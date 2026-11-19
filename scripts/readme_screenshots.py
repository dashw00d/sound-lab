#!/usr/bin/env python3
"""Regenerate the README screenshots in docs/screenshots/.

What it does, end to end:
  1. Writes a small demo game (a soundlab_project.py and a handful of sounds) into a temporary folder.
  2. Runs the real `sounds generate` pipeline on it (prompt variants x seeds, mastering, the index).
     The model is replaced by a tiny numpy synthesiser, so the takes are STAND-IN AUDIO (beeps, sweeps, noise
     bursts), not Stable Audio 3 output. This needs no GPU and no model download.
  3. Writes some demo votes, starts `serve` on a spare port, and captures the web app with headless Chromium.

It never touches your own projects. Requirements, beyond the repo's: numpy, playwright (`playwright install chromium`),
Pillow, ffmpeg on PATH, and the web app built (`npm ci && npm run build` in web-app/).

    python scripts/readme_screenshots.py [--out docs/screenshots]
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
import urllib.request
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
SR = 44100

# name: (kind, seconds, prompt, extra prompt variants {name: prompt})
SOUNDS = {
    "coin_pickup": ("oneshot", 1.0, "Bright two-note coin pickup chime, metallic ping with a short sparkle tail, retro arcade, dry.",
                    {"bell": "A small brass bell struck twice, rising pitch, clean and close, no reverb.",
                     "chip": "8-bit coin collect blip, square wave, two quick ascending notes."}),
    "jump": ("oneshot", 0.8, "Cartoon jump boing, rising pitch sweep with a soft rubbery wobble, dry.",
             {"spring": "Short spring boing, a coiled spring released, quick upward pitch bend."}),
    "sword_hit": ("oneshot", 1.0, "Sword strike on a metal shield, sharp transient, ringing metallic decay, close mic.",
                  {"heavy": "Heavy steel blade slamming a shield, loud clang with a long ring.",
                   "light": "Quick light rapier tap on armor, short bright tick."}),
    "footstep_stone": ("oneshot", 0.6, "Single boot footstep on a stone floor, dull thud with a little grit, dry and close.",
                       {"echo": "One footstep on stone in a large hall, thud followed by a faint echo."}),
    "ui_click": ("oneshot", 0.4, "Soft interface button click, short tick, gentle and clean.", {}),
    "explosion_small": ("oneshot", 2.0, "Small explosion, punchy low boom with a crackling debris tail.",
                        {"distant": "A distant explosion, rolling low rumble, muffled."}),
    "wind_loop": ("loop", 4.0, "Steady cold wind over a mountain ridge, seamless loop, soft gusts, no melody.", {}),
}
SHIPPED = ["coin_pickup", "ui_click", "footstep_stone", "sword_hit"]

# Votes: take id -> 1 | -1; picks: sound -> take id. Take ids are "<sound>.<variant>.s<seed>".
THUMBS = {
    "coin_pickup.el.s0": -1, "coin_pickup.el.s1": 1, "coin_pickup.el.s2": 1, "coin_pickup.bell.s0": 1, "coin_pickup.bell.s1": -1,
    "coin_pickup.chip.s2": -1, "sword_hit.el.s0": 1, "sword_hit.el.s2": -1, "sword_hit.heavy.s1": 1, "sword_hit.heavy.s0": 1,
    "sword_hit.light.s0": -1, "sword_hit.light.s1": -1, "jump.el.s1": 1, "jump.spring.s0": 1, "jump.spring.s2": -1,
    "explosion_small.el.s1": 1, "explosion_small.distant.s0": -1, "footstep_stone.el.s0": 1, "footstep_stone.echo.s1": -1,
    "ui_click.el.s2": 1, "ui_click.el.s0": -1,
}
PICKS = {"coin_pickup": "coin_pickup.el.s1", "sword_hit": "sword_hit.heavy.s1", "jump": "jump.spring.s0",
         "footstep_stone": "footstep_stone.el.s0", "explosion_small": "explosion_small.el.s1"}
NOTES = {"coin_pickup": "Want it brighter and shorter. The bell takes ring too long.",
         "sword_hit": "Heavy takes are close. Less ring on the tail."}


# --------------------------------------------------------------------------- stand-in synthesiser

def synth(name: str, prompt: str, seed: int, seconds: float) -> np.ndarray:
    """Deterministic stand-in audio shaped loosely like the sound's name, varied by prompt and seed. (samples, 2)."""
    rng = np.random.default_rng((sum(map(ord, prompt)) * 1009 + seed * 7919) % (2 ** 32))  # (not hash(): stable across runs)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    j = 1 + 0.12 * rng.standard_normal()  # pitch jitter per take
    noise = rng.standard_normal(n)

    def lp(x, k):  # crude low-pass: moving average
        return np.convolve(x, np.ones(k) / k, mode="same")

    if name == "coin_pickup":
        f1, f2 = 988 * j, 1319 * j
        x = np.where(t < 0.09, np.sin(2 * np.pi * f1 * t), np.sin(2 * np.pi * f2 * t)) * np.exp(-np.maximum(t - 0.09, 0) * 7)
        x += 0.3 * np.sin(2 * np.pi * 2 * f2 * t) * np.exp(-t * 9)
    elif name == "jump":
        f = 220 * j * np.exp(t * 2.6)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4) * (1 + 0.3 * np.sin(2 * np.pi * 14 * t))
    elif name == "sword_hit":
        x = noise * np.exp(-t * 60) + sum(np.sin(2 * np.pi * f * j * t) * np.exp(-t * d) * a
                                          for f, d, a in ((1180, 5, .5), (2310, 7, .35), (3470, 11, .25)))
    elif name == "footstep_stone":
        x = lp(noise, 40) * np.exp(-t * 28) * 8 + np.sin(2 * np.pi * 70 * j * t) * np.exp(-t * 22)
    elif name == "ui_click":
        x = np.sin(2 * np.pi * 1800 * j * t) * np.exp(-t * 90) + 0.2 * noise * np.exp(-t * 200)
    elif name == "explosion_small":
        x = lp(noise, 30) * np.exp(-t * 2.2) * 6 + np.sin(2 * np.pi * 48 * j * t) * np.exp(-t * 3)
        x += 0.15 * noise * np.exp(-t * 6)
    else:  # wind_loop: slowly gusting low-passed noise, faded at the ends so it tiles
        gust = 0.6 + 0.4 * np.sin(2 * np.pi * (0.35 * j) * t + rng.uniform(0, 6))
        x = lp(noise, 14) * gust * 5
        fade = int(0.3 * SR)
        x[:fade] *= np.linspace(0, 1, fade)
        x[-fade:] *= np.linspace(1, 0, fade)
    x = x / (np.abs(x).max() + 1e-9) * 0.6
    pan = rng.uniform(0.85, 1.0)
    return np.stack([x, x * pan], axis=1)


class StubEngine:
    """Stands in for soundlab.engine.Engine (Stable Audio 3): same generate() signature, no model."""
    last_s = 0.02

    def generate(self, prompt, seconds, seed, **_):
        for name, (_, secs, p, extra) in SOUNDS.items():
            if prompt in (p, *extra.values()) or prompt.rstrip(".") in (p.rstrip("."), *[v.rstrip(".") for v in extra.values()]):
                return synth(name, prompt, seed, seconds)
        return synth("ui_click", prompt, seed, seconds)


# --------------------------------------------------------------------------- the demo game

PROJECT_PY = '''\
"""A demo game's soundlab_project.py, written by scripts/readme_screenshots.py."""
from pathlib import Path

from soundlab.project import Project, Sound

HERE = Path(__file__).resolve().parent
SOUNDS = %(sounds)r
SHIPPED = %(shipped)r


def project():
    def sounds():
        out = []
        for name, (kind, secs, prompt, _extra) in SOUNDS.items():
            f = HERE / "assets" / "audio" / ("%%s.wav" %% name)
            out.append(Sound(name=name, kind=kind, seconds=secs, channels=2, prompt=prompt, out=f,
                             palette="loops" if kind == "loop" else "one-shots",
                             shipped=f if name in SHIPPED else None))
        return out

    return Project(name="demo-game", root=HERE, work=HERE.parent / "work" / "demo-game", data=HERE.parent / "data",
                   assets=HERE / "assets", sounds=sounds)
'''


def build_demo(game: Path) -> None:
    from soundlab import dsp

    game.mkdir(parents=True, exist_ok=True)
    (game / "soundlab_project.py").write_text(PROJECT_PY % dict(sounds=SOUNDS, shipped=SHIPPED))
    (game / "assets" / "audio").mkdir(parents=True, exist_ok=True)
    for name in SHIPPED:  # the files the demo game "ships now", for the A/B against a take
        _, secs, p, _ = SOUNDS[name]
        dsp.write(game / "assets" / "audio" / f"{name}.wav", dsp.normalise(synth(name, p, 99, secs), -18.0, -1.0))
    (game.parent / "data").mkdir(exist_ok=True)  # outside the game folder, so the lab uses it in place
    (game.parent / "data" / "prompts.json").write_text(json.dumps({n: v[3] for n, v in SOUNDS.items() if v[3]}, indent=1))


def generate(game: Path) -> None:
    """The repo's own `sounds generate`, with the model swapped for the stand-in synthesiser."""
    os.environ["PYTHONPATH"] = str(REPO) + os.pathsep + os.environ.get("PYTHONPATH", "")
    sys.path.insert(0, str(REPO))
    import soundlab.engine as engine

    engine.Engine = StubEngine
    from soundlab.__main__ import main

    sys.argv = ["soundlab", "--project", str(game), "sounds", "generate", "--seeds", "3"]
    if main():
        sys.exit("generate failed")


def write_votes(game: Path) -> None:
    idx = json.loads((game.parent / "work" / "demo-game" / "index.json").read_text())
    clips = {k: v for k, v in THUMBS.items() if k in idx["clips"]}
    at = {k: "2026-11-02T18:%02d:00+00:00" % (i % 60) for i, k in enumerate(clips)}
    votes = dict(clips=clips, at=at, picks={k: v for k, v in PICKS.items() if v in idx["clips"]}, notes=NOTES)
    (game.parent / "data" / "votes.json").write_text(json.dumps(votes, indent=1))


# --------------------------------------------------------------------------- capture

def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def optimise(path: Path, width: int = 1280) -> None:
    from PIL import Image

    im = Image.open(path).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(path, optimize=True)
    q = im.quantize(colors=128, method=Image.Quantize.MEDIANCUT) if path.stat().st_size > 350_000 else None
    if q is not None:
        q.save(path, optimize=True)


CHROMIUM = os.environ.get("SOUNDLAB_CHROMIUM")  # optional path to a Chromium / headless shell Playwright can drive


def shots():
    def pick_take(page):  # load the picked take into the player at the bottom
        page.locator("text=take 2").nth(1).click()
        page.wait_for_timeout(1500)  # (it plays once; let the one-second sound finish)

    # (file, URL hash, viewport height, what to do on the page first)
    return [("sounds-page.png", "/#sounds/sword_hit", 1000, pick_take)]


def terminal_html(game: Path, commands: list[list[str]]) -> str:
    """Run real soundlab commands against the demo game and lay their output out like a terminal."""
    import html

    shown_root = "demo-game"
    out = []
    for cmd in commands:
        text = subprocess.run([sys.executable, "-m", "soundlab", "--project", str(game), *cmd], cwd=REPO, capture_output=True,
                              text=True, env=dict(os.environ, PYTHONPATH=str(REPO), PYTHONDONTWRITEBYTECODE="1")).stdout
        text = text.replace(str(game), shown_root)
        out.append(f'<div class="p">$ ./soundlab.sh --project {shown_root} {" ".join(cmd)}</div>' + html.escape(text).rstrip() + "\n")
    return ("<style>body{margin:0;background:#0b0d12}pre{margin:0;padding:22px 26px;color:#d7dae0;font:15px/1.5 'DejaVu Sans Mono',"
            "monospace;width:max-content;max-width:1180px;white-space:pre-wrap}.p{color:#8fd694;margin-top:12px}.p:first-child{margin-top:0}"
            "</style><pre>" + "\n".join(out) + "</pre>")


def capture(game: Path, out: Path) -> None:
    from playwright.sync_api import sync_playwright

    port = free_port()
    env = dict(os.environ, PYTHONPATH=str(REPO), PYTHONDONTWRITEBYTECODE="1")
    srv = subprocess.Popen([sys.executable, "-m", "soundlab", "--project", str(game), "serve", "--port", str(port)],
                           cwd=REPO, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f"http://127.0.0.1:{port}"
        for _ in range(60):
            try:
                urllib.request.urlopen(base + "/api/stamp", timeout=1)
                break
            except OSError:
                time.sleep(0.5)
        out.mkdir(parents=True, exist_ok=True)
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=CHROMIUM) if CHROMIUM else p.chromium.launch()
            for name, path, height, prep in shots():
                page = browser.new_page(viewport={"width": 1440, "height": height})
                page.goto(base + path)
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(1000)
                prep(page)
                page.wait_for_timeout(800)
                page.screenshot(path=str(out / name))
                page.close()
                optimise(out / name)
                print("captured", out / name, (out / name).stat().st_size // 1024, "KB")
            page = browser.new_page(viewport={"width": 1280, "height": 400})
            page.set_content(terminal_html(game, [["status"], ["sounds", "promote"]]))
            page.locator("pre").screenshot(path=str(out / "cli-status.png"))
            optimise(out / "cli-status.png")
            print("captured", out / "cli-status.png", (out / "cli-status.png").stat().st_size // 1024, "KB")
            browser.close()
    finally:
        srv.terminate()
        srv.wait(timeout=10)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(REPO / "docs" / "screenshots"))
    ap.add_argument("--keep", help="build the demo game in this (empty) folder and keep it; default: a temporary folder")
    args = ap.parse_args()
    sys.path.insert(0, str(REPO))
    tmp = None if args.keep else tempfile.TemporaryDirectory(prefix="soundlab-demo-")
    game = Path(args.keep or tmp.name).resolve() / "game"
    build_demo(game)
    generate(game)
    write_votes(game)
    capture(game, Path(args.out))
    if tmp:
        tmp.cleanup()


if __name__ == "__main__":
    main()

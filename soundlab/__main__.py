"""SoundLab command line. Run through ./soundlab.sh (Linux) or soundlab.cmd (Windows), which use the installed runtime.

  soundlab [--project PATH] serve [--port 7870]          the web app
  soundlab [--project PATH] status [--json]              what the project has: sounds, takes, decisions, music
  soundlab doctor [--generate]                           check the install (and make one second of audio)
  soundlab [--project PATH] sounds generate [--seeds 3] [--only NAME ...] [--variants V ...]
  soundlab [--project PATH] sounds promote [--apply] [--only NAME ...]
  soundlab [--project PATH] alerts build
  soundlab [--project PATH] music audition [--seeds 4]
  soundlab [--project PATH] music generate --contexts C ... [--biomes B ...] [--takes 3] [--tries 14]
  soundlab [--project PATH] music promote [--apply]
  soundlab [--project PATH] balance measure

--project is a game folder holding soundlab_project.py, or the file itself (default: SOUNDLAB_PROJECT, else the
current folder). Generators skip takes that already exist, so re-running only adds what is new.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys


def doctor(generate: bool) -> int:
    import os

    from . import paths

    os.environ.setdefault("HF_HOME", str(paths.hf_home()))  # (before huggingface_hub is imported: it reads it once)
    ok = True

    def line(good: bool, what: str, detail: str = "") -> None:
        nonlocal ok
        ok &= good
        print(f"  [{'ok' if good else '!!'}] {what}" + (f": {detail}" if detail else ""))

    print("SoundLab doctor")
    line(sys.version_info >= (3, 10), "python", sys.version.split()[0])
    ff = shutil.which(paths.ffmpeg())
    line(bool(ff), "ffmpeg", ff or "not found (install it and put it on PATH, or set FFMPEG)")
    if ff:
        filters = subprocess.run([paths.ffmpeg(), "-hide_banner", "-filters"], capture_output=True, text=True).stdout
        line(" rubberband " in filters, "ffmpeg rubberband filter", "needed for the music's tempo correction")
    try:
        import torch

        cuda = torch.cuda.is_available()
        line(cuda, "torch + CUDA", f"{torch.__version__}, {torch.cuda.get_device_name(0) if cuda else 'no CUDA GPU'}")
    except ImportError as e:
        line(False, "torch", str(e))
    try:
        import flash_attn

        line(True, "flash-attn", flash_attn.__version__)
    except ImportError:
        print("  [--] flash-attn: not installed (optional: Stable Audio 3 falls back to PyTorch attention)")
    for mod in ("stable_audio_3", "librosa", "soundfile"):
        try:
            __import__(mod)
            line(True, mod)
        except ImportError as e:
            line(False, mod, str(e))
    from huggingface_hub import try_to_load_from_cache

    have = [isinstance(try_to_load_from_cache(paths.MODEL_REPO, f), str)
            for f in ("model.safetensors", "model_config.json", "t5gemma-b-b-ul2/model.safetensors")]
    line(all(have), "model", f"{paths.MODEL_REPO} in {paths.hf_home()}" if all(have) else "missing: run install.py")
    if generate and ok:
        from .engine import Engine

        eng = Engine()
        x = eng.generate("TrackType: SFX, a single wooden knock, close mic.", 1.0, 0)
        from . import dsp

        line(not dsp.silent(x), "generation", f"1 s of audio in {eng.last_s:.2f} s")
    print("all good" if ok else "problems above")
    return 0 if ok else 1


def status(proj, as_json: bool) -> int:
    from .store import Store

    st = Store(proj)
    idx, votes = st.index(), st.votes()
    sounds = [s.name for s in proj.sounds()]
    taken = {c["name"] for c in idx["clips"].values()}
    out = dict(
        project=proj.name, file=proj.path(),
        sounds=dict(total=len(sounds), with_takes=sum(n in taken for n in sounds),
                    decided=sum(n in votes["picks"] for n in sounds),
                    kept_shipped=sum(votes["picks"].get(n) == "shipped" for n in sounds),
                    undecided=[n for n in sounds if n in taken and n not in votes["picks"]]),
        takes=dict(total=len(idx["clips"]), silent=sum(1 for c in idx["clips"].values() if c.get("failed"))),
        notes=votes["notes"],
        alert_sets=len(idx.get("sets", {}).get("alerts", {}).get("rows", [])),
        music={k: len(c["takes"]) for k, c in idx.get("mesh", {}).get("contexts", {}).items()},
        promoted=dict(sounds=len(Store.read(st.promoted_path, {})), music_tracks=len(Store.read(st.music_promoted_path, {}))),
    )
    if as_json:
        print(json.dumps(out, indent=1))
        return 0
    s = out["sounds"]
    print(f"{proj.name} ({proj.path()})")
    print(f"  sounds: {s['total']}, {s['with_takes']} with takes, {s['decided']} decided ({s['kept_shipped']} keep the shipped file)")
    if s["undecided"]:
        print(f"  undecided: {', '.join(s['undecided'][:12])}{' ...' if len(s['undecided']) > 12 else ''}")
    print(f"  takes: {out['takes']['total']} ({out['takes']['silent']} silent)")
    print(f"  alert sets: {out['alert_sets']}; music sets: {out['music'] or 'none'}")
    print(f"  shipped: {out['promoted']['sounds']} sounds, {out['promoted']['music_tracks']} music tracks")
    for n, t in votes["notes"].items():
        print(f"  note on {n}: {t}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="soundlab", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", help="game folder with soundlab_project.py, or the file")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("serve")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=7870)
    p = sub.add_parser("status")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("doctor")
    p.add_argument("--generate", action="store_true")
    snd = sub.add_parser("sounds").add_subparsers(dest="action", required=True)
    p = snd.add_parser("generate")
    p.add_argument("--seeds", type=int, default=3)
    p.add_argument("--only", nargs="*")
    p.add_argument("--variants", nargs="*")
    p = snd.add_parser("promote")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--only", nargs="*")
    al = sub.add_parser("alerts").add_subparsers(dest="action", required=True)
    al.add_parser("build")
    mu = sub.add_parser("music").add_subparsers(dest="action", required=True)
    p = mu.add_parser("audition")
    p.add_argument("--seeds", type=int, default=4)
    p = mu.add_parser("generate")
    p.add_argument("--contexts", nargs="+", required=True)
    p.add_argument("--biomes", nargs="*", default=["any"])
    p.add_argument("--takes", type=int, default=3)
    p.add_argument("--tries", type=int, default=14)
    p = mu.add_parser("promote")
    p.add_argument("--apply", action="store_true")
    ba = sub.add_parser("balance").add_subparsers(dest="action", required=True)
    ba.add_parser("measure")
    a = ap.parse_args()

    if a.cmd == "doctor":
        return doctor(a.generate)
    from . import project

    proj = project.load(a.project)
    if a.cmd == "serve":
        from .server import serve

        serve(proj, a.host, a.port)
        return 0
    if a.cmd == "status":
        return status(proj, a.json)
    if a.cmd == "sounds":
        from . import sounds

        return sounds.generate(proj, a.seeds, a.only, a.variants) if a.action == "generate" else \
            sounds.promote(proj, a.apply, a.only)
    if a.cmd == "alerts":
        from . import alerts

        return alerts.build(proj)
    if a.cmd == "music":
        from . import music

        if not proj.music:
            raise SystemExit("this project has no music design (Project.music)")
        if a.action == "audition":
            return music.auditions(proj, a.seeds)
        if a.action == "generate":
            bad = [c for c in a.contexts if c not in proj.music["contexts"]] + \
                  [b for b in a.biomes if b not in proj.music["biomes"]]
            if bad:
                raise SystemExit(f"unknown contexts/biomes: {bad}")
            return music.generate(proj, a.contexts, a.biomes, a.takes, a.tries)
        return music.promote(proj, a.apply)
    if a.cmd == "balance":
        from . import balance

        return balance.measure(proj)
    return 1


if __name__ == "__main__":
    sys.exit(main())

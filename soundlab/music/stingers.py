"""Stingers (2026-10-21, the designer on Musloop's: "Stingers, i like that"): short accents at a scene change, where the
walk comes out of a rest into a new scene. They mask the seam and make the change sound meant. A riser builds over the
rest and stops exactly on the new scene's first downbeat; a boom (a low drum or impact) and a crash (a cymbal or gong)
land on that downbeat. Unpitched, so they never clash with a song's key.

`music stingers` makes takes of each kind from the prompts below (sound-effect prompts, as tuning.json's sfx rules say:
one physical source, its action once, the recording; Emberhold's taste: dark cinematic, big drums, no folk), trims each
to where it acts (a riser cut at its loudest moment, so the build ends on the bar line; a hit from its attack), and
levels it. The designer thumbs them on the Mixer page; the Mixer plays the liked ones at scene changes, and the sync
ships them to the game (soundlab/sync). Takes already made stay; more --seeds only adds.
"""
from __future__ import annotations

import numpy as np

from .. import dsp, project as P, tuning
from ..store import Store

# (kind: seconds to generate, the most to keep, and the prompts)
KINDS = {
    "riser": dict(seconds=7.0, keep=6.0, prompts={
        "reverse": "TrackType: SFX, a reversed cymbal swell rising to a sudden stop, one long build, close mic, studio.",
        "roll": "TrackType: SFX, a snare drum roll building from soft to loud, one long crescendo, close mic, large hall.",
        "whoosh": "TrackType: SFX, a deep rising whoosh building to a sudden cut, one long swell, close mic, studio.",
        "strings": "TrackType: SFX, low strings trembling in a rising crescendo, one swell to a sudden stop, close mic, large hall.",
    }),
    "boom": dict(seconds=5.0, keep=4.0, prompts={
        "wardrum": "TrackType: SFX, a huge war drum struck once, a deep boom with a long rumble, close mic, large hall.",
        "taiko": "TrackType: SFX, a taiko drum hit once with a heavy mallet, deep and booming, close mic, large hall.",
        "impact": "TrackType: SFX, a deep cinematic impact, one low hit with a long decay, close mic, studio.",
        "timpani": "TrackType: SFX, timpani struck once, one deep thunderous hit, close mic, concert hall.",
    }),
    "crash": dict(seconds=6.0, keep=5.0, prompts={
        "crash": "TrackType: SFX, a large crash cymbal struck once, a long shimmer fading out, close mic, studio.",
        "gong": "TrackType: SFX, a big gong struck once with a soft mallet, a long dark wash, close mic, large hall.",
        "suspended": "TrackType: SFX, a suspended cymbal hit once with a mallet, a swelling shimmer, close mic, concert hall.",
        "anvil": "TrackType: SFX, a heavy chain dropped once on a stone floor, one metallic crash, close mic, large hall.",
    }),
}
LUFS, CEILING = -20.0, -3.0  # (an accent: under the music's own -18, its peaks limited)


def _env(x: np.ndarray, hop: int) -> np.ndarray:
    m = x.mean(axis=1)
    return np.array([np.sqrt(np.mean(m[k:k + hop] ** 2)) + 1e-9 for k in range(0, len(m) - hop, hop)])


def shape(kind: str, x: np.ndarray, keep: float) -> tuple[np.ndarray, dict]:
    """A take trimmed to where it acts. A riser: cut at its loudest moment after its first third (the build ends on
    the bar line), at most `keep` seconds before it, faded in; with how directed its build is (Musloop's build-up test:
    the normalised slope of its loudness and R^2). A hit: from its attack, at most `keep` seconds, the last half second
    faded out."""
    sr, hop = dsp.SR, int(dsp.SR * 0.01)
    env = _env(x, hop)
    if kind == "riser":
        k0 = len(env) // 3
        peak = k0 + int(np.argmax(np.convolve(env[k0:], np.ones(5) / 5, mode="same")))
        end = min(len(x), (peak + 2) * hop)
        start = max(0, end - int(keep * sr))
        y = x[start:end].copy()
        n_in, n_out = min(len(y) // 3, int(0.3 * sr)), min(len(y) // 10, int(0.012 * sr))
        y[:n_in] *= np.linspace(0, 1, n_in)[:, None]
        y[-n_out:] *= np.linspace(1, 0, n_out)[:, None]
        e = _env(y, hop)
        xs = np.arange(len(e), dtype=float)
        fit = np.polyfit(xs, e, 1)
        slope = float(fit[0]) * len(e) / float(e.mean())
        r2 = 1 - float(np.sum((e - np.polyval(fit, xs)) ** 2)) / (float(np.sum((e - e.mean()) ** 2)) + 1e-12)
        return y, dict(slope=round(slope, 2), r2=round(max(0.0, r2), 2), rises=bool(slope > 0.35 and r2 > 0.25))
    y = dsp.onset_trim(x)[: int(keep * sr)].copy()
    n_out = min(len(y) // 4, int(0.5 * sr))
    y[-n_out:] *= np.linspace(1, 0, n_out)[:, None]
    return y, {}


def generate(proj: P.Project, seeds: int = 6, kinds: list[str] | None = None) -> int:
    """Takes of each kind (sounds stinger_<kind>), shaped and levelled, for the Mixer page."""
    tuning.require("sfx")
    st = Store(proj)
    idx = st.index()
    todo = [(k, v, s) for k in (kinds or KINDS) for v in KINDS[k]["prompts"] for s in range(seeds)
            if f"stinger_{k}.{v}.s{s}" not in idx["clips"]]
    if not todo:
        print("every stinger take already exists; pass a larger --seeds for more", flush=True)
        return 0
    from ..engine import Engine

    eng = Engine()
    for kind in kinds or KINDS:
        K, name, made = KINDS[kind], f"stinger_{kind}", 0
        idx["sounds"][name] = dict(kind="stinger", seconds=K["keep"], channels=2, palette=kind, shipped=None)
        idx["prompts"][name] = dict(K["prompts"])
        for variant, prompt in K["prompts"].items():
            for seed in range(seeds):
                cid = f"{name}.{variant}.s{seed}"
                if cid in idx["clips"]:
                    continue
                raw = eng.generate(prompt, K["seconds"], seed)
                if dsp.silent(raw):
                    idx["clips"][cid] = dict(name=name, variant=variant, seed=seed, prompt=prompt, file=None, failed=True, kind=kind)
                    continue
                y, info = shape(kind, raw, K["keep"])
                y = dsp.normalise(y, LUFS, CEILING)
                rel = f"stingers/{kind}/{variant}.s{seed}.ogg"
                dsp.write(st.clips / rel, y)
                idx["clips"][cid] = dict(name=name, variant=variant, seed=seed, prompt=prompt, file=rel, failed=dsp.silent(y),
                                         duration=round(len(y) / dsp.SR, 3), gen_s=round(eng.last_s, 2), kind=kind, **info)
                made += 1
        st.save_index(idx)
        print(f"  {name}: {made} takes", flush=True)
    return 0


def takes(proj: P.Project) -> dict[str, list[dict]]:
    """Every stinger take, by kind, with its votes (for the Mixer and the sync)."""
    idx, clips = Store(proj).index(), Store(proj).votes()["clips"]
    out: dict[str, list[dict]] = {k: [] for k in KINDS}
    for cid, c in idx["clips"].items():
        if cid.startswith("stinger_") and c.get("file") and not c.get("failed") and c.get("kind") in out:
            out[c["kind"]].append(dict(id=cid, file=c["file"], variant=c["variant"], seed=c["seed"], seconds=c.get("duration"),
                                       rises=c.get("rises"), slope=c.get("slope"), vote=clips.get(cid, 0)))
    for v in out.values():
        v.sort(key=lambda t: (t["variant"], t["seed"]))
    return out

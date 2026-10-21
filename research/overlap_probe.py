"""Overlap probe: can two songs, or two levels, be laid over each other on the grid? (Research, outside the app.
2026-10-19, the designer: "I want to see if overlapping songs by a bar or two sounds good. For intense music we would
maybe need to overlay the calm version and ramp it up.")

Renders listening demos from liked takes into the project's clips/overlap/ (served by `serve` at /clips/overlap/):

  switch   song A's loop end into song B's start, three ways:
             now      B starts on A's last bar line, A fades over two beats (what the game does today)
             1bar     A's last bar under B's first, an equal-power crossfade over the bar
             2bar     the same over two bars
  ramp     a song's calm level into intensity, three ways:
             now      calm to its own action level with a two-beat crossfade (the game today)
             own      calm keeps playing; its own action level ramps in over 4 bars on top of it
             other    calm keeps playing; another song's action level ramps in over 4 bars on top of it

Every file starts on a downbeat of the 90 BPM grid, so bar lines meet sample-exactly. Measured per pair:
  chroma    cosine between the two files' mean chroma (1 = the same pitch classes; under ~0.8 they lean on
            different notes) and the shift (semitones) that matches them best (0 = the same key centre)
  lag_ms    the onset-envelope cross-correlation lag within a beat (0 = beats land together)
  lufs      integrated loudness of the overlap region next to each part alone (the overlaid ramps are brought
            down over the ramp to end at the action level's loudness, so they aren't heard as better for being louder)

  runtime/venv/bin/python research/overlap_probe.py --project P      (results: research/data/overlap_probe.json)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))

# (name, A as set/take/profile/level, B as the same): song-to-song switches
SWITCHES = [
    ("night_samestyle", "night~violinbed/k0/stack/calm", "night~violinbed/k1/stack/calm"),
    ("night_violinbed_to_violin", "night~violinbed/k4/stack/calm", "night~violin/k2/stack/calm"),
    ("night_trailer_to_tagelharpa", "night~trailer/k2/close/calm", "night~tagelharpa2/k0/stack/calm"),
    ("day_action_war2", "day~war2/k0/stack/action", "day~war2/k2/stack/action"),
]
# (name, the calm song, another song whose action level is ramped over it)
RAMPS = [
    ("night_violinbed", "night~violinbed/k0/stack", "night~trailer/k2/close"),
    ("day_violinbed", "day~violinbed/k0/stack", "day~war2/k0/stack"),
]
LEAD, TAIL, RAMP, HOLD = 6, 6, 4, 4  # bars: before the change, after it, the ramp's length, both held after it


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    a = ap.parse_args()
    import librosa
    from soundlab import dsp, project as P
    from soundlab.store import Store

    proj = P.load(a.project)
    st = Store(proj)
    sets = st.index()["mesh"]["contexts"]
    M = proj.music
    bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * dsp.SR))
    beat = bar // M["bar_beats"]
    out = st.clips / "overlap"
    out.mkdir(parents=True, exist_ok=True)

    def load(ref: str) -> np.ndarray:
        key, tid, prof, level = ref.split("/")
        take = next(t for t in sets[key]["takes"] if t["id"] == tid)
        return dsp.decode(st.clips / take["profiles"][prof]["levels"][level])

    def span(x: np.ndarray, start: int, n: int) -> np.ndarray:
        """n samples of a loop from start, wrapping round (the game loops every file)."""
        return np.take(x, np.arange(start, start + n) % len(x), axis=0)

    def fade(n: int, shape: str) -> tuple[np.ndarray, np.ndarray]:
        if shape == "eq":  # equal power: out, in
            t = np.linspace(0, 1, n)
            return np.cos(t * np.pi / 2), np.sin(t * np.pi / 2)
        g = 10 ** (np.linspace(-40, 0, n) / 20)  # a ramp in dB from -40 to full
        return np.ones(n), g

    def save(name: str, y: np.ndarray) -> str:
        y = dsp.limit(y, -1.0)
        dsp.write(out / f"{name}.ogg", y)
        return f"overlap/{name}.ogg"

    def measure(x: np.ndarray, y: np.ndarray) -> dict:
        cx = librosa.feature.chroma_cqt(y=x.mean(axis=1).astype(np.float32), sr=dsp.SR).mean(axis=1)
        cy = librosa.feature.chroma_cqt(y=y.mean(axis=1).astype(np.float32), sr=dsp.SR).mean(axis=1)
        cos = [float(np.roll(cx, k) @ cy / (np.linalg.norm(cx) * np.linalg.norm(cy) + 1e-9)) for k in range(12)]
        ex, fps = dsp.onset_env(x)
        ey, _ = dsp.onset_env(y)
        n = min(len(ex), len(ey))
        w = int(round(fps * beat / dsp.SR))
        cc = [float(np.dot(ex[:n - abs(k)] if k >= 0 else ex[-k:n], ey[k:n] if k >= 0 else ey[:n + k]))
              for k in range(-w // 2, w // 2 + 1)]
        lag = (int(np.argmax(cc)) - w // 2) / fps * 1000
        best = int(np.argmax(cos))
        return dict(chroma=round(cos[0], 3), best_shift=best if best <= 6 else best - 12,
                    best_chroma=round(cos[best], 3), lag_ms=round(lag, 1))

    def lufs(x: np.ndarray) -> float:
        return round(dsp.loudness_stats(x)[0], 1)

    results = dict(bar_s=bar / dsp.SR, switches={}, ramps={})
    for name, ra, rb in SWITCHES:
        x, y = load(ra), load(rb)
        L = len(x)
        r = dict(a=ra, b=rb, **measure(x, y), files={})
        # now: B from A's loop end; A runs on past it (wrapping) and fades out over two beats
        head = span(x, L - LEAD * bar, LEAD * bar)
        fo, fi = fade(2 * beat, "eq")
        mix = span(y, 0, TAIL * bar).copy()
        mix[:2 * beat] = mix[:2 * beat] * fi[:, None] + span(x, 0, 2 * beat) * fo[:, None]
        r["files"]["now"] = save(f"switch_{name}_now", np.concatenate([head, mix]))
        for k in (1, 2):
            n = k * bar
            fo, fi = fade(n, "eq")
            over = span(x, L - n, n) * fo[:, None] + span(y, 0, n) * fi[:, None]
            seq = np.concatenate([span(x, L - LEAD * bar, LEAD * bar - n), over, span(y, n, TAIL * bar)])
            r["files"][f"{k}bar"] = save(f"switch_{name}_{k}bar", seq)
            if k == 2:
                r["lufs"] = dict(a=lufs(span(x, L - n, n)), b=lufs(span(y, 0, n)), overlap=lufs(over),
                                 both_full=lufs(span(x, L - n, n) + span(y, 0, n)))
        results["switches"][name] = r
        print(f"switch {name}: chroma {r['chroma']} (best {r['best_chroma']} at {r['best_shift']:+d}), "
              f"lag {r['lag_ms']} ms, lufs {r['lufs']}", flush=True)

    for name, song, other in RAMPS:
        calm, act, oth = load(f"{song}/calm"), load(f"{song}/action"), load(f"{other}/action")
        r = dict(song=song, other=other, own=measure(calm, act), other_m=measure(calm, oth), files={})
        p = LEAD * bar  # the change lands on this bar line, at the same loop position in every level (synced stems)
        fo, fi = fade(2 * beat, "eq")
        now = np.concatenate([span(calm, 0, p), span(act, p, (RAMP + HOLD) * bar)])
        now[p:p + 2 * beat] = span(calm, p, 2 * beat) * fo[:, None] + span(act, p, 2 * beat) * fi[:, None]
        r["files"]["now"] = save(f"ramp_{name}_now", now)
        for tag, top in (("own", act), ("other", oth)):
            n = (RAMP + HOLD) * bar
            g = np.concatenate([fade(RAMP * bar, "ramp")[1], np.ones(HOLD * bar)])
            seq = np.concatenate([span(calm, 0, p), span(calm, p, n) + span(top, p, n) * g[:, None]])
            # calm and a loud level summed end louder than the action level alone, and louder reads as better:
            # bring the mix down over the ramp so it ends at the game's action loudness
            d = M["lufs"]["action"] - dsp.loudness_stats(seq[-HOLD * bar:])[0]
            trim = 10 ** (d * np.concatenate([np.linspace(0, 1, RAMP * bar), np.ones(HOLD * bar)]) / 20)
            seq[p:] *= trim[:, None]
            r["files"][tag] = save(f"ramp_{name}_{tag}", seq)
            r[f"lufs_{tag}"] = dict(calm=lufs(span(calm, p, HOLD * bar)), top=lufs(span(top, p, HOLD * bar)),
                                    both=lufs(seq[-HOLD * bar:]))
        results["ramps"][name] = r
        print(f"ramp {name}: own {r['own']}, other {r['other_m']}, lufs own {r['lufs_own']}, "
              f"other {r['lufs_other']}", flush=True)

    dest = LAB / "research" / "data" / "overlap_probe.json"
    dest.write_text(json.dumps(results, indent=1))
    print(f"wrote {dest} and {out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

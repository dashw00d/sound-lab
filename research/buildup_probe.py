"""Do our songs' cut-off endings make build-ups? (2026-10-21, the designer, on Musloop: "Buildup detection for the
graph?"). Musloop marks a section a build-up, to play once rather than loop, when its loudness has a directed trend
(normalised RMS slope > 0.6 with R^2 > 0.35, or > 0.35 with R^2 > 0.25 and brightness rising with it or a poor loop
closure: backend/analysis.py _is_transition). Our loops are cut from the middle of a longer piece, and the guessed mellow
cues leave out its end (bars after the cue's end, the crescendo SA3 writes). This measures, for every shipped song's calm
level: the bars after its cue, as a section, by Musloop's test; how much louder its last beat is than the loop's mean;
and whether its brightness rises. Writes research/data/buildup_probe.json.

  runtime/venv/bin/python research/buildup_probe.py --project P
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from soundlab import dsp, project as P  # noqa: E402
from soundlab.music.shipping import library  # noqa: E402
from soundlab.store import Store  # noqa: E402


def trend(v: np.ndarray) -> tuple[float, float]:
    """Musloop's normalised slope (change over the section against its mean) and R^2 of a straight line."""
    x = np.arange(len(v), dtype=float)
    fit = np.polyfit(x, v, 1)
    slope = float(fit[0]) * len(v) / max(float(v.mean()), 1e-8)
    res = float(np.sum((v - np.polyval(fit, x)) ** 2)); tot = float(np.sum((v - v.mean()) ** 2)) + 1e-12
    return slope, max(0.0, 1 - res / tot)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    a = ap.parse_args()
    proj = P.load(a.project)
    M, lib = proj.music, library(proj)
    votes = Store(proj).votes()
    beat = int(round(60.0 / M["bpm"] * dsp.SR)); nb = M["bar_beats"]
    rows = []
    for t in lib["tracks"]:
        m = t.get("measure") or {}
        cue = (votes.get("cues", {}).get(t["id"]) or {}).get("mellow") or ((m.get("cuts") or {}).get("calm") or [{}])[0].get("bars")
        if not cue or "calm" not in t["files"]:
            continue
        lo, hi = cue
        if hi >= M["bars"] - 1:
            rows.append(dict(id=t["id"], cue=cue, tail_bars=M["bars"] - hi, buildup=None))
            continue
        x = dsp.decode(Path(proj.assets) / t["files"]["calm"]).mean(axis=1)
        # (per beat: RMS, and the spectral centroid as brightness)
        rms, cent = [], []
        for k in range(len(x) // beat):
            seg = x[k * beat:(k + 1) * beat]
            rms.append(float(np.sqrt(np.mean(seg ** 2)) + 1e-9))
            S = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
            f = np.fft.rfftfreq(len(seg), 1 / dsp.SR)
            cent.append(float((S * f).sum() / (S.sum() + 1e-9)))
        rms, cent = np.array(rms), np.array(cent)
        a0, a1 = hi * nb, M["bars"] * nb  # (the bars after the cue's end)
        sl, r2 = trend(rms[a0:a1]); cs, _ = trend(cent[a0:a1])
        loop = rms[(lo - 1) * nb:hi * nb]
        strong = abs(sl) > 0.6 and r2 > 0.35
        moderate = abs(sl) > 0.35 and r2 > 0.25 and sl * cs > 0 and abs(cs) > 0.25
        rows.append(dict(id=t["id"], cue=cue, tail_bars=M["bars"] - hi, slope=round(sl, 2), r2=round(r2, 2), bright=round(cs, 2),
                         end_db=round(20 * np.log10(rms[a1 - 1] / loop.mean()), 1), rising=sl > 0,
                         buildup=bool((strong or moderate) and sl > 0), falling=bool((strong or moderate) and sl < 0)))
    Path("research/data").mkdir(exist_ok=True)
    json.dump(rows, open("research/data/buildup_probe.json", "w"), indent=1)
    have = [r for r in rows if r["buildup"] is not None]
    print(f"{len(rows)} songs; {len(rows) - len(have)} loop to their end (no bars after the cue: nothing to measure)")
    print(f"bars after the cue: " + ", ".join(f"{n}: {sum(1 for r in have if r['tail_bars'] == n)}" for n in sorted({r['tail_bars'] for r in have})))
    b = [r for r in have if r["buildup"]]; f = [r for r in have if r["falling"]]
    print(f"build-ups by Musloop's test: {len(b)} of {len(have)} ({100 * len(b) / max(1, len(have)):.0f}%); falling (breakdowns): {len(f)}")
    print(f"rising at all: {sum(1 for r in have if r['rising'])}; brightness rising with it: {sum(1 for r in have if r['rising'] and r['bright'] > 0)}")
    e = sorted(r["end_db"] for r in b)
    if e:
        print(f"the build-ups' last beat against their loop's mean: median {e[len(e) // 2]:+.1f} dB (from {e[0]:+.1f} to {e[-1]:+.1f})")
    for r in sorted(b, key=lambda r: -r["slope"])[:6]:
        print(f"  {r['id']}: bars {r['cue'][1] + 1}-16, slope {r['slope']}, R2 {r['r2']}, brightness {r['bright']}, ends {r['end_db']:+.1f} dB")


if __name__ == "__main__":
    main()

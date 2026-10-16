"""End drift: does a music take stay steady to its last bar, or build toward an ending? (Research, outside the app.
2026-10-15, after the designer: SA3 "will often slip some weird stuff in toward the end trying to reach a crescendo".)

For each take's spine (its calm level: the loop itself), per bar: loudness (RMS dB) and timbre (mean MFCC, without
the energy coefficient). Per take:
  end rise    the last 4 bars' loudness minus the median of the first 12 (dB; a crescendo is positive)
  end change  1 - cosine between the last 4 bars' timbre and the first 12's (0 = the same sound)
  wander      the spread of bar loudness over all 16 bars (dB; steadiness over the full length)

  runtime/venv/bin/python research/end_drift.py --project P STYLE ...     (every set of those styles)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))


def drift(path: Path, bars: int, bar_s: float) -> dict:
    import librosa
    from soundlab import dsp
    x = dsp.decode(path).mean(axis=1).astype(np.float32)
    n = int(bar_s * dsp.SR)
    rms, mf = [], []
    for b in range(bars):
        seg = x[b * n:(b + 1) * n]
        if len(seg) < n // 2:
            break
        rms.append(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9))
        mf.append(librosa.feature.mfcc(y=seg, sr=dsp.SR, n_mfcc=20)[1:].mean(axis=1))
    rms, mf = np.array(rms), np.array(mf)
    head, tail = slice(0, bars - 4), slice(bars - 4, bars)
    a, b = mf[head].mean(axis=0), mf[tail].mean(axis=0)
    return dict(rise=float(rms[tail].mean() - np.median(rms[head])),
                change=float(1 - a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)),
                wander=float(np.std(rms)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("styles", nargs="+")
    a = ap.parse_args()
    from soundlab import project as pj
    from soundlab.store import Store
    proj = pj.load(a.project)
    st, M = Store(proj), proj.music
    bar_s = 60.0 / M["bpm"] * M["bar_beats"]
    C = st.index()["mesh"]["contexts"]
    allr = []
    for key in sorted(k for k in C if k.split("~")[-1] in a.styles):
        rows = []
        for t in C[key]["takes"]:
            prof = next(iter(t["profiles"].values()), {})
            f = (prof.get("levels") or {}).get("calm")
            if f and (st.clips / f).exists():
                rows.append(drift(st.clips / f, M["bars"], bar_s))
        if rows:
            allr += rows
            print(f"{key:26s} n {len(rows)}  end rise {np.mean([r['rise'] for r in rows]):+5.2f} dB "
                  f"(max {max(r['rise'] for r in rows):+5.2f})  end change {np.mean([r['change'] for r in rows]):.3f}  "
                  f"wander {np.mean([r['wander'] for r in rows]):.2f} dB")
    if allr:
        print(f"{'all':26s} n {len(allr)}  end rise {np.mean([r['rise'] for r in allr]):+5.2f} dB  "
              f"end change {np.mean([r['change'] for r in allr]):.3f}  wander {np.mean([r['wander'] for r in allr]):.2f} dB  "
              f"(end rise over +1.5 dB: {sum(r['rise'] > 1.5 for r in allr)} of {len(allr)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

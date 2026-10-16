"""Layers probe (2026-10-15): can a theme be built from whole-length layers (a bed, a melody, drums) that fit each other?

1. Separation: Demucs (htdemucs) splits a full take into drums, bass, vocals and other. On our orchestral takes the
   melody stays in "other" with the harmony, so separation gives a drumless bed (bass + other) and a drum layer, not a
   melody (see MODELS_LOG.md).
2. A melody derived from the bed: audio-to-audio from the drumless bed, prompted for a solo instrument playing a
   melody, at a few strengths. Each result is measured against its bed: harmony agreement per bar (chroma, as
   quality.drift), how many notes sound at once (a melody is one line), and Audiobox's content enjoyment.

  runtime/venv/bin/python research/layers_probe.py BED_DIR... --out DIR
    (BED_DIR: a Demucs output folder with bass.wav and other.wav; writes DIR/<theme>/bed.wav, melody_*.wav,
     bed+melody_*.wav and DIR/report.json)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))
from soundlab import dsp, paths, quality  # noqa: E402

os.environ.setdefault("HF_HOME", str(paths.hf_home()))

BPM, BB = 90.0, 4
INSTRUMENTS = {"cello": "solo cello", "horn": "solo French horn"}
STRENGTHS = (0.4, 0.55, 0.7)


def polyphony(f: dict) -> float:
    """Pitch classes sounding at once, per beat (those over half the beat's strongest), averaged: 1 for a single line."""
    c = f["beat_chroma"]
    return float(((c / (c.max(axis=0, keepdims=True) + 1e-9)) > 0.5).sum(axis=0).mean())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("beds", nargs="+")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    from soundlab.engine import Engine

    eng = Engine()
    out = Path(a.out)
    report = {}
    for d in map(Path, a.beds):
        theme = d.name
        bed = dsp.decode(d / "bass.wav") + dsp.decode(d / "other.wav")  # (drumless: what's left without the drums)
        bed = dsp.normalise(bed, -20.0, -2.5)
        (out / theme).mkdir(parents=True, exist_ok=True)
        dsp.write(out / theme / "bed.wav", bed)
        fb = quality.features(bed, BPM)
        rows = {"bed": dict(poly=round(polyphony(fb), 2))}
        sec = len(bed) / dsp.SR
        for ik, inst in INSTRUMENTS.items():
            prompt = (f"TrackType: Instrument, {inst} playing a slow, mournful melody, a single line, dark and cinematic, "
                      f"recorded in a large hall. BPM: 90.")
            for s in STRENGTHS:
                y = eng.generate(prompt, sec, 7, init=bed, noise=s)
                y = y[:len(bed)] if len(y) >= len(bed) else np.pad(y, ((0, len(bed) - len(y)), (0, 0)))
                y = dsp.normalise(y, -20.0, -2.5)
                key = f"{ik}_{s}"
                dsp.write(out / theme / f"melody_{key}.wav", y)
                dsp.write(out / theme / f"bed+melody_{key}.wav", dsp.normalise(bed * 10 ** (-4 / 20) + y, -18.0, -1.5))
                f = quality.features(y, BPM)
                dr = quality.drift(f, fb, BB)
                rows[key] = dict(agree=round(1 - float(np.mean(dr)), 3), worst_bar=round(1 - max(dr), 3), poly=round(polyphony(f), 2))
                print(f"{theme:28s} {key:10s} agree {rows[key]['agree']:.3f} (worst bar {rows[key]['worst_bar']:.3f})  notes at once {rows[key]['poly']:.2f}", flush=True)
        report[theme] = rows
    files = [(t, k) for t, r in report.items() for k in r if k != "bed"]
    for (t, k), aes in zip(files, quality.aesthetics([str(out / t / f"melody_{k}.wav") for t, k in files])):
        if aes:
            report[t][k]["CE"] = aes["CE"]
    (out / "report.json").write_text(json.dumps(report, indent=1))
    print("\nby setting (mean over themes): agree / notes at once / CE")
    for k in sorted({k for r in report.values() for k in r if k != "bed"}):
        v = [r[k] for r in report.values() if k in r]
        print(f"  {k:10s} {np.mean([x['agree'] for x in v]):.3f} / {np.mean([x['poly'] for x in v]):.2f} / {np.mean([x.get('CE', 0) for x in v]):.2f}")
    print("  beds: notes at once " + ", ".join(f"{t} {r['bed']['poly']}" for t, r in report.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())

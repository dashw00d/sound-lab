"""Scene probe (2026-10-21): what a scene is made of, and how chill each song is.

The designer: a family is one scene, made of "lead instrument, beat/bass, and amount of aggregate noise. We want to go
from chill to less chill in waves." Measured on every song's calm level (and the battle level, to check the energy):

  beat      the onset strength at each sixteenth of the bar, averaged over the bars and normalised (the rhythm's
            shape), and the percussive share of the sound (librosa HPSS)
  bass      the share of energy under 150 Hz
  noise     spectral flatness (how noise-like), onset busyness (how much is happening), the share over 4 kHz
  energy    how un-chill a song is: those standardised and averaged (busyness, flatness, percussive share, highs)

Checks: a song's battle level should be more energetic than its calm (it's 10 dB louder and busier by design); the
designer's transition votes, liked inside a scene against across. Features cached in research/data/scene_features.json.

    runtime/venv/bin/python research/scene_probe.py --project PATH
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from soundlab import dsp, families, project as P  # noqa: E402
from soundlab.store import Store  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "scene_features.json"


def features(path: Path, bpm: float, bar_beats: int, bars: int) -> dict:
    return families.sound(dsp.decode(path), dict(bpm=bpm, bar_beats=bar_beats, bars=bars))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    proj = P.load(ap.parse_args().project)
    M, st = proj.music, Store(proj)
    fam = Store.read(proj.work / "families.json", {})
    cache = json.loads(OUT.read_text()) if OUT.exists() else {}
    path = lambda u: st.clips / u[len("/clips/"):] if u.startswith("/clips/") else Path(proj.assets) / u[len("/shipped/"):]
    ids = list(fam["items"])
    for n, i in enumerate(ids):
        for lv in ("calm", "battle"):
            src = fam["items"][i]["src"].get(lv)
            if src and f"{i}|{lv}" not in cache:
                cache[f"{i}|{lv}"] = features(path(src), M["bpm"], M["bar_beats"], M["bars"])
        if n % 25 == 0:
            OUT.write_text(json.dumps(cache))
            print(f"  {n} of {len(ids)}", flush=True)
    OUT.write_text(json.dumps(cache))
    keys = ("busy", "flat", "perc", "highs", "bass")
    calm = {i: cache[f"{i}|calm"] for i in ids if f"{i}|calm" in cache}
    allv = {k: np.array([c[k] for c in calm.values()]) for k in keys}
    zs = lambda k, v: (v - allv[k].mean()) / allv[k].std()
    energy = lambda c: float(np.mean([zs(k, c[k]) for k in ("busy", "flat", "perc", "highs")]))
    E = {i: energy(c) for i, c in calm.items()}
    up = [energy(cache[f"{i}|battle"]) - E[i] for i in calm if f"{i}|battle" in cache]
    print(f"energy, battle level over calm: higher in {np.mean(np.array(up) > 0):.0%} of {len(up)} songs (median +{np.median(up):.2f})")
    for k in keys:
        d = [cache[f"{i}|battle"][k] - calm[i][k] for i in calm if f"{i}|battle" in cache]
        print(f"  {k:6s} battle over calm: higher in {np.mean(np.array(d) > 0):.0%}")
    by = {}
    for i, e in E.items():
        by.setdefault(i.split(".")[0], []).append(e)
    print("energy by context: " + ", ".join(f"{c} {np.median(v):+.2f}" for c, v in sorted(by.items(), key=lambda t: np.median(t[1]))))
    lead = {}
    for i, e in E.items():
        lead.setdefault(fam["items"][i]["lead"], []).append(e)
    print("energy by lead: " + ", ".join(f"{c} {np.median(v):+.2f} ({len(v)})" for c, v in sorted(lead.items(), key=lambda t: np.median(t[1])) if len(v) >= 5))
    votes = st.votes()["clips"]
    rows = []
    for k, v in votes.items():
        m = re.match(r"^join_(.+)@(\d+)>(.+)\|(\d+)$", k)
        if m and v and m.group(1) in E and m.group(3) in E:
            rows.append((v > 0, E[m.group(1)], E[m.group(3)]))
    y = np.array([r[0] for r in rows])
    d = np.array([r[2] - r[1] for r in rows])
    auc = lambda x: float(np.mean([(a > b) + 0.5 * (a == b) for a in x[y] for b in x[~y]]))
    print(f"transitions: energy step (B less A) AUC {auc(d):.3f}; its size AUC {auc(-np.abs(d)):.3f} ({len(rows)} votes)")
    json.dump(dict(energy=E), open(OUT.with_name("scene_energy.json"), "w"))
    return 0


if __name__ == "__main__":
    sys.exit(main())

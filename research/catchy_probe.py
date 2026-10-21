"""Catchiness probe: does a shipped song have a tune that sticks? (Research, outside the app. 2026-10-21: the song-level
score's "complex" rewarded unpredictable notes, and its top songs struck the designer as "the weirdest, not the best".)

What makes a melody catchy, from hook and earworm research (Burgoyne, Van Balen et al., "Hooked", 2013-15: melodic
repetition and conventional, typical intervals make a hook recognisable; Jakubowski et al. 2017: earworms have common
contours, mostly stepwise, with a distinctive leap, and simple rhythm), measured on Basic Pitch's notes of each track's
calm "other" stem (work/notes.json, made by research/notes_probe.py). The melody: the highest strong note on a
sixteenth grid (as in notes_probe).

  tune        the melody stands out: the share of the loop it sounds, times how much louder its notes are than the
              other notes sounding with them (a pad has no tune: always sounding, never louder)
  motif       a phrase comes back: for lags of 1, 2 and 4 bars, how many of a bar's melody onsets (sixteenth, pitch)
              recur L bars later (Jaccard), the best lag's mean
  varied_rep  it comes back changed, not looped: motif's share of bars that recur close but not exact (0.3-0.9)
  stepwise    the share of the melody's moves that are steps (1-2 semitones) among all moves
  leap        it has a hook leap: at least one move of 5-8 semitones per 4 bars, capped at 1
  singable    the melody's range (5-95th percentile) within 12 semitones (1), falling off to 0 at 24
  in_key      the share of melody notes in D minor (natural or harmonic)
  home        the share of melody notes on D, F or A, and of phrase-ending notes (bars 4, 8, 12, 16) on D
  rhythm      the melody's onset pattern (16 steps) repeats bar to bar (mean Jaccard to the next bar)
  density     notes per bar, scored 1 between 2 and 8 and falling off outside it
Each is standardised; catchy is their sum. Checked against the designer's saved sets and against the song score's
"complex" (expected opposite).

  runtime/venv/bin/python research/catchy_probe.py --project P      (results: research/data/catchy_probe.json)
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

import numpy as np

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))

KEY = {2, 4, 5, 7, 9, 10, 0, 1}  # D minor, natural and harmonic
HOME = {2, 5, 9}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    a = ap.parse_args()
    from soundlab import project as P
    from soundlab.store import Store

    proj = P.load(a.project)
    M = proj.music
    beat = 60.0 / M["bpm"]
    bar = beat * M["bar_beats"]
    N = M["bars"]
    step = beat / 4
    per_bar = M["bar_beats"] * 4
    steps = N * per_bar
    notes = Store.read(proj.work / "notes.json", {})

    rows = {}
    for tid, nn in notes.items():
        if not nn:
            continue
        top = max(n[3] for n in nn)
        strong = [n for n in nn if n[3] >= 0.5 * top]
        mel, amp, other = [None] * steps, [0.0] * steps, [0.0] * steps
        for i in range(steps):
            t = i * step + step / 2
            on = [n for n in strong if n[0] <= t < n[1]]
            if on:
                hi = max(on, key=lambda n: n[2])
                mel[i], amp[i] = hi[2], hi[3]
                rest = [n[3] for n in on if n is not hi]
                other[i] = float(np.mean(rest)) if rest else 0.0
        # melody notes: (step, pitch) where the skyline changes to a new note
        mn = [(i, p) for i, p in enumerate(mel) if p is not None and (i == 0 or mel[i - 1] != p)]
        if len(mn) < 4:
            continue
        pitches = np.array([p for _, p in mn])
        iv = np.diff(pitches)
        moves = iv[iv != 0]
        sounding = [i for i in range(steps) if mel[i] is not None]
        cover = len(sounding) / steps
        lift = float(np.mean([amp[i] - other[i] for i in sounding])) / top
        bars = [{(i % per_bar, p) for i, p in mn if i // per_bar == b} for b in range(N)]
        jac = lambda x, y: len(x & y) / len(x | y) if x | y else 0.0
        best, best_lag = -1.0, 1
        for lag in (1, 2, 4):
            v = float(np.mean([jac(bars[b], bars[(b + lag) % N]) for b in range(N)]))
            if v > best:
                best, best_lag = v, lag
        near = [jac(bars[b], bars[(b + best_lag) % N]) for b in range(N)]
        rh = [{i for i, _ in b_} for b_ in bars]
        rng = float(np.percentile(pitches, 95) - np.percentile(pitches, 5))
        ends = [mel[min(steps - 1, (b + 1) * per_bar - 1)] for b in range(3, N, 4)]
        ends = [p for p in ends if p is not None]
        dens = len(mn) / N
        rows[tid] = dict(
            tune=cover * max(0.0, lift),
            motif=best,
            varied_rep=float(np.mean([0.3 <= x <= 0.9 for x in near])),
            stepwise=float(np.mean(np.abs(moves) <= 2)) if len(moves) else 0.0,
            leap=min(1.0, float(np.sum((np.abs(moves) >= 5) & (np.abs(moves) <= 8))) / (N / 4)),
            singable=float(np.clip((24 - rng) / 12, 0, 1)),
            in_key=float(np.mean([p % 12 in KEY for p in pitches])),
            home=0.5 * float(np.mean([p % 12 in HOME for p in pitches])) + 0.5 * (float(np.mean([p % 12 == 2 for p in ends])) if ends else 0.0),
            rhythm=float(np.mean([jac(rh[b], rh[(b + 1) % N]) for b in range(N)])),
            density=float(1.0 if 2 <= dens <= 8 else np.exp(-abs(np.log(dens / (2 if dens < 2 else 8))))),
            notes_per_bar=dens, range=rng, lag=best_lag,
        )
    ids = sorted(rows)
    keys = ["tune", "motif", "varied_rep", "stepwise", "leap", "singable", "in_key", "home", "rhythm", "density"]

    def zs(k):
        v = np.array([rows[t][k] for t in ids], float)
        return {t: float(np.clip((x - v.mean()) / (v.std() + 1e-9), -2.5, 2.5)) for t, x in zip(ids, v)}
    Z = {k: zs(k) for k in keys}
    catchy = {t: sum(Z[k][t] for k in keys) for t in ids}
    order = sorted(ids, key=lambda t: -catchy[t])

    mixes = Store.read(Path(proj.data) / "mixes.json", {})
    in_sets = collections.Counter(p["track"] for mx in mixes.values() for p in mx["parts"])
    scores = Store.read(LAB / "research" / "data" / "song_scores.json", {})
    cx = scores.get("parts", {}).get("complex", {})

    def auc(s):
        pos = [s[t] for t in ids if in_sets[t]]
        neg = [s[t] for t in ids if not in_sets[t]]
        return float(np.mean([(p > n) + 0.5 * (p == n) for p in pos for n in neg]))

    short = lambda t: t.replace(".any", "").replace(".stack", "").replace(".close", " (close)")
    print(f"{len(ids)} songs. catchy = the sum of the standardised parts")
    print(f"{'#':>3} {'song':30s} {'catchy':>6} " + " ".join(f"{k[:6]:>6}" for k in keys) + "  n/bar range set")
    for i, t in enumerate(order):
        if i < 15 or i >= len(order) - 8:
            print(f"{i + 1:3d} {short(t):30s} {catchy[t]:+6.1f} " + " ".join(f"{Z[k][t]:+6.1f}" for k in keys)
                  + f"  {rows[t]['notes_per_bar']:5.1f} {rows[t]['range']:5.0f}  {'SET' if in_sets[t] else ''}")
        elif i == 15:
            print("  ...")
    print(f"\nagainst the saved sets (AUC, 0.5 = no relation): catchy {auc(catchy):.2f} · " + " · ".join(f"{k} {auc(Z[k]):.2f}" for k in keys))
    if cx:
        common = [t for t in ids if t in cx]
        print(f"catchy against the song score's complex: r = {np.corrcoef([catchy[t] for t in common], [cx[t] for t in common])[0, 1]:+.2f}")
    (LAB / "research" / "data" / "catchy_probe.json").write_text(json.dumps(dict(order=order, catchy=catchy, parts=Z, raw=rows), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

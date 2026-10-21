"""Notes probe: does note-level analysis predict the designer's taste in transitions? (Research, outside the app.
2026-10-21: after 315 transition votes in the Mixer, the taste model, built from loudness and onsets per beat and each
song's record, is right 67% of the time on votes it didn't see; what's left looked melodic: "does a phrase sound
finished at the exit, does the next song's opening sound like a beginning".)

Each shipped track's calm level, its Demucs "other" stem (melody and harmony, no drums; the retuned copy where the
track was retuned, as the Mixer plays it), is transcribed to notes by Basic Pitch (Spotify, ICASSP 2022; its ONNX model
on onnxruntime: basic-pitch installed --no-deps, its TensorFlow has no Python 3.12 build). The melody is the skyline:
on a sixteenth-note grid, the highest note sounding at at least half the loudest note's amplitude.

Measured around each voted transition (song a's bar e into song b from its bar s; t_a the end of a's bar e, t_b the
start of b's bar s):
  a_cut          a melody note of a sounding across t_a (held over the bar line, so the cut lands mid-note)
  a_cut_share    the share of a's strong notes sounding across t_a (any voice, not only the melody)
  a_rest         a's last beat before t_a has no strong note starting (the line comes to rest)
  a_home         a's last melody note before t_a is D, F or A (the home chord)
  a_tonic        it is D
  a_fall         a's last four melody notes move down on the whole (phrases tend to fall into their end)
  b_down         b has a melody note starting on t_b (within an eighth of a beat)
  b_fresh        in b's own song, the beat before t_b has no strong note starting (b's line begins there)
  b_home         b's first melody note at or after t_b is D, F or A
  leap           semitones from a's last melody note to b's first
  register       a's melody's mean pitch over its bar e against b's over its bar s, in semitones
  density_gap    notes starting per beat: a's bar e against b's bar s (log ratio)
  semis          strong pitch classes a semitone apart across the join (a's bar e against b's bar s; any pair)

Each is judged by AUC against the votes, and the best are tried in the taste model by leave-one-out.

  runtime/venv/bin/python research/notes_probe.py --project P [--melody top|loud]     (results: research/data/notes_probe[_loud].json;
  the transcriptions are cached in the project's work folder, notes.json)
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
from pathlib import Path

import numpy as np

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))

HOME = {2, 5, 9}  # D, F, A


def transcribe(path: Path) -> list[tuple[float, float, int, float]]:
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    _, _, notes = predict(str(path), ICASSP_2022_MODEL_PATH, onset_threshold=0.5, frame_threshold=0.3, minimum_note_length=80)
    return [(float(a), float(b), int(p), float(v)) for a, b, p, v, *_ in notes]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--melody", choices=("top", "loud"), default="top", help="the melody: the highest strong note at each step, or the loudest")
    a = ap.parse_args()
    from soundlab import music, project as P
    from soundlab.store import Store

    proj = P.load(a.project)
    st = Store(proj)
    M = proj.music
    beat = 60.0 / M["bpm"]
    bar = beat * M["bar_beats"]
    lib = music.library(proj)
    measured = Store.read(proj.work / "songs.json", {})
    cache_path = proj.work / "notes.json"
    cache = Store.read(cache_path, {})
    for t in lib["tracks"]:
        rel = (t.get("stems") or {}).get("calm.other")
        if not rel or t["id"] in cache:
            continue
        cache[t["id"]] = transcribe(st.clips / rel)
        print(f"  {t['id']}: {len(cache[t['id']])} notes", flush=True)
    st.write(cache_path, cache)

    N, loop = M["bars"], M["bars"] * bar
    step = beat / 4

    def strong(notes):  # notes at at least half the loudest's amplitude
        top = max((n[3] for n in notes), default=0)
        return [n for n in notes if n[3] >= 0.5 * top]

    def melody(notes):  # the skyline on the sixteenth grid: (time, pitch) per step, None where nothing sounds
        out = []
        for i in range(int(round(loop / step))):
            t = i * step + step / 2
            on = [n for n in notes if n[0] <= t < n[1]]
            out.append(max(on, key=lambda n: n[3])[2] if a.melody == "loud" and on else max((n[2] for n in on), default=None))
        return out

    tracks = {}
    for tid, notes in cache.items():
        sn = strong(notes)
        tracks[tid] = dict(notes=sn, mel=melody(sn))

    def mel_notes(tid, t0, t1):  # the melody's notes (start step, pitch) between t0 and t1 (seconds, may wrap)
        m, out, last = tracks[tid]["mel"], [], None
        for i in range(int(round(t0 / step)), int(round(t1 / step))):
            p = m[i % len(m)]
            if p is not None and p != last:
                out.append((i, p))
            last = p
        return out

    def starts(tid, t0, t1):
        return [n for n in tracks[tid]["notes"] if t0 <= n[0] < t1 or t0 <= n[0] + loop < t1 or t0 <= n[0] - loop < t1]

    rows = []
    for k, v in st.votes()["clips"].items():
        if not k.startswith("join_"):
            continue
        try:
            sa, rest = k[5:].rsplit("@", 1)
            e, sb = rest.split(">", 1)
            sb, s = sb.rsplit("|", 1)
            e, s = int(e), int(s)
        except ValueError:
            continue
        if sa not in tracks or sb not in tracks:
            continue
        ta, tb = (e * bar) % loop, ((s - 1) * bar) % loop
        na = tracks[sa]["notes"]
        across = [n for n in na if n[0] < ta - beat / 8 and n[1] > ta + beat / 8]
        mel_a = mel_notes(sa, ta - bar, ta)
        mel_b = mel_notes(sb, tb, tb + bar)
        last_a = mel_a[-1][1] if mel_a else None
        first_b = mel_b[0][1] if mel_b else None
        ma, mb = tracks[sa]["mel"], tracks[sb]["mel"]
        held = ma[int(round(ta / step)) % len(ma) - 1] is not None and ma[int(round(ta / step)) % len(ma) - 1] == ma[int(round(ta / step)) % len(ma)]
        pa = {n[2] % 12 for n in starts(sa, ta - bar, ta)}
        pb = {n[2] % 12 for n in starts(sb, tb, tb + bar)}
        reg = lambda m, t0: [p for p in (m[i % len(m)] for i in range(int(round(t0 / step)), int(round((t0 + bar) / step)))) if p is not None]
        ra, rb = reg(ma, ta - bar), reg(mb, tb)
        f = dict(
            vote=v,
            a_cut=float(held),
            a_cut_share=len(across) / max(1, len([n for n in na if n[0] < ta + beat / 8 and n[1] > ta - beat])),
            a_rest=float(not starts(sa, ta - beat, ta)),
            a_home=float(last_a is not None and last_a % 12 in HOME),
            a_tonic=float(last_a is not None and last_a % 12 == 2),
            a_fall=float(len(mel_a) >= 2 and np.mean(np.diff([p for _, p in mel_a[-4:]])) < 0),
            b_down=float(any(abs(n[0] - tb) < beat / 8 or abs(n[0] + loop - tb) < beat / 8 for n in tracks[sb]["notes"])),
            b_fresh=float(not starts(sb, tb - beat, tb - beat / 8)),
            b_home=float(first_b is not None and first_b % 12 in HOME),
            leap=float(abs(first_b - last_a)) if last_a is not None and first_b is not None else np.nan,
            register=float(abs(np.mean(ra) - np.mean(rb))) if ra and rb else np.nan,
            density_gap=float(abs(np.log((len(starts(sb, tb, tb + bar)) + 1) / (len(starts(sa, ta - bar, ta)) + 1)))),
            semis=float(sum(1 for x in pa for y in pb if (x - y) % 12 in (1, 11))),
        )
        f.update({x: music.join_features(measured, sa, e, sb, s)[x] for x in ("level_a", "entry_phrase", "attack_b", "held_a")})
        rows.append(f)
    y = np.array([r["vote"] > 0 for r in rows])

    def auc(xs, yy):
        xs = np.array(xs, float)
        m = ~np.isnan(xs)
        pos, neg = xs[m & yy], xs[m & ~yy]
        return float(np.mean([(p > q) + 0.5 * (p == q) for p in pos for q in neg])) if len(pos) and len(neg) else float("nan")

    feats = ["a_cut", "a_cut_share", "a_rest", "a_home", "a_tonic", "a_fall", "b_down", "b_fresh", "b_home", "leap", "register", "density_gap", "semis"]
    print(f"\n{len(rows)} votes ({int(y.sum())} good). AUC: 0.5 = no better than a coin; under 0.5 = higher means worse")
    res = {}
    for f in feats:
        xs = [r[f] for r in rows]
        res[f] = dict(auc=auc(xs, y), good=float(np.nanmean([r[f] for r in rows if r["vote"] > 0])), bad=float(np.nanmean([r[f] for r in rows if r["vote"] < 0])))
    for f, r in sorted(res.items(), key=lambda kv: -abs(kv[1]["auc"] - 0.5)):
        print(f"  {f:12s} AUC {r['auc']:.2f}   good avg {r['good']:6.2f}   bad avg {r['bad']:6.2f}")

    # the taste model with the strongest of them (leave one out; no song records here: they are the same either way)
    base = ["level_a", "entry_phrase", "attack_b", "held_a"]
    yv = y.astype(float)

    def loo(fs):
        X = np.array([[r[f] for f in fs] for r in rows], float)
        X = np.where(np.isnan(X), np.nanmean(X, axis=0), X)
        p = np.zeros(len(rows))
        for i in range(len(rows)):
            keep = np.arange(len(rows)) != i
            mu, sd, w = music._fit_logistic(X[keep], yv[keep])
            p[i] = 1 / (1 + np.exp(-(w[0] + ((X[i] - mu) / sd) @ w[1:])))
        return auc(p, y), float(((p > 0.5) == y).mean())

    top = [f for f, r in sorted(res.items(), key=lambda kv: -abs(kv[1]["auc"] - 0.5))][:5]
    print("\nthe taste model's audio features, with the strongest new ones (leave one out):")
    tried = [("as now", base)] + [(f"+ {f}", base + [f]) for f in top] + [(f"+ {' + '.join(c)}", base + list(c)) for c in itertools.combinations(top[:3], 2)]
    out = {}
    for label, fs in tried:
        a_, r_ = loo(fs)
        out[label] = dict(auc=a_, right=r_)
        print(f"  AUC {a_:.2f}  right {r_:.0%}  {label}")
    (LAB / "research" / "data" / f"notes_probe{'' if a.melody == 'top' else '_' + a.melody}.json").write_text(json.dumps(dict(features=res, models=out, n=len(rows)), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

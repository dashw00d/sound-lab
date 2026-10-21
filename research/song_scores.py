"""Song scores: which shipped songs are the library's best? (Research, outside the app. 2026-10-21, the designer: "If
something is diverse, complex, doesn't red line, and plays nice often, it's likely very good.")

Every shipped track's calm level (its mellow) scored on:
  plays_nice   how many transitions the taste model (work/join_model.json) puts at 80% or more, out of it and into it,
               against every other song, over its exits (phrase ends inside its cues) and entries (phrase starts)
  calm         the opposite of red-lining: loudness spikes (the loudest beat over the median beat, dB), the share of
               energy in the harsh 2-5 kHz band, and how hard its attacks hit (the mean of the strongest quarter of its
               beat onsets against its median busyness); each standardised, summed, negated
  varied       how much it changes bar to bar (1 - the mean cosine of neighbouring bars' fingerprints)
  unique       how unlike the rest of the library it sounds (1 - its mean CLAP cosine to its 5 nearest other songs)
  complex      from Basic Pitch's notes (work/notes.json): the melody's range, the number of distinct pitches, the
               entropy of its intervals and of its note lengths; each standardised, summed
  quality      Audiobox Aesthetics content enjoyment (CE) of the calm level, where installed
  nice_blind   plays_nice by the taste model's audio features alone (song records at their mean, votes ignored): the
               measure that isn't circular against the votes, and the one a new take can have
Each is standardised across the library (clipped at ±2.5); the total is their sum (quality at half weight, nice_blind
left out). Found (MODELS_LOG 2026-10-21): only nice_blind and complex track the designer's sets; varied counts against.

Checked against the designer's own signals: the songs in their saved Mixer sets (data/mixes.json) and each song's
record in their transition votes.

  runtime/venv/bin/python research/song_scores.py --project P     (results: research/data/song_scores.json)
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    a = ap.parse_args()
    from soundlab import dsp, music, project as P, quality
    from soundlab.store import Store

    proj = P.load(a.project)
    st = Store(proj)
    lib = music.library(proj)
    T = {t["id"]: t for t in lib["tracks"]}
    m = Store.read(proj.work / "songs.json", {})
    notes = Store.read(proj.work / "notes.json", {})
    M = Store.read(proj.work / "join_model.json", None)
    votes = st.votes()
    clips, cues = votes["clips"], votes.get("cues", {})
    ids = [t for t in T if t in m and "feat" in m[t] and "onset" in m[t]]

    # --- plays nice: the taste model over every exit into every entry
    cnt = collections.defaultdict(lambda: [0, 0])
    for k, x in clips.items():
        if k.startswith("join_"):
            s_a, rest = k[5:].rsplit("@", 1)
            s_b = rest.split(">", 1)[1].rsplit("|", 1)[0]
            for t in {s_a, s_b}:
                cnt[t][0 if x > 0 else 1] += 1
    rec = {t: music.song_record(*c) for t, c in cnt.items()}

    def cue(t):
        return (cues.get(t) or {}).get("mellow") or m[t]["cuts"]["calm"][0]["bars"]

    ex, en = [], []
    for t in ids:
        lo, hi = cue(t)
        ph = m[t]["phrase"]
        s0 = ph["start"] if ph["contrast"] >= 0.08 else lo
        starts = [b for b in range(lo, hi - 2) if (b - s0) % 4 == 0] or [lo]
        en += [(t, b) for b in starts]
        ex += [(t, e) for e in range(lo, hi + 1) if (e - s0) % 4 == 3] or [(t, b + 3) for b in starts]

    def jbar(sa, e, sb, s):
        fa, fb = np.array(m[sa]["feat"]), np.array(m[sb]["feat"])
        at = lambda f, i: f[(i - 1) % len(f)]
        ba, bb = m[sa]["beats"]["calm"], m[sb]["beats"]["calm"]
        step = abs(bb[((s - 1) * 4) % len(bb)] - ba[((e - 1) * 4 + 3) % len(ba)])
        return 0.5 * (at(fa, e + 1) @ at(fb, s) + at(fa, e) @ at(fb, s - 1)) - 0.03 * max(0, step - 2)

    def prob(sa, e, sb, s, blind=False):
        f = music.join_features(m, sa, e, sb, s)
        f["rec_a"], f["rec_b"] = (M["mu"][M["features"].index("rec_a")], M["mu"][M["features"].index("rec_b")]) if blind else (rec.get(sa, 0), rec.get(sb, 0))
        z = M["w"][0] + sum(M["w"][i + 1] * (f[x] - M["mu"][i]) / M["sd"][i] for i, x in enumerate(M["features"]))
        return 1 / (1 + np.exp(-z))

    nice, blind = collections.Counter(), collections.Counter()  # blind: the audio alone (no song records, no votes)
    for sa, e in ex:
        for sb, s in en:
            if sa == sb or clips.get(f"join_{sa}@{e}>{sb}|{s}", 0) < 0 or jbar(sa, e, sb, s) < 0.6:
                continue
            if clips.get(f"join_{sa}@{e}>{sb}|{s}", 0) > 0 or prob(sa, e, sb, s) >= 0.8:
                nice[sa] += 1
                nice[sb] += 1
            if prob(sa, e, sb, s, blind=True) >= 0.8:
                blind[sa] += 1
                blind[sb] += 1
    print("plays nice: counted", flush=True)

    # --- calm (not red-lining), varied, complex, from the measurements and the audio
    rows = {}
    for t in ids:
        r = m[t]
        beats = np.array(r["beats"]["calm"])
        busy, attack = np.array(r["onset"]["busy"]), np.array(r["onset"]["attack"])
        x = dsp.decode(Path(proj.assets) / T[t]["files"]["calm"]).mean(axis=1)
        S = np.abs(np.fft.rfft(x[:dsp.SR * 30])) ** 2
        fr = np.fft.rfftfreq(min(len(x), dsp.SR * 30), 1 / dsp.SR)
        harsh = float(S[(fr > 2000) & (fr < 5000)].sum() / S[fr > 40].sum())
        f = np.array(r["feat"])
        varied = float(1 - np.mean([f[k] @ f[k - 1] for k in range(1, len(f))]))
        rows[t] = dict(nice=nice[t], blind=blind[t], spike=float(beats.max() - np.median(beats)), harsh=harsh,
                       hits=float(np.mean(np.sort(attack)[-len(attack) // 4:]) / np.median(busy)), varied=varied)
        nn = notes.get(t, [])
        if nn:
            p = np.array([n[2] for n in nn])
            on = np.sort(np.array([n[0] for n in nn]))
            dur = np.array([n[1] - n[0] for n in nn])
            iv = np.diff(p[np.argsort([n[0] for n in nn])])
            ent = lambda v, bins: float(-sum(q * np.log(q) for q in np.histogram(v, bins=bins)[0] / max(1, len(v)) if q > 0))
            rows[t].update(range=float(np.percentile(p, 95) - np.percentile(p, 5)), pitches=float(len(set(p.tolist()))),
                           int_ent=ent(np.clip(iv, -12, 12), 25), dur_ent=ent(np.log(np.clip(dur, 0.05, 4)), 12))
    print("calm, varied, complex: measured", flush=True)

    # --- unique: CLAP
    z = np.load(LAB / "research" / "data" / "song_embeddings.npz", allow_pickle=True)
    files = [str(v) for v in z["files"]]
    E = z["emb"].astype(float)
    E /= np.linalg.norm(E, axis=1, keepdims=True)

    def emb(t):
        p = t.split(".")
        for i, fn in enumerate(files):
            if fn.startswith(f"mesh_{p[0]}~{p[2]}/") and fn.endswith(f".{p[3]}.ogg"):
                return E[i]
    embs = {t: emb(t) for t in ids}
    have = [t for t in ids if embs[t] is not None]
    for t in have:
        sims = sorted((float(embs[t] @ embs[o]) for o in have if o != t), reverse=True)[:5]
        rows[t]["unique"] = 1 - float(np.mean(sims))

    # --- quality: Audiobox CE
    q = quality.aesthetics([str(Path(proj.assets) / T[t]["files"]["calm"]) for t in ids])
    for t, r in zip(ids, q):
        if r:
            rows[t]["quality"] = r["CE"]
    print("unique, quality: measured", flush=True)

    def zs(key, sign=1.0):
        v = np.array([rows[t].get(key, np.nan) for t in ids], float)
        mu, sd = np.nanmean(v), np.nanstd(v) + 1e-9
        return {t: sign * (0 if np.isnan(x) else float(np.clip((x - mu) / sd, -2.5, 2.5))) for t, x in zip(ids, v)}  # clipped: one outlier can't carry a song

    parts = dict(plays_nice=zs("nice"),
                 calm={t: -(zs("spike")[t] + zs("harsh")[t] + zs("hits")[t]) / np.sqrt(3) for t in ids},
                 varied=zs("varied"), unique=zs("unique"),
                 complex={t: (zs("range")[t] + zs("pitches")[t] + zs("int_ent")[t] + zs("dur_ent")[t]) / 2 for t in ids},
                 quality=zs("quality"), nice_blind=zs("blind"))
    total = {t: sum(parts[k][t] * (0.5 if k == "quality" else 1.0) for k in parts if k != "nice_blind") for t in ids}
    order = sorted(ids, key=lambda t: -total[t])

    mixes = Store.read(Path(proj.data) / "mixes.json", {})
    in_sets = collections.Counter(p["track"] for mx in mixes.values() for p in mx["parts"])
    short = lambda t: t.replace(".any", "").replace(".stack", "").replace(".close", " (close)")
    print(f"\n{len(ids)} songs ranked (each part standardised; total = the sum, quality at half weight)")
    print(f"{'#':>3} {'song':32s} {'total':>6} {'nice':>5} {'calm':>5} {'varied':>6} {'unique':>6} {'complex':>7} {'qual':>5}  80%-moves sets record")
    for i, t in enumerate(order):
        if i < 20 or i >= len(order) - 8:
            c = cnt.get(t, [0, 0])
            print(f"{i + 1:3d} {short(t):32s} {total[t]:+6.2f} {parts['plays_nice'][t]:+5.1f} {parts['calm'][t]:+5.1f} {parts['varied'][t]:+6.1f} "
                  f"{parts['unique'][t]:+6.1f} {parts['complex'][t]:+7.1f} {parts['quality'][t]:+5.1f}  {rows[t]['nice']:5d}  {in_sets[t]:3d}  {c[0]}/{c[1]}")
        elif i == 20:
            print("  ...")

    # does it agree with what the designer has shown?
    def auc(score, good):
        pos = [score[t] for t in ids if good(t)]
        neg = [score[t] for t in ids if not good(t)]
        return float(np.mean([(p > n) + 0.5 * (p == n) for p in pos for n in neg])) if pos and neg else float("nan")
    print(f"\n{sum(1 for t in ids if in_sets[t])} songs in saved sets; {sum(1 for t in ids if sum(cnt.get(t, [0, 0])) >= 3 and cnt[t][0] > cnt[t][1])} with a good record")
    print("against the designer's own signals (AUC: 0.5 = no relation):")
    for name, good in (("in a saved set", lambda t: in_sets[t] > 0),
                       ("good record in transition votes (more good than bad, 3+ votes)", lambda t: sum(cnt.get(t, [0, 0])) >= 3 and cnt[t][0] > cnt[t][1])):
        print(f"  {name}: total {auc(total, good):.2f} · " + " · ".join(f"{k} {auc(v, good):.2f}" for k, v in parts.items()))
    (LAB / "research" / "data" / "song_scores.json").write_text(json.dumps(
        dict(order=order, total=total, parts={k: v for k, v in parts.items()}, raw=rows), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

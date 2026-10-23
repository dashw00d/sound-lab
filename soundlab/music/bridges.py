"""Ways between songs that aren't seamless cuts (2026-10-23, the designer: "lets have the votes effect whats in the
game"; a thumbs down on a scene change counted for nothing, since the walk entered the next scene by energy alone). For
every song and every bar it may stop on, the songs it can go on into from a phrase start of theirs, judged as the
Mixer judged a transition before the graph (web-app/src/mixer/judge.ts judge()): the bar-fingerprint join score at least
CLASH and the taste model's chance the designer likes it at least TASTE. The scene walk takes one where a scene changes
(into one of the scenes it may go to next, the best fit) and where a song has no seamless cut on into its own scene.

On 264 of the designer's thumbs on transitions across scenes (research/bridge_probe.py, 2026-10-23), 95 of the 124 the
rule lets through were liked (77%), and 29 of the 140 it stops (21%); a song at a median bar has a way into 8 other
scenes, and 9% of the bars a scene could end on have none (the walk then enters as before).

  bridges(proj)  {song: [[after, to, start, fit], ...]}: per bar `after` that ends a phrase (any bar, for a song
                 with no clear phrasing), the best way into each other scene and every way into the song's own; `fit` is the taste model's chance. Cached in work/bridges.json until the
                 measures, the scenes, the cues or the model change. The votes are laid over it where it's read (the
                 Mixer's graph, the game's manifest): a transition thumbed down is never taken, one thumbed up is
                 always there and taken first.

Songs without the taste model's measures (trial takes and extensions: no music trims) have no ways; the walk enters
them at their entry, as before."""
from __future__ import annotations

import hashlib
import json

import numpy as np

from .. import project as P
from ..store import Store

CLASH, TASTE = 0.6, 0.5  # (judge.ts CLASH; the taste model's even chance)
LEN = 4
VERSION = 3  # (of how they're made: a new one makes them again)


def _sig(proj: P.Project, cues: dict) -> str:
    parts = [f"v{VERSION}"]
    for f in ("songs.json", "candidates.json", "families.json", "join_model.json"):
        p = proj.work / f
        parts.append(f"{f}:{p.stat().st_size}:{p.stat().st_mtime_ns}" if p.exists() else f"{f}:-")
    return hashlib.sha256(("|".join(parts) + json.dumps(cues, sort_keys=True)).encode()).hexdigest()[:16]


def bridges(proj: P.Project) -> dict:
    """{song: [[after, to, start, fit], ...]}, made again when what it's made of changed."""
    from .. import candidates
    votes = Store(proj).votes()
    cues = {k: (v or {}).get("mellow") for k, v in (votes.get("cues") or {}).items() if (v or {}).get("mellow")}
    sig, path = _sig(proj, cues), proj.work / "bridges.json"
    old = Store.read(path, {})
    if old.get("sig") == sig:
        return old["bridges"]
    M = Store.read(proj.work / "songs.json", {}) | candidates.measures(proj)
    F = Store.read(proj.work / "families.json", {"families": {}})
    model = Store.read(proj.work / "join_model.json", {})
    out = _make(M, F, model, votes.get("clips", {}), cues, proj.music["bars"]) if model else {}
    Store.write(path, dict(sig=sig, bridges=out))
    return out


def _make(M: dict, F: dict, model: dict, clips: dict, cues: dict, N: int) -> dict:
    scene = {m: fid for fid, f in F["families"].items() for m in f["members"]}
    ok = lambda t: t in M and all(M[t].get(k) for k in ("feat", "onset", "phrase")) and (M[t].get("beats") or {}).get("calm")
    songs = [t for t in scene if ok(t)]
    if not songs:
        return {}
    # (each song's records in the transition votes: judge.ts records(), music/taste.py song_record)
    n: dict[str, list[int]] = {}
    for k, v in clips.items():
        if k.startswith("join_") and "@" in k and ">" in k and "|" in k:
            a, b = k[5:k.rindex("@")], k[k.index(">") + 1:k.rindex("|")]
            for t in {a, b}:
                n.setdefault(t, [0, 0])[0 if v > 0 else 1] += 1
    rec = {t: (g - d) / (g + d + 3) for t, (g, d) in n.items()}

    def loop(t):  # (the mellow cues, else the guessed ones; its phrase start; its entry: the first phrase start inside them)
        lo, hi = cues.get(t) or (((M[t].get("cuts") or {}).get("calm") or [{}])[0].get("bars")) or [1, N]
        ph = M[t]["phrase"]
        p0 = ph["start"] if ph.get("contrast", 0) >= 0.08 else None
        entry = lo if p0 is None else next((b for b in range(lo, hi + 1) if (b - p0) % LEN == 0), lo)
        return lo, hi, p0, entry

    W, mu, sd = np.array(model["w"]), np.array(model["mu"]), np.array(model["sd"])
    fi = {f: i for i, f in enumerate(model["features"])}
    feat = {t: np.array(M[t]["feat"], float) for t in songs}
    at = lambda xs, k: xs[(k - 1) % len(xs)]  # (bar k, 1-based, round the song)
    # (every song entered at a phrase start inside its loop with a phrase's room, as the cuts are)
    cand = []
    for b in songs:  # (inside its cues with a phrase's room, as a cut lands: graph.ts and the sync manifest's cuts)
        lo, hi, p0, entry = loop(b)
        B, bb = M[b], M[b]["beats"]["calm"]
        for s in [x for x in range(lo, hi - LEN + 2) if p0 is None and x == entry or p0 is not None and (x - p0) % LEN == 0]:
            cand.append(dict(b=b, s=s, f1=at(feat[b], s), f0=at(feat[b], s - 1), beat=bb[((s - 1) * 4) % len(bb)],
                             entry_phrase=float((s - B["phrase"]["start"]) % LEN == 0),
                             attack_b=float(np.log(B["onset"]["attack"][((s - 1) * 4) % len(B["onset"]["attack"])] / np.median(B["onset"]["busy"]))),
                             rec_b=rec.get(b, 0.0)))
    Fs1, Fs0 = np.array([c["f1"] for c in cand]), np.array([c["f0"] for c in cand])
    beat_b = np.array([c["beat"] for c in cand])
    col = {f: np.array([c[f] for c in cand]) for f in ("entry_phrase", "attack_b", "rec_b")}
    to = [c["b"] for c in cand]
    out: dict[str, list] = {}
    for a in songs:
        A, ba = M[a], np.array(M[a]["beats"]["calm"])
        oa = M[a]["onset"]
        lo, hi, pa, entry = loop(a)
        rows = []
        for e in range(min(lo, entry), min(N, max(hi, entry + LEN - 1)) + 1):  # (the bars its visit plays: scenewalk.ts start())
            if pa is not None and (e - pa) % LEN != LEN - 1:
                continue  # (a scene ends at a phrase end, and a song goes on into another without a cut there too)
            j = 0.5 * (Fs1 @ at(feat[a], e + 1) + Fs0 @ at(feat[a], e)) - 0.03 * np.maximum(0, np.abs(beat_b - ba[((e - 1) * 4 + 3) % len(ba)]) - 2)
            ia = [((e - 1) * 4 + k) % len(ba) for k in range(4)]
            f = dict(level_a=float(ba[ia].mean() - np.median(ba)),
                     held_a=float(np.log(oa["busy"][ia[3]] / (oa["attack"][(e * 4) % len(oa["attack"])] + 1e-6))), rec_a=rec.get(a, 0.0))
            z = np.full(len(cand), W[0])
            for name, i in fi.items():
                x = col[name] if name in col else f[name]
                z = z + W[i + 1] * (x - mu[i]) / sd[i]
            t = 1 / (1 + np.exp(-z))
            good = np.flatnonzero((j >= CLASH) & (t >= TASTE))
            best: dict[str, tuple] = {}  # (the best into each other scene; every way into a song of its own)
            for k in good:
                b = to[k]
                if b == a:
                    continue
                key = b if scene[b] == scene[a] else scene[b]
                if key not in best or t[k] > best[key][2]:
                    best[key] = (b, cand[k]["s"], float(t[k]))
            rows += [[e, b, s, round(p, 2)] for b, s, p in sorted(best.values(), key=lambda x: -x[2])]
        if rows:
            out[a] = rows
    return out


def with_votes(ways: dict, clips: dict, songs: set[str]) -> dict:
    """The ways among `songs` as the votes stand: none thumbed down, the ones thumbed up marked and always there (a liked
    transition that isn't a seamless cut). {song: [{after, to, start, fit, liked?}]}."""
    liked: dict[str, list] = {}
    for k, v in clips.items():
        if v > 0 and k.startswith("join_") and "@" in k and ">" in k and "|" in k:
            a, rest = k[5:].rsplit("@", 1)
            e, b = rest.split(">", 1)
            b, s = b.rsplit("|", 1)
            if a in songs and b in songs and a != b:
                liked.setdefault(a, []).append([int(e), b, int(s), 1.0])
    out = {}
    for a in songs:
        seen, rows = set(), []
        for e, b, s, p in liked.get(a, []) + ways.get(a, []):
            v = clips.get(f"join_{a}@{e}>{b}|{s}", 0)
            if b not in songs or v < 0 or (e, b, s) in seen:
                continue
            seen.add((e, b, s))
            rows.append(dict(after=e, to=b, start=s, fit=p, **({"liked": True} if v > 0 else {})))
        if rows:
            out[a] = rows
    return out

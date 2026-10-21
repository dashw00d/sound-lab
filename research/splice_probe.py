"""Splice probe (2026-10-21): a family by whether its songs splice, not by how related they sound.

The designer, on the Families page: "These are often related, but I wouldn't consider most of them mid song sibling
splicable." The sort (soundlab/families.py) joins songs by CLAP likeness, the mean bar likeness at the best offset, and
the same style and lead (W_STYLE + W_LEAD alone clear its JOIN bar). A sibling (one piece made for another context, in
step bar for bar) is what the walk swaps into mid-song; that's the bar a family should meet.

Spliceable, for two songs A and B at an offset L (B's bar k+L lined up under A's bar k): cut from A after bar k into B's
bar k+1+L. The Mixer's join score for that cut is the mean of A's bar k+1 against B's bar k+1+L (B's bar stands in for
A's real next one) and A's bar k against B's bar k+L (A's bar is like the one before B's): the lined-up bar likeness
either side of the cut. The cut is seamless when that's at least a natural bar step (each song's own bar k against
k+1: STEP, 0.785) and B's bar is within LOUD dB of the bar of A it replaces. A pair's splice score: the share of the 16
cuts that are seamless at its best offset (both ways are the same cuts, so it's symmetric).

Checked against the songs known to splice: siblings (music trims' families). Reports the score for siblings, for
pairs the sort put in one family, and for the rest; and the families complete linkage at a few bars would make.
Raw results: research/data/splice_probe.json.

    runtime/venv/bin/python research/splice_probe.py --project PATH
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from soundlab import dsp, families, music, project as P  # noqa: E402
from soundlab.store import Store  # noqa: E402

STEP, LOUD = 0.785, 3.0
OUT = Path(__file__).resolve().parent / "data" / "splice_probe.json"


def load(proj: P.Project):
    """Every song the sort sorts, with its bar fingerprints and per-bar loudness (calm level)."""
    M = proj.music
    fam = Store.read(proj.work / "families.json", {})
    lib = {t["id"]: t for t in music.library(proj)["tracks"]}
    items, feats, loud = {}, {}, {}
    bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * dsp.SR))
    for i, it in fam["items"].items():
        t = lib.get(i)
        m = (t or {}).get("measure") or {}
        if m.get("feat"):
            feats[i] = np.array(m["feat"])[:M["bars"]]
        elif it.get("feat"):
            feats[i] = np.array(it["feat"])[:M["bars"]]
        else:
            continue
        if m.get("loud", {}).get("calm"):
            loud[i] = np.array(m["loud"]["calm"])[:M["bars"]]
        else:  # (a take not shipped: its calm level's loudness per bar, as music trims measures it)
            src = it["src"]["calm"]
            f = (Store(proj).clips / src[len("/clips/"):]) if src.startswith("/clips/") else Path(proj.assets) / src[len("/shipped/"):]
            x = dsp.decode(f).mean(axis=1)
            loud[i] = np.array([20 * np.log10(np.sqrt(np.mean(x[k * bar:(k + 1) * bar] ** 2)) + 1e-9) for k in range(M["bars"])])
        items[i] = dict(it, sib=((t or {}).get("family") or {}).get("key") if t else None)
    return items, feats, loud


def splice(F: np.ndarray, Ld: np.ndarray):
    """Each pair's splice score (the share of seamless cuts at the best offset), that offset, and the mean lined-up
    likeness there (as music.same_piece)."""
    n, nb, _ = F.shape
    best = np.zeros((n, n)), np.zeros((n, n), int), np.zeros((n, n))
    for L in range(nb):
        R, RL = np.roll(F, -L, axis=1), np.roll(Ld, -L, axis=1)
        s = np.einsum("ikd,jkd->ijk", F, R)            # A's bar k against B's bar k+L
        cut = 0.5 * (s + np.roll(s, -1, axis=2))         # the cut after A's bar k: bars k and k+1 lined up
        step = np.abs(np.roll(Ld, -1, axis=1)[:, None, :] - np.roll(RL, -1, axis=1)[None, :, :])  # B's bar k+1+L against A's k+1
        f = ((cut >= STEP) & (step <= LOUD)).mean(axis=2)
        up = f > best[0]
        best[0][up], best[1][up], best[2][up] = f[up], L, s.mean(axis=2)[up]
    return best


def complete(S: np.ndarray, at: float, must: list[tuple[int, int]]) -> list[list[int]]:
    """Families where every pair splices at `at` or more (complete linkage), the must-links kept together."""
    n = len(S)
    par = list(range(n))
    def root(x):
        while par[x] != x:
            par[x] = par[par[x]]; x = par[x]
        return x
    for a, b in must:
        par[root(a)] = root(b)
    groups: dict[int, list[int]] = {}
    for k in range(n):
        groups.setdefault(root(k), []).append(k)
    fams = list(groups.values())
    while True:
        best, bi, bj = at, -1, -1
        for x in range(len(fams)):
            for y in range(x + 1, len(fams)):
                v = S[np.ix_(fams[x], fams[y])].min()
                if v >= best:
                    best, bi, bj = v, x, y
        if bi < 0:
            break
        fams[bi] += fams.pop(bj)
    return fams


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    proj = P.load(ap.parse_args().project)
    items, feats, loud = load(proj)
    ids = list(feats)
    n = len(ids)
    F, Ld = np.array([feats[i] for i in ids]), np.array([loud[i] for i in ids])
    S, lag, alike = splice(F, Ld)
    own = np.mean([(F[:, k] * F[:, (k + 1) % F.shape[1]]).sum(axis=1) for k in range(F.shape[1])], axis=0)
    iu = np.triu_indices(n, 1)
    sib = np.array([[bool(items[a]["sib"]) and items[a]["sib"] == items[b]["sib"] for b in ids] for a in ids])
    fam = np.array([[items[a]["family"] == items[b]["family"] for b in ids] for a in ids])
    q = lambda v: {k: round(float(np.quantile(v, p)), 3) for k, p in (("p10", .1), ("p25", .25), ("median", .5), ("p75", .75), ("p90", .9))} | {"n": int(len(v))}
    groups = {"siblings": sib[iu], "one family, not siblings": fam[iu] & ~sib[iu], "different families": ~fam[iu]}
    rep = dict(songs=n, step=STEP, loud=LOUD, own_step=q(own), splice={k: q(S[iu][m]) for k, m in groups.items()},
               alike={k: q(alike[iu][m]) for k, m in groups.items()},
               sibling_lag0=float(np.mean(lag[iu][sib[iu]] == 0)) if sib.any() else None)
    print(f"{n} songs; each song's own bar step: median {rep['own_step']['median']}")
    for k in groups:
        print(f"  splice score, {k:26s} {rep['splice'][k]}")
    for k in groups:
        print(f"  mean lined-up likeness, {k:18s} {rep['alike'][k]}")
    print(f"  siblings splice best at offset 0: {rep['sibling_lag0']:.0%}")
    ix = {i: k for k, i in enumerate(ids)}
    must = [(ix[a], ix[b]) for a in ids for b in ids if a < b and sib[ix[a], ix[b]]]
    must += [(ix[i], ix[it["seed"]]) for i, it in items.items() if it.get("seed") in ix and i in ix]
    rep["families"] = {}
    for at in (0.5, 0.6, 0.7):
        fs = complete(S, at, must)
        sizes = sorted((len(f) for f in fs), reverse=True)
        rep["families"][str(at)] = dict(count=sum(1 for s in sizes if s > 1), alone=sum(1 for s in sizes if s == 1), sizes=sizes[:20],
                                        examples=[[ids[k] for k in f] for f in sorted(fs, key=len, reverse=True)[:6]])
        print(f"  every pair at {at}: {rep['families'][str(at)]['count']} families of 2+ (sizes {sizes[:12]}), {rep['families'][str(at)]['alone']} on their own")
    sort_sizes = sorted(np.unique([items[i]["family"] for i in ids], return_counts=True)[1].tolist(), reverse=True)
    rep["sort_sizes"] = sort_sizes
    print(f"  the sort now: {sum(1 for s in sort_sizes if s > 1)} families of 2+ (sizes {sort_sizes[:12]})")
    OUT.write_text(json.dumps(rep, indent=1))
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Families: every song (shipped, scored new takes, trial takes and their extensions) sorted into families, and a
queue of what the designer should judge next (2026-10-21). A family is songs that could pass as sections of one long
piece: one palette and feel, so moving inside one is a walk and moving between two a change of scene (the designer
agreed this meaning). Built from what we know and how they sound:

  sounds like   CLAP (candidates._clap), centred on all the items
  same piece    bar fingerprints at the best offset (music.same_piece)
  what it is    the same style, the same lead instrument (a drawn take's words, else its style's)
  must go together   siblings (one piece made for other contexts, music.families), an extension and its seed, and the
                     designer's own answers: "belongs here" (link_<a>|<b> = 1) and "near duplicate" (dup_<a>|<b> = 1)
  must not           "bad match" (link_<a>|<b> = -1)

The two sound measures are standardised over all pairs and averaged, the style and lead add W_STYLE and W_LEAD; families
merge by average linkage while the average likeness is over JOIN and no "bad match" lies between them. Each item gets
a confidence: how much more it's like its own family than the next. The queue: new trial takes and extensions
unanswered, then the least confident items, then the most alike pairs (where "near duplicate" starts). Writes
work/families.json for the Families page; its answers are votes:

  ok_<id>          1 good, -1 a bad take (on a shipped song: out of the walk only, never out of the game)
  link_<id>|<id>   1 belongs with that family's member shown, -1 good but a bad match for that family
  dup_<id>|<id>    1 a near duplicate of that member
  novel_<id>       1 good and the start of a family of its own (trial takes keep novel_<set>.<take>)
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import numpy as np

from . import candidates, dsp, music, project as P
from .store import Store

W_STYLE, W_LEAD, JOIN = 0.6, 0.5, 0.9
LEADS = {"violin": "violin", "violintags": "violin", "violinbed": "violin", "kantele": "kantele", "kantele2": "kantele",
         "tagelharpa": "tagelharpa", "tagelharpa2": "tagelharpa", "nyckelharpa": "nyckelharpa", "nyckelharpa2": "nyckelharpa",
         "winterwater": "waterphone", "winterglass": "celesta", "winterstrings": "tremolo strings", "winterchoir": "choir",
         "choir": "choir", "horror": "dread", "war": "brass", "war2": "brass", "trailer": "brass", "full": "brass",
         "anthem": "brass", "bed": "brass", "bed2": "brass", "strings": "strings"}


def _lead(style: str, words: dict | None) -> str:
    w = (words or {}).get("lead", "")
    for name in ("violin", "nyckelharpa", "tagelharpa", "kantele", "viola", "horn", "celesta", "waterphone"):
        if name in w:
            return name
    return LEADS.get(style, style or "plain")


def mixer_id(c: dict, take: dict, prof: str) -> str:
    return ".".join(x for x in (c["context"], c.get("biome", "any"), c.get("style"), take["id"], prof) if x)


def build(proj: P.Project) -> int:
    M, st = proj.music, Store(proj)
    idx, votes = st.index(), st.votes()["clips"]
    prof = M.get("default_profile", "stack")
    path = proj.work / "families.json"
    old = Store.read(path, {})
    lib = music.library(proj)
    items, files, feats = {}, {}, {}
    for t in lib["tracks"]:
        m = t.get("measure") or {}
        if not m.get("feat") or "calm" not in t["files"]:
            continue
        style = (t.get("key") or "~").split("~")[-1]
        items[t["id"]] = dict(kind="shipped", style=style, lead=_lead(style, None), context=t.get("context"),
                              src={lv: t["src"].get(lv) for lv in ("calm", "battle") if t["src"].get(lv)},
                              sibling=(t.get("family") or {}).get("key"))
        files[t["id"]] = Path(proj.assets) / t["files"]["calm"]
        feats[t["id"]] = np.array(m["feat"])[:M["bars"]]
    cand = {r["id"]: r for r in Store.read(proj.work / "candidates.json", {}).get("takes", {}).values() if r.get("id")}
    for key, c in idx.get("mesh", {}).get("contexts", {}).items():
        for take in c["takes"]:
            i = mixer_id(c, take, prof if prof in take["profiles"] else next(iter(take["profiles"])))
            if not (take.get("trial") or i in cand):
                continue
            lv = (take["profiles"].get(prof) or next(iter(take["profiles"].values())))["levels"]
            style = c.get("style") or ""
            r = cand.get(i) or {}
            tuned = r.get("tuned") or {}
            # (a style that draws its words per take isn't a family's style: its lead stands in)
            items[i] = dict(kind="extension" if take.get("grow") else "trial" if take.get("trial") else "candidate",
                            style=_lead(style, take.get("words")) if take.get("words") else style,
                            lead=_lead(style, take.get("words")), context=c["context"], set=key, take=take["id"],
                            words=take.get("words"), rank=r.get("rank"),
                            src={k: "/clips/" + (tuned[k]["file"] if k in tuned else lv[k]) for k in ("calm", "battle") if lv.get(k)},
                            **({"seed": mixer_id(c, {"id": take["grow"]["of"]}, prof)} if take.get("grow") else {}))
            files[i] = st.clips / lv["calm"]
            if r.get("measure", {}).get("feat"):
                feats[i] = np.array(r["measure"]["feat"])[:M["bars"]]
            elif (old.get("items", {}).get(i) or {}).get("feat"):
                feats[i] = np.array(old["items"][i]["feat"])
            else:
                feats[i] = music._fingerprint(dsp.decode(files[i]), M)
    ids = list(items)
    n = len(ids)
    print(f"{n} songs: " + ", ".join(f"{sum(1 for i in ids if items[i]['kind'] == k)} {k}" for k in ("shipped", "candidate", "trial", "extension")), flush=True)
    E = candidates._clap(proj, {i: files[i] for i in ids})
    C = np.array([E[i] for i in ids])
    C = C - C.mean(axis=0)
    C /= np.linalg.norm(C, axis=1, keepdims=True)
    Sc = C @ C.T
    F = np.array([feats[i] for i in ids])
    Sf = np.max([np.einsum("ikd,jkd->ij", F, np.roll(F, -L, axis=1)) / F.shape[1] for L in range(F.shape[1])], axis=0)
    Sf = np.maximum(Sf, Sf.T)
    iu = np.triu_indices(n, 1)
    z = lambda S: (S - S[iu].mean()) / (S[iu].std() + 1e-9)
    same = lambda f: np.array([[items[a][f] == items[b][f] for b in ids] for a in ids], float)
    S = 0.5 * (z(Sc) + z(Sf)) + W_STYLE * same("style") + W_LEAD * same("lead")
    np.fill_diagonal(S, 0.0)
    pos = {i: k for k, i in enumerate(ids)}

    # the constraints: what must go together, what mustn't
    must, cannot = [], set()
    for a in ids:
        for b in ids:
            if a < b and items[a].get("sibling") and items[a]["sibling"] == items[b].get("sibling"):
                must.append((a, b))
        if items[a].get("seed") in pos:
            must.append((a, items[a]["seed"]))
    for k, v in votes.items():
        if k.startswith(("link_", "dup_")) and "|" in k:
            a, b = k.split("_", 1)[1].split("|", 1)
            if a in pos and b in pos:
                if v > 0:
                    must.append((a, b))
                elif k.startswith("link_"):
                    cannot.add(frozenset((a, b)))
    par = list(range(n))

    def root(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x
    for a, b in must:
        if frozenset((a, b)) not in cannot:
            par[root(pos[a])] = root(pos[b])
    groups: dict[int, list[int]] = {}
    for k in range(n):
        groups.setdefault(root(k), []).append(k)
    fams = list(groups.values())
    # (a take the designer called a new family starts its own: it takes in only its extensions and what they say belongs)
    novel = {pos[i] for i in ids if votes.get(f"novel_{i}", 0) > 0
             or (items[i].get("set") and votes.get(f"novel_{items[i]['set']}.{items[i]['take']}", 0) > 0)}
    blocked = lambda A, B: (any(frozenset((ids[x], ids[y])) in cannot for x in A for y in B)
                            or bool(novel & set(A)) or bool(novel & set(B)))
    # average linkage: the likeliest pair of families merges while its average likeness is over JOIN
    while True:
        best, bi, bj = JOIN, -1, -1
        for x in range(len(fams)):
            for y in range(x + 1, len(fams)):
                v = S[np.ix_(fams[x], fams[y])].mean()
                if v > best and not blocked(fams[x], fams[y]):
                    best, bi, bj = v, x, y
        if bi < 0:
            break
        fams[bi] = fams[bi] + fams[bj]
        del fams[bj]
    fams.sort(key=len, reverse=True)
    fam_of = {ids[k]: f"f{j + 1}" for j, fam in enumerate(fams) for k in fam}
    out_f = {}
    for j, fam in enumerate(fams):
        fid = f"f{j + 1}"
        med = fam[int(np.argmax(S[np.ix_(fam, fam)].sum(axis=1)))] if len(fam) > 1 else fam[0]
        leads = sorted({items[ids[k]]["lead"] for k in fam})
        out_f[fid] = dict(members=[ids[k] for k in fam], medoid=ids[med], leads=leads,
                          shipped=sum(1 for k in fam if items[ids[k]]["kind"] == "shipped"))
    for i in ids:  # confidence: own family's average likeness against the next best family's
        k, own = pos[i], fam_of[i]
        mine = [pos[m] for m in out_f[own]["members"] if m != i]
        a = float(S[k, mine].mean()) if mine else 0.0
        others = [(float(S[k, [pos[m] for m in f["members"]]].mean()), fid) for fid, f in out_f.items() if fid != own]
        b, nxt = max(others) if others else (-9.0, None)
        items[i].update(family=own, conf=round(a - b, 2), next=nxt,
                        nearest=[ids[x] for x in np.argsort(-S[k])[:6] if ids[x] != i][:5], feat=np.round(feats[i], 3).tolist())

    # the queue
    def answered(i, fam=None):
        if votes.get(f"ok_{i}", 0) < 0 or votes.get(f"novel_{i}") or (items[i].get("set") and votes.get(f"novel_{items[i]['set']}.{items[i]['take']}")):
            return True
        return any(k.startswith((f"link_{i}|", f"dup_{i}|")) for k in votes)
    q = []
    for i in ids:
        if items[i]["kind"] in ("trial", "extension") and not answered(i):
            q.append(dict(kind="new" if items[i]["kind"] == "trial" else "extension", item=i,
                          family=items[i]["family"] if items[i]["kind"] == "extension" or len(out_f[items[i]["family"]]["members"]) > 1 else items[i]["next"]))
    unsure = sorted((i for i in ids if not answered(i) and items[i]["kind"] in ("shipped", "candidate") and len(out_f[items[i]["family"]]["members"]) > 1),
                    key=lambda i: items[i]["conf"])[:30]
    dups = []
    for x, y in zip(*iu):
        a, b = ids[x], ids[y]
        if (votes.get(f"dup_{a}|{b}") is None and votes.get(f"dup_{b}|{a}") is None and not votes.get(f"link_{a}|{b}")
                and not votes.get(f"link_{b}|{a}") and not (items[a].get("seed") == b or items[b].get("seed") == a)):
            dups.append((float(0.5 * (z(Sc)[x, y] + z(Sf)[x, y])), a, b))
    dups = sorted(dups, reverse=True)[:20]
    for k in range(max(len(unsure), len(dups))):
        if k < len(unsure):
            q.append(dict(kind="uncertain", item=unsure[k], family=items[unsure[k]]["family"]))
        if k < len(dups):
            q.append(dict(kind="dup", item=dups[k][1], vs=dups[k][2], family=items[dups[k][2]]["family"], alike=round(dups[k][0], 2)))
    st.write(path, dict(made=datetime.now().strftime("%Y-%m-%d %H:%M"), weights=dict(style=W_STYLE, lead=W_LEAD, join=JOIN),
                        items=items, families=out_f, queue=q))
    sizes = sorted((len(f["members"]) for f in out_f.values()), reverse=True)
    print(f"{len(out_f)} families (sizes {sizes[:12]}{' ...' if len(sizes) > 12 else ''}; {sum(1 for s in sizes if s == 1)} alone); "
          f"queue: {len(q)} ({sum(1 for x in q if x['kind'] in ('new', 'extension'))} new, {sum(1 for x in q if x['kind'] == 'uncertain')} unsure, "
          f"{sum(1 for x in q if x['kind'] == 'dup')} near-duplicate checks); {path}")
    for fid, f in list(out_f.items())[:10]:
        print(f"  {fid}: {len(f['members'])} songs ({f['shipped']} shipped), leads {', '.join(f['leads'])}; e.g. {f['medoid']}")
    return 0

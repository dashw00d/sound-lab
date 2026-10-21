"""Families: every song (shipped, scored new takes, trial takes and their extensions) sorted into scenes, and a queue
of what the designer should judge next (2026-10-21). A family is one scene: songs of one palette and feel that flow
into each other naturally, so moving inside one is a walk and moving out of it a change of scene (the designer,
choosing between "sounds alike", "one scene" and "splice partners": "one scene"; MODELS_LOG "families are scenes").

  a scene     the designer's: "lead instrument, beat/bass, and amount of aggregate noise" (sound(): the same lead;
                the beat's shape and percussive share alike; the bass share alike; the noise, flatness, busyness and
                highs, alike), and how well two songs flow into each other (the same key, their chroma over the whole
                song alike, and splicing, splice()), at twice the weight: each standardised over all pairs
  energy        how un-chill a song is: its busyness, flatness, percussive share and highs, standardised, averaged; a
                song's battle level is above its calm in 98% of songs (research/scene_probe.py). The graph's waves.
  must go together   siblings (one piece made for other contexts, music.families), an extension and its seed, and the
                     designer's own answers: "belongs here" (link_<a>|<b> = 1) and "near duplicate" (dup_<a>|<b> = 1)
  must not           "bad match" (link_<a>|<b> = -1); a take the designer called a new family merges only with other
                     new families (that flow with it), its extensions and what the designer says belongs

Scenes merge by average linkage while their songs' average likeness is SCENE or more (the must-links together first):
21 scenes of 2 or more (by lead, then noise), 16 songs alone; transitions the designer voted on, inside one liked 67%
of the time, across scenes 48% (in sample). Each song gets a confidence (its flow with its own scene against the next), its nearest
(the songs it flows into best), its guesses (the scenes it nearly flows with: their average just under SCENE), and its
cuts: where it can cut seamlessly into the members of its scene that splice with it (cuts(); the music graph's edges
inside a scene). CLAP and bar likeness place the songs on the map and find near duplicates.
Writes work/families.json
for the Families page; its answers are votes:

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

W_STYLE, W_LEAD = 0.6, 0.5  # (the map's likeness)
STEP, LOUD, SPLICE = 0.785, 3.0, 0.25  # (a seamless cut: bars as alike as a natural step, within 3 dB; splice partners: 0.25 or more)
SCENE, CLOSE, GUESSES = 0.5, 0.35, 6  # (a scene: average likeness 0.5 or more; a guess: 0.35 or more with a scene, its best 6)


def splice(F: np.ndarray, Ld: np.ndarray) -> np.ndarray:
    """Each pair's splice score: the share of cuts from one into the other that are seamless at their best offset, less
    that share at their median offset (F: songs x bars x features, each bar a unit vector; Ld: songs x bars, the calm
    level's loudness in dB). Two static loops splice at any offset; one piece in step, at one (2026-10-21, MODELS_LOG
    "scouting": siblings against the old families, AUC 0.91 with the median taken off, 0.86 without)."""
    n, nb, _ = F.shape
    per = []
    for L in range(nb):
        s = np.einsum("ikd,jkd->ijk", F, np.roll(F, -L, axis=1))  # A's bar k against B's bar k+L
        cut = 0.5 * (s + np.roll(s, -1, axis=2))  # the cut after A's bar k: the bars either side lined up
        step = np.abs(np.roll(Ld, -1, axis=1)[:, None, :] - np.roll(np.roll(Ld, -L, axis=1), -1, axis=1)[None, :, :])
        per.append(((cut >= STEP) & (step <= LOUD)).mean(axis=2))
    per = np.array(per)
    return per.max(axis=0) - np.median(per, axis=0)


def cuts(F: np.ndarray, G: np.ndarray, La: np.ndarray, Lb: np.ndarray) -> tuple[int, list[list[int]]]:
    """Where song A can cut into song B seamlessly: B's best offset L (the most seamless cuts) and those cuts, as
    [A's last bar, B's first bar] (1-based): after A's bar e, B from its bar s = e + L + 1 (wrapping round its 16).
    The music graph's edges inside a family (2026-10-21: "we want the music to really flow ... but always be unique")."""
    nb = len(F)
    best, out = -1, (0, [])
    for L in range(nb):
        s = (F * np.roll(G, -L, axis=0)).sum(axis=1)
        cut = 0.5 * (s + np.roll(s, -1))
        step = np.abs(np.roll(La, -1) - np.roll(np.roll(Lb, -L), -1))
        ok = [k for k in range(nb) if cut[k] >= STEP and step[k] <= LOUD]
        if len(ok) > best:
            best, out = len(ok), (L, [[k + 1, (k + 1 + L) % nb + 1] for k in ok])
    return out


def sound(x: np.ndarray, M: dict) -> dict:
    """What a scene is made of, per song (2026-10-21, the designer: "lead instrument, beat/bass, and amount of aggregate
    noise"; research/scene_probe.py): the beat's shape (onset strength at each sixteenth of the bar, averaged over the
    bars, a unit vector) and its percussive share (HPSS), the bass (energy share under 150 Hz), and the noise:
    spectral flatness, onset busyness, the share over 4 kHz. From the calm level."""
    import librosa
    sr, hop = 22050, 256
    y = librosa.resample(x.mean(axis=1) if x.ndim > 1 else x, orig_sr=dsp.SR, target_sr=sr)[: int(sr * M["bars"] * M["bar_beats"] * 60 / M["bpm"])]
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    f, P2 = librosa.fft_frequencies(sr=sr, n_fft=2048), S ** 2
    tot = P2.sum() + 1e-12
    H, Pc = librosa.decompose.hpss(S)
    env = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S), sr=sr, hop_length=hop)
    fps, six = sr / hop, 60.0 / M["bpm"] / 4
    grid = np.zeros(4 * M["bar_beats"])
    for k in range(int(len(env) / fps / six)):
        a, b = int(k * six * fps), int((k + 1) * six * fps)
        grid[k % len(grid)] += env[a:b].mean() if b > a else 0
    grid /= np.linalg.norm(grid) + 1e-9
    return dict(rhythm=grid.round(4).tolist(), perc=round(float((Pc ** 2).sum() / ((H ** 2).sum() + (Pc ** 2).sum() + 1e-12)), 4),
                bass=round(float(P2[f < 150].sum() / tot), 4), highs=round(float(P2[f > 4000].sum() / tot), 4),
                flat=round(float(np.median(librosa.feature.spectral_flatness(S=S))), 5), busy=round(float(np.mean(env)), 4))


def _loud(x: np.ndarray, M: dict) -> list[float]:
    """A level's loudness per bar (dB, RMS), as music trims measures it."""
    bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * dsp.SR))
    m = x.mean(axis=1) if x.ndim > 1 else x
    return [round(float(20 * np.log10(np.sqrt(np.mean(m[k * bar:(k + 1) * bar] ** 2)) + 1e-9)), 2) for k in range(M["bars"])]
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
    items, files, feats, louds, busy = {}, {}, {}, {}, {}
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
        if (m.get("loud") or {}).get("calm"):
            louds[t["id"]] = list(m["loud"]["calm"])[:M["bars"]]
        if (m.get("onset") or {}).get("busy"):
            busy[t["id"]] = float(np.median(m["onset"]["busy"]))
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
            had, x = old.get("items", {}).get(i) or {}, None
            if r.get("measure", {}).get("feat"):
                feats[i] = np.array(r["measure"]["feat"])[:M["bars"]]
            elif had.get("feat"):
                feats[i] = np.array(had["feat"])
            else:
                feats[i] = music._fingerprint(x := dsp.decode(files[i]), M)
            if (r.get("measure", {}).get("onset") or {}).get("busy"):
                busy[i] = float(np.median(r["measure"]["onset"]["busy"]))
            elif had.get("busy") is not None:
                busy[i] = had["busy"]
            else:  # (a take without measures: its onsets, as music trims measures them)
                busy[i] = float(np.median(music._onsets(x if x is not None else (x := dsp.decode(files[i])), M["bpm"])["busy"]))
            if (r.get("measure", {}).get("loud") or {}).get("calm"):
                louds[i] = list(r["measure"]["loud"]["calm"])[:M["bars"]]
            elif had.get("loud"):
                louds[i] = had["loud"]
            elif x is not None:
                louds[i] = _loud(x, M)
    for i in items:  # (a loudness per bar for every song: measured once, then kept in families.json)
        if i not in louds:
            louds[i] = _loud(dsp.decode(files[i]), M)
    seed = Store.read(Path(__file__).resolve().parents[1] / "research" / "data" / "scene_features.json", {})
    sounds = {}
    for k, i in enumerate(items):  # (what a scene is made of: measured once, then kept in families.json)
        had = (old.get("items", {}).get(i) or {}).get("sound") or seed.get(f"{i}|calm")
        sounds[i] = had or sound(dsp.decode(files[i]), M)
        if not had and k % 20 == 0:
            print(f"  measured the sound of {k} of {len(items)}", flush=True)
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
    S = 0.5 * (z(Sc) + z(Sf)) + W_STYLE * same("style") + W_LEAD * same("lead")  # (likeness: the map, near duplicates)
    np.fill_diagonal(S, 0.0)
    Sp = splice(F, np.array([louds[i][:M["bars"]] for i in ids], float))  # (spliceable)
    np.fill_diagonal(Sp, 0.0)
    ch = F[:, :, :12].sum(axis=1)  # (the key: each song's chroma over all its bars)
    ch /= np.linalg.norm(ch, axis=1, keepdims=True) + 1e-9
    sd = lambda v: (v - v.mean()) / (v.std() + 1e-9)
    near_ = lambda v: z(-np.abs(v[:, None] - v[None, :]))
    snd = {k: np.array([sounds[i][k] for i in ids], float) for k in ("perc", "bass", "highs", "flat", "busy")}
    R = np.array([sounds[i]["rhythm"] for i in ids])
    noise = (sd(np.log(snd["busy"] + 1e-9)) + sd(np.log(snd["flat"] + 1e-9)) + sd(snd["highs"])) / 3
    energy = (sd(np.log(snd["busy"] + 1e-9)) + sd(np.log(snd["flat"] + 1e-9)) + sd(snd["perc"]) + sd(snd["highs"])) / 4
    Sw = (z(same("lead")) + (z(R @ R.T) + near_(sd(snd["perc"]))) / 2 + near_(sd(np.log(snd["bass"] + 1e-9))) + near_(noise)
          + 2 * (z(ch @ ch.T) + z(Sp)) / 2) / 6  # (a scene: lead, beat, bass, noise, and flow at twice the weight)
    np.fill_diagonal(Sw, 0.0)
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
    # (a take the designer called a new family starts its own: no existing scene takes it in, nor it them; but new
    # families that flow together are one new family, 2026-10-21: "several clearly belong together, but I worry I will
    # create two families if I use the button")
    novel = {pos[i] for i in ids if votes.get(f"novel_{i}", 0) > 0
             or (items[i].get("set") and votes.get(f"novel_{items[i]['set']}.{items[i]['take']}", 0) > 0)}
    # average linkage: the two scenes whose songs flow best on average merge, while that's SCENE or more (D: the
    # scenes' average flow; X: a bad match between them; nov: a new family in it, which merges only with new families)
    f = len(fams)
    D = np.array([[Sw[np.ix_(a, b)].mean() for b in fams] for a in fams])
    size = np.array([len(a) for a in fams], float)
    X = np.array([[any(frozenset((ids[x], ids[y])) in cannot for x in a for y in b) for b in fams] for a in fams])
    nov = np.array([bool(novel & set(a)) for a in fams])
    alive = np.ones(f, bool)
    while True:
        W = np.where(X | (nov[:, None] != nov[None, :]) | ~alive[:, None] | ~alive[None, :] | np.eye(f, dtype=bool), -1.0, D)
        x, y = np.unravel_index(np.argmax(W), W.shape)
        if W[x, y] < SCENE:
            break
        fams[x] = fams[x] + fams[y]
        alive[y] = False
        D[x, :] = D[:, x] = (D[x] * size[x] + D[y] * size[y]) / (size[x] + size[y])
        size[x] += size[y]
        X[x, :] = X[:, x] = X[x] | X[y]
        nov[x] |= nov[y]
    fams = [fam for k, fam in enumerate(fams) if alive[k]]
    fams.sort(key=len, reverse=True)
    fam_of = {ids[k]: f"f{j + 1}" for j, fam in enumerate(fams) for k in fam}
    out_f = {}
    for j, fam in enumerate(fams):
        fid = f"f{j + 1}"
        med = fam[int(np.argmax(Sw[np.ix_(fam, fam)].sum(axis=1)))] if len(fam) > 1 else fam[0]
        leads = sorted({items[ids[k]]["lead"] for k in fam})
        out_f[fid] = dict(members=[ids[k] for k in fam], medoid=ids[med], leads=leads,
                          shipped=sum(1 for k in fam if items[ids[k]]["kind"] == "shipped"))
    # a map for the Families graph: the songs placed by likeness (classical MDS on the likeness, two axes), so families
    # show as clusters; scaled to about 1000 units across
    K = S.copy()
    np.fill_diagonal(K, K.max())
    Dm = (K.max() - K) ** 2
    J = np.eye(n) - 1.0 / n
    B = -0.5 * J @ Dm @ J
    w, V = np.linalg.eigh(B)
    XY = V[:, -2:] * np.sqrt(np.maximum(w[-2:], 1e-9))
    XY = (XY - XY.mean(axis=0)) / (np.abs(XY).max() + 1e-9) * 500
    # guesses: the scenes a song nearly flows with (its average flow with them CLOSE or more, no bad match with any
    # member); each song's best two, each scene's best GUESSES ("worst" kept as the page reads it: here the average)
    guess: dict[str, list[dict]] = {i: [] for i in ids}
    for fid, fm in out_f.items():
        ms = [pos[m] for m in fm["members"]]
        near_f = []
        for i in ids:
            k = pos[i]
            if fam_of[i] == fid or any(frozenset((i, m)) in cannot for m in fm["members"]):
                continue
            worst = float(Sw[k, ms].mean())
            if worst >= CLOSE:
                near_f.append((worst, float(Sw[k, ms].min()), i))
        near_f.sort(reverse=True)
        fm["guesses"] = [i for _, _, i in near_f[:GUESSES]]
        for worst, mean, i in near_f[:GUESSES]:
            guess[i].append(dict(family=fid, worst=round(worst, 2), mean=round(mean, 2)))
    near = Sw.copy()  # (the songs it flows into best)
    np.fill_diagonal(near, -1.0)
    for i in ids:  # confidence: how much better it splices with its own family than with the next best
        k, own = pos[i], fam_of[i]
        mine = [pos[m] for m in out_f[own]["members"] if m != i]
        a = float(Sw[k, mine].mean()) if mine else 0.0
        others = [(float(Sw[k, [pos[m] for m in fm["members"]]].mean()), fid) for fid, fm in out_f.items() if fid != own]
        b, nxt = max(others) if others else (0.0, None)
        items[i].update(family=own, conf=round(a - b, 2), next=nxt, xy=[round(float(XY[k, 0]), 1), round(float(XY[k, 1]), 1)],
                        nearest=[ids[x] for x in np.argsort(-near[k])[:5]], feat=np.round(feats[i], 3).tolist(), loud=louds[i],
                        guess=sorted(guess[i], key=lambda g: (-g["worst"], -g["mean"]))[:2], busy=busy.get(i), sound=sounds[i], energy=round(float(energy[k]), 3),  # (cuts: below)
                        splice={ids[x]: round(float(Sp[k, x]), 2) for x in np.argsort(-near[k])[:12]},
                        flow={ids[x]: round(float(Sw[k, x]), 2) for x in np.argsort(-near[k])[:12]})
    # the music graph inside each scene: every member's seamless cuts into the members it splices with (SPLICE or more;
    # an extension and its seed always)
    Lv = {i: np.array(louds[i][:M["bars"]], float) for i in ids}
    for fm in out_f.values():
        for a in fm["members"]:
            items[a]["cuts"] = {}
            for b in fm["members"]:
                if a != b and (Sp[pos[a], pos[b]] >= SPLICE or items[a].get("seed") == b or items[b].get("seed") == a):
                    L, c = cuts(feats[a], feats[b], Lv[a], Lv[b])
                    if c:
                        items[a]["cuts"][b] = dict(offset=L, at=c)

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
    st.write(path, dict(made=datetime.now().strftime("%Y-%m-%d %H:%M"), weights=dict(scene=SCENE, close=CLOSE, step=STEP, loud=LOUD, splice=SPLICE, style=W_STYLE, lead=W_LEAD),
                        items=items, families=out_f, queue=q))
    sizes = sorted((len(f["members"]) for f in out_f.values()), reverse=True)
    print(f"{len(out_f)} families (sizes {sizes[:12]}{' ...' if len(sizes) > 12 else ''}; {sum(1 for s in sizes if s == 1)} alone); "
          f"guesses: {sum(1 for i in ids if items[i]['guess'])} songs close to {sum(1 for f in out_f.values() if f['guesses'])} families; "
          f"queue: {len(q)} ({sum(1 for x in q if x['kind'] in ('new', 'extension'))} new, {sum(1 for x in q if x['kind'] == 'uncertain')} unsure, "
          f"{sum(1 for x in q if x['kind'] == 'dup')} near-duplicate checks); {path}")
    for fid, f in list(out_f.items())[:10]:
        print(f"  {fid}: {len(f['members'])} songs ({f['shipped']} shipped), leads {', '.join(f['leads'])}; e.g. {f['medoid']}")
    return 0

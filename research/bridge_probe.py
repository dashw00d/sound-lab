"""Scene changes (2026-10-23, the designer: "lets have the votes effect whats in the game"): how well the Mixer's judge
(the bar-fingerprint join score, web-app/src/mixer/judge.ts jBar, and the taste model, join_model.json) predicts the
designer's thumbs on transitions, within a scene and across scenes; and how many ways into each other scene a song has
at each bar it may end a scene on. Raw results: research/data/bridge_probe.json."""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from soundlab import project as P  # noqa: E402
from soundlab.music.taste import JOIN_FEATURES, join_features, song_record  # noqa: E402
from soundlab.store import Store  # noqa: E402

proj = P.load(sys.argv[1] if len(sys.argv) > 1 else "/home/ryan/dev/games/emberhold/tools/audio/soundlab_project.py")
M = Store.read(proj.work / "songs.json", {})
F = Store.read(proj.work / "families.json", {})
model = Store.read(proj.work / "join_model.json", {})
clips = Store(proj).votes()["clips"]
scene = {m: fid for fid, f in F["families"].items() for m in f["members"]}
N = proj.music["bars"]


def jbar(a, e, b, s):
    A, B = M[a], M[b]
    fa, fb = A["feat"], B["feat"]
    at = lambda f, k: np.array(f[(k - 1) % N])
    ba, bb = (A.get("beats") or {}).get("calm"), (B.get("beats") or {}).get("calm")
    loud = (0.03 * max(0, abs(bb[((s - 1) * 4) % len(bb)] - ba[((e - 1) * 4 + 3) % len(ba)]) - 2) if ba and bb
            else 0.02 * max(0, abs(A["loud"]["calm"][(s - 1) % N] - B["loud"]["calm"][(e - 1) % N]) - 3))
    return 0.5 * (at(fa, e + 1) @ at(fb, s) + at(fa, e) @ at(fb, s - 1)) - loud


recs = {}
for k, v in clips.items():
    if k.startswith("join_"):
        a = k[5:k.rindex("@")]; b = k[k.index(">") + 1:k.rindex("|")]
        for t in {a, b}:
            g, d = recs.get(t, (0, 0)); recs[t] = (g + (v > 0), d + (v < 0))
rec = {t: song_record(g, d) for t, (g, d) in recs.items()}


def taste(a, e, b, s):
    f = join_features(M, a, e, b, s) | dict(rec_a=rec.get(a, 0.0), rec_b=rec.get(b, 0.0))
    z = model["w"][0] + sum(model["w"][i + 1] * (f[x] - model["mu"][i]) / model["sd"][i] for i, x in enumerate(model["features"]))
    return 1 / (1 + np.exp(-z))


def auc(p, y):
    p, y = np.array(p), np.array(y)
    pos, neg = p[y > 0], p[y <= 0]
    return float(np.mean([(u > q) + 0.5 * (u == q) for u in pos for q in neg])) if len(pos) and len(neg) else None


rows = []
for k, v in clips.items():
    if not k.startswith("join_"):
        continue
    a, rest = k[5:].rsplit("@", 1); e, b = rest.split(">", 1); b, s = b.rsplit("|", 1); e, s = int(e), int(s)
    if a not in M or b not in M or "feat" not in M[a] or "feat" not in M[b] or "onset" not in M[a] or "onset" not in M[b]:
        continue
    rows.append(dict(v=v, j=float(jbar(a, e, b, s)), t=float(taste(a, e, b, s)), cross=scene.get(a) != scene.get(b) or scene.get(a) is None))
out = {}
for name, rs in (("all", rows), ("same scene", [r for r in rows if not r["cross"]]), ("across scenes", [r for r in rows if r["cross"]])):
    y = [r["v"] > 0 for r in rs]
    ok = [r["j"] >= 0.6 and r["t"] >= 0.5 for r in rs]
    out[name] = dict(n=len(rs), liked=sum(y), auc_join=auc([r["j"] for r in rs], y), auc_taste=auc([r["t"] for r in rs], y),
                     auc_both=auc([r["t"] + r["j"] for r in rs], y),
                     ok_rule=dict(passed=sum(ok), liked_of_passed=sum(1 for o, l in zip(ok, y) if o and l), liked_of_rest=sum(1 for o, l in zip(ok, y) if not o and l)))
    print(name, json.dumps(out[name]))

# ways into other scenes: for each walkable shipped song and each bar of its loop, the other scenes' songs entered at a
# phrase start in their loop, judged as the Mixer's old walk judged a transition (join 0.6+ and taste 0.5+)
def cue(t):
    c = (Store(proj).votes().get("cues", {}).get(t) or {}).get("mellow")
    return list(c) if c else (((M[t].get("cuts") or {}).get("calm") or [{}])[0].get("bars") or [1, N])
def starts(t):
    lo, hi = cue(t); ph = M[t].get("phrase")
    p0 = ph["start"] if ph and ph.get("contrast", 0) >= 0.08 else lo
    xs = [b for b in range(lo, hi - 2) if (b - p0) % 4 == 0]
    return xs or [lo]
songs = [t for t in scene if t in M and "feat" in M[t] and "onset" in M[t]]
per, best = [], []
for a in songs:
    lo, hi = cue(a)
    for e in range(lo, hi + 1):
        ok_scenes, fits = set(), []
        for b in songs:
            if scene[b] == scene[a]:
                continue
            for s in starts(b):
                j = jbar(a, e, b, s)
                if j < 0.6:
                    continue
                t = taste(a, e, b, s)
                if t >= 0.5:
                    ok_scenes.add(scene[b]); fits.append(t)
        per.append(len(ok_scenes)); best.append(max(fits) if fits else 0)
per = np.array(per)
out["ways"] = dict(songs=len(songs), ends=len(per), scenes=len(F["families"]), median_scenes_reachable=float(np.median(per)),
                   share_with_none=float((per == 0).mean()), share_5plus=float((per >= 5).mean()))
print("ways", json.dumps(out["ways"]))
json.dump(out, open(Path(__file__).parent / "data" / "bridge_probe.json", "w"), indent=1)

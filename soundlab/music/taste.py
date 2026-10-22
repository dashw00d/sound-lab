"""The designer's taste in transitions: the features that predict their thumbs on a Mixer join (mirrored in mixer.js
taste()), a song's record in those votes, the logistic model fit to them (`music joins --fit`), and the report of
their votes against the join score (`music joins`)."""
from __future__ import annotations

from datetime import date

import numpy as np

from .. import project as P
from ..store import Store


JOIN_WEAK = 0.75  # (the Mixer's threshold for a straight transition: web/js/mixer.js WEAK)


JOIN_FEATURES = ("level_a", "entry_phrase", "attack_b", "held_a", "rec_a", "rec_b")  # (drums_a measured, not used: below)


def join_features(m: dict, a: str, e: int, b: str, s: int) -> dict:
    """What predicts the designer's thumbs on a transition (song a's bar e into song b from its bar s), from songs.json.
    Found on their first 132 votes (2026-10-21, MODELS_LOG). The Mixer computes the same in web/js/mixer.js
    (taste()): keep the two the same.
      level_a       how full a's exit bar is: its beats' mean loudness less a's median beat (dB)
      entry_phrase  1 when b is entered on a phrase start of its own grid
      attack_b      how clearly b starts: the onset at its entry beat against b's median busyness (log)
      held_a        a's last beat's busyness against the onset at a's next downbeat (log): high where a wasn't about
                    to hit a strong beat itself, so leaving there steps on nothing
      drums_a       a's calm drums building into the cut: their loudness in the bar after the exit less the bar before
                    (dB; music stems; 0 for a song without stems). Drums fading out of a song are disliked (2026-10-21,
                    MODELS_LOG "scouting": AUC 0.60, nearly independent of level_a). Not in JOIN_FEATURES: with the song
                    records (rec_a, rec_b) in, it adds 0.003 AUC (0.711 -> 0.714 on 344 votes, leave-one-out); a song
                    whose drums fade at its exit already has a bad record. Kept to try again with more votes."""
    A, B = m[a], m[b]
    ba, n = A["beats"]["calm"], len(A["beats"]["calm"])
    oa, ob = A["onset"], B["onset"]
    ia = [((e - 1) * 4 + k) % n for k in range(4)]
    dr = (A.get("stem_loud") or {}).get("calm.drums")
    return dict(level_a=float(np.mean([ba[i] for i in ia]) - np.median(ba)),
                drums_a=float(dr[e % len(dr)] - dr[(e - 2) % len(dr)]) if dr else 0.0,
                entry_phrase=float((((s - B["phrase"]["start"]) % 4) + 4) % 4 == 0),
                attack_b=float(np.log(ob["attack"][((s - 1) * 4) % len(ob["attack"])] / np.median(ob["busy"]))),
                held_a=float(np.log(oa["busy"][ia[-1]] / (oa["attack"][(e * 4) % len(oa["attack"])] + 1e-6))))


def song_record(good: int, bad: int) -> float:
    """A song's record in the designer's transition votes (rec_a, rec_b: as the song leaving or coming in, either way):
    good less bad over all, shrunk toward 0 for songs with few votes (2026-10-21, 315 votes: adds 2 points to the
    model, 65% -> 67% right on votes it didn't see). The Mixer counts it live from votes.json."""
    return (good - bad) / (good + bad + 3)


def _fit_logistic(X: np.ndarray, y: np.ndarray, l2: float = 2.0):
    """Logistic regression on standardised features (Newton steps, L2 on the weights): (mu, sd, [bias, weights])."""
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = np.c_[np.ones(len(X)), (X - mu) / sd]
    w, R = np.zeros(Z.shape[1]), l2 * np.eye(Z.shape[1])
    R[0, 0] = 0
    for _ in range(25):
        p = 1 / (1 + np.exp(-Z @ w))
        w -= np.linalg.solve(Z.T @ (Z * (p * (1 - p))[:, None]) + R, Z.T @ (p - y) + R @ w)
    return mu, sd, w


def fit_joins(proj: P.Project) -> int:
    """Learn the designer's taste in transitions from their votes (join_*): a logistic model on JOIN_FEATURES, judged
    by leave-one-out (each vote predicted by a model fit without it), saved to work/join_model.json for the Mixer."""
    from .. import candidates  # (votes on new takes' transitions, heard in the Mixer before they shipped)

    measured = Store.read(proj.work / "songs.json", {}) | candidates.measures(proj)
    for i, x in Store.read(proj.work / "stems.json", {}).items():  # (the calm drums per bar: drums_a)
        if i in measured and x.get("loud"):
            measured[i] = dict(measured[i], stem_loud=x["loud"])
    rows, ys, songs = [], [], []
    for k, v in Store(proj).votes()["clips"].items():
        if not k.startswith("join_"):
            continue
        try:
            a, rest = k[5:].rsplit("@", 1)
            e, b = rest.split(">", 1)
            b, st = b.rsplit("|", 1)
            f = join_features(measured, a, int(e), b, int(st))
        except (ValueError, KeyError):
            continue
        rows.append(f)
        ys.append(1.0 if v > 0 else 0.0)
        songs.append((a, b))
    for i, f in enumerate(rows):  # (a song's record from the other votes: a vote never explains itself)
        for side, t in (("rec_a", songs[i][0]), ("rec_b", songs[i][1])):
            g = sum(1 for j, (a, b) in enumerate(songs) if j != i and t in (a, b) and ys[j] > 0)
            bd = sum(1 for j, (a, b) in enumerate(songs) if j != i and t in (a, b) and ys[j] == 0)
            f[side] = song_record(g, bd)
    X, y = np.array([[f[x] for x in JOIN_FEATURES] for f in rows]), np.array(ys)
    if len(y) < 20 or y.min() == y.max():
        raise SystemExit(f"{len(y)} transition votes: rate at least 20, good and bad, in the Mixer first")
    p = np.zeros(len(y))
    for i in range(len(y)):
        keep = np.arange(len(y)) != i
        mu, sd, w = _fit_logistic(X[keep], y[keep])
        p[i] = 1 / (1 + np.exp(-(w[0] + ((X[i] - mu) / sd) @ w[1:])))
    auc = float(np.mean([(u > q) + 0.5 * (u == q) for u in p[y > 0] for q in p[y == 0]]))
    right = float(((p > 0.5) == (y > 0)).mean())
    mu, sd, w = _fit_logistic(X, y)
    model = dict(features=list(JOIN_FEATURES), mu=mu.round(4).tolist(), sd=sd.round(4).tolist(), w=w.round(4).tolist(),
                 n=len(y), good=int(y.sum()), auc=round(auc, 3), right=round(right, 3), base=round(float(y.mean()), 3),
                 at=date.today().isoformat())
    Store(proj).write(proj.work / "join_model.json", model)
    print(f"{len(y)} votes ({int(y.sum())} good): on votes it didn't see, the model is right {right:.0%} (AUC {auc:.2f}); "
          f"'good' every time is right {y.mean():.0%}")
    print("  weights (standardised): " + ", ".join(f"{f} {x:+.2f}" for f, x in zip(JOIN_FEATURES, w[1:])))
    return 0


def joins(proj: P.Project) -> int:
    """The designer's thumbs on Mixer transitions (votes.json "join_<song>@<bar>><song>|<start>": that bar of a song into
    that part) against the score the player used, to learn where bad joins slip through. The score, as the page has it:
    the mean of the cosine of the part's first bar with the bar that really followed, and of the song's bar with the bar
    that really came before the part (bar fingerprints: beat chroma and MFCC), less 0.02 per dB of loudness step over 3.
    Also its pieces (harmony: chroma alone; timbre: MFCC alone; the loudness step), to see which one misses."""
    measured = Store.read(proj.work / "songs.json", {})
    votes = {k: v for k, v in Store(proj).votes()["clips"].items() if k.startswith("join_")}
    n = M_bars = proj.music["bars"]
    rows = []
    for k, v in votes.items():
        try:
            a, rest = k[5:].rsplit("@", 1)
            e, b = rest.split(">", 1)
            b, st = b.rsplit("|", 1)
            e, st = int(e), int(st)
        except ValueError:
            continue
        if a not in measured or b not in measured or "feat" not in measured[a] or "feat" not in measured[b]:
            continue
        fa, fb = np.array(measured[a]["feat"]), np.array(measured[b]["feat"])
        la, lb = measured[a]["loud"]["calm"], measured[b]["loud"]["calm"]
        at = lambda f, i: f[(i - 1) % n]
        pairs = [(at(fa, e + 1), at(fb, st)), (at(fa, e), at(fb, st - 1))]
        cos = lambda x, y: float(x @ y / (np.linalg.norm(x) * np.linalg.norm(y) + 1e-9))
        step = abs(at(lb, st) - at(la, e))
        score = float(np.mean([x @ y for x, y in pairs])) - 0.02 * max(0.0, step - 3)
        bt, bb = measured[a].get("beats", {}).get("calm"), measured[b].get("beats", {}).get("calm")
        beat_step = round(abs(bb[((st - 1) * 4) % len(bb)] - bt[((e - 1) * 4 + 3) % len(bt)]), 1) if bt and bb else None
        rows.append(dict(key=k, vote=v, score=round(score, 3), beat_step=beat_step, harmony=round(np.mean([cos(x[:12], y[:12]) for x, y in pairs]), 3),
                         timbre=round(np.mean([cos(x[12:], y[12:]) for x, y in pairs]), 3), step=round(step, 1), a=a, e=e, b=b, start=st))
    liked, disliked = [r for r in rows if r["vote"] > 0], [r for r in rows if r["vote"] < 0]
    print(f"{len(rows)} transitions voted on: {len(liked)} liked, {len(disliked)} disliked (the player goes straight at {JOIN_WEAK} or more)")
    if not rows:
        print("  none yet: thumb transitions in the Mixer's lane")
        return 0
    slipped = sorted([r for r in disliked if r["score"] >= JOIN_WEAK], key=lambda r: -r["score"])
    print(f"\nslipped through (disliked, scored {JOIN_WEAK}+): {len(slipped)} of {len(disliked)} disliked")
    for r in slipped:
        print(f"  {r['score']:.2f}  {r['a']} bar {r['e']} -> {r['b']} bar {r['start']}   harmony {r['harmony']:.2f} timbre {r['timbre']:.2f} step {r['step']} dB (last beat into first: {r['beat_step']} dB)")
    under = sorted([r for r in liked if r["score"] < JOIN_WEAK], key=lambda r: r["score"])
    print(f"\nliked but under {JOIN_WEAK} (the player wouldn't take them unprompted): {len(under)} of {len(liked)} liked")
    for r in under:
        print(f"  {r['score']:.2f}  {r['a']} bar {r['e']} -> {r['b']} bar {r['start']}   harmony {r['harmony']:.2f} timbre {r['timbre']:.2f} step {r['step']} dB (last beat into first: {r['beat_step']} dB)")
    if len(liked) >= 3 and len(disliked) >= 3:
        mean = lambda xs, f: float(np.mean([x[f] for x in xs]))
        print("\nliked against disliked, on average:")
        for f in ("score", "harmony", "timbre", "step"):
            print(f"  {f:8s} {mean(liked, f):6.2f}  {mean(disliked, f):6.2f}")
        best = max(sorted({r["score"] for r in rows}), key=lambda t: sum((r["score"] >= t) == (r["vote"] > 0) for r in rows))
        right = sum((r["score"] >= best) == (r["vote"] > 0) for r in rows)
        print(f"\nthe threshold that best splits your votes: {best:.2f} ({right} of {len(rows)} right; at {JOIN_WEAK}: "
              f"{sum((r['score'] >= JOIN_WEAK) == (r['vote'] > 0) for r in rows)})")
    return 0

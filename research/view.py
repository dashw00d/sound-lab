"""Pictures of two songs side by side, for an agent to look at (2026-10-21, the designer: "write a tool for yourself
that creates an image with two songs waveform/spectrogram next to each other with markers and timing"). The measures
(splice score, join score, cues, phrases, loudness) are numbers; this draws what they're computed from, on one bar grid,
so a score can be checked against what the songs do. Writes a PNG (work/<project>/views/ by default) and prints its path.

  pair A B [--lag L]   the splice view: B shifted to its best offset under A (or L bars), so bar k of A sits over bar
                       k+L of B. Rows: each song's spectrogram (the calm level, mel) with its loudness per bar, its
                       mellow cues (shaded) and phrase starts (ticks); both songs' chroma per bar; each cut's lined-up
                       likeness against a natural bar step (STEP) and each song's own step, the loudness step at the cut,
                       and whether it's seamless (families.splice's test); and the splice score at every offset.
  join KEY             a Mixer transition (a votes.json key, join_<A>@<e>><B>|<s>): A's bars e-3..e into B's bars
                       s..s+3, mixed as the player crosses them (two beats, equal power), with the cut, the beats, the
                       loudness per beat either side, both songs' chroma per bar, the join score and the designer's vote.

  family FID           a family's songs stacked, each shifted to its best splice offset against the root, with its
                       loudness, cues, phrase starts and splice score with the root (work/families.json's families).
  levels ID            one song's levels stacked (calm, tension, action, battle: each derived from the spine) and its
                       Demucs stems, with loudness per bar: what a level change and a stem variation sound like.

Songs are track ids as on the Families page (work/families.json items). `--level battle` draws the battle level.

    runtime/venv/bin/python research/view.py --project PATH pair day.any.war2.k2.stack night.any.war2.k2.stack
    runtime/venv/bin/python research/view.py --project PATH join 'join_day.any.violin.k2.stack@8>night.any.violin.k6.stack|5'
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from soundlab import dsp, families, music, project as P, quality  # noqa: E402
from soundlab.store import Store  # noqa: E402

import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SR_VIEW = 22050
BG, FG, DIM = "#0d0f14", "#d8dbe6", "#6b7085"
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


class Song:
    """One song as the measures see it: its audio (one level), bar fingerprints, loudness per bar and per beat, chroma
    per bar, mellow cues and phrase grid."""

    def __init__(self, proj: P.Project, sid: str, level: str, info: dict):
        M, st = proj.music, Store(proj)
        self.id, self.M = sid, M
        it = info["items"].get(sid)
        if not it:
            raise SystemExit(f"no song {sid} in work/families.json (run music families)")
        src = it["src"].get(level) or it["src"]["calm"]
        self.path = st.clips / src[len("/clips/"):] if src.startswith("/clips/") else Path(proj.assets) / src[len("/shipped/"):]
        self.x = dsp.decode(self.path)
        self.bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * dsp.SR))
        self.nb = M["bars"]
        self.x = self.x[:self.bar * self.nb]
        self.feat = music._fingerprint(self.x, M)
        q = quality.features(self.x, M["bpm"])
        self.chroma = quality._bars(q["beat_chroma"], M["bar_beats"])[:, :self.nb]
        self.chroma = self.chroma / (self.chroma.max(axis=0, keepdims=True) + 1e-9)
        self.loud = np.array(families._loud(self.x, M))
        beat = self.bar // M["bar_beats"]
        m = self.x.mean(axis=1)
        self.beats = np.array([20 * np.log10(np.sqrt(np.mean(m[k * beat:(k + 1) * beat] ** 2)) + 1e-9) for k in range(len(m) // beat)])
        meas = info["measures"].get(sid) or {}
        cue = (info["votes"].get("cues", {}).get(sid) or {}).get("mellow")
        self.cue_yours = bool(cue)
        self.cue = cue or ((meas.get("cuts") or {}).get("calm") or [{}])[0].get("bars") or [1, self.nb]
        self.phrase = meas.get("phrase")
        self.label = f"{sid}  ·  family {it.get('family')}  ·  {it.get('kind')}"

    def spec(self) -> np.ndarray:
        import librosa
        y = librosa.resample(self.x.mean(axis=1), orig_sr=dsp.SR, target_sr=SR_VIEW)
        S = librosa.feature.melspectrogram(y=y, sr=SR_VIEW, n_fft=2048, hop_length=512, n_mels=96, fmax=SR_VIEW // 2)
        return librosa.power_to_db(S, ref=np.max, top_db=70)

    def wrap(self, a: int, b: int) -> np.ndarray:
        """Samples a..b of the loop, wrapping round it (a song's loop, as the player plays it)."""
        n = len(self.x)
        return np.take(self.x, np.arange(a, b) % n, axis=0)


def load_info(proj: P.Project) -> dict:
    """What the measures know: families.json (ids, families, src), each song's measurements (shipped: songs.json;
    new takes: candidates.json), and the votes."""
    from soundlab import candidates
    meas = {t["id"]: t.get("measure") or {} for t in music.library(proj)["tracks"]}
    for t in candidates.mixer_tracks(proj):
        meas.setdefault(t["id"], t.get("measure") or {})
    return dict(items=Store.read(proj.work / "families.json", {}).get("items", {}), measures=meas, votes=Store(proj).votes())


def style(ax):
    ax.set_facecolor(BG)
    for s in ax.spines.values():
        s.set_color("#2a2e3a")
    ax.tick_params(colors=DIM, labelsize=8)


def bar_grid(ax, nb: int, labels=None, top=False):
    for k in range(nb + 1):
        ax.axvline(k, color="#ffffff", alpha=0.18 if k % 4 else 0.38, lw=0.6)
    ax.set_xlim(0, nb)
    ax.set_xticks(np.arange(nb) + 0.5)
    ax.set_xticklabels(labels or [str(k + 1) for k in range(nb)])
    if top:
        ax.xaxis.tick_top()


def draw_song(ax, s: Song, shift: int, title: str):
    """A song's spectrogram on the bar grid (rolled by `shift` bars, so its bar k+shift sits at k), with its loudness per
    bar, its cues and its phrase starts."""
    style(ax)
    S, nb = s.spec(), s.nb
    cols = S.shape[1]
    S = np.roll(S, -int(round(shift * cols / nb)), axis=1)
    ax.imshow(S, origin="lower", aspect="auto", extent=[0, nb, 0, S.shape[0]], cmap="magma", vmin=-70, vmax=0)
    lab = [str(((k + shift) % nb) + 1) for k in range(nb)]
    bar_grid(ax, nb, lab)
    ax.set_yticks([])
    lo, hi = s.cue
    for k in range(nb):  # (the cue: the bars its mellow loops between)
        b = ((k + shift) % nb) + 1
        if lo <= b <= hi:
            ax.axvspan(k, k + 1, ymin=0.965, ymax=1.0, color="#5bd6ff" if s.cue_yours else "#9486ff", alpha=0.9, lw=0)
    if s.phrase and s.phrase.get("contrast", 0) >= 0.08:
        for k in range(nb):
            b = ((k + shift) % nb) + 1
            if (b - s.phrase["start"]) % 4 == 0:
                ax.plot([k, k], [0, S.shape[0] * 0.1], color="#ffc857", lw=2.2)
    tw = ax.twinx()
    tw.plot(np.arange(nb) + 0.5, np.roll(s.loud, -shift), color="#4fdc9b", lw=1.6, marker="o", ms=3)
    tw.set_ylabel("dB / bar", color="#4fdc9b", fontsize=8)
    tw.tick_params(colors="#4fdc9b", labelsize=7)
    tw.set_ylim(min(s.loud.min(), -40) - 2, max(s.loud.max(), -10) + 2)
    ax.set_title(title, color=FG, fontsize=9.5, loc="left")


def draw_chroma(ax, A: Song, B: Song, lag: int):
    style(ax)
    C = np.vstack([A.chroma, np.full((1, A.nb), np.nan), np.roll(B.chroma, -lag, axis=1)])
    ax.imshow(C, origin="lower", aspect="auto", extent=[0, A.nb, 0, 25], cmap="viridis", interpolation="nearest")
    bar_grid(ax, A.nb)
    ax.set_yticks([6, 19])
    ax.set_yticklabels(["A chroma", "B chroma"])
    for k in range(A.nb):  # (each bar's strongest pitch class, as text)
        ax.text(k + 0.5, 13.0, f"{NOTES[int(np.argmax(A.chroma[:, k]))]}·{NOTES[int(np.argmax(B.chroma[:, (k + lag) % B.nb]))]}",
                ha="center", va="center", color=FG, fontsize=7)


def pair(proj: P.Project, a: str, b: str, lag: int | None, level: str, out: Path) -> Path:
    info = load_info(proj)
    A, B = Song(proj, a, level, info), Song(proj, b, level, info)
    nb = A.nb
    scores = []
    for L in range(nb):  # (the splice score at every offset: families.splice's test, A against B)
        s = (A.feat * np.roll(B.feat, -L, axis=0)).sum(axis=1)
        cut = 0.5 * (s + np.roll(s, -1))
        step = np.abs(np.roll(A.loud, -1) - np.roll(np.roll(B.loud, -L), -1))
        scores.append(float(((cut >= families.STEP) & (step <= families.LOUD)).mean()))
    best = int(np.argmax(scores))
    L = best if lag is None else lag
    s = (A.feat * np.roll(B.feat, -L, axis=0)).sum(axis=1)
    cut = 0.5 * (s + np.roll(s, -1))
    step = np.abs(np.roll(A.loud, -1) - np.roll(np.roll(B.loud, -L), -1))
    ok = (cut >= families.STEP) & (step <= families.LOUD)
    ownA = (A.feat * np.roll(A.feat, -1, axis=0)).sum(axis=1)
    ownB = np.roll((B.feat * np.roll(B.feat, -1, axis=0)).sum(axis=1), -L)

    fig = plt.figure(figsize=(17, 12.5), dpi=100, facecolor=BG)
    gs = fig.add_gridspec(5, 2, height_ratios=[3, 3, 1.4, 2.2, 1.3], width_ratios=[5, 1], hspace=0.42, wspace=0.08)
    sec = nb * A.bar / dsp.SR
    fig.suptitle(f"splice {A.id}  ↔  {B.id}   at offset {L} (B's bar k+{L} under A's bar k)   ·   splice score {scores[L]:.2f}"
                 f" (best {scores[best]:.2f} at {best})   ·   mean lined-up likeness {s.mean():.2f}   ·   {nb} bars = {sec:.1f} s",
                 color=FG, fontsize=11, x=0.01, ha="left")
    draw_song(fig.add_subplot(gs[0, 0]), A, 0, f"A  {A.label}   (cue bars {A.cue[0]}–{A.cue[1]}{', yours' if A.cue_yours else ''}; ticks: phrase starts)")
    draw_song(fig.add_subplot(gs[1, 0]), B, L, f"B  {B.label}   shifted by {L}: its bar numbers under the grid   (cue {B.cue[0]}–{B.cue[1]})")
    draw_chroma(fig.add_subplot(gs[2, 0]), A, B, L)
    ax = fig.add_subplot(gs[3, 0])
    style(ax)
    x = np.arange(nb) + 1.0  # (the cut after A's bar k sits on the line between bars k and k+1)
    ax.plot(np.arange(nb) + 0.5, s, color="#9196a7", lw=1, ls=":", label="bar k lined up (A·B)")
    ax.plot(x, cut, color="#eceef4", lw=1.8, marker="o", ms=4, label="the cut after bar k")
    ax.plot(x, ownA, color="#9486ff", lw=1, ls="--", label="A's own step k→k+1")
    ax.plot(x, ownB, color="#5bd6ff", lw=1, ls="--", label="B's own step")
    ax.axhline(families.STEP, color="#ffc857", lw=1, label=f"natural step {families.STEP}")
    for k in range(nb):
        ax.scatter([x[k]], [cut[k]], s=70, marker="o" if ok[k] else "x", color="#4fdc9b" if ok[k] else "#ff6b7f", zorder=5)
    bar_grid(ax, nb)
    ax.set_xlim(0, nb + 0.3)
    ax.set_ylim(min(0.3, float(cut.min()) - 0.05), 1.0)
    ax.set_ylabel("likeness", color=DIM, fontsize=8)
    ax.legend(loc="lower left", fontsize=7, facecolor=BG, labelcolor=FG, ncol=5, framealpha=0.6)
    tw = ax.twinx()
    tw.bar(x, step, width=0.25, color="#ff9f6b", alpha=0.45)
    tw.axhline(families.LOUD, color="#ff9f6b", lw=0.8, ls=":")
    tw.set_ylabel("loudness step dB", color="#ff9f6b", fontsize=8)
    tw.tick_params(colors="#ff9f6b", labelsize=7)
    tw.set_ylim(0, max(9.0, float(step.max()) + 1))
    ax.set_title(f"each cut: green = seamless ({int(ok.sum())} of {nb}), red x = not (likeness under the natural step, or over {families.LOUD:g} dB)",
                 color=FG, fontsize=9, loc="left")
    ax2 = fig.add_subplot(gs[4, 0])
    style(ax2)
    ax2.bar(np.arange(nb), scores, color=["#ffc857" if k == L else "#5f6475" for k in range(nb)])
    ax2.axhline(families.SPLICE, color="#4fdc9b", lw=0.8, ls=":")
    ax2.set_xticks(np.arange(nb))
    ax2.set_title(f"the splice score at every offset (dotted: a family's bar, {families.SPLICE})", color=FG, fontsize=9, loc="left")
    side = fig.add_subplot(gs[:, 1])
    side.axis("off")
    ia, ib = info["items"][a], info["items"][b]
    sp = (ia.get("splice") or {}).get(b)
    lines = [f"A  {a}", f"   family {ia.get('family')}, lead {ia.get('lead')}", f"B  {b}", f"   family {ib.get('family')}, lead {ib.get('lead')}", "",
             f"sort's splice score: {sp if sp is not None else '(not kept)'}", f"siblings: {'yes' if ia.get('sibling') and ia.get('sibling') == ib.get('sibling') else 'no'}",
             f"same piece (mean, best offset): {max(((A.feat * np.roll(B.feat, -k, axis=0)).sum(axis=1).mean()) for k in range(nb)):.2f}",
             "", "loudness per bar (dB)", f"   A {np.round(A.loud, 1).min()} .. {np.round(A.loud, 1).max()}", f"   B {np.round(B.loud, 1).min()} .. {np.round(B.loud, 1).max()}"]
    side.text(0, 1, "\n".join(lines), color=FG, fontsize=8.5, va="top", family="monospace")
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, facecolor=BG, bbox_inches="tight")
    plt.close(fig)
    return out


def join(proj: P.Project, key: str, level: str, out: Path) -> Path:
    m = re.match(r"^join_(.+)@(\d+)>(.+)\|(\d+)$", key)
    if not m:
        raise SystemExit("a join key looks like join_<A>@<e>><B>|<s>")
    a, e, b, s0 = m.group(1), int(m.group(2)), m.group(3), int(m.group(4))
    info = load_info(proj)
    A, B = Song(proj, a, level, info), Song(proj, b, level, info)
    M, bar = proj.music, A.bar
    beat = bar // M["bar_beats"]
    xa = A.wrap((e - 4) * bar, (e + 1) * bar)          # A's bars e-3..e and the one after (what the crossfade hears)
    xb = B.wrap((s0 - 2) * bar, (s0 + 3) * bar)        # B's bar s-1, then bars s..s+3
    cut = 4 * bar
    t = np.arange(len(xa))
    ga = np.where(t < cut - beat, 1.0, np.where(t > cut + beat, 0.0, np.cos(0.5 * np.pi * (t - (cut - beat)) / (2 * beat))))
    mix = xa * ga[:, None]
    pos = np.arange(len(xb)) + 3 * bar                 # (B placed so its bar s starts at the cut: its bar s-1 from bar 3 on)
    gb = np.sin(0.5 * np.pi * np.clip((pos - (cut - beat)) / (2 * beat), 0, 1))
    out_len = 8 * bar
    y = np.zeros((out_len, 2))
    y[:len(mix)] += mix[:out_len]
    y[3 * bar:3 * bar + len(xb)] += (xb * gb[:, None])[:out_len - 3 * bar]
    import librosa
    S = librosa.power_to_db(librosa.feature.melspectrogram(y=librosa.resample(y.mean(axis=1), orig_sr=dsp.SR, target_sr=SR_VIEW), sr=SR_VIEW,
                                                           n_fft=2048, hop_length=512, n_mels=96), ref=np.max, top_db=70)
    yb = y.mean(axis=1)
    lb = [20 * np.log10(np.sqrt(np.mean(yb[k * beat:(k + 1) * beat] ** 2)) + 1e-9) for k in range(out_len // beat)]
    nbv = (e % A.nb), (s0 - 1) % B.nb  # (0-based: A's bar e+1, B's bar s)
    jscore = 0.5 * (float(A.feat[nbv[0]] @ B.feat[nbv[1]]) + float(A.feat[(e - 1) % A.nb] @ B.feat[(s0 - 2) % B.nb]))
    vote = info["votes"]["clips"].get(key)

    fig = plt.figure(figsize=(16, 10), dpi=100, facecolor=BG)
    gs = fig.add_gridspec(3, 1, height_ratios=[3.2, 1.4, 1.6], hspace=0.4)
    fig.suptitle(f"join  {a}  bar {e}  →  {b}  bar {s0}    ·    join score (bars either side lined up) {jscore:.2f}    ·    "
                 f"your vote: {'liked' if vote and vote > 0 else 'disliked' if vote and vote < 0 else 'none'}", color=FG, fontsize=11, x=0.01, ha="left")
    ax = fig.add_subplot(gs[0])
    style(ax)
    ax.imshow(S, origin="lower", aspect="auto", extent=[0, 8, 0, S.shape[0]], cmap="magma", vmin=-70, vmax=0)
    bar_grid(ax, 8, [f"A{(e - 4 + k) % A.nb + 1}" for k in range(4)] + [f"B{(s0 - 1 + k) % B.nb + 1}" for k in range(4)])
    ax.axvspan(4 - 0.25, 4 + 0.25, color="#ffffff", alpha=0.12)
    ax.axvline(4, color="#ff6b7f", lw=2)
    ax.set_yticks([])
    ax.set_title("the transition as the player plays it (two beats of crossfade around the cut, shaded)", color=FG, fontsize=9, loc="left")
    tw = ax.twinx()
    tw.plot((np.arange(len(lb)) + 0.5) / M["bar_beats"], lb, color="#4fdc9b", lw=1.4, marker="o", ms=2.5)
    tw.set_ylabel("dB / beat", color="#4fdc9b", fontsize=8)
    tw.tick_params(colors="#4fdc9b", labelsize=7)
    ax2 = fig.add_subplot(gs[1])
    style(ax2)
    C = np.hstack([np.roll(A.chroma, -(e - 4), axis=1)[:, :4], np.roll(B.chroma, -(s0 - 1), axis=1)[:, :4]])
    ax2.imshow(C, origin="lower", aspect="auto", extent=[0, 8, 0, 12], cmap="viridis", interpolation="nearest")
    bar_grid(ax2, 8, [NOTES[int(np.argmax(C[:, k]))] for k in range(8)])
    ax2.axvline(4, color="#ff6b7f", lw=2)
    ax2.set_yticks(range(12))
    ax2.set_yticklabels(NOTES, fontsize=6)
    ax2.set_title("chroma per bar (strongest pitch class under each bar)", color=FG, fontsize=9, loc="left")
    ax3 = fig.add_subplot(gs[2])
    style(ax3)
    simA = [float(A.feat[(e - 4 + k) % A.nb] @ A.feat[(e - 3 + k) % A.nb]) for k in range(3)]
    simB = [float(B.feat[(s0 - 1 + k) % B.nb] @ B.feat[(s0 + k) % B.nb]) for k in range(3)]
    across = float(A.feat[(e - 1) % A.nb] @ B.feat[(s0 - 1) % B.nb])
    ax3.plot([1, 2, 3], simA, color="#9486ff", marker="o", label="A's own steps")
    ax3.plot([5, 6, 7], simB, color="#5bd6ff", marker="o", label="B's own steps")
    ax3.scatter([4], [across], s=90, color="#ff6b7f", zorder=5, label="the step across the cut (A's last bar · B's first)")
    ax3.axhline(families.STEP, color="#ffc857", lw=1, label=f"natural step {families.STEP}")
    bar_grid(ax3, 8, [""] * 8)
    ax3.set_xlim(0, 8)
    ax3.set_ylim(0.3, 1.0)
    ax3.legend(loc="lower left", fontsize=7, facecolor=BG, labelcolor=FG, ncol=4, framealpha=0.6)
    ax3.set_title("bar-to-bar likeness: inside each song, and across the cut", color=FG, fontsize=9, loc="left")
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, facecolor=BG, bbox_inches="tight")
    plt.close(fig)
    return out


def best_offset(A: Song, B: Song) -> tuple[int, float]:
    """B's best splice offset against A and the score there (families.splice's test)."""
    out = []
    for L in range(A.nb):
        s = (A.feat * np.roll(B.feat, -L, axis=0)).sum(axis=1)
        cut = 0.5 * (s + np.roll(s, -1))
        step = np.abs(np.roll(A.loud, -1) - np.roll(np.roll(B.loud, -L), -1))
        out.append(float(((cut >= families.STEP) & (step <= families.LOUD)).mean()))
    return int(np.argmax(out)), max(out)


def family(proj: P.Project, fid: str, level: str, out: Path) -> Path:
    info = load_info(proj)
    fam = Store.read(proj.work / "families.json", {}).get("families", {}).get(fid)
    if not fam:
        raise SystemExit(f"no family {fid}")
    root = fam["medoid"]
    ids = [root] + [m for m in fam["members"] if m != root][:9]
    R = Song(proj, root, level, info)
    fig = plt.figure(figsize=(16, 2.3 * len(ids) + 1), dpi=90, facecolor=BG)
    gs = fig.add_gridspec(len(ids), 1, hspace=0.55)
    fig.suptitle(f"family {fid}: {len(fam['members'])} songs, leads {', '.join(fam['leads'])}; each shifted to its best splice offset against the root",
                 color=FG, fontsize=11, x=0.01, ha="left")
    for r, i in enumerate(ids):
        S = R if i == root else Song(proj, i, level, info)
        L, sc = (0, 1.0) if i == root else best_offset(R, S)
        draw_song(fig.add_subplot(gs[r]), S, L, f"{'ROOT  ' if i == root else ''}{S.label}   offset {L}, splice with root {sc:.2f}")
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, facecolor=BG, bbox_inches="tight")
    plt.close(fig)
    return out


def levels(proj: P.Project, sid: str, out: Path) -> Path:
    import librosa
    t = {x["id"]: x for x in music.library(proj)["tracks"]}.get(sid)
    if not t:
        raise SystemExit(f"{sid} isn't a shipped track")
    M, st = proj.music, Store(proj)
    path = lambda u: st.clips / u[len("/clips/"):] if u.startswith("/clips/") else Path(proj.assets) / u[len("/shipped/"):]
    rows = [(lv, path(t["src"].get(lv) or "/shipped/" + t["files"][lv])) for lv in t["files"]]
    rows += [(f"stem {k}", st.clips / v) for k, v in (t.get("stems") or {}).items()]
    bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * dsp.SR))
    fig = plt.figure(figsize=(16, 1.9 * len(rows) + 1), dpi=90, facecolor=BG)
    gs = fig.add_gridspec(len(rows), 1, hspace=0.6)
    fig.suptitle(f"levels and stems of {sid}", color=FG, fontsize=11, x=0.01, ha="left")
    for r, (name, f) in enumerate(rows):
        x = dsp.decode(f)[:bar * M["bars"]]
        ax = fig.add_subplot(gs[r])
        style(ax)
        y = librosa.resample(x.mean(axis=1), orig_sr=dsp.SR, target_sr=SR_VIEW)
        S = librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=SR_VIEW, n_fft=2048, hop_length=512, n_mels=96), ref=1.0, top_db=None)
        ax.imshow(S, origin="lower", aspect="auto", extent=[0, M["bars"], 0, 96], cmap="magma", vmin=S.max() - 70, vmax=S.max())
        bar_grid(ax, M["bars"])
        ax.set_yticks([])
        ld = families._loud(x, M)
        tw = ax.twinx()
        tw.plot(np.arange(M["bars"]) + 0.5, ld, color="#4fdc9b", lw=1.5, marker="o", ms=3)
        tw.tick_params(colors="#4fdc9b", labelsize=7)
        ax.set_title(f"{name}   ({f.name}; {np.median(ld):.1f} dB median, {max(ld) - min(ld):.1f} dB range)", color=FG, fontsize=9, loc="left")
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, facecolor=BG, bbox_inches="tight")
    plt.close(fig)
    return out


def main() -> int:
    common = argparse.ArgumentParser(add_help=False)  # (before or after the view's name)
    common.add_argument("--level", default=argparse.SUPPRESS)
    common.add_argument("--out", default=argparse.SUPPRESS)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, parents=[common])
    ap.add_argument("--project", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("pair", parents=[common])
    p1.add_argument("a")
    p1.add_argument("b")
    p1.add_argument("--lag", type=int)
    p2 = sub.add_parser("join", parents=[common])
    p2.add_argument("key")
    p3 = sub.add_parser("family", parents=[common])
    p3.add_argument("fid")
    p4 = sub.add_parser("levels", parents=[common])
    p4.add_argument("sid")
    a = ap.parse_args()
    a.level, a.out = getattr(a, "level", "calm"), getattr(a, "out", None)
    proj = P.load(a.project)
    views = proj.work / "views"
    if a.cmd == "pair":
        out = Path(a.out) if a.out else views / f"pair_{a.a}__{a.b}.png"
        print(pair(proj, a.a, a.b, a.lag, a.level, out))
    elif a.cmd == "family":
        print(family(proj, a.fid, a.level, Path(a.out) if a.out else views / f"family_{a.fid}.png"))
    elif a.cmd == "levels":
        print(levels(proj, a.sid, Path(a.out) if a.out else views / f"levels_{a.sid}.png"))
    else:
        out = Path(a.out) if a.out else views / f"{re.sub(r'[^A-Za-z0-9._-]+', '_', a.key)}.png"
        print(join(proj, a.key, a.level, out))
    return 0


if __name__ == "__main__":
    sys.exit(main())

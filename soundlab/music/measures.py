"""Measuring songs (`music trims`, and `music candidates` for new takes): per-bar and per-beat loudness, onsets, tuning,
the phrase grid, the best mellow cuts, bar fingerprints and how alike two songs are, and the families of siblings in
step (work/songs.json)."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from .. import dsp, project as P
from ..dsp import SR
from ..store import Store
from .shipping import library


def _beats(x: np.ndarray, beat: int) -> list[float]:
    """Loudness of each beat (dB, mean square of the mono mix): the Mixer matches levels at a join from these, where a
    bar's average hid a swell or a quiet beat right at the join ("weird volume changes from a bad slice": the designer)."""
    m = x.mean(axis=1)
    return [round(float(10 * np.log10((m[i * beat:(i + 1) * beat] ** 2).mean() + 1e-12)), 2) for i in range(len(m) // beat)]


def _onsets(x: np.ndarray, bpm: float) -> dict:
    """Per beat of the calm level: "busy", the mean onset strength over the beat (how much is happening), and "attack",
    the strongest onset within 60 ms of the beat's start (a strong one on a bar's first beat: the music breaks or starts
    there; a weak one: a note held across the bar line). For learning which transitions the designer likes."""
    env, fps = dsp.onset_env(x)
    beat = 60.0 / bpm
    n = int(len(x) / SR / beat)
    busy, attack = [], []
    for i in range(n):
        a, b = int(round(i * beat * fps)), int(round((i + 1) * beat * fps))
        busy.append(round(float(env[a:b].mean()), 3))
        lo, hi = max(0, int(round((i * beat - 0.03) * fps))), int(round((i * beat + 0.06) * fps)) + 1
        attack.append(round(float(env[lo:hi].max()), 3))
    return dict(busy=busy, attack=attack)


TUNING_V = 2  # (2026-10-21: the estimate before this was 3x too big and wrapped at 17 cents; measured again when older)


def _tuning(x: np.ndarray) -> float:
    """How far the music sits from A440, in cents, within half a semitone (librosa's estimate in fractions of a
    semitone: on test tones within 2 cents, on music a few). Until 2026-10-21 it asked for 36 bins an octave and read the
    fraction of a bin (33 cents) as a fraction of a semitone: every tuning came out 3x too big and wrapped past 17 cents
    (a true +10 read +26, +25 read -28), so the retunes it drove were mostly noise."""
    import librosa

    y = librosa.resample(x.mean(axis=1).astype(np.float32), orig_sr=SR, target_sr=22050)
    return round(100 * float(librosa.estimate_tuning(y=y, sr=22050, bins_per_octave=12)), 1)


def _phrase(feat: np.ndarray, length: int = 4) -> dict:
    """The phrase grid: of the 4 offsets, the one where the bar-to-bar change of the bar fingerprints peaks (a phrase
    starts where the music changes most), as the 1-based first bar of a phrase, with how much more change there is at
    those bars than elsewhere (2026-10-21: over 98 tracks, 54 start phrases at bar 1; contrast median 0.14, against
    a bar-to-bar change of 0.25)."""
    n = len(feat)
    nov = np.array([1 - feat[k] @ feat[k - 1] for k in range(n)])  # (nov[k]: the change into bar k+1, round the loop)
    contrast = [nov[o::length].mean() - np.delete(nov, np.arange(o, n, length)).mean() for o in range(length)]
    o = int(np.argmax(contrast))
    return dict(start=o + 1, contrast=round(float(contrast[o]), 3))


TRIM_REGION, TRIM_LENGTHS, TRIM_KEEP = (2, 12), (6, 8, 10), 4  # (bars a mellow loop may use; its lengths (6: more places to loop where the level holds, 2026-10-21); cuts offered)


LOUD_PEN = 0.15  # (a cut's score loses this per dB: of level step at its seam over 2, of a bar dipping under its median over 4)


def _cuts(sim: np.ndarray, loud: list[float]) -> list[dict]:
    """The best mellow loops of a level, from its bars' similarity and loudness. A cut bars s..e (1-based, inside
    TRIM_REGION) jumps from bar e back to bar s: scored by how alike bar s is to the bar that really follows e, less
    how much the level steps at that jump and how deep a bar inside it dips (2026-10-21: chosen by likeness alone, 18
    of 89 shipped guesses and 44 of 192 new takes stepped over 4 dB at the seam, some 13 dB, and SA3's quiet bars 2-4
    made loops dip; the designer heard it: "otherwise 5 stars")."""
    nb = sim.shape[0]
    lo, hi = TRIM_REGION
    ref = float(np.percentile(loud, 75))  # (the take's own loud part: a loop well under it is a near-silent stretch)
    cuts = []
    for length in TRIM_LENGTHS:
        for s in range(lo, hi - length + 2):
            e = s + length - 1
            if e >= nb:  # (bar e + 1 must exist to judge the jump)
                continue
            seam = float(sim[s - 1, e])  # (0-based: bar s against the bar after e)
            loop = loud[s - 1:e]
            step, dip = abs(loud[e - 1] - loud[s - 1]), float(np.median(loop)) - min(loop)
            quiet = max(0.0, ref - float(np.median(loop)))  # (2026-10-21: two takes' bars 2-8 were near silence, 13-25 dB under)
            score = seam + 0.01 * (length - 8) - LOUD_PEN * (max(0.0, step - 2) + max(0.0, dip - 4) + 2 * max(0.0, quiet - 3))
            cuts.append(dict(bars=[s, e], seam=round(seam, 3), step=round(step, 1), dip=round(dip, 1), quiet=round(quiet, 1), score=round(score, 3)))
    cuts.sort(key=lambda c: -c["score"])
    return cuts[:TRIM_KEEP]


UNEVEN_STEP, UNEVEN_DIP, UNEVEN_QUIET = 4.0, 5.0, 6.0  # (a loop is uneven when its seam steps more than this, a bar dips this far
# under it, or it sits this far under the take's own loud part)
uneven_loop = lambda c: c.get("step", 0) > UNEVEN_STEP or c.get("dip", 0) >= UNEVEN_DIP or c.get("quiet", 0) >= UNEVEN_QUIET


def recut(rec: dict, keep: list[int] | None = None) -> None:
    """The calm level's cuts again from what's measured (its bar fingerprints and loudness), without the audio. With
    `keep` (the loop guessed before), that loop stays first unless it's uneven: a guess the designer has been hearing
    changes only to fix it (2026-10-21: re-guessing everything moved 58 of 89 shipped loops, most of them fine)."""
    if "feat" not in rec or "calm" not in rec.get("loud", {}):
        return
    F = np.array(rec["feat"])
    loud = rec["loud"]["calm"][:len(F)]
    cuts = _cuts(F @ F.T, loud)
    if keep:
        s, e = keep
        loop = loud[s - 1:e]
        was = dict(bars=[s, e], seam=round(float((F @ F.T)[s - 1, min(e, len(F) - 1)]), 3), step=round(abs(loud[e - 1] - loud[s - 1]), 1),
                   dip=round(float(np.median(loop)) - min(loop), 1), quiet=round(max(0.0, float(np.percentile(loud, 75)) - float(np.median(loop))), 1))
        if not uneven_loop(was):
            was["score"] = round(was["seam"] - LOUD_PEN * (max(0.0, was["step"] - 2) + max(0.0, was["dip"] - 4) + 2 * max(0.0, was["quiet"] - 3)), 3)
            cuts = [was] + [c for c in cuts if c["bars"] != [s, e]][:TRIM_KEEP - 1]
    rec.setdefault("cuts", {})["calm"] = cuts


def _fingerprint(x: np.ndarray, M: dict) -> np.ndarray:
    """A level's bar fingerprints (bars x features: beat chroma and MFCC, each bar a unit vector), as songs.json "feat"."""
    from .. import quality

    q = quality.features(x, M["bpm"])
    B = quality._bars(np.vstack([q["beat_chroma"], q["beat_mfcc"] * 0.3]), M["bar_beats"])
    B = B / (np.linalg.norm(B, axis=0, keepdims=True) + 1e-9)
    return B.T[:M["bars"]]


SAME_PIECE = 0.85  # (bar fingerprints this alike at the best offset: the same piece; candidates.py flags the same)


def same_piece(F: np.ndarray, G: np.ndarray) -> float:
    """How alike two songs' bar fingerprints are at the best of their offsets (1 = the same, unrelated songs ~0.66)."""
    n = min(len(F), len(G))
    F, G = F[:n], G[:n]
    return float(max(np.mean(np.sum(F * np.roll(G, -L, axis=0), axis=1)) for L in range(n)))


def _measure(files: dict[str, Path], M: dict) -> dict:
    """One track's measurements (its calm and battle levels' files), as songs.json keeps them: per-bar and per-beat
    loudness, the best mellow cuts, the bar-to-bar step, and of the calm level the bar fingerprints, tuning, onsets
    and phrase grid. For `music trims` (shipped tracks) and `music candidates` (new takes)."""
    from .. import quality

    bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * dsp.SR))
    rec = dict(loud={}, cuts={}, step={})
    for lv, f in files.items():
        x = dsp.decode(f)
        m = x.mean(axis=1)
        rec["loud"][lv] = [round(float(10 * np.log10((m[i * bar:(i + 1) * bar] ** 2).mean() + 1e-12)), 2)
                           for i in range(len(m) // bar)]
        rec.setdefault("beats", {})[lv] = _beats(x, bar // M["bar_beats"])
        q = quality.features(x, M["bpm"])
        B = quality._bars(np.vstack([q["beat_chroma"], q["beat_mfcc"] * 0.3]), M["bar_beats"])
        B = B / (np.linalg.norm(B, axis=0, keepdims=True) + 1e-9)
        sim = B.T @ B
        nb = sim.shape[0]
        rec["cuts"][lv] = _cuts(sim, rec["loud"][lv])
        rec["step"][lv] = round(float(np.median([sim[k, k + 1] for k in range(nb - 1)])), 3)  # (this level's own bar-to-bar step)
        if lv == "calm":  # (the bars' fingerprints, to find the songs in step with this one: families)
            rec["feat"] = np.round(B.T[:M["bars"]], 3).tolist()
            rec["tuning"], rec["tuning_v"] = _tuning(x), TUNING_V
            rec["onset"] = _onsets(x, M["bpm"])
            rec["phrase"] = _phrase(np.array(rec["feat"]))
    return rec


def trims(proj: P.Project, force: bool = False) -> int:
    """Measure every shipped track for the Songs page's trimmed mellows (work/songs.json): the loudness of each bar of
    its calm and battle levels, and the best mellow loops cut from its middle. SA3 builds across a piece, so a loop's
    last bars (13-16 of 16) are its crescendo and its first bar still carries it (2026-10-20: over 98 tracks, bars 13-16
    +1.6 to +1.8 dB over the loop's mean, bar 1 +0.4, bars 2-4 -3.6 to -2.5); the steady middle loops on its own as the
    mellow, the crescendo leads into intense and bar 1 tapers back. A cut bars s..e (1-based, inside TRIM_REGION) jumps
    from bar e back to bar s, so it is scored by how alike bar s is to the bar that really follows e (cosine of the bars'
    beat chroma and MFCC, as quality.repeat): a natural bar-to-bar step in this music is ~0.78 (median), its roughest
    tenth under 0.5. Kept per track with the files' size and time, so only changed files are measured again."""
    from .. import quality

    st = Store(proj)
    path = proj.work / "songs.json"
    old = Store.read(path, {}) if not force else {}
    lib, out, n = library(proj), {}, 0
    M = proj.music
    bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * dsp.SR))
    for t in lib["tracks"]:
        need = [lv for lv in ("calm", "battle") if lv in t["files"]]
        files = {lv: Path(proj.assets) / t["files"][lv] for lv in need}
        sig = {lv: f"{f.stat().st_size}:{f.stat().st_mtime_ns}" for lv, f in files.items()}
        if old.get(t["id"], {}).get("sig") == sig:
            out[t["id"]] = old[t["id"]]
            if "tuning" not in out[t["id"]] or out[t["id"]].get("tuning_v") != TUNING_V:
                out[t["id"]]["tuning"], out[t["id"]]["tuning_v"] = _tuning(dsp.decode(files["calm"])), TUNING_V
            if "beats" not in out[t["id"]]:
                out[t["id"]]["beats"] = {lv: _beats(dsp.decode(f), bar // M["bar_beats"]) for lv, f in files.items()}
            if "onset" not in out[t["id"]]:
                out[t["id"]]["onset"] = _onsets(dsp.decode(files["calm"]), M["bpm"])
            out[t["id"]]["phrase"] = _phrase(np.array(out[t["id"]]["feat"]))
            recut(out[t["id"]], old[t["id"]]["cuts"]["calm"][0]["bars"] if old[t["id"]].get("cuts", {}).get("calm") else None)
            continue
        rec = dict(sig=sig, **_measure(files, M))
        out[t["id"]] = rec
        n += 1
        print(f"  {t['id']}: " + ", ".join(f"{lv} bars {c[0]['bars'][0]}-{c[0]['bars'][1]} (join {c[0]['seam']}, its steps "
                                           f"{rec['step'][lv]})" for lv, c in rec["cuts"].items() if c), flush=True)
    fams = families(lib["tracks"], out, M["bars"])
    for rec in out.values():
        rec.pop("family", None)
    for f in fams:
        for tid in f["members"]:
            out[tid]["family"] = f
    st.write(path, out)
    print(f"{len(fams)} families of siblings in step: {sum(len(f['members']) for f in fams)} songs"
          + "".join(f"\n  {f['key']}: {len(f['members'])} songs, in step {f['in_step']}" for f in fams))
    print(f"measured {n} tracks ({len(out) - n} unchanged); {path.relative_to(proj.root) if path.is_relative_to(proj.root) else path}")
    return 0


FAMILY_MIN = 0.65  # (in-step similarity under which siblings aren't treated as one piece)


def families(tracks: list[dict], measured: dict, bars: int) -> list[dict]:
    """Siblings: the shipped takes of one style and take id made for other contexts (the same seed, the prompt's mood
    and mode changed). SA3 made them as variations of one piece in step, bar for bar (2026-10-21: 22 families, 53 of
    98 tracks; bar-aligned similarity 0.82 between siblings against 0.63 for any two songs, and 21 of 22 families most
    alike at no offset), so the Songs page can switch between them at the same bar, as between levels, or play a family
    as one piece. Two siblings are in step when they are most alike with no offset and at least FAMILY_MIN; a family is
    the siblings joined by in-step pairs."""
    by: dict[str, list[str]] = {}
    for t in tracks:
        if t.get("key") and t.get("take") and t["id"] in measured and "feat" in measured[t["id"]]:
            style = t["key"].split("~", 1)[1] if "~" in t["key"] else "plain"
            by.setdefault(f"{style}.{t['take']}", []).append(t["id"])
    feat = {tid: np.array(r["feat"]) for tid, r in measured.items() if "feat" in r}

    def lag_sim(a: str, b: str, lag: int) -> float:
        A, B = feat[a], feat[b]
        n = min(len(A), len(B), bars)
        return float(np.mean([A[k] @ B[(k + lag) % n] for k in range(n)]))

    out = []
    for key, ids in sorted(by.items()):
        # siblings joined by in-step pairs (most alike with no offset, and at least FAMILY_MIN); each group is a family
        par = {a: a for a in ids}

        def root(a):
            while par[a] != a:
                a = par[a]
            return a
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                if max(range(-3, 4), key=lambda L: lag_sim(a, b, L)) == 0 and lag_sim(a, b, 0) >= FAMILY_MIN:
                    par[root(a)] = root(b)
        groups: dict[str, list[str]] = {}
        for a in ids:
            groups.setdefault(root(a), []).append(a)
        fams = [sorted(g) for g in groups.values() if len(g) > 1]
        for j, keep in enumerate(sorted(fams, key=len, reverse=True)):
            pairs = [(a, b) for i, a in enumerate(keep) for b in keep[i + 1:]]
            out.append(dict(key=key if j == 0 else f"{key}.{j + 1}", members=keep,
                            in_step=round(float(np.mean([lag_sim(a, b, 0) for a, b in pairs])), 3)))
    return out

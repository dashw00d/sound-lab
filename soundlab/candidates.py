"""Candidates: new music takes scored before the designer hears them, by what their shipped songs say makes a song
good (2026-10-21, research/song_scores.py and research/catchy_probe.py, MODELS_LOG):

  plays nice   how many transitions the taste model (work/join_model.json) rates 80% or more between the take and the
               shipped library, both ways: its exits (phrase ends inside its mellow cut) into every shipped song's
               entries (phrase starts), and theirs into its, where the join isn't a clash (join score under CLASH).
               The model's audio features only: a new take has no record in the votes, so records sit at their mean.
               Against the designer's saved sets, AUC 0.74 for the shipped songs; reported as how many of them it beats.
  catchy       a tune that sticks, from Basic Pitch's notes of the calm level's melody-and-harmony stem (Demucs): a
               melody that stands out, a motif that comes back changed, steps more than leaps, a hook leap, a singable
               range, in key, home notes and the tonic at phrase ends, a rhythm that repeats, 2 to 8 notes a bar. Each
               part standardised on the shipped songs, then the sum compared within the take's style (plucked and clear
               strings transcribe best, so a style is its own yardstick; a style with under 3 songs gets 0). The
               designer: a counterweight, "I wouldn't weight it too high".
  unique       how unlike everything else it is: of two measures, each standardised on pairs of shipped songs and
               averaged, its highest similarity to any shipped song (and to any new take ranked above it), against
               the shipped songs' own highest similarity to each other, negated:
                 same piece   the bar fingerprints (beat chroma and MFCC) at the best of 16 offsets: siblings 0.82,
                              any two songs 0.63 (families, 2026-10-21)
                 sounds like  CLAP (laion/larger_clap_music_and_speech, as research/song_groups.py), the mean of
                              four 4-bar windows, centred on the library (what all the music shares left out)
               The designer, 2026-10-21: the top should be "unique + plays nice"; their 5 stars are "sounds good and
               completely unique", 4 "good, but common in the library".
  pick         both at once: the weaker of plays nice and unique, plus a quarter of their sum (each standardised on
               the shipped songs; + catchy x catchiness in plays nice, 0 by default: "resort without the complexity
               score"). The designer asked for "unique + plays nice": added, a take very unlike everything but joining
               nothing ranked in the top 10 (day~violin k9: 1 good transition). Ranked one at a time: a take's
               uniqueness counts the new takes already ranked above it, so the top holds no two near-copies.

The quality gate (Audiobox CE) already threw out off-sounding takes when they were made. Writes work/candidates.json:
per take ("<set>.<take>"), its scores, its rank, and its measurements (as songs.json has them, so the Mixer can play
it later); the shipped songs' own scores come along for the yardstick.
"""
from __future__ import annotations

import collections
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import numpy as np

from . import dsp, music, project as P
from .store import Store

CATCHY_WEIGHT = 0.0  # (the designer took catchiness out of the ranking, 2026-10-21; --catchy puts it back)
UNEVEN_PEN = 0.2  # (per dB of step at its loop's seam over 2, and of dip inside it over 4: a 6 dB step costs 0.8)
both = lambda n, u: min(n, u) + 0.25 * (n + u)  # (the pick: plays nice and unique, the weaker counting most)
CLAP = "laion/larger_clap_music_and_speech"
NICE_AT = 0.8   # (the taste bar: the Mixer's default)
CLASH = 0.6     # (under this join score the Mixer never goes there)
KEY = {2, 4, 5, 7, 9, 10, 0, 1}  # D minor, natural and harmonic
HOME = {2, 5, 9}  # D, F, A
CATCHY_PARTS = ("tune", "motif", "varied_rep", "stepwise", "leap", "singable", "in_key", "home", "rhythm", "density")


def transcribe(path: Path) -> list[tuple[float, float, int, float]]:
    """Basic Pitch's notes (start s, end s, MIDI pitch, amplitude) of a file. basic-pitch is installed --no-deps on
    onnxruntime (its TensorFlow has no Python 3.12 build)."""
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    _, _, notes = predict(str(path), ICASSP_2022_MODEL_PATH, onset_threshold=0.5, frame_threshold=0.3, minimum_note_length=80)
    return [(float(a), float(b), int(p), float(v)) for a, b, p, v, *_ in notes]


def catchiness(nn: list, M: dict) -> dict | None:
    """The raw parts of catchiness from a loop's notes (research/catchy_probe.py, where each is described)."""
    beat = 60.0 / M["bpm"]
    N, step = M["bars"], beat / 4
    per_bar = M["bar_beats"] * 4
    steps = N * per_bar
    if not nn:
        return None
    top = max(n[3] for n in nn)
    strong = [n for n in nn if n[3] >= 0.5 * top]
    mel, amp, other = [None] * steps, [0.0] * steps, [0.0] * steps
    for i in range(steps):
        t = i * step + step / 2
        on = [n for n in strong if n[0] <= t < n[1]]
        if on:
            hi = max(on, key=lambda n: n[2])
            mel[i], amp[i] = hi[2], hi[3]
            rest = [n[3] for n in on if n is not hi]
            other[i] = float(np.mean(rest)) if rest else 0.0
    mn = [(i, p) for i, p in enumerate(mel) if p is not None and (i == 0 or mel[i - 1] != p)]
    if len(mn) < 4:
        return None
    pitches = np.array([p for _, p in mn])
    moves = np.diff(pitches)
    moves = moves[moves != 0]
    sounding = [i for i in range(steps) if mel[i] is not None]
    lift = float(np.mean([amp[i] - other[i] for i in sounding])) / top
    bars = [{(i % per_bar, p) for i, p in mn if i // per_bar == b} for b in range(N)]
    jac = lambda x, y: len(x & y) / len(x | y) if x | y else 0.0
    best, lag = max((float(np.mean([jac(bars[b], bars[(b + L) % N]) for b in range(N)])), L) for L in (4, 2, 1))
    near = [jac(bars[b], bars[(b + lag) % N]) for b in range(N)]
    rh = [{i for i, _ in b_} for b_ in bars]
    rng = float(np.percentile(pitches, 95) - np.percentile(pitches, 5))
    ends = [p for p in (mel[min(steps - 1, (b + 1) * per_bar - 1)] for b in range(3, N, 4)) if p is not None]
    dens = len(mn) / N
    return dict(
        tune=len(sounding) / steps * max(0.0, lift),
        motif=best,
        varied_rep=float(np.mean([0.3 <= x <= 0.9 for x in near])),
        stepwise=float(np.mean(np.abs(moves) <= 2)) if len(moves) else 0.0,
        leap=min(1.0, float(np.sum((np.abs(moves) >= 5) & (np.abs(moves) <= 8))) / (N / 4)),
        singable=float(np.clip((24 - rng) / 12, 0, 1)),
        in_key=float(np.mean([p % 12 in KEY for p in pitches])),
        home=0.5 * float(np.mean([p % 12 in HOME for p in pitches])) + 0.5 * (float(np.mean([p % 12 == 2 for p in ends])) if ends else 0.0),
        rhythm=float(np.mean([jac(rh[b], rh[(b + 1) % N]) for b in range(N)])),
        density=float(1.0 if 2 <= dens <= 8 else np.exp(-abs(np.log(dens / (2 if dens < 2 else 8))))),
        notes_per_bar=round(dens, 2), range=rng)


def ends(m: dict, t: str, cue: list[int] | None = None) -> tuple[list[int], list[int]]:
    """A song's entries (phrase starts) and exits (phrase ends) inside its mellow cut, as the Mixer walks them."""
    lo, hi = cue or m[t]["cuts"]["calm"][0]["bars"]
    ph = m[t]["phrase"]
    s0 = ph["start"] if ph["contrast"] >= 0.08 else lo
    starts = [b for b in range(lo, hi - 2) if (b - s0) % 4 == 0] or [lo]
    exits = [e for e in range(lo, hi + 1) if (e - s0) % 4 == 3] or [b + 3 for b in starts]
    return starts, exits


def join_score(m: dict, a: str, e: int, b: str, s: int) -> float:
    """The Mixer's join score (mixer.js jBar): how alike the bars either side of the cut are, less a loudness step."""
    fa, fb = np.array(m[a]["feat"]), np.array(m[b]["feat"])
    at = lambda f, i: f[(i - 1) % len(f)]
    ba, bb = m[a]["beats"]["calm"], m[b]["beats"]["calm"]
    step = abs(bb[((s - 1) * 4) % len(bb)] - ba[((e - 1) * 4 + 3) % len(ba)])
    return 0.5 * (at(fa, e + 1) @ at(fb, s) + at(fa, e) @ at(fb, s - 1)) - 0.03 * max(0, step - 2)


def taste(m: dict, model: dict, a: str, e: int, b: str, s: int) -> float:
    """The taste model's chance the designer likes song a's bar e into song b's bar s, from the audio alone."""
    f = music.join_features(m, a, e, b, s)
    for k in ("rec_a", "rec_b"):
        if k in model["features"]:
            f[k] = model["mu"][model["features"].index(k)]
    z = model["w"][0] + sum(model["w"][i + 1] * (f[x] - model["mu"][i]) / model["sd"][i] for i, x in enumerate(model["features"]))
    return float(1 / (1 + np.exp(-z)))


def _split_other(files: list[tuple[str, Path]], out: Path, cpu: bool = False) -> dict[str, Path]:
    """Demucs's melody-and-harmony stem ("other" + "vocals") of each calm file, in batches (one model load each); on
    the CPU with `cpu` (while a generator holds the GPU)."""
    got = {}
    for i in range(0, len(files), 12):
        batch = files[i:i + 12]
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([str(Path(sys.executable).parent / "demucs"), "-n", "htdemucs", *(["-d", "cpu"] if cpu else []), "-o", tmp,
                            *[str(f) for _, f in batch]],
                           check=True, capture_output=True)
            for name, f in batch:
                d = Path(tmp) / "htdemucs" / f.stem
                dst = out / f"{name}.other.ogg"
                dst.parent.mkdir(parents=True, exist_ok=True)
                dsp.write(dst, dsp.decode(d / "other.wav") + dsp.decode(d / "vocals.wav"))
                got[name] = dst
        print(f"  split {min(i + 12, len(files))} of {len(files)}", flush=True)
    return got


def candidates(proj: P.Project, everything: bool = False, cpu: bool = False, catchy: float = CATCHY_WEIGHT) -> int:
    """Score the newest round's takes (every round's with `everything`) against the shipped library; see the module."""
    M, st = proj.music, Store(proj)
    idx, votes = st.index(), st.votes()
    mesh = idx.get("mesh", {})
    newest = music.newest_round(mesh) if mesh else ""
    model = Store.read(proj.work / "join_model.json", None)
    shipped = Store.read(proj.work / "songs.json", {})
    lib = {t["id"]: t for t in music.library(proj)["tracks"]}
    lib_ids = [t for t in lib if t in shipped and "onset" in shipped[t]]
    if not model or not lib_ids:
        print("needs the shipped songs measured (music trims) and the taste model (music joins --fit)")
        return 1
    prof = M.get("default_profile", "stack")
    path = proj.work / "candidates.json"
    old = Store.read(path, {}).get("takes", {})

    # the takes: each one's calm and battle files
    takes = {}
    for key, c in mesh.get("contexts", {}).items():
        for t in c["takes"]:
            if not everything and t.get("round", c.get("round", "")) != newest:
                continue
            p_ = prof if prof in t["profiles"] else next(iter(t["profiles"]))
            lv = t["profiles"][p_]["levels"]
            if "calm" in lv and "battle" in lv:
                # (its id in the Mixer is the one `music promote` gives it: votes on its transitions stay with it once shipped)
                tid = ".".join(x for x in (c["context"], c.get("biome", "any"), c.get("style"), t["id"], p_) if x)
                takes[f"{key}.{t['id']}"] = dict(id=tid, key=key, take=t["id"], style=c.get("style") or "", context=c["context"],
                                                 biome=c.get("biome", "any"), profile=p_, levels=dict(lv),
                                                 files={k: st.clips / lv[k] for k in ("calm", "battle")})
    print(f"{len(takes)} takes to score against {len(lib_ids)} shipped songs", flush=True)
    if not takes:
        return 0

    # measure (as music trims), split, transcribe; what was done before and hasn't changed is kept
    sig = lambda f: f"{f.stat().st_size}:{f.stat().st_mtime_ns}"
    m = dict(shipped)
    measured, notes = {}, {}
    for cid, t in takes.items():
        s = {k: sig(f) for k, f in t["files"].items()}
        if old.get(cid, {}).get("sig") == s and "measure" in old[cid]:
            measured[cid], notes[cid] = old[cid]["measure"], old[cid].get("notes")
            prev = ((old[cid].get("first_cut") or (measured[cid].get("cuts", {}).get("calm") or [{}])[0].get("bars")))
            music.recut(measured[cid], prev)  # (the loop chosen as music trims chooses it: the one heard so far, unless uneven)
            if measured[cid].get("tuning_v") != music.TUNING_V:  # (measured again with the corrected estimate)
                measured[cid]["tuning"], measured[cid]["tuning_v"] = music._tuning(dsp.decode(t["files"]["calm"])), music.TUNING_V
        else:
            measured[cid] = music._measure(t["files"], M)
        m[cid] = measured[cid]
    print("  measured", flush=True)
    try:
        import basic_pitch  # noqa: F401
        can_hear_notes = True
    except ImportError:
        can_hear_notes = False
        print("  basic-pitch isn't installed: no catchiness (pick = plays nice alone)")
    if can_hear_notes:
        todo = [(cid.replace("~", "_").replace("/", "_"), t["files"]["calm"]) for cid, t in takes.items() if notes.get(cid) is None]
        names = {cid.replace("~", "_").replace("/", "_"): cid for cid in takes}
        if todo:
            stems = _split_other(todo, st.clips / "stems" / "candidates", cpu)
            for name, f in stems.items():
                notes[names[name]] = transcribe(f)
            print(f"  transcribed {len(stems)}", flush=True)
    lib_notes = Store.read(proj.work / "notes.json", {})

    # plays nice: the shipped songs among themselves (the yardstick), and each take with them
    cues = votes.get("cues", {})
    E = {t: ends(m, t, (cues.get(t) or {}).get("mellow")) for t in lib_ids}
    E.update({cid: ends(m, cid) for cid in takes})

    vid = {cid: t["id"] for cid, t in takes.items()}  # (a take's votes are under its Mixer id)

    def moves(a: str, bs: list[str]) -> int:
        n = 0
        for b in bs:
            if b == a:
                continue
            for x, y in ((a, b), (b, a)):
                for e in E[x][1]:
                    for s in E[y][0]:
                        if votes["clips"].get(f"join_{vid.get(x, x)}@{e}>{vid.get(y, y)}|{s}", 0) >= 0 and join_score(m, x, e, y, s) >= CLASH \
                                and taste(m, model, x, e, y, s) >= NICE_AT:
                            n += 1
        return n
    lib_nice = {t: moves(t, lib_ids) for t in lib_ids}  # (each song with the other shipped songs, as a take with them all)
    nice = {cid: moves(cid, lib_ids) for cid in takes}
    mu, sd = float(np.mean(list(lib_nice.values()))), float(np.std(list(lib_nice.values())) + 1e-9)
    print("  plays nice: counted", flush=True)

    # catchy: parts standardised on the shipped songs; the sum against its style's songs (shipped and new)
    style_of = lambda tid: (lib[tid].get("key") or "~").split("~")[-1] if tid in lib else takes[tid]["style"]
    raw = {t: catchiness(lib_notes.get(t, []), M) for t in lib_ids}
    raw.update({cid: catchiness(notes.get(cid) or [], M) for cid in takes})
    base = [t for t in lib_ids if raw[t]]
    stats = {k: (float(np.mean([raw[t][k] for t in base])), float(np.std([raw[t][k] for t in base]) + 1e-9)) for k in CATCHY_PARTS}
    total = {t: (sum(float(np.clip((r[k] - stats[k][0]) / stats[k][1], -2.5, 2.5)) for k in CATCHY_PARTS) if r else None)
             for t, r in raw.items()}
    lib_sd = float(np.std([total[t] for t in base]) + 1e-9)
    by_style = collections.defaultdict(list)
    for t, v in total.items():
        if v is not None:
            by_style[style_of(t)].append(v)
    within = {t: ((v - np.mean(by_style[style_of(t)])) / lib_sd if v is not None and len(by_style[style_of(t)]) >= 3 else 0.0)
              for t, v in total.items()}

    # unique: how unlike the shipped songs, and the takes ranked above it
    ids = lib_ids + list(takes)
    files = {t: Path(proj.assets) / lib[t]["files"]["calm"] for t in lib_ids} | {cid: t["files"]["calm"] for cid, t in takes.items()}
    E = _clap(proj, {i: files[i] for i in ids})
    Ec = np.array([E[i] for i in ids])
    Ec = Ec - Ec[:len(lib_ids)].mean(axis=0)
    Ec /= np.linalg.norm(Ec, axis=1, keepdims=True)
    Sc = Ec @ Ec.T  # (sounds like)
    Fx = np.array([np.array(m[i]["feat"])[:M["bars"]] for i in ids])
    Sf = np.max([np.einsum("ikd,jkd->ij", Fx, np.roll(Fx, -L, axis=1)) / Fx.shape[1] for L in range(Fx.shape[1])], axis=0)
    Sf = np.maximum(Sf, Sf.T)  # (same piece: at the best offset, either way round)
    nl = len(lib_ids)
    pairs = np.triu_indices(nl, 1)
    z = lambda S: (S - S[:nl, :nl][pairs].mean()) / (S[:nl, :nl][pairs].std() + 1e-9)
    Z = 0.5 * (z(Sc) + z(Sf))
    np.fill_diagonal(Z, -np.inf)
    lib_max = Z[:nl, :nl].max(axis=1)
    umu, usd = float(lib_max.mean()), float(lib_max.std() + 1e-9)
    uniq_lib = {t: -(lib_max[k] - umu) / usd for k, t in enumerate(lib_ids)}
    pos = {i: k for k, i in enumerate(ids)}
    # uneven: its loop still steps or dips at its best cut (it would sound broken each time round): down the ranking
    def uneven(t):
        c = ((m[t].get("cuts") or {}).get("calm") or [{}])[0]
        return max(0.0, c.get("step", 0) - 2) + max(0.0, c.get("dip", 0) - 4) + max(0.0, c.get("quiet", 0) - 3)
    base = {t: ((nice[t] - mu) / sd if t in takes else (lib_nice[t] - mu) / sd) + catchy * within[t] - UNEVEN_PEN * uneven(t) for t in ids}
    pick = {t: both(base[t], uniq_lib[t]) for t in lib_ids}
    # one at a time: the best by plays nice + unique against the shipped songs and the takes already ranked
    left, ranked, against, uniq = list(takes), [], list(range(nl)), {}
    while left:
        cols = np.array(against)
        # (probably the same piece as a shipped song or a take above it: no more unique than the library's least unique)
        u = {c: min(-(Z[pos[c], cols].max() - umu) / usd, -1.0 if Sf[pos[c], cols].max() >= SAME_PIECE else np.inf) for c in left}
        c = max(left, key=lambda c: both(base[c], u[c]))
        uniq[c], pick[c] = u[c], both(base[c], u[c])
        ranked.append(c); left.remove(c); against.append(pos[c])
    lib_picks = sorted(pick[t] for t in lib_ids)
    near = {}
    for cid in takes:
        k = pos[cid]
        j = int(np.argmax(Z[k, :nl]))
        near[cid] = dict(id=lib_ids[j], same_piece=round(float(Sf[k, j]), 3), sounds_like=round(float(Sc[k, j]), 3),
                         unique_vs_shipped=round(float(-(Z[k, :nl].max() - umu) / usd), 2))
    out = {}
    for cid, t in takes.items():
        out[cid] = dict(id=t["id"], key=t["key"], take=t["take"], style=t["style"], context=t["context"], biome=t["biome"],
                        profile=t["profile"], levels=t["levels"],
                        sig={k: sig(f) for k, f in t["files"].items()},
                        nice=nice[cid], nice_beats=sum(1 for v in lib_nice.values() if nice[cid] > v),
                        catchy=None if total[cid] is None else round(total[cid], 2), catchy_in_style=round(within[cid], 2),
                        pick=round(pick[cid], 2), pick_beats=sum(1 for v in lib_picks if pick[cid] > v),
                        unique=round(uniq[cid], 2), nearest=near[cid], uneven=round(uneven(cid), 1),
                        first_cut=(old.get(cid) or {}).get("first_cut") or ((old.get(cid) or {}).get("measure", {}).get("cuts", {}).get("calm") or [{}])[0].get("bars"),
                        notes_per_bar=(raw[cid] or {}).get("notes_per_bar"), measure=measured[cid], notes=notes.get(cid))
    order = ranked
    for i, c in enumerate(order):
        out[c]["rank"] = i + 1
    _retune(proj, st, out, {cid: r.get("tuned") for cid, r in old.items()})
    st.write(path, dict(made=datetime.now().strftime("%Y-%m-%d %H:%M"), round=None if everything else newest,
                        weights=dict(catchy=catchy, pick="min(nice, unique) + 0.25 (nice + unique)", nice_at=NICE_AT, clash=CLASH),
                        library=dict(songs=len(lib_ids), nice_mean=round(mu, 1), nice_sd=round(sd, 1),
                                     pick={t: round(pick[t], 2) for t in lib_ids}),
                        takes=out))
    n = len(lib_ids)
    print(f"\n{len(out)} takes, best first (beats: how many of the {n} shipped songs it scores over)")
    print(f"{'#':>3} {'take':34s} {'pick':>6} {'beats':>5} {'nice':>5} {'unique':>6}  nearest shipped song (same piece, sounds like)")
    for c in order:
        r = out[c]
        nr = r["nearest"]
        print(f"{r['rank']:3d} {c:34s} {r['pick']:+6.2f} {r['pick_beats']:5d} {r['nice']:5d} {r['unique']:+6.2f}  "
              f"{nr['id'].replace('.any', '').replace('.stack', '')} ({nr['same_piece']:.2f}, {nr['sounds_like']:+.2f})")
    top = sum(1 for r in out.values() if r["pick_beats"] >= n // 2)
    dup = [c for c in order if out[c]["nearest"]["same_piece"] >= SAME_PIECE]
    print(f"\n{top} of {len(out)} score over the median shipped song; {path}")
    print(f"{len(dup)} new takes are probably the same piece as a shipped song (bar fingerprints {SAME_PIECE} or more)"
          + (": " + ", ".join(f"{c} ~ {out[c]['nearest']['id']}" for c in dup[:12]) + (" ..." if len(dup) > 12 else "") if dup else ""))
    return 0


# (bar fingerprints this alike at the best offset: over the shipped songs, unrelated pairs median 0.66 and 1% at 0.81 or
# more, siblings median 0.82: the fingerprint is coarse for music that's all dark D minor, so only this high is a flag)
SAME_PIECE = 0.85


def _clap(proj: P.Project, files: dict) -> dict:
    """CLAP embeddings of the files (unit vectors), cached by path and file time in work/embeddings.npz."""
    path = proj.work / "embeddings.npz"
    have = {}
    if path.exists():
        z = np.load(path, allow_pickle=True)
        have = dict(zip(z["keys"].tolist(), z["emb"]))
    key = lambda f: f"{f}:{Path(f).stat().st_mtime_ns}"
    todo = [i for i, f in files.items() if key(f) not in have]
    if todo:
        import librosa
        import torch
        from transformers import ClapModel, ClapProcessor
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        model, proc = ClapModel.from_pretrained(CLAP).to(dev).eval(), ClapProcessor.from_pretrained(CLAP)
        for n, i in enumerate(todo):
            y, _ = librosa.load(files[i], sr=48000, mono=True)
            w = len(y) // 4
            inp = proc(audio=[y[k * w:(k + 1) * w] for k in range(4)], sampling_rate=48000, return_tensors="pt").to(dev)
            with torch.no_grad():
                out = model.get_audio_features(**inp)
            e = (out if hasattr(out, "float") else getattr(out, "pooler_output", None) if getattr(out, "pooler_output", None) is not None else out[0]).float().cpu().numpy()
            e /= np.linalg.norm(e, axis=1, keepdims=True)
            have[key(files[i])] = e.mean(axis=0)
            if (n + 1) % 25 == 0:
                print(f"  embedded {n + 1} of {len(todo)}", flush=True)
        np.savez(path, keys=np.array(list(have)), emb=np.array(list(have.values())))
    return {i: have[key(f)] / np.linalg.norm(have[key(f)]) for i, f in files.items()}


def _retune(proj: P.Project, st: Store, out: dict, done: dict) -> None:
    """As `music retune` does the shipped tracks: a take more than RETUNE_MIN cents off the common pitch gets copies of
    the levels the Mixer plays (calm, action, battle) shifted to it, under work/clips/tuned (its own files untouched)."""
    ref = Store.read(proj.work / "tuned.json", {}).get("reference")
    if ref is None:
        tun = [r["tuning"] for r in Store.read(proj.work / "songs.json", {}).values() if r.get("tuning") is not None]
        ref = float(np.median(tun)) if tun else None
    if ref is None:
        return
    n = 0
    for cid, r in out.items():
        c = r["measure"].get("tuning")
        if c is None or abs(c - ref) <= music.RETUNE_MIN:
            continue
        cents = round(ref - c, 1)
        tuned, prev = {}, done.get(cid) or {}
        for lv in ("calm", "action", "battle"):
            rel = r["levels"].get(lv)
            if not rel:
                continue
            src, dst = st.clips / rel, st.clips / "tuned" / rel
            sig = f"{src.stat().st_mtime_ns}:{cents}:{dsp.STRETCH}"
            if prev.get(lv, {}).get("sig") != sig or not dst.exists():
                x = dsp.decode(src)
                y = dsp.stretch(x, cents=cents)
                y = y[:len(x)] if len(y) >= len(x) else np.pad(y, ((0, len(x) - len(y)), (0, 0)))  # (the grid: the same length)
                dst.parent.mkdir(parents=True, exist_ok=True)
                dsp.write(dst, y)
                n += 1
            tuned[lv] = dict(file=f"tuned/{rel}", sig=sig)
        r["shift"], r["tuned"] = cents, tuned
    print(f"  retuned: {sum(1 for r in out.values() if r.get('shift'))} takes off the common pitch ({n} files made)", flush=True)


def measures(proj: P.Project) -> dict:
    """The scored takes' measurements by their Mixer id, as songs.json has the shipped tracks' (for the taste model)."""
    return {r["id"]: r["measure"] for r in Store.read(proj.work / "candidates.json", {}).get("takes", {}).values() if r.get("id")}


def mixer_tracks(proj: P.Project) -> list[dict]:
    """The scored takes as the Mixer's tracks, best first: their level files (retuned where they were), measurements
    and scores. Not shipped: the Songs page leaves them out, and the Mixer adds them only when asked."""
    c = Store.read(proj.work / "candidates.json", {})
    out = []
    for r in sorted(c.get("takes", {}).values(), key=lambda r: r.get("rank", 1e9)):
        if not r.get("id"):
            continue
        tuned = r.get("tuned") or {}
        out.append(dict(id=r["id"], context=r["context"], biome=r.get("biome", "any"), key=r["key"], take=r["take"],
                        profile=r.get("profile"), candidate={k: r.get(k) for k in ("rank", "pick", "pick_beats", "nice", "nice_beats", "catchy_in_style")},
                        files=dict(r["levels"]), src={lv: "/clips/" + (tuned[lv]["file"] if lv in tuned else f) for lv, f in r["levels"].items()},
                        measure=r["measure"], **({"shift": r["shift"]} if r.get("shift") else {})))
    return out

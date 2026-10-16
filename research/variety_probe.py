"""Variety probe: which prompt words make Stable Audio 3 write melodies and beats it hasn't written before? (Research,
outside the app; findings go into MODELS_LOG.md. First run 2026-10-15 for Emberhold, after the designer: "way too
many repeating patterns".)

Short clips (20 s) of three layer kinds, each always the same instrument (the designer: constrain by instrument, so
only the pattern varies; a wide pilot with any instrument was set aside), from a wide random space of pattern words:
  melody  always a solo violin: how the line moves, its scale, its rhythm, meter, tempo, mood, a genre idiom
  bass    always a solo cello playing a bass line: the same factors with bass-line motions
  beat    always a war drum ensemble: a pattern, a meter, tempo, mood, a genre idiom
Each factor is optional, so leaving it out is measured too. Timbre (CLAP) shows when a word pulls the instrument away. A seed baseline (a few fixed prompts over many seeds)
shows how much variety the seed alone gives; the game's shipped music is the "house" sound to get away from.

Measured, tempo-normalised (patterns in beats, not seconds: one groove at 90 and 140 BPM is the same groove):
  rhythm   the repeating cycle of accents per band (low, mid, high), the median over cycles (a fill that doesn't
           repeat drops out) and only the accents (hits under half the band's strongest drop out), low band weighted
           most: the skeleton, so extra hits laid over the same backbone don't make it new. Compared over shifts.
  melody   the main notes (pYIN; notes under a quarter beat, the ornaments, dropped): interval and interval-pair
           profile (key and tempo free), and where in the beat notes start and how long they last, in beats
  harmony  the pitch-class profile, key-free (the scale)
  timbre   CLAP (laion/larger_clap_music) embedding: the "same DNA" by sound
  quality  Audiobox Aesthetics (CE): only clips that sound good count; unique-because-broken teaches nothing
A clip's uniqueness on a dimension: 1 - its mean similarity to its 5 nearest good clips of its kind.

  runtime/venv/bin/python research/variety_probe.py --project P gen --minutes 6 [--tag pilot]
  runtime/venv/bin/python research/variety_probe.py --project P analyze      (scores, embeddings, features)
  runtime/venv/bin/python research/variety_probe.py --project P report       (report.md, report.html to listen)
Output: <project work>/variety/ (runs.jsonl, clips/, feats/, report.*, results.jsonl). Needs the GPU (SA3; then Audiobox +
CLAP). Findings: MODELS_LOG.md (2026-10-15, variety probe); results kept in research/data/.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))
from soundlab import paths  # noqa: E402

os.environ.setdefault("HF_HOME", str(paths.hf_home()))

SECONDS = 20.0
OUT: Path = Path()
KINDS = ("melody", "bass", "beat")
INSTRUMENT = {"melody": "solo violin", "bass": "solo cello", "beat": "a war drum ensemble"}
CE_FLOOR = {"melody": 6.0, "bass": 5.8, "beat": 5.5}  # (good enough to count; checked against the pilot)

# ---- the prompt space (plain, literal words: clever prompts degrade)
MOTION = ["that moves stepwise", "with wide leaps", "built from arpeggios", "that descends chromatically",
          "of repeated notes", "ornamented with trills", "that slides between notes", "in call and response phrases",
          "that rises in a sequence", "that falls in a sequence", "of long held notes", "of fast scale runs",
          "with octave jumps", "built on a short repeating motif", "that winds on and on", "built on a three-note motif",
          "in question and answer phrases", "over a pedal note"]
BASS_MOTION = ["a walking bass line", "a pulsing pedal note", "a repeating bass riff", "a descending bass line",
               "a bass line bouncing between root and fifth", "a bass line in octave jumps", "a syncopated bass riff",
               "long held low notes", "a bass line that climbs chromatically", "a bass line of repeated eighth notes",
               "a galloping bass figure", "a slow bass line that answers itself"]
SCALES = ["D minor", "D harmonic minor", "D phrygian", "D phrygian dominant", "D dorian", "D lydian", "D major",
          "D minor pentatonic", "a whole-tone scale", "D locrian", "a double harmonic scale", "a chromatic scale"]
MEL_RHYTHM = ["in dotted rhythms", "in triplets", "with syncopation", "with a swing", "in free time",
              "in staccato eighth notes", "in long legato notes", "in sixteenth-note runs", "in a galloping rhythm",
              "with long pauses between phrases"]
METERS = ["3/4", "4/4", "5/4", "6/8", "7/8", "9/8", "12/8"]
TEMPO_WORDS = ["slow", "moderate", "fast", "very fast"]
BPMS = [60, 70, 80, 90, 100, 110, 120, 130, 140, 160, 180]
MOODS = ["ominous", "triumphant", "playful", "mysterious", "desperate", "sly", "noble", "feverish", "sorrowful",
         "hypnotic", "aggressive", "whimsical", "eerie", "majestic", "grim", "frantic", "tender", "savage",
         "ceremonial", "haunting", "defiant", "cold"]
GENRES = ["film score", "video game boss battle", "baroque", "romantic era", "minimalist", "Middle Eastern",
          "East Asian", "Balkan", "flamenco", "jazz", "tango", "progressive rock", "heavy metal", "trip hop",
          "dark ambient", "medieval", "renaissance", "Gregorian", "dark fantasy", "sea shanty", "Celtic", "Viking",
          "Arabic maqam", "Indian raga", "West African", "Andean", "gothic", "industrial", "horror", "western",
          "klezmer", "march", "waltz", "lullaby", "tribal"]
PATTERNS = ["a four-on-the-floor beat", "a half-time groove", "a syncopated groove", "a three-against-two polyrhythm",
            "a galloping rhythm", "a shuffle", "a tresillo rhythm", "a clave pattern", "a blast beat", "rolling toms",
            "sparse heavy hits", "a rhythm that speeds up", "call and response between two drums", "a steady march",
            "a broken beat", "a driving eighth-note pulse", "a sixteenth-note groove", "an off-beat pattern",
            "a slow heartbeat pulse", "a stuttering rhythm"]
SHAPES = ["instrument", "sentence", "tags"]
# A few fixed prompts per kind, over many seeds: the seed's own variety.
BASELINE = {
    "melody": ["TrackType: Instrument, solo violin playing a melody built on a short repeating motif in D minor, grim. BPM: 90.",
               "TrackType: Instrument, solo violin playing a melody with wide leaps in D minor, haunting. BPM: 90."],
    "bass": ["TrackType: Instrument, solo cello playing a repeating bass riff in D minor, grim. BPM: 90.",
             "TrackType: Instrument, solo cello playing a walking bass line in D minor, ominous. BPM: 90."],
    "beat": ["TrackType: Instrument, a war drum ensemble playing a steady march, grim. BPM: 90.",
             "TrackType: Instrument, a war drum ensemble playing a driving eighth-note pulse, aggressive. BPM: 90."],
}


def pick(rng, pool, p=0.6):
    return rng.choice(pool) if rng.random() < p else None


def sample(rng: random.Random, kind: str) -> dict:
    f = dict(kind=kind, shape=rng.choice(SHAPES), mood=rng.choice(MOODS), genre=pick(rng, GENRES, 0.5),
             meter=pick(rng, METERS, 0.35))
    r = rng.random()
    f["tempo"] = "bpm" if r < 0.6 else "word" if r < 0.8 else None
    f["bpm"] = rng.choice(BPMS) if f["tempo"] == "bpm" else None
    f["tempo_word"] = rng.choice(TEMPO_WORDS) if f["tempo"] == "word" else None
    f["genre"] = pick(rng, GENRES, 0.35)
    if kind == "melody":
        f.update(motion=pick(rng, MOTION, 0.8), scale=pick(rng, SCALES, 0.6), mel_rhythm=pick(rng, MEL_RHYTHM, 0.5))
    elif kind == "bass":
        f.update(motion=pick(rng, BASS_MOTION, 0.8), scale=pick(rng, SCALES, 0.5), mel_rhythm=pick(rng, MEL_RHYTHM, 0.4))
    else:
        f.update(pattern=pick(rng, PATTERNS, 0.85))
    return f


def build(f: dict) -> str:
    k, sh, ins = f["kind"], f["shape"], INSTRUMENT[f["kind"]]
    tempo = f" BPM: {f['bpm']}." if f["bpm"] else f" {f['tempo_word'].capitalize()} tempo." if f["tempo_word"] else ""
    meter = f" in {f['meter']} time" if f.get("meter") else ""
    genre = f.get("genre")
    if k == "beat":
        what = f"{ins} playing {f.get('pattern') or 'a rhythm'}{meter}"
        extra = []
    else:
        mo = f.get("motion")
        what = (f"{ins} playing {'a melody ' + mo if mo else 'a melody'}" if k == "melody"
                else f"{ins} playing {mo or 'a bass line'}") + (f" in {f['scale']}" if f.get("scale") else "")
        what += (f", {f['mel_rhythm']}" if f.get("mel_rhythm") else "") + meter
        extra = [f.get("scale"), f.get("mel_rhythm")]
    if sh == "instrument":
        return f"TrackType: Instrument, {what}, {f['mood']}{f', {genre}' if genre else ''}.{tempo}"
    if sh == "sentence":
        return f"{f['mood'].capitalize()} {genre + ' ' if genre else ''}{'percussion loop' if k == 'beat' else 'music'}: {what}.{tempo}"
    word = {"melody": "a melody", "bass": "a bass line", "beat": "percussion"}[k]
    tags = ["TrackType: Instrument", f"Genre: {genre}" if genre else None, ins.removeprefix("solo ").removeprefix("a "),
            f.get("pattern") or word if k == "beat" else
            (f"a melody {f['motion']}" if f.get("motion") else word) if k == "melody" else f.get("motion") or word, *extra,
            f"{f['meter']} time" if f.get("meter") else None, f["mood"]]
    return ", ".join(t for t in tags if t) + "." + tempo


# ---- generation
def gen(minutes: float, tag: str, baseline_seeds: int) -> None:
    from soundlab import dsp
    from soundlab.engine import Engine

    eng = Engine()
    runs, clips = OUT / "runs.jsonl", OUT / "clips"
    clips.mkdir(parents=True, exist_ok=True)
    done = sum(1 for _ in open(runs)) if runs.exists() else 0
    rng = random.Random(f"{tag}:{done}")
    todo = [dict(kind=k, baseline=i, prompt=p, seed=s) for k, ps in BASELINE.items() for i, p in enumerate(ps)
            for s in range(baseline_seeds)]
    t_end = time.time() + minutes * 60
    n = 0
    with open(runs, "a") as fh:
        while time.time() < t_end:
            if todo:
                r = todo.pop(0)
            else:
                f = sample(rng, KINDS[n % 3])
                r = dict(f, prompt=build(f), seed=rng.randrange(1 << 30))
            r.update(id=f"{tag}-{done + n:05d}", tag=tag)
            x = eng.generate(r["prompt"], SECONDS, r["seed"])
            r["gen_s"] = round(eng.last_s, 2)
            r["silent"] = bool(dsp.silent(x))
            if not r["silent"]:
                x = dsp.normalise(x, -20.0, -1.0)
            dsp.write(clips / f"{r['id']}.ogg", x)
            fh.write(json.dumps(r) + "\n")
            fh.flush()
            n += 1
            if n % 25 == 0:
                print(f"  {n} clips ({r['gen_s']} s each)", flush=True)
    print(f"generated {n} clips", flush=True)


# ---- features (CPU)
SUB = 12  # subdivisions per beat: sixteenths and triplets both land on it
BAND_W = (1.0, 0.7, 0.35)  # low (kick, toms), mid, high (hats): the backbone counts most
HOP = 256
SR_A = 22050


def _fold(bt: np.ndarray) -> np.ndarray:
    """Beat times folded into 70-140 BPM (one beat level for every clip: tempo-normalised)."""
    for _ in range(3):
        if len(bt) < 4:
            return bt
        tempo = 60.0 / np.median(np.diff(bt))
        if tempo >= 140:
            bt = bt[::2]
        elif tempo < 70:
            bt = np.sort(np.concatenate([bt, (bt[:-1] + bt[1:]) / 2]))
        else:
            break
    return bt


def _pattern(env: np.ndarray, bt_f: np.ndarray) -> np.ndarray | None:
    """(beats, bands, SUB): each band's strongest onset in each sub-step of each beat."""
    if len(bt_f) < 7:
        return None
    rows = []
    for a, b in zip(bt_f[:-1], bt_f[1:]):
        edges = a + (b - a) * np.arange(SUB + 1) / SUB - (b - a) / (2 * SUB)
        e = np.clip(np.round(edges).astype(int), 0, env.shape[1] - 1)
        rows.append([[env[c, e[k]:max(e[k + 1], e[k] + 1)].max() for k in range(SUB)] for c in range(env.shape[0])])
    m = np.array(rows)
    return m / (np.percentile(m, 95, axis=(0, 2), keepdims=True) + 1e-9)


def _skeleton(m: np.ndarray, cyc: int) -> tuple[np.ndarray | None, float]:
    """The repeating cycle's accents: median over cycles, hits under half each band's strongest dropped, bands weighted.
    Returns (vector (cyc*SUB*3), how alike the cycles are)."""
    nc = len(m) // cyc
    if nc < 2:
        return None, 0.0
    c = m[:nc * cyc].reshape(nc, cyc, m.shape[1], SUB)
    med = np.median(c, axis=0)  # (cyc, bands, SUB)
    sk = np.where(med >= 0.5 * med.max(axis=(0, 2), keepdims=True), med, 0) * np.array(BAND_W)[None, :, None]
    flat = c.reshape(nc, -1)
    ref = med.reshape(-1)
    cons = float(np.mean([np.corrcoef(f, ref)[0, 1] for f in flat if f.std() > 0])) if nc else 0.0
    v = sk.transpose(0, 2, 1).reshape(-1, sk.shape[1])  # time-major: (cyc*SUB, bands), so rolling shifts time
    return v.reshape(-1), cons


def features(args) -> dict:
    path, kind = args
    import librosa

    from soundlab import dsp
    x = dsp.decode(Path(path)).mean(axis=1)
    y = librosa.resample(x.astype(np.float32), orig_sr=dsp.SR, target_sr=SR_A)
    out: dict = {}
    oenv = librosa.onset.onset_strength(y=y, sr=SR_A, hop_length=HOP)
    tempo, bt = librosa.beat.beat_track(onset_envelope=oenv, sr=SR_A, hop_length=HOP, units="time")
    out["tempo_raw"] = float(np.atleast_1d(tempo)[0])
    btf = _fold(np.asarray(bt))
    out["tempo"] = float(60.0 / np.median(np.diff(btf))) if len(btf) > 3 else 0.0
    out["ibi_cv"] = float(np.std(np.diff(btf)) / np.mean(np.diff(btf))) if len(btf) > 3 else 1.0
    ac = librosa.autocorrelate(oenv - oenv.mean())
    ac = ac / (ac[0] + 1e-9)
    lag = int(round(60.0 / max(out["tempo"], 1) * SR_A / HOP))
    out["pulse"] = float(ac[max(1, int(lag * 0.95)):int(lag * 1.05) + 2].max()) if 0 < lag < len(ac) - 2 else 0.0
    out["onsets_per_beat"] = float(len(librosa.onset.onset_detect(onset_envelope=oenv, sr=SR_A, hop_length=HOP))
                                   / max(len(btf) - 1, 1))
    # rhythm skeleton per band
    S = librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=SR_A, hop_length=HOP, n_mels=64, fmax=SR_A / 2))
    mf = librosa.mel_frequencies(n_mels=64, fmax=SR_A / 2)
    ch = [0, int(np.searchsorted(mf, 200)), int(np.searchsorted(mf, 2000)), 64]
    benv = librosa.onset.onset_strength_multi(S=S, sr=SR_A, hop_length=HOP, channels=ch)
    m = _pattern(benv, np.asarray(btf) * SR_A / HOP)
    for cyc in (3, 4):
        v, cons = _skeleton(m, cyc) if m is not None else (None, 0.0)
        out[f"rhythm{cyc}"] = v.tolist() if v is not None else None
        out[f"cons{cyc}"] = round(cons, 3)
    # harmony: pitch-class profile
    chroma = librosa.feature.chroma_cqt(y=y, sr=SR_A, hop_length=512)
    out["chroma"] = (chroma.mean(axis=1) / (chroma.mean(axis=1).sum() + 1e-9)).tolist()
    if kind != "beat":
        out.update(_melody(y, btf))
    return out


def _melody(y: np.ndarray, btf: np.ndarray) -> dict:
    import librosa
    f0, vf, _ = librosa.pyin(y, fmin=40, fmax=1600, sr=SR_A, frame_length=2048, hop_length=HOP)
    t = librosa.times_like(f0, sr=SR_A, hop_length=HOP)
    midi = np.where(vf, np.round(librosa.hz_to_midi(np.nan_to_num(f0, nan=1.0))), -1)
    notes = []  # (start, end, pitch)
    i = 0
    while i < len(midi):
        j = i
        while j + 1 < len(midi) and midi[j + 1] == midi[i]:
            j += 1
        if midi[i] >= 0 and j - i + 1 >= 3:
            notes.append((t[i], t[j] + HOP / SR_A, int(midi[i])))
        i = j + 1
    out = dict(voiced=float(np.mean(vf)), notes=len(notes))
    if len(btf) < 4 or len(notes) < 6:
        return out
    bi = np.arange(len(btf))
    pos = lambda s: np.interp(s, btf, bi, left=None, right=None) if btf[0] <= s <= btf[-1] else \
        (s - btf[0]) / np.median(np.diff(btf)) if s < btf[0] else len(btf) - 1 + (s - btf[-1]) / np.median(np.diff(btf))
    main = [(pos(a), pos(b), p) for a, b, p in notes if pos(b) - pos(a) >= 0.25]  # (ornaments out)
    merged = []
    for n in main:
        if merged and merged[-1][2] == n[2] and n[0] - merged[-1][1] < 0.25:
            merged[-1] = (merged[-1][0], n[1], n[2])
        else:
            merged.append(n)
    out["main_notes"] = len(merged)
    if len(merged) < 6:
        return out
    ps = np.array([p for _, _, p in merged])
    iv = np.clip(np.diff(ps), -12, 12)
    out["intervals"] = (np.bincount(iv + 12, minlength=25) / len(iv)).tolist()
    iv7 = np.clip(iv, -7, 7) + 7
    big = np.bincount(iv7[:-1] * 15 + iv7[1:], minlength=225).astype(float)
    out["interval_pairs"] = (big / max(big.sum(), 1)).tolist()
    onp = np.bincount(np.round((np.array([a for a, _, _ in merged]) % 1) * SUB).astype(int) % SUB, minlength=SUB)
    dur = np.array([b - a for a, b, _ in merged])
    db = np.bincount(np.clip(np.round(np.log2(dur / 0.25)).astype(int), 0, 5), minlength=6)
    out["mel_rhythm"] = np.concatenate([onp / onp.sum(), db / db.sum()]).tolist()
    out["grams"] = sorted({",".join(map(str, iv[k:k + 4])) for k in range(len(iv) - 3)})
    out["range"] = float(np.percentile(ps, 95) - np.percentile(ps, 5))
    out["notes_per_beat"] = float(len(merged) / max(merged[-1][1] - merged[0][0], 1))
    return out


# ---- analysis
def analyze(workers: int) -> None:
    rows = [json.loads(l) for l in open(OUT / "runs.jsonl")]
    feats = OUT / "feats"
    feats.mkdir(exist_ok=True)
    refs = house_refs()
    items = [(r["id"], str(OUT / "clips" / f"{r['id']}.ogg"), r["kind"]) for r in rows if not r.get("silent")]
    items += [(f"house-{i}", p, k) for i, (p, k) in enumerate(refs)]
    todo = [it for it in items if not (feats / f"{it[0]}.json").exists()]
    print(f"{len(todo)} clips to analyse ({len(items) - len(todo)} done)", flush=True)
    # GPU part: Audiobox + CLAP, in batches
    from soundlab import quality
    for i in range(0, len(todo), 16):
        batch = todo[i:i + 16]
        aes = quality.aesthetics([p for _, p, _ in batch])
        emb = clap([p for _, p, _ in batch])
        for (cid, p, k), a, e in zip(batch, aes, emb):
            (feats / f"{cid}.gpu.json").write_text(json.dumps(dict(aes=a, clap=e)))
        print(f"  scored {min(i + 16, len(todo))}/{len(todo)}", flush=True)
    _CLAP.clear()
    with ProcessPoolExecutor(workers) as ex:
        for n, ((cid, p, k), f) in enumerate(zip(todo, ex.map(features, [(p, k) for _, p, k in todo], chunksize=2))):
            g = json.loads((feats / f"{cid}.gpu.json").read_text())
            f.update(g, id=cid, kind=k, path=p)
            (feats / f"{cid}.json").write_text(json.dumps(f))
            if (n + 1) % 50 == 0:
                print(f"  features {n + 1}/{len(todo)}", flush=True)
    print("analysed", flush=True)


_CLAP: dict = {}


def clap(paths_: list[str]) -> list[list[float]]:
    import librosa
    import torch
    from transformers import ClapModel, ClapProcessor

    from soundlab import dsp
    if "m" not in _CLAP:
        _CLAP["m"] = ClapModel.from_pretrained("laion/larger_clap_music").eval().to("cuda")
        _CLAP["p"] = ClapProcessor.from_pretrained("laion/larger_clap_music")
    xs = [librosa.resample(dsp.decode(Path(p)).mean(axis=1).astype(np.float32), orig_sr=dsp.SR, target_sr=48000) for p in paths_]
    inp = _CLAP["p"](audio=xs, sampling_rate=48000, return_tensors="pt")
    inp = {k: v.to("cuda") for k, v in inp.items()}
    with torch.no_grad():
        e = _CLAP["m"].get_audio_features(**inp)
    e = getattr(e, "pooler_output", e)
    e = torch.nn.functional.normalize(e, dim=-1)
    return e.cpu().numpy().round(5).tolist()


def house_refs() -> list[tuple[str, str]]:
    """The game's shipped music as the house sound: each track's calm level (the spine, no drum layers) for melody and
    bass, its action level (the spine and its drums) for beat."""
    music = Path(PROJ.assets) / "music" / "mesh"
    out = []
    for f in sorted(music.glob("*.stack_calm.ogg")):
        out += [(str(f), "melody"), (str(f), "bass")]
    out += [(str(f), "beat") for f in sorted(music.glob("*.stack_action.ogg"))]
    return out


# ---- similarity
def _cos(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    A = A / (np.linalg.norm(A, axis=1, keepdims=True) + 1e-9)
    B = B / (np.linalg.norm(B, axis=1, keepdims=True) + 1e-9)
    return A @ B.T


def center(ref: list[dict], feats: list[dict]) -> None:
    """What every clip of the kind shares taken out, so only the differences count: each feature minus the mean of the
    kind's good random clips (a steady beat always has hits on the beat; every clip here is a violin in D). Rhythm
    cycles and pitch profiles are first turned to their best match with that mean (a canonical phase or key), then
    centred. Writes "<key>_c"."""
    def aligned(v, m, shifts, axis):
        return max((np.roll(v, s, axis=axis) for s in shifts), key=lambda w: float((w * m).sum()))
    for cyc in (3, 4):
        k = f"rhythm{cyc}"
        R = [np.array(f[k]).reshape(cyc * SUB, 3) for f in ref if f.get(k)]
        if len(R) < 5:
            continue
        m = np.mean(R, axis=0)
        for _ in range(3):
            m = np.mean([aligned(v, m, range(0, cyc * SUB, 3), 0) for v in R], axis=0)
        for f in feats:
            if f.get(k):
                f[k + "_c"] = (aligned(np.array(f[k]).reshape(cyc * SUB, 3), m, range(0, cyc * SUB, 3), 0) - m).reshape(-1)
    C = [np.array(f["chroma"]) for f in ref]
    m = np.mean(C, axis=0)
    for _ in range(3):
        m = np.mean([aligned(v, m, range(12), 0) for v in C], axis=0)
    for f in feats:
        f["chroma_c"] = aligned(np.array(f["chroma"]), m, range(12), 0) - m
    for k in ("intervals", "interval_pairs", "mel_rhythm", "clap"):
        V = [np.array(f[k]) for f in ref if f.get(k)]
        if len(V) < 5:
            continue
        m = np.mean(V, axis=0)
        for f in feats:
            if f.get(k):
                f[k + "_c"] = np.array(f[k]) - m


def sim_rhythm(F: list[dict], G: list[dict]) -> np.ndarray:
    """Centred skeleton similarity, the best over cycle length (3 or 4 beats) and a sixteenth either way."""
    S = np.full((len(F), len(G)), np.nan)
    for cyc in (3, 4):
        k = f"rhythm{cyc}_c"
        a = [i for i, f in enumerate(F) if k in f]
        b = [j for j, g in enumerate(G) if k in g]
        if not a or not b:
            continue
        A = np.array([F[i][k] for i in a])
        B = np.array([G[j][k] for j in b]).reshape(len(b), cyc * SUB, 3)
        best = np.max([_cos(A, np.roll(B, s, axis=1).reshape(len(b), -1)) for s in (-3, 0, 3)], axis=0)
        S[np.ix_(a, b)] = np.fmax(S[np.ix_(a, b)], best)
    return S


def sim_harmony(F, G):
    return _cos(np.array([f["chroma_c"] for f in F]), np.array([g["chroma_c"] for g in G]))


def sim_vec(F, G, key):
    S = np.full((len(F), len(G)), np.nan)
    a = [i for i, f in enumerate(F) if key in f]
    b = [j for j, g in enumerate(G) if key in g]
    if a and b:
        S[np.ix_(a, b)] = _cos(np.array([F[i][key] for i in a]), np.array([G[j][key] for j in b]))
    return S


def sim_melody(F, G):
    return 0.6 * sim_vec(F, G, "interval_pairs_c") + 0.4 * sim_vec(F, G, "intervals_c")


DIMS = {"rhythm": sim_rhythm, "melody": sim_melody, "mel_rhythm": lambda F, G: sim_vec(F, G, "mel_rhythm_c"),
        "harmony": sim_harmony, "timbre": lambda F, G: sim_vec(F, G, "clap_c")}
KIND_DIMS = {"melody": ["melody", "mel_rhythm", "harmony", "timbre"], "bass": ["melody", "mel_rhythm", "rhythm", "timbre"],
             "beat": ["rhythm", "timbre"]}


def good(f: dict, r: dict | None) -> bool:
    ce = (f.get("aes") or {}).get("CE", 0)
    return ce >= CE_FLOOR[f["kind"]]


def measurable(f: dict, dim: str) -> bool:
    if dim == "rhythm":
        return f["pulse"] >= 0.3 and f["ibi_cv"] <= 0.12 and bool(f.get("rhythm3") or f.get("rhythm4"))
    if dim in ("melody", "mel_rhythm"):
        return f.get("voiced", 0) >= 0.3 and bool(f.get("intervals"))
    return True


def report() -> None:
    rows = {r["id"]: r for r in (json.loads(l) for l in open(OUT / "runs.jsonl"))}
    feats = {p.stem: json.loads(p.read_text()) for p in (OUT / "feats").glob("*.json") if not p.stem.endswith(".gpu")}
    lines = [f"# Variety probe ({time.strftime('%Y-%m-%d %H:%M')})", "",
             f"{len(rows)} clips, {sum(1 for r in rows.values() if r.get('silent'))} silent. "
             f"CE floors: {CE_FLOOR}. Similarities are centred (what every clip of the kind shares taken out: 0 = unrelated). Uniqueness = 1 - mean similarity to the 5 nearest good clips of the kind.", ""]
    html = []
    data_rows = []
    for kind in KINDS:
        F = [f for cid, f in feats.items() if f["kind"] == kind and not cid.startswith("house")]
        H = [f for cid, f in feats.items() if f["kind"] == kind and cid.startswith("house")]
        if not F:
            continue
        ces = np.array([(f.get("aes") or {}).get("CE", 0) for f in F])
        G = [f for f in F if good(f, rows.get(f["id"]))]
        lines += [f"## {kind}", "", f"{len(F)} clips; CE median {np.median(ces):.2f} (p10 {np.percentile(ces, 10):.2f}, "
                  f"p90 {np.percentile(ces, 90):.2f}); {len(G)} good (CE >= {CE_FLOOR[kind]}).", ""]
        rand = [f for f in G if rows[f["id"]].get("baseline") is None]
        base = [f for f in G if rows[f["id"]].get("baseline") is not None]
        uniq = {f["id"]: {} for f in rand}
        center(rand, F + H)
        follow = {}
        lines += ["| dimension | measurable | random pairs: mean sim | seed baseline: same prompt | near the house (max sim) | uniqueness median |",
                  "|---|---|---|---|---|---|"]
        for dim in KIND_DIMS[kind]:
            R = [f for f in rand if measurable(f, dim)]
            if len(R) < 8:
                continue
            S = DIMS[dim](R, R)
            np.fill_diagonal(S, np.nan)
            k = min(5, len(R) - 1)
            top = -np.sort(-np.nan_to_num(S, nan=-1), axis=1)[:, :k]
            u = 1 - top.mean(axis=1)
            for f, v in zip(R, u):
                uniq[f["id"]][dim] = round(float(v), 4)
            Bm = [f for f in base if measurable(f, dim)]
            bs = []
            for b in {rows[f["id"]]["prompt"] for f in Bm}:
                grp = [f for f in Bm if rows[f["id"]]["prompt"] == b]
                if len(grp) > 1:
                    s = DIMS[dim](grp, grp)
                    bs += list(s[np.triu_indices(len(grp), 1)])
            Hm = [h for h in H if measurable(h, dim)]
            hs = np.nanmax(DIMS[dim](R, Hm), axis=1) if Hm else np.array([np.nan])
            for f, v in zip(R, hs):
                uniq[f["id"]][f"house_{dim}"] = round(float(v), 4)
            lines.append(f"| {dim} | {len(R)}/{len(rand)} | {np.nanmean(S):.3f} | {np.nanmean(bs) if bs else float('nan'):.3f} "
                         f"| {np.nanmean(hs):.3f} | {np.median(u):.3f} |")
            follow[dim] = followed(R, [rows[f["id"]] for f in R], S, hs)
        lines.append("")
        for dim, fl in follow.items():
            if fl:
                lines += [f"**Words followed on {dim}** (clips sharing the word, their similarity to each other above random pairs; "
                          f"and how near the house they land, lower = further away): " + "; ".join(fl), ""]
        # factor effects: ridge over one-hot factors, on uniqueness per dimension, on CE and on being good
        lines += effects(kind, [rows[f["id"]] for f in F if rows[f["id"]].get("baseline") is None],
                         {f["id"]: f for f in F}, uniq)
        for f in F:
            r = rows[f["id"]]
            data_rows.append(dict({k: v for k, v in r.items() if k not in ("tag",)}, CE=(f.get("aes") or {}).get("CE"),
                                  PQ=(f.get("aes") or {}).get("PQ"), tempo=round(f["tempo"], 1), pulse=round(f["pulse"], 3),
                                  ibi_cv=round(f["ibi_cv"], 3), good=good(f, r), **uniq.get(f["id"], {})))
        # listening: the most unique good clips per dimension, and the most house-like
        html.append(f"<h2>{kind}</h2>")
        for dim in KIND_DIMS[kind]:
            ranked = sorted((f for f in rand if dim in uniq[f["id"]]), key=lambda f: -uniq[f["id"]][dim])
            if not ranked:
                continue
            html.append(f"<h3>most unique by {dim}</h3>" + "".join(_li(rows[f["id"]], f, uniq[f["id"]]) for f in ranked[:8]))
            html.append(f"<h3>least unique by {dim}</h3>" + "".join(_li(rows[f["id"]], f, uniq[f["id"]]) for f in ranked[-4:]))
    (OUT / "report.md").write_text("\n".join(lines) + "\n")
    (OUT / "report.html").write_text("<meta charset=utf-8><style>body{font:14px system-ui;background:#111;color:#ddd;"
                                     "max-width:1100px;margin:auto}li{margin:8px 0}small{color:#888}</style>"
                                     + "\n".join(html))
    with open(OUT / "results.jsonl", "w") as fh:
        for d in data_rows:
            fh.write(json.dumps(d) + "\n")
    print("\n".join(lines))
    print(f"\nlisten: {OUT / 'report.html'}")


def followed(R: list[dict], rows: list[dict], S: np.ndarray, house: np.ndarray, top: int = 10) -> list[str]:
    """Factor values the model follows on this dimension: mean similarity among the clips that share the value, minus
    the mean over all pairs (the word makes them alike); with the group's mean nearness to the house."""
    base = np.nanmean(S)
    out = []
    for k in ("motion", "pattern", "mel_rhythm", "scale", "meter", "genre", "mood", "bpm", "tempo_word", "shape"):
        vals = {}
        for i, r in enumerate(rows):
            if r.get(k) is not None:
                vals.setdefault(r[k], []).append(i)
        for v, ix in vals.items():
            if len(ix) < 4:
                continue
            sub = S[np.ix_(ix, ix)]
            w = np.nanmean(sub[~np.eye(len(ix), dtype=bool)])
            out.append((w - base, f"{k}={v} {w - base:+.2f} (n{len(ix)}, house {np.nanmean(house[ix]):.2f})"))
    return [t for _, t in sorted(out, reverse=True)[:top]]


def _li(r, f, u):
    return (f"<li><audio controls preload=none src='clips/{r['id']}.ogg'></audio> <b>{r['id']}</b> "
            f"<small>CE {(f.get('aes') or {}).get('CE', 0):.1f} · {f['tempo']:.0f} BPM · "
            + " · ".join(f"{k} {v:.2f}" for k, v in u.items()) + f"</small><br>{r['prompt']}</li>")


FACTORS = ["shape", "mood", "genre", "meter", "tempo", "tempo_word", "bpm", "motion", "scale", "mel_rhythm", "pattern"]


def effects(kind: str, R: list[dict], F: dict, uniq: dict) -> list[str]:
    from sklearn.linear_model import Ridge
    cols = sorted({f"{k}={r.get(k)}" for r in R for k in FACTORS if k in r})
    if len(R) < 30:
        return [f"(only {len(R)} random clips: no factor effects yet)", ""]
    have = [{f"{k}={r.get(k)}" for k in FACTORS if k in r} for r in R]
    X = np.array([[1.0 if c in h else 0.0 for c in cols] for h in have])
    targets = {"CE": np.array([(F[r["id"]].get("aes") or {}).get("CE", np.nan) for r in R])}
    targets["good"] = np.array([float(good(F[r["id"]], r)) for r in R])
    for dim in KIND_DIMS[kind]:
        targets[f"unique {dim}"] = np.array([uniq.get(r["id"], {}).get(dim, np.nan) for r in R])
        targets[f"away from house {dim}"] = np.array([1 - uniq.get(r["id"], {}).get(f"house_{dim}", np.nan) for r in R])
    out = []
    rng = np.random.default_rng(0)
    for name, y in targets.items():
        ok = ~np.isnan(y)
        if ok.sum() < 30:
            continue
        Xo, yo = X[ok], y[ok]
        coef = Ridge(alpha=3.0).fit(Xo, yo - yo.mean()).coef_
        boots = []
        for _ in range(30):
            ix = rng.integers(0, len(yo), len(yo))
            boots.append(Ridge(alpha=3.0).fit(Xo[ix], yo[ix] - yo[ix].mean()).coef_)
        sd = np.std(boots, axis=0)
        nn = Xo.sum(axis=0)
        rank = [i for i in np.argsort(-coef) if nn[i] >= 4]
        sc = np.std(yo) or 1
        fmt = lambda i: f"{cols[i]} {coef[i] / sc:+.2f}±{sd[i] / sc:.2f} (n{int(nn[i])})"
        out.append(f"- **{name}** (n {ok.sum()}, mean {yo.mean():.3f}, sd {np.std(yo):.3f}; effects in sd): "
                   f"up: {', '.join(fmt(i) for i in rank[:6])}; down: {', '.join(fmt(i) for i in rank[-6:][::-1])}")
    return out + [""]


def main() -> int:
    global OUT, PROJ
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("cmd", choices=["gen", "analyze", "report"])
    ap.add_argument("--minutes", type=float, default=6)
    ap.add_argument("--tag", default="v")
    ap.add_argument("--baseline-seeds", type=int, default=8)
    ap.add_argument("--workers", type=int, default=12)
    a = ap.parse_args()
    from soundlab import project as pj
    PROJ = pj.load(a.project)
    OUT = Path(PROJ.work) / "variety"
    OUT.mkdir(parents=True, exist_ok=True)
    if a.cmd == "gen":
        gen(a.minutes, a.tag, a.baseline_seeds)
    elif a.cmd == "analyze":
        analyze(a.workers)
    else:
        report()
    return 0


PROJ = None

if __name__ == "__main__":
    sys.exit(main())

"""Music prompt probe: what in a prompt makes Stable Audio 3 music sound off? (Research, outside the app; findings
go into MODELS_LOG.md and tuning.json. First run 2026-10-15 for Emberhold.)

Random prompts from a factor space (prompt shape, genre tags, line-up and part count, what each part does, mood and
intensity words, how tempo and key are written, a recording phrase, the VocalType tag), one spine-length take each,
scored with SoundLab's detector (quality.py: Audiobox Aesthetics CE/CU/PC/PQ, pauses) and the generator's tempo check
(steady at 90 BPM or not: an unsteady take is a rejection). Rows go to runs.jsonl, audio to clips/.

  runtime/venv/bin/python research/music_probe.py --project P run --minutes 60 [--repeat] [--exclude ID ..]
  runtime/venv/bin/python research/music_probe.py --project P report

--repeat runs a few fixed prompts over seeds, to measure seed noise (do it first: a pilot). --exclude leaves
instruments out (Emberhold: its folk ones). The instruments are the project's music candidates; results go to
<project work>/probe/ (runs.jsonl, clips/). It needs the GPU to itself (SA3 plus the Audiobox model, ~13 GB).
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

import numpy as np

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))
import os  # noqa: E402
from soundlab import paths  # noqa: E402

os.environ.setdefault("HF_HOME", str(paths.hf_home()))  # (SoundLab's model cache; the engine then runs offline)

BPM = 90.0
SECONDS = 48.0
OUT = None  # <project work>/probe, set in main

GENRES = ["Cinematic", "Orchestral", "Epic", "Dark", "Horror", "Soundtrack", "Medieval", "Trailer", "Dark Ambient",
          "Choral", "Fantasy"]

MOODS = ["ominous", "brooding", "grim", "fierce", "heroic", "tense", "menacing", "mournful", "solemn", "dark"]
INTENSITY = {"calm": "slow, quiet", "tension": "tense, steady", "action": "fast, loud"}
JOBS = {  # what a part does: (present, participle)
    "theme": ("plays a grim theme", "playing a grim theme"),
    "ostinato": ("drives a dark ostinato", "driving a dark ostinato"),
    "chords": ("holds long dark chords", "holding long dark chords"),
    "bass": ("plays a slow bass line", "playing a slow bass line"),
    "rhythm": ("pounds a heavy rhythm", "pounding a heavy rhythm"),
    "counter": ("answers with a counter-melody", "answering with a counter-melody"),
    "drone": ("holds a low drone", "holding a low drone"),
    "swell": ("swells and fades", "swelling and fading"),
    "texture": ("adds an eerie texture", "adding an eerie texture"),
}
ROLE_JOBS = {"melody_bowed": ["theme", "counter", "ostinato"], "melody_plucked": ["theme", "counter", "chords"],
             "drone": ["drone"], "winds": ["theme", "counter", "swell"], "percussion": ["rhythm"],
             "big_drum": ["rhythm"], "low": ["bass", "chords"], "voice": ["theme", "chords", "drone"],
             "strings": ["ostinato", "chords", "theme"], "brass": ["theme", "swell", "chords"],
             "texture": ["texture", "swell"]}
SINGULAR_S = {"double bass", "bass"}


def instruments(proj, exclude=()):
    """The project's music candidates whose role the probe knows how to write for."""
    return {k: dict(role=i["role"], tag=i["tag"], name=i["name"]) for k, i in proj.music["instruments"].items()
            if k not in exclude and i["role"] in ROLE_JOBS}


def verb(present: str, name: str) -> str:
    plural = name.endswith("s") and name not in SINGULAR_S
    if not plural:
        return present
    w = present.split(" ")
    w[0] = w[0][:-1]  # plays -> play
    if "and" in w:
        i = w.index("and") + 1
        w[i] = w[i][:-1]
    return " ".join(w)


def sample(rng: random.Random, ins: dict) -> dict:
    """One point of the factor space, and its prompt."""
    f = dict(shape=rng.choice(["tags", "guide", "paragraph", "tagsonly"]),
             genres=sorted(rng.sample(GENRES, rng.randint(1, 3))),
             n_parts=rng.randint(2, 6), mood=rng.choice(MOODS), level=rng.choice(list(INTENSITY)),
             tempo=rng.choice(["90 BPM", "BPM: 90", "none"]), key=rng.choice(["D minor", "D aeolian", "none"]),
             rec=rng.choice([True, False]), vocal_tag=rng.choice([True, False]))
    ids = rng.sample(sorted(ins), f["n_parts"])
    f["instruments"] = ids
    f["jobs"] = [rng.choice(ROLE_JOBS[ins[i]["role"]]) for i in ids]
    f["prompt"] = build(f, ins)
    f["words"] = len(f["prompt"].split())
    return f


def build(f: dict, ins: dict) -> str:
    names = [ins[i]["name"] for i in f["ids"]] if "ids" in f else [ins[i]["name"] for i in f["instruments"]]
    tags = ", ".join(dict.fromkeys(ins[i]["tag"] for i in f["instruments"]))
    head = "TrackType: Music, " + ("VocalType: Instrumental, " if f["vocal_tag"] else "")
    genre = ", ".join(f"Genre: {g}" for g in f["genres"])
    words = " ".join(g.lower() for g in f["genres"])
    mood, inten = f["mood"], INTENSITY[f["level"]]
    tempo = "" if f["tempo"] == "none" else f["tempo"]
    key = "" if f["key"] == "none" else f["key"]
    rec = "recorded live in a large hall" if f["rec"] else ""
    if f["shape"] == "tagsonly":
        extra = [f"Mood: {mood.title()}"] + ([f"BPM: 90"] if tempo else []) + ([f"Key: {key}"] if key else [])
        return head + f"{genre}, Instruments: {tags}, " + ", ".join(extra) + "."
    parts_present = [f"the {n} {verb(JOBS[j][0], n)}" for n, j in zip(names, f["jobs"])]
    parts_part = [f"{n} {JOBS[j][1]}" for n, j in zip(names, f["jobs"])]
    tail = ", ".join(x for x in (tempo, key, rec) if x)
    if f["shape"] == "tags":
        return head + f"{genre}, Instruments: {tags}. {mood.capitalize()}, {inten} {words} music: " + ", ".join(parts_present) + (f", {tail}." if tail else ".")
    if f["shape"] == "guide":
        body = ", ".join(parts_part[:-1]) + (" and " if len(parts_part) > 1 else "") + parts_part[-1]
        s = f"{mood.capitalize()} {words} score" + (f" in {key}" if key else "") + f" with {body}, creating {inten} energy."
        return head + s + (f" {rec[0].upper() + rec[1:]}." if rec else "") + (" BPM: 90." if tempo else "")
    # paragraph: the feel first, then who plays what, in sentences
    s = (f"A {mood}, {inten} {words} instrumental with the feeling of an army gathering in the dark. "
         + ". ".join(p[0].upper() + p[1:] for p in parts_present) + ". " + (f"{rec[0].upper() + rec[1:]}, " if rec else "")
         + ", ".join(x for x in (tempo, key) if x))
    return head + genre + ". " + s.rstrip(", ") + "."


def score(x: np.ndarray, path: Path) -> dict:
    from soundlab import dsp, quality

    got, wobble = dsp.tempo_of(x, BPM)
    y = dsp.normalise(x, -20.0, -2.5)
    dsp.write(path, y)
    aes = quality.aesthetics([str(path)])[0] or {}
    n, s = quality.dropouts(y)
    return dict(bpm=round(got, 1), spread=round(wobble, 1), steady=bool(abs(got / BPM - 1) <= 0.06 and wobble <= 40),
                silent=bool(dsp.silent(x)), dropouts=n, dropout_s=s, **aes)


def run(proj, minutes: float, repeat: bool, exclude) -> None:
    from soundlab.engine import Engine

    ins, eng = instruments(proj, exclude), Engine()
    RUNS, CLIPS = OUT / "runs.jsonl", OUT / "clips"
    CLIPS.mkdir(parents=True, exist_ok=True)
    n0 = sum(1 for _ in open(RUNS)) if RUNS.exists() else 0
    rng = random.Random(time.time_ns())
    fixed = [sample(random.Random(s), ins) for s in range(4)] if repeat else None
    end, i = time.time() + minutes * 60, n0
    while time.time() < end:
        f = dict(fixed[(i - n0) % len(fixed)]) if fixed else sample(rng, ins)
        seed = rng.randrange(1 << 30)
        t0 = time.time()
        x = eng.generate(f["prompt"], SECONDS, seed)
        r = dict(id=i, seed=seed, repeat=bool(fixed), gen_s=round(time.time() - t0, 2), **f)
        r.update(score(x, CLIPS / f"p{i:05d}.ogg"))
        with open(RUNS, "a") as fh:
            fh.write(json.dumps(r) + "\n")
        print(f"{i:5d} CE {r.get('CE', 0):.2f} steady {r['steady']!s:5s} {r['shape']:9s} {r['n_parts']} parts  {r['gen_s']} s", flush=True)
        i += 1


def report() -> None:
    rows = [json.loads(l) for l in open(OUT / "runs.jsonl")]
    rep = [r for r in rows if r["repeat"]]
    rows = [r for r in rows if not r["repeat"] and "CE" in r]
    print(f"{len(rows)} random prompts, {len(rep)} repeats")
    if rep:  # seed noise: the spread of one prompt over seeds
        by = {}
        for r in rep:
            by.setdefault(r["prompt"], []).append(r["CE"])
        print("seed noise (CE sd per fixed prompt):", [round(float(np.std(v)), 2) for v in by.values()],
              "means", [round(float(np.mean(v)), 2) for v in by.values()])
    ce = np.array([r["CE"] for r in rows])
    steady = np.array([r["steady"] for r in rows], float)
    print(f"CE mean {ce.mean():.2f} sd {ce.std():.2f}; steady {steady.mean():.0%}")
    # one-hot design: every factor level against its baseline, all at once (so one factor isn't credited with another's)
    cols = []
    def add(name, vals):
        for v in sorted(set(vals))[1:]:
            cols.append((f"{name}={v}", np.array([x == v for x in vals], float)))
    for k in ("shape", "mood", "level", "tempo", "key", "rec", "vocal_tag", "n_parts"):
        add(k, [r[k] for r in rows])
    allg = sorted({g for r in rows for g in r["genres"]})
    for g in allg:
        cols.append((f"genre {g}", np.array([g in r["genres"] for r in rows], float)))
    alli = sorted({i for r in rows for i in r["instruments"]})
    for i in alli:
        cols.append((f"inst {i}", np.array([i in r["instruments"] for r in rows], float)))
    allj = sorted({j for r in rows for j in r["jobs"]})
    for j in allj:
        cols.append((f"job {j}", np.array([j in r["jobs"] for r in rows], float)))
    X = np.column_stack([np.ones(len(rows))] + [c for _, c in cols])
    for target, yv in (("CE", ce), ("steady", steady)):
        lam = 2.0  # (ridge: many columns, few hundred rows)
        A = X.T @ X + lam * np.eye(X.shape[1]); A[0, 0] -= lam
        b = np.linalg.solve(A, X.T @ yv)
        res = yv - X @ b
        se = np.sqrt(np.diag(np.linalg.inv(A)) * res.var())
        eff = sorted(zip([n for n, _ in cols], b[1:], se[1:], [int(c.sum()) for _, c in cols]), key=lambda e: e[1])
        print(f"\n{target}: most harmful")
        for n, e, s, k in eff[:12]:
            print(f"  {n:28s} {e:+.2f} (±{s:.2f}, n={k})")
        print(f"{target}: most helpful")
        for n, e, s, k in eff[-12:][::-1]:
            print(f"  {n:28s} {e:+.2f} (±{s:.2f}, n={k})")
    print("\nworst 8:"); [print(f"  {r['CE']:.2f} p{r['id']:05d} {r['prompt'][:150]}") for r in sorted(rows, key=lambda r: r["CE"])[:8]]
    print("best 8:"); [print(f"  {r['CE']:.2f} p{r['id']:05d} {r['prompt'][:150]}") for r in sorted(rows, key=lambda r: -r["CE"])[:8]]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run"); p.add_argument("--minutes", type=float, default=5); p.add_argument("--repeat", action="store_true")
    p.add_argument("--exclude", nargs="*", default=[])
    sub.add_parser("report")
    a = ap.parse_args()
    from soundlab import project as pj
    proj = pj.load(a.project)
    OUT = Path(proj.work) / "probe"
    run(proj, a.minutes, a.repeat, set(a.exclude)) if a.cmd == "run" else report()

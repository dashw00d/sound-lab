"""Sound effects and loops: generate candidates in prompt variants x seeds, master them as the game masters its
files, and ship the picks.

Prompt variants per sound:
  el     the project's own prompt with its "No ..." sentences and ", no ..." clauses removed (SA3 runs at cfg 1.0,
         where a negative only adds the word)
  core   the same without the project's shared style tail (Sound.core), when it has one
  *      every variant hand-written in prompts.json ({sound: {variant: prompt}})
Identical prompts are generated once.
"""
from __future__ import annotations

import hashlib
import multiprocessing as mp
import re
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import date
from pathlib import Path

import numpy as np

from . import project as P
from .store import Store

MODEL = "stable-audio-3-medium"


def strip_negatives(text: str) -> str:
    sents = [s for s in re.split(r"(?<=\.)\s+", text) if not re.match(r"(?i)no\b", s)]
    return re.sub(r",\s*no\b[^,.]*", "", " ".join(sents)).strip()


def variants(s: P.Sound, extra: dict) -> dict[str, str]:
    cands = {"el": strip_negatives(s.prompt), "core": strip_negatives(s.core) if s.core else "", **extra.get(s.name, {})}
    out: dict[str, str] = {}
    for v, p in cands.items():
        if p and p not in out.values():
            out[v] = p
    return out


def meta(proj: P.Project, s: P.Sound) -> dict:
    shipped = s.shipped if s.shipped and s.shipped.exists() else None
    return dict(kind=s.kind, seconds=s.seconds, channels=s.channels, palette=s.palette or "plain",
                shipped=str(shipped.relative_to(proj.assets)) if shipped else None)


_proj = None


def _master_one(project_path: str, name: str, raw: np.ndarray, path: str) -> dict:
    """Score the raw take, then master and write it (in a worker process; no torch here)."""
    global _proj
    if _proj is None:
        _proj = P.load(project_path)
    from . import dsp

    s = {x.name: x for x in _proj.sounds()}[name]
    x = raw.mean(axis=1, keepdims=True) if s.channels == 1 else raw
    sc = P.score(_proj, s, x)
    if sc is None or sc == float("inf"):
        return dict(failed=True)
    y, info = P.master(_proj, s, x)
    dsp.write(Path(path), y)
    return dict(failed=False, score=sc, master=info, duration=round(len(y) / dsp.SR, 3))


def generate(proj: P.Project, seeds: int = 3, only: list[str] | None = None, only_variants: list[str] | None = None,
             workers: int = 8) -> int:
    st = Store(proj)
    sounds = {s.name: s for s in proj.sounds()}
    names = only or list(sounds)
    unknown = [n for n in names if n not in sounds]
    if unknown:
        raise SystemExit(f"unknown sounds: {unknown}")
    extra = st.prompts()
    idx = st.index()
    idx["model"] = MODEL
    for n, s in sounds.items():
        idx["sounds"][n] = meta(proj, s)
        rows = variants(s, extra)
        kept = {k: v for k, v in idx["prompts"].get(n, {}).items() if k not in rows and any(
            c["name"] == n and c["variant"] == k for c in idx["clips"].values())}  # rows other generators made
        idx["prompts"][n] = {**kept, **rows}
    jobs = []
    for n in names:
        for v, prompt in variants(sounds[n], extra).items():
            if only_variants and v not in only_variants:
                continue
            for seed in range(seeds):
                cid = f"{n}.{v}.s{seed}"
                if cid not in idx["clips"]:
                    jobs.append((cid, sounds[n], v, prompt, seed))
    print(f"{len(jobs)} takes to generate ({len(names)} sounds)", flush=True)
    st.save_index(idx)
    if not jobs:
        return 0
    from .engine import Engine

    eng = Engine()
    pool = ProcessPoolExecutor(workers, mp_context=mp.get_context("spawn"))
    pending, t_start = [], time.perf_counter()

    def collect(block: bool) -> None:
        for item in list(pending):
            fut, cid, rec = item
            if block or fut.done():
                rec.update(fut.result())
                idx["clips"][cid] = rec
                pending.remove(item)

    for i, (cid, s, v, prompt, seed) in enumerate(jobs, 1):
        raw = eng.generate(prompt, s.seconds, seed)
        rel = f"{s.name}/{v}.s{seed}{s.out.suffix}"
        rec = dict(name=s.name, variant=v, seed=seed, prompt=prompt, file=rel, gen_s=round(eng.last_s, 2))
        pending.append((pool.submit(_master_one, proj.path(), s.name, raw, str(st.clips / rel)), cid, rec))
        collect(False)
        if i % 25 == 0 or i == len(jobs):
            el = time.perf_counter() - t_start
            print(f"[{i}/{len(jobs)}] {cid}  {el:.0f}s, ~{el / i * (len(jobs) - i):.0f}s left", flush=True)
            st.save_index(idx)
    collect(True)
    pool.shutdown()
    st.save_index(idx)
    failed = sum(1 for c in idx["clips"].values() if c.get("failed"))
    print(f"done: {len(idx['clips'])} takes in the index, {failed} silent or failed", flush=True)
    return 0


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def promote(proj: P.Project, apply: bool = False, only: list[str] | None = None) -> int:
    """Ship the picks (votes.json "picks"; "shipped" keeps the current file): each picked take is installed where
    the game reads it, with provenance in promoted.json. A dry run unless `apply`."""
    st = Store(proj)
    votes, idx = st.votes(), st.index()
    sounds = {s.name: s for s in proj.sounds()}
    promoted = st.read(st.promoted_path, {})
    done = []
    for name, pick in sorted(votes["picks"].items()):
        if (only and name not in only) or pick == "shipped" or name not in sounds:
            continue
        clip = idx["clips"].get(pick)
        src = st.clips / clip["file"] if clip else None
        if not clip or not src.exists():
            print(f"  {name}: pick {pick} not found, skipped")
            continue
        s = sounds[name]
        if promoted.get(name, {}).get("sha256") == _sha(src) and s.out.exists() and _sha(s.out) == _sha(src):
            continue
        print(f"  {name}: {clip['variant']} seed {clip['seed']} -> {s.out.relative_to(proj.root)}")
        if apply:
            P.install(proj, s, src)
            promoted[name] = dict(clip=pick, model=idx.get("model", MODEL), variant=clip["variant"], seed=clip["seed"],
                                  prompt=clip["prompt"], file=str(s.out.relative_to(proj.root)), sha256=_sha(src),
                                  date=date.today().isoformat())
            done.append(s.out)
    if not apply:
        print("dry run: pass --apply to ship these")
        return 0
    st.write(st.promoted_path, promoted, sort=True)
    print(f"shipped {len(done)} sound(s); provenance in {st.promoted_path.relative_to(proj.root)}")
    return proj.after_install(done) if proj.after_install and done else 0

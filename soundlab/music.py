"""Meshed music: every track at three intensities on one beat grid, so levels crossfade at any moment and tracks
switch on any bar line; and the instrument pool it is played on.

The design comes from the project (Project.music):

  bpm, bar_beats, bars           the grid (every loop exactly `bars` bars, starting on a downbeat)
  levels                         the intensity names, quietest first; the middle one is the spine
  lufs                           {level: integrated loudness}
  profiles                       {name: {level: audio-to-audio strength}} for the non-spine levels
  contexts                       {context: [mode, mood word]};  biomes: {biome: word, "any": ""}
  instruments                    {id: {role, tag, sentence, name}}: the candidates (auditions on the Instruments page)
  provisional                    {role: id}: used until the pool has votes
  prompts(context, mode, mood, names) -> {level: prompt}   names: {role: instrument name}
  audition                       {seconds, template} (template takes {tag} and {sentence})
  manifest, out_dir              where promote writes the game's music.json and the files
  rotate_loops                   loops a track plays before the game moves on (written into the manifest)
  seed_file(path)                optional: called for each shipped file before after_install (e.g. an import stub)

How a set is made: SA3 generates the spine from an explicit prompt; its tempo is measured and corrected to the grid
(rubberband, a small factor), its first strong downbeat found, and bars+1 bars cut from there. The other levels
are derived from that spine with audio-to-audio, which keeps its timing and harmony but changes the arrangement.
Each level is looped by fading its extra bar over the head and rotated so its tracked beats sit exactly on the
grid. A take whose spine or any level has unsteady beats (or sits over a quarter-beat off the grid) is thrown out
and another seed tried. Each take draws its instruments from the pool, seeded, so a set's tracks differ in colour.
"""
from __future__ import annotations

import hashlib
import random
import shutil
from datetime import date
from pathlib import Path

import numpy as np

from . import dsp, project as P
from .dsp import SR
from .store import Store


def key_of(context: str, biome: str) -> str:
    return context if biome == "any" else f"{context}.{biome}"


# --------------------------------------------------------------------------- the instrument pool

def auditions(proj: P.Project, seeds: int = 4) -> int:
    """A solo take of every candidate instrument (sounds pool_<id>), level-matched, for the Instruments page."""
    M, st = proj.music, Store(proj)
    idx = st.index()
    if all(f"pool_{pid}.pool.s{k}" in idx["clips"] for pid in M["instruments"] for k in range(seeds)):
        print("every audition already exists; pass a larger --seeds for more", flush=True)
        return 0
    from .engine import Engine

    eng = Engine()
    au = M["audition"]
    for pid, ins in M["instruments"].items():
        name, prompt = f"pool_{pid}", au["template"].format(tag=ins["tag"], sentence=ins["sentence"])
        idx["sounds"][name] = dict(kind="pool", seconds=au["seconds"], channels=2, palette=ins["role"], shipped=None)
        idx["prompts"][name] = {"pool": prompt}
        for seed in range(seeds):
            if f"{name}.pool.s{seed}" in idx["clips"]:
                continue  # (existing takes are kept; more --seeds only adds)
            x = dsp.normalise(eng.generate(prompt, au["seconds"], seed), -18.0, -2.5)
            rel = f"{name}/pool.s{seed}.ogg"
            dsp.write(st.clips / rel, x)
            idx["clips"][f"{name}.pool.s{seed}"] = dict(name=name, variant="pool", seed=seed, prompt=prompt, file=rel,
                                                        failed=dsp.silent(x), duration=au["seconds"], gen_s=round(eng.last_s, 2))
        print(f"  {name}: {seeds} takes", flush=True)
    st.save_index(idx)
    return 0


def pool_of(proj: P.Project) -> tuple[dict[str, list[str]], bool]:
    """Role -> the pool's instruments: an instrument is in when its audition has a pick or a net thumbs-up, out
    when voted down on balance. With no pool votes, the provisional one-per-role set."""
    M, votes = proj.music, Store(proj).votes()
    score: dict[str, int] = {}
    for cid, v in votes["clips"].items():
        if cid.startswith("pool_"):
            pid = cid.split(".")[0][5:]
            score[pid] = score.get(pid, 0) + v
    picked = {n[5:] for n in votes["picks"] if n.startswith("pool_")}
    members = {p for p in M["instruments"] if (p in picked or score.get(p, 0) > 0) and score.get(p, 0) >= 0}
    if not members:
        return {r: [p] for r, p in M["provisional"].items()}, True
    roles = {r: sorted(p for p in members if M["instruments"][p]["role"] == r) for r in M["provisional"]}
    return {r: ps or [M["provisional"][r]] for r, ps in roles.items()}, False


def take_roles(pool: dict[str, list[str]], key: str, seed: int) -> dict[str, str]:
    rng = random.Random(f"{key}:{seed}")
    return {r: rng.choice(ps) for r, ps in pool.items()}


# --------------------------------------------------------------------------- generating sets

def generate(proj: P.Project, contexts: list[str], biomes: list[str], takes: int = 3, tries: int = 14) -> int:
    M, st = proj.music, Store(proj)
    bpm, bar_beats, bars = M["bpm"], M["bar_beats"], M["bars"]
    bar = 60.0 / bpm * bar_beats
    levels = M["levels"]
    spine_lv = levels[len(levels) // 2]
    beat = 60.0 / bpm
    need = (bars + 1) * bar  # the loop plus the bar faded over its head
    names = {p: i["name"] for p, i in M["instruments"].items()}

    def loop(x):
        return dsp.crossfade_loop(x, 0, int(round(bars * bar * SR)), int(round(bar * SR)))

    def level(x, lv):
        return dsp.normalise(x, M["lufs"][lv], -2.5)

    pool, provisional = pool_of(proj)
    from .engine import Engine

    eng = Engine()
    idx = st.index()
    mesh = idx.setdefault("mesh", {})
    mesh.update(bpm=bpm, bar_beats=bar_beats, bars=bars, levels=levels, provisional=provisional,
                profiles=list(M["profiles"]), pool={r: [names[p] for p in ps] for r, ps in pool.items()})
    mesh.setdefault("contexts", {})
    for ctx, biome in [(c, b) for c in contexts for b in biomes]:
        key = key_of(ctx, biome)
        mode, mood = M["contexts"][ctx]
        if M["biomes"].get(biome):
            mood = f"{mood}, {M['biomes'][biome]}"
        found, first_prompts = [], None
        for seed in range(tries):
            if len(found) == takes:
                break
            roles = take_roles(pool, key, seed)
            prompts = M["prompts"](ctx, mode, mood, {r: names[p] for r, p in roles.items()})
            first_prompts = first_prompts or prompts
            spine = eng.generate(prompts[spine_lv], need + 2 * bar + 4.0, seed)  # room to find a downbeat
            got, wobble = dsp.tempo_of(spine, bpm)
            if abs(got / bpm - 1) > 0.06 or wobble > 40:
                print(f"  {key} seed {seed}: rejected ({got:.1f} BPM, beat spread {wobble:.0f} ms)", flush=True)
                continue
            spine = dsp.ffmpeg_filter(spine, f"rubberband=tempo={bpm / got:.6f}")  # onto the grid, same pitch
            start = int(dsp.first_downbeat(spine, bpm, bar_beats) * SR)
            spine = spine[start:start + int(round(need * SR))]
            if len(spine) < int(round(need * SR)):
                print(f"  {key} seed {seed}: rejected (too short after the downbeat)", flush=True)
                continue
            after, _ = dsp.tempo_of(spine, bpm)
            tid = f"k{seed}"
            take = dict(id=tid, seed=seed, measured_bpm=round(got, 2), corrected_bpm=round(after, 2),
                        beat_spread_ms=round(wobble, 1), profiles={}, prompts=prompts,
                        instruments={r: names[p] for r, p in roles.items()})
            base = level(loop(spine), spine_lv)
            _, ref_lock = dsp.grid_phase(base, bpm)
            if ref_lock < M.get("spine_lock", 0.85):
                print(f"  {key} seed {seed}: rejected (spine beat lock {ref_lock:.2f})", flush=True)
                continue
            base, _ = dsp.snap(base, bpm)
            failed = None
            for prof, noise in M["profiles"].items():
                files = {spine_lv: f"mesh_{key}/{spine_lv}.{tid}.ogg"}
                info = {spine_lv: dict(lock=round(ref_lock, 2))}
                for lv in [l for l in levels if l != spine_lv]:
                    for attempt in range(4):
                        d = eng.generate(prompts[lv], need, 100 * seed + attempt, init=spine, noise=noise[lv])
                        d = d[:len(spine)] if len(d) >= len(spine) else np.pad(d, ((0, len(spine) - len(d)), (0, 0)))
                        y = level(loop(d), lv)
                        off, lock = dsp.grid_phase(y, bpm)
                        if lock >= M.get("min_lock", 0.8) and abs(off) <= M.get("max_snap", 0.25) * beat:
                            break
                    else:
                        failed = f"{prof} {lv}: beat lock {lock:.2f}, {off * 1000:+.0f} ms off the grid"
                        break
                    y, moved = dsp.snap(y, bpm)
                    files[lv] = f"mesh_{key}/{lv}.{prof}.{tid}.ogg"
                    info[lv] = dict(noise=noise[lv], lock=round(lock, 2), snapped_ms=round(moved * 1000, 1),
                                    attempts=attempt + 1, audio=y)
                if failed:
                    break
                take["profiles"][prof] = dict(levels=files, info=info)
            if failed:
                print(f"  {key} seed {seed}: rejected ({failed})", flush=True)
                continue
            dsp.write(st.clips / f"mesh_{key}/{spine_lv}.{tid}.ogg", base)
            for v in take["profiles"].values():  # written only once the whole take has passed
                for lv, i in v["info"].items():
                    if "audio" in i:
                        dsp.write(st.clips / v["levels"][lv], i.pop("audio"))
            print(f"  {key} {tid}: {got:.1f} -> {after:.1f} BPM, " + ", ".join(take["instruments"].values()), flush=True)
            found.append(take)
        mesh["contexts"][key] = dict(context=ctx, biome=biome, mode=mode, prompts=first_prompts, takes=found)
        st.save_index(idx)
    print("music: " + ", ".join(f"{key_of(c, b)} {len(mesh['contexts'][key_of(c, b)]['takes'])} takes"
                                for c in contexts for b in biomes)
          + (" (provisional pool)" if provisional else ""), flush=True)
    return 0


# --------------------------------------------------------------------------- shipping

def promote(proj: P.Project, apply: bool = False) -> int:
    """Ship the music: every take liked on the Music page becomes a track in rotation (votes "mesh_<key>.<take>.
    <profile>" > 0); a set with none liked ships all its takes not voted down, at its first profile that is
    "contrast" if there is one. Writes out_dir/<track>_<level>.ogg and the manifest, removes tracks no longer chosen,
    records provenance in music_promoted.json, then the project's after_install."""
    M, st = proj.music, Store(proj)
    idx, votes = st.index(), st.votes()["clips"]
    out_dir, levels = Path(M["out_dir"]), M["levels"]
    tracks, record, written = [], {}, []
    for key, c in idx.get("mesh", {}).get("contexts", {}).items():
        if not c["takes"]:
            continue
        liked = [(t, p) for t in c["takes"] for p in t["profiles"] if votes.get(f"mesh_{key}.{t['id']}.{p}", 0) > 0]
        p0 = "contrast" if "contrast" in c["takes"][0]["profiles"] else next(iter(c["takes"][0]["profiles"]))
        chosen = liked or [(t, p0) for t in c["takes"] if votes.get(f"mesh_{key}.{t['id']}.{p0}", 0) >= 0]
        for take, prof in chosen:
            tid = f"{c['context']}.{c['biome']}.{take['id']}.{prof}"
            files = {lv: out_dir / f"{tid}_{lv}.ogg" for lv in levels}
            tracks.append(dict(id=tid, context=c["context"], biome=c["biome"],
                               files={lv: proj.asset_uri(f) for lv, f in files.items()}))
            record[tid] = dict(key=key, take=take["id"], profile=prof, seed=take["seed"], voted=bool(liked),
                               prompts=take.get("prompts", c["prompts"]), instruments=take.get("instruments", {}),
                               date=date.today().isoformat(), sha256={})
            for lv in levels:
                src = st.clips / take["profiles"][prof]["levels"][lv]
                record[tid]["sha256"][lv] = hashlib.sha256(src.read_bytes()).hexdigest()
                if apply:
                    files[lv].parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(src, files[lv])
                    if M.get("seed_file"):
                        M["seed_file"](files[lv])
                    written.append(files[lv])
        print(f"  {key}: " + ", ".join(f"{t['id']} {p}" for t, p in chosen) + ("" if liked else " (none liked yet)"))
    if not apply:
        print(f"dry run: {len(tracks)} tracks; pass --apply to ship them")
        return 0
    keep = {f"{t['id']}_{lv}.ogg" for t in tracks for lv in levels}
    for f in out_dir.glob("*.ogg"):
        if f.name not in keep:  # (a track no longer chosen)
            f.unlink()
            f.with_name(f.name + ".import").unlink(missing_ok=True)
    manifest = dict(bpm=M["bpm"], bar_beats=M["bar_beats"], loop_bars=M["bars"], rotate_loops=M.get("rotate_loops", 2),
                    levels=levels, tracks=tracks)
    st.write(Path(M["manifest"]), manifest)
    st.write(st.music_promoted_path, record, sort=True)
    print(f"shipped {len(tracks)} tracks; manifest {Path(M['manifest']).relative_to(proj.root)}")
    return proj.after_install(written) if proj.after_install else 0

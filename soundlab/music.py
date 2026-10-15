"""Meshed music: every track at three intensities on one beat grid, so levels crossfade at any moment and tracks
switch on any bar line; and the instrument pool it is played on.

The design comes from the project (Project.music):

  bpm, bar_beats, bars           the grid (every loop exactly `bars` bars, starting on a downbeat)
  levels                         the intensity names, quietest first; the middle one is the spine
  lufs                           {level: integrated loudness}
  profiles                       {name: {level: audio-to-audio strength}} for the non-spine levels (0: the spine
                                 itself, so the levels can't drift apart: a stack built only by layers); a profile may
                                 add "layers": {layer: {level: gain dB}}, those layers mixed into those levels
  layers                         optional: {name: {prompt(context, mode, mood) -> str}}: stems generated from text on
                                 the grid and mixed into levels (e.g. battle drums under action), since a derived level
                                 can't add intensity. Pitch-free parts (percussion) can't clash with the harmony.
  default_profile                optional: the profile the Music page opens on, and the one a set with no liked take
                                 ships at (default: "contrast" if there is one)
  contexts                       {context: [mode, mood word]};  biomes: {biome: word, "any": ""}
  instruments                    {id: {role, tag, sentence, name, prompts?}}: the candidates (auditions on the
                                 Instruments page); `prompts` ({variant: prompt}) replaces the audition template, e.g.
                                 to compare prompt shapes or for an instrument the template can't describe (voices)
  provisional                    {role: id}: used until the pool has votes
  prompts(context, mode, mood, names) -> {level: prompt}   names: {role: instrument name}
  styles                         optional: {style: prompts function, same signature}, alternative prompt styles to
                                 compare in a tuning round. A style's sets are keyed "<context>[.<biome>]~<style>"
  audition                       {seconds, template} (template takes {tag} and {sentence})
  manifest, out_dir              where promote writes the game's music.json and the files
  rotate_loops                   loops a track plays before the game moves on (written into the manifest)
  seed_file(path)                optional: called for each shipped file before after_install (e.g. an import stub)

Each `generate` run is a round (index mesh.rounds; each set carries its round). The Music page shows only the newest
round's sets and folds everything older under "Earlier rounds" (liked sets first).

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
from datetime import date, datetime
from pathlib import Path

import numpy as np

from . import dsp, project as P, quality, tuning
from .dsp import SR
from .store import Store


def key_of(context: str, biome: str, style: str | None = None) -> str:
    return (context if biome == "any" else f"{context}.{biome}") + (f"~{style}" if style else "")


# --------------------------------------------------------------------------- the instrument pool

def auditions(proj: P.Project, seeds: int = 4) -> int:
    """A solo take of every candidate instrument (sounds pool_<id>), level-matched, for the Instruments page."""
    tuning.require("instruments")
    M, st = proj.music, Store(proj)
    idx = st.index()
    au = M["audition"]

    def prompts(ins):
        return ins.get("prompts") or {"pool": au["template"].format(tag=ins["tag"], sentence=ins["sentence"])}
    if all(f"pool_{pid}.{v}.s{k}" in idx["clips"] for pid, ins in M["instruments"].items() for v in prompts(ins)
           for k in range(seeds)):
        print("every audition already exists; pass a larger --seeds for more", flush=True)
        return 0
    from .engine import Engine

    eng = Engine()
    for pid, ins in M["instruments"].items():
        name = f"pool_{pid}"
        idx["sounds"][name] = dict(kind="pool", seconds=au["seconds"], channels=2, palette=ins["role"], shipped=None)
        idx["prompts"][name] = prompts(ins)
        made = 0
        for variant, prompt in prompts(ins).items():
            for seed in range(seeds):
                cid = f"{name}.{variant}.s{seed}"
                if cid in idx["clips"]:
                    continue  # (existing takes are kept; more --seeds only adds)
                x = dsp.normalise(eng.generate(prompt, au["seconds"], seed), -18.0, -2.5)
                rel = f"{name}/{variant}.s{seed}.ogg"
                dsp.write(st.clips / rel, x)
                idx["clips"][cid] = dict(name=name, variant=variant, seed=seed, prompt=prompt, file=rel,
                                         failed=dsp.silent(x), duration=au["seconds"], gen_s=round(eng.last_s, 2))
                made += 1
        if made:
            print(f"  {name}: {made} takes", flush=True)
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

class _Failed(Exception):
    pass


def _accents(x: np.ndarray, bpm: float, bar_beats: int) -> np.ndarray:
    """A grid-snapped loop's onset strength at each beat of the bar, averaged over its bars."""
    env, fps = dsp.onset_env(x)
    beat, acc = 60.0 / bpm, np.zeros(bar_beats)
    w = max(1, int(0.08 * fps))
    for b in range(int(len(env) / fps / beat)):
        i = int(b * beat * fps)
        acc[b % bar_beats] += env[i:i + w].max() if i < len(env) else 0
    return acc


def _layer_stem(eng, M: dict, prompt: str, seed: int, spine: np.ndarray):
    """A layer from text on the grid: tempo-corrected, cut from its first downbeat, looped, snapped to the beat,
    then rotated by whole beats so its bar accents line up with the spine's. Returns (audio, info) or (None, why)."""
    bpm, bb = M["bpm"], M["bar_beats"]
    beat = 60.0 / bpm
    bar = beat * bb
    need = (M["bars"] + 1) * bar
    why = "nothing generated"
    for attempt in range(8):
        x = eng.generate(prompt, need + 2 * bar + 4.0 + 6.0, seed + attempt)  # (room to slow down to the grid)
        if dsp.silent(x):
            why = "silent"
            continue
        got, wobble = dsp.tempo_of(x, bpm)
        # (percussion stretches cleanly, so a stem may be corrected much further than a spine: the model plays
        # "intense" drums faster than asked, e.g. 116 for 90)
        if abs(got / bpm - 1) > M.get("layer_stretch", 0.3) or wobble > 40:
            why = f"{got:.1f} BPM, beat spread {wobble:.0f} ms"
            continue
        x = dsp.ffmpeg_filter(x, f"rubberband=tempo={bpm / got:.6f}")
        start = int(dsp.first_downbeat(x, bpm, bb) * SR)
        x = x[start:start + int(round(need * SR))]
        if len(x) < int(round(need * SR)):
            why = "too short after the downbeat"
            continue
        y = dsp.normalise(dsp.crossfade_loop(x, 0, len(spine), int(round(bar * SR))), -18.0, -2.5)
        off, lock = dsp.grid_phase(y, bpm)
        if lock < M.get("min_lock", 0.8):
            why = f"beat lock {lock:.2f}"
            continue
        y, moved = dsp.snap(y, bpm)
        a, b = _accents(spine, bpm, bb), _accents(y, bpm, bb)
        k = max(range(bb), key=lambda k: float(np.dot(a - a.mean(), np.roll(b, -k) - b.mean())))
        y = np.roll(y, -k * int(round(beat * SR)), axis=0)
        return y, dict(prompt=prompt, seed=seed + attempt, measured_bpm=round(got, 2), lock=round(lock, 2),
                       beats_rotated=k, attempts=attempt + 1)
    return None, why


def _mix(x: np.ndarray, stems: list[tuple[np.ndarray, float]], lufs: float) -> np.ndarray:
    """A level with layers mixed in: each stem matched to the level's loudness, then at its gain (dB); the sum
    brought back to the level's loudness."""
    ref = dsp.loudness_stats(x)[0]
    y = x.copy()
    for stem, gain in stems:
        y = y + stem * 10 ** ((ref - dsp.loudness_stats(stem)[0] + gain) / 20)
    return dsp.normalise(y, lufs, -2.5)


def _make_profiles(eng, M: dict, st: Store, key: str, take: dict, prompts: dict, init: np.ndarray, base: np.ndarray,
                   spine: tuple[str, dict], profs: dict, mood: tuple[str, str, str]) -> dict:
    """Add `profs` to a take: each level derived from the spine (reusing a level of the same strength the take
    already has), then the profile's layers mixed in (a layer is made once per take; its stem is kept). `init`: the
    spine with the bar faded over its head (for audio-to-audio); `base`: the looped, levelled spine; `spine`: its
    (file, info). Returns {file: audio} to write once the caller accepts the take; raises _Failed."""
    levels = M["levels"]
    spine_lv = levels[len(levels) // 2]
    made = {}  # (level, strength) -> [file, info, audio]: unlayered levels
    for v in take["profiles"].values():
        for lv, i in v["info"].items():
            if lv != spine_lv and i.get("noise") is not None and not i.get("layers"):
                made.setdefault((lv, i["noise"]), [v["levels"][lv], i, None])
    writes, stems = {}, {}

    def raw(lv, cfg, prof):
        if lv == spine_lv:
            return spine[0], spine[1], base
        if cfg[lv] == 0:  # (strength 0: the spine itself at this level's loudness, so every level is the same music)
            k = (lv, 0)
            if k not in made:
                f = f"mesh_{key}/{lv}.spine.{take['id']}.ogg"
                y = dsp.normalise(base, M["lufs"][lv], -2.5)
                writes[f] = y
                made[k] = [f, dict(noise=0, lock=spine[1].get("lock")), y]
            return made[k]
        k = (lv, cfg[lv])
        if k not in made:
            y, info = _derive_level(eng, M, prompts[lv], init, take["seed"], cfg[lv], lv)
            if y is None:
                raise _Failed(f"{prof} {info}")
            f = f"mesh_{key}/{lv}.{prof}.{take['id']}.ogg"
            writes[f] = y
            made[k] = [f, info, y]
        if made[k][2] is None:
            made[k][2] = dsp.decode(st.clips / made[k][0])
        return made[k]

    def stem(name):
        if name not in stems:
            have = take.get("layers", {}).get(name)
            if have:
                stems[name] = dsp.decode(st.clips / have["file"])
            else:
                # (seeded by set, take and layer: the layer prompts don't change between sets, so a take's own seed
                # would give every set's k3 the same drums)
                lseed = int(hashlib.sha256(f"{key}:{take['id']}:{name}".encode()).hexdigest()[:6], 16)
                y, info = _layer_stem(eng, M, M["layers"][name]["prompt"](*mood), lseed, base)
                if y is None:
                    raise _Failed(f"layer {name}: {info}")
                f = f"mesh_{key}/layer.{name}.{take['id']}.ogg"
                dsp.write(st.clips / f, y)  # (a stem stands alone: kept even if the take fails later)
                take.setdefault("layers", {})[name] = dict(file=f, **info)
                stems[name] = y
        return stems[name]

    for prof, cfg in profs.items():
        files, info = {}, {}
        for lv in levels:
            f, i, y = raw(lv, cfg, prof)
            gains = {n: g[lv] for n, g in cfg.get("layers", {}).items() if g.get(lv) is not None}
            if gains:
                f = f"mesh_{key}/{lv}.{prof}.{take['id']}.ogg"
                writes[f] = _mix(y, [(stem(n), g) for n, g in gains.items()], M["lufs"][lv])
                i = {k: x for k, x in i.items()} | dict(layers=gains)
            files[lv], info[lv] = f, {k: x for k, x in i.items()}
        take["profiles"][prof] = dict(levels=files, info=info)
    return writes


def _derive_level(eng, M: dict, prompt: str, init: np.ndarray, seed: int, noise: float, lv: str):
    """One non-spine level from the spine (`init`: the spine plus the bar faded over its head), with audio-to-audio
    at `noise`; looped, levelled and snapped to the grid. Returns (audio, info), or (None, why it failed)."""
    bpm, bar = M["bpm"], 60.0 / M["bpm"] * M["bar_beats"]
    need = (M["bars"] + 1) * bar
    for attempt in range(4):
        d = eng.generate(prompt, need, 100 * seed + attempt, init=init, noise=noise)
        d = d[:len(init)] if len(d) >= len(init) else np.pad(d, ((0, len(init) - len(d)), (0, 0)))
        y = dsp.normalise(dsp.crossfade_loop(d, 0, int(round(M["bars"] * bar * SR)), int(round(bar * SR))),
                          M["lufs"][lv], -2.5)
        off, lock = dsp.grid_phase(y, bpm)
        if lock >= M.get("min_lock", 0.8) and abs(off) <= M.get("max_snap", 0.25) * 60.0 / bpm:
            y, moved = dsp.snap(y, bpm)
            return y, dict(noise=noise, lock=round(lock, 2), snapped_ms=round(moved * 1000, 1), attempts=attempt + 1)
    return None, f"{lv}: beat lock {lock:.2f}, {off * 1000:+.0f} ms off the grid"


def generate(proj: P.Project, contexts: list[str], biomes: list[str], takes: int = 3, tries: int = 14,
             styles: list[str] | None = None, profiles: list[str] | None = None) -> int:
    """Sets for every context x biome (x style, when given: the project's alternative prompt styles), each `takes`
    takes, at every profile (or only `profiles`)."""
    tuning.require("music")
    M, st = proj.music, Store(proj)
    bpm, bar_beats, bars = M["bpm"], M["bar_beats"], M["bars"]
    bar = 60.0 / bpm * bar_beats
    levels = M["levels"]
    spine_lv = levels[len(levels) // 2]
    need = (bars + 1) * bar  # the loop plus the bar faded over its head
    names = {p: i["name"] for p, i in M["instruments"].items()}

    def loop(x):
        return dsp.crossfade_loop(x, 0, int(round(bars * bar * SR)), int(round(bar * SR)))

    def level(x, lv):
        return dsp.normalise(x, M["lufs"][lv], -2.5)

    profs = {p: n for p, n in M["profiles"].items() if not profiles or p in profiles}
    pool, provisional = pool_of(proj)
    from .engine import Engine

    eng = Engine()
    idx = st.index()
    mesh = idx.setdefault("mesh", {})
    mesh.update(bpm=bpm, bar_beats=bar_beats, bars=bars, levels=levels, provisional=provisional,
                profiles=list(M["profiles"]), pool={r: [names[p] for p in ps] for r, ps in pool.items()})
    mesh.setdefault("contexts", {})
    runs = [(c, b, s) for c in contexts for b in biomes for s in (styles or [None])]
    rid = datetime.now().strftime("%Y-%m-%d %H:%M")  # a round: this run's sets (the Music page shows the newest)
    mesh.setdefault("rounds", []).append(dict(id=rid, contexts=contexts, biomes=biomes, styles=styles or [],
                                              profiles=list(profs), takes=takes))
    for ctx, biome, style in runs:
        key = key_of(ctx, biome, style)
        make = M["styles"][style] if style else M["prompts"]
        mode, mood = M["contexts"][ctx]
        if M["biomes"].get(biome):
            mood = f"{mood}, {M['biomes'][biome]}"
        found, first_prompts = [], None
        for seed in range(tries):
            if len(found) == takes:
                break
            roles = take_roles(pool, key, seed)
            prompts = make(ctx, mode, mood, {r: names[p] for r, p in roles.items()})
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
                        instruments={r: names[p] for r, p in roles.items()  # (the ones its prompts name)
                                     if any(names[p].lower() in t.lower() for t in prompts.values())})
            base = level(loop(spine), spine_lv)
            _, ref_lock = dsp.grid_phase(base, bpm)
            if ref_lock < M.get("spine_lock", 0.85):
                print(f"  {key} seed {seed}: rejected (spine beat lock {ref_lock:.2f})", flush=True)
                continue
            base, _ = dsp.snap(base, bpm)
            spine_file = f"mesh_{key}/{spine_lv}.{tid}.ogg"
            try:
                writes = _make_profiles(eng, M, st, key, take, prompts, spine, base,
                                        (spine_file, dict(lock=round(ref_lock, 2))), profs, (ctx, mode, mood))
            except _Failed as e:
                print(f"  {key} seed {seed}: rejected ({e})", flush=True)
                continue
            dsp.write(st.clips / spine_file, base)
            for f, y in writes.items():  # written only once the whole take has passed
                dsp.write(st.clips / f, y)
            first = next(iter(take["profiles"].values()))["levels"]
            why = quality.gate({lv: str(st.clips / f) for lv, f in first.items()}) if M.get("quality_gate", True) else None
            if why:  # (rated as off-sounding: another seed instead)
                print(f"  {key} seed {seed}: rejected ({why})", flush=True)
                for f in {spine_file, *writes}:
                    (st.clips / f).unlink(missing_ok=True)
                continue
            print(f"  {key} {tid}: {got:.1f} -> {after:.1f} BPM, " + ", ".join(take["instruments"].values()), flush=True)
            found.append(take)
        mesh["contexts"][key] = dict(context=ctx, biome=biome, mode=mode, prompts=first_prompts, takes=found, round=rid,
                                     **({"style": style} if style else {}))
        st.save_index(idx)
    print("music: " + ", ".join(f"{key_of(c, b, s)} {len(mesh['contexts'][key_of(c, b, s)]['takes'])} takes"
                                for c, b, s in runs)
          + (" (provisional pool)" if provisional else ""), flush=True)
    return 0


def derive(proj: P.Project, profiles: list[str], keys: list[str] | None = None) -> int:
    """Add profiles to existing takes (the newest round's sets, or `keys`), from each take's saved spine: other
    audio-to-audio strengths, or layers mixed in. A level of a strength the take already has is reused, and a layer
    is made once per take. Existing profiles and votes are untouched."""
    tuning.require("music")
    M, st = proj.music, Store(proj)
    idx = st.index()
    mesh = idx.get("mesh", {})
    sets = mesh.get("contexts", {})
    newest = max((c.get("round", "") for c in sets.values()), default="")
    keys = keys or [k for k, c in sets.items() if c.get("round", "") == newest]
    spine_lv = M["levels"][len(M["levels"]) // 2]
    bar = 60.0 / M["bpm"] * M["bar_beats"]
    from .engine import Engine

    eng = Engine()
    for key in keys:
        c = sets[key]
        mood = M["contexts"][c["context"]][1] + (f", {M['biomes'][c['biome']]}" if M["biomes"].get(c["biome"]) else "")
        for take in c["takes"]:
            todo = [p for p in profiles if p not in take["profiles"]]
            if not todo:
                continue
            first = next(iter(take["profiles"].values()))
            spine = (first["levels"][spine_lv], first["info"][spine_lv])
            base = dsp.decode(st.clips / spine[0])
            init = np.concatenate([base, base[:int(round(bar * SR))]])  # (the loop is seamless: its head again)
            for prof in todo:
                try:
                    writes = _make_profiles(eng, M, st, key, take, take.get("prompts") or c["prompts"], init, base,
                                            spine, {prof: M["profiles"][prof]}, (c["context"], c["mode"], mood))
                except _Failed as e:
                    take["profiles"].pop(prof, None)
                    print(f"  {key} {take['id']} {prof}: failed ({e})", flush=True)
                    continue
                for f, y in writes.items():
                    dsp.write(st.clips / f, y)
                print(f"  {key} {take['id']}: + {prof}", flush=True)
            st.save_index(idx)
    mesh["profiles"] = list(dict.fromkeys(mesh.get("profiles", []) + list(M["profiles"])))
    st.save_index(idx)
    return 0


def check(proj: P.Project, keys: list[str] | None = None) -> int:
    """Measure every level file of every take (or the sets `keys`) for what sounds off (quality.py): dropouts, sudden
    changes, drift from the spine, leaving the key, noise; and their Audiobox Aesthetics scores. Written into each
    take's "quality" ({file: report}); the Music page flags them."""
    from . import quality

    M, st = proj.music, Store(proj)
    idx = st.index()
    sets = idx.get("mesh", {}).get("contexts", {})
    spine_lv = M["levels"][len(M["levels"]) // 2]
    todo = []
    for key in keys or list(sets):
        c = sets[key]
        for take in c["takes"]:
            q = take.setdefault("quality", {})
            files = {f for v in take["profiles"].values() for f in v["levels"].values()}
            spine_file = next(iter(take["profiles"].values()))["levels"][spine_lv]
            if all(f in q for f in files):
                continue
            ref = None
            for f in [spine_file] + sorted(files - {spine_file}):
                if f in q and f != spine_file:
                    continue
                rep, feats = quality.assess(dsp.decode(st.clips / f), M, c["mode"], None if f == spine_file else ref)
                if f == spine_file:
                    ref = feats
                q[f] = rep
                todo.append((take, f))
        st.save_index(idx)
    for (take, f), aes in zip(todo, quality.aesthetics([str(st.clips / f) for _, f in todo])):
        if aes:
            take["quality"][f]["aes"] = aes
    flagged = 0
    for c in sets.values():  # (flags again for every report: the thresholds may have moved)
        for take in c["takes"]:
            for q in take.get("quality", {}).values():
                q["flags"] = quality.flags(q)
                flagged += bool(q["flags"])
    st.save_index(idx)
    print(f"checked {len(todo)} level files; {flagged} level files flagged")
    return 0


def add(proj: P.Project, takes: list[str], apply: bool = False) -> int:
    """Ship chosen takes ("<set>.<take>.<profile>", e.g. night~trailer.k2.close) into rotation beside what has
    already shipped: the manifest's other tracks stay as they are and nothing is removed. For locking in a keeper
    while the rest of a round is undecided."""
    M, st = proj.music, Store(proj)
    sets = st.index().get("mesh", {}).get("contexts", {})
    out_dir, levels = Path(M["out_dir"]), M["levels"]
    manifest = Store.read(Path(M["manifest"]), {}) or dict(bpm=M["bpm"], bar_beats=M["bar_beats"], loop_bars=M["bars"],
                                                           rotate_loops=M.get("rotate_loops", 2), levels=levels, tracks=[])
    record, written = Store.read(st.music_promoted_path, {}), []
    for name in takes:
        key, tk, prof = name.rsplit(".", 2)
        c = sets.get(key)
        take = next((t for t in (c or {}).get("takes", []) if t["id"] == tk), None)
        if not take or prof not in take["profiles"]:
            raise SystemExit(f"no take {name} (a set key, a take id and one of its profiles)")
        tid = ".".join(x for x in (c["context"], c["biome"], c.get("style"), tk, prof) if x)
        files = {lv: out_dir / f"{tid}_{lv}.ogg" for lv in levels}
        known = any(t["id"] == tid for t in manifest["tracks"])
        print(f"  {name} -> {tid} ({c['context']}, {c['biome']})" + (": already shipped, refreshing its files" if known else ""))
        if not known:
            manifest["tracks"].append(dict(id=tid, context=c["context"], biome=c["biome"],
                                           files={lv: proj.asset_uri(f) for lv, f in files.items()}))
        record[tid] = dict(key=key, take=tk, profile=prof, seed=take["seed"], voted=True, added=True,
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
    ctxs = {sets[n.rsplit(".", 2)[0]]["context"] for n in takes}
    print("  rotation then: " + ", ".join(f"{x} {sum(t['context'] == x for t in manifest['tracks'])} tracks" for x in sorted(ctxs)))
    if not apply:
        print("dry run: pass --apply to ship")
        return 0
    st.write(Path(M["manifest"]), manifest)
    st.write(st.music_promoted_path, record, sort=True)
    print(f"added {len(takes)}; manifest {Path(M['manifest']).relative_to(proj.root)} has {len(manifest['tracks'])} tracks")
    return proj.after_install(written) if proj.after_install else 0


def promote(proj: P.Project, apply: bool = False) -> int:
    """Ship the music: every take liked on the Music page becomes a track in rotation (votes "mesh_<key>.<take>.
    <profile>" > 0), whatever its style; a context and biome with none liked in any style ships all its plain
    (unstyled) set's takes not voted down, at the default profile (else "contrast" if there is one, else the first). Writes out_dir/<track>_<level>.ogg and the manifest, removes tracks no longer chosen,
    records provenance in music_promoted.json, then the project's after_install."""
    M, st = proj.music, Store(proj)
    idx, votes = st.index(), st.votes()["clips"]
    out_dir, levels = Path(M["out_dir"]), M["levels"]
    tracks, record, written = [], {}, []
    sets = idx.get("mesh", {}).get("contexts", {})
    liked = {key: [(t, p) for t in c["takes"] for p in t["profiles"] if votes.get(f"mesh_{key}.{t['id']}.{p}", 0) > 0]
             for key, c in sets.items()}
    any_liked = {(c["context"], c["biome"]) for key, c in sets.items() if liked[key]}
    for key, c in sets.items():
        if not c["takes"] or (not liked[key] and (c.get("style") or (c["context"], c["biome"]) in any_liked)):
            continue
        ps = c["takes"][0]["profiles"]
        p0 = next(p for p in (M.get("default_profile"), "contrast", next(iter(ps))) if p in ps)
        chosen = liked[key] or [(t, p0) for t in c["takes"] if votes.get(f"mesh_{key}.{t['id']}.{p0}", 0) >= 0]
        for take, prof in chosen:
            tid = ".".join(x for x in (c["context"], c["biome"], c.get("style"), take["id"], prof) if x)
            files = {lv: out_dir / f"{tid}_{lv}.ogg" for lv in levels}
            tracks.append(dict(id=tid, context=c["context"], biome=c["biome"],
                               files={lv: proj.asset_uri(f) for lv, f in files.items()}))
            record[tid] = dict(key=key, take=take["id"], profile=prof, seed=take["seed"], voted=bool(liked[key]),
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
        print(f"  {key}: " + ", ".join(f"{t['id']} {p}" for t, p in chosen) + ("" if liked[key] else " (none liked yet)"))
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

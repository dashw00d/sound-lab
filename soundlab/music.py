"""Meshed music: every track at three intensities on one beat grid, so levels crossfade at any moment and tracks
switch on any bar line; and the instrument pool it is played on.

The design comes from the project (Project.music):

  bpm, bar_beats, bars           the grid (every loop exactly `bars` bars, starting on a downbeat)
  levels                         the intensity names, quietest first
  spine                          optional: the level the spine is (default: the middle one); every other level is
                                 made from it, so adding a level later keeps the spine where it was
  lufs                           {level: integrated loudness}
  profiles                       {name: {level: audio-to-audio strength}} for the non-spine levels (0: the spine
                                 itself, so the levels can't drift apart: a stack built only by layers); a profile may
                                 add "layers": {layer: {level: gain dB}}, those layers mixed into those levels; a
                                 level's strength may name another level instead, to reuse that level's audio (e.g.
                                 a louder level that is the action level with the drums pushed: "battle": "action")
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
  groups                         optional: {file, default}: song groups. Then promote ships every liked take (and
                                 only those), and keeps `file` (the game's, hand-edited: {"tracks": {track id:
                                 group}, ...}) current by adding each new track at the `default` group; it never
                                 changes a track already in it
  seed_file(path)                optional: called for each shipped file before after_install (e.g. an import stub)

Each `generate` run is a round (index mesh.rounds), and `--takes` counts the takes of that run. Each take carries its
round, and a set keeps the takes of every run: nothing is deleted. The Music page shows only the newest round's takes (a
batch to listen to, vote on and talk over), and folds everything older away, voted on or not: other sets under "Earlier
rounds", a set's older takes under "Earlier takes". Votes and notes stay with their takes. Shipping ships what is liked
in any round, and for a set with nothing liked, only its newest batch.

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


LEAD_IN, TAIL = 4, 6  # (bars of each generated spine left out before and after its loop: the opening and the ending)

def spine_level(M: dict) -> str:
    return M.get("spine") or M["levels"][len(M["levels"]) // 2]


class _LazyEngine:
    """The generator, loaded only when something needs it (mixing layers into levels doesn't)."""
    def __init__(self):
        self._eng = None

    def __getattr__(self, name):
        if self._eng is None:
            from .engine import Engine
            self._eng = Engine()
        return getattr(self._eng, name)


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


def sa3_seed(key: str, seed: int) -> int:
    """The seed SA3 gets for a set's take: its take number offset by the set's own range (from its key), so the same
    take number in another context is another piece (2026-10-21: with the take number itself as the seed, a style's
    takes came out as near-copies across contexts: siblings 0.82 alike bar for bar, against 0.63 for any two songs).
    Takes made before keep their seed (take["sa3_seed"] absent: the take number)."""
    return int(hashlib.sha256(key.encode()).hexdigest()[:5], 16) * 1000 + seed


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
                   spine: tuple[str, dict], profs: dict, mood: tuple[str, str, str], new_layers: bool = True) -> dict:
    """Add `profs` to a take: each level derived from the spine (reusing a level of the same strength the take
    already has), then the profile's layers mixed in (a layer is made once per take; its stem is kept). `init`: the
    spine with the bar faded over its head (for audio-to-audio); `base`: the looped, levelled spine; `spine`: its
    (file, info). A profile the take already has keeps its levels; only the levels it lacks are made (a level added
    to the project later). With `new_layers` off, a layer the take has no stem for is left out of the mix (noted in
    the level's info as "missing") rather than generated. Returns {file: audio} to write once the caller accepts the
    take; raises _Failed."""
    levels = M["levels"]
    spine_lv = spine_level(M)
    made = {}  # (level, strength) -> [file, info, audio]: unlayered levels
    for v in take["profiles"].values():
        for lv, i in v["info"].items():
            if lv != spine_lv and i.get("noise") is not None and not i.get("layers"):
                made.setdefault((lv, i["noise"]), [v["levels"][lv], i, None])
    writes, stems = {}, {}

    def raw(lv, cfg, prof):
        if isinstance(cfg[lv], str):  # (another level's audio, before its layers)
            return raw(cfg[lv], cfg, prof)
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
            y, info = _derive_level(eng, M, prompts[lv], init, take.get("sa3_seed", take["seed"]), cfg[lv], lv)
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
            elif not new_layers:
                stems[name] = None
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
        old = take["profiles"].get(prof, {})
        files, info = dict(old.get("levels", {})), dict(old.get("info", {}))
        for lv in levels:
            if lv in files:
                continue
            f, i, y = raw(lv, cfg, prof)
            gains = {n: g[lv] for n, g in cfg.get("layers", {}).items() if g.get(lv) is not None}
            if gains or isinstance(cfg[lv], str):
                have = {n: g for n, g in gains.items() if stem(n) is not None}
                f = f"mesh_{key}/{lv}.{prof}.{take['id']}.ogg"
                writes[f] = _mix(y, [(stem(n), g) for n, g in have.items()], M["lufs"][lv])
                i = {k: x for k, x in i.items()} | dict(layers=have)
                if len(have) < len(gains):
                    i["missing"] = sorted(set(gains) - set(have))
            files[lv], info[lv] = f, {k: x for k, x in i.items()}
        take["profiles"][prof] = dict(levels={lv: files[lv] for lv in levels}, info={lv: info[lv] for lv in levels})
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


def newest_round(mesh: dict) -> str:
    """The latest run's round id (the batch being listened to)."""
    rounds = mesh.get("rounds") or []
    return rounds[-1]["id"] if rounds else max((c.get("round", "") for c in mesh.get("contexts", {}).values()), default="")


def current_takes(c: dict) -> list[dict]:
    """A set's newest batch: the takes of the round it was last generated in."""
    return [t for t in c["takes"] if t.get("round", c.get("round", "")) == c.get("round", "")]


def generate(proj: P.Project, contexts: list[str], biomes: list[str], takes: int = 3, tries: int = 14,
             styles: list[str] | None = None, profiles: list[str] | None = None) -> int:
    """Sets for every context x biome (x style, when given: the project's alternative prompt styles): a new batch of
    `takes` takes each, at every profile (or only `profiles`). Earlier takes of a set stay, but are no longer the batch."""
    tuning.require("music")
    M, st = proj.music, Store(proj)
    bpm, bar_beats, bars = M["bpm"], M["bar_beats"], M["bars"]
    bar = 60.0 / bpm * bar_beats
    levels = M["levels"]
    spine_lv = spine_level(M)
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
    now = datetime.now()
    rid = now.strftime("%Y-%m-%d %H:%M")  # a round: this run's takes (the Music page shows the newest batch)
    if any(r["id"] == rid for r in mesh.get("rounds", [])):  # (a second run in the same minute is still its own batch)
        rid = now.strftime("%Y-%m-%d %H:%M:%S")
    mesh.setdefault("rounds", []).append(dict(id=rid, contexts=contexts, biomes=biomes, styles=styles or [],
                                              profiles=list(profs), takes=takes))
    for ctx, biome, style in runs:
        key = key_of(ctx, biome, style)
        make = M["styles"][style] if style else M["prompts"]
        mode, mood = M["contexts"][ctx]
        if M["biomes"].get(biome):
            mood = f"{mood}, {M['biomes'][biome]}"
        old = mesh["contexts"].get(key) or {}
        # Regenerating a key never reuses a take id: votes (mesh_<key>.<id>.<profile>) and the page's "seen" markers
        # are keyed by it, and a take's files are named by it. Seeds (and so ids) continue after the highest this
        # key has used. The earlier takes stay (hidden on the page once this batch exists), tagged with their round.
        first_seed = max([old.get("next_seed", 0)] + [int(t["id"][1:]) + 1 for t in old.get("takes", [])
                                                      if t["id"][1:].isdigit()])
        found, first_prompts = [], None
        for seed in range(first_seed, first_seed + tries):
            if len(found) == takes:
                break
            roles = take_roles(pool, key, seed)
            prompts = make(ctx, mode, mood, {r: names[p] for r, p in roles.items()})
            first_prompts = first_prompts or prompts
            # The loop is cut from the middle of a longer piece: SA3 writes each take as a whole piece, opening and
            # heading for an ending (a late crescendo, "weird stuff toward the end", the designer 2026-10-15), so the
            # loop starts LEAD_IN bars after the first downbeat and stops TAIL bars before the end.
            spine = eng.generate(prompts[spine_lv], need + (LEAD_IN + TAIL) * bar + 4.0, sa3_seed(key, seed))
            got, wobble = dsp.tempo_of(spine, bpm)
            if abs(got / bpm - 1) > 0.06 or wobble > 40:
                print(f"  {key} seed {seed}: rejected ({got:.1f} BPM, beat spread {wobble:.0f} ms)", flush=True)
                continue
            spine = dsp.ffmpeg_filter(spine, f"rubberband=tempo={bpm / got:.6f}")  # onto the grid, same pitch
            start = int((dsp.first_downbeat(spine, bpm, bar_beats) + LEAD_IN * bar) * SR)
            spine = spine[start:start + int(round(need * SR))]
            if len(spine) < int(round(need * SR)):
                print(f"  {key} seed {seed}: rejected (too short after the downbeat)", flush=True)
                continue
            after, _ = dsp.tempo_of(spine, bpm)
            tid = f"k{seed}"
            take = dict(id=tid, seed=seed, sa3_seed=sa3_seed(key, seed), round=rid, measured_bpm=round(got, 2), corrected_bpm=round(after, 2),
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
        for t in old.get("takes", []):  # (takes made before takes carried their round: the set's)
            t.setdefault("round", old.get("round", ""))
        if not found and old.get("takes"):
            print(f"  {key}: no new takes passed; the set keeps its earlier takes", flush=True)
        mesh["contexts"][key] = dict(context=ctx, biome=biome, mode=mode, prompts=first_prompts or old.get("prompts"),
                                     takes=found + old.get("takes", []),  # (the newest batch first)
                                     round=rid if found or not old.get("takes") else old.get("round", ""),
                                     next_seed=first_seed + tries, **({"style": style} if style else {}))
        st.save_index(idx)
    print("music: " + ", ".join(f"{key_of(c, b, s)} {len([t for t in mesh['contexts'][key_of(c, b, s)]['takes'] if t.get('round') == rid])} new takes"
                                for c, b, s in runs)
          + (" (provisional pool)" if provisional else ""), flush=True)
    return 0


def derive(proj: P.Project, profiles: list[str], keys: list[str] | None = None, liked: bool = False,
           new_layers: bool = True) -> int:
    """Add profiles to existing takes (the newest round's takes, every take of the sets `keys`, or with `liked` every
    take liked at that profile), from each take's saved spine: other audio-to-audio strengths, or layers mixed in. A
    profile a take already has gets only the levels it lacks (a level added to the project later). A level of a
    strength the take already has is reused, and a layer is made once per take (with `new_layers` off, a layer the
    take has no stem for is left out instead). Existing levels and votes are untouched. The generator is loaded only
    if something needs it."""
    tuning.require("music")
    M, st = proj.music, Store(proj)
    idx = st.index()
    mesh = idx.get("mesh", {})
    sets = mesh.get("contexts", {})
    newest = newest_round(mesh)
    votes = Store(proj).votes()["clips"] if liked else {}
    only = None if keys or liked else newest  # (named sets: all their takes; by default the newest batch)
    keys = keys or (list(sets) if liked else [k for k, c in sets.items() if c.get("round", "") == newest])
    spine_lv = spine_level(M)
    bar = 60.0 / M["bpm"] * M["bar_beats"]
    eng = _LazyEngine()
    for key in keys:
        c = sets[key]
        mood = M["contexts"][c["context"]][1] + (f", {M['biomes'][c['biome']]}" if M["biomes"].get(c["biome"]) else "")
        for take in c["takes"]:
            if only and take.get("round", c.get("round", "")) != only:
                continue
            todo = [p for p in profiles if (p not in take["profiles"]
                                            or any(lv not in take["profiles"][p]["levels"] for lv in M["levels"]))
                    and (not liked or votes.get(f"mesh_{key}.{take['id']}.{p}", 0) > 0)]
            if not todo:
                continue
            first = next(iter(take["profiles"].values()))
            spine = (first["levels"][spine_lv], first["info"][spine_lv])
            base = dsp.decode(st.clips / spine[0])
            init = np.concatenate([base, base[:int(round(bar * SR))]])  # (the loop is seamless: its head again)
            for prof in todo:
                try:
                    writes = _make_profiles(eng, M, st, key, take, take.get("prompts") or c["prompts"], init, base,
                                            spine, {prof: M["profiles"][prof]}, (c["context"], c["mode"], mood), new_layers)
                except _Failed as e:
                    if not any(lv in take["profiles"].get(prof, {}).get("levels", {}) for lv in M["levels"]):
                        take["profiles"].pop(prof, None)
                    print(f"  {key} {take['id']} {prof}: failed ({e})", flush=True)
                    continue
                for f, y in writes.items():
                    dsp.write(st.clips / f, y)
                gaps = {lv: i["missing"] for lv, i in take["profiles"][prof]["info"].items() if i.get("missing")}
                print(f"  {key} {take['id']}: + {prof}" + (f" (no stem for {gaps})" if gaps else ""), flush=True)
            st.save_index(idx)
    mesh["profiles"] = list(dict.fromkeys(mesh.get("profiles", []) + list(M["profiles"])))
    mesh["levels"] = M["levels"]
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
    spine_lv = spine_level(M)
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


def add(proj: P.Project, takes: list[str], apply: bool = False, replace: bool = False) -> int:
    """Ship chosen takes ("<set>.<take>.<profile>", e.g. night~trailer.k2.close) into rotation beside what has
    already shipped: the manifest's other tracks stay as they are and nothing is removed. For locking in keepers
    while the rest of a round is undecided. With `replace`, the chosen takes become the whole rotation of each
    context and biome they're for (its other tracks are removed); other contexts are untouched."""
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
    removed = []
    if replace:
        chosen = {".".join(x for x in (sets[k]["context"], sets[k]["biome"], sets[k].get("style"), tk, pr) if x)
                  for k, tk, pr in (n.rsplit(".", 2) for n in takes)}
        touched = {(sets[n.rsplit(".", 2)[0]]["context"], sets[n.rsplit(".", 2)[0]]["biome"]) for n in takes}
        removed = [t for t in manifest["tracks"] if (t["context"], t.get("biome", "any")) in touched and t["id"] not in chosen]
        manifest["tracks"] = [t for t in manifest["tracks"] if t not in removed]
        for t in removed:
            print(f"  - {t['id']} ({t['context']}, {t.get('biome', 'any')}): leaves the rotation")
    ctxs = {sets[n.rsplit(".", 2)[0]]["context"] for n in takes}
    print("  rotation then: " + ", ".join(f"{x} {sum(t['context'] == x for t in manifest['tracks'])} tracks" for x in sorted(ctxs)))
    if not apply:
        print("dry run: pass --apply to ship")
        return 0
    out_dir = Path(M["out_dir"])
    for t in removed:  # (its files go too; they stay in git history)
        for lv in levels:
            f = out_dir / f"{t['id']}_{lv}.ogg"
            f.unlink(missing_ok=True)
            f.with_name(f.name + ".import").unlink(missing_ok=True)
        record.pop(t["id"], None)
    st.write(Path(M["manifest"]), manifest)
    st.write(st.music_promoted_path, record, sort=True)
    print(f"added {len(takes)}, removed {len(removed)}; manifest {Path(M['manifest']).relative_to(proj.root)} has {len(manifest['tracks'])} tracks")
    return proj.after_install(written) if proj.after_install else 0


def library(proj: P.Project) -> dict:
    """Every track the game ships (its music manifest), for the Songs page: each one's level files (relative to the
    project's assets, served at /shipped/), its provenance (music_promoted.json: set, take, profile, prompts,
    instruments, date) and its song group (the game's groups file). Reads only what's shipped: no work index needed."""
    M, st = proj.music, Store(proj)
    man = Store.read(Path(M["manifest"]), {})
    prov = Store.read(st.music_promoted_path, {})
    G = M.get("groups")
    grouped = Store.read(Path(G["file"]), {}) if G else {}
    in_group = grouped.get("tracks", {})
    out_dir, assets = Path(M["out_dir"]), Path(proj.assets).resolve()
    levels = man.get("levels", M["levels"])
    measured = Store.read(proj.work / "songs.json", {})  # (music trims: per-bar loudness and the guessed cues)
    tracks = []
    for t in man.get("tracks", []):
        p = prov.get(t["id"], {})
        files = {}
        for lv in levels:
            f = (out_dir / f"{t['id']}_{lv}.ogg").resolve()
            if f.is_file() and f.is_relative_to(assets):
                files[lv] = f.relative_to(assets).as_posix()
        tracks.append(dict(id=t["id"], context=t.get("context"), biome=t.get("biome", "any"), key=p.get("key"),
                           take=p.get("take"), profile=p.get("profile"), date=p.get("date"),
                           instruments=p.get("instruments", {}), prompts=p.get("prompts", {}),
                           group=in_group.get(t["id"], G["default"] if G else None), files=files))
        m = measured.get(t["id"])
        if m and all((Path(proj.assets) / files.get(lv, "")).is_file() and
                     f"{(Path(proj.assets) / files[lv]).stat().st_size}:{(Path(proj.assets) / files[lv]).stat().st_mtime_ns}" == sg
                     for lv, sg in m["sig"].items()):  # (only while it describes the files shipped now)
            tracks[-1]["measure"] = dict(loud=m["loud"], cuts=m["cuts"], step=m["step"], feat=m.get("feat"),
                                         tuning=m.get("tuning"), phrase=m.get("phrase"), beats=m.get("beats"), onset=m.get("onset"))
            if m.get("family"):
                tracks[-1]["family"] = m["family"]
    stem_index = Store.read(proj.work / "stems.json", {})  # (music stems: the Mixer's variation over repeats)
    fill_index = Store.read(proj.work / "fills.json", {})  # (music fills: generated fills at each loop point)
    for t in tracks:
        if t["id"] in stem_index:
            t["stems"] = stem_index[t["id"]]["files"]
        if t["id"] in fill_index:
            t["fills"] = {k: [dict(file=f["file"], bars=f["bars"], seed=f["seed"], beats=f.get("beats")) for f in v] for k, v in fill_index[t["id"]].items()
                          if not k.endswith(".tried") and v}
    glue_index = Store.read(proj.work / "glues.json", {})  # (music glues: a mellow pad per family, for the Mixer)
    of = {tid: g for g in glue_index.values() for tid in g["members"]}
    for t in tracks:
        if t["id"] in of:
            t["glue"] = of[t["id"]]["id"]
    # music retune: a track off the common pitch has retuned copies of what the Mixer plays (its levels, stems, fills,
    # glue) under work/clips/tuned; the Mixer plays those (t["src"]: the URL of each level), the Songs page the shipped files
    tuned = Store.read(proj.work / "tuned.json", {})
    retuned = lambda rel: f"tuned/{rel}" if rel in tuned.get("files", {}) else rel
    for t in tracks:
        t["src"] = {lv: ("/clips/" + retuned(f"shipped/{f}") if f"shipped/{f}" in tuned.get("files", {}) else "/shipped/" + f) for lv, f in t["files"].items()}
        if t["id"] in tuned.get("shift", {}):
            t["shift"] = tuned["shift"][t["id"]]
        if "stems" in t:
            t["stems"] = {k: retuned(v) for k, v in t["stems"].items()}
        if "fills" in t:
            t["fills"] = {k: [dict(f, file=retuned(f["file"])) for f in v] for k, v in t["fills"].items()}
    glue_out = {k: {x: g[x] for x in ("id", "members", "source", "bars", "tonic", "file")} for k, g in glue_index.items()}
    for g in glue_out.values():
        g["file"] = retuned(g["file"])
    return dict(glues=glue_out, pitch=tuned.get("reference"), join_model=Store.read(proj.work / "join_model.json", None),
                bpm=man.get("bpm", M["bpm"]), bar_beats=man.get("bar_beats", M["bar_beats"]),
                bars=man.get("loop_bars", M["bars"]), levels=levels, tracks=tracks,
                groups={k: dict(name=v.get("name", k), about=v.get("about", "")) for k, v in grouped.get("groups", {}).items()})


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


def _tuning(x: np.ndarray) -> float:
    """How far the music sits from A440, in cents (librosa's estimate, a third of a semitone's resolution)."""
    import librosa

    y = librosa.resample(x.mean(axis=1).astype(np.float32), orig_sr=SR, target_sr=22050)
    return round(100 * float(librosa.estimate_tuning(y=y, sr=22050, bins_per_octave=36)), 1)


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


TRIM_REGION, TRIM_LENGTHS, TRIM_KEEP = (2, 12), (8, 10), 4  # (bars a mellow loop may use; its lengths; cuts offered)


def trims(proj: P.Project, force: bool = False) -> int:
    """Measure every shipped track for the Songs page's trimmed mellows (work/songs.json): the loudness of each bar of
    its calm and battle levels, and the best mellow loops cut from its middle. SA3 builds across a piece, so a loop's
    last bars (13-16 of 16) are its crescendo and its first bar still carries it (2026-10-20: over 98 tracks, bars 13-16
    +1.6 to +1.8 dB over the loop's mean, bar 1 +0.4, bars 2-4 -3.6 to -2.5); the steady middle loops on its own as the
    mellow, the crescendo leads into intense and bar 1 tapers back. A cut bars s..e (1-based, inside TRIM_REGION) jumps
    from bar e back to bar s, so it is scored by how alike bar s is to the bar that really follows e (cosine of the bars'
    beat chroma and MFCC, as quality.repeat): a natural bar-to-bar step in this music is ~0.78 (median), its roughest
    tenth under 0.5. Kept per track with the files' size and time, so only changed files are measured again."""
    from . import quality

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
            if "tuning" not in out[t["id"]]:
                out[t["id"]]["tuning"] = _tuning(dsp.decode(files["calm"]))
            if "beats" not in out[t["id"]]:
                out[t["id"]]["beats"] = {lv: _beats(dsp.decode(f), bar // M["bar_beats"]) for lv, f in files.items()}
            if "onset" not in out[t["id"]]:
                out[t["id"]]["onset"] = _onsets(dsp.decode(files["calm"]), M["bpm"])
            out[t["id"]]["phrase"] = _phrase(np.array(out[t["id"]]["feat"]))
            continue
        rec = dict(sig=sig, loud={}, cuts={}, step={})
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
            lo, hi = TRIM_REGION
            cuts = []
            for length in TRIM_LENGTHS:
                for s in range(lo, hi - length + 2):
                    e = s + length - 1
                    if e >= nb:  # (bar e + 1 must exist to judge the jump)
                        continue
                    seam = float(sim[s - 1, e])  # (0-based: bar s against the bar after e)
                    cuts.append(dict(bars=[s, e], seam=round(seam, 3), score=round(seam + 0.01 * (length - 8), 3)))
            cuts.sort(key=lambda c: -c["score"])
            rec["cuts"][lv] = cuts[:TRIM_KEEP]
            rec["step"][lv] = round(float(np.median([sim[k, k + 1] for k in range(nb - 1)])), 3)  # (this level's own bar-to-bar step)
            if lv == "calm":  # (the bars' fingerprints, to find the songs in step with this one: families)
                rec["feat"] = np.round(B.T[:M["bars"]], 3).tolist()
                rec["tuning"] = _tuning(x)
                rec["onset"] = _onsets(x, M["bpm"])
                rec["phrase"] = _phrase(np.array(rec["feat"]))
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


def stems(proj: P.Project, force: bool = False) -> int:
    """Stems of every shipped track, for the Mixer's variation over repeats (2026-10-21): Demucs (htdemucs) splits the
    calm level into drums, bass and the rest ("other": melody and harmony together, with vocals folded in), and the
    battle level into its drums (the pulse a repeat can bring into the mellow). On our takes Demucs gives a clean bed
    and drum layer, not a melody (MODELS_LOG, 2026-10-15). work/clips/stems/<track>/<level>.<stem>.ogg, listed in
    work/stems.json; only tracks whose files changed are split again. Demucs runs in its own process (the GPU)."""
    import subprocess
    import sys
    import tempfile

    st = Store(proj)
    lib = library(proj)
    path = proj.work / "stems.json"
    old = Store.read(path, {}) if not force else {}
    out_dir = st.clips / "stems"
    index, todo = {}, []
    for t in lib["tracks"]:
        sig = {lv: f"{(Path(proj.assets) / t['files'][lv]).stat().st_mtime_ns}" for lv in ("calm", "battle") if lv in t["files"]}
        if old.get(t["id"], {}).get("sig") == sig and all((st.clips / f).exists() for f in old[t["id"]]["files"].values()):
            index[t["id"]] = old[t["id"]]
        else:
            todo.append((t, sig))
    print(f"{len(todo)} tracks to split ({len(index)} unchanged)", flush=True)
    for i in range(0, len(todo), 12):  # (in batches: one Demucs process loads the model once per batch)
        batch = todo[i:i + 12]
        with tempfile.TemporaryDirectory() as tmp:
            srcs = []
            for t, _ in batch:
                for lv in ("calm", "battle"):
                    srcs.append(str(Path(proj.assets) / t["files"][lv]))
            subprocess.run([str(Path(sys.executable).parent / "demucs"), "-n", "htdemucs", "-o", tmp, *srcs],
                           check=True, capture_output=True)
            for t, sig in batch:
                files = {}
                (out_dir / t["id"]).mkdir(parents=True, exist_ok=True)
                for lv in ("calm", "battle"):
                    d = Path(tmp) / "htdemucs" / Path(t["files"][lv]).stem
                    parts = {k: dsp.decode(d / f"{k}.wav") for k in ("drums", "bass", "other", "vocals")}
                    keep = {"drums": parts["drums"], "bass": parts["bass"], "other": parts["other"] + parts["vocals"]} if lv == "calm" \
                        else {"drums": parts["drums"]}
                    for k, x in keep.items():
                        rel = f"stems/{t['id']}/{lv}.{k}.ogg"
                        dsp.write(st.clips / rel, x)
                        files[f"{lv}.{k}"] = rel
                index[t["id"]] = dict(sig=sig, files=files)
        st.write(path, index, sort=True)
        print(f"  split {min(i + 12, len(todo))} of {len(todo)}", flush=True)
    st.write(path, index, sort=True)
    print(f"stems for {len(index)} tracks")
    return 0


RETUNE_MIN = 6.0  # (cents off the common pitch before a track is retuned)


def retune(proj: P.Project, force: bool = False) -> int:
    """One pitch for the Mixer (2026-10-21): SA3's takes sit at slightly different pitches (98 tracks: median 8 cents
    sharp of A440, 10th-90th percentile 0 to +20, extremes -37 and +37; 12% of pairs more than 20 cents apart, enough
    to sound sour when one follows the other). Every track more than RETUNE_MIN cents off the median is shifted to it
    with rubberband (pitch only: the tempo and the grid stay), with everything the Mixer plays from it: its calm,
    tension, action and battle levels, its stems, its fills and its family's glue (by the glue's source track). The
    copies go under work/clips/tuned/ (the shipped files are never touched); work/tuned.json lists them. Needs
    `music trims` (the tunings) first; run it again after new stems, fills or glues."""
    st = Store(proj)
    measured = Store.read(proj.work / "songs.json", {})
    tun = {tid: r["tuning"] for tid, r in measured.items() if r.get("tuning") is not None}
    if not tun:
        raise SystemExit("measure the songs first: soundlab music trims")
    ref = float(np.median(list(tun.values())))
    path = proj.work / "tuned.json"
    old = Store.read(path, {}) if not force else {}
    lib = library(proj)
    stems, fill_index, glue_index = (Store.read(proj.work / f, {}) for f in ("stems.json", "fills.json", "glues.json"))
    done = old.get("files", {}) if abs(old.get("reference", ref) - ref) < 0.5 else {}
    files, shift = {}, {}
    for t in lib["tracks"]:
        c = tun.get(t["id"])
        if c is None or abs(c - ref) <= RETUNE_MIN:
            continue
        cents = round(ref - c, 1)
        shift[t["id"]] = cents
        rels = [f"shipped/{f}" for f in t["files"].values()] + list(stems.get(t["id"], {}).get("files", {}).values())
        rels += [f["file"] for k, v in fill_index.get(t["id"], {}).items() if not k.endswith(".tried") for f in v]
        rels += [g["file"] for g in glue_index.values() if g["source"]["track"] == t["id"]]
        n = 0
        for rel in rels:
            src = Path(proj.assets) / rel[len("shipped/"):] if rel.startswith("shipped/") else st.clips / rel
            if not src.exists():
                continue
            sig = f"{src.stat().st_mtime_ns}:{cents}"
            dst = st.clips / "tuned" / rel
            if done.get(rel) == sig and dst.exists():
                files[rel] = sig
                continue
            x = dsp.decode(src)
            y = dsp.ffmpeg_filter(x, f"rubberband=pitch={2 ** (cents / 1200):.6f}:pitchq=quality")
            y = y[:len(x)] if len(y) >= len(x) else np.pad(y, ((0, len(x) - len(y)), (0, 0)))  # (the grid: the same length exactly)
            dst.parent.mkdir(parents=True, exist_ok=True)
            dsp.write(dst, y)
            files[rel] = sig
            n += 1
        print(f"  {t['id']}: {c:+.0f} cents, shifted {cents:+.1f} ({n} files)", flush=True)
    st.write(path, dict(reference=round(ref, 1), shift=shift, files=files), sort=True)
    print(f"common pitch {ref:+.1f} cents from A440: {len(shift)} of {len(tun)} tracks retuned, {len(files)} files")
    return 0


FILL_CTX = 4  # (bars kept either side of a fill: the end of the loop before it, its start after it)


def fills(proj: P.Project, seeds: int = 4, bars: int = 1, only: list[str] | None = None) -> int:
    """Generated fills at each shipped track's mellow loop point (2026-10-21): SA3 inpaints `bars` bar(s) between the
    loop's end cue and its start cue (FILL_CTX bars kept either side: the bars before the end cue, then the start cue's
    bars), so each time round a song can end its loop on a different fill. With both ends kept, inpainting holds the
    grid (section probe, 2026-10-20: violinbed 17 of 18). The cue is the designer's (votes.json "cues") or the guess.
    A take is kept when the fill and a bar either side hold 90 BPM, it rates at least the calm gate (Audiobox CE), and
    its loudness is within 3 dB of the bars around it. work/clips/fills/<track>/<cue>.<seed>.ogg (the fill with 50 ms
    either side, for crossfades), listed in work/fills.json; existing takes are kept."""
    from .engine import Engine
    import tempfile

    M, st = proj.music, Store(proj)
    lib = library(proj)
    measured = Store.read(proj.work / "songs.json", {})
    cues_of = st.votes().get("cues", {})
    path = proj.work / "fills.json"
    index = Store.read(path, {})
    bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * SR))
    pad = int(0.05 * SR)
    spine = spine_level(M)
    eng = None
    kept = tried = 0
    tmp = Path(tempfile.mkdtemp(prefix="fills_"))
    for t in lib["tracks"]:
        if only and t["id"] not in only:
            continue
        m = measured.get(t["id"])
        cue = (cues_of.get(t["id"], {}).get("mellow")
               or (m and m.get("cuts", {}).get("calm") and m["cuts"]["calm"][0]["bars"]) or None)
        if not cue:
            continue
        ms, me = cue
        key = f"{ms}-{me}"
        rec = index.setdefault(t["id"], {})
        have = [f for f in rec.get(key, []) if (st.clips / f["file"]).exists()]
        done = {f["seed"] for f in rec.get(key + ".tried", [])} | {f["seed"] for f in have}
        if len(have) >= seeds:
            continue
        x = dsp.decode(Path(proj.assets) / t["files"]["calm"])
        n = len(x) // bar
        take = lambda a, k: np.concatenate([x[((a + j) % n) * bar:((a + j) % n + 1) * bar] for j in range(k)])
        before, after = take(me - FILL_CTX, FILL_CTX), take(ms - 1, FILL_CTX)  # (bars me-3..me, then ms..ms+3)
        keep = np.concatenate([before, np.zeros((bars * bar, 2)), after])
        prompt = (t.get("prompts") or {}).get(spine if t.get("profile") == "stack" else "calm") or (t.get("prompts") or {}).get("calm", "")
        if eng is None:
            eng = Engine()
        a0, a1 = FILL_CTX * bar, (FILL_CTX + bars) * bar
        ref = dsp.loudness_stats(np.concatenate([before[-bar:], after[:bar]]))[0]
        seed, made = 0, []
        while len(have) + len(made) < seeds and seed < seeds * 3:
            if seed in done:
                seed += 1
                continue
            y = eng.generate(prompt, len(keep) / SR, seed, keep=keep, fill=[(a0 / SR, a1 / SR)])
            tried += 1
            around = y[a0 - bar:a1 + bar]
            ph, c = dsp.grid_phase(around, M["bpm"])
            loud = dsp.loudness_stats(y[a0:a1])[0]
            wav = tmp / f"{t['id']}.{seed}.wav"
            dsp.write_wav(wav, around)
            ce = (quality.aesthetics([str(wav)])[0] or {}).get("CE")
            ok = c >= 0.8 and abs(ph) <= 0.04 and abs(loud - ref) <= 3.0 and (ce is None or ce >= quality.GATE.get("calm", 0))
            info = dict(seed=seed, grid=round(float(c), 2), loud=round(float(loud - ref), 1), ce=ce)
            if ok:
                rel = f"fills/{t['id']}/{key}.{seed}.ogg"
                dsp.write(st.clips / rel, y[a0 - pad:a1 + pad])
                made.append(dict(info, file=rel, bars=bars))
            else:
                rec.setdefault(key + ".tried", []).append(info)
            seed += 1
        rec[key] = have + made
        kept += len(made)
        st.write(path, index, sort=True)
        print(f"  {t['id']} (loop {ms}-{me}): {len(have) + len(made)} fills" + (f", {seed - len(made) - len(have)} rejected" if seed > len(made) else ""), flush=True)
    n = 0  # (each fill's loudness per beat, for the Mixer to level it at play time: fills step 2.3 dB in at the median, 37% over 3)
    beat, pad = bar // M["bar_beats"], int(0.05 * SR)
    for tid, rec in index.items():
        for key, fl in rec.items():
            if key.endswith(".tried"):
                continue
            for f in fl:
                if "beats" not in f and (st.clips / f["file"]).exists():
                    f["beats"] = _beats(dsp.decode(st.clips / f["file"])[pad:-pad], beat)
                    n += 1
    st.write(path, index, sort=True)
    print(f"kept {kept} new fills of {tried} tried; measured {n} fills' beats")
    return 0


GLUE_BARS, GLUE_DB, TONIC = 7, -3.0, (2, 5, 9)  # (bars made: up to 4 to play, a bar to rise and a bar to fall, a spare; under the mellow level; D, F, A)


def _freeze(x: np.ndarray, seconds: float, seed: int, n_fft: int = 16384, hop: int = 2048, width: int = 8,
            rest: float = 0.05) -> np.ndarray:
    """A spectral freeze of the chord in `x`: its steady spectrum (each bin's median magnitude over the frames, so the
    attacks drop out), only its peaks kept (local maxima at least twice the floor around them, with their two
    neighbours: the notes' partials; everything else at `rest`), each bin's phase turning at its measured rate (a tone
    keeps its pitch), held for `seconds`; each channel its own random start (width). Keeping only the peaks matters: a
    whole frozen mix beats like coloured noise (2026-10-21, 10 glues at -27 LUFS: frame-to-frame spectral change 18.5,
    the music's own 17.6; peaks only 5.3, the share on D, F and A 53% -> 70%, level steady within 0.4 dB)."""
    from scipy.ndimage import maximum_filter1d, median_filter

    rng = np.random.default_rng(seed)
    win = np.hanning(n_fft)
    if len(x) < 2 * n_fft:
        x = np.concatenate([x, x[::-1]])  # (a bar is short for these frames: mirrored, so there are enough of them)
    out = []
    for ch in range(x.shape[1]):
        s = x[:, ch]
        S = np.fft.rfft(np.array([s[i:i + n_fft] * win for i in range(0, len(s) - n_fft, hop)]), axis=1)
        mag = np.median(np.abs(S), axis=0)
        floor = median_filter(mag, size=61) + 1e-12
        keep = np.zeros(mag.size, bool)
        for k in np.where((mag == maximum_filter1d(mag, size=2 * width + 1)) & (mag > 2.0 * floor))[0]:
            keep[max(0, k - 1):k + 2] = True
        mag = mag * np.where(keep, 1.0, rest)
        k = np.arange(mag.size)
        expected = 2 * np.pi * k * hop / n_fft
        dev = np.angle(np.exp(1j * (np.angle(S[1:] * np.conj(S[:-1])) - expected)))
        adv = expected + np.median(dev, axis=0)
        frames = int(seconds * SR / hop) + n_fft // hop + 2
        y, w = np.zeros(frames * hop + n_fft), np.zeros(frames * hop + n_fft)
        phase = rng.uniform(-np.pi, np.pi, mag.size)
        for f in range(frames):
            y[f * hop:f * hop + n_fft] += np.fft.irfft(mag * np.exp(1j * phase), n=n_fft) * win
            w[f * hop:f * hop + n_fft] += win ** 2
            phase += adv
        y /= np.maximum(w, 1e-6)
        out.append(y[n_fft:n_fft + int(seconds * SR)])
    return np.stack(out, axis=1)


def glues(proj: P.Project, force: bool = False) -> int:
    """Glue for the Mixer (2026-10-21): per family of siblings (and per song without any), a mellow pad in the family's
    own sound, to slip between two parts: a breath, and a way through when two parts don't join. No shipped bar joins
    every part of a set well (searched: the quietest stretches reach 0.70-0.74 with every part of a starter set), so
    each glue is made: the family's steadiest quiet bar on the home chord (most of its pitch-class energy on D, F
    and A, shared by every context's mode), frozen into a sustained pad (_freeze), darkened, at the mellow level less
    GLUE_DB. GLUE_BARS long; work/clips/glues/<id>.ogg, listed in work/glues.json. Needs `music trims` first."""
    M, st = proj.music, Store(proj)
    measured = Store.read(proj.work / "songs.json", {})
    if not measured:
        raise SystemExit("measure the songs first: soundlab music trims")
    lib = library(proj)
    bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * SR))
    out_dir = st.clips / "glues"
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = proj.work / "glues.json"
    old = Store.read(index_path, {}) if not force else {}
    groups: dict[str, list[dict]] = {}
    for t in lib["tracks"]:
        if t.get("measure") and t["measure"].get("feat"):
            fam = t.get("family")
            groups.setdefault(fam["key"] if fam else t["id"], []).append(t)
    index, made = {}, 0
    for gid, members in sorted(groups.items()):
        best = None
        for t in members:
            f, loud = np.array(t["measure"]["feat"]), np.array(t["measure"]["loud"]["calm"])
            med = np.median(loud)
            for b in range(1, min(12, len(f) - 1)):  # (bars 2..12: the steady middle)
                c = np.clip(f[b, :12], 0, None)
                tonic = float(c[list(TONIC)].sum() / (c.sum() + 1e-9))
                steady = float(f[b] @ f[b - 1] + f[b] @ f[b + 1]) / 2
                score = tonic + 0.3 * steady - 0.03 * max(0.0, loud[b] - med)
                if best is None or score > best[0]:
                    best = (score, t, b + 1, round(tonic, 3), round(steady, 3))
        if not best:
            continue
        _, t, src_bar, tonic, steady = best
        fname = f"{gid}.ogg"
        rec = dict(id=gid, members=[m["id"] for m in members], source=dict(track=t["id"], bar=src_bar), bars=GLUE_BARS,
                   tonic=tonic, steady=steady, file=f"glues/{fname}")
        sig = f"{(Path(proj.assets) / t['files']['calm']).stat().st_mtime_ns}"
        if old.get(gid, {}).get("sig") == sig and old[gid].get("source") == rec["source"] and (out_dir / fname).exists():
            index[gid] = old[gid]
            continue
        x = dsp.decode(Path(proj.assets) / t["files"]["calm"])
        src = x[(src_bar - 1) * bar:src_bar * bar]
        y = _freeze(src, GLUE_BARS * bar / SR, seed=src_bar)
        y = dsp.ffmpeg_filter(y, "lowpass=f=3200,highpass=f=40")
        y = dsp.normalise(y, M["lufs"]["calm"] + GLUE_DB)
        dsp.write(out_dir / fname, y)
        index[gid] = dict(rec, sig=sig)
        made += 1
        print(f"  {gid}: from {t['id']} bar {src_bar} (home chord {tonic:.0%}, steady {steady})", flush=True)
    st.write(index_path, index, sort=True)
    print(f"made {made} glues ({len(index) - made} unchanged): {len(index)} in all, for {sum(len(g['members']) for g in index.values())} songs")
    return 0


JOIN_WEAK = 0.75  # (the Mixer's threshold for a straight transition: web/js/mixer.js WEAK)


JOIN_FEATURES = ("level_a", "entry_phrase", "attack_b", "held_a", "rec_a", "rec_b")


def join_features(m: dict, a: str, e: int, b: str, s: int) -> dict:
    """What predicts the designer's thumbs on a transition (song a's bar e into song b from its bar s), from songs.json.
    Found on their first 132 votes (2026-10-21, MODELS_LOG). The Mixer computes the same in web/js/mixer.js
    (taste()): keep the two the same.
      level_a       how full a's exit bar is: its beats' mean loudness less a's median beat (dB)
      entry_phrase  1 when b is entered on a phrase start of its own grid
      attack_b      how clearly b starts: the onset at its entry beat against b's median busyness (log)
      held_a        a's last beat's busyness against the onset at a's next downbeat (log): high where a wasn't about
                    to hit a strong beat itself, so leaving there steps on nothing"""
    A, B = m[a], m[b]
    ba, n = A["beats"]["calm"], len(A["beats"]["calm"])
    oa, ob = A["onset"], B["onset"]
    ia = [((e - 1) * 4 + k) % n for k in range(4)]
    return dict(level_a=float(np.mean([ba[i] for i in ia]) - np.median(ba)),
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
    measured = Store.read(proj.work / "songs.json", {})
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


def promote(proj: P.Project, apply: bool = False) -> int:
    """Ship the music: every take liked on the Music page becomes a track in rotation (votes "mesh_<key>.<take>.
    <profile>" > 0), whatever its style; a context and biome with none liked in any style ships all its plain
    (unstyled) set's newest batch not voted down, at the default profile (else "contrast" if there is one, else the first). Writes out_dir/<track>_<level>.ogg and the manifest, removes tracks no longer chosen,
    records provenance in music_promoted.json, then the project's after_install. With song groups (music.groups),
    only liked takes ship, and each new track joins the groups file at the default group."""
    M, st = proj.music, Store(proj)
    idx, votes = st.index(), st.votes()["clips"]
    out_dir, levels = Path(M["out_dir"]), M["levels"]
    tracks, record, written = [], {}, []
    sets = idx.get("mesh", {}).get("contexts", {})
    liked = {key: [(t, p) for t in c["takes"] for p in t["profiles"] if votes.get(f"mesh_{key}.{t['id']}.{p}", 0) > 0]
             for key, c in sets.items()}
    any_liked = {(c["context"], c["biome"]) for key, c in sets.items() if liked[key]}
    G = M.get("groups")
    for key, c in sets.items():
        if not c["takes"] or (not liked[key] and (G or c.get("style") or (c["context"], c["biome"]) in any_liked)):
            continue
        ps = c["takes"][0]["profiles"]
        p0 = next(p for p in (M.get("default_profile"), "contrast", next(iter(ps))) if p in ps)
        chosen = liked[key] or [(t, p0) for t in current_takes(c) if votes.get(f"mesh_{key}.{t['id']}.{p0}", 0) >= 0]
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
    grouped = None
    if G:
        grouped = Store.read(Path(G["file"]), {})
        have = grouped.setdefault("tracks", {})
        new = [t["id"] for t in tracks if t["id"] not in have]
        for tid in new:
            have[tid] = G["default"]
        count: dict[str, int] = {}
        for t in tracks:
            count[have[t["id"]]] = count.get(have[t["id"]], 0) + 1
        print("  groups: " + ", ".join(f"{g} {n}" for g, n in sorted(count.items()))
              + (f"; {len(new)} new tracks join {G['default']}" if new else ""))
    old = {t["id"] for t in Store.read(Path(M["manifest"]), {}).get("tracks", [])}
    gone = sorted(old - {t["id"] for t in tracks})
    print(f"  {len(tracks)} tracks: {len({t['id'] for t in tracks} - old)} new, {len(gone)} leave the rotation"
          + (": " + ", ".join(gone) if gone else ""))
    if not apply:
        print(f"dry run: {len(tracks)} tracks; pass --apply to ship them")
        return 0
    if grouped is not None:
        st.write(Path(G["file"]), grouped)
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

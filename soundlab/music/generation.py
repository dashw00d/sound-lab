"""Making sets (`music generate`): each take's spine from text, put on the grid, its levels derived from it by
audio-to-audio and its layers mixed in, checked and kept or thrown out; `music derive` (profiles added to takes already
made) and `music check` (every level measured for what sounds off)."""
from __future__ import annotations

import hashlib
import random
from datetime import datetime

import numpy as np

from .. import dsp, project as P, quality, tuning
from ..dsp import SR
from ..store import Store
from .design import key_of, spine_level
from .measures import SAME_PIECE, _fingerprint, same_piece
from .pool import pool_of, take_roles
from .shipping import newest_round


# --------------------------------------------------------------------------- generating sets

LEAD_IN, TAIL = 4, 6  # (bars of each generated spine left out before and after its loop: the opening and the ending)


class _LazyEngine:
    """The generator, loaded only when something needs it (mixing layers into levels doesn't)."""
    def __init__(self):
        self._eng = None

    def __getattr__(self, name):
        if self._eng is None:
            from ..engine import Engine
            self._eng = Engine()
        return getattr(self._eng, name)


def sa3_seed(key: str, seed: int) -> int:
    """The seed SA3 gets for a set's take: its take number offset by the set's own range (from its key), so the same
    take number in another context is another piece (2026-10-21: with the take number itself as the seed, a style's
    takes came out as near-copies across contexts: siblings 0.82 alike bar for bar, against 0.63 for any two songs).
    Takes made before keep their seed (take["sa3_seed"] absent: the take number)."""
    return int(hashlib.sha256(key.encode()).hexdigest()[:5], 16) * 1000 + seed


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
        x = dsp.stretch(x, tempo=bpm / got)
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
        if lv == spine_lv:  # (first: a profile needn't give the spine's own level a strength)
            return spine[0], spine[1], base
        if isinstance(cfg[lv], str):  # (another level's audio, before its layers)
            return raw(cfg[lv], cfg, prof)
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


def generate(proj: P.Project, contexts: list[str], biomes: list[str], takes: int = 3, tries: int = 14,
             styles: list[str] | None = None, profiles: list[str] | None = None, same_round: bool = False, trial: bool = False) -> int:
    """Sets for every context x biome (x style, when given: the project's alternative prompt styles): a new batch of
    `takes` takes each, at every profile (or only `profiles`). Earlier takes of a set stay, but are no longer the batch.
    With `same_round`, this run's takes join the newest round (one batch made in several runs, e.g. other styles for
    other contexts) instead of starting a new one."""
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
    from ..engine import Engine

    eng = Engine()
    idx = st.index()
    mesh = idx.setdefault("mesh", {})
    mesh.update(bpm=bpm, bar_beats=bar_beats, bars=bars, levels=levels, provisional=provisional,
                profiles=list(M["profiles"]), pool={r: [names[p] for p in ps] for r, ps in pool.items()})
    mesh.setdefault("contexts", {})
    runs = [(c, b, s) for c in contexts for b in biomes for s in (styles or [None])]
    shipped, votes_now = Store.read(st.music_promoted_path, {}), st.votes()["clips"]
    # (what a new take mustn't be the same piece as: the shipped songs, then this run's own takes as they're made)
    refs = [(t, np.array(r["feat"])[:bars]) for t, r in Store.read(proj.work / "songs.json", {}).items() if "feat" in r]
    now = datetime.now()
    rid = now.strftime("%Y-%m-%d %H:%M")  # a round: this run's takes (the Music page shows the newest batch)
    if any(r["id"] == rid for r in mesh.get("rounds", [])):  # (a second run in the same minute is still its own batch)
        rid = now.strftime("%Y-%m-%d %H:%M:%S")
    if same_round and mesh.get("rounds"):
        r = mesh["rounds"][-1]
        rid = r["id"]
        for f, new in (("contexts", contexts), ("biomes", biomes), ("styles", styles or []), ("profiles", list(profs))):
            r[f] = r.get(f, []) + [x for x in new if x not in r.get(f, [])]
    else:
        mesh.setdefault("rounds", []).append(dict(id=rid, contexts=contexts, biomes=biomes, styles=styles or [],
                                                  profiles=list(profs), takes=takes, **({"trial": True} if trial else {})))
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
        # The ids the votes and the shipped tracks name count too: a work folder lost (cleaned) takes the index with
        # it, and a new k0 would inherit an old k0's votes and its track's name.
        used = [t["id"] for t in old.get("takes", [])] + [r["take"] for r in shipped.values() if r.get("key") == key]
        used += [k[len(f"mesh_{key}."):].split(".")[0] for k in votes_now if k.startswith(f"mesh_{key}.")]
        first_seed = max([old.get("next_seed", 0)] + [int(i[1:]) + 1 for i in used if i[:1] == "k" and i[1:].isdigit()])
        found, first_prompts = [], None
        for seed in range(first_seed, first_seed + tries):
            if len(found) == takes:
                break
            roles = take_roles(pool, key, seed)
            # (a style may draw some of its words per take, seeded like the instruments: style.draws(context) -> {slot:
            # [options]}; the draw is kept with the take, so the votes can say which words win)
            draws = getattr(make, "draws", None)
            words = {sl: random.Random(f"{key}:{seed}:{sl}").choice(opts) for sl, opts in (draws(ctx) if draws else {}).items()}
            prompts = make(ctx, mode, mood, {r: names[p] for r, p in roles.items()} | ({"_words": words} if words else {}))
            first_prompts = first_prompts or prompts
            # The loop is cut from the middle of a longer piece: SA3 writes each take as a whole piece, opening and
            # heading for an ending (a late crescendo, "weird stuff toward the end", the designer 2026-10-15), so the
            # loop starts LEAD_IN bars after the first downbeat and stops TAIL bars before the end.
            spine = eng.generate(prompts[spine_lv], need + (LEAD_IN + TAIL) * bar + 4.0, sa3_seed(key, seed))
            got, wobble = dsp.tempo_of(spine, bpm)
            if abs(got / bpm - 1) > 0.06 or wobble > 40:
                print(f"  {key} seed {seed}: rejected ({got:.1f} BPM, beat spread {wobble:.0f} ms)", flush=True)
                continue
            spine = dsp.stretch(spine, tempo=bpm / got)  # onto the grid, same pitch
            start = int((dsp.first_downbeat(spine, bpm, bar_beats) + LEAD_IN * bar) * SR)
            spine = spine[start:start + int(round(need * SR))]
            if len(spine) < int(round(need * SR)):
                print(f"  {key} seed {seed}: rejected (too short after the downbeat)", flush=True)
                continue
            after, _ = dsp.tempo_of(spine, bpm)
            tid = f"k{seed}"
            take = dict(id=tid, seed=seed, sa3_seed=sa3_seed(key, seed), round=rid, measured_bpm=round(got, 2), corrected_bpm=round(after, 2),
                        **({"words": words} if words else {}), **({"trial": True} if trial else {}),
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
            # (the same piece as a shipped song, or as a take this run already made: another seed instead; 2026-10-21, the
            # similarity scan found 4 of an overnight 192 were; the designer: "most tracks sound basically the same")
            F = _fingerprint(dsp.normalise(base, M["lufs"]["calm"], -2.5), M)
            dup = max(((same_piece(F, G), name) for name, G in refs), default=(0.0, ""))
            if dup[0] >= SAME_PIECE:
                print(f"  {key} seed {seed}: rejected (the same piece as {dup[1]}: {dup[0]:.2f})", flush=True)
                for f in {spine_file, *writes}:
                    (st.clips / f).unlink(missing_ok=True)
                continue
            refs.append((f"{key}.{tid}", F))
            print(f"  {key} {tid}: {got:.1f} -> {after:.1f} BPM, " + ", ".join(take["instruments"].values())
                  + (" · " + " · ".join(words.values()) if words else ""), flush=True)
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
    from .. import quality

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

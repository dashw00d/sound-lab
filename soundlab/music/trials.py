"""The Trial page's takes: a mini trial (a small batch in a style that draws its words per take, judged one at a time,
blind), seamless extensions grown from a take called a new family, and how many trial takes are still to answer."""
from __future__ import annotations

import hashlib
import random

import numpy as np

from .. import dsp, project as P, tuning
from ..dsp import SR
from ..store import Store
from .design import spine_level
from .generation import _Failed, _make_profiles, generate
from .measures import SAME_PIECE, _fingerprint, same_piece
from .pool import pool_of, take_roles


TRIAL_CONTEXTS = ("day", "night", "bloodmoon", "winter")


def trial(proj: P.Project, takes: int = 2, contexts: list[str] | None = None, style: str = "drawn") -> int:
    """A mini trial (2026-10-21, the designer: "a 'is this unique and good' mini trial over and over so we can build up
    samples"): a small batch of takes in a style that draws its words per take, `takes` per context, made like any
    round (the quality gate, the same-piece check) and marked as a trial, for the Trial page: one at a time, blind, the
    designer answers "new family" (votes novel_<set>.<take> = 1, strict: only what could open a whole new family of
    songs) or not (-1). Their answers, with each take's drawn words, are the samples the next draws learn from."""
    M = proj.music
    if style not in M.get("styles", {}):
        raise SystemExit(f"no style {style!r} in the project")
    return generate(proj, list(contexts or [c for c in TRIAL_CONTEXTS if c in M["contexts"]]), ["any"], takes=takes,
                    tries=max(12, takes * 8), styles=[style], profiles=[M.get("default_profile", "stack")], trial=True)


GROW_KEEP, GROW_BARS = 4, 16  # (bars of the seed kept either side; bars written between them)


GROW_CHANGES = ("none", "melody", "accomp", "lead")  # (the slot each next extension of a seed draws anew, in turn)


def grow(proj: P.Project, src: str | None = None, n: int = 4, auto: bool = False) -> int:
    """Seamless extensions of a take the designer called a new family (2026-10-21, the designer: "should we frame the
    grow like the mixer where we try and grow seamless extensions?"). SA3 inpaints GROW_BARS new bars between the seed's
    last GROW_KEEP bars and its first GROW_KEEP bars, so the extension comes out of the seed's end and lands back on its
    start: seed -> extension -> seed joins by construction, on the grid (inpainting with both ends kept held the key and
    grid, MODELS_LOG section probe). Each extension draws one slot of the seed's words anew (GROW_CHANGES: none, the
    melody, the strings' part, the lead), so the family grows rather than repeats. Kept when it holds the grid, sits
    within 2.5 dB of the seed, doesn't click at either seam, isn't the same piece as the seed, and passes the quality
    gate; its levels use the seed's own layers (the family's drums). A new take in the seed's set, id <seed>g<j>, marked
    trial and grow={of, change, ...}: the Trial page plays it between the seed's tail and head, and the designer answers.
    `src` "<set>.<take>", else (auto) the oldest new-family seed with fewer than `n` extensions. Returns 3 if none."""
    from .. import quality
    from ..engine import Engine

    tuning.require("music")
    M, st = proj.music, Store(proj)
    idx, votes = st.index(), st.votes()["clips"]
    mesh = idx.get("mesh", {})
    sets = mesh.get("contexts", {})
    bpm, bar_beats = M["bpm"], M["bar_beats"]
    bar = int(round(bar_beats * 60.0 / bpm * SR))
    spine_lv, prof = spine_level(M), M.get("default_profile", "stack")
    grown = lambda key, tid: [t for t in sets[key]["takes"] if (t.get("grow") or {}).get("of") == tid]
    seeds = [(key, t) for key, c in sets.items() for t in c["takes"]
             if votes.get(f"novel_{key}.{t['id']}", 0) > 0 and not t.get("grow")]
    if src:
        key, tid = src.rsplit(".", 1)
        pick = [(key, t) for t in sets.get(key, {}).get("takes", []) if t["id"] == tid]
    else:
        pick = [(k, t) for k, t in seeds if len(grown(k, t["id"])) < n]
    if not pick:
        print("no new-family seed left to grow" if not src else f"no take {src}")
        return 3
    key, take = pick[0]
    c = sets[key]
    ctx, biome, style = c["context"], c.get("biome", "any"), c.get("style")
    make = M["styles"][style] if style else M["prompts"]
    mode, mood = M["contexts"][ctx]
    if M["biomes"].get(biome):
        mood = f"{mood}, {M['biomes'][biome]}"
    pool, _ = pool_of(proj)
    names = {p: i["name"] for p, i in M["instruments"].items()}
    nm = {r: names[p] for r, p in take_roles(pool, key, take["seed"]).items()}
    S = dsp.decode(st.clips / f"mesh_{key}/{spine_lv}.{take['id']}.ogg")  # (the seed's spine: its loop, at the spine's level)
    keep = np.concatenate([S[-GROW_KEEP * bar:], np.zeros((GROW_BARS * bar, 2)), S[:GROW_KEEP * bar]])
    a0, a1 = GROW_KEEP * bar, (GROW_KEEP + GROW_BARS) * bar
    F_S, ref = _fingerprint(dsp.normalise(S, M["lufs"]["calm"], -2.5), M), dsp.loudness_stats(S)[0]
    draws = getattr(make, "draws", None)
    eng = Engine()
    done, made, tries = len(grown(key, take["id"])), 0, 0
    print(f"growing {key} {take['id']} (has {done})", flush=True)
    while done + made < n and tries < n * 4:
        j = done + made
        change = GROW_CHANGES[j % len(GROW_CHANGES)]
        words = dict(take.get("words") or {})
        slots = draws(ctx) if draws else {}
        if change in slots:
            words[change] = random.Random(f"{key}:{take['id']}:grow:{j}:{tries}").choice([o for o in slots[change] if o != words.get(change)])
        prompts = make(ctx, mode, mood, nm | ({"_words": words} if words else {}))
        gseed = int(hashlib.sha256(f"{key}:{take['id']}:grow:{j}:{tries}".encode()).hexdigest()[:6], 16)
        tries += 1
        y = eng.generate(prompts[spine_lv], len(keep) / SR, gseed, keep=keep, fill=[(a0 / SR, a1 / SR)])
        E = y[a0:a1]
        ph, lock = dsp.grid_phase(y[a0 - bar:a1 + bar], bpm)
        loud = dsp.loudness_stats(E)[0] - ref
        click = max(dsp.click_ratio(y, a0), dsp.click_ratio(y, a1))
        same = same_piece(_fingerprint(dsp.normalise(E, M["lufs"]["calm"], -2.5), M), F_S)
        why = ("off the grid" if lock < 0.8 or abs(ph) > 0.04 else f"{loud:+.1f} dB from the seed" if abs(loud) > 2.5
               else f"a click at a seam ({click})" if click > dsp.CLICK else f"the same as the seed ({same:.2f})" if same >= SAME_PIECE else None)
        if why:
            print(f"  {change}: rejected ({why})", flush=True)
            continue
        tid = f"{take['id']}g{j}"
        new = dict(id=tid, seed=take["seed"], sa3_seed=gseed, round=take.get("round", c.get("round", "")), trial=True,
                   grow=dict(of=take["id"], change=change, lock=round(float(lock), 2), loud=round(float(loud), 1), click=click,
                             same=round(same, 3)),
                   words=words, prompts=prompts, instruments=dict(take.get("instruments", {})), layers=dict(take.get("layers", {})),
                   profiles={}, measured_bpm=bpm, corrected_bpm=bpm)
        base = dsp.normalise(E, M["lufs"][spine_lv], -2.5)
        spine_file = f"mesh_{key}/{spine_lv}.{tid}.ogg"
        try:
            writes = _make_profiles(eng, M, st, key, new, prompts, base, base, (spine_file, dict(lock=round(float(lock), 2))),
                                    {prof: M["profiles"][prof]}, (ctx, mode, mood), new_layers=False)
        except _Failed as e:
            print(f"  {change}: rejected ({e})", flush=True)
            continue
        dsp.write(st.clips / spine_file, base)
        for f, a in writes.items():
            dsp.write(st.clips / f, a)
        gate = quality.gate({lv: str(st.clips / f) for lv, f in new["profiles"][prof]["levels"].items()}) if M.get("quality_gate", True) else None
        if gate:
            print(f"  {change}: rejected ({gate})", flush=True)
            for f in {spine_file, *writes}:
                (st.clips / f).unlink(missing_ok=True)
            continue
        c["takes"].append(new)
        st.save_index(idx)
        made += 1
        print(f"  {key} {tid}: {change}" + (f" -> {words.get(change)}" if change in slots else "") + f" (grid {lock:.2f}, {loud:+.1f} dB, "
              f"seams {click}, like the seed {same:.2f})", flush=True)
    print(f"grew {made} extensions of {key} {take['id']} in {tries} tries")
    return 0


def trial_pending(proj: P.Project) -> int:
    """How many trial takes the designer hasn't answered yet (the trial loop keeps one batch ahead of them)."""
    from ..families import mixer_id

    st = Store(proj)
    votes = st.votes()["clips"]
    prof = proj.music.get("default_profile", "stack")
    said = {k.split("_", 1)[1].split("|", 1)[0] for k in votes if k.startswith(("ok_", "link_", "dup_", "novel_"))}
    return sum(1 for key, c in st.index().get("mesh", {}).get("contexts", {}).items() for t in c["takes"]
               if t.get("trial") and f"novel_{key}.{t['id']}" not in votes and mixer_id(c, t, prof) not in said)

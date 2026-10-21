"""The instrument pool: a solo audition of every candidate instrument (the Instruments page), the pool the votes make
of them, and the instruments a take draws from it."""
from __future__ import annotations

import random

from .. import dsp, project as P, tuning
from ..store import Store


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
    from ..engine import Engine

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

"""Measure every shipped sound and music level for the Balance page (work/balance.json).

Each file's loudness (a one-shot by its loudest moment, a loop or music level by its integrated loudness, LUFS),
its group, and what the game's code does with it: its bus and the dB offset its call sites give it. The page adds
the mix's trims and bus levels on top, so what it shows and plays is what the game plays, short of 3D distance.

The project describes it (Project.balance):
  mix          the game's mix file (JSON: buses, sounds, music, levels -> dB), re-read live by the game
  dirs         asset subfolders to measure (e.g. ["sfx", "vo"]); files directly in them
  voice_dirs   which of those hold voices (their bus defaults to "Voice")
  groups       [[group, [name prefixes]], ...], first match wins
  call_sites() {name or "prefix_": [{db, bus, at}]}: how the code plays each sound (db None = computed)
  buses()      {bus: base dB}: the game's default bus levels
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import dsp, project as P
from .store import Store


def _group(B: dict, stem: str, sub: str) -> str:
    if sub in B.get("voice_dirs", []):
        return "voices"
    for name, prefixes in B.get("groups", []):
        if stem.startswith(tuple(prefixes)):
            return name
    return "other"


def _sites(calls: dict, stem: str) -> list[dict]:
    base = re.sub(r"_\d+$", "", stem)  # (arrow_hit_2 is played as "arrow_hit")
    found = calls.get(stem, []) + (calls.get(base, []) if base != stem else [])
    if not found:
        for prefix, sites in calls.items():
            if stem.startswith(prefix) and (prefix.endswith("_") or prefix == base):
                return sites
    return found


def _measure(path: Path, kind: str) -> float:
    i, m = dsp.loudness_stats(dsp.decode(path, 2))
    return round(m if kind == "oneshot" else i, 1)


def measure(proj: P.Project) -> int:
    if not proj.balance:
        raise SystemExit("this project has no balance section (Project.balance)")
    B, st = proj.balance, Store(proj)
    calls = B["call_sites"]() if B.get("call_sites") else {}
    files = []
    for sub in B.get("dirs", ["sfx"]):
        for f in sorted((proj.assets / sub).glob("*")):
            if f.suffix in (".wav", ".ogg"):
                files.append((f, sub, "loop" if f.suffix == ".ogg" else "oneshot"))
    music = {}
    if proj.music and Path(proj.music["manifest"]).exists():
        manifest = Store.read(Path(proj.music["manifest"]), {})
        for t in manifest.get("tracks", []):
            music[t["id"]] = dict(context=t["context"], biome=t["biome"], levels={})
            for lv in manifest["levels"]:
                files.append((Path(proj.music["out_dir"]) / f"{t['id']}_{lv}.ogg", "music", "music"))
    with ThreadPoolExecutor(8) as ex:
        loud = list(ex.map(lambda a: _measure(a[0], a[2]), files))
    sounds = {}
    for (f, sub, kind), lufs in zip(files, loud):
        rel = str(f.relative_to(proj.assets))
        if sub == "music":
            tid, lv = f.stem.rsplit("_", 1)
            music[tid]["levels"][lv] = dict(file=rel, lufs=lufs)
            continue
        sites = _sites(calls, f.stem)
        bus = sites[0]["bus"] if sites else ("Voice" if sub in B.get("voice_dirs", []) else
                                              B.get("loop_bus", "Ambience") if kind == "loop" else "SFX")
        sounds[f.stem] = dict(file=rel, kind=kind, lufs=lufs, metric="loudest moment" if kind == "oneshot" else "integrated",
                              group=_group(B, f.stem, sub), bus=bus, base=re.sub(r"_\d+$", "", f.stem), calls=sites)
    st.write(st.balance_path, dict(buses=B["buses"]() if B.get("buses") else {}, sounds=sounds, music=music))
    print(f"measured {len(sounds)} sounds and {len(music)} music tracks -> {st.balance_path}")
    return 0

"""Measure every shipped sound and music level for the Balance page (work/balance.json).

Two kinds of project:

A sound table (the game's mix file has "version": 2, e.g. Emberhold's assets/audio/mix.json). The game plays events,
each naming its file (or variants, or a family like "*_select"), a category (bus, space, voices, priority, its own
dB) and its dB; the buses, ducks and music trims are in the same file. Here each event's files are measured (a
one-shot by its loudest moment, a loop or music level by its integrated loudness, LUFS; an event's loudness is its
loudest take), and the page computes exactly what the game does:

    effective = file loudness + event dB + category dB + bus dB

(a positional sound also gets the game's zoom and screen-position terms, both 0 on screen at the reference zoom:
the page states its levels there). The page edits the table's dBs and saves the whole table; the game re-reads it
live. There is nothing to infer from the game's code.

The older trims-only mix (no "version"): each file's loudness, its group, and what the game's code does with it, from
the project's call_sites() and buses() hooks; the page adds the mix's trims on top.

The project describes it (Project.balance):
  mix          the game's mix file, re-read live by the game
  dirs         asset subfolders holding sound files (e.g. ["sfx", "vo"]); "" is the audio root
  voice_dirs   which of those hold voices
  (trims-only projects also: groups, call_sites(), buses(), loop_bus)
"""
from __future__ import annotations

import fnmatch
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


def _files(proj: P.Project, B: dict) -> dict[str, Path]:
    """Every sound file by stem; a subfolder's file wins over the audio root's (as the game loads them)."""
    out: dict[str, Path] = {}
    for sub in [""] + [d for d in B.get("dirs", ["sfx"]) if d]:
        for f in sorted((proj.assets / sub).glob("*") if sub else proj.assets.glob("*")):
            if f.is_file() and f.suffix in (".wav", ".ogg"):
                out[f.stem] = f
    return out


def _event_files(d: dict, sid: str, have: dict[str, Path]) -> list[str]:
    """The stems an event plays: its file and that file's variants (name_1..), its files list, or a family glob."""
    out = []
    for f in d.get("files") or [d.get("file", sid)]:
        if "*" in f:
            out += [n for n in have if fnmatch.fnmatch(n, f) or fnmatch.fnmatch(n, f + "_*")]
        else:
            out += [n for n in have if n == f or re.fullmatch(re.escape(f) + r"_\d", n)]
    return sorted(set(out))


def _music(proj: P.Project) -> tuple[dict, list]:
    music, files = {}, []
    if proj.music and Path(proj.music["manifest"]).exists():
        manifest = Store.read(Path(proj.music["manifest"]), {})
        for t in manifest.get("tracks", []):
            music[t["id"]] = dict(context=t["context"], biome=t["biome"], levels={})
            for lv in manifest["levels"]:
                files.append((Path(proj.music["out_dir"]) / f"{t['id']}_{lv}.ogg", t["id"], lv))
    return music, files


def measure(proj: P.Project) -> int:
    if not proj.balance:
        raise SystemExit("this project has no balance section (Project.balance)")
    B, st = proj.balance, Store(proj)
    mix = Store.read(Path(B["mix"]), {})
    music, mfiles = _music(proj)
    if mix.get("version", 1) >= 2:
        return _measure_table(proj, B, st, mix, music, mfiles)
    calls = B["call_sites"]() if B.get("call_sites") else {}
    files = []
    for sub in B.get("dirs", ["sfx"]):
        for f in sorted((proj.assets / sub).glob("*")):
            if f.suffix in (".wav", ".ogg"):
                files.append((f, sub, "loop" if f.suffix == ".ogg" else "oneshot"))
    files += [(f, "music", "music") for f, _, _ in mfiles]
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


def _measure_table(proj, B, st, mix, music, mfiles) -> int:
    have = _files(proj, B)
    events, unreached = {}, set(n for n, p in have.items() if p.parent != proj.assets)
    jobs = {}
    for sid, d in mix.get("sounds", {}).items():
        stems = _event_files(d, sid, have)
        unreached -= set(stems)
        events[sid] = dict(cat=d.get("cat", ""), stems=stems)
        for s in stems:
            jobs[s] = have[s]
    stems = sorted(jobs)
    with ThreadPoolExecutor(8) as ex:
        loud = dict(zip(stems, ex.map(lambda s: _measure(jobs[s], "loop" if jobs[s].suffix == ".ogg" else "oneshot"), stems)))
        mloud = list(ex.map(lambda a: _measure(a[0], "music"), mfiles))
    for sid, e in events.items():
        takes = [dict(file=str(jobs[s].relative_to(proj.assets)), lufs=loud[s]) for s in e.pop("stems")]
        e["takes"] = takes
        if takes:
            top = max(takes, key=lambda t: t["lufs"])  # (an event is as loud as its loudest take)
            e.update(file=top["file"], lufs=top["lufs"],
                     metric="integrated" if top["file"].endswith(".ogg") else "loudest moment")
    for (f, tid, lv), lufs in zip(mfiles, mloud):
        music[tid]["levels"][lv] = dict(file=str(f.relative_to(proj.assets)), lufs=lufs)
    missing = sorted(s for s, e in events.items() if not e["takes"])
    st.write(st.balance_path, dict(version=2, events=events, music=music, unreached=sorted(unreached), missing=missing))
    print(f"measured {len(events)} events ({len(jobs)} files) and {len(music)} music tracks -> {st.balance_path}")
    if missing:
        print(f"  !! events with no file: {', '.join(missing)}")
    if unreached:
        print(f"  note: files no event plays: {', '.join(sorted(unreached))}")
    return 0

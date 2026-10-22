"""The sync (2026-10-21, the designer: "this app should allow you to sync with a game's source as a folder and maybe
include json/code/docs ... so the game knows how to plug it in. It should be agnostic"). One folder in the game, the
lab's own, holding everything a game needs to play its music as the Mixer plays it, in no engine's terms:

  soundlab.json          the manifest: the grid, the playback rules, each song's files and levels, and the walk's music
                         (songs, scenes, cuts)
  soundlab.schema.json   its JSON Schema
  walk.js, walk.d.ts     the scene walk (web-app/src/mixer/engine/scenewalk.ts, built): where the music goes next; the
                         Mixer walks the graph with the same code
  README.md              how to plug it in, for any engine
  music/<song>.<state>.ogg   each song's mellow and intense levels (a retuned copy where the Mixer plays one)

The folder is the project's `sync` (default: <game root>/soundlab). `soundlab sync` shows what would change; with
--apply it writes only what differs, removes the audio it wrote before and no longer ships, and touches nothing else in
the folder. With --link, a song's audio already in the game (shipped by `music promote`, not retuned) isn't copied: the
manifest points at it instead.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import statistics
from datetime import datetime
from pathlib import Path

from .. import project as P
from ..music.shipping import library
from ..store import Store

FORMAT = "soundlab-music/1"
HERE = Path(__file__).parent
LEN = 4  # bars in a phrase (scenewalk.ts LEN)
SWAP_HZ = 180  # the bass swap's split (web-app/src/mixer/curves.ts SWAP_HZ)
XF = 0.04  # seconds either side of a bar line where a song steps within itself (web-app/src/mixer/judge.ts XF)
# The Mixer's settings this reads, with the web app's defaults (web-app/src/mixer/prefs.ts DEFAULTS)
DEFAULTS = dict(intense="battle", glueBars=1, tail="taper", stay=12, joins="two", match=True, even=True, bassSwap=False,
                sceneBars=48, wave=8)


def folder(proj: P.Project) -> Path:
    """Where the project syncs to: its `sync`, else <game root>/soundlab."""
    return Path(getattr(proj, "sync", None) or Path(proj.root) / "soundlab")


def _source(proj: P.Project, url: str) -> Path:
    """The file behind one of the player's URLs (/clips/: the lab's work; /shipped/: the game's assets)."""
    if url.startswith("/clips/"):
        return proj.work / "clips" / url[len("/clips/"):]
    if url.startswith("/shipped/"):
        return Path(proj.assets) / url[len("/shipped/"):]
    raise ValueError(url)


def manifest(proj: P.Project, link: bool = False) -> tuple[dict, dict[str, Path]]:
    """The manifest, and the audio it needs: {path in the folder: the file to copy there}. The walk's music is made as
    the Mixer makes it (web-app/src/mixer/engine/graph.ts Graph.data), from the songs the game ships: a scene's members
    that aren't bad takes, each one's loop (the designer's mellow cues, else the guessed ones), entry (its first phrase
    start in the loop), phrase and energy, and the cuts that land inside the other song's loop with a phrase's room."""
    if not proj.music:
        raise RuntimeError("this project has no music")
    st, lib = Store(proj), library(proj)
    votes = st.votes()
    clips, cues = votes.get("clips", {}), votes.get("cues", {})
    prefs = DEFAULTS | {k: v for k, v in Store.read(st.mixer_settings_path, {}).items() if k in DEFAULTS}
    F = Store.read(proj.work / "families.json", {"items": {}, "families": {}})
    N, bpm, beats = lib["bars"], lib["bpm"], lib["bar_beats"]
    bar_s = 60 / bpm * beats
    tracks = {t["id"]: t for t in lib["tracks"]}
    measure = lambda tid: tracks[tid].get("measure") or {}
    states = {"mellow": "calm", "intense": prefs["intense"]}

    # (even levels, as the Mixer: each song's median beat against the library's median, within 6 dB; judge.ts trimDb)
    def level(tid: str, state: str) -> float | None:
        b = (measure(tid).get("beats") or {}).get("calm" if state == "mellow" else "battle")
        return statistics.median(b) if b else None
    ref = {s: statistics.median(v) if (v := [x for t in tracks if (x := level(t, s)) is not None]) else None for s in states}

    def trim(tid: str, state: str) -> float:
        v, r = level(tid, state), ref[state]
        return 0.0 if not prefs["even"] or v is None or r is None else round(max(-6.0, min(6.0, r - v)), 2)

    def cue(tid: str) -> list[int]:
        c = (cues.get(tid) or {}).get("mellow")
        if c:
            return list(c)
        g = ((measure(tid).get("cuts") or {}).get("calm") or [{}])[0].get("bars")
        return list(g) if g else [1, N]

    def phrase(tid: str) -> int | None:
        ph = measure(tid).get("phrase")
        return ph["start"] if ph and ph.get("contrast", 0) >= 0.08 else None

    def entry(tid: str) -> int:
        lo, hi = cue(tid)
        ph = phrase(tid)
        if ph is None:
            return lo
        return next((b for b in range(lo, hi + 1) if (b - ph) % LEN == 0), lo)

    out, files, songs, scenes, cuts, walk_songs = folder(proj), {}, {}, {}, {}, {}
    for fid, fam in F.get("families", {}).items():
        ms = [m for m in fam.get("members", []) if m in tracks and clips.get(f"ok_{m}", 0) >= 0
              and F["items"].get(m, {}).get("energy") is not None and tracks[m]["src"].get("calm")]
        if not ms:
            continue
        scenes[fid] = dict(members=ms)
        for m in ms:
            t, it = tracks[m], F["items"][m]
            walk_songs[m] = dict(loop=cue(m), entry=entry(m), phrase=phrase(m), energy=it["energy"])
            fs = {}
            for s, lv in states.items():
                url = t["src"].get(lv) or t["src"]["calm"]  # (a song without that level: its calm, as the Mixer plays it)
                src = _source(proj, url)
                if link and url.startswith("/shipped/") and src.resolve().is_relative_to(Path(proj.root).resolve()):
                    fs[s] = Path(os.path.relpath(src, out)).as_posix()
                else:
                    fs[s] = f"music/{m}.{s}.ogg"
                    files[fs[s]] = src
            b = measure(m).get("beats") or {}
            songs[m] = dict(files=fs, gainDb={s: trim(m, s) for s in states},
                            loudness={"mellow": b.get("calm"), "intense": b.get("battle")},
                            scene=fid, lead=it.get("lead"), context=t.get("context"))
    for a in walk_songs:
        at = [dict(to=b, after=e, start=s) for b, c in (F["items"][a].get("cuts") or {}).items() if b in walk_songs
              for e, s in c.get("at", []) if s >= walk_songs[b]["loop"][0] and s + LEN - 1 <= walk_songs[b]["loop"][1]]
        if at:
            cuts[a] = at
    join = {"tight": 2 * XF, "beat": 60 / bpm, "two": 2 * 60 / bpm}[prefs["joins"]]
    man = dict(
        format=FORMAT, project=proj.name, made=datetime.now().isoformat(timespec="seconds"),
        grid=dict(bpm=bpm, beatsPerBar=beats, barSeconds=round(bar_s, 6), bars=N),
        states=states,
        play=dict(
            stay=prefs["stay"], sceneBars=prefs["sceneBars"], waveBars=round(prefs["wave"] * 60 / bar_s, 2),
            restBars=prefs["glueBars"], avoid=4,
            join=dict(seconds=round(join, 4), curve="equal-power", centred=True),
            step=dict(seconds=2 * XF, curve="linear", centred=True),
            stateChange=dict(beats=2, curve="equal-power"),
            matchLevels=dict(on=prefs["match"], withinDb=6, easeBars=2),
            bassSwap=dict(on=prefs["bassSwap"], hz=SWAP_HZ),
            rest=dict(tail=prefs["tail"]),
        ),
        songs=songs,
        walk=dict(bars=N, songs=walk_songs, scenes=scenes, cuts=cuts),
    )
    return man, files


def _same_file(a: Path, b: Path) -> bool:
    if not b.is_file() or a.stat().st_size != b.stat().st_size:
        return False
    h = lambda p: hashlib.sha1(p.read_bytes()).digest()
    return h(a) == h(b)


def readme(proj: P.Project, man: dict) -> str:
    """The README, the template filled with this project's numbers."""
    p, g = man["play"], man["grid"]
    n_songs, n_scenes = len(man["walk"]["songs"]), len(man["walk"]["scenes"])
    n_cuts = sum(len(v) for v in man["walk"]["cuts"].values())
    fill = dict(project=proj.name, songs=n_songs, scenes=n_scenes, cuts=n_cuts, bpm=int(g["bpm"]) if float(g["bpm"]).is_integer() else g["bpm"], beats=g["beatsPerBar"],
                bar=round(g["barSeconds"], 3), bars=g["bars"], stay=p["stay"], scene_bars=p["sceneBars"],
                wave_bars=round(p["waveBars"]), rest_bars=p["restBars"], join=p["join"]["seconds"],
                swap="on" if p["bassSwap"]["on"] else "off", tail=p["rest"]["tail"], intense=man["states"]["intense"], format=FORMAT)
    text = (HERE / "README.md").read_text()
    for k, v in fill.items():  # ({{name}}: the README's code keeps its braces)
        text = text.replace("{{" + k + "}}", str(v))
    return text


def plan(proj: P.Project, link: bool = False) -> dict:
    """What a sync would do: each file it owns, new, changed, the same, or to remove."""
    out = folder(proj)
    man, audio = manifest(proj, link)
    old = Store.read(out / "soundlab.json", {})
    same_man = {k: v for k, v in old.items() if k != "made"} == {k: v for k, v in man.items() if k != "made"}
    if same_man and old.get("made"):
        man["made"] = old["made"]  # (nothing changed: the manifest stays as it is)
    texts = {"soundlab.json": json.dumps(man, indent=1, ensure_ascii=False) + "\n", "README.md": readme(proj, man),
             "walk.js": (HERE / "walk.js").read_text(), "walk.d.ts": (HERE / "walk.d.ts").read_text(),
             "soundlab.schema.json": (HERE / "schema.json").read_text()}
    rows = []
    for name, text in texts.items():
        f = out / name
        state = "new" if not f.exists() else "same" if f.read_text() == text else "changed"
        rows.append(dict(path=name, kind="text", state=state, bytes=len(text.encode())))
    for rel, src in sorted(audio.items()):
        f = out / rel
        if not src.is_file():
            rows.append(dict(path=rel, kind="audio", state="missing", bytes=0, source=str(src)))
            continue
        state = "new" if not f.exists() else "same" if _same_file(src, f) else "changed"
        rows.append(dict(path=rel, kind="audio", state=state, bytes=src.stat().st_size, source=str(src)))
    owned = {f for s in old.get("songs", {}).values() for f in s.get("files", {}).values() if f.startswith("music/")}
    for rel in sorted(owned - set(audio)):
        if (out / rel).exists():
            rows.append(dict(path=rel, kind="audio", state="remove", bytes=(out / rel).stat().st_size))
    count = lambda s: sum(1 for r in rows if r["state"] == s)
    return dict(folder=str(out), link=link, exists=out.exists(), synced=old.get("made"), rows=rows, texts=texts,
                songs=len(man["walk"]["songs"]), scenes=len(man["walk"]["scenes"]), cuts=sum(len(v) for v in man["walk"]["cuts"].values()),
                changes=sum(count(s) for s in ("new", "changed", "remove")), missing=count("missing"),
                bytes=sum(r["bytes"] for r in rows if r["kind"] == "audio" and r["state"] != "remove"),
                write_bytes=sum(r["bytes"] for r in rows if r["state"] in ("new", "changed")))


def apply(proj: P.Project, link: bool = False) -> dict:
    """Write what the plan says, and nothing else."""
    p = plan(proj, link)
    out = Path(p["folder"])
    for r in p["rows"]:
        f = out / r["path"]
        if r["state"] in ("new", "changed"):
            f.parent.mkdir(parents=True, exist_ok=True)
            if r["kind"] == "text":
                tmp = f.with_name(f.name + ".tmp")
                tmp.write_text(p["texts"][r["path"]])
                os.replace(tmp, f)
            else:
                shutil.copyfile(r["source"], f)
        elif r["state"] == "remove":
            f.unlink(missing_ok=True)
    return plan(proj, link)


def run(proj: P.Project, do_apply: bool = False, link: bool = False) -> int:
    """`soundlab sync`: the plan, and with --apply, the sync."""
    try:
        p = apply(proj, link) if do_apply else plan(proj, link)
    except RuntimeError as e:
        print(e)
        return 1
    mb = lambda b: f"{b / 1e6:.1f} MB"
    print(f"{'synced' if do_apply else 'would sync'} {p['songs']} songs in {p['scenes']} scenes to {p['folder']}"
          f" ({mb(p['bytes'])} of audio{', linked where the game has it' if link else ''})")
    if do_apply:
        print("done: everything is the same as the lab's" if not p["changes"] else f"{p['changes']} still differ")
        return 0
    for state in ("new", "changed", "remove", "missing"):
        rs = [r for r in p["rows"] if r["state"] == state]
        if not rs:
            continue
        audio = [r for r in rs if r["kind"] == "audio"]
        print(f"  {state}: " + ", ".join(r["path"] for r in rs if r["kind"] == "text")
              + (f"{', ' if len(rs) > len(audio) else ''}{len(audio)} audio files ({mb(sum(r['bytes'] for r in audio))})" if audio else ""))
    print(f"nothing to do: the folder is in sync" if not p["changes"] else f"run with --apply to write it ({mb(p['write_bytes'])})")
    return 0

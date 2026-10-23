"""The game's folder (2026-10-21, the designer: "this app should allow you to sync with a game's source as a folder and
maybe include json/code/docs ... so the game knows how to plug it in. It should be agnostic"). One folder in the game,
the lab's own, holding everything a game needs to play its music as the Mixer plays it, in no engine's terms:

  soundlab.json          the manifest: the grid, the playback rules, each shipped song's files and levels, and the
                         walk's music (songs, scenes, cuts)
  soundlab.schema.json   its JSON Schema
  walk.js, walk.d.ts     the scene walk (web-app/src/mixer/engine/scenewalk.ts, built): where the music goes next; the
                         Mixer walks the graph with the same code
  README.md              how to plug it in, for any engine
  music/<song>.<state>.ogg   each shipped song's mellow and intense levels
  glues/<glue>.ogg       the pads between scenes (music glues), when the Mixer goes from scene to scene through a pad

Audio goes in on demand, a batch at a time (the designer: "when you are happy with a big ol' batch, you can move it over
to the source, optionally keep a local copy, and have your next batch separate and local. Those tracks would be
shipped"): `ship` copies the songs chosen into the folder, records them in the project's data (shipped.json), and can
drop the lab's own copy of what it shipped (the lab then plays it from the game's folder). The ready ones are the songs
the lab has that the game doesn't: shipped with `music promote` before, or new takes the designer kept (Keep, a new
family, belongs with a scene, liked). Everything else stays local, the next batch.

`sync` writes the manifest, the walk, the docs and the schema, for the songs whose audio is in the folder: only what
differs, and nothing else in the folder. Both are dry runs until applied (--apply, or the Game page's buttons).
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
DEFAULTS = dict(intense="battle", glue="breaths", glueKind="rest", glueBars=1, tail="taper", stay=12, joins="two", match=True, even=True, bassSwap=False,
                sceneBars=48, wave=8)


def folder(proj: P.Project) -> Path:
    """Where the project syncs to: its `sync`, else <game root>/soundlab."""
    return Path(getattr(proj, "sync", None) or Path(proj.root) / "soundlab")


def _shipped_path(proj: P.Project) -> Path:
    return proj.data / "shipped.json"


def shipped(proj: P.Project) -> dict:
    """The songs shipped into the folder, batch by batch: {song: {at, files: {state: path in the folder}, local: {state:
    the lab's URL it came from}, kept: whether the lab kept its own copy, kind}}."""
    return Store.read(_shipped_path(proj), {})


def _source(proj: P.Project, url: str) -> Path:
    """The file behind one of the player's URLs (/clips/: the lab's work; /shipped/: the game's assets)."""
    if url.startswith("/clips/"):
        return proj.work / "clips" / url[len("/clips/"):]
    if url.startswith("/shipped/"):
        return Path(proj.assets) / url[len("/shipped/"):]
    raise ValueError(url)


def local_copy(proj: P.Project, url: str) -> Path | None:
    """Where the game's folder has a shipped song's audio that the lab no longer keeps itself (the server plays it from
    there), or None."""
    for s in shipped(proj).values():
        for state, u in s.get("local", {}).items():
            if u == url and state in s.get("files", {}):
                return folder(proj) / s["files"][state]
    return None


class _Lab:
    """What the lab knows of its songs, for the manifest and the batches: the shipped tracks (music promote) with their
    measures, every song the families measured (shipped, candidates, trial takes, extensions) with its energy, scene and
    audio, the votes and cues, and the Mixer's settings."""

    def __init__(self, proj: P.Project):
        if not proj.music:
            raise RuntimeError("this project has no music")
        st, lib = Store(proj), library(proj)
        self.proj, self.lib = proj, lib
        votes = st.votes()
        self.clips, self.cues = votes.get("clips", {}), votes.get("cues", {})
        self.prefs = DEFAULTS | {k: v for k, v in Store.read(st.mixer_settings_path, {}).items() if k in DEFAULTS}
        self.F = Store.read(proj.work / "families.json", {"items": {}, "families": {}})
        self.N, self.bpm, self.bar_beats = lib["bars"], lib["bpm"], lib["bar_beats"]
        self.tracks = {t["id"]: t for t in lib["tracks"]}
        self.states = {"mellow": "calm", "intense": self.prefs["intense"]}
        self.scene_of = {m: fid for fid, f in self.F.get("families", {}).items() for m in f.get("members", [])}
        # (even levels, as the Mixer: each song's median beat against the shipped songs' median, within 6 dB; judge.ts trimDb)
        self.ref = {s: statistics.median(v) if (v := [statistics.median(b) for t in self.tracks if (b := (self.measure(t).get("beats") or {}).get("calm" if s == "mellow" else "battle"))]) else None
                    for s in self.states}

    def measure(self, sid: str) -> dict:
        return (self.tracks.get(sid) or {}).get("measure") or {}

    def beats(self, sid: str, lv: str) -> list[float] | None:
        """A song's loudness per beat at a level (calm or battle): music trims' measure, else measured here from its file
        and kept in work/levels.json (new takes: as the player measures them, web-app/src/mixer/buffers.ts measureBeats)."""
        b = (self.measure(sid).get("beats") or {}).get(lv)
        if b:
            return b
        src = (self.tracks.get(sid) or {}).get("src") or (self.F["items"].get(sid) or {}).get("src") or {}
        url = src.get(lv) or src.get("calm")
        if not url:
            return None
        f = _source(self.proj, url)
        if not f.is_file():
            return None
        sig, key = f"{f.stat().st_size}:{f.stat().st_mtime_ns}", str(f)
        if not hasattr(self, "_levels"):
            self._levels = Store.read(self.proj.work / "levels.json", {})
        if self._levels.get(key, {}).get("sig") != sig:
            from .. import dsp
            from ..music.measures import _beats
            self._levels[key] = dict(sig=sig, beats=_beats(dsp.decode(f), int(round(60.0 / self.bpm * dsp.SR))))
            Store.write(self.proj.work / "levels.json", self._levels)
        return self._levels[key]["beats"]

    def level(self, sid: str, state: str) -> float | None:
        b = self.beats(sid, "calm" if state == "mellow" else "battle")
        return statistics.median(b) if b else None

    def trim(self, sid: str, state: str) -> float:
        v, r = self.level(sid, state), self.ref[state]
        return 0.0 if not self.prefs["even"] or v is None or r is None else round(max(-6.0, min(6.0, r - v)), 2)

    def cue(self, sid: str) -> list[int]:
        c = (self.cues.get(sid) or {}).get("mellow")
        if c:
            return list(c)
        g = ((self.measure(sid).get("cuts") or {}).get("calm") or [{}])[0].get("bars")
        return list(g) if g else [1, self.N]

    def phrase(self, sid: str) -> int | None:
        ph = self.measure(sid).get("phrase")
        return ph["start"] if ph and ph.get("contrast", 0) >= 0.08 else None

    def entry(self, sid: str) -> int:
        lo, hi = self.cue(sid)
        ph = self.phrase(sid)
        return lo if ph is None else next((b for b in range(lo, hi + 1) if (b - ph) % LEN == 0), lo)

    def urls(self, sid: str) -> dict[str, str] | None:
        """Each state's audio as the Mixer plays it (a shipped track's retuned copy where there is one; a song without
        that level: its calm), or None when the lab has none."""
        src = (self.tracks.get(sid) or {}).get("src") or (self.F["items"].get(sid) or {}).get("src") or {}
        if not src.get("calm"):
            return None
        return {s: src.get(lv) or src.get("battle") or src["calm"] for s, lv in self.states.items()}

    def kind(self, sid: str) -> str:
        return "shipped" if sid in self.tracks else (self.F["items"].get(sid) or {}).get("kind", "candidate")

    def bad(self, sid: str) -> bool:
        return self.clips.get(f"ok_{sid}", 0) < 0

    def kept(self, sid: str) -> bool:
        """A new take the designer kept: Keep, a new family, belongs with a scene, or liked on the Music page."""
        it = self.F["items"].get(sid) or {}
        c = self.clips
        return (c.get(f"ok_{sid}", 0) > 0 or c.get(f"novel_{sid}", 0) > 0 or c.get(f"novel_{it.get('set')}.{it.get('take')}", 0) > 0
                or any(k.startswith(f"link_{sid}|") and v > 0 for k, v in c.items())
                or any(k.startswith(f"mesh_{it.get('set')}.{it.get('take')}.") and v > 0 for k, v in c.items()))

    def walkable(self, sid: str) -> bool:
        return sid in self.scene_of and (self.F["items"].get(sid) or {}).get("energy") is not None and not self.bad(sid)


def manifest(proj: P.Project, lab: _Lab | None = None, preview: list[str] | None = None) -> dict:
    """The manifest, for the songs whose audio is in the folder. The walk's music is made as the Mixer makes it
    (web-app/src/mixer/engine/graph.ts Graph.data): a scene's members that aren't bad takes, each one's loop (the
    designer's mellow cues, else the guessed ones), entry (its first phrase start in the loop), phrase and energy, and the
    cuts that land inside the other song's loop with a phrase's room.

    `preview`: the manifest the game would have with these songs shipped too, written nowhere, its files the player's
    URLs (2026-10-23, the designer: "is there a 'Play exactly what you would hear in game' option?"): the Game page plays
    it. A song in the game already plays from the URL it was shipped from (the server finds it in the game's folder when
    the lab no longer keeps it)."""
    L = lab or _Lab(proj)
    out, ship = folder(proj), shipped(proj)
    have = {sid: s["files"] for sid, s in ship.items() if all((out / f).is_file() for f in s["files"].values())}
    if preview is not None:
        have = {sid: ship[sid].get("local") or L.urls(sid) for sid in have}
        have |= {sid: u for sid in preview if sid not in have and L.walkable(sid) and (u := L.urls(sid))}
    songs, scenes, cuts, walk_songs = {}, {}, {}, {}
    between = "straight" if L.prefs["glue"] == "off" else "pad" if L.prefs["glueKind"] == "pad" else "rest"  # (the Mixer's Between scenes)
    pads = between == "pad"
    for fid, fam in L.F.get("families", {}).items():
        ms = [m for m in fam.get("members", []) if m in have and L.walkable(m)]
        if not ms:
            continue
        scenes[fid] = dict(members=ms)
        for m in ms:
            it = L.F["items"][m]
            walk_songs[m] = dict(loop=L.cue(m), entry=L.entry(m), phrase=L.phrase(m), energy=it["energy"])
            gid = (L.tracks.get(m) or {}).get("glue")
            pad = pads and gid in L.lib.get("glues", {}) and L.clips.get(f"glue_{gid}", 0) >= 0
            glue = None if not pad else f"/clips/{L.lib['glues'][gid]['file']}" if preview is not None else f"glues/{gid}.ogg"
            songs[m] = dict(files=have[m], glue=glue, gainDb={s: L.trim(m, s) for s in L.states},
                            loudness={"mellow": L.beats(m, "calm"), "intense": L.beats(m, "battle")},
                            scene=fid, lead=it.get("lead"), context=it.get("context"))
    for a in walk_songs:
        at = [dict(to=b, after=e, start=s) for b, c in (L.F["items"][a].get("cuts") or {}).items() if b in walk_songs
              for e, s in c.get("at", []) if s >= walk_songs[b]["loop"][0] and s + LEN - 1 <= walk_songs[b]["loop"][1]]
        if at:
            cuts[a] = at
    p, bar_s = L.prefs, 60 / L.bpm * L.bar_beats
    join = {"tight": 2 * XF, "beat": 60 / L.bpm, "two": 2 * 60 / L.bpm}[p["joins"]]
    return dict(
        format=FORMAT, project=proj.name, made=datetime.now().isoformat(timespec="seconds"),
        grid=dict(bpm=L.bpm, beatsPerBar=L.bar_beats, barSeconds=round(bar_s, 6), bars=L.N),
        states=L.states,
        play=dict(
            stay=p["stay"], sceneBars=p["sceneBars"], waveBars=round(p["wave"] * 60 / bar_s, 2), restBars=p["glueBars"], avoid=4,
            join=dict(seconds=round(join, 4), curve="equal-power", centred=True),
            step=dict(seconds=2 * XF, curve="linear", centred=True),
            stateChange=dict(beats=2, curve="equal-power"),
            matchLevels=dict(on=p["match"], withinDb=6, easeBars=2),
            bassSwap=dict(on=p["bassSwap"], hz=SWAP_HZ),
            betweenScenes=between,
            rest=dict(tail=p["tail"]),
        ),
        songs=songs,
        walk=dict(bars=L.N, songs=walk_songs, scenes=scenes, cuts=cuts),
    )


def readme(proj: P.Project, man: dict) -> str:
    """The README, the template filled with this project's numbers ({{name}}: the README's code keeps its braces)."""
    p, g = man["play"], man["grid"]
    fill = dict(project=proj.name, songs=len(man["walk"]["songs"]), scenes=len(man["walk"]["scenes"]),
                cuts=sum(len(v) for v in man["walk"]["cuts"].values()),
                bpm=int(g["bpm"]) if float(g["bpm"]).is_integer() else g["bpm"], beats=g["beatsPerBar"],
                bar=round(g["barSeconds"], 3), bars=g["bars"], stay=p["stay"], scene_bars=p["sceneBars"],
                wave_bars=round(p["waveBars"]), rest_bars=p["restBars"], join=p["join"]["seconds"],
                swap="on" if p["bassSwap"]["on"] else "off", tail=p["rest"]["tail"], intense=man["states"]["intense"], format=FORMAT,
                between=p["betweenScenes"], between_words={"straight": "straight on, no break", "pad": f"a pad of {p['restBars']} bar(s) between them",
                                                           "rest": f"a rest of {p['restBars']} bar(s) between them"}[p["betweenScenes"]])
    text = (HERE / "README.md").read_text()
    for k, v in fill.items():
        text = text.replace("{{" + k + "}}", str(v))
    return text


def plan(proj: P.Project) -> dict:
    """Where the folder stands: its texts against the lab's (new, changed, the same), the songs in it (and any whose audio
    has gone), and the batch ready to ship."""
    L, out = _Lab(proj), folder(proj)
    man = manifest(proj, L)
    old = Store.read(out / "soundlab.json", {})
    if {k: v for k, v in old.items() if k != "made"} == {k: v for k, v in man.items() if k != "made"} and old.get("made"):
        man["made"] = old["made"]  # (nothing changed: the manifest stays as it is)
    texts = {"soundlab.json": json.dumps(man, indent=1, ensure_ascii=False) + "\n", "README.md": readme(proj, man),
             "walk.js": (HERE / "walk.js").read_text(), "walk.d.ts": (HERE / "walk.d.ts").read_text(),
             "soundlab.schema.json": (HERE / "schema.json").read_text()}
    rows = []
    for name, text in texts.items():
        f = out / name
        state = "new" if not f.exists() else "same" if f.read_text() == text else "changed"
        rows.append(dict(path=name, state=state, bytes=len(text.encode())))
    owned = {f for v in old.get("stingers", {}).values() for f in v}  # (audio an older sync wrote that nothing ships now: removed)
    owned_glues = {s.get("glue") for s in old.get("songs", {}).values() if s.get("glue")}  # (the pads the last sync wrote)
    for s in man["songs"].values():
        if s.get("glue"):
            gid = s["glue"][len("glues/"):-len(".ogg")]
            src = proj.work / "clips" / L.lib["glues"][gid]["file"]
            if src.is_file() and not any(r["path"] == s["glue"] for r in rows):
                state = "new" if not (out / s["glue"]).exists() else "same" if _same(src, out / s["glue"]) else "changed"
                rows.append(dict(path=s["glue"], state=state, bytes=src.stat().st_size, source=str(src)))
            owned_glues.discard(s["glue"])
    for rel in sorted(owned | owned_glues):
        if (out / rel).exists():
            rows.append(dict(path=rel, state="remove", bytes=(out / rel).stat().st_size))
    ship = shipped(proj)
    size = lambda files: sum((out / f).stat().st_size for f in files.values() if (out / f).is_file())
    in_game = [dict(id=sid, kind=s.get("kind"), scene=L.scene_of.get(sid), at=s.get("at"), kept=s.get("kept", True),
                    bytes=size(s["files"]), missing=[f for f in s["files"].values() if not (out / f).is_file()],
                    walked=sid in man["walk"]["songs"]) for sid, s in ship.items()]
    ready, local = [], 0
    for sid in sorted(set(L.tracks) | set(L.F["items"])):
        if sid in ship or not L.walkable(sid) or not (urls := L.urls(sid)):
            continue
        if L.kind(sid) != "shipped" and not L.kept(sid):
            local += 1  # (not judged yet, or not kept: the next batch's)
            continue
        srcs = [_source(proj, u) for u in urls.values()]
        ready.append(dict(id=sid, kind=L.kind(sid), scene=L.scene_of[sid], energy=L.F["items"][sid]["energy"],
                          lead=(L.F["items"][sid] or {}).get("lead"), bytes=sum(p.stat().st_size for p in srcs if p.is_file()),
                          missing=[str(p) for p in srcs if not p.is_file()]))
    return dict(folder=str(out), exists=out.exists(), synced=old.get("made"), rows=rows, texts=texts,
                songs=len(man["walk"]["songs"]), scenes=len(man["walk"]["scenes"]), cuts=sum(len(v) for v in man["walk"]["cuts"].values()),
                changes=sum(1 for r in rows if r["state"] != "same"), in_game=in_game, ready=ready, local=local,
                bytes=sum(s["bytes"] for s in in_game))


def write(proj: P.Project) -> dict:
    """Sync the texts: what differs, and nothing else."""
    p = plan(proj)
    out = Path(p["folder"])
    for r in p["rows"]:
        f = out / r["path"]
        if r["state"] == "remove":
            f.unlink(missing_ok=True)
        elif r["state"] != "same":
            f.parent.mkdir(parents=True, exist_ok=True)
            if "source" in r:  # (a pad's audio)
                shutil.copyfile(r["source"], f)
                continue
            tmp = f.with_name(f.name + ".tmp")
            tmp.write_text(p["texts"][r["path"]])
            os.replace(tmp, f)
    return plan(proj)


def _same(a: Path, b: Path) -> bool:
    if not b.is_file() or a.stat().st_size != b.stat().st_size:
        return False
    return hashlib.sha1(a.read_bytes()).digest() == hashlib.sha1(b.read_bytes()).digest()


def ship(proj: P.Project, ids: list[str], keep: bool = True) -> dict:
    """A batch into the game: each song's mellow and intense audio (as the Mixer plays it) copied into the folder's
    music/, recorded in shipped.json, then the texts synced. Without `keep`, the lab's own copy of what it shipped goes:
    only files in the lab's work (never the game's assets), and the lab plays the song from the folder after."""
    L, out = _Lab(proj), folder(proj)
    record, now = shipped(proj), datetime.now().isoformat(timespec="seconds")
    for sid in ids:
        urls = L.urls(sid)
        if not urls or not L.walkable(sid):
            raise RuntimeError(f"{sid}: not a song the lab can ship (no audio, no scene, or a bad take)")
        files = {}
        for state, url in urls.items():
            src, rel = _source(proj, url), f"music/{sid}.{state}.ogg"
            if not src.is_file():
                raise RuntimeError(f"{sid}: {src} is missing")
            if not _same(src, out / rel):
                (out / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, out / rel)
            files[state] = rel
        record[sid] = dict(at=now, kind=L.kind(sid), files=files, local=urls, kept=keep)
        Store.write(_shipped_path(proj), record, sort=True)  # (after each song: a batch stopped halfway is recorded as far as it went)
    if not keep:
        work = proj.work.resolve()
        for sid in ids:
            for url in record[sid]["local"].values():
                src = _source(proj, url)
                if url.startswith("/clips/") and src.resolve().is_relative_to(work) and src.is_file():
                    src.unlink()
    return write(proj)


def run(proj: P.Project, do_apply: bool = False) -> int:
    """`soundlab sync`: where the folder stands, and with --apply, the texts written."""
    try:
        p = write(proj) if do_apply else plan(proj)
    except RuntimeError as e:
        print(e)
        return 1
    mb = lambda b: f"{b / 1e6:.1f} MB"
    print(f"{p['folder']}: {len(p['in_game'])} songs shipped ({mb(p['bytes'])}), {p['songs']} walked in {p['scenes']} scenes, {p['cuts']} cuts")
    for r in p["rows"]:
        if r["state"] != "same":
            print(f"  {r['state']}: {r['path']}")
    gone = [s for s in p["in_game"] if s["missing"]]
    if gone:
        print(f"  {len(gone)} shipped songs have lost audio in the folder: " + ", ".join(s["id"] for s in gone[:5]))
    print(f"ready to ship: {len(p['ready'])} songs ({mb(sum(r['bytes'] for r in p['ready']))}); {p['local']} more stay local until kept"
          + ("" if not p["ready"] else " (soundlab ship --all, or the Game page)"))
    print("the texts are in sync" if not p["changes"] else "written" if do_apply else "run with --apply to write the texts")
    return 0


def run_ship(proj: P.Project, ids: list[str], all_ready: bool, drop_local: bool, do_apply: bool) -> int:
    """`soundlab ship`: a batch into the game (a dry run without --apply)."""
    try:
        p = plan(proj)
    except RuntimeError as e:
        print(e)
        return 1
    ready = {r["id"]: r for r in p["ready"]}
    todo = list(ready) if all_ready else ids
    unknown = [i for i in todo if i not in ready]
    if unknown:
        print("not ready to ship (unknown, not kept, or shipped already): " + ", ".join(unknown))
        return 1
    if not todo:
        print("nothing to ship: pass song ids or --all")
        return 1
    mb = sum(ready[i]["bytes"] for i in todo) / 1e6
    if not do_apply:
        print(f"would ship {len(todo)} songs ({mb:.1f} MB) into {p['folder']}" + (", dropping the lab's own copies" if drop_local else "")
              + "\nrun with --apply to ship them")
        return 0
    ship(proj, todo, keep=not drop_local)
    print(f"shipped {len(todo)} songs ({mb:.1f} MB) into {p['folder']}")
    return 0

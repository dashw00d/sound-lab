"""The lab's web app and API (standard library only).

  GET  /                    the app (soundlab/web)
  GET  /api/state           {project, index, votes, shipped}: every take, prompt, set and vote, and the take each
                            sound last shipped from (promoted.json)
  GET  /api/stamp           {index, votes, promoted, tuning}: when those files last changed (the app polls it for news)
  GET  /api/songs           every shipped music track: its level files (under /shipped/), provenance and song group
  GET  /api/mixes           the Mixer page's saved sets: {name: {parts: [{track, start, bars}], at}}
  POST /api/mixes           {name, parts | null}: save a set of parts under a name (null: delete it)
  GET  /api/mixer           the Mixer's settings (data/mixer.json), so they're the same in any browser
  GET  /api/sync            the game's folder (soundlab/sync): its texts against the lab's, the songs shipped into it, the
                            batch ready to ship, and the README
  POST /api/sync            write the texts (manifest, walk, docs, schema) into the game's folder (the designer's button)
  POST /api/sync/ship       {ids, keep}: ship a batch into the game's folder (the designer's button)
  POST /api/mixer           {settings}: save them
  GET  /api/votes           votes.json alone
  GET  /api/families        every song sorted into families, and the queue of what to judge next (work/families.json)
  POST /api/families/rebuild   sort the families again now (in the background; /api/stamp's "families" changes when done)
  GET  /api/streams         the Mixer's listening sessions (data/streams.json), for the review of low-rated blocks
  POST /api/review          {stream, block, piece, mode, note?}: the piece the designer marked as what spoiled a block
  POST /api/stream          {id, settings, stream}: a Mixer listening session, in the order it played: each block
                            (a part of a song, a glue or a fill) with its stars (1-5) and each transition with its thumb
  GET  /api/tuning          {tuning, base, evidence, ...}: the prompt tuning (tuning.json) and what this project's votes say
  POST /api/tuning          {base, tuning}: save it; 409 with the current one if it changed since `base` (an agent wrote it)
  POST /api/vote            {clip, value: 1|-1|0} | {sound, pick: id|"shipped"|null} | {picks: {sound: id|null}}
                            | {sound, note} | {sound, variant, prompt_note, prompt}: a note on one prompt's takes
                            | {cue: track, level: "mellow"|"intense", bars: [start, end] | null}: the Songs page's cues
  GET  /api/balance         {balance (work/balance.json), mix (the game's mix file), version (1 or 2: the mix file's
                            kind, which the page follows), base (the mix file's stamp)}
  POST /api/mix             {base, version, mix}: the mix's levels; written to the game's mix file (the game re-reads
                            it live): for a sound table, only the dBs change. 409 if the file changed since `base`;
                            {mix (as written), base} on success
  GET  /clips/<path>        a take (work/clips)
  GET  /shipped/<path>      a shipped file (the project's assets)

Bound to a loopback address, it answers only requests addressed to one (so a DNS-rebinding page can't reach it),
and it takes writes only as JSON from its own origin (so another website open in the browser can't post to it).

Errors are JSON, {"error": message}: 400 for a request that isn't valid, 404, 409 for a stale write, 500 for the rest
(its traceback goes to the server's stderr).
"""
from __future__ import annotations

import json
import math
import mimetypes
import re
import sys
import threading
import traceback
from datetime import date, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from . import paths, project as P, tuning
from .store import Store

mimetypes.add_type("audio/ogg", ".ogg")
mimetypes.add_type("audio/wav", ".wav")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("image/svg+xml", ".svg")
LOCK = threading.Lock()
REBUILD = threading.Lock()  # (a families sort running)
LOOPBACK = {"127.0.0.1", "localhost", "[::1]", "::1"}


class HttpError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


def _inside(base: Path, rel: str) -> Path | None:
    try:
        p = (base / rel).resolve()
        return p if p.is_relative_to(base.resolve()) and p.is_file() else None
    except (ValueError, OSError):  # (a NUL in the name, a name too long)
        return None


def _byte_range(header: str, size: int):
    """The (start, end) of a single satisfiable `bytes=` range; None when there's no usable range (send the whole file:
    absent, malformed or several ranges); False when it lies past the end (416)."""
    m = re.fullmatch(r"bytes=(\d{0,18})-(\d{0,18})", header.strip(), re.I | re.A)
    if not m or not (m[1] or m[2]):
        return None
    if not m[1]:  # (the last n bytes)
        n = int(m[2])
        return (max(0, size - n), size - 1) if n and size else False
    start, end = int(m[1]), int(m[2]) if m[2] else size - 1
    if m[2] and end < start:
        return None
    return (start, min(end, size - 1)) if start < size else False


def _num(v, what: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float, str)):
        raise HttpError(400, f"{what}: expected a number of dB")
    try:
        x = float(v)
    except ValueError:
        raise HttpError(400, f"{what}: expected a number of dB, got {v!r}") from None
    if not math.isfinite(x) or abs(x) > 200:
        raise HttpError(400, f"{what}: {v!r} dB is out of range")
    return round(x, 2)


def _section(d: dict, key: str) -> dict:
    v = d.get(key, {})
    if not isinstance(v, dict):
        raise HttpError(400, f"the mix's {key!r} must be an object")
    return v


def _version(mix) -> int:
    v = mix.get("version", 1) if isinstance(mix, dict) else 1
    return 2 if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 2 else 1


def make_handler(proj: P.Project, host: str = "127.0.0.1"):
    st = Store(proj)
    mix_path = Path(proj.balance["mix"]) if proj.balance else None

    def mix_stamp() -> str:  # (a string: nanoseconds don't survive a trip through a JavaScript number)
        return str(mix_path.stat().st_mtime_ns) if mix_path and mix_path.exists() else "0"

    def candidate_scores() -> dict:  # (music candidates' scores for the Music page, without the measurements)
        c = Store.read(proj.work / "candidates.json", {})
        keep = ("pick", "pick_beats", "nice", "nice_beats", "catchy", "catchy_in_style", "unique", "nearest", "rank", "notes_per_bar")
        return dict(made=c.get("made"), songs=c.get("library", {}).get("songs"),
                    takes={k: {x: v.get(x) for x in keep} for k, v in c.get("takes", {}).items()})

    info = dict(name=proj.name, root=str(proj.root), features=dict(
        alerts=bool(proj.alerts), music=bool(proj.music), balance=bool(proj.balance)),
        instruments={k: v["name"] for k, v in (proj.music or {}).get("instruments", {}).items()},
        default_profile=(proj.music or {}).get("default_profile"))

    class Handler(BaseHTTPRequestHandler):
        _started = False  # (the response's headers are out: an error can no longer be sent)

        def log_message(self, *_):
            pass

        def end_headers(self):
            self._started = True
            super().end_headers()

        def send_error(self, code, message=None, explain=None):
            if self._started:
                self.close_connection = True
                return
            body = json.dumps(dict(error=message or HTTPStatus(code).phrase)).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            if self.command != "HEAD":
                self.wfile.write(body)

        def send_json(self, obj, status=200):
            body = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def guard(self, fn, bad_input=()):
            """Run a request; any error becomes a JSON {error} with its status (400 for `bad_input` errors, 500 otherwise)."""
            self._started = False
            try:
                fn()
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True
            except HttpError as e:
                self.send_error(e.code, str(e))
            except bad_input as e:
                traceback.print_exc(file=sys.stderr)
                self.send_error(400, f"missing {e}" if isinstance(e, KeyError) else f"bad request: {e}")
            except Exception as e:
                print(f"{self.command} {self.path}: {type(e).__name__}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
                self.send_error(500, f"{type(e).__name__}: {e}")

        def send_page(self):
            """The app's page, each script and stylesheet it loads stamped with its file's time (?v=...): a reload after an
            edit fetches the new file rather than a copy the browser kept (cache busting)."""
            def stamp(m):
                f = _inside(paths.WEB, m.group(2))
                return f"{m.group(1)}/web/{m.group(2)}?v={f.stat().st_mtime_ns if f else 0}{m.group(3)}"
            body = re.sub(r'((?:src|href)=")/web/([^"?]+\.(?:js|css))(")', stamp, (paths.WEB / "index.html").read_text()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def send_file(self, path: Path | None):
            if path is None:
                self.send_error(404)
                return
            size = path.stat().st_size
            start, end, status = 0, size - 1, 200
            rng = _byte_range(self.headers.get("Range", ""), size)  # audio elements seek and loop with range requests
            if rng is False:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if rng:
                start, end = rng
                status = 206
            self.send_response(status)
            self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "no-cache")  # (the browser checks back each time: an edited page or a remade file is picked up on reload)
            self.send_header("Content-Length", str(max(0, end - start + 1)))
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)

        def foreign(self) -> bool:
            """A request from another website (its Origin isn't ours), or addressed to a name that isn't loopback."""
            where = self.headers.get("Host") or ""
            name = where.strip().lower()
            name = name[:name.index("]") + 1] if name.startswith("[") and "]" in name else name if name.count(":") > 1 else name.partition(":")[0]
            if host in LOOPBACK and name not in LOOPBACK:
                return True
            origin = self.headers.get("Origin")
            return bool(origin) and urlparse(origin).netloc != where

        def body(self) -> dict:
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                raise HttpError(400, "bad Content-Length") from None
            if not 0 <= n <= 32 << 20:
                raise HttpError(400, "the request body is too large" if n > 0 else "bad Content-Length")
            try:
                msg = json.loads(self.rfile.read(n) or b"{}")
            except ValueError as e:  # (not JSON, or not UTF-8)
                raise HttpError(400, f"the request body isn't valid JSON: {e}") from None
            if not isinstance(msg, dict):
                raise HttpError(400, "the request body must be a JSON object")
            return msg

        def do_GET(self):
            self.guard(self.get)

        def do_POST(self):
            self.guard(self.post, (KeyError, ValueError, TypeError, AttributeError))

        def get(self):
            if self.foreign():
                self.send_error(403, "addressed to a non-loopback host or from another origin")
                return
            url = unquote(urlparse(self.path).path)
            if url in ("/", "/index.html"):
                self.send_page()
            elif url.startswith("/web/"):
                self.send_file(_inside(paths.WEB, url[5:]))
            elif url == "/app" or url.startswith("/app/"):  # (the TS + React app: its files, else its page, for its own routes)
                rel = url[5:]
                f = _inside(paths.WEBAPP, rel) if rel else None
                self.send_file(f if f and f.is_file() else _inside(paths.WEBAPP, "index.html"))
            elif url == "/api/state":
                with LOCK:
                    shipped = {n: p.get("clip") for n, p in Store.read(st.promoted_path, {}).items()}
                    self.send_json(dict(project=info, index=st.index(), votes=st.votes(), shipped=shipped, candidates=candidate_scores()))
            elif url == "/api/project":  # (the project alone: what the new app needs to start, not the 750 KB state)
                self.send_json(info)
            elif url == "/api/stamp":
                self.send_json({k: str(p.stat().st_mtime_ns) if p.exists() else "0"  # (strings: exact in JavaScript)
                                for k, p in (("index", st.index_path), ("votes", st.votes_path), ("promoted", st.promoted_path), ("tuning", tuning.PATH),
                                             ("candidates", proj.work / "candidates.json"), ("families", proj.work / "families.json"),
                                             ("streams", st.streams_path))})
            elif url == "/api/songs":
                if not proj.music:
                    raise HttpError(404, "this project has no music")
                from . import candidates, music
                with LOCK:  # (the new takes, scored, ride along: the Mixer adds them to the walk when asked)
                    from .music import stingers
                    self.send_json(music.library(proj) | dict(candidates=candidates.mixer_tracks(proj), stingers=stingers.takes(proj)))
            elif url == "/api/votes":  # (the decisions alone, without the index: what the new app's pages poll)
                self.send_json(st.votes())
            elif url == "/api/families":
                f = Store.read(proj.work / "families.json", {})
                for it in f.get("items", {}).values():
                    it.pop("feat", None)  # (the measurements stay on the server)
                self.send_json(f)
            elif url == "/api/streams":
                self.send_json(dict(streams=Store.read(st.streams_path, {}), reviews=Store.read(st.reviews_path, [])))
            elif url == "/api/mixer":
                self.send_json(Store.read(st.mixer_settings_path, {}))
            elif url == "/api/sync":
                from . import sync
                with LOCK:
                    p = sync.plan(proj)
                self.send_json({k: v for k, v in p.items() if k != "texts"} | dict(readme=p["texts"]["README.md"]))
            elif url == "/api/mixes":
                with LOCK:
                    self.send_json(Store.read(st.mixes_path, {}))
            elif url == "/api/tuning":
                with LOCK:
                    self.send_json(dict(tuning=tuning.load(), base=tuning.stamp(), path=str(tuning.PATH), evidence=tuning.evidence(proj),
                                        tasks=tuning.TASKS, commands=tuning.COMMANDS, engines=tuning.ENGINES))
            elif url == "/favicon.ico":
                self.send_file(paths.WEB / "img" / "favicon.png")
            elif url == "/api/balance":
                mix = Store.read(mix_path, {}) if mix_path else {}  # (the page follows the mix file's kind, and saves against its stamp)
                self.send_json(dict(balance=Store.read(st.balance_path, {}), mix=mix, version=_version(mix), base=mix_stamp()))
            elif url.startswith("/clips/"):
                f = _inside(st.clips, url[7:])
                if f is not None and not f.is_file():  # (a song shipped without the lab keeping its copy: the game's folder has it)
                    from . import sync
                    f = sync.local_copy(proj, url) or f
                self.send_file(f)
            elif url.startswith("/shipped/"):
                self.send_file(_inside(proj.assets, url[9:]))
            else:
                self.send_error(404)

        def post(self):
            if self.foreign() or self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                self.send_error(403, "writes are taken only as JSON from this page's own origin")
                return
            url = urlparse(self.path).path
            if url == "/api/mix" and mix_path:
                msg = self.body()
                mix = msg.get("mix")
                if not isinstance(mix, dict):
                    raise HttpError(400, "no mix levels to save")
                with LOCK:
                    cur = Store.read(mix_path, {})
                    if str(msg.get("base")) != mix_stamp():  # (an agent or the game's tools wrote it since this page read it)
                        self.send_json(dict(error="the mix file changed since this page loaded it: reload to see it", base=mix_stamp()), 409)
                        return
                    if not isinstance(cur, dict):
                        raise HttpError(500, "the mix file isn't a JSON object")
                    if msg.get("version") != _version(cur):
                        raise HttpError(400, f"this page and the mix file disagree about its kind (version {msg.get('version')} vs {_version(cur)}): reload the page")
                    if _version(cur) >= 2:
                        # A sound table: only the levels change (bus, category, event and music dBs); every other field
                        # of the table (files, categories' voices and spaces, ducks, the positional model) stays.
                        # (all checked before anything is changed, so a bad payload writes nothing)
                        buses = {b: _num(v, f"bus {b}") for b, v in _section(mix, "buses").items()}
                        cats = {c: _num(v, f"category {c}") for c, v in _section(mix, "categories").items()}
                        sounds = {n: _num(v, f"event {n}") for n, v in _section(mix, "sounds").items()}
                        mm = _section(mix, "music")
                        music = {k: {n: _num(v, f"music {k} {n}") for n, v in sorted(_section(mm, k).items())} for k in ("levels", "tracks")}
                        contexts = set((proj.music or {}).get("contexts", {}))
                        for b, v in buses.items():
                            cur.setdefault("buses", {})[b] = v
                        for c, v in cats.items():
                            if isinstance(cur.get("categories", {}).get(c), dict):
                                cur["categories"][c]["db"] = v
                        for sid, v in sounds.items():
                            if isinstance(cur.get("sounds", {}).get(sid), dict):
                                cur["sounds"][sid]["db"] = v
                        mu = cur.setdefault("music", {})
                        # (a track's 0 is kept only to override a context's trim)
                        ctx_trim = any(n in contexts and abs(v) > 1e-6 for n, v in music["tracks"].items())
                        mu["levels"] = {n: v for n, v in music["levels"].items() if abs(v) > 1e-6}
                        mu["tracks"] = {n: v for n, v in music["tracks"].items() if abs(v) > 1e-6 or (ctx_trim and n not in contexts)}
                        clean = cur
                    else:
                        clean = {}
                        for k in ("buses", "sounds", "music", "levels"):
                            vals = {n: _num(v, f"{k} {n}") for n, v in sorted(_section(mix, k).items())}
                            contexts = set((proj.music or {}).get("contexts", {}))
                            ctx_trim = k == "music" and any(n in contexts and abs(v) > 1e-6 for n, v in vals.items())
                            clean[k] = {n: v for n, v in vals.items() if abs(v) > 1e-6 or k == "buses" or (ctx_trim and n not in contexts)}
                    Store.write(mix_path, clean)
                    self.send_json(dict(mix=clean, base=mix_stamp()))
                return
            if url == "/api/tuning":
                msg = self.body()
                new = msg.get("tuning")
                if not isinstance(new, dict) or not new:  # (clean({}) would save an empty tuning over the rules)
                    raise HttpError(400, "no tuning to save: it must be a non-empty object")
                with LOCK:
                    if str(msg.get("base")) != tuning.stamp():
                        self.send_json(dict(error="tuning.json changed since this page loaded it", tuning=tuning.load(), base=tuning.stamp()), 409)
                        return
                    t = tuning.save(new)
                    self.send_json(dict(tuning=t, base=tuning.stamp()))
                return
            if url == "/api/mixes":  # (a set of parts: shipped tracks' bars, all on the one grid)
                msg = self.body()
                name, parts = msg.get("name"), msg.get("parts")
                if not isinstance(name, str) or not name.strip() or len(name) > 80:
                    raise HttpError(400, "a mix needs a name (up to 80 characters)")
                n = (proj.music or {}).get("bars", 16)
                if parts is not None:
                    if not isinstance(parts, list) or len(parts) > 200 or not all(
                            isinstance(x, dict) and isinstance(x.get("track"), str) and all(
                                isinstance(x.get(k), int) and not isinstance(x.get(k), bool) for k in ("start", "bars"))
                            and 1 <= x["start"] and 1 <= x["bars"] and x["start"] + x["bars"] - 1 <= n for x in parts):
                        raise HttpError(400, f"parts are [{{track, start, bars}}] inside the {n} bars")
                with LOCK:
                    mixes = Store.read(st.mixes_path, {})
                    if parts is None:
                        mixes.pop(name.strip(), None)
                    else:
                        mixes[name.strip()] = dict(parts=[dict(track=x["track"], start=x["start"], bars=x["bars"]) for x in parts],
                                                   at=date.today().isoformat())
                    st.write(st.mixes_path, mixes, sort=True)
                    self.send_json(mixes)
                return
            if url in ("/api/sync", "/api/sync/ship"):  # (into the game's folder: the designer's buttons, and nothing else)
                from . import sync
                msg = self.body()
                with LOCK:
                    if url == "/api/sync":
                        p = sync.write(proj)
                    else:
                        ids = msg.get("ids")
                        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids) or not ids:
                            raise HttpError(400, "ids: the songs to ship")
                        p = sync.ship(proj, ids, keep=msg.get("keep", True) is not False)
                self.send_json({k: v for k, v in p.items() if k != "texts"} | dict(readme=p["texts"]["README.md"]))
                return
            if url == "/api/mixer":  # (the Mixer's settings: one small object)
                new = self.body().get("settings")
                if not isinstance(new, dict) or len(json.dumps(new)) > 20000:
                    raise HttpError(400, "settings are one object")
                with LOCK:
                    st.write(st.mixer_settings_path, new, sort=True)
                    self.send_json(dict(ok=True))
                return
            if url == "/api/families/rebuild":  # (one sort at a time, in the background: it takes half a minute)
                from . import families
                if not REBUILD.acquire(blocking=False):
                    self.send_json(dict(started=False, busy=True))
                    return
                def run():
                    try:
                        families.build(proj)
                    except Exception:
                        traceback.print_exc()
                    finally:
                        REBUILD.release()
                threading.Thread(target=run, daemon=True).start()
                self.send_json(dict(started=True))
                return
            if url == "/api/review":  # (a mark on a low-rated block's piece: data/reviews.json, a list)
                msg = self.body()
                if not isinstance(msg.get("stream"), str) or not isinstance(msg.get("block"), int) or not isinstance(msg.get("piece"), dict) \
                        or len(json.dumps(msg)) > 5000:
                    raise HttpError(400, "a review is {stream, block, piece, mode, note?}")
                with LOCK:
                    reviews = Store.read(st.reviews_path, [])
                    reviews.append(dict(stream=msg["stream"], block=msg["block"], piece=msg["piece"], mode=str(msg.get("mode", ""))[:20],
                                        note=str(msg.get("note") or "")[:500], at=datetime.now().strftime("%Y-%m-%d %H:%M")))
                    st.write(st.reviews_path, reviews)
                    self.send_json(dict(ok=True, reviews=len(reviews)))
                return
            if url == "/api/stream":  # (a listening session: data/streams.json, {id: {at, settings, stream}})
                msg = self.body()
                sid, stream = msg.get("id"), msg.get("stream")
                if not isinstance(sid, str) or not sid or len(sid) > 40 or not isinstance(stream, list) or len(stream) > 4000 \
                        or not all(isinstance(x, dict) and x.get("kind") in ("part", "glue", "rest", "fill", "transition") for x in stream):
                    raise HttpError(400, "a stream is {id, stream: [{kind: part | glue | rest | fill | transition, ...}]}")
                for x in stream:
                    if x["kind"] == "transition":
                        if x.get("like") not in (None, 1, -1):
                            raise HttpError(400, "a transition's like is 1, -1 or null")
                    elif x.get("stars") is not None and (not isinstance(x["stars"], int) or isinstance(x["stars"], bool) or not 1 <= x["stars"] <= 5):
                        raise HttpError(400, "stars are 1 to 5, or null")
                with LOCK:
                    streams = Store.read(st.streams_path, {})
                    streams[sid] = dict(at=datetime.now().strftime("%Y-%m-%d %H:%M"), settings=msg.get("settings") or {}, stream=stream)
                    st.write(st.streams_path, streams, sort=True)
                    self.send_json(dict(ok=True, blocks=sum(1 for x in stream if x["kind"] != "transition")))
                return
            if url != "/api/vote":
                self.send_error(404)
                return
            msg = self.body()
            with LOCK:
                v = st.votes()
                if "clip" in msg:
                    if msg.get("value"):
                        v["clips"][msg["clip"]] = int(msg["value"])
                    else:
                        v["clips"].pop(msg["clip"], None)
                if "pick" in msg:
                    if msg["pick"]:
                        v["picks"][msg["sound"]] = msg["pick"]
                    else:
                        v["picks"].pop(msg["sound"], None)
                for name, pick in msg.get("picks", {}).items():
                    if pick:
                        v["picks"][name] = pick
                    else:
                        v["picks"].pop(name, None)
                if "prompt_note" in msg:  # (kept with the prompt text it's about, so a later rewrite shows it's older)
                    pn = v.setdefault("prompt_notes", {})
                    if msg["prompt_note"].strip():
                        pn.setdefault(msg["sound"], {})[msg["variant"]] = dict(
                            text=msg["prompt_note"].strip(), prompt=msg.get("prompt", ""), at=msg.get("at") or date.today().isoformat())
                    else:
                        pn.get(msg["sound"], {}).pop(msg["variant"], None)
                        if not pn.get(msg["sound"]):
                            pn.pop(msg["sound"], None)
                if "cue" in msg:  # (a shipped track's mellow or intense loop, bars start..end of its 16; null: back to the guess)
                    lvl, bars = msg.get("level"), msg.get("bars")
                    if lvl not in ("mellow", "intense"):
                        raise HttpError(400, "a cue's level is mellow or intense")
                    cues = v.setdefault("cues", {})
                    if bars is None:
                        cues.get(msg["cue"], {}).pop(lvl, None)
                    else:
                        n = (proj.music or {}).get("bars", 16)
                        if (not isinstance(bars, list) or len(bars) != 2 or not all(isinstance(b, int) and not isinstance(b, bool) for b in bars)
                                or not 1 <= bars[0] < bars[1] <= n):
                            raise HttpError(400, f"a cue is [start, end] with 1 <= start < end <= {n}")
                        cues.setdefault(msg["cue"], {})[lvl] = bars
                    if not cues.get(msg["cue"]):
                        cues.pop(msg["cue"], None)
                    if not cues:
                        v.pop("cues")
                if "note" in msg:
                    if msg["note"].strip():
                        v["notes"][msg["sound"]] = msg["note"]
                    else:
                        v["notes"].pop(msg["sound"], None)
                st.save_votes(v)
                self.send_json(v)

    return Handler


def serve(proj: P.Project, host: str = "127.0.0.1", port: int = 7870) -> None:
    srv = ThreadingHTTPServer((host, port), make_handler(proj, host))
    print(f"SoundLab ({proj.name}): http://{host}:{port}", flush=True)
    srv.serve_forever()

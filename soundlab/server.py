"""The lab's web app and API (standard library only).

  GET  /                    the app (soundlab/web)
  GET  /api/state           {project, index, votes, shipped}: every take, prompt, set and vote, and the take each
                            sound last shipped from (promoted.json)
  GET  /api/stamp           {index, votes, promoted, tuning}: when those files last changed (the app polls it for news)
  GET  /api/tuning          {tuning, base, evidence, ...}: the prompt tuning (tuning.json) and what this project's votes say
  POST /api/tuning          {base, tuning}: save it; 409 with the current one if it changed since `base` (an agent wrote it)
  POST /api/vote            {clip, value: 1|-1|0} | {sound, pick: id|"shipped"|null} | {picks: {sound: id|null}}
                            | {sound, note} | {sound, variant, prompt_note, prompt}: a note on one prompt's takes
  GET  /api/balance         {balance (work/balance.json), mix (the game's mix file)}
  POST /api/mix             the whole mix; written to the game's mix file (the game re-reads it live)
  GET  /clips/<path>        a take (work/clips)
  GET  /shipped/<path>      a shipped file (the project's assets)

Bound to a loopback address, it answers only requests addressed to one (so a DNS-rebinding page can't reach it),
and it takes writes only as JSON from its own origin (so another website open in the browser can't post to it).
"""
from __future__ import annotations

import json
import mimetypes
import threading
from datetime import date
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
LOOPBACK = {"127.0.0.1", "localhost", "[::1]", "::1"}


def _inside(base: Path, rel: str) -> Path | None:
    p = (base / rel).resolve()
    return p if p.is_relative_to(base.resolve()) and p.is_file() else None


def make_handler(proj: P.Project, host: str = "127.0.0.1"):
    st = Store(proj)
    mix_path = Path(proj.balance["mix"]) if proj.balance else None
    info = dict(name=proj.name, root=str(proj.root), features=dict(
        alerts=bool(proj.alerts), music=bool(proj.music), balance=bool(proj.balance)),
        instruments={k: v["name"] for k, v in (proj.music or {}).get("instruments", {}).items()},
        default_profile=(proj.music or {}).get("default_profile"))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send_json(self, obj, status=200):
            body = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def send_file(self, path: Path | None):
            if path is None:
                self.send_error(404)
                return
            size = path.stat().st_size
            start, end, rng = 0, size - 1, self.headers.get("Range", "")
            if rng.startswith("bytes="):  # audio elements seek and loop with range requests
                a, _, b = rng[6:].partition("-")
                start = int(a) if a else max(0, size - int(b))
                end = int(b) if a and b else size - 1
            self.send_response(206 if rng else 200)
            self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            if rng:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            with open(path, "rb") as f:
                f.seek(start)
                self.wfile.write(f.read(end - start + 1))

        def foreign(self) -> bool:
            """A request from another website (its Origin isn't ours), or addressed to a name that isn't loopback."""
            where = self.headers.get("Host") or ""
            if host in LOOPBACK and where.rsplit(":", 1)[0] not in LOOPBACK:
                return True
            origin = self.headers.get("Origin")
            return bool(origin) and urlparse(origin).netloc != where

        def body(self):
            return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")

        def do_GET(self):
            if self.foreign():
                self.send_error(403)
                return
            url = unquote(urlparse(self.path).path)
            if url in ("/", "/index.html"):
                self.send_file(paths.WEB / "index.html")
            elif url.startswith("/web/"):
                self.send_file(_inside(paths.WEB, url[5:]))
            elif url == "/api/state":
                with LOCK:
                    shipped = {n: p.get("clip") for n, p in Store.read(st.promoted_path, {}).items()}
                    self.send_json(dict(project=info, index=st.index(), votes=st.votes(), shipped=shipped))
            elif url == "/api/stamp":
                self.send_json({k: str(p.stat().st_mtime_ns) if p.exists() else "0"  # (strings: exact in JavaScript)
                                for k, p in (("index", st.index_path), ("votes", st.votes_path), ("promoted", st.promoted_path), ("tuning", tuning.PATH))})
            elif url == "/api/tuning":
                with LOCK:
                    self.send_json(dict(tuning=tuning.load(), base=tuning.stamp(), path=str(tuning.PATH), evidence=tuning.evidence(proj),
                                        tasks=tuning.TASKS, commands=tuning.COMMANDS, engines=tuning.ENGINES))
            elif url == "/favicon.ico":
                self.send_file(paths.WEB / "img" / "favicon.png")
            elif url == "/api/balance":
                self.send_json(dict(balance=Store.read(st.balance_path, {}),
                                    mix=Store.read(mix_path, {}) if mix_path else {}))
            elif url.startswith("/clips/"):
                self.send_file(_inside(st.clips, url[7:]))
            elif url.startswith("/shipped/"):
                self.send_file(_inside(proj.assets, url[9:]))
            else:
                self.send_error(404)

        def do_POST(self):
            if self.foreign() or self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                self.send_error(403)
                return
            url = urlparse(self.path).path
            if url == "/api/mix" and mix_path:
                mix = self.body()
                clean = {k: {n: round(float(v), 2) for n, v in sorted(mix.get(k, {}).items())
                             if abs(float(v)) > 1e-6 or k == "buses"} for k in ("buses", "sounds", "music", "levels")}
                with LOCK:
                    Store.write(mix_path, clean)
                self.send_json(clean)
                return
            if url == "/api/tuning":
                msg = self.body()
                with LOCK:
                    if str(msg.get("base")) != tuning.stamp():
                        self.send_json(dict(tuning=tuning.load(), base=tuning.stamp()), 409)
                        return
                    t = tuning.save(msg.get("tuning") or {})
                    self.send_json(dict(tuning=t, base=tuning.stamp()))
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

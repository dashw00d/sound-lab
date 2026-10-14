"""The lab's web app and API (standard library only).

  GET  /                    the app (soundlab/web)
  GET  /api/state           {project, index, votes}: every take, prompt, set and vote
  POST /api/vote            {clip, value: 1|-1|0} | {sound, pick: id|"shipped"|null} | {picks: {sound: id}}
                            | {sound, note}
  GET  /api/balance         {balance (work/balance.json), mix (the game's mix file)}
  POST /api/mix             the whole mix; written to the game's mix file (the game re-reads it live)
  GET  /clips/<path>        a take (work/clips)
  GET  /shipped/<path>      a shipped file (the project's assets)
"""
from __future__ import annotations

import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from . import paths, project as P
from .store import Store

mimetypes.add_type("audio/ogg", ".ogg")
mimetypes.add_type("audio/wav", ".wav")
mimetypes.add_type("text/javascript", ".js")
LOCK = threading.Lock()


def _inside(base: Path, rel: str) -> Path | None:
    p = (base / rel).resolve()
    return p if p.is_relative_to(base.resolve()) and p.is_file() else None


def make_handler(proj: P.Project):
    st = Store(proj)
    mix_path = Path(proj.balance["mix"]) if proj.balance else None
    info = dict(name=proj.name, root=str(proj.root), features=dict(
        alerts=bool(proj.alerts), music=bool(proj.music), balance=bool(proj.balance)),
        instruments={k: v["name"] for k, v in (proj.music or {}).get("instruments", {}).items()})

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

        def body(self):
            return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")

        def do_GET(self):
            url = unquote(urlparse(self.path).path)
            if url in ("/", "/index.html"):
                self.send_file(paths.WEB / "index.html")
            elif url.startswith("/web/"):
                self.send_file(_inside(paths.WEB, url[5:]))
            elif url == "/api/state":
                with LOCK:
                    self.send_json(dict(project=info, index=st.index(), votes=st.votes()))
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
            url = urlparse(self.path).path
            if url == "/api/mix" and mix_path:
                mix = self.body()
                clean = {k: {n: round(float(v), 2) for n, v in sorted(mix.get(k, {}).items())
                             if abs(float(v)) > 1e-6 or k == "buses"} for k in ("buses", "sounds", "music", "levels")}
                with LOCK:
                    Store.write(mix_path, clean)
                self.send_json(clean)
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
                    v["picks"][name] = pick
                if "note" in msg:
                    if msg["note"].strip():
                        v["notes"][msg["sound"]] = msg["note"]
                    else:
                        v["notes"].pop(msg["sound"], None)
                st.save_votes(v)
                self.send_json(v)

    return Handler


def serve(proj: P.Project, host: str = "127.0.0.1", port: int = 7870) -> None:
    srv = ThreadingHTTPServer((host, port), make_handler(proj))
    print(f"Sound Lab ({proj.name}): http://{host}:{port}", flush=True)
    srv.serve_forever()

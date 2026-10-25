#!/usr/bin/env python3
"""Install Sound Lab's runtime on Windows or Linux: a Python 3.12 environment with Stable Audio 3 and CUDA PyTorch,
and the Stable Audio 3 Medium model (the ungated mirror cocktailpeanut/stable-audio-3-medium, about 10 GB).

    python install.py                       # everything into ./runtime (re-running only does what is missing)
    python install.py --hf-home PATH        # keep (or reuse) the model in another Hugging Face cache
    python install.py --cuda cu128          # a different CUDA build of PyTorch (cu118, cu126, cu128)
    python install.py --no-model            # skip the 10 GB download (doctor will say it is missing)
    python install.py --no-web              # skip building the web app (web-app/ into soundlab/webapp)

Needs: an NVIDIA GPU with a recent driver (Medium wants about 12 GB of VRAM), ffmpeg on PATH (with the rubberband
filter, for the music's tempo correction), and git if available (else the code is fetched as a zip). uv, the Python
manager, is installed for you if missing. Any Python 3.8+ can run this script; the runtime gets its own 3.12.
Node.js 20.19+ (with npm) builds the web app at /app/ (its build isn't committed); without it, only the older app at
/ works. Re-run the installer after pulling changes to web-app/: it rebuilds when the sources are newer than the build.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import platform
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / "runtime"
VENV = RUNTIME / "venv"
SA3 = RUNTIME / "stable-audio-3"
CONFIG = RUNTIME / "config.json"
WIN = sys.platform == "win32"
PY = VENV / ("Scripts/python.exe" if WIN else "bin/python")
SA3_REPO = "https://github.com/Stability-AI/stable-audio-3"
MODEL_REPO = "cocktailpeanut/stable-audio-3-medium"
TORCH = "2.7.1"  # what stable-audio-3 pins
WHEELS = "mjun0812/flash-attention-prebuild-wheels"
WEB_SRC = ROOT / "web-app"  # the TS + React app's sources
WEB_OUT = ROOT / "soundlab" / "webapp"  # its build (gitignored), served at /app/
NODE_MIN = (20, 19)  # what Vite 8 needs (or 22.12+)


def say(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)


def run(cmd: list, **kw) -> None:
    print("   $ " + " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def find_uv() -> str:
    uv = shutil.which("uv")
    for c in [Path.home() / ".local/bin" / ("uv.exe" if WIN else "uv"), Path.home() / ".cargo/bin" / ("uv.exe" if WIN else "uv")]:
        if not uv and c.exists():
            uv = str(c)
    if uv:
        return uv
    say("installing uv (https://docs.astral.sh/uv)")
    if WIN:
        run(["powershell", "-ExecutionPolicy", "ByPass", "-c", "irm https://astral.sh/uv/install.ps1 | iex"])
    else:
        run(["sh", "-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"])
    uv = shutil.which("uv") or str(Path.home() / ".local/bin" / ("uv.exe" if WIN else "uv"))
    if not Path(uv).exists() and not shutil.which("uv"):
        sys.exit("uv was installed but is not on PATH; open a new terminal and run the installer again")
    return uv


def check_system() -> None:
    say("checking the system")
    if platform.machine().lower() not in ("x86_64", "amd64"):
        print("   ! this is not an x86-64 machine: CUDA PyTorch and the prebuilt wheels may not exist for it")
    smi = shutil.which("nvidia-smi")
    if smi:
        out = subprocess.run([smi, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
                             capture_output=True, text=True).stdout.strip()
        print(f"   GPU: {out or 'unknown'}")
    else:
        print("   ! no nvidia-smi: Stable Audio 3 Medium needs an NVIDIA GPU (it will be very slow, if it runs at all)")
    ff = shutil.which(os.environ.get("FFMPEG", "ffmpeg"))
    if not ff:
        hint = "winget install Gyan.FFmpeg" if WIN else "sudo apt install ffmpeg (or your distro's package)"
        print(f"   ! ffmpeg not found: install it ({hint}) and run the installer again, or set FFMPEG")
    else:
        filters = subprocess.run([ff, "-hide_banner", "-filters"], capture_output=True, text=True).stdout
        print(f"   ffmpeg: {ff}{'' if ' rubberband ' in filters else '  (! no rubberband filter: music tempo correction will fail)'}")


def fetch_sa3() -> str:
    if (SA3 / "pyproject.toml").exists():
        say("Stable Audio 3 code: already here")
    elif shutil.which("git"):
        say("fetching the Stable Audio 3 code")
        run(["git", "clone", "--depth", "1", SA3_REPO, SA3])
    else:
        say("fetching the Stable Audio 3 code (zip; git not found)")
        data = urllib.request.urlopen(f"{SA3_REPO}/archive/refs/heads/main.zip").read()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.extractall(RUNTIME)
        (RUNTIME / "stable-audio-3-main").rename(SA3)
    if shutil.which("git") and (SA3 / ".git").exists():
        return subprocess.run(["git", "-C", str(SA3), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    return "main (zip)"


def flash_attn_wheel(cuda: str) -> str | None:
    """A prebuilt flash-attn wheel for this platform, Python 3.12, torch 2.7 and this CUDA, if one is published."""
    plat = "win_amd64" if WIN else "linux_x86_64"
    want = f"{cuda}torch2.7-cp312-cp312-{plat}.whl"
    best = None
    try:
        for page in range(1, 4):
            req = urllib.request.Request(f"https://api.github.com/repos/{WHEELS}/releases?per_page=50&page={page}",
                                         headers={"Accept": "application/vnd.github+json"})
            releases = json.loads(urllib.request.urlopen(req, timeout=30).read())
            if not releases:
                break
            for r in releases:
                for a in r.get("assets", []):
                    n = a["name"]
                    if n.startswith("flash_attn-") and n.endswith(want):
                        ver = tuple(int(x) for x in n.split("-")[1].split("+")[0].split(".") if x.isdigit())
                        if best is None or ver > best[0]:
                            best = (ver, a["browser_download_url"])
    except Exception as e:  # (rate limits, no network): flash-attn is optional
        print(f"   ! could not list flash-attn wheels: {e}")
    return best[1] if best else None


def web_stale() -> bool:
    """Whether the web app needs building: no build yet, or a source newer than it (e.g. after a git pull)."""
    built = WEB_OUT / "index.html"
    if not built.exists():
        return True
    t = built.stat().st_mtime
    return any(p.stat().st_mtime > t for p in WEB_SRC.rglob("*") if p.is_file() and "node_modules" not in p.parts)


def build_web() -> None:
    """npm ci and npm run build in web-app/, when Node is here and the build is missing or stale. Never fatal: the
    older app at / works without it."""
    if not web_stale():
        say("the web app: already built")
        return
    node, npm = shutil.which("node"), shutil.which("npm")
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip() if node else ""
    have = tuple(int(x) for x in ver.lstrip("v").split(".")[:2] if x.isdigit())
    if not (node and npm) or have < NODE_MIN:
        hint = "winget install OpenJS.NodeJS.LTS" if WIN else "https://nodejs.org, or your distro's nodejs + npm"
        say("the web app: not built")
        print(f"   ! needs Node.js {NODE_MIN[0]}.{NODE_MIN[1]}+ with npm ({ver or 'not found'}): install it ({hint}) and run the"
              " installer again. Until then only the older app at / works, not /app/")
        return
    say(f"building the web app (Node {ver}) into {WEB_OUT.relative_to(ROOT)}")
    try:
        lock, mods = WEB_SRC / "package-lock.json", WEB_SRC / "node_modules" / ".package-lock.json"
        if not mods.exists() or lock.stat().st_mtime > mods.stat().st_mtime:
            run([npm, "ci", "--no-audit", "--no-fund"], cwd=WEB_SRC)
        run([npm, "run", "build"], cwd=WEB_SRC)
    except subprocess.CalledProcessError:
        print("   ! the web app did not build (see above); the older app at / still works")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hf-home", help="the Hugging Face cache to keep the model in (default: runtime/hf)")
    ap.add_argument("--cuda", default="cu126", choices=["cu118", "cu126", "cu128"])
    ap.add_argument("--no-model", action="store_true")
    ap.add_argument("--no-flash-attn", action="store_true")
    ap.add_argument("--no-web", action="store_true")
    a = ap.parse_args()

    RUNTIME.mkdir(exist_ok=True)
    cfg = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
    hf_home = Path(a.hf_home or cfg.get("hf_home") or RUNTIME / "hf").resolve()
    check_system()
    uv = find_uv()
    env = dict(os.environ, UV_HTTP_TIMEOUT=os.environ.get("UV_HTTP_TIMEOUT", "300"))

    if not PY.exists():
        say("creating the Python 3.12 environment")
        run([uv, "venv", "--python", "3.12", VENV], env=env)
    commit = fetch_sa3()
    say(f"installing PyTorch {TORCH} ({a.cuda})")
    run([uv, "pip", "install", "--python", PY, f"torch=={TORCH}", f"torchaudio=={TORCH}",
         "--index-url", f"https://download.pytorch.org/whl/{a.cuda}"], env=env)
    say("installing Stable Audio 3 and the lab's libraries")
    run([uv, "pip", "install", "--python", PY, "-e", SA3, "librosa", "soundfile", "requests", "huggingface_hub[hf_xet]",
         "audiobox_aesthetics", "pedalboard", "demucs", "transformers", "scikit-learn", "matplotlib"], env=env)
    # (audiobox_aesthetics: music check and the quality gate; pedalboard: retuning; demucs: stems; transformers: CLAP;
    # matplotlib: research/view.py, pictures of songs side by side)
    say("Basic Pitch (the catchiness score), on ONNX: its own requirements pull TensorFlow")
    run([uv, "pip", "install", "--python", PY, "onnxruntime", "pretty_midi", "mir_eval", "resampy"], env=env)
    run([uv, "pip", "install", "--python", PY, "--no-deps", "basic-pitch==0.4.0"], env=env)
    if not a.no_flash_attn:
        say("flash-attn (optional: a faster attention kernel)")
        wheel = flash_attn_wheel(a.cuda)
        if wheel:
            try:
                run([uv, "pip", "install", "--python", PY, wheel], env=env)
            except subprocess.CalledProcessError:
                print("   ! the flash-attn wheel did not install; continuing without it")
        else:
            print("   no prebuilt wheel for this platform; continuing without it (Stable Audio 3 falls back to PyTorch)")
    cfg.update(hf_home=str(hf_home), cuda=a.cuda, torch=TORCH, stable_audio_3=commit, platform=sys.platform)
    CONFIG.write_text(json.dumps(cfg, indent=1))
    if not a.no_model:
        say(f"the model: {MODEL_REPO} into {hf_home} (about 10 GB the first time)")
        run([PY, "-c", f"from huggingface_hub import snapshot_download; print(snapshot_download('{MODEL_REPO}'))"],
            env=dict(env, HF_HOME=str(hf_home)))
        say(f"the music quality model: facebook/audiobox-aesthetics into {hf_home} (small)")
        run([PY, "-c", "from audiobox_aesthetics.infer import initialize_predictor; initialize_predictor()"],
            env=dict(env, HF_HOME=str(hf_home)))  # (into the lab's cache: the generator runs offline)
        say(f"the music analysis models: CLAP into {hf_home}, the Demucs stem splitter (small)")
        run([PY, "-c", "from transformers import ClapModel, ClapProcessor as P; m = 'laion/larger_clap_music_and_speech'; "
             "ClapModel.from_pretrained(m); P.from_pretrained(m); from demucs.pretrained import get_model; get_model('htdemucs')"],
            env=dict(env, HF_HOME=str(hf_home)))
    if not a.no_web:
        build_web()
    say("checking it all works")
    rc = subprocess.run([str(PY), "-m", "soundlab", "doctor"] + ([] if a.no_model else ["--generate"]),
                        env=dict(env, PYTHONPATH=str(ROOT)), cwd=ROOT).returncode
    print("\nInstalled. Start the lab with:  " + ("soundlab.cmd" if WIN else "./soundlab.sh") + " --project PATH serve"
          + "  (then http://127.0.0.1:7870/app/)")
    return rc


if __name__ == "__main__":
    sys.exit(main())

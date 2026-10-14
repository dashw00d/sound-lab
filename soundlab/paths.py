"""Where the tool keeps its runtime (made by install.py) and the model."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

TOOL = Path(__file__).resolve().parent.parent
RUNTIME = TOOL / "runtime"
VENV = RUNTIME / "venv"
SA3_SRC = RUNTIME / "stable-audio-3"  # Stability-AI/stable-audio-3, installed into the venv
CONFIG = RUNTIME / "config.json"  # written by install.py (where the model cache is)
MODEL_REPO = "cocktailpeanut/stable-audio-3-medium"  # an ungated mirror of stabilityai/stable-audio-3-medium
WEB = Path(__file__).resolve().parent / "web"


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def hf_home() -> Path:
    """The Hugging Face cache holding the model: SOUNDLAB_HF_HOME, else what install.py chose, else runtime/hf."""
    if os.environ.get("SOUNDLAB_HF_HOME"):
        return Path(os.environ["SOUNDLAB_HF_HOME"])
    if CONFIG.exists():
        return Path(json.loads(CONFIG.read_text()).get("hf_home", RUNTIME / "hf"))
    return RUNTIME / "hf"


def ffmpeg() -> str:
    return os.environ.get("FFMPEG", "ffmpeg")

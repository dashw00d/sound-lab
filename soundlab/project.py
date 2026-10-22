"""A project: the game the lab works for, described by one Python file in that game (soundlab_project.py).

The file defines `project()` returning a Project. Only the paths and `sounds` are required; every section the
game leaves out (alerts, music, balance) just turns that page off. See AGENTS.md, "The project file".
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np


@dataclass
class Sound:
    """One sound the game ships, as the lab sees it."""
    name: str  # the stem the game looks it up by
    kind: str  # "oneshot" | "loop"
    seconds: float  # how long to generate
    channels: int  # 1 | 2
    prompt: str  # the prompt it was made from (shown as the "el" row; its "No ..." parts are dropped for SA3)
    out: Path  # where a promoted take is written
    core: str = ""  # the description without a shared style tail ("core" row), if the project has tails
    palette: str = ""  # a label for its style family
    shipped: Path | None = None  # the file shipped now (for comparison), if any
    meta: dict = field(default_factory=dict)  # anything the project's own hooks want back


@dataclass
class Project:
    name: str
    root: Path  # the game's root
    work: Path  # generated takes and caches (gitignored)
    data: Path  # authored data: votes, prompts, provenance (tracked)
    assets: Path  # the game's audio root, served at /shipped/
    sounds: Callable[[], list[Sound]]
    # Mastering a take as the shipped file is mastered: (sound, raw (samples, ch) at 44.1 kHz) -> (audio, info).
    # Default: integrated loudness -18 LUFS, limited at -1 dBFS.
    master: Callable[[Sound, np.ndarray], tuple[np.ndarray, dict]] | None = None
    # A take's quality score (lower is better; None or inf = silent or failed). Default: silence check only.
    score: Callable[[Sound, np.ndarray], float | None] | None = None
    # Shipping a picked take: (sound, mastered file) -> None. Default: copy it to sound.out.
    install: Callable[[Sound, Path], None] | None = None
    after_install: Callable[[list[Path]], int] | None = None  # e.g. run the engine's importer; returns an exit code
    alerts: dict | None = None  # the alert family design (soundlab/alerts.py)
    music: dict | None = None  # the meshed music design (soundlab/music/__init__.py)
    balance: dict | None = None  # the mix and how the code plays sounds (soundlab/balance.py)
    asset_uri: Callable[[Path], str] = lambda p: str(p)  # how the game names a file (e.g. res://...)
    sync: Path | None = None  # the folder in the game the lab syncs its music to (soundlab/sync); default <root>/soundlab
    # The game's own folder for the lab's data, when the project file puts `data` in the game: the lab keeps its data at
    # work/<project>/data instead and writes here only when the designer shares (soundlab data share). Set by load().
    share: Path | None = None

    def path(self) -> str:
        return getattr(self, "_path", "")


def load(path: str | os.PathLike | None = None) -> Project:
    """Load a project from a soundlab_project.py file, or a folder holding one (default: SOUNDLAB_PROJECT, else
    the current folder)."""
    p = Path(path or os.environ.get("SOUNDLAB_PROJECT", "."))
    if p.is_dir():
        found = list(p.glob("soundlab_project.py")) or list(p.glob("**/soundlab_project.py"))
        found = [f for f in found if ".work" not in f.parts and "node_modules" not in f.parts]
        if not found:
            sys.exit(f"no soundlab_project.py in {p.resolve()} (pass --project PATH)")
        p = found[0]
    spec = importlib.util.spec_from_file_location("soundlab_project", p)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(p.parent))
    spec.loader.exec_module(mod)
    proj = mod.project()
    proj._path = str(p.resolve())
    proj.work.mkdir(parents=True, exist_ok=True)
    _localise(proj)
    proj.data.mkdir(parents=True, exist_ok=True)
    return proj


def _localise(proj: Project) -> None:
    """The lab's data (votes, picks, cues, notes, settings, sessions, provenance) lives in the lab, not in the game's repo
    (2026-10-22, the designer: "every time I vote it goes into my emberhold project and muddys up whatever branch im on
    ... I wanted it all local other than data sharing"). A project whose `data` is inside the game's root gets
    work/<project>/data instead, filled once from the game's folder (copied, never moved: the game's files stay as they
    are); the game's folder becomes `share`, written only by `soundlab data share`. A project that keeps its data
    outside the game already (a test copy) is left as it is."""
    data, root = Path(proj.data).resolve(), Path(proj.root).resolve()
    if not data.is_relative_to(root):
        return
    local = Path(proj.work) / "data"
    if not local.exists() and data.is_dir():  # (the first time: what the game's folder has; one process does it)
        tmp = local.with_name(f"data.{os.getpid()}.tmp")
        shutil.copytree(data, tmp)
        try:
            os.rename(tmp, local)
        except OSError:
            shutil.rmtree(tmp, ignore_errors=True)
    proj.share, proj.data = data, local


def master(proj: Project, s: Sound, x: np.ndarray) -> tuple[np.ndarray, dict]:
    if proj.master:
        return proj.master(s, x)
    from . import dsp

    y = x.mean(axis=1, keepdims=True) if s.channels == 1 else x
    return dsp.normalise(y, -18.0, -1.0), {"lufs": -18.0}


def score(proj: Project, s: Sound, x: np.ndarray) -> float | None:
    if proj.score:
        return proj.score(s, x)
    from . import dsp

    return None if dsp.silent(x) else 0.0


def install(proj: Project, s: Sound, src: Path) -> None:
    if proj.install:
        proj.install(s, src)
        return
    s.out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, s.out)

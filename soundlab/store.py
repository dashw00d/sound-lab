"""The lab's files for a project.

Generated (project.work, gitignored):  index.json (every take, its prompt and metrics), clips/, alert_kits/,
                                        balance.json (the Balance page's measurements)
Authored (project.data, tracked):      votes.json (your picks, thumbs, notes and prompt notes), prompts.json (hand-written
                                        prompt variants), promoted.json, music_promoted.json (provenance)
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from .project import Project


class Store:
    def __init__(self, proj: Project):
        self.proj = proj
        self.index_path = proj.work / "index.json"
        self.clips = proj.work / "clips"
        self.kits = proj.work / "alert_kits"
        self.balance_path = proj.work / "balance.json"
        self.votes_path = proj.data / "votes.json"
        self.prompts_path = proj.data / "prompts.json"
        self.promoted_path = proj.data / "promoted.json"
        self.music_promoted_path = proj.data / "music_promoted.json"
        self.mixes_path = proj.data / "mixes.json"  # (the Mixer page's saved sets of parts: the user's)

    @staticmethod
    def read(path: Path, default):
        return json.loads(path.read_text()) if path.exists() else default

    @staticmethod
    def write(path: Path, obj, sort: bool = False) -> None:
        """Atomic: a temp file of its own (writers don't share a name), then a rename over the file."""
        path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(obj, indent=1, sort_keys=sort, ensure_ascii=False) + "\n"
        fd, name = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text)
            os.chmod(name, path.stat().st_mode & 0o777 if path.exists() else 0o644)  # (mkstemp makes it private)
            os.replace(name, path)
        except BaseException:
            Path(name).unlink(missing_ok=True)
            raise

    def index(self) -> dict:
        idx = self.read(self.index_path, {})
        for k in ("clips", "sounds", "prompts"):
            idx.setdefault(k, {})
        return idx

    def save_index(self, idx: dict) -> None:
        self.write(self.index_path, idx)

    def votes(self) -> dict:
        v = self.read(self.votes_path, {})
        for k in ("clips", "picks", "notes", "prompt_notes"):
            v.setdefault(k, {})
        return v

    def save_votes(self, v: dict) -> None:
        self.write(self.votes_path, {k: x for k, x in v.items() if x or k != "prompt_notes"}, sort=True)  # (no empty key until there's a note)

    def prompts(self) -> dict:
        return self.read(self.prompts_path, {})

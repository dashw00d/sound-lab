"""The lab's files for a project.

Generated (project.work, gitignored):  index.json (every take, its prompt and metrics), clips/, alert_kits/,
                                        balance.json (the Balance page's measurements)
Authored (project.data, tracked):      votes.json (your picks, thumbs, notes and prompt notes), prompts.json (hand-written
                                        prompt variants), promoted.json, music_promoted.json (provenance)
"""
from __future__ import annotations

import json
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

    @staticmethod
    def read(path: Path, default):
        return json.loads(path.read_text()) if path.exists() else default

    @staticmethod
    def write(path: Path, obj, sort: bool = False) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(obj, indent=1, sort_keys=sort, ensure_ascii=False) + "\n")
        tmp.replace(path)

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

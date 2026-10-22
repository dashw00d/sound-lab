"""Sharing the lab's data with the game (2026-10-22, the designer: "every time I vote it goes into my emberhold project
and muddys up whatever branch im on, very irritating. That is why I wanted it all local other than data sharing").

The lab keeps its data (votes, picks, cues, notes, prompts, settings, sessions, provenance) in work/<project>/data
(project.py _localise). The game's own folder for it (the project file's `data`, now `share`) is written only here:
`soundlab data share` copies the lab's files into it (to commit, or to hand to someone through the game's repo), and
`soundlab data pull` takes the game's into the lab (someone else's, committed there), keeping the lab's as they were in
data/.backups first. Both are dry runs until --apply; the Game page shares with a button.
"""
from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from . import project as P


def _files(d: Path) -> dict[str, Path]:
    return {f.name: f for f in sorted(d.glob("*.json"))} if d and d.is_dir() else {}


def plan(proj: P.Project) -> dict:
    """Each data file, the lab's against the game's: the same, newer in the lab, only in the lab, only in the game."""
    local, game = Path(proj.data), proj.share
    rows = []
    if game is None:
        return dict(local=str(local), game=None, rows=[], differ=0)
    L, G = _files(local), _files(game)
    for name in sorted(set(L) | set(G)):
        a, b = L.get(name), G.get(name)
        state = "only in the lab" if not b else "only in the game" if not a else "same" if a.read_bytes() == b.read_bytes() else "differs"
        rows.append(dict(name=name, state=state, lab=a.stat().st_mtime if a else None, game=b.stat().st_mtime if b else None))
    return dict(local=str(local), game=str(game), rows=rows, differ=sum(1 for r in rows if r["state"] in ("differs", "only in the lab")))


def share(proj: P.Project) -> dict:
    """The lab's data files into the game's folder (those that differ, and those only the lab has)."""
    p = plan(proj)
    if not p["game"]:
        return p
    for r in p["rows"]:
        if r["state"] in ("differs", "only in the lab"):
            shutil.copy2(Path(p["local"]) / r["name"], Path(p["game"]) / r["name"])
    return plan(proj)


def pull(proj: P.Project) -> dict:
    """The game's data files into the lab, the lab's kept first in data/.backups/<time>-pull/."""
    p = plan(proj)
    if not p["game"]:
        return p
    keep = Path(p["local"]) / ".backups" / (datetime.now().strftime("%Y-%m-%d_%H%M%S") + "-pull")
    for r in p["rows"]:
        if r["state"] in ("differs", "only in the game"):
            src, dst = Path(p["game"]) / r["name"], Path(p["local"]) / r["name"]
            if dst.exists():
                keep.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dst, keep / r["name"])
            shutil.copy2(src, dst)
    return plan(proj)


def run(proj: P.Project, action: str, apply: bool) -> int:
    p = plan(proj)
    if not p["game"]:
        print(f"this project keeps its data outside the game ({p['local']}): nothing to share")
        return 0
    print(f"the lab's data: {p['local']}\nthe game's folder: {p['game']}")
    for r in p["rows"]:
        print(f"  {r['state']:>17}  {r['name']}")
    moving = [r for r in p["rows"] if r["state"] in (("differs", "only in the lab") if action == "share" else ("differs", "only in the game"))]
    if action == "status" or not moving:
        print("nothing to " + action if action != "status" else "")
        return 0
    if not apply:
        print(f"{len(moving)} file{'s' if len(moving) > 1 else ''} would go {'into the game' if action == 'share' else 'into the lab'}: run with --apply")
        return 0
    (share if action == "share" else pull)(proj)
    print(f"{'shared' if action == 'share' else 'pulled'} {len(moving)} file{'s' if len(moving) > 1 else ''}")
    return 0

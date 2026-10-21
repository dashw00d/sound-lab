"""What the project's music design says that every part of the music needs: the level the spine is, and a set's key."""
from __future__ import annotations


def spine_level(M: dict) -> str:
    return M.get("spine") or M["levels"][len(M["levels"]) // 2]


def key_of(context: str, biome: str, style: str | None = None) -> str:
    return (context if biome == "any" else f"{context}.{biome}") + (f"~{style}" if style else "")

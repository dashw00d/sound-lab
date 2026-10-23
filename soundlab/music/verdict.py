"""A song's verdict (2026-10-23, the designer: "lets have the votes effect whats in the game and make them binary so a
thumbs down replaces a previous thumbs up"): its latest thumb, wherever it was given, says whether it's in the game (1),
out (-1), or not judged yet (0). The thumbs on a song:

  mesh_<set>.<take>.<profile>     the Music page's like or dislike of the take at that profile
  song_<id>.mellow, .intense      the Songs page's thumbs on its two states
  ok_<id>                         the Families page's and the Game page's good or bad take (Keep)
  novel_<id>, novel_<set>.<take>  the Trial page's "a new family" (only that: "not new" says nothing of its quality)
  link_<id>|<member>              "belongs with" (only that: "a bad match" is a good song in the wrong family)

The latest by votes.json `at` (the server records when each vote was made; votes before 2026-10-23 were dated from the
game repo's history and the lab's backups). A vote without a time is older than any with one (made before the times
were kept, or in a copy of the data that never had them), and at the same time a thumbs down wins. The Mixer has the same in web-app/src/mixer/verdict.ts: keep the two the same."""
from __future__ import annotations

BEFORE = ""  # (a vote with no time: older than every dated one)


def thumbs(sid: str, set_key: str | None, take: str | None, clips: dict) -> list[tuple[str, int]]:
    """The thumbs bearing on a song: (vote key, 1 or -1)."""
    profile = sid.rsplit(".", 1)[-1]
    out = []
    for k in ([f"mesh_{set_key}.{take}.{profile}"] if set_key and take else []) + [f"song_{sid}.mellow", f"song_{sid}.intense", f"ok_{sid}"]:
        if clips.get(k):
            out.append((k, 1 if clips[k] > 0 else -1))
    for k in [f"novel_{sid}"] + ([f"novel_{set_key}.{take}"] if set_key and take else []):
        if clips.get(k, 0) > 0:
            out.append((k, 1))
    out += [(k, 1) for k, v in clips.items() if v > 0 and k.startswith(f"link_{sid}|")]
    return out


def latest(sid: str, set_key: str | None, take: str | None, clips: dict, at: dict) -> tuple[str, int, str | None] | None:
    """The thumb that decides: (vote key, 1 or -1, when), or None when there's none."""
    ts = thumbs(sid, set_key, take, clips)
    if not ts:
        return None
    k, v = max(ts, key=lambda kv: (at.get(kv[0], BEFORE), kv[1] < 0))
    return k, v, at.get(k)


def verdict(sid: str, set_key: str | None, take: str | None, clips: dict, at: dict) -> int:
    """1 in the game, -1 out, 0 not judged: the latest thumb (a thumbs down at the same time)."""
    t = latest(sid, set_key, take, clips, at)
    return t[1] if t else 0

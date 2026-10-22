"""Are the songs at one level as the player plays them? (2026-10-21, the designer: "there's some volume mismatches in
our library still, from the new stuff?"). The player evens levels (Even levels: each song trimmed by its median beat
against the shipped songs' median, within 6 dB; web-app/src/mixer/judge.ts trimDb) from `music trims`' measures, which
only shipped songs have. This measures every song the Mixer can play (shipped, scored candidates, trial takes,
extensions) as the player does, per beat of its calm and battle files, and reports where each lands after the trim the
player would give it (before 2026-10-21's fix: only songs with measures, shipped and scored candidates, were trimmed; the
player now measures the rest from their files). Writes research/data/level_probe.json.

  runtime/venv/bin/python research/level_probe.py --project P
"""
import argparse
import json
import statistics
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from soundlab import candidates, dsp, project as P  # noqa: E402
from soundlab.music.measures import _beats  # noqa: E402
from soundlab.music.shipping import library  # noqa: E402
from soundlab.store import Store  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    a = ap.parse_args()
    proj = P.load(a.project)
    lib, M = library(proj), proj.music
    F = Store.read(proj.work / "families.json", {"items": {}})
    beat = int(round(60.0 / M["bpm"] * dsp.SR))
    shipped = {t["id"]: t for t in lib["tracks"]}
    scored = {k for k, v in candidates.measures(proj).items() if v.get("beats")}  # (the scored candidates: measured too)
    url = lambda u: (proj.work / "clips" / u[7:]) if u.startswith("/clips/") else Path(proj.assets) / u[9:]
    rows = []
    for sid, it in F["items"].items():
        src = (shipped.get(sid) or {}).get("src") or it.get("src") or {}
        row = dict(id=sid, kind=it.get("kind"), measured=bool((shipped.get(sid) or {}).get("measure")) or sid in scored)
        for lv in ("calm", "battle"):
            f = src.get(lv)
            if not f or not url(f).is_file():
                continue
            row[lv] = round(statistics.median(_beats(dsp.decode(url(f)), beat)), 2)
        rows.append(row)
    ref = {lv: statistics.median([r[lv] for r in rows if r["kind"] == "shipped" and lv in r]) for lv in ("calm", "battle")}
    for r in rows:
        for lv in ("calm", "battle"):
            if lv in r:
                trim = max(-6, min(6, ref[lv] - r[lv])) if r["measured"] else 0.0  # (what the player gives it)
                r[f"{lv}_off"] = round(r[lv] - ref[lv], 2)
                r[f"{lv}_played"] = round(r[lv] + trim - ref[lv], 2)
    Path("research/data").mkdir(exist_ok=True)
    json.dump(dict(ref=ref, rows=rows), open("research/data/level_probe.json", "w"), indent=1)
    print(f"reference (the shipped songs' median beat): calm {ref['calm']:.1f} dB, battle {ref['battle']:.1f} dB")
    for kind in ("shipped", "candidate", "trial", "extension"):
        rs = [r for r in rows if r["kind"] == kind and "calm_off" in r]
        if not rs:
            continue
        for lv in ("calm", "battle"):
            off = sorted(r[f"{lv}_off"] for r in rs if f"{lv}_off" in r)
            pl = sorted(r[f"{lv}_played"] for r in rs if f"{lv}_played" in r)
            if not off:
                continue
            far = sum(1 for v in pl if abs(v) > 3)
            print(f"{kind:9} {lv:6} n={len(off):3}  as made: median {statistics.median(off):+5.1f} dB, from {off[0]:+5.1f} to {off[-1]:+5.1f}"
                  f"  | as played: median {statistics.median(pl):+5.1f}, {far} more than 3 dB off")
    worst = sorted((r for r in rows if "calm_played" in r), key=lambda r: -abs(r["calm_played"]))[:8]
    print("loudest and quietest as played (calm):")
    for r in worst:
        print(f"  {r['calm_played']:+5.1f} dB  {r['kind']:9} {r['id']}")


if __name__ == "__main__":
    main()

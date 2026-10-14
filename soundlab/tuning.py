"""Prompt tuning: how to write prompts for each model, which model makes what, and the user's taste.

It lives in tuning.json at the tool's root (or SOUNDLAB_TUNING; tracked, and shared by every project: what a model can do and what the
user likes carry over from game to game). The Tuning page edits it; `soundlab tuning` prints it for an agent, with
what this project's votes say. It is the starting point for every prompt an agent writes (AGENTS.md).

  tasks    {task: {model, note}}                 task: sfx | alerts | instruments | music
  taste    [{id, text, by, added}]               the user's taste, for every model
  models   {model id: {name, engine, summary, rules, templates, examples}}
             engine     "sa3": SoundLab's generators run it | "external": made elsewhere, imported into the index
             rules      [{id, text, why, tasks, by, added, pinned}]   tasks: the tasks it's for ([] = all)
             templates  {task: the prompt's shape}
             examples   [{id, prompt, verdict ("good" | "bad"), why, task, take}]   take: a take id, to listen to

`by` is "user" or "agent". The user's rules and taste are instructions: agents never edit or remove them. An agent's
own rules are hypotheses, with their evidence in `why`, revised as the votes come in.
"""
from __future__ import annotations

import json
import os
import secrets
import statistics
from collections import Counter
from datetime import date

from pathlib import Path

from . import paths
from .store import Store

PATH = Path(os.environ.get("SOUNDLAB_TUNING") or paths.TOOL / "tuning.json")
TASKS = {"sfx": "Sound effects", "alerts": "Alerts", "instruments": "Instrument auditions", "music": "Music"}
COMMANDS = {"sfx": "sounds generate", "alerts": "alerts build", "instruments": "music audition", "music": "music generate"}
ENGINES = {"sa3": "runs in SoundLab", "external": "made outside SoundLab, imported"}
RUNNABLE = {"sa3"}  # what SoundLab's generators can run
FEW = 5  # a prompt style offered for fewer sounds than this is listed apart: one lucky win says little


def stamp() -> str:  # (a string: nanoseconds don't survive a trip through a JavaScript number)
    return str(PATH.stat().st_mtime_ns) if PATH.exists() else "0"


def load() -> dict:
    return clean(Store.read(PATH, {}))


def save(t: dict) -> dict:
    t = clean(t)
    Store.write(PATH, t)
    return t


def _id(prefix: str) -> str:
    return prefix + secrets.token_hex(3)


def clean(t: dict) -> dict:
    """The file's shape, whatever was posted: known keys, right types, ids on everything."""
    t = t if isinstance(t, dict) else {}
    s = lambda x: x.strip() if isinstance(x, str) else ""
    by = lambda x: "user" if x != "agent" else "agent"
    tasks = lambda xs: [x for x in xs if x in TASKS] if isinstance(xs, list) else []
    models = {}
    for mid, m in (t.get("models") or {}).items():
        if not isinstance(m, dict) or not s(mid):
            continue
        models[s(mid)] = dict(
            name=s(m.get("name")) or s(mid), engine=m.get("engine") if m.get("engine") in ENGINES else "external",
            summary=s(m.get("summary")),
            rules=[dict(id=r.get("id") or _id("r"), text=s(r.get("text")), why=s(r.get("why")), tasks=tasks(r.get("tasks")),
                        by=by(r.get("by")), added=s(r.get("added")) or date.today().isoformat(), pinned=bool(r.get("pinned")))
                   for r in m.get("rules") or [] if isinstance(r, dict) and s(r.get("text"))],
            templates={k: s(v) for k, v in (m.get("templates") or {}).items() if k in TASKS and s(v)},
            examples=[dict(id=e.get("id") or _id("e"), prompt=s(e.get("prompt")), verdict="bad" if e.get("verdict") == "bad" else "good",
                           why=s(e.get("why")), task=e.get("task") if e.get("task") in TASKS else "sfx", take=s(e.get("take")))
                      for e in m.get("examples") or [] if isinstance(e, dict) and s(e.get("prompt"))])
    given = t.get("tasks") if isinstance(t.get("tasks"), dict) else {}

    def task(k):
        x = given.get(k) if isinstance(given.get(k), dict) else {}
        return dict(model=x.get("model") if x.get("model") in models else next(iter(models), ""), note=s(x.get("note")))

    return dict(
        about=s(t.get("about")) or "Prompt tuning: the starting point for every prompt. See soundlab/tuning.py and AGENTS.md.",
        tasks={k: task(k) for k in TASKS},
        taste=[dict(id=x.get("id") or _id("t"), text=s(x.get("text")), by=by(x.get("by")), added=s(x.get("added")) or date.today().isoformat())
               for x in t.get("taste") or [] if isinstance(x, dict) and s(x.get("text"))],
        models=models)


def require(task: str) -> None:
    """Refuse to generate a task that the tuning gives to a model SoundLab can't run."""
    if not PATH.exists():
        return
    t = load()
    mid = t["tasks"][task]["model"]
    m = t["models"].get(mid)
    if m and m["engine"] not in RUNNABLE:
        raise SystemExit(f"tuning.json gives {TASKS[task].lower()} to {m['name']} ({ENGINES[m['engine']]}): SoundLab's "
                         f"generators only run Stable Audio 3. Make those takes outside SoundLab, or give the task back "
                         f"to a model with engine \"sa3\" on the Tuning page.")


# --------------------------------------------------------------------------- evidence: what this project's votes say

def evidence(proj) -> dict:
    """{model id: {task: facts}} from the project's takes and votes."""
    st = Store(proj)
    idx, v = st.index(), st.votes()
    default = idx.get("model") or "stable-audio-3-medium"
    out: dict = {}
    for mid in {c.get("model") or default for c in idx["clips"].values()} | {default}:
        clips = {k: c for k, c in idx["clips"].items() if (c.get("model") or default) == mid}
        sfx = {k: c for k, c in clips.items() if not c.get("kit") and c.get("variant") != "pool"}
        e = {}
        if sfx:
            rows, offered = {}, {}
            for k, c in sfx.items():
                r = rows.setdefault(c["variant"], dict(takes=0, silent=0, up=0, down=0, picked=0, words=[]))
                r["takes"] += 1
                r["silent"] += bool(c.get("failed"))
                r["up"] += v["clips"].get(k) == 1
                r["down"] += v["clips"].get(k) == -1
                r["words"].append(len((c.get("prompt") or "").split()))
                offered.setdefault(c["variant"], set()).add(c["name"])
            for p in v["picks"].values():
                if p in sfx and sfx[p]["variant"] in rows:
                    rows[sfx[p]["variant"]]["picked"] += 1
            styles = [dict(style=k, offered=len(offered[k]), rate=round(r["picked"] / len(offered[k]), 3),
                           words=int(statistics.median(r["words"])), **{x: r[x] for x in ("takes", "silent", "up", "down", "picked")})
                      for k, r in rows.items()]
            styles.sort(key=lambda r: (r["offered"] < FEW, -r["rate"], -r["picked"]))
            gen = [c["gen_s"] for c in sfx.values() if c.get("gen_s")]
            made = {(c["name"], c["variant"]) for c in sfx.values()}  # (the user's notes on prompts this model made takes of)
            notes = [dict(sound=n, style=var, text=x["text"], at=x.get("at", "")) for n, vs in v.get("prompt_notes", {}).items()
                     for var, x in vs.items() if (n, var) in made]
            e["sfx"] = dict(styles=styles, takes=len(sfx), silent=sum(bool(c.get("failed")) for c in sfx.values()), notes=notes,
                            sounds=len({c["name"] for c in sfx.values()}), gen_s=round(statistics.median(gen), 2) if gen else None, few=FEW)
        names = (idx.get("sets", {}).get("alerts") or {}).get("names", [])
        kits = Counter((clips[p].get("kit") or clips[p]["variant"]).split(".")[0] for n, p in v["picks"].items() if n in names and p in clips)
        if kits:
            e["alerts"] = dict(alerts=len(names), picked=dict(kits.most_common()))
        pool = [n for n, m in idx["sounds"].items() if m.get("kind") == "pool"]
        if pool and any(c.get("variant") == "pool" for c in clips.values()):
            def state(n):
                net = sum(v["clips"].get(k, 0) for k, c in clips.items() if c["name"] == n)
                return "out" if net < 0 else "in" if v["picks"].get(n) or net > 0 else "undecided"
            e["instruments"] = dict(Counter(state(n) for n in pool))
        if mid == default and idx.get("mesh", {}).get("contexts"):
            prof = {}
            for k, x in v["clips"].items():
                if k.startswith("mesh_"):
                    p = prof.setdefault(k.rsplit(".", 1)[-1], dict(liked=0, disliked=0))
                    p["liked" if x > 0 else "disliked"] += 1
            e["music"] = dict(sets=len(idx["mesh"]["contexts"]), takes=sum(len(c["takes"]) for c in idx["mesh"]["contexts"].values()),
                              votes=prof, notes={k[5:]: n for k, n in v["notes"].items() if k.startswith("mesh_")})
        out[mid] = e
    return out


# --------------------------------------------------------------------------- the agent's view

def _facts(task: str, e: dict) -> list[str]:
    if task == "sfx":
        main = [r for r in e["styles"] if r["offered"] >= e["few"]]
        few = [r for r in e["styles"] if r["offered"] < e["few"]]
        lines = ["win rate by prompt style: " + " · ".join(f"{r['style']} {round(100 * r['rate'])}% ({r['picked']}/{r['offered']} sounds, "
                                                          f"~{r['words']} words)" for r in main)] if main else []
        if few:
            lines.append(f"tried on fewer than {e['few']} sounds: " + ", ".join(f"{r['style']} {r['picked']}/{r['offered']}" for r in few))
        lines.append(f"{e['takes']} takes of {e['sounds']} sounds, {e['silent']} silent" + (f", median {e['gen_s']} s per take" if e["gen_s"] else ""))
        lines += [f"the user's note on {x['sound']} · {x['style']} ({x['at']}): {x['text']}" for x in e.get("notes", [])]
        return lines
    if task == "alerts":
        return ["picked kits: " + ", ".join(f"{k} for {n} of {e['alerts']} alerts" for k, n in e["picked"].items())]
    if task == "instruments":
        return [", ".join(f"{n} {k}" for k, n in e.items())]
    return [f"{e['sets']} sets, {e['takes']} takes; votes by profile: " +
            (", ".join(f"{p} {x['liked']} liked / {x['disliked']} disliked" for p, x in e["votes"].items()) or "none yet")] + \
           [f"note on {k}: {n}" for k, n in e["notes"].items()]


def show(proj, task: str | None = None, as_json: bool = False) -> int:
    t = load()
    ev = evidence(proj) if proj else {}
    if as_json:
        print(json.dumps(dict(tuning=t, evidence=ev, path=str(PATH)), indent=1))
        return 0
    if not PATH.exists():
        print(f"no tuning yet ({PATH}): open the Tuning page, or write it (soundlab/tuning.py documents the shape)")
        return 0
    print(f"Prompt tuning ({PATH}): the starting point for every prompt. Follow it, then vary from it.")
    if t["taste"]:
        print("\nThe user's taste (for every model; by user = an instruction):")
        for x in t["taste"]:
            print(f"  - {x['text']}  [{x['by']}, {x['added']}]")
    for k in [task] if task else TASKS:
        mid = t["tasks"][k]["model"]
        m = t["models"].get(mid)
        print(f"\n{TASKS[k]} ({k}, `{COMMANDS[k]}`) → " + (f"{m['name']} [{mid}, {ENGINES[m['engine']]}]" if m else "no model assigned"))
        if t["tasks"][k]["note"]:
            print(f"  note: {t['tasks'][k]['note']}")
        if not m:
            continue
        if m["summary"]:
            print(f"  {m['summary']}")
        rules = sorted((r for r in m["rules"] if not r["tasks"] or k in r["tasks"]), key=lambda r: (not r["pinned"], r["by"] != "user"))
        if rules:
            print("  rules:")
            for r in rules:
                print(f"    - {'[user] ' if r['by'] == 'user' else ''}{r['text']}" + (f"  (why: {r['why']})" if r["why"] else ""))
        if m["templates"].get(k):
            print(f"  prompt shape: {m['templates'][k]}")
        for x in (x for x in m["examples"] if x["task"] == k):
            print(f"  {x['verdict']} example: \"{x['prompt']}\"" + (f"  ({x['why']})" if x["why"] else "") + (f"  take {x['take']}" if x["take"] else ""))
        e = ev.get(mid, {}).get(k)
        if e:
            print(f"  evidence in {proj.name}:")
            for line in _facts(k, e):
                print(f"    {line}")
    return 0


def summary() -> str:
    """One line for `status`: which model makes what."""
    if not PATH.exists():
        return ""
    t = load()
    return " · ".join(f"{k} → {t['models'].get(x['model'], {}).get('name', x['model'] or 'none')}" for k, x in t["tasks"].items())

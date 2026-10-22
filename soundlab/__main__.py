"""SoundLab command line. Run through ./soundlab.sh (Linux) or soundlab.cmd (Windows), which use the installed runtime.

  soundlab [--project PATH] serve [--port 7870]          the web app
  soundlab [--project PATH] status [--json]              what the project has: sounds, takes, decisions, music
  soundlab [--project PATH] tuning [--task T] [--json]   how to write prompts for the model each task uses (read first)
  soundlab doctor [--generate]                           check the install (and make one second of audio)
  soundlab [--project PATH] sounds generate [--seeds 3] [--only NAME ...] [--variants V ...]
  soundlab [--project PATH] sounds promote [--apply] [--only NAME ...]
  soundlab [--project PATH] alerts build
  soundlab [--project PATH] music audition [--seeds 4]
  soundlab [--project PATH] music generate --contexts C ... [--biomes B ...] [--styles S ...] [--profiles P ...]
                                           [--takes 3] [--tries 14] [--same-round]
  soundlab [--project PATH] music derive --profiles P ... [--sets KEY ... | --liked] [--no-new-layers]   new profiles (or new levels) for existing takes
  soundlab [--project PATH] music check [--sets KEY ...]                    measure takes for what sounds off
  soundlab [--project PATH] music trial [--takes 2] [--contexts C ...] [--style drawn] [--pending]   a mini trial for the Trial page
  soundlab [--project PATH] music grow [SET.TAKE] [--n 4]                   seamless extensions of a new-family take
  soundlab [--project PATH] music candidates [--all] [--cpu]                score new takes: plays nice with the shipped songs, catchiness
  soundlab [--project PATH] music promote [--apply] [--add SET.TAKE.PROFILE ...]
  soundlab [--project PATH] balance measure

--project is a game folder holding soundlab_project.py, or the file itself (default: SOUNDLAB_PROJECT, else the
current folder). Generators skip takes that already exist, so re-running only adds what is new.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys


def doctor(generate: bool) -> int:
    import os

    from . import paths

    os.environ.setdefault("HF_HOME", str(paths.hf_home()))  # (before huggingface_hub is imported: it reads it once)
    ok = True

    def line(good: bool, what: str, detail: str = "") -> None:
        nonlocal ok
        ok &= good
        print(f"  [{'ok' if good else '!!'}] {what}" + (f": {detail}" if detail else ""))

    print("SoundLab doctor")
    line(sys.version_info >= (3, 10), "python", sys.version.split()[0])
    ff = shutil.which(paths.ffmpeg())
    line(bool(ff), "ffmpeg", ff or "not found (install it and put it on PATH, or set FFMPEG)")
    if ff:
        filters = subprocess.run([paths.ffmpeg(), "-hide_banner", "-filters"], capture_output=True, text=True).stdout
        line(" rubberband " in filters, "ffmpeg rubberband filter", "needed for the music's tempo correction")
    try:
        import torch

        cuda = torch.cuda.is_available()
        line(cuda, "torch + CUDA", f"{torch.__version__}, {torch.cuda.get_device_name(0) if cuda else 'no CUDA GPU'}")
    except ImportError as e:
        line(False, "torch", str(e))
    try:
        import flash_attn

        line(True, "flash-attn", flash_attn.__version__)
    except ImportError:
        print("  [--] flash-attn: not installed (optional: Stable Audio 3 falls back to PyTorch attention)")
    for mod in ("stable_audio_3", "librosa", "soundfile"):
        try:
            __import__(mod)
            line(True, mod)
        except ImportError as e:
            line(False, mod, str(e))
    from huggingface_hub import try_to_load_from_cache

    have = [isinstance(try_to_load_from_cache(paths.MODEL_REPO, f), str)
            for f in ("model.safetensors", "model_config.json", "t5gemma-b-b-ul2/model.safetensors")]
    line(all(have), "model", f"{paths.MODEL_REPO} in {paths.hf_home()}" if all(have) else "missing: run install.py")
    if generate and ok:
        from .engine import Engine

        eng = Engine()
        x = eng.generate("TrackType: SFX, a single wooden knock, close mic.", 1.0, 0)
        from . import dsp

        line(not dsp.silent(x), "generation", f"1 s of audio in {eng.last_s:.2f} s")
    print("all good" if ok else "problems above")
    return 0 if ok else 1


def status(proj, as_json: bool) -> int:
    from .store import Store

    st = Store(proj)
    idx, votes = st.index(), st.votes()
    sounds = [s.name for s in proj.sounds()]
    taken = {c["name"] for c in idx["clips"].values()}
    out = dict(
        project=proj.name, file=proj.path(),
        sounds=dict(total=len(sounds), with_takes=sum(n in taken for n in sounds),
                    decided=sum(n in votes["picks"] for n in sounds),
                    kept_shipped=sum(votes["picks"].get(n) == "shipped" for n in sounds),
                    undecided=[n for n in sounds if n in taken and n not in votes["picks"]]),
        takes=dict(total=len(idx["clips"]), silent=sum(1 for c in idx["clips"].values() if c.get("failed"))),
        notes=votes["notes"],
        prompt_notes={n: {var: dict(x, current=x.get("prompt", "") == idx["prompts"].get(n, {}).get(var, x.get("prompt", "")))
                          for var, x in vs.items()} for n, vs in votes["prompt_notes"].items()},
        alert_sets=len(idx.get("sets", {}).get("alerts", {}).get("rows", [])),
        music={k: len(c["takes"]) for k, c in idx.get("mesh", {}).get("contexts", {}).items()},
        promoted=dict(sounds=len(Store.read(st.promoted_path, {})), music_tracks=len(Store.read(st.music_promoted_path, {}))),
    )
    if as_json:
        print(json.dumps(out, indent=1))
        return 0
    s = out["sounds"]
    print(f"{proj.name} ({proj.path()})")
    print(f"  sounds: {s['total']}, {s['with_takes']} with takes, {s['decided']} decided ({s['kept_shipped']} keep the shipped file)")
    if s["undecided"]:
        print(f"  undecided: {', '.join(s['undecided'][:12])}{' ...' if len(s['undecided']) > 12 else ''}")
    print(f"  takes: {out['takes']['total']} ({out['takes']['silent']} silent)")
    print(f"  alert sets: {out['alert_sets']}; music sets: {out['music'] or 'none'}")
    print(f"  shipped: {out['promoted']['sounds']} sounds, {out['promoted']['music_tracks']} music tracks")
    from . import tuning

    if tuning.summary():
        print(f"  models: {tuning.summary()} (prompt tuning: soundlab tuning)")
    for n, t in votes["notes"].items():
        print(f"  note on {n} (the whole sound): {t}")
    for n, vs in out["prompt_notes"].items():
        for var, x in vs.items():
            print(f"  note on {n} · {var} prompt ({x.get('at', '')}): {x['text']}" + ("" if x["current"] else "  [the prompt has changed since]"))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="soundlab", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", help="game folder with soundlab_project.py, or the file")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("serve")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=7870)
    p = sub.add_parser("status")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("tuning")
    p.add_argument("--task", choices=["sfx", "alerts", "instruments", "music"])
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("doctor")
    p.add_argument("--generate", action="store_true")
    snd = sub.add_parser("sounds").add_subparsers(dest="action", required=True)
    p = snd.add_parser("generate")
    p.add_argument("--seeds", type=int, default=3)
    p.add_argument("--only", nargs="*")
    p.add_argument("--variants", nargs="*")
    p = snd.add_parser("promote")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--only", nargs="*")
    al = sub.add_parser("alerts").add_subparsers(dest="action", required=True)
    al.add_parser("build")
    mu = sub.add_parser("music").add_subparsers(dest="action", required=True)
    p = mu.add_parser("audition")
    p.add_argument("--seeds", type=int, default=4)
    p = mu.add_parser("generate")
    p.add_argument("--contexts", nargs="+", required=True)
    p.add_argument("--biomes", nargs="*", default=["any"])
    p.add_argument("--takes", type=int, default=3)
    p.add_argument("--tries", type=int, default=14)
    p.add_argument("--styles", nargs="*", help="the project's alternative prompt styles (music.styles), for a tuning round")
    p.add_argument("--profiles", nargs="*", help="only these profiles (default: all)")
    p.add_argument("--same-round", action="store_true", help="add this run's takes to the newest round (one batch in several runs)")
    p = mu.add_parser("trial", help="a mini trial: a few takes per context in a style that draws its words, for the Trial page")
    p.add_argument("--takes", type=int, default=2, help="takes per context")
    p.add_argument("--contexts", nargs="*")
    p.add_argument("--style", default="drawn")
    p.add_argument("--pending", action="store_true", help="only print how many trial takes are waiting for an answer")
    p = mu.add_parser("families", help="sort every song into families and queue what to judge next (work/families.json)")
    p = mu.add_parser("grow", help="seamless extensions of a take answered 'a new family' on the Trial page")
    p.add_argument("take", nargs="?", help="<set>.<take> (default: the oldest new-family seed that needs extensions)")
    p.add_argument("--n", type=int, default=4, help="extensions per seed")
    p = mu.add_parser("derive")
    p.add_argument("--profiles", nargs="+", required=True)
    p.add_argument("--sets", nargs="*", help="music set keys (default: the newest round's)")
    p.add_argument("--liked", action="store_true", help="every take liked at these profiles, in any set or round")
    p.add_argument("--no-new-layers", action="store_true",
                   help="leave out a layer a take has no stem for, rather than generating it (no generator needed)")
    p = mu.add_parser("check")
    p.add_argument("--sets", nargs="*", help="music set keys (default: all)")
    p = mu.add_parser("trims", help="measure the shipped tracks for the Songs page: per-bar loudness and guessed cues")
    p.add_argument("--force", action="store_true", help="measure every track again, not only changed files")
    p = mu.add_parser("glues", help="a mellow pad per family of shipped tracks, for the Mixer (after music trims)")
    p.add_argument("--force", action="store_true", help="make every glue again")
    p = mu.add_parser("stems", help="Demucs stems of every shipped track's calm and battle levels, for the Mixer")
    p.add_argument("--force", action="store_true", help="split every track again")
    p = mu.add_parser("joins", help="the designer's votes on Mixer transitions against their join scores: where bad joins slip through")
    p.add_argument("--fit", action="store_true", help="learn their taste from the votes: the model the Mixer walks by")
    p = mu.add_parser("candidates", help="score new takes before you hear them: plays nice with the shipped songs, catchiness (work/candidates.json)")
    p.add_argument("--all", action="store_true", help="every round's takes, not only the newest round's")
    p.add_argument("--cpu", action="store_true", help="split stems on the CPU (while a generator holds the GPU)")
    p.add_argument("--catchy", type=float, default=0.0, help="catchiness's weight in the ranking (default 0: plays nice and unique)")
    p = mu.add_parser("retune", help="retuned copies of the tracks off the common pitch, for the Mixer (after music trims)")
    p.add_argument("--force", action="store_true", help="retune every file again")
    p = mu.add_parser("fills", help="SA3-generated fills at each shipped track's mellow loop point, for the Mixer")
    p.add_argument("--seeds", type=int, default=4, help="fills kept per track and loop")
    p.add_argument("--bars", type=int, default=1)
    p.add_argument("--only", nargs="*", help="track ids (default: all)")
    p = mu.add_parser("stingers", help="accents for a scene change (a riser into its downbeat, a boom or a crash on it), for the Mixer")
    p.add_argument("--seeds", type=int, default=6, help="takes per prompt")
    p.add_argument("--kinds", nargs="*", choices=["riser", "boom", "crash"], help="default: all three")
    p = mu.add_parser("promote")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--add", nargs="+", metavar="SET.TAKE.PROFILE",
                   help="ship just these takes beside what has shipped (nothing is removed)")
    p.add_argument("--replace", action="store_true",
                   help="with --add: these takes become the whole rotation of their contexts (the rest is removed)")
    p = sub.add_parser("sync", help="the manifest, the walk and the docs for the songs shipped, into the game's folder (dry run without --apply)")
    p.add_argument("--apply", action="store_true", help="write them")
    p = sub.add_parser("data", help="the lab's data (votes, cues, settings, sessions) against the game's folder for it: share it, or pull the game's")
    p.add_argument("action", nargs="?", choices=["status", "share", "pull"], default="status")
    p.add_argument("--apply", action="store_true")
    p = sub.add_parser("ship", help="a batch of songs into the game's folder: their audio, then the manifest (dry run without --apply)")
    p.add_argument("ids", nargs="*", help="song ids (see `soundlab sync` for the ready ones)")
    p.add_argument("--all", action="store_true", help="every song ready to ship")
    p.add_argument("--drop-local", action="store_true", help="remove the lab's own copy of what it ships (it plays them from the game's folder)")
    p.add_argument("--apply", action="store_true", help="ship them")
    ba = sub.add_parser("balance").add_subparsers(dest="action", required=True)
    ba.add_parser("measure")
    a = ap.parse_args()

    if a.cmd == "doctor":
        return doctor(a.generate)
    if a.cmd == "tuning":  # (works without a project too: just no evidence)
        from . import project as pj, tuning

        try:
            proj = pj.load(a.project)
        except SystemExit:
            proj = None
        return tuning.show(proj, a.task, a.json)
    from . import project

    proj = project.load(a.project)
    if a.cmd == "serve":
        from .server import serve

        serve(proj, a.host, a.port)
        return 0
    if a.cmd == "status":
        return status(proj, a.json)
    if a.cmd == "sounds":
        from . import sounds

        return sounds.generate(proj, a.seeds, a.only, a.variants) if a.action == "generate" else \
            sounds.promote(proj, a.apply, a.only)
    if a.cmd == "alerts":
        from . import alerts

        return alerts.build(proj)
    if a.cmd == "music":
        from . import music

        if not proj.music:
            raise SystemExit("this project has no music design (Project.music)")
        if a.action == "audition":
            return music.auditions(proj, a.seeds)
        if a.action == "generate":
            bad = [c for c in a.contexts if c not in proj.music["contexts"]] + \
                  [b for b in a.biomes if b not in proj.music["biomes"]] + \
                  [s for s in a.styles or [] if s not in proj.music.get("styles", {})] + \
                  [p for p in a.profiles or [] if p not in proj.music["profiles"]]
            if bad:
                raise SystemExit(f"unknown contexts/biomes/styles/profiles: {bad}")
            return music.generate(proj, a.contexts, a.biomes, a.takes, a.tries, a.styles, a.profiles, a.same_round)
        if a.action == "check":
            return music.check(proj, a.sets)
        if a.action == "trims":
            return music.trims(proj, a.force)
        if a.action == "glues":
            return music.glues(proj, a.force)
        if a.action == "joins":
            return music.fit_joins(proj) if a.fit else music.joins(proj)
        if a.action == "retune":
            return music.retune(proj, a.force)
        if a.action == "families":
            from . import families
            return families.build(proj)
        if a.action == "grow":
            return music.grow(proj, a.take, a.n)
        if a.action == "trial":
            if a.pending:
                print(music.trial_pending(proj))
                return 0
            return music.trial(proj, a.takes, a.contexts, a.style)
        if a.action == "candidates":
            from . import candidates
            return candidates.candidates(proj, a.all, a.cpu, a.catchy)
        if a.action == "stems":
            return music.stems(proj, a.force)
        if a.action == "fills":
            return music.fills(proj, a.seeds, a.bars, a.only)
        if a.action == "stingers":
            from .music import stingers
            return stingers.generate(proj, a.seeds, a.kinds)
        if a.action == "derive":
            bad = [p for p in a.profiles if p not in proj.music["profiles"]]
            if bad:
                raise SystemExit(f"unknown profiles: {bad}")
            return music.derive(proj, a.profiles, a.sets, a.liked, not a.no_new_layers)
        return music.add(proj, a.add, a.apply, a.replace) if a.add else music.promote(proj, a.apply)
    if a.cmd == "sync":
        from . import sync
        return sync.run(proj, a.apply)
    if a.cmd == "data":
        from . import share
        return share.run(proj, a.action, a.apply)
    if a.cmd == "ship":
        from . import sync
        return sync.run_ship(proj, a.ids, a.all, a.drop_local, a.apply)
    if a.cmd == "balance":
        from . import balance

        return balance.measure(proj)
    return 1


if __name__ == "__main__":
    sys.exit(main())

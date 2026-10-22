"""Rounds and shipping: the newest round and a set's newest batch, shipping takes into the game (`music promote`,
`music promote --add`) and the library of what the game ships (the Songs page and the Mixer read it)."""
from __future__ import annotations

import hashlib
import shutil
from datetime import date
from pathlib import Path

from .. import project as P
from ..store import Store


def newest_round(mesh: dict) -> str:
    """The latest run's round id (the batch being listened to)."""
    rounds = mesh.get("rounds") or []
    return rounds[-1]["id"] if rounds else max((c.get("round", "") for c in mesh.get("contexts", {}).values()), default="")


def current_takes(c: dict) -> list[dict]:
    """A set's newest batch: the takes of the round it was last generated in."""
    return [t for t in c["takes"] if t.get("round", c.get("round", "")) == c.get("round", "")]


def add(proj: P.Project, takes: list[str], apply: bool = False, replace: bool = False) -> int:
    """Ship chosen takes ("<set>.<take>.<profile>", e.g. night~trailer.k2.close) into rotation beside what has
    already shipped: the manifest's other tracks stay as they are and nothing is removed. For locking in keepers
    while the rest of a round is undecided. With `replace`, the chosen takes become the whole rotation of each
    context and biome they're for (its other tracks are removed); other contexts are untouched."""
    M, st = proj.music, Store(proj)
    sets = st.index().get("mesh", {}).get("contexts", {})
    out_dir, levels = Path(M["out_dir"]), M["levels"]
    manifest = Store.read(Path(M["manifest"]), {}) or dict(bpm=M["bpm"], bar_beats=M["bar_beats"], loop_bars=M["bars"],
                                                           rotate_loops=M.get("rotate_loops", 2), levels=levels, tracks=[])
    record, written = Store.read(st.music_promoted_path, {}), []
    for name in takes:
        key, tk, prof = name.rsplit(".", 2)
        c = sets.get(key)
        take = next((t for t in (c or {}).get("takes", []) if t["id"] == tk), None)
        if not take or prof not in take["profiles"]:
            raise SystemExit(f"no take {name} (a set key, a take id and one of its profiles)")
        tid = ".".join(x for x in (c["context"], c["biome"], c.get("style"), tk, prof) if x)
        files = {lv: out_dir / f"{tid}_{lv}.ogg" for lv in levels}
        known = any(t["id"] == tid for t in manifest["tracks"])
        print(f"  {name} -> {tid} ({c['context']}, {c['biome']})" + (": already shipped, refreshing its files" if known else ""))
        if not known:
            manifest["tracks"].append(dict(id=tid, context=c["context"], biome=c["biome"],
                                           files={lv: proj.asset_uri(f) for lv, f in files.items()}))
        record[tid] = dict(key=key, take=tk, profile=prof, seed=take["seed"], voted=True, added=True,
                           prompts=take.get("prompts", c["prompts"]), instruments=take.get("instruments", {}),
                           date=date.today().isoformat(), sha256={})
        for lv in levels:
            src = st.clips / take["profiles"][prof]["levels"][lv]
            record[tid]["sha256"][lv] = hashlib.sha256(src.read_bytes()).hexdigest()
            if apply:
                files[lv].parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, files[lv])
                if M.get("seed_file"):
                    M["seed_file"](files[lv])
                written.append(files[lv])
    removed = []
    if replace:
        chosen = {".".join(x for x in (sets[k]["context"], sets[k]["biome"], sets[k].get("style"), tk, pr) if x)
                  for k, tk, pr in (n.rsplit(".", 2) for n in takes)}
        touched = {(sets[n.rsplit(".", 2)[0]]["context"], sets[n.rsplit(".", 2)[0]]["biome"]) for n in takes}
        removed = [t for t in manifest["tracks"] if (t["context"], t.get("biome", "any")) in touched and t["id"] not in chosen]
        manifest["tracks"] = [t for t in manifest["tracks"] if t not in removed]
        for t in removed:
            print(f"  - {t['id']} ({t['context']}, {t.get('biome', 'any')}): leaves the rotation")
    ctxs = {sets[n.rsplit(".", 2)[0]]["context"] for n in takes}
    print("  rotation then: " + ", ".join(f"{x} {sum(t['context'] == x for t in manifest['tracks'])} tracks" for x in sorted(ctxs)))
    if not apply:
        print("dry run: pass --apply to ship")
        return 0
    out_dir = Path(M["out_dir"])
    for t in removed:  # (its files go too; they stay in git history)
        for lv in levels:
            f = out_dir / f"{t['id']}_{lv}.ogg"
            f.unlink(missing_ok=True)
            f.with_name(f.name + ".import").unlink(missing_ok=True)
        record.pop(t["id"], None)
    st.write(Path(M["manifest"]), manifest)
    st.write(st.music_promoted_path, record, sort=True)
    print(f"added {len(takes)}, removed {len(removed)}; manifest {Path(M['manifest']).relative_to(proj.root)} has {len(manifest['tracks'])} tracks")
    return proj.after_install(written) if proj.after_install else 0


def library(proj: P.Project) -> dict:
    """Every track the game ships (its music manifest), for the Songs page: each one's level files (relative to the
    project's assets, served at /shipped/), its provenance (music_promoted.json: set, take, profile, prompts,
    instruments, date) and its song group (the game's groups file). Reads only what's shipped: no work index needed."""
    M, st = proj.music, Store(proj)
    man = Store.read(Path(M["manifest"]), {})
    prov = Store.read(st.music_promoted_path, {})
    G = M.get("groups")
    grouped = Store.read(Path(G["file"]), {}) if G else {}
    in_group = grouped.get("tracks", {})
    out_dir, assets = Path(M["out_dir"]), Path(proj.assets).resolve()
    levels = man.get("levels", M["levels"])
    measured = Store.read(proj.work / "songs.json", {})  # (music trims: per-bar loudness and the guessed cues)
    tracks = []
    for t in man.get("tracks", []):
        p = prov.get(t["id"], {})
        files = {}
        for lv in levels:
            f = (out_dir / f"{t['id']}_{lv}.ogg").resolve()
            if f.is_file() and f.is_relative_to(assets):
                files[lv] = f.relative_to(assets).as_posix()
        tracks.append(dict(id=t["id"], context=t.get("context"), biome=t.get("biome", "any"), key=p.get("key"),
                           take=p.get("take"), profile=p.get("profile"), date=p.get("date"),
                           instruments=p.get("instruments", {}), prompts=p.get("prompts", {}),
                           group=in_group.get(t["id"], G["default"] if G else None), files=files))
        m = measured.get(t["id"])
        if m and all((Path(proj.assets) / files.get(lv, "")).is_file() and
                     f"{(Path(proj.assets) / files[lv]).stat().st_size}:{(Path(proj.assets) / files[lv]).stat().st_mtime_ns}" == sg
                     for lv, sg in m["sig"].items()):  # (only while it describes the files shipped now)
            tracks[-1]["measure"] = dict(loud=m["loud"], cuts=m["cuts"], step=m["step"], feat=m.get("feat"),
                                         tuning=m.get("tuning"), phrase=m.get("phrase"), beats=m.get("beats"), onset=m.get("onset"))
            if m.get("family"):
                tracks[-1]["family"] = m["family"]
    stem_index = Store.read(proj.work / "stems.json", {})  # (music stems: the Mixer's variation over repeats)
    fill_index = Store.read(proj.work / "fills.json", {})  # (music fills: generated fills at each loop point)
    for t in tracks:
        if t["id"] in stem_index:
            t["stems"] = stem_index[t["id"]]["files"]
            t["stem_gain"] = stem_index[t["id"]].get("gain", {})  # (each variation's gain back to the full level, dB)
            t["stem_loud"] = stem_index[t["id"]].get("loud", {})  # (the calm drums' loudness per bar: the taste model's drums_a)
        if t["id"] in fill_index:
            t["fills"] = {k: [dict(file=f["file"], bars=f["bars"], seed=f["seed"], beats=f.get("beats"), click=f.get("click"),
                                   stinger=(f.get("accent") or {}).get("stinger") or None) for f in v] for k, v in fill_index[t["id"]].items()
                          if not k.endswith(".tried") and v}
    glue_index = Store.read(proj.work / "glues.json", {})  # (music glues: a mellow pad per family, for the Mixer)
    of = {tid: g for g in glue_index.values() for tid in g["members"]}
    for t in tracks:
        if t["id"] in of:
            t["glue"] = of[t["id"]]["id"]
    # music retune: a track off the common pitch has retuned copies of what the Mixer plays (its levels, stems, fills,
    # glue) under work/clips/tuned; the Mixer plays those (t["src"]: the URL of each level), the Songs page the shipped files
    tuned = Store.read(proj.work / "tuned.json", {})
    retuned = lambda rel: f"tuned/{rel}" if rel in tuned.get("files", {}) else rel
    for t in tracks:
        t["src"] = {lv: ("/clips/" + retuned(f"shipped/{f}") if f"shipped/{f}" in tuned.get("files", {}) else "/shipped/" + f) for lv, f in t["files"].items()}
        if t["id"] in tuned.get("shift", {}):
            t["shift"] = tuned["shift"][t["id"]]
        if "stems" in t:
            t["stems"] = {k: retuned(v) for k, v in t["stems"].items()}
        if "fills" in t:
            t["fills"] = {k: [dict(f, file=retuned(f["file"])) for f in v] for k, v in t["fills"].items()}
    glue_out = {k: {x: g[x] for x in ("id", "members", "source", "bars", "tonic", "file")} for k, g in glue_index.items()}
    for g in glue_out.values():
        g["file"] = retuned(g["file"])
    return dict(glues=glue_out, pitch=tuned.get("reference"), join_model=Store.read(proj.work / "join_model.json", None),
                bpm=man.get("bpm", M["bpm"]), bar_beats=man.get("bar_beats", M["bar_beats"]),
                bars=man.get("loop_bars", M["bars"]), levels=levels, tracks=tracks,
                groups={k: dict(name=v.get("name", k), about=v.get("about", "")) for k, v in grouped.get("groups", {}).items()})


def promote(proj: P.Project, apply: bool = False) -> int:
    """Ship the music: every take liked on the Music page becomes a track in rotation (votes "mesh_<key>.<take>.
    <profile>" > 0), whatever its style; a context and biome with none liked in any style ships all its plain
    (unstyled) set's newest batch not voted down, at the default profile (else "contrast" if there is one, else the first). Writes out_dir/<track>_<level>.ogg and the manifest, removes tracks no longer chosen,
    records provenance in music_promoted.json, then the project's after_install. With song groups (music.groups),
    only liked takes ship, and each new track joins the groups file at the default group."""
    M, st = proj.music, Store(proj)
    idx, votes = st.index(), st.votes()["clips"]
    out_dir, levels = Path(M["out_dir"]), M["levels"]
    tracks, record, written = [], {}, []
    sets = idx.get("mesh", {}).get("contexts", {})
    liked = {key: [(t, p) for t in c["takes"] for p in t["profiles"] if votes.get(f"mesh_{key}.{t['id']}.{p}", 0) > 0]
             for key, c in sets.items()}
    any_liked = {(c["context"], c["biome"]) for key, c in sets.items() if liked[key]}
    G = M.get("groups")
    for key, c in sets.items():
        if not c["takes"] or (not liked[key] and (G or c.get("style") or (c["context"], c["biome"]) in any_liked)):
            continue
        ps = c["takes"][0]["profiles"]
        p0 = next(p for p in (M.get("default_profile"), "contrast", next(iter(ps))) if p in ps)
        chosen = liked[key] or [(t, p0) for t in current_takes(c) if votes.get(f"mesh_{key}.{t['id']}.{p0}", 0) >= 0]
        for take, prof in chosen:
            tid = ".".join(x for x in (c["context"], c["biome"], c.get("style"), take["id"], prof) if x)
            files = {lv: out_dir / f"{tid}_{lv}.ogg" for lv in levels}
            tracks.append(dict(id=tid, context=c["context"], biome=c["biome"],
                               files={lv: proj.asset_uri(f) for lv, f in files.items()}))
            record[tid] = dict(key=key, take=take["id"], profile=prof, seed=take["seed"], voted=bool(liked[key]),
                               prompts=take.get("prompts", c["prompts"]), instruments=take.get("instruments", {}),
                               date=date.today().isoformat(), sha256={})
            for lv in levels:
                src = st.clips / take["profiles"][prof]["levels"][lv]
                record[tid]["sha256"][lv] = hashlib.sha256(src.read_bytes()).hexdigest()
                if apply:
                    files[lv].parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(src, files[lv])
                    if M.get("seed_file"):
                        M["seed_file"](files[lv])
                    written.append(files[lv])
        print(f"  {key}: " + ", ".join(f"{t['id']} {p}" for t, p in chosen) + ("" if liked[key] else " (none liked yet)"))
    # A shipped track whose take isn't in the work folder (cleaned away, or made on another machine) stays as it is,
    # unless voted down: the index can't choose it, so it can't unchoose it either.
    shipped_before = Store.read(st.music_promoted_path, {})
    in_manifest = {t["id"]: t for t in Store.read(Path(M["manifest"]), {}).get("tracks", [])}
    kept = []
    for tid, r in sorted(shipped_before.items()):
        c = sets.get(r.get("key"))
        if (tid in record or tid not in in_manifest or (c and any(t["id"] == r["take"] for t in c["takes"]))
                or votes.get(f"mesh_{r['key']}.{r['take']}.{r['profile']}", 0) < 0
                or not all((out_dir / f"{tid}_{lv}.ogg").exists() for lv in levels)):
            continue
        tracks.append(in_manifest[tid])
        record[tid] = r
        kept.append(tid)
    if kept:
        print(f"  {len(kept)} shipped tracks stay as they are (their takes aren't in the work folder)")
    grouped = None
    if G:
        grouped = Store.read(Path(G["file"]), {})
        have = grouped.setdefault("tracks", {})
        new = [t["id"] for t in tracks if t["id"] not in have]
        for tid in new:
            have[tid] = G["default"]
        count: dict[str, int] = {}
        for t in tracks:
            count[have[t["id"]]] = count.get(have[t["id"]], 0) + 1
        print("  groups: " + ", ".join(f"{g} {n}" for g, n in sorted(count.items()))
              + (f"; {len(new)} new tracks join {G['default']}" if new else ""))
    old = {t["id"] for t in Store.read(Path(M["manifest"]), {}).get("tracks", [])}
    gone = sorted(old - {t["id"] for t in tracks})
    print(f"  {len(tracks)} tracks: {len({t['id'] for t in tracks} - old)} new, {len(gone)} leave the rotation"
          + (": " + ", ".join(gone) if gone else ""))
    if not apply:
        print(f"dry run: {len(tracks)} tracks; pass --apply to ship them")
        return 0
    if grouped is not None:
        st.write(Path(G["file"]), grouped)
    keep = {f"{t['id']}_{lv}.ogg" for t in tracks for lv in levels}
    for f in out_dir.glob("*.ogg"):
        if f.name not in keep:  # (a track no longer chosen)
            f.unlink()
            f.with_name(f.name + ".import").unlink(missing_ok=True)
    manifest = dict(bpm=M["bpm"], bar_beats=M["bar_beats"], loop_bars=M["bars"], rotate_loops=M.get("rotate_loops", 2),
                    levels=levels, tracks=tracks)
    st.write(Path(M["manifest"]), manifest)
    st.write(st.music_promoted_path, record, sort=True)
    print(f"shipped {len(tracks)} tracks; manifest {Path(M['manifest']).relative_to(proj.root)}")
    return proj.after_install(written) if proj.after_install else 0

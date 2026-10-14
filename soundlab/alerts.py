"""An alert family: every alert made from one shared kit, so the set is consistent and its meaning learnable.

The design comes from the project (Project.alerts):

  order      the alert sound names, in the order the Alerts page shows them
  legend     {family: one line on how that family signals}
  concepts   {id: {family, label, ...}}, two families:
               "recordings"  one generated take per alert, used whole (prompts: {alert: [prompt, seconds]})
               "earcon"      one instrument plus a drum and a drone, composed by `scores` (low, high: note prompts;
                             drone: drone prompt; sustained: bool)
  scores     {family: {alert: {what, ev, drone}}}; an earcon event is [time s, "v" | "drum", semitones from the
             tonic, gain dB, held length s], and "drone" is [gain dB, length s]
  drum       the earcon kits' drum prompt;  tonic (Hz): the register every kit plays in;  drone_ref (Hz): the
             pitch class drones are tuned to (any octave)
  kits, recording_takes, tries   how many to make

SA3 is good at timbre but cannot hold exact intervals or rhythms, so for earcons it only makes each kit's notes and
hits; they are placed and retuned here like a sampler. A kit is only used when its note has a clean pitch (pyin
cross-checked with YIN), between 120 and 750 Hz. Kits are cached in work/alert_kits/; composing is instant.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import dsp, project as P
from .dsp import SR
from .store import Store


def kit_dir(st: Store, concept: str, k: int) -> Path:
    return st.kits / f"{concept}.k{k}"


def _make_kits(proj: P.Project, st: Store) -> dict:
    A = proj.alerts
    eng = None
    kits = {}
    for concept, c in A["concepts"].items():
        found = 0
        want = A.get("recording_takes", 6) if c["family"] == "recordings" else A.get("kits", 3)
        for seed in range(max(A.get("tries", 10), want)):
            if found == want:
                break
            d = kit_dir(st, concept, seed)
            meta_p = d / "kit.json"
            meta = json.loads(meta_p.read_text()) if meta_p.exists() else None
            if meta is None:
                if eng is None:
                    from .engine import Engine

                    eng = Engine()
                d.mkdir(parents=True, exist_ok=True)
                if c["family"] == "recordings":
                    prompts = {a: p for a, (p, _) in c["prompts"].items()}
                    lengths = {a: sec for a, (_, sec) in c["prompts"].items()}
                else:
                    prompts = {"low": c["low"], "high": c["high"], "drum": A["drum"], "drone": c["drone"]}
                    lengths = {"low": 3.0, "high": 3.0, "drum": 1.5, "drone": 4.0}
                meta = dict(concept=concept, family=c["family"], seed=seed, prompts=prompts)
                for el, prompt in prompts.items():
                    dsp.write_wav(d / f"{el}.wav", eng.generate(prompt, lengths[el], 1000 * seed + 17))
            meta["family"] = c["family"]  # (from the design: kits cached by older versions may lack it)
            if c["family"] == "recordings":
                meta["usable"] = True
            else:
                if "analysis" not in meta:
                    meta["analysis"] = {el: dsp.pitch_of(dsp.decode(d / f"{el}.wav")) for el in ("low", "high", "drone")}
                an = meta["analysis"]
                # One note per kit: every note is retuned from it, so intervals are exact even if the absolute
                # reading were off. The clean note nearest ~300 Hz, where an alert reads on any speaker.
                clean = [r for r in ("low", "high") if an[r]["ok"] and 120 < an[r]["hz"] < 750]
                meta["voice"] = min(clean, key=lambda r: abs(np.log2(an[r]["hz"] / 300)), default=None)
                meta["usable"] = meta["voice"] is not None
            meta_p.write_text(json.dumps(meta, indent=1))
            print(f"  kit {concept}.k{seed}: {'ok' if meta['usable'] else 'rejected (no clean note)'}", flush=True)
            if meta["usable"]:
                kits[f"{concept}.k{seed}"] = meta
                found += 1
    # A drone needs a trustworthy pitch to sit in tune: a kit whose own drone is unclear borrows a verified one
    # made from the same prompt by another kit (the prompt, not the seed, sets its sound).
    drones: dict[str, list[tuple[str, float]]] = {}
    for f in sorted(st.kits.glob("*/kit.json")):
        m = json.loads(f.read_text())
        if "drone" in m["prompts"] and m.get("analysis", {}).get("drone", {}).get("ok"):
            drones.setdefault(m["prompts"]["drone"], []).append((f.parent.name, m["analysis"]["drone"]["hz"]))
    for kid, meta in kits.items():
        if meta["family"] != "earcon":
            continue
        cands = drones.get(meta["prompts"]["drone"], [])
        pick = next((c for c in cands if c[0] == kid), cands[0] if cands else None)
        meta["drone"] = dict(kit=pick[0], hz=pick[1]) if pick else None
        (kit_dir(st, meta["concept"], meta["seed"]) / "kit.json").write_text(json.dumps(meta, indent=1))
    return kits


def _load(d: Path, el: str) -> np.ndarray:
    x = dsp.onset_trim(dsp.decode(d / f"{el}.wav"))
    return x / max(np.abs(x).max(), 1e-9)  # peak 1, so the scores' gains mean the same in every kit


def compose(proj: P.Project, st: Store, meta: dict, score: dict, channels: int) -> np.ndarray:
    A = proj.alerts
    d = kit_dir(st, meta["concept"], meta["seed"])
    sustained = A["concepts"][meta["concept"]].get("sustained", False)
    voice, voice_hz = _load(d, meta["voice"]), meta["analysis"][meta["voice"]]["hz"]
    drum = _load(d, "drum")
    parts = []
    for t, el, semis, gain_db, length in score["ev"]:
        if el == "drum":
            x = drum
        else:
            x = dsp.gate(dsp.shift(voice, A["tonic"] * 2 ** (semis / 12) / voice_hz), length,
                         release=0.08 if sustained else 0.35)  # (a pluck rings on through its release)
        parts.append((t, x * 10 ** (gain_db / 20)))
    if score.get("drone") and meta.get("drone"):
        gain_db, length = score["drone"]
        x = _load(st.kits / meta["drone"]["kit"], "drone")
        ref = A.get("drone_ref", A["tonic"])
        target = ref * 2 ** round(np.log2(meta["drone"]["hz"] / ref))  # the tonic's pitch class nearest the drone
        x = dsp.gate(dsp.shift(x, target / meta["drone"]["hz"]), length, release=0.6)
        fade = min(len(x), int(0.25 * SR))
        x[:fade] *= np.linspace(0, 1, fade)[:, None]
        parts.append((0.0, x * 10 ** (gain_db / 20)))
    y = np.zeros((max(int(t * SR) + len(x) for t, x in parts), 2))
    for t, x in parts:
        s = int(t * SR)
        y[s:s + len(x)] += x
    return y.mean(axis=1, keepdims=True) if channels == 1 else y


def build(proj: P.Project) -> int:
    if not proj.alerts:
        raise SystemExit("this project has no alerts design (Project.alerts)")
    A, st = proj.alerts, Store(proj)
    kits = _make_kits(proj, st)
    sounds = {s.name: s for s in proj.sounds()}
    idx, votes = st.index(), st.votes()
    order = A["order"]
    # Rebuilt from scratch, except takes you have voted on or picked.
    keep = set(votes["clips"]) | set(votes["picks"].values())
    for cid in [cid for cid, c in idx["clips"].items() if c["name"] in order and cid not in keep and "kit" in c]:
        (st.clips / idx["clips"][cid]["file"]).unlink(missing_ok=True)
        del idx["clips"][cid]
    rows = []
    for kid, meta in kits.items():
        concept, k = meta["concept"], meta["seed"]
        fam = A["concepts"][concept]["family"]
        row = dict(id=kid, family=fam, label=f"{A['concepts'][concept]['label']} · take {k}", clips={})
        for name in order:
            s, score = sounds[name], A["scores"][fam][name]
            if fam == "recordings":
                x = _load(kit_dir(st, concept, k), name)
                x = x.mean(axis=1, keepdims=True) if s.channels == 1 else x
            else:
                x = compose(proj, st, meta, score, s.channels)
            y, info = P.master(proj, s, x)
            rel = f"{name}/{concept}.s{k}{s.out.suffix}"
            dsp.write(st.clips / rel, y)
            cid = f"{name}.{concept}.s{k}"
            idx["clips"][cid] = dict(name=name, variant=concept, seed=k, file=rel, gen_s=0, failed=False,
                                     prompt=f"{score['what']} · kit {kid}", master=info,
                                     duration=round(len(y) / SR, 3), kit=kid)
            row["clips"][name] = cid
        rows.append(row)
        print(f"rendered {len(order)} alerts with kit {kid}", flush=True)
    for name in order:
        kept = {c["variant"] for c in idx["clips"].values() if c["name"] == name and "kit" not in c}
        old = idx["prompts"].get(name, {})
        idx["prompts"][name] = {**{v: old[v] for v in kept if v in old},
                                **{c: f"{A['concepts'][c]['label']}: {A['scores'][A['concepts'][c]['family']][name]['what']}"
                                   for c in A["concepts"] if any(r["id"].startswith(c + ".") for r in rows)}}
    idx.setdefault("sets", {})["alerts"] = dict(names=order, rows=rows, legend=A.get("legend", {}),
                                                what={f: {n: sc[n]["what"] for n in order} for f, sc in A["scores"].items()})
    st.save_index(idx)
    print(f"{len(rows)} kits x {len(order)} alerts in the index", flush=True)
    return 0

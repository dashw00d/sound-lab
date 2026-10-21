"""What the Mixer plays beside the shipped files: Demucs stems and their level-matched variations (`music stems`), copies
retuned to one pitch (`music retune`), generated fills at the loop points (`music fills`) and a glue per family
(`music glues`)."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from .. import dsp, project as P, quality
from ..dsp import SR
from ..store import Store
from .design import spine_level
from .measures import _beats
from .shipping import library


STEM_MIX = {"nodrums": {"calm.other": 0, "calm.bass": 0}, "sparse": {"calm.other": 0, "calm.bass": -6},
             "pulse": {"calm": 0, "battle.drums": -10}}  # (the Mixer's stem variations: what each mixes, in dB; mixer.js prepare)


def _stem_gains(proj: P.Project, st: "Store", t: dict, files: dict) -> dict:
    """Each stem variation's gain back to the full calm level (dB, within -6 and +9): a variation changes the texture,
    not the volume (2026-10-21: war2 k6's "sparse" sat 6.3 dB under its full mix, a drop mid-song the designer heard
    and rated 2 of 5). Measured as mean power over the whole loop."""
    def power(x):
        m = x.mean(axis=1)
        return float((m ** 2).mean())
    have = {"calm": dsp.decode(Path(proj.assets) / t["files"]["calm"])}
    have.update({k: dsp.decode(st.clips / f) for k, f in files.items()})
    ref = power(have["calm"])
    out = {}
    for v, parts in STEM_MIX.items():
        if not all(k in have for k in parts):
            continue
        n = min(len(have[k]) for k in parts)
        x = sum(have[k][:n] * 10 ** (g / 20) for k, g in parts.items())
        out[v] = round(float(np.clip(10 * np.log10(ref / (power(x) + 1e-12)), -6, 9)), 1)
    return out


def stems(proj: P.Project, force: bool = False) -> int:
    """Stems of every shipped track, for the Mixer's variation over repeats (2026-10-21): Demucs (htdemucs) splits the
    calm level into drums, bass and the rest ("other": melody and harmony together, with vocals folded in), and the
    battle level into its drums (the pulse a repeat can bring into the mellow). On our takes Demucs gives a clean bed
    and drum layer, not a melody (MODELS_LOG, 2026-10-15). work/clips/stems/<track>/<level>.<stem>.ogg, listed in
    work/stems.json; only tracks whose files changed are split again. Demucs runs in its own process (the GPU)."""
    import subprocess
    import sys
    import tempfile

    st = Store(proj)
    lib = library(proj)
    path = proj.work / "stems.json"
    old = Store.read(path, {}) if not force else {}
    out_dir = st.clips / "stems"
    index, todo = {}, []
    for t in lib["tracks"]:
        sig = {lv: f"{(Path(proj.assets) / t['files'][lv]).stat().st_mtime_ns}" for lv in ("calm", "battle") if lv in t["files"]}
        if old.get(t["id"], {}).get("sig") == sig and all((st.clips / f).exists() for f in old[t["id"]]["files"].values()):
            index[t["id"]] = old[t["id"]]
            if "gain" not in index[t["id"]]:  # (made before the variations were level-matched)
                index[t["id"]]["gain"] = _stem_gains(proj, st, t, index[t["id"]]["files"])
        else:
            todo.append((t, sig))
    print(f"{len(todo)} tracks to split ({len(index)} unchanged)", flush=True)
    for i in range(0, len(todo), 12):  # (in batches: one Demucs process loads the model once per batch)
        batch = todo[i:i + 12]
        with tempfile.TemporaryDirectory() as tmp:
            srcs = []
            for t, _ in batch:
                for lv in ("calm", "battle"):
                    srcs.append(str(Path(proj.assets) / t["files"][lv]))
            subprocess.run([str(Path(sys.executable).parent / "demucs"), "-n", "htdemucs", "-o", tmp, *srcs],
                           check=True, capture_output=True)
            for t, sig in batch:
                files = {}
                (out_dir / t["id"]).mkdir(parents=True, exist_ok=True)
                for lv in ("calm", "battle"):
                    d = Path(tmp) / "htdemucs" / Path(t["files"][lv]).stem
                    parts = {k: dsp.decode(d / f"{k}.wav") for k in ("drums", "bass", "other", "vocals")}
                    keep = {"drums": parts["drums"], "bass": parts["bass"], "other": parts["other"] + parts["vocals"]} if lv == "calm" \
                        else {"drums": parts["drums"]}
                    for k, x in keep.items():
                        rel = f"stems/{t['id']}/{lv}.{k}.ogg"
                        dsp.write(st.clips / rel, x)
                        files[f"{lv}.{k}"] = rel
                index[t["id"]] = dict(sig=sig, files=files, gain=_stem_gains(proj, st, t, files))
        st.write(path, index, sort=True)
        print(f"  split {min(i + 12, len(todo))} of {len(todo)}", flush=True)
    st.write(path, index, sort=True)
    print(f"stems for {len(index)} tracks")
    return 0


RETUNE_MIN = 6.0  # (cents off the common pitch before a track is retuned)


def retune(proj: P.Project, force: bool = False) -> int:
    """One pitch for the Mixer (2026-10-21): a take more than RETUNE_MIN cents off the library's median pitch is shifted
    to it (98 shipped tracks: the median +2 cents from A440, 4 tracks off by more than 6; the first measurement, 3x too
    big, had found 42, MODELS_LOG), with dsp.stretch (Rubber Band R3 through Pedalboard, pitch only: the tempo and the
    grid stay; ffmpeg's rubberband filter, before, shifted unreliably), with everything the Mixer plays from it: its calm,
    tension, action and battle levels, its stems, its fills and its family's glue (by the glue's source track). The
    copies go under work/clips/tuned/ (the shipped files are never touched); work/tuned.json lists them. Needs
    `music trims` (the tunings) first; run it again after new stems, fills or glues."""
    st = Store(proj)
    measured = Store.read(proj.work / "songs.json", {})
    tun = {tid: r["tuning"] for tid, r in measured.items() if r.get("tuning") is not None}
    if not tun:
        raise SystemExit("measure the songs first: soundlab music trims")
    ref = float(np.median(list(tun.values())))
    path = proj.work / "tuned.json"
    old = Store.read(path, {}) if not force else {}
    lib = library(proj)
    stems, fill_index, glue_index = (Store.read(proj.work / f, {}) for f in ("stems.json", "fills.json", "glues.json"))
    done = old.get("files", {}) if abs(old.get("reference", ref) - ref) < 0.5 else {}
    files, shift = {}, {}
    for t in lib["tracks"]:
        c = tun.get(t["id"])
        if c is None or abs(c - ref) <= RETUNE_MIN:
            continue
        cents = round(ref - c, 1)
        shift[t["id"]] = cents
        rels = [f"shipped/{f}" for f in t["files"].values()] + list(stems.get(t["id"], {}).get("files", {}).values())
        rels += [f["file"] for k, v in fill_index.get(t["id"], {}).items() if not k.endswith(".tried") for f in v]
        rels += [g["file"] for g in glue_index.values() if g["source"]["track"] == t["id"]]
        n = 0
        for rel in rels:
            src = Path(proj.assets) / rel[len("shipped/"):] if rel.startswith("shipped/") else st.clips / rel
            if not src.exists():
                continue
            sig = f"{src.stat().st_mtime_ns}:{cents}:{dsp.STRETCH}"
            dst = st.clips / "tuned" / rel
            if done.get(rel) == sig and dst.exists():
                files[rel] = sig
                continue
            x = dsp.decode(src)
            y = dsp.stretch(x, cents=cents)
            y = y[:len(x)] if len(y) >= len(x) else np.pad(y, ((0, len(x) - len(y)), (0, 0)))  # (the grid: the same length exactly)
            dst.parent.mkdir(parents=True, exist_ok=True)
            dsp.write(dst, y)
            files[rel] = sig
            n += 1
        print(f"  {t['id']}: {c:+.0f} cents, shifted {cents:+.1f} ({n} files)", flush=True)
    st.write(path, dict(reference=round(ref, 1), shift=shift, files=files), sort=True)
    print(f"common pitch {ref:+.1f} cents from A440: {len(shift)} of {len(tun)} tracks retuned, {len(files)} files")
    return 0


FILL_CTX = 4  # (bars kept either side of a fill: the end of the loop before it, its start after it)


def fills(proj: P.Project, seeds: int = 4, bars: int = 1, only: list[str] | None = None) -> int:
    """Generated fills at each shipped track's mellow loop point (2026-10-21): SA3 inpaints `bars` bar(s) between the
    loop's end cue and its start cue (FILL_CTX bars kept either side: the bars before the end cue, then the start cue's
    bars), so each time round a song can end its loop on a different fill. With both ends kept, inpainting holds the
    grid (section probe, 2026-10-20: violinbed 17 of 18). The cue is the designer's (votes.json "cues") or the guess.
    A take is kept when the fill and a bar either side hold 90 BPM, it rates at least the calm gate (Audiobox CE), and
    its loudness is within 3 dB of the bars around it. work/clips/fills/<track>/<cue>.<seed>.ogg (the fill with 50 ms
    either side, for crossfades), listed in work/fills.json; existing takes are kept."""
    from ..engine import Engine
    import tempfile

    M, st = proj.music, Store(proj)
    lib = library(proj)
    measured = Store.read(proj.work / "songs.json", {})
    cues_of = st.votes().get("cues", {})
    path = proj.work / "fills.json"
    index = Store.read(path, {})
    bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * SR))
    pad = int(0.05 * SR)
    spine = spine_level(M)
    eng = None
    kept = tried = 0
    tmp = Path(tempfile.mkdtemp(prefix="fills_"))
    for t in lib["tracks"]:
        if only and t["id"] not in only:
            continue
        m = measured.get(t["id"])
        cue = (cues_of.get(t["id"], {}).get("mellow")
               or (m and m.get("cuts", {}).get("calm") and m["cuts"]["calm"][0]["bars"]) or None)
        if not cue:
            continue
        ms, me = cue
        key = f"{ms}-{me}"
        rec = index.setdefault(t["id"], {})
        have = [f for f in rec.get(key, []) if (st.clips / f["file"]).exists()]
        done = {f["seed"] for f in rec.get(key + ".tried", [])} | {f["seed"] for f in have}
        if len(have) >= seeds:
            continue
        x = dsp.decode(Path(proj.assets) / t["files"]["calm"])
        n = len(x) // bar
        take = lambda a, k: np.concatenate([x[((a + j) % n) * bar:((a + j) % n + 1) * bar] for j in range(k)])
        before, after = take(me - FILL_CTX, FILL_CTX), take(ms - 1, FILL_CTX)  # (bars me-3..me, then ms..ms+3)
        keep = np.concatenate([before, np.zeros((bars * bar, 2)), after])
        prompt = (t.get("prompts") or {}).get(spine if t.get("profile") == "stack" else "calm") or (t.get("prompts") or {}).get("calm", "")
        if eng is None:
            eng = Engine()
        a0, a1 = FILL_CTX * bar, (FILL_CTX + bars) * bar
        ref = dsp.loudness_stats(np.concatenate([before[-bar:], after[:bar]]))[0]
        seed, made = 0, []
        while len(have) + len(made) < seeds and seed < seeds * 3:
            if seed in done:
                seed += 1
                continue
            y = eng.generate(prompt, len(keep) / SR, seed, keep=keep, fill=[(a0 / SR, a1 / SR)])
            tried += 1
            around = y[a0 - bar:a1 + bar]
            ph, c = dsp.grid_phase(around, M["bpm"])
            loud = dsp.loudness_stats(y[a0:a1])[0]
            wav = tmp / f"{t['id']}.{seed}.wav"
            dsp.write_wav(wav, around)
            ce = (quality.aesthetics([str(wav)])[0] or {}).get("CE")
            click = max(dsp.click_ratio(y, a0), dsp.click_ratio(y, a1))  # (where the inpainted bar meets the kept audio)
            ok = c >= 0.8 and abs(ph) <= 0.04 and abs(loud - ref) <= 3.0 and (ce is None or ce >= quality.GATE.get("calm", 0)) and click <= dsp.CLICK
            info = dict(seed=seed, grid=round(float(c), 2), loud=round(float(loud - ref), 1), ce=ce, click=click)
            if ok:
                rel = f"fills/{t['id']}/{key}.{seed}.ogg"
                dsp.write(st.clips / rel, y[a0 - pad:a1 + pad])
                made.append(dict(info, file=rel, bars=bars))
            else:
                rec.setdefault(key + ".tried", []).append(info)
            seed += 1
        rec[key] = have + made
        kept += len(made)
        st.write(path, index, sort=True)
        print(f"  {t['id']} (loop {ms}-{me}): {len(have) + len(made)} fills" + (f", {seed - len(made) - len(have)} rejected" if seed > len(made) else ""), flush=True)
    n = 0  # (each fill's loudness per beat, for the Mixer to level it at play time: fills step 2.3 dB in at the median, 37% over 3)
    beat, pad = bar // M["bar_beats"], int(0.05 * SR)
    for tid, rec in index.items():
        for key, fl in rec.items():
            if key.endswith(".tried"):
                continue
            for f in fl:
                if ("beats" not in f or "click" not in f) and (st.clips / f["file"]).exists():
                    y = dsp.decode(st.clips / f["file"])
                    f["beats"] = _beats(y[pad:-pad], beat)
                    f["click"] = max(dsp.click_ratio(y, pad), dsp.click_ratio(y, len(y) - pad))  # (the Mixer skips one that clicks)
                    n += 1
    st.write(path, index, sort=True)
    print(f"kept {kept} new fills of {tried} tried; measured {n} fills' beats")
    return 0


GLUE_BARS, GLUE_DB, TONIC = 7, -3.0, (2, 5, 9)  # (bars made: up to 4 to play, a bar to rise and a bar to fall, a spare; under the mellow level; D, F, A)


def _freeze(x: np.ndarray, seconds: float, seed: int, n_fft: int = 16384, hop: int = 2048, width: int = 8,
            rest: float = 0.05) -> np.ndarray:
    """A spectral freeze of the chord in `x`: its steady spectrum (each bin's median magnitude over the frames, so the
    attacks drop out), only its peaks kept (local maxima at least twice the floor around them, with their two
    neighbours: the notes' partials; everything else at `rest`), each bin's phase turning at its measured rate (a tone
    keeps its pitch), held for `seconds`; each channel its own random start (width). Keeping only the peaks matters: a
    whole frozen mix beats like coloured noise (2026-10-21, 10 glues at -27 LUFS: frame-to-frame spectral change 18.5,
    the music's own 17.6; peaks only 5.3, the share on D, F and A 53% -> 70%, level steady within 0.4 dB)."""
    from scipy.ndimage import maximum_filter1d, median_filter

    rng = np.random.default_rng(seed)
    win = np.hanning(n_fft)
    if len(x) < 2 * n_fft:
        x = np.concatenate([x, x[::-1]])  # (a bar is short for these frames: mirrored, so there are enough of them)
    out = []
    for ch in range(x.shape[1]):
        s = x[:, ch]
        S = np.fft.rfft(np.array([s[i:i + n_fft] * win for i in range(0, len(s) - n_fft, hop)]), axis=1)
        mag = np.median(np.abs(S), axis=0)
        floor = median_filter(mag, size=61) + 1e-12
        keep = np.zeros(mag.size, bool)
        for k in np.where((mag == maximum_filter1d(mag, size=2 * width + 1)) & (mag > 2.0 * floor))[0]:
            keep[max(0, k - 1):k + 2] = True
        mag = mag * np.where(keep, 1.0, rest)
        k = np.arange(mag.size)
        expected = 2 * np.pi * k * hop / n_fft
        dev = np.angle(np.exp(1j * (np.angle(S[1:] * np.conj(S[:-1])) - expected)))
        adv = expected + np.median(dev, axis=0)
        frames = int(seconds * SR / hop) + n_fft // hop + 2
        y, w = np.zeros(frames * hop + n_fft), np.zeros(frames * hop + n_fft)
        phase = rng.uniform(-np.pi, np.pi, mag.size)
        for f in range(frames):
            y[f * hop:f * hop + n_fft] += np.fft.irfft(mag * np.exp(1j * phase), n=n_fft) * win
            w[f * hop:f * hop + n_fft] += win ** 2
            phase += adv
        y /= np.maximum(w, 1e-6)
        out.append(y[n_fft:n_fft + int(seconds * SR)])
    return np.stack(out, axis=1)


def glues(proj: P.Project, force: bool = False) -> int:
    """Glue for the Mixer (2026-10-21): per family of siblings (and per song without any), a mellow pad in the family's
    own sound, to slip between two parts: a breath, and a way through when two parts don't join. No shipped bar joins
    every part of a set well (searched: the quietest stretches reach 0.70-0.74 with every part of a starter set), so
    each glue is made: the family's steadiest quiet bar on the home chord (most of its pitch-class energy on D, F
    and A, shared by every context's mode), frozen into a sustained pad (_freeze), darkened, at the mellow level less
    GLUE_DB. GLUE_BARS long; work/clips/glues/<id>.ogg, listed in work/glues.json. Needs `music trims` first."""
    M, st = proj.music, Store(proj)
    measured = Store.read(proj.work / "songs.json", {})
    if not measured:
        raise SystemExit("measure the songs first: soundlab music trims")
    lib = library(proj)
    bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * SR))
    out_dir = st.clips / "glues"
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = proj.work / "glues.json"
    old = Store.read(index_path, {}) if not force else {}
    groups: dict[str, list[dict]] = {}
    for t in lib["tracks"]:
        if t.get("measure") and t["measure"].get("feat"):
            fam = t.get("family")
            groups.setdefault(fam["key"] if fam else t["id"], []).append(t)
    index, made = {}, 0
    for gid, members in sorted(groups.items()):
        best = None
        for t in members:
            f, loud = np.array(t["measure"]["feat"]), np.array(t["measure"]["loud"]["calm"])
            med = np.median(loud)
            for b in range(1, min(12, len(f) - 1)):  # (bars 2..12: the steady middle)
                c = np.clip(f[b, :12], 0, None)
                tonic = float(c[list(TONIC)].sum() / (c.sum() + 1e-9))
                steady = float(f[b] @ f[b - 1] + f[b] @ f[b + 1]) / 2
                score = tonic + 0.3 * steady - 0.03 * max(0.0, loud[b] - med)
                if best is None or score > best[0]:
                    best = (score, t, b + 1, round(tonic, 3), round(steady, 3))
        if not best:
            continue
        _, t, src_bar, tonic, steady = best
        fname = f"{gid}.ogg"
        rec = dict(id=gid, members=[m["id"] for m in members], source=dict(track=t["id"], bar=src_bar), bars=GLUE_BARS,
                   tonic=tonic, steady=steady, file=f"glues/{fname}")
        sig = f"{(Path(proj.assets) / t['files']['calm']).stat().st_mtime_ns}"
        if old.get(gid, {}).get("sig") == sig and old[gid].get("source") == rec["source"] and (out_dir / fname).exists():
            index[gid] = old[gid]
            continue
        x = dsp.decode(Path(proj.assets) / t["files"]["calm"])
        src = x[(src_bar - 1) * bar:src_bar * bar]
        y = _freeze(src, GLUE_BARS * bar / SR, seed=src_bar)
        y = dsp.ffmpeg_filter(y, "lowpass=f=3200,highpass=f=40")
        y = dsp.normalise(y, M["lufs"]["calm"] + GLUE_DB)
        dsp.write(out_dir / fname, y)
        index[gid] = dict(rec, sig=sig)
        made += 1
        print(f"  {gid}: from {t['id']} bar {src_bar} (home chord {tonic:.0%}, steady {steady})", flush=True)
    st.write(index_path, index, sort=True)
    print(f"made {made} glues ({len(index) - made} unchanged): {len(index)} in all, for {sum(len(g['members']) for g in index.values())} songs")
    return 0

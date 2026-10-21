"""Section probe: can SA3 write a song's next part, a bridge into a fight, and can one recording give rest, urgent and
intense levels? (Research, outside the app. 2026-10-20, the designer: the music is repetitive, not catchy and too
abrasive over a 30-minute game; "can we find a way to turn rest song into urgent or intense seamlessly", and "compose
longer songs that are very good by stitching them together, have different parts to them".)

SA3 inpaints: given audio with a span blanked out, it writes the span to fit what's kept on either side (the mask and the
kept audio are conditioning inputs it was trained with; engine.generate(keep=, fill=)). Everything here is built on that.
Sources are shipped, liked tracks (assets/audio/music/mesh; their prompts from music_promoted.json). A = the take's
spine: the calm file of a stack take (the spine itself, quieter), the tension file of a close take.

  sections  A's next part, written between A's last 8 bars and A's first 4 (both ends kept: in a first test that held
            the grid in 6 of 6 seeds against 5 of 6 open-ended, and rose +0.5 dB to its end against +3.4), so it can
            go back to A. Three kinds: contrast (the take's calm prompt), urgent (a new prompt: anxious, not martial),
            intense (the take's action prompt). SEEDS seeds each; a seed is kept only if its new bars hold the 90 BPM
            grid; the kept ones are ranked by Audiobox content enjoyment (CE) and the best TOP are rendered with A's
            last 4 bars before and A's first 4 after, so both joins can be heard.
  bridges   rest into a fight. now: the game today (calm to battle at the same loop position, a two-beat crossfade);
            bridge2/bridge4: calm up to bar 8, then 2 or 4 bars SA3 writes (the action prompt) into the battle level's
            start (Godot's AudioStreamInteractive can play such a filler clip between two clips on a bar line).
  strip     rest, urgent and intense from one recording: Demucs splits the take's battle level into drums, bass, other
            and vocals; rest = other + vocals + bass at -6 dB, urgent = the same with the bass full and the drums at
            -9 dB, intense = the battle level itself. Played as the game would move through them (rest 4 bars, urgent
            4, intense 4, rest 4; two beats up, eight beats down), next to today's calm, tension and battle files.
  song      A, the best contrast section, A, the best intense section, then A's first 8 bars (the loop back): a song of
            about three minutes with parts, every join written by SA3.

Measured per section: grid (bars its new part holds 90 BPM, of 16), tempo, CE, rise (dB from the 2 bars before the
join to its last 2 bars), joins (loudness steps at the two joins, dB), key (chroma cosine with A: 1 = the same notes).

  runtime/venv/bin/python research/section_probe.py --project P
  (listening page: work/clips/sections/index.html, served by `serve` at /clips/sections/index.html;
   results: research/data/section_probe.json)
"""
from __future__ import annotations

import argparse
import html
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))

TAKES = ["night.any.trailer.k2.close", "night.any.violinbed.k0.stack", "day.any.nyckelharpa2.k2.stack",
         "bloodmoon.any.kantele2.k3.stack"]
# Urgent: a crisis (starving, out of wood), not a fight. Each take's tension sentence with one idea changed: the
# ostinato ticks, restless, and the mood is anxious dread; the take's own lead, key and instruments stay.
URGENT = {
    "night.any.trailer.k2.close":
        "TrackType: Music, VocalType: Instrumental, Tense dark cinematic score in D aeolian with trombones playing a "
        "grim theme, low strings ticking a restless staccato ostinato and a drum ensemble tapping a quick, quiet "
        "pulse, creating anxious, urgent dread. BPM: 90.",
    "night.any.violinbed.k0.stack":
        "TrackType: Music, VocalType: Instrumental, Genre: Cinematic, Genre: Orchestral, Genre: Medieval. Tense dark "
        "cinematic score in D minor with a solo violin playing a short two-bar theme that repeats, low strings "
        "ticking a restless staccato ostinato and the cello playing an uneasy bass line, creating anxious, urgent "
        "dread. BPM: 90.",
    "day.any.nyckelharpa2.k2.stack":
        "TrackType: Music, VocalType: Instrumental, Genre: Cinematic, Genre: Orchestral, Genre: Medieval. Tense dark "
        "cinematic score in D dorian with a nyckelharpa playing a theme in question and answer phrases, low strings "
        "ticking a restless staccato ostinato and the cello playing an uneasy bass line, at one steady level from "
        "beginning to end, creating anxious, urgent dread. BPM: 90.",
    "bloodmoon.any.kantele2.k3.stack":
        "TrackType: Music, VocalType: Instrumental, Genre: Cinematic, Genre: Orchestral, Genre: Medieval. Tense dark "
        "cinematic score in D phrygian with a kantele playing a theme in question and answer phrases, tremolo "
        "strings ticking a restless staccato ostinato and the double bass playing an uneasy bass line, at one steady "
        "level from beginning to end, creating anxious, urgent dread. BPM: 90.",
}
CTX, NEW, BACK = 8, 16, 4  # section windows: A's last bars kept, the new bars, A's first bars kept after
SEEDS, TOP = 6, 2
BRIDGE_AT, BRIDGE_SEEDS = 8, 4  # the bar of calm a bridge starts on; seeds per bridge
XF = 0.25  # beats of crossfade where generated audio meets the original (both are the same music there)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--only", nargs="*", default=None, help="take ids (default: all of TAKES)")
    a = ap.parse_args()
    from soundlab import dsp, project as P, quality

    proj = P.load(a.project)
    M = proj.music
    bpm, bb = M["bpm"], M["bar_beats"]
    bar = int(round(bb * 60.0 / bpm * dsp.SR))
    beat = bar // bb
    S = dsp.SR
    mesh = Path(proj.assets) / "music" / "mesh"
    prov = json.loads((Path(proj.data) / "music_promoted.json").read_text())
    out = Path(proj.work) / "clips" / "sections"
    out.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="section_probe_"))
    takes = a.only or TAKES

    def level(tid: str, lv: str) -> np.ndarray:
        return dsp.decode(mesh / f"{tid}_{lv}.ogg")

    def span(x: np.ndarray, start: int, n: int) -> np.ndarray:
        """n samples of a loop from start, wrapping round (the game loops every file)."""
        return np.take(x, np.arange(start, start + n) % len(x), axis=0)

    def splice(pre: np.ndarray, y: np.ndarray, s: int, e: int, post: np.ndarray) -> np.ndarray:
        """pre, then y[s:e] (what SA3 wrote), then post. y also holds SA3's own rendering of the kept audio around
        its span, so each join is a short equal-power crossfade between the original and that rendering of the same
        bars, on the original's side of the bar line: the bar lines stay exactly on the grid."""
        n = int(XF * beat)
        fi, fo = dsp.eq_power(n)
        a, b = pre.copy(), post.copy()
        a[-n:] = a[-n:] * fo + y[s - n:s] * fi
        b[:n] = y[e:e + n] * fo + b[:n] * fi
        return np.concatenate([a, y[s:e], b])

    def save(name: str, y: np.ndarray) -> str:
        dsp.write(out / f"{name}.ogg", dsp.limit(y, -1.0))
        return f"{name}.ogg"

    def grid_bars(y: np.ndarray, start: int, n: int) -> int:
        """Bars from `start` (a bar index) over which every 4-bar window keeps the 90 BPM grid from t=0."""
        for i in range(start, start + n - 3):
            ph, c = dsp.grid_phase(y[i * bar:(i + 4) * bar], bpm)
            if c < 0.8 or abs(ph) > 0.04:
                return i - start
        return n

    def lufs(x: np.ndarray) -> float:
        return round(dsp.loudness_stats(x)[0], 1)

    def chroma(x: np.ndarray) -> np.ndarray:
        import librosa
        return librosa.feature.chroma_cqt(y=x.mean(axis=1).astype(np.float32), sr=S).mean(axis=1)

    def cos(u: np.ndarray, v: np.ndarray) -> float:
        return round(float(u @ v / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9)), 3)

    def ce(xs: list[np.ndarray]) -> list[float | None]:
        ps = []
        for i, x in enumerate(xs):
            p = tmp / f"ce_{i}.wav"
            dsp.write_wav(p, x)
            ps.append(str(p))
        return [r["CE"] if r else None for r in quality.aesthetics(ps)]

    def onsets(x: np.ndarray) -> float:
        import librosa
        env, fps = dsp.onset_env(x)
        return round(len(librosa.onset.onset_detect(onset_envelope=env, sr=22050, hop_length=256)) / (len(x) / S), 2)

    # --- strip: Demucs first, in its own process, before SA3 takes the GPU
    stems = {}
    for tid in takes:
        d = tmp / "demucs"
        src = tmp / f"{tid}.wav"
        dsp.write_wav(src, level(tid, "battle"))
        subprocess.run([str(Path(sys.executable).parent / "demucs"), "-n", "htdemucs", "-o", str(d), str(src)],
                       check=True, capture_output=True)
        stems[tid] = {k: dsp.decode(d / "htdemucs" / tid / f"{k}.wav") for k in ("drums", "bass", "other", "vocals")}
        print(f"separated {tid}", flush=True)

    from soundlab.engine import Engine
    eng = Engine()
    results = dict(date="2026-10-20", bar_s=bar / S, takes={})

    for tid in takes:
        P_ = prov[tid]["prompts"]
        stack = prov[tid]["profile"] == "stack"
        A = level(tid, "calm" if stack else "tension")
        r = results["takes"][tid] = dict(a="calm" if stack else "tension", sections={}, bridges={}, strip={}, song={})
        cA = chroma(A)

        # --- sections
        best = {}
        for kind, prompt in (("contrast", P_["calm"]), ("urgent", URGENT[tid]), ("intense", P_["action"])):
            keep = np.zeros(((CTX + NEW + BACK) * bar, 2))
            keep[:CTX * bar] = A[-CTX * bar:]
            keep[(CTX + NEW) * bar:] = A[:BACK * bar]
            cands = []
            for seed in range(SEEDS):
                y = eng.generate(prompt, len(keep) / S, seed, keep=keep, fill=[(CTX * bar / S, (CTX + NEW) * bar / S)])
                new = y[CTX * bar:(CTX + NEW) * bar]
                cands.append(dict(seed=seed, y=y, new=new, grid=max(0, grid_bars(y, CTX - 2, NEW + 2) - 2),
                                  tempo=round(dsp.tempo_of(new, bpm)[0], 1),
                                  rise=round(lufs(new[-2 * bar:]) - lufs(A[-2 * bar:]), 1),
                                  joins=[round(lufs(new[:bar]) - lufs(A[-bar:]), 1),
                                         round(lufs(A[:bar]) - lufs(new[-bar:]), 1)],
                                  key=cos(chroma(new), cA), busy=onsets(new)))
            for c, v in zip(cands, ce([c["new"] for c in cands])):
                c["ce"] = v
            held = [c for c in cands if c["grid"] >= NEW]
            pool = sorted(held, key=lambda c: -(c["ce"] or 0)) if held else sorted(cands, key=lambda c: -c["grid"])
            best[kind] = pool[0]
            rows = []
            for rank, c in enumerate(pool[:TOP]):
                f = save(f"{tid}_section_{kind}_s{c['seed']}",
                         splice(A[-BACK * bar:], c["y"], CTX * bar, (CTX + NEW) * bar, A[:BACK * bar]))
                rows.append(dict(file=f, rank=rank + 1, **{k: c[k] for k in ("seed", "grid", "tempo", "ce", "rise", "joins", "key", "busy")}))
            r["sections"][kind] = dict(prompt=prompt, held=f"{len(held)} of {SEEDS}", listen=rows,
                                       all=[{k: c[k] for k in ("seed", "grid", "tempo", "ce", "rise", "key", "busy")} for c in cands], a_busy=onsets(A))
            print(f"{tid} {kind}: {len(held)}/{SEEDS} held the grid; best CE {rows[0]['ce']} (seed {rows[0]['seed']})",
                  flush=True)

        # --- bridges: calm to battle
        calm, battle = level(tid, "calm"), level(tid, "battle")
        p = BRIDGE_AT * bar
        n2 = 2 * beat
        fi, fo = dsp.eq_power(n2)
        tail = span(battle, p, 6 * bar).copy()
        tail[:n2] = tail[:n2] * fi + span(calm, p, n2) * fo
        r["bridges"]["now"] = dict(file=save(f"{tid}_bridge_now", np.concatenate([span(calm, p - 6 * bar, 6 * bar), tail])))
        for g in (2, 4):
            keep = np.zeros(((6 + g + 6) * bar, 2))
            keep[:6 * bar] = span(calm, p - 6 * bar, 6 * bar)
            keep[(6 + g) * bar:] = battle[:6 * bar]
            cands = []
            for seed in range(BRIDGE_SEEDS):
                y = eng.generate(P_["action"], len(keep) / S, seed, keep=keep, fill=[(6 * bar / S, (6 + g) * bar / S)])
                cands.append(dict(seed=seed, y=y, grid=grid_bars(y, 4, g + 4)))
            for c, v in zip(cands, ce([c["y"] for c in cands])):
                c["ce"] = v
            c = max(cands, key=lambda c: (c["grid"] >= g + 4, c["ce"] or 0))
            seq = splice(keep[:6 * bar], c["y"], 6 * bar, (6 + g) * bar, battle[:6 * bar])
            r["bridges"][f"bridge{g}"] = dict(file=save(f"{tid}_bridge{g}_s{c['seed']}", seq), seed=c["seed"],
                                              grid=f"{c['grid']} of {g + 4}", ce=c["ce"],
                                              held=f"{sum(x['grid'] >= g + 4 for x in cands)} of {BRIDGE_SEEDS}")
        print(f"{tid} bridges: {r['bridges']['bridge2'].get('held')} / {r['bridges']['bridge4'].get('held')} held",
              flush=True)

        # --- strip: rest, urgent, intense from one recording
        st = stems[tid]
        db = lambda v: 10 ** (v / 20)
        rest = st["other"] + st["vocals"] + st["bass"] * db(-6)
        urgent = st["other"] + st["vocals"] + st["bass"] + st["drums"] * db(-9)
        L = M["lufs"]
        ways = {"today": [dsp.normalise(level(tid, l), L[l]) for l in ("calm", "tension", "battle")],
                "strip": [dsp.normalise(rest, L["calm"]), dsp.normalise(urgent, L["tension"]),
                          dsp.normalise(battle, L["battle"])]}
        for way, (lo, mid, hi) in ways.items():
            seq, pos = [], 0
            order = [(lo, None), (mid, 2), (hi, 2), (lo, 8)]  # (level, crossfade beats into it)
            prev = None
            for lvl, xb in order:
                seg = span(lvl, pos, 4 * bar).copy()
                if prev is not None:
                    n = xb * beat
                    fi, fo = dsp.eq_power(n)
                    seg[:n] = seg[:n] * fi + span(prev, pos, n) * fo
                seq.append(seg)
                prev, pos = lvl, pos + 4 * bar
            r["strip"][way] = dict(file=save(f"{tid}_levels_{way}", np.concatenate(seq)),
                                   onsets=[onsets(x) for x in (lo, mid, hi)], lufs=[lufs(x) for x in (lo, mid, hi)])
            if way == "strip":
                r["strip"][way]["rest_file"] = save(f"{tid}_rest_alone", lo)
        print(f"{tid} strip: onsets/s today {r['strip']['today']['onsets']}, strip {r['strip']['strip']['onsets']}",
              flush=True)

        # --- song: A B A C, then the loop back to A
        B, C = best["contrast"], best["intense"]
        w = (CTX * bar, (CTX + NEW) * bar)
        song = splice(A, B["y"], *w, splice(A, C["y"], *w, A[:8 * bar]))
        song = dsp.normalise(song, L["tension"])
        r["song"] = dict(file=save(f"{tid}_song", song), seconds=round(len(song) / S, 1),
                         parts=f"A (16) · contrast s{B['seed']} (16) · A (16) · intense s{C['seed']} (16) · A (8, the loop back)",
                         grid=[B["grid"], C["grid"]])
        print(f"{tid} song: {r['song']['seconds']} s", flush=True)

    (LAB / "research" / "data" / "section_probe.json").write_text(json.dumps(results, indent=1))
    (out / "index.html").write_text(page(results))
    print(f"wrote research/data/section_probe.json and {out / 'index.html'}", flush=True)
    return 0


def page(res: dict) -> str:
    """The listening page: every demo with its measurements."""
    e = html.escape

    def audio(f: str) -> str:
        return f'<audio controls preload="none" src="{e(f)}"></audio>'

    def m(d: dict, keys) -> str:
        return " · ".join(f"{k} {d[k]}" for k in keys if d.get(k) is not None)

    h = ["<!doctype html><meta charset=utf-8><title>Section probe</title><style>",
         "body{font:15px/1.5 system-ui,sans-serif;max-width:980px;margin:2em auto;padding:0 1em;background:#16151a;color:#ddd}",
         "h1,h2,h3{font-weight:600}h2{margin-top:2.2em;border-top:1px solid #333;padding-top:1em}",
         ".row{display:flex;gap:1em;align-items:center;margin:.35em 0}.row b{min-width:9em}.m{color:#999;font-size:13px}",
         "audio{height:32px;width:340px}p.note{color:#aaa}code{color:#cbb}</style>",
         "<h1>Section probe, 2026-10-20</h1>",
         "<p class=note>Four liked tracks, each made into: new <b>sections</b> that grow out of it (contrast, urgent, "
         "intense), <b>bridges</b> from rest into a fight, <b>rest/urgent/intense levels</b> made by taking one recording "
         "apart, and a three-minute <b>song</b> with parts. Every join between old and new audio was written by SA3; "
         "nothing is crossfaded between different music. Listen for: do the joins sound like one piece, does the urgent "
         "section feel like a crisis rather than a fight, and is the stripped rest restful.</p>",
         "<p class=note>grid: bars the new part holds the 90 BPM beat (of 16) · CE: the quality model's rating (liked "
         "takes rate over about 6.7) · rise: dB louder at its end than where it started · joins: loudness steps at the "
         "two joins (dB) · key: 1 = the same notes as the original · busy: note onsets per second.</p>"]
    for tid, r in res["takes"].items():
        h.append(f"<h2>{e(tid)}</h2>")
        h.append(f"<h3>Song: A · contrast · A · intense · back to A ({r['song']['seconds']} s)</h3>")
        h.append(f"<div class=row>{audio(r['song']['file'])}<span class=m>{e(r['song']['parts'])}</span></div>")
        h.append("<h3>Sections (each between A's last 4 bars and A's first 4)</h3>")
        for kind, s in r["sections"].items():
            for x in s["listen"]:
                h.append(f"<div class=row><b>{kind} #{x['rank']}</b>{audio(x['file'])}<span class=m>"
                         f"{m(x, ('seed', 'grid', 'tempo', 'ce', 'rise', 'joins', 'key', 'busy'))}</span></div>")
            h.append(f"<div class=m>{kind}: {s['held']} seeds held the grid · A's busy {s['a_busy']} · prompt: <code>{e(s['prompt'])}</code></div>")
        h.append("<h3>Into a fight: rest (calm) to battle</h3>")
        for k, label in (("now", "today (2-beat crossfade)"), ("bridge2", "2-bar bridge"), ("bridge4", "4-bar bridge")):
            b = r["bridges"][k]
            h.append(f"<div class=row><b>{label}</b>{audio(b['file'])}<span class=m>{m(b, ('seed', 'grid', 'ce', 'held'))}</span></div>")
        h.append("<h3>Levels: rest 4 bars · urgent 4 · intense 4 · rest 4</h3>")
        for k, label in (("today", "today's levels"), ("strip", "one take, stripped")):
            s = r["strip"][k]
            h.append(f"<div class=row><b>{label}</b>{audio(s['file'])}<span class=m>onsets/s rest, urgent, intense: "
                     f"{s['onsets']} · LUFS {s['lufs']}</span></div>")
        h.append(f"<div class=row><b>stripped rest alone</b>{audio(r['strip']['strip']['rest_file'])}</div>")
    return "\n".join(h)


if __name__ == "__main__":
    sys.exit(main())

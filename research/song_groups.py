"""Song groups: the liked music takes clustered by how they sound, and one long stream per group to listen through.
(Research, outside the app. 2026-10-19, the designer: "I've been wanting to group them by similarity... if I could hear
a long stream of each group that is similar I think it would help me.")

  1. Every liked take (votes `mesh_<set>.<take>.<profile>` = 1), by its spine: the song itself, before layers (the
     stack profile's calm level, else the tension level, which every other profile derives from). The layers are the
     same drums under every song, so they're left out of the comparison.
  2. Embedded with CLAP (laion/larger_clap_music_and_speech: audio and text in one space, trained on music and its
     descriptions), the mean of four ~10.7 s windows (4 bars each) over the 16-bar loop, so the whole loop counts. The
     embeddings are centred on the 98 songs' mean before comparing, so what they all share (dark cinematic music)
     doesn't swamp what sets them apart. (laion/larger_clap_music gives the same embedding for everything: tested
     2026-10-19 on transformers 4.46 and 5.19 alike, ~0.998 between any two songs and ~0 to any description.)
  3. Clustered (Ward on the unit vectors, so close to cosine), the group count picked by silhouette between --min and
     --max groups. Within a group the songs are put in a chain, each next to its nearest, so the stream moves by
     small steps.
  4. Each group as one stream: every song one full loop at -20 LUFS, into the next with the game's two-bar equal-power
     crossfade (the old loop's last two bars under the new one's first two).
  5. CLAP's words for each group: the descriptions (DESCRIBE) scoring highest for the group against all 98 songs (its
     mean similarity minus the mean over every song), so they say what sets the group apart, not what all the music is.

  runtime/venv/bin/python research/song_groups.py --project P [--k K]
Streams go to the project's clips/groups/ (served by `serve` at /clips/groups/), the groups and every song's place in
its stream to research/data/song_groups.json; the embeddings are cached in research/data/song_embeddings.npz.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))
DATA = LAB / "research" / "data"
CLAP = "laion/larger_clap_music_and_speech"  # (laion/larger_clap_music is broken: every song ~0.998 alike, ~0 to any text)
LUFS, SWITCH_BARS = -20.0, 2

DESCRIBE = [
    "solo violin melody", "fiddle", "string orchestra", "low cello and double bass", "choir", "male choir chanting",
    "solo female voice", "war drums", "frame drum and rattle", "timpani", "brass horns", "low horn calls",
    "plucked harp", "kantele", "lyre", "hurdy gurdy drone", "bagpipe drone", "flute", "glassy celesta and bells",
    "water and glass textures", "dark ambient drone", "eerie horror soundscape", "epic cinematic trailer",
    "medieval battle music", "Nordic folk music", "folk dance", "slow and sparse", "fast and driving",
    "sad and mournful", "tense and suspenseful", "warm and pastoral", "cold and icy", "majestic and heroic",
    "bright major key", "dark minor key", "repetitive ostinato", "lyrical melody", "rhythmic and percussive",
]


def liked(st, M) -> list[dict]:
    idx, votes = st.index(), st.votes()
    sets = idx["mesh"]["contexts"]
    songs = []
    for vid, v in sorted(votes["clips"].items()):
        if v != 1 or not vid.startswith("mesh_"):
            continue
        key, tid, prof = vid[5:].rsplit(".", 2)
        take = next(t for t in sets[key]["takes"] if t["id"] == tid)
        levels = take["profiles"][prof]["levels"]
        strength = M["profiles"].get(prof, {})
        level = "calm" if strength.get("calm", 1) == 0 else "tension"  # (the spine: strength 0, or the middle level)
        songs.append(dict(id=vid, set=key, take=tid, profile=prof, context=sets[key]["context"],
                          style=key.split("~")[1] if "~" in key else "", level=level, file=levels[level]))
    return songs


def embed(songs: list[dict], clips: Path) -> np.ndarray:
    cache = DATA / "song_embeddings.npz"
    have = {}
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        have = dict(zip(z["files"].tolist(), z["emb"]))
    todo = [s for s in songs if s["file"] not in have]
    if todo:
        import librosa
        import torch
        from transformers import ClapModel, ClapProcessor
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        model, proc = ClapModel.from_pretrained(CLAP).to(dev).eval(), ClapProcessor.from_pretrained(CLAP)
        for i, s in enumerate(todo):
            y, _ = librosa.load(clips / s["file"], sr=48000, mono=True)
            n = len(y) // 4
            wins = [y[k * n:(k + 1) * n] for k in range(4)]
            inp = proc(audio=wins, sampling_rate=48000, return_tensors="pt").to(dev)
            with torch.no_grad():
                e = _tensor(model.get_audio_features(**inp)).float().cpu().numpy()
            e /= np.linalg.norm(e, axis=1, keepdims=True)
            have[s["file"]] = e.mean(axis=0)
            print(f"  embedded {i + 1}/{len(todo)} {s['id']}", flush=True)
        DATA.mkdir(parents=True, exist_ok=True)
        np.savez(cache, files=np.array(list(have)), emb=np.array(list(have.values())))
    E = np.array([have[s["file"]] for s in songs])
    return E / np.linalg.norm(E, axis=1, keepdims=True)


def centred(E: np.ndarray) -> np.ndarray:
    C = E - E.mean(axis=0)
    return C / np.linalg.norm(C, axis=1, keepdims=True)


def words(E: np.ndarray) -> np.ndarray:
    import torch
    from transformers import ClapModel, ClapProcessor
    model, proc = ClapModel.from_pretrained(CLAP).eval(), ClapProcessor.from_pretrained(CLAP)
    with torch.no_grad():
        t = _tensor(model.get_text_features(**proc(text=DESCRIBE, return_tensors="pt", padding=True))).float().numpy()
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    return E @ t.T  # songs x descriptions


def _tensor(out):
    return out if hasattr(out, "float") else getattr(out, "pooler_output", None) if getattr(out, "pooler_output", None) is not None else out[0]


def chain(E: np.ndarray, members: list[int]) -> list[int]:
    """The group's songs in a path, each next to its nearest unplayed: from the one farthest from the group's centre."""
    c = E[members].mean(axis=0)
    left = list(members)
    cur = min(left, key=lambda i: E[i] @ c)
    order = [cur]
    left.remove(cur)
    while left:
        cur = max(left, key=lambda i: E[i] @ E[cur])
        order.append(cur)
        left.remove(cur)
    return order


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--k", type=int, help="the number of groups (default: the best silhouette between --min and --max)")
    ap.add_argument("--min", type=int, default=5)
    ap.add_argument("--max", type=int, default=12)
    a = ap.parse_args()
    from sklearn.cluster import AgglomerativeClustering
    from sklearn.metrics import silhouette_score
    from soundlab import dsp, project as P
    from soundlab.store import Store

    proj = P.load(a.project)
    st, M = Store(proj), proj.music
    songs = liked(st, M)
    print(f"{len(songs)} liked takes", flush=True)
    raw = embed(songs, st.clips)
    E = centred(raw)
    sims = E @ E.T
    print(f"similarity between songs: median {np.median(sims[np.triu_indices(len(E), 1)]):.3f}, "
          f"min {sims.min():.3f}", flush=True)

    fits = {}
    for k in range(a.min, a.max + 1):
        lab = AgglomerativeClustering(n_clusters=k, linkage="ward").fit_predict(E)
        fits[k] = (silhouette_score(E, lab, metric="cosine"), lab)
        print(f"  {k} groups: silhouette {fits[k][0]:.3f}, sizes {sorted(np.bincount(lab).tolist(), reverse=True)}")
    k = a.k or max(fits, key=lambda j: fits[j][0])
    lab = fits[k][1] if k in fits else AgglomerativeClustering(n_clusters=k, linkage="ward").fit_predict(E)

    W = words(raw)
    W_rel = W - W.mean(axis=0)
    bar = int(round(M["bar_beats"] * 60.0 / M["bpm"] * dsp.SR))
    out = st.clips / "groups"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("group_*.ogg"):
        old.unlink()
    groups = []
    for g in sorted(set(lab), key=lambda g: -np.sum(lab == g)):
        members = [i for i in range(len(songs)) if lab[i] == g]
        order = chain(E, members)
        rel = W_rel[members].mean(axis=0)
        top = [DESCRIBE[j] for j in np.argsort(-rel)[:4]]
        c = E[members].mean(axis=0)
        n = len(groups) + 1
        stream, entries = np.zeros((0, 2)), []
        for i in order:
            x = dsp.normalise(dsp.decode(st.clips / songs[i]["file"]), LUFS)
            start = 0 if not len(stream) else len(stream) - SWITCH_BARS * bar
            if len(stream):
                f = np.linspace(0, 1, SWITCH_BARS * bar)[:, None]
                stream[start:] = stream[start:] * np.cos(f * np.pi / 2) + x[:SWITCH_BARS * bar] * np.sin(f * np.pi / 2)
                x = x[SWITCH_BARS * bar:]
            entries.append(dict(**songs[i], at_s=round(start / dsp.SR, 2),
                                fit=round(float(E[i] @ c / np.linalg.norm(c)), 3)))
            stream = np.concatenate([stream, x])
        dsp.write(out / f"group_{n}.ogg", dsp.limit(stream, -1.0))
        inner = sims[np.ix_(members, members)][np.triu_indices(len(members), 1)]
        groups.append(dict(group=n, size=len(members), words=top, file=f"groups/group_{n}.ogg",
                           minutes=round(len(stream) / dsp.SR / 60, 1),
                           within=round(float(inner.mean()) if len(inner) else 1.0, 3), songs=entries))
        print(f"group {n}: {len(members)} songs, {groups[-1]['minutes']} min, within {groups[-1]['within']}, "
              f"words: {', '.join(top)}", flush=True)
        for e in entries:
            print(f"    {int(e['at_s'] // 60)}:{int(e['at_s'] % 60):02d}  {e['set']} {e['take']} ({e['profile']})")
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "song_groups.json").write_text(json.dumps(dict(
        k=k, silhouette={j: round(float(s), 3) for j, (s, _) in fits.items()}, groups=groups), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

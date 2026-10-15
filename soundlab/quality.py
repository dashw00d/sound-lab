"""Checks for off-sounding music: measurements that catch what a listener hears as broken, so a take can be flagged
(or rejected) before anyone has to listen to it. `soundlab music check` writes them into the index, per take and
level file, and the Music page shows the flags.

Per level (each file once):
  dropouts      gaps where the loudness falls over 15 dB under the level's median for 0.2 s or more: (count, seconds)
  jumps         sudden changes of timbre or harmony mid-loop: beat-synchronous chroma + MFCC, a two-bar checkerboard
                novelty curve (Foote), its peaks in robust z-scores; phrase boundaries every 4 bars are expected and
                left out
  drift         per bar, how far a level's harmony is from the spine's (1 - chroma cosine): a derived level that
                wanders plays other chords than the level it crossfades with
  key           per bar, the share of chroma energy inside the set's mode (D dorian, aeolian, phrygian...)
  noise         bursts of noise: loud frames with a spectral flatness over 0.35
  repeat        mean similarity of each bar to the next (1 = every bar the same)
  aesthetics    Meta's Audiobox Aesthetics (CE content enjoyment, CU usefulness, PC complexity, PQ production
                quality, 1-10), when the package is installed

Validated against the designer's votes (Emberhold round 3, 2026-10-14: 35 takes, 13 liked): Audiobox's content
enjoyment (CE) told liked from not with AUC 0.82 on the spine (0.79 on calm), and within a style the liked takes were
the highest rated; no liked take rated under 6.74 calm, 6.94 tension, 6.37 action. The hand-made measures predicted
little (drift AUC 0.35, key and jumps ~0.5), and some liked takes had long dropouts (composed breaks), so those only
warn. GATE rejects a take while it is generated; THRESHOLDS flag a level on the Music page.
"""
from __future__ import annotations

import numpy as np

from . import dsp
from .dsp import SR

MODES = {"ionian": [0, 2, 4, 5, 7, 9, 11], "dorian": [0, 2, 3, 5, 7, 9, 10], "phrygian": [0, 1, 3, 5, 7, 8, 10],
         "lydian": [0, 2, 4, 6, 7, 9, 11], "mixolydian": [0, 2, 4, 5, 7, 9, 10], "aeolian": [0, 2, 3, 5, 7, 8, 10],
         "locrian": [0, 1, 3, 5, 6, 8, 10], "major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10]}
NOTES = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8,
         "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}

# A level is flagged when any of these is crossed (warnings: the designer decides).
THRESHOLDS = dict(ce=6.5, dropout_s=1.5, drift=0.35, noise_frames=0.02)
# A take is rejected while generating when a level's content enjoyment (CE) is under its floor: none of the liked
# takes was; 9 of 22 unliked ones were.
GATE = {"calm": 6.3, "tension": 6.8, "action": 6.3}

_SR = 22050
_HOP = 512


def _mono(x: np.ndarray) -> np.ndarray:
    import librosa

    return librosa.resample(x.mean(axis=1).astype(np.float32), orig_sr=SR, target_sr=_SR)


def _beat_frames(n_frames: int, bpm: float) -> np.ndarray:
    beat = 60.0 / bpm * _SR / _HOP
    return np.round(np.arange(0, n_frames, beat)).astype(int)


def features(x: np.ndarray, bpm: float) -> dict:
    """The per-beat features the checks share: chroma (12) and normalised MFCC (13)."""
    import librosa

    y = _mono(x)
    chroma = librosa.feature.chroma_stft(y=y, sr=_SR, hop_length=_HOP)
    mfcc = librosa.feature.mfcc(y=y, sr=_SR, hop_length=_HOP, n_mfcc=13)
    b = _beat_frames(chroma.shape[1], bpm)
    cb = librosa.util.sync(chroma, b, aggregate=np.mean)
    mb = librosa.util.sync(mfcc, b, aggregate=np.mean)
    mb = (mb - mb.mean(axis=1, keepdims=True)) / (mb.std(axis=1, keepdims=True) + 1e-9)
    return dict(y=y, chroma=chroma, beat_chroma=cb, beat_mfcc=mb)


def _bars(beat_feat: np.ndarray, bar_beats: int) -> np.ndarray:
    n = beat_feat.shape[1] // bar_beats
    return beat_feat[:, :n * bar_beats].reshape(beat_feat.shape[0], n, bar_beats).mean(axis=2)


def _cos(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return (a * b).sum(axis=0) / (np.linalg.norm(a, axis=0) * np.linalg.norm(b, axis=0) + 1e-9)


def dropouts(x: np.ndarray) -> tuple[int, float]:
    env, _, hop = dsp.frame_rms(x, 0.05, 0.05)
    r = 20 * np.log10(env + 1e-9)
    low = r < np.median(r) - 15
    runs, n = [], 0
    for v in list(low) + [False]:
        if v:
            n += 1
        else:
            if n * 0.05 >= 0.2:
                runs.append(n * 0.05)
            n = 0
    return len(runs), round(float(sum(runs)), 2)


def jumps(f: dict, bar_beats: int) -> tuple[float, int]:
    """The strongest sudden change away from the 4-bar phrase lines: (robust z-score, bar from 1)."""
    v = np.vstack([f["beat_chroma"] / (np.linalg.norm(f["beat_chroma"], axis=0) + 1e-9), f["beat_mfcc"] * 0.3])
    v = v / (np.linalg.norm(v, axis=0) + 1e-9)
    ssm = v.T @ v
    k = 2 * bar_beats  # two bars either side
    n = ssm.shape[0]
    sign = np.sign(np.subtract.outer(np.arange(-k, k), -0.5))
    kernel = np.outer(sign, sign)
    nov = np.zeros(n)
    for i in range(k, n - k):
        nov[i] = (ssm[i - k:i + k, i - k:i + k] * kernel).sum()
    core = nov[k:n - k]
    med, mad = np.median(core), np.median(np.abs(core - np.median(core))) + 1e-9
    z = (nov - med) / (1.4826 * mad)
    z[:k] = z[n - k:] = 0
    phrase = 4 * bar_beats
    z[[i for i in range(n) if i % phrase in (phrase - 1, 0, 1)]] = 0  # (phrase lines, give or take a beat: composed)
    i = int(np.argmax(z))
    return round(float(z[i]), 1), i // bar_beats + 1


def key_fit(f: dict, mode: str, bar_beats: int) -> list[float]:
    """Per bar, the share of chroma energy in the mode's notes ("D aeolian")."""
    tonic, name = (mode.split() + ["aeolian"])[:2]
    pcs = [(NOTES.get(tonic, 2) + s) % 12 for s in MODES.get(name.lower(), MODES["aeolian"])]
    bars = _bars(f["beat_chroma"], bar_beats)
    return [round(float(v), 2) for v in bars[pcs].sum(axis=0) / (bars.sum(axis=0) + 1e-9)]


def drift(f: dict, spine: dict, bar_beats: int) -> list[float]:
    a, b = _bars(f["beat_chroma"], bar_beats), _bars(spine["beat_chroma"], bar_beats)
    n = min(a.shape[1], b.shape[1])
    return [round(float(v), 2) for v in 1 - _cos(a[:, :n], b[:, :n])]


def noise(f: dict) -> float:
    import librosa

    flat = librosa.feature.spectral_flatness(y=f["y"], hop_length=_HOP)[0]
    rms = librosa.feature.rms(y=f["y"], hop_length=_HOP)[0]
    loud = rms > np.median(rms)
    return round(float(((flat > 0.35) & loud).mean()), 3)


def repeat(f: dict, bar_beats: int) -> float:
    bars = _bars(np.vstack([f["beat_chroma"], f["beat_mfcc"] * 0.3]), bar_beats)
    return round(float(_cos(bars[:, :-1], bars[:, 1:]).mean()), 2)


_AES = {}


def aesthetics(paths: list[str]) -> list[dict | None]:
    """Audiobox Aesthetics scores (CE, CU, PC, PQ), or None when it isn't installed."""
    try:
        from audiobox_aesthetics.infer import initialize_predictor
    except ImportError:
        return [None] * len(paths)
    if "p" not in _AES:
        _AES["p"] = initialize_predictor()
    out = []
    for i in range(0, len(paths), 8):
        out += [{k: round(float(v), 2) for k, v in r.items()} for r in _AES["p"].forward([{"path": p} for p in paths[i:i + 8]])]
    return out


def flags(q: dict) -> list[str]:
    """What a listener may hear as off, in words."""
    T, out = THRESHOLDS, []
    ce = q.get("aes", {}).get("CE")
    if ce is not None and ce < T["ce"]:
        out.append(f"rated weak ({ce:.1f})")
    if q["dropouts"][1] >= T["dropout_s"]:
        out.append(f"{q['dropouts'][0]} pause{'s' if q['dropouts'][0] != 1 else ''} ({q['dropouts'][1]:.1f} s)")
    if q.get("drift") and max(q["drift"]) >= T["drift"]:
        bad = [i + 1 for i, v in enumerate(q["drift"]) if v >= T["drift"]]
        out.append(f"drifts from the spine in bar{'s' if len(bad) > 1 else ''} {', '.join(map(str, bad[:4]))}")
    if q["noise"] >= T["noise_frames"]:
        out.append("noise bursts")
    return out


def gate(level_paths: dict[str, str]) -> str | None:
    """Why a take should be rejected (a level rated under GATE), or None. Needs Audiobox Aesthetics; without it,
    every take passes."""
    lv = [l for l in level_paths if l in GATE]
    for l, a in zip(lv, aesthetics([level_paths[l] for l in lv])):
        if a and a["CE"] < GATE[l]:
            return f"{l} rated {a['CE']:.1f} (under {GATE[l]})"
    return None


def assess(x: np.ndarray, M: dict, mode: str, spine: dict | None) -> tuple[dict, dict]:
    """A level's report (and its features, to compare other levels with)."""
    bb = M["bar_beats"]
    f = features(x, M["bpm"])
    q = dict(dropouts=dropouts(x), jump=jumps(f, bb), key=key_fit(f, mode, bb), noise=noise(f), repeat=repeat(f, bb))
    if spine is not None:
        q["drift"] = drift(f, spine, bb)
    q["flags"] = flags(q)
    return q, f

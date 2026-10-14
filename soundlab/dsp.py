"""Audio helpers shared by every generator: file IO through ffmpeg, loudness (ITU BS.1770), a look-ahead limiter,
loop crossfades, pitch (pyin cross-checked with YIN), sampler-style retuning, and beat-grid measurement.

Audio is numpy float64 shaped (samples, channels) at SR."""
from __future__ import annotations

import math
import re
import subprocess
import wave
from pathlib import Path

import numpy as np

from .paths import ffmpeg

SR = 44100


# --------------------------------------------------------------------------- files

def decode(path: Path, channels: int = 2) -> np.ndarray:
    cmd = [ffmpeg(), "-v", "error", "-i", str(path), "-f", "f32le", "-acodec", "pcm_f32le",
           "-ac", str(channels), "-ar", str(SR), "-"]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).reshape(-1, channels).astype(np.float64)


def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = np.clip(np.round(x * 32767.0), -32768, 32767).astype("<i2")
    tmp = path.with_suffix(".tmp")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    tmp.replace(path)


def write_ogg(path: Path, x: np.ndarray) -> None:
    tmp = path.with_name(path.stem + ".tmp.ogg")
    cmd = [ffmpeg(), "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(x.shape[1]), "-i", "-",
           "-c:a", "libvorbis", "-q:a", "5", "-fflags", "+bitexact", "-flags:a", "+bitexact", str(tmp)]
    subprocess.run(cmd, input=x.astype(np.float32).tobytes(), check=True)
    tmp.replace(path)


def write(path: Path, x: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    (write_ogg if path.suffix == ".ogg" else write_wav)(path, x)


def ffmpeg_filter(x: np.ndarray, af: str) -> np.ndarray:
    ch = x.shape[1]
    cmd = [ffmpeg(), "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-i", "-", "-af", af,
           "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-"]
    out = subprocess.run(cmd, input=x.astype(np.float32).tobytes(), capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).reshape(-1, ch).astype(np.float64)


# --------------------------------------------------------------------------- level

def loudness_stats(x: np.ndarray) -> tuple[float, float]:
    """(integrated LUFS, max momentary LUFS) via ffmpeg ebur128. Short clips are tiled to >= 3 s so the 400 ms
    gating blocks see the sound itself rather than its edges."""
    y = np.tile(x, (max(1, math.ceil(3 * SR / max(len(x), 1))), 1))
    cmd = [ffmpeg(), "-hide_banner", "-nostats", "-f", "f32le", "-ar", str(SR), "-ac", str(x.shape[1]),
           "-i", "-", "-af", "ebur128=framelog=info", "-f", "null", "-"]
    err = subprocess.run(cmd, input=y.astype(np.float32).tobytes(), capture_output=True).stderr.decode()
    i = re.findall(r"I:\s+(-?[\d.]+|-inf) LUFS", err)
    m = [float(v) for v in re.findall(r"M:\s*(-?[\d.]+)", err)]
    return (float(i[-1]) if i and i[-1] != "-inf" else -99.0), (max(m) if m else -99.0)


def db(v: float) -> float:
    return 20 * math.log10(max(v, 1e-12))


def _moving_min(a: np.ndarray, w: int) -> np.ndarray:
    h = w // 2
    n = len(a)
    pad = np.pad(a, (h, h), constant_values=1.0)
    pad = np.pad(pad, (0, (-len(pad)) % w), constant_values=1.0)
    blocks = pad.reshape(-1, w)
    pre = np.minimum.accumulate(blocks, axis=1).ravel()
    suf = np.minimum.accumulate(blocks[:, ::-1], axis=1)[:, ::-1].ravel()
    return np.minimum(suf[:n], pre[w - 1:w - 1 + n])


def _moving_avg(a: np.ndarray, w: int) -> np.ndarray:
    h = w // 2
    c = np.concatenate([[0.0], np.cumsum(np.pad(a, (h, h), mode="edge"))])
    return (c[w:] - c[:-w]) / w


def limit(x: np.ndarray, ceiling_db: float, hold_ms: float = 20.0) -> np.ndarray:
    """Look-ahead brickwall limiter: never exceeds the ceiling, never clips."""
    ceil = 10 ** (ceiling_db / 20)
    pk = np.abs(x).max(axis=1)
    g = np.minimum(1.0, ceil / np.maximum(pk, 1e-12))
    if g.min() >= 1.0:
        return x
    h = int(hold_ms * SR / 1000)
    gs = _moving_avg(_moving_min(g, 2 * h + 1), h + (1 - h % 2))
    y = x * np.minimum(gs, g)[:, None]
    return y * min(1.0, ceil / max(np.abs(y).max(), 1e-12))


def normalise(x: np.ndarray, lufs: float, ceiling_db: float = -1.0) -> np.ndarray:
    """Integrated loudness to `lufs`, limited at `ceiling_db` (re-measured, since the limiter shaves a little)."""
    x = x - x.mean(axis=0)
    for _ in range(3):
        x = limit(x * 10 ** ((lufs - loudness_stats(x)[0]) / 20), ceiling_db)
        if abs(loudness_stats(x)[0] - lufs) < 0.2:
            break
    return x


def frame_rms(x: np.ndarray, win: float, hop: float) -> tuple[np.ndarray, int, int]:
    p = (x ** 2).mean(axis=1)
    w, hp = max(1, int(win * SR)), max(1, int(hop * SR))
    c = np.concatenate([[0.0], np.cumsum(p)])
    starts = np.arange(0, max(1, len(p) - w + 1), hp)
    ends = np.minimum(starts + w, len(p))
    return np.sqrt((c[ends] - c[starts]) / np.maximum(ends - starts, 1)), w, hp


def active_bounds(x: np.ndarray, rel_db: float, floor_db: float = -70) -> tuple[int, int]:
    env, w, hp = frame_rms(x, 0.01, 0.005)
    thr = max(env.max() * 10 ** (rel_db / 20), 10 ** (floor_db / 20))
    idx = np.nonzero(env > thr)[0]
    if len(idx) == 0:
        return 0, len(x)
    return int(idx[0] * hp), int(min(len(x), idx[-1] * hp + w))


def silent(x: np.ndarray) -> bool:
    """A failed generation: no real signal at all."""
    return db(float(np.abs(x).max())) < -45 or db(float(np.sqrt((x ** 2).mean()))) < -60


def eq_power(n: int) -> tuple[np.ndarray, np.ndarray]:
    t = (np.arange(n) + 0.5) / n
    return np.sin(0.5 * np.pi * t)[:, None], np.cos(0.5 * np.pi * t)[:, None]


def crossfade_loop(x: np.ndarray, start: int, end: int, xf: int) -> np.ndarray:
    """Loop x[start:end]: the xf samples after `end` are faded over the head, so the wrap continues exactly where
    the source audio did."""
    fin, fout = eq_power(xf)
    y = x[start:end].copy()
    y[:xf] = x[start:start + xf] * fin + x[end:end + xf] * fout
    return y


# --------------------------------------------------------------------------- pitch and sampler

def yin(x: np.ndarray) -> tuple[float, float]:
    """Fundamental (Hz, 55-1000) by YIN over the first half-second of sustain, and its aperiodicity."""
    mono = x.mean(axis=1)
    a, b = active_bounds(x, -40)
    W, tmin, tmax = 2048, int(SR / 1000), int(SR / 55)
    est = []
    for start in range(a + int(0.04 * SR), min(b, a + int(0.6 * SR)) - W - tmax, int(0.05 * SR)):
        seg = mono[start:start + W + tmax]
        d = np.array([np.sum((seg[:W] - seg[t:t + W]) ** 2) for t in range(tmax)])
        cm = np.concatenate([[1.0], d[1:] * np.arange(1, tmax) / np.maximum(np.cumsum(d[1:]), 1e-12)])
        below = np.nonzero(cm[tmin:] < 0.15)[0]
        t = tmin + (below[0] if len(below) else int(np.argmin(cm[tmin:])))
        while t + 1 < tmax and cm[t + 1] < cm[t]:
            t += 1
        if 1 <= t < tmax - 1:
            den = cm[t - 1] - 2 * cm[t] + cm[t + 1]
            t = t + 0.5 * (cm[t - 1] - cm[t + 1]) / den if den else t
        est.append((SR / t, float(cm[int(round(t))])))
    if not est:
        return 0.0, 1.0
    return float(np.median([e[0] for e in est])), float(np.median([e[1] for e in est]))


def pitch_of(x: np.ndarray) -> dict:
    """pyin's median pitch over the first 1.5 s, its voiced share, and whether YIN agrees on the pitch class
    (within 50 cents, octave errors forgiven). A note is only trusted when both hold."""
    import librosa

    a, _ = active_bounds(x, -40)
    m = x.mean(axis=1)[a:a + int(1.5 * SR)]
    f, v, _ = librosa.pyin(m, fmin=55, fmax=1100, sr=SR, frame_length=4096)
    fv = f[v & ~np.isnan(f)]
    hz = float(np.median(fv)) if len(fv) else 0.0
    y, _ = yin(x)
    cents = 1200 * abs(np.log2(hz / y)) % 1200 if hz and y else 600
    return dict(hz=round(hz, 2), voiced=round(len(fv) / max(len(f), 1), 2), yin=round(y, 2),
                ok=bool(hz and min(cents, 1200 - cents) < 50 and len(fv) >= 0.7 * len(f)))


def onset_trim(x: np.ndarray) -> np.ndarray:
    a, _ = active_bounds(x, -40)
    return x[max(0, a - int(0.003 * SR)):]


def shift(x: np.ndarray, ratio: float) -> np.ndarray:
    """Resample by `ratio` (>1 = higher and shorter), as a sampler does."""
    n = int(len(x) / ratio)
    src = np.arange(n) * ratio
    return np.stack([np.interp(src, np.arange(len(x)), x[:, c]) for c in range(x.shape[1])], axis=1)


def gate(x: np.ndarray, length: float, release: float = 0.18) -> np.ndarray:
    n, r = int(length * SR), int(release * SR)
    if len(x) <= n:
        return x
    y = x[:n + r].copy()
    y[n:] *= np.linspace(1, 0, len(y) - n)[:, None]
    return y


# --------------------------------------------------------------------------- beat grid

def onset_env(x: np.ndarray):
    import librosa

    y = librosa.resample(x.mean(axis=1).astype(np.float32), orig_sr=SR, target_sr=22050)
    return librosa.onset.onset_strength(y=y, sr=22050, hop_length=256), 22050 / 256


def beat_times(x: np.ndarray, bpm: float) -> np.ndarray:
    import librosa

    env, fps = onset_env(x)
    _, b = librosa.beat.beat_track(onset_envelope=env, sr=22050, hop_length=256, start_bpm=bpm)
    return b / fps


def tempo_of(x: np.ndarray, bpm: float) -> tuple[float, float]:
    """Measured tempo (a line fitted through the tracked beats, folded towards `bpm`) and the beat-interval
    spread in ms."""
    t = beat_times(x, bpm)
    if len(t) < 8:
        return 0.0, 999.0
    tempo = 60.0 / np.polyfit(np.arange(len(t)), t, 1)[0]
    while tempo > bpm * 1.4:
        tempo /= 2
    while tempo < bpm / 1.4:
        tempo *= 2
    return float(tempo), float(np.std(np.diff(t)) * 1000)


def grid_phase(x: np.ndarray, bpm: float) -> tuple[float, float]:
    """Where the tracked beats sit on the exact grid from t=0: the circular mean offset (s, within half a beat)
    and its consistency (1 = every beat on the grid)."""
    beat = 60.0 / bpm
    z = np.exp(2j * np.pi * (beat_times(x, bpm) % beat) / beat).mean()
    return float(np.angle(z) / (2 * np.pi) * beat), float(abs(z))


def first_downbeat(x: np.ndarray, bpm: float, bar_beats: int) -> float:
    """Seconds to the first downbeat: the beat phase from the tracked beats, then the bar phase where the onsets
    on every bar_beats-th beat are strongest."""
    env, fps = onset_env(x)
    beat = 60.0 / bpm
    off = grid_phase(x, bpm)[0] % beat
    n = int((len(env) / fps - off) / beat) - 1

    def accent(k):
        idx = ((off + np.arange(k, n, bar_beats) * beat) * fps).astype(int)
        return env[idx[idx < len(env)]].mean()

    return off + max(range(bar_beats), key=accent) * beat


def snap(y: np.ndarray, bpm: float) -> tuple[np.ndarray, float]:
    """Rotate a loop so its beats sit on the grid (the loop is circular, so nothing is lost)."""
    beat = 60.0 / bpm
    off, _ = grid_phase(y, bpm)
    d = (off + beat / 2) % beat - beat / 2
    return np.roll(y, -int(round(d * SR)), axis=0), d

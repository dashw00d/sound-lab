"""What the bass swap does, drawn (2026-10-22, the designer: "can you show me an example with and without bass swap i
was having a hard time figuring out the difference"). Picks the graph's seamless cut (between two different pieces, not
siblings) where both songs' bass stems are loudest at the join, mixes it as the player does (two beats' equal-power crossfade centred on the bar line; with the
swap, under 180 Hz the song going out keeps its low end to the bar line and the one coming in takes it there), and
draws each song's low end and the mix's low spectrum, without and with. Writes work/<project>/views/bass_swap.png.

  runtime/venv/bin/python research/bass_swap_view.py --project P
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from soundlab import dsp, project as P  # noqa: E402
from soundlab.music.shipping import library  # noqa: E402
from soundlab.store import Store  # noqa: E402
from soundlab.sync import _Lab  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    a = ap.parse_args()
    proj = P.load(a.project)
    L, M = _Lab(proj), proj.music
    stems = Store.read(proj.work / "stems.json", {})
    sr, bar = dsp.SR, 4 * 60.0 / M["bpm"]
    url = lambda u: (proj.work / "clips" / u[7:]) if u.startswith("/clips/") else Path(proj.assets) / u[9:]
    # (the graph's cuts, each scored by the quieter of the two bass stems around the join: the strongest pair of basslines)
    F = L.F
    best, best_v, bass = None, -1e9, {}
    def bass_db(sid, b0, b1):
        f = (stems.get(sid) or {}).get("files", {}).get("calm.bass")
        if not f:
            return None
        if sid not in bass:
            bass[sid] = dsp.decode(proj.work / "clips" / f).mean(axis=1)
        x = bass[sid][int(b0 * bar * sr):int(b1 * bar * sr)]
        return 10 * np.log10(np.mean(x ** 2) + 1e-12) if len(x) else None
    for sid, it in F["items"].items():
        if sid not in L.tracks:
            continue
        for b, c in (it.get("cuts") or {}).items():
            if b not in L.tracks or sid.split(".")[2:4] == b.split(".")[2:4]:  # (not a sibling: the same piece, the same bass)
                continue
            for e, s in c.get("at", [])[:6]:
                va, vb = bass_db(sid, e - 1, e), bass_db(b, s - 1, s)
                if va is not None and vb is not None and min(va, vb) > best_v:
                    best_v, best = min(va, vb), (sid, e, b, s)
    sid_a, e, sid_b, s = best
    print(f"the cut: {sid_a} after bar {e} -> {sid_b} from bar {s} (bass stems {best_v:.1f} dB at the join)")
    A = dsp.decode(url(L.tracks[sid_a]["src"]["calm"])).mean(axis=1)
    B = dsp.decode(url(L.tracks[sid_b]["src"]["calm"])).mean(axis=1)
    # (a timeline from 2 bars before the bar line to 2 after; each song where the player would have it)
    t = np.arange(int(-2 * bar * sr), int(2 * bar * sr)) / sr
    xa = A[np.clip((e * bar + t) * sr, 0, len(A) - 1).astype(int)]
    xb = B[np.clip(((s - 1) * bar + t) * sr, 0, len(B) - 1).astype(int)]
    beat = 60.0 / M["bpm"]
    k = np.clip((t + beat) / (2 * beat), 0, 1)
    ga, gb = np.cos(k * np.pi / 2), np.sin(k * np.pi / 2)
    lp = butter(2, 180, "lowpass", fs=sr, output="sos")
    la, lb = sosfilt(lp, xa), sosfilt(lp, xb)
    without = dict(a_low=ga * la, b_low=gb * lb, mix=ga * xa + gb * xb)
    sa, sb = (t < 0).astype(float), (t >= 0).astype(float)
    with_ = dict(a_low=sa * la, b_low=sb * lb, mix=ga * (xa - la) + gb * (xb - lb) + sa * la + sb * lb)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
    fig, ax = plt.subplots(2, 2, figsize=(13, 6.4), gridspec_kw=dict(width_ratios=[1.15, 1]), facecolor="#0b0d11")
    env = lambda x: np.array([20 * np.log10(np.sqrt(np.mean(x[i:i + 2205] ** 2)) + 1e-9) for i in range(0, len(x) - 2205, 441)])
    te = t[:len(t) - 2205:441]
    for row, (name, d) in enumerate((("Without bass swap", without), ("With bass swap", with_))):
        a0, a1 = ax[row]
        for axx in (a0, a1):
            axx.set_facecolor("#0b0d11"); axx.tick_params(colors="#8a90a4")
            for sp in axx.spines.values(): sp.set_color("#2a2f3d")
        ea, eb = env(d["a_low"]), env(d["b_low"])
        a0.fill_between(te, -60, ea, color="#ff9f6b", alpha=.55, lw=0, label="the bass of the song going out")
        a0.fill_between(te, -60, eb, color="#5bd6ff", alpha=.55, lw=0, label="the bass of the song coming in")
        both = (ea > ea.max() - 18) & (eb > eb.max() - 18)
        if both.any():
            x0, x1 = te[both].min(), te[both].max()
            a0.axvspan(x0, x1, color="#ffc857", alpha=.12, lw=0)
            a0.text((x0 + x1) / 2, ea.max() + 4, f"both basslines: {x1 - x0:.1f} s", color="#ffc857", ha="center", fontsize=10, fontweight="bold")
        a0.axvline(0, color="#ffffff", lw=1, alpha=.6); a0.set_ylim(max(-60, min(ea.min(), eb.min())), max(ea.max(), eb.max()) + 10)
        a0.set_xlim(-1.5 * beat * 2, 1.5 * beat * 2)
        a0.set_title(f"{name}: each song's low end (under 180 Hz)", color="#eef0f6", loc="left", fontsize=11, fontweight="bold")
        a0.set_ylabel("dB", color="#8a90a4")
        if row == 0:
            a0.legend(loc="lower left", fontsize=8.5, facecolor="#161921", edgecolor="#2a2f3d", labelcolor="#c9cde0")
        # (the mix's low spectrum: two bass notes at once show as two lines)
        n = 16384
        win = np.hanning(n); hop = 1024
        frames = [d["mix"][i:i + n] * win for i in range(0, len(d["mix"]) - n, hop)]
        S = np.abs(np.fft.rfft(np.array(frames), axis=1)).T
        f = np.fft.rfftfreq(n, 1 / sr); keep = (f >= 30) & (f <= 220)
        ts = t[:len(t) - n:hop] + n / 2 / sr
        a1.pcolormesh(ts, f[keep], 20 * np.log10(S[keep] + 1e-6), shading="auto", cmap="magma", vmin=np.percentile(20 * np.log10(S[keep] + 1e-6), 40))
        a1.axvline(0, color="#ffffff", lw=1, alpha=.6); a1.set_xlim(-1.5 * beat * 2, 1.5 * beat * 2)
        a1.set_title("the mix, 30 to 220 Hz", color="#eef0f6", loc="left", fontsize=11)
        a1.set_ylabel("Hz", color="#8a90a4")
    for axx in ax[1]:
        axx.set_xlabel("seconds from the bar line (the white line)", color="#8a90a4")
    fig.suptitle(f"{sid_a} bar {e}  →  {sid_b} bar {s}   ·   2-beat join", color="#a0a5b6", fontsize=10.5, x=0.01, ha="left")
    fig.tight_layout(rect=(0, 0, 1, .96))
    out = proj.work / "views" / "bass_swap.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=110, facecolor=fig.get_facecolor())
    print(out)


if __name__ == "__main__":
    main()

// Gain shapes for the walk's crossfades (mixer.js, ported as is).
export const db = (v: number) => Math.pow(10, v / 20)
export const med = (xs: number[]) => { const v = [...xs].sort((x, y) => x - y), n = v.length; return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2 }

/** Equal power, from one level to another. */
export function curve(param: AudioParam, from: number, to: number, at: number, dur: number) {
  const c = new Float32Array(32)
  for (let i = 0; i < 32; i++) { const k = i / 31; c[i] = from < to ? to * Math.sin(k * Math.PI / 2) + from * Math.cos(k * Math.PI / 2) : from * Math.cos(k * Math.PI / 2) + to * Math.sin(k * Math.PI / 2) }
  try { param.setValueCurveAtTime(c, at, dur) } catch { param.setValueAtTime(to, at + dur) }
}
/** A taper: down in dB along k^2 (gentle at first, then away: -12 dB halfway, -48 by the end), then nothing. A song
 * leaving into a rest decrescendos rather than dipping (2026-10-21: "a pleasing taper into a bar of silence"). */
export function taper(p: AudioParam, from: number, at: number, dur: number) {
  const c = new Float32Array(48)
  for (let i = 0; i < 48; i++) { const k = i / 47; c[i] = i === 47 ? 0 : from * Math.pow(10, -2.4 * k * k) }
  try { p.setValueCurveAtTime(c, at, dur) } catch { p.setValueAtTime(0, at + dur) }
}
/** A ring-out: down at a steady rate in dB (-48 by the end), as a sound dies away, then nothing. */
export function decay(p: AudioParam, from: number, at: number, dur: number) {
  const c = new Float32Array(48)
  for (let i = 0; i < 48; i++) { const k = i / 47; c[i] = i === 47 ? 0 : from * Math.pow(10, -2.4 * k) }
  try { p.setValueCurveAtTime(c, at, dur) } catch { p.setValueAtTime(0, at + dur) }
}
/** Bass swap (from Musloop's player): at a song change only what's above SWAP_HZ crosses over; under it, the song going
 * out keeps its bass and kick to the bar line and the one coming in takes over there. Each chunk plays x through g (the
 * usual fades) and its low band through d: out = g.x + d.lp(x), so d = (the low band's gain) - g. */
export const SWAP_HZ = 180
export function swapCurve(level: number, comingIn: boolean, n = 64) {
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1), high = comingIn ? level * Math.sin(k * Math.PI / 2) : level * Math.cos(k * Math.PI / 2)
    const low = comingIn ? (k >= 0.5 ? level : 0) : (k < 0.5 ? level : 0)
    c[i] = low - high
  }
  return c
}
export function hold(p: AudioParam, t: number) {
  const q = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => void }
  if (q.cancelAndHoldAtTime) q.cancelAndHoldAtTime(t)
  else { p.cancelScheduledValues(t); try { p.setValueAtTime(p.value, t) } catch { /* inside a running curve */ } }
}
/** A straight line from v0 at t to v1 at t1. The start is pinned: a linear ramp runs from the param's previous event,
 * which after a cancel can be a fade that ended long before (a chunk faded across its whole length, 2026-10-21). */
export function line(p: AudioParam, t: number, v0: number, v1: number, t1: number) {
  hold(p, t); try { p.setValueAtTime(v0, t) } catch { /* ignore */ } p.linearRampToValueAtTime(v1, t1)
}

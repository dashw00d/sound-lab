// What goes into what: every 4-bar part of every measured song, scored against every other, both ways (mixer.js).
// A part x then a part y joins well when y's first bar is like the bar that really followed x in its own song, and x's
// last bar like the bar that really came before y (bar fingerprints: beat chroma and MFCC; a natural bar step ~0.78).
// "Base": how alike two parts' pitch classes are overall. Two random parts of different songs join both ways that well
// about 1% of the time, but sets of 10 parts from 10 songs do: starter sets, and what fits everything in a set.
import { LEN, pkey, type Judge } from './judge'
import type { Part } from './types'

export class PartMatrix {
  readonly parts: Part[] = []
  readonly idx = new Map<string, number>()
  readonly P: number
  private J: Float32Array
  private chroma: Float64Array[] = []
  private starterSets: { parts: Part[]; mean: number }[] | null = null

  constructor(jd: Judge) {
    const ts = jd.lib.tracks.filter(t => t.measure?.feat && jd.active(t)), n = jd.N
    ts.forEach(t => { for (let s = 1; s + LEN - 1 <= n; s++) { this.idx.set(`${t.id}|${s}`, this.parts.length); this.parts.push({ track: t.id, start: s }) } })
    const P = (this.P = this.parts.length), D = ts[0]?.measure?.feat[0].length ?? 0
    const at = (t: string, k: number) => jd.track(t)!.measure!.feat[((k % n) + n) % n]
    const first: number[][] = [], last: number[][] = [], next: number[][] = [], prev: number[][] = [], lf: number[] = [], ll: number[] = []
    for (const p of this.parts) {
      const f = jd.track(p.track)!.measure!, s = p.start - 1
      first.push(at(p.track, s)); last.push(at(p.track, s + LEN - 1)); next.push(at(p.track, s + LEN)); prev.push(at(p.track, s - 1))
      lf.push(f.loud.calm[s]); ll.push(f.loud.calm[s + LEN - 1])
      const c = new Float64Array(12)
      for (let k = 0; k < LEN; k++) for (let i = 0; i < 12; i++) c[i] += f.feat[s + k][i]
      const nn = Math.hypot(...c) || 1
      this.chroma.push(c.map(v => v / nn))
    }
    const dot = (a: number[], b: number[]) => { let v = 0; for (let i = 0; i < D; i++) v += a[i] * b[i]; return v }
    this.J = new Float32Array(P * P)  // J[x * P + y]: x then y
    for (let x = 0; x < P; x++) for (let y = 0; y < P; y++)
      this.J[x * P + y] = 0.5 * (dot(next[x], first[y]) + dot(last[x], prev[y])) - 0.02 * Math.max(0, Math.abs(lf[y] - ll[x]) - 3)
  }
  j = (x: number, y: number) => this.J[x * this.P + y]
  both = (x: number, y: number) => Math.min(this.J[x * this.P + y], this.J[y * this.P + x])
  base = (x: number, y: number) => { let v = 0; for (let i = 0; i < 12; i++) v += this.chroma[x][i] * this.chroma[y][i]; return v }
  ix = (p: Part) => this.idx.get(pkey(p))
  joinOf(a: Part, b: Part): number | null { const x = this.ix(a), y = this.ix(b); return x == null || y == null ? null : this.j(x, y) }

  /** Starter sets: from parts with many strong partners, add the part whose worst join (both ways) with the set is
   * best, while it stays at least `tau` with every member, with the same base, one part per song. */
  starters(tau = 0.75) {
    if (this.starterSets) return this.starterSets
    const P = this.P, song = this.parts.map(p => p.track), strength: number[] = []
    for (let x = 0; x < P; x++) { let c = 0; for (let y = 0; y < P; y++) if (song[y] !== song[x] && this.both(x, y) >= tau) c++; strength.push(c) }
    const seeds = [...Array(P).keys()].sort((a, b) => strength[b] - strength[a]).slice(0, 120), sets: number[][] = [], seen = new Set<string>()
    for (const seed of seeds) {
      const S = [seed], songs = new Set([song[seed]])
      for (;;) {
        let best = -1, bv = -9
        for (let c = 0; c < P; c++) {
          if (songs.has(song[c])) continue
          let w = 9
          for (const m of S) { const v = Math.min(this.both(c, m), this.base(c, m) >= 0.9 ? 9 : -9); if (v < w) w = v; if (w < tau) break }
          if (w >= tau && w > bv) { bv = w; best = c }
        }
        if (best < 0) break
        S.push(best); songs.add(song[best])
      }
      const key = [...songs].sort().join(',')
      if (S.length >= 4 && !seen.has(key)) { seen.add(key); sets.push(S) }
    }
    const mean = (S: number[]) => { let v = 0, n = 0; for (const a of S) for (const b of S) if (a !== b) { v += this.j(a, b); n++ } return v / n }
    this.starterSets = sets.map(S => ({ parts: S.map(i => this.parts[i]), mean: mean(S) }))
      .sort((a, b) => b.parts.length - a.parts.length || b.mean - a.mean).slice(0, 8)
    return this.starterSets
  }
  /** What fits everything in the set: its worst join, both ways, with every member; each song's best part. */
  suggestions(set: Part[]) {
    const S = set.map(this.ix).filter((i): i is number => i != null)
    if (!S.length) return []
    const overlaps = (a: Part, b: Part) => a.track === b.track && Math.abs(a.start - b.start) < LEN
    const out: { p: Part; fit: number; base: number; weak: Part }[] = []
    for (let c = 0; c < this.P; c++) {
      const p = this.parts[c]
      if (set.some(m => overlaps(m, p))) continue
      let w = 9, b = 9, weak = S[0]
      for (const m of S) { const v = this.both(c, m); if (v < w) { w = v; weak = m } b = Math.min(b, this.base(c, m)) }
      out.push({ p, fit: w, base: b, weak: this.parts[weak] })
    }
    const bestOf = new Map<string, (typeof out)[number]>()
    for (const o of out.filter(o => o.base >= 0.85).sort((a, b) => b.fit - a.fit)) if (!bestOf.has(o.p.track)) bestOf.set(o.p.track, o)
    return [...bestOf.values()].slice(0, 24)
  }
}

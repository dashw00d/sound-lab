// Training (mixer.js trainPair): one transition at a time (2 bars of A, then 3 of B), rated with one key, the next
// straight after. Mostly the ones the model is least sure of (where a vote teaches the most), some it scores high (to
// catch bad joins slipping through), a few low; never one already rated. With new takes in, most pairs have one.
import { CLASH, LEN, type Judge } from '../judge'
import type { Prefs } from '../prefs'
import type { Part } from '../types'

export interface TrainPair { a: string; e: number; b: Part; j: number; t: number | null; w: number }
export interface Training { on: boolean; cur: TrainPair | null; n: number; agree: number; last: (TrainPair & { v: number }) | null }
export const freshTraining = (): Training => ({ on: false, cur: null, n: 0, agree: 0, last: null })

export function trainPair(jd: Judge, prefs: Prefs): TrainPair | null {
  const E = jd.libEntries(), byTrack: Record<string, Part[]> = {}
  E.forEach(p => (byTrack[p.track] ||= []).push(p))
  const tracks = Object.keys(byTrack), r = Math.random(), model = !!jd.lib.join_model, newOnly = prefs.cands !== 'off' && Math.random() < 0.8
  const want = model ? (r < 0.6 ? [0.4, 0.6] : r < 0.85 ? [0.7, 1.01] : [0.2, 0.4]) : (r < 0.6 ? [0.7, 0.82] : r < 0.85 ? [0.82, 1.5] : [0.6, 0.7])
  let best: TrainPair | null = null
  for (let i = 0; i < 800; i++) {
    const a = tracks[Math.floor(Math.random() * tracks.length)], ea = byTrack[a][Math.floor(Math.random() * byTrack[a].length)], e = ea.start + LEN - 1
    const b = E[Math.floor(Math.random() * E.length)]
    if (b.track === a || jd.joinVote(a, e, b)) continue
    if (newOnly && !jd.track(a)?.candidate && !jd.track(b.track)?.candidate && i < 700) continue
    const x = jd.judge(a, e, b)
    if (x.j < CLASH) continue
    const pair = { a, e, b, j: x.j, t: x.t, w: x.w }
    if (x.w >= want[0] && x.w < want[1]) return pair
    if (!best || Math.abs(x.w - want[0]) < Math.abs(best.w - want[0])) best = pair
  }
  return best
}

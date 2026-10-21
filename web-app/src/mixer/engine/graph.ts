// The music graph (2026-10-21, the designer: "we want the music to really flow in the game naturally, but at the same
// time always be unique ... go from chill to less chill in waves"). Its nodes are songs grouped in scenes (music
// families: one lead, beat and bass, amount of noise), each song with an energy (how un-chill it is); its edges inside
// a scene are the seamless cuts between members (families.json cuts: after A's bar e, B from its bar s). The walk
// plays a scene for a while, cutting from song to song, then rests a bar and moves to the next scene: the one nearest
// a target energy that rises and falls as a slow wave, never one heard lately; inside a scene, the member nearest the
// target and heard least.
import type { Families } from '../../api/types'
import { LEN, type Judge } from '../judge'

export class Graph {
  readonly F: Families
  private jd: Judge
  private lo: number
  private hi: number

  constructor(F: Families, jd: Judge) {
    this.F = F; this.jd = jd
    const e = Object.values(F.items).map(it => it.energy).filter((x): x is number => x != null).sort((a, b) => a - b)
    this.lo = e.length ? e[Math.floor(e.length * 0.1)] : -1
    this.hi = e.length ? e[Math.floor(e.length * 0.9)] : 1
  }
  energy(id: string): number { return this.F.items[id]?.energy ?? 0 }
  /** A song the walk may play: one it can hear, not a bad take, a new take only when new takes are on. */
  playable(id: string, clips: Record<string, number>): boolean {
    const it = this.F.items[id]
    if (!it?.src.calm || (clips[`ok_${id}`] || 0) < 0) return false
    const t = this.jd.track(id)
    if (t) return this.jd.active(t)
    if (!this.jd.byId.has(id)) this.jd.byId.set(id, { id, files: {}, src: it.src })  // (a trial take or an extension: its files)
    return it.kind === 'extension' || (clips[`novel_${it.set}.${it.take}`] || 0) > 0
  }
  /** The energy the walk aims at after `bars` bars: from chill (the library's 10th percentile) to less chill (90th) and
   * back, over `period` bars, starting chill. */
  target(bars: number, period: number): number {
    return this.lo + (this.hi - this.lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * bars) / period))
  }
  members(fid: string, clips: Record<string, number>): string[] {
    return (this.F.families[fid]?.members ?? []).filter(m => this.playable(m, clips))
  }
  /** The next scene: the nearest the target energy (its members' mean), a little against those heard more, never one
   * of the last `avoid`; one of the best three, so no two walks are the same. */
  pickScene(target: number, recent: string[], heard: Map<string, number>, clips: Record<string, number>): string | null {
    const fs = Object.keys(this.F.families).map(fid => ({ fid, ms: this.members(fid, clips) })).filter(x => x.ms.length)
    const fresh = fs.filter(x => !recent.includes(x.fid)), from = fresh.length ? fresh : fs
    const cost = (x: { fid: string; ms: string[] }) => {
      const e = x.ms.reduce((t, m) => t + this.energy(m), 0) / x.ms.length, h = x.ms.reduce((t, m) => t + (heard.get(m) ?? 0), 0) / x.ms.length
      return Math.abs(e - target) + 0.02 * Math.log1p(h) + 0.15 * Math.random()
    }
    const best = from.map(x => ({ x, c: cost(x) })).sort((a, b) => a.c - b.c).slice(0, 3)
    return best.length ? best[Math.floor(Math.random() * best.length)].x.fid : null
  }
  /** A member to play: one the scene hasn't played if there is one, nearest the target energy, heard least, not `not`. */
  pickMember(fid: string, target: number, heard: Map<string, number>, clips: Record<string, number>, not?: string, played: string[] = []): string | null {
    const all = this.members(fid, clips).filter(m => m !== not), fresh = all.filter(m => !played.includes(m)), ms = fresh.length ? fresh : all
    return ms.map(m => ({ m, c: Math.abs(this.energy(m) - target) + 0.05 * Math.log1p(heard.get(m) ?? 0) + 0.1 * Math.random() }))
      .sort((a, b) => a.c - b.c)[0]?.m ?? null
  }
  /** Where song `a`, just past its bar `e`, can cut seamlessly into another member of its scene: [song, its bar]. Only
   * into the other's mellow loop with a part's room before its end, so it plays on round its own loop's seam (2026-10-21:
   * the designer flagged two blocks entered at bar 11 and 15, outside their loops, that jumped back to the loop's start
   * from bars the loop never reaches: 64% of the cuts landed like that). */
  cutsAt(a: string, e: number, clips: Record<string, number>): { to: string; bar: number }[] {
    const cuts = this.F.items[a]?.cuts ?? {}
    return Object.entries(cuts).flatMap(([b, c]) => {
      if (!this.playable(b, clips)) return []
      const [lo, hi] = this.jd.cueOf(b)
      return c.at.filter(([x, s]) => x === e && s >= lo && s + LEN - 1 <= hi).map(([, s]) => ({ to: b, bar: s }))
    })
  }
}

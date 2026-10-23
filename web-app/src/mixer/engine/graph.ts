// The music graph (2026-10-21, the designer: "we want the music to really flow in the game naturally, but at the same
// time always be unique ... go from chill to less chill in waves"). Its nodes are songs grouped in scenes (music
// families: one lead, beat and bass, amount of noise), each song with an energy (how un-chill it is); its edges inside
// a scene are the seamless cuts between members (families.json cuts: after A's bar e, B from its bar s). The walk itself
// is the scene walk (scenewalk.ts, which a game gets as walk.js); this turns the lab's data into what it walks: the songs
// it may play (one it can hear, not a bad take, a new take only when new takes are on), each one's loop, entry, phrase
// and energy, the scenes' members, and the cuts that land inside the other song's loop with a part's room before its end
// (2026-10-21: the designer flagged two blocks entered at bar 11 and 15, outside their loops), but none thumbed down
// (2026-10-23: the walk had kept one, against "the walk won't take it again"). `soundlab sync` writes the
// same for a game (soundlab/sync.py manifest), from the songs it ships.
import type { Families } from '../../api/types'
import { LEN, type Judge } from '../judge'
import type { WalkData } from './scenewalk'

/** The walk's music without the cuts thumbed down (the game's manifest, as you vote while it plays). */
export function withoutDisliked(d: WalkData, clips: Record<string, number>): WalkData {
  return { ...d, cuts: Object.fromEntries(Object.entries(d.cuts).map(([a, cs]) => [a, cs.filter(c => (clips[`join_${a}@${c.after}>${c.to}|${c.start}`] || 0) >= 0)])) }
}

export class Graph {
  readonly F: Families
  private jd: Judge
  private cache: { clips: Record<string, number>; cues: unknown; data: WalkData } | null = null

  constructor(F: Families, jd: Judge) { this.F = F; this.jd = jd }
  /** A song the walk may play: one it can hear, not a bad take, a new take only when new takes are on. */
  playable(id: string, clips: Record<string, number>): boolean {
    const it = this.F.items[id]
    if (!it?.src.calm || (clips[`ok_${id}`] || 0) < 0) return false
    const t = this.jd.track(id)
    if (t) return this.jd.active(t)
    if (!this.jd.byId.has(id)) this.jd.byId.set(id, { id, files: {}, src: it.src })  // (a trial take or an extension: its files)
    return it.kind === 'extension' || (clips[`novel_${it.set}.${it.take}`] || 0) > 0
  }
  /** What the scene walk walks, as the votes stand (a vote or a cue moved: made again). */
  data(clips: Record<string, number>, cues: unknown): WalkData {
    if (this.cache && this.cache.clips === clips && this.cache.cues === cues) return this.cache.data
    const songs: WalkData['songs'] = {}, scenes: WalkData['scenes'] = {}, cuts: WalkData['cuts'] = {}
    for (const [fid, f] of Object.entries(this.F.families)) {
      const ms = f.members.filter(m => this.playable(m, clips) && this.F.items[m]?.energy != null)
      if (!ms.length) continue
      scenes[fid] = { members: ms }
      for (const m of ms) {
        const ph = this.jd.track(m)?.measure?.phrase
        songs[m] = { loop: this.jd.cueOf(m), entry: this.jd.entryOf(m), phrase: ph && ph.contrast >= 0.08 ? ph.start : null, energy: this.F.items[m].energy! }
      }
    }
    for (const a of Object.keys(songs)) {
      const out = Object.entries(this.F.items[a]?.cuts ?? {}).flatMap(([b, c]) => {
        const s = songs[b]
        return s ? c.at.filter(([after, st]) => st >= s.loop[0] && st + LEN - 1 <= s.loop[1] && (clips[`join_${a}@${after}>${b}|${st}`] || 0) >= 0)
          .map(([after, start]) => ({ to: b, after, start })) : []  // (a transition thumbed down: never taken)
      })
      if (out.length) cuts[a] = out
    }
    const data = { bars: this.jd.N, songs, scenes, cuts }
    this.cache = { clips, cues, data }
    return data
  }
}

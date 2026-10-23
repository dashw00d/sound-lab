// The music graph (2026-10-21, the designer: "we want the music to really flow in the game naturally, but at the same
// time always be unique ... go from chill to less chill in waves"). Its nodes are songs grouped in scenes (music
// families: one lead, beat and bass, amount of noise), each song with an energy (how un-chill it is); its edges inside
// a scene are the seamless cuts between members (families.json cuts: after A's bar e, B from its bar s). The walk itself
// is the scene walk (scenewalk.ts, which a game gets as walk.js); this turns the lab's data into what it walks: the songs
// it may play (one it can hear, not a bad take, a new take only when new takes are on), each one's loop, entry, phrase
// and energy, the scenes' members, and the cuts that land inside the other song's loop with a part's room before its end
// (2026-10-21: the designer flagged two blocks entered at bar 11 and 15, outside their loops), but none thumbed down
// (2026-10-23: the walk had kept one, against "the walk won't take it again"); and the ways in that aren't cuts (bridges,
// soundlab/music/bridges.py), for a scene change and for a song with no cut on. The votes are laid over it all: a song
// whose latest thumb is down isn't in it (mixer/verdict.ts), a transition thumbed down isn't either, and one thumbed up is
// marked liked (a liked transition that isn't a cut becomes a bridge). `soundlab sync` writes the same for a game
// (soundlab/sync manifest), from the songs it ships.
import type { Families } from '../../api/types'
import { LEN, type Judge } from '../judge'
import { verdict } from '../verdict'
import type { WalkBridge, WalkCut, WalkData } from './scenewalk'

/** The walk's music as the votes stand (the Mixer's graph; the game's manifest as you vote while it plays): no transition
 * thumbed down, the ones thumbed up marked liked, and a liked one that isn't a cut there as a bridge (fit 1, first). The
 * same as soundlab/music/bridges.py with_votes and the sync manifest's cuts: keep them the same. */
export function withVotes(d: WalkData, clips: Record<string, number>): WalkData {
  const v = (a: string, e: number, b: string, s: number) => clips[`join_${a}@${e}>${b}|${s}`] || 0
  const mark = <T extends WalkCut | WalkBridge>(a: string, c: T): T => { const { liked: _, ...x } = c; return (v(a, c.after, c.to, c.start) > 0 ? { ...x, liked: true } : x) as T }
  const cuts: WalkData['cuts'] = {}, isCut = new Set<string>()
  for (const [a, cs] of Object.entries(d.cuts)) {
    const keep = cs.filter(c => v(a, c.after, c.to, c.start) >= 0).map(c => mark(a, c))
    if (keep.length) cuts[a] = keep
    for (const c of keep) isCut.add(`${a}@${c.after}>${c.to}|${c.start}`)
  }
  const liked: Record<string, WalkBridge[]> = {}
  for (const [k, x] of Object.entries(clips)) {
    if (x <= 0 || !k.startsWith('join_') || !k.includes('@') || !k.includes('>') || !k.includes('|')) continue
    const a = k.slice(5, k.lastIndexOf('@')), e = +k.slice(k.lastIndexOf('@') + 1, k.indexOf('>', k.lastIndexOf('@'))), rest = k.slice(k.indexOf('>', k.lastIndexOf('@')) + 1)
    const b = rest.slice(0, rest.lastIndexOf('|')), s = +rest.slice(rest.lastIndexOf('|') + 1)
    if (d.songs[a] && d.songs[b] && a !== b) (liked[a] ??= []).push({ after: e, to: b, start: s, fit: 1 })
  }
  const bridges: Record<string, WalkBridge[]> = {}
  for (const a of Object.keys(d.songs)) {
    const seen = new Set<string>(), rows: WalkBridge[] = []
    for (const w of [...(liked[a] ?? []), ...(d.bridges?.[a] ?? [])]) {
      const key = `${a}@${w.after}>${w.to}|${w.start}`
      if (!d.songs[w.to] || v(a, w.after, w.to, w.start) < 0 || seen.has(key) || isCut.has(key)) continue
      seen.add(key); rows.push(mark(a, w))
    }
    if (rows.length) bridges[a] = rows
  }
  return { ...d, cuts, bridges }
}

export class Graph {
  readonly F: Families
  private jd: Judge
  private cache: { clips: Record<string, number>; cues: unknown; at: unknown; data: WalkData } | null = null

  constructor(F: Families, jd: Judge) { this.F = F; this.jd = jd }
  /** A song the walk may play: one it can hear, its latest thumb not down; a new take only when new takes are on, a
   * trial take only once thumbed up (an extension of one, always). */
  playable(id: string, clips: Record<string, number>, at: Record<string, string> = {}): boolean {
    const it = this.F.items[id]
    if (!it?.src.calm) return false
    const t = it.kind === 'trial' || it.kind === 'extension' ? undefined : this.jd.track(id)
    const v = verdict(id, t?.key ?? it.set, t?.take ?? it.take, clips, at)
    if (v < 0) return false
    if (it.kind === 'trial' || it.kind === 'extension') {
      if (!this.jd.byId.has(id)) this.jd.byId.set(id, { id, files: {}, src: it.src })  // (a trial take or an extension: its files)
      return it.kind === 'extension' || v > 0
    }
    return !!t && this.jd.active(t)
  }
  /** What the scene walk walks, as the votes stand (a vote or a cue moved: made again). */
  data(clips: Record<string, number>, cues: unknown, at: Record<string, string> = {}): WalkData {
    if (this.cache && this.cache.clips === clips && this.cache.cues === cues && this.cache.at === at) return this.cache.data
    const songs: WalkData['songs'] = {}, scenes: WalkData['scenes'] = {}, cuts: WalkData['cuts'] = {}, bridges: Record<string, WalkBridge[]> = {}
    for (const [fid, f] of Object.entries(this.F.families)) {
      const ms = f.members.filter(m => this.playable(m, clips, at) && this.F.items[m]?.energy != null)
      if (!ms.length) continue
      scenes[fid] = { members: ms }
      for (const m of ms) {
        const ph = this.jd.track(m)?.measure?.phrase
        songs[m] = { loop: this.jd.cueOf(m), entry: this.jd.entryOf(m), phrase: ph && ph.contrast >= 0.08 ? ph.start : null, energy: this.F.items[m].energy! }
      }
    }
    const room = (b: string, st: number) => { const s = songs[b]; return !!s && st >= s.loop[0] && st + LEN - 1 <= s.loop[1] }
    for (const a of Object.keys(songs)) {
      const out = Object.entries(this.F.items[a]?.cuts ?? {}).flatMap(([b, c]) => (songs[b] ? c.at.filter(([, st]) => room(b, st)).map(([after, start]) => ({ to: b, after, start })) : []))
      if (out.length) cuts[a] = out
      const ways = (this.F.bridges?.[a] ?? []).filter(([, b, st]) => room(b, st)).map(([after, to, start, fit]) => ({ after, to, start, fit }))
      if (ways.length) bridges[a] = ways
    }
    const data = withVotes({ bars: this.jd.N, songs, scenes, cuts, bridges }, clips)
    this.cache = { clips, cues, at, data }
    return data
  }
}

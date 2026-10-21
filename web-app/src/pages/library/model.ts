// The Library's songs: each shipped track as a row (its context, style and take; its scene and energy from the sort;
// its votes and how it's fared in the listening sessions), and what to sort and filter them by.
import type { Families, Votes } from '../../api/types'
import type { Library, StreamSession, Track } from '../../mixer/types'

export interface SongRow {
  id: string; t: Track; context: string; style: string; take: string
  scene: string | null; sceneSize: number; lead: string; energy: number | null
  mellow: number; intense: number; ratings: Record<number, number>; exits: [number, number]; entries: [number, number]
  loop: [number, number] | null; mine: boolean
}
/** "day.any.war2.k2.stack": context day, style war2, take k2. */
export function parts(id: string) {
  const p = id.split('.')
  return { context: p[0], style: p.slice(2, -2).join('.') || 'plain', take: p[p.length - 2] ?? '' }
}
export function rows(lib: Library, F: Families | null, votes: Votes, streams: Record<string, StreamSession> | null): SongRow[] {
  const ratings: Record<string, Record<number, number>> = {}
  for (const s of Object.values(streams ?? {})) for (const b of s.stream ?? []) {
    if (b.kind === 'transition' || !('stars' in b) || !b.stars || !b.track) continue
    ;(ratings[b.track] ??= {})[b.stars] = (ratings[b.track][b.stars] ?? 0) + 1
  }
  const ex: Record<string, [number, number]> = {}, en: Record<string, [number, number]> = {}
  for (const [k, v] of Object.entries(votes.clips)) {
    const m = /^join_(.+)@\d+>(.+)\|\d+$/.exec(k)
    if (!m || !v) continue
    ;(ex[m[1]] ??= [0, 0])[v > 0 ? 0 : 1]++
    ;(en[m[2]] ??= [0, 0])[v > 0 ? 0 : 1]++
  }
  return lib.tracks.filter(t => !t.candidate).map(t => {
    const it = F?.items[t.id], fam = it ? F!.families[it.family] : null, cue = votes.cues?.[t.id]?.mellow
    return {
      id: t.id, t, ...parts(t.id), scene: it?.family ?? null, sceneSize: fam?.members.length ?? 0, lead: it?.lead ?? '',
      energy: it?.energy ?? null, mellow: votes.clips[`song_${t.id}.mellow`] || 0, intense: votes.clips[`song_${t.id}.intense`] || 0,
      ratings: ratings[t.id] ?? {}, exits: ex[t.id] ?? [0, 0], entries: en[t.id] ?? [0, 0],
      loop: cue ?? t.measure?.cuts?.calm?.[0]?.bars ?? null, mine: !!cue,
    }
  })
}
export type SortKey = 'scene' | 'energy' | 'name' | 'rating'
export function sortRows(r: SongRow[], key: SortKey): SongRow[] {
  const name = (x: SongRow) => `${x.style} ${x.context} ${x.take}`
  const score = (x: SongRow) => Object.entries(x.ratings).reduce((s, [k, n]) => s + (Number(k) - 3) * n, 0) + 2 * x.mellow
  const by: Record<SortKey, (a: SongRow, b: SongRow) => number> = {
    scene: (a, b) => b.sceneSize - a.sceneSize || (a.scene ?? '').localeCompare(b.scene ?? '') || (a.energy ?? 0) - (b.energy ?? 0),
    energy: (a, b) => (a.energy ?? 0) - (b.energy ?? 0),
    name: (a, b) => name(a).localeCompare(name(b)),
    rating: (a, b) => score(b) - score(a),
  }
  return [...r].sort(by[key])
}

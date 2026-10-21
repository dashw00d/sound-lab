// The Families graph's logic, apart from React: the designer's links as edges, and what each kind of edge saves.
// Votes (families.py): link_<a>|<b> 1 they match / -1 a bad match, dup_<a>|<b> 1 near duplicates, ok_<id> 1 good /
// -1 a bad take, novel_<set>.<take> (or novel_<id>) 1 the start of a new family.
import type { Families, FamilyItem, Votes } from '../../api/types'

export type Link = 'match' | 'dup' | 'bad'
export interface LinkEdge { a: string; b: string; kind: Link }

/** Every pair the designer has linked, once each (a pair's strongest word wins: near duplicate, then match, then bad). */
export function links(votes: Votes, items: Families['items']): LinkEdge[] {
  const out = new Map<string, LinkEdge>()
  const put = (a: string, b: string, kind: Link) => {
    if (!items[a] || !items[b] || a === b) return
    const k = a < b ? `${a}|${b}` : `${b}|${a}`, had = out.get(k)
    const rank = { dup: 3, match: 2, bad: 1 }
    if (!had || rank[kind] > rank[had.kind]) out.set(k, { a, b, kind })
  }
  for (const [k, v] of Object.entries(votes.clips)) {
    const m = /^(link|dup)_(.+)\|(.+)$/.exec(k)
    if (!m || !v) continue
    put(m[2], m[3], m[1] === 'dup' ? 'dup' : v > 0 ? 'match' : 'bad')
  }
  return [...out.values()]
}

/** The votes that make a pair's link `kind` (or none): every other word about the pair cleared. */
export function linkVotes(a: string, b: string, kind: Link | null): [string, number][] {
  const both = (p: string, v: number): [string, number][] => [[`${p}_${a}|${b}`, v], [`${p}_${b}|${a}`, 0]]
  if (kind === 'match') return [...both('link', 1), ...both('dup', 0)]
  if (kind === 'dup') return [...both('dup', 1), ...both('link', 0)]
  if (kind === 'bad') return [...both('link', -1), ...both('dup', 0)]
  return [...both('link', 0), ...both('dup', 0)]
}
export const NEXT: Record<Link, Link | null> = { match: 'dup', dup: 'bad', bad: null }

export const novelKey = (id: string, it: FamilyItem) => (it.set && it.take ? `novel_${it.set}.${it.take}` : `novel_${id}`)

/** A family's colour: its number spread round the hue circle. */
export function hue(fid: string): number {
  const n = parseInt(fid.replace(/\D/g, ''), 10) || 0
  return (n * 137.508) % 360
}

/** A short name: context, style or lead, take. */
export function label(id: string, it: FamilyItem): string {
  const p = id.split('.')
  return `${p[0]} · ${it.style === 'drawn' || !it.style ? it.lead : it.style} · ${it.take ?? p[3] ?? ''}`
}

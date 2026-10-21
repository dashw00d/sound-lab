// The Families graph's logic, apart from React. Votes (families.py): link_<a>|<b> 1 they match / -1 a bad match,
// dup_<a>|<b> 1 near duplicates, ok_<id> 1 good / -1 a bad take, novel_<set>.<take> (or novel_<id>) 1 a new family.
//
// A family is one group with one root (2026-10-21, the designer: "a family needs to be a consolidated group ... they
// need to share a single root"): the sort's family (music families), with the designer's answers since applied at once,
// so any member shows the same family. Its root is the song the designer's links point to, else the sort's medoid. A
// member is confirmed when the designer linked it (to the root), else the sort's suggestion. Every action keeps the
// links a star round the root: a song joining links to the root, a song leaving takes only itself out (the rest stay
// linked), a bad match with the root keeps it out when the sort runs again.
import type { Families, FamilyItem, Votes } from '../../api/types'

export type Link = 'match' | 'dup' | 'bad'
export type EdgeKind = Link | 'suggested'
export interface GraphLink { a: string; b: string; kind: EdgeKind }
export interface Family { id: string; root: string; members: string[] }  // (the root first)
/** Votes to write: [key, 1 | -1 | 0 (cleared)], only those that change. */
export type Ops = [string, number][]
type Want = Map<string, number>

const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** The designer's own links: the groups their matches and near duplicates join (the sort's must-links), with the
 * vote changes that keep each a star. */
class Links {
  private groupOf = new Map<string, string[]>()
  private inDeg = new Map<string, number>()
  readonly dups = new Set<string>()
  readonly bads: { a: string; b: string }[] = []
  private clips: Record<string, number>

  constructor(clips: Record<string, number>, items: Families['items']) {
    this.clips = clips
    const parent = new Map<string, string>()
    const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r }
    for (const [k, v] of Object.entries(clips)) {
      const m = /^(link|dup)_(.+)\|(.+)$/.exec(k)
      if (!m || !v || !items[m[2]] || !items[m[3]] || m[2] === m[3]) continue
      const [, kind, a, b] = m
      if (v < 0) { if (kind === 'link') this.bads.push({ a, b }); continue }
      for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x)
      parent.set(find(a), find(b))
      if (kind === 'dup') this.dups.add(pair(a, b)); else this.inDeg.set(b, (this.inDeg.get(b) ?? 0) + 1)
    }
    const by = new Map<string, string[]>()
    for (const x of parent.keys()) by.set(find(x), [...(by.get(find(x)) ?? []), x])
    for (const g of by.values()) g.forEach(x => this.groupOf.set(x, g))
  }
  group(x: string): string[] | null { return this.groupOf.get(x) ?? null }
  linkedTo(x: string): number { return this.inDeg.get(x) ?? 0 }
  bad(a: string, b: string) { return (this.clips[`link_${a}|${b}`] ?? 0) < 0 || (this.clips[`link_${b}|${a}`] ?? 0) < 0 }
  /** The songs linked as a star round `root`: each to the root, no other match between them, no bad match. */
  star(want: Want, ms: string[], root: string) {
    for (const x of ms) for (const y of ms) {
      if (x === y) continue
      if (y === root) { want.set(`link_${x}|${y}`, 1); want.set(`link_${y}|${x}`, 0) }
      else if (x !== root) want.set(`link_${x}|${y}`, 0)
    }
  }
  /** The songs given leave their groups; what stays of each group stays one star (round its root, or the most linked
   * to of the rest when the root left). */
  leave(want: Want, xs: string[]) {
    const out = new Set(xs)
    for (const g of new Set(xs.map(x => this.group(x)).filter((g): g is string[] => !!g))) {
      for (const x of g.filter(m => out.has(m))) for (const y of g) if (x !== y)
        for (const k of [`link_${x}|${y}`, `link_${y}|${x}`, `dup_${x}|${y}`, `dup_${y}|${x}`]) want.set(k, 0)
      const rest = g.filter(m => !out.has(m))
      if (rest.length > 1) {
        const root = [...g].sort((a, b) => this.linkedTo(b) - this.linkedTo(a))[0]
        this.star(want, rest, out.has(root) ? [...rest].sort((a, b) => this.linkedTo(b) - this.linkedTo(a) || a.localeCompare(b))[0] : root)
      }
    }
  }
}

export class FamilyView {
  private famOf = new Map<string, string>()
  private fams = new Map<string, Family>()
  private L: Links
  private clips: Record<string, number>

  constructor(F: Families, votes: Votes) {
    this.clips = votes.clips
    const L = (this.L = new Links(votes.clips, F.items))
    for (const [id, it] of Object.entries(F.items)) this.famOf.set(id, it.family)
    // (the designer's groups: each whole, in the family of the song its links point to)
    for (const id of Object.keys(F.items)) {
      const g = L.group(id)
      if (g && id === [...g].sort((a, b) => L.linkedTo(b) - L.linkedTo(a) || a.localeCompare(b))[0]) g.forEach(m => this.famOf.set(m, this.famOf.get(id)!))
    }
    // (a bad match within one family: the song named first, unless it's linked in, is out until the sort places it)
    for (const { a, b } of L.bads) if (this.famOf.get(a) === this.famOf.get(b) && !L.group(a)) this.famOf.set(a, `solo:${a}`)
    const by = new Map<string, string[]>()
    for (const [id, f] of this.famOf) by.set(f, [...(by.get(f) ?? []), id])
    for (const [f, ms] of by) {
      const top = [...ms].sort((a, b) => L.linkedTo(b) - L.linkedTo(a))[0], medoid = F.families[f]?.medoid
      const root = L.linkedTo(top) > 0 ? top : medoid && ms.includes(medoid) ? medoid : ms[0]
      const name = (x: string) => label(x, F.items[x])
      const rest = ms.filter(x => x !== root).sort((a, b) => Number(!!L.group(b)) - Number(!!L.group(a)) || name(a).localeCompare(name(b)))
      this.fams.set(f, { id: f, root, members: [root, ...rest] })
    }
  }
  family(id: string): Family { return this.fams.get(this.famOf.get(id)!)! }
  get(fid: string): Family | undefined { return this.fams.get(fid) }
  families(): Family[] { return [...this.fams.values()].sort((a, b) => b.members.length - a.members.length) }
  rootOf(id: string) { return this.family(id).root }
  /** Linked in by the designer (else the sort's suggestion). */
  confirmed(id: string) { return !!this.L.group(id) }
  /** What the designer has said about two songs: one family (near duplicates or not), a bad match, or nothing yet. */
  relation(a: string, b: string): Link | null {
    const g = this.L.group(a)
    if (g && g.includes(b)) return this.L.dups.has(pair(a, b)) ? 'dup' : 'match'
    return this.L.bad(a, b) ? 'bad' : null
  }
  /** The graph's links: each member to its family's root (the designer's match or near duplicate, else the sort's
   * suggestion), near duplicates between other members, and bad matches. */
  edges(): GraphLink[] {
    const out: GraphLink[] = []
    for (const f of this.fams.values()) for (const m of f.members.slice(1)) out.push({ a: m, b: f.root, kind: this.relation(m, f.root) === 'dup' ? 'dup' : this.relation(m, f.root) ? 'match' : 'suggested' })
    for (const k of this.L.dups) { const [a, b] = k.split('|'); if (a !== this.rootOf(a) && b !== this.rootOf(b)) out.push({ a, b, kind: 'dup' }) }
    for (const { a, b } of this.L.bads) out.push({ a, b, kind: 'bad' })
    return out
  }

  // ---- the votes each answer writes (only those that change)
  private diff(want: Want): Ops { return [...want].filter(([k, v]) => (this.clips[k] ?? 0) !== v) }
  private into(want: Want, xs: string[], root: string) {
    this.L.leave(want, xs.filter(x => x !== root))
    for (const x of xs) if (x !== root) for (const [k, v] of [[`link_${x}|${root}`, 1], [`link_${root}|${x}`, 0]] as const) want.set(k, v)
  }
  /** `x` joins `y`'s family (linked to its root); as a near duplicate of `y`, with `dup`. */
  join(x: string, y: string, dup = false): Ops {
    const want: Want = new Map()
    this.into(want, [x], this.rootOf(y))
    if (x !== y) { want.set(`dup_${x}|${y}`, dup ? 1 : 0); want.set(`dup_${y}|${x}`, 0) }
    return this.diff(want)
  }
  /** Every member of `x`'s family confirmed: linked to the root. */
  confirmAll(x: string): Ops {
    const f = this.family(x), want: Want = new Map()
    for (const m of f.members.slice(1)) if (!this.relation(m, f.root)) { want.set(`link_${m}|${f.root}`, 1); want.set(`link_${f.root}|${m}`, 0) }
    return this.diff(want)
  }
  /** The songs given, one family: the family most of them are in (its root), else the first song's. */
  merge(ids: string[]): Ops {
    if (ids.length < 2) return []
    const n = new Map<string, number>()
    ids.forEach(id => n.set(this.famOf.get(id)!, (n.get(this.famOf.get(id)!) ?? 0) + 1))
    const best = [...n].sort((a, b) => b[1] - a[1] || this.fams.get(b[0])!.members.length - this.fams.get(a[0])!.members.length)[0]
    const want: Want = new Map()
    this.into(want, ids, best[1] > 1 ? this.fams.get(best[0])!.root : ids[0])
    return this.diff(want)
  }
  /** `x` out of its family, for good: a bad match with the root (the root leaving: with the next root). */
  out(x: string): Ops {
    const f = this.family(x), others = f.members.filter(m => m !== x)
    if (!others.length) return []
    const root = x === f.root ? [...others].sort((a, b) => this.L.linkedTo(b) - this.L.linkedTo(a))[0] : f.root, want: Want = new Map()
    this.L.leave(want, [x])
    want.set(`link_${x}|${root}`, -1); want.set(`link_${root}|${x}`, 0)
    return this.diff(want)
  }
  /** `x`'s links gone: back to the sort's suggestion. */
  unlink(x: string): Ops {
    const want: Want = new Map()
    this.L.leave(want, [x])
    return this.diff(want)
  }
  /** What the designer says about x against y: x joins y's family (as a near duplicate of y, or not), is a bad match
   * for it (out of it, if it's in it), or nothing (a bad match cleared; else x's links undone). */
  set(x: string, y: string, kind: Link | null): Ops {
    if (kind === 'match' || kind === 'dup') return this.join(x, y, kind === 'dup')
    if (kind === 'bad') {
      if (this.famOf.get(x) === this.famOf.get(y)) return this.out(x)
      const want: Want = new Map([[`link_${x}|${y}`, -1], [`link_${y}|${x}`, 0]])
      return this.diff(want)
    }
    if (this.L.bad(x, y)) return this.diff(new Map([[`link_${x}|${y}`, 0], [`link_${y}|${x}`, 0]]))
    return this.unlink(x)
  }
}
/** What a click on a link makes it: the sort's suggestion confirmed, a match a near duplicate, a near duplicate a bad
 * match (out of the family), a bad match nothing. */
export const NEXT: Record<EdgeKind, Link | null> = { suggested: 'match', match: 'dup', dup: 'bad', bad: null }

export const novelKey = (id: string, it: FamilyItem) => (it.set && it.take ? `novel_${it.set}.${it.take}` : `novel_${id}`)

/** A family's colour: its number spread round the hue circle (a song out on its own: grey, -1). */
export function hue(fid: string): number {
  if (fid.startsWith('solo:')) return -1
  const n = parseInt(fid.replace(/\D/g, ''), 10) || 0
  return (n * 137.508) % 360
}
export const colour = (h: number, l = 62) => (h < 0 ? `hsl(0 0% ${l - 10}%)` : `hsl(${h} 70% ${l}%)`)

/** A short name: context, style or lead, take. */
export function label(id: string, it: FamilyItem): string {
  const p = id.split('.')
  return `${p[0]} · ${it.style === 'drawn' || !it.style ? it.lead : it.style} · ${it.take ?? p[3] ?? ''}`
}

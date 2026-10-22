// The library as the walk reads it, and how it judges a transition (mixer.js, ported as is): the join score (bar
// fingerprints either side of the cut, less a loudness step), the taste model (the designer's transition votes fit by
// `music joins --fit`; the same features as music.py join_features: keep the two the same), levels (even levels and
// matching), cues, entries and siblings.
import type { Votes } from '../api/types'
import { beatsOf } from './buffers'
import { db, med } from './curves'
import type { Prefs } from './prefs'
import type { Chunk, Level, Library, Part, Track } from './types'

export const LEN = 4, XF = 0.04, STEP = 0.785, OK = 0.7, WEAK = 0.75, CLASH = 0.6, CAND_TOP = 50

export const pkey = (p: Part) => `${p.track}|${p.start}`
export const joinKey = (a: string, e: number, p: Part) => `join_${a}@${e}>${pkey(p)}`  // (votes.json: a thumb on a transition)
export const name = (t: Track) => (t.key ? `${t.key.replace(/~/g, ' · ')} · ${t.take}` : t.id)
export const grade = (v: number | null) => (v == null ? '' : v >= STEP ? 'good' : v >= OK ? 'fair' : 'poor')

export interface Judged { p: Part; j: number; t: number | null; v: number; ok: boolean; w: number }

export class Judge {
  readonly byId: Map<string, Track>
  private recs: Record<string, number> | null = null
  private recsAt = -1
  private refLevel: Partial<Record<Level, number | null>> | null = null
  readonly lib: Library
  readonly prefs: () => Prefs
  readonly votes: () => Votes

  constructor(lib: Library, prefs: () => Prefs, votes: () => Votes) {
    this.lib = lib; this.prefs = prefs; this.votes = votes
    this.byId = new Map(lib.tracks.map(t => [t.id, t]))
  }
  track = (id: string | undefined) => (id ? this.byId.get(id) : undefined)
  get N() { return this.lib.bars }
  beatS = () => 60 / this.lib.bpm
  barS = () => this.beatS() * this.lib.bar_beats
  label(p: Part) { const t = this.track(p.track); return `${t ? name(t) : p.track} · bars ${p.start}–${p.start + LEN - 1}` }
  /** New takes (music candidates) join the walk when asked: the best 50 or all of them. */
  active = (t: Track) => !t.candidate || this.prefs().cands === 'all' || (this.prefs().cands === 'top' && t.candidate.rank <= CAND_TOP)
  joinVote = (a: string, e: number, p: Part) => this.votes().clips[joinKey(a, e, p)] || 0

  cueOf(tid: string): [number, number] {
    const c = this.votes().cues?.[tid]?.mellow
    if (c) return c
    const g = this.track(tid)?.measure?.cuts?.calm?.[0]?.bars
    return g ?? [1, this.N]
  }
  /** Where a song is entered on its own (a page playing it, a queue): the first phrase start inside its mellow cues. */
  entryOf(tid: string): number {
    const [lo, hi] = this.cueOf(tid), ph = this.track(tid)?.measure?.phrase
    if (!ph || ph.contrast < 0.08) return lo
    for (let b = lo; b <= hi; b++) if ((((b - ph.start) % LEN) + LEN) % LEN === 0) return b
    return lo
  }
  loopFor(tid: string, entry: number): [number, number] {
    const [ms, me] = this.cueOf(tid)
    return [Math.min(ms, entry), Math.min(this.N, Math.max(me, entry + LEN - 1))]
  }
  /** Song a's bar e, then song b from its bar s. */
  jBar(a: string, e: number, b: string, s: number): number {
    const A = this.track(a)?.measure, B = this.track(b)?.measure
    if (!A?.feat || !B?.feat) return -1
    const n = this.N, at = <T,>(f: T[], k: number) => f[(((k - 1) % n) + n) % n]
    const dot = (x: number[], y: number[]) => { let v = 0; for (let i = 0; i < x.length; i++) v += x[i] * y[i]; return v }
    const ba = A.beats?.calm, bb = B.beats?.calm
    const loud = ba && bb ? 0.03 * Math.max(0, Math.abs(bb[((s - 1) * 4) % bb.length] - ba[((e - 1) * 4 + 3) % ba.length]) - 2)
      : 0.02 * Math.max(0, Math.abs(at(B.loud.calm, s) - at(A.loud.calm, e)) - 3)
    return 0.5 * (dot(at(A.feat, e + 1), at(B.feat, s)) + dot(at(A.feat, e), at(B.feat, s - 1))) - loud
  }
  /** Each song's record in the transition votes (music.py song_record), recounted when the votes change. */
  records(): Record<string, number> {
    const clips = this.votes().clips, keys = Object.keys(clips).filter(k => k.startsWith('join_'))
    if (this.recs && this.recsAt === keys.length) return this.recs
    const n: Record<string, [number, number]> = {}
    for (const k of keys) {
      const v = clips[k], a = k.slice(5, k.lastIndexOf('@')), b = k.slice(k.indexOf('>') + 1, k.lastIndexOf('|'))
      for (const t of new Set([a, b])) (n[t] ||= [0, 0])[v > 0 ? 0 : 1]++
    }
    this.recs = Object.fromEntries(Object.entries(n).map(([t, [g, b]]) => [t, (g - b) / (g + b + 3)]))
    this.recsAt = keys.length
    return this.recs
  }
  /** The chance the designer likes song a's bar e into part p (null without a model). */
  taste(a: string, e: number, p: Part): number | null {
    const M = this.lib.join_model, A = this.track(a)?.measure, B = this.track(p.track)?.measure
    if (!M || !A?.beats || !A.onset || !B?.onset || !B.phrase) return null
    const ba = A.beats.calm, n = ba.length, ia = [0, 1, 2, 3].map(k => ((e - 1) * 4 + k) % n), s = p.start
    const f: Record<string, number> = {
      level_a: ia.reduce((t, i) => t + ba[i], 0) / 4 - med(ba),
      entry_phrase: ((((s - B.phrase.start) % 4) + 4) % 4) === 0 ? 1 : 0,
      attack_b: Math.log(B.onset.attack[((s - 1) * 4) % B.onset.attack.length] / med(B.onset.busy)),
      held_a: Math.log(A.onset.busy[ia[3]] / (A.onset.attack[(e * 4) % A.onset.attack.length] + 1e-6)),
      rec_a: this.records()[a] || 0, rec_b: this.records()[p.track] || 0,
    }
    let z = M.w[0]
    M.features.forEach((k, i) => { z += M.w[i + 1] * (f[k] - M.mu[i]) / M.sd[i] })
    return 1 / (1 + Math.exp(-z))
  }
  /** The walk's chance (taste, else the join score), the join score, the designer's vote. */
  judge(a: string, e: number, p: Part): Judged {
    const j = this.jBar(a, e, p.track, p.start), t = this.taste(a, e, p), v = this.joinVote(a, e, p)
    return { p, j, t, v, ok: v > 0 || (v >= 0 && j >= CLASH && (t != null ? t >= 0.5 : j >= WEAK)), w: t != null ? t : j }
  }
  /** Siblings: the same piece made for other contexts, in step (music trims' families). */
  family(tid: string): string[] {
    const t = this.track(tid), lv = this.prefs().intense
    return t?.family ? t.family.members.filter(m => { const x = this.track(m); return m !== tid && !!x?.measure?.feat && !!x.files.calm && !!x.files[lv] }) : []
  }
  /** Everything: each song's phrase starts inside its mellow cues (mellows thumbed down left out). */
  libEntries(): Part[] {
    const out: Part[] = [], clips = this.votes().clips, lv = this.prefs().intense
    for (const t of this.lib.tracks) {
      const m = t.measure
      if (!m?.feat || !this.active(t) || !t.files.calm || !t.files[lv] || (clips[`song_${t.id}.mellow`] || 0) < 0) continue
      const [lo, hi] = this.cueOf(t.id), ph = m.phrase, s0 = ph && ph.contrast >= 0.08 ? ph.start : lo, starts: number[] = []
      for (let b = lo; b + LEN - 1 <= hi; b++) if ((((b - s0) % LEN) + LEN) % LEN === 0) starts.push(b)
      ;(starts.length ? starts : [lo]).forEach(b => out.push({ track: t.id, start: b }))
    }
    return out
  }
  /** A song's level as a URL (a take without that level: its calm). */
  url(tid: string | undefined, level: string): string | null {
    const t = this.track(tid)
    if (!t) return null
    return t.src?.[level] ?? (t.files[level] ? '/shipped/' + t.files[level] : t.src?.calm ?? (t.files.calm ? '/shipped/' + t.files.calm : null))
  }
  glueOf(id: string | undefined): string | null {
    const t = this.track(id)
    return t?.glue && this.lib.glues?.[t.glue] ? t.glue : null
  }
  glueName(gid: string) { const t = this.track(gid); return t ? name(t) : gid }

  // ---- levels
  /** Even levels: a song's own trim toward the library's typical level (the median of the shipped songs' median
   * beats), within 6 dB. Songs are mastered to one LUFS, but a sparse one sits far under its peaks (2026-10-21). */
  private levelOf(tid: string, st: Level): number | null {
    const b = this.beatsOf(tid, st === 'mellow' ? 'calm' : 'battle')
    return b?.length ? med(b) : null
  }
  /** A song's loudness per beat at a level: music trims' measure, else what the player measured from its file. */
  beatsOf(tid: string | undefined, lv: 'calm' | 'battle'): number[] | null {
    const b = this.track(tid)?.measure?.beats?.[lv]
    return b?.length ? b : beatsOf(this.url(tid, lv))
  }
  trimDb(tid: string | undefined, st: Level): number {
    if (!this.prefs().even || !tid) return 0
    if (!this.refLevel) {
      const of = (s: Level) => { const v = this.lib.tracks.filter(t => !t.candidate).map(t => this.levelOf(t.id, s)).filter((x): x is number => x != null); return v.length ? med(v) : null }
      this.refLevel = { mellow: of('mellow'), intense: of('intense') }
    }
    const v = this.levelOf(tid, st), ref = this.refLevel[st]
    return v == null || ref == null ? 0 : Math.max(-6, Math.min(6, ref - v))
  }
  /** The run's gain where it comes in: its first beat at the level of the song going out's last. */
  matchGain(prev: Chunk, c: Chunk, st: Level): number {
    const lv = st === 'mellow' ? 'calm' : 'battle', a = this.beatsOf(prev.track, lv), b = this.beatsOf(c.track, lv)
    const tB = this.trimDb(c.track, st)
    if (!a || !b || prev.kind !== 'part') return db(tB)
    const tA = this.trimDb(prev.run?.entry ? prev.run.entry.track : prev.track, st)  // (the gain the song going out was playing at)
    const last = a[(((prev.bar + prev.bars - 1) - 1) * 4 + 3) % a.length] + tA, first = b[((c.bar - 1) * 4) % b.length]
    return db(Math.max(tB - 6, Math.min(tB + 6, last - first)))
  }
  /** A gain per beat of a fill: 100% to the beats either side at its edges, 70% inside, within 6 dB. */
  fillLevels(c: Chunk): number[] | null {
    const bt = this.beatsOf(c.track, 'calm'), f = c.fillBeats
    if (!bt || !f?.length || c.hi == null) return null
    const before = bt[((c.hi - 1) * 4 + 3) % bt.length], after = bt[((c.bar - 1) * 4) % bt.length]
    return f.map((v, k) => { const target = before + (after - before) * (k + 0.5) / f.length, edge = k === 0 || k === f.length - 1 ? 1 : 0.7
      return db(Math.max(-6, Math.min(6, edge * (target - v)))) })
  }
}

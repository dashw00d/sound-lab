// The listening stream (mixer.js record, saveStream): what a walk played, block by block in order, with the designer's
// stars on each block and thumbs on each transition, saved as data/streams.json (POST /api/stream). Blind: the lane
// shows no names or scores. A thumb on a transition between two songs is also a vote the walk and the taste model use.
import { toast } from '../../shell/toast'
import { vote } from '../../state/votes'
import { joinKey } from '../judge'
import type { Prefs } from '../prefs'
import type { Block, Chunk, Level, StreamBlock, StreamChunk, StreamEntry } from '../types'

/** The designer's scale (2026-10-21): what each star means, as they rate. */
export const STARS: Record<number, string> = {
  5: '5: sounds good and is completely unique', 4: '4: sounds good, but common in the library',
  3: '3: sounds okay; only to sandwich two better tracks', 2: '2: broken or scuffed: potential, but unusable', 1: '1: avoid anything similar',
}
export const blockKey = (b: Block) => `${b.kind}#${b.chunks[0].bid}`  // (set when planned: a block keeps it as its first chunks are forgotten)
const chunkKey = (c: Chunk) => `${(c.kind === 'part' || c.kind === 'fill') && c.run ? 'part' : c.kind}#${c.bid}`

interface Seen { T: number; bars: number; kind: Chunk['kind']; track?: string; bar: number; variant?: string; fill?: string; hi?: number }
interface Rec { T: number; seen: Map<string, Seen>; what: StreamBlock; join: string | null }

export class Session {
  readonly id = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ')
  readonly rec = new Map<string, Rec>()
  readonly stars = new Map<string, number>()
  readonly likes = new Map<string, number>()
  private saving = 0
  private prefs: () => Prefs
  constructor(prefs: () => Prefs) { this.prefs = prefs }

  /** Takes in a block once it has started: what it was, and the transition into the next. */
  record(b: Block, nb: Block | undefined, state: Level) {
    const id = blockKey(b), had = this.rec.get(id)
    const seen = had?.seen ?? new Map<string, Seen>()  // (each chunk once: time -> what it was)
    b.chunks.forEach(c => { if (!c.replay) seen.set(c.T!.toFixed(3), { T: c.T!, bars: c.bars, kind: c.kind, track: c.track, bar: c.bar, variant: c.variant, fill: c.fill, hi: c.hi }) })
    let what: StreamBlock
    if (b.kind === 'glue') what = { kind: 'glue', glue: b.glue, bars: b.bars }
    else if (b.kind === 'rest') what = { kind: 'rest', bars: b.bars }
    else if (b.kind === 'fill') what = { kind: 'fill', track: b.track, fill: b.chunks[0].fill, bars: b.bars }
    else {
      const cs = [...seen.values()].sort((x, y) => x.T - y.T), start = Array.isArray(had?.what.bars) ? had.what.bars[0] : b.bar
      what = { kind: 'part', track: b.track, bars: [start, b.last], variants: [...new Set([...(had?.what.variants ?? []), ...b.vars])],
        // (its chunks in order, so a 2-star block can be played again exactly: the review)
        chunks: cs.map((c): StreamChunk => c.kind === 'fill' ? { kind: 'fill', track: c.track!, bar: c.bar, bars: c.bars, fill: c.fill, hi: c.hi }
          : { kind: 'part', track: c.track!, bar: c.bar, bars: c.bars, variant: c.variant || 'full' }),
        played: cs.reduce((x, c) => x + c.bars, 0) }
      const fills = cs.filter(c => c.kind === 'fill').map(c => c.fill!), sibs = [...new Set(cs.filter(c => c.kind === 'part' && c.track !== b.track).map(c => c.track!))]
      if (fills.length) what.fills = fills
      if (sibs.length) what.siblings = sibs
    }
    what.state = had?.what.state ?? state
    const out = [...b.chunks].reverse().find(c => c.kind === 'part')  // (the chunk it left from: after a swap, a sibling)
    const join = nb && b.kind === 'part' && out && nb.kind === 'part' && nb.run !== b.run && nb.run?.entry ? joinKey(out.track!, out.bar + out.bars - 1, nb.run.entry) : null
    this.rec.set(id, { T: had ? had.T : b.T, seen, what, join: join ?? had?.join ?? null })
  }
  /** The blocks so far, in the order they played; `playing` lit. */
  list(playing: Chunk | null) {
    const cur = playing?.bid != null ? chunkKey(playing) : null
    return [...this.rec.entries()].sort((a, b) => a[1].T - b[1].T).map(([id, r]) => ({ id, kind: r.what.kind, cur: id === cur }))
  }
  /** Stars on a block (the same star again clears them). */
  star(id: string, n: number) {
    if (this.stars.get(id) === n) this.stars.delete(id); else this.stars.set(id, n)
    this.save()
  }
  /** A thumb on the transition after a block (the same again clears it). */
  async like(id: string, v: number) {
    const now = (this.likes.get(id) || 0) === v ? 0 : v, r = this.rec.get(id)
    if (now) this.likes.set(id, now); else this.likes.delete(id)
    this.save()
    if (r?.join) {
      await vote(r.join, now)
      toast(now > 0 ? 'Good transition' : now < 0 ? "Bad transition: the walk won't take it again" : 'Cleared', now < 0 ? 'down' : now ? 'up' : 'x')
    }
  }
  private save() {  // (debounced: a burst of clicks is one write)
    clearTimeout(this.saving)
    this.saving = window.setTimeout(async () => {
      const P = this.prefs(), recs = [...this.rec.entries()].sort((a, b) => a[1].T - b[1].T), stream: StreamEntry[] = []
      recs.forEach(([id, r], i) => {
        stream.push({ ...r.what, stars: this.stars.get(id) || null })
        if (i < recs.length - 1) stream.push({ kind: 'transition', like: this.likes.get(id) || null, ...(r.join ? { join: r.join } : {}) })
      })
      const settings = { stay: P.stay, joins: P.joins, match: P.match, even: P.even, bassSwap: P.bassSwap, glue: P.glue, glueKind: P.glueKind,
                         glueBars: P.glueBars, bed: P.bed, intense: P.intense, strict: P.strict, scope: P.scope, cands: P.cands, vary: P.vary }
      try { await fetch('/api/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: this.id, settings, stream }) }) }
      catch { toast("Couldn't save the ratings", 'x') }
    }, 400)
  }
}

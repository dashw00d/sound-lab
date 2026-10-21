// The review of low-rated blocks (mixer.js; 2026-10-21, the designer: "maybe we need a 2 star mix review"): the blocks
// rated 1 or 2 stars, played again as they played (when their chunks were recorded) or piece by piece (the song full,
// each variation, sibling and fill it had), so the designer can mark the piece that spoiled it (data/reviews.json).
// Not blind: it's diagnosis.
import { name, type Judge } from '../judge'
import type { Chunk, Piece, ReviewItem, ReviewMark, Run, StreamBlock, StreamChunk, StreamSession } from '../types'

export const VARIANT: Record<string, string> = { full: '', nodrums: 'drums out', sparse: 'sparse', pulse: '+ pulse' }

export const shortName = (jd: Judge, id: string) => { const t = jd.track(id); return t ? name(t) : String(id).replace(/\.any|\.stack/g, '') }
export const pieceLabel = (jd: Judge, c: Partial<StreamChunk> & { kind: string }) =>
  c.kind === 'fill' ? `fill · ${shortName(jd, c.track!)}`
    : `${shortName(jd, c.track!)} · bars ${c.bar}–${c.bar! + c.bars! - 1}${c.variant && c.variant !== 'full' ? ' · ' + VARIANT[c.variant] : ''}`

/** Every 1- or 2-star part block in the saved sessions, newest first, with the marks already on it. */
export async function loadReview(jd: Judge): Promise<ReviewItem[]> {
  const r: { streams: Record<string, StreamSession>; reviews: ReviewMark[] } = await (await fetch('/api/streams')).json()
  const items: ReviewItem[] = []
  for (const [sid, v] of Object.entries(r.streams ?? {})) {
    let n = -1
    for (const x of v.stream ?? []) {
      if (x.kind === 'transition') continue
      n++
      const w = x as StreamBlock
      if (w.kind === 'part' && w.stars && w.stars <= 2 && w.track && jd.track(w.track) && Array.isArray(w.bars))
        items.push({ sid, block: n, w: w as ReviewItem['w'], marked: (r.reviews ?? []).filter(m => m.stream === sid && m.block === n).map(m => ({ label: m.piece.label, note: m.note })) })
    }
  }
  return items.reverse()
}

/** A block's pieces: the song full, each variation, each sibling, each fill (with 2 bars before and 1 after). */
export function piecesOf(jd: Judge, w: ReviewItem['w']): Piece[] {
  const a = w.bars[0], mk = (t: string, bar: number, bars: number, variant: string): Chunk => ({ kind: 'part', track: t, bar, bars, variant })
  const out: Piece[] = [{ label: `${shortName(jd, w.track)} · full`, desc: { kind: 'part', track: w.track, bar: a, bars: 4, variant: 'full' }, chunks: [mk(w.track, a, 4, 'full')] }]
  for (const v of w.variants ?? []) out.push({ label: `${shortName(jd, w.track)} · ${VARIANT[v]}`, desc: { kind: 'part', track: w.track, bar: a, bars: 4, variant: v }, chunks: [mk(w.track, a, 4, v)] })
  for (const sb of w.siblings ?? []) out.push({ label: `sibling · ${shortName(jd, sb)}`, desc: { kind: 'part', track: sb, bar: a, bars: 4, variant: 'full' }, chunks: [mk(sb, a, 4, 'full')] })
  for (const f of w.fills ?? []) {
    const owner = w.chunks?.find(c => c.kind === 'fill' && c.fill === f)?.track ?? (/fills\/([^/]+)\//.exec(f) ?? [])[1] ?? w.track
    const m = /(\d+)-(\d+)\.\d+\.ogg$/.exec(f), ms = m ? +m[1] : a, me = m ? +m[2] : a + 7
    out.push({ label: `fill · ${shortName(jd, owner)} (bar ${me} → ${ms})`, desc: { kind: 'fill', track: owner, fill: f },
               chunks: [mk(owner, me - 1, 2, 'full'), { kind: 'fill', track: owner, bar: ms, bars: 1, fill: f, hi: me }, mk(owner, ms, 1, 'full')] })
  }
  return out
}
/** Pieces as the script the player plays: a run per group, its chunks joined as within a run; each tagged `rev`. */
export function toScript(jd: Judge, groups: Chunk[][]): Chunk[] {
  const beatsOf = (t: string, f: string) => { for (const v of Object.values(jd.track(t)?.fills ?? {})) for (const x of v) if (x.file === f) return x.beats ?? null; return null }
  return groups.flatMap(g => {
    const entry = { track: g[0].track!, start: g[0].bar }, run: Run = { entry, track: entry.track }
    return g.map((c, j): Chunk => ({ ...c, variant: c.variant || 'full', fillBeats: c.kind === 'fill' ? beatsOf(c.track!, c.fill!) : undefined, run, entry, first: j === 0 }))
  })
}
/** The two ways to hear a block: exactly as it played, or piece by piece. */
export function reviewScript(jd: Judge, it: ReviewItem, mode: 'exact' | 'pieces'): { pieces: Piece[]; script: Chunk[] } {
  if (mode === 'exact') {
    const chunks = (it.w.chunks ?? []).map((c, k): Chunk => ({ ...c, rev: k }))
    return { pieces: chunks.map(c => ({ label: pieceLabel(jd, c as StreamChunk), desc: c as StreamChunk, chunks: [c] })), script: toScript(jd, [chunks]) }
  }
  const pieces = piecesOf(jd, it.w)
  return { pieces, script: toScript(jd, pieces.map((p, k) => p.chunks.map(c => ({ ...c, rev: k })))) }
}

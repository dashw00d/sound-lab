// The review of low-rated blocks: each 1- or 2-star block, played as it played or piece by piece; W (or "That one")
// marks the piece playing as what spoiled it (data/reviews.json). Not blind: it's for finding what broke.
import type { Mixer } from '../../mixer/engine/mixer'
import { pieceLabel, piecesOf, shortName, VARIANT } from '../../mixer/engine/review'
import type { StreamChunk } from '../../mixer/types'
import { Icon } from '../../shell/Icon'
import { useSnapshot } from '../../player/hooks'

export function ReviewCard({ m, note, setNote }: { m: Mixer; note: Record<number, string>; setNote: (n: Record<number, string>) => void }) {
  const snap = useSnapshot(m), items = m.review.items, cur = m.review.cur
  if (!items) return <section className="card mx-review"><div className="dim">Reading your sessions…</div></section>
  if (!items.length) return <section className="card mx-review"><div className="dim">No blocks rated 1 or 2 stars yet.</div></section>
  const lit = (i: number, mode: string, k: number) => cur?.i === i && cur.mode === mode && snap.rev === k
  return (
    <section className="card mx-review">
      <div className="rvhead"><b>Low-rated blocks</b><span className="dim">Play one, and press <kbd>W</kbd> (or “That one”) when the piece that spoiled it plays.</span></div>
      {items.map((it, i) => {
        const w = it.w, on = cur?.i === i
        return (
          <div key={`${it.sid}#${it.block}`} className={`rvitem ${on ? 'on' : ''}`}>
            <div className="rvh">
              <b className="rvs">{'★'.repeat(w.stars ?? 0)}</b> {shortName(m.jd, w.track)}
              <small>{it.sid} · {w.played ?? '?'} bars{w.variants?.length ? ` · ${w.variants.map(v => VARIANT[v]).join(', ')}` : ''}
                {w.fills ? ` · ${w.fills.length} fill${w.fills.length > 1 ? 's' : ''}` : ''}{w.siblings ? ' · sibling' : ''}</small>
              {it.marked.length > 0 && <span className="rvm"><Icon name="check" />marked: {it.marked.map(x => x.label).join('; ')}</span>}
            </div>
            {w.chunks && <div className="rvrow"><span className="lbl">as it played</span>{w.chunks.map((c, k) => <span key={k} className={`rvc ${lit(i, 'exact', k) ? 'now' : ''}`}>{pieceLabel(m.jd, c as StreamChunk)}</span>)}</div>}
            <div className="rvrow"><span className="lbl">pieces</span>{piecesOf(m.jd, w).map((p, k) => <span key={k} className={`rvc ${lit(i, 'pieces', k) ? 'now' : ''}`}>{p.label}</span>)}</div>
            <div className="row">
              <button className="btn" disabled={!w.chunks} title={w.chunks ? undefined : 'Rated before blocks kept their chunks: play it piece by piece'} onClick={() => void m.reviewPlay(i, 'exact')}><Icon name="play" />As it played</button>
              <button className="btn" onClick={() => void m.reviewPlay(i, 'pieces')}><Icon name="play" />Piece by piece</button>
              <button className="btn primary" disabled={!on || !snap.playing} onClick={() => void m.reviewMark(note[i] ?? '')}><Icon name="flag" />That one<kbd>W</kbd></button>
              <input className="rvnote" placeholder="what was off (optional)" value={note[i] ?? ''} onChange={e => setNote({ ...note, [i]: e.target.value })} />
            </div>
          </div>
        )
      })}
    </section>
  )
}

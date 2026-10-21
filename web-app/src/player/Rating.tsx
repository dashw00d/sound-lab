// Rating as it plays, blind (2026-10-21): each block (a song's visit, a glue, a rest) shows only its stars, and between
// blocks a thumb for the transition. The lane: what's playing and the few before it; the session list: everything this
// session played, in order, growing only at its end, so a block can be rated long after it passed.
import type { Mixer, Snapshot } from '../mixer/engine/mixer'
import { STARS } from '../mixer/engine/session'
import { Icon } from '../shell/Icon'

function Stars({ m, id }: { m: Mixer; id: string }) {
  const n = m.sess?.stars.get(id) ?? 0
  return <span className="stars">{[1, 2, 3, 4, 5].map(k => <button key={k} className={`star ${k <= n ? 'on' : ''}`} title={STARS[k]} onClick={() => m.star(id, k)}>★</button>)}</span>
}
function Thumbs({ m, id }: { m: Mixer; id: string }) {
  const v = m.sess?.likes.get(id) ?? 0
  return (
    <span className="thumbs">
      <button className={v > 0 ? 'on up' : 'up'} title="Good transition" onClick={() => void m.like(id, 1)}><Icon name="up" /></button>
      <button className={v < 0 ? 'on down' : 'down'} title="Bad transition" onClick={() => void m.like(id, -1)}><Icon name="down" /></button>
    </span>
  )
}
const Block = ({ m, id, kind, cls, n }: { m: Mixer; id: string; kind: string; cls: string; n?: number }) => (
  <span className={`blk ${kind !== 'part' ? kind : ''} ${cls}`}>{kind !== 'part' ? <small>{kind}</small> : n != null && <small>{n}</small>}<Stars m={m} id={id} /></span>
)

export function Lane({ m, snap }: { m: Mixer; snap: Snapshot }) {
  return (
    <div className="lane">
      {snap.lane.map(b => <span key={b.id} className="lanepair"><Block m={m} id={b.id} kind={b.kind} cls={`${b.on ? 'on' : ''} ${b.past ? 'past' : ''}`} />{b.hasNext && <Thumbs m={m} id={b.id} />}</span>)}
    </div>
  )
}
export function SessionList({ m, snap }: { m: Mixer; snap: Snapshot }) {
  if (!snap.session.length) return null
  const rated = snap.session.filter(b => m.sess?.stars.has(b.id)).length
  return (
    <div className="sess">
      <div className="lbl">This session · {snap.session.length} block{snap.session.length === 1 ? '' : 's'} · {rated} rated</div>
      <div className="sessr">
        {snap.session.map((b, i) => <span key={b.id} className="lanepair"><Block m={m} id={b.id} kind={b.kind} cls={b.cur && snap.playing ? 'on' : ''} n={i + 1} />{i < snap.session.length - 1 && <Thumbs m={m} id={b.id} />}</span>)}
      </div>
    </div>
  )
}

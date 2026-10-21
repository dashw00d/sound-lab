// Choosing songs on the graph and hearing them in turn (2026-10-21, the designer: "select a bunch of nodes from families
// into the player and easily match them with the match votes. Then I can just select arbitrary nodes, quickly vote,
// repeat"). The chosen songs, to play as a queue (each for Stay bars, then straight into the next) or to link all at
// once (one family, one root); the queue playing, each pair of neighbours with its link; and the transition just
// heard, voted with one key (the song coming in joins the family of the one before, or is a bad match for it).
import type { Families } from '../../api/types'
import type { Mixer } from '../../mixer/engine/mixer'
import { hue, label, type Link } from './model'

const WORD: Record<Link, string> = { match: 'match', dup: 'near duplicate', bad: 'bad match' }

/** A pair's link, as three buttons: match, near duplicate, bad match (the one it has, again: none). */
export function PairVote({ kind, onVote }: { kind: Link | null; onVote: (k: Link | null) => void }) {
  return (
    <span className="pv">
      {(['match', 'dup', 'bad'] as const).map(k => (
        <button key={k} className={`${k} ${kind === k ? 'on' : ''}`} title={kind === k ? `Clear the ${WORD[k]}` : `They're a ${WORD[k]}`} onClick={() => onVote(kind === k ? null : k)}>
          {k === 'match' ? '✓' : k === 'dup' ? '≈' : '✗'}
        </button>
      ))}
    </span>
  )
}

const Dot = ({ fid }: { fid: string }) => <span className="dot" style={{ background: `hsl(${hue(fid)} 70% 62%)` }} />

export function Chosen({ F, picked, onPlay, onQueue, onLinkAll, onDrop, onClear }: {
  F: Families; picked: string[]; onPlay: (id: string) => void; onQueue: () => void; onLinkAll: () => void; onDrop: (id: string) => void; onClear: () => void
}) {
  return (
    <section className="fa-sel">
      <div className="lbl">{picked.length} chosen</div>
      <div className="row">
        <button className="btn primary" onClick={onQueue}>Play as queue <kbd>Q</kbd></button>
        <button className="btn" title="One family of them all, under one root (the root of the biggest family among them)" onClick={onLinkAll}>Make one family</button>
        <button className="btn ghost" onClick={onClear}>Clear</button>
      </div>
      <div className="fa-list">
        {picked.map((id, i) => (
          <div key={id} className="fa-li">
            <small>{i + 1}</small><Dot fid={F.items[id].family} />
            <button className="lnk" onClick={() => onPlay(id)}>{label(id, F.items[id])}</button>
            <button className="x" title="Take it out of the choice" onClick={() => onDrop(id)}>×</button>
          </div>
        ))}
      </div>
    </section>
  )
}

export function QueueCard({ F, m, linkOf, onVote }: { F: Families; m: Mixer; linkOf: (a: string, b: string) => Link | null; onVote: (a: string, b: string, k: Link | null) => void }) {
  const q = m.queue!, h = m.heard(), on = m.mode === 'queue'
  const name = (id: string) => (F.items[id] ? label(id, F.items[id]) : id)
  return (
    <section className="fa-sel fa-queue">
      <div className="lbl">The queue · {q.length} songs{on ? '' : ' · stopped'}</div>
      {on && h.from && h.track ? (
        <div className="fa-heard">
          <div className="dim">just heard</div>
          <div><b>{name(h.from)}</b> → <b>{name(h.track)}</b></div>
          <div className="row">
            <PairVote kind={linkOf(h.from, h.track)} onVote={k => onVote(h.from!, h.track!, k)} />
            <span className="dim"><kbd>M</kbd> match <kbd>N</kbd> near duplicate <kbd>B</kbd> bad match</span>
          </div>
        </div>
      ) : <div className="dim">{on ? 'The first song: the vote comes with the next one.' : <button className="btn" onClick={() => m.playQueue(q)}>Play it again</button>}</div>}
      <div className="fa-list">
        {q.map((x, i) => (
          <div key={`${x.id}#${i}`}>
            <div className={`fa-li ${on && h.qi === i ? 'now' : ''}`}>
              <small>{i + 1}</small>{F.items[x.id] && <Dot fid={F.items[x.id].family} />}
              <button className="lnk" title="Go to it" onClick={() => m.playQueue(q, i)}>{x.label}</button>
            </div>
            {i < q.length - 1 && <div className="fa-pair"><PairVote kind={linkOf(x.id, q[i + 1].id)} onVote={k => onVote(x.id, q[i + 1].id, k)} /></div>}
          </div>
        ))}
      </div>
    </section>
  )
}

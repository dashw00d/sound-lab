// The player's queue, from the graph (2026-10-21, the designer: "select a bunch of nodes from families into the player
// and easily match them with the match votes. Then I can just select arbitrary nodes, quickly vote, repeat"; and "when
// I control click two, ... show the two I have queued up in the player"). The songs chosen are the queue: in the
// player's bar at once, played in turn (each for Stay bars, then straight into the next). Here: the transition just
// heard, voted with one key (the song coming in joins the family of the one before, or is a bad match for it); each
// pair of neighbours with its link; the queue made one family; a song taken out; the queue cleared.
import type { Families } from '../../api/types'
import type { Mixer } from '../../mixer/engine/mixer'
import { colour, hue, label, type FamilyView, type Link } from './model'

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

export function QueueCard({ F, fv, m, onVote, onMerge, onDrop, onClear }: {
  F: Families; fv: FamilyView; m: Mixer; onVote: (a: string, b: string, k: Link | null) => void
  onMerge: () => void; onDrop: (id: string) => void; onClear: () => void
}) {
  const q = m.queue!, h = m.heard(), on = m.mode === 'queue'
  const name = (id: string) => (F.items[id] ? label(id, F.items[id]) : id)
  return (
    <section className="fa-sel fa-queue">
      <div className="lbl">The queue · {q.length} songs{on ? '' : ' · Space plays it'}</div>
      <div className="row">
        {!on && <button className="btn primary" title="Play the queue: each song in turn, Stay bars each (Q)" onClick={() => m.playQueue(q)}>Play <kbd>Q</kbd></button>}
        <button className="btn" title="One family of them all, under one root (the root of the family most of them are in)" onClick={onMerge}>Make one family</button>
        <button className="btn ghost" title="Clear the queue" onClick={onClear}>Clear</button>
      </div>
      {on && (h.from && h.track ? (
        <div className="fa-heard">
          <div className="dim">just heard</div>
          <div><b>{name(h.from)}</b> → <b>{name(h.track)}</b></div>
          <div className="row">
            <PairVote kind={fv.relation(h.track, h.from)} onVote={k => onVote(h.from!, h.track!, k)} />
            <span className="dim"><kbd>M</kbd> match <kbd>N</kbd> near duplicate <kbd>B</kbd> bad match</span>
          </div>
        </div>
      ) : <div className="dim">The first song: the vote comes with the next one.</div>)}
      <div className="fa-list">
        {q.map((x, i) => (
          <div key={`${x.id}#${i}`}>
            <div className={`fa-li ${on && h.qi === i ? 'now' : ''}`}>
              <small>{i + 1}</small>{F.items[x.id] && <span className="dot" style={{ background: colour(hue(fv.family(x.id).id)) }} />}
              <button className="lnk" title="Play from here" onClick={() => m.playQueue(q, i)}>{x.label}</button>
              <button className="x" title="Take it out of the queue" onClick={() => onDrop(x.id)}>×</button>
            </div>
            {i < q.length - 1 && <div className="fa-pair"><PairVote kind={fv.relation(q[i + 1].id, x.id)} onVote={k => onVote(x.id, q[i + 1].id, k)} /></div>}
          </div>
        ))}
      </div>
    </section>
  )
}

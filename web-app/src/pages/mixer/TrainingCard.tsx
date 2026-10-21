// Training: one transition at a time (2 bars of A, then 3 of B), rated with one key, the next straight after. Blind:
// the model's guess shows only after the vote, so it can't sway it.
import type { Mixer } from '../../mixer/engine/mixer'
import { name } from '../../mixer/judge'
import { Icon } from '../../shell/Icon'
import { useVotes } from '../../state/votes'

export function TrainingCard({ m }: { m: Mixer }) {
  const votes = useVotes(), tr = m.train, c = tr.cur, l = tr.last, M = m.lib.join_model
  const all = Object.keys(votes.clips).filter(k => k.startsWith('join_')).length
  const nm = (id: string) => { const t = m.jd.track(id); return t ? name(t) : id }
  return (
    <section className="card mx-train">
      <div className="lbl">Rating transitions <span className="dim">· {tr.n} this session · {all} in all · {M
        ? <>the model (fit on {M.n}) is right {Math.round(100 * M.right)}% on votes it didn't see: <code>soundlab music joins --fit</code> refits it</>
        : <>no model yet: <code>soundlab music joins --fit</code></>}</span></div>
      {c ? (
        <div className="tpair">
          <b>{nm(c.a)}</b><small>bar {c.e}</small><span className="arrow"><Icon name="arrow" /></span><b>{nm(c.b.track)}</b><small>bar {c.b.start}</small>
          <span className="dim" title="Training plays mostly the ones the model is least sure of">guess hidden</span>
        </div>
      ) : <div className="dim">No transition left to rate.</div>}
      <div className="row">
        <button className="btn good" disabled={!c} onClick={() => void m.trainVote(1)}><Icon name="up" />Good<kbd>↑</kbd></button>
        <button className="btn bad" disabled={!c} onClick={() => void m.trainVote(-1)}><Icon name="down" />Bad<kbd>↓</kbd></button>
        <button className="btn" onClick={() => m.trainNext()}><Icon name="next" />Skip<kbd>→</kbd></button>
        <button className="btn ghost" onClick={() => m.trainPlay()}><Icon name="refresh" />Replay<kbd>R</kbd></button>
        <button className="btn ghost" onClick={() => m.trainToggle()}><Icon name="x" />Done</button>
      </div>
      {l && (
        <div className="dim">last: {nm(l.a)} → {nm(l.b.track)} · you said <b>{l.v > 0 ? 'good' : 'bad'}</b>
          {l.t != null && <> · the model guessed {Math.round(100 * l.t)}%: {(l.t >= 0.5) === (l.v > 0) ? 'agreed' : <b>disagreed</b>}</>} · join score {l.j.toFixed(2)}</div>
      )}
      {tr.n > 0 && <div className="dim">this session the model agreed with you {tr.agree} of {tr.n} times</div>}
    </section>
  )
}

// Sessions (2026-10-21: the Mixer's listening history, made a page): every session you rated, newest first, and one
// whole: its blocks in order with their ratings and what played in them, the transitions with your thumbs. Any block
// plays again exactly as it played, or piece by piece; a flagged one shows its pieces, and W marks the one that broke it.
import { useEffect, useMemo } from 'react'
import { go, useRoute } from '../../data/route'
import { useStreams } from '../../data/resources'
import { shortName, VARIANT } from '../../mixer/engine/review'
import type { ReviewItem, StreamBlock, StreamSession, StreamTransition } from '../../mixer/types'
import { useEngine } from '../../player/hooks'
import { useKeys } from '../../player/keys'
import { RATING } from '../../player/Rating'
import { usePlayer } from '../../player/store'
import { Icon } from '../../shell/Icon'
import { Split } from '../../ui/Split'
import '../library/library.css'
import './sessions.css'

const blocksOf = (s: StreamSession) => (s.stream ?? []).filter((x): x is StreamBlock => x.kind !== 'transition')
const when = (sid: string) => { const d = new Date(sid.replace(' ', 'T')); return isNaN(+d) ? sid : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const scopeName: Record<string, string> = { graph: 'the graph', all: 'everything', set: 'a set' }

export default function SessionsPage() {
  const route = useRoute(), st = useStreams().data, m = usePlayer().m
  useEngine(m)
  const list = useMemo(() => Object.entries(st?.streams ?? {}).filter(([, s]) => blocksOf(s).length).sort((a, b) => b[0].localeCompare(a[0])), [st])
  const sel = list.find(([sid]) => sid === route.id) ?? null
  useEffect(() => { if (!route.id && list[0]) go('sessions', list[0][0], true) }, [route.id, list])
  useKeys(k => {
    const i = list.findIndex(([sid]) => sid === route.id)
    if (k === 'ArrowDown' || k === 'j') { const r = list[Math.min(list.length - 1, i + 1)]; if (r) go('sessions', r[0], true); return true }
    if (k === 'ArrowUp' || k === 'k') { const r = list[Math.max(0, i - 1)]; if (r) go('sessions', r[0], true); return true }
    if (k === 'w' && m?.review.cur) { void m.reviewMark(''); return true }
    return false
  })
  if (!st) return <div className="empty-state"><div className="lib-loading" /></div>
  return (
    <Split id="sessions" initial={620} max={900} left={
      <div className="lib">
        <div className="lib-bar"><span className="lbl">Your listening sessions</span><span className="lib-count">{list.length} sessions</span></div>
        <div className="lib-list">
          {list.map(([sid, s]) => {
            const bl = blocksOf(s), rated: Record<number, number> = {}
            bl.forEach(b => { if (b.stars) rated[b.stars] = (rated[b.stars] ?? 0) + 1 })
            const tr = (s.stream ?? []).filter((x): x is StreamTransition => x.kind === 'transition')
            const up = tr.filter(x => (x.like ?? 0) > 0).length, down = tr.filter(x => (x.like ?? 0) < 0).length
            return (
              <div key={sid} className={`srow2 ${sid === route.id ? 'sel' : ''}`} onClick={() => go('sessions', sid, true)}>
                <div className="when"><b>{when(sid)}</b><span>{bl.length} block{bl.length === 1 ? "" : "s"} · {bl.reduce((n, b) => n + (b.played ?? 0), 0)} bars · from {scopeName[String(s.settings?.scope)] ?? String(s.settings?.scope ?? '?')}</span></div>
                <div className="dist">
                  {[5, 4, 3, 2, 1].map(k => rated[k] ? <span key={k} className={`rvs r${k}`} title={`${RATING[k].name}: ${rated[k]}`}><Icon name={RATING[k].icon} />{rated[k]}</span> : null)}
                  {(up > 0 || down > 0) && <span className="thumbsum"><span className="good">▲{up}</span> <span className="bad">▼{down}</span></span>}
                </div>
              </div>
            )
          })}
          {!list.length && <div className="empty-state"><div><b>No sessions yet</b>Rate as the walk plays: each session saves here.</div></div>}
        </div>
      </div>
    } right={sel ? <Session sid={sel[0]} s={sel[1]} /> : <div className="empty-state"><div><b>Choose a session</b></div></div>} />
  )
}

function Session({ sid, s }: { sid: string; s: StreamSession }) {
  const m = usePlayer().m
  useEngine(m)
  const S = s.settings ?? {}
  let n = -1
  const cur = m?.review.cur, curIt = m?.review.items?.[0]
  const play = (b: StreamBlock, block: number, mode: 'exact' | 'pieces') => {
    if (!m || b.kind !== 'part' || !b.track || !Array.isArray(b.bars)) return
    const it: ReviewItem = { sid, block, w: b as ReviewItem['w'], marked: [] }
    void m.playBlock(it, mode)
  }
  return (
    <div className="insp">
      <header className="insp-head">
        <h2>{when(sid)}</h2>
        <div className="insp-kicker">
          {['scope', 'stay', 'joins', 'glueKind', 'glueBars', 'sceneBars', 'wave'].filter(k => S[k] != null).map(k => <span key={k} className="chip"><span className="dim">{k}</span> {String(S[k])}</span>)}
        </div>
      </header>
      <div className="stream">
        {(s.stream ?? []).map((x, i) => {
          if (x.kind === 'transition') {
            const t = x as StreamTransition
            return <div key={i} className={`tr2 ${t.like ? (t.like > 0 ? 'up' : 'down') : ''}`}><span className="line" />{t.like ? <Icon name={t.like > 0 ? 'up' : 'down'} /> : null}</div>
          }
          n++
          const b = x as StreamBlock, k = n, on = !!cur && curIt?.sid === sid && curIt.block === k
          const name = b.kind === 'part' && b.track && m ? shortName(m.jd, b.track) : b.kind
          return (
            <div key={i} className={`blk2 k-${b.kind} ${b.stars ? `r${b.stars}` : ''} ${on ? 'on' : ''}`}>
              <span className="rate-ic">{b.stars ? <Icon name={RATING[b.stars].icon} /> : <i />}</span>
              <div className="body">
                <b>{name}</b>
                <span className="meta">
                  {Array.isArray(b.bars) ? `bars ${b.bars[0]}–${b.bars[1]} · ${b.played ?? '?'} played` : `${b.bars} bar${b.bars === 1 ? '' : 's'}`}
                  {b.variants?.length ? ` · ${b.variants.map(v => VARIANT[v]).join(', ')}` : ''}{b.fills?.length ? ` · ${b.fills.length} fill${b.fills.length > 1 ? 's' : ''}` : ''}{b.siblings?.length ? ' · sibling' : ''}
                </span>
                {on && cur && <div className="pieces">{cur.pieces.map((p, j) => <span key={j} className={m!.snapshot().rev === j ? 'now' : ''}>{p.label}</span>)}<span className="dim">W marks the one playing</span></div>}
              </div>
              {b.kind === 'part' && (
                <span className="acts">
                  <button className="btn sm" disabled={!b.chunks} title="Play it again exactly as it played" onClick={() => play(b, k, 'exact')}><Icon name="play" />Again</button>
                  {b.stars && b.stars <= 2 && <button className="btn sm" title="Each piece alone: the song, each variation, sibling and fill" onClick={() => play(b, k, 'pieces')}><Icon name="layers" />Pieces</button>}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

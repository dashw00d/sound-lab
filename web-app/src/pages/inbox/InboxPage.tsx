// The Inbox (2026-10-21: the Music page's newest round, the Trial page and grow's extensions, made one): everything new
// waiting for an answer. Play them all as a queue and the choice follows the song heard; answer with one key, and the
// next unanswered take comes up.
import { useEffect, useMemo, useRef, useState } from 'react'
import { go, useRoute } from '../../data/route'
import { useFamilies, useSongs, useVotesData } from '../../data/resources'
import { useEngine } from '../../player/hooks'
import { useKeys } from '../../player/keys'
import { usePlayer } from '../../player/store'
import { useHoverWarm, usePreload } from '../../player/warm'
import { Icon } from '../../shell/Icon'
import { toast } from '../../shell/toast'
import { vote } from '../../state/votes'
import { Energy } from '../../ui/Energy'
import { Split } from '../../ui/Split'
import { Toggle } from '../../ui/Field'
import { colour, hue } from '../families/model'
import '../library/library.css'
import { KIND, takes, type Answer, type Kind, type Take } from './model'
import { TakeInspector } from './TakeInspector'
import './inbox.css'

export function useInboxCount() {
  const lib = useSongs().data, F = useFamilies().data, votes = useVotesData()
  return useMemo(() => (lib || F ? takes(lib, F, votes).filter(t => !t.answered).length : null), [lib, F, votes])
}

export default function InboxPage() {
  const route = useRoute(), lib = useSongs().data, F = useFamilies().data, votes = useVotesData(), m = usePlayer().m
  useEngine(m)
  const [open, setOpen] = useState(() => localStorage.getItem('inbox.all') !== '1')
  const all = useMemo(() => takes(lib, F, votes), [lib, F, votes])
  const list = useMemo(() => all.filter(t => !open || !t.answered || t.id === route.id), [all, open, route.id])
  const sel = all.find(t => t.id === route.id) ?? null
  usePreload(m, sel?.id ?? null, sel?.src)
  const hover = useHoverWarm(m)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!route.id && list[0]) go('inbox', list[0].id, true) }, [route.id, list])
  useEffect(() => { box.current?.querySelector('.lrow.sel')?.scrollIntoView({ block: 'nearest' }) }, [route.id])
  // (a queue playing: the choice follows the song heard)
  const heard = m?.mode === 'queue' ? m.heard().track : null
  useEffect(() => { if (heard && heard !== route.id && all.some(t => t.id === heard)) go('inbox', heard, true) }, [heard])  // eslint-disable-line

  const play = (t: Take) => {
    if (!m || !t.src.calm) return
    m.ensure(t.id, t.src)
    const seed = t.seed ? F?.items[t.seed] : null
    if (seed?.src.calm) { m.ensure(t.seed!, seed.src); m.playFramed(t.seed!, t.id) } else m.playSong(t.id)
  }
  const playAll = () => {
    if (!m) return
    const q = list.filter(t => !t.answered && t.src.calm)
    q.forEach(t => m.ensure(t.id, t.src))
    if (q.length) m.playQueue(q.map(t => ({ id: t.id, label: `${t.style} · ${t.take}` })))
  }
  const answer = async (t: Take, a: Answer) => {
    const undo = t.answered?.label === a.label
    for (const [k, x] of a.votes) await vote(k, undo ? 0 : x)
    toast(undo ? `${t.style} ${t.take}: answer cleared` : `${t.style} ${t.take}: ${a.label.toLowerCase()}`, a.tone === 'bad' ? 'down' : a.tone === 'plain' ? 'x' : 'check')
    if (undo) return
    const next = list.find(x => !x.answered && x.id !== t.id && list.indexOf(x) > list.indexOf(t)) ?? list.find(x => !x.answered && x.id !== t.id)
    if (next) { go('inbox', next.id, true); if (m?.playing && m.mode !== 'queue') play(next) }
  }
  useKeys(k => {
    const i = list.findIndex(t => t.id === route.id)
    if (k === 'ArrowDown' || k === 'j') { const t = list[Math.min(list.length - 1, i + 1)]; if (t) go('inbox', t.id, true); return true }
    if (k === 'ArrowUp' || k === 'k') { const t = list[Math.max(0, i - 1)]; if (t) go('inbox', t.id, true); return true }
    if (k === 'Enter' && sel) { play(sel); return true }
    if (k === 'q') { playAll(); return true }
    const a = sel?.answers.find(x => x.key === k)
    if (sel && a) { void answer(sel, a); return true }
    return false
  })
  if (!lib && !F) return <div className="empty-state"><div className="lib-loading" /></div>
  const groups = (['extension', 'trial', 'new'] as Kind[]).map(k => ({ k, rows: list.filter(t => t.kind === k) })).filter(g => g.rows.length)
  const waiting = all.filter(t => !t.answered).length
  return (
    <Split id="inbox" left={
      <div className="lib">
        <div className="lib-bar">
          <button className="btn primary" disabled={!waiting} title="Play all unanswered: each new take in turn, as a queue (Q)" onClick={playAll}><Icon name="play" />Play all unanswered<kbd>Q</kbd></button>
          <Toggle on={open} label="Unanswered only" onChange={o => { setOpen(o); localStorage.setItem('inbox.all', o ? '0' : '1') }} />
          <span className="lib-count">{waiting} waiting · {all.length - waiting} answered</span>
        </div>
        <div className="lib-list" ref={box}>
          {groups.map(g => (
            <section key={g.k}>
              <header className="lib-group ib-group"><b>{KIND[g.k].title}</b><span>{KIND[g.k].sub}</span><span className="n">{g.rows.length}</span></header>
              {g.rows.map(t => (
                <div key={t.id} {...hover(t.id, t.src)} className={`lrow ib-row ${t.id === route.id ? 'sel' : ''} ${heard === t.id || (m?.tag === t.id && m.playing) ? 'playing' : ''} ${t.answered ? 'done' : ''}`} onClick={() => go('inbox', t.id, true)}>
                  <span className="sw" style={{ background: t.scene ? colour(hue(t.scene)) : 'var(--line-3)' }} />
                  <span className="nm"><b>{t.style}</b><span>{t.take}</span></span>
                  <span className={`ctx c-${t.context}`}>{t.context}</span>
                  <span className="ld">{t.rank != null ? `#${t.rank}` : t.words.slice(0, 2).join(' · ')}</span>
                  <Energy value={t.energy} />
                  <span className="marks">{t.answered ? <span className={`ans ${t.answered.tone}`}>{t.answered.label}</span> : <span className="ans wait">new</span>}</span>
                </div>
              ))}
            </section>
          ))}
          {!list.length && <div className="empty-state"><div><b>All answered</b>New takes, trials and extensions show here as they're made.</div></div>}
        </div>
      </div>
    } right={sel ? <TakeInspector t={sel} onPlay={() => play(sel)} onAnswer={a => void answer(sel, a)} /> : <div className="empty-state"><div><b>Nothing chosen</b>Choose a take to hear it and answer.</div></div>} />
  )
}

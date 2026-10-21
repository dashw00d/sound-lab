// The Families graph (2026-10-21, the designer: "what we need is like nodes where you can drag this matches this and
// this matches that and that"). Every song is a dot placed by likeness (music families' map) in its family's colour.
// Drag from one song to another: they match. Click a link to make it a near duplicate, then a bad match, then nothing.
// Click a song to hear it in the player, as the game plays it (1 / 2: mellow / intense). Shift-drag a box or Ctrl-click
// to choose several, and play them as a queue: each for Stay bars, then straight into the next; M / N / B vote on the
// transition just heard (match, near duplicate, bad match). The panel: the song chosen, good / bad take / new family,
// the songs chosen and the queue, and the families to look at one by one. The sort (music families) takes the answers
// in when it runs again.
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type EdgeMouseHandler, type NodeChange, type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { Families, Votes } from '../../api/types'
import { useEngine } from '../../player/hooks'
import { useKeys } from '../../player/keys'
import { usePlayer } from '../../player/store'
import { toast } from '../../shell/toast'
import { useLive } from '../../shell/useLive'
import { hue, label, linkVotes, links, NEXT, novelKey, type Link } from './model'
import { Chosen, QueueCard } from './Queue'
import SongNode, { type SongNodeType } from './SongNode'
import './families.css'

const nodeTypes = { song: SongNode }
const SCALE = 2.4
const EDGE: Record<Link, React.CSSProperties> = {
  match: { stroke: 'var(--good)', strokeWidth: 2 },
  dup: { stroke: 'var(--pick)', strokeWidth: 2, strokeDasharray: '6 4' },
  bad: { stroke: 'var(--bad)', strokeWidth: 1.5, strokeDasharray: '2 4', opacity: 0.7 },
}

function Graph() {
  const fam = useLive(api.families, ['families'])
  const live = useLive(api.votes, ['votes'])
  const [votes, setVotes] = useState<Votes | null>(null)
  useEffect(() => { if (live.data) setVotes(live.data) }, [live.data])
  const [sel, setSel] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])  // (the songs chosen, in the order chosen)
  const [focus, setFocus] = useState<string | null>(null)
  const [showBad, setShowBad] = useState(false)
  const [sorting, setSorting] = useState(false)
  const m = usePlayer().m
  useEngine(m)
  // (the song heard, when this page asked for it: one song, an extension framed by its seed, a queue)
  const playing = m?.mode === 'queue' ? m.heard().track : m?.mode === 'song' || m?.mode === 'script' ? m.tag : null
  const flow = useReactFlow()
  const F = fam.data as Families | null

  const vote = useCallback(async (pairs: [string, number][]) => {
    let v: Votes | null = null
    for (const [clip, value] of pairs) v = await api.vote(clip, value)
    if (v) setVotes(v)
  }, [])

  // (a song the library has plays from its own measures; any other take by its files; an extension framed by its seed)
  const play = useCallback((id: string) => {
    const it = F?.items[id]; if (!m || !it?.src.calm) return
    m.ensure(id, it.src)
    const seed = it.seed ? F?.items[it.seed] : undefined
    if (seed?.src.calm) { m.ensure(it.seed!, seed.src); m.playFramed(it.seed!, id) }
    else m.playSong(id)
  }, [F, m])
  const toggle = useCallback((id: string) => { if (playing === id && m?.mode !== 'queue') m?.stop(); else play(id) }, [m, playing, play])
  const playQueue = useCallback((ids: string[]) => {
    if (!m || !F) return
    const ok = ids.filter(id => F.items[id]?.src.calm)
    ok.forEach(id => m.ensure(id, F.items[id].src))
    m.playQueue(ok.map(id => ({ id, label: label(id, F.items[id]) })))
  }, [F, m])

  const unsure = useMemo(() => new Set((F?.queue ?? []).filter(q => q.kind !== 'dup').map(q => q.item)), [F])
  const focused = useMemo(() => (focus && F ? new Set(F.families[focus]?.members ?? []) : null), [focus, F])
  const nodes: SongNodeType[] = useMemo(() => {
    if (!F) return []
    return Object.entries(F.items).map(([id, it]) => ({
      id, type: 'song' as const, position: { x: it.xy[0] * SCALE, y: it.xy[1] * SCALE }, selected: picked.includes(id),
      data: {
        label: label(id, it), hue: hue(it.family), kind: it.kind, playing: playing === id, dim: !!focused && !focused.has(id),
        unsure: unsure.has(id), novel: !!(votes && votes.clips[novelKey(id, it)] > 0), bad: !!(votes && votes.clips[`ok_${id}`] < 0),
      },
    }))
  }, [F, picked, playing, focused, unsure, votes])
  const edges: Edge[] = useMemo(() => {
    if (!F || !votes) return []
    return links(votes, F.items).filter(l => showBad || l.kind !== 'bad' || l.a === sel || l.b === sel)
      .map(l => ({ id: `${l.a}|${l.b}`, source: l.a, target: l.b, data: { kind: l.kind }, style: EDGE[l.kind], interactionWidth: 14 }))
  }, [F, votes, showBad, sel])

  const onConnect = useCallback((c: Connection) => { if (c.source && c.target && c.source !== c.target) void vote(linkVotes(c.source, c.target, 'match')) }, [vote])
  const onEdgeClick: EdgeMouseHandler = useCallback((_, e) => {
    const kind = (e.data as { kind: Link }).kind
    void vote(linkVotes(e.source, e.target, NEXT[kind]))
  }, [vote])
  // (React Flow chooses: a click one song, Ctrl-click one more, a Shift-drag box all inside; a click also plays it)
  const onNodesChange = useCallback((changes: NodeChange<SongNodeType>[]) => setPicked(p => {
    let out = p
    for (const c of changes) if (c.type === 'select') out = c.selected ? (out.includes(c.id) ? out : [...out, c.id]) : out.filter(x => x !== c.id)
    return out
  }), [])
  const onNodeClick: NodeMouseHandler = useCallback((e, n) => { setSel(n.id); if (!e.ctrlKey && !e.metaKey && !e.shiftKey) toggle(n.id) }, [toggle])

  const linkMap = useMemo(() => new Map((votes && F ? links(votes, F.items) : []).map(l => [l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`, l.kind])), [votes, F])
  const linkOf = useCallback((a: string, b: string) => linkMap.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? null, [linkMap])
  const pairVote = useCallback((a: string, b: string, k: Link | null) => {
    if (!F) return
    void vote(linkVotes(a, b, k))
    toast(`${label(a, F.items[a])} → ${label(b, F.items[b])}: ${k === 'match' ? 'a match' : k === 'dup' ? 'near duplicates' : k === 'bad' ? 'a bad match' : 'no link'}`,
          k === 'bad' ? 'down' : k ? 'check' : 'x')
  }, [F, vote])
  const linkAll = useCallback(async () => {
    if (!F || picked.length < 2) return
    const pairs = picked.slice(1).flatMap((b, i) => linkVotes(picked[i], b, 'match'))
    await vote(pairs)
    toast(`Linked ${picked.length} songs as matches`, 'check')
  }, [F, picked, vote])

  const answer = useCallback((what: 'good' | 'bad' | 'novel') => {
    if (!sel || !F) return
    const it = F.items[sel]
    if (what === 'good') void vote([[`ok_${sel}`, 1]])
    if (what === 'bad') void vote([[`ok_${sel}`, -1]])
    if (what === 'novel') void vote([[novelKey(sel, it), 1], [`ok_${sel}`, 1]])
  }, [sel, F, vote])
  const resort = useCallback(async () => {
    setSorting(true)
    await api.rebuildFamilies().catch(() => {})
  }, [])
  useEffect(() => { if (sorting && fam.data) setSorting(false) }, [fam.data])  // (the stamp changed: the sort is in)

  // (the player's keys are in its bar: Space here plays the song chosen, when nothing plays)
  useKeys(k => {
    if (k === ' ' && sel && !m?.playing) { play(sel); return true }
    if (k === 'q' && picked.length) { playQueue(picked); return true }
    if ((k === 'm' || k === 'n' || k === 'b') && m?.mode === 'queue') {  // (the transition just heard)
      const h = m.heard()
      if (h.from && h.track) pairVote(h.from, h.track, k === 'm' ? 'match' : k === 'n' ? 'dup' : 'bad')
      else toast('The vote is on the transition just heard: wait for the next song')
      return true
    }
    if (k === 'g') { answer('good'); return true }
    if (k === 'd') { answer('bad'); return true }
    if (k === 'y') { answer('novel'); return true }
    if (k === 'Escape') setFocus(null)  // (and the player stops)
    return false
  })

  const focusOn = (fid: string | null) => {
    setFocus(fid)
    if (fid && F) requestAnimationFrame(() => flow.fitView({ nodes: F.families[fid].members.map(id => ({ id })), duration: 400, padding: 0.3 }))
    else requestAnimationFrame(() => flow.fitView({ duration: 400 }))
  }

  if (fam.error && !F) return <div className="fa-empty">Couldn't read the families: {fam.error}. Run <code>soundlab music families</code>.</div>
  if (!F || !votes) return <div className="fa-empty">Reading the families…</div>
  const it = sel ? F.items[sel] : null
  const fams = Object.entries(F.families).sort((a, b) => b[1].members.length - a[1].members.length)
  const mine = sel ? links(votes, F.items).filter(l => l.a === sel || l.b === sel) : []

  return (
    <div className="fa">
      <div className="fa-graph">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onConnect={onConnect} onEdgeClick={onEdgeClick} onNodeClick={onNodeClick}
          onNodesChange={onNodesChange} multiSelectionKeyCode={['Control', 'Meta']} onPaneClick={() => setSel(null)} nodesDraggable={false} connectionRadius={28} minZoom={0.1} maxZoom={3} fitView proOptions={{ hideAttribution: true }}>
          <Background color="#1b1e27" gap={28} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable bgColor="#12141a" nodeColor={n => `hsl(${(n.data as { hue: number }).hue} 60% 55%)`} maskColor="rgba(10,11,15,.7)" />
        </ReactFlow>
      </div>
      <aside className="fa-side">
        <div className="lbl">{Object.keys(F.items).length} songs · {fams.length} families · sorted {F.made}</div>
        <div className="row">
          <button className="btn" onClick={resort} disabled={sorting}>{sorting ? 'Sorting…' : 'Re-sort now'}</button>
          <button className={`btn ${showBad ? 'on' : ''}`} onClick={() => setShowBad(b => !b)}>Bad matches</button>
        </div>
        <p className="dim help">Drag from a song to another: they match. Click a link: near duplicate → bad match → none. Click a song to hear it;
          Shift-drag a box or Ctrl-click to choose several, then <kbd>Q</kbd> plays them in turn and <kbd>M</kbd> <kbd>N</kbd> <kbd>B</kbd> vote on each transition.
          Keys: <kbd>Space</kbd> play <kbd>1</kbd><kbd>2</kbd> mellow / intense <kbd>G</kbd> good <kbd>D</kbd> bad take <kbd>Y</kbd> new family.</p>
        {m?.queue && <QueueCard F={F} m={m} linkOf={linkOf} onVote={pairVote} />}
        {picked.length > 1 && <Chosen F={F} picked={picked} onPlay={play} onQueue={() => playQueue(picked)} onLinkAll={() => void linkAll()}
          onDrop={id => setPicked(p => p.filter(x => x !== id))} onClear={() => setPicked([])} />}
        {it && sel ? (
          <section className="fa-sel">
            <div className="lbl">{it.kind === 'shipped' ? 'a shipped song' : it.kind === 'extension' ? 'an extension' : 'a new take'} · family {it.family}{it.conf < 0.3 ? ' · unsure' : ''}</div>
            <div className="nm">{label(sel, it)}</div>
            {it.words && <div className="dim words">{Object.values(it.words).filter(Boolean).map(w => w.replace('{s} ', 'strings ')).join(' · ')}</div>}
            <div className="row">
              <button className="btn" onClick={() => toggle(sel)}>{playing === sel ? 'Stop' : 'Play'}</button>
              <button className={`btn ${m?.state === 'mellow' ? 'on' : ''}`} onClick={() => m?.setState('mellow')}>mellow</button>
              <button className={`btn ${m?.state === 'intense' ? 'on' : ''}`} onClick={() => m?.setState('intense')}>intense</button>
            </div>
            <div className="row">
              <button className={`btn good ${votes.clips[`ok_${sel}`] > 0 ? 'on' : ''}`} onClick={() => answer('good')}>Good <kbd>G</kbd></button>
              <button className={`btn bad ${votes.clips[`ok_${sel}`] < 0 ? 'on' : ''}`} onClick={() => answer('bad')}>Bad take <kbd>D</kbd></button>
              <button className={`btn ${votes.clips[novelKey(sel, it)] > 0 ? 'on' : ''}`} onClick={() => answer('novel')}>New family <kbd>Y</kbd></button>
            </div>
            {mine.length > 0 && <div className="links">{mine.map(l => { const o = l.a === sel ? l.b : l.a; return (
              <div key={o} className={`lk ${l.kind}`}><button className="lnk" onClick={() => { setSel(o); play(o) }}>{label(o, F.items[o])}</button>
                <span>{l.kind === 'match' ? 'matches' : l.kind === 'dup' ? 'near duplicate' : 'bad match'}</span>
                <button className="x" title="Remove this link" onClick={() => void vote(linkVotes(sel, o, null))}>×</button></div>) })}</div>}
            <div className="lbl near">nearest</div>
            {it.nearest.filter(o => F.items[o]).map(o => (
              <button key={o} className="nearb" onClick={() => { setSel(o); play(o) }}>
                <span className="dot" style={{ background: `hsl(${hue(F.items[o].family)} 70% 62%)` }} />{label(o, F.items[o])}</button>))}
          </section>
        ) : <p className="dim">Click a song to hear it and see its links.</p>}
        <div className="lbl famh">families</div>
        <div className="fa-fams">
          {focus && <button className="famb on" onClick={() => focusOn(null)}>All families ×</button>}
          {fams.map(([fid, f]) => (
            <button key={fid} className={`famb ${focus === fid ? 'on' : ''}`} onClick={() => focusOn(focus === fid ? null : fid)}>
              <span className="dot" style={{ background: `hsl(${hue(fid)} 70% 62%)` }} />
              <b>{f.members.length}</b> {f.leads.slice(0, 3).join(', ')}{f.shipped ? <span className="dim"> · {f.shipped} shipped</span> : null}
            </button>))}
        </div>
      </aside>
    </div>
  )
}

export default function FamiliesPage() {
  return <ReactFlowProvider><Graph /></ReactFlowProvider>
}

// The Families graph (2026-10-21, the designer: "what we need is like nodes where you can drag this matches this and
// this matches that and that"). Every song is a dot placed by likeness (music families' map) in its family's colour.
// Drag from one song to another: they match. Click a link to make it a near duplicate, then a bad match, then nothing.
// Click a song to hear it (1 / 2: mellow / intense). The panel: the song chosen, good / bad take / new family, and the
// families to look at one by one. The sort (music families) takes the answers in when it runs again.
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type EdgeMouseHandler, type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { Families, Votes } from '../../api/types'
import { SongPlayer, type Level } from '../../audio/songPlayer'
import { useLive } from '../../shell/useLive'
import { hue, label, linkVotes, links, NEXT, novelKey, type Link } from './model'
import SongNode, { type SongNodeType } from './SongNode'
import './families.css'

const player = new SongPlayer()
const nodeTypes = { song: SongNode }
const SCALE = 2.4
const EDGE: Record<Link, React.CSSProperties> = {
  match: { stroke: 'var(--good)', strokeWidth: 2 },
  dup: { stroke: 'var(--pick)', strokeWidth: 2, strokeDasharray: '6 4' },
  bad: { stroke: 'var(--bad)', strokeWidth: 1.5, strokeDasharray: '2 4', opacity: 0.7 },
}

function usePlayer() {
  const [, tick] = useState(0)
  useEffect(() => player.onChange(() => tick(t => t + 1)), [])
  return player
}

function Graph() {
  const fam = useLive(api.families, ['families'])
  const live = useLive(api.votes, ['votes'])
  const [votes, setVotes] = useState<Votes | null>(null)
  useEffect(() => { if (live.data) setVotes(live.data) }, [live.data])
  const [sel, setSel] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [showBad, setShowBad] = useState(false)
  const [sorting, setSorting] = useState(false)
  const pl = usePlayer()
  const flow = useReactFlow()
  const F = fam.data as Families | null

  const vote = useCallback(async (pairs: [string, number][]) => {
    let v: Votes | null = null
    for (const [clip, value] of pairs) v = await api.vote(clip, value)
    if (v) setVotes(v)
  }, [])

  const play = useCallback((id: string) => {
    const it = F?.items[id]; if (!it?.src.calm) return
    const seed = it.seed ? F?.items[it.seed] : undefined
    void pl.play({ id, calm: it.src.calm, battle: it.src.battle, seed: seed?.src.calm ? { calm: seed.src.calm, battle: seed.src.battle } : undefined })
  }, [F, pl])

  const unsure = useMemo(() => new Set((F?.queue ?? []).filter(q => q.kind !== 'dup').map(q => q.item)), [F])
  const focused = useMemo(() => (focus && F ? new Set(F.families[focus]?.members ?? []) : null), [focus, F])
  const nodes: SongNodeType[] = useMemo(() => {
    if (!F) return []
    return Object.entries(F.items).map(([id, it]) => ({
      id, type: 'song' as const, position: { x: it.xy[0] * SCALE, y: it.xy[1] * SCALE }, selected: id === sel,
      data: {
        label: label(id, it), hue: hue(it.family), kind: it.kind, playing: pl.playing === id, dim: !!focused && !focused.has(id),
        unsure: unsure.has(id), novel: !!(votes && votes.clips[novelKey(id, it)] > 0), bad: !!(votes && votes.clips[`ok_${id}`] < 0),
      },
    }))
  }, [F, sel, pl.playing, focused, unsure, votes])
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
  const onNodeClick: NodeMouseHandler = useCallback((_, n) => { setSel(n.id); if (pl.playing === n.id) pl.stop(); else play(n.id) }, [pl, play])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === ' ') { e.preventDefault(); if (pl.playing) pl.stop(); else if (sel) play(sel) }
      else if (e.key === '1' || e.key === '2') pl.setLevel((e.key === '1' ? 'mellow' : 'intense') as Level)
      else if (e.key === 'g' || e.key === 'G') answer('good')
      else if (e.key === 'd' || e.key === 'D') answer('bad')
      else if (e.key === 'y' || e.key === 'Y') answer('novel')
      else if (e.key === 'Escape') { pl.stop(); setFocus(null) }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [pl, sel, play, answer])

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
          onPaneClick={() => setSel(null)} nodesDraggable={false} connectionRadius={28} minZoom={0.1} maxZoom={3} fitView proOptions={{ hideAttribution: true }}>
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
        <p className="dim help">Drag from a song to another: they match. Click a link: near duplicate → bad match → none. Click a song to hear it.
          Keys: <kbd>Space</kbd> play <kbd>1</kbd><kbd>2</kbd> mellow / intense <kbd>G</kbd> good <kbd>D</kbd> bad take <kbd>Y</kbd> new family.</p>
        {it && sel ? (
          <section className="fa-sel">
            <div className="lbl">{it.kind === 'shipped' ? 'a shipped song' : it.kind === 'extension' ? 'an extension' : 'a new take'} · family {it.family}{it.conf < 0.3 ? ' · unsure' : ''}</div>
            <div className="nm">{label(sel, it)}</div>
            {it.words && <div className="dim words">{Object.values(it.words).filter(Boolean).map(w => w.replace('{s} ', 'strings ')).join(' · ')}</div>}
            <div className="row">
              <button className="btn" onClick={() => (pl.playing === sel ? pl.stop() : play(sel))}>{pl.playing === sel ? 'Stop' : 'Play'}</button>
              <button className={`btn ${pl.level === 'mellow' ? 'on' : ''}`} onClick={() => pl.setLevel('mellow')}>mellow</button>
              <button className={`btn ${pl.level === 'intense' ? 'on' : ''}`} onClick={() => pl.setLevel('intense')}>intense</button>
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

// The Families graph (2026-10-21, the designer: "what we need is like nodes where you can drag this matches this and
// this matches that and that"). Every song is a dot placed by likeness (music families' map) in its family's colour.
// A family is one group with one root (the sort's family with the designer's answers applied at once), drawn as a star
// round its root, the same from any member. Drag from one song to another: it joins that song's family. Click a link:
// the sort's suggestion confirmed, then a near duplicate, then a bad match (out of the family), then nothing.
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
import { FamilyCard } from './Family'
import { colour, FamilyView, hue, label, NEXT, novelKey, type EdgeKind, type Link, type Ops } from './model'
import { QueueCard } from './Queue'
import SongNode, { type SongNodeType } from './SongNode'
import './families.css'

const nodeTypes = { song: SongNode }
const SCALE = 2.4
/** A link's look: in its family's colour, faint while it's only the sort's suggestion; the selected song's family bright. */
const edgeStyle = (kind: EdgeKind, c: string, lit: boolean): React.CSSProperties =>
  kind === 'bad' ? { stroke: 'var(--bad)', strokeWidth: 1.5, strokeDasharray: '2 4', opacity: 0.7 }
    : kind === 'dup' ? { stroke: 'var(--pick)', strokeWidth: 2, strokeDasharray: '6 4' }
    : kind === 'match' ? { stroke: c, strokeWidth: lit ? 2.2 : 1.6, opacity: lit ? 1 : 0.75 }
    : { stroke: c, strokeWidth: 1, strokeDasharray: '3 4', opacity: lit ? 0.6 : 0.16 }

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

  const vote = useCallback(async (pairs: Ops) => {
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
  /** Songs as the player's queue (the ones it can play), played at once with `play`. */
  const queue = useCallback((ids: string[], play = false) => {
    if (!m || !F) return
    const ok = ids.filter(id => F.items[id]?.src.calm)
    ok.forEach(id => m.ensure(id, F.items[id].src))
    const items = ok.map(id => ({ id, label: label(id, F.items[id]) }))
    if (play) m.playQueue(items); else m.setQueue(items)
  }, [F, m])
  const playQueue = useCallback((ids: string[]) => queue(ids, true), [queue])
  // (two songs or more chosen: they're the queue, in the player's bar at once; one chosen leaves it as it was)
  useEffect(() => { if (picked.length > 1) queue(picked) }, [picked, queue])

  const unsure = useMemo(() => new Set((F?.queue ?? []).filter(q => q.kind !== 'dup').map(q => q.item)), [F])
  const fv = useMemo(() => (votes && F ? new FamilyView(F, votes) : null), [votes, F])
  const focused = useMemo(() => (focus && fv ? new Set(fv.get(focus)?.members ?? []) : null), [focus, fv])
  const nodes: SongNodeType[] = useMemo(() => {
    if (!F) return []
    return Object.entries(F.items).map(([id, it]) => ({
      id, type: 'song' as const, position: { x: it.xy[0] * SCALE, y: it.xy[1] * SCALE }, selected: picked.includes(id),
      data: {
        label: label(id, it), hue: hue(fv?.family(id).id ?? it.family), kind: it.kind, playing: playing === id, root: fv?.rootOf(id) === id && fv.family(id).members.length > 1, dim: !!focused && !focused.has(id),
        unsure: unsure.has(id), novel: !!(votes && votes.clips[novelKey(id, it)] > 0), bad: !!(votes && votes.clips[`ok_${id}`] < 0),
      },
    }))
  }, [F, fv, picked, playing, focused, unsure, votes])
  const edges: Edge[] = useMemo(() => {
    if (!fv) return []
    const selFam = sel ? fv.family(sel).id : null
    return fv.edges().filter(l => showBad || l.kind !== 'bad' || l.a === sel || l.b === sel).map(l => {
      const fid = fv.family(l.a).id
      return { id: `${l.kind}:${l.a}|${l.b}`, source: l.a, target: l.b, sourceHandle: 'c', targetHandle: 'c', type: 'straight', data: { kind: l.kind },
               style: edgeStyle(l.kind, colour(hue(fid)), fid === selFam), interactionWidth: 12 }
    })
  }, [fv, showBad, sel])

  const onConnect = useCallback((c: Connection) => { if (fv && c.source && c.target && c.source !== c.target) void vote(fv.set(c.source, c.target, 'match')) }, [fv, vote])
  const onEdgeClick: EdgeMouseHandler = useCallback((_, e) => {  // (a star's link is its member's: the member is what changes)
    const kind = (e.data as { kind: EdgeKind }).kind
    if (fv) void vote(fv.set(e.source, e.target, NEXT[kind]))
  }, [fv, vote])
  // (React Flow chooses: a click one song, Ctrl-click one more, a Shift-drag box all inside; a click also plays it)
  const onNodesChange = useCallback((changes: NodeChange<SongNodeType>[]) => setPicked(p => {
    let out = p
    for (const c of changes) if (c.type === 'select') out = c.selected ? (out.includes(c.id) ? out : [...out, c.id]) : out.filter(x => x !== c.id)
    return out
  }), [])
  const onNodeClick: NodeMouseHandler = useCallback((e, n) => { setSel(n.id); if (!e.ctrlKey && !e.metaKey && !e.shiftKey) toggle(n.id) }, [toggle])

  /** x against y: x joins y's family (a near duplicate of y, or not), is a bad match for it, or neither. */
  const setLink = useCallback((x: string, y: string, k: Link | null) => {
    if (!F || !fv) return
    void vote(fv.set(x, y, k))
    toast(`${label(x, F.items[x])} ${k === 'match' ? 'is in the family of' : k === 'dup' ? 'is a near duplicate of' : k === 'bad' ? 'is a bad match for' : 'is back to the sort’s guess beside'} ${label(y, F.items[y])}`,
          k === 'bad' ? 'down' : k ? 'check' : 'x')
  }, [F, fv, vote])
  const pairVote = useCallback((a: string, b: string, k: Link | null) => setLink(b, a, k), [setLink])  // (a transition a → b: b against a)
  const out = useCallback((x: string) => { if (fv && F) { void vote(fv.out(x)); toast(`${label(x, F.items[x])} is out of its family`, 'x') } }, [F, fv, vote])
  const confirmAll = useCallback((x: string) => { if (fv) { const f = fv.family(x); void vote(fv.confirmAll(x)); toast(`All ${f.members.length} confirmed in one family`, 'check') } }, [fv, vote])
  const linkAll = useCallback(async () => {
    const ids = m?.queue?.map(q => q.id) ?? []
    if (!fv || ids.length < 2) return
    await vote(fv.merge(ids))
    toast(`${ids.length} songs are one family`, 'check')
  }, [fv, m, vote])
  const drop = useCallback((id: string) => {
    if (!m?.queue) return
    setPicked(p => p.filter(x => x !== id))
    m.setQueue(m.queue.filter(q => q.id !== id))
  }, [m])

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

  // (the player's keys are in its bar: Space here plays the song chosen, when nothing plays and there's no queue)
  useKeys(k => {
    if (k === ' ' && sel && !m?.playing && !m?.queue) { play(sel); return true }
    if (k === 'q' && m?.queue) { m.playQueue(m.queue); return true }
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
    if (fid && fv?.get(fid)) requestAnimationFrame(() => flow.fitView({ nodes: fv.get(fid)!.members.map(id => ({ id })), duration: 400, padding: 0.3 }))
    else requestAnimationFrame(() => flow.fitView({ duration: 400 }))
  }

  if (fam.error && !F) return <div className="fa-empty">Couldn't read the families: {fam.error}. Run <code>soundlab music families</code>.</div>
  if (!F || !votes || !fv) return <div className="fa-empty">Reading the families…</div>
  const it = sel ? F.items[sel] : null
  const fams = fv.families().filter(f => f.members.length > 1)
  /** A family's most common leads (its name in the list). */
  const leads = (ms: string[]) => { const n = new Map<string, number>(); ms.forEach(x => n.set(F.items[x].lead, (n.get(F.items[x].lead) ?? 0) + 1)); return [...n].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]).join(', ') }

  return (
    <div className="fa">
      <div className="fa-graph">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onConnect={onConnect} onEdgeClick={onEdgeClick} onNodeClick={onNodeClick}
          onNodesChange={onNodesChange} multiSelectionKeyCode={['Control', 'Meta']} onPaneClick={() => setSel(null)} nodesDraggable={false} connectionRadius={28} minZoom={0.1} maxZoom={3} fitView proOptions={{ hideAttribution: true }}>
          <Background color="#1b1e27" gap={28} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable bgColor="#12141a" nodeColor={n => colour((n.data as { hue: number }).hue, 55)} maskColor="rgba(10,11,15,.7)" />
        </ReactFlow>
      </div>
      <aside className="fa-side">
        <div className="lbl">{Object.keys(F.items).length} songs · {fams.length} families · sorted {F.made}</div>
        <div className="row">
          <button className="btn" onClick={resort} disabled={sorting}>{sorting ? 'Sorting…' : 'Re-sort now'}</button>
          <button className={`btn ${showBad ? 'on' : ''}`} onClick={() => setShowBad(b => !b)}>Bad matches</button>
        </div>
        <p className="dim help">Each family is a star round its root: faint lines are the sort's guesses, solid ones you confirmed. Drag from a song to another: it
          joins that song's family. Click a line: confirmed → near duplicate → out (a bad match) → none. Click a song to hear it;
          Shift-drag a box or Ctrl-click to choose several, then <kbd>Q</kbd> plays them in turn and <kbd>M</kbd> <kbd>N</kbd> <kbd>B</kbd> vote on each transition.
          Keys: <kbd>Space</kbd> play <kbd>1</kbd><kbd>2</kbd> mellow / intense <kbd>G</kbd> good <kbd>D</kbd> bad take <kbd>Y</kbd> new family.</p>
        {m?.queue && <QueueCard F={F} fv={fv} m={m} onVote={pairVote} onMerge={() => void linkAll()} onDrop={drop} onClear={() => { setPicked([]); m.setQueue(null) }} />}
        {it && sel ? (
          <section className="fa-sel">
            <div className="lbl">{it.kind === 'shipped' ? 'a shipped song' : it.kind === 'extension' ? 'an extension' : 'a new take'}</div>
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
            <FamilyCard F={F} fv={fv} sel={sel} playing={playing} onPlay={o => { setSel(o); play(o) }} onSet={setLink} onOut={out} onConfirmAll={confirmAll} onQueue={playQueue} />
          </section>
        ) : <p className="dim">Click a song to hear it and see its links.</p>}
        <div className="lbl famh">families</div>
        <div className="fa-fams">
          {focus && <button className="famb on" onClick={() => focusOn(null)}>All families ×</button>}
          {fams.map(f => {
            const sure = f.members.slice(1).filter(x => fv.relation(x, f.root)).length, shipped = f.members.filter(x => F.items[x].kind === 'shipped').length
            return (
              <button key={f.id} className={`famb ${focus === f.id ? 'on' : ''}`} onClick={() => focusOn(focus === f.id ? null : f.id)}>
                <span className="dot" style={{ background: colour(hue(f.id)) }} />
                <b>{f.members.length}</b> {leads(f.members)}<span className="dim">{shipped ? ` · ${shipped} shipped` : ''}{sure ? ` · ${sure} confirmed` : ''}</span>
              </button>
            )
          })}
        </div>
      </aside>
    </div>
  )
}

export default function FamiliesPage() {
  return <ReactFlowProvider><Graph /></ReactFlowProvider>
}

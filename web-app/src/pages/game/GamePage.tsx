// The game (2026-10-21, the designer: "this app should allow you to sync with a game's source as a folder and maybe
// include json/code/docs ... so the game knows how to plug it in. It should be agnostic"): the folder the lab keeps in
// the game. Audio goes over a batch at a time ("when you are happy with a big ol' batch, you can move it over to the
// source, optionally keep a local copy, and have your next batch separate and local. Those tracks would be shipped"):
// the songs ready to ship, by scene, each to hear and to leave out; what's in the game already; the manifest, the walk
// and the docs, written for what's shipped. Beside it, the README the game gets. Nothing is written but by a button.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import type { DataPlan, SyncPlan, SyncSong } from '../../api/types'
import { useFamilies, useProject } from '../../data/resources'
import { useEngine } from '../../player/hooks'
import { usePlayer } from '../../player/store'
import { Icon } from '../../shell/Icon'
import { toast } from '../../shell/toast'
import { vote } from '../../state/votes'
import { Energy } from '../../ui/Energy'
import { Split } from '../../ui/Split'
import { colour, hue } from '../families/model'
import './game.css'

const mb = (b: number) => (!b ? '0 MB' : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)
const STATE = { new: 'new', changed: 'changed', same: 'in sync', remove: 'to remove' } as const
const KIND: Record<string, string> = { shipped: 'promoted', candidate: 'kept take', trial: 'trial take', extension: 'extension' }
/** Where the vote that decides a song was given (soundlab/music/verdict.py's keys). */
const WHERE = (k: string) => k.startsWith('mesh_') ? 'the Music page' : k.endsWith('.mellow') ? 'the Songs page (mellow)' : k.endsWith('.intense') ? 'the Songs page (intense)'
  : k.startsWith('ok_') ? 'Families or here' : k.startsWith('novel_') ? 'the Trial page' : k.startsWith('link_') ? 'Families (belongs with)' : 'a vote'
const day = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'just now')
/** day.any.war.k3.close → war k3 · day */
const nameOf = (id: string) => { const p = id.split('.'); return p.length >= 4 ? { title: `${p[2]} ${p[3]}`, sub: p[0] } : { title: id, sub: '' } }
const bySceneOf = <T extends SyncSong>(xs: T[]) => {
  const m = new Map<string, T[]>()
  for (const x of xs) { const k = x.scene ?? 'none'; m.set(k, [...(m.get(k) ?? []), x]) }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
}

export default function GamePage() {
  const project = useProject()?.name ?? 'the game', F = useFamilies().data, m = usePlayer().m
  useEngine(m)
  const [plan, setPlan] = useState<SyncPlan | null>(null), [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<'ship' | 'sync' | null>(null), [left, setLeft] = useState<Set<string>>(new Set())
  const [keep, setKeep] = useState(() => localStorage.getItem('ship.keep') !== '0'), [showIn, setShowIn] = useState(false)
  const load = () => api.syncPlan().then(setPlan).catch(e => setErr(String(e)))
  const [data, setData] = useState<DataPlan | null>(null)
  useEffect(() => { void load(); api.dataPlan().then(setData).catch(() => {}) }, [])
  const shareData = async () => {
    try { setData(await api.shareData()); toast('Your decisions are in the game’s folder, to commit when you like', 'check') } catch (e) { toast(`Couldn't share: ${e}`, 'x') }
  }
  const ready = plan?.ready ?? [], chosen = useMemo(() => ready.filter(r => !left.has(r.id)), [ready, left])
  const play = (id: string) => {
    if (!m) return
    if (m.playing && m.tag === id) { m.stop(); return }
    const src = F?.items[id]?.src
    if (!m.jd.track(id) && src) m.ensure(id, src as Record<string, string>)
    m.playSong(id)
  }
  // (as the game: the manifest the game would have with the batch shipped, walked as the game walks it)
  const [loading, setLoading] = useState(false), asGame = !!m?.playing && !!m.game
  const playGame = async () => {
    if (!m) return
    if (asGame) { m.stop(); return }
    setLoading(true)
    try { m.playGame(await api.syncPreview(chosen.map(r => r.id))) } catch (e) { toast(`Couldn't play it as the game: ${e}`, 'x') }
    setLoading(false)
  }
  // (a song's thumb, binary: its latest thumb anywhere decides, so a thumb down here replaces an earlier thumb up)
  const thumb = async (id: string, v: 1 | -1) => {
    try { await vote(`ok_${id}`, v); await load(); toast(v > 0 ? 'In: it ships, and the walk plays it' : "Out: it won't ship, and the walk leaves it out", v > 0 ? 'up' : 'down') }
    catch (e) { toast(`Couldn't save the thumb: ${e}`, 'x') }
  }
  const Thumbs = ({ id, v }: { id: string; v: number }) => (
    <span className="gm-th">
      <button className={v > 0 ? 'on up' : ''} title={v > 0 ? 'In: its latest thumb is up' : 'Thumb up: in the game (it replaces any thumb down, wherever it was given)'} onClick={() => v <= 0 && void thumb(id, 1)}><Icon name="up" /></button>
      <button className={v < 0 ? 'on down' : ''} title={v < 0 ? 'Out: its latest thumb is down' : 'Thumb down: out of the game (it replaces any thumb up, wherever it was given)'} onClick={() => v >= 0 && void thumb(id, -1)}><Icon name="down" /></button>
    </span>
  )
  const [showOut, setShowOut] = useState(false)
  const toggle = (ids: string[], on: boolean) => setLeft(s => { const n = new Set(s); for (const i of ids) { if (on) n.delete(i); else n.add(i) } return n })
  const ship = async () => {
    setBusy('ship')
    try {
      const p = await api.ship(chosen.map(r => r.id), keep)
      setPlan(p); setLeft(new Set())
      toast(`Shipped ${chosen.length} song${chosen.length > 1 ? 's' : ''} into the game`, 'check')
    } catch (e) { toast(`Couldn't ship: ${e}`, 'x') }
    setBusy(null)
  }
  const sync = async () => {
    setBusy('sync')
    try { setPlan(await api.sync()); toast("The game's manifest and docs are up to date", 'check') } catch (e) { toast(`Couldn't write: ${e}`, 'x') }
    setBusy(null)
  }
  if (err && !plan) return <div className="empty-state"><div><b>Couldn't read the game's folder</b>{err}</div></div>
  if (!plan) return <div className="empty-state"><div className="lib-loading" /></div>

  const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null)
  const inBytes = plan.bytes, readyBytes = chosen.reduce((a, r) => a + r.bytes, 0), lost = plan.in_game.filter(s => s.missing.length), walked = plan.in_game.filter(s => s.walked).length
  return (
    <Split id="game" initial={600} max={800} left={
      <div className="gm">
        <header className="gm-head">
          <span className="lbl">The game's folder</span>
          <h2>{project}</h2>
          <code className="gm-folder" title="The folder the lab keeps in the game: nothing outside it is written">{plan.folder}</code>
          <div className={`gm-status ${!plan.synced ? 'never' : plan.changes ? 'behind' : 'ok'}`}>
            <i />{!plan.synced ? 'Nothing in the game yet' : plan.changes ? `The manifest is behind the lab (written ${when(plan.synced)})` : `Up to date · ${when(plan.synced)}`}
          </div>
        </header>

        <div className="gm-tiles">
          <div className="tile"><span className="lbl">In the game</span><b>{plan.in_game.length}<small> songs</small></b><span className="sub">{mb(inBytes)}</span></div>
          <div className="tile"><span className="lbl">Walked</span><b>{plan.scenes}<small> scenes</small></b><span className="sub">{plan.cuts} seamless cuts</span></div>
          <div className="tile hot"><span className="lbl">Ready to ship</span><b>{ready.length}<small> songs</small></b><span className="sub">{mb(ready.reduce((a, r) => a + r.bytes, 0))}</span></div>
          <div className="tile"><span className="lbl">Local</span><b>{plan.local}<small> takes</small></b><span className="sub">not kept yet</span></div>
        </div>

        <div className={`gm-hear ${asGame ? 'on' : ''}`}>
          <button className="btn primary" disabled={loading || (!walked && !chosen.length)} onClick={() => void playGame()}
            title={asGame ? 'Stop playing as the game' : "What the game would play once this batch ships: the songs in the game and the batch, walked scene by scene by the rules the game gets from your Mixer settings (Stay, Joins, Bass swap, Between scenes, Tail, Match levels), at the game's gains. None of the lab's extras: no bed, no siblings, stems or fills, no new takes outside the batch"}
            data-tip-title="Play as the game" data-tip-icon="game">
            <Icon name={loading ? 'refresh' : asGame ? 'stop' : 'play'} />{loading ? 'Loading…' : asGame ? 'Stop' : 'Play as the game'}
          </button>
          <div className="gm-hear-t">
            <b>{asGame && m?.game ? `Playing as the game · ${m.game.songs} songs in ${m.game.scenes} scenes` : `Hear what the game would play: ${walked + chosen.length} songs`}</b>
            <span>{asGame ? 'By its rules, with nothing the lab adds. Rate blocks and transitions on the timeline as usual; the session is marked as the game.'
              : `${walked ? `the ${walked} in the game` : 'nothing in the game yet'}${chosen.length ? `${walked ? ' and' : ','} the ${chosen.length} ticked below` : ''}, by the game's rules (from your Mixer settings), with no bed, siblings, stems or fills`}</span>
          </div>
        </div>

        <section className="gm-sec">
          <div className="gm-sh"><span className="lbl">Ready to ship · the batch</span>
            {ready.length > 0 && <span className="gm-sel"><button title="Every song ready goes in the batch" onClick={() => setLeft(new Set())}>all</button><button title="None: then tick the ones to ship" onClick={() => setLeft(new Set(ready.map(r => r.id)))}>none</button></span>}
          </div>
          {!ready.length ? (
            <p className="gm-hint">Nothing is ready. Songs get ready when you keep them: Keep, New family or Belongs with in the Inbox, or a like on the Music page. The rest stay local, your next batch.</p>
          ) : (
            <div className="gm-batch">
              {bySceneOf(ready).map(([fid, rs]) => {
                const on = rs.filter(r => !left.has(r.id)).length
                return (
                  <div key={fid} className="gm-scene">
                    <label className="gm-sc-h">
                      <input type="checkbox" checked={on === rs.length} ref={el => { if (el) el.indeterminate = on > 0 && on < rs.length }} onChange={e => toggle(rs.map(r => r.id), e.target.checked)} />
                      <span className="sw" style={{ background: fid === 'none' ? 'var(--line-3)' : colour(hue(fid)) }} />
                      <b>{fid === 'none' ? 'No scene' : `Scene ${fid.replace(/^f/, '')}`}</b>
                      <span className="dim">{[...new Set(rs.map(r => r.lead).filter(Boolean))].slice(0, 2).join(' · ')}</span>
                      <span className="n">{on}/{rs.length}</span>
                    </label>
                    {rs.sort((a, b) => a.energy - b.energy).map(r => {
                      const n = nameOf(r.id), playing = m?.playing && m.tag === r.id
                      return (
                        <div key={r.id} className={`gm-song ${left.has(r.id) ? 'out' : ''} ${playing ? 'playing' : ''}`}>
                          <input type="checkbox" checked={!left.has(r.id)} onChange={e => toggle([r.id], e.target.checked)} />
                          <button className="gm-play" title={playing ? 'Stop' : 'Hear it'} onClick={() => play(r.id)}><Icon name={playing ? 'stop' : 'play'} /></button>
                          <span className="nm"><b>{n.title}</b><span>{n.sub}</span></span>
                          <span className={`gm-kind k-${r.kind}`}>{KIND[r.kind] ?? r.kind}</span>
                          <Thumbs id={r.id} v={r.verdict} />
                          <Energy value={r.energy} />
                          <span className="gm-size">{r.missing.length ? <span className="bad">missing</span> : mb(r.bytes)}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
          {ready.length > 0 && (
            <div className="gm-go">
              <label className="gm-keep"><input type="checkbox" checked={keep} onChange={e => { setKeep(e.target.checked); localStorage.setItem('ship.keep', e.target.checked ? '1' : '0') }} />
                Keep a local copy<span className="dim"> · {keep ? 'the lab keeps its own audio of what ships' : "the lab's own audio of what ships goes; it plays them from the game's folder (the game's own files are never touched)"}</span></label>
              <button className="btn primary" disabled={!!busy || !chosen.length || chosen.some(r => r.missing.length)} title="Ship the batch: their audio into the game's folder, recorded in shipped.json, and the manifest, walk and docs written for them" data-tip-title="Ship into the game" onClick={() => void ship()}>
                <Icon name={busy === 'ship' ? 'refresh' : 'check'} />{busy === 'ship' ? 'Shipping…' : `Ship ${chosen.length} song${chosen.length === 1 ? '' : 's'} into the game · ${mb(readyBytes)}`}
              </button>
              <span className="gm-hint">Their mellow and intense audio goes into {plan.folder.split('/').slice(-2).join('/')}/music, and the manifest walks them.</span>
            </div>
          )}
        </section>

        {plan.out.length > 0 && (
          <section className="gm-sec">
            <button className="gm-sh link" title={showOut ? 'Hide the songs left out' : 'Show the songs left out: their latest thumb is down'} onClick={() => setShowOut(o => !o)}><span className="lbl">Left out · {plan.out.length} thumbed down</span><Icon name={showOut ? 'up' : 'down'} /></button>
            {showOut && (
              <div className="gm-batch">
                {plan.out.map(r => {
                  const n = nameOf(r.id)
                  return (
                    <div key={r.id} className="gm-song left">
                      <button className="gm-play" title="Hear it" onClick={() => play(r.id)}><Icon name="play" /></button>
                      <span className="nm"><b>{n.title}</b><span>{n.sub}</span></span>
                      <span className="gm-kind">{r.by ? `👎 on ${WHERE(r.by.key)} · ${day(r.by.at)}` : 'thumbed down'}</span>
                      <Thumbs id={r.id} v={r.verdict} />
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

        <section className="gm-sec">
          <button className="gm-sh link" title={showIn ? 'Hide the songs in the game' : 'Show the songs in the game, by scene'} onClick={() => setShowIn(o => !o)}><span className="lbl">In the game · {plan.in_game.length} songs</span><Icon name={showIn ? 'up' : 'down'} /></button>
          {lost.length > 0 && <p className="gm-warn"><Icon name="flag" />{lost.length} shipped song{lost.length > 1 ? 's have' : ' has'} lost audio in the folder: ship {lost.length > 1 ? 'them' : 'it'} again</p>}
          {showIn && (
            <div className="gm-batch">
              {bySceneOf(plan.in_game).map(([fid, rs]) => (
                <div key={fid} className="gm-scene">
                  <div className="gm-sc-h"><span className="sw" style={{ background: fid === 'none' ? 'var(--line-3)' : colour(hue(fid)) }} /><b>{fid === 'none' ? 'No scene' : `Scene ${fid.replace(/^f/, '')}`}</b><span className="n">{rs.length}</span></div>
                  {rs.map(r => {
                    const n = nameOf(r.id)
                    return (
                      <div key={r.id} className={`gm-song in ${r.walked ? '' : 'out'}`}>
                        <button className="gm-play" title="Hear it" onClick={() => play(r.id)}><Icon name="play" /></button>
                        <span className="nm"><b>{n.title}</b><span>{n.sub}</span></span>
                        <span className="gm-kind">{r.walked ? `shipped ${when(r.at)}` : r.verdict < 0 ? 'not walked: thumbed down' : 'not walked'}</span>
                        <Thumbs id={r.id} v={r.verdict} />
                        <span className="gm-size">{r.missing.length ? <span className="bad">audio gone</span> : mb(r.bytes)}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </section>

        {data?.game && (
          <section className="gm-sec">
            <span className="lbl">Your decisions</span>
            <p className="gm-hint">Votes, cues, notes, settings and sessions stay in the lab ({data.local.split('/').slice(-3).join('/')}), so voting never touches the game's repo. Share them into the game's folder ({data.game.split('/').slice(-3).join('/')}) only when you want them there: to commit, or to hand to someone.</p>
            <div className="gm-go row">
              <button className="btn" disabled={!data.differ} title="Copy the lab's data files that differ into the game's folder (soundlab data share)" data-tip-title="Share your decisions" data-tip-icon="link" onClick={() => void shareData()}>
                <Icon name="link" />{data.differ ? `Share ${data.differ} file${data.differ > 1 ? 's' : ''} into the game` : 'The game has the same'}
              </button>
              {data.rows.some(r => r.state === 'only in the game') && <span className="gm-hint">The game's folder has files the lab doesn't: soundlab data pull takes them</span>}
            </div>
          </section>
        )}

        <section className="gm-sec">
          <span className="lbl">The manifest, the walk and the docs</span>
          <div className="gm-files">
            {plan.rows.map(r => (
              <div key={r.path} className={`gm-file s-${r.state}`}>
                <Icon name={r.path.endsWith('.md') ? 'layers' : r.path.startsWith('glues/') ? 'wave' : 'save'} /><code>{r.path}</code><span className="gm-what">{ABOUT[r.path] ?? ''}</span><span className="gm-state">{STATE[r.state]}</span>
              </div>
            ))}
          </div>
          <div className="gm-go row">
            <button className="btn" disabled={!!busy || !plan.changes} title="Write the manifest, the walk, the docs and the schema into the game's folder: only what differs" data-tip-title="Update the game's manifest" onClick={() => void sync()}><Icon name={busy === 'sync' ? 'refresh' : 'save'} />{plan.changes ? `Write ${plan.changes} file${plan.changes > 1 ? 's' : ''} into the game` : 'Up to date'}</button>
            <span className="gm-hint">{plan.changes ? 'A cue, a vote or a setting changed what the game walks. Shipping writes these too.' : "They describe what's in the game now."}</span>
            <button className="btn ghost sm" title="Check again: read the game's folder and the lab's data again" onClick={() => { setPlan(null); void load() }}><Icon name="refresh" />Check again</button>
          </div>
        </section>
      </div>
    } right={
      <div className="gm-readme">
        <div className="gm-readme-bar"><span className="lbl">README.md · what the game gets</span></div>
        <article className="md">{markdown(plan.readme)}</article>
      </div>
    } />
  )
}

const ABOUT: Record<string, string> = {
  'soundlab.json': 'the manifest: grid, rules, songs, the graph',
  'README.md': 'how to plug it in, any engine',
  'walk.js': 'the walk, as the Mixer runs it',
  'walk.d.ts': "the walk's types",
  'soundlab.schema.json': "the manifest's schema",
}

/** A little markdown: headings, paragraphs, lists, tables, code blocks, bold and inline code (the README's own). */
function markdown(text: string): ReactNode[] {
  const out: ReactNode[] = [], lines = text.split('\n')
  const inline = (s: string, k: string | number): ReactNode => (
    <span key={k}>{s.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((p, i) => p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p)}</span>
  )
  for (let i = 0; i < lines.length;) {
    const l = lines[i]
    if (l.startsWith('```')) {
      const body: string[] = []
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i])
      out.push(<pre key={i}><code>{body.join('\n')}</code></pre>); i++
    } else if (/^#{1,3} /.test(l)) {
      const h = l.match(/^#+/)![0].length, t = inline(l.replace(/^#+ /, ''), 0)
      out.push(h === 1 ? <h1 key={i}>{t}</h1> : h === 2 ? <h2 key={i}>{t}</h2> : <h3 key={i}>{t}</h3>); i++
    } else if (l.startsWith('|')) {
      const rows: string[][] = []
      for (; i < lines.length && lines[i].startsWith('|'); i++) if (!/^\|[\s|:-]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split('|').map(c => c.trim()))
      out.push(<table key={i}><thead><tr>{rows[0].map((c, j) => <th key={j}>{inline(c, j)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c, k)}</td>)}</tr>)}</tbody></table>)
    } else if (/^\s*(-|\d+\.) /.test(l)) {
      const ordered = /^\d+\./.test(l.trim()), items: { text: string; sub: string[] }[] = []
      for (; i < lines.length && (/^\s*(-|\d+\.) /.test(lines[i]) || (/^\s{3,}\S/.test(lines[i]) && items.length)); i++) {
        if (/^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1].sub.push(lines[i].trim().replace(/^(-|\d+\.) /, ''))
        else items.push({ text: lines[i].trim().replace(/^(-|\d+\.) /, ''), sub: [] })
      }
      const li = items.map((it, j) => <li key={j}>{inline(it.text, 0)}{it.sub.length > 0 && <ul>{it.sub.map((s, k) => <li key={k}>{inline(s, k)}</li>)}</ul>}</li>)
      out.push(ordered ? <ol key={i}>{li}</ol> : <ul key={i}>{li}</ul>)
    } else if (l.trim()) {
      const para: string[] = []
      for (; i < lines.length && lines[i].trim() && !/^(#|\||```|\s*(-|\d+\.) )/.test(lines[i]); i++) para.push(lines[i])
      out.push(<p key={i}>{inline(para.join(' '), 0)}</p>)
    } else i++
  }
  return out
}

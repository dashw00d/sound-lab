// The set: parts cut from any songs (bars s..s+3) that go together in any order. Its cards (hear one alone, reorder,
// take out), the grid of what goes into what (row, then column: click to hear it as the player would), the glues, and
// where parts come from: starter sets that already go together, what fits everything already in, any song's parts.
// Saved sets (data/mixes.json) are the designer's: named, loaded and deleted here only.
import { useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Mixes } from '../../api/types'
import type { Mixer } from '../../mixer/engine/mixer'
import { grade, LEN, name, pkey } from '../../mixer/judge'
import type { Part } from '../../mixer/types'
import { Icon } from '../../shell/Icon'
import { toast } from '../../shell/toast'
import { useVotes } from '../../state/votes'
import { useFrame } from './hooks'

const overlaps = (a: Part, b: Part) => a.track === b.track && Math.abs(a.start - b.start) < LEN
const Num = ({ v }: { v: number | null }) => (v == null || !isFinite(v) ? null : <span className={grade(v)}>{v.toFixed(2)}</span>)

export function SetBuilder({ m, mixes, setMixes }: { m: Mixer; mixes: Mixes; setMixes: (x: Mixes) => void }) {
  useVotes()  // (a vote from the lane or training: the grid shows it)
  const set = m.prefs.set, mx = m.matrix(), jd = m.jd
  const label = (p: Part) => jd.label(p)
  const both = (a: Part, b: Part) => { const x = mx.joinOf(a, b), y = mx.joinOf(b, a); return x == null || y == null ? null : Math.min(x, y) }
  const put = (s: Part[]) => m.setPrefs({ set: s })
  const add = (p: Part) => { if (set.some(x => pkey(x) === pkey(p))) return; put([...set, { track: p.track, start: p.start }]); toast(`Added ${label(p)}`, 'plus') }

  // (the part playing: lit, with how far through Stay its run is; drawn each frame, not through React)
  const cards = useRef(new Map<string, HTMLDivElement>())
  useFrame(() => {
    const c = m.playing ? m.nowChunk() : null, k = c?.run?.entry ? pkey(c.run.entry) : null
    cards.current.forEach((el, key) => {
      const on = key === k, bar = el.querySelector<HTMLDivElement>('.prog div')
      el.classList.toggle('on', on)
      if (bar) bar.style.width = on && c?.run ? `${Math.min(100, (100 * (c.run.played ?? 0)) / Math.max(m.prefs.stay, c.run.played ?? 1))}%` : '0'
    })
  })

  return (
    <section className="mx-set">
      <SetHead m={m} mixes={mixes} setMixes={setMixes} />
      {!set.length ? <div className="mx-empty"><b>No parts yet</b><p>Start from one of the sets below, or add parts from a song.</p></div> : (
        <div className="mx-setwrap">
          <div className="pcards">
            {set.map((p, i) => {
              const t = jd.track(p.track)!, loud = t.measure?.loud.calm ?? [], lo = Math.min(...loud), hi = Math.max(...loud)
              const w = set.length > 1 ? Math.min(...set.filter(o => o !== p).map(o => both(p, o) ?? 9)) : null
              const move = (d: number) => { const s = [...set]; s.splice(i + d, 0, s.splice(i, 1)[0]); put(s) }
              return (
                <div key={pkey(p)} className="pcard" ref={el => { if (el) cards.current.set(pkey(p), el); else cards.current.delete(pkey(p)) }}>
                  <span className="num">{i + 1}</span>
                  <div className="pn"><b>{name(t)}</b><small>bars {p.start}–{p.start + LEN - 1}{w != null && w < 9 && <> · weakest join <Num v={w} /></>}</small></div>
                  <span className="strip">{loud.map((v, k) => <i key={k} className={k + 1 >= p.start && k + 1 < p.start + LEN ? 'in' : ''} style={{ height: `${(22 + (78 * (v - lo)) / Math.max(1e-6, hi - lo)).toFixed(0)}%` }} />)}</span>
                  <span className="acts">
                    <button className="tb" title="Hear this part alone" onClick={() => m.playPart(p)}><Icon name="play" /></button>
                    <button className="tb" title="Earlier in the order" disabled={!i} onClick={() => move(-1)}><Icon name="left" /></button>
                    <button className="tb" title="Later in the order" disabled={i === set.length - 1} onClick={() => move(1)}><Icon name="right" /></button>
                    <button className="tb" title="Take it out of the set" onClick={() => put(set.filter(x => x !== p))}><Icon name="x" /></button>
                  </span>
                  <div className="prog"><div /></div>
                </div>
              )
            })}
            <Glues m={m} />
          </div>
          {set.length > 1 && <JoinGrid m={m} />}
        </div>
      )}
      {set.length ? <Suggestions m={m} onAdd={add} /> : <Starters m={m} />}
      <Browse m={m} onAdd={add} />
    </section>
  )
}

function SetHead({ m, mixes, setMixes }: { m: Mixer; mixes: Mixes; setMixes: (x: Mixes) => void }) {
  const p = m.prefs, names = Object.keys(mixes).sort(), nameRef = useRef<HTMLInputElement>(null)
  const save = async () => {
    const nm = p.name.trim()
    if (!nm) { toast('Name the set first'); nameRef.current?.focus(); return }
    try { setMixes(await api.saveMix(nm, p.set.map(x => ({ track: x.track, start: x.start, bars: LEN })))); toast(`Saved “${nm}”`, 'save') }
    catch (e) { toast(`Couldn't save: ${(e as Error).message}`, 'x') }
  }
  const del = async (k: string) => {
    if (!confirm(`Delete the saved set “${k}”?`)) return
    try { setMixes(await api.saveMix(k, null)) } catch (e) { toast(`Couldn't delete: ${(e as Error).message}`, 'x') }
  }
  const load = (k: string) => m.setPrefs({ name: k, set: mixes[k].parts.map(x => ({ track: x.track, start: x.start })).filter(x => m.jd.track(x.track)) })
  return (
    <div className="mx-sethead">
      <h3>The set · {p.set.length} part{p.set.length === 1 ? '' : 's'}{p.scope === 'all' && <span className="dim"> · not used while drawing from everything</span>}</h3>
      <input ref={nameRef} placeholder="Name this set" value={p.name} onChange={e => m.setPrefs({ name: e.target.value })} />
      <button className="btn" disabled={!p.set.length} onClick={() => void save()}><Icon name="save" />Save</button>
      <button className="btn ghost" disabled={!p.set.length} onClick={() => { if (m.playing) m.stop(); m.setPrefs({ set: [], name: '' }) }}><Icon name="x" />Clear</button>
      {names.map(k => (
        <span key={k} className={`chip mixc ${k === p.name ? 'on' : ''}`}>
          <button onClick={() => load(k)}>{k} · {mixes[k].parts.length}</button>
          <button title="Delete this saved set" onClick={() => void del(k)}><Icon name="x" /></button>
        </span>
      ))}
    </div>
  )
}

function JoinGrid({ m }: { m: Mixer }) {
  const set = m.prefs.set, mx = m.matrix(), glue = m.prefs.glue !== 'off'
  return (
    <div className="jbox">
      <div className="lbl">What goes into what <span className="dim">(row, then column · green: as smooth as a natural bar step)</span></div>
      <div className="jgrid" style={{ gridTemplateColumns: `28px repeat(${set.length}, 34px)` }}>
        <span className="h" title="Row, then column">→</span>
        {set.map((_, j) => <span key={j} className="h">{j + 1}</span>)}
        {set.map((a, i) => [
          <span key={`h${i}`} className="h">{i + 1}</span>,
          ...set.map((b, j) => {
            if (i === j) return <span key={j} className="c self">·</span>
            const v = mx.joinOf(a, b) ?? 0, jv = m.jd.joinVote(a.track, a.start + LEN - 1, b), via = m.viaGlue(a, b)
            return (
              <button key={j} className={`c ${grade(v)} ${jv > 0 ? 'liked' : jv < 0 ? 'disliked' : ''}`}
                title={`${m.jd.label(a)} → ${m.jd.label(b)}: ${v.toFixed(2)} · click: hear it as the player would${glue ? ' (through the glue where it would come in)' : ''} · Shift-click: ${via ? 'straight' : 'through the glue'}`}
                onClick={e => m.playJoin(a, b, e.shiftKey ? !via : via)}>{Math.round(100 * v)}</button>
            )
          }),
        ])}
      </div>
    </div>
  )
}

function Glues({ m }: { m: Mixer }) {
  const gl = [...new Set(m.prefs.set.map(p => m.jd.glueOf(p.track)).filter((g): g is string => !!g))], bars = m.prefs.glueBars
  if (!gl.length) return <div className="glues dim">No glues yet: run <code>soundlab music glues</code>.</div>
  return (
    <div className="glues">
      <span className="lbl">Glues</span>
      {gl.map(g => {
        const src = m.lib.glues[g].source
        return <button key={g} className="chip glue" title={`Hear it alone: ${bars} bar${bars > 1 ? 's' : ''}, frozen from ${src.track} bar ${src.bar}`} onClick={() => m.playGlue(g)}><Icon name="play" />{m.jd.glueName(g)}</button>
      })}
    </div>
  )
}

function Starters({ m }: { m: Mixer }) {
  const st = m.matrix().starters()  // (worked out once per matrix)
  const style = (p: Part) => (m.jd.track(p.track)?.key ?? '').split('~')[1] || 'plain'
  return (
    <>
      <h3>Start from a set that already goes together</h3>
      <div className="starters">
        {st.map((s, i) => (
          <button key={i} className="starter" onClick={() => m.setPrefs({ set: s.parts.map(p => ({ ...p })), name: '' })}>
            <b>{s.parts.length} parts · {s.parts.length} songs</b>
            <small>joins {s.mean.toFixed(2)} on average, every pair both ways ≥ 0.75</small>
            <span>{[...new Set(s.parts.map(style))].join(', ')}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function Suggestions({ m, onAdd }: { m: Mixer; onAdd: (p: Part) => void }) {
  const set = m.prefs.set, mx = m.matrix(), key = set.map(pkey).join()
  const sg = useMemo(() => mx.suggestions(set), [mx, key])
  return (
    <>
      <h3>Fits everything in the set <span className="dim">· its worst join, both ways, with any part already in</span></h3>
      <div className="sugg">
        {sg.map(o => (
          <div key={pkey(o.p)} className="srow">
            <span className={`fit ${grade(o.fit)}`}>{o.fit.toFixed(2)}</span>
            <div className="pn"><b>{name(m.jd.track(o.p.track)!)}</b><small>bars {o.p.start}–{o.p.start + LEN - 1} · weakest with {m.jd.label(o.weak)}</small></div>
            <button className="tb" title="Hear it alone" onClick={() => m.playPart(o.p)}><Icon name="play" /></button>
            <button className="tb" title="Hear the part it joins worst with, then it" onClick={() => m.playJoin(o.weak, o.p)}><Icon name="arrow" /></button>
            <button className="btn" onClick={() => onAdd(o.p)}><Icon name="plus" />Add</button>
          </div>
        ))}
      </div>
    </>
  )
}

function Browse({ m, onAdd }: { m: Mixer; onAdd: (p: Part) => void }) {
  const jd = m.jd, set = m.prefs.set, mx = m.matrix(), [pick, setPick] = useState(m.prefs.pick)
  const cands = m.prefs.cands
  const songs = useMemo(() => jd.lib.tracks.filter(t => t.measure?.feat && jd.active(t)).sort((a, b) => name(a).localeCompare(name(b))), [jd, cands])
  const t = jd.track(pick), parts: Part[] = t ? Array.from({ length: jd.N - LEN + 1 }, (_, k) => ({ track: t.id, start: k + 1 })) : []
  const fit = (p: Part) => {
    const v = set.filter(x => !overlaps(x, p)).map(x => { const a = mx.joinOf(p, x), b = mx.joinOf(x, p); return a == null || b == null ? 9 : Math.min(a, b) })
    return v.length ? Math.min(...v) : null
  }
  return (
    <>
      <h3>Parts of any song</h3>
      <div className="browse">
        <select value={pick} onChange={e => { setPick(e.target.value); m.setPrefs({ pick: e.target.value }) }}>
          <option value="">Choose a song…</option>
          {songs.map(o => <option key={o.id} value={o.id}>{name(o)}{o.candidate ? ` · new #${o.candidate.rank}` : ''}</option>)}
        </select>
        {parts.map(p => {
          const inSet = set.some(x => pkey(x) === pkey(p)), f = set.length ? fit(p) : null
          return (
            <span key={p.start} className={`bpart ${inSet ? 'on' : ''}`}>
              <button className="tb" title={`Hear bars ${p.start}–${p.start + LEN - 1}`} onClick={() => m.playPart(p)}><Icon name="play" /></button>
              <b>{p.start}–{p.start + LEN - 1}</b>
              {f != null && f < 9 && <Num v={f} />}
              <button className="tb" title="Add to the set" disabled={inSet} onClick={() => onAdd(p)}><Icon name="plus" /></button>
            </span>
          )
        })}
      </div>
    </>
  )
}

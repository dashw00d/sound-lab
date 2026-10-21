// The timeline (2026-10-21, the designer: "a timeline section where you can drag a marker anywhere in what is queued or
// playing ... marker grid, the vote things on top, the thing you drag on top of the footer"). Follow mode, as a DAW:
// the playhead stays put and the music flows past it, a minute behind and half a minute ahead. Bars and beats as a grid,
// every fourth bar timed; each block (a song's visit, a glue, a rest) where it played or will, with its rating on it
// (hover: the five to choose from) and the thumb on the transition after it at the notch between; in a queue, the songs
// after the plan as ghosts. Drag the playhead's handle, or press anywhere on the strip, to play from there; near a
// transition it snaps to 2 bars before it ("just zoomed out and easy to skip to right before transitions").
// It sits between what's playing and the levels, zoomed out: two and a half minutes behind, 45 seconds ahead.
import { useEffect, useRef, useState } from 'react'
import { audio } from '../audio/context'
import type { Mixer } from '../mixer/engine/mixer'
import { Icon } from '../shell/Icon'
import { toast } from '../shell/toast'
import { useFrame } from './hooks'
import { RATING } from './Rating'
import { STARS } from '../mixer/engine/session'
import './timelineStrip.css'

const PAST = 150, AHEAD = 45, HEAD = PAST / (PAST + AHEAD), SNAP = 12
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function TimelineStrip({ m }: { m: Mixer }) {
  const box = useRef<HTMLDivElement>(null), film = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(1000), [scrub, setScrub] = useState<number | null>(null)
  useEffect(() => {
    const b = box.current; if (!b) return
    const ro = new ResizeObserver(() => setW(b.clientWidth)); ro.observe(b); setW(b.clientWidth)
    return () => ro.disconnect()
  }, [])
  const tl = m.timeline(), pps = w / (PAST + AHEAD), headX = w * HEAD, origin = tl.origin
  const xOf = (t: number) => (t - origin) * pps
  useFrame(() => { if (film.current) film.current.style.transform = `translateX(${headX - (audio().currentTime - origin) * pps}px)` })  // (the clock alone, each frame)

  // (the grid: a bar a cell, its beats inside, every fourth bar timed from the walk's start)
  const bars: number[] = []
  if (m.playing) for (let k = 4 * Math.floor((tl.now - PAST - 12 - origin) / tl.barS / 4); k <= Math.ceil((tl.now + AHEAD + 12 - origin) / tl.barS); k += 4) bars.push(k)

  const at = (x: number) => tl.now + (x - headX) / pps
  /** Where a press at x lands: near a transition, 2 bars before it; else the time under it. */
  const target = (x: number): { t: number; snap: boolean } => {
    const near = tl.blocks.filter(b => b.next).map(b => ({ e: b.end, d: Math.abs(xOf(b.end) - (x - headX + (tl.now - origin) * pps)) })).sort((a, b) => a.d - b.d)[0]
    return near && near.d <= SNAP ? { t: near.e - 2 * tl.barS, snap: true } : { t: at(x), snap: false }
  }
  const where = (t: number) => {
    const b = tl.blocks.find(x => x.T <= t && t < x.end)
    if (b) return { kind: 'block' as const, text: `${b.label ?? (b.kind === 'part' ? 'this song' : b.kind)}${b.kind === 'part' ? ` · bar ${b.bar + Math.floor((t - b.T) / tl.barS)}` : ''}`, ahead: t > tl.now }
    const g = tl.ghosts.find(x => x.T <= t && t < x.end)
    if (g) return { kind: 'ghost' as const, text: `${g.label} · from its start`, ahead: true }
    return null
  }
  const drag = (e: React.PointerEvent) => {
    if (!m.playing) return
    e.preventDefault()
    const r = box.current!.getBoundingClientRect(), pos = (ev: { clientX: number }) => Math.max(0, Math.min(w, ev.clientX - r.left))
    setScrub(pos(e))
    const move = (ev: PointerEvent) => setScrub(pos(ev))
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up)
      setScrub(null)
      const { t } = target(pos(ev)), g = tl.ghosts.find(x => x.T <= t && t < x.end)
      if (g && m.queue) { m.playQueue(m.queue, g.qi); return }
      if (Math.abs(pos(ev) - headX) < 4) return  // (a click on the playhead itself: nothing)
      if (!m.seekTo(t)) toast('Nothing to play from there', 'x')
    }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  const tg = scrub == null ? null : target(scrub), sw = tg ? where(tg.t) : null
  return (
    <div className={`tls ${m.playing ? 'live' : ''}`}>
      <div className="tls-track" ref={box} onPointerDown={drag}>
        <div className="tls-film" ref={film}>
          {bars.map(k => (
            <div key={k} className={`tls-bar ${k % 16 === 0 ? 'sixteen' : ''}`} style={{ left: k * tl.barS * pps, width: 4 * tl.barS * pps }}>
              {k % 16 === 0 && k >= 0 && <span className="tls-time">{mmss(k * tl.barS)}</span>}
            </div>
          ))}
          {tl.blocks.map((b, i) => {
            const state = b.end <= tl.now ? 'past' : b.T <= tl.now ? 'cur' : 'next'
            return (
              <div key={b.key} className={`tls-blk k-${b.kind} ${state} ${b.rating ? `r${b.rating}` : ''} h${i % 4}`} style={{ left: xOf(b.T) + 1, width: Math.max(4, (b.end - b.T) * pps - 2) }}
>
                <span className="tls-shape">{b.shape.map((v, k) => <i key={k} style={{ height: `${Math.round(v * 100)}%` }} />)}</span>
                {(b.end - b.T) * pps > 70 && <span className="tls-name">{b.label ?? ''}</span>}
                {b.rating > 0 && <span className={`tls-badge r${b.rating}`}><Icon name={RATING[b.rating].icon} /></span>}
                {b.rated && state !== 'next' && (
                  <span className="tls-tray" onPointerDown={e => e.stopPropagation()}>
                    {[1, 2, 3, 4, 5].map(k => <button key={k} className={`r${k} ${b.rating === k ? 'on' : ''}`} title={STARS[k]} onClick={() => m.star(b.key, k)}><Icon name={RATING[k].icon} /></button>)}
                  </span>
                )}
              </div>
            )
          })}
          {tl.blocks.filter(b => b.next).map(b => (
            <div key={`t${b.key}`} className={`tls-notch ${b.like > 0 ? 'up' : b.like < 0 ? 'down' : ''}`} style={{ left: xOf(b.end) }}>
              <i />
              {b.rated && b.end <= tl.now + 0.01 && <span className="tls-thumbs" onPointerDown={e => e.stopPropagation()}>
                <button className={b.like > 0 ? 'on up' : 'up'} title="Good transition" onClick={() => void m.like(b.key, 1)}><Icon name="up" /></button>
                <button className={b.like < 0 ? 'on down' : 'down'} title="Bad transition" onClick={() => void m.like(b.key, -1)}><Icon name="down" /></button>
              </span>}
            </div>
          ))}
          {tl.ghosts.map(g => <div key={`g${g.qi}`} className="tls-blk ghost" style={{ left: xOf(g.T) + 1, width: Math.max(4, (g.end - g.T) * pps - 2) }}><span className="tls-name">{g.label}</span></div>)}
        </div>
        <div className="tls-fade l" /><div className="tls-fade r" />
        {!m.playing && <div className="tls-idle">Space plays the walk · the timeline follows what plays</div>}
      </div>
      {m.playing && (
        <div className="tls-head" style={{ left: headX }}>
          <span className="tls-knob" onPointerDown={drag} title="Drag to play from anywhere in what played or is planned"><i /><i /><i /></span>
        </div>
      )}
      {scrub != null && (
        <div className={`tls-scrub ${sw ? '' : 'none'} ${tg?.snap ? 'snap' : ''}`} style={{ left: tg?.snap ? headX + (tg.t - tl.now) * pps : scrub }}>
          <span className="tls-tip">{sw ? <>{tg?.snap ? '2 bars before the transition · ' : sw.ahead ? 'ahead · ' : 'back · '}{sw.text}</> : 'nothing there'}</span>
        </div>
      )}
    </div>
  )
}

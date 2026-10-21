// The timeline (2026-10-21, the designer's mock): what played, plays and is planned, a card per block (a song's visit, a
// glue, a rest) on a ruler, the playhead's handle on top. Each card: its shape (the loudness of each beat it plays, lit
// up to the playhead while it plays) and under it, always there, its rating (the five uses: remove, flag, fill, good,
// exceptional; at its right end, so a card half out of view still shows it); between two cards, the transition, its
// thumbs once it has played (as the lane had them). Press a card's
// shape, or drag the handle, to play from there; near a transition (its last 2 bars, shaded, or the seam) it lands 2
// bars before it, and the seam's marker goes there in one click ("easy to skip to right before transitions"). The cards
// move along a block at a time, and hold still while the pointer is over them (the wheel looks back and ahead).
import { useEffect, useRef, useState } from 'react'
import { audio } from '../audio/context'
import type { Mixer } from '../mixer/engine/mixer'
import { STARS } from '../mixer/engine/session'
import { Icon } from '../shell/Icon'
import { toast } from '../shell/toast'
import { useFrame } from './hooks'
import { RATING } from './Rating'
import './timelineStrip.css'

const G = 50, BARW = 46, MINW = 156, MAXW = 380, EASE = 0.15, SNAP = 14, WAVE_H = 36
type TL = ReturnType<Mixer['timeline']>
type Blk = TL['blocks'][number]
type Ghost = TL['ghosts'][number]
interface Card { id: string; T: number; end: number; bars: number; x: number; w: number; b: Blk | null; g: Ghost | null }

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`

/** The cards side by side, a seam between each two; the first where it was last time, so the row doesn't jump as old
 * blocks leave it. */
function layout(tl: TL, memo: Map<string, number>): Card[] {
  const cards: Card[] = [
    ...tl.blocks.map(b => ({ id: b.id, T: b.T, end: b.end, bars: b.bars, x: 0, w: 0, b, g: null })),
    ...tl.ghosts.map(g => ({ id: `g${g.qi}`, T: g.T, end: g.end, bars: Math.max(1, Math.round((g.end - g.T) / tl.barS)), x: 0, w: 0, b: null, g })),
  ]
  cards.forEach((c, i) => {
    c.w = Math.max(MINW, Math.min(MAXW, c.bars * BARW))
    c.x = i ? cards[i - 1].x + cards[i - 1].w + G : memo.get(c.id) ?? 0
  })
  memo.clear()
  for (const c of cards) if (c.b) memo.set(c.id, c.x)
  return cards
}
/** Where time t sits on the row: along its card, and across the seam in the moment either side of a transition. */
function xOf(cards: Card[], t: number) {
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i], last = i === cards.length - 1
    if (t >= c.end && !last) continue
    const dl = i ? EASE : 0, dr = last ? 0 : EASE, local = t - c.T
    if (local < dl) return c.x - G / 2 + (Math.max(0, local) / dl) * (G / 2)
    if (c.end - t < dr) return c.x + c.w + (1 - (c.end - t) / dr) * (G / 2)
    return c.x + Math.min(1, (local - dl) / Math.max(0.01, c.end - c.T - dl - dr)) * c.w
  }
  return 0
}
function wave(shape: number[], w: number, h: number) {
  const n = Math.max(8, Math.floor(w / 5)), step = w / n, m = shape.length
  let d = ''
  for (let k = 0; k < n; k++) {
    const f = Math.max(0, ((k + 0.5) / n) * m - 0.5), i = Math.min(m - 1, Math.floor(f)), j = Math.min(m - 1, i + 1), a = f - i
    const v = m ? shape[i] * (1 - a) + shape[j] * a : 0.1, hh = Math.max(0.8, v * (h / 2 - 3)), x = (k + 0.5) * step
    d += `M${x.toFixed(1)} ${(h / 2 - hh).toFixed(1)}V${(h / 2 + hh).toFixed(1)}`
  }
  return d
}

export function TimelineStrip({ m }: { m: Mixer }) {
  const box = useRef<HTMLDivElement>(null), film = useRef<HTMLDivElement>(null), head = useRef<HTMLDivElement>(null), lit = useRef<HTMLDivElement | null>(null)
  const memo = useRef(new Map<string, number>()), applied = useRef(0), hold = useRef<number | null>(null), pan = useRef(0)
  const [w, setW] = useState(900), [scrub, setScrub] = useState<number | null>(null), [panned, setPanned] = useState(false)
  useEffect(() => {
    const b = box.current; if (!b) return
    const ro = new ResizeObserver(() => setW(b.clientWidth)); ro.observe(b); setW(b.clientWidth)
    return () => ro.disconnect()
  }, [])

  const tl = m.timeline(), cards = layout(tl, memo.current), playing = m.playing, now = tl.now
  const cur = playing ? cards.find(c => c.b && c.T <= now && now < c.end) ?? null : null
  const first = cards[0], lastR = cards.length ? cards[cards.length - 1].x + cards[cards.length - 1].w : 0
  // (the row's place: the card playing ends three quarters along, the next one's start in view; stopped, the newest)
  const desired = cur ? w * 0.76 - (cur.x + cur.w) : first ? Math.min(16 - first.x, w - 16 - lastR) : 0
  const clampOff = (o: number) => (first ? Math.max(Math.min(o, 16 - first.x + w * 0.4), w - 16 - lastR - w * 0.4) : o)
  const live = useRef({ cards, desired, cur, playing })
  live.current = { cards, desired, cur, playing }

  useFrame(() => {
    const L = live.current, t = audio().currentTime
    if (L.playing && hold.current != null) {  // (held under the pointer, unless the playhead would leave the view)
      const hx = xOf(L.cards, t) + hold.current + pan.current
      if (hx < 8 || hx > w - 8) { hold.current = L.desired; pan.current = 0; setPanned(false) }
    }
    const base = hold.current ?? L.desired, off = pan.current ? clampOff(base + pan.current) : base
    if (off !== applied.current) { applied.current = off; if (film.current) film.current.style.transform = `translateX(${off}px)` }
    if (!L.playing) return
    const hx = xOf(L.cards, t)
    if (head.current) head.current.style.transform = `translateX(${hx}px)`
    if (lit.current && L.cur) lit.current.style.clipPath = `inset(0 ${Math.max(0, 100 - (100 * (hx - L.cur.x)) / L.cur.w)}% 0 0)`
  })
  useEffect(() => {  // (the wheel: look back and ahead, while the pointer is over the row)
    const b = box.current; if (!b) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      if (hold.current == null) hold.current = applied.current
      pan.current -= Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      b.classList.add('panning'); setPanned(true)
    }
    b.addEventListener('wheel', wheel, { passive: false })
    return () => b.removeEventListener('wheel', wheel)
  }, [])
  const enter = () => { if (hold.current == null) hold.current = applied.current }
  const leave = () => { hold.current = null; pan.current = 0; setPanned(false); box.current?.classList.remove('panning') }

  // ---- landing: a time from a point on the row (in the row's own coordinates)
  const before = (c: Card) => c.end - 2 * tl.barS
  const target = (x: number): { t: number; snap: boolean; card: Card | null } | null => {
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i], nx = cards[i + 1]
      const lead = c.b?.kind === 'part' && c.bars >= 3 && nx ? xOf(cards, before(c)) : c.x + c.w
      if (nx && x >= Math.min(lead, c.x + c.w - SNAP) && x <= nx.x + SNAP) return { t: before(c), snap: true, card: c }
      if (x >= c.x && x <= c.x + c.w) {
        if (c.g) return { t: c.T, snap: false, card: c }
        const dl = i ? EASE : 0, dr = nx ? EASE : 0, t = c.T + dl + ((x - c.x) / c.w) * (c.end - c.T - dl - dr)
        return { t: c.T + Math.floor((t - c.T) / tl.barS) * tl.barS + 0.01, snap: false, card: c }
      }
    }
    return null
  }
  const where = (t: number) => {
    const c = cards.find(x => x.T <= t && t < x.end)
    if (!c) return null
    if (c.g) return `${c.g.label} · from its start`
    const b = c.b!, name = b.label ?? (b.kind === 'part' ? 'this song' : b.kind)
    return b.kind === 'part' ? `${name} · bar ${b.bar + Math.floor((t - b.T) / tl.barS)}` : name
  }
  const go = (tg: { t: number; card: Card | null } | null) => {
    if (!tg || !playing) return
    if (tg.card?.g && m.queue && tg.t >= tg.card.T) { m.playQueue(m.queue, tg.card.g.qi); return }
    if (!m.seekTo(tg.t)) toast('Nothing to play from there', 'x')
  }
  const drag = (e: React.PointerEvent) => {
    if (!playing || (e.target as HTMLElement).closest('.tlc-ctl, .tls-seam, .tls-now')) return
    e.preventDefault()
    const r = box.current!.getBoundingClientRect(), pos = (ev: { clientX: number }) => ev.clientX - r.left - applied.current
    const x0 = e.clientX
    setScrub(pos(e))
    const move = (ev: PointerEvent) => setScrub(pos(ev))
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up)
      setScrub(null)
      const onHead = (e.target as HTMLElement).closest('.tls-knob') && Math.abs(ev.clientX - x0) < 3
      if (!onHead) go(target(pos(ev)))
    }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }

  // (the ruler runs on past the cards, a tick a bar, so the timeline reaches across the whole strip)
  const ext: number[] = []
  if (first) {
    for (let x = first.x - G; x > first.x - 2 * w; x -= BARW) ext.push(x)
    for (let x = lastR + G; x < lastR + 2 * w; x += BARW) ext.push(x)
  }
  const tg = scrub == null ? null : target(scrub), tip = tg ? where(tg.t) : null
  const state = (c: Card) => (c.g || c.T > now + 0.01 ? 'next' : c.end <= now || !playing ? 'past' : 'cur')
  return (
    <div className={`tls ${playing ? 'live' : ''}`}>
      <div className="tls-track" ref={box} onPointerDown={drag} onPointerEnter={enter} onPointerLeave={leave}>
        <div className="tls-rule tls-top" /><div className="tls-rule tls-base" />
        <div className="tls-film" ref={film}>
          <div className="tls-ticks">{ext.map(x => <i key={x} style={{ left: x }} />)}</div>
          {cards.map((c, i) => {
            const st = state(c), b = c.b, nx = cards[i + 1], ticks = Array.from({ length: c.bars + 1 }, (_, k) => k)
            const leadX = b?.kind === 'part' && c.bars >= 3 && nx ? xOf(cards, before(c)) - c.x : null
            const path = wave(b?.shape ?? [], c.w - 16, WAVE_H)
            return (
              <div key={c.id}>
                <div className={`tlc ${st} k-${b?.kind ?? 'ghost'} ${b?.rating ? `r${b.rating}` : ''}`} style={{ left: c.x, width: c.w }}>
                  <div className="tlc-wave">
                    <svg width={c.w - 16} height={WAVE_H}><path d={path} /></svg>
                    {st === 'cur' && <div className="tlc-lit" ref={lit}><svg width={c.w - 16} height={WAVE_H}><path d={path} /></svg></div>}
                    {leadX != null && <span className="tlc-lead" style={{ left: leadX }} />}
                    {b && b.kind !== 'part' && <span className="tlc-kind">{b.kind}</span>}
                    {c.g && <span className="tlc-kind">up later</span>}
                  </div>
                  <div className="tlc-ctl">
                    {b?.rated && st !== 'next' ? (
                      <span className={`rate ${b.rating ? 'set' : ''}`}>
                        {[1, 2, 3, 4, 5].map(k => <button key={k} className={`r${k} ${b.rating === k ? 'on' : ''}`} title={`${RATING[k].name}: ${STARS[k]}`} onClick={() => m.star(b.key, k)}><Icon name={RATING[k].icon} /></button>)}
                      </span>
                    ) : c.g ? (
                      <button className="tlc-label" title="Play it now" onClick={() => m.queue && m.playQueue(m.queue, c.g!.qi)}><Icon name="play" />{c.g.label}</button>
                    ) : b?.label ? (
                      <span className="tlc-label">{b.label}</span>
                    ) : (
                      <span className="tlc-note">{st === 'next' ? 'up next' : ''}</span>
                    )}
                    <span className="tlc-bars">{c.bars} bar{c.bars > 1 ? 's' : ''}</span>
                  </div>
                </div>
                <div className="tls-ruler" style={{ left: c.x, width: c.w }}>
                  {ticks.map(k => <i key={k} className={k === 0 ? 'major' : ''} style={{ left: `${(100 * k) / c.bars}%` }} />)}
                  <span>{mmss(c.T - tl.origin)}</span>
                </div>
                {nx && (
                  <div className={`tls-seam ${b && b.like > 0 ? 'up' : b && b.like < 0 ? 'down' : ''} ${c.end <= now + 0.01 && playing ? 'passed' : ''}`} style={{ left: c.x + c.w, width: G }}>
                    <button className="tls-jump" disabled={!playing} title="Play from 2 bars before this transition" onClick={() => go({ t: before(c), card: c })}><i /></button>
                    {b?.rated && b.end <= now + 0.01 && !nx.g && (
                      <span className="thumbs">
                        <button className={b.like > 0 ? 'on up' : 'up'} title="Good transition" onClick={() => void m.like(b.key, 1)}><Icon name="up" /></button>
                        <button className={b.like < 0 ? 'on down' : 'down'} title="Bad transition" onClick={() => void m.like(b.key, -1)}><Icon name="down" /></button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {playing && cards.length > 0 && (
            <div className="tls-head" ref={head}>
              <span className="tls-knob" title="Drag to play from anywhere in what played or is planned"><i /><i /><i /></span>
            </div>
          )}
          {tg && (
            <div className={`tls-scrub ${tip ? '' : 'none'} ${tg.snap ? 'snap' : ''} ${scrub! + applied.current > w * 0.6 ? 'flip' : ''}`} style={{ transform: `translateX(${tg.snap ? xOf(cards, tg.t) : scrub}px)` }}>
              <span className="tls-tip">{tip ? <>{tg.snap ? '2 bars before the transition · ' : tg.t > now ? 'ahead · ' : 'back · '}{tip}</> : 'nothing there'}</span>
            </div>
          )}
        </div>
        {!cards.length && <div className="tls-idle">Space plays the walk · each block shows here to rate</div>}
        {panned && <button className="tls-now" onClick={leave}>Now <Icon name="next" /></button>}
      </div>
    </div>
  )
}

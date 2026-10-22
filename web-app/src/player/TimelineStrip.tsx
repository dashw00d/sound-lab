// The timeline (2026-10-21, the designer's mock): what played, plays and is planned, a card per block (a song's visit, a
// glue, a rest) between a rail and a ruler. Each card: its shape (the loudness of each beat it plays, lit up to the
// playhead while it plays) and under it, always there, its rating (the five uses: remove, flag, fill, good,
// exceptional; at its right end, so a card half out of view still shows it); between two cards, the transition, its
// thumbs once it has played (as the lane had them).
// The rail on top is the progress: lit up to the playhead, a dot per transition, and before each transition its last 2
// bars in gold, which play from there in one click ("easy to skip to right before transitions"; so does the chevron
// between two cards, and '.'). The ruler below: a tick a beat, a bar, a phrase (the song's own bars numbered), each
// block's start timed, lit as it's played. The playhead's head reads the time. Press a card, or drag the head: it
// lands on the nearest bar line (2026-10-21, the designer: "why can't the timeline just snap to bars"), the guide on
// its tick and the bar named on the ruler. The cards move along a block at a time, and hold still
// while the pointer is over them (the wheel looks back and ahead).
import { useEffect, useRef, useState } from 'react'
import { audio } from '../audio/context'
import type { Mixer } from '../mixer/engine/mixer'
import { STARS } from '../mixer/engine/session'
import { Icon } from '../shell/Icon'
import { toast } from '../shell/toast'
import { useFrame } from './hooks'
import { RATING } from './Rating'
import './timelineStrip.css'

const G = 50, BARW = 48, MINW = 192, MAXW = 640, EASE = 0.15, WAVE_H = 34
const RULER_H = 26, TICK = [4, 7, 11, 16]  // (the ruler's height; a beat's tick, a bar's, a phrase's, a block's start)
type TL = ReturnType<Mixer['timeline']>
type Blk = TL['blocks'][number]
type Ghost = TL['ghosts'][number]
interface Card { id: string; T: number; end: number; bars: number; x: number; w: number; b: Blk | null; g: Ghost | null }

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`

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
/** The ruler: its ticks by kind, its labels (each block's start timed, the song's bars numbered), on past the cards. */
function ruler(cards: Card[], beatsPerBar: number, origin: number, w: number) {
  const lv: number[][] = [[], [], [], []], labels: { x: number; text: string; time: boolean }[] = []
  const beats = (x: number, pb: number) => { if (pb >= 18) for (let j = 1; j < beatsPerBar; j++) lv[0].push(x + (j * pb) / beatsPerBar) }
  for (const c of cards) {
    const pb = c.w / c.bars, nums = c.b?.nums ?? []
    for (let k = 0; k < c.bars; k++) {
      const x = c.x + k * pb, n = nums[k] ?? null, phrase = n != null && (n - 1) % 4 === 0
      lv[k === 0 ? 3 : phrase ? 2 : 1].push(x); beats(x, pb)
      if (k === 0) labels.push({ x, text: mmss(c.T - origin), time: true })
      else if (n != null && (pb >= 30 || phrase)) labels.push({ x, text: String(n), time: false })
    }
    lv[1].push(c.x + c.w)
  }
  if (cards.length) {
    const a = cards[0].x - G, z = cards[cards.length - 1].x + cards[cards.length - 1].w + G
    for (let k = 0; k * BARW < 1.5 * w; k++) {
      lv[k % 4 ? 1 : 2].push(a - k * BARW, z + k * BARW)
      beats(a - (k + 1) * BARW, BARW); beats(z + k * BARW, BARW)
    }
  }
  const all = lv.flat(), lo = all.length ? Math.min(...all) - 2 : 0, hi = all.length ? Math.max(...all) + 2 : 0
  const path = (xs: number[], h: number) => xs.map(x => `M${Math.round(x - lo) + 0.5} 0V${h}`).join('')
  return { lo, hi, labels, paths: lv.map((xs, i) => path(xs, TICK[i])), grid: [path(lv[1], 1), path(lv[2], 1), path(lv[3], 1)] }
}

export function TimelineStrip({ m }: { m: Mixer }) {
  const box = useRef<HTMLDivElement>(null), film = useRef<HTMLDivElement>(null), head = useRef<HTMLDivElement>(null), lit = useRef<HTMLDivElement | null>(null)
  const readout = useRef<HTMLElement>(null), played = useRef<HTMLDivElement>(null), railFill = useRef<HTMLDivElement>(null)
  const memo = useRef(new Map<string, number>()), applied = useRef(0), hold = useRef<number | null>(null), pan = useRef(0)
  const [w, setW] = useState(900), [scrub, setScrub] = useState<number | null>(null), [hov, setHov] = useState<number | null>(null), [panned, setPanned] = useState(false)
  useEffect(() => {
    const b = box.current; if (!b) return
    const ro = new ResizeObserver(() => setW(b.clientWidth)); ro.observe(b); setW(b.clientWidth)
    return () => ro.disconnect()
  }, [])

  const tl = m.timeline(), cards = layout(tl, memo.current), playing = m.playing, now = tl.now
  const cur = playing ? cards.find(c => c.b && c.T <= now && now < c.end) ?? null : null
  const first = cards[0], lastR = cards.length ? cards[cards.length - 1].x + cards[cards.length - 1].w : 0
  const R = ruler(cards, tl.beats, tl.origin, w)
  // (the row's place: the card playing ends three quarters along, the next one's start in view; stopped, the newest)
  const desired = cur ? Math.max(w * 0.76 - (cur.x + cur.w), w * 0.2 - cur.x) : first ? Math.min(16 - first.x, w - 16 - lastR) : 0
  const clampOff = (o: number) => (first ? Math.max(Math.min(o, 16 - first.x + w * 0.4), w - 16 - lastR - w * 0.4) : o)
  const live = useRef({ cards, desired, cur, playing, lo: R.lo, origin: tl.origin })
  live.current = { cards, desired, cur, playing, lo: R.lo, origin: tl.origin }

  useFrame(() => {
    const L = live.current, t = audio().currentTime, hx = L.playing ? xOf(L.cards, t) : 0
    const want = L.playing ? Math.min(L.desired, w - 56 - hx) : L.desired  // (a long card: the row follows the playhead near the edge)
    if (L.playing && hold.current != null) {  // (held under the pointer, unless the playhead would leave the view)
      const sx = hx + hold.current + pan.current
      if (sx < 8 || sx > w - 8) { hold.current = want; pan.current = 0; setPanned(false) }
    }
    const base = hold.current ?? want, off = pan.current ? clampOff(base + pan.current) : base
    if (off !== applied.current) { applied.current = off; if (film.current) film.current.style.transform = `translateX(${off}px)` }
    if (!L.playing) return
    if (head.current) head.current.style.transform = `translateX(${hx}px)`
    const pw = `${Math.max(0, hx - L.lo)}px`
    if (played.current && played.current.style.width !== pw) played.current.style.width = pw
    if (railFill.current && railFill.current.style.width !== pw) railFill.current.style.width = pw
    const txt = mmss(t - L.origin)
    if (readout.current && readout.current.textContent !== txt) readout.current.textContent = txt
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
  const leave = () => { hold.current = null; pan.current = 0; setPanned(false); setHov(null); box.current?.classList.remove('panning') }

  // ---- landing: a time from a point on the row (in the row's own coordinates)
  const before = (c: Card) => c.end - 2 * tl.barS
  /** Where a press at x lands: the nearest bar line of the card under it (between two cards, the next one's start). */
  const target = (x: number): { t: number; x: number; card: Card } | null => {
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i], nx = cards[i + 1]
      if (nx && x > c.x + c.w && x < nx.x) return nx.g ? { t: nx.T, x: nx.x, card: nx } : { t: nx.T + 0.01, x: nx.x, card: nx }
      if (x < c.x - (i ? 0 : G) || x > c.x + c.w) continue
      if (c.g) return { t: c.T, x: c.x, card: c }
      const pb = c.w / c.bars, k = Math.max(0, Math.min(nx ? c.bars : c.bars - 1, Math.round((x - c.x) / pb)))
      if (k === c.bars) return nx!.g ? { t: nx!.T, x: nx!.x, card: nx! } : { t: nx!.T + 0.01, x: nx!.x, card: nx! }
      return { t: c.T + k * tl.barS + 0.01, x: c.x + k * pb, card: c }
    }
    return null
  }
  const where = (t: number) => {
    const c = cards.find(x => x.T <= t && t < x.end)
    if (!c) return null
    if (c.g) return `${c.g.label} · from its start`
    const b = c.b!, n = b.nums[Math.floor((t - b.T) / tl.barS)], at = mmss(t - tl.origin)
    if (b.kind !== 'part') return `${b.kind} · ${at}`
    return `${b.label ? `${b.label} · ` : ''}${n != null ? `bar ${n}` : 'fill'} · ${at}`
  }
  const go = (tg: { t: number; card: Card } | null) => {
    if (!tg || !playing) return
    if (tg.card?.g && tg.t >= tg.card.T) { m.jumpQueue(tg.card.g.qi); return }
    if (!m.seekTo(tg.t)) toast('Nothing to play from there', 'x')
  }
  const NOT_HERE = '.tlc-ctl, .tls-seam, .tls-now, .tls-lead'
  const local = (clientX: number) => clientX - box.current!.getBoundingClientRect().left - applied.current
  const drag = (e: React.PointerEvent) => {
    if (!playing || (e.target as HTMLElement).closest(NOT_HERE)) return
    e.preventDefault()
    const x0 = e.clientX
    setScrub(local(e.clientX))
    const move = (ev: PointerEvent) => setScrub(local(ev.clientX))
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up)
      setScrub(null)
      const onHead = (e.target as HTMLElement).closest('.tls-knob') && Math.abs(ev.clientX - x0) < 3
      if (!onHead) go(target(local(ev.clientX)))
    }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  const hover = (e: React.PointerEvent) => setHov(playing && !(e.target as HTMLElement).closest(NOT_HERE) ? local(e.clientX) : null)

  const px = scrub ?? hov, tg = px == null || !playing ? null : target(px), tip = tg ? where(tg.t) : null, cx = tg?.x ?? 0
  const state = (c: Card) => (c.g || c.T > now + 0.01 ? 'next' : c.end <= now || !playing ? 'past' : 'cur')
  return (
    <div className={`tls ${playing ? 'live' : ''} ${m.paused ? 'paused' : ''}`}>
      <div className="tls-track" ref={box} onPointerDown={drag} onPointerMove={hover} onPointerEnter={enter} onPointerLeave={leave}>
        <div className="tls-rail" /><div className="tls-band" />
        <div className="tls-film" ref={film}>
          {/* the grid behind the cards, on past them */}
          <svg className="tls-grid" style={{ left: R.lo }} width={R.hi - R.lo} height={1} preserveAspectRatio="none" viewBox={`0 0 ${R.hi - R.lo} 1`}>
            <path className="g1" d={R.grid[0]} /><path className="g2" d={R.grid[1]} /><path className="g3" d={R.grid[2]} />
          </svg>
          {/* the rail: the progress, the transitions, the last 2 bars before each */}
          {playing && <div className="tls-rail-fill" ref={railFill} style={{ left: R.lo }} />}
          {cards.slice(0, -1).map((c, i) => {
            const b = c.b, sx = c.x + c.w + G / 2, lx = b?.kind === 'part' && c.bars >= 3 ? xOf(cards, before(c)) : null
            return (
              <div key={`r${c.id}`}>
                {lx != null && playing && <button className="tls-lead" style={{ left: lx, width: sx - lx }} title="Play from 2 bars before this transition" onClick={() => go({ t: before(c), card: c })}><i /></button>}
                <span className={`tls-dot ${b && b.like > 0 ? 'up' : b && b.like < 0 ? 'down' : ''} ${c.end <= now + 0.01 && playing ? 'passed' : ''} ${cards[i + 1].g ? 'later' : ''}`} style={{ left: sx }} />
              </div>
            )
          })}
          {/* the ruler: its ticks, lit as they're played, and its labels */}
          <div className="tls-ruler" style={{ left: R.lo, width: R.hi - R.lo }}>
            <svg width={R.hi - R.lo} height={RULER_H}>{R.paths.map((d, i) => <path key={i} className={`t${i}`} d={d} />)}</svg>
            {playing && (
              <div className="tls-played" ref={played}>
                <svg width={R.hi - R.lo} height={RULER_H}>{R.paths.map((d, i) => <path key={i} className={`t${i}`} d={d} />)}</svg>
              </div>
            )}
            {R.labels.map(l => <span key={`${l.x}`} className={l.time ? 'time' : 'num'} style={{ left: l.x - R.lo }}>{l.text}</span>)}
          </div>
          {cards.map((c, i) => {
            const st = state(c), b = c.b, nx = cards[i + 1]
            const path = wave(b?.shape ?? [], c.w - 16, WAVE_H)
            return (
              <div key={c.id}>
                <div className={`tlc ${st} k-${b?.kind ?? 'ghost'} ${b?.rating ? `r${b.rating}` : ''}`} style={{ left: c.x, width: c.w }}>
                  <div className="tlc-wave">
                    <svg width={c.w - 16} height={WAVE_H}><path d={path} /></svg>
                    {st === 'cur' && <div className="tlc-lit" ref={lit}><svg width={c.w - 16} height={WAVE_H}><path d={path} /></svg></div>}
                    {b && b.kind !== 'part' && <span className="tlc-kind">{b.kind}</span>}
                    {c.g && <span className="tlc-kind">up later</span>}
                  </div>
                  <div className="tlc-ctl">
                    {b?.rated && st !== 'next' ? (
                      <span className={`rate ${b.rating ? 'set' : ''}`}>
                        {[1, 2, 3, 4, 5].map(k => <button key={k} className={`r${k} ${b.rating === k ? 'on' : ''}`} title={`${RATING[k].name}: ${STARS[k]}`} onClick={() => m.star(b.key, k)}><Icon name={RATING[k].icon} /></button>)}
                      </span>
                    ) : c.g ? (
                      <button className="tlc-label" title="Play it now" onClick={() => m.jumpQueue(c.g!.qi)}><Icon name="play" />{c.g.label}</button>
                    ) : b?.label ? (
                      <span className="tlc-label">{b.label}</span>
                    ) : (
                      <span className="tlc-note">{st === 'next' ? 'up next' : ''}</span>
                    )}
                    <span className="tlc-bars">{c.bars} bar{c.bars > 1 ? 's' : ''}</span>
                  </div>
                </div>
                {nx && (
                  <div className={`tls-seam ${b && b.like > 0 ? 'up' : b && b.like < 0 ? 'down' : ''} ${c.end <= now + 0.01 && playing ? 'passed' : ''}`} style={{ left: c.x + c.w, width: G }}>
                    <button className="tls-jump" disabled={!playing} title="Play from 2 bars before this transition" onClick={() => go({ t: before(c), card: c })}><i><Icon name="next" /></i></button>
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
              <span className="tls-beam" />
              <span className="tls-knob" title={m.paused ? 'Paused: drag to move the playhead; Space goes on from it' : 'Drag to play from anywhere in what played or is planned'}>{m.paused && <Icon name="pause" />}<b ref={readout}>0:00</b></span>
              <span className="tls-foot" />
            </div>
          )}
          {tg && (
            <div className={`tls-cursor ${scrub != null ? 'down' : ''} ${tip ? '' : 'none'} ${cx + applied.current > w * 0.62 ? 'flip' : ''}`} style={{ transform: `translateX(${cx}px)` }}>
              <span className="tls-bubble">{tip ?? 'nothing there'}</span>
            </div>
          )}
        </div>
        {!cards.length && <div className="tls-idle">Space plays the walk · each block shows here to rate</div>}
        {panned && <button className="tls-now" onClick={leave}>Now <Icon name="next" /></button>}
      </div>
    </div>
  )
}

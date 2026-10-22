// The timeline (2026-10-21, the designer's mock): the tape as the walk laid it down, played and planned (or a queue's
// songs), a card per block (a song's visit, a glue, a rest) between a rail and a ruler, and the playhead moving along
// it. A seek moves the playhead on the same cards: back, what played plays again as it was; ahead, what's planned plays
// from there (the designer: a seek back mustn't add the song again, a press ahead must play what's planned).
// Each card: its shape (the loudness of each beat it plays, lit up to the playhead while it plays) and under it, always
// there, its rating (the five uses: remove, flag, fill, good, exceptional; at its right end, so a card half out of view
// still shows it); between two cards, the transition, its thumbs once it has played (as the lane had them).
// The rail on top is the progress: lit up to the playhead, a dot per transition, and before each transition its last 2
// bars in gold, which play from there in one click ("easy to skip to right before transitions"; so does the chevron
// between two cards, and '.'). The ruler below: a tick a beat, a bar, a phrase (the song's own bars numbered), each
// card's start timed, lit up to the playhead. The playhead's head reads the time. Press a card, or drag the head: it
// lands on the nearest bar line ("why can't the timeline just snap to bars"), the guide on its tick and the bar named
// on the ruler. The cards move along a card at a time, and hold still while the pointer is over them (the wheel looks
// back and ahead). All of it works paused too.
import { useEffect, useRef, useState } from 'react'
import type { Mixer, TCard } from '../mixer/engine/mixer'
import { STARS } from '../mixer/engine/session'
import { Icon } from '../shell/Icon'
import { toast } from '../shell/toast'
import { useFrame } from './hooks'
import { RATING } from './Rating'
import './timelineStrip.css'

const G = 50, BARW = 48, MINW = 192, MAXW = 640, CROSS = 0.08, WAVE_H = 34, SHOW = 40
const RULER_H = 26, TICK = [4, 7, 11, 16]  // (the ruler's height; a beat's tick, a bar's, a phrase's, a card's start)
interface Card { c: TCard; i: number; x: number; w: number }

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`

/** The cards side by side along the whole tape, a seam between each two (the tape only grows, so a card stays put). */
function layout(cs: TCard[]): Card[] {
  let x = 0
  return cs.map((c, i) => { const w = Math.max(MINW, Math.min(MAXW, c.bars * BARW)), k = { c, i, x, w }; x += w + G; return k })
}
/** Where `bar` bars into a card sits: along it, and across the seam in the moment either side of a transition. */
function xAt(cards: Card[], k: Card, bar: number) {
  const pb = k.w / k.c.bars, n = k.c.bars
  if (bar > n - CROSS && cards[k.i + 1]) return k.x + (n - CROSS) * pb + ((Math.min(bar, n) - (n - CROSS)) / CROSS) * (CROSS * pb + G / 2)
  if (bar < CROSS && k.i > 0) return k.x - G / 2 + (bar / CROSS) * (G / 2 + CROSS * pb)
  return k.x + Math.min(n, bar) * pb
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
/** The ruler: its ticks by kind, its labels (each card's start timed, the song's bars numbered), on past the cards. */
function ruler(cards: Card[], all: Card[], beatsPerBar: number, w: number) {
  const lv: number[][] = [[], [], [], []], labels: { x: number; text: string; time: boolean }[] = []
  const beats = (x: number, pb: number) => { if (pb >= 18) for (let j = 1; j < beatsPerBar; j++) lv[0].push(x + (j * pb) / beatsPerBar) }
  for (const k of cards) {
    const pb = k.w / k.c.bars, nums = k.c.nums
    for (let b = 0; b < k.c.bars; b++) {
      const x = k.x + b * pb, n = nums[b] ?? null, phrase = n != null && (n - 1) % 4 === 0
      lv[b === 0 ? 3 : phrase ? 2 : 1].push(x); beats(x, pb)
      if (b === 0) labels.push({ x, text: mmss(k.c.start), time: true })
      else if (n != null && (pb >= 30 || phrase)) labels.push({ x, text: String(n), time: false })
    }
    lv[1].push(k.x + k.w)
  }
  if (cards.length) {  // (on past the tape's ends, a tick a bar)
    const first = all[0], last = all[all.length - 1], a = first.x - G, z = last.x + last.w + G
    for (let k = 0; k * BARW < 1.5 * w; k++) {
      if (cards[0] === first) { lv[k % 4 ? 1 : 2].push(a - k * BARW); beats(a - (k + 1) * BARW, BARW) }
      if (cards[cards.length - 1] === last) { lv[k % 4 ? 1 : 2].push(z + k * BARW); beats(z + k * BARW, BARW) }
    }
  }
  const xs = lv.flat(), lo = xs.length ? Math.min(...xs) - 2 : 0, hi = xs.length ? Math.max(...xs) + 2 : 0
  const path = (v: number[], h: number) => v.map(x => `M${Math.round(x - lo) + 0.5} 0V${h}`).join('')
  return { lo, hi, labels, paths: lv.map((v, i) => path(v, TICK[i])), grid: [path(lv[1], 1), path(lv[2], 1), path(lv[3], 1)] }
}

export function TimelineStrip({ m }: { m: Mixer }) {
  const box = useRef<HTMLDivElement>(null), film = useRef<HTMLDivElement>(null), head = useRef<HTMLDivElement>(null), lit = useRef<HTMLDivElement | null>(null)
  const readout = useRef<HTMLElement>(null), played = useRef<HTMLDivElement>(null), railFill = useRef<HTMLDivElement>(null)
  const applied = useRef(0), hold = useRef<number | null>(null), pan = useRef(0), lastHead = useRef(0)
  const [w, setW] = useState(900), [scrub, setScrub] = useState<number | null>(null), [hov, setHov] = useState<number | null>(null), [panned, setPanned] = useState(false)
  useEffect(() => {
    const b = box.current; if (!b) return
    const ro = new ResizeObserver(() => setW(b.clientWidth)); ro.observe(b); setW(b.clientWidth)
    return () => ro.disconnect()
  }, [])

  const tl = m.timeline(), all = layout(tl.cards), playing = m.playing, hp = m.headPos()
  const byId = new Map(all.map(k => [k.c.id, k])), cur = hp ? byId.get(hp.id) ?? null : null, hi = cur?.i ?? (playing ? -1 : all.length)
  // (the cards drawn: SHOW either side of the one playing, the newest when stopped)
  const mid = cur ? cur.i : all.length - 1, cards = all.slice(Math.max(0, mid - SHOW), mid + SHOW)
  const first = all[0], last = all[all.length - 1], lastR = last ? last.x + last.w : 0
  const R = ruler(cards, all, tl.beats, w)
  // (the row's place: the card playing ends three quarters along, the next one's start in view; stopped, the newest)
  const desired = cur ? Math.max(w * 0.76 - (cur.x + cur.w), w * 0.2 - cur.x) : first ? Math.min(16 - first.x, w - 16 - lastR) : 0
  const clampOff = (o: number) => (first ? Math.max(Math.min(o, 16 - first.x + w * 0.4), w - 16 - lastR - w * 0.4) : o)
  const live = useRef({ all, byId, desired, cur, playing, lo: R.lo })
  live.current = { all, byId, desired, cur, playing, lo: R.lo }

  useFrame(() => {
    const L = live.current, h = L.playing ? m.headPos() : null, k = h ? L.byId.get(h.id) : null
    if (k) lastHead.current = xAt(L.all, k, h!.bar)
    const hx = lastHead.current
    const want = L.playing ? Math.min(L.desired, w - 56 - hx) : L.desired  // (a long card: the row follows the playhead near the edge)
    if (L.playing && hold.current != null) {  // (held under the pointer, unless the playhead would leave the view)
      const sx = hx + hold.current + pan.current
      if (sx < 8 || sx > w - 8) { hold.current = want; pan.current = 0; setPanned(false) }
    }
    const base = hold.current ?? want, off = pan.current ? clampOff(base + pan.current) : base
    if (off !== applied.current) { applied.current = off; if (film.current) film.current.style.transform = `translateX(${off}px)` }
    if (!L.playing || !k) return
    if (head.current) head.current.style.transform = `translateX(${hx}px)`
    const pw = `${Math.max(0, hx - L.lo)}px`
    if (played.current && played.current.style.width !== pw) played.current.style.width = pw
    if (railFill.current && railFill.current.style.width !== pw) railFill.current.style.width = pw
    const txt = mmss(k.c.start + Math.min(h!.bar, k.c.bars) * tl.barS)
    if (readout.current && readout.current.textContent !== txt) readout.current.textContent = txt
    if (lit.current && k === L.cur) lit.current.style.clipPath = `inset(0 ${Math.max(0, 100 - (100 * (hx - k.x)) / k.w)}% 0 0)`
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

  // ---- landing: a bar of a card from a point on the row (in the row's own coordinates)
  /** Where a press at x lands: the nearest bar line of the card under it (between two cards, the next one's start). */
  const target = (x: number): { k: Card; bar: number; x: number } | null => {
    for (const k of cards) {
      const nx = all[k.i + 1]
      if (nx && x > k.x + k.w && x < nx.x) return { k: nx, bar: 0, x: nx.x }
      if (x < k.x - (k.i ? 0 : G) || x > k.x + k.w) continue
      const pb = k.w / k.c.bars, b = Math.max(0, Math.min(nx ? k.c.bars : k.c.bars - 1, Math.round((x - k.x) / pb)))
      return b === k.c.bars ? { k: nx!, bar: 0, x: nx!.x } : { k, bar: b, x: k.x + b * pb }
    }
    return null
  }
  const where = (k: Card, bar: number) => {
    const c = k.c, n = c.nums[bar], at = mmss(c.start + bar * tl.barS)
    if (c.kind !== 'part') return `${c.kind} · ${at}`
    return `${c.label ? `${c.label} · ` : ''}${n != null ? `bar ${n}` : 'fill'} · ${at}`
  }
  const go = (k: Card, bar: number) => { if (playing && !m.seekAt(k.c.seek, bar)) toast('Nothing to play from there', 'x') }
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
      const onHead = (e.target as HTMLElement).closest('.tls-knob') && Math.abs(ev.clientX - x0) < 3, tg = target(local(ev.clientX))
      if (!onHead && tg) go(tg.k, tg.bar)
    }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  const hover = (e: React.PointerEvent) => setHov(playing && !(e.target as HTMLElement).closest(NOT_HERE) ? local(e.clientX) : null)

  const px = scrub ?? hov, tg = px == null || !playing ? null : target(px), tip = tg ? where(tg.k, tg.bar) : null, cx = tg?.x ?? 0
  const state = (k: Card) => (k.i < hi ? 'past' : k.i === hi ? 'cur' : 'next')
  const before = (k: Card) => Math.max(0, k.c.bars - 2)
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
          {cards.filter(k => all[k.i + 1]).map(k => {
            const c = k.c, sx = k.x + k.w + G / 2, lx = c.kind === 'part' && c.bars >= 3 ? k.x + (k.w * before(k)) / c.bars : null
            return (
              <div key={`r${c.id}`}>
                {lx != null && playing && <button className="tls-lead" style={{ left: lx, width: sx - lx }} title="Play from 2 bars before this transition" onClick={() => go(k, before(k))}><i /></button>}
                <span className={`tls-dot ${c.like > 0 ? 'up' : c.like < 0 ? 'down' : ''} ${k.i < hi ? 'passed' : ''}`} style={{ left: sx }} />
              </div>
            )
          })}
          {/* the ruler: its ticks, lit up to the playhead, and its labels */}
          <div className="tls-ruler" style={{ left: R.lo, width: R.hi - R.lo }}>
            <svg width={R.hi - R.lo} height={RULER_H}>{R.paths.map((d, i) => <path key={i} className={`t${i}`} d={d} />)}</svg>
            {playing && (
              <div className="tls-played" ref={played}>
                <svg width={R.hi - R.lo} height={RULER_H}>{R.paths.map((d, i) => <path key={i} className={`t${i}`} d={d} />)}</svg>
              </div>
            )}
            {R.labels.map(l => <span key={`${l.x}`} className={l.time ? 'time' : 'num'} style={{ left: l.x - R.lo }}>{l.text}</span>)}
          </div>
          {cards.map(k => {
            const st = state(k), c = k.c, nx = all[k.i + 1], path = wave(c.shape, k.w - 16, WAVE_H), queued = !!c.seek && 'qi' in c.seek
            return (
              <div key={c.id}>
                <div className={`tlc ${st} k-${c.kind} ${c.rating ? `r${c.rating}` : ''}`} style={{ left: k.x, width: k.w }}>
                  <div className="tlc-wave">
                    <svg width={k.w - 16} height={WAVE_H}><path d={path} /></svg>
                    {st === 'cur' && <div className="tlc-lit" ref={lit}><svg width={k.w - 16} height={WAVE_H}><path d={path} /></svg></div>}
                    {c.kind !== 'part' && <span className="tlc-kind">{c.kind}</span>}
                  </div>
                  <div className="tlc-ctl">
                    {c.rated && c.key ? (
                      <span className={`rate ${c.rating ? 'set' : ''}`}>
                        {[1, 2, 3, 4, 5].map(r => <button key={r} className={`r${r} ${c.rating === r ? 'on' : ''}`} title={`${RATING[r].name}: ${STARS[r]}`} onClick={() => m.star(c.key!, r)}><Icon name={RATING[r].icon} /></button>)}
                      </span>
                    ) : queued && st !== 'cur' ? (
                      <button className="tlc-label" title="Play it now" onClick={() => go(k, 0)}><Icon name="play" />{c.label}</button>
                    ) : c.label ? (
                      <span className="tlc-label">{c.label}</span>
                    ) : (
                      <span className="tlc-note">{st === 'next' ? 'up next' : ''}</span>
                    )}
                    <span className="tlc-bars">{c.bars} bar{c.bars > 1 ? 's' : ''}</span>
                  </div>
                </div>
                {nx && (
                  <div className={`tls-seam ${c.like > 0 ? 'up' : c.like < 0 ? 'down' : ''} ${k.i < hi ? 'passed' : ''}`} style={{ left: k.x + k.w, width: G }}>
                    <button className="tls-jump" disabled={!playing} title="Play from 2 bars before this transition" onClick={() => go(k, before(k))}><i><Icon name="next" /></i></button>
                    {c.rated && c.key && k.i < hi && (
                      <span className="thumbs">
                        <button className={c.like > 0 ? 'on up' : 'up'} title="Good transition" onClick={() => void m.like(c.key!, 1)}><Icon name="up" /></button>
                        <button className={c.like < 0 ? 'on down' : 'down'} title="Bad transition" onClick={() => void m.like(c.key!, -1)}><Icon name="down" /></button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {playing && cur && (
            <div className="tls-head" ref={head}>
              <span className="tls-beam" />
              <span className="tls-knob" title={m.paused ? 'Paused: drag to move the playhead; Space goes on from it' : 'Drag to play from anywhere in what played or is planned'}>{m.paused && <Icon name="pause" />}<b ref={readout}>0:00</b></span>
              <span className="tls-foot" />
            </div>
          )}
          {tg && (
            <div className={`tls-cursor ${scrub != null ? 'down' : ''} ${cx + applied.current > w * 0.62 ? 'flip' : ''}`} style={{ transform: `translateX(${cx}px)` }}>
              <span className="tls-bubble">{tip}</span>
            </div>
          )}
        </div>
        {!all.length && <div className="tls-idle">Space plays the walk · each block shows here to rate</div>}
        {panned && <button className="tls-now" onClick={leave}>Now <Icon name="next" /></button>}
      </div>
    </div>
  )
}

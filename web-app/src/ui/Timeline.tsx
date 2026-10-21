// A song on its bar grid: its spectrogram (audio/spectrogram), the bars numbered, the loop it plays (shaded outside it,
// with handles to drag, snapping to bars: the designer's cues), phrase starts (ticks), markers (where it cuts into other
// songs), and the playhead while the player is in it. Clicking a bar asks to play from it.
import { useEffect, useRef, useState } from 'react'
import { spectrogram } from '../audio/spectrogram'
import { useFrame } from '../player/hooks'
import './timeline.css'

export interface Marker { bar: number; color: string; title: string; size?: number }
export function Timeline({ url, bars = 16, loop, mine, onLoop, ticks = [], markers = [], playhead, onPlay, height = 150 }: {
  url: string | null; bars?: number; loop?: [number, number]; mine?: boolean; onLoop?: (b: [number, number]) => void
  ticks?: number[]; markers?: Marker[]; playhead?: () => number | null; onPlay?: (bar: number) => void; height?: number
}) {
  const box = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), head = useRef<HTMLDivElement>(null)
  const [img, setImg] = useState<ImageData | null>(null), [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<[number, number] | null>(null)
  useEffect(() => {
    if (!url) return
    let alive = true
    setBusy(true); setImg(null)
    spectrogram(url).then(s => { if (alive) { setImg(s.img); setBusy(false) } }).catch(() => alive && setBusy(false))
    return () => { alive = false }
  }, [url])
  useEffect(() => {  // (drawn at the box's own pixel size)
    const c = cv.current, b = box.current
    if (!c || !b || !img) return
    const draw = () => {
      const w = b.clientWidth, dpr = devicePixelRatio || 1
      c.width = Math.round(w * dpr); c.height = Math.round(height * dpr)
      const off = new OffscreenCanvas(img.width, img.height); off.getContext('2d')!.putImageData(img, 0, 0)
      const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(off, 0, 0, c.width, c.height)
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(b)
    return () => ro.disconnect()
  }, [img, height])
  useFrame(() => {
    const h = head.current; if (!h) return
    const p = playhead?.() ?? null
    h.style.opacity = p == null ? '0' : '1'
    if (p != null) h.style.left = `${(100 * p) / bars}%`
  })
  const lp = drag ?? loop
  const barAt = (clientX: number) => { const r = box.current!.getBoundingClientRect(); return Math.max(0, Math.min(bars, Math.round(((clientX - r.left) / r.width) * bars))) }
  const handle = (side: 0 | 1) => (e: React.PointerEvent) => {
    if (!loop || !onLoop) return
    e.preventDefault(); e.stopPropagation()
    const move = (ev: PointerEvent) => {
      const b = barAt(ev.clientX), [s, t] = loop
      setDrag(side === 0 ? [Math.min(Math.max(1, b + 1), t - 1), t] : [s, Math.max(Math.min(bars, b), s + 1)])
    }
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up)
      setDrag(d => { if (d && (d[0] !== loop[0] || d[1] !== loop[1])) onLoop(d); return null })
    }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  return (
    <div className="tl" style={{ height: height + 22 }}>
      <div className="tl-view" ref={box} style={{ height }} onClick={e => onPlay?.(Math.min(bars, Math.floor(((e.clientX - box.current!.getBoundingClientRect().left) / box.current!.clientWidth) * bars) + 1))}>
        <canvas ref={cv} className={img ? 'in' : ''} />
        {busy && <div className="tl-busy"><span /></div>}
        {Array.from({ length: bars - 1 }, (_, k) => <i key={k} className={`tl-line ${(k + 1) % 4 ? '' : 'four'}`} style={{ left: `${(100 * (k + 1)) / bars}%` }} />)}
        {lp && <>
          <div className="tl-out" style={{ left: 0, width: `${(100 * (lp[0] - 1)) / bars}%` }} />
          <div className="tl-out" style={{ left: `${(100 * lp[1]) / bars}%`, right: 0 }} />
          <div className={`tl-loop ${mine ? 'mine' : ''}`} style={{ left: `${(100 * (lp[0] - 1)) / bars}%`, width: `${(100 * (lp[1] - lp[0] + 1)) / bars}%` }}>
            {onLoop && <><span className="tl-h l" onPointerDown={handle(0)} title="Drag: where the loop starts" /><span className="tl-h r" onPointerDown={handle(1)} title="Drag: where the loop ends" /></>}
          </div>
        </>}
        {ticks.map(b => <i key={`t${b}`} className="tl-tick" style={{ left: `${(100 * (b - 1)) / bars}%` }} />)}
        {markers.map((m, k) => { const d = 4 + Math.min(6, 1.5 * (m.size ?? 1)); return <i key={`m${k}`} className="tl-mark" title={m.title} style={{ left: `${(100 * m.bar) / bars}%`, background: m.color, width: d, height: d, marginLeft: -d / 2 }} /> })}
        <div className="tl-head" ref={head} />
      </div>
      <div className="tl-bars" style={{ gridTemplateColumns: `repeat(${bars}, 1fr)` }}>
        {Array.from({ length: bars }, (_, k) => <span key={k} className={lp && k + 1 >= lp[0] && k + 1 <= lp[1] ? 'in' : ''}>{k + 1}</span>)}
      </div>
    </div>
  )
}

// Two songs meeting, drawn as they play (Mixer.playMeeting): each part's slice of its spectrogram side by side, as
// wide as its bars, named; the cuts between them with the crossfade around each; the playhead as it plays.
import { useEffect, useRef, useState } from 'react'
import { spectrogram } from '../audio/spectrogram'
import type { Mixer } from '../mixer/engine/mixer'
import { useFrame } from '../player/hooks'
import './meeting.css'

export function Meeting({ m, names }: { m: Mixer; names: (id: string) => string }) {
  const mt = m.meeting!, total = mt.segs.reduce((s, g) => s + g.bars, 0)
  const cv = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null), head = useRef<HTMLDivElement>(null)
  const [imgs, setImgs] = useState<(ImageData | null)[]>([])
  useEffect(() => {
    let alive = true
    Promise.all(mt.segs.map(g => { const u = m.jd.url(g.track, 'calm'); return u ? spectrogram(u).then(s => s.img).catch(() => null) : Promise.resolve(null) }))
      .then(x => { if (alive) setImgs(x) })
    return () => { alive = false }
  }, [mt, m])
  useEffect(() => {
    const c = cv.current, b = box.current
    if (!c || !b || !imgs.length) return
    const draw = () => {
      const dpr = devicePixelRatio || 1, w = b.clientWidth, h = b.clientHeight
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr)
      const g = c.getContext('2d')!
      let x = 0
      mt.segs.forEach((s, k) => {
        const img = imgs[k], dw = (c.width * s.bars) / total
        if (img) {
          const off = new OffscreenCanvas(img.width, img.height); off.getContext('2d')!.putImageData(img, 0, 0)
          const sx = (img.width * (s.start - 1)) / 16, sw = (img.width * s.bars) / 16
          g.drawImage(off, sx, 0, sw, img.height, x, 0, dw, c.height)
        }
        x += dw
      })
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(b)
    return () => ro.disconnect()
  }, [imgs, mt, total])
  useFrame(() => {
    const p = m.meetingPos(), h = head.current
    if (!h) return
    h.style.opacity = p ? '1' : '0'
    if (p) h.style.left = `${(100 * (mt.segs.slice(0, p.i).reduce((s, g) => s + g.bars, 0) + p.f * mt.segs[p.i].bars)) / total}%`
  })
  let at = 0
  return (
    <div className="meet">
      <div className="meet-view" ref={box}>
        <canvas ref={cv} />
        {mt.segs.map((s, k) => {
          const left = (100 * at) / total
          at += s.bars
          return (
            <div key={k}>
              {k > 0 && <><i className="meet-fade" style={{ left: `calc(${left}% - ${(100 * 0.25) / total}%)`, width: `${(100 * 0.5) / total}%` }} /><i className="meet-cut" style={{ left: `${left}%` }} /></>}
              <span className={`meet-name ${s.track === mt.a ? 'a' : 'b'}`} style={{ left: `calc(${left}% + 6px)` }}>{names(s.track)} <em>{s.start}–{s.start + s.bars - 1}</em></span>
            </div>
          )
        })}
        <div className="meet-head" ref={head} />
      </div>
      <div className="meet-legend"><span>the take</span><span className="arrow">→ into it, then back →</span><span>the take</span></div>
    </div>
  )
}

// Two panes: a list and an inspector beside it, the inspector's width dragged and kept (per page, in this browser).
import { useRef, useState, type ReactNode } from 'react'
import './split.css'

export function Split({ id, left, right, initial = 460, min = 340, max = 760 }: { id: string; left: ReactNode; right: ReactNode; initial?: number; min?: number; max?: number }) {
  const [w, setW] = useState(() => Number(localStorage.getItem(`split.${id}`)) || initial)
  const box = useRef<HTMLDivElement>(null)
  const drag = (e: React.PointerEvent) => {
    e.preventDefault()
    const move = (ev: PointerEvent) => {
      const r = box.current!.getBoundingClientRect()
      setW(Math.max(min, Math.min(max, r.right - ev.clientX)))
    }
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); setW(x => { localStorage.setItem(`split.${id}`, String(Math.round(x))); return x }) }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  return (
    <div className="split" ref={box}>
      <div className="split-l">{left}</div>
      <div className="split-bar" onPointerDown={drag} />
      <div className="split-r" style={{ width: w }}>{right}</div>
    </div>
  )
}

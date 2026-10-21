import { useEffect, useReducer, useRef, useState } from 'react'
import type { Mixer, Snapshot } from '../../mixer/engine/mixer'

/** Redraws when the engine says something changed (playing, the session, training, the review, the settings). */
export function useEngine(m: Mixer) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => m.onChange(bump), [m])
}
/** The engine's snapshot, kept current every frame (a new state only when it changed: the clock moves each beat). */
export function useSnapshot(m: Mixer): Snapshot {
  const [snap, setSnap] = useState(() => m.snapshot())
  const sig = useRef('')
  useEffect(() => {
    let raf = 0
    const frame = () => {
      const s = m.snapshot(), k = JSON.stringify(s)
      if (k !== sig.current) { sig.current = k; setSnap(s) }
      raf = requestAnimationFrame(frame)
    }
    frame()
    return () => cancelAnimationFrame(raf)
  }, [m])
  return snap
}
/** Runs `draw` every frame while mounted (the spectrum, the meters: drawn straight to the DOM, not through React). */
export function useFrame(draw: () => void) {
  const f = useRef(draw)
  f.current = draw
  useEffect(() => {
    let raf = 0
    const tick = () => { f.current(); raf = requestAnimationFrame(tick) }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])
}

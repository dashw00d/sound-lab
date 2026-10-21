// Songs made ready before they're played (2026-10-21, the designer: "a tiny buffer when you select / press play / or
// even on hover, plus buffer ahead the next in the queue"): a pause over a song fetches its files; choosing it decodes
// them into the player's cache, so Play starts at once.
import { useEffect, useRef } from 'react'
import type { Mixer } from '../mixer/engine/mixer'

/** Handlers for a song's row or node: after a short pause over it, its files are fetched (not decoded). */
export function useHoverWarm(m: Mixer | null) {
  const t = useRef(0)
  useEffect(() => () => clearTimeout(t.current), [])
  return (id: string, src?: { calm?: string; battle?: string }) => ({
    onMouseEnter: () => { clearTimeout(t.current); t.current = window.setTimeout(() => { if (!m) return; if (src?.calm) m.ensure(id, src); m.preload(id, false) }, 120) },
    onMouseLeave: () => clearTimeout(t.current),
  })
}
/** The song chosen: its files decoded now. */
export function usePreload(m: Mixer | null, id: string | null, src?: { calm?: string; battle?: string }) {
  useEffect(() => { if (!m || !id) return; if (src?.calm) m.ensure(id, src); m.preload(id) }, [m, id])  // eslint-disable-line react-hooks/exhaustive-deps
}

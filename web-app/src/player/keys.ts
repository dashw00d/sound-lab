// Keys, one listener for the app: the page's keys first (they know what's selected, or that training is on), then the
// player's (Space, the arrows, 1 / 2 / X, Esc). A handler returns true when it took the key. Typing in a field is left alone.
import { useEffect, useRef } from 'react'

export type KeyHandler = (k: string, e: KeyboardEvent) => boolean
const handlers: { h: { current: KeyHandler }; prio: number }[] = []

function onKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest?.('input, select, textarea')) return
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  for (const { h } of [...handlers].sort((a, b) => b.prio - a.prio)) if (h.current(k, e)) { e.preventDefault(); return }
}

/** Keys while mounted: a page's (prio 1) before the player's (prio 0). */
export function useKeys(handler: KeyHandler, prio = 1) {
  const h = useRef(handler)
  h.current = handler
  useEffect(() => {
    const entry = { h, prio }
    if (!handlers.length) addEventListener('keydown', onKey)
    handlers.push(entry)
    return () => {
      handlers.splice(handlers.indexOf(entry), 1)
      if (!handlers.length) removeEventListener('keydown', onKey)
    }
  }, [prio])
}

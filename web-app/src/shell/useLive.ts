import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Stamp } from '../api/types'

/** Data that follows the files it's read from: re-read when any of `files` changes on the server (/api/stamp, every
 * `every` ms), as the old pages do for votes and new takes. `reload` forces a read. */
export function useLive<T>(read: () => Promise<T>, files: (keyof Stamp)[], every = 4000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seen = useRef<string>('')
  const reload = useCallback(async () => {
    try { setData(await read()); setError(null) } catch (e) { setError(String(e)) }
  }, [read])
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const s = await api.stamp(), sig = files.map(f => s[f]).join('|')
        if (sig !== seen.current) { seen.current = sig; if (alive) await reload() }
      } catch { /* server restarting */ }
    }
    tick()
    const t = setInterval(tick, every)
    return () => { alive = false; clearInterval(t) }
  }, [reload, every, files.join()])  // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload, setData }
}

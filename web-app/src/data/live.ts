// One live data layer for the app: each resource (the songs, the scenes, the votes, the sessions, the state) is read
// once, shared by every page, and read again only when its file changes on the server (/api/stamp, polled every few
// seconds). Pages subscribe with useResource; a write (a vote) puts the server's answer straight in, so every page
// shows it at once.
import { useSyncExternalStore } from 'react'
import type { Stamp } from '../api/types'

interface Entry<T> { data: T | null; error: string | null; sig: string | null; loading: Promise<void> | null }
interface Def<T> { read: () => Promise<T>; files: (keyof Stamp)[] }

const defs = new Map<string, Def<unknown>>()
const entries = new Map<string, Entry<unknown>>()
const listeners = new Set<() => void>()
let stamp: Stamp | null = null
let timer = 0
let version = 0
const notify = () => { version++; listeners.forEach(f => f()) }

/** Declares a resource: how to read it and which files it follows. */
export function resource<T>(name: string, read: () => Promise<T>, files: (keyof Stamp)[]) {
  defs.set(name, { read, files } as Def<unknown>)
  return name
}
function entry(name: string): Entry<unknown> {
  let e = entries.get(name)
  if (!e) entries.set(name, (e = { data: null, error: null, sig: null, loading: null }))
  return e
}
async function load(name: string, force = false) {
  const d = defs.get(name)!, e = entry(name), sig = stamp ? d.files.map(f => stamp![f]).join('|') : null
  if (e.loading) return e.loading  // (already on its way: wait for that read)
  if (!force && e.data !== null && sig !== null && sig === e.sig) return
  e.loading = (async () => {
    try { e.data = await d.read(); e.error = null; e.sig = sig } catch (err) { e.error = String(err) }
    e.loading = null
    notify()
  })()
  return e.loading
}
async function poll() {
  try {
    const r = await fetch('/api/stamp')
    if (r.ok) stamp = await r.json()
  } catch { /* the server restarting */ }
  for (const name of entries.keys()) void load(name)
}
/** Sets a resource's data from a write's answer (a vote returns the votes as saved). */
export function put<T>(name: string, data: T) { const e = entry(name); e.data = data; notify() }
export function get<T>(name: string): T | null { return (entries.get(name)?.data as T) ?? null }
/** Read again now (after something else wrote it). */
export function reload(name: string) { return load(name, true) }

export function useResource<T>(name: string): { data: T | null; error: string | null } {
  useSyncExternalStore(f => {
    listeners.add(f)
    if (!timer) { timer = window.setInterval(poll, 3000); void poll() }
    if (!entries.has(name)) void load(name)
    return () => { listeners.delete(f) }
  }, () => version)
  const e = entries.get(name)
  return { data: (e?.data as T) ?? null, error: e?.error ?? null }
}

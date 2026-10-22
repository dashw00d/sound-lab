// The API, typed: reads, and the one way to change a decision (POST /api/vote), as the old pages do (core.js Lab.vote).
import type { Library } from '../mixer/types'
import type { Families, Mixes, ProjectInfo, Stamp, SyncPlan, Votes } from './types'

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json() as Promise<T>
}
const post = <T>(url: string, body: unknown) =>
  json<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  stamp: () => json<Stamp>('/api/stamp'),
  state: () => json<{ project: ProjectInfo; votes: Votes }>('/api/state'),
  project: () => json<ProjectInfo>('/api/project'),
  votes: () => json<Votes>('/api/votes'),
  families: () => json<Families>('/api/families'),
  rebuildFamilies: () => post<{ started: boolean; busy?: boolean }>('/api/families/rebuild', {}),
  /** Every shipped track with its measures, plus the scored new takes (the Mixer's library). */
  songs: () => json<Library>('/api/songs'),
  mixes: () => json<Mixes>('/api/mixes'),
  /** Save a set of parts under a name (`null`: delete it). Returns every saved set. */
  saveMix: async (name: string, parts: { track: string; start: number; bars: number }[] | null) => {
    const r = await fetch('/api/mixes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parts }) })
    if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? String(r.status))
    return r.json() as Promise<Mixes>
  },
  /** What a sync into the game's folder would write (link: point at the game's own copies of the audio). */
  syncPlan: (link: boolean) => json<SyncPlan>(`/api/sync?link=${link ? 1 : 0}`),
  /** Sync the music into the game's folder: what the plan showed. Returns the plan after (all the same). */
  sync: (link: boolean) => post<SyncPlan>('/api/sync', { link }),
  /** A thumb or answer: value 1, -1, or 0 to clear it. Returns the votes as saved. */
  vote: (clip: string, value: number) => post<Votes>('/api/vote', { clip, value }),
}

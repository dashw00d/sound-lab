// The API, typed: reads, and the one way to change a decision (POST /api/vote), as the old pages do (core.js Lab.vote).
import type { Families, ProjectInfo, Stamp, Votes } from './types'

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
  votes: () => json<Votes>('/api/votes'),
  families: () => json<Families>('/api/families'),
  rebuildFamilies: () => post<{ started: boolean; busy?: boolean }>('/api/families/rebuild', {}),
  /** A thumb or answer: value 1, -1, or 0 to clear it. Returns the votes as saved. */
  vote: (clip: string, value: number) => post<Votes>('/api/vote', { clip, value }),
}

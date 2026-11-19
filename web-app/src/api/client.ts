// The API, typed: reads, and the one way to change a decision (POST /api/vote), as the old pages do (core.js Lab.vote).
import type { Library } from '../mixer/types'
import type { DataPlan, Families, GameManifest, Mixes, ProjectInfo, Stamp, SyncPlan, Votes } from './types'

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json() as Promise<T>
}
// (GET /api/families is only {"bridges": {}} until `soundlab music families` has written work/families.json: a project
// with no music, or music not sorted yet. Every part the pages read is filled in, so they see an empty graph, not undefined.)
const EMPTY_FAMILIES: Families = { made: '', items: {}, families: {}, queue: [] }
const post = <T>(url: string, body: unknown) =>
  json<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  stamp: () => json<Stamp>('/api/stamp'),
  state: () => json<{ project: ProjectInfo; votes: Votes }>('/api/state'),
  project: () => json<ProjectInfo>('/api/project'),
  votes: () => json<Votes>('/api/votes'),
  families: async () => ({ ...EMPTY_FAMILIES, ...(await json<Partial<Families>>('/api/families')) }),
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
  /** The game's folder: its texts against the lab's, the songs shipped into it, the batch ready to ship. */
  syncPlan: () => json<SyncPlan>('/api/sync'),
  /** Write the manifest, the walk and the docs into the game's folder. Returns where it stands after. */
  sync: () => post<SyncPlan>('/api/sync', {}),
  /** Ship a batch into the game's folder (keep: the lab keeps its own copy). Returns where it stands after. */
  ship: (ids: string[], keep: boolean) => post<SyncPlan>('/api/sync/ship', { ids, keep }),
  /** The manifest the game would have with these songs shipped too (nothing written): the Game page plays it. */
  syncPreview: (ids: string[]) => post<GameManifest>('/api/sync/preview', { ids }),
  /** The lab's data files against the game's folder for them; and sharing them into it. */
  dataPlan: () => json<DataPlan>('/api/data'),
  shareData: () => post<DataPlan>('/api/data/share', {}),
  /** A thumb or answer: value 1, -1, or 0 to clear it. Returns the votes as saved. */
  vote: (clip: string, value: number) => post<Votes>('/api/vote', { clip, value }),
}

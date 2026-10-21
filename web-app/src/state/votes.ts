// The designer's decisions (votes.json), one copy for every page (data/live.ts), changed only through POST /api/vote
// (which returns the votes as saved, put straight in).
import { api } from '../api/client'
import type { Votes } from '../api/types'
import { get, put, reload } from '../data/live'
import { useVotesData, VOTES } from '../data/resources'

const NONE: Votes = { clips: {}, picks: {}, notes: {}, cues: {} }
export const getVotes = (): Votes => get<Votes>(VOTES) ?? NONE
export async function vote(clip: string, value: number): Promise<Votes> {
  const v = await api.vote(clip, value)
  put(VOTES, v)
  return v
}
/** A cue: a shipped track's mellow or intense loop, bars [start, end] (null: back to the guess). */
export async function setCue(track: string, level: 'mellow' | 'intense', bars: [number, number] | null): Promise<Votes> {
  const r = await fetch('/api/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cue: track, level, bars }) })
  if (!r.ok) throw new Error(String(r.status))
  const v = (await r.json()) as Votes
  put(VOTES, v)
  return v
}
export async function refreshVotes(_force = false) { await reload(VOTES) }
export const useVotes = useVotesData

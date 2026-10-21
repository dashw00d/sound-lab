// The designer's decisions (votes.json), one copy for every page: read when the file changes on the server, and
// changed only through POST /api/vote (which returns the votes as saved).
import { useSyncExternalStore } from 'react'
import { api } from '../api/client'
import type { Votes } from '../api/types'

let votes: Votes = { clips: {}, picks: {}, notes: {}, cues: {} }
let stamp = ''
const listeners = new Set<() => void>()
const set = (v: Votes) => { votes = v; listeners.forEach(f => f()) }

export const getVotes = () => votes
export async function vote(clip: string, value: number): Promise<Votes> {
  const v = await api.vote(clip, value)
  set(v)
  return v
}
export async function refreshVotes(force = false) {
  try {
    const s = await api.stamp()
    if (force || s.votes !== stamp) { stamp = s.votes; set(await api.votes()) }
  } catch { /* server restarting */ }
}
let timer = 0
export function useVotes(): Votes {
  return useSyncExternalStore(f => {
    listeners.add(f)
    if (!timer) { void refreshVotes(true); timer = window.setInterval(() => void refreshVotes(), 3000) }
    return () => { listeners.delete(f) }
  }, () => votes)
}

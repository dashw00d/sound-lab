// The app's resources: what the server has, read once and shared (data/live.ts).
import { api } from '../api/client'
import type { Families, Votes } from '../api/types'
import type { Library, StreamSession } from '../mixer/types'
import { resource, useResource } from './live'

export const SONGS = resource<Library>('songs', api.songs, ['index', 'candidates', 'promoted'])
export const FAMILIES = resource<Families>('families', api.families, ['families'])
export const VOTES = resource<Votes>('votes', api.votes, ['votes'])
export const STREAMS = resource<{ streams: Record<string, StreamSession> }>('streams', () => fetch('/api/streams').then(r => r.json()), ['streams'])

const NO_VOTES: Votes = { clips: {}, picks: {}, notes: {}, cues: {} }
export const useSongs = () => useResource<Library>(SONGS)
export const useFamilies = () => useResource<Families>(FAMILIES)
export const useVotesData = () => useResource<Votes>(VOTES).data ?? NO_VOTES
export const useStreams = () => useResource<{ streams: Record<string, StreamSession> }>(STREAMS)

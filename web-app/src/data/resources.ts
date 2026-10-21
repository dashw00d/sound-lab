// The app's resources: what the server has, read once and shared (data/live.ts).
import { api } from '../api/client'
import type { Families, ProjectInfo, Votes } from '../api/types'
import type { Library, StreamSession } from '../mixer/types'
import { resource, useResource } from './live'

// (/api/songs is 3.8 MB and 0.4 s on the server: it follows what it's made of, the shipped songs and the scored takes,
// not the work index, which the family loop rewrites after every grown extension)
export const SONGS = resource<Library>('songs', api.songs, ['candidates', 'promoted'])
export const PROJECT = resource<ProjectInfo>('project', api.project, [])
export const FAMILIES = resource<Families>('families', api.families, ['families'])
export const VOTES = resource<Votes>('votes', api.votes, ['votes'])
export const STREAMS = resource<{ streams: Record<string, StreamSession> }>('streams', () => fetch('/api/streams').then(r => r.json()), ['streams'])

const NO_VOTES: Votes = { clips: {}, picks: {}, notes: {}, cues: {} }
export const useSongs = () => useResource<Library>(SONGS)
export const useFamilies = () => useResource<Families>(FAMILIES)
export const useVotesData = () => useResource<Votes>(VOTES).data ?? NO_VOTES
export const useProject = () => useResource<ProjectInfo>(PROJECT).data
export const useStreams = () => useResource<{ streams: Record<string, StreamSession> }>(STREAMS)

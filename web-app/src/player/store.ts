// The app's one player (2026-10-21, the designer: "I thought we were gonna have a universal player"): the Mixer engine,
// made once and kept across pages, so whatever any page plays sounds as the game plays it, and keeps playing when the
// page changes. The bar in the shell is its transport; pages get it from usePlayer().
import { useSyncExternalStore } from 'react'
import type { Families, ProjectInfo } from '../api/types'
import { get, reload } from '../data/live'
import { FAMILIES, PROJECT, SONGS } from '../data/resources'
import type { Library } from '../mixer/types'
import { Mixer } from '../mixer/engine/mixer'
import { loadPrefs } from '../mixer/prefs'
import { refreshVotes } from '../state/votes'

export type PlayerState =
  | { status: 'loading' | 'none'; m: null; error?: undefined }  // (none: the project has no music)
  | { status: 'ready'; m: Mixer; error?: undefined }
  | { status: 'error'; m: null; error: string }

let state: PlayerState = { status: 'loading', m: null }
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const set = (s: PlayerState) => { state = s; listeners.forEach(f => f()) }

/** Reads the library (the shipped songs, measured, and the scored new takes) and makes the player. Again later (new
 * stems, fills, glues or takes since): only while nothing plays, so nothing is cut off. */
export function loadPlayer(again = false): Promise<void> {
  if (loading) return loading
  if (again && (state.status !== 'ready' || state.m.playing)) return Promise.resolve()
  loading = (async () => {
    try {
      // (the songs and the scenes from the app's one data layer: read once, shared with the pages)
      if (!get<ProjectInfo>(PROJECT)) await reload(PROJECT)
      const project = get<ProjectInfo>(PROJECT)
      if (project && !project.features.music) { set({ status: 'none', m: null }); return }
      const [prefs] = await Promise.all([loadPrefs(), get(SONGS) ? null : reload(SONGS), get(FAMILIES) ? null : reload(FAMILIES), refreshVotes(true)])
      const shared = get<Library>(SONGS)
      if (!shared) throw new Error('no songs')
      const lib: Library = { ...shared, tracks: [...shared.tracks, ...(shared.candidates ?? [])] }  // (new takes join the walk when asked)
      if (!lib.tracks.some(t => t.measure?.feat)) { set({ status: 'error', m: null, error: "The songs aren't measured: run soundlab music trims (the player needs each song's bar fingerprints)." }); return }
      if (state.m?.playing) return  // (something started while it read)
      const was = state.m
      const m = new Mixer(lib, prefs)
      m.setGraph(get<Families>(FAMILIES))
      set({ status: 'ready', m })
      was?.dispose()
    } catch (e) {
      if (state.status !== 'ready') set({ status: 'error', m: null, error: `Couldn't read the game's music (${(e as Error).message}). Check the terminal running soundlab serve.` })
    } finally { loading = null }
  })()
  return loading
}

// (for diagnosis from the browser's console or a test: the player and its skips)
;(globalThis as unknown as { soundlab: unknown }).soundlab = { player: () => state.m }

export function usePlayer(): PlayerState {
  return useSyncExternalStore(f => {
    listeners.add(f)
    if (state.status === 'loading' && !loading) void loadPlayer()
    return () => { listeners.delete(f) }
  }, () => state)
}

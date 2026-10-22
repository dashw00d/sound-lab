// The Mixer's settings: in the project's data (data/mixer.json, GET/POST /api/mixer), the same in any browser. The
// defaults are the designer's own (2026-10-21): 2-beat joins, a low bed and 1-bar glue matter most to them, and 12
// bars of Stay to judge a part as the game would play it.
import type { Part } from './types'

export interface Prefs {
  set: Part[]
  name: string
  mode: 'any' | 'order'
  intense: 'battle' | 'action'
  pick: string
  glue: 'off' | 'weak' | 'breaths'
  glueKind: 'rest' | 'pad'
  glueBars: number
  /** How a song goes into a rest: tapering over its last bar (the designer's), ringing out past the bar line, or echoing out. */
  tail: 'taper' | 'ring' | 'echo'
  /** Stingers at a scene change (out of a rest or a glue): a riser into its first downbeat, a boom or a crash on it. */
  stingers: { riser: boolean; boom: boolean; crash: boolean }
  stay: number
  vary: { siblings: boolean; stems: boolean; fills: boolean }
  bed: 'off' | 'low' | 'mid'
  joins: 'tight' | 'beat' | 'two'
  match: boolean
  even: boolean
  bassSwap: boolean
  scope: 'set' | 'all' | 'graph'
  /** The graph: bars in one scene before a rest and the next; minutes for a wave from chill to less chill and back. */
  sceneBars: number
  wave: number
  strict: number
  cands: 'off' | 'top' | 'all'
}
export const DEFAULTS: Prefs = {
  set: [], name: '', mode: 'any', intense: 'battle', pick: '', glue: 'breaths', glueKind: 'rest', glueBars: 1, tail: 'taper', stingers: { riser: false, boom: false, crash: false }, stay: 12,
  vary: { siblings: true, stems: true, fills: true }, bed: 'low', joins: 'two', match: true, even: true, bassSwap: false,
  scope: 'all', strict: 0.8, cands: 'off', sceneBars: 48, wave: 8,
}
export const PREF_KEYS = Object.keys(DEFAULTS) as (keyof Prefs)[]

export async function loadPrefs(): Promise<Prefs> {
  try {
    const r = await fetch('/api/mixer')
    const got = r.ok ? await r.json() : {}
    return { ...DEFAULTS, ...Object.fromEntries(PREF_KEYS.filter(k => got[k] !== undefined).map(k => [k, got[k]])) }
  } catch { return { ...DEFAULTS } }
}
let saving = 0
export function savePrefs(p: Prefs) {
  clearTimeout(saving)
  saving = window.setTimeout(() => {
    void fetch('/api/mixer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: Object.fromEntries(PREF_KEYS.map(k => [k, p[k]])) }) })
  }, 300)
}

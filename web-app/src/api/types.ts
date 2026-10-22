// What Sound Lab's API serves (soundlab/server.py), typed. Only the parts the app's pages use.

/** votes.json: the designer's decisions. `clips` holds every thumb and answer (1 | -1). */
export interface Votes {
  clips: Record<string, number>
  picks: Record<string, string>
  notes: Record<string, string>
  cues?: Record<string, { mellow?: [number, number]; intense?: [number, number] }>
}

export interface ProjectInfo {
  name: string
  root: string
  features: { alerts: boolean; music: boolean; balance: boolean }
  default_profile?: string
}

/** GET /api/stamp: when each file last changed (strings: nanoseconds). */
export type Stamp = Record<'index' | 'votes' | 'promoted' | 'tuning' | 'candidates' | 'families' | 'streams', string>

/** A song in work/families.json (music families). Ids are track ids (a new take's: the id `music promote` gives it). */
export interface FamilyItem {
  kind: 'shipped' | 'candidate' | 'trial' | 'extension'
  style: string
  lead: string
  context?: string
  set?: string
  take?: string
  words?: Record<string, string>
  rank?: number
  sibling?: string
  seed?: string
  src: { calm?: string; battle?: string }
  family: string
  conf: number
  next: string | null
  nearest: string[]
  xy: [number, number]
  /** Its splice score with the songs it splices best with (the share of seamless cuts at their best offset). */
  splice?: Record<string, number>
  /** How un-chill it is (music families: beat, bass and noise, standardised; the graph's waves). */
  energy?: number
  /** Where it cuts seamlessly into the other members of its scene: after its bar e, the other from its bar s. */
  cuts?: Record<string, { offset: number; at: [number, number][] }>
  /** The families it nearly splices with: its worst splice with their members just under the bar. */
  guess?: { family: string; worst: number; mean: number }[]
}

export interface Family {
  members: string[]
  medoid: string
  leads: string[]
  shipped: number
  /** The songs that nearly splice with all of it, best first. */
  guesses?: string[]
}

export interface QueueEntry {
  kind: 'new' | 'extension' | 'uncertain' | 'dup'
  item: string
  family: string
  vs?: string
  alike?: number
}

/** GET /api/families */
export interface Families {
  made: string
  items: Record<string, FamilyItem>
  families: Record<string, Family>
  queue: QueueEntry[]
}

/** data/mixes.json: the Mixer's saved sets of parts. */
export type Mixes = Record<string, { parts: { track: string; start: number; bars: number }[]; at: string }>

/** GET /api/sync: the game's folder (soundlab/sync plan): its texts against the lab's, what's shipped into it, the batch
 * ready to ship. */
export interface SyncSong { id: string; kind: string; scene: string | null; bytes: number; missing: string[] }
export interface SyncPlan {
  folder: string
  exists: boolean
  /** When the music in the folder last changed (its manifest's `made`), or null: never written. */
  synced: string | null
  rows: { path: string; state: 'new' | 'changed' | 'same'; bytes: number }[]
  /** The songs walked from the folder: those shipped, in scenes, not bad takes. */
  songs: number
  scenes: number
  cuts: number
  changes: number
  in_game: (SyncSong & { at: string; kept: boolean; walked: boolean })[]
  ready: (SyncSong & { energy: number; lead: string | null })[]
  /** New takes not kept (yet): the next batch, local. */
  local: number
  bytes: number
  readme: string
}

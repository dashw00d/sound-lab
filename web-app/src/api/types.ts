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
export type Stamp = Record<'index' | 'votes' | 'promoted' | 'tuning' | 'candidates' | 'families', string>

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
}

export interface Family {
  members: string[]
  medoid: string
  leads: string[]
  shipped: number
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

// What the Mixer works with: the library (GET /api/songs: music.library, plus the scored new takes), and the walk's
// own pieces (parts, runs, chunks, blocks).
export type Level = 'mellow' | 'intense'
export const STATES: Level[] = ['mellow', 'intense']

export interface Cut { bars: [number, number]; seam: number; score: number; step?: number; dip?: number; quiet?: number }
export interface Measure {
  loud: Record<string, number[]>
  cuts: Record<string, Cut[]>
  step?: Record<string, number>
  feat: number[][]
  tuning?: number
  phrase?: { start: number; contrast: number }
  beats?: Record<string, number[]>
  onset?: { busy: number[]; attack: number[] }
}
export interface Fill { file: string; bars: number; seed: number; beats?: number[] | null; click?: number | null }
export interface Track {
  id: string
  context?: string
  key?: string
  take?: string
  files: Record<string, string>
  src?: Record<string, string>
  measure?: Measure
  family?: { key: string; members: string[]; in_step?: number }
  stems?: Record<string, string>
  stem_gain?: Record<string, number>
  fills?: Record<string, Fill[]>
  glue?: string
  shift?: number
  profile?: string
  candidate?: { rank: number; pick: number; pick_beats: number; nice: number; nice_beats: number; catchy_in_style?: number }
}
export interface Glue { id: string; members: string[]; source: { track: string; bar: number }; bars: number; tonic: number; file: string }
export interface JoinModel { features: string[]; mu: number[]; sd: number[]; w: number[]; n: number; right: number; auc: number }
export interface Library {
  bpm: number
  bar_beats: number
  bars: number
  levels: string[]
  tracks: Track[]
  candidates?: Track[]
  glues: Record<string, Glue>
  join_model: JoinModel | null
}

/** A part: bars start..start+3 of a song. */
export interface Part { track: string; start: number }

/** A run: the walk's visit to a song, entered at a part and playing on in it. */
export interface Run {
  id?: number
  track: string
  entry: Part
  bar?: number
  lo?: number
  hi?: number
  played?: number
  passes?: number
  lastBar?: number
  variant?: string
  lastFill?: string | null
  afterFill?: boolean
  first?: boolean
  swapped?: boolean
  /** Its place in the queue, when the walk plays one. */
  qi?: number
  gn?: Partial<Record<Level, GainNode>> | null
  match?: Partial<Record<Level, number>> | null
}

export type Variant = 'full' | 'nodrums' | 'sparse' | 'pulse'
export interface Source { buf: AudioBuffer; gain: number; pre: number }
/** A chunk: what the walk plays next, from a bar of a song (or a fill, a glue, a rest). */
export interface Chunk {
  kind: 'part' | 'fill' | 'glue' | 'rest'
  track?: string
  bar: number
  bars: number
  variant?: string
  run?: Run
  entry?: Part
  first?: boolean
  fill?: string
  fillBeats?: number[] | null
  hi?: number
  glue?: string
  // set as it's planned and played
  T?: number
  end?: number
  bufs?: { mellow?: Source[]; intense?: Source[]; glue?: AudioBuffer }
  nodes?: AudioNode[]
  scheduled?: boolean
  skipped?: boolean
  failed?: boolean
  post?: number
  bid?: number
  tapeIdx?: number
  heard?: boolean
  replay?: boolean
  rev?: number
  /** Its place in a meeting (playMeeting): which of the parts it is. */
  seg?: number
}
/** A block in the lane: a run's visit (its chunks folded), or a glue or a rest. */
export interface Block {
  kind: Chunk['kind']
  run?: Run
  track?: string
  bar: number
  bars: number
  last: number
  T: number
  end: number
  glue?: string
  chunks: Chunk[]
  vars: Set<string>
}

// ---- the listening stream (data/streams.json) and its review
/** A chunk as the stream keeps it: enough to play it again. */
export interface StreamChunk { kind: 'part' | 'fill'; track: string; bar: number; bars: number; variant?: string; fill?: string; hi?: number }
/** A block as the stream keeps it, with the designer's stars. */
export interface StreamBlock {
  kind: 'part' | 'fill' | 'glue' | 'rest'
  track?: string
  bars: number | [number, number]
  glue?: string
  fill?: string
  variants?: string[]
  chunks?: StreamChunk[]
  played?: number
  fills?: string[]
  siblings?: string[]
  state?: Level
  stars?: number | null
}
export interface StreamTransition { kind: 'transition'; like: number | null; join?: string }
export type StreamEntry = StreamBlock | StreamTransition
export interface StreamSession { at: string; settings: Record<string, unknown>; stream: StreamEntry[] }
export interface ReviewMark { stream: string; block: number; piece: { label: string } & Partial<StreamChunk>; mode: string; note: string; at: string }
/** A part block rated 1 or 2 stars, to review. */
export interface ReviewItem { sid: string; block: number; w: StreamBlock & { kind: 'part'; track: string; bars: [number, number] }; marked: { label: string; note: string }[] }
/** A piece of a block to hear on its own: the chunks that play it, and what a mark on it saves. */
export interface Piece { label: string; desc: Partial<StreamChunk> & { kind: string }; chunks: Chunk[] }

// The scene walk (2026-10-21, the designer: the music should "really flow in the game naturally, but at the same time
// always be unique ... go from chill to less chill in waves"): where the music graph's walk goes next, on its own. It
// knows nothing of audio or of the app: give it the music of a synced manifest (songs, scenes, cuts) and a few settings,
// and ask it for the next step to play. The Mixer walks the graph with it, and `soundlab sync` ships this file to the
// game as walk.js (its reference), so a game makes the choices the Mixer made. No imports, no dependencies.
//
// The walk plays a scene (songs that could pass as sections of one long piece: one lead, beat and bass, amount of noise)
// for a while, cutting from song to song at their seamless cuts (after A's bar e, B from its bar s), each song at least
// Stay bars and at most one pass round its loop; then a rest, and the next scene: the one nearest a target energy that
// rises from chill to less chill and back as a slow wave, never one of the last few, and the songs heard least.

/** Bars in a phrase. */
export const LEN = 4

export interface WalkSong {
  /** The bars it loops between (1-based, inclusive): its mellow cues. */
  loop: [number, number]
  /** Where it's entered on its own: its first phrase start inside the loop. */
  entry: number
  /** The bar its phrases start on (they're 4 bars), or null when it has no clear phrasing. */
  phrase: number | null
  /** How un-chill it is (the library's own scale: higher is busier, brighter, more percussive). */
  energy: number
}
/** A seamless cut: after this song's bar `after`, the song `to` from its bar `start`. */
export interface WalkCut { to: string; after: number; start: number }
export interface WalkData {
  /** Bars in each song's file (the loop is inside them). */
  bars: number
  songs: Record<string, WalkSong>
  scenes: Record<string, { members: string[] }>
  cuts: Record<string, WalkCut[]>
}
export interface WalkSettings {
  /** Bars a song plays at least before the walk looks for a way on. */
  stay: number
  /** Bars in a scene before it rests and moves on. */
  sceneBars: number
  /** Bars in one wave of the target energy, chill to less chill and back. */
  waveBars: number
  /** Bars of silence between scenes. */
  restBars: number
  /** Scenes the next one is never one of (the last few played). Default 4. */
  avoid?: number
}
/** A song's visit: it's entered at `entry` and loops between `lo` and `hi` until the walk leaves it. */
export interface Visit { id: number; song: string; entry: number; lo: number; hi: number }
export type Step =
  | { kind: 'part'; visit: Visit; song: string; bar: number; bars: number; first: boolean; at: number }
  | { kind: 'rest'; bars: number; after: string }
/** What to keep between sessions, so the walk stays unique across them: bars heard of each song, the scenes lately. */
export interface WalkMemory { heard: Record<string, number>; scenes: string[]; bars: number }

interface Run { visit: Visit; bar: number; played: number; lastBar: number; first: boolean }

export class SceneWalk {
  private data!: WalkData
  private settings: () => WalkSettings
  private rand: () => number
  private lo = -1
  private hi = 1
  private run: Run | null = null
  private pending: { song: string; start: number } | null = null
  private scene: { fid: string; bars: number; played: string[] } | null = null
  private bars = 0
  private heard = new Map<string, number>()
  private scenes: string[] = []
  private visits = 0

  constructor(data: WalkData, settings: WalkSettings | (() => WalkSettings), opts: { random?: () => number; memory?: WalkMemory } = {}) {
    this.settings = typeof settings === 'function' ? settings : () => settings
    this.rand = opts.random ?? Math.random
    this.setData(data)
    if (opts.memory) this.remember(opts.memory)
  }
  /** New music (a sync, a vote): the walk goes on where it is. */
  setData(data: WalkData) {
    this.data = data
    const e = Object.values(data.songs).map(s => s.energy).sort((a, b) => a - b)
    this.lo = e.length ? e[Math.floor(e.length * 0.1)] : -1
    this.hi = e.length ? e[Math.floor(e.length * 0.9)] : 1
  }
  /** A fresh walk: nothing heard. */
  reset() { this.run = null; this.pending = null; this.scene = null; this.bars = 0; this.heard = new Map(); this.scenes = [] }
  remember(m: WalkMemory) { this.heard = new Map(Object.entries(m.heard)); this.scenes = [...m.scenes]; this.bars = m.bars }
  memory(): WalkMemory { return { heard: Object.fromEntries(this.heard), scenes: this.scenes.slice(-16), bars: this.bars } }

  /** The energy aimed at after `bars` bars: from chill (the library's 10th percentile) to less chill (its 90th) and back. */
  target(bars = this.bars): number {
    return this.lo + (this.hi - this.lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * bars) / this.settings().waveBars))
  }
  energy(id: string): number { return this.data.songs[id]?.energy ?? 0 }
  members(fid: string): string[] { return (this.data.scenes[fid]?.members ?? []).filter(m => this.data.songs[m]) }
  sceneOf(id: string): string | null { return Object.keys(this.data.scenes).find(f => this.data.scenes[f].members.includes(id)) ?? null }
  /** Where song `a`, just past its bar `after`, can cut seamlessly into another member of its scene. */
  cutsAt(a: string, after: number): WalkCut[] { return (this.data.cuts[a] ?? []).filter(c => c.after === after && this.data.songs[c.to]) }
  /** The songs a visit to `a` may cut into (to load them ahead). */
  cutsFrom(a: string): string[] {
    const s = this.data.songs[a]
    return s ? [...new Set((this.data.cuts[a] ?? []).filter(c => c.after >= s.loop[0] && c.after <= s.loop[1] && this.data.songs[c.to]).map(c => c.to))] : []
  }
  /** Where the walk is: the scene, its bars, the energy aimed at and the song's. */
  state() {
    if (!this.scene) return null
    return { scene: this.scene.fid, bars: this.scene.bars, target: this.target(), energy: this.run ? this.energy(this.run.visit.song) : null }
  }

  /** On to the next scene at once (skip): its first song, which next() then plays. */
  skip(): { song: string; start: number } | null {
    const p = this.enterScene()
    if (p) { this.run = null; this.pending = p }
    return p
  }
  /** Enter a song at a bar (a page's choice, a skip): in its scene, keeping what was heard. */
  enter(song: string, start: number) {
    if (this.pending?.song !== song || this.pending.start !== start || !this.scene) {
      const fid = this.sceneOf(song)
      if (!fid) return
      if (this.scene?.fid !== fid) { this.scene = { fid, bars: 0, played: [] }; this.scenes.push(fid) }
      this.pending = { song, start }
    }
    this.run = null
  }
  /** The song playing is done: the walk moves on at its next chance. */
  hurry() { if (this.run) this.run.played = Math.max(this.run.played, 999) }

  /** The next step: a part of a song (up to a phrase at a time while it has Stay to play, then bar by bar, so it can
   * leave at any bar that cuts well), or a rest between scenes. Null when there's nothing to play. */
  next(depth = 0): Step | null {
    const st = this.settings()
    if (depth > 4) return null
    if (!this.run) {
      const p = this.pending && this.scene ? this.pending : this.enterScene()
      this.pending = null
      if (!p) return null
      this.start(p.song, p.start)
    }
    const r = this.run!, sc = this.scene!, song = r.visit.song
    if (!sc.played.includes(song)) sc.played.push(song)
    // (a song plays its loop at most once before the walk looks for a way on: a 6-bar loop under Stay 12 played three
    // times over is the same thing 18 bars running; the graph never repeats a loop)
    const loopLen = r.visit.hi - r.visit.lo + 1, stay = Math.min(st.stay, loopLen), most = Math.max(stay, Math.min(stay + LEN, loopLen))
    if (sc.bars >= st.sceneBars) {  // (the scene's done: at a phrase end, or 8 bars on at most, a rest, then the next)
      if (r.played >= Math.min(stay, LEN) && (this.phraseEnd(r) || sc.bars >= st.sceneBars + 8 || r.played >= most)) {
        this.run = null; this.scene = null
        return { kind: 'rest', bars: st.restBars, after: song }
      }
    } else if (r.played >= stay) {
      // (a seamless cut into a member this scene hasn't played, toward the target energy and the least heard)
      const t = this.target(), cut = this.cutsAt(song, r.lastBar).filter(c => !sc.played.includes(c.to))
        .map(c => ({ c, k: Math.abs(this.energy(c.to) - t) + 0.05 * Math.log1p(this.heard.get(c.to) ?? 0) + 0.1 * this.rand() })).sort((a, b) => a.k - b.k)[0]?.c
      if (cut) { this.start(cut.to, cut.start); return this.next(depth + 1) }
      if (this.phraseEnd(r) || r.played >= most) {  // (no cut: another member at a phrase end, or before a bar repeats)
        const m = this.pickMember(sc.fid, t, song, sc.played)
        if (m) { this.start(m, this.data.songs[m].entry); return this.next(depth + 1) }
      }
    }
    if (r.bar > r.visit.hi) r.bar = r.visit.lo
    const bars = r.played < stay ? Math.min(LEN - (r.played % LEN), stay - r.played, r.visit.hi - r.bar + 1) : 1
    const step: Step = { kind: 'part', visit: r.visit, song, bar: r.bar, bars, first: r.first, at: r.played }
    r.first = false; r.bar += bars; r.played += bars; r.lastBar = step.bar + bars - 1
    sc.bars += bars; this.bars += bars; this.heard.set(song, (this.heard.get(song) ?? 0) + bars)
    return step
  }

  private start(song: string, start: number) {
    const s = this.data.songs[song], lo = Math.min(s.loop[0], start), hi = Math.min(this.data.bars, Math.max(s.loop[1], start + LEN - 1))
    this.run = { visit: { id: ++this.visits, song, entry: start, lo, hi }, bar: start, played: 0, lastBar: start - 1, first: true }
  }
  /** Is the visit's last bar the end of a phrase? */
  private phraseEnd(r: Run): boolean {
    const ph = this.data.songs[r.visit.song]?.phrase
    if (ph != null) return (((r.lastBar - ph) % LEN) + LEN) % LEN === LEN - 1
    return r.played % LEN === 0
  }
  /** The next scene: the nearest the target energy (its members' mean), a little against those heard more, never one of
   * the last few; one of the best three, so no two walks are the same. Its first song: nearest the target, heard least. */
  private enterScene(): { song: string; start: number } | null {
    const t = this.target(), avoid = this.settings().avoid ?? 4
    const recent = [...this.scenes.slice(-avoid), ...(this.scene ? [this.scene.fid] : [])]
    const fs = Object.keys(this.data.scenes).map(fid => ({ fid, ms: this.members(fid) })).filter(x => x.ms.length)
    const fresh = fs.filter(x => !recent.includes(x.fid)), from = fresh.length ? fresh : fs
    const cost = (x: { ms: string[] }) => {
      const e = x.ms.reduce((a, m) => a + this.energy(m), 0) / x.ms.length, h = x.ms.reduce((a, m) => a + (this.heard.get(m) ?? 0), 0) / x.ms.length
      return Math.abs(e - t) + 0.02 * Math.log1p(h) + 0.15 * this.rand()
    }
    const best = from.map(x => ({ x, c: cost(x) })).sort((a, b) => a.c - b.c).slice(0, 3)
    const fid = best.length ? best[Math.floor(this.rand() * best.length)].x.fid : null
    const m = fid ? this.pickMember(fid, t) : null
    if (!fid || !m) return null
    this.scene = { fid, bars: 0, played: [] }; this.scenes.push(fid)
    return { song: m, start: this.data.songs[m].entry }
  }
  /** A member to play: one the scene hasn't played if there is one, nearest the target energy, heard least, not `not`. */
  private pickMember(fid: string, target: number, not?: string, played: string[] = []): string | null {
    const all = this.members(fid).filter(m => m !== not), fresh = all.filter(m => !played.includes(m)), ms = fresh.length ? fresh : all
    return ms.map(m => ({ m, c: Math.abs(this.energy(m) - target) + 0.05 * Math.log1p(this.heard.get(m) ?? 0) + 0.1 * this.rand() }))
      .sort((a, b) => a.c - b.c)[0]?.m ?? null
  }
}

/** The walk a synced manifest (soundlab.json) describes: its music, and its play settings. */
export function fromManifest(m: { walk: WalkData; play: WalkSettings }, opts: { random?: () => number; memory?: WalkMemory } = {}): SceneWalk {
  const p = m.play
  return new SceneWalk(m.walk, { stay: p.stay, sceneBars: p.sceneBars, waveBars: p.waveBars, restBars: p.restBars, avoid: p.avoid }, opts)
}

/** A seeded random source (mulberry32), for a walk a game can repeat. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

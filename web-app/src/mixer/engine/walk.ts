// The walk: where the music goes next (mixer.js planNext and its helpers).
//
// A run enters a song at a part and plays on in it as SA3 wrote it (looping between the song's mellow cues) for at least
// Stay bars; then, at a phrase end, it takes a transition the taste model puts over the taste bar (or settles for 50%
// once forced), or goes through the glue (a rest: a taper into silence; or a pad). Each 4-bar phrase may vary: a
// sibling at the same bars, stems (drums out, sparse), a fill at the loop point.
//
// Drawing from the graph, it plays scenes instead, as the scene walk (scenewalk.ts, the same file a game gets as walk.js)
// says: a scene for Scene bars, cutting from song to song inside it at their seamless cuts, then a rest and the next
// scene, nearest a target energy that rises and falls in waves.
//
// A page can also pin the walk to one song (played as written, round its cues, until stopped), or give it a queue:
// each song in turn, as written, for exactly Stay bars from its first phrase start, then straight into the next
// (2026-10-21: the designer queues songs from the Families graph to hear whether they match; "I have it set to 4 bars").
import { getVotes } from '../../state/votes'
import { LEN, pkey, type Judge, type Judged } from '../judge'
import type { Prefs } from '../prefs'
import type { Chunk, Part, Run } from '../types'
import { withoutDisliked, type Graph } from './graph'
import { SceneWalk, type Step, type Visit, type WalkData, type WalkSettings } from './scenewalk'

/** The stems a phrase may vary to: only the song's own (2026-10-22, the designer: "stems should originate from the same
 * source"). "pulse" laid the battle level's drums under calm, and those drums are the text-made percussion layer (taiko,
 * snare rolls, cymbal crashes), not the song's: 3 of the 4 blocks it played in were rated 2, against 2 of 58 plain blocks. */
const STEMS = ['nodrums', 'sparse'] as const

export class Walk {
  run: Run | null = null
  pendingEntry: Part | null = null
  private runs = 0
  private recent: string[] = []
  private recentTracks: string[] = []
  private run0: Part | null = null
  /** One song, as it's written: the walk never leaves it and nothing varies (a page playing a song). */
  private pin = false
  private queue: Part[] | null = null
  private qi = 0
  /** Bars to skip into the first run (a queue's song, to just before it ends: the next transition). */
  private ffw = 0
  private sinceGlue = 0
  private breath = 3
  // (the graph, and its walk: the scene playing, bars walked, bars heard of each song, the scenes lately)
  private graph: Graph | null = null
  private sw: SceneWalk | null = null
  private visit: Visit | null = null

  private jd: Judge
  private prefs: () => Prefs
  private prefetch: (ids: string[]) => void
  constructor(jd: Judge, prefs: () => Prefs, prefetch: (ids: string[]) => void = () => {}) { this.jd = jd; this.prefs = prefs; this.prefetch = prefetch }
  /** The songs likely next after a run of `tid` starts: the queue's next, or the graph's cuts out of its loop. Their
   * files are decoded ahead, so a change of song never waits on them (a skip). */
  private upcoming(tid: string): string[] {
    if (this.queue) return [this.queue[(this.qi + 1) % this.queue.length].track]
    if (this.graphOn && this.sw) return this.sw.cutsFrom(tid).slice(0, 2)
    return []
  }

  /** A fresh walk; `from` enters first, keeping what was heard lately (skip, replay). `pin`: stay in `from`'s song;
   * `queue`: its songs in turn, from the one at `at`. */
  reset(from: Part | null, opts: { pin?: boolean; queue?: Part[]; at?: number; ffw?: number } = {}) {
    this.ffw = opts.ffw ?? 0
    const queue = opts.queue?.length ? opts.queue : null, qi = queue ? (((opts.at ?? 0) % queue.length) + queue.length) % queue.length : 0
    Object.assign(this, { run: null, pendingEntry: queue ? queue[qi] : from, runs: 0, run0: null, sinceGlue: 0, breath: 3, pin: !!opts.pin && !!from, queue, qi })
    if (!from) { this.recent = []; this.recentTracks = [] }
    if (this.graphOn) { const sw = this.scenes(); this.visit = null; if (!from) sw?.reset(); else sw?.enter(from.track, from.start) }
  }
  setGraph(g: Graph | null) { this.graph = g; if (!g) this.sw = null }
  /** As the game (the Game page): the walk on the game's own graph and rules (its manifest's), or back to the lab's. */
  private game: { data: WalkData; settings: WalkSettings; clips?: Record<string, number> } | null = null
  setGame(g: { data: WalkData; settings: WalkSettings } | null) { this.game = g; this.sw = null; this.visit = null }
  /** The scene walk, on the graph as the votes stand now (a vote or a cue moved: the walk goes on in the new one); as the
   * game, on the game's. */
  private scenes(): SceneWalk | null {
    if (this.game) {  // (a cut thumbed down while it plays: never taken from then on)
      const g = this.game, clips = getVotes().clips
      if (g.clips !== clips) { g.clips = clips; const d = withoutDisliked(g.data, clips); if (this.sw) this.sw.setData(d); else this.sw = new SceneWalk(d, () => g.settings) }
      return this.sw
    }
    if (!this.graph) return null
    const v = getVotes(), d = this.graph.data(v.clips, v.cues)
    if (!this.sw) this.sw = new SceneWalk(d, () => {
      const pr = this.prefs()
      return { stay: pr.stay, sceneBars: pr.sceneBars, waveBars: (pr.wave * 60) / this.jd.barS(), restBars: pr.glueBars, avoid: 4 }
    })
    else this.sw.setData(d)
    return this.sw
  }
  /** The song playing is done: the walk moves on at its next chance (a phrase end; in the graph, at once). */
  hurry() { if (this.run) this.run.played = Math.max(this.run.played!, 999); this.sw?.hurry() }
  get graphOn() { return this.prefs().scope === 'graph' && (!!this.graph || !!this.game) && !this.pin && !this.queue }
  /** Where the graph is: the scene, the energy aimed at, and the song's. */
  graphState() { return this.graphOn ? this.sw?.state() ?? null : null }
  /** What the walk draws from: the set's parts, or every song's phrase starts. */
  pool(): Part[] { return this.prefs().scope === 'set' ? this.prefs().set : this.jd.libEntries() }

  pickEntry(fromTrack: string | null): Part | null {
    if (this.graphOn) {  // (skip: the next scene)
      const p = this.scenes()?.skip()
      return p ? { track: p.song, start: p.start } : null
    }
    const P = this.pool(), pr = this.prefs()
    if (!P.length) return null
    if (pr.mode === 'order' && pr.scope !== 'all') { const i = this.run0 ? P.findIndex(p => pkey(p) === pkey(this.run0!)) : -1; return P[(i + 1) % P.length] }
    const recent = pr.scope === 'all' ? [] : this.recent.slice(-(P.length >= 3 ? 2 : 1)), songs = pr.scope === 'all' ? this.recentTracks.slice(-6) : []
    const ok = P.filter(p => p.track !== fromTrack && !recent.includes(pkey(p)) && !songs.includes(p.track))
    const from = ok.length ? ok : P
    return from[Math.floor(Math.random() * from.length)]
  }
  private exits(r: Run): Judged[] {
    const e = r.lastBar!, P = this.pool(), pr = this.prefs()
    if (pr.scope === 'all') {  // (the whole library: every entry scored, the walk choosing among the 8 best it may take)
      const songs = this.recentTracks.slice(-6)
      return P.filter(p => p.track !== r.track && !songs.includes(p.track)).map(p => this.jd.judge(r.track, e, p))
        .filter(x => x.ok).sort((a, b) => Number(b.v > 0) - Number(a.v > 0) || b.w - a.w).slice(0, 8)
    }
    const recent = this.recent.slice(-(P.length >= 3 ? 2 : 1))
    const want = pr.mode === 'order' ? [this.pickEntry(r.track)] : P.filter(p => p.track !== r.track && !recent.includes(pkey(p)))
    return want.filter((p): p is Part => !!p).map(p => this.jd.judge(r.track, e, p)).filter(x => x.ok)  // (a liked transition always; a disliked one never)
  }
  private weighted(xs: Judged[]): Judged {
    const w = xs.map(x => (x.v > 0 ? 3 : 1) * Math.max(0.05, x.w || 1)), t = w.reduce((a, b) => a + b, 0)
    let r = Math.random() * t
    for (let i = 0; i < xs.length; i++) if ((r -= w[i]) < 0) return xs[i]
    return xs[xs.length - 1]
  }
  /** Is the run's last bar the end of a phrase? */
  private phraseEnd(r: Run): boolean {
    const ph = this.jd.track(r.track)?.measure?.phrase
    if (ph && ph.contrast >= 0.08) return (((r.lastBar! - ph.start) % LEN) + LEN) % LEN === LEN - 1
    return r.played! % LEN === 0
  }
  /** A new list for the queue playing (the page's choice changed): on in it from the song playing, or from where that
   * song was when it's no longer in it. */
  setQueue(parts: Part[]) {
    if (!this.queue || !parts.length) return
    const r = this.run, i = r ? parts.findIndex(p => p.track === r.entry.track) : -1
    if (i >= 0) { this.qi = i; r!.qi = i } else { this.qi = Math.min(this.qi, parts.length) - 1; if (r) r.qi = undefined }
    this.queue = parts
  }
  /** As written: no exits of its own, no fills, no variations. */
  private get plain() { return this.pin || !!this.queue }
  private startRun(p: Part) {
    const [lo, hi] = this.jd.loopFor(p.track, p.start)
    this.run = { id: ++this.runs, track: p.track, entry: p, bar: p.start, lo, hi, played: 0, passes: 0, lastBar: p.start - 1, variant: 'full', lastFill: null, first: true,
                 qi: this.queue ? this.qi : undefined }
    this.recent.push(pkey(p)); this.recentTracks.push(p.track); this.run0 = p; this.sinceGlue++
    this.prefetch(this.upcoming(p.track))
    if (this.ffw > 0) {  // (into the run: round its loop, counted as played)
      const r = this.run!, len = r.hi! - r.lo! + 1
      r.bar = r.lo! + ((((r.bar! - r.lo! + this.ffw) % len) + len) % len); r.played = this.ffw; r.lastBar = r.bar - 1; r.first = false
      this.ffw = 0
    }
  }

  /** The graph's next chunk: the scene walk's next step, a song's visit as a run (one block, rated once); between scenes,
   * what the Glue settings say (2026-10-22, the designer: "Im getting rests when I have them off or set to pad"): off,
   * straight into the next scene; a pad, the song's own glue; else a rest. And the variation settings, as the rest of the
   * walk has them: a phrase may go on in a sibling or as stems, and a song going round its loop may take a fill. */
  private held: Step | null = null  // (a step held back while a fill plays before it)
  private nextGraph(): Chunk | null {
    const pr = this.prefs(), jd = this.jd, clips = getVotes().clips
    let s = this.held ?? this.scenes()?.next() ?? null
    this.held = null
    if (!s) return null
    if (s.kind === 'rest') {
      this.run = null; this.visit = null
      const gid = jd.glueOf(s.after)
      if (pr.glue === 'off') s = this.scenes()?.next() ?? null  // (straight on: the next scene's first song crosses over as any song change)
      else if (pr.glueKind === 'pad' && gid && (clips['glue_' + gid] || 0) >= 0) return { kind: 'glue', bar: 1, glue: gid, bars: s.bars, track: s.after }
      else return { kind: 'rest', bar: 1, bars: s.bars, track: s.after }
      if (!s) return null
      if (s.kind === 'rest') return { kind: 'rest', bar: 1, bars: s.bars, track: s.after }
    }
    if (this.visit?.id !== s.visit.id || !this.run) {  // (a new visit: a run of its own)
      this.visit = s.visit
      this.startRun({ track: s.song, start: s.visit.entry })
      Object.assign(this.run!, { lo: s.visit.lo, hi: s.visit.hi })
    } else if (s.bar === s.visit.lo && this.run.lastBar === s.visit.hi && s.at > 0) {  // (round its loop: a fill first, when there is one)
      const r = this.run, [ms, me] = jd.cueOf(r.entry.track)
      const swing = (f: { beats?: number[] | null }) => (f.beats?.length ? Math.max(...f.beats) - Math.min(...f.beats) : 0)
      const fl = pr.vary.fills && r.lo === ms && r.hi === me ? (jd.track(r.track)?.fills?.[`${ms}-${me}`] ?? [])
        .filter(f => (clips['fill_' + f.file] || 0) >= 0 && swing(f) <= 10 && (f.click || 0) <= 3 && !f.stinger?.length) : []
      if (fl.length) {
        const fresh = fl.filter(f => f.file !== r.lastFill), f = (fresh.length ? fresh : fl)[Math.floor(Math.random() * (fresh.length || fl.length))]
        r.lastFill = f.file; r.lastBar = r.lo! - 1; this.held = s
        return { kind: 'fill', track: r.track, bar: r.lo!, bars: f.bars, fill: f.file, fillBeats: f.beats, hi: r.hi, run: r, entry: r.entry }
      }
    }
    const r = this.run!
    if (s.at >= LEN && s.at % LEN === 0) {  // (a new phrase: perhaps a variation, as the walk's)
      const sib = jd.family(r.track)
      if (pr.vary.siblings && sib.length && Math.random() < 0.3) { r.track = sib[Math.floor(Math.random() * sib.length)]; r.swapped = true }
      const st = jd.track(r.track)?.stems ?? {}
      const ok = st['calm.other'] && st['calm.bass'] ? STEMS.filter(v => v !== r.variant) : []
      r.variant = pr.vary.stems && ok.length && Math.random() < 0.45 ? ok[Math.floor(Math.random() * ok.length)] : 'full'
    }
    const c: Chunk = { kind: 'part', at: s.at, track: r.track, bar: s.bar, bars: s.bars, variant: r.variant ?? 'full', run: r, entry: r.entry, first: s.first }
    r.first = false; r.bar = s.bar + s.bars; r.played = s.at + s.bars; r.lastBar = s.bar + s.bars - 1
    return c
  }

  /** The next chunk to play. */
  next(): Chunk | null {
    if (this.graphOn) return this.nextGraph()
    const jd = this.jd, pr = this.prefs(), clips = getVotes().clips
    if (!this.run) { const p = this.pendingEntry ?? this.pickEntry(null); this.pendingEntry = null; if (!p) return null; this.startRun(p) }
    const r = this.run!
    if (this.queue && r.played! >= pr.stay) {  // (a queue: after exactly Stay bars, the next song, straight in)
      this.qi = (this.qi + 1) % this.queue.length
      this.startRun(this.queue[this.qi])
      return this.next()
    }
    if (!this.plain && r.played! >= pr.stay && !r.afterFill) {
      // A straight exit can be at any bar that joins well; the glue only at the end of a phrase, so it never cuts a phrase
      // off. A breath that's due waits for one; with no exit in 8 bars past Stay, the run goes at the next phrase end anyway.
      const rest = pr.glueKind === 'rest', gid = jd.glueOf(r.track), atPhrase = this.phraseEnd(r)
      const glueOn = pr.glue !== 'off' && (rest || (!!gid && (clips['glue_' + gid] || 0) >= 0))  // (a rest needs no pad)
      const breath = glueOn && pr.glue === 'breaths' && this.sinceGlue >= this.breath
      const forced = r.played! >= pr.stay + 8 || !this.pool().some(p => p.track !== r.track)
      // (the taste bar: by the designer's own votes, they liked 89% of what the model put at 80% or more and about 60%
      // between 50 and 80; so the walk waits for one over the bar, and only once forced takes what passes 50%)
      const all = breath || !atPhrase ? [] : this.exits(r), over = all.filter(x => x.v > 0 || x.w >= pr.strict)
      const ex = over.length ? over : forced ? all : []
      if (this.pool().length && (ex.length || ((breath || forced) && atPhrase))) {
        const to = ex.length ? this.weighted(ex).p : this.pickEntry(r.track)
        if (to) {  // (nowhere to go: the song plays on)
          this.run = null
          if (glueOn && !ex.length) {
            this.pendingEntry = to; this.sinceGlue = 0; this.breath = 2 + Math.floor(Math.random() * 3)
            return rest ? { kind: 'rest', bar: 1, bars: pr.glueBars, track: r.track } : { kind: 'glue', bar: 1, glue: gid!, bars: pr.glueBars, track: r.track }
          }
          this.startRun(to)
          return this.next()
        }
      }
    }
    if (r.bar! > r.hi!) {  // round the loop: a generated fill, when there is one for this cue
      r.bar = r.lo; r.passes!++
      const swing = (f: { beats?: number[] | null }) => (f.beats?.length ? Math.max(...f.beats) - Math.min(...f.beats) : 0)  // (over 10 dB inside: a fill no leveling saves)
      const [ms, me] = jd.cueOf(r.track)
      const fl = pr.vary.fills && !this.plain ? (jd.track(r.track)?.fills?.[`${ms}-${me}`] ?? [])
        .filter(f => (clips['fill_' + f.file] || 0) >= 0 && swing(f) <= 10 && (f.click || 0) <= 3 && !f.stinger?.length) : []  // (3: dsp.CLICK)
      if (fl.length && r.lo === ms && r.hi === me) {
        const fresh = fl.filter(f => f.file !== r.lastFill), f = (fresh.length ? fresh : fl)[Math.floor(Math.random() * (fresh.length || fl.length))]
        r.lastFill = f.file; r.afterFill = true
        return { kind: 'fill', track: r.track, bar: r.lo!, bars: f.bars, fill: f.file, fillBeats: f.beats, hi: r.hi, run: r, entry: r.entry }
      }
    }
    if (!this.plain && r.played! >= LEN && r.played! % LEN === 0) {  // a new phrase: perhaps a variation
      const sib = jd.family(r.track)
      if (pr.vary.siblings && sib.length && Math.random() < 0.3) { r.track = sib[Math.floor(Math.random() * sib.length)]; r.swapped = true }
      const st = jd.track(r.track)?.stems ?? {}
      const ok = st['calm.other'] && st['calm.bass'] ? STEMS.filter(v => v !== r.variant) : []
      r.variant = pr.vary.stems && ok.length && Math.random() < 0.45 ? ok[Math.floor(Math.random() * ok.length)] : 'full'
    }
    const len = this.pin ? Math.min(LEN, r.hi! - r.bar! + 1) : r.played! < pr.stay ? Math.min(LEN - (r.played! % LEN), pr.stay - r.played!, r.hi! - r.bar! + 1) : 1
    r.afterFill = false
    const c: Chunk = { kind: 'part', at: r.played!, track: r.track, bar: r.bar!, bars: len, variant: r.variant, run: r, entry: r.entry, first: r.first }
    r.first = false; r.bar! += len; r.played! += len; r.lastBar = c.bar + len - 1
    return c
  }
}

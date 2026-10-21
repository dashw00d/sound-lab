// The walk: where the music goes next (mixer.js planNext and its helpers).
//
// A run enters a song at a part and plays on in it as SA3 wrote it (looping between the song's mellow cues) for at least
// Stay bars; then, at a phrase end, it takes a transition the taste model puts over the taste bar (or settles for 50%
// once forced), or goes through the glue (a rest: a taper into silence; or a pad). Each 4-bar phrase may vary: a
// sibling at the same bars, stems (drums out, sparse, the battle drums in), a fill at the loop point.
//
// A page can also pin the walk to one song (played as written, round its cues, until stopped), or give it a queue:
// each song in turn, as written, for exactly Stay bars from its first phrase start, then straight into the next
// (2026-10-21: the designer queues songs from the Families graph to hear whether they match; "I have it set to 4 bars").
import { getVotes } from '../../state/votes'
import { LEN, pkey, type Judge, type Judged } from '../judge'
import type { Prefs } from '../prefs'
import type { Chunk, Part, Run } from '../types'

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
  private sinceGlue = 0
  private breath = 3

  private jd: Judge
  private prefs: () => Prefs
  constructor(jd: Judge, prefs: () => Prefs) { this.jd = jd; this.prefs = prefs }

  /** A fresh walk; `from` enters first, keeping what was heard lately (skip, replay). `pin`: stay in `from`'s song;
   * `queue`: its songs in turn, from the one at `at`. */
  reset(from: Part | null, opts: { pin?: boolean; queue?: Part[]; at?: number } = {}) {
    const queue = opts.queue?.length ? opts.queue : null, qi = queue ? (((opts.at ?? 0) % queue.length) + queue.length) % queue.length : 0
    Object.assign(this, { run: null, pendingEntry: queue ? queue[qi] : from, runs: 0, run0: null, sinceGlue: 0, breath: 3, pin: !!opts.pin && !!from, queue, qi })
    if (!from) { this.recent = []; this.recentTracks = [] }
  }
  /** What the walk draws from: the set's parts, or every song's phrase starts. */
  pool(): Part[] { return this.prefs().scope === 'all' ? this.jd.libEntries() : this.prefs().set }

  pickEntry(fromTrack: string | null): Part | null {
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
  }

  /** The next chunk to play. */
  next(): Chunk | null {
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
        .filter(f => (clips['fill_' + f.file] || 0) >= 0 && swing(f) <= 10 && (f.click || 0) <= 3) : []  // (3: dsp.CLICK)
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
      const ok = ['nodrums', 'sparse', 'pulse'].filter(v => v !== r.variant && (v === 'pulse' ? st['battle.drums'] : st['calm.other'] && st['calm.bass']))
      r.variant = pr.vary.stems && ok.length && Math.random() < 0.45 ? ok[Math.floor(Math.random() * ok.length)] : 'full'
    }
    const len = this.pin ? Math.min(LEN, r.hi! - r.bar! + 1) : r.played! < pr.stay ? Math.min(LEN - (r.played! % LEN), pr.stay - r.played!, r.hi! - r.bar! + 1) : 1
    r.afterFill = false
    const c: Chunk = { kind: 'part', track: r.track, bar: r.bar!, bars: len, variant: r.variant, run: r, entry: r.entry, first: r.first }
    r.first = false; r.bar! += len; r.played! += len; r.lastBar = c.bar + len - 1
    return c
  }
}

// The Mixer: the walk played on the audio clock (mixer.js, ported), and the app's one player (player/store): whatever a
// page plays (a song, a part, a join, an extension) goes through it, so it sounds as the game plays it. It owns the plan
// (the chunks planned ahead, about 6 s), the tape (every chunk planned, in order, for Back), the pump (every 200 ms: plan
// ahead, schedule what's due within 3 s), and the transport; the Walk decides what comes next, the Scheduler makes it
// sound, the Session records it. Pages read snapshot() each frame and call the methods; onChange tells them when to
// redraw the rest.
import { audio } from '../../audio/context'
import { toast } from '../../shell/toast'
import { getVotes, vote } from '../../state/votes'
import { joinKey, Judge, LEN, name, WEAK, XF } from '../judge'
import { PartMatrix } from '../matrix'
import { savePrefs, type Prefs } from '../prefs'
import type { Families } from '../../api/types'
import type { Block, Chunk, Level, Library, Part, Piece, ReviewItem, Run } from '../types'
import { loadReview, reviewScript, VARIANT } from './review'
import { Scheduler } from './scheduler'
import { blockKey, Session } from './session'
import { freshTraining, trainPair, type Training } from './training'
import { Graph } from './graph'
import { Walk } from './walk'

/** A song in a queue, with the name the page gave it. */
export interface QueueItem { id: string; label: string }
const inRun = (c: Chunk) => (c.kind === 'part' || c.kind === 'fill') && !!c.run
const PLAN_AHEAD = 6, SCHEDULE_AHEAD = 3, PUMP_MS = 200

export class Mixer {
  readonly jd: Judge
  readonly sched: Scheduler
  private walk: Walk
  private mx: PartMatrix | null = null
  plan: Chunk[] = []
  private script: Chunk[] | null = null
  private replay: Chunk[] | null = null
  private tape: Chunk[] = []
  private bseq = 0
  private gen = 0
  private timer = 0
  private starting = false
  private pinned = false
  playing = false
  /** What a page asked to play (a song's id), so it can light it; null for the walk. */
  tag: string | null = null
  /** The queue (a page's choice of songs): Play plays it when there is one; kept when stopped, until cleared. */
  queue: QueueItem[] | null = null
  private heardRun: Run | null = null
  private prevRun: Run | null = null
  sess: Session | null = null
  train: Training = freshTraining()
  review: { items: ReviewItem[] | null; cur: { i: number; mode: 'exact' | 'pieces'; pieces: Piece[] } | null } = { items: null, cur: null }
  private listeners = new Set<() => void>()

  prefs: Prefs

  constructor(lib: Library, prefs: Prefs) {
    const has = new Set(lib.tracks.map(t => t.id))
    this.prefs = { ...prefs, set: prefs.set.filter(p => has.has(p.track)) }  // (a part of a song no longer shipped plays nothing; saved as is until a change)
    this.jd = new Judge(lib, () => this.prefs, getVotes)
    this.walk = new Walk(this.jd, () => this.prefs)
    this.sched = new Scheduler(this.jd, () => this.prefs, () => this.playing)
  }
  get lib() { return this.jd.lib }
  get state(): Level { return this.sched.state }
  /** What's playing: the walk, one song (playSong), a queue (playQueue), or a script (auditions, training, the review). */
  get mode(): 'walk' | 'song' | 'queue' | 'script' | null {
    return !this.playing ? null : this.script ? 'script' : this.pinned ? 'song' : this.queueOn ? 'queue' : 'walk'
  }
  private queueOn = false
  get walking() { return this.mode === 'walk' }
  matrix(): PartMatrix { return (this.mx ??= new PartMatrix(this.jd)) }
  onChange(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f) } }
  private changed() { this.listeners.forEach(f => f()) }
  setPrefs(p: Partial<Prefs>) {
    const was = this.prefs
    this.prefs = { ...this.prefs, ...p }
    if (p.cands !== undefined && p.cands !== was.cands) this.mx = null  // (the parts the matrix covers changed)
    if (p.bed !== undefined && this.playing && !this.script) { const c = this.nowChunk(); this.sched.bedTo(c ? this.jd.glueOf(c.track) : null, audio().currentTime + 0.1) }
    savePrefs(this.prefs)
    if (p.intense !== undefined && p.intense !== was.intense && this.playing) {  // (the other files: the walk starts again in them)
      const walk = this.walking
      this.stop()
      if (walk) void this.play()
    }
    this.changed()
  }
  private now() { return audio().currentTime }

  // ---- the pump
  private next(): Chunk | null {
    if (this.replay?.length) return this.replay.shift()!  // (back: the tape again, chunk for chunk)
    if (this.script) return this.script.shift() ?? null
    return this.walk.next()
  }
  /** A chunk that goes on the same run in the same song shares its block's id; anything else starts a block. */
  private enter(c: Chunk, last: Chunk | null) {
    if (c.bid == null) c.bid = last && inRun(last) && inRun(c) && last.run === c.run ? last.bid : ++this.bseq
    if (c.tapeIdx == null && !this.script) { c.tapeIdx = this.tape.length; this.tape.push(c) }  // (the tape: what the walk planned, in order)
    this.plan.push(c)
  }
  private pump = () => {
    if (!this.playing) return
    const now = this.now(), barS = this.jd.barS()
    if (!this.plan.length) {  // (the first chunk: loaded before it's given a time, so it starts on time)
      if (this.starting) return
      const c = this.next(), g = this.gen
      if (!c) { if (this.script) this.stop(); return }
      this.starting = true
      this.sched.prepare(c).then(b => {
        this.starting = false
        if (g !== this.gen) return
        c.bufs = b; c.T = this.now() + 0.12 + (c.kind === 'glue' ? barS : 0); c.end = c.T + c.bars * barS
        this.enter(c, null); this.pump()
      }).catch(() => { this.starting = false })
      return
    }
    let last: Chunk | null = this.plan[this.plan.length - 1]
    while ((last ? last.end! : now) - now < PLAN_AHEAD) {
      const c = this.next()
      if (!c) break
      c.T = last ? last.end! : now + 0.25 + (c.kind === 'glue' ? barS : 0)
      c.end = c.T + c.bars * barS
      this.sched.prepare(c).then(b => { c.bufs = b }).catch(() => { c.failed = true })
      this.enter(c, last); last = c
    }
    for (let i = 0; i < this.plan.length; i++) {
      const c = this.plan[i]
      if (c.scheduled) continue
      if (c.T! - now > SCHEDULE_AHEAD) break
      if (!c.bufs) { if (c.failed || c.T! - now < 0.05) { c.scheduled = c.skipped = true; continue } break }
      this.sched.schedule(c, this.plan[i - 1]); c.scheduled = true
    }
    for (const c of this.plan) if (c.scheduled && !c.skipped && c.T! <= now && c.tapeIdx != null && this.tape[c.tapeIdx]) this.tape[c.tapeIdx].heard = true
    this.record(now)
    const run = this.nowChunk(now)?.run ?? null
    if (run && run !== this.heardRun) { this.prevRun = this.heardRun; this.heardRun = run; this.changed() }  // (a new song heard: pages light it)
    this.plan = this.plan.filter(c => c.end! > now - 30)
    if (this.script && !this.script.length && this.plan.every(c => c.end! < now)) this.stop()
  }
  private start() {
    this.playing = true; this.starting = false
    this.pump()
    clearInterval(this.timer); this.timer = window.setInterval(this.pump, PUMP_MS)  // (keeps going in a background tab)
    this.changed()
  }

  // ---- the transport
  /** The walk (a fresh session), or a script (auditions, training, review: no session). `from`: a part to enter first,
   * keeping the history (skip); with `pin`, the walk stays in its song (no session). `tag`: what the page asked for. */
  async play(script: Chunk[] | null = null, from: Part | null = null, opts: { pin?: boolean; tag?: string; queue?: QueueItem[]; at?: number } = {}) {
    ++this.gen
    const queue = !script && opts.queue?.length ? opts.queue : null, pin = !script && !queue && !!from && !!opts.pin
    if (!script && from && !pin) { let n = this.tape.length; while (n > 0 && !this.tape[n - 1].heard) n--; this.tape.length = n }
    else if (!script) this.tape = []
    this.replay = null
    if (script || pin || queue) this.sess = null
    else if (!from || !this.sess) this.sess = new Session(() => this.prefs)
    if (!script?.some(c => c.rev != null)) this.review.cur = null
    if (audio().state === 'suspended') await audio().resume()
    this.halt()
    if (!script && !pin && !queue && !this.walk.pool().length) { toast('Add some parts first'); return }
    this.script = script ? [...script] : null
    this.pinned = pin; this.queueOn = !!queue; this.tag = opts.tag ?? null
    this.heardRun = this.prevRun = null
    if (queue) this.queue = queue
    this.plan = []
    this.walk.reset(from, { pin, queue: queue ? this.queueParts(queue) : undefined, at: opts.at })
    this.start()
  }
  private halt() { this.sched.halt(this.plan); this.plan = []; this.playing = false; clearInterval(this.timer) }
  stop() { this.gen++; this.halt(); this.script = null; this.tag = null; this.changed() }
  /** The listening volume (0..1, as the slider; heard as its square, so the low end is fine-grained), or muted. */
  setVolume(v: number, muted: boolean) {
    const g = muted ? 0 : Math.max(0, Math.min(1, v)) ** 2
    this.sched.volume.gain.setTargetAtTime(g, audio().currentTime, 0.03)
  }
  /** Done with (the library was read again): silent, and off the output. */
  dispose() { this.stop(); this.listeners.clear(); this.sched.out.disconnect() }
  /** Back (2026-10-21: the designer needs to hear a transition again, identically): the tape from 2 bars before the
   * transition into the block playing, every chunk as it was, then the walk goes on from where it had got to. Pressed
   * again within 3 s of a block's start: the transition before that. A replayed chunk keeps its block's id. */
  back() {
    if (this.mode === 'queue') {  // (a queue: this song from its start; within 3 s of it, the one before)
      const cur = this.nowChunk(), began = this.plan.find(c => c.run === cur?.run && c.scheduled && !c.skipped)?.T ?? 0, qi = this.heard().qi ?? 0
      this.playQueue(this.queue!, this.now() - began < 3 ? qi - 1 : qi)
      return
    }
    if (!this.walking || !this.tape.length) return
    const now = this.now(), cur = this.nowChunk(now), T = this.tape
    if (!cur || cur.tapeIdx == null) return
    const startOf = (j: number) => { while (j > 0 && T[j - 1].bid === T[j].bid) j--; return j }
    let s = startOf(cur.tapeIdx)
    const began = (this.plan.find(c => c.bid === cur.bid && c.scheduled && !c.skipped) ?? cur).T!
    if (now - began < 3 && s > 0) s = startOf(s - 1)
    let k = s, lead = 0
    while (k > 0 && lead < 2) { k--; lead += T[k].bars }
    const runs = new Map<Run, Run>()
    const runOf = (r?: Run) => { if (!r) return r; if (!runs.has(r)) runs.set(r, { ...r, gn: null, match: null }); return runs.get(r) }
    const queue = T.slice(k).map((o, j): Chunk => ({ kind: o.kind, track: o.track, bar: o.bar, bars: o.bars, variant: o.variant, fill: o.fill, fillBeats: o.fillBeats,
      hi: o.hi, glue: o.glue, entry: o.entry, first: o.first || j === 0, bid: o.bid, tapeIdx: k + j, replay: true, run: runOf(o.run) }))
    ++this.gen; this.halt()
    if (this.walk.run) this.walk.run = runOf(this.walk.run)!  // (the walk goes on in the copy of the run it was in, so the seam is a seam within a run)
    this.replay = queue
    this.start()
    toast(s === startOf(cur.tapeIdx) ? 'Again: the transition into this block' : 'Back: the transition before', 'undo')
  }
  skip() {
    if (this.mode === 'queue') { this.playQueue(this.queue!, (this.heard().qi ?? 0) + 1); return }
    if (!this.walking) return
    const p = this.walk.pickEntry(this.nowChunk()?.track ?? null)
    if (p) void this.play(null, p)
  }
  setState(st: Level) { this.sched.setState(st); this.changed() }

  // ---- auditions
  /** A part as a run of its own: auditions join as the walk does. */
  part(p: Part, from = 0, bars = LEN): Chunk { return { kind: 'part', track: p.track, bar: p.start + from, bars, variant: 'full', entry: p, first: true, run: { entry: p, track: p.track } } }
  viaGlue(a: Part, b: Part) { const g = this.prefs.glue; return g === 'breaths' || (g === 'weak' && (this.matrix().joinOf(a, b) ?? 0) < WEAK) }
  playJoin(a: Part, b: Part, glue = this.viaGlue(a, b)) {
    const gid = this.jd.glueOf(a.track), bars = this.prefs.glueBars
    const mid: Chunk[] = glue && this.prefs.glueKind === 'rest' ? [{ kind: 'rest', bar: 1, bars, track: a.track }] : glue && gid ? [{ kind: 'glue', bar: 1, glue: gid, bars, track: a.track }] : []
    void this.play([this.part(a, LEN - 2, 2), ...mid, this.part(b)])
  }
  playPart(p: Part) { void this.play([this.part(p)]) }
  playGlue(gid: string) { void this.play([{ kind: 'glue', bar: 1, glue: gid, bars: this.prefs.glueBars }]) }

  /** The music graph (work/families.json: scenes, energies, cuts), read again when the sort changes. */
  setGraph(F: Families | null) { this.walk.setGraph(F ? new Graph(F, this.jd) : null); this.changed() }
  graphState() { return this.walk.graphState() }

  // ---- songs, for any page
  /** A song that isn't in the library (a take on the Music page, a trial, an extension): its level files by url. */
  ensure(id: string, src: Record<string, string>) { if (!this.jd.track(id)) this.jd.byId.set(id, { id, files: {}, src }) }
  /** A song as the game plays it: from its first phrase start inside its cues, round them, nothing varying, until
   * stopped (Stay is the walk's and a queue's). */
  playSong(tid: string, tag = tid, from?: number) { void this.play(null, { track: tid, start: from ?? this.jd.entryOf(tid) }, { pin: true, tag }) }
  /** Where the player is in a song (bars from its start, 0-based, fractional), or null when it isn't playing it. */
  positionIn(tid: string): number | null {
    const c = this.playing ? this.nowChunk() : null
    if (!c || c.track !== tid || (c.kind !== 'part' && c.kind !== 'fill')) return null
    return c.bar - 1 + Math.max(0, Math.min(c.bars, (this.now() - c.T!) / this.jd.barS()))
  }
  /** Songs in turn: each for exactly Stay bars from its first phrase start, as written, then straight into the next,
   * round and round. The
   * songs a page has that the library doesn't, it gives with ensure() first. */
  playQueue(items: QueueItem[], at = 0) { if (items.length) void this.play(null, null, { queue: items, at }) }
  private queueParts(items: QueueItem[]): Part[] { return items.map(q => ({ track: q.id, start: this.jd.entryOf(q.id) })) }
  /** The queue to play next (a page's choice), or none. A queue playing goes on in the new list. */
  setQueue(items: QueueItem[] | null) {
    this.queue = items?.length ? items : null
    if (this.mode === 'queue') { if (this.queue) this.walk.setQueue(this.queueParts(this.queue)); else this.stop() }
    this.changed()
  }
  /** Play: the queue when there is one, else the walk. */
  playDefault() { if (this.queue) this.playQueue(this.queue); else void this.play() }
  /** The song heard now (the walk's run, a pinned song, a queue's song), its place in the queue, and the song heard
   * before it in this play (so a page can vote on the transition just heard). */
  heard(): { track: string | null; qi: number | null; from: string | null } {
    const c = this.playing ? this.nowChunk() : null, prev = this.prevRun
    return { track: c?.run?.entry?.track ?? c?.track ?? null, qi: c?.run?.qi ?? null, from: c && prev ? prev.entry?.track ?? prev.track : null }
  }
  /** An extension (music grow) once, framed by its seed's last and first 4 bars, so both seams are heard. */
  playFramed(seed: string, ext: string, tag = ext) {
    const N = this.jd.N, entry = { track: seed, start: N - LEN + 1 }, run: Run = { entry, track: seed }
    const c = (track: string, bar: number, bars: number): Chunk => ({ kind: 'part', track, bar, bars, variant: 'full', run, entry, first: track === seed && bar > 1 })
    void this.play([c(seed, N - LEN + 1, LEN), c(ext, 1, N), c(seed, 1, LEN)], null, { tag })
  }

  // ---- what's playing
  nowChunk(now = this.now()): Chunk | null { return this.plan.find(c => c.scheduled && !c.skipped && c.T! - XF <= now && now < c.end!) ?? null }
  chunkLabel(c: Chunk): string {
    if (c.kind === 'glue') return `glue · ${this.jd.glueName(c.glue!)}`
    if (c.kind === 'rest') return `rest · ${c.bars} bar${c.bars > 1 ? 's' : ''} of silence`
    const t = this.jd.track(c.track), tags = [c.kind === 'fill' ? 'fill' : VARIANT[c.variant ?? 'full'], c.run?.entry && c.track !== c.run.entry.track ? 'variation' : ''].filter(Boolean)
    return `${t ? name(t) : c.track} · bar ${c.bar}${c.bars > 1 ? `–${c.bar + c.bars - 1}` : ''}${tags.length ? ` · ${tags.join(', ')}` : ''}`
  }
  /** The lane's blocks: a block per run, a song's visit with everything in it, so one is rated once (2026-10-21: a
   * block per fill and swap gave 1- to 7-bar boxes the designer couldn't keep up with); a glue or a rest its own. */
  blocks(): Block[] {
    const out: Block[] = []
    for (const c of this.plan.filter(c => !c.skipped)) {
      const b = out[out.length - 1], same = !!b && inRun(c) && b.kind === 'part' && b.run === c.run
      const lastBar = c.kind === 'fill' ? null : c.bar + c.bars - 1
      if (same) { b.bars += c.bars; b.end = c.end!; if (lastBar != null) b.last = lastBar; b.chunks.push(c); if (c.variant && c.variant !== 'full') b.vars.add(c.variant) }
      else out.push({ kind: inRun(c) ? 'part' : c.kind, run: c.run, track: c.run?.entry ? c.run.entry.track : c.track, bar: c.bar, bars: c.bars, last: lastBar ?? c.bar,
                      T: c.T!, end: c.end!, glue: c.glue, chunks: [c], vars: new Set(c.variant && c.variant !== 'full' ? [c.variant] : []) })
    }
    return out
  }
  /** Every block passes through the lane's window (the 5 before the one playing): the session takes each in. */
  private record(now: number) {
    if (!this.sess) return
    const bl = this.blocks(), cur = this.nowChunk(now), i = cur ? bl.findIndex(b => b.chunks.includes(cur)) : -1
    if (i < 0) return
    const n0 = this.sess.rec.size, show = bl.slice(Math.max(0, i - 5), i + 1)
    show.forEach((b, j) => this.sess!.record(b, show[j + 1] ?? bl[i + 1], this.state))
    if (this.sess.rec.size !== n0) this.changed()
  }
  star(id: string, n: number) { this.sess?.star(id, n); this.changed() }
  async like(id: string, v: number) { const p = this.sess?.like(id, v); this.changed(); await p }

  /** What the page draws each frame. */
  snapshot() {
    const now = this.now(), cur = this.playing ? this.nowChunk(now) : null, N = this.jd.N, barS = this.jd.barS(), beatS = this.jd.beatS()
    let clock = { big: '1.1', small: `/ ${N}` }, beat = -1, nowL = '–', nextL = '–'
    if (cur) {
      const t = now - cur.T!, k = Math.floor(t / barS)
      beat = Math.floor(t / beatS) % this.lib.bar_beats
      clock = cur.kind === 'glue' || cur.kind === 'rest' ? { big: cur.kind, small: ` ${k + 1}/${cur.bars}` } : cur.kind === 'fill' ? { big: 'fill', small: ` ${beat + 1}` } : { big: `${cur.bar + k}.${beat + 1}`, small: `/ ${N}` }
      nowL = this.chunkLabel(cur)
      const nx = this.plan.find(c => c.T! >= cur.end! - 0.01 && (c.kind !== 'part' || c.run !== cur.run || c.track !== cur.track))
      nextL = nx ? this.chunkLabel(nx) : this.script ? '(the end)' : '…'
    }
    const bl = this.blocks(), i = cur ? bl.findIndex(b => b.chunks.includes(cur)) : -1
    const lane = i < 0 ? [] : bl.slice(Math.max(0, i - 5), i + 1).map((b, j, a) => ({ id: blockKey(b), kind: b.kind, on: b.T <= now && now < b.end, past: b.end <= now, hasNext: j < a.length - 1 }))
    return {
      playing: this.playing, mode: this.mode, tag: this.tag, qi: cur?.run?.qi ?? null, clock, beat, now: nowL, next: nextL, lane, session: this.sess?.list(cur) ?? [],
      entry: cur?.run?.entry ?? null, played: cur?.run?.played ?? 0, rev: this.review.cur && cur?.rev != null ? cur.rev : null,
    }
  }

  // ---- training
  trainToggle() {
    this.train = { ...freshTraining(), on: !this.train.on }
    if (this.train.on) this.trainNext(); else this.stop()
    this.changed()
  }
  trainNext() { this.train.cur = trainPair(this.jd, this.prefs); this.trainPlay(); this.changed() }
  trainPlay() { const c = this.train.cur; if (c) void this.play([this.part({ track: c.a, start: c.e - 1 }, 0, 2), this.part(c.b, 0, 3)]) }
  async trainVote(v: number) {
    const c = this.train.cur; if (!c) return
    await vote(joinKey(c.a, c.e, c.b), v)
    this.train.n++; this.train.last = { ...c, v }
    if (c.t != null && (c.t >= 0.5) === (v > 0)) this.train.agree++
    this.trainNext()
  }

  // ---- the review
  async reviewLoad() { this.review.items = null; this.changed(); try { this.review.items = await loadReview(this.jd) } catch { this.review.items = [] } this.changed() }
  /** One block of a saved session, played as it played or piece by piece (the Sessions page); W marks the piece. */
  async playBlock(it: ReviewItem, mode: 'exact' | 'pieces') { this.review.items = [it]; await this.reviewPlay(0, mode) }
  async reviewPlay(i: number, mode: 'exact' | 'pieces') {
    const it = this.review.items?.[i]; if (!it) return
    const { pieces, script } = reviewScript(this.jd, it, mode)
    await this.play(script)
    this.review.cur = { i, mode, pieces }; this.changed()
  }
  async reviewMark(note: string) {
    const cur = this.review.cur, c = this.nowChunk()
    if (!cur || !c || c.rev == null || !this.playing) { toast('Play a block in the review first, then press W on the piece'); return }
    const it = this.review.items![cur.i], p = cur.pieces[c.rev]
    try {
      await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stream: it.sid, block: it.block, mode: cur.mode, note, piece: { ...p.desc, label: p.label } }) })
      it.marked.push({ label: p.label, note })
      // (a marked fill or glue is also disliked: the walk never plays it again)
      if (p.desc.kind === 'fill' && p.desc.fill) { await vote('fill_' + p.desc.fill, -1); toast(`Marked: ${p.label}: it won't play again`, 'down') }
      else toast(`Marked: ${p.label}`, 'check')
    } catch { toast("Couldn't save the mark", 'x') }
    this.changed()
  }
}
export type Snapshot = ReturnType<Mixer['snapshot']>

// The Mixer's audio graph (mixer.js prepare, schedule, the bed and the state switch): each chunk's buffers, its
// crossfades with the chunk before (80 ms linear inside a run; at a song change 80 ms, one or two beats, equal power,
// with the bass swap if asked), its run's gain (matched to the song before, easing to its own even level over 2 bars),
// a fill's own leveling, glues and rests, and the bed. Mellow and intense are two buses, crossed over two beats.
import { audio } from '../../audio/context'
import { bedPad, file, FILLPAD, ROLL, sliced } from '../buffers'
import { curve, db, hold, line, SWAP_HZ, swapCurve, taper } from '../curves'
import { XF, type Judge } from '../judge'
import type { Prefs } from '../prefs'
import { STATES, type Chunk, type Level, type Source } from '../types'

type BedVoice = { gid: string; s: AudioBufferSourceNode; g: GainNode; level: number }
/** A chunk's gain: its level kept for the next chunk's crossfade, and (with the bass swap) its low band's gain. */
type ChunkGain = GainNode & { _level?: number; _d?: GainNode }
const chunkGains = (c: Chunk | undefined) => ((c?.nodes ?? []) as ChunkGain[]).filter(n => n instanceof GainNode && n._level != null)

export class Scheduler {
  readonly out: GainNode
  readonly analyser: AnalyserNode
  /** The listening volume: after the meters and the spectrum, so they show the music's own level at any volume. */
  readonly volume: GainNode
  readonly bus: Record<Level, { g: GainNode; meter: AnalyserNode }>
  private glueBus: GainNode
  private bedVoice: BedVoice | null = null
  state: Level = 'mellow'

  private jd: Judge
  private prefs: () => Prefs
  private isPlaying: () => boolean

  constructor(jd: Judge, prefs: () => Prefs, isPlaying: () => boolean) {
    this.jd = jd; this.prefs = prefs; this.isPlaying = isPlaying
    const ctx = audio()
    this.out = ctx.createGain(); this.analyser = ctx.createAnalyser()
    this.out.gain.value = 0.9; this.analyser.fftSize = 4096; this.analyser.smoothingTimeConstant = 0.8
    this.volume = ctx.createGain()
    this.out.connect(this.analyser); this.analyser.connect(this.volume); this.volume.connect(ctx.destination)
    this.bus = Object.fromEntries(STATES.map(st => {
      const g = ctx.createGain(), meter = ctx.createAnalyser()
      meter.fftSize = 1024; g.gain.value = st === 'mellow' ? 1 : 0; g.connect(meter); meter.connect(this.out)
      return [st, { g, meter }]
    })) as Scheduler['bus']
    this.glueBus = ctx.createGain(); this.glueBus.connect(this.out)  // (glue sounds in either state)
  }
  private now() { return audio().currentTime }
  private barS() { return this.jd.barS() }
  private beatS() { return this.jd.beatS() }
  private glueUrl(gid: string) { return '/clips/' + this.jd.lib.glues[gid].file }

  /** The buffers a chunk plays: its mellow and intense sources, or a glue's. */
  async prepare(c: Chunk): Promise<NonNullable<Chunk['bufs']>> {
    const jd = this.jd, P = this.prefs()
    if (c.kind === 'glue') return { glue: await file(this.glueUrl(c.glue!)) }
    if (c.kind === 'rest') return {}  // (silence: nothing to load)
    const t = jd.track(c.track)!, clip = (u: string) => '/clips/' + u, st = t.stems ?? {}, level = (l: string) => jd.url(c.track, l)!
    const gid = jd.glueOf(c.track), bed = P.bed !== 'off' && gid ? bedPad(gid, this.glueUrl(gid), this.barS()) : null
    const intense = sliced(level(P.intense), this.barS(), c.kind === 'fill' ? ((c.bar - 1 - c.bars + jd.N) % jd.N) + 1 : c.bar, c.bars)
    let mellow: Source[]
    if (c.kind === 'fill') mellow = [{ buf: await file(clip(c.fill!)), gain: 1, pre: FILLPAD }]
    else {
      // (a variation is brought back to the song's full level: music stems measures each one's gain, music STEM_MIX)
      const v = c.variant ?? 'full', k = db(t.stem_gain?.[v] || 0)
      const parts: [string, number][] = v === 'nodrums' ? [[clip(st['calm.other']), k], [clip(st['calm.bass']), k]]
        : v === 'sparse' ? [[clip(st['calm.other']), k], [clip(st['calm.bass']), db(-6) * k]]
        : v === 'pulse' ? [[level('calm'), k], [clip(st['battle.drums']), db(-10) * k]]
        : [[level('calm'), 1]]
      mellow = await Promise.all(parts.map(async ([u, g]) => ({ buf: await sliced(u, this.barS(), c.bar, c.bars), gain: g, pre: ROLL })))
    }
    if (bed) await bed
    return { mellow, intense: [{ buf: await intense, gain: 1, pre: ROLL }] }
  }

  /** Puts a chunk on the audio clock at c.T, crossing over from the chunk before. */
  schedule(c: Chunk, prev: Chunk | undefined) {
    const ctx = audio(), now = this.now(), P = this.prefs(), jd = this.jd, T = c.T!
    c.nodes = []
    if (c.kind === 'glue') {  // it rises over the bar before T as the chunk before fades out over it (a slow handover)
      const lead = this.barS(), dur = c.bars * this.barS()
      // (the handover starts once the chunk before has finished fading in: a 1-bar chunk's fade-in sits right at T - lead)
      const t0 = Math.max(now + 0.01, T - lead, prev?.T != null && !prev.skipped ? prev.T + XF + 0.01 : 0)
      for (const g of chunkGains(prev)) { hold(g.gain, t0); curve(g.gain, g._level!, 0, t0, T - t0) }
      const s = ctx.createBufferSource(), g = ctx.createGain()
      s.buffer = c.bufs!.glue!; s.connect(g).connect(this.glueBus)
      g.gain.setValueAtTime(0, t0); curve(g.gain, 0, 1, t0, T - t0); curve(g.gain, 1, 0, T + dur, this.barS())  // (and falls over the next chunk's first bar)
      s.start(t0, Math.max(0, t0 - (T - lead))); s.stop(T + dur + this.barS() + 0.05)
      c.nodes.push(s, g)
      return
    }
    if (c.kind === 'rest') {  // the song before tapers over its last bar into silence (the bed too), for the rest's bars
      const t0 = Math.max(now + 0.01, T - this.barS(), prev?.T != null && !prev.skipped ? prev.T + XF + 0.01 : 0)
      for (const g of chunkGains(prev)) { hold(g.gain, t0); taper(g.gain, g._level!, t0, T - t0) }
      if (this.bedVoice) { this.fadeOut(this.bedVoice, t0, T - t0); this.bedVoice = null }  // (the next song's bed comes back with it)
      return
    }
    const dur = c.bars * this.barS(), live = !!prev && !prev.skipped && !!prev.nodes && prev.kind !== 'glue' && prev.kind !== 'rest'
    const same = live && !!prev!.run && prev!.run === c.run, change = live && !same && !!prev!.run
    // a song change crosses over around the bar line (Joins: tight 80 ms, or one or two beats); within a run, 80 ms linear
    const w = same || !change ? XF : Math.min(P.joins === 'two' ? this.beatS() : P.joins === 'beat' ? this.beatS() / 2 : XF, prev!.post || XF), t0 = T - w
    if (same) for (const g of chunkGains(prev)) line(g.gain, t0, g._level!, 0, T + XF)
    const swap = change && P.bassSwap && w > XF && now <= t0 + 0.01
    if (change) for (const g of chunkGains(prev)) {
      hold(g.gain, t0); curve(g.gain, g._level!, 0, t0, 2 * w)
      if (swap && g._d) { hold(g._d.gain, t0); try { g._d.gain.setValueCurveAtTime(swapCurve(g._level!, false), t0, 2 * w) } catch { /* a curve already running */ } }
    }
    const r = c.run
    if (r && !r.gn) {  // a run's own gain: where it comes in, its level matched to the song it follows, easing to its own over 2 bars
      r.gn = {}; r.match = {}
      for (const st of STATES) {
        const own = db(jd.trimDb(c.track, st)), g = ctx.createGain(), m = change && P.match ? jd.matchGain(prev!, c, st) : own
        g.connect(this.bus[st].g); g.gain.setValueAtTime(m, Math.max(now, t0)); g.gain.setValueAtTime(m, T); g.gain.linearRampToValueAtTime(own, T + 2 * this.barS())
        r.gn[st] = g; r.match[st] = m
      }
    }
    const lv = c.kind === 'fill' ? jd.fillLevels(c) : null
    for (const st of STATES) for (const src of c.bufs?.[st] ?? []) {
      const s = ctx.createBufferSource(), g: ChunkGain = ctx.createGain(), dest = r?.gn?.[st] ?? this.bus[st].g
      let into: AudioNode = dest  // (where this source's paths go: the fill's own leveling, else the run's gain)
      if (lv && st === 'mellow') {  // (the fill's own leveling, beat by beat)
        const lev = ctx.createGain(), at0 = Math.max(now, T - w)
        lev.gain.setValueAtTime(lv[0], at0)
        lv.forEach((v, k) => lev.gain.linearRampToValueAtTime(v, T + (k + 0.5) * this.beatS()))
        lev.gain.linearRampToValueAtTime(lv[lv.length - 1], T + dur + XF)
        lev.connect(dest); s.connect(g).connect(lev); into = lev
      } else s.connect(g).connect(dest)
      if (P.bassSwap) {  // (the low band's own path, silent until a song change uses it)
        const lp = ctx.createBiquadFilter(), d = ctx.createGain()
        lp.type = 'lowpass'; lp.frequency.value = SWAP_HZ; lp.Q.value = Math.SQRT1_2; d.gain.value = 0
        s.connect(lp).connect(d).connect(into)
        g._d = d; c.nodes.push(lp, d)
        if (swap) d.gain.setValueCurveAtTime(swapCurve(src.gain, true), Math.max(now, t0), 2 * w)
      }
      s.buffer = src.buf
      const at = Math.max(now, t0)
      g.gain.setValueAtTime(0, at)
      if (same) g.gain.linearRampToValueAtTime(src.gain, T + XF); else curve(g.gain, 0, src.gain, at, 2 * w)
      curve(g.gain, src.gain, 0, T + dur - XF, 2 * XF)
      g._level = src.gain
      s.start(at, Math.max(0, src.pre - w) + (at - t0)); s.stop(T + dur + (src.pre >= ROLL ? ROLL : XF) + 0.02)  // (late enough for a long crossover)
      c.nodes.push(s, g)
    }
    c.post = c.kind === 'fill' ? FILLPAD : ROLL
    if (c.first) this.bedTo(jd.glueOf(c.track), T)
  }

  /** The bed: the playing song's glue, quietly under everything, crossing over two bars when the family changes. */
  bedTo(gid: string | null, at: number) {
    const P = this.prefs(), level = P.bed === 'low' ? db(-12) : db(-6), cur = this.bedVoice
    if (P.bed === 'off' || !gid) { if (cur) { this.fadeOut(cur, at, 2 * this.barS()); this.bedVoice = null } return }
    if (cur && cur.gid === gid) {
      if (cur.level !== level) { try { line(cur.g.gain, Math.max(at, this.now() + 0.02), cur.g.gain.value, level, at + this.barS()) } catch { /* ignore */ } cur.level = level }
      return
    }
    void bedPad(gid, this.glueUrl(gid), this.barS()).then(b => {
      if (!this.isPlaying()) return
      const ctx = audio(), s = ctx.createBufferSource(), g = ctx.createGain(), t0 = Math.max(this.now() + 0.05, at)
      s.buffer = b; s.loop = true; s.connect(g).connect(this.glueBus)
      g.gain.setValueAtTime(0, t0); curve(g.gain, 0, level, t0, 2 * this.barS()); s.start(t0)
      if (this.bedVoice) this.fadeOut(this.bedVoice, t0, 2 * this.barS())
      this.bedVoice = { gid, s, g, level }
    })
  }
  private fadeOut(v: BedVoice, at: number, dur: number) {  // (the stop first: it must happen even if the fade can't be scheduled)
    try { v.s.stop(at + dur + 0.05) } catch { /* ignore */ }
    try { line(v.g.gain, at, v.level != null && at > this.now() + 0.05 ? v.level : v.g.gain.value, 0, at + dur) } catch { /* ignore */ }
  }

  /** Everything scheduled stops (a quick fade), and the bed. */
  halt(plan: Chunk[]) {
    const now = this.now()
    for (const c of plan) for (const nd of c.nodes ?? []) {
      if (nd instanceof AudioBufferSourceNode) { try { nd.stop(now + 0.06) } catch { /* ignore */ } }
      else if (nd instanceof GainNode) { try { line(nd.gain, now, nd.gain.value, 0, now + 0.05) } catch { /* ignore */ } }
    }
    if (this.bedVoice) { this.fadeOut(this.bedVoice, now, 0.1); this.bedVoice = null }
  }
  /** Mellow or intense: the two-beat crossfade between the buses. */
  setState(st: Level) {
    this.state = st
    const now = this.now() + 0.02, dur = 2 * this.beatS()
    for (const s of STATES) {
      const p = this.bus[s].g.gain, from = p.value, to = s === st ? 1 : 0
      hold(p, now)
      const c = new Float32Array(32)
      for (let i = 0; i < 32; i++) { const k = i / 31; c[i] = Math.sqrt(from * from * (1 - k) + to * to * k) }
      try { p.setValueCurveAtTime(c, now, dur) } catch { p.setValueAtTime(to, now) }
    }
  }
}

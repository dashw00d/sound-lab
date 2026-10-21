// Plays one song at a time: its mellow (calm) and intense (battle) levels looping in sync, crossing over two beats when
// switched, as the game does. An extension (music grow) plays once, framed by its seed's last and first GROW_KEEP bars,
// so both seams are heard. Framework-free: pages subscribe to changes.
import { audio, buffer } from './context'

export type Level = 'mellow' | 'intense'
export interface Song { id: string; calm: string; battle?: string; seed?: { calm: string; battle?: string } }

const GROW_KEEP = 4, BPM = 90, BAR_BEATS = 4

function framed(seed: AudioBuffer, ext: AudioBuffer): AudioBuffer {
  const bar = Math.round(ext.sampleRate * 60 / BPM * BAR_BEATS), k = GROW_KEEP * bar
  const b = audio().createBuffer(ext.numberOfChannels, k + ext.length + k, ext.sampleRate)
  for (let ch = 0; ch < ext.numberOfChannels; ch++) {
    const d = b.getChannelData(ch), s = seed.getChannelData(Math.min(ch, seed.numberOfChannels - 1))
    d.set(s.subarray(s.length - k), 0); d.set(ext.getChannelData(ch), k); d.set(s.subarray(0, k), k + ext.length)
  }
  return b
}

export class SongPlayer {
  private out: GainNode
  private voices: Partial<Record<Level, { s: AudioBufferSourceNode; g: GainNode }>> = {}
  private gen = 0
  private listeners = new Set<() => void>()
  playing: string | null = null
  level: Level = 'mellow'

  constructor() {
    this.out = audio().createGain()
    this.out.gain.value = 0.9
    this.out.connect(audio().destination)
  }
  onChange(f: () => void): () => void { this.listeners.add(f); return () => { this.listeners.delete(f) } }
  private changed() { this.listeners.forEach(f => f()) }

  async play(song: Song): Promise<void> {
    this.stop()
    const gen = ++this.gen, ctx = audio()
    if (ctx.state === 'suspended') await ctx.resume()
    this.playing = song.id; this.changed()
    let [m, i] = await Promise.all([buffer(song.calm), buffer(song.battle ?? song.calm)])
    if (song.seed) {
      const [sm, si] = await Promise.all([buffer(song.seed.calm), buffer(song.seed.battle ?? song.seed.calm)])
      m = framed(sm, m); i = framed(si, i)
    }
    if (gen !== this.gen) return  // (another play or a stop while it loaded)
    const at = ctx.currentTime + 0.05
    for (const [lv, b] of [['mellow', m], ['intense', i]] as const) {
      const s = ctx.createBufferSource(), g = ctx.createGain()
      s.buffer = b; s.loop = !song.seed; g.gain.value = lv === this.level ? 1 : 0
      s.connect(g).connect(this.out); s.start(at)
      if (!s.loop && lv === 'mellow') s.onended = () => { if (gen === this.gen) { this.playing = null; this.voices = {}; this.changed() } }
      this.voices[lv] = { s, g }
    }
  }
  stop(): void {
    this.gen++
    const now = audio().currentTime
    for (const v of Object.values(this.voices)) { try { v.g.gain.setTargetAtTime(0, now, 0.03); v.s.stop(now + 0.15) } catch { /* ended */ } }
    this.voices = {}
    if (this.playing) { this.playing = null; this.changed() }
  }
  setLevel(lv: Level): void {
    this.level = lv
    const now = audio().currentTime, w = 2 * 60 / BPM
    for (const [k, v] of Object.entries(this.voices)) {
      v.g.gain.cancelScheduledValues(now); v.g.gain.setValueAtTime(v.g.gain.value, now); v.g.gain.linearRampToValueAtTime(k === lv ? 1 : 0, now + w)
    }
    this.changed()
  }
}

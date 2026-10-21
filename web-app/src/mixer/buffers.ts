// The Mixer's audio: files decoded whole (levels, stems, fills, glues), sliced to what each chunk plays (mixer.js).
import { audio } from '../audio/context'

const files = new Map<string, Promise<AudioBuffer>>(), slices = new Map<string, Promise<AudioBuffer>>(), pads = new Map<string, Promise<AudioBuffer>>()
const MAX_FILES = 10, MAX_SLICES = 120
/** Seconds of audio kept either side of a slice: a song change crosses over up to two beats around the bar line. */
export const ROLL = 0.7
export const FILLPAD = 0.05

export function file(url: string): Promise<AudioBuffer> {
  const had = files.get(url)
  if (had) { files.delete(url); files.set(url, had); return had }
  const b = fetch(url).then(r => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.arrayBuffer() }).then(x => audio().decodeAudioData(x))
  files.set(url, b); b.catch(() => files.delete(url))
  while (files.size > MAX_FILES) files.delete(files.keys().next().value as string)
  return b
}
/** Bars start.. (1-based) of a loop, with ROLL either side, wrapping round it. */
function cut(b: AudioBuffer, barS: number, start: number, bars: number): AudioBuffer {
  const sr = b.sampleRate, bar = Math.round(barS * sr), xf = Math.round(ROLL * sr), total = b.length, a = (start - 1) * bar - xf, n = bars * bar + 2 * xf
  const nb = audio().createBuffer(b.numberOfChannels, n, sr)
  for (let c = 0; c < b.numberOfChannels; c++) { const src = b.getChannelData(c), d = nb.getChannelData(c); for (let i = 0; i < n; i++) d[i] = src[(((a + i) % total) + total) % total] }
  return nb
}
export function sliced(url: string, barS: number, start: number, bars: number): Promise<AudioBuffer> {
  const k = `${url}|${start}|${bars}`
  let p = slices.get(k)
  if (!p) {
    p = file(url).then(b => cut(b, barS, start, bars))
    slices.set(k, p); p.catch(() => slices.delete(k))
    while (slices.size > MAX_SLICES) slices.delete(slices.keys().next().value as string)
  }
  return p
}
/** A glue as a bed: its middle four bars, the last 0.3 s faded into what comes before them, so it loops without a seam. */
export function bedPad(gid: string, url: string, barS: number): Promise<AudioBuffer> {
  let p = pads.get(gid)
  if (!p) {
    p = file(url).then(b => {
      const sr = b.sampleRate, bar = Math.round(barS * sr), a = Math.round(bar / 2), n = 4 * bar, x = Math.round(0.3 * sr)
      const nb = audio().createBuffer(b.numberOfChannels, n, sr)
      for (let c = 0; c < b.numberOfChannels; c++) {
        const src = b.getChannelData(c), d = nb.getChannelData(c)
        for (let i = 0; i < n; i++) d[i] = src[a + i]
        for (let i = 0; i < x; i++) { const f = (i + 0.5) / x; d[n - x + i] = d[n - x + i] * Math.cos(f * Math.PI / 2) + src[a - x + i] * Math.sin(f * Math.PI / 2) }
      }
      return nb
    })
    pads.set(gid, p)
  }
  return p
}
export function flushBuffers() { files.clear(); slices.clear(); pads.clear() }

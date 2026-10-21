// Spectrograms of the app's audio files, made in a worker (spectrogram.worker.ts) and kept: a file's image is made once.
import { file } from '../mixer/buffers'

export interface Spectro { img: ImageData; seconds: number }
const cache = new Map<string, Promise<Spectro>>()
let worker: Worker | null = null, seq = 0
const waiting = new Map<number, (d: { img: Uint8ClampedArray; width: number; height: number }) => void>()

export function spectrogram(url: string, width = 1200, height = 160): Promise<Spectro> {
  const key = `${url}|${width}|${height}`
  let p = cache.get(key)
  if (p) return p
  p = file(url).then(buf => new Promise<Spectro>(done => {
    if (!worker) {
      worker = new Worker(new URL('./spectrogram.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<{ id: number; img: Uint8ClampedArray; width: number; height: number }>) => { waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id) }
    }
    const id = ++seq, n = buf.length, x = new Float32Array(n), a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a
    for (let i = 0; i < n; i++) x[i] = 0.5 * (a[i] + b[i])
    waiting.set(id, d => done({ img: new ImageData(new Uint8ClampedArray(d.img), d.width, d.height), seconds: buf.duration }))
    worker.postMessage({ id, x, sr: buf.sampleRate, width, height }, [x.buffer])
  }))
  cache.set(key, p)
  p.catch(() => cache.delete(key))
  return p
}

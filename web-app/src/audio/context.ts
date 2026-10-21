// One AudioContext for the app, and a decoded-buffer cache (a 43 s level decodes to about 15 MB: keep a few).
let ctx: AudioContext | null = null
export const audio = (): AudioContext => (ctx ??= new AudioContext())

const cache = new Map<string, Promise<AudioBuffer>>()
const MAX = 14
export function buffer(url: string): Promise<AudioBuffer> {
  let b = cache.get(url)
  if (b) { cache.delete(url); cache.set(url, b); return b }  // (most recent last)
  b = fetch(url).then(r => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.arrayBuffer() }).then(a => audio().decodeAudioData(a))
  cache.set(url, b)
  b.catch(() => cache.delete(url))
  while (cache.size > MAX) cache.delete(cache.keys().next().value as string)
  return b
}

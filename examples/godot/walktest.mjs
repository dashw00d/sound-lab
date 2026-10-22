// The same rows as test_walk.gd, from the sync folder's walk.js: node walktest.mjs /path/to/soundlab 7 600
import { readFileSync } from 'node:fs'
const [dir, seed, n] = process.argv.slice(2)
const { fromManifest, seeded } = await import(dir + '/walk.js')
const m = JSON.parse(readFileSync(dir + '/soundlab.json', 'utf8'))
const w = fromManifest(m, { random: seeded(Number(seed)) })
for (let i = 0; i < Number(n); i++) {
  const s = w.next()
  if (!s) break
  console.log(JSON.stringify(s.kind === 'rest' ? ['rest', s.bars, s.after] : ['part', s.song, s.bar, s.bars, s.visit.id, s.first, s.at]))
}

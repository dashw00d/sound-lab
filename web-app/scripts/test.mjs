// Regression test for the API client's reading of /api/families (npm test). That route answers only {"bridges": {}}
// until `soundlab music families` has written work/families.json (a project with no music, or music not sorted yet), and
// the app once read `.families` of it and crashed on a blank page ("Cannot convert undefined or null to object").
// The client now fills in every part the pages read. client.ts is compiled to a temp folder, as walk.mjs does.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const out = mkdtempSync(join(tmpdir(), 'client-test-'))
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', 'src/api/client.ts', '--target', 'es2022', '--module', 'es2022',
  '--outDir', out, '--skipLibCheck', '--ignoreConfig', '--lib', 'es2022,dom'], { stdio: 'inherit' })
writeFileSync(join(out, 'package.json'), '{"type":"module"}')
const { api } = await import(pathToFileURL(join(out, 'api', 'client.js')).href)

const serve = body => { globalThis.fetch = async () => ({ ok: true, json: async () => body }) }

serve({ bridges: {} })  // (no families.json yet)
let f = await api.families()
assert.deepEqual(Object.values(f.families), [])  // (what App.tsx does to count the scenes)
assert.deepEqual(Object.keys(f.items), [])
assert.deepEqual(f.queue, [])
assert.deepEqual(f.bridges, {})

const real = { made: '2026-11-01', items: { a: { family: 'f' } }, families: { f: { members: ['a'] } }, queue: [{ item: 'a' }], bridges: { a: [] } }
serve(real)  // (a sorted project: passed through as it is)
assert.deepEqual(await api.families(), real)

console.log('ok: /api/families is read whole whether or not the sort has run')

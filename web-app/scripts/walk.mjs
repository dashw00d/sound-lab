// Builds the scene walk for games: web-app/src/mixer/engine/scenewalk.ts as plain JavaScript (walk.js) and its types
// (walk.d.ts), into soundlab/sync, which `soundlab sync` copies into a game's folder. They're committed, so a sync
// needs no Node; the build makes them again so they never drift from what the Mixer runs.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'walk-'))
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', 'src/mixer/engine/scenewalk.ts', '--target', 'es2020', '--module', 'es2020',
  '--declaration', '--outDir', out, '--skipLibCheck', '--ignoreConfig'], { stdio: 'inherit' })
const head = '// The scene walk: where the music goes next. Made by Sound Lab (`soundlab sync`) from its own player\'s code\n' +
  '// (web-app/src/mixer/engine/scenewalk.ts): the game makes the choices the Mixer made. Don\'t edit it here; a sync\n' +
  '// writes it again. No dependencies: an ES module any JavaScript runs, and the algorithm to port (see README.md).\n'
writeFileSync('../soundlab/sync/walk.js', head + readFileSync(join(out, 'scenewalk.js'), 'utf8'))
writeFileSync('../soundlab/sync/walk.d.ts', head + readFileSync(join(out, 'scenewalk.d.ts'), 'utf8'))
console.log('walk.js, walk.d.ts → soundlab/sync')

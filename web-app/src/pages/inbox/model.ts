// The Inbox's takes: everything new waiting for the designer's answer, of three kinds, each with its own answers.
//   extension   grown from a take they called a new family (music grow): keep it, a bad take, or a new family itself
//   trial       a mini trial's take (music trial): could it start a new family? yes, no, or a bad take
//   new         this round's takes, scored and ranked (music candidates, "best first"): like or dislike
import type { Families, Votes } from '../../api/types'
import type { Library } from '../../mixer/types'
import { parts } from '../library/model'

export type Kind = 'extension' | 'trial' | 'new'
export interface Answer { key: string; label: string; votes: [string, number][]; tone: 'good' | 'bad' | 'gem' | 'plain' }
export interface Take {
  id: string; kind: Kind; context: string; style: string; take: string; src: { calm?: string; battle?: string }
  rank: number | null; nice: number | null; unique: number | null; catchy: number | null
  words: string[]; seed: string | null; energy: number | null; scene: string | null; answered: Answer | null; answers: Answer[]
}
export const KIND: Record<Kind, { title: string; sub: string }> = {
  extension: { title: 'Grown from your new families', sub: 'Seamless extensions of the takes you called a new family: does it keep the family going?' },
  trial: { title: 'Trials', sub: 'Could this take start a whole new family of songs? Be strict.' },
  new: { title: 'This round, best first', sub: 'Ranked by how well each plays with your songs and how unlike them it is.' },
}
export function takes(lib: Library | null, F: Families | null, votes: Votes): Take[] {
  const v = votes.clips, out: Take[] = []
  const pick = (as: Answer[]) => as.find(a => a.votes.every(([k, x]) => (v[k] || 0) === x || x === 0 && !v[k])) ?? null
  for (const [id, it] of Object.entries(F?.items ?? {})) {
    if (it.kind !== 'trial' && it.kind !== 'extension') continue
    const novel = it.set && it.take ? `novel_${it.set}.${it.take}` : `novel_${id}`, ok = `ok_${id}`
    const answers: Answer[] = it.kind === 'trial'
      ? [{ key: 'y', label: 'New family', votes: [[novel, 1], [ok, 1]], tone: 'gem' }, { key: 'n', label: 'Not new', votes: [[novel, -1]], tone: 'plain' }, { key: 'd', label: 'Bad take', votes: [[ok, -1]], tone: 'bad' }]
      : [{ key: 'g', label: 'Keep', votes: [[ok, 1]], tone: 'good' }, { key: 'd', label: 'Bad take', votes: [[ok, -1]], tone: 'bad' }, { key: 'y', label: 'A new family', votes: [[novel, 1], [ok, 1]], tone: 'gem' }]
    const said = (v[novel] || 0) !== 0 || (v[ok] || 0) !== 0
    out.push({ id, kind: it.kind, ...parts(id), src: it.src, rank: null, nice: null, unique: null, catchy: null,
      words: Object.values(it.words ?? {}).filter(Boolean).map(w => w.replace('{s} ', 'strings ')), seed: it.seed ?? null,
      energy: it.energy ?? null, scene: it.family, answered: said ? (pick(answers) ?? answers[0]) : null, answers })
  }
  for (const t of lib?.candidates ?? []) {
    const key = `mesh_${t.key}.${t.take}.${t.profile ?? 'stack'}`, it = F?.items[t.id]
    const answers: Answer[] = [{ key: 'g', label: 'Like', votes: [[key, 1]], tone: 'good' }, { key: 'd', label: 'Dislike', votes: [[key, -1]], tone: 'bad' }]
    out.push({ id: t.id, kind: 'new', ...parts(t.id), src: { calm: t.src?.calm, battle: t.src?.battle ?? t.src?.action }, rank: t.candidate?.rank ?? null,
      nice: t.candidate?.nice ?? null, unique: (t.candidate as { unique?: number } | undefined)?.unique ?? null, catchy: t.candidate?.catchy_in_style ?? null,
      words: Object.values(it?.words ?? {}).filter(Boolean).map(w => w.replace('{s} ', 'strings ')), seed: null, energy: it?.energy ?? null,
      scene: it?.family ?? null, answered: v[key] ? answers[v[key] > 0 ? 0 : 1] : null, answers })
  }
  const order: Record<Kind, number> = { extension: 0, trial: 1, new: 2 }
  return out.sort((a, b) => order[a.kind] - order[b.kind] || (a.rank ?? 999) - (b.rank ?? 999) || a.id.localeCompare(b.id))
}

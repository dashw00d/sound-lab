// A song's verdict (2026-10-23, the designer: "lets have the votes effect whats in the game and make them binary so a
// thumbs down replaces a previous thumbs up"): its latest thumb, wherever it was given, says whether it's in (1), out
// (-1), or not judged yet (0). The same as soundlab/music/verdict.py (which says which thumbs count, and why): keep the
// two the same.
const BEFORE = ''  // (a vote with no time: older than every dated one)

/** The thumbs bearing on a song: [vote key, 1 or -1]. */
export function thumbs(id: string, set: string | undefined, take: string | undefined, clips: Record<string, number>): [string, number][] {
  const profile = id.slice(id.lastIndexOf('.') + 1), out: [string, number][] = []
  for (const k of [...(set && take ? [`mesh_${set}.${take}.${profile}`] : []), `song_${id}.mellow`, `song_${id}.intense`, `ok_${id}`])
    if (clips[k]) out.push([k, clips[k] > 0 ? 1 : -1])
  for (const k of [`novel_${id}`, ...(set && take ? [`novel_${set}.${take}`] : [])]) if ((clips[k] || 0) > 0) out.push([k, 1])
  for (const [k, v] of Object.entries(clips)) if (v > 0 && k.startsWith(`link_${id}|`)) out.push([k, 1])
  return out
}

/** 1 in, -1 out, 0 not judged: the latest thumb (a thumbs down at the same time). */
export function verdict(id: string, set: string | undefined, take: string | undefined, clips: Record<string, number>, at: Record<string, string> = {}): number {
  let best: [string, number] | null = null, bestAt = ''
  for (const t of thumbs(id, set, take, clips)) {
    const w = at[t[0]] ?? BEFORE
    if (!best || w > bestAt || (w === bestAt && t[1] < 0)) { best = t; bestAt = w }
  }
  return best ? best[1] : 0
}

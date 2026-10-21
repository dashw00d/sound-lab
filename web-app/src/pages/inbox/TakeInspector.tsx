// A new take, whole: what it is (its kind, its words: what SA3 was asked for), how it scored, where the sort puts it (its
// scene, its energy), its spectrogram, and its answers (one key each).
import { useMemo } from 'react'
import { api } from '../../api/client'
import { put } from '../../data/live'
import { useFamilies, useVotesData, VOTES } from '../../data/resources'
import { toast } from '../../shell/toast'
import { useEngine } from '../../player/hooks'
import { usePlayer } from '../../player/store'
import { Icon } from '../../shell/Icon'
import { Energy } from '../../ui/Energy'
import { Timeline } from '../../ui/Timeline'
import { colour, FamilyView, hue, label } from '../families/model'
import { KIND, type Answer, type Take } from './model'

export function TakeInspector({ t, onPlay, onAnswer }: { t: Take; onPlay: () => void; onAnswer: (a: Answer) => void }) {
  const m = usePlayer().m, F = useFamilies().data, votes = useVotesData()
  useEngine(m)
  // (where it belongs: the scenes it nearly fits, and the new families nearest it; + links it there, a real vote)
  const fv = useMemo(() => (F ? new FamilyView(F, votes) : null), [F, votes])
  const belongs = useMemo(() => {
    if (!fv || !F?.items[t.id]) return []
    const own = fv.family(t.id).id, out = new Map<string, { root: string; size: number; why: string }>()
    for (const g of fv.guessesFor(t.id)) out.set(g.family.id, { root: g.family.root, size: g.family.members.length, why: `fits ${g.worst.toFixed(2)}` })
    for (const o of F.items[t.id].nearest ?? []) {
      const f = F.items[o] ? fv.family(o) : null
      if (f && f.id !== own && !out.has(f.id) && out.size < 4) out.set(f.id, { root: f.root, size: f.members.length, why: 'flows with it' })
    }
    return [...out.entries()].slice(0, 4)
  }, [fv, F, t.id])
  // (hear a suggestion: the scene's root alone, or this take and the root in turn, both transitions heard)
  const hearRoot = (root: string) => { const it = F?.items[root]; if (!m || !it?.src.calm) return; m.ensure(root, it.src); m.playSong(root) }
  const together = (root: string) => {  // (only where they meet: into it and back, about 25 seconds)
    const it = F?.items[root]; if (!m || !F || !it?.src.calm || !t.src.calm) return
    m.ensure(t.id, t.src); m.ensure(root, it.src)
    if (m.playing && m.tag === `${t.id}~${root}`) { m.stop(); return }
    m.playMeeting(t.id, root)
  }
  const join = async (root: string) => {
    if (!fv || !F) return
    let v = null
    for (const [k, x] of fv.set(t.id, root, 'match')) v = await api.vote(k, x)
    if (v) put(VOTES, v)
    toast(`${t.style} ${t.take} belongs with ${label(root, F.items[root])}`, 'check')
  }
  const playing = !!m?.playing && (m.tag === t.id || m.heard().track === t.id)
  const seed = t.seed ? F?.items[t.seed] : null, near = F?.items[t.id]?.nearest?.filter(o => F?.items[o]?.kind === 'shipped').slice(0, 3) ?? []
  const pct = (x: number | null) => (x == null ? '–' : `${Math.round(100 * x)}`)
  return (
    <div className="insp">
      <header className="insp-head">
        <div className="insp-kicker">
          <span className={`kind k-${t.kind}`}>{KIND[t.kind].title}</span>
          <span className={`ctx c-${t.context}`}>{t.context}</span>
          {t.scene && <span className="chip"><span className="sw" style={{ background: colour(hue(t.scene)) }} />Scene {t.scene.replace(/^f/, '')}</span>}
        </div>
        <h2>{t.style} <span>{t.take}</span>{t.rank != null && <em className="rank">#{t.rank}</em>}</h2>
        {t.words.length > 0 && <div className="words">{t.words.map((w, k) => <span key={k}>{w}</span>)}</div>}
        <div className="insp-energy"><span className="lbl">chill</span><Energy value={t.energy} wide /><span className="lbl">intense</span></div>
      </header>

      <div className="insp-transport">
        <button className="playbtn sm" title={playing ? 'Stop' : seed ? 'Play it between its seed’s end and start' : 'Play it'} onClick={() => (playing ? m?.stop() : onPlay())}><Icon name={playing ? 'stop' : 'play'} /></button>
        <span className="dim">{seed ? `framed by its seed, ${label(t.seed!, seed)}` : 'round its loop'} · <kbd>Enter</kbd></span>
      </div>

      <div className="answers">
        {t.answers.map(a => (
          <button key={a.key} className={`ans-btn ${a.tone} ${t.answered?.label === a.label ? 'on' : ''}`} onClick={() => onAnswer(a)}>
            <span>{a.label}</span><kbd>{a.key.toUpperCase()}</kbd>
          </button>
        ))}
      </div>

      <div className="insp-sec">
        <span className="lbl">Calm level</span>
        <Timeline url={t.src.calm ?? null} playhead={() => m?.positionIn(t.id) ?? null} />
      </div>

      {t.kind === 'new' && (
        <div className="insp-tiles">
          <div className="tile"><span className="lbl">Rank</span><b>{t.rank ?? '–'}</b></div>
          <div className="tile"><span className="lbl">Plays nice</span><b>{pct(t.nice)}<small>%</small></b></div>
          <div className="tile"><span className="lbl">Unique</span><b>{pct(t.unique)}<small>%</small></b></div>
          <div className="tile"><span className="lbl">Catchy</span><b>{t.catchy == null ? '–' : t.catchy.toFixed(1)}</b></div>
        </div>
      )}
      {belongs.length > 0 && (
        <div className="insp-sec">
          <span className="lbl">Belongs with</span>
          <div className="mates">{belongs.map(([fid, b]) => (
            <div key={fid} className="mate">
              <span className="nm"><span className="sw2" style={{ background: colour(hue(fid)) }} /><b>{label(b.root, F!.items[b.root])}</b> <span className="dim">scene of {b.size} · {b.why}</span></span>
              <span className="hear">
                <button className={m?.mode === 'song' && m.tag === b.root ? 'on' : ''} title="Hear the scene's root alone" onClick={() => (m?.mode === 'song' && m.tag === b.root ? m.stop() : hearRoot(b.root))}><Icon name={m?.mode === 'song' && m.tag === b.root ? 'stop' : 'play'} /></button>
                <button className={m?.playing && m.tag === `${t.id}~${b.root}` ? 'on' : ''} title="Hear them meet, both ways: 2 bars of this take into the root, 4 of the root, back into this take (about 25 seconds)" onClick={() => together(b.root)}>⇄</button>
              </span>
              <button className="addb" title="It belongs in this scene (a link to its root: the same vote as dragging it there in Scenes)" onClick={() => void join(b.root)}>+</button>
            </div>
          ))}</div>
        </div>
      )}
      {near.length > 0 && (
        <div className="insp-sec">
          <span className="lbl">Flows best with, shipped</span>
          <div className="mates">{near.map(o => (
            <div key={o} className="mate">
              <span className="nm"><b>{label(o, F!.items[o])}</b></span>
              <span className="hear">
                <button className={m?.mode === 'song' && m.tag === o ? 'on' : ''} title="Hear it alone" onClick={() => (m?.mode === 'song' && m.tag === o ? m.stop() : hearRoot(o))}><Icon name={m?.mode === 'song' && m.tag === o ? 'stop' : 'play'} /></button>
                <button className={m?.playing && m.tag === `${t.id}~${o}` ? 'on' : ''} title="Hear them meet, both ways: 2 bars of this take into it, 4 of it, back into this take (about 25 seconds)" onClick={() => together(o)}>⇄</button>
              </span>
              <Energy value={F!.items[o].energy ?? null} />
            </div>
          ))}</div>
        </div>
      )}
    </div>
  )
}

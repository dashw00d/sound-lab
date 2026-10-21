// The Mixer: build a set of parts, cut from any songs, that go together in any order, and tune how the walk plays them
// (the player's bar plays it: endlessly, mellow or intense, each song coming in at a part and playing on for at least
// Stay bars, varying as it goes, then moving on where it joins well). What the walk played this session, rated blind
// (stars per block, thumbs per transition), and the two listening tools: training and the review of low-rated blocks.
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { Mixes } from '../../api/types'
import type { Mixer } from '../../mixer/engine/mixer'
import { LEN } from '../../mixer/judge'
import { useEngine, useSnapshot } from '../../player/hooks'
import { useKeys } from '../../player/keys'
import { SessionList } from '../../player/Rating'
import { loadPlayer, usePlayer } from '../../player/store'
import { ReviewCard } from './ReviewCard'
import { SetBuilder } from './SetBuilder'
import { Settings } from './Settings'
import { TrainingCard } from './TrainingCard'
import './mixer.css'

export default function MixerPage() {
  const p = usePlayer()
  const [mixes, setMixes] = useState<Mixes>({})
  useEffect(() => {
    void loadPlayer(true)  // (each visit: stems, fills, glues and takes made since join, unless something plays)
    api.mixes().then(setMixes).catch(() => {})
  }, [])
  if (p.status === 'error') return <div className="mx-msg"><b>No music to mix</b><p className="dim">{p.error}</p></div>
  if (p.status === 'none') return <div className="mx-msg"><b>This project has no music</b></div>
  if (p.status !== 'ready') return <div className="mx-msg dim">Reading the songs…</div>
  return <Page m={p.m} mixes={mixes} setMixes={setMixes} />
}

function Page({ m, mixes, setMixes }: { m: Mixer; mixes: Mixes; setMixes: (x: Mixes) => void }) {
  useEngine(m)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [note, setNote] = useState<Record<number, string>>({})
  const toggleReview = () => { const open = !reviewOpen; setReviewOpen(open); if (open) void m.reviewLoad() }

  // (the player's keys are in its bar; these are the Mixer's own, and training's, which come first while it's on)
  useKeys(k => {
    if (m.train.on) {
      if (k === 'ArrowUp' || k === 'u') { void m.trainVote(1); return true }
      if (k === 'ArrowDown' || k === 'd') { void m.trainVote(-1); return true }
      if (k === 'ArrowRight' || k === 'n') { m.trainNext(); return true }
      if (k === 'r' || k === ' ') { m.trainPlay(); return true }
      if (k === 'Escape' || k === 't') { m.trainToggle(); return true }
    }
    if (k === 'w' && m.review.cur) { void m.reviewMark(note[m.review.cur.i] ?? ''); return true }
    if (k === 't') { m.trainToggle(); return true }
    if (k === 'o') { m.setPrefs({ mode: m.prefs.mode === 'any' ? 'order' : 'any' }); return true }
    return false
  })

  return (
    <div className="mx">
      <div className="mx-wrap">
        <header className="mx-head">
          <div className="lbl">{m.lib.bpm} BPM · {LEN}-bar parts · every song on one grid</div>
          <h1>Mixer</h1>
          <p className="dim">How the walk plays the songs, as the game would: endlessly, mellow or intense. Each song comes in at a part, plays on for at least
            Stay bars, varying as it goes, then moves on where it joins well. The player's bar plays it (<kbd>Space</kbd>); rate as it plays: remove, flag, fill, good
            or exceptional on each block, a thumb on each transition.</p>
        </header>
        <Session m={m} />
        <Settings m={m} reviewOpen={reviewOpen} onReview={toggleReview} />
        {m.train.on && <TrainingCard m={m} />}
        {reviewOpen && <ReviewCard m={m} note={note} setNote={setNote} />}
        <SetBuilder m={m} mixes={mixes} setMixes={setMixes} />
        <p className="mx-keys dim">
          <kbd>Space</kbd> play or stop · <kbd>←</kbd> back · <kbd>→</kbd> skip · <kbd>1</kbd> <kbd>2</kbd> <kbd>X</kbd> mellow / intense ·
          <kbd>O</kbd> any order / in order · <kbd>T</kbd> train (<kbd>↑</kbd> good, <kbd>↓</kbd> bad, <kbd>→</kbd> skip, <kbd>R</kbd> replay) · <kbd>Esc</kbd> stop
        </p>
      </div>
    </div>
  )
}

/** What the walk played this session, each block rated or not yet. */
function Session({ m }: { m: Mixer }) {
  const snap = useSnapshot(m), g = m.walking ? m.graphState() : null
  if (!snap.session.length && !g) return null
  return (
    <section className="card mx-sess">
      {g && (  // (the graph: where the wave is, and the song against it)
        <div className="mx-wave">
          <span className="lbl">the graph</span> scene {g.scene} · {g.bars} of {m.prefs.sceneBars} bars · energy aimed at {g.target.toFixed(2)}
          {g.energy != null && <> · this song {g.energy.toFixed(2)}</>}
          <span className="bar"><i style={{ left: `${Math.max(0, Math.min(100, 50 + 25 * g.target))}%` }} /></span>
        </div>
      )}
      {snap.session.length > 0 && <SessionList m={m} snap={snap} />}
    </section>
  )
}

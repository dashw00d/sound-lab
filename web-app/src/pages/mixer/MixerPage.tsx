// The Mixer: build a set of parts, cut from any songs, that go together in any order, and hear it as the game would play
// it: endlessly, mellow or intense, each song coming in at a part and playing on for at least Stay bars, varying as it
// goes, then moving on where it joins well. Rated blind as it plays (stars per block, thumbs per transition).
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Mixes } from '../../api/types'
import { Mixer } from '../../mixer/engine/mixer'
import { LEN } from '../../mixer/judge'
import { loadPrefs } from '../../mixer/prefs'
import { refreshVotes } from '../../state/votes'
import { useEngine } from './hooks'
import { ReviewCard } from './ReviewCard'
import { SetBuilder } from './SetBuilder'
import { Settings } from './Settings'
import { TrainingCard } from './TrainingCard'
import { Transport } from './Transport'
import './mixer.css'

type Loaded = { m: Mixer; mixes: Mixes } | { error: string; hint?: string }

export default function MixerPage() {
  const [got, setGot] = useState<Loaded | null>(null)
  useEffect(() => {
    let alive = true, made: Mixer | null = null
    void (async () => {
      try {
        const [lib, mixes, prefs] = await Promise.all([api.songs(), api.mixes().catch(() => ({})), loadPrefs(), refreshVotes(true)])
        lib.tracks = [...lib.tracks, ...(lib.candidates ?? [])]  // (new takes join the walk when asked)
        if (!alive) return
        if (!lib.tracks.some(t => t.measure?.feat)) { setGot({ error: "The songs aren't measured", hint: 'Run soundlab music trims: the Mixer needs each song’s bar fingerprints.' }); return }
        made = new Mixer(lib, prefs)
        setGot({ m: made, mixes })
      } catch (e) {
        if (alive) setGot({ error: "Couldn't read the game's music", hint: `The server didn't give the shipped tracks (${(e as Error).message}). Check the terminal running soundlab serve.` })
      }
    })()
    return () => { alive = false; made?.stop() }  // (leaving the page stops the music)
  }, [])
  if (!got) return <div className="mx-msg dim">Reading the songs…</div>
  if ('error' in got) return <div className="mx-msg"><b>{got.error}</b><p className="dim">{got.hint}</p></div>
  return <Page m={got.m} mixes={got.mixes} />
}

function Page({ m, mixes: mixes0 }: { m: Mixer; mixes: Mixes }) {
  useEngine(m)
  const [mixes, setMixes] = useState(mixes0)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [note, setNote] = useState<Record<number, string>>({})
  const noteRef = useRef(note)
  noteRef.current = note
  const toggleReview = () => { const open = !reviewOpen; setReviewOpen(open); if (open) void m.reviewLoad() }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || el.closest('input, select, textarea')) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, stop = () => e.preventDefault()
      if (m.train.on) {  // (rating: one key each)
        if (k === 'ArrowUp' || k === 'u') { stop(); void m.trainVote(1); return }
        if (k === 'ArrowDown' || k === 'd') { stop(); void m.trainVote(-1); return }
        if (k === 'ArrowRight' || k === 'n') { stop(); m.trainNext(); return }
        if (k === 'r' || k === ' ') { stop(); m.trainPlay(); return }
        if (k === 'Escape' || k === 't') { m.trainToggle(); return }
      }
      if (k === 'w' && m.review.cur) { stop(); void m.reviewMark(noteRef.current[m.review.cur.i] ?? ''); return }
      if (k === 't') m.trainToggle()
      else if (k === ' ') { stop(); if (m.playing) m.stop(); else void m.play() }
      else if (k === '1') m.setState('mellow')
      else if (k === '2') m.setState('intense')
      else if (k === 'x') m.setState(m.state === 'mellow' ? 'intense' : 'mellow')
      else if (k === 'o') m.setPrefs({ mode: m.prefs.mode === 'any' ? 'order' : 'any' })
      else if (k === 'ArrowLeft') { stop(); m.back() }
      else if (k === 'ArrowRight') { stop(); m.skip() }
      else if (k === 'Escape') m.stop()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [m])

  return (
    <div className="mx">
      <div className="mx-wrap">
        <header className="mx-head">
          <div className="lbl">{m.lib.bpm} BPM · {LEN}-bar parts · every song on one grid</div>
          <h1>Mixer</h1>
          <p className="dim">Hear the songs as the game would play them: endlessly, mellow or intense. Each song comes in at a part, plays on for at least
            Stay bars, varying as it goes, then moves on where it joins well. Rate as it plays: stars on each block, a thumb on each transition.</p>
        </header>
        <Transport m={m} />
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

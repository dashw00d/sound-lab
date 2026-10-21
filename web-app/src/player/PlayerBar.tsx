// The player's bar, at the foot of every page: back / play / skip, the clock and its beats, what plays now and next,
// the blind lane while the walk plays (stars per block, a thumb per transition) or the queue while one plays (click a
// song to go to it), the two levels (mellow, intense) with their meters, and the spectrum. Space with nothing playing
// starts the walk: the game's music.
import { useRef } from 'react'
import { drawSpectrum } from '../audio/spectrum'
import type { Mixer } from '../mixer/engine/mixer'
import { STATES } from '../mixer/types'
import { Icon } from '../shell/Icon'
import { useEngine, useFrame, useSnapshot } from './hooks'
import { useKeys } from './keys'
import { Lane } from './Rating'
import { usePlayer } from './store'
import './player.css'

const MODE = { walk: 'The walk', song: 'Song', queue: 'Queue', script: 'Audition' } as const

export function PlayerBar() {
  const p = usePlayer()
  if (p.status === 'error') return <footer className="pbar off"><span className="dim">{p.error}</span></footer>
  return p.status === 'ready' ? <Bar m={p.m} /> : null
}

function Bar({ m }: { m: Mixer }) {
  const snap = useSnapshot(m)  // (only the bar redraws as the clock moves)
  useEngine(m)  // (and when a star or thumb changes)
  useKeys((k) => {
    if (k === ' ') { if (m.playing) m.stop(); else void m.play(); return true }
    if (k === 'ArrowLeft' && (m.walking || m.mode === 'queue')) { m.back(); return true }
    if (k === 'ArrowRight' && (m.walking || m.mode === 'queue')) { m.skip(); return true }
    if (k === '1' || k === '2') { m.setState(k === '1' ? 'mellow' : 'intense'); return true }
    if (k === 'x') { m.setState(m.state === 'mellow' ? 'intense' : 'mellow'); return true }
    if (k === 'Escape' && m.playing) { m.stop(); return true }
    return false
  }, 0)
  const spec = useRef<HTMLCanvasElement>(null), meters = useRef<Record<string, HTMLDivElement | null>>({})
  const bins = useRef(new Float32Array(m.sched.analyser.frequencyBinCount)), wav = useRef(new Float32Array(1024))
  useFrame(() => {
    drawSpectrum(spec.current, m.sched.analyser, bins.current, m.playing)
    for (const st of STATES) {
      const el = meters.current[st]; if (!el) continue
      let s = 0
      if (m.playing) { m.sched.bus[st].meter.getFloatTimeDomainData(wav.current); for (const v of wav.current) s += v * v }
      el.style.width = `${Math.round(100 * Math.min(1, Math.max(0, (10 * Math.log10(s / 1024 + 1e-12) + 54) / 48)))}%`
    }
  })
  const walk = snap.mode === 'walk', queue = snap.mode === 'queue' ? m.queue : null
  return (
    <footer className="pbar">
      <div className="pb-tr">
        <button className="iconbtn" disabled={!walk && !queue} title={queue ? 'Back: this song from its start; twice: the one before (←)' : 'Back: the transition into this block again; twice: the one before (←)'} onClick={() => m.back()}><Icon name="prev" /></button>
        <button className="playbtn" title={snap.playing ? 'Stop (Space)' : 'Play the walk (Space)'} onClick={() => (snap.playing ? m.stop() : void m.play())}><Icon name={snap.playing ? 'stop' : 'play'} /></button>
        <button className="iconbtn" disabled={!walk && !queue} title={queue ? 'The next song (→)' : 'Skip to a new run (→)'} onClick={() => m.skip()}><Icon name="next" /></button>
      </div>
      <div className="pb-clock">
        <div className="big">{snap.clock.big}<small>{snap.clock.small}</small></div>
        <div className="beats">{Array.from({ length: m.lib.bar_beats }, (_, i) => <i key={i} className={i === snap.beat ? 'on' : ''} />)}</div>
      </div>
      <div className="pb-now">
        <span className="lbl">{snap.mode ? MODE[snap.mode] : 'Stopped'}{queue && snap.qi != null ? ` · ${snap.qi + 1} of ${queue.length}` : ''}</span>
        <b>{snap.playing ? snap.now : 'Space plays the walk'}</b>
        {snap.playing && <small>next: {snap.next}</small>}
      </div>
      <div className="pb-lane">
        {walk && <Lane m={m} snap={snap} />}
        {queue && (
          <div className="pb-queue">
            {queue.map((q, i) => <button key={`${q.id}#${i}`} className={`chip ${i === snap.qi ? 'on' : ''}`} title={`Go to ${q.label}`} onClick={() => m.playQueue(queue, i)}><small>{i + 1}</small>{q.label}</button>)}
          </div>
        )}
      </div>
      <div className="pb-levels">
        {STATES.map((st, i) => (
          <button key={st} className={`pb-lvl ${m.state === st ? 'on' : ''}`} title={`${st === 'mellow' ? 'calm' : m.prefs.intense} level (${i + 1}; X switches)`} onClick={() => m.setState(st)}>
            <span>{st}</span><div className="vu"><div ref={el => { meters.current[st] = el }} /></div>
          </button>
        ))}
      </div>
      <canvas className="pb-spec" ref={spec} />
    </footer>
  )
}

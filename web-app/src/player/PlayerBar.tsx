// The player's bar, at the foot of every page: back / play / skip, the clock and its beats, what plays now and next,
// the blind lane while the walk plays (stars per block, a thumb per transition) or the queue while one plays (click a
// song to go to it; a page fills it, e.g. the songs chosen on the Families graph), the two levels (mellow, intense)
// with their meters, and the spectrum. Space with nothing playing plays the queue when there is one, else the walk:
// the game's music.
import { useEffect, useRef, useState } from 'react'
import { useFamilies } from '../data/resources'
import { drawSpectrum } from '../audio/spectrum'
import type { Mixer } from '../mixer/engine/mixer'
import { STATES } from '../mixer/types'
import { Icon } from '../shell/Icon'
import { useEngine, useFrame, useSnapshot } from './hooks'
import { useKeys } from './keys'
import { usePlayer } from './store'
import { TimelineStrip } from './TimelineStrip'
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
  const [vol, setVol] = useState(() => Number(localStorage.getItem('player.volume') ?? 0.95))
  const [muted, setMuted] = useState(() => localStorage.getItem('player.muted') === '1')
  useEffect(() => { m.setVolume(vol, muted); localStorage.setItem('player.volume', String(vol)); localStorage.setItem('player.muted', muted ? '1' : '0') }, [m, vol, muted])
  const fams = useFamilies()  // (the graph follows the sort)
  useEffect(() => { if (fams.data) m.setGraph(fams.data) }, [fams.data, m])
  useKeys((k) => {
    if (k === ' ') { if (m.playing) m.stop(); else m.playDefault(); return true }
    if (k === 'ArrowLeft' && (m.walking || m.mode === 'queue')) { m.back(); return true }
    if (k === 'ArrowRight' && (m.walking || m.mode === 'queue')) { m.skip(); return true }
    if (k === '1' || k === '2') { m.setState(k === '1' ? 'mellow' : 'intense'); return true }
    if (k === 'x') { m.setState(m.state === 'mellow' ? 'intense' : 'mellow'); return true }
    if (k === 'Escape' && m.playing) { m.stop(); return true }
    if (k === 'm') { setMuted(x => !x); return true }
    if (k === '.' && (m.walking || m.mode === 'queue')) { m.nextTransition(); return true }
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
  const walk = snap.mode === 'walk', queue = !walk ? m.queue : null, inQueue = snap.mode === 'queue'
  return (
    <footer className="pbar">
      <div className="pb-row">
      <div className="pb-tr">
        <button className="iconbtn" disabled={!walk && !inQueue} title={inQueue ? 'Back: this song from its start; twice: the one before (←)' : 'Back: the transition into this block again; twice: the one before (←)'} onClick={() => m.back()}><Icon name="prev" /></button>
        <button className="playbtn" title={snap.playing ? 'Stop (Space)' : queue ? 'Play the queue (Space)' : 'Play the walk (Space)'} onClick={() => (snap.playing ? m.stop() : m.playDefault())}><Icon name={snap.playing ? 'stop' : 'play'} /></button>
        <button className="iconbtn" disabled={!walk && !inQueue} title={inQueue ? 'The next song (→)' : 'Skip to a new run (→)'} onClick={() => m.skip()}><Icon name="next" /></button>
        <button className="iconbtn tr" disabled={!walk && !inQueue} title={inQueue ? 'To 2 bars before the next song (.)' : 'Move on at the next phrase end: to the next transition (.)'} onClick={() => m.nextTransition()}><Icon name="arrow" /></button>
      </div>
      <div className="pb-clock">
        <div className="big">{snap.clock.big}<small>{snap.clock.small}</small></div>
        <div className="beats">{Array.from({ length: m.lib.bar_beats }, (_, i) => <i key={i} className={i === snap.beat ? 'on' : ''} />)}</div>
      </div>
      <div className="pb-now">
        <span className="lbl">{snap.mode ? MODE[snap.mode] : 'Stopped'}{inQueue && queue && snap.qi != null ? ` · ${snap.qi + 1} of ${queue.length}` : ''}
          {queue && <button className="pb-clear" title="Clear the queue (Play then plays the walk)" onClick={() => m.setQueue(null)}>queue of {queue.length} <Icon name="x" /></button>}</span>
        <b>{snap.playing ? snap.now : queue ? `Space plays the queue: ${queue.length} songs` : 'Space plays the walk'}</b>
        {snap.playing && <small>next: {snap.next}</small>}
      </div>
      <TimelineStrip m={m} />
      <div className="pb-levels">
        {STATES.map((st, i) => (
          <button key={st} className={`pb-lvl ${m.state === st ? 'on' : ''}`} title={`${st === 'mellow' ? 'calm' : m.prefs.intense} level (${i + 1}; X switches)`} onClick={() => m.setState(st)}>
            <span>{st}</span><div className="vu"><div ref={el => { meters.current[st] = el }} /></div>
          </button>
        ))}
      </div>
      <div className={`pb-vol ${muted ? 'muted' : ''}`}>
        <button title={muted ? 'Unmute (M)' : 'Mute (M)'} onClick={() => setMuted(x => !x)}><Icon name={muted || vol === 0 ? 'mute' : 'volume'} /></button>
        <input type="range" min={0} max={1} step={0.01} value={vol} aria-label="Volume" title={`Volume ${Math.round(100 * vol)}%`}
          style={{ ['--v' as string]: `${(muted ? 0 : vol) * 100}%` }}
          onChange={e => { setVol(Number(e.target.value)); if (muted) setMuted(false) }} />
      </div>
      <canvas className="pb-spec" ref={spec} />
      </div>
    </footer>
  )
}

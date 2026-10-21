// The transport: back / play / skip, the clock and its beats, what plays now and next, the spectrum, the lane, the
// session list, and the two levels (mellow, intense) with their meters.
import { useRef } from 'react'
import { drawSpectrum } from '../../audio/spectrum'
import type { Mixer } from '../../mixer/engine/mixer'
import { STATES } from '../../mixer/types'
import { Icon } from '../../shell/Icon'
import { useEngine, useFrame, useSnapshot } from './hooks'
import { Lane, SessionList } from './Rating'

export function Transport({ m }: { m: Mixer }) {
  const snap = useSnapshot(m)  // (only the transport redraws as the clock moves)
  useEngine(m)  // (and when a star or thumb changes)
  const spec = useRef<HTMLCanvasElement>(null), meters = useRef<Record<string, { vu: HTMLDivElement | null; mix: HTMLDivElement | null }>>({})
  const bins = useRef(new Float32Array(m.sched.analyser.frequencyBinCount)), wav = useRef(new Float32Array(1024))
  useFrame(() => {
    drawSpectrum(spec.current, m.sched.analyser, bins.current, m.playing)
    for (const st of STATES) {
      const el = meters.current[st]; if (!el?.vu || !el.mix) continue
      let s = 0
      if (m.playing) { m.sched.bus[st].meter.getFloatTimeDomainData(wav.current); for (const v of wav.current) s += v * v }
      el.vu.style.width = `${Math.round(100 * Math.min(1, Math.max(0, (10 * Math.log10(s / 1024 + 1e-12) + 54) / 48)))}%`
      el.mix.style.width = `${Math.round(100 * (m.playing ? m.sched.bus[st].g.gain.value : 0))}%`
    }
  })
  const intense = m.prefs.intense
  return (
    <section className="card transport">
      <div className="ttop">
        <button className="iconbtn" title="Back: the transition into this block again; twice: the one before (←)" onClick={() => m.back()}><Icon name="prev" /></button>
        <button className="playbtn" title="Play or stop (Space)" onClick={() => (snap.playing ? m.stop() : void m.play())}><Icon name={snap.playing ? 'stop' : 'play'} /></button>
        <button className="iconbtn" title="Skip to a new run (→)" onClick={() => m.skip()}><Icon name="next" /></button>
        <div className="clock">
          <div className="big">{snap.clock.big}<small>{snap.clock.small}</small></div>
          <div className="beats">{Array.from({ length: m.lib.bar_beats }, (_, i) => <i key={i} className={i === snap.beat ? 'on' : ''} />)}</div>
        </div>
        <div className="readouts"><div><span className="lbl">Now</span><b>{snap.now}</b></div><div><span className="lbl">Next</span><b>{snap.next}</b></div></div>
        <canvas className="spectrum" ref={spec} />
      </div>
      <Lane m={m} snap={snap} />
      <SessionList m={m} snap={snap} />
      <div className="levels">
        {STATES.map((st, i) => (
          <button key={st} className={`lvl ${m.state === st ? 'on' : ''}`} onClick={() => m.setState(st)}>
            <span className="t"><b>{st}</b><kbd>{i + 1}</kbd></span>
            <small>{st === 'mellow' ? 'calm' : intense} level of every part</small>
            <div className="vu"><div ref={el => { (meters.current[st] ??= { vu: null, mix: null }).vu = el }} /></div>
            <div className="mix"><div ref={el => { (meters.current[st] ??= { vu: null, mix: null }).mix = el }} /></div>
          </button>
        ))}
      </div>
    </section>
  )
}

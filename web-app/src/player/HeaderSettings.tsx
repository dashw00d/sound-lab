// The settings for everything the player plays (data/mixer.json, the Mixer's), in the header of every page: how long
// each song stays (the walk's least; each song of a queue), how two songs join and whether their basslines swap (in view:
// behind the sliders it went unfound twice, 2026-10-21), and behind the sliders: the levels, the bed, what intense is. The walk's own settings (what it draws from, the taste bar, variation, glue) are the Mixer's.
import { useEffect, useRef, useState } from 'react'
import { SWAP_HZ } from '../mixer/curves'
import type { Mixer } from '../mixer/engine/mixer'
import type { Prefs } from '../mixer/prefs'
import { Icon } from '../shell/Icon'
import { Field, Toggle } from '../ui/Field'
import { Seg } from '../ui/Seg'
import { useEngine } from './hooks'
import { usePlayer } from './store'

export function HeaderSettings() {
  const p = usePlayer()
  return p.status === 'ready' ? <Controls m={p.m} /> : null
}

function Controls({ m }: { m: Mixer }) {
  useEngine(m)
  const [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null)
  useEffect(() => {  // (a click anywhere else closes it)
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    addEventListener('mousedown', away)
    return () => removeEventListener('mousedown', away)
  }, [open])
  const P = m.prefs, set = (x: Partial<Prefs>) => m.setPrefs(x)
  return (
    <div className="hset" ref={box}>
      <span className="hl">Stay</span>
      <Seg value={P.stay} icon="history" onChange={stay => set({ stay })} options={[4, 8, 12, 16].map(k => ({
        value: k, label: String(k), tip: `${k} bars: each song of a queue plays ${k} bars; the walk stays in a song at least ${k}` }))} />
      <span className="hl">Joins</span>
      <Seg value={P.joins} icon="link" onChange={joins => set({ joins })} options={[
        { value: 'tight', label: 'tight', tip: 'A song change is an 80 ms crossfade at the bar line' },
        { value: 'beat', label: '1 beat', tip: 'The two songs overlap for a beat around the bar line' },
        { value: 'two', label: '2 beats', tip: 'The two songs overlap for two beats around the bar line' }]} />
      <button className={`hswap ${P.bassSwap ? 'on' : ''}`} data-tip-icon="wave" title={`Bass swap: at a song change only the melody and harmony cross over; the bass and kick (under ${SWAP_HZ} Hz) swap on the bar line, so two basslines never overlap`} onClick={() => set({ bassSwap: !P.bassSwap })}>
        <i />Bass swap
      </button>
      <button className={`iconbtn ${open ? 'on' : ''}`} title="More settings: even and matched levels, the bed, what intense is" onClick={() => setOpen(o => !o)}><Icon name="sliders" /></button>
      {open && (
        <div className="hpop card">
          <Field label="Levels">
            <Toggle on={P.even} label="Even levels" onChange={even => set({ even })} tip="Each song trimmed toward the library's typical level (by its median beat, within 6 dB)" />
            <Toggle on={P.match} label="Match levels" onChange={match => set({ match })} tip="The song coming in starts at the level of the one going out (within 6 dB), then eases to its own over 2 bars" />
          </Field>
          <Field label="Bed">
            <Seg value={P.bed} onChange={bed => set({ bed })} options={[
              { value: 'off', label: 'off' },
              { value: 'low', label: 'low', tip: "The playing song's glue under everything, 12 dB down" },
              { value: 'mid', label: 'mid', tip: "The playing song's glue under everything, 6 dB down" }]} />
          </Field>
          <Field label="Intense is">
            <Seg value={P.intense} onChange={intense => set({ intense })} options={[{ value: 'battle', label: 'battle' }, { value: 'action', label: 'action' }]} />
          </Field>
        </div>
      )}
    </div>
  )
}

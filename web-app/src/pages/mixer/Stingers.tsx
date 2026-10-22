// Stingers (2026-10-21, the designer on Musloop's: "Stingers, i like that"): accents at a scene change, out of a rest or a
// glue. Each kind on or off (a riser into the new scene's first downbeat, a boom or a crash on it), and every take to
// hear and thumb: the walk plays the liked ones (until some are liked, any not thumbed down), and the sync ships the
// liked ones to the game. Takes come from `music stingers`.
import { useState } from 'react'
import type { Mixer } from '../../mixer/engine/mixer'
import type { StingerKind, StingerTake } from '../../mixer/types'
import { useVotesData } from '../../data/resources'
import { Icon } from '../../shell/Icon'
import { vote } from '../../state/votes'
import { Field, Toggle } from '../../ui/Field'

const KIND: Record<StingerKind, { label: string; tip: string }> = {
  riser: { label: 'Riser', tip: "Builds over the rest and stops exactly on the new scene's first downbeat" },
  boom: { label: 'Boom', tip: "A low drum or impact on the new scene's first downbeat" },
  crash: { label: 'Crash', tip: "A cymbal or gong on the new scene's first downbeat" },
}
let playing: HTMLAudioElement | null = null
const hear = (t: StingerTake) => {
  playing?.pause()
  playing = new Audio('/clips/' + t.file)
  playing.volume = Math.min(1, Number(localStorage.getItem('player.volume') ?? 0.95) ** 2)
  void playing.play()
}

export function Stingers({ m }: { m: Mixer }) {
  const all = m.lib.stingers, on = m.prefs.stingers, clips = useVotesData().clips, [open, setOpen] = useState(false)
  const n = all ? Object.values(all).reduce((a, v) => a + v.length, 0) : 0
  const set = (kind: StingerKind, v: boolean) => m.setPrefs({ stingers: { ...on, [kind]: v } })
  return (
    <>
      <Field label="Stingers">
        {(Object.keys(KIND) as StingerKind[]).map(k => {
          const ts = all?.[k] ?? [], liked = ts.filter(t => (clips[t.id] || 0) > 0).length
          return <Toggle key={k} on={on[k]} label={`${KIND[k].label}${ts.length ? ` · ${liked || ts.length}` : ''}`} disabled={!ts.length}
            tip={ts.length ? `${KIND[k].tip}. ${liked ? `${liked} liked: the walk plays those` : `${ts.length} takes, none liked yet: the walk plays any not thumbed down`}` : `${KIND[k].tip}: none made yet (music stingers)`}
            onChange={v => set(k, v)} />
        })}
        {n > 0 && <button className={`btn ghost sm ${open ? 'on' : ''}`} onClick={() => setOpen(o => !o)}><Icon name="volume" />Hear and judge {n}</button>}
      </Field>
      {open && all && (
        <div className="stg">
          {(Object.keys(KIND) as StingerKind[]).filter(k => all[k]?.length).map(k => (
            <div key={k} className="stg-kind">
              <span className="lbl">{KIND[k].label}s</span>
              <div className="stg-takes">
                {all[k].map(t => {
                  const v = clips[t.id] || 0
                  return (
                    <span key={t.id} className={`stg-take ${v > 0 ? 'up' : v < 0 ? 'down' : ''}`} title={`${t.variant} s${t.seed} · ${t.seconds ?? '?'} s${t.rises != null ? (t.rises ? ' · a directed build' : ' · a weak build') : ''}`}>
                      <button className="stg-play" onClick={() => hear(t)}><Icon name="play" />{t.variant}<small>{t.seed}</small></button>
                      <button className={`stg-v ${v > 0 ? 'on' : ''}`} title="Good: the walk plays it, the game gets it" onClick={() => void vote(t.id, v > 0 ? 0 : 1)}><Icon name="up" /></button>
                      <button className={`stg-v dn ${v < 0 ? 'on' : ''}`} title="Bad: never played" onClick={() => void vote(t.id, v < 0 ? 0 : -1)}><Icon name="down" /></button>
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

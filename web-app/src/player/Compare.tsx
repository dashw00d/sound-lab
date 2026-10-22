// Compare a transition (2026-10-22, the designer: "can you show me an example with and without bass swap ... We have a
// bunch of transitions and stuff that are hard to sample"): one transition, heard under each variant of a setting, back
// to back and labelled: the bass swap, the joins, the tail into a rest, matched levels. The variant playing
// lights up, your setting is marked, and "Keep" makes a variant your setting. Opened from a transition on the timeline
// (A/B on its seam) or from the header (the last transition heard).
import type { Mixer, CompareKind } from '../mixer/engine/mixer'
import { COMPARE } from '../mixer/engine/mixer'
import type { Prefs } from '../mixer/prefs'
import { Icon } from '../shell/Icon'
import { useEngine, useSnapshot } from './hooks'
import './compare.css'

const KINDS = Object.keys(COMPARE) as CompareKind[]

/** Is a variant the Mixer's setting now? */
const isMine = (P: Prefs, over: Partial<Prefs>) => Object.entries(over).every(([k, v]) => JSON.stringify(P[k as keyof Prefs]) === JSON.stringify(v))

export function Compare({ m }: { m: Mixer }) {
  useEngine(m)
  useSnapshot(m)  // (the variant playing, as it changes)
  const o = m.compareOpen
  if (!o) return null
  const spec = COMPARE[o.kind], now = m.comparing(), all = m.tag === 'compare' && m.playing
  const keep = (over: Partial<Prefs>) => m.setPrefs(over)
  return (
    <div className="cmp" role="dialog" aria-label="Compare a transition">
      <header className="cmp-h">
        <span className="cmp-ic"><Icon name="layers" /></span>
        <div className="cmp-t"><b>Compare a transition</b><span title={o.t.label}>{o.t.label}</span></div>
        <button className="cmp-x" title="Close (the comparison stops)" onClick={() => m.closeCompare()}><Icon name="x" /></button>
      </header>
      <div className="cmp-kinds">
        {KINDS.map(k => <button key={k} className={k === o.kind ? 'on' : ''} title={COMPARE[k].about} onClick={() => m.setCompareKind(k)}>{COMPARE[k].title}</button>)}
      </div>
      <p className="cmp-about">{spec.about}{spec.via === 'rest' && o.t.via !== 'rest' ? '. Played through a rest, as at a scene change.' : spec.via === null && o.t.via ? '. Played as a straight cut, without the rest.' : '.'}</p>
      <div className="cmp-vs">
        {spec.variants.map((v, i) => {
          const mine = isMine(m.prefs, v.over), on = now === i
          return (
            <div key={i} className={`cmp-v ${on ? 'on' : ''}`}>
              <button className="cmp-play" title={`Hear ${'ABCD'[i]}: ${v.label}`} onClick={() => (on && !all ? m.stop() : m.playCompare(i))}>
                <span className="cmp-l">{'ABCD'[i]}</span><Icon name={on ? 'stop' : 'play'} />
              </button>
              <span className="cmp-n">{v.label}</span>
              {mine ? <span className="cmp-mine" title="Your setting now">yours</span>
                : <button className="cmp-keep" title={`Keep ${v.label}: it becomes your setting`} onClick={() => keep(v.over)}>Keep</button>}
              {on && <span className="cmp-eq"><b /><b /><b /></span>}
            </div>
          )
        })}
      </div>
      <div className="cmp-go">
        <button className="btn primary" title="Each variant in turn, twice (about a minute): listen at the bar line where they meet" onClick={() => (all && now != null ? m.stop() : m.playCompare('all'))}>
          <Icon name={all && now != null ? 'stop' : 'play'} />{all && now != null ? 'Stop' : `Play ${spec.variants.map((_, i) => 'ABCD'[i]).join(', ')} in turn`}
        </button>
        <span className="cmp-hint">2 bars of the song going out, the transition, 3 bars of the one coming in{spec.title === 'Bass swap' ? ': listen low, on headphones or a sub' : ''}</span>
      </div>
    </div>
  )
}

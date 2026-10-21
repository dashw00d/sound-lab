// A new take, whole: what it is (its kind, its words: what SA3 was asked for), how it scored, where the sort puts it (its
// scene, its energy), its spectrogram, and its answers (one key each).
import { useFamilies } from '../../data/resources'
import { useEngine } from '../../player/hooks'
import { usePlayer } from '../../player/store'
import { Icon } from '../../shell/Icon'
import { Energy } from '../../ui/Energy'
import { Timeline } from '../../ui/Timeline'
import { colour, hue, label } from '../families/model'
import { KIND, type Answer, type Take } from './model'

export function TakeInspector({ t, onPlay, onAnswer }: { t: Take; onPlay: () => void; onAnswer: (a: Answer) => void }) {
  const m = usePlayer().m, F = useFamilies().data
  useEngine(m)
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
      {near.length > 0 && (
        <div className="insp-sec">
          <span className="lbl">Flows best with, shipped</span>
          <div className="mates">{near.map(o => <div key={o} className="mate"><span className="nm"><b>{label(o, F!.items[o])}</b></span><span /><Energy value={F!.items[o].energy ?? null} /></div>)}</div>
        </div>
      )}
    </div>
  )
}

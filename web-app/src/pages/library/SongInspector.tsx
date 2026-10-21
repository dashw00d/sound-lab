// One song, whole: what it is and where it sits (its scene, its energy), its transport (play it mellow or intense, from
// any bar), its spectrogram on the bar grid with the loop it plays (drag the cues), how it's fared (the ratings it got in
// the listening sessions, its transitions as the song leaving and coming in), its levels and stems one by one, and the
// other songs of its scene.
import { useMemo, useState } from 'react'
import { go } from '../../data/route'
import { useFamilies, useVotesData } from '../../data/resources'
import type { Level } from '../../mixer/types'
import { useEngine } from '../../player/hooks'
import { RATING } from '../../player/Rating'
import { usePlayer } from '../../player/store'
import { Icon } from '../../shell/Icon'
import { toast } from '../../shell/toast'
import { setCue, vote } from '../../state/votes'
import { Energy } from '../../ui/Energy'
import { Seg } from '../../ui/Seg'
import { Timeline } from '../../ui/Timeline'
import { colour, hue } from '../families/model'
import type { SongRow } from './model'

const LEVEL_NAME: Record<string, string> = { calm: 'calm', tension: 'tension', action: 'action', battle: 'battle' }

export function SongInspector({ row: r, all }: { row: SongRow; all: SongRow[] }) {
  const m = usePlayer().m, F = useFamilies().data, votes = useVotesData()
  useEngine(m)
  const [view, setView] = useState<Level>('mellow')
  const t = r.t, url = (lv: string) => t.src?.[lv] ?? (t.files[lv] ? '/shipped/' + t.files[lv] : null)
  const lv = view === 'mellow' ? 'calm' : (m?.prefs.intense ?? 'battle')
  const cue = votes.cues?.[r.id]?.[view], guess = (view === 'mellow' ? t.measure?.cuts?.calm : t.measure?.cuts?.battle)?.[0]?.bars as [number, number] | undefined
  const loop = cue ?? guess ?? [1, 16]
  const ph = t.measure?.phrase, ticks = ph && ph.contrast >= 0.08 ? Array.from({ length: 16 }, (_, k) => k + 1).filter(b => (((b - ph.start) % 4) + 4) % 4 === 0) : []
  const it = F?.items[r.id], cuts = it?.cuts ?? {}
  // (one mark per bar of its loop it can cut out of into a shipped song's loop, with a part's room: the cuts the graph takes)
  const loops = new Map(all.map(x => [x.id, x.loop])), into: Record<number, string[]> = {}
  Object.entries(cuts).forEach(([b, c]) => c.at.forEach(([e, s]) => {
    const tl = loops.get(b)
    if (tl && e >= loop[0] && e <= loop[1] && s >= tl[0] && s + 3 <= tl[1]) (into[e] ??= []).push(b)
  }))
  const markers = Object.entries(into).map(([e, bs]) => ({ bar: Number(e), color: colour(hue(r.scene ?? 'x')), size: bs.length, title: `after bar ${e}: cuts into ${bs.length} song${bs.length > 1 ? 's' : ''} of its scene` }))
  const mates = useMemo(() => (r.scene ? all.filter(x => x.scene === r.scene && x.id !== r.id).sort((a, b) => (a.energy ?? 0) - (b.energy ?? 0)) : []), [all, r.scene, r.id])
  const playingThis = m?.mode === 'song' && m.tag === r.id
  const thumb = (st: Level) => votes.clips[`song_${r.id}.${st}`] || 0
  const setThumb = async (st: Level, v: number) => { await vote(`song_${r.id}.${st}`, thumb(st) === v ? 0 : v); toast(`${st}: ${thumb(st) === v ? 'cleared' : v > 0 ? 'liked' : 'disliked'}`, v > 0 ? 'up' : 'down') }
  const play = (from?: number) => { if (!m) return; if (m.state !== view) m.setState(view); m.playSong(r.id, r.id, from) }
  const audition = (name: string, u: string) => { if (!m) return; const id = `${r.id}::${name}`; m.ensure(id, { calm: u, battle: u }); m.playSong(id) }
  const rated = [5, 4, 3, 2, 1].filter(k => r.ratings[k])
  return (
    <div className="insp">
      <header className="insp-head">
        <div className="insp-kicker">
          <span className={`ctx c-${r.context}`}>{r.context}</span>
          {r.scene && <button className="chip" onClick={() => go('scenes', r.id)} title="Its scene on the map"><span className="sw" style={{ background: colour(hue(r.scene)) }} />Scene {r.scene.replace(/^f/, '')} · {mates.length + 1} shipped{r.sceneSize > mates.length + 1 ? `, ${r.sceneSize - mates.length - 1} new` : ''}</button>}
          {r.lead && <span className="chip">{r.lead}</span>}
        </div>
        <h2>{r.style} <span>{r.take}</span></h2>
        <div className="insp-energy"><span className="lbl">chill</span><Energy value={r.energy} wide /><span className="lbl">intense</span></div>
      </header>

      <div className="insp-transport">
        <button className="playbtn sm" title={playingThis ? 'Stop' : `Play it ${view}`} onClick={() => (playingThis ? m?.stop() : play())}><Icon name={playingThis ? 'stop' : 'play'} /></button>
        <Seg value={view} onChange={v => { setView(v); m?.setState(v) }} options={[{ value: 'mellow', label: 'Mellow' }, { value: 'intense', label: 'Intense' }]} />
        <span className="thumbs2">
          <button className={thumb(view) > 0 ? 'on up' : 'up'} title={`Good ${view}`} onClick={() => void setThumb(view, 1)}><Icon name="up" /></button>
          <button className={thumb(view) < 0 ? 'on down' : 'down'} title={`Bad ${view}`} onClick={() => void setThumb(view, -1)}><Icon name="down" /></button>
        </span>
      </div>

      <div className="insp-sec">
        <div className="insp-sh"><span className="lbl">{LEVEL_NAME[lv] ?? lv} · its loop</span>
          <span className={`cue-state ${cue ? 'mine' : ''}`}>{cue ? 'your cues' : 'guessed'} · bars {loop[0]}–{loop[1]}</span>
          {cue && <button className="btn sm ghost" onClick={() => void setCue(r.id, view, null).then(() => toast('Back to the guessed loop', 'undo'))}>Reset</button>}
        </div>
        <Timeline url={url(lv)} loop={loop} mine={!!cue} ticks={ticks} markers={view === 'mellow' ? markers : []}
          onLoop={b => void setCue(r.id, view, b).then(() => toast(`Loop: bars ${b[0]}–${b[1]}`, 'check'))}
          playhead={() => (m?.state === view ? m.positionIn(r.id) : null)} onPlay={bar => play(bar)} />
        <p className="insp-hint">Click a bar to play from it · drag the handles to set the loop · ticks: phrase starts · dots: where it cuts into its scene</p>
      </div>

      <div className="insp-tiles">
        <div className="tile"><span className="lbl">Loop</span><b>{loop[1] - loop[0] + 1}<small> bars</small></b></div>
        <div className="tile"><span className="lbl">Energy</span><b>{r.energy == null ? '–' : r.energy > 0 ? `+${r.energy.toFixed(2)}` : r.energy.toFixed(2)}</b></div>
        <div className="tile"><span className="lbl">Leaving it</span><b className="pair"><span className="good">{r.exits[0]}</span>/<span className="bad">{r.exits[1]}</span></b></div>
        <div className="tile"><span className="lbl">Coming in</span><b className="pair"><span className="good">{r.entries[0]}</span>/<span className="bad">{r.entries[1]}</span></b></div>
      </div>
      {rated.length > 0 && (
        <div className="insp-sec">
          <span className="lbl">In your sessions</span>
          <div className="rated">{rated.map(k => <span key={k} className={`rvs r${k}`}><Icon name={RATING[k].icon} />{RATING[k].name} <b>{r.ratings[k]}</b></span>)}</div>
        </div>
      )}

      <div className="insp-sec">
        <span className="lbl">Levels and stems</span>
        <div className="files">
          {Object.keys(t.files).map(l => <FileRow key={l} name={LEVEL_NAME[l] ?? l} sub="level" onPlay={() => audition(l, url(l)!)} />)}
          {Object.entries(t.stems ?? {}).map(([k, f]) => <FileRow key={k} name={k.replace('.', ' · ')} sub="stem" onPlay={() => audition(k, '/clips/' + f)} />)}
          {Object.values(t.fills ?? {}).flat().length > 0 && <div className="frow dim"><Icon name="layers" /><span>{Object.values(t.fills ?? {}).flat().length} fills at its loop point</span></div>}
        </div>
      </div>

      {mates.length > 0 && (
        <div className="insp-sec">
          <div className="insp-sh"><span className="lbl">Its scene · {mates.length + 1} songs, chill to intense</span>
            <button className="btn sm" onClick={() => { if (!m) return; const ids = [r.id, ...mates.map(x => x.id)]; m.playQueue(ids.map(id => ({ id, label: id.split('.').slice(2, -1).join(' · ') }))) }}><Icon name="play" />Queue it</button>
          </div>
          <div className="mates">
            {mates.slice(0, 12).map(x => (
              <button key={x.id} className="mate" onClick={() => go('library', x.id, true)}>
                <span className="nm"><b>{x.style}</b> {x.take} <span className="dim">{x.context}</span></span>
                {cuts[x.id] && <span className="cutn" title={`${cuts[x.id].at.length} seamless cuts from this song into it`}><Icon name="link" />{cuts[x.id].at.length}</span>}
                <Energy value={x.energy} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FileRow({ name, sub, onPlay }: { name: string; sub: string; onPlay: () => void }) {
  return <button className="frow" onClick={onPlay}><Icon name="play" /><span>{name}</span><span className="dim">{sub}</span></button>
}

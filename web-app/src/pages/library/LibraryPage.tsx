// The Library (2026-10-21: the Songs page, made one with the rest): every song the game ships, by scene, with how un-chill
// it is and how it's fared; choose one and the inspector beside it shows it whole. ↑ / ↓ move through the list, Enter
// plays the song chosen, / searches.
import { useEffect, useMemo, useRef, useState } from 'react'
import { go, useRoute } from '../../data/route'
import { useFamilies, useSongs, useStreams, useVotesData } from '../../data/resources'
import { useKeys } from '../../player/keys'
import { useEngine } from '../../player/hooks'
import { usePlayer } from '../../player/store'
import { Icon } from '../../shell/Icon'
import { Energy } from '../../ui/Energy'
import { Seg } from '../../ui/Seg'
import { Split } from '../../ui/Split'
import { colour, hue } from '../families/model'
import { rows, sortRows, type SongRow, type SortKey } from './model'
import { SongInspector } from './SongInspector'
import './library.css'

export default function LibraryPage() {
  const route = useRoute(), songs = useSongs(), F = useFamilies().data, votes = useVotesData(), streams = useStreams().data, m = usePlayer().m
  useEngine(m)  // (the row playing, lit)
  const [q, setQ] = useState(''), [sort, setSort] = useState<SortKey>(() => (localStorage.getItem('library.sort') as SortKey) || 'scene')
  const search = useRef<HTMLInputElement>(null), listBox = useRef<HTMLDivElement>(null)
  const all = useMemo(() => (songs.data ? rows(songs.data, F, votes, streams?.streams ?? null) : []), [songs.data, F, votes, streams])
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (r: SongRow) => words.every(w => `${r.id} ${r.lead} ${r.scene ?? ''}`.toLowerCase().includes(w))
    return sortRows(all.filter(hit), sort)
  }, [all, q, sort])
  const sel = list.find(r => r.id === route.id) ?? null
  useEffect(() => { if (!route.id && list[0]) go('library', list[0].id, true) }, [route.id, list])
  useEffect(() => { listBox.current?.querySelector('.lrow.sel')?.scrollIntoView({ block: 'nearest' }) }, [route.id])
  useKeys(k => {
    const i = list.findIndex(r => r.id === route.id)
    if (k === 'ArrowDown' || k === 'j') { const r = list[Math.min(list.length - 1, i + 1)]; if (r) go('library', r.id, true); return true }
    if (k === 'ArrowUp' || k === 'k') { const r = list[Math.max(0, i - 1)]; if (r) go('library', r.id, true); return true }
    if (k === 'Enter' && sel && m) { m.playSong(sel.id); return true }
    if (k === '/') { search.current?.focus(); return true }
    return false
  })
  if (songs.error && !songs.data) return <div className="empty-state"><div><b>Couldn't read the songs</b>{songs.error}</div></div>
  if (!songs.data) return <div className="empty-state"><div className="lib-loading" /></div>

  // (by scene: a heading per scene, its colour, size and mean energy)
  const groups: { key: string; rows: SongRow[] }[] = []
  for (const r of list) {
    const key = sort === 'scene' ? r.scene ?? 'none' : 'all'
    if (groups[groups.length - 1]?.key !== key) groups.push({ key, rows: [] })
    groups[groups.length - 1].rows.push(r)
  }
  const playing = m?.mode === 'song' ? m.tag : m?.heard().track ?? null
  return (
    <Split id="library" left={
      <div className="lib">
        <div className="lib-bar">
          <label className="search"><Icon name="search" /><input ref={search} value={q} onChange={e => setQ(e.target.value)} placeholder="Search songs, leads, scenes" /><kbd>/</kbd></label>
          <Seg value={sort} onChange={s => { setSort(s); localStorage.setItem('library.sort', s) }} options={[
            { value: 'scene', label: 'Scene' }, { value: 'energy', label: 'Energy' }, { value: 'rating', label: 'Rating' }, { value: 'name', label: 'Name' }]} />
          <span className="lib-count">{list.length} of {all.length} songs</span>
        </div>
        <div className="lib-list" ref={listBox}>
          {groups.map(g => (
            <section key={g.key}>
              {sort === 'scene' && (
                <header className="lib-group">
                  <span className="sw" style={{ background: g.key === 'none' ? 'var(--line-3)' : colour(hue(g.key)) }} />
                  <b>{g.key === 'none' ? 'No scene' : `Scene ${g.key.replace(/^f/, '')}`}</b>
                  <span>{[...new Set(g.rows.map(r => r.lead))].slice(0, 3).join(' · ')}</span>
                  <span className="n">{g.rows.length}</span>
                </header>
              )}
              {g.rows.map(r => <Row key={r.id} r={r} on={r.id === route.id} playing={r.id === playing} />)}
            </section>
          ))}
          {!list.length && <div className="empty-state"><div><b>No songs match</b>Try fewer words.</div></div>}
        </div>
      </div>
    } right={sel ? <SongInspector row={sel} all={all} /> : <div className="empty-state"><div><b>Choose a song</b>Its spectrogram, cues, levels and scene show here.</div></div>} />
  )
}

function Row({ r, on, playing }: { r: SongRow; on: boolean; playing: boolean }) {
  const flags = r.ratings[2] ?? 0, gems = r.ratings[5] ?? 0
  return (
    <div className={`lrow ${on ? 'sel' : ''} ${playing ? 'playing' : ''}`} onClick={() => go('library', r.id, true)}>
      <span className="sw" style={{ background: r.scene ? colour(hue(r.scene)) : 'var(--line-3)' }} />
      <span className="nm"><b>{r.style}</b><span>{r.take}</span>{playing && <i className="eq"><b /><b /><b /></i>}</span>
      <span className={`ctx c-${r.context}`}>{r.context}</span>
      <span className="ld">{r.lead}</span>
      <Energy value={r.energy} />
      <span className="marks">
        {r.mellow > 0 && <span className="mk good" title="Mellow liked"><Icon name="up" /></span>}
        {r.mellow < 0 && <span className="mk bad" title="Mellow disliked"><Icon name="down" /></span>}
        {gems > 0 && <span className="mk gem" title={`Exceptional ${gems}×`}><Icon name="sparkle" />{gems > 1 ? gems : ''}</span>}
        {flags > 0 && <span className="mk flag" title={`Flagged ${flags}×`}><Icon name="flag" />{flags > 1 ? flags : ''}</span>}
      </span>
    </div>
  )
}

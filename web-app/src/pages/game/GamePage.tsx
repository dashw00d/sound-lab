// The game (2026-10-21, the designer: "this app should allow you to sync with a game's source as a folder and maybe
// include json/code/docs ... so the game knows how to plug it in. It should be agnostic"): the folder the lab keeps in
// the game, what's in it against what the lab has now, and the one button that writes it. Beside it, the README the
// game gets: how to plug the music in, in any engine. Nothing is written but by that button.
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import type { SyncPlan } from '../../api/types'
import { useProject } from '../../data/resources'
import { Icon } from '../../shell/Icon'
import { toast } from '../../shell/toast'
import { Seg } from '../../ui/Seg'
import { Split } from '../../ui/Split'
import './game.css'

const mb = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)
const STATE = { new: 'new', changed: 'changed', same: 'in sync', remove: 'to remove', missing: 'missing' } as const

export default function GamePage() {
  const project = useProject()?.name ?? 'the game'
  const [link, setLink] = useState(() => localStorage.getItem('sync.link') === '1')
  const [plans, setPlans] = useState<Partial<Record<'copy' | 'link', SyncPlan>>>({}), [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [open, setOpen] = useState(false)
  const load = (l: boolean) => api.syncPlan(l).then(p => setPlans(x => ({ ...x, [l ? 'link' : 'copy']: p }))).catch(e => setErr(String(e)))
  useEffect(() => { void load(false); void load(true) }, [])
  const plan = plans[link ? 'link' : 'copy']
  const choose = (l: boolean) => { setLink(l); localStorage.setItem('sync.link', l ? '1' : '0') }
  const sync = async () => {
    setBusy(true)
    try {
      const p = await api.sync(link)
      setPlans(x => ({ ...x, [link ? 'link' : 'copy']: p })); void load(!link)
      toast(`Synced into ${p.folder.split('/').slice(-2).join('/')}`, 'check')
    } catch (e) { toast(`Couldn't sync: ${e}`, 'x') }
    setBusy(false)
  }
  if (err && !plan) return <div className="empty-state"><div><b>Couldn't read what a sync would write</b>{err}</div></div>
  if (!plan) return <div className="empty-state"><div className="lib-loading" /></div>

  const texts = plan.rows.filter(r => r.kind === 'text'), audio = plan.rows.filter(r => r.kind === 'audio')
  const n = (s: string) => audio.filter(r => r.state === s).length, writes = plan.rows.filter(r => r.state === 'new' || r.state === 'changed')
  const when = plan.synced ? new Date(plan.synced).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
  return (
    <Split id="game" initial={560} max={760} left={
      <div className="gm">
        <header className="gm-head">
          <span className="lbl">Sync to the game</span>
          <h2>{project}</h2>
          <code className="gm-folder" title="The folder the lab keeps in the game: nothing outside it is written">{plan.folder}</code>
          <div className={`gm-status ${!plan.synced ? 'never' : plan.changes ? 'behind' : 'ok'}`}>
            <i />{!plan.synced ? 'Never synced' : plan.changes ? `${plan.changes} change${plan.changes > 1 ? 's' : ''} since ${when}` : `In sync · ${when}`}
          </div>
        </header>

        <div className="gm-tiles">
          <div className="tile"><span className="lbl">Songs</span><b>{plan.songs}</b></div>
          <div className="tile"><span className="lbl">Scenes</span><b>{plan.scenes}</b></div>
          <div className="tile"><span className="lbl">Seamless cuts</span><b>{plan.cuts}</b></div>
          <div className="tile"><span className="lbl">Audio</span><b>{mb(plan.bytes)}</b></div>
        </div>

        <section className="gm-sec">
          <span className="lbl">The audio</span>
          <Seg value={link ? 'link' : 'copy'} onChange={v => choose(v === 'link')} options={[
            { value: 'copy', label: `Copy into the folder${plans.copy ? ` · ${mb(plans.copy.bytes)}` : ''}`, tip: 'The folder holds every song it plays: self-contained, whatever else the game has' },
            { value: 'link', label: `Use the game's files${plans.link ? ` · ${mb(plans.link.bytes)}` : ''}`, tip: "Where the game already has a song's audio (shipped by music promote), the manifest points at it; only retuned copies go in the folder" }]} />
          <p className="gm-hint">{link ? "The manifest points at the songs the game already ships; the folder holds only the retuned copies the Mixer plays." : 'Each song the walk plays, mellow and intense, as the Mixer hears it (retuned where it is).'}</p>
        </section>

        <section className="gm-sec">
          <span className="lbl">What it writes</span>
          <div className="gm-files">
            {texts.map(r => (
              <div key={r.path} className={`gm-file s-${r.state}`}>
                <Icon name={r.path.endsWith('.md') ? 'layers' : 'save'} /><code>{r.path}</code><span className="gm-what">{ABOUT[r.path] ?? ''}</span><span className="gm-state">{STATE[r.state]}</span>
              </div>
            ))}
            <button className={`gm-file audio ${n('new') + n('changed') + n('remove') ? 's-changed' : 's-same'}`} onClick={() => setOpen(o => !o)}>
              <Icon name="wave" /><code>music/</code>
              <span className="gm-what">{audio.length - n('remove')} files{n('remove') ? `, ${n('remove')} to remove` : ''}</span>
              <span className="gm-state">{[n('new') && `${n('new')} new`, n('changed') && `${n('changed')} changed`, n('remove') && `${n('remove')} to remove`].filter(Boolean).join(' · ') || 'in sync'}</span>
            </button>
            {open && <div className="gm-audio">{audio.map(r => <div key={r.path} className={`s-${r.state}`}><code>{r.path.replace(/^music\//, '')}</code><span>{mb(r.bytes)}</span><span className="gm-state">{STATE[r.state]}</span></div>)}</div>}
            {plan.missing > 0 && <p className="gm-warn"><Icon name="flag" />{plan.missing} audio file{plan.missing > 1 ? 's' : ''} the lab can't find: run music retune or music promote again</p>}
          </div>
        </section>

        <div className="gm-go">
          <button className="btn primary" disabled={busy || !plan.changes} onClick={() => void sync()}>
            <Icon name={busy ? 'refresh' : 'check'} />{busy ? 'Syncing…' : plan.changes ? `Sync ${writes.length} file${writes.length === 1 ? '' : 's'} into the game` : 'Nothing to sync'}
          </button>
          <span className="gm-hint">{plan.changes ? `${mb(plan.write_bytes)} into ${plan.folder.split('/').slice(-2).join('/')}${n('remove') ? `, and ${n('remove')} old audio file${n('remove') > 1 ? 's' : ''} removed` : ''}. Nothing outside the folder is touched.` : 'The folder has everything the lab has now.'}</span>
          <button className="btn ghost sm" onClick={() => { setPlans({}); void load(false); void load(true) }}><Icon name="refresh" />Check again</button>
        </div>
      </div>
    } right={
      <div className="gm-readme">
        <div className="gm-readme-bar"><span className="lbl">README.md · what the game gets</span></div>
        <article className="md">{markdown(plan.readme)}</article>
      </div>
    } />
  )
}

const ABOUT: Record<string, string> = {
  'soundlab.json': 'the manifest: grid, rules, songs, the graph',
  'README.md': 'how to plug it in, any engine',
  'walk.js': 'the walk, as the Mixer runs it',
  'walk.d.ts': "the walk's types",
  'soundlab.schema.json': "the manifest's schema",
}

/** A little markdown: headings, paragraphs, lists, tables, code blocks, bold and inline code (the README's own). */
function markdown(text: string): ReactNode[] {
  const out: ReactNode[] = [], lines = text.split('\n')
  const inline = (s: string, k: string | number): ReactNode => (
    <span key={k}>{s.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((p, i) => p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p)}</span>
  )
  for (let i = 0; i < lines.length;) {
    const l = lines[i]
    if (l.startsWith('```')) {
      const body: string[] = []
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i])
      out.push(<pre key={i}><code>{body.join('\n')}</code></pre>); i++
    } else if (/^#{1,3} /.test(l)) {
      const h = l.match(/^#+/)![0].length, t = inline(l.replace(/^#+ /, ''), 0)
      out.push(h === 1 ? <h1 key={i}>{t}</h1> : h === 2 ? <h2 key={i}>{t}</h2> : <h3 key={i}>{t}</h3>); i++
    } else if (l.startsWith('|')) {
      const rows: string[][] = []
      for (; i < lines.length && lines[i].startsWith('|'); i++) if (!/^\|[\s|:-]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split('|').map(c => c.trim()))
      out.push(<table key={i}><thead><tr>{rows[0].map((c, j) => <th key={j}>{inline(c, j)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c, k)}</td>)}</tr>)}</tbody></table>)
    } else if (/^\s*(-|\d+\.) /.test(l)) {
      const ordered = /^\d+\./.test(l.trim()), items: { text: string; sub: string[] }[] = []
      for (; i < lines.length && /^\s*(-|\d+\.) /.test(lines[i]); i++) {
        if (/^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1].sub.push(lines[i].trim().replace(/^(-|\d+\.) /, ''))
        else items.push({ text: lines[i].trim().replace(/^(-|\d+\.) /, ''), sub: [] })
      }
      const li = items.map((it, j) => <li key={j}>{inline(it.text, 0)}{it.sub.length > 0 && <ul>{it.sub.map((s, k) => <li key={k}>{inline(s, k)}</li>)}</ul>}</li>)
      out.push(ordered ? <ol key={i}>{li}</ol> : <ul key={i}>{li}</ul>)
    } else if (l.trim()) {
      const para: string[] = []
      for (; i < lines.length && lines[i].trim() && !/^(#|\||```|\s*(-|\d+\.) )/.test(lines[i]); i++) para.push(lines[i])
      out.push(<p key={i}>{inline(para.join(' '), 0)}</p>)
    } else i++
  }
  return out
}

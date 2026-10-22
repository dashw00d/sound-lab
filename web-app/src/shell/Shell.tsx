import type { ReactNode } from 'react'
import { go } from '../data/route'
import { HeaderSettings } from '../player/HeaderSettings'
import { Tooltips } from '../ui/Tooltips'
import type { IconName } from './Icon'
import { PlayerBar } from '../player/PlayerBar'
import './shell.css'
import { Toaster } from './toast'

export interface PageDef { id: string; title: string; count?: number | null; tip?: string; icon?: IconName }

/** The app: the top bar (the lab's name, the sections, the player's settings), the section, and the player's bar at
 * the foot, which stays as the sections change. */
export function Shell({ pages, current, project, children }: { pages: PageDef[]; current: string; project?: string; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="#/library" title="Back to the Library" data-tip-title="Sound Lab" data-tip-icon="wave"><span className="mark" /><span>Sound<b>Lab</b></span></a>
        {project && <span className="proj" title="The game this lab makes music and sound for: its votes, cues and settings live in the game's own folder" data-tip-title={project} data-tip-icon="game" data-tip-link="#/game" data-tip-link-label="Its folder in the game">{project}</span>}
        <nav>
          {pages.map(p => (
            <button key={p.id} className={p.id === current ? 'on' : ''} onClick={() => go(p.id)} title={p.tip} data-tip-title={p.title} data-tip-icon={p.icon}>
              {p.title}{p.count != null && <span className="n">{p.count}</span>}
            </button>
          ))}
          <a className="old" href="/" target="_blank" rel="noreferrer" title="The pages not moved to the new app yet: Sounds, Alerts, Balance, Tuning and Instruments" data-tip-title="The old app" data-tip-icon="external" data-tip-link-label="Open it in a new tab">Old app ↗</a>
        </nav>
        <HeaderSettings />
      </header>
      <main>{children}</main>
      <PlayerBar />
      <Toaster />
      <Tooltips />
    </div>
  )
}

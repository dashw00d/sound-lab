import type { ReactNode } from 'react'
import { go } from '../data/route'
import { HeaderSettings } from '../player/HeaderSettings'
import { PlayerBar } from '../player/PlayerBar'
import './shell.css'
import { Toaster } from './toast'

export interface PageDef { id: string; title: string; count?: number | null }

/** The app: the top bar (the lab's name, the sections, the player's settings), the section, and the player's bar at
 * the foot, which stays as the sections change. */
export function Shell({ pages, current, project, children }: { pages: PageDef[]; current: string; project?: string; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="#/library"><span className="mark" /><span>Sound<b>Lab</b></span></a>
        {project && <span className="proj">{project}</span>}
        <nav>
          {pages.map(p => (
            <button key={p.id} className={p.id === current ? 'on' : ''} onClick={() => go(p.id)}>
              {p.title}{p.count != null && <span className="n">{p.count}</span>}
            </button>
          ))}
          <a className="old" href="/" title="The pages not moved to the new app yet">Old app ↗</a>
        </nav>
        <HeaderSettings />
      </header>
      <main>{children}</main>
      <PlayerBar />
      <Toaster />
    </div>
  )
}

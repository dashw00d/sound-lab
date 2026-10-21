import type { ReactNode } from 'react'
import { PlayerBar } from '../player/PlayerBar'
import './shell.css'
import { Toaster } from './toast'

export interface PageDef { id: string; title: string }

/** The top bar (the lab's name, the pages built in the new app, the way back to the old one), the page, and the player's
 * bar at the foot, which stays as the pages change. */
export function Shell({ pages, current, project, children }: { pages: PageDef[]; current: string; project?: string; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="/app/">Sound<b>Lab</b></a>
        {project && <span className="proj">{project}</span>}
        <nav>
          {pages.map(p => <a key={p.id} href={`#${p.id}`} className={p.id === current ? 'on' : ''}>{p.title}</a>)}
          <a className="old" href="/" title="The pages not moved to the new app yet">Old app ↗</a>
        </nav>
      </header>
      <main>{children}</main>
      <PlayerBar />
      <Toaster />
    </div>
  )
}

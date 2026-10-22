import { lazy, Suspense, useEffect } from 'react'
import { go, useRoute } from './data/route'
import { useFamilies, useProject, useSongs } from './data/resources'
import InboxPage, { useInboxCount } from './pages/inbox/InboxPage'
import LibraryPage from './pages/library/LibraryPage'
import { Shell } from './shell/Shell'

// The app's sections (2026-10-21: Inbox, Library, Scenes, Sessions, the Mixer, and the Game: the folder the lab syncs
// into the game; sound effects, the mix and tuning next). Scenes (the graph library), Sessions and the Mixer load when first opened.
const FamiliesPage = lazy(() => import('./pages/families/FamiliesPage'))
const SessionsPage = lazy(() => import('./pages/sessions/SessionsPage'))
const MixerPage = lazy(() => import('./pages/mixer/MixerPage'))
const GamePage = lazy(() => import('./pages/game/GamePage'))

export default function App() {
  const route = useRoute(), songs = useSongs().data, fams = useFamilies().data, inbox = useInboxCount(), project = useProject()?.name
  useEffect(() => { if (!route.section) go('library', null, true) }, [route.section])
  const pages = [
    { id: 'inbox', title: 'Inbox', count: inbox, view: () => <InboxPage /> },
    { id: 'library', title: 'Library', count: songs ? songs.tracks.filter(t => !t.candidate).length : null, view: () => <LibraryPage /> },
    { id: 'scenes', title: 'Scenes', count: fams ? Object.values(fams.families).filter(f => f.members.length > 1).length : null, view: () => <FamiliesPage /> },
    { id: 'sessions', title: 'Sessions', view: () => <SessionsPage /> },
    { id: 'mixer', title: 'Mixer', view: () => <MixerPage /> },
    { id: 'game', title: 'Game', view: () => <GamePage /> },
  ]
  const page = pages.find(p => p.id === (route.section === 'families' ? 'scenes' : route.section)) ?? pages[0]
  return (
    <Shell pages={pages} current={page.id} project={project}>
      <Suspense fallback={<div className="empty-state"><div className="lib-loading" /></div>}>{page.view()}</Suspense>
    </Shell>
  )
}

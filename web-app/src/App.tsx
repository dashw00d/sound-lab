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
    { id: 'inbox', title: 'Inbox', icon: 'inbox' as const, count: inbox, view: () => <InboxPage />,
      tip: 'New takes waiting for your ear: keep one, call it a bad take, start a new family with it, or say which scene it belongs with' },
    { id: 'library', title: 'Library', icon: 'list' as const, count: songs ? songs.tracks.filter(t => !t.candidate).length : null, view: () => <LibraryPage />,
      tip: "Every song the game has, by scene: hear it whole from any bar, set its loop, its levels and stems, and how it's fared in your sessions" },
    { id: 'scenes', title: 'Scenes', icon: 'graph' as const, count: fams ? Object.values(fams.families).filter(f => f.members.length > 1).length : null, view: () => <FamiliesPage />,
      tip: 'The music graph: songs in scenes that pass as one piece, each with its energy, and the seamless cuts the walk takes between them' },
    { id: 'sessions', title: 'Sessions', icon: 'history' as const, view: () => <SessionsPage />,
      tip: 'Your listening sessions: every block you rated and every transition you thumbed, to hear again exactly as it played' },
    { id: 'mixer', title: 'Mixer', icon: 'sliders' as const, view: () => <MixerPage />,
      tip: 'How the walk plays: what it draws from, the scenes and the wave, variation, glue and stingers; and training, the review and hand-made sets' },
    { id: 'game', title: 'Game', icon: 'game' as const, view: () => <GamePage />,
      tip: "The folder the lab keeps in the game: ship a batch of songs, and the manifest, the walk and the docs any engine plugs in" },
  ]
  const page = pages.find(p => p.id === (route.section === 'families' ? 'scenes' : route.section)) ?? pages[0]
  return (
    <Shell pages={pages} current={page.id} project={project}>
      <Suspense fallback={<div className="empty-state"><div className="lib-loading" /></div>}>{page.view()}</Suspense>
    </Shell>
  )
}

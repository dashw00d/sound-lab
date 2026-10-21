import { useEffect, useState } from 'react'
import { api } from './api/client'
import { go, useRoute } from './data/route'
import { useFamilies, useSongs } from './data/resources'
import FamiliesPage from './pages/families/FamiliesPage'
import InboxPage, { useInboxCount } from './pages/inbox/InboxPage'
import LibraryPage from './pages/library/LibraryPage'
import MixerPage from './pages/mixer/MixerPage'
import { Shell } from './shell/Shell'

// The app's sections (2026-10-21: Library, Scenes and the Mixer first; Inbox, Sessions, sound effects, the mix and
// tuning next). The pages not moved yet stay in the old app, one link away.
export default function App() {
  const route = useRoute(), songs = useSongs().data, fams = useFamilies().data, inbox = useInboxCount()
  const [project, setProject] = useState<string>()
  useEffect(() => { api.state().then(s => setProject(s.project.name)).catch(() => {}) }, [])
  useEffect(() => { if (!route.section) go('library', null, true) }, [route.section])
  const pages = [
    { id: 'inbox', title: 'Inbox', count: inbox, view: () => <InboxPage /> },
    { id: 'library', title: 'Library', count: songs ? songs.tracks.filter(t => !t.candidate).length : null, view: () => <LibraryPage /> },
    { id: 'scenes', title: 'Scenes', count: fams ? Object.values(fams.families).filter(f => f.members.length > 1).length : null, view: () => <FamiliesPage /> },
    { id: 'mixer', title: 'Mixer', view: () => <MixerPage /> },
  ]
  const page = pages.find(p => p.id === (route.section === 'families' ? 'scenes' : route.section)) ?? pages[0]
  return <Shell pages={pages} current={page.id} project={project}>{page.view()}</Shell>
}

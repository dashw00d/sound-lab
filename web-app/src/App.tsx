import { useEffect, useState } from 'react'
import { api } from './api/client'
import FamiliesPage from './pages/families/FamiliesPage'
import { Shell, type PageDef } from './shell/Shell'
import { useHash } from './shell/useHash'

// The pages moved to the new app so far (2026-10-21: the Families graph first; then the Mixer, Songs and Music, and the
// rest). The old pages stay at / until each one is replaced.
const PAGES: (PageDef & { view: () => React.JSX.Element })[] = [
  { id: 'families', title: 'Families', view: () => <FamiliesPage /> },
]

export default function App() {
  const [hash] = useHash('families')
  const [project, setProject] = useState<string>()
  useEffect(() => { api.state().then(s => setProject(s.project.name)).catch(() => {}) }, [])
  const page = PAGES.find(p => p.id === hash.split('/')[0]) ?? PAGES[0]
  return <Shell pages={PAGES} current={page.id} project={project}>{page.view()}</Shell>
}

// Where the app is: the URL's hash, #/section/id (the song or scene chosen). Every page reads it, so a choice anywhere
// (a song clicked in Scenes, a row in the Library) is one place in the app, and a link to it.
import { useSyncExternalStore } from 'react'

export interface Route { section: string; id: string | null }
const read = (): Route => {
  const [section = '', ...rest] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/')
  return { section, id: rest.join('/') || null }
}
let cur = read()
const listeners = new Set<() => void>()
addEventListener('hashchange', () => { cur = read(); listeners.forEach(f => f()) })

export function useRoute(): Route {
  return useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f) } }, () => cur)
}
/** Go to a section, and choose an item in it (replace: no new history entry, for moving through a list). */
export function go(section: string, id: string | null = null, replace = false) {
  const h = `#/${section}${id ? '/' + encodeURIComponent(id) : ''}`
  if (replace) { history.replaceState(null, '', h); cur = read(); listeners.forEach(f => f()) } else location.hash = h
}

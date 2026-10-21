import { useEffect, useState } from 'react'

/** The page in the URL's hash (#families), as the old app routes. */
export function useHash(fallback: string): [string, (h: string) => void] {
  const read = () => decodeURIComponent(location.hash.slice(1)) || fallback
  const [h, setH] = useState(read)
  useEffect(() => {
    const f = () => setH(read())
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  })
  return [h, (to: string) => { location.hash = to }]
}

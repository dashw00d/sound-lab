import { useEffect, useState } from 'react'
import { Icon, type IconName } from './Icon'

// A short message at the bottom of the page, as the old pages show one (core.js Lab.toast).
type Toast = { msg: string; icon?: IconName; at: number }
let current: Toast | null = null
const listeners = new Set<(t: Toast | null) => void>()
export function toast(msg: string, icon?: IconName) {
  current = { msg, icon, at: Date.now() }
  listeners.forEach(f => f(current))
  setTimeout(() => { if (current && Date.now() - current.at >= 1850) { current = null; listeners.forEach(f => f(null)) } }, 1900)
}
export function Toaster() {
  const [t, setT] = useState<Toast | null>(current)
  useEffect(() => { listeners.add(setT); return () => { listeners.delete(setT) } }, [])
  return <div className={`toast ${t ? 'show' : ''}`}>{t?.icon && <Icon name={t.icon} />}<span>{t?.msg}</span></div>
}

// The app's tooltips (2026-10-21, the designer: "make the tooltips AAA beautiful: a title, icons, description, link if
// applicable, for all the elements in the app"). One layer, mounted once, takes over every `title` in the app as you
// point at it (and keeps it from showing the browser's own): a card with the element's icon, a title, what it does, its
// keys as key caps, and a link where there is one. The hints stay written as plain sentences where they're used:
//   "Back: this song from its start; twice: the one before (←)"  →  title "Back", the rest below, ← as a key
//   "Only the melody and harmony cross over…" on a "Bass swap" button  →  title "Bass swap" (its label), the hint below
// An element can say more with data-tip-* attributes: data-tip-title, data-tip-icon (an Icon name), data-tip-keys
// ("Space,M"), data-tip-link (a href) and data-tip-link-label. Shown after 0.65 s (0.09 s while moving between
// hinted elements, as the system's do), above the element (below where there's no room), with an arrow to it; the
// pointer can move into the card to follow its link.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '../shell/Icon'
import './tooltips.css'

interface Tip { title: string | null; body: string | null; keys: (string | { key: string })[] | null; icon: { name?: IconName; svg?: string } | null; link: { href: string; label: string } | null; anchor: Element }

const KEY = /^(Space|Esc|Enter|Tab|Shift|Ctrl|Alt|Cmd|Backspace|Delete|[←→↑↓]|[A-Za-z0-9]|[./\\'[\]=-]|F\d{1,2})$/
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** An icon a title suggests, for an element with none of its own. */
const GUESS: [RegExp, IconName][] = [
  [/^(play|hear|listen)/i, 'play'], [/^stop/i, 'stop'], [/^bad take/i, 'trash'], [/^(good|like)/i, 'up'], [/^bad/i, 'down'],
  [/^keep/i, 'check'], [/new family/i, 'sparkle'], [/^not new/i, 'x'], [/^(queue|play all)/i, 'list'], [/^(clear|done|delete)/i, 'x'],
  [/^(save|write|update)/i, 'save'], [/^(reset|back to|undo)/i, 'undo'], [/^(skip|move on|next)/i, 'next'],
  [/^(replay|check again|re-sort)/i, 'refresh'], [/^(load|start from)/i, 'layers'], [/^add/i, 'plus'], [/^ship/i, 'game'],
  [/^(mellow|intense|calm)/i, 'wave'], [/scene/i, 'graph'], [/^(all|none)$/i, 'check'], [/root/i, 'root'], [/^(rest|glue)/i, 'link'],
  [/^(riser|boom|crash|stinger)/i, 'sparkle'], [/^(mute|unmute|volume)/i, 'volume'], [/folder|game/i, 'game'],
]

/** A hint's keys: the trailing parenthetical ("(Space)", "(1; X switches)", "(← →)"), its key-like words as key caps. */
function keysOf(s: string): { rest: string; keys: Tip['keys'] } {
  const m = s.match(/\s*\(([^()]{1,28})\)\s*$/)
  if (!m || !m[1].split(/[\s;,/]+/).some(w => KEY.test(w))) return { rest: s, keys: null }
  const keys: Tip['keys'] = []
  for (const part of m[1].split(/(\s+|;\s*|,\s*)/)) {
    if (!part) continue
    if (/^[\s;,]+$/.test(part)) { keys.push(/[;,]/.test(part) ? ' · ' : ' '); continue }  // (a separator stays words)
    if (KEY.test(part)) keys.push({ key: part })
    else keys.push(part)
  }
  return { rest: s.slice(0, m.index).trim(), keys }
}

/** What an element's hint says: its title (the part before a colon, else its own label, else a short hint whole), the
 * rest as the description, its keys, its icon (its own, or data-tip-icon) and its link. */
function read(el: HTMLElement, text: string): Tip {
  const d = el.dataset
  let { rest, keys } = keysOf(text)
  if (d.tipKeys) keys = d.tipKeys.split(',').map(k => ({ key: k.trim() }))
  let title: string | null = d.tipTitle ?? null, body: string | null = rest || null
  if (!title && rest) {
    // (the title: the hint's own lead-in ("Back: …") where it names the element; else the element's own short label
    // ("Siblings", "tight") over the whole hint; else a short hint whole)
    const colon = rest.match(/^([^:.;()]{2,42}):\s+(.+)$/s)
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()
    const okLabel = !!label && label.length <= 34 && !/^\d+$/.test(label) && label.toLowerCase() !== rest.toLowerCase()
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, ''), same = (x: string, y: string) => norm(x).startsWith(norm(y)) || norm(y).startsWith(norm(x))
    if (colon && (!okLabel || same(colon[1], label))) { title = colon[1]; body = colon[2] }
    else if (okLabel && rest.length > 24) { title = label; body = rest }
    else if (colon) { title = colon[1]; body = colon[2] }
    else if (rest.length <= 48) { title = rest; body = null }
  }
  // (its icon: the one it says, else its own, else its setting's, else one its title suggests)
  const own = el.querySelector('svg.i:not(.state)'), scope = el.closest<HTMLElement>('[data-tip-scope-icon]')?.dataset.tipScopeIcon
  const guess = title ? GUESS.find(([re]) => re.test(title!))?.[1] : undefined
  const named = (d.tipIcon ?? (own ? null : scope ?? guess)) as IconName | null | undefined
  const icon = named ? { name: named } : own ? { svg: own.innerHTML } : null
  const href = d.tipLink ?? (el instanceof HTMLAnchorElement ? el.getAttribute('href') : null)
  return {
    title: title ? cap(title) : null, body: body ? cap(body) : null, keys, icon,
    link: href ? { href, label: d.tipLinkLabel ?? (el instanceof HTMLAnchorElement && el.target === '_blank' ? 'Opens in a new tab' : 'Open') } : null, anchor: el,
  }
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null), [shown, setShown] = useState(false)
  const card = useRef<HTMLDivElement>(null), timer = useRef(0), hideTimer = useRef(0), lastHidden = useRef(0), over = useRef(false)
  const [pos, setPos] = useState<{ x: number; y: number; arrow: number; below: boolean } | null>(null)
  const shownRef = useRef(false)
  shownRef.current = shown

  useEffect(() => {
    const hide = (now = false) => {
      clearTimeout(timer.current); clearTimeout(hideTimer.current)
      const go = () => {
        if (over.current) return
        setShown(false); lastHidden.current = performance.now()
        window.setTimeout(() => { if (!shownRef.current) { setTip(null); setPos(null) } }, 180)  // (after it has faded)
      }
      if (now) { over.current = false; go() } else hideTimer.current = window.setTimeout(go, 110)
    }
    const enter = (e: Event) => {
      const t = e.target as HTMLElement | null
      if (!t || !(t instanceof Element) || card.current?.contains(t)) return
      const el = t.closest<HTMLElement>('[title], [data-tip]')
      if (!el) return
      const title = el.getAttribute('title')
      if (title != null) {  // (ours from now on: the browser's own never shows)
        el.dataset.tip = title; el.removeAttribute('title')
        if (!el.getAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title)
      }
      const text = el.dataset.tip
      if (!text) return
      clearTimeout(hideTimer.current); clearTimeout(timer.current)
      const warm = shownRef.current || performance.now() - lastHidden.current < 450
      timer.current = window.setTimeout(() => { setTip(read(el, text)); setShown(true) }, warm ? 90 : 650)
    }
    const leave = (e: MouseEvent) => {
      const to = e.relatedTarget as Node | null
      if (to && card.current?.contains(to)) return
      const from = (e.target as Element | null)?.closest?.('[data-tip]')
      if (from && to && from.contains(to)) return
      clearTimeout(timer.current); hide()
    }
    const gone = () => hide(true)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(true) }
    document.addEventListener('mouseover', enter); document.addEventListener('focusin', enter)
    document.addEventListener('mouseout', leave); document.addEventListener('focusout', gone)
    const press = (e: MouseEvent) => { if (!card.current?.contains(e.target as Node)) hide(true) }
    document.addEventListener('mousedown', press, true)
    addEventListener('scroll', gone, true); addEventListener('blur', gone); addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mouseover', enter); document.removeEventListener('focusin', enter)
      document.removeEventListener('mouseout', leave); document.removeEventListener('focusout', gone)
      document.removeEventListener('mousedown', press, true)
      removeEventListener('scroll', gone, true); removeEventListener('blur', gone); removeEventListener('keydown', key)
    }
  }, [])

  // (placed above its element, below where there's no room; kept on screen; the arrow at the element's middle)
  useLayoutEffect(() => {
    if (!tip || !card.current) return
    const r = tip.anchor.getBoundingClientRect(), c = card.current.getBoundingClientRect(), gap = 10
    if (!r.width && !r.height) { setShown(false); return }
    const below = r.top - c.height - gap < 8
    const x = Math.max(8, Math.min(innerWidth - c.width - 8, r.left + r.width / 2 - c.width / 2))
    const y = below ? r.bottom + gap : r.top - c.height - gap
    setPos({ x, y, arrow: Math.max(14, Math.min(c.width - 14, r.left + r.width / 2 - x)), below })
  }, [tip])

  if (!tip) return null
  const compact = !tip.body && !tip.link && !tip.icon
  return createPortal(
    <div ref={card} role="tooltip" className={`tt ${shown && pos ? 'on' : ''} ${pos?.below ? 'below' : ''} ${compact ? 'compact' : ''}`}
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}
      onMouseEnter={() => { over.current = true; clearTimeout(hideTimer.current) }}
      onMouseLeave={() => { over.current = false; setShown(false); lastHidden.current = performance.now() }}>
      <span className="tt-arrow" style={{ left: pos?.arrow ?? 20 }} />
      {(tip.title || tip.icon) && (
        <div className="tt-head">
          {tip.icon && <span className="tt-ic">{tip.icon.name ? <Icon name={tip.icon.name} /> : <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: tip.icon.svg! }} />}</span>}
          {tip.title && <b className="tt-title">{tip.title}</b>}
          {tip.keys && <Keys keys={tip.keys} inline />}
        </div>
      )}
      {tip.body && <p className="tt-body">{tip.body}</p>}
      {tip.keys && !tip.title && !tip.icon && <Keys keys={tip.keys} />}
      {tip.link && <a className="tt-link" href={tip.link.href} target={tip.link.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{tip.link.label}<Icon name={tip.link.href.startsWith('http') || tip.link.label.includes('new tab') ? 'external' : 'arrow'} /></a>}
    </div>,
    document.body,
  )
}

function Keys({ keys, inline }: { keys: NonNullable<Tip['keys']>; inline?: boolean }): ReactNode {
  return <span className={`tt-keys ${inline ? 'inline' : ''}`}>{keys.map((k, i) => (typeof k === 'string' ? <span key={i}>{k}</span> : <kbd key={i}>{k.key}</kbd>))}</span>
}

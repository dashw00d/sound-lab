// The lab's icons (24-unit grid, drawn in the current colour), as the old pages draw them (core.js Lab.ICONS).
const FILL = { fill: 'currentColor', stroke: 'none' } as const
const STAR = 'M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17.1 6.6 20l1-6.1-4.4-4.3 6.1-.9z'
const THUMB = <><path d="M7 11v9" /><path d="M7 11l3.6-6.6A1.8 1.8 0 0 1 14 5.6l-.8 3.9h5.3a2 2 0 0 1 2 2.4l-1.3 6.4a2 2 0 0 1-2 1.7H7" /><path d="M7 20H4.5A1.5 1.5 0 0 1 3 18.5v-6A1.5 1.5 0 0 1 4.5 11H7" /></>
const ICONS = {
  play: <path {...FILL} d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />,
  stop: <rect {...FILL} x="6" y="6" width="12" height="12" rx="2.2" />,
  up: THUMB, down: <g transform="rotate(180 12 12)">{THUMB}</g>,
  star: <path d={STAR} />, starFill: <path {...FILL} d={STAR} />,
  refresh: <><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" /><path d="M20.5 4v4.5H16" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  check: <path d="M20 6.5L9.5 17 4 11.5" />, plus: <path d="M12 5v14M5 12h14" />, x: <path d="M18 6L6 18M6 6l12 12" />,
  left: <path d="M15 18l-6-6 6-6" />, right: <path d="M9 18l6-6-6-6" />, arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  layers: <><path d="M12 3L2.5 8 12 13l9.5-5z" /><path d="M2.5 12.5L12 17.5l9.5-5" /><path d="M2.5 16.5L12 21.5l9.5-5" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h12l-2.5 4.5L17 13H5" /></>,
  save: <><path d="M5 3.5h11l3.5 3.5v12.5a1 1 0 0 1-1 1H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5z" /><path d="M7.5 3.5v5h8v-5M7.5 20.5v-6h9v6" /></>,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  // (a family's root: a hub, as the graph draws a family, a star round it)
  root: <><circle {...FILL} cx="12" cy="12" r="3.4" /><path d="M12 8.6V5.2M8.8 11L5.9 10M10 14.8l-1.9 2.6M14 14.8l1.9 2.6M15.2 11l2.9-1" />
    <circle cx="12" cy="3.8" r="1.5" /><circle cx="4.4" cy="9.5" r="1.5" /><circle cx="7.2" cy="18.6" r="1.5" /><circle cx="16.8" cy="18.6" r="1.5" /><circle cx="19.6" cy="9.5" r="1.5" /></>,
  prev: <><path {...FILL} d="M18 6.6v10.8a.9.9 0 0 1-1.4.75L9 12.75a.9.9 0 0 1 0-1.5l7.6-5.4A.9.9 0 0 1 18 6.6z" /><path d="M6.5 6v12" /></>,
  next: <><path {...FILL} d="M6 6.6v10.8a.9.9 0 0 0 1.4.75L15 12.75a.9.9 0 0 0 0-1.5L7.4 5.85A.9.9 0 0 0 6 6.6z" /><path d="M17.5 6v12" /></>,
} as const
export type IconName = keyof typeof ICONS

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`i ${className}`} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>
}

import type { ReactNode } from 'react'
import { Icon, type IconName } from '../shell/Icon'

/** Each setting's icon, for the tooltips of its options (ui/Tooltips). */
const FIELD_ICON: Record<string, IconName> = {
  'Draw from': 'graph', Scene: 'graph', Wave: 'wave', 'New takes': 'inbox', Order: 'list', 'Taste bar': 'sliders', Variation: 'layers',
  Glue: 'link', Stingers: 'sparkle', Training: 'up', Review: 'flag', Levels: 'volume', Bed: 'layers', 'Intense is': 'wave',
}
/** A labelled control. */
export function Field({ label, grow, icon, children }: { label: string; grow?: boolean; icon?: IconName; children: ReactNode }) {
  return <div className={`field ${grow ? 'grow' : ''}`} data-tip-scope-icon={icon ?? FIELD_ICON[label]}><label>{label}</label><div className="row">{children}</div></div>
}
/** An on / off button that says which it is. */
export function Toggle({ on, label, tip, disabled, onChange }: { on: boolean; label: string; tip?: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return <button className={`btn ${on && !disabled ? 'on' : ''}`} title={tip} disabled={disabled} onClick={() => onChange(!on)}><Icon name={on && !disabled ? 'check' : 'x'} className="state" /><span>{label}</span></button>
}

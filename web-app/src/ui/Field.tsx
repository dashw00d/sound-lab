import type { ReactNode } from 'react'
import { Icon } from '../shell/Icon'

/** A labelled control. */
export function Field({ label, grow, children }: { label: string; grow?: boolean; children: ReactNode }) {
  return <div className={`field ${grow ? 'grow' : ''}`}><label>{label}</label><div className="row">{children}</div></div>
}
/** An on / off button that says which it is. */
export function Toggle({ on, label, tip, disabled, onChange }: { on: boolean; label: string; tip?: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return <button className={`btn ${on && !disabled ? 'on' : ''}`} title={tip} disabled={disabled} onClick={() => onChange(!on)}><Icon name={on && !disabled ? 'check' : 'x'} /><span>{label}</span></button>
}

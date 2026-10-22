import type { IconName } from '../shell/Icon'
// A segmented control: one of a few values.
export interface SegOption<T extends string | number> { value: T; label: string; tip?: string; disabled?: boolean }

export function Seg<T extends string | number>({ value, options, onChange, icon }: { value: T; options: SegOption<T>[]; onChange: (v: T) => void; icon?: IconName }) {
  return (
    <span className="seg" data-tip-scope-icon={icon}>
      {options.map(o => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} disabled={o.disabled} title={o.tip} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </span>
  )
}

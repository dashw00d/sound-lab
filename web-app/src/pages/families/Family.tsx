// A song's family, the same from any member: its root first, then the members the designer confirmed, then the sort's
// suggestions; each can be confirmed (or undone), marked a near duplicate of the root, or taken out. The family plays
// as a queue; the songs most like this one outside it are one click from joining.
import type { Families } from '../../api/types'
import { Icon } from '../../shell/Icon'
import { colour, hue, label, type FamilyView, type Link } from './model'

export function FamilyCard({ F, fv, sel, playing, onPlay, onSet, onOut, onConfirmAll, onQueue }: {
  F: Families; fv: FamilyView; sel: string; playing: string | null
  onPlay: (id: string) => void; onSet: (x: string, y: string, k: Link | null) => void; onOut: (id: string) => void
  onConfirmAll: (id: string) => void; onQueue: (ids: string[]) => void
}) {
  const f = fv.family(sel), it = F.items[sel], dot = (id: string) => colour(hue(fv.family(id).id))
  const sure = f.members.slice(1).filter(m => fv.relation(m, f.root)).length
  const near = it.nearest.filter(o => F.items[o] && fv.family(o).id !== f.id)
  return (
    <div className="fa-fam">
      <div className="lbl">{f.members.length > 1 ? `its family · ${f.members.length} songs · ${sure} confirmed` : 'on its own'}</div>
      {f.members.length > 1 && (
        <>
          <div className="fa-list">
            {f.members.map(x => {
              const rel = x === f.root ? null : fv.relation(x, f.root)
              return (
                <div key={x} className={`fa-li ${x === f.root ? 'root' : ''} ${x === sel ? 'sel' : ''} ${x === playing ? 'now' : ''} ${x !== f.root && !rel ? 'guess' : ''}`}>
                  {x === f.root ? <span className="hub" style={{ color: dot(x) }} title="The family's root: every member is linked to it"><Icon name="root" /></span>
                    : <span className="dot" style={{ background: dot(x) }} />}
                  <button className="lnk" onClick={() => onPlay(x)}>{label(x, F.items[x])}</button>
                  {x !== f.root && <>
                    <button className={`okb ${rel ? 'on' : ''}`} title={rel ? 'Confirmed: click to undo (back to the sort’s suggestion)' : 'The sort’s suggestion: click to confirm it belongs'}
                      onClick={() => onSet(x, f.root, rel ? null : 'match')}>✓</button>
                    <button className={`dupb ${rel === 'dup' ? 'on' : ''}`} title={rel === 'dup' ? 'A near duplicate of the root: click for just a match' : 'A near duplicate of the root'}
                      onClick={() => onSet(x, f.root, rel === 'dup' ? 'match' : 'dup')}>≈</button>
                  </>}
                  <button className="x" title={x === f.root ? 'Take it out (the next most linked becomes the root)' : 'Take it out of the family, for good (a bad match)'} onClick={() => onOut(x)}>×</button>
                </div>
              )
            })}
          </div>
          <div className="row">
            {sure < f.members.length - 1 && <button className="btn" onClick={() => onConfirmAll(sel)}>Confirm all</button>}
            <button className="btn" onClick={() => onQueue(f.members)}>Play it as a queue</button>
          </div>
        </>
      )}
      {near.length > 0 && <div className="lbl near">most like it{f.members.length > 1 ? ', outside the family' : ''}</div>}
      {near.map(o => (
        <div key={o} className={`fa-li ${o === playing ? 'now' : ''}`}>
          <span className="dot" style={{ background: dot(o) }} />
          <button className="lnk" onClick={() => onPlay(o)}>{label(o, F.items[o])}{fv.family(o).members.length > 1 ? <small> · family of {fv.family(o).members.length}</small> : null}</button>
          <button className="addb" title="Bring it into this family" onClick={() => onSet(o, sel, 'match')}>+</button>
        </div>
      ))}
    </div>
  )
}

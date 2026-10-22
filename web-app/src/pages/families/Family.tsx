// A song's family, the same from any member: its root first, then the members the designer confirmed, then the sort's
// suggestions; each can be confirmed (or undone), marked a near duplicate of the root, or taken out. Then the guesses:
// the songs that nearly splice with all of the family, and the families this song nearly splices with, each one click
// from in (or a bad match); and the songs it splices best with. Scores: the share of seamless cuts at the best offset.
import type { Families } from '../../api/types'
import { Icon } from '../../shell/Icon'
import { colour, hue, label, type FamilyView, type Link } from './model'


export function FamilyCard({ F, fv, sel, playing, onPlay, onSet, onOut, onConfirmAll, onQueue }: {
  F: Families; fv: FamilyView; sel: string; playing: string | null
  onPlay: (id: string) => void; onSet: (x: string, y: string, k: Link | null) => void; onOut: (id: string) => void
  onConfirmAll: (id: string) => void; onQueue: (ids: string[]) => void
}) {
  const f = fv.family(sel), it = F.items[sel], dot = (id: string) => colour(hue(fv.family(id).id)), name = (id: string) => label(id, F.items[id])
  const sure = f.members.slice(1).filter(m => fv.relation(m, f.root)).length
  const close = fv.guesses(f.id), elsewhere = fv.guessesFor(sel)
  const shown = new Set([...f.members, ...close.map(g => g.id)])
  const best = it.nearest.filter(o => F.items[o] && !shown.has(o)).slice(0, 4)
  return (
    <div className="fa-fam">
      <div className="lbl">{f.members.length > 1 ? `its scene · ${f.members.length} songs · ${sure} confirmed` : 'on its own'}</div>
      {f.members.length > 1 && (
        <>
          <div className="fa-list">
            {f.members.map(x => {
              const rel = x === f.root ? null : fv.relation(x, f.root)
              return (
                <div key={x} className={`fa-li ${x === f.root ? 'root' : ''} ${x === sel ? 'sel' : ''} ${x === playing ? 'now' : ''} ${x !== f.root && !rel ? 'guess' : ''}`}>
                  {x === f.root ? <span className="hub" style={{ color: dot(x) }} title="The family's root: every member is linked to it"><Icon name="root" /></span>
                    : <span className="dot" style={{ background: dot(x) }} />}
                  <button className="lnk" title="Hear it" onClick={() => onPlay(x)}>{name(x)}</button>
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
            {sure < f.members.length - 1 && <button className="btn" title="Confirm all: every member belongs, as the sort put them (a link vote each)" onClick={() => onConfirmAll(sel)}>Confirm all</button>}
            <button className="btn" title="Play the scene as a queue: each member in turn, Stay bars each, to hear whether they match" onClick={() => onQueue(f.members)}>Play the scene as a queue</button>
          </div>
        </>
      )}
      {close.length > 0 && <>
        <div className="lbl near">close · {f.members.length > 1 ? 'they nearly belong in this scene' : 'they nearly go with it'}</div>
        {close.map(g => (
          <div key={g.id} className={`fa-li ${g.id === playing ? 'now' : ''}`}>
            <span className="dot" style={{ background: dot(g.id) }} />
            <button className="lnk" title="Hear it" onClick={() => onPlay(g.id)}>{name(g.id)}{fv.family(g.id).members.length > 1 ? <small> · in a family of {fv.family(g.id).members.length}</small> : null}</button>
            <span className="sc" title="How well it fits the scene (its average likeness with the scene's songs; a scene is 0.5 or more)">{g.worst.toFixed(2)}</span>
            <button className="addb" title={f.members.length > 1 ? 'Bring it into this scene' : 'Make these two a scene'} onClick={() => onSet(g.id, f.root, 'match')}>+</button>
            <button className="x" title="A bad match: never guessed for this family again" onClick={() => onSet(g.id, f.root, 'bad')}>✗</button>
          </div>
        ))}
      </>}
      {elsewhere.length > 0 && <>
        <div className="lbl near">it nearly belongs in another scene</div>
        {elsewhere.map(g => (
          <div key={g.family.id} className="fa-li">
            <span className="hub" style={{ color: colour(hue(g.family.id)) }}><Icon name="root" /></span>
            <button className="lnk" title="Hear that family's root" onClick={() => onPlay(g.family.root)}>{name(g.family.root)}<small> · a family of {g.family.members.length}</small></button>
            <span className="sc" title="How well it fits that scene">{g.worst.toFixed(2)}</span>
            <button className="addb" title="Move it into that scene" onClick={() => onSet(sel, g.family.root, 'match')}>+</button>
          </div>
        ))}
      </>}
      {best.length > 0 && <div className="lbl near">flows best with{f.members.length > 1 ? ', outside the scene' : ''}</div>}
      {best.map(o => (
        <div key={o} className={`fa-li ${o === playing ? 'now' : ''}`}>
          <span className="dot" style={{ background: dot(o) }} />
          <button className="lnk" title="Hear it" onClick={() => onPlay(o)}>{name(o)}{fv.family(o).members.length > 1 ? <small> · in a family of {fv.family(o).members.length}</small> : null}</button>
          <button className="addb" title="Bring it into this scene" onClick={() => onSet(o, f.root, 'match')}>+</button>
        </div>
      ))}
    </div>
  )
}

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { memo } from 'react'

export type SongData = { label: string; hue: number; kind: string; playing: boolean; dim: boolean; unsure: boolean; novel: boolean; bad: boolean }
export type SongNodeType = Node<SongData, 'song'>

/** A song: a dot in its family's colour (a new take ringed, a new family starred), its name beside it; drag from it to
 * another song to say they match. */
function SongNode({ data, selected }: NodeProps<SongNodeType>) {
  const c = `hsl(${data.hue} 70% 62%)`
  return (
    <div className={`song ${selected ? 'sel' : ''} ${data.playing ? 'playing' : ''} ${data.dim ? 'dim' : ''} ${data.bad ? 'badtake' : ''}`} title={data.label}>
      <Handle type="target" position={Position.Left} className="h" />
      <span className={`dot ${data.kind !== 'shipped' ? 'new' : ''}`} style={{ background: c, borderColor: c }}>{data.novel ? '★' : ''}</span>
      <span className="nm">{data.label}</span>
      {data.unsure && <span className="unsure" title="The sort isn't sure where this one belongs">?</span>}
      <Handle type="source" position={Position.Right} className="h" />
    </div>
  )
}
export default memo(SongNode)

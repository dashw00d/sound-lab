import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { memo } from 'react'
import { colour } from './model'

export type SongData = { label: string; hue: number; kind: string; playing: boolean; dim: boolean; unsure: boolean; novel: boolean; bad: boolean; root: boolean }
export type SongNodeType = Node<SongData, 'song'>

/** A song: a dot in its family's colour (a new take ringed, a new family starred, a family's root bigger), its name
 * beside it; drag from it to another song to bring it into that song's family. */
function SongNode({ data, selected }: NodeProps<SongNodeType>) {
  const c = colour(data.hue)
  return (
    <div className={`song ${data.root ? 'root' : ''} ${selected ? 'sel' : ''} ${data.playing ? 'playing' : ''} ${data.dim ? 'dim' : ''} ${data.bad ? 'badtake' : ''}`} title={data.label}>
      <Handle type="target" position={Position.Left} className="h" />
      <span className={`dot ${data.kind !== 'shipped' ? 'new' : ''}`} style={{ background: c, borderColor: c }}>{data.novel ? '★' : ''}</span>
      <span className="nm">{data.label}</span>
      {data.unsure && <span className="unsure" title="The sort isn't sure where this one belongs">?</span>}
      <Handle type="source" position={Position.Right} className="h" />
      {/* (the links' own ends, at the dot's centre, so a family reads as a star) */}
      <Handle type="source" id="c" position={Position.Left} className="hc" isConnectable={false} />
      <Handle type="target" id="c" position={Position.Left} className="hc" isConnectable={false} />
    </div>
  )
}
export default memo(SongNode)

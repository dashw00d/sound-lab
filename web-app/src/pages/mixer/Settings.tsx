// The walk's own settings (data/mixer.json): what it draws from, its order, the taste bar it waits for, how songs vary,
// and the glue between them; and the two listening tools (training, the review of low-rated blocks). Stay, the joins,
// the levels, the bed and what intense is are for everything the player plays: in the header.
import { CAND_TOP, WEAK } from '../../mixer/judge'
import type { Mixer } from '../../mixer/engine/mixer'
import type { Prefs } from '../../mixer/prefs'
import { Icon } from '../../shell/Icon'
import { Field, Toggle } from '../../ui/Field'
import { Seg } from '../../ui/Seg'

export function Settings({ m, reviewOpen, onReview }: { m: Mixer; reviewOpen: boolean; onReview: () => void }) {
  const p = m.prefs, set = (x: Partial<Prefs>) => m.setPrefs(x), lib = m.lib, n = lib.candidates?.length ?? 0
  const hasStems = lib.tracks.some(t => t.stems), hasFills = lib.tracks.some(t => t.fills && Object.keys(t.fills).length)
  const vary = (k: keyof Prefs['vary'], label: string, tip: string, made: boolean) =>
    <Toggle on={p.vary[k]} label={label} disabled={!made} tip={made ? tip : `${tip}: none made yet`} onChange={on => set({ vary: { ...p.vary, [k]: on } })} />
  const bars = (k: number) => `${k} bar${k > 1 ? 's' : ''}`
  return (
    <div className="mx-settings">
      <div className="mx-group">
        <div className="mx-gh">The walk <span className="dim">· Stay, joins and levels are in the header, for everything played</span></div>
        <Field label="Draw from">
          <Seg value={p.scope} onChange={scope => set({ scope })} options={[
            { value: 'set', label: 'the set', tip: 'The parts of the set below' },
            { value: 'all', label: 'everything', tip: 'Every song in the library, entering at its phrase starts inside its mellow cues (mellows you thumbed down left out)' },
            { value: 'graph', label: 'the graph', tip: 'Scenes (music families): a scene for a while, cutting from song to song inside it, then a rest and the next scene, from chill to less chill and back in waves' }]} />
        </Field>
        {p.scope === 'graph' && <>
          <Field label="Scene">
            <Seg value={p.sceneBars} onChange={sceneBars => set({ sceneBars })} options={[24, 48, 96].map(k => ({ value: k, label: `${k} bars`, tip: `About ${Math.round(k * 4 * 60 / m.lib.bpm / 6) / 10} minutes in one scene, then a rest and the next` }))} />
          </Field>
          <Field label="Wave">
            <Seg value={p.wave} onChange={wave => set({ wave })} options={[4, 8, 16].map(k => ({ value: k, label: `${k} min`, tip: `From chill to less chill and back in ${k} minutes` }))} />
          </Field>
        </>}
        {n > 0 && (
          <Field label="New takes">
            <Seg value={p.cands} onChange={cands => set(p.scope === 'set' && cands !== 'off' ? { cands, scope: 'all' } : { cands })} options={[
              { value: 'off', label: 'off', tip: 'Only the shipped songs' },
              { value: 'top', label: `best ${CAND_TOP}`, tip: `The ${CAND_TOP} best new takes (music candidates) join the walk (everything, or the graph's scenes) and training` },
              { value: 'all', label: `all ${n}`, tip: 'Every scored new take joins the walk (everything, or the graph\'s scenes) and training' }]} />
          </Field>
        )}
        {p.scope !== 'graph' && <>  {/* (how the walk picks its next part: the graph takes its scenes' cuts instead) */}
        <Field label="Order">
          <Seg value={p.mode} onChange={mode => set({ mode })} options={[
            { value: 'any', label: 'any order', tip: 'A random part each time, never the one just heard: as the game would' },
            { value: 'order', label: 'in order', tip: "The set's order, round and round (O)" }]} />
        </Field>
        <Field label="Taste bar">
          <Seg value={p.strict} onChange={strict => set({ strict })} options={[0.5, 0.7, 0.8, 0.9].map(v => ({
            value: v, label: `${Math.round(100 * v)}%`,
            tip: v === 0.5 ? 'Anything the model puts at 50% or more (you liked about 60% of those)'
              : `Wait for a transition the model puts at ${Math.round(100 * v)}% or more; settle for 50% only when it must${v === 0.8 ? ' (you liked 89% of those at 80%)' : ''}` }))} />
        </Field>
        </>}
        <Field label="Variation">
          {vary('siblings', 'Siblings', 'A phrase may go on in a sibling: the same take made for another context, in step bar for bar but its own recording, in that context\'s mode and mood', true)}
          {vary('stems', 'Stems', 'A phrase may drop the drums or thin to the melody and harmony: the song\'s own stems (music stems)', hasStems)}
          {vary('fills', 'Fills', "Round the loop, a fill SA3 wrote for that song's loop point (music fills)", hasFills)}
        </Field>
        {p.scope === 'graph' ? (
          <Field label="Between scenes">
            <Seg value={p.glue === 'off' ? 'off' : p.glueKind} onChange={v => set(v === 'off' ? { glue: 'off' } : { glue: p.glue === 'off' ? 'breaths' : p.glue, glueKind: v })} options={[
              { value: 'off', label: 'straight on', tip: "The next scene's first song comes straight in, crossing over as any song change" },
              { value: 'pad', label: 'pad', tip: "The song going out's glue: a pad frozen from its own steadiest bar, then the next scene" },
              { value: 'rest', label: 'rest', tip: 'The song tapers or rings into silence, then the next scene comes in' }]} />
            {p.glue !== 'off' && <Seg value={p.glueBars} onChange={glueBars => set({ glueBars })} options={[1, 2, 4].map(k => ({
              value: k, label: bars(k), tip: `${bars(k)} of ${p.glueKind === 'rest' ? 'silence' : 'pad'} between scenes` }))} />}
            {p.glue !== 'off' && p.glueKind === 'rest' && <Seg value={p.tail} onChange={tail => set({ tail })} options={[
              { value: 'taper', label: 'taper', tip: 'Into the rest, the song tapers over its last bar' },
              { value: 'ring', label: 'ring out', tip: 'The song plays to the bar line at its own level, then its next downbeat rings out and dies away (its own audio, as it would go on)' },
              { value: 'echo', label: 'echo out', tip: 'The song stops on the bar line and its last beat echoes on in time, darker each repeat, into the silence' }]} />}
          </Field>
        ) : (
        <Field label="Glue">
          <Seg value={p.glue} onChange={glue => set({ glue })} options={[
            { value: 'off', label: 'off', tip: 'Runs go straight into each other, even where nothing joins well' },
            { value: 'weak', label: 'weak joins', tip: `Through the glue where no part joins well (${WEAK}) within 8 bars of Stay` },
            { value: 'breaths', label: 'breaths', tip: 'That, and a breath of glue every 2 to 4 runs' }]} />
          <Seg value={p.glueKind} onChange={glueKind => set({ glueKind })} options={[
            { value: 'rest', label: 'rest', tip: 'The song tapers over its last bar into silence (the bed too), then the next comes in' },
            { value: 'pad', label: 'pad', tip: "The song's glue: a pad frozen from its own steadiest bar" }]} />
          <Seg value={p.glueBars} onChange={glueBars => set({ glueBars })} options={[1, 2, 4].map(k => ({
            value: k, label: bars(k), tip: `${bars(k)} of ${p.glueKind === 'rest' ? 'silence' : 'pad'}` }))} />
          {p.glueKind === 'rest' && <Seg value={p.tail} onChange={tail => set({ tail })} options={[
            { value: 'taper', label: 'taper', tip: 'Into the rest, the song tapers over its last bar' },
            { value: 'ring', label: 'ring out', tip: "The song plays to the bar line at its own level, then its next downbeat rings out and dies away (its own audio, as it would go on)" },
            { value: 'echo', label: 'echo out', tip: 'The song stops on the bar line and its last beat echoes on in time, darker each repeat, into the silence' }]} />}
        </Field>
        )}
      </div>

      <div className="mx-group">
        <div className="mx-gh">Listen</div>
        <Field label="Training">
          <button className={`btn ${m.train.on ? 'on' : ''}`} onClick={() => m.trainToggle()} title="Rate transitions one after another, one key each: the ones a vote teaches the most (T)">
            <Icon name="up" /><span>Train transitions</span><kbd>T</kbd>
          </button>
        </Field>
        <Field label="Review">
          <button className={`btn ${reviewOpen ? 'on' : ''}`} onClick={onReview} title="The blocks you rated 1 or 2 stars, played again so you can mark the piece that spoiled each">
            <Icon name="flag" /><span>Low-rated blocks</span>
          </button>
        </Field>
      </div>
    </div>
  )
}

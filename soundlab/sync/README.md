# Music from Sound Lab

This folder is made by Sound Lab for **{{project}}**. It holds the music the lab's Mixer plays, and everything a game needs to play it the same way, in any engine. Sound Lab writes it with `soundlab sync`, so don't edit it here: the next sync writes it again. Nothing else in the game is touched.

This sync: **{{songs}} songs** in **{{scenes}} scenes**, with **{{cuts}} seamless cuts** between them.

## What's here

| file | what it is |
|---|---|
| `soundlab.json` | the manifest: the grid, how to play, each song's audio and levels, and the music graph |
| `soundlab.schema.json` | the manifest's JSON Schema ({{format}}) |
| `walk.js`, `walk.d.ts` | the walk: which song plays next, and from which bar. Plain JavaScript with no dependencies, and the same code the lab's Mixer runs |
| `music/<song>.mellow.ogg`, `music/<song>.intense.ogg` | each song's two levels: the same length, on the same grid, sample-aligned |
| `stingers/<take>.ogg` | short accents for a scene change: risers, booms, crashes |

## How the music works

Every song is a {{bars}}-bar loop on one grid: {{bpm}} BPM, {{beats}} beats a bar, {{bar}} s a bar. Each song comes in two levels, **mellow** (calm) and **intense** ({{intense}}), which play together; the game's state decides which one is heard.

Songs that could pass as sections of one long piece form a **scene**. Inside a scene, songs **cut** into each other seamlessly: after song A's bar e, song B from its bar s. The walk plays a scene for about {{scene_bars}} bars, moving from song to song at those cuts. Each song plays at least {{stay}} bars (or one pass of its loop, if that's shorter) and never goes round its loop twice. Then the next scene: {{between_words}}. The scenes follow a slow wave of energy, from chill to less chill and back over {{wave_bars}} bars, and the walk prefers what it has heard least.

The game decides two things: when music plays (the walk never ends), and whether it's mellow or intense, which can change at any moment.

## Plugging it in

1. Load `soundlab.json`.
2. Make a walk: `const walk = fromManifest(manifest)` (from `walk.js`). In another language, port `walk.js` (see "The walk" below; it's under 200 lines).
3. Keep a few seconds of music scheduled ahead on your audio clock. Whenever less than about 6 s is scheduled, take `walk.next()` and put it on the grid right after what's already scheduled:
   - `{ kind: "part", song, bar, bars, visit, first }`: play `bars` bars of `song`, starting at its bar `bar`. Bars are 1-based, so bar b starts at (b − 1) × `grid.barSeconds` into the file. Play both levels at once, with the current state's level audible.
   - `{ kind: "rest", bars }`: silence for `bars` bars.
4. Join each step to the one before as described below.
5. Store `walk.memory()` in the save and pass it back next session (`fromManifest(manifest, { memory })`), so the music stays fresh from one session to the next.

```js
import { fromManifest } from "./walk.js"

const m = await (await fetch("soundlab/soundlab.json")).json()
const walk = fromManifest(m, { memory: save.music })
const barS = m.grid.barSeconds
let at = clock() + 0.1                  // when the next step starts, on the audio clock

function pump() {                        // call it a few times a second
  while (at - clock() < 6) {
    const step = walk.next()
    if (step.kind === "part") playStep(at, step)   // both levels of step.song from step.bar, joined to what came before
    else rest(at, step)
    at += step.bars * barS
  }
}
```

## Joining steps

Steps meet on the bar line. How they join depends on what changes.

**The same song** (the same `visit.id`): the song goes on. If the next step's bar follows on (the last step's `bar + bars`), keep the file playing. If it jumps (round its loop, from the loop's end back to its start), crossfade linearly over `play.step.seconds`, centred on the bar line.

**A new song** (a new `visit.id`): crossfade equal-power over `play.join.seconds` ({{join}} s), centred on the bar line. Start the incoming song half the crossfade early, from just before its bar; the outgoing one runs half the crossfade past its last bar. Both are just more of each file.

- **Levels.** Play each song at its `songs[id].gainDb` for the state; the gains even the library out. With `play.matchLevels.on`, an incoming song starts at the level of the one going out: its first beat's `loudness` against the outgoing song's last beat's, each plus its gain, within ±6 dB. It then eases to its own gain over 2 bars. `loudness` holds one value per beat, in dB.
- **Bass swap** (now {{swap}}). When it's on, only what's above `play.bassSwap.hz` crosses over. Below it, the outgoing song keeps the low end until the bar line, and the incoming one takes it there. Split each song with a low-pass at that frequency to do this.

**Between scenes**, by `play.betweenScenes` (now {{between}}). The walk marks a scene change with a `rest` step; what it means depends on this:

- `straight`: no break. Take the next step at once, at the same time, and join it as a new song.
- `pad`: the outgoing song's pad (`songs[id].glue`, a sustained chord frozen from its own audio) fills the rest's bars. It rises equal-power over the bar before the rest while the song fades out over that bar, then falls over the next song's first bar while that song comes in. A song with no pad rests instead.
- `rest`: silence for the rest's bars, as below.

**Into a rest**, by `play.rest.tail` (now {{tail}}):

- `taper`: the song fades over its last bar, along gain × 10^(−2.4 k²) for k from 0 to 1. That's −12 dB halfway and −48 dB at the bar line.
- `ring`: full level to the bar line, then the file runs on and fades at a steady rate, −48 dB over 0.66 s.
- `echo`: the song stops on the bar line, and its last beat repeats in time: a 1-beat delay, feedback 0.42, low-passed at 3.2 kHz, mixed in at 0.75. It dies away by itself.

**Out of a rest**, the next song starts on its bar line with an 80 ms fade-in.

**Stingers** mark a scene change, the step after a rest (now: riser {{riser}}, boom {{boom}}, crash {{crash}}). For each kind that's on in `play.stingers`, play one of `stingers[kind]` at `play.stingers.db` dB, in either state. Pick a different file from last time.

- `riser`: it builds over the rest and must **end** exactly on the next step's first downbeat, so start it at that time minus its length. If the rest is shorter than the riser, it starts over the end of the song before.
- `boom`, `crash`: start exactly on that downbeat.

## Mellow and intense

A song's two levels always play together, sample-aligned. To change state, crossfade them equal-power over `play.stateChange.beats` beats. It can happen at any moment, not just on a bar line.

## The walk

`walk.js` is the reference. For a port, this is everything it does.

**State:** the visit playing (its song, entry bar, loop `lo`–`hi`, the next bar, bars played, its last bar), a pending entry, the scene (its id, bars played in it, songs it has played), total bars walked, bars heard of each song, and the scenes played lately.

**Target energy** after b bars walked: `lo + (hi − lo) × (0.5 − 0.5 cos(2π b / play.waveBars))`. Here `lo` and `hi` are the songs' energies at the 10th and 90th percentiles (sorted ascending, taking indices floor(n × 0.1) and floor(n × 0.9)).

**`next()`:**

1. With no visit, start the pending entry if there is one, or else enter a new scene (below). A song's visit loops between `min(loop[0], entry)` and `min(bars, max(loop[1], entry + 3))`.
2. Note the song as played in the scene. Then work out:
   - loopLen = hi − lo + 1
   - stay = min(`play.stay`, loopLen)
   - most = max(stay, min(stay + 4, loopLen))
3. If the scene has had `play.sceneBars` bars or more, the scene ends once two things hold:
   - the song has played at least min(stay, 4) bars;
   - it's at a phrase end, or the scene has had sceneBars + 8 bars, or the song has played `most` bars.

   When the scene ends, return `{ kind: "rest", bars: play.restBars }`. The next call enters a new scene.
4. Otherwise, once the song has played `stay` bars, look for a cut after its last bar (`walk.cuts[song]` entries with `after` equal to that bar) into a song the scene hasn't played yet. Choose the lowest cost = |energy − target| + 0.05 ln(1 + heard) + 0.1 r. If one is found, start its visit at the cut's `start` and go back to step 2. If not, and the song is at a phrase end or has played `most` bars, move to another member of the scene (pick member, below) from its entry.
5. If the next bar is past `hi`, go back to `lo`.
6. Play the next bars:
   - while played < stay: min(4 − played mod 4, stay − played, hi − bar + 1) bars;
   - after that, 1 bar at a time, so the visit can leave at any bar that cuts well.

   Then advance the visit and add the bars to the scene, the walk and the song's heard count.

**Phrase end:** (last bar − `phrase`) mod 4 = 3. For a song with no `phrase`, the test is bars played mod 4 = 0.

**Entering a scene:** take the scenes with members, leaving out the last `play.avoid` scenes and the current one (unless nothing else is left). The cost of a scene is |mean energy of its members − target| + 0.02 ln(1 + mean heard) + 0.15 r. Take one of the three cheapest at random. Its first song is chosen by pick member.

**Pick member:** take the members the scene hasn't played (or all of them, if it has played them all), other than the song playing. Choose the lowest cost = |energy − target| + 0.05 ln(1 + heard) + 0.1 r.

**r** is a random number in [0, 1): `Math.random` by default. `seeded(seed)` in `walk.js` (mulberry32) gives the same walk every time for the same seed, if the port draws in the same order as `walk.js`.

**Also there:**

- `walk.skip()` moves on to a new scene now.
- `walk.hurry()` ends the song playing at its next chance.
- `walk.state()` gives the scene, the target energy and the song's energy.
- `walk.cutsFrom(song)` lists the songs a visit may cut into, so you can load them ahead.

## The manifest

| field | what it is |
|---|---|
| `grid` | `bpm`, `beatsPerBar`, `barSeconds`, `bars` (each file's length in bars) |
| `states` | the level each state plays: `mellow` (calm) and `intense` |
| `play` | how to play: `stay`, `sceneBars`, `waveBars`, `restBars` and `avoid` for the walk; `join`, `step` and `stateChange` crossfades; `matchLevels`; `bassSwap`; `rest.tail`; `stingers` (which kinds play at a scene change, and their level) |
| `stingers` | the stinger files of each kind (`riser`, `boom`, `crash`), relative to this folder |
| `songs[id].glue` | the song's pad for a scene change (`glues/<id>.ogg`), or null |
| `songs[id]` | `files` (each state's audio, relative to this folder); `gainDb` (each state's level trim); `loudness` (each state's per-beat loudness, dB); `scene`; `lead` (its lead instrument); `context` |
| `walk` | what `walk.js` walks: `bars`; `songs[id]` with `loop` [first bar, last bar], `entry`, `phrase` (the bar its 4-bar phrases start on, or null) and `energy`; `scenes[id].members`; `cuts[id]` as a list of `{ to, after, start }` |

## Engines

Any engine works if it can start an audio file at a time on its audio clock, from an offset into the file, and fade its volume.

- **Web:** Web Audio's `AudioBufferSourceNode.start(when, offset)` with a `GainNode` per voice; `walk.js` runs as it is.
- **Unity:** `AudioSource.PlayScheduled` on `AudioSettings.dspTime`, one source per level and voice; port the walk to C#.
- **Godot:** start each voice from its offset (`AudioStreamPlayer.play(from_position)`), and time it with `AudioServer.get_time_to_next_mix()`. Sound Lab's repo has a Godot 4 reference in `examples/godot`: the walk ported to GDScript (`soundlab_walk.gd`, which walks exactly the steps `walk.js` walks for the same seed) and a player node (`soundlab_music.gd`) that follows these rules.
- **FMOD, Wwise:** programmer instruments or scheduled sounds, with the walk in the game's code.

A song coming in overlaps the one going out, so allow two songs at once, each with both levels.

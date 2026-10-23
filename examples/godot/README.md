# Sound Lab music in Godot 4: a reference

A Godot 4 project that plays a Sound Lab sync folder (the folder `soundlab sync` and `soundlab ship` write into a game, see `soundlab/sync/README.md`) the way the lab's Mixer plays it. It's a reference to read and copy from, not an engine plugin: your game already has its own music code, and this shows what the folder means in Godot terms.

| file | what it is |
|---|---|
| `soundlab/soundlab_walk.gd` | the scene walk: a line-for-line port of the folder's `walk.js` (made from the lab's `web-app/src/mixer/engine/scenewalk.ts`). With the same seed it walks exactly the same steps |
| `soundlab/soundlab_music.gd` | `SoundLabMusic`, a node that plays the walk: each song's mellow and intense layers together, the joins, scene changes and rests, and evened and matched levels |
| `main.tscn`, `main.gd` | the demo: Space plays and stops, I switches between mellow and intense, N moves on to the next scene |
| `test_walk.gd` | prints a seeded walk's steps, to compare with `walk.js` |
| `test_player.gd` | runs the player headless for a while and prints each step as it starts |

## Running the demo

1. Put a synced folder at `examples/godot/soundlab/`, next to the scripts. Either point a project's `sync` at it, or copy the game's folder in. The synced files are gitignored here.
2. Open the project in Godot 4.3 or later and run it. Or set `folder` on the `Music` node to an absolute path, such as your game's `soundlab` folder.

## In your game

1. Copy `soundlab_walk.gd` and `soundlab_music.gd` into your project.
2. Add a `SoundLabMusic` node and set `folder` to the synced folder (`res://soundlab`).
3. Call `play()`, and `set_intense(true / false)` as the game's state changes. Use `walk.skip()` to move on to a new scene now, or `walk.hurry()` to end the song playing at its next chance.
4. Keep `memory()` in the save, and pass it back with `walk.remember(...)`, so the music stays fresh across sessions.
5. Listen to `step_started` for each step as it starts, for example to show what's playing.

Your game's own steering can drive the walk instead: pick `walk.next_step()` yourself, or pass the walk a different target energy by changing `play.waveBars`. The joins are in `_schedule()`.

## How it times things

Godot can't start a sound at a future moment. So each voice starts in the frame its time falls inside the next audio mix, from the file position it should have reached by then (`AudioServer.get_time_to_next_mix()`). A song's two layers start in the same frame, from the same position, so they stay together. Songs stay in step to within one mix. Fades are set every frame, and Godot smooths volume changes across a mix. For sample-exact starts you'd mix in an `AudioStreamGenerator` or a GDExtension.

Two things the reference leaves out:

- **The bass swap.** It needs each song split at `play.bassSwap.hz` onto two buses: a low-pass and a high-pass `AudioEffectFilter`.
- **The echo tail.** It needs an `AudioEffectDelay` on a bus. Here, `echo` plays as `ring`.

## Keeping the port honest

`soundlab_walk.gd` has to make the choices `walk.js` makes. When `scenewalk.ts` changes, change the port too, then compare the two on a synced folder:

```sh
godot --headless --path examples/godot --script res://test_walk.gd -- /path/to/soundlab/soundlab.json 7 600 | grep '^\[' > gd.txt
node examples/godot/walktest.mjs /path/to/soundlab 7 600 > js.txt
cmp gd.txt js.txt
```

On 2026-10-21, on a 138-song folder (27 scenes, 1,798 cuts), seeds 7, 42 and 2026 walked 600 identical steps each. On 2026-10-23, with liked cuts and bridges (scene changes and moves with no cut), on a 114-song folder (26 scenes, 923 cuts, 2,814 bridges), seeds 7, 42 and 2026 walked 600 identical steps each again.

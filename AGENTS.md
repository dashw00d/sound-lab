# Sound Lab: instructions for agents

You make game audio with local models: Stable Audio 3 Medium (SA3) by default, and `tuning.json` says which model makes what. The user listens and decides in the web app; you generate, organise and ship. You can't hear, so never claim a take sounds good. Report what you measured (silence, loudness, tempo, beat lock) and let the user's votes decide.

## Setup and health

- Install: `./install.sh` (Linux) or `install.cmd` (Windows). It's idempotent. `--hf-home PATH` reuses an existing model cache.
- Check: `./soundlab.sh doctor`, or `doctor --generate` to also make one second of real audio. Fix anything marked `!!` before generating.
- Every command takes `--project PATH`: a game folder containing `soundlab_project.py`, or the file itself. `SOUNDLAB_PROJECT` sets a default.
- Start with `./soundlab.sh --project P status` (or `status --json`). It lists the sounds, takes, decisions, the user's notes, alert sets, music sets, what has shipped and which model makes what.
- Before writing any prompt, run `./soundlab.sh --project P tuning --task T` and start from it (see "Prompt tuning: start here").

## Commands

| command | does | time |
|---|---|---|
| `tuning [--task T] [--json]` | the prompt tuning for the model each task uses, with this project's evidence: read it before writing prompts | – |
| `serve [--port 7870]` | the web app (run it in the background; it reads files on every request, and the open page offers new takes as they're generated) | – |
| `sounds generate [--seeds N] [--only NAME..] [--variants V..]` | takes for every (or some) sound, prompt variant and seed; existing takes are skipped | ~0.7 s per take |
| `sounds promote [--apply] [--only NAME..]` | ship the picks into the game (dry run without `--apply`) | seconds |
| `alerts build` | the alert family: kits (cached) composed into every alert, one row per kit | ~1 min first time |
| `music audition [--seeds 4]` | solo takes of every candidate instrument | ~1 min |
| `music generate --contexts C.. [--biomes B..] [--styles S..] [--profiles P..] [--takes 3] [--tries 14] [--same-round]` | a new batch of music takes per set (each take: a spine plus derived levels on one beat grid); `--takes` is the batch size, `--styles` makes a set per prompt style for a tuning round, `--profiles` limits the derived-level profiles, `--same-round` adds the run's takes to the newest round (one batch made in several runs, e.g. other styles for other contexts) | 1–3 min per set |
| `music derive --profiles P.. [--sets KEY.. \| --liked] [--no-new-layers]` | add profiles (audio-to-audio strengths) to existing takes, from each take's saved spine: the newest batch's takes by default (all of a set's takes with `--sets`, every take liked at that profile with `--liked`); a profile a take has gets only the levels it lacks (a level added to the project later); existing levels and votes stay. `--no-new-layers` leaves out a layer a take has no stem for instead of generating it (then no generator is loaded) | ~10 s per level; seconds per mixed level |
| `music check [--sets KEY..]` | measure every level for what sounds off (soundlab/quality.py: Audiobox Aesthetics ratings, pauses, drift, noise) and flag it on the Music page | ~1 s per file |
| `music trims [--force]` | measure every shipped track for the Songs page (work/songs.json): per-bar loudness of its calm and battle levels, guessed cues (the loop between them leaves out SA3's crescendo), and families (siblings: one style and take made for other contexts, in step bar for bar, which the page switches between at the same bar or plays as a medley); only changed files are measured again | ~1 s per track |
| `music glues [--force]` | a glue per family of shipped tracks (and per song without siblings), for the Mixer: the family's steadiest quiet bar on the home chord, frozen into a sustained pad of its own sound (work/clips/glues, work/glues.json); after `music trims` | ~1 s per glue |
| `music stems [--force]` | Demucs stems of every shipped track (calm: drums, bass, the rest; battle: drums), for the Mixer's variation over repeats (work/clips/stems, work/stems.json) | ~5 s per track |
| `music fills [--seeds 4] [--bars 1] [--only ID..]` | SA3 inpaints fills at each shipped track's mellow loop point (its end cue back into its start cue, the user's cue or the guess); a take is kept when it holds the grid, rates at least the calm gate and matches the loudness around it (work/clips/fills, work/fills.json); takes already made stay | ~2 s per take |
| `music joins [--fit]` | the user's thumbs on Mixer transitions against the join score the player used; with `--fit`, a model of their taste learned from those votes (work/join_model.json: features in music.py `join_features`, mirrored in mixer.js `taste()`; reports how often it's right on votes it didn't see). The Mixer walks by it. Refit after a training session: disliked transitions that scored over the threshold (slipped through), liked ones under it, which piece of the score (harmony, timbre, loudness step) misses, and the threshold that best splits the votes. Read it after the user has voted on transitions, and log what it shows in MODELS_LOG | seconds |
| `music retune [--force]` | the tracks more than 6 cents off the common pitch (the median of `music trims`' tunings) retuned to it with rubberband (pitch only), with their stems, fills and glue, as copies under work/clips/tuned (the shipped files are never touched); the Mixer plays those. Run it again after new stems, fills or glues | ~20 s per track |
| `music trial [--takes 2] [--contexts C..] [--style drawn] [--pending]` | a mini trial for the Trial page: `--takes` per context (day, night, bloodmoon, winter) in a style that draws its words per take (`drawn`: the spine written fresh each take, the draw kept as take `words`), through the quality gate and the same-piece check, marked `trial`. The Trial page plays them one at a time, blind, and the designer answers "a new family" or "not new". `logs/trial_loop.sh` keeps one batch ahead of their answers (stop it with `work/<project>/trial.stop`); `--pending` counts the unanswered | ~5 min per trial |
| `music families` | every song (shipped, scored new takes, trial takes, extensions) sorted into families: songs that could pass as sections of one long piece, i.e. songs the walk could cut between mid-song as it swaps into a sibling. The splice score (the share of cuts from one into the other at their best bar offset where the bars either side are as alike as a natural bar step, within 3 dB); every pair in a family splices at 0.5 or more (complete linkage); siblings, extensions and the designer's "belongs" and "near duplicate" answers keep songs together, "bad match" keeps them apart, a "new family" stays its own. Guesses: songs that nearly splice with a family (their worst pair 0.35 or more). CLAP and bar likeness only place songs on the map and find near duplicates. Writes work/families.json with each song's family, confidence, nearest, splice scores and guesses, and the Families page's queue: new takes and extensions, the least sure placements, the most alike pairs. `logs/family_loop.sh` runs it after every batch and when the designer has answered | ~30 s (CLAP cached) |
| `music grow [SET.TAKE] [--n 4]` | seamless extensions of a take answered "a new family": SA3 inpaints 16 new bars between the seed's last 4 bars and its first 4, so seed → extension → seed joins by construction; each extension draws one slot of the seed's words anew (none, melody, the strings' part, lead) and uses the seed's layers; kept when on the grid, within 2.5 dB of the seed, no click at a seam, not the same piece, and through the gate. A new take `<seed>g<j>` in the seed's set (`grow`: of, change), on the Trial page framed by the seed's tail and head. The trial loop grows the yeses before making new trials | ~1 min per extension |
| `music candidates [--all] [--cpu]` | score the newest round's takes (every round's with `--all`) before the user hears them, by what their shipped songs say makes a song good: plays nice (the taste model's 80%+ transitions with the shipped songs, audio features only) and unique (unlike the shipped songs and the takes ranked above it: bar fingerprints and CLAP; the weaker of the two counts most), with its nearest shipped song and the takes that are probably the same piece; `--catchy W` adds catchiness (Basic Pitch notes; 0 by default); work/candidates.json, shown on the Music page as "Best first" and each take's rank, and the Mixer's "best 50". Report the ranks as measurements, not as a verdict. `--cpu` splits stems on the CPU while a generator holds the GPU | ~10 s per take |
| `music promote [--apply]` | ship the liked music takes as tracks and write the game's music manifest | seconds |
| `balance measure` | measure every shipped sound for the Balance page | ~1 min |

Run long jobs in the background, with output to a log. Only one generator at a time: the model needs about 12 GB of VRAM and two copies don't fit.

**Generate generously.** Generation is local and free, and the user prefers many options to a careful few. When a sound needs work, add several new prompt ideas to `prompts.json`, written from the tuning, and 6 or more seeds each. More `--seeds` only adds takes, and the takes already voted on stay as they are.

## The user's decisions (data/votes.json)

The project's `data` folder (tracked in the game's repo) holds:

- **votes.json**:
  - `clips`: `{take id: 1 | -1}`, thumbs up or down.
  - `picks`: `{sound: take id | "shipped"}`; `"shipped"` means keep the current file.
  - `prompt_notes`: `{sound: {variant: {text, prompt, at}}}`, the user's note on one prompt's takes, with the prompt text it was written about and the date. This is the main kind of note.
  - `notes`: `{sound: text}`, a note on the whole sound (and `mesh_<set>` for a music set).
  - `song_<track>.mellow` and `song_<track>.intense` in `clips`: the Songs page's thumbs on a shipped music track's two states (mellow = its calm level, intense = its battle or action level), from 2026-10-20. The designer is choosing the best mellows this way; they don't (yet) change what ships.
  - `join_<track>@<bar>><track>|<start>` in `clips`: the user's thumbs on a Mixer transition (that bar of a song into that part); the walk never takes a disliked one and takes a liked one three times as often (even under the join threshold).
  - `fill_<file>` and `glue_<id>` in `clips` (-1): a generated fill or a glue the user disliked in the Mixer; the player never plays it again.
  - From the Families page (2026-10-21; a family = songs that could pass as sections of one long piece): `ok_<id>` 1 good / -1 a bad take (on a shipped song: out of the walk, never out of the game); `link_<id>|<member>` 1 belongs with that member's family / -1 good but a bad match; `dup_<id>|<member>` 1 a near duplicate of it; `novel_<id>` 1 a new family (an index take writes `novel_<set>.<take>`). Ids are track ids (a new take's: the id `music promote` would give it).
  - `novel_<set>.<take>` in `clips`: the Trial page's answer on a trial take: 1 = good and could start a whole new family of songs (the designer is strict), -1 = not new (from 2026-10-21). With each take's drawn `words`, these are the samples the next draws should learn from.
  - `cues`: `{track: {mellow | intense: [start bar, end bar]}}`, the user's cues on the Songs page: the bars a shipped track's state loops between (1-based, of the 16), dragged on its timeline. Where a track has none, the page uses `music trims`' best guess. Like votes, never edit them yourself.
  - Notes are instructions: read them with `status` and act on them. A prompt note is about that prompt only, so don't carry it over to new variants: they start clean, and the user notes them if they miss too. `status` flags a prompt note whose prompt has changed since it was written. It may no longer apply, so weigh it, and ask if unsure. When the user resolves a note, it's gone: open notes are current.
- **prompts.json**: hand-written prompt variants, `{sound: {variant: prompt}}`.
- **mixes.json**: the Mixer page's saved sets, `{name: {parts: [{track, start, bars}], at}}`: parts of shipped tracks (bars `start` to `start + bars - 1` of the 16) that the user put together to play in any order. The user's work: never edit them yourself.
- **mixer.json**: the Mixer page's settings (draw from, stay, joins, glue, bed, taste bar, new takes, the working set...), so they're the same in any browser (from 2026-10-21; before, only the browser's storage held them). The user's: never change them yourself.
- **streams.json**: the Mixer's listening sessions, `{started: {at, settings, stream}}` (from 2026-10-21): what the walk played, in order, rated blind (the lane shows no names or scores). `stream` alternates a block (`part`: track, bars, variants; `glue`; `fill`) with its `stars` (1-5, or null when not rated) and a `transition` with its `like` (1, -1 or null; between two songs also its `join` vote key, which is written to votes.json too). The user's work: never edit it yourself. Their star scale: **5** sounds good and is completely unique; **4** sounds good but is common in the library; **3** sounds okay, only to sandwich two better tracks; **2** broken or scuffed, potential but unusable; **1** avoid anything similar. So 4 against 5 is about variety, not quality; 3 is filler; 2 is a defect to fix (a cut, a fill, a level), not taste; 1 is taste, and reaches beyond the block (keep its kind out of new rounds).
- **promoted.json**, **music_promoted.json**: provenance of everything shipped.

Rules:

- Never edit or delete the user's votes, picks or notes. Generators keep takes the user has voted on.
- Ship (`promote --apply`) only when the user asks. Run the dry run first and show what will change. Shipping overwrites the game's files: they're in the game's git, but say what you replaced.
- Instrument pool: an instrument is in when one of its audition takes is picked or it is net 👍, and out when net 👎. Each music take draws one instrument per role from the pool, seeded.
- Music shipping: liked takes (`mesh_<set>.<take>.<profile>` = 1) ship as tracks. A set with none liked ships its newest batch's takes not 👎, at the music's `default_profile` (older takes ship only when liked). With song groups (`music.groups`, Emberhold's since 2026-10-19), only liked takes ship, and the game's groups file (which group each track is in, and which groups each weather plays) is the user's, hand-edited: promote only adds new tracks to it at the default group. Never move a track between groups yourself.
- Music levels: the project's `music.spine` names the level every other level is made from (default: the middle one), so a level can be added later (Emberhold's fourth, `battle`, 2026-10-19). After adding one, `music derive --profiles P --liked` gives the liked takes the new level.
- Off-sounding music: `music generate` rejects a take a level of which Audiobox Aesthetics rates under `quality.GATE` (validated against the user's likes, see `quality.py`), and `music check` flags weak levels, long pauses, drift and noise. Report flags as measurements; the user's ears decide. Install the model's package with `uv pip install --python runtime/venv/bin/python audiobox_aesthetics` (without it the gate passes everything).
- Music layers: a derived level can't add intensity (audio-to-audio keeps the spine's density at any strength), so the project's `music.layers` are stems made from text (percussion: no pitch, so no clash), put on the grid, rotated so their bar accents meet the spine's, and mixed into levels by a profile's `layers` ({layer: {level: dB}}). Each take keeps its stems (the Music page plays one alone from its chip). `music derive --profiles P` adds a layered profile to takes already heard.
- Music prompt styles: the project's `music.styles` are alternative prompt functions. `music generate --styles S..` makes sets keyed `<context>[.<biome>]~<style>`, side by side with the plain sets on the Music page, and the tuning evidence counts votes by style. A style's takes ship only when liked; a context and biome with nothing liked in any style ships its plain set as before. Each `music generate` run is a round, and its takes are a batch: the user listens to all of them, votes, and talks it over with you, and the next run hides every one of them (voted on or not) and starts a fresh batch. The Music page shows only the newest round's takes; a set's older takes fold under "Earlier takes", and older sets under "Earlier rounds" (liked first). Nothing is deleted: every take keeps its `round`, its id (seeds, and so ids, continue past the highest the set has used, so a vote always stays with its audio) and its votes. `--takes` counts the new takes of that run.

## What we've learned: MODELS_LOG.md

`MODELS_LOG.md` is the dated record of what each model does and doesn't do, with how it was measured and how sure we are (solid, leaning, anecdote), including what didn't work. Read it before a new kind of round. Add to it whenever a round, a probe or a measurement teaches something: the finding, the evidence, the date, and the `tuning.json` rule id it became. Experiments outside the app (like `research/music_probe.py`) live in `research/`, with their raw results in `research/data/`. To see what a score is computed from, draw it: `runtime/venv/bin/python research/view.py --project P pair A B` (two songs on one bar grid at their best splice offset: spectrograms, loudness, cues, phrases, chroma, every cut against the natural step) or `... join KEY` (a voted transition as the player crosses it); it writes a PNG under work/<project>/views/ to look at. Then check what a picture suggests against the votes before acting on it.

## Prompt tuning: start here

`tuning.json`, at the root of this repo, says how to write prompts for each model, which model makes which task, and what the user likes. It's shared by every project: what a model can do, and the user's taste, carry over from game to game. The Tuning page edits it, and `soundlab/tuning.py` documents its shape. It replaces the prompt advice that used to live here.

- **Read it before writing or changing any prompt.** Run `./soundlab.sh --project P tuning --task T`, where T is `sfx`, `alerts`, `instruments` or `music`. It prints the model the task uses; that model's rules (pinned first), prompt shape and examples; the user's taste; and the evidence: what this project's picks and votes say. Treat it as the starting point. Write the first variants to its rules and shape, then vary from there.
- **The user's rules and taste are instructions** (`"by": "user"`, shown as "Yours"). Follow them, and never edit or remove them, exactly as with votes and notes. Your own rules (`"by": "agent"`) are hypotheses: put the evidence in `why` (numbers, take ids, the date) and revise them when the votes turn.
- **Keep it learning.** After the user votes on a round, read the evidence and record what it taught you as an agent rule, scoped to its `tasks`. Add good and bad examples, with their take ids, once a winner or a clear loser shows. Write to `tuning.json` directly, keeping its shape: the page reloads when the file changes, and it never overwrites your edit.
- **Prompt styles differ by model.** Each model has its own guide, and one model's style doesn't carry over to another. MOSS-SoundEffect, fed prompts written for SA3, won 1 of 7 sounds. To try a new model for a task, give it a guide, assign it the task, and start its rules from its own documentation and its first votes.
- **Which model makes what** is in `tasks`. SoundLab's generators run only Stable Audio 3 (`"engine": "sa3"`). A model with `"engine": "external"` makes its takes elsewhere, and they're imported into the index with their `model` field. The generators refuse a task assigned to a model they can't run, so check the assignment before you generate.

## The project file

`soundlab_project.py` in the game defines `project()`, which returns `soundlab.project.Project`. The required fields:

| field | what it is |
|---|---|
| `name` | the project's name |
| `root` | the game's folder |
| `work` | generated output: takes, the index, measurements (gitignored; e.g. the lab's `work/<project>`). Not a scratch folder that gets cleaned: unshipped takes and the index live only here |
| `data` | authored data (tracked) |
| `assets` | the game's audio root (served at `/shipped/`) |
| `sounds()` | returns `[Sound(name, kind "oneshot"/"loop", seconds, channels, prompt, out, core, palette, shipped)]` |

Optional hooks (the defaults are simple):

| hook | does | default |
|---|---|---|
| `master(sound, x)` → `(audio, info)` | master a take exactly as the game's shipped files are | -18 LUFS, -1 dBFS |
| `score(sound, x)` | a take's quality score; `None` for a silent take | silence check |
| `install(sound, src)` | ship a take | copy to `sound.out` |
| `after_install(paths)` | run after shipping, e.g. the engine's importer | none |
| `asset_uri(path)` | the name the game uses for a file, e.g. `res://...` | the path |

Optional sections turn pages on:

- **`alerts`**: a dict documented at the top of `soundlab/alerts.py`. It has two families: `recordings` (whole takes) and `earcon` (one instrument's notes retuned to a motif).
- **`music`**: a dict documented in `soundlab/music.py`. It covers the grid, levels, loudness, profiles, contexts and biomes, the instrument candidates and roles, a `prompts(context, mode, mood, names)` function, and where the manifest and files go. The game plays the manifest: a track per context and biome, each with one file per level, all on one grid.
- **`balance`**: a dict documented in `soundlab/balance.py`. It names the mix file and the folders holding sound files. Best is a sound table (the mix file at `"version": 2`: every level the game applies, which the game reads and the page edits, so the page shows exactly what the game plays; Emberhold's `assets/audio/mix.json` and `tools/audio/README.md` "The mix" are the example). An older trims-only mix also needs the groups and `call_sites()`/`buses()`, which read the game's own code.

Emberhold's file (`/home/ryan/dev/games/emberhold/tools/audio/soundlab_project.py`) is a complete example.

## Files in `work`

| file | contents |
|---|---|
| `index.json` | `clips`: `{take id: {name, variant, seed, prompt, file, failed, duration, ...}}`; `sounds`; `prompts` (the rows shown per sound); `sets.alerts`; `mesh` (music sets: `contexts → takes → profiles → levels`) |
| `clips/` | the mastered takes |
| `alert_kits/` | the alert kits (cached; delete a kit's folder to regenerate it) |
| `balance.json` | the Balance page's measurements |

## Gotchas

- Restart `serve` after changing the server's Python code. The web files are read on every request.
- Never kill processes with `pkill -f PATTERN` or `pgrep -f PATTERN | xargs kill` when the pattern also appears in your own command line. It kills your own shell. List the processes first, then kill by PID.
- SA3 occasionally produces silence. Generators flag it as `failed` and the app greys it out, so mention silent counts when you report.
- Music needs ffmpeg's rubberband filter. `doctor` checks for it.

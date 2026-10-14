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
| `music generate --contexts C.. [--biomes B..] [--takes 3] [--tries 14]` | music sets (each take: a spine plus derived levels on one beat grid) | 1–3 min per set |
| `music promote [--apply]` | ship the liked music takes as tracks and write the game's music manifest | seconds |
| `balance measure` | measure every shipped sound for the Balance page | ~1 min |

Run long jobs in the background, with output to a log. Only one generator at a time: the model needs about 12 GB of VRAM and two copies don't fit.

**Generate generously.** Generation is local and free, and the user prefers many options to a careful few. When a sound needs work, add several new prompt ideas to `prompts.json`, written from the tuning, and 6 or more seeds each. More `--seeds` only adds takes, and the takes already voted on stay as they are.

## The user's decisions (data/votes.json)

The project's `data` folder (tracked in the game's repo) holds:

- **votes.json**:
  - `clips`: `{take id: 1 | -1}`, thumbs up or down.
  - `picks`: `{sound: take id | "shipped"}`; `"shipped"` means keep the current file.
  - `notes`: `{sound: text}`. Notes are instructions: read them with `status` and act on them.
- **prompts.json**: hand-written prompt variants, `{sound: {variant: prompt}}`.
- **promoted.json**, **music_promoted.json**: provenance of everything shipped.

Rules:

- Never edit or delete the user's votes, picks or notes. Generators keep takes the user has voted on.
- Ship (`promote --apply`) only when the user asks. Run the dry run first and show what will change. Shipping overwrites the game's files: they're in the game's git, but say what you replaced.
- Instrument pool: an instrument is in when one of its audition takes is picked or it is net 👍, and out when net 👎. Each music take draws one instrument per role from the pool, seeded.
- Music shipping: liked takes (`mesh_<set>.<take>.<profile>` = 1) ship as tracks. A set with none liked ships all takes not 👎.

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
| `work` | generated output (gitignored; e.g. `.work/soundlab`) |
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
- **`balance`**: a dict documented in `soundlab/balance.py`. It names the mix file, the folders to measure, the groups, and `call_sites()` and `buses()`, which read the game's own code.

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

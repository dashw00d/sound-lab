<img src="soundlab/web/img/soundlab-mark.png" width="64" alt="">

# SoundLab

Make a game's audio with Stable Audio 3, running locally. SoundLab can:

- generate many takes of every sound;
- audition and vote on them in a web app;
- build consistent alert families;
- compose an adaptive music score with intensity levels that crossfade at any moment and tracks that switch on the bar;
- balance the whole mix live against the running game;
- ship the winners.

It works on Windows and Linux, with an NVIDIA GPU (Stable Audio 3 Medium wants about 12 GB of VRAM).

## Install

```sh
./install.sh            # Linux
install.cmd             # Windows
```

The installer, `install.py`, does the following, and re-running it only does what's missing:

1. Gets `uv`, the Python manager, if you don't have it.
2. Creates a Python 3.12 environment in `runtime/`.
3. Fetches [Stable Audio 3](https://github.com/Stability-AI/stable-audio-3).
4. Installs CUDA PyTorch, plus a prebuilt flash-attn wheel when one matches your platform (optional; it's faster).
5. Downloads [cocktailpeanut/stable-audio-3-medium](https://huggingface.co/cocktailpeanut/stable-audio-3-medium), an ungated mirror of Stability's model (about 10 GB).
6. Ends with a health check that makes one second of audio.

Options:

| option | effect |
|---|---|
| `--hf-home PATH` | keep the model elsewhere, or reuse an existing cache |
| `--cuda cu128` | a different PyTorch CUDA build |
| `--no-model` | skip the download |

You also need **ffmpeg** on your PATH, built with the rubberband filter, which the music's tempo correction needs. The full builds for Windows (`winget install Gyan.FFmpeg`) and most Linux packages have it. `./soundlab.sh doctor` checks everything.

The model is licensed under the Stability AI Community License (commercial use has conditions: https://stability.ai/license), and T5Gemma under the Gemma Terms of Use. The web app bundles the Geist fonts (SIL Open Font License, `soundlab/web/fonts/OFL.txt`).

## Use

```sh
./soundlab.sh --project ~/dev/games/mygame serve     # http://127.0.0.1:7870  (Windows: soundlab.cmd ...)
./soundlab.sh --project ~/dev/games/mygame status
```

A project is a game folder containing `soundlab_project.py`, which describes the game's sounds and how it masters and plays them (see AGENTS.md, "The project file"). The pages:

| page | what it's for |
|---|---|
| **Sounds** | Every sound's takes in prompt variants × seeds, next to the file the game ships now. 👍 / 👎 / ★ pick, with notes. A/B a take against the shipped file at the same moment. |
| **Alerts** | Whole alert families side by side (one kit per row, each alert a mini waveform), to judge consistency, not single sounds. |
| **Instruments** | Solo auditions of the music's candidate instruments. Picked ones form the pool every track draws from. |
| **Music** | A track's intensity levels playing in sync. Crossfade them live, stack them to hear clashes, switch takes on the bar, and click the timeline to jump to a bar. Liked takes ship as tracks. A profile can mix layers (drum stems made on the same grid) into tension and action; click a layer chip to hear it alone. Each `music generate` run is a round: the page shows only the newest round and folds everything older under Earlier rounds (liked sets first). |
| **Balance** | Every sound and music level at its in-game loudness. Trim it, A/B it against a reference, and save to the game's mix file, which the running game reloads live. |
| **Tuning** | How each model wants its prompts, which model makes what, and your taste, with the evidence from your votes (which prompt styles win, per model). Agents start every prompt from it. |

Across the pages:

- **The dock** at the bottom shows the selected take large, as a waveform or a spectrogram (`V`). Hover for the time (and frequency), click to seek, drag to loop a range, double-click to clear it. Thumbs and pick sit beside it.
- **Jump to anything** with `Ctrl K` (or `/`): any sound, music set, instrument or page.
- **Undo** the last vote or pick with `Ctrl Z`, or from the toast that confirms it.
- **Live**: while a generator runs, the top bar offers the new takes (nothing moves until you click); votes written elsewhere appear on their own.
- **Prompt tuning** (`tuning.json`, shared by every project) holds a guide per model: its rules, the shape of a prompt for each task, good and bad examples. Agents read it with `./soundlab.sh tuning` before writing a prompt and add what your votes teach them. Rules and taste you write (or mark as yours) are instructions they never change; theirs carry their evidence. Assign a different model to a task and it gets its own prompt style.
- Everything is keyboard-driven: `?` lists the keys for the page you're on, `Alt 1–6` switches pages, `M` mutes.

Generating and shipping happen on the command line:

```sh
./soundlab.sh --project P sounds generate --seeds 3          # every sound x prompt variant x 3 seeds
./soundlab.sh --project P sounds promote --apply             # ship the picks into the game
./soundlab.sh --project P alerts build
./soundlab.sh --project P music audition                     # the instrument candidates
./soundlab.sh --project P music generate --contexts day night --biomes any fjords
./soundlab.sh --project P music generate --contexts day --styles story tune --profiles close   # compare prompt styles
./soundlab.sh --project P music derive --profiles drive          # a new profile for the newest round's takes
./soundlab.sh --project P music promote --apply
./soundlab.sh --project P balance measure
./soundlab.sh --project P tuning --task sfx                 # how to prompt the model that makes sound effects
```

Rough speeds on a 4070 Ti SUPER:

| job | time |
|---|---|
| one sound effect take | under 1 s |
| one music set (a spine plus derived levels, several takes) | 1–3 min |
| a whole game's sound list at 3 seeds | about 20 min |

## Working with an agent

SoundLab is made to be driven by a coding agent: the agent writes prompts, generates and ships, and you listen and decide in the app. [AGENTS.md](AGENTS.md) tells it how.

**Point the agent at it.** An agent started in this folder reads AGENTS.md on its own. If you start it in your game's folder, add a line to the game's agent instructions (its AGENTS.md or CLAUDE.md), for example: *"Game audio is made with SoundLab (`path/to/sound-lab`): read its AGENTS.md before working on audio."*

**The loop.** Ask for a round, vote on it in the app, then ask the agent to learn from it:

1. *"The feast takes still aren't working, see my note. Do a new round from the tuning: 4–5 new prompt variants, 6 seeds each."*
2. Listen and vote in the app: thumbs on the near-misses as well as a pick, plus a note on the prompts that miss (`C`, or the pen on a prompt row). A note stays with its prompt, so new prompts start clean.
3. *"I've voted on the feast round. Read the evidence and update the tuning with what it taught you."*

Step 3 is the one people skip, and it's the one that makes the agent better with your models: the votes go into the tuning as rules, so the next round starts from what worked. Thumbs say more than picks alone, because a pick only shows which take won and a thumbs down shows what lost.

Other useful asks:

- *"Add to my taste: I prefer dry, close recordings over big cinematic reverb."* (Or type it on the Tuning page.)
- *"I want to try another model for footsteps. Write it a guide from its documentation and assign it the task."*
- *"Review the tuning: drop agent rules the evidence no longer supports, and tell me which ones my votes contradict."*
- *"Show me what will change if we ship, then ship the picks."* (Shipping overwrites the game's files, so agents only do it when you ask.)

## Layout

```
install.py, install.sh, install.cmd    the installer
soundlab.sh, soundlab.cmd              run the tool with the installed runtime
soundlab/                              the tool: engine, generators, server, web app (soundlab/web)
tuning.json                            prompt tuning: a guide per model, which model makes what, your taste
runtime/                               installed (gitignored): Python env, Stable Audio 3, the model cache
```

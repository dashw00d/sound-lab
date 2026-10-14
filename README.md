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
| **Music** | A track's intensity levels playing in sync. Crossfade them live, stack them to hear clashes, switch takes on the bar, and click the timeline to jump to a bar. Liked takes ship as tracks. |
| **Balance** | Every sound and music level at its in-game loudness. Trim it, A/B it against a reference, and save to the game's mix file, which the running game reloads live. |
| **Stats** | Which prompt styles win. |

Across the pages:

- **The dock** at the bottom shows the selected take large, as a waveform or a spectrogram (`V`). Hover for the time (and frequency), click to seek, drag to loop a range, double-click to clear it. Thumbs and pick sit beside it.
- **Jump to anything** with `Ctrl K` (or `/`): any sound, music set, instrument or page.
- **Undo** the last vote or pick with `Ctrl Z`, or from the toast that confirms it.
- **Live**: while a generator runs, the top bar offers the new takes (nothing moves until you click); votes written elsewhere appear on their own.
- Everything is keyboard-driven: `?` lists the keys for the page you're on, `Alt 1–6` switches pages, `M` mutes.

Generating and shipping happen on the command line:

```sh
./soundlab.sh --project P sounds generate --seeds 3          # every sound x prompt variant x 3 seeds
./soundlab.sh --project P sounds promote --apply             # ship the picks into the game
./soundlab.sh --project P alerts build
./soundlab.sh --project P music audition                     # the instrument candidates
./soundlab.sh --project P music generate --contexts day night --biomes any fjords
./soundlab.sh --project P music promote --apply
./soundlab.sh --project P balance measure
```

Rough speeds on a 4070 Ti SUPER:

| job | time |
|---|---|
| one sound effect take | under 1 s |
| one music set (a spine plus derived levels, several takes) | 1–3 min |
| a whole game's sound list at 3 seeds | about 20 min |

## Layout

```
install.py, install.sh, install.cmd    the installer
soundlab.sh, soundlab.cmd              run the tool with the installed runtime
soundlab/                              the tool: engine, generators, server, web app (soundlab/web)
runtime/                               installed (gitignored): Python env, Stable Audio 3, the model cache
```

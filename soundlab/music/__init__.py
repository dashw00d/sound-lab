"""Meshed music: every track at three intensities on one beat grid, so levels crossfade at any moment and tracks
switch on any bar line; and the instrument pool it is played on.

The design comes from the project (Project.music):

  bpm, bar_beats, bars           the grid (every loop exactly `bars` bars, starting on a downbeat)
  levels                         the intensity names, quietest first
  spine                          optional: the level the spine is (default: the middle one); every other level is
                                 made from it, so adding a level later keeps the spine where it was
  lufs                           {level: integrated loudness}
  profiles                       {name: {level: audio-to-audio strength}} for the non-spine levels (0: the spine
                                 itself, so the levels can't drift apart: a stack built only by layers); a profile may
                                 add "layers": {layer: {level: gain dB}}, those layers mixed into those levels; a
                                 level's strength may name another level instead, to reuse that level's audio (e.g.
                                 a louder level that is the action level with the drums pushed: "battle": "action")
  layers                         optional: {name: {prompt(context, mode, mood) -> str}}: stems generated from text on
                                 the grid and mixed into levels (e.g. battle drums under action), since a derived level
                                 can't add intensity. Pitch-free parts (percussion) can't clash with the harmony.
  default_profile                optional: the profile the Music page opens on, and the one a set with no liked take
                                 ships at (default: "contrast" if there is one)
  contexts                       {context: [mode, mood word]};  biomes: {biome: word, "any": ""}
  instruments                    {id: {role, tag, sentence, name, prompts?}}: the candidates (auditions on the
                                 Instruments page); `prompts` ({variant: prompt}) replaces the audition template, e.g.
                                 to compare prompt shapes or for an instrument the template can't describe (voices)
  provisional                    {role: id}: used until the pool has votes
  prompts(context, mode, mood, names) -> {level: prompt}   names: {role: instrument name}
  styles                         optional: {style: prompts function, same signature}, alternative prompt styles to
                                 compare in a tuning round. A style's sets are keyed "<context>[.<biome>]~<style>"
  audition                       {seconds, template} (template takes {tag} and {sentence})
  manifest, out_dir              where promote writes the game's music.json and the files
  rotate_loops                   loops a track plays before the game moves on (written into the manifest)
  groups                         optional: {file, default}: song groups. Then promote ships every liked take (and
                                 only those), and keeps `file` (the game's, hand-edited: {"tracks": {track id:
                                 group}, ...}) current by adding each new track at the `default` group; it never
                                 changes a track already in it
  seed_file(path)                optional: called for each shipped file before after_install (e.g. an import stub)

Each `generate` run is a round (index mesh.rounds), and `--takes` counts the takes of that run. Each take carries its
round, and a set keeps the takes of every run: nothing is deleted. The Music page shows only the newest round's takes (a
batch to listen to, vote on and talk over), and folds everything older away, voted on or not: other sets under "Earlier
rounds", a set's older takes under "Earlier takes". Votes and notes stay with their takes. Shipping ships what is liked
in any round, and for a set with nothing liked, only its newest batch.

How a set is made: SA3 generates the spine from an explicit prompt; its tempo is measured and corrected to the grid
(rubberband, a small factor), its first strong downbeat found, and bars+1 bars cut from there. The other levels
are derived from that spine with audio-to-audio, which keeps its timing and harmony but changes the arrangement.
Each level is looped by fading its extra bar over the head and rotated so its tracked beats sit exactly on the
grid. A take whose spine or any level has unsteady beats (or sits over a quarter-beat off the grid) is thrown out
and another seed tried. Each take draws its instruments from the pool, seeded, so a set's tracks differ in colour.
"""
from __future__ import annotations

# (the names the one module imported, so `music.np`, `music.Store` and the like still resolve)
import hashlib  # noqa: F401
import random  # noqa: F401
import shutil  # noqa: F401
from datetime import date, datetime  # noqa: F401
from pathlib import Path  # noqa: F401

import numpy as np  # noqa: F401

from .. import dsp, project as P, quality, tuning  # noqa: F401
from ..dsp import SR  # noqa: F401
from ..store import Store  # noqa: F401

# The music was one module, soundlab/music.py, until 2026-10-21; now a package of one module per job, and every name it
# had (private ones too: research/ and the other modules use some) is importable from soundlab.music as before:
#   design      the spine level and a set's key
#   pool        the instrument pool: auditions, the pool the votes make, a take's instruments
#   generation  making sets (generate), adding profiles (derive), checking levels (check)
#   trials      the Trial page: mini trials, grown extensions, what's still to answer
#   shipping    rounds, promote and add, and the library of what the game ships
#   measures    measuring songs (trims, songs.json): loudness, onsets, tuning, phrases, cuts, fingerprints, families
#   mixer       what the Mixer plays beside the shipped files: stems, retuned copies, fills, glues
#   taste       the designer's taste in transitions: join features, song records, the join model, the joins report
from .design import key_of, spine_level
from .pool import auditions, pool_of, take_roles
from .generation import (
    LEAD_IN, TAIL, _Failed, _LazyEngine, _accents, _derive_level, _layer_stem, _make_profiles, _mix, check, derive,
    generate, sa3_seed,
)
from .trials import GROW_BARS, GROW_CHANGES, GROW_KEEP, TRIAL_CONTEXTS, grow, trial, trial_pending
from .shipping import add, current_takes, library, newest_round, promote
from .measures import (
    FAMILY_MIN, LOUD_PEN, SAME_PIECE, TRIM_KEEP, TRIM_LENGTHS, TRIM_REGION, TUNING_V, UNEVEN_DIP, UNEVEN_QUIET,
    UNEVEN_STEP, _beats, _cuts, _fingerprint, _measure, _onsets, _phrase, _tuning, families, recut, same_piece, trims,
    uneven_loop,
)
from .mixer import (
    FILL_CTX, GLUE_BARS, GLUE_DB, RETUNE_MIN, STEM_MIX, TONIC, _freeze, _stem_gains, fills, glues, retune, stems,
)
from .taste import JOIN_FEATURES, JOIN_WEAK, _fit_logistic, fit_joins, join_features, joins, song_record

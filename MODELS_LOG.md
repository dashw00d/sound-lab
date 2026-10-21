# What we've learned about the models

A dated log of findings about the models SoundLab uses: what we tried, how we measured it, what came out. `tuning.json` holds the working rules agents follow (ids like `r17`); this file keeps the story and the evidence behind them, including what didn't work, so nobody has to rediscover it. Newest first within each model. Add to it whenever a round, probe or measurement teaches something.

How findings are graded:
- **Solid**: a large effect against the noise, or confirmed twice.
- **Leaning**: consistent in direction, but the sample is small; treat as a starting point.
- **Anecdote**: one designer remark or one case; worth testing, not a rule.

---

## CLAP (LAION), used to group songs by similarity

- **Changed 2026-10-21:** families are no longer grouped by CLAP likeness but by whether songs splice (see SA3, "families by whether songs splice"); CLAP places songs on the Families map and finds near duplicates.

### 2026-10-19: which checkpoint works, and what it groups by

`research/song_groups.py` embeds the 98 liked music takes (each one's spine) and clusters them, so the designer can hear each group as one long stream (data: `research/data/song_groups.json`). Not yet heard by the designer.

- **Solid. `laion/larger_clap_music` is broken on Hugging Face.** Any two songs come out ~0.998 alike and every text description scores ~0, the same on transformers 4.46 and 5.19, with no missing weights. `laion/larger_clap_music_and_speech` works: on four very different takes, the choir song scored highest for "choir singing" (0.41, against 0.11 to 0.22 for the others), and the songs sat 0.73 to 0.90 apart. Use that one.
- **Leaning. It groups by lead instrument and set more than by context.** Centred on the songs' mean, Ward clustering picked 5 groups by silhouette (0.27; 5 to 12 tried, all 0.21 to 0.27, so the groups are soft): all 18 violinbed takes together (day, night, winter, Blood Moon and menu alike); 11 of the 14 violin and violintags takes together; all 5 winterwater takes with the tagelharpa and nyckelharpa ones; all 5 war2 takes with strings and bed2; all 5 war takes with 3 of the 5 trailer takes. Day, night and Blood Moon takes mix in every group.

## Composing before SA3 (MIDI-LLM, MOSS-Music, sampled orchestras): abandoned

### 2026-10-15: what the detour taught

The ask was more melodic variety. Tried in turn: MIDI-LLM (Llama 3.2 1B) writing MIDI sketches, MOSS-Music-8B (4-bit) judging them, the MIDI orchestrated with free sample libraries (Sonatina Symphonic Orchestra, VCSL, Karoryfer Horse Pulse, Ajatar Kantele) through a small SFZ sampler, then SA3 audio-to-audio over that. **The designer's verdict: "this is not working. Basically none of it. SA3 is just very very good, and all this other stuff is just getting in the way."** The code stays on the sound-lab `themes` branch, unmerged; nothing of it is on main. Lessons:

- **Solid. Don't put a pipeline in front of SA3.** Each stage before it (sketch, checks, sampled render) cost time and taste and didn't beat SA3 prompted well. Variety comes from the prompt words (variety probe, below), not from feeding it other audio.
- **Solid. MIDI-LLM ignores the key.** 22 of 61 sketches came out major despite "D minor" in the prompt; about half were loose, played-in timing that can't loop on a grid.
- **Solid. MOSS-Music is no composition judge.** 28 verdicts scored only 6, 7 or 8, on a template ("The piece opens with a N-second introduction..."), ~1 min to load and ~10 s a verdict.
- **Solid. Sample-render polish doesn't register; instrument choice does.** Paired on the same 27 sketches (Audiobox): humanising, legato, glue and a better hall +0.04 (n.s.); a tonic drone under everything -0.12. Leads: **kantele +0.39** (the most Nordic and the best rated), a solo violin without vibrato +0.26, bowed psaltery -0.53; a chorus can't carry a melody (rated 3.7-6.9 as the lead).
- **Nordic instruments to try as SA3 prompt words** (from this and the sample hunt): kantele, tagelharpa (bowed; bass tagelharpa plucked), jouhikko, nyckelharpa, hurdy-gurdy, a lur or bukkehorn (war horn), frame drums and bodhran, a low male choir as a pad (not a lead). Untested in SA3 prompts.

## Stable Audio 3 Medium (SA3)

### 2026-10-21: families by whether songs splice, not how related they sound

The designer, on the Families graph: "These are often related, but I wouldn't consider most of them mid song sibling splicable." The sort (`music families`) joined songs by CLAP likeness and mean bar likeness at the best offset, plus the same style and lead: the style and lead bonuses alone (0.6 + 0.5) cleared its 0.9 bar, so families were "related" (sizes 77, 41, 39...). `research/splice_probe.py` (data: `research/data/splice_probe.json`), 306 songs:

- **Leaning. A splice score separates siblings from related songs.** Two songs at an offset L: the cut from A after bar k into B's bar k+1+L is seamless when the lined-up bars either side are at least a natural bar step (0.785) alike and B's bar is within 3 dB of the bar of A it replaces; the score is the share of the 16 cuts that are seamless at the best offset. Siblings (43 pairs): median 0.56 (p25 0.34, p75 0.78); pairs the old sort put in one family, not siblings (5682): 0.19 (p75 0.31); the rest: 0.12. 91% of siblings splice best at offset 0, as "in step bar for bar" predicts. The mean lined-up likeness (music.same_piece) separates them too (siblings 0.82, one family 0.67, the rest 0.62), but it's a mean: a song that's alike for most bars and jars at a few passes it.
- **Changed 2026-10-21: families are complete linkage on the splice score at 0.5** (every pair in a family splices at least that well; siblings, extensions and the designer's links together first, bad matches and new families kept apart), their roots the members that splice best with the rest, each song's nearest the songs it splices best with. 61 families of 2 or more (largest 9), 147 songs on their own. CLAP and the likeness only place the songs on the map and find near duplicates.
- **Guesses:** a song whose worst splice with a family's members is 0.35 or more (about siblings' lowest quarter) is a guess for that family, shown dotted on the graph with its score, for the designer to bring in or call a bad match: 146 songs close to 163 families (each song's best 2, each family's best 6).
- The designer, seeing the 0.5 families: "yeah that is what we want." Not yet checked by ear family by family.

### 2026-10-21: the tuning measurement and the retune were both wrong (corrects "SA3 takes weren't at one pitch")

The research on audio backends found ffmpeg's rubberband filter runs Rubber Band's older real-time engine (R2) on each channel apart. Testing it showed worse.

- **Solid. The tuning estimate was 3× too big and wrapped.** `music._tuning` asked librosa for 36 bins an octave and read the fraction of a bin (33 cents) as a fraction of a semitone. On test tones: a true +10 cents read +26, −10 read −24, +25 read −28 (wrapped), +37 read +17.
  - Fixed: 12 bins an octave. Test tones now read within 2 cents; known shifts on music are tracked within a few.
  - The library is at **+2 cents** from A440 (was "+8.5"). **4 of 98** shipped songs are over 6 cents off (was "42").
  - The earlier entries' figures (median +8 cents, extremes ±37, "12% of pairs 20 cents apart", "the played gap now 3 cents") came from the broken estimate. They're void.
- **Solid. ffmpeg's rubberband pitch shift was unreliable.** On a two-tone test, −45 to +28 cents asked: 0 moved. On a 440 Hz tone: −28.5 asked, −53.7 moved.
  - Pedalboard's `time_stretch` (R3, high quality, channels together): exact on the same tests. It now does all retuning and tempo correction (`dsp.stretch`).
- **So the Mixer had been playing about 38 in-tune songs shifted by noise.** Among them was night.violinbed.k0: truly +5 cents, "retuned" −28.5. It was the sibling the designer marked as the weird piece in a 2-star block.
- Fixed in the code and in the work files: tunings measured again (`TUNING_V` 2), the retune redone with Pedalboard (4 songs), and the new takes' retunes redone.

### 2026-10-21: the first blind ratings in the Mixer (73 blocks, 68 transitions)

Stars from the Mixer's blind queue (streams.json; scale: 5 unique, 4 good but common, 3 filler, 2 broken, 1 avoid), and the designer's review marks (reviews.json) on the 2-star blocks.

- **Anecdote, small n. Variations inside a block cost stars.**
  - Mean stars with a fill 3.6 (n 5) against 4.15 without; with a sparse phrase 3.6 (n 7) against 4.2; with a sibling swap 3.5 (n 2); with drums out 3.9 (n 7).
  - Marked as what spoiled a 2-star block: a sibling swap (winter.violinbed.k0 into night.violinbed.k0, which is retuned -28.5 cents); a fill (bloodmoon.war2.k6, 5-12.1); a new take's own loop (night~war2 k5, fixed since).
- **Anecdote. The overnight takes rate like the shipped songs** (4.12, n 26, against 4.10, n 41).
- **Anecdote, against the ranking.** New takes rated 5 against 4:
  - uniqueness +0.12 against +0.29;
  - plays nice 7.7 against 14.2 good transitions;
  - rank median 45 against 25.
  - So what joins easily may sound common, and CLAP plus bar fingerprints don't match "completely unique" by ear. Don't weight the measured uniqueness up until more stars agree.
- **Anecdote. By style:** violin 4.9 (n 7), nyckelharpa2 4.8 (n 4), war2 3.5 (n 12), trailer 3.9 (n 8).

### 2026-10-21: guessed loops chosen by likeness alone stepped, dipped and looped silence

The designer rated a new take 2 of 5 ("otherwise 5 stars", a volume issue): night~war2 k5 looped bars 2-11, and bar 2 sits 6 dB under bar 11 (SA3's quiet bars 2-4). The cue guesser had scored loops only by how alike the bars either side of the jump are.

- **Solid. Uneven guesses were common.** Seam step over 4 dB: 18 of 89 shipped guesses, 44 of 192 new takes. A bar 5+ dB under its loop's median: 11 and 21. The designer's own cues: 1 of 9.
- **Solid. Some new takes are half silence.** Their bars 2-7 or 2-8 sit 13 to 25 dB under the music that follows: night~tagelharpa k7, day~nyckelharpa k7, and a few more nyckelharpa takes. They ranked #1 and #4 on plays nice, which their loud half earned. The Audiobox gate passed them.
- `music trims` and `music candidates` now score loops on likeness less loudness (`LOUD_PEN` 0.15 per dB):
  - a seam step over 2 dB;
  - a bar dipping over 4 dB under the loop's median;
  - twice over, a loop more than 3 dB under the take's own 75th-percentile bar, so it can't loop a silent stretch.
  - Loops may be 6 bars too, which gives more places where the level holds. On all 281 guessed loops, 6-bar options cut the uneven ones from 57 to 13 and raised the median seam likeness from 0.785 to 0.823.
- Guesses are sticky: a loop already guessed moves only if it's uneven (`uneven_loop`: step over 4, dip 5+, quiet 6+). 21 shipped loops moved, and new fills were made for them. 56 new takes' loops moved. Takes still uneven are ranked down.
- A take probably the same piece as a shipped song (bar fingerprints 0.85+) now has its uniqueness capped at -1. night~nyckelharpa k3 (0.86 to day.nyckelharpa.k6) fell from #9 to #147.

### 2026-10-21: a similarity scan of the overnight batch against the shipped songs

`music candidates` now scores how unlike the rest each take is, with two measures, each standardised on pairs of shipped songs and averaged: bar fingerprints at the best of 16 offsets ("same piece"), and CLAP centred on the library ("sounds like"). The designer: the top should be "unique + plays nice".

- **Solid. The bar fingerprint is too coarse to call a copy by itself.** Over the shipped songs, unrelated pairs have a median 0.66, with 1% at 0.81 or more; siblings a median 0.82, with a 10th percentile of 0.70. The best offset adds little: 0.63 at no offset. At 0.8, 39 of 192 new takes had a match, about what chance gives over 18,816 pairs. At 0.85, 4 did (night~nyckelharpa k3 ~ day.nyckelharpa.k6 at 0.86).
- **Solid. Adding uniqueness to plays nice let unjoinable takes in.** day~violin k9 (1 good transition, unique +2.8) reached the top 10. The pick is now the weaker of the two plus a quarter of their sum, ranked one at a time against the shipped songs and the takes above.
  - Top 50: every take has 10+ good transitions (median 16) and is unique −0.15 or more.
  - It spans 15 styles: bloodmoon 21, night 14, day 11, winter 4.
  - winter~winterwater k9 (CLAP 0.85 to the shipped winterwater k1) fell from #9 out of the top 50.
- Untested: whether uniqueness agrees with the designer's 5 against 4 stars ("unique" against "common in the library"). Check once there are a few dozen rated blocks.

### 2026-10-21: the Mixer's stem variations changed the volume, not just the texture

The designer rated bloodmoon.any.war2.k6.stack 2 of 5 ("volume issue inside") in a blind session: 13 bars with a fill and two stem variations. Measured over its mellow loop (bars 5-12, mean power per bar): full -26.2 dB, drums out -28.2, sparse (bass -6 dB) -32.5. So a sparse phrase dropped about 6 dB at an 80 ms switch.

- **Solid. Across the library (98 songs) the variations weren't level with the full mix.** Drums out was a median 0.6 dB quieter (worst 4.6); sparse 2.3 dB quieter (worst 6.5); pulse (the battle drums in at -10 dB) a median 3.1 dB louder.
- `music stems` now measures each variation's gain back to the full calm level (`_stem_gains`, stems.json `gain`, within -6 and +9 dB), and the Mixer applies it. A variation changes the texture, not the volume.
- The same session: songs mastered to one LUFS still differ by up to 7 dB in their median beat (sparse takes sit far under their peaks). The Mixer's "Even levels" trims each song toward the library's median beat, within 6 dB.

### 2026-10-21: a song-level score: which shipped songs are the best (compatible, complex, calm, diverse)

`research/song_scores.py` (data: research/data/song_scores.json). The designer's working definition of a very good song is diverse, complex, doesn't red-line, and plays nice often. Each of the 98 shipped songs' calm levels was scored on those terms, standardised (clipped at ±2.5 SD), and checked against the 18 songs in their saved Mixer sets (AUC; 0.5 = no relation).

- **Solid. "Plays nice" is the strongest predictor.** The measure: the count of 80%+ transitions in and out, by the taste model with its audio alone (no song records, no votes, so nothing circular). Sets AUC 0.74. With the song records and votes added, 0.80 (and 0.93 on the songs' own vote records, which is circular).
- **Leaning. Complexity is real and independent.** The measure, from Basic Pitch's notes: melody range, distinct pitches, the entropy of intervals and of note lengths. Sets AUC 0.68, with r = 0.0 to compatibility. Together, compatibility plus complexity: AUC 0.75; 8 of the 18 set songs are in the top 20 and 2 are in the bottom 20.
- **Leaning. Calm, i.e. not red-lining, doesn't separate the mellows (0.48).** The measure: the loudest beat over the median beat, the 2-5 kHz share, and the strongest onsets over the median. Every file is mastered to -1 dBFS, and the calm levels are all calm enough. Abrasion is likely in the intense levels and the old middle levels (unmeasured here).
- **Leaning. Bar-to-bar change counts against a song (0.26).** The measure: 1 minus the cosine of neighbouring bars. It isn't the crescendo (r = 0.11 to the loop's loudness swing). Songs that keep changing shape every bar don't get picked. The variety the designer wants comes from the walk between songs, not from within a 4-bar part.
- **Anecdote. Uniqueness by CLAP, i.e. unlike its 5 nearest songs, is unrelated (0.52).** Use it to keep a batch diverse, not to rank. Audiobox CE is unrelated too (0.48), as before: it catches broken takes.
- Score to use for filtering new takes: blind compatibility + complexity, with CE as the existing gate.
- **Anecdote, from the designer: the top of that ranking struck them as "the weirdest, not the best".** Complexity as entropy rewards unpredictable notes, so don't filter on it without a listen.
- **Catchiness, first pass (`research/catchy_probe.py`, research/data/catchy_probe.json; untested by ear).** It draws on hook and earworm research (Burgoyne and Van Balen's "Hooked"; Jakubowski 2017). The measures, from the same notes: a tune that stands out, a motif that recurs at 1, 2 or 4 bars (changed, not looped), steps more than leaps, a hook leap, a singable range, in key, home notes and a tonic at phrase ends, a repeating rhythm, 2 to 8 notes per bar.
  - It ranks kantele, violintags and nyckelharpa songs on top, and the "close" war, trailer and horror songs at the bottom (atonal, no motif). It is independent of complexity (r = -0.11) and of the sets (0.57), which measure joinability, not tunes.
  - Its top song, day.violintags.k3, has the worst transition record (4 good, 21 bad): a catchy, looping motif may be what clashes in a join.
  - Bias: plucked notes transcribe cleanly, and pads and choirs don't. Next: the designer listens to the top and bottom of the list.
  - **The designer, by ear: day.violintags.k3 is "amazing", it just won't mix.** Catchiness is a fair counterweight to plays-nice. Don't weight it high, for the clear-strings bias.
  - **Leaning. In the transition votes, catchiness matters.** The two songs' catchiness gap: AUC 0.39 (the wider, the worse); the catchiness of the song left: 0.43.
  - Added to the taste model (leave one out, 315 votes): audio features alone 0.69 → 0.71, with song records 0.726 → 0.730. Not added: a small gain, on a biased measure.
  - The audio-only model puts day.violintags.k3 high on plays-nice (38 moves at 80%+) against its 4 good and 21 bad votes. So the model can't hear a tune's clash, and votes have to catch it.
- **The score for filtering new takes (research/data/song_pick.json):** plays-nice (audio only) + 0.4 × catchiness, the latter standardised within the song's style (a style with under 3 songs gets 0), with Audiobox CE as the gate.
  - Its top 20 span 14 styles, so it isn't string-biased.
  - Sets AUC 0.70, against 0.74 for plays-nice alone. That's expected: the sets measure joinability, and the catchiness weight is the designer's call.

### 2026-10-21: note-level analysis of the transitions: real melodic signal, nothing new for the model

`research/notes_probe.py` (data: research/data/notes_probe.json, notes_probe_loud.json). Each shipped track's calm "other" stem (retuned where the track was) transcribed to notes by Basic Pitch (Spotify, ICASSP 2022), on onnxruntime (basic-pitch installed --no-deps: its TensorFlow has no Python 3.12 build; 0.7 s a track; 360-600 notes per 43 s loop, mostly D, B flat, F, A). The melody: the highest strong note on a sixteenth grid, or the loudest. Measured around the designer's 315 voted transitions.

- **Leaning. Melodic continuity carries some signal on its own.** The melodies' registers sit closer in good transitions (8.2 against 10.1 semitones apart, AUC 0.41; under 0.5 = more is worse), the leap from a's last melody note to b's first is smaller (13 against 16 semitones, 0.42), fewer strong notes a semitone apart across the join (0.45), b's first melody note on a home note (D, F, A) a little more often (0.55-0.56).
- **Solid for these votes. None of it improves the taste model.** Added to its four audio features, by leave-one-out: AUC 0.69-0.70, right 61-66%, against 0.69 and 66% without. The melodic signal overlaps what the model has (b's clear start, a's fuller bar) or is too noisy at this size.
- **Solid. "Does the phrase sound finished" doesn't matter.** A line coming to rest before the cut, falling into it, ending on the tonic: AUC 0.51-0.55, with either melody definition. Instead, good transitions cut through a held note more often (32% against 22% with the loudest-note melody), which fits held_a: leaving during a sustained note covers the change; leaving just before the song's own strong attack exposes it.
- What's left of the designer's taste (a third of the model's calls) isn't in loudness, onsets, harmony, timbre or the notes. Untested: how consistent the designer's own ratings are (the ceiling), and a learned embedding of the transition audio itself.

### 2026-10-21: 132 transition votes: a model of the designer's taste in transitions

The designer rated 132 transitions (75 good, 57 bad), most in the Mixer's training mode. Asked "what does that tell you so far". Each measure judged by how well it separates good from bad (AUC), and models by leave-one-out (each vote predicted by a model fit without it). `music joins --fit`.

- **Solid. The join score (bar fingerprints) doesn't predict taste.** AUC 0.53; as a leave-one-out model 0.43, right 53% (always guessing "good": 57%). Nor do timbre (0.54), the beat-level loudness step once levels are matched (0.53), CLAP whole-song similarity (0.56), the same lead instrument, family or context (0.51-0.53), the tuning gap after retuning (0.46), how busy either side is (0.46-0.48), or whether the music is rising or falling into the join (0.46-0.50). It is still a useful floor: training mostly offered transitions over 0.6.
- **Leaning. What does: leave from a full bar, into a clear start, without stepping on a downbeat, at a phrase start.** Single measures: how loud song A's exit bar is against its usual level (AUC 0.69; good +0.65 dB, bad 0.0), how clearly song B starts (the onset at its entry beat against its usual busyness, 0.64), harmony (0.63, 0.91 against 0.89), entering B on a phrase start (0.56, 87% against 74%), A not about to hit a strong downbeat of its own (0.58). Together (level_a, entry_phrase, attack_b, held_a): right 67-70% on votes the model didn't see, AUC 0.69-0.71. Most of what makes a transition good to the designer is still unmeasured.
- Some songs join badly whatever the bars: day~violintags k3 in 1 good and 7 bad transitions, winter~winterglass k1 in 1 and 5; night~violin k3 in 6 good and 1 bad. With about 10 votes per song, a song's record doesn't (yet) help predict.
- In use: the Mixer walks by the model's probability (taken at 50% or more; under a join score of 0.6, a clash, never), and training offers mostly the transitions it's least sure of (40-60%). Refit as votes come.
- **Solid. The model's high end is trustworthy; its middle isn't.** Leave-one-out estimates against the designer's 315 votes: under 30%, 24% liked (67 votes); 30-50%, 41% (92); 50-80%, about 60-63% (119); 80% or more, 89% (37). Across the library (97 songs: 206 exits at phrase ends inside the cues, 152 entries at phrase starts, 31,312 moves; 20,018 clashes under a join score of 0.6), 1,177 transitions reach 80% (350 reach 90%), and 87 of 97 songs have at least one 80% way out. The Mixer's walk now waits for one over a taste bar (default 80%), settling for 50% only after 8 bars past Stay, then the glue; in a 2-minute test it took 81%, 90%, 83% and a 63% the designer had liked.
- **Update, 315 votes (159 good, 156 bad; the new ones rated blind, mostly where the model was least sure).** The model held: right 66% on votes it didn't see (AUC 0.69), against 50% for always "good". How clearly song B starts strengthened (AUC 0.66) and is now the largest weight; not stepping on A's downbeat rose (0.60); how full A's exit bar is fell (0.69 -> 0.62, still real). **Leaning: a song's record now helps.** Each song's good less bad over its other transitions (shrunk toward 0) lifts the model to 67%, AUC 0.72; the outgoing song's record weighs 0.51. The Mixer counts it live from the votes. Harmony adds nothing beyond these. **Retuning checked:** the gap the Mixer actually plays is 2.9 against 3.3 cents (good against bad, AUC 0.46: inaudible), and transitions with retuned songs are good as often as the rest (48-54%); a faint sign that the songs needing the biggest shift join worse (shift AUC 0.45). Unmeasured still: about a third of the calls.

### 2026-10-21: the designer's first transition votes: what the join score misses

After the tuning and bug fixes ("this is way way way better"), the designer thumbed 8 transitions in the Mixer: 1 liked, 7 disliked. Their words on the bad ones: "mostly just sudden transitions that don't match, or weird volume changes from a bad slice." `music joins`.

- **Solid for these votes. The join score didn't separate them.** All 7 disliked transitions scored 0.76-0.84, over the 0.75 the walk takes; the liked one 0.78. Harmony (chroma) 0.89-0.95 on all of them, liked included.
- **Solid. Timbre doesn't explain it either.** The suspect from the score's make-up (74% chroma) failed: the liked transition had the lowest timbre cosine of all (-0.19, against -0.08 to 0.28 for the disliked ones). Nor does whole-song similarity: CLAP (laion/larger_clap_music_and_speech, research/song_groups.py) puts the liked pair at 0.934 and the disliked pairs at 0.87-0.97 (any two songs: median 0.913).
- **Leaning. The loudness at the join is finer than a bar.** Beat-level loudness (`music trims`: "beats") shows steps of 1.0-4.2 dB from the outgoing song's last beat into the incoming song's first, where bar averages said 0.3-3.5 dB (one disliked transition: 0.3 dB by bars, 3.6 dB by beats). The Mixer now matches levels at a song change (the incoming run starts at the outgoing song's last-beat level, within 6 dB, and eases to its own over 2 bars), crosses over a beat around the bar line ("sudden": Joins, tight / 1 beat / 2 beats), and the score takes 0.03 per dB of beat-level step over 2 dB. Not yet heard.
- **Solid. Fills step and swell more than the bar check showed.** Per beat, over the 370 kept fills: the step from the loop's last beat into a fill is 2.3 dB at the median (over 3 dB for 37%, over 6 dB for 9%), out of it 2.1 dB (30%, 12%), and a fill swings 5.3 dB inside (over 6 dB for 40%). The designer's remaining volume issues were "mostly with fills"; the disliked ones step up to 5.7 dB in and swing up to 13.8 dB. The Mixer now levels a fill as it plays (100% to the beats either side at its edges, 70% of its swells inside, within 6 dB), leaves out the 50 that swing over 10 dB, and never leaves a run straight after a fill (a fill leads back into its loop). Not yet heard.
- One song (day~bed2 k2) was in 4 of the 7 bad transitions, and two of its fills and its glue were thumbed down too: the designer took it out of the set.

### 2026-10-21: music theory checks on the Mixer's joins: tuning, phrases, modes, downbeats

The designer: "so close to working. We just need a little more music theory and fine tuning, possibly bug hunting." Measured on the 98 shipped tracks' calm levels.

- **Solid. SA3's takes aren't all at one pitch.** librosa's tuning estimate: median +8.5 cents from A440, 10th-90th percentile 0 to +20, extremes -37 and +37; 12% of pairs of songs are more than 20 cents apart and 5% more than 30, enough to sound sour when one follows the other. `music retune` moves the 42 tracks more than 6 cents off the median to it (median shift 9.5 cents, largest 45.5), with rubberband (pitch only, the grid kept), with their stems, fills and glues: 523 files under work/clips/tuned. Not yet heard.
- **Leaning. There is a 4-bar phrase grid, not always at bar 1.** The bar where the bar-to-bar change of the fingerprints peaks, every 4 bars: phrases start at bar 1 in 54 tracks, bar 2 in 19, bar 3 in 9, bar 4 in 16; the change there is 0.14 above the rest (median), against a bar-to-bar change of 0.25. The Mixer's runs now leave at the end of a phrase of their song (where the grid is clear, contrast at least 0.08; else 4 bars from where the run came in).
- **Solid, a null result. The contexts' modes didn't take, and modal clashes don't mark bad joins.** Asked for D dorian (day), aeolian (night, winter), phrygian (Blood Moon), the takes lean to B flat and E flat in every context (log B/Bb -0.21 to -0.36 by context; B natural the stronger in only 21-35% of tracks). A clash measure on the modal pairs (B/Bb, E/Eb, C#/C, F#/F) across a join gives the same distribution across songs as within one song (median 0.0425 against 0.0426; 90th percentile 0.055 against 0.059): no signal, so no penalty.
- **Inconclusive. Downbeats.** The beat each loop starts on is its bar's strongest onset accent in 48 of 98 tracks (median ratio to the next beat 1.0: the accents are weak), and its strongest chord change in 35 (beat 4: 27, often an anticipation). The two measures disagree too often to shift any loop by a beat; joins may land some songs a beat off. To check by ear.

### 2026-10-21: making pieces last longer: runs, variation over repeats, generated fills at the loop point

The designer: "how do we get the individual pieces to go longer?", then "fancy looping, or generating fills, or layering on stuff and looping ... let's do all of that and see what we get." Built into the Mixer's player; not yet heard by the designer.

- **Solid. Fixed windows can't grow far.** Requiring each part's two ends to still join every other part both ways (0.75) lets parts in 4 starter sets grow from 4 bars to a median of 5 (5% reach 8). So the player walks runs instead: a run enters a song at a part and plays on in it (looping between the song's mellow cues) for at least Stay bars, then leaves at the first bar whose join into a part of the set is at least 0.75 (that bar into that part's start), or through the glue within 8 more bars. In a test at Stay 8, runs of about 8 bars left at joins of 0.76-0.88.
- **Leaning. Siblings continue each other in step.** A part, then the next 4 bars of a sibling at the same bars: median join 0.79, 53% of 344 at least a natural step. A run's phrase goes on in a sibling 30% of the time.
- **Stems** (`music stems`, Demucs, 98 tracks): a phrase varies 45% of the time between drums out (bass and the rest), sparse (the rest, bass -6 dB) and pulse (the battle level's drums in at -10 dB, in step since the levels share the spine).
- **Solid. SA3 writes loop-point fills well; loudness is what fails.** `music fills`: 1 bar inpainted between each track's end cue and start cue (4 bars kept either side), checked for the grid (90 BPM), rating (at least the calm gate) and loudness (within 3 dB of the bars around it). 367 kept of 513 tried; 89 of 98 tracks got all 4, one none. Kept fills rate 7.57 (median, min 6.32). Of 146 rejected, 137 were partly or only for loudness, 10 off the beat, 18 rated low: a fill tends to rise or drop against the bars it sits between.

### 2026-10-21: glue between parts: none in the library, so frozen from each family's own bar

The designer, on the Mixer ("most of these work super well, some almost perfect"): "an even mellower join that was homogeneous in each family that we could slap in the middle." Uses: a way through when two parts don't join (so a set can hold parts that don't fit each other directly), a breath every few parts (rise and fall instead of one busy level), and later the doorway to the rests and into a fight.

- **Solid. No shipped bar works as glue.** Every 1- and 2-bar stretch of the 98 mellows that is at least 2 dB under its song (105-115 per starter set), scored against each part of 4 starter sets both ways: the best reach 0.70-0.74 with every part, under the 0.78 the sets' own parts manage. Part of this is the measure: it scores continuity, and a breath is a change, so a glue is judged by its harmony (the set's base), not its join score.
- **Solid. A frozen pad needs its peaks, not the whole spectrum.** `music glues`: per family (and per song without siblings), the bar scoring best on home chord share (D, F, A: every context's mode has them), steadiness and quietness, frozen (each bin's median magnitude, phase turning at its measured rate), darkened, at -27 LUFS (3 dB under the mellow). On 10 glues, everything at -27 LUFS: the whole spectrum frozen changes frame to frame as much as the music does (spectral change 18.5 against 17.6; small phase jitter or longer windows didn't help, nor PaulStretch's random phases: 20.3); it beats like coloured noise, since a section plus reverb fills every bin. Keeping only the spectral peaks (the chord's partials) gives 5.3, the home chord's share 53% to 70%, the level steady within 0.4 dB (the music wanders 2.4). 68 glues, about 1 s each. Not yet heard by the designer.
- In the Mixer, the outgoing part fades into its own family's glue over two beats, and the glue fades out under the next part's first two beats; "weak joins" puts it where the next part joins under 0.75, "breaths" every 2-4 parts.

### 2026-10-21: 4-bar parts of different songs that go together in any order (the Mixer)

The designer: "what we need is a real song mixer ... match and splice interesting parts into each other that share the same base ... they should go together in any order." Every shipped loop is on the one 90 BPM 4/4 grid, so any part lines up with any other; what has to match is harmony and texture. Parts: every 4-bar window of each mellow (1274). A part x then y is scored as the cue joins are (y's first bar against the bar that really followed x, x's last bar against the bar that really came before y; bar fingerprints from `music trims`), minus a loudness step over 3 dB; "any order" needs both ways. "Base": the parts' pitch-class profiles (cosine).

- **Solid. Two random parts rarely fit, but sets do.** Parts of different songs join both ways as smoothly as a natural bar step (0.785) only 1% of the time (median 0.52). Built greedily (one part per song, base at least 0.9): sets of 10 parts from 10 songs where every pair joins both ways at that level; 15 at 0.75; 23 at 0.70. Of 300 seeds, 256 grow to 6 parts or more at 0.75. In the Mixer's first starter set (15 parts), 198 of 210 joins are as smooth as a natural step, the rest at least 0.7.
- **Leaning, to check against the designer's transition votes (`music joins`). The join score is mostly harmony.** The bar fingerprint's weight is 74% chroma, 26% MFCC. Joins the player takes (at least 0.75; 12% of random bar pairs) have a harmony cosine median of 0.92 but a timbre (MFCC) cosine median of 0.27, against 0.43 between a song's own neighbouring bars. The MFCC part is noisy, though (neighbouring bars of one song: 10th percentile -0.36), and only 1% of accepted joins fall under that. A suspect for bad joins slipping through, not a finding yet.
- **Solid. 8-bar parts fit far less:** sets of at most 5 (natural step), 7 (0.75), 11 (0.70). 4 bars is the unit.
- Measured, not heard. The sets mix instruments (tagelharpa, nyckelharpa, strings, kantele, celesta) on one base; whether that sounds like one piece is the designer's call on the Mixer page.

### 2026-10-21: one seed in other contexts gives the same piece in step (why so many sound alike)

The designer, liking mellows on the Songs page: "so many are so similar ... it would be awesome if we could combine the similar ones perfectly." Measured on the 98 shipped calm levels (`music trims`, bar fingerprints: beat chroma and MFCC per bar, as quality.repeat).

- **Solid. Same style and take id in other contexts = variations of one piece, in step.** A style's take kN gets the same seed in every context, and only the prompt's mood and mode change. Bar-aligned similarity between such siblings: median 0.82 (44 pairs), against 0.63 for any other two songs (99th percentile 0.83). Only 2 pairs are near copies (over 0.9). 22 families cover 53 tracks, and 21 of 22 are most alike at no offset, so bar k of one sits on bar k of the other. Families as the Songs page uses them (in-step pairs, at least 0.65): 21 families, 51 tracks; the largest are violinbed k0 (5) and violinbed k1 (4). So the repetition the designer hears across the library is the seed, not SA3 reusing a tune: when a round runs one style over several contexts, the contexts share takes' skeletons. Making contexts differ needs other seeds per context (not yet changed in `music generate`).
- **Changed 2026-10-21: new sets get their own seeds.** `music generate` now gives SA3 `sa3_seed(key, n)`: the take number offset by a range from the set's key (take["sa3_seed"]), so a style's take kN in another context is another piece. Takes made before keep their seeds (and their families). To check on the next round: siblings' bar-aligned similarity should fall to the level of any two songs (0.63).
- **Leaning. Siblings combine like levels.** Switching from one to another at the same bar (the two-beat crossfade) or playing a family as a medley (each loop once, the next in step) needs no new seam. Not yet judged by ear.
- **Leaning. Any two songs often join well somewhere.** For each ordered pair, the best exit bar e in A's cued loop and entry bar s in B's: B's bar s against A's real bar e+1 and A's bar e against B's real bar s-1, minus a loudness step. Median 0.79; 54% of pairs (5145 of 9506) join at least as smoothly as a natural bar step, and every song has partners (median 57). Same group 0.81, across groups 0.79. Not built into the page yet.

### 2026-10-20: every shipped loop builds to its end, and its middle loops on its own (the cues)

The designer, on the Songs page: "so many of these start in crescendo then quickly taper." Measured on all 98 shipped tracks (`music trims`, work/songs.json), each calm level's loudness per bar against the loop's mean, averaged: bar 1 +0.4 dB, bars 2-4 -3.6 to -2.5, bars 5-12 about 0 to +0.9, bars 13-16 +1.6 to +1.8. Not yet judged by ear beyond that remark.

- **Solid. The loops are one long build, and bar 1 carries its end.** The quietest bar is bar 2 or 3 in 68 of 98 tracks; the loudest is in bars 13-16 in 53. The crescendo inside a span (round 10, the section probe) shows up here as the shape of every loop: what the designer hears as "starts big, then tapers" is the loud end wrapping into bar 1.
- **Leaning. The middle loops on its own about as smoothly as the music steps from bar to bar.** A loop from bar s to e (inside bars 2-12, 8 or 10 bars) jumps from e back to s; scored as the cosine of bar s with the bar that really follows e (beat chroma and MFCC). The best cut per track scores a median 0.78, the same as a natural bar-to-bar step (median 0.785, roughest tenth under 0.50), and 92 of 98 are no rougher than that tenth. On the battle level, with its repeating drum layers, cuts score higher (median 0.94; its own steps are higher too). Measured, not heard: the designer moves the cues on the Songs page.
- **The cost:** most best cuts are 8 bars (21 s), so a cued mellow repeats twice as often as a whole loop. The idea (the designer's): the cut-off ends, back then front (the loop's own wrap, so seamless), become the crescendo that leads into intense; the Songs page's "crescendo transition" plays that from any moment, to judge whether it works as a transition. From a mid-loop moment it takes until the start cue, up to about 8 bars.

### 2026-10-20: inpainting writes a song's next part and its joins (section probe)

The designer: the shipped music is repetitive, not catchy and abrasive over a 30-minute game (turned down to 10%); can rest music turn urgent or intense seamlessly, and can longer songs with parts be built by stitching? SA3 inpaints (a mask and the kept audio are conditioning inputs; `engine.generate(keep=, fill=)`). `research/section_probe.py` on four liked shipped tracks (night~trailer k2, night~violinbed k0, day~nyckelharpa2 k2, bloodmoon~kantele2 k3): sections written between a take's last 8 bars and its first 4 (contrast = its calm prompt, urgent = a new anxious prompt, intense = its action prompt; 6 seeds each), bridges from calm into the battle level, rest/urgent/intense levels by Demucs-stripping one recording, and a 192 s song (A, contrast, A, intense, back to A). Data: `research/data/section_probe.json`; listening page: work/clips/sections/index.html. Not yet heard by the designer.

- **Solid. SA3 sees what's kept.** It renders the kept bars back at 0.97 correlation and the same loudness (0.1 dB), so a span it writes continues from real context, in the same key (chroma cosine with the source 0.95 to 1.0 in every section).
- **Leaning. Keep both ends.** An open-ended continuation held the grid 8 bars then jumped to ~112 BPM in the first test; with the source kept after the span too, violinbed held in 6 of 6 seeds (5 of 6 open) and rose +0.5 dB to its end (+3.4 open). Over the probe: 46 of 72 sections held the 90 BPM grid for all 16 bars (violinbed 17 of 18, kantele 9 of 18, trailer 10 of 18, nyckelharpa 7 of 18): generate several seeds and keep the ones on the grid, as the generator already does.
- **Solid. Every song held the grid end to end.** All four 72-bar songs: beat consistency 0.87 to 1.00 per 4-bar window, within 19 ms of the grid. Best sections rated CE 7.1 to 8.0 (liked takes rate over ~6.7).
- **Leaning. "Intense" sections get louder, not busier, and some crescendo.** Onsets per second were within ~10% of the source (or fewer); nyckelharpa and kantele intense sections rose +12.5 and +9.3 dB to their ends, so going back to A drops 8 to 12 dB. The late crescendo (round 10) is still there inside a span. Contrast sections came out sparser where the source was busy (trailer 2.2 against 3.2 onsets/s, nyckelharpa 2.3 against 4.2).
- **Solid. Stripping a recording doesn't make rest.** Demucs-stripped rest levels (no drums, bass -6 dB) were as busy as today's or busier (onsets/s 3.0 to 5.1 against 1.9 to 5.4): the strings' ostinato lives in "other" with the melody. A restful level has to be written as such (a contrast section), not taken apart.
- **Anecdote, the designer's verdict (2026-10-20). Today's two-beat crossfade beat the written bridges**, and "drop the middle from a lot of what I already have": two states per song, mellow (calm) and intense, from the shipped takes, rather than new sections. The Songs page (sound-lab branch `music-library`) lists every shipped track that way to find the best mellows.
- **Leaning. Bridges into the battle level hold less often** in the busier takes: violinbed and nyckelharpa 8 of 8, trailer 5 of 8, kantele 2 of 8 (its 4-bar bridge 0 of 4).

### 2026-10-15: round 10, contrast and full-length consistency

The designer, on round 9 ("kinda meh"): emphasise melodic contrast and full-length consistency; SA3 "will often slip some weird stuff in toward the end trying to reach a crescendo". Round 9's leads and frame with two wording changes ("a theme in question and answer phrases, a rising phrase answered by a falling one"; "at one steady level from beginning to end"), and the generator now cuts each loop from the middle of a longer piece (4 bars after the first downbeat, 6 before the end; music.py LEAD_IN/TAIL). Measured with `research/end_drift.py` on each take's spine (the calm level). Not yet heard by the designer.

- **Solid. The late crescendo is real and common.** Round 9's loops end +3.7 dB louder than they run (mean over 9 sets; 43 of 60 loops over +1.5 dB, one +17 dB) and wander 4.3 dB bar to bar; round 6's liked violinbed: +1.6 dB, 1.5 dB.
- **Leaning. The steady wording and the middle cut help, not enough.** Round 10: end rise +2.4 dB, wander 3.1 dB (9 sets, 36 takes); best on the tagelharpa (day wander 5.6 to 2.6 dB; night end rise +5.7 to +1.5 dB), none on day~kantele. Loops cut from the middle still rise: SA3 seems to build across the whole piece, not only at its end.
- 15 seeds rejected in round 10: 6 spine beat lock, 7 layers off tempo, 1 tempo, 1 quality gate.

### 2026-10-15: round 9, melodic variety with a Nordic lead

The variety probe's words in round 6's proven frame (violinbed: drumless spine, the layers bring the drums; SA3's sentence, "BPM: 90", D minor etc., every part named, no Folk tags), a Nordic instrument carrying the theme: **kantele** ("a theme built on a three-note motif"), **tagelharpa** (bowed, "a theme with wide leaps"), **nyckelharpa** ("a cold pentatonic theme"); day, night and bloodmoon, 4 takes each on the stack profile (40 takes: day~kantele has 8). The pulse layer plays "a half-time groove" (the probe: followed, away from the house drums, better rated). Not yet heard by the designer.

- **Solid. "A syncopated groove" breaks the battle layer.** 11 of 39 seeds failed on it (battle drums at 112-120 BPM, beat spread 47-62 ms; the stretch allows 30%), against 2 of 24 with "a driving rhythm". Reverted; the half-time pulse stayed.
- **Leaning. The nyckelharpa holds the beat least.** Its sets lost the most seeds to the spine's beat lock (0.57-0.76); kantele and tagelharpa spines locked at 90.0 BPM almost every time. No take failed the quality gate.
- **Anecdote, a tool note.** `music generate --takes N` adds N new takes to a set; it doesn't top a set up to N. A stopped run loses the set in progress (the index is written per set).

### 2026-10-15: which words make new melodies and beats (variety probe)

Method: `research/variety_probe.py` (results: `research/data/2026-10-15_variety_probe.jsonl`; audio kept locally only). 1302 clips of 20 s, one fixed instrument per layer kind (the designer: constrain by instrument): a solo violin melody, a solo cello bass line, a war drum ensemble. Random pattern words: motion, scale, note rhythm, meter, tempo, mood, a genre idiom, prompt shape. Measured tempo-normalised (in beats): the drum skeleton (accents repeated across cycles, low band weighted most: fills and extra hits over the same backbone don't count), the main notes (ornaments under a quarter beat dropped) as intervals, the note rhythm in beats, the scale, CLAP timbre. Similarities centred (what every clip of the kind shares removed). Only clips Audiobox rates as good count (CE floors: melody 6.0, bass 5.8, beat 5.5). The house is our 15 themes. A wide pilot with any instrument was set aside: timbre swamped everything. Each word appeared 4 to 25 times, so effects are **Leaning** unless stated (±0.15 to 0.3 sd).

- **Solid. SA3 doesn't reuse tunes.** The same prompt over different seeds gives different notes (centred interval similarity 0.14; random prompts 0). The repetition the designer hears is not the same melody again.
- **Solid. It's the note rhythm and the scale that the prompt pins.** Same prompt, other seeds: note rhythm 0.38 to 0.40, scale 0.40, against 0 for random prompts. Our themes sit near the middle of that (nearest-house note rhythm 0.50 to 0.56, scale 0.47). Changing the seed doesn't change the feel; changing the words does.
- **Solid. Drums follow the prompt but cluster on our sound.** Drum skeletons: same prompt 0.45, random prompts 0.25, nearest house 0.64 (the highest of any layer). Only a few pattern words are followed (clips sharing them more alike): a steady march, a three-against-two polyrhythm, a blast beat, a tresillo rhythm (+0.1 to 0.2).
- **Drums, away from the house:** "a shuffle" (+0.82 sd, and better rated +0.64), "a stuttering rhythm", 6/8. Better rated: "a half-time groove" (+0.72), "a syncopated groove" (+0.73). **Rated junk:** "a slow heartbeat pulse" (-1.8 sd, solid), "sparse heavy hits" (-1.0), and "a driving eighth-note pulse" passes the gate less often (-0.51): our current drum vocabulary.
- **Violin melodies, away from the house:** "built on a three-note motif", D minor pentatonic, "cold", "with wide leaps" (wide leaps also the most unique note rhythm, +0.6). **Closest to the house:** "built from arpeggios" (-0.97 sd), "in staccato eighth notes", 160 BPM. Arpeggios also rate highest (+0.61): Audiobox likes the house sound, so pleasant and new pull apart. **Junk:** "of repeated notes" (-0.83), a whole-tone scale, Genre: Horror.
- **Cello bass lines:** "a pulsing pedal note" makes one thing every time and it is the house (-1.19 sd); "a walking bass line", "grim", "a slow bass line that answers itself" and "long held low notes" move away. The sentence shape rates better than tags for a bass line (+0.42 against -0.49).
- **Anecdote (n 4 to 7). Genre words move a melody most** (Arabic maqam, tango, East Asian, industrial pull it furthest from the house) but risk the designer's no-folk rule; Gregorian and medieval rate well for the bass.
- Not measured: whether a listener hears these as new. Next: a round built from the "away" words (and Nordic instruments), judged by ear.

### 2026-10-15: whole-length layers (a bed, a melody, drums): what splits and what doesn't

Method: `research/layers_probe.py` on four liked round-5/3 themes (night~trailer k2, day~strings k2, day~war2 k0, bloodmoon~bed2 k0). Demucs (htdemucs) for separation; then audio-to-audio from the drumless bed prompted for a solo cello or horn melody at strengths 0.4, 0.55, 0.7. Measured: harmony agreement with the bed per bar (chroma, as quality.drift), notes sounding at once per beat (a melody is ~1), Audiobox content enjoyment.

- **Solid. Separation gives a bed and drums, not a melody.** On our orchestral takes Demucs puts the melody and the harmony together in "other"; vocals are near silent (-60 dB; -23 in the one with a choir-like part). Drums are a real layer even where the prompt asked for none (bed2: drums -7 dB under the mix: low booms). So bass + other is a drumless bed, and the drum stem is the take's own drum layer. About 0.5 s per take.
- **Solid. A separate melody layer can't be derived from a bed.** No strength gives both: at 0.4 the result fits the bed (agreement 0.97) but is still a full texture (3-5 notes at once); at 0.7 it nears a single line (1.3-2.3) but clashes (agreement 0.4-0.6, bars down to 0.13), and the horn falls apart (CE 4.0). The same root limit as everywhere: the model doesn't follow given chords.
- **Leaning. At 0.4, audio-to-audio re-orchestrates a whole theme and keeps its notes**: a new lead colour (cello, horn) at the bed's quality (CE 7.2-7.3 against 7.4). A theme can have several orchestrations. Needs the designer's ears.

### 2026-10-15: rounds 7 and 8, the drumless style in every season, and a winter power round

Round 7: the two round 6 styles that won (violinbed, violin) in winter, bloodmoon and menu, 4 takes each, stack only. Round 8: four ways to carry a winter score on the same drumless spine (winterstrings: high tremolo strings; winterwater: a waterphone moaning over a brass line; winterglass: a celesta; winterchoir: a low male choir), 5 takes each, stack only. Styles are in Emberhold's `soundlab_project.py`.

- **Solid. The drumless spine holds across seasons.** Round 7: violinbed 10 of 12 takes liked (bloodmoon 4 of 4, winter 4 of 4, menu 2 of 4); violin 5 of 12 (bloodmoon 3 of 4, winter 2 of 4, menu 0 of 4). With round 6 (8 of 8 in night and day) violinbed is 18 of 20, and it beat violin in every context. No take was disliked in either round. (`r20`)
- **Leaning. In winter a waterphone or a celesta over the drumless spine won.** winterwater 5 of 5 liked, winterglass 5 of 5, winterstrings 1 of 4, winterchoir 0 of 1. The two icy, metallic or glassy carriers won; the shivering tremolo strings, the one carrier already in the instrument pool, mostly lost. One round, one context, and the likes can't say what the takes sound like (I can't hear), so this is a direction, not a rule. (`r21`)
- **Measured. Choirs still struggle.** winterchoir made 1 take in 14 tries: 12 seeds rejected, most by the quality gate (calm rated 5.8 to 5.9 against 6.3; tension 6.2 to 6.7 against 6.8), one by the tempo check (95.5 BPM, beat spread 58 ms). The gate's thresholds were validated against likes in non-choir styles, so it may be too strict for a choir; untested.
- **Measured. Everything else ran clean.** 2 to 4 seeds rejected per set at most, none by the quality gate outside the choir.
- Shipped 2026-10-15: 17 takes from round 6 and 26 from rounds 7 and 8 (`music promote --add`, nothing removed): 67 tracks in the game, winter 3 to 20, bloodmoon 7 to 14, menu 3 to 5, night 2 to 11, day 6 to 14.

### 2026-10-15: round 6, a solo violin as the pace and the hook (liked, but no violin heard)

The ask: a catchy violin-like stringed instrument that is both the pace and the melody. Prompts written from the tuning (`r15` to `r19`), in three styles in `soundlab_project.py`: **violin** (SA3's sentence shape, a light pulse and a drum under the violin), **violintags** (the same in the tag shape) and **violinbed** (no drums in the spine; the stack's layers bring them). Run on night and day, 4 takes each, profiles stack and close (`music generate --contexts night day --styles violin violintags violinbed --takes 4 --profiles stack close`).

How the prompts were written (the recipe, so it can be reused):

- **Describe the playing, not the goal.** At cfg 1.0 the model takes words literally and has no way to know what "catchy" or "the pace" means. "Pace" became a fast repeating note value ("in fast, driving eighth notes", "fast staccato eighth notes"); "catchy" became a short theme that repeats ("a short two-bar theme that repeats"). The goal words themselves ("catchy", "memorable") were left out.
- **Level by note value.** Calm: a slow, haunting two-bar theme that repeats. Tension (the spine): fast, driving eighth notes that set the pace. Action: sixteenth notes that race. One idea per prompt.
- **The proven frame, unchanged.** SA3's one-sentence shape ("Dark cinematic war score in D minor with a solo violin playing ..., creating ominous, dark tension. BPM: 90."), Genre: Cinematic, Orchestral, Medieval (`r18`), "BPM: 90" always and the key as "D minor" (`r17`), every part named (`r14`), no "menacing", no negations.
- **An orchestral soloist, not a fiddle.** "A solo violin", with no Folk or Nordic tag: the designer's no-folk rule (`tuning.json` taste) lists fiddles, and Audiobox rates folk fiddles high, so the quality gate wouldn't catch a drift to folk.
- **Something rhythmic still under the lead.** The violin sets the pace, but the spine also names a low string pulse and a drum (violin, violintags). The probe found takes with rhythm parts hold tempo better and string sections less so (`r18`), so a lone violin risked the tempo check. violinbed is the version with no drums in the spine, and the layers (pulse, battle) bring them.
- **Fix only the lead.** The violin is written into the style; the low string, the strings section and the drum are still drawn per take from the instrument pool, so the takes differ in more than the seed (`r19`, "same basic DNA").

What was measured (Emberhold, 28 seeds tried):

- **Solid. Clean takes.** 24 takes passed, 4 seeds were rejected (2 spine beat lock, 1 tempo, 1 level lock). The quality gate rejected none; every set made its 4 takes. Compare round 3, which threw out 45 seeds for 35 takes.
- **Anecdote. The designer liked them, and heard no violin.** First reaction: "every single one of these are amazing." Asked whether any had something close to a violin: no. So the phrasing did not make SA3 play a violin. The takes are good music, but not the ask. (An earlier version of this entry called it "a recipe that worked"; that was wrong, and `r20` now says so.)
- **Solid for the night and day. The votes: violinbed 8 of 8 takes liked, violin 5 of 8, violintags 4 of 8** (17 of 24 liked; every like was on the stack profile, none on close). The spine with no drums, where the layers bring the percussion, won every take. Whether a violin was in them is separate: none was heard. Shipped 2026-10-15 as 17 tracks beside the existing ones (`music promote --add`): day 6 to 17 tracks in rotation, night 2 to 11.
- **Not known why.** Candidates: the violin was one part among an orchestral sentence ("dark cinematic war score", Genre: Orchestral, a low string, a drum) and was outweighed; SA3 may not make a solo violin in a full-score prompt; or at all. The index's per-take `instruments` list never named a violin (it only lists pool instruments), so it can't tell. Nobody measured whether a violin is in the audio, and I can't hear.
- **Next, untested.** Audition a violin alone (TrackType: Instrument) to see if SA3 makes one; then a spine where it is the only melodic part with fewer competing words.

To do: test the violin by itself (TrackType: Instrument), then a spine with it as the only melodic part. Round 7 (winter, bloodmoon, menu; violinbed and violin) fills the contexts this round didn't cover.

### 2026-10-15: round 5, the probe's rules applied ("way way better")

Prompts written from the probe (`r17`, `r18`) and round 3's votes: SA3's sentence shape with Genre: Cinematic, Orchestral and Medieval; four named parts (theme, ostinato, bass line, rhythm); "BPM: 90" always; the key by its common name where one exists (night "D minor"); no "menacing"; no chant, bullroarer, bowed cymbal or hurdy-gurdy in the spine. Three styles: war2 (brass theme), bed2 (the same without drums, so the layers supply them), strings (the strings carry the theme). Levels as close, layered and stack.

- **Anecdote, but a strong one.** The designer, on the first sets: "these are way way better."
- **Solid. Cleaner takes.** All 9 sets, 36 takes: the quality gate rejected none, and only 5 seeds failed the tempo check (41 tried). Round 3 threw out 45 seeds for its 35 takes.
- **Solid. Stack wins.** All 14 likes in round 5 were on the stack profile, across all three styles and all three contexts (calm = the spine itself, quieter; tension and action = the spine plus the drum layers; no audio-to-audio). The designer: stack for every song. All 24 shipped tracks are stack since 2026-10-15. (`r19`)
- **Anecdote, the designer. A fixed template makes everything sound alike.** "Same horn, same synth punches, beat intensity, same basic DNA." Every take shared one sentence frame, three moods and the same few instruments, so the variety came only from seeds. The next round has to vary what carries the music, not just the seed.
- **Anecdote, the designer. Clever prompts degrade fast.** "When you try to get too clever with it, the model starts degrading reallll fast." It agrees with the sound-effect finding (short and literal wins) and with the probe (more parts or more words didn't help). Vary one thing at a time and keep prompts plain.
- **Anecdote.** night~bed2 k0 (close), thumbed down: "horn sounds off tune, and is mixing some crazy shit that dont mix."

### 2026-10-15: what in a music prompt makes takes sound off (prompt probe)

Method: `research/music_probe.py` (raw results: `research/data/2026-10-15_emberhold_probe.jsonl`; the audio was kept locally only). Random prompts from a factor space: prompt shape, genre tags, line-up and part count, what each part does, mood and intensity words, how tempo and key are written, a recording phrase, the VocalType tag. One 48 s take each, scored by Audiobox Aesthetics content enjoyment (CE, see below) and by the generator's tempo check (does it hold 90 BPM steadily). Ridge regression over all factors at once, so a weak instrument isn't blamed on the genre it was paired with. 188 prompts in total (78-prompt pilot, then 110 in the main run, stopped early to free the GPU). Only effects with the same sign in both runs are kept. Seed noise: one fixed prompt over 16 seeds spreads ±0.5 to 0.9 CE, so single takes say little.

- **Solid. Always write the tempo.** Without "90 BPM" or "BPM: 90", 5% of takes hold a steady beat; with it, about 50% (effect -0.43 ±0.06). An unsteady take is a rejection, so a prompt without a tempo wastes almost every generation. (`r17`)
- **Leaning. Write the key as a common name.** "D minor" is steadier than "D aeolian" (+0.14 ±0.06), though it's the same scale; leaving the key out lowers CE (-0.19 ±0.12). (`r17`)
- **Leaning. What lowers the rating** in dark cinematic music, on average: "menacing" (-0.47), monks' chant (-0.34), Genre: Horror (-0.33), and in a mix trombones/tuba, hurdy-gurdy, bullroarer, bowed cymbal (about -0.3 each). **What raises it:** an ostinato part (+0.37), Genre: Orchestral and Genre: Medieval (+0.33). These are averages, not bans: the designer's favourite take has trombones. (`r18`)
- **Leaning. What makes takes steadier:** parts with rhythm (a drum pounding a rhythm +0.21, a theme, a bass line), "fierce" and "mournful". Less steady: calm prompts, "tense", Fantasy and Dark Ambient genres, the string section. (`r18`)
- No clear effect from the prompt shape (tags, tags only, SA3's assistant sentence, paragraph) or from the number of parts (2 to 6).
- Speed: about 2.4 s per 48 s music take on a 4070 Ti SUPER.

### 2026-10-14: derived levels can't add intensity; layers can

SoundLab's music generates a spine (the tension level) from text, then derives calm and action from it with audio-to-audio.

- **Solid. At strength 0.5 the three levels are the same music at three volumes.** Round 3, 35 takes: onsets per second, punch (crest) and energy under 150 Hz matched within about 3% across calm, tension and action. The designer's complaint, "action rarely intense enough", was this. (`r12`)
- **Solid. Raising action's strength doesn't help.** At 0.65 and 0.8, action got looser, not busier: onsets down 0.5 to 1.7 per second in 3 of 4 styles, low end 0.16 down to 0.10. Both profiles were tried and removed.
- **Leaning. Derived levels also wander and drop out.** 18 calm levels in rounds 3 and 4 had dropouts (loudness more than 15 dB under the median) of up to 11 s in total. Tension and action had them about as often. Audio-to-audio re-imagines the spine, so at any moment a derived level may rest or change chord where the spine doesn't. Hence the idea of a "stack": every level built from the spine itself plus layers (not yet tried).
- **Solid. Layers work technically.** Percussion stems generated from text, tempo-corrected onto the grid, looped, beat-snapped and rotated to the spine's bar accents land within a few ms. Percussion has no pitch, so it can't clash with the harmony. Whether they make action intense enough is still waiting on the designer's votes.
- **Solid. SA3 plays "intense" drums too fast.** Asked for 90 BPM, a battle drum stem came out at 116. Percussion stretches cleanly, so stems are allowed a 30% tempo correction (music spines only 6%).
- **Solid. Seed layer stems per set, not per take seed.** The layer prompts don't change between sets, so seeding by the take's seed gave every set's k3 the same drums (and the same failures).
- **Solid. Choirs have a weak beat.** Choir-led spines fail the tempo check far more (day choir: 2 of 14 seeds passed). Use them as a layer or colour, not to carry the pulse.

### 2026-10-14: prompting music (rounds 1 to 3, the designer's votes)

- **Solid. Folk tags make folk music.** "Genre: Folk, Genre: Nordic" plus fiddles and lyres carrying the theme gave folk music, however dark the words. Round 2 ("grim", "ritual", "dread", "epic") got no likes and was heard as folk. The designer's direction since: no folk (taste in `tuning.json`).
- **Anecdote. A mood word alone steers the genre.** "warm", "a quiet moment after the day's work" and "folk dance" made pastoral music for a war game. Start from the game's genre and stakes. (`r11`)
- **Leaning. SA3's own prompt-assistant shape works for music.** One flowing sentence: "Dark cinematic war score in D aeolian with trombones playing a grim theme, low strings driving a dark ostinato and a drum ensemble pounding a heavy martial rhythm, creating ominous, dark tension. BPM: 90." Round 3, likes per style: trailer (this shape) 5, war (tag shape, same content) 5, horror 2, choir 1. The designer's favourite so far is in this shape (night~trailer k2, shipped). (`r15`)
- **Anecdote. Name every part of the arrangement.** Three parts left takes thin ("always missing a layer, either a melody or intense rhythm"). (`r14`)
- **Leaning. Round 2's spines repeated.** "Repeats a short figure" and "sparse, lots of space" made a dull calm, since calm inherits the spine. (`r12`)

### 2026-10-14: instrument auditions

13 dark candidates, each auditioned in two prompt shapes with the same content, 4 seeds per shape. The designer picked a take of every one.

- **Leaning. The tag shape wins for ensembles and voices**: choirs, chant, string and brass sections, drum ensemble, timpani, waterphone (9 of 13). **SA3's assistant shape wins for unusual sound-makers**: bowed cymbal, bullroarer, bagpipes, throat singing (4 of 13). (`r13`)
- **Solid. Voices are possible.** SA3's prompt assistant (`stable_audio_3/interface/reprompt.py`) treats any vocal word as a failure, yet wordless choirs and chant auditioned well. Leave out "VocalType: Instrumental" for them.

### 2026-10-14: how SA3 wants its prompts (from its own code)

- **Solid.** `reprompt.py`, Stability's prompt assistant, writes music as one sentence of the form "<genre> with <main instruments>, <supporting layers>, and <percussion> creating <mood>. BPM: X." (under about 45 words), and instruments as "TrackType: Instrument, <instrument> <style> motif loop with <character>. BPM: X." Its "Length: N seconds" is stripped by the UI, which sets the duration from it: leave it out of prompts.
- **Solid.** "TrackType: Music, VocalType: Instrumental" are real training-data tags and help coherence (SA3's prompting guide).

### 2026-10-14: sound effects (earlier rounds)

Emberhold's sound-effect rounds, recorded as `r1` to `r10` in `tuning.json`: short literal prompts of about 18 words won (core 25% of sounds, tags 20%, vivid 14%, a mixing-engineer adjective tail 14%); no negations (no negative prompt at cfg 1.0); no game lore; split multi-part sounds; natural recordings used whole.

---

## Audiobox Aesthetics (Meta), used as the music quality detector

### 2026-10-14/15: it predicts the designer's likes

- **Solid (for this designer and these styles).** Content enjoyment (CE) on the spine told liked from unliked takes with AUC 0.82 (calm 0.79). 35 round-3 takes, 13 liked. Within choir and horror, the liked takes were the top-rated. No liked take rated under 6.74 calm, 6.94 tension or 6.37 action, while 9 of 22 unliked takes did. Those floors are SoundLab's quality gate (`soundlab/quality.py`, `r16`).
- **Solid. It caught the round 4 takes the designer called weird** (bloodmoon~anthem k0 and k1: rated 6.4 to 6.5, or 7.7 s of calm dropouts).
- **Solid. It scores pleasantness, not direction.** It rates folk fiddles and flutes high (+0.7 in the probe pilot), the opposite of the designer's taste. Use it to catch broken takes, not to choose a style.
- **Leaning. Among good takes it can't tell taste apart.** War and trailer takes all rated 7.2 to 7.7, liked or not.
- **Solid. The hand-made checks predicted little.** Key fit and sudden-change novelty were near chance (AUC ~0.5), drift from the spine 0.35. Long dropouts appear in liked takes too (composed breaks), so they only warn.
- Setup: `audiobox_aesthetics` (pip), about 1 s per file. Its model must be in SoundLab's Hugging Face cache, because the generator runs offline; `install.py` puts it there. A missing model once crashed the probe.

---

## MOSS-SoundEffect v2.0

### 2026-10-14

- **Solid.** Fed the same prompts as SA3, it won 1 of 7 sounds; 3 of 84 takes were silent. Prompts written for SA3 don't carry over. It takes a negative prompt; its own style still needs finding. About 24 s per take against under 1 s for SA3. (`m1`, `m2`)

# What we've learned about the models

A dated log of findings about the models SoundLab uses: what we tried, how we measured it, what came out. `tuning.json` holds the working rules agents follow (ids like `r17`); this file keeps the story and the evidence behind them, including what didn't work, so nobody has to rediscover it. Newest first within each model. Add to it whenever a round, probe or measurement teaches something.

How findings are graded:
- **Solid**: a large effect against the noise, or confirmed twice.
- **Leaning**: consistent in direction, but the sample is small; treat as a starting point.
- **Anecdote**: one designer remark or one case; worth testing, not a rule.

---

## Stable Audio 3 Medium (SA3)

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

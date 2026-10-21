Yes. **MuseCritic is the closest match to an actual “listen to this music and judge it” LLM that I found.** **MOSS-Music** is another strong candidate, particularly for explaining what is happening musically rather than just assigning a score. Both publish Apache-2.0-licensed model checkpoints. [Hugging Face](https://huggingface.co/WuqnEl/MuseCritic)

The important distinction is **a model that can discuss music** versus **a model specifically trained to predict whether people think the music is good**.

## 1. MuseCritic: the most directly relevant music critic

**Hugging Face:** `WuqnEl/MuseCritic`  
**Code:** `WuqnEl/MuseCritic`

This is a 2026 project built on **MOSS-Audio-8B-Instruct**. It listens to a song, generates a written critique, and then produces five continuous scores between 1 and 5 covering **coherence, musicality, memorability, structural clarity, and vocal naturalness**. Its released inference code returns both the critique and the scores. [arXiv](https://arxiv.org/html/2608.11755v2)

That makes it a much closer fit for “does this composition actually work?” than simply asking a general audio chatbot to invent a rating.

**The catch for your music:** it was trained primarily on English and Chinese **vocal songs**. I would test whether its judgments agree with yours before trusting it with instrumental RTS tracks, orchestral loops, or sparse atmospheric pieces. Its authors also note that generating criticism before scoring makes it more expensive than a direct scoring model. [arXiv](https://arxiv.org/html/2608.11755v2)

## 2. MOSS-Music: my first candidate for detailed musical feedback

**Hugging Face:** `OpenMOSS-Team/MOSS-Music-8B-Instruct`  
**Alternative:** `OpenMOSS-Team/MOSS-Music-8B-Thinking`

This is a music-specialized audio-language model, with approximately **9.1 billion total parameters** including the audio components. Its documented tasks include music descriptions, structural analysis, chord/key/tempo reasoning, lyrics transcription, and questions about full musical pieces. The models are Apache-2.0 licensed. [Hugging Face](https://huggingface.co/OpenMOSS-Team/MOSS-Music-8B-Instruct)

For your Stable Audio experiments, I would test it with specific questions rather than “rate this out of ten,” for example:

> Identify the recurring theme, rhythmic pulse, bass part, and supporting instruments. Describe where the arrangement becomes thin or crowded. Does the main theme recur recognizably? Separate audible observations from uncertain interpretations.

**I would use this as an analyst, not assume it is a calibrated taste judge.** Its published evaluations primarily establish music understanding and captioning, not reliable agreement with your preferences. [Hugging Face](https://huggingface.co/OpenMOSS-Team/MOSS-Music-8B-Instruct)

## For automatically ranking lots of generations

These are **not LLMs**, but they are worth considering alongside one:

| Model | What it provides | Important limitation |
|---|---|---|
| **TuneJury** | A preference score trained from approximately 17,500 human A/B judgments. Its stated scope is **instrumental music**, making it particularly relevant here. | Main checkpoint is **noncommercial**. A separate Apache-2.0 CLAP-only variant exists, but it is not the same model as the primary release. [Hugging Face](https://huggingface.co/TuneJury/tunejury) |
| **Meta Audiobox Aesthetics** | Separate predictions for production quality, content enjoyment, production complexity, and content usefulness. Includes a batch-scoring interface. | No written musical criticism. Released under **CC-BY-4.0**. [GitHub](https://github.com/facebookresearch/audiobox-aesthetics) |
| **MuQ-Eval** | Per-clip generated-music quality prediction. The repository reports approximately **3–4 GB VRAM** for its main variants. | The project is MIT-licensed, but its default **MuQ backbone weights are noncommercial**. Do not treat the entire stack as permissively licensed. [GitHub](https://github.com/dgtql/MuQ-Eval) |

**Music Flamingo** is also worth knowing about. NVIDIA offers music-focused question answering and reasoning, including the `music-flamingo-think-2601-hf` checkpoint. However, its **NVIDIA OneWay Noncommercial License** makes it less attractive for a commercial game-development pipeline than the Apache-licensed MOSS options. [Hugging Face](https://huggingface.co/nvidia/music-flamingo-think-2601-hf)

## What I would use for your SA3 tracks

My starting combination would be **MOSS-Music for musical observations + Audiobox Aesthetics for a separate quality signal**, then trial **MuseCritic** against a set of tracks you have already accepted or rejected. I would keep “matches the requested arrangement,” “sounds technically clean,” and “I actually like it” as separate judgments rather than immediately blending everything into one score.

There is a good reason for that caution: an **October 9, 2026 preprint** tested five audio-language judges and found substantial sensitivity to question wording and clip order. In its paired-clip setup, Music Flamingo selected the second clip in 99% of pairs. That study did **not** evaluate MuseCritic or MOSS-Music, so it is a warning about evaluation methods, not evidence that those two have the same failure. [arXiv](https://arxiv.org/html/2610.13247v1)

**My picks: MuseCritic for “critique and score this”; MOSS-Music for “tell me what works musically”; Audiobox Aesthetics for an additional batch-scoring signal.**

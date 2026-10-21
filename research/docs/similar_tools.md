# Seamless Music Piece App Research
So my goal here is to basically have you generate things based on rules and filtering, but we may be missing out on some serious tech. I don't want to cause more work for myself, so it is important that the tool enhance a similar workflow, otherwise we should just dig into the repo for useful bits our current tool/process is missing. Although some of these look pretty nuts. Musloop is basically tailor made for what we're doing, although it looks like one of the weaker apps in the list (based on a picture in README.md so don't take my word on that). Our generation variety is certainly a weak point, even after an overnight run most tracks sound basically the same. This also could make our music graph plan much easier.

## Stem / Mixing / Generating Tools
https://github.com/inikolax/remiqora/tree/master
https://github.com/azerothl/song-maker
https://github.com/weellio/waivepulse
https://github.com/pymss-project/pymss-studio
https://github.com/andremichelle/openDAW
https://github.com/Siziff/musloop
https://github.com/stemdeckapp/stemdeck

## The useful backend projects
| Project | What it contributes | Where I would use it |
|---|---|---|
| **[python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator)** | Python API/CLI supporting multiple separation-model families, including Demucs, MDX, VR, and RoFormer models. | The extraction backend behind a custom stem editor. ([GitHub][1]) |
| **[Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training)** | Model selection, inference, ensembles, training, and a substantial pretrained-model collection. | More specialized splitting and experimentation with which model works best for a particular source. ([GitHub][2]) |
| **[DawDreamer](https://github.com/DBraun/DawDreamer)** | Python-controlled audio routing, effects/instruments, time stretching, looping, pitch warping, automation, and rendering. | A programmable engine for arranging and exporting combinations of clips and stems. ([GitHub][3]) |
| **[Spotify Pedalboard](https://github.com/spotify/pedalboard)** | Effects processing, including gain, compression, limiting, filtering, reverb, delay, pitch shift, and VST3 support. | Processing stems and rendering consistent effect chains across a collection of clips. ([GitHub][4]) |

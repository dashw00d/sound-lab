## Plays a Sound Lab sync folder in Godot 4 as the lab's Mixer plays it: the scene walk (soundlab_walk.gd, a port of the
## folder's walk.js) picks each step, and this puts it on the bar grid: each song's mellow and intense layers together,
## sample-aligned, the state crossfading between them; a new song crossfading over the join, a song going round its
## loop over 80 ms; between scenes, straight on, a pad, or a rest tapering or ringing out; stingers at a scene change;
## levels evened and matched. It's a
## reference: read it, copy it, change it. See the sync folder's README.md for the rules it follows.
##
## Timing: Godot can't start a sound at a future time, so each voice starts in the frame its time falls inside the next
## audio mix, from the file position it should have reached by then (AudioServer.get_time_to_next_mix): layers and
## songs stay in step to within a mix. Fades are set every frame and Godot smooths volume across a mix.
## Not here: the bass swap (it needs each song split at play.bassSwap.hz onto two buses) and the echo tail (a delay on
## a bus); echo plays as ring.
class_name SoundLabMusic
extends Node

const Walk := preload("res://soundlab/soundlab_walk.gd")

signal step_started(step: Dictionary)  ## each step as it starts (for a now-playing display)

@export var folder := "res://soundlab"  ## the sync folder: res://... or an absolute path
@export var bus := &"Master"
@export var walk_seed := 0  ## 0: a new walk each time; else the same walk for the same seed
@export var autoplay := false

var manifest: Dictionary
var walk
var playing := false

const AHEAD := 6.0  ## seconds of music decided ahead

var _bar := 0.0
var _beat := 0.0
var _next_t := 0.0
var _voices: Array = []  ## {players, t0, pos0, end_t, fades, gain, match, started, visit, next_bar}
var _cur = null  ## the voice of the visit decided last
var _after_rest := false
var _pending_steps: Array = []  ## steps decided, waiting for their time (for step_started)
var _intense := false
var _w_from := 0.0
var _w_to := 0.0
var _w_t0 := -1.0
var _streams := {}
var _last_stinger := {}


func _ready() -> void:
	var f := FileAccess.open(folder.path_join("soundlab.json"), FileAccess.READ)
	if f == null:
		push_error("SoundLabMusic: no soundlab.json in %s (sync the music into it from Sound Lab's Game page)" % folder)
		return
	manifest = JSON.parse_string(f.get_as_text())
	_bar = float(manifest.grid.barSeconds)
	_beat = _bar / float(manifest.grid.beatsPerBar)
	var random := Walk.seeded(walk_seed) if walk_seed != 0 else Callable()
	walk = Walk.new(manifest, random)
	if autoplay:
		play()


## Play the walk from where it is (a fresh walk the first time).
func play() -> void:
	if playing or walk == null:
		return
	playing = true
	_next_t = _clock() + 0.15


## Stop at once (a quick fade); play() goes on with the walk where it was.
func stop() -> void:
	playing = false
	var now := _clock()
	for v in _voices:
		v.fades.append([now, now + 0.08, "line_out"])
		v.end_t = minf(v.end_t, now + 0.08)
	_cur = null
	_pending_steps.clear()


## Mellow or intense: the two layers of every song crossfade equal-power over play.stateChange.beats beats.
func set_intense(on: bool) -> void:
	if on == _intense:
		return
	_w_from = _state_weight(_clock()); _w_to = 1.0 if on else 0.0; _w_t0 = _clock(); _intense = on


func is_intense() -> bool:
	return _intense


## What to keep in the save, so the music stays fresh across sessions: pass it to the walk next time (walk.remember).
func memory() -> Dictionary:
	return walk.memory() if walk != null else {}


func _process(_delta: float) -> void:
	if walk == null:
		return
	var now := _clock()
	while playing and _next_t - now < AHEAD:
		var step = walk.next_step()
		if step == null:
			playing = false
			break
		if step.kind == "rest" and manifest.play.get("betweenScenes", "rest") == "straight":
			continue  # (straight on: the next scene's first song comes in at once, as any new song)
		_schedule(step, _next_t)
		_next_t += step.bars * _bar
	var mix_at := now + AudioServer.get_time_to_next_mix()
	for v in _voices:
		if not v.started and v.t0 <= mix_at:
			v.started = true
			for p in v.players:
				p.play(maxf(0.0, v.pos0 + (mix_at - v.t0)))
	while _pending_steps.size() and _pending_steps[0].t <= now:
		step_started.emit(_pending_steps.pop_front().step)
	var w := _state_weight(now)
	for v in _voices.duplicate():
		if now > v.end_t + 0.1:
			for p in v.players:
				p.queue_free()
			_voices.erase(v)
			continue
		var g := _fade(v, now)
		for i in v.players.size():
			var layer: float = v.layer_w[i]
			var sw := 1.0 if layer < 0 else (sqrt(1.0 - w) if layer == 0 else sqrt(w))
			v.players[i].volume_db = linear_to_db(maxf(g * _level(v, i, now) * sw, 1e-5))


func _clock() -> float:
	return Time.get_ticks_usec() / 1e6


func _state_weight(now: float) -> float:
	if _w_t0 < 0:
		return _w_to
	var k := clampf((now - _w_t0) / (float(manifest.play.stateChange.beats) * _beat), 0.0, 1.0)
	return sqrt(_w_from * _w_from * (1.0 - k) + _w_to * _w_to * k)


## A step on the grid at time t, joined to what came before (README "Joining steps").
func _schedule(step: Dictionary, t: float) -> void:
	_pending_steps.append({step = step, t = t})
	var P: Dictionary = manifest.play
	if step.kind == "rest":
		var pad = manifest.songs[_cur.song].get("glue") if _cur != null else null
		if pad != null and P.get("betweenScenes", "rest") == "pad":  # (the song's pad: rising over the bar before, falling over the next song's first)
			var g := AudioStreamPlayer.new()
			g.stream = _stream(pad); g.bus = bus; add_child(g)
			_voices.append({players = [g], layer_w = [-1], t0 = t - _bar, pos0 = 0.0, end_t = t + (step.bars + 1) * _bar,
				fades = [[t - _bar, t, "power_in"], [t + step.bars * _bar, t + (step.bars + 1) * _bar, "power_out"]],
				gain = {mellow = 1.0}, match = null, started = false, visit = -1, next_bar = -1, song = ""})
			_cur.fades.append([t - _bar, t, "power_out"]); _cur.end_t = t
		elif _cur != null:
			if P.rest.tail == "taper":
				_cur.fades.append([t - _bar, t, "taper"]); _cur.end_t = t
			else:  # (ring; echo plays as ring here)
				_cur.fades.append([t, t + 0.66, "decay"]); _cur.end_t = t + 0.66
		_cur = null; _after_rest = true
		return
	var song: String = step.song
	var at: float = (step.bar - 1) * _bar  # (where the step's first bar is in the file)
	if _cur != null and _cur.visit == step.visit.id and _cur.next_bar == step.bar:
		_cur.end_t = t + step.bars * _bar; _cur.next_bar = step.bar + step.bars  # (the song goes on)
		return
	var xf: float
	var curve: String
	if _cur != null and _cur.visit == step.visit.id:
		xf = float(P.step.seconds); curve = "line"  # (round its loop)
	elif _after_rest or _cur == null:
		xf = 0.08; curve = "power"
		if _after_rest:
			_stingers(t)
	else:
		xf = float(P.join.seconds); curve = "power"  # (a new song)
	var h := xf / 2.0
	var v := _voice(song, t - h, at - h, t + step.bars * _bar)
	v.visit = step.visit.id; v.next_bar = step.bar + step.bars
	v.fades.append([t - h, t + h, curve + "_in"])
	var own := {mellow = db_to_linear(float(manifest.songs[song].gainDb.mellow)), intense = db_to_linear(float(manifest.songs[song].gainDb.intense))}
	v.gain = own
	if _cur != null:
		_cur.fades.append([t - h, t + h, curve + "_out"]); _cur.end_t = t + h
		if _cur.visit != step.visit.id and P.matchLevels.on:
			v.match = _match(_cur, song, step.bar, t, own)
	_cur = v; _after_rest = false


## A voice: a song's two layers, from file position `pos` at time t0, until `end_t`.
func _voice(song: String, t0: float, pos: float, end_t: float) -> Dictionary:
	var players: Array = []
	for state in ["mellow", "intense"]:
		var p := AudioStreamPlayer.new()
		p.stream = _stream(manifest.songs[song].files[state]); p.bus = bus
		add_child(p); players.append(p)
	var v := {players = players, layer_w = [0, 1], t0 = t0, pos0 = maxf(0.0, pos), end_t = end_t, fades = [], gain = {mellow = 1.0, intense = 1.0},
		match = null, started = false, visit = -1, next_bar = -1, song = song, last_pos = pos}
	if pos < 0:
		v.t0 = t0 - pos  # (no audio before bar 1: it starts a little later)
	_voices.append(v)
	return v


## The incoming song's level where it comes in: its first beat at the level of the outgoing song's last, within ±6 dB of
## its own gain, then easing to its own over 2 bars.
func _match(out_v: Dictionary, song: String, bar: int, t: float, own: Dictionary):
	var m := {}
	for state in ["mellow", "intense"]:
		var a = manifest.songs[out_v.song].loudness[state]
		var b = manifest.songs[song].loudness[state]
		if a == null or b == null:
			return null
		var beats := int(manifest.grid.beatsPerBar)
		var last: float = a[posmod((out_v.next_bar - 1) * beats - 1, a.size())] + float(manifest.songs[out_v.song].gainDb[state])
		var first: float = b[posmod((bar - 1) * beats, b.size())]
		var own_db := float(manifest.songs[song].gainDb[state])
		m[state] = db_to_linear(clampf(last - first, own_db - 6.0, own_db + 6.0))
	return {from = m, t0 = t, t1 = t + 2.0 * _bar}


func _level(v: Dictionary, i: int, now: float) -> float:
	var state := "mellow" if i == 0 else "intense"
	if v.layer_w[i] < 0:
		return v.gain.mellow
	var own: float = v.gain[state]
	if v.match == null or now >= v.match.t1:
		return own
	var k := clampf((now - v.match.t0) / (v.match.t1 - v.match.t0), 0.0, 1.0)
	return lerpf(v.match.from[state], own, k)


## The product of a voice's fades at time `now`.
func _fade(v: Dictionary, now: float) -> float:
	var g := 1.0
	for f in v.fades:
		var t0: float = f[0]
		var t1: float = f[1]
		var k := clampf((now - t0) / maxf(t1 - t0, 1e-4), 0.0, 1.0)
		match f[2]:
			"line_in": g *= k
			"line_out": g *= 1.0 - k
			"power_in": g *= sin(k * PI / 2.0)
			"power_out": g *= cos(k * PI / 2.0)
			"taper": g *= 0.0 if k >= 1.0 else pow(10.0, -2.4 * k * k)
			"decay": g *= 0.0 if k >= 1.0 else pow(10.0, -2.4 * k)
	return g


## A scene change's stingers (README "Stingers"): a riser ending on t, a boom or a crash starting on it.
func _stingers(t: float) -> void:
	var P: Dictionary = manifest.play.get("stingers", {})  # (an older manifest has none)
	for kind in ["riser", "boom", "crash"]:
		var files: Array = manifest.get("stingers", {}).get(kind, [])
		if not P.get(kind, false) or files.is_empty():
			continue
		var pick: String = files[randi() % files.size()]
		if files.size() > 1:
			while pick == _last_stinger.get(kind, ""):
				pick = files[randi() % files.size()]
		_last_stinger[kind] = pick
		var stream := _stream(pick)
		var p := AudioStreamPlayer.new()
		p.stream = stream; p.bus = bus; add_child(p)
		var length := stream.get_length()
		var t0 := t - length if kind == "riser" else t
		_voices.append({players = [p], layer_w = [-1], t0 = maxf(t0, _clock()), pos0 = maxf(0.0, _clock() - t0), end_t = t0 + length,
			fades = [], gain = {mellow = db_to_linear(float(P.get("db", -6)))}, match = null, started = false, visit = -1, next_bar = -1, song = ""})


func _stream(path: String) -> AudioStream:
	if _streams.has(path):
		return _streams[path]
	var full := folder.path_join(path)
	var s: AudioStream = load(full) if full.begins_with("res://") else AudioStreamOggVorbis.load_from_file(full)
	_streams[path] = s
	return s

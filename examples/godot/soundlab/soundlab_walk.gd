## The scene walk in GDScript: where the music goes next. A line-for-line port of Sound Lab's walk.js (made from the
## lab's own web-app/src/mixer/engine/scenewalk.ts), so a Godot game makes the choices the lab's Mixer makes; with the
## same seed it walks the same steps (test_walk.gd checks it against walk.js). Give it the manifest a sync wrote
## (soundlab.json) and ask it for the next step: {kind: "part", song, bar, bars, visit, first, at} or {kind: "rest", bars,
## after}. See the sync folder's README.md for what it does.
class_name SoundLabWalk
extends RefCounted

const LEN := 4  ## bars in a phrase

var _songs: Dictionary
var _scenes: Dictionary
var _cuts: Dictionary
var _file_bars: int
var _stay: int
var _scene_bars: int
var _wave_bars: float
var _rest_bars: int
var _avoid: int
var _rand: Callable
var _lo := -1.0
var _hi := 1.0
var _run = null  # {visit: {id, song, entry, lo, hi}, bar, played, last_bar, first}
var _pending = null  # {song, start}
var _scene = null  # {fid, bars, played}
var _bars := 0
var _heard := {}
var _scene_list: Array = []
var _visits := 0


## The walk a synced manifest describes. `random`: a Callable returning a float in [0, 1), e.g. SoundLabWalk.seeded(7);
## default randf. `memory`: what memory() gave last session, to stay unique across sessions.
func _init(manifest: Dictionary, random := Callable(), memory = null) -> void:
	var p: Dictionary = manifest.play
	_stay = int(p.stay); _scene_bars = int(p.sceneBars); _wave_bars = float(p.waveBars); _rest_bars = int(p.restBars)
	_avoid = int(p.get("avoid", 4))
	_rand = random if random.is_valid() else Callable(self, "_randf")
	set_data(manifest.walk)
	if memory != null:
		remember(memory)


func _randf() -> float:
	return randf()


## New music (a new sync): the walk goes on where it is.
func set_data(data: Dictionary) -> void:
	_songs = data.songs; _scenes = data.scenes; _cuts = data.cuts; _file_bars = int(data.bars)
	var e: Array = []
	for s in _songs.values():
		e.append(float(s.energy))
	e.sort()
	_lo = e[int(floor(e.size() * 0.1))] if e.size() else -1.0
	_hi = e[int(floor(e.size() * 0.9))] if e.size() else 1.0


## A fresh walk: nothing heard.
func reset() -> void:
	_run = null; _pending = null; _scene = null; _bars = 0; _heard = {}; _scene_list = []


func remember(m: Dictionary) -> void:
	_heard = m.heard.duplicate(); _scene_list = m.scenes.duplicate(); _bars = int(m.bars)


## What to keep in the save: bars heard of each song, the scenes lately.
func memory() -> Dictionary:
	return {heard = _heard.duplicate(), scenes = _scene_list.slice(-16), bars = _bars}


## The energy aimed at after `bars` bars walked: chill (the songs' 10th percentile) to less chill (their 90th) and back.
func target(bars = null) -> float:
	var b: float = _bars if bars == null else bars
	return _lo + (_hi - _lo) * (0.5 - 0.5 * cos((2.0 * PI * b) / _wave_bars))


func energy(id: String) -> float:
	return float(_songs[id].energy) if _songs.has(id) else 0.0


func members(fid: String) -> Array:
	var out: Array = []
	if _scenes.has(fid):
		for m in _scenes[fid].members:
			if _songs.has(m):
				out.append(m)
	return out


func scene_of(id: String):
	for fid in _scenes:
		if id in _scenes[fid].members:
			return fid
	return null


## Where song `a`, just past its bar `after`, can cut seamlessly into another member of its scene.
func cuts_at(a: String, after: int) -> Array:
	var out: Array = []
	for c in _cuts.get(a, []):
		if int(c.after) == after and _songs.has(c.to):
			out.append(c)
	return out


## The songs a visit to `a` may cut into (to load them ahead).
func cuts_from(a: String) -> Array:
	var out: Array = []
	if not _songs.has(a):
		return out
	var lp: Array = _songs[a].loop
	for c in _cuts.get(a, []):
		if int(c.after) >= int(lp[0]) and int(c.after) <= int(lp[1]) and _songs.has(c.to) and not (c.to in out):
			out.append(c.to)
	return out


## Where the walk is: the scene, its bars, the energy aimed at and the song's.
func state():
	if _scene == null:
		return null
	return {scene = _scene.fid, bars = _scene.bars, target = target(), energy = energy(_run.visit.song) if _run != null else null}


## On to the next scene at once: its first song, which next() then plays.
func skip():
	var p = _enter_scene()
	if p != null:
		_run = null; _pending = p
	return p


## Enter a song at a bar, in its scene, keeping what was heard.
func enter(song: String, start: int) -> void:
	if _pending == null or _pending.song != song or _pending.start != start or _scene == null:
		var fid = scene_of(song)
		if fid == null:
			return
		if _scene == null or _scene.fid != fid:
			_scene = {fid = fid, bars = 0, played = []}; _scene_list.append(fid)
		_pending = {song = song, start = start}
	_run = null


## The song playing is done: the walk moves on at its next chance.
func hurry() -> void:
	if _run != null:
		_run.played = maxi(_run.played, 999)


## The next step: a part of a song, or a rest between scenes; null when there's nothing to play.
func next_step(depth := 0):
	if depth > 4:
		return null
	if _run == null:
		var p = _pending if (_pending != null and _scene != null) else _enter_scene()
		_pending = null
		if p == null:
			return null
		_start(p.song, int(p.start))
	var r: Dictionary = _run
	var sc: Dictionary = _scene
	var song: String = r.visit.song
	if not (song in sc.played):
		sc.played.append(song)
	var loop_len: int = r.visit.hi - r.visit.lo + 1
	var stay: int = mini(_stay, loop_len)
	var most: int = maxi(stay, mini(stay + LEN, loop_len))
	if sc.bars >= _scene_bars:
		if r.played >= mini(stay, LEN) and (_phrase_end(r) or sc.bars >= _scene_bars + 8 or r.played >= most):
			_run = null; _scene = null
			return {kind = "rest", bars = _rest_bars, after = song}
	elif r.played >= stay:
		var t := target()
		var best = null
		var best_k := INF
		for c in cuts_at(song, r.last_bar):
			if c.to in sc.played:
				continue
			var k := absf(energy(c.to) - t) + 0.05 * log(1.0 + float(_heard.get(c.to, 0))) + 0.1 * float(_rand.call())
			if k < best_k:
				best_k = k; best = c
		if best != null:
			_start(best.to, int(best.start))
			return next_step(depth + 1)
		if _phrase_end(r) or r.played >= most:
			var m = _pick_member(sc.fid, t, song, sc.played)
			if m != null:
				_start(m, int(_songs[m].entry))
				return next_step(depth + 1)
	if r.bar > r.visit.hi:
		r.bar = r.visit.lo
	var bars: int = mini(mini(LEN - (r.played % LEN), stay - r.played), r.visit.hi - r.bar + 1) if r.played < stay else 1
	var step := {kind = "part", visit = r.visit, song = song, bar = r.bar, bars = bars, first = r.first, at = r.played}
	r.first = false; r.bar += bars; r.played += bars; r.last_bar = step.bar + bars - 1
	sc.bars += bars; _bars += bars; _heard[song] = int(_heard.get(song, 0)) + bars
	return step


func _start(song: String, start: int) -> void:
	var s: Dictionary = _songs[song]
	var lo: int = mini(int(s.loop[0]), start)
	var hi: int = mini(_file_bars, maxi(int(s.loop[1]), start + LEN - 1))
	_visits += 1
	_run = {visit = {id = _visits, song = song, entry = start, lo = lo, hi = hi}, bar = start, played = 0, last_bar = start - 1, first = true}


func _phrase_end(r: Dictionary) -> bool:
	var ph = _songs[r.visit.song].get("phrase")
	if ph != null:
		return posmod(r.last_bar - int(ph), LEN) == LEN - 1
	return r.played % LEN == 0


func _enter_scene():
	var t := target()
	var recent: Array = _scene_list.slice(-_avoid) if _avoid > 0 else []
	if _scene != null:
		recent.append(_scene.fid)
	var fs: Array = []
	for fid in _scenes:
		var ms := members(fid)
		if ms.size():
			fs.append({fid = fid, ms = ms})
	var fresh: Array = fs.filter(func(x): return not (x.fid in recent))
	var from: Array = fresh if fresh.size() else fs
	var costed: Array = []
	for x in from:
		var e := 0.0
		var h := 0.0
		for m in x.ms:
			e += energy(m); h += float(_heard.get(m, 0))
		e /= x.ms.size(); h /= x.ms.size()
		costed.append({x = x, c = absf(e - t) + 0.02 * log(1.0 + h) + 0.15 * float(_rand.call())})
	costed.sort_custom(func(a, b): return a.c < b.c)
	var best: Array = costed.slice(0, 3)
	if best.is_empty():
		return null
	var fid: String = best[int(floor(float(_rand.call()) * best.size()))].x.fid
	var m = _pick_member(fid, t)
	if m == null:
		return null
	_scene = {fid = fid, bars = 0, played = []}; _scene_list.append(fid)
	return {song = m, start = int(_songs[m].entry)}


func _pick_member(fid: String, t: float, not_song = null, played: Array = []):
	var all: Array = members(fid).filter(func(m): return m != not_song)
	var fresh: Array = all.filter(func(m): return not (m in played))
	var ms: Array = fresh if fresh.size() else all
	var best = null
	var best_c := INF
	for m in ms:
		var c := absf(energy(m) - t) + 0.05 * log(1.0 + float(_heard.get(m, 0))) + 0.1 * float(_rand.call())
		if c < best_c:
			best_c = c; best = m
	return best


## A seeded random source (mulberry32, as walk.js's seeded()): the same walk every time for the same seed.
static func seeded(seed: int) -> Callable:
	var state := [seed & 0xFFFFFFFF]
	return func() -> float:
		state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
		var t: int = state[0]
		t = _imul(t ^ (t >> 15), t | 1)
		t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
		return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


## The low 32 bits of a 32-bit product (as JavaScript's Math.imul), without overflowing a 64-bit int.
static func _imul(x: int, y: int) -> int:
	x &= 0xFFFFFFFF; y &= 0xFFFFFFFF
	var lo := (x & 0xFFFF) * (y & 0xFFFF)
	var mid := (((x >> 16) * (y & 0xFFFF)) + ((x & 0xFFFF) * (y >> 16))) & 0xFFFF
	return (lo + (mid << 16)) & 0xFFFFFFFF

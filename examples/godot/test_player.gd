## Runs SoundLabMusic on a sync folder for a while, headless, and prints each step as it starts with the voices playing:
##   godot --headless --path examples/godot --script res://test_player.gd -- /path/to/soundlab 40
extends SceneTree

const Music := preload("res://soundlab/soundlab_music.gd")
var music
var until := 0.0
var steps := 0


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	music = Music.new()
	music.folder = args[0]; music.walk_seed = 7
	until = Time.get_ticks_msec() / 1000.0 + float(args[1])
	root.add_child(music)
	music.step_started.connect(func(s):
		steps += 1
		var on := 0
		for v in music._voices:
			if v.started: on += 1
		print("%6.2f  %-5s %s  voices %d" % [Time.get_ticks_msec() / 1000.0, s.kind, "" if s.kind == "rest" else "%s %d+%d" % [s.song, s.bar, s.bars], on]))
	music.play.call_deferred()


func _process(_d: float) -> bool:
	if Time.get_ticks_msec() / 1000.0 > until:
		if music.is_intense() == false:
			pass
		print("steps started: %d, voices now: %d" % [steps, music._voices.size()])
		return true
	if Time.get_ticks_msec() / 1000.0 > until - 20.0 and not music.is_intense():
		music.set_intense(true)
		print("-> intense")
	return false

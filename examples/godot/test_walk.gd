## Prints a seeded walk's steps, one JSON line each, to compare with walk.js's on the same manifest (a port that walks the
## same steps makes the same music):
##   godot --headless --path examples/godot --script res://test_walk.gd -- path/to/soundlab.json 7 500
extends SceneTree

const Walk := preload("res://soundlab/soundlab_walk.gd")


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var m = JSON.parse_string(FileAccess.get_file_as_string(args[0]))
	var w = Walk.new(m, Walk.seeded(int(args[1])))
	for i in int(args[2]):
		var s = w.next_step()
		if s == null:
			break
		var row := ["rest", s.bars, s.after] if s.kind == "rest" else ["part", s.song, s.bar, s.bars, s.visit.id, s.first, s.at]
		print(JSON.stringify(row))
	quit()

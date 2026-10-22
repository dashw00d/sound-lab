## The demo: a synced folder played by SoundLabMusic. Space plays and stops, I switches mellow and intense, N moves on to
## the next scene. The label shows the scene, the song and the energy the walk is aiming at.
extends Control

@onready var music: SoundLabMusic = $Music
@onready var label: Label = $Panel/Label


func _ready() -> void:
	music.step_started.connect(_on_step)
	label.text = "Space: play · I: mellow / intense · N: next scene"


func _unhandled_input(e: InputEvent) -> void:
	if not (e is InputEventKey and e.pressed and not e.echo):
		return
	match e.keycode:
		KEY_SPACE:
			if music.playing: music.stop()
			else: music.play()
		KEY_I:
			music.set_intense(not music.is_intense())
		KEY_N:
			music.walk.skip()


func _on_step(step: Dictionary) -> void:
	var st = music.walk.state()
	var where := "" if st == null else "scene %s · energy %.2f → %.2f" % [st.scene, st.energy if st.energy != null else 0.0, st.target]
	if step.kind == "rest":
		label.text = "rest · %d bar(s)\n%s" % [step.bars, where]
	else:
		label.text = "%s · bars %d-%d%s\n%s\n%s" % [step.song, step.bar, step.bar + step.bars - 1, "" if not music.is_intense() else " · intense", where,
			"Space: play / stop · I: mellow / intense · N: next scene"]

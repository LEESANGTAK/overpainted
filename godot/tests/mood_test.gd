extends SceneTree
## The room's mood and hints (port stage 5), through the real screens:
##   - a blunder does not turn the room; TURN_MOVES moves later it does (music lost, canvas drying)
##   - undo back past the blunder calms it; the timer turns it too; a dead end turns it at once
##   - a hint marks the first move of a shortest line, counts in the result, says so when lost
##   - M toggles the sound (saved, the music bus muted)
##   godot --headless --path godot --script res://tests/mood_test.gd

const Solver := preload("res://scripts/core/solver.gd")
const Rules := preload("res://scripts/core/rules.gd")
const SaveData := preload("res://scripts/game/save_data.gd")

var _failures := 0
var game: Control
var play: Control


func _fail(msg: String) -> void:
	_failures += 1
	printerr("FAIL " + msg)


func _check(ok: bool, msg: String) -> void:
	if not ok:
		_fail(msg)


func _initialize() -> void:
	_run.call_deferred()


func _frames(n := 2) -> void:
	for i in n:
		await process_frame


## A demo level, a blunder from its start, and a line of `after` more strikes from there that never
## dead-ends (so the room can only turn by the move count). Returns {} if there is none.
func _find_blunder(after: int) -> Dictionary:
	for i in play.data.levels.size():
		var def: Dictionary = play.data.levels[i]
		if not play.data.demo.has(def.chapter) or def.has("tape") or def.has("palette"):
			continue
		var b := Rules.parse_level(def)
		for m in Rules.list_moves(b, b.init_hp):
			var hp := Rules.apply_hits(b.init_hp, m.hits)
			if Solver.analyze(b, hp).solvable:
				continue
			var line := []
			var state := hp
			for k in after:
				var next := Rules.list_moves(b, state)
				if next.is_empty():
					break
				line.append(next[0].cell)
				state = Rules.apply_hits(state, next[0].hits)
			if line.size() == after and not Rules.list_moves(b, state).is_empty():
				return {"index": i, "blunder": m.cell, "line": line}
	return {}


func _strike(c: int) -> void:
	await play._on_cell_pressed(c)
	await _frames()


func _run() -> void:
	SaveData.path_override = "user://test_mood_save.json"
	var save_file := ProjectSettings.globalize_path(SaveData.path_override)
	DirAccess.remove_absolute(save_file)
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	await _frames(3)
	play = game.play
	var music: Node = game.music

	# ---- the room turns late, and calms when the blunder is undone ----
	var found := _find_blunder(play.TURN_MOVES)
	_check(not found.is_empty(), "no demo level with a blunder followed by %d moves" % play.TURN_MOVES)
	if not found.is_empty():
		game.open_level(found.index)
		await _strike(found.blunder)
		_check(play.lost_at == 1, "the blunder was not noticed (lost_at %d)" % play.lost_at)
		_check(not play.turned and not music.lost, "the room turned on the blunder itself")
		await _strike(found.line[0])
		_check(not play.turned, "the room turned one move after the blunder")
		await _strike(found.line[1])
		_check(play.turned and music.lost, "the room did not turn %d moves after the blunder" % play.TURN_MOVES)
		await _frames(20)
		_check(play.view.dry_amount() > 0.0, "the canvas is not drying")
		_check(music._target.lost > music._target.calm, "the music balance did not move to the lost piece")
		play.undo()
		play.undo()
		_check(play.turned, "undoing moves after the blunder calmed the room")
		play.undo()
		_check(not play.turned and not music.lost and play.lost_at == 0, "undoing the blunder did not calm the room")

		# the timer turns it too
		play.turn_seconds = 0.3
		await _strike(found.blunder)
		_check(not play.turned, "turned at once with the timer path")
		await create_timer(0.6).timeout
		_check(play.turned, "the room did not turn after turn_seconds")
		# a stale timer does nothing after a restart
		play.restart()
		await _strike(found.blunder)
		play.restart()
		await create_timer(0.6).timeout
		_check(not play.turned, "a stale timer turned the room after a restart")
		play.turn_seconds = 25.0

	# ---- a dead end turns it at once ----
	var dead := {}
	for i in play.data.levels.size():
		var def: Dictionary = play.data.levels[i]
		if not play.data.demo.has(def.chapter):
			continue
		var b := Rules.parse_level(def)
		for m in Rules.list_moves(b, b.init_hp):
			var hp := Rules.apply_hits(b.init_hp, m.hits)
			if not Rules.is_clear(hp, b.n_paint) and Rules.list_moves(b, hp).is_empty():
				dead = {"index": i, "cell": m.cell}
				break
		if not dead.is_empty():
			break
	if dead.is_empty():
		print("(no one-move dead end in the demo levels; dead-end check skipped)")
	else:
		game.open_level(dead.index)
		await _strike(dead.cell)
		_check(play.turned and play._status.text != "", "a dead end did not turn the room at once")

	# ---- hints ----
	game.open_level(0)
	var first: Dictionary = Solver.analyze(play.board).solution[0]
	play.hint()
	_check(play.hints == 1 and play.view._hint == first.cell, "the hint did not mark the first move (%d)" % play.view._hint)
	await _strike(first.cell)
	_check(play.view._hint == -1, "the hint stayed after the strike")
	for m in Solver.analyze(play.board, play.hp).solution:
		await _strike(m.cell)
	_check(play.won and play._ov_result.text.contains("1"), "the result does not count the hint: %s" % play._ov_result.text)
	if not found.is_empty():
		game.open_level(found.index)
		await _strike(found.blunder)
		play.hint()
		_check(play.hints == 0 and play._status.text != "", "a hint on a lost attempt did not say so")

	# ---- the sound key ----
	var was_on: bool = game.save.sound
	var e := InputEventKey.new()
	e.physical_keycode = KEY_M
	e.pressed = true
	Input.parse_input_event(e)
	Input.flush_buffered_events()
	await _frames()
	_check(game.save.sound != was_on and music.muted == was_on, "M did not toggle the sound")
	var bus := AudioServer.get_bus_index("Music")
	_check(bus >= 0 and AudioServer.is_bus_mute(bus) == was_on, "the music bus mute does not follow the setting")

	DirAccess.remove_absolute(save_file)
	print("mood: %d failures" % _failures)
	game.queue_free() # free the game (and its music) before quitting, so nothing is left at exit
	await process_frame
	await process_frame
	quit(1 if _failures > 0 else 0)

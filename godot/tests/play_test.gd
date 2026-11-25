extends SceneTree
## Plays every level that needs no tools through the real play screen, clicking the solver's line cell
## by cell (with the strike animation), and checks the win, the strike count, undo and restart.
##   godot --headless --path godot --script res://tests/play_test.gd
##   godot --path godot --script res://tests/play_test.gd -- shots=<folder>   (also saves screenshots)

const SaveData := preload("res://scripts/game/save_data.gd")

const Solver := preload("res://scripts/core/solver.gd")
const Rules := preload("res://scripts/core/rules.gd")

var _failures := 0


func _fail(msg: String) -> void:
	_failures += 1
	printerr("FAIL " + msg)


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var shots := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("shots="):
			shots = a.substr(6)
	SaveData.path_override = "user://test_save.json"
	DirAccess.remove_absolute(ProjectSettings.globalize_path(SaveData.path_override))
	var game: Control = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	var play: Control = game.play
	await process_frame
	var played := 0
	for i in play.data.levels.size():
		var def: Dictionary = play.data.levels[i]
		if def.has("tape") or def.has("palette"):
			continue # tool levels have no controls yet (not in the demo)
		play.load_level(i)
		var line: Array = Solver.analyze(play.board).solution
		for k in line.size():
			var m: Dictionary = line[k]
			if shots != "" and i == 0 and k == 0:
				_shot_during(play, m.cell, shots.path_join("strike.png"))
			await play._on_cell_pressed(m.cell)
		if not play.won:
			_fail("%s: not won after its solution" % def.id)
			continue
		if play.history.size() != int(def.get("par", -1)):
			_fail("%s: %d strikes, par %d" % [def.id, play.history.size(), int(def.get("par", -1))])
		if not play._overlay.visible:
			_fail("%s: no result card" % def.id)
		if shots != "" and i == 0:
			await process_frame
			await process_frame
			_save(shots.path_join("won.png"))
		play.undo()
		if play.won or play.history.size() != line.size() - 1:
			_fail("%s: undo after the win" % def.id)
		play.restart()
		if play.history.size() != 0 or play.hp != play.board.init_hp:
			_fail("%s: restart" % def.id)
		played += 1
	# a strike that lifts nothing changes nothing
	play.load_level(0)
	var before: PackedByteArray = play.hp
	for c in play.board.w * play.board.h:
		var r = Rules.probe(play.board, play.hp, c)
		if r != null and r.hits.size() < 2:
			await play._on_cell_pressed(c)
			break
	if play.hp != before or play.history.size() != 0:
		_fail("a fizzle changed the state")
	print("%d levels played to the end, %d failures" % [played, _failures])
	quit(1 if _failures > 0 else 0)


## Save a screenshot ~half way through the strike that starts now.
func _shot_during(play: Control, cell: int, path: String) -> void:
	var waiter := func():
		await create_timer(0.12).timeout
		_save(path)
	waiter.call()


func _save(path: String) -> void:
	if DisplayServer.get_name() == "headless":
		return
	root.get_texture().get_image().save_png(path)

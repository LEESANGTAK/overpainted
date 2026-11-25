extends SceneTree
## Playtest logging (port stage 6), against the local dev server (tools/serve.mjs must be running:
## it writes playtests/<session>.jsonl). Plays a short session — welcome card and name, a fizzle, an
## undo, a restart, a hint, a win, leaving a painting — and sends it. Prints the session id;
## tools/test-godot.mjs then runs tools/playtest.mjs on that file and deletes it.
##   godot --headless --path godot --script res://tests/playlog_test.gd -- url=http://localhost:5173/api/playlog

const Solver := preload("res://scripts/core/solver.gd")
const Rules := preload("res://scripts/core/rules.gd")
const SaveData := preload("res://scripts/game/save_data.gd")
const Playlog := preload("res://scripts/net/playlog.gd")

var _failures := 0


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


func _run() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("url="):
			Playlog.url_override = a.substr(4)
	if Playlog.url_override == "":
		printerr("usage: -- url=<dev server /api/playlog>")
		quit(2)
		return
	SaveData.path_override = "user://test_playlog_save.json"
	var save_file := ProjectSettings.globalize_path(SaveData.path_override)
	DirAccess.remove_absolute(save_file)
	var game: Control = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	await _frames(3)
	var play: Control = game.play
	var log: Node = game.playlog
	_check(log.enabled, "the log is not recording with a url")

	# the welcome card asks for a name first, once
	var welcome: Control = null
	for c in game.get_children():
		if c.has_signal("done"):
			welcome = c
	_check(welcome != null, "no welcome card on the first visit")
	if welcome:
		_check(welcome._start.disabled, "Start is enabled with no name")
		welcome._name.text = "  test-bot  "
		welcome._sync()
		welcome._submit()
		await _frames()
		_check(game.save.tester == "test-bot" and game.save.welcomed, "the name was not kept: '%s'" % game.save.tester)

	# a short session
	game.open_level(0)
	for c in play.board.w * play.board.h: # one strike that lifts nothing
		var r = Rules.probe(play.board, play.hp, c)
		if r != null and r.hits.size() < 2:
			await play._on_cell_pressed(c)
			break
	var line: Array = Solver.analyze(play.board).solution
	await play._on_cell_pressed(line[0].cell)
	play.undo()
	play.restart()
	play.hint()
	for m in line:
		await play._on_cell_pressed(m.cell)
	_check(play.won, "the first painting was not restored")
	var unfinished := 1 # start a painting that takes more than one strike, and leave it for the list
	while int(play.data.levels[unfinished].get("par", 1)) < 2:
		unfinished += 1
	game.open_level(unfinished)
	await play._on_cell_pressed(Solver.analyze(play.board).solution[0].cell)
	_check(not play.won, "the painting meant to be left was restored")
	game.show_list()

	# send, and wait for the server to answer
	log.flush()
	var until := Time.get_ticks_msec() + 10000
	while not log._in_flight.is_empty() and Time.get_ticks_msec() < until:
		await process_frame
	_check(log._in_flight.is_empty() and log._buffer.is_empty() and log.sent_ok, "the events were not delivered")
	print("SESSION %s" % log.session)

	# a second start: no welcome card
	game.queue_free()
	await _frames()
	var again: Control = load("res://scenes/main.tscn").instantiate()
	root.add_child(again)
	await _frames(3)
	for c in again.get_children():
		_check(not c.has_signal("done"), "the welcome card came back after it was answered")
	again.queue_free()
	await _frames(2)
	DirAccess.remove_absolute(save_file)
	print("playlog: %d failures" % _failures)
	quit(1 if _failures > 0 else 0)

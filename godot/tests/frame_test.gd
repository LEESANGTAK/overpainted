extends SceneTree
## The game's frame (port stage 4): the list of paintings, opening one with the pad, the saved best,
## Menu back to the list, extras opening after their parent, the chapter-done line, settings and
## language kept across a restart, and the demo holding only its chapters.
##   godot --headless --path godot --script res://tests/frame_test.gd

const Solver := preload("res://scripts/core/solver.gd")
const SaveData := preload("res://scripts/game/save_data.gd")
const LevelData := preload("res://scripts/game/level_data.gd")
const Strings := preload("res://scripts/ui/strings.gd")

var _failures := 0
var game: Control


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


func _button(index: int) -> void:
	var e := InputEventJoypadButton.new()
	e.button_index = index
	e.pressed = true
	Input.parse_input_event(e)
	Input.flush_buffered_events()
	await _frames()
	var up := e.duplicate()
	up.pressed = false
	Input.parse_input_event(up)
	Input.flush_buffered_events()
	await _frames()


func _start_game() -> void:
	if game:
		game.queue_free()
		await _frames()
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	await _frames(3)


func _solve(play: Control) -> void:
	for m in Solver.analyze(play.board).solution:
		await play._on_cell_pressed(m.cell)


func _run() -> void:
	SaveData.path_override = "user://test_frame_save.json"
	var save_file := ProjectSettings.globalize_path(SaveData.path_override)
	DirAccess.remove_absolute(save_file)
	await _start_game()
	var play: Control = game.play

	# the list first; the pad's A opens the focused painting (the first one)
	_check(game.select.visible and not play.visible, "the game does not start on the list")
	await _button(JOY_BUTTON_A)
	_check(play.visible and play.index == 0, "A on the list did not open the first painting")

	# restore it: the best is saved, Menu goes back to the list, which shows the stars
	await _solve(play)
	_check(play.won, "first painting not restored")
	_check(game.save.best.get(play.def.id) == play.history.size(), "best not recorded")
	var on_disk = JSON.parse_string(FileAccess.get_file_as_string(SaveData.path_override))
	_check(on_disk != null and int(on_disk.best.get(play.def.id, -1)) == play.history.size(), "best not written to the save file")
	await _button(JOY_BUTTON_START)
	_check(game.select.visible and not play.visible, "Menu did not go back to the list")
	var first_button: Button = game.select._buttons[0]
	_check(first_button.text.contains("★"), "the list does not show the stars: %s" % first_button.text)

	# an extra is locked until its parent is restored, and the parent's card offers it
	var data: LevelData = game.data
	var extra_i := -1
	for i in data.levels.size():
		if data.levels[i].get("extra", false) and data.demo.has(data.levels[i].chapter):
			extra_i = i
			break
	_check(extra_i >= 0, "no extra in the demo chapters")
	var extra: Dictionary = data.levels[extra_i]
	var parent_i := data.index_of(extra.parent)
	_check(data.is_locked(extra, game.save), "%s open before %s" % [extra.id, extra.parent])
	_check(game.select._buttons[extra_i].disabled, "the locked extra's button is not disabled")
	game.open_level(parent_i)
	await _solve(play)
	_check(not data.is_locked(extra, game.save), "%s still locked after %s" % [extra.id, extra.parent])
	_check(play._ov_extra.visible, "the parent's result card does not offer the extra")
	play.step_level(1) # from the parent, the next open painting in the list is now the extra
	_check(play.index == extra_i, "LB/RB stepping skipped the opened extra")

	# the chapter-done line: restore every main painting of chapter 1, the last one through play
	var ch: Dictionary = data.chapters[0]
	var mains: Array = data.mains_of(ch)
	for d in mains.slice(0, mains.size() - 1):
		game.save.record(d.id, int(d.par))
	game.open_level(data.index_of(mains[-1].id))
	await _solve(play)
	_check(play._ov_chapter.visible, "no chapter-done line after the chapter's last painting")
	game.open_level(data.index_of(mains[-1].id))
	await _solve(play)
	_check(not play._ov_chapter.visible, "the chapter-done line again on a second clear")

	# settings: language and sight preview, kept across a restart
	game.show_list()
	var was: String = Strings.lang
	game.select._lang.pressed.emit()
	_check(Strings.lang != was, "the language button did not switch")
	_check(play._undo.text == Strings.t("undo"), "the play screen kept the old language")
	game.select._sight.toggled.emit(false)
	await _start_game()
	_check(Strings.lang != was, "the language was not kept across a restart")
	_check(not game.save.sight, "sight preview off was not kept")
	game.open_level(0)
	_check(not game.play.view.show_sight, "the board still previews lines of sight")
	_check(game.save.cleared(data.levels[0].id), "the records were not kept across a restart")

	# the demo: only its chapters
	var demo := LevelData.new(true)
	_check(demo.chapters.size() == demo.demo.size(), "demo data has %d chapters" % demo.chapters.size())
	_check(demo.levels.all(func(d): return demo.demo.has(d.chapter)), "demo data has a level outside the demo")
	var last_main := -1
	for i in demo.levels.size():
		if not demo.levels[i].get("extra", false):
			last_main = i
	_check(demo.next_main(last_main) == -1, "the demo's last painting has a next one")

	Strings.lang = was
	DirAccess.remove_absolute(save_file)
	print("frame: %d failures (demo: %d chapters, %d paintings)" % [_failures, demo.chapters.size(), demo.levels.size()])
	game.queue_free() # free the game (and its music) before quitting, so nothing is left at exit
	await process_frame
	await process_frame
	quit(1 if _failures > 0 else 0)

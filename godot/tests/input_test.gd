extends SceneTree
## Plays the demo chapters with one kind of input at a time, sending real input events through Godot's
## Input (as a pad or a touchscreen would):
##   - gamepad only: D-pad to each cell of the solver's line, A to strike, A on the result card to go on
##     (and B to undo once there), LB/RB between paintings
##   - touch only: taps on the cells (Godot turns them into clicks)
##   godot --headless --path godot --script res://tests/input_test.gd

const SaveData := preload("res://scripts/game/save_data.gd")

const Solver := preload("res://scripts/core/solver.gd")

var _failures := 0
var play: Control


func _fail(msg: String) -> void:
	_failures += 1
	printerr("FAIL " + msg)


func _initialize() -> void:
	_run.call_deferred()


func _frames(n := 2) -> void:
	for i in n:
		await process_frame


func _send(e: InputEvent) -> void:
	Input.parse_input_event(e)
	Input.flush_buffered_events()


func _button(index: int) -> void:
	var e := InputEventJoypadButton.new()
	e.device = 0
	e.button_index = index
	e.pressed = true
	_send(e)
	await _frames()
	var up := e.duplicate()
	up.pressed = false
	_send(up)
	await _frames()


## Tap at a point on the canvas. Input events are in window coordinates (in a headless run the window
## is tiny and scaled), so the point goes through the root's final transform first.
func _tap(at: Vector2) -> void:
	var e := InputEventScreenTouch.new()
	e.index = 0
	e.position = root.get_final_transform() * at
	e.pressed = true
	_send(e)
	await _frames(1)
	var up := e.duplicate()
	up.pressed = false
	_send(up)
	await _frames(1)


func _settle() -> void:
	while play.busy:
		await process_frame
	await _frames()


## Move the pad cursor to cell c with D-pad presses.
func _pad_to(c: int) -> void:
	var w: int = play.board.w
	while play.cursor != c:
		var dx: int = c % w - play.cursor % w
		var dy: int = c / w - play.cursor / w
		var before: int = play.cursor
		if dx != 0:
			await _button(JOY_BUTTON_DPAD_RIGHT if dx > 0 else JOY_BUTTON_DPAD_LEFT)
		else:
			await _button(JOY_BUTTON_DPAD_DOWN if dy > 0 else JOY_BUTTON_DPAD_UP)
		if play.cursor == before:
			_fail("%s: the D-pad did not move the cursor" % play.def.id)
			return


func _run() -> void:
	SaveData.path_override = "user://test_save.json"
	DirAccess.remove_absolute(ProjectSettings.globalize_path(SaveData.path_override))
	var game: Control = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	play = game.play
	await _frames()
	var demo: Array = play.data.demo
	var pad_levels := 0
	var tap_levels := 0

	# ---- gamepad only, through the demo in order ----
	play.load_level(0)
	await _frames()
	await _button(JOY_BUTTON_DPAD_RIGHT) # the first press only shows the cursor
	if not play.cursor_active:
		_fail("the first D-pad press did not show the cursor")
	while play.index >= 0 and demo.has(play.def.chapter):
		var id: String = play.def.id
		for m in Solver.analyze(play.board).solution:
			await _pad_to(m.cell)
			await _button(JOY_BUTTON_A)
			await _settle()
		if not play.won:
			_fail("%s: not won with the pad" % id)
			break
		if play.history.size() != int(play.def.get("par", -1)):
			_fail("%s: %d strikes with the pad, par %d" % [id, play.history.size(), int(play.def.get("par", -1))])
		pad_levels += 1
		var next: int = play.data.next_main(play.index)
		if pad_levels == 1:
			await _button(JOY_BUTTON_B) # B on the result card undoes the last strike
			if play.won or play._overlay.visible:
				_fail("%s: B on the result card did not undo" % id)
			var last: Dictionary = Solver.analyze(play.board, play.hp).solution[0]
			await _pad_to(last.cell)
			await _button(JOY_BUTTON_A)
			await _settle()
		await _button(JOY_BUTTON_A) # the card's focused button: next
		if play.index != next:
			_fail("%s: A on the result card did not open the next painting (at %d, want %d)" % [id, play.index, next])
			break
	# LB / RB step between paintings
	var at: int = play.index
	await _button(JOY_BUTTON_RIGHT_SHOULDER)
	await _button(JOY_BUTTON_LEFT_SHOULDER)
	if play.index != at:
		_fail("RB then LB did not come back to the same painting")

	# ---- a quick key tap (pressed and released within one frame) still moves the cursor ----
	play.load_level(0)
	await _frames()
	play.cursor_active = true
	var from: int = play.cursor
	var tap := InputEventKey.new()
	tap.physical_keycode = KEY_RIGHT
	tap.pressed = true
	_send(tap)
	var tap_up := tap.duplicate()
	tap_up.pressed = false
	_send(tap_up)
	await _frames()
	if play.cursor != from + 1:
		_fail("a quick key tap did not move the cursor (%d -> %d)" % [from, play.cursor])

	# ---- touch only: taps on the cells ----
	for i in play.data.levels.size():
		var def: Dictionary = play.data.levels[i]
		if not demo.has(def.chapter) or def.get("extra", false):
			continue
		play.load_level(i)
		await _frames()
		for m in Solver.analyze(play.board).solution:
			await _tap(play.view.get_global_transform_with_canvas() * play.view.center_of(m.cell))
			await _settle()
		if not play.won:
			_fail("%s: not won by touch" % def.id)
		elif play.cursor_active:
			_fail("%s: the pad cursor stayed on under touch" % def.id)
		tap_levels += 1

	print("gamepad: %d paintings in a row · touch: %d paintings · %d failures" % [pad_levels, tap_levels, _failures])
	game.queue_free() # free the game (and its music) before quitting, so nothing is left at exit
	await process_frame
	await process_frame
	quit(1 if _failures > 0 else 0)

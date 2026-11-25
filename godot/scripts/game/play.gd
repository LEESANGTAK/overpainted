extends Control
## Grey-box play screen (port stages 2-3): one painting at a time — strike, undo, restart, win, stars.
## The screen is built in code; art and staging come later. A developer picker opens any level.
## Input: mouse, touch (taps arrive as clicks), keyboard and gamepad (a cursor on the board; see
## scripts/input/controls.gd). Not here yet: masking tape and palette controls (not in the demo
## chapters), saving, sound.

const Rules := preload("res://scripts/core/rules.gd")
const LevelData := preload("res://scripts/game/level_data.gd")
const BoardView := preload("res://scripts/game/board_view.gd")
const Strings := preload("res://scripts/ui/strings.gd")
const Controls := preload("res://scripts/input/controls.gd")

const BG := Color("#1b170f")
const INK := Color("#f4e9c8")
const MUTED := Color("#9a8f7f")
const GOLD := Color("#b8915c")
const BAD := Color("#d9826a")

var data: LevelData
var index := -1             ## current level in data.levels
var def: Dictionary
var board: Rules.Board
var hp: PackedByteArray
var history: Array[PackedByteArray] = []
var won := false
var busy := false           ## a strike is playing

## Keyboard / gamepad cursor. Shown once a key or pad button is used, hidden again by the mouse or a touch.
var cursor_active := false
var cursor := 0
var pad_last := false       ## the last cursor input came from a gamepad (for the hints line)
var _dir := Vector2i.ZERO   ## direction held at the last frame
var _repeat_at := 0.0       ## when a held direction steps again (seconds of play time)
var _clock := 0.0
var _cursor_w := 0          ## board width the cursor index was made for

var view: BoardView
var _chapter_label: Label
var _name_label: Label
var _note_label: Label
var _picker: OptionButton
var _hud: Label
var _status: Label
var _overlay: Control
var _ov_title: Label
var _ov_stars: Label
var _ov_result: Label
var _ov_next: Button
var _ov_retry: Button
var _keys: Label


func _ready() -> void:
	Controls.ensure()
	data = LevelData.new()
	_build()
	if data.error != "":
		_status.text = data.error
		return
	for i in data.levels.size():
		var d: Dictionary = data.levels[i]
		var ch := data.chapter_of(d)
		_picker.add_item("%d · %s%s" % [data.chapter_number(ch), Strings.field(d, "name"), "  (Extra)" if d.get("extra", false) else ""], i)
	load_level(0)


# ---------- levels ----------

func load_level(i: int) -> void:
	if i < 0 or i >= data.levels.size():
		return
	index = i
	def = data.levels[i]
	board = Rules.parse_level(def)
	if board == null:
		_status.text = "%s: %s" % [def.id, Rules.last_error]
		return
	hp = board.init_hp
	history.clear()
	won = false
	busy = false
	_hide_overlay()
	# keep the cursor's column and row where they fit, else start in the middle
	var cx := mini(cursor % maxi(1, _cursor_w), board.w - 1) if _cursor_w > 0 else board.w / 2
	var cy := mini(cursor / maxi(1, _cursor_w), board.h - 1) if _cursor_w > 0 else board.h / 2
	cursor = cy * board.w + cx
	_cursor_w = board.w
	_picker.select(i)
	var ch := data.chapter_of(def)
	_chapter_label.text = Strings.t("chapter_label", {"n": data.chapter_number(ch), "name": Strings.field(ch, "name")})
	_name_label.text = Strings.field(def, "name")
	_note_label.text = Strings.field(def, "note")
	_refresh()


func undo() -> void:
	if busy or history.is_empty():
		return
	hp = history.pop_back()
	won = false
	_hide_overlay()
	_refresh()


func restart() -> void:
	if busy:
		return
	load_level(index)


# ---------- play ----------

func _on_cell_pressed(c: int) -> void:
	if won or busy or Rules.is_ruined(board, hp):
		return
	var r = Rules.probe(board, hp, c)
	if r == null:
		return # a tile, a wall or tape: nothing to strike
	if r.hits.size() < 2:
		view.play_fizzle(c)
		return
	busy = true
	view.interactive = false
	var level_now := index
	await view.play_lift(c, r.hits)
	if level_now != index:
		return # another level was opened during the lift
	history.append(hp)
	hp = Rules.apply_hits(hp, r.hits)
	busy = false
	if Rules.is_won(board, hp):
		_win()
	_refresh()


func _win() -> void:
	won = true
	var strikes := history.size()
	var par: int = int(def.get("par", -1))
	_ov_title.text = Strings.t("restored")
	_ov_stars.text = _stars(strikes, par)
	_ov_result.text = Strings.t("result", {"s": strikes, "p": par if par >= 0 else "?"})
	var next := data.next_main(index)
	_ov_next.visible = next >= 0
	if next >= 0:
		var next_ch := data.chapter_of(data.levels[next])
		_ov_next.text = Strings.t("next_chapter", {"name": Strings.field(next_ch, "name")}) if next_ch != data.chapter_of(def) else Strings.t("next")
	_overlay.show()
	(_ov_next if _ov_next.visible else _ov_retry).grab_focus()


## The prototype's rule: par or better 3 stars, one over 2, more 1.
static func _stars(strikes: int, par: int) -> String:
	if par < 0:
		return ""
	return "★★★" if strikes <= par else ("★★☆" if strikes <= par + 1 else "★☆☆")


func _refresh() -> void:
	view.show_state(board, hp)
	view.interactive = not won and not busy and not Rules.is_ruined(board, hp)
	view.set_cursor(cursor if cursor_active and not won else -1)
	_keys.text = Strings.t("keys_pad" if pad_last else "keys")
	_hud.text = "%s %d   ·   %s %s   ·   %s %d" % [
		Strings.t("strikes"), history.size(),
		Strings.t("par"), str(int(def.par)) if def.has("par") else "–",
		Strings.t("layers_left"), Rules.layers_left(board, hp)]
	_status.text = ""
	_status.add_theme_color_override("font_color", BAD)
	if won:
		return
	if Rules.is_ruined(board, hp):
		_status.text = Strings.t("ruined")
	elif not Rules.is_clear(hp, board.n_paint) and Rules.list_moves(board, hp).is_empty() and not _tool_can_make_a_strike():
		_status.text = Strings.t("dead_end")


## A palette dab can open a strike; tape never does (the prototype's dead-end rule).
func _tool_can_make_a_strike() -> bool:
	for m in Rules.list_tool_moves(board, hp):
		if m.get("palette", false):
			return true
	return false


func _hide_overlay() -> void:
	if _overlay.visible:
		var f := get_viewport().gui_get_focus_owner()
		if f:
			f.release_focus()
	_overlay.hide()


# ---------- input ----------

func _input(event: InputEvent) -> void:
	# the mouse or a touch takes over from the cursor (a tap arrives as a click)
	if board != null and cursor_active and (event is InputEventMouseButton or (event is InputEventMouseMotion and event.relative.length() > 2.0)):
		cursor_active = false
		_refresh()


func _unhandled_input(event: InputEvent) -> void:
	if board == null or not event.is_pressed() or event.is_echo():
		return
	var from_pad := event is InputEventJoypadButton or event is InputEventJoypadMotion
	var handled := true
	if event.is_action("undo"):
		undo()
	elif event.is_action("restart"):
		restart()
	elif event.is_action("prev_level"):
		load_level(index - 1)
	elif event.is_action("next_level"):
		load_level(index + 1)
	elif event.is_action("strike") and not _overlay.visible:
		if cursor_active:
			_on_cell_pressed(cursor)
		_show_cursor(from_pad)
	elif _is_cursor_event(event):
		pass # moves are read every frame in _process (held directions repeat)
	else:
		handled = false
	if handled:
		get_viewport().set_input_as_handled()


func _is_cursor_event(event: InputEvent) -> bool:
	return event.is_action("cursor_up") or event.is_action("cursor_down") or event.is_action("cursor_left") or event.is_action("cursor_right")


## Show the cursor (the first key or button press only shows it, where it was).
func _show_cursor(from_pad: bool) -> bool:
	pad_last = from_pad
	if cursor_active:
		return false
	cursor_active = true
	_refresh()
	return true


func _process(delta: float) -> void:
	_clock += delta
	if board == null or _overlay.visible:
		_dir = Vector2i.ZERO
		return # on the result card, Godot's own focus moves between its buttons
	var d := Controls.held_direction()
	if d == Vector2i.ZERO:
		_dir = d
		return
	var step := false
	if d != _dir:
		step = true
		_repeat_at = _clock + Controls.REPEAT_DELAY
	elif _clock >= _repeat_at:
		step = true
		_repeat_at = _clock + Controls.REPEAT_EVERY
	_dir = d
	if not step:
		return
	var from_pad := Input.get_connected_joypads().size() > 0 and not _arrow_keys_down()
	if _show_cursor(from_pad):
		return
	var x := clampi(cursor % board.w + d.x, 0, board.w - 1)
	var y := clampi(cursor / board.w + d.y, 0, board.h - 1)
	cursor = y * board.w + x
	_refresh()


func _arrow_keys_down() -> bool:
	for k in [KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT]:
		if Input.is_physical_key_pressed(k):
			return true
	return false


# ---------- screen ----------

func _label(size: int, color: Color, text := "") -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


func _button(text: String, on_press: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", 18)
	b.pressed.connect(on_press)
	return b


func _build() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	add_child(margin)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	margin.add_child(col)

	var header := HBoxContainer.new()
	col.add_child(header)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(titles)
	_chapter_label = _label(16, GOLD)
	_name_label = _label(34, INK)
	_note_label = _label(17, MUTED)
	_note_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	for l in [_chapter_label, _name_label, _note_label]:
		titles.add_child(l)
	var nav := HBoxContainer.new()
	nav.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	header.add_child(nav)
	nav.add_child(_button("◀", func(): load_level(index - 1)))
	_picker = OptionButton.new()
	_picker.focus_mode = Control.FOCUS_NONE
	_picker.custom_minimum_size.x = 280
	_picker.item_selected.connect(func(i): load_level(_picker.get_item_id(i)))
	nav.add_child(_picker)
	nav.add_child(_button("▶", func(): load_level(index + 1)))

	view = BoardView.new()
	view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	view.cell_pressed.connect(_on_cell_pressed)
	col.add_child(view)

	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation", 16)
	col.add_child(footer)
	_hud = _label(18, INK)
	footer.add_child(_hud)
	_status = _label(16, BAD)
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	footer.add_child(_status)
	footer.add_child(_button(Strings.t("undo"), undo))
	footer.add_child(_button(Strings.t("restart"), restart))
	_keys = _label(13, MUTED, Strings.t("keys"))
	col.add_child(_keys)

	_overlay = Control.new()
	_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	_overlay.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_overlay)
	var shade := ColorRect.new()
	shade.color = Color(0, 0, 0, 0.55)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_overlay.add_child(shade)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_overlay.add_child(center)
	var card := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color("#2a241b")
	style.border_color = GOLD
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(28)
	card.add_theme_stylebox_override("panel", style)
	center.add_child(card)
	var lines := VBoxContainer.new()
	lines.add_theme_constant_override("separation", 10)
	card.add_child(lines)
	_ov_title = _label(30, INK)
	_ov_stars = _label(40, GOLD)
	_ov_result = _label(18, MUTED)
	for l in [_ov_title, _ov_stars, _ov_result]:
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		lines.add_child(l)
	var buttons := HBoxContainer.new()
	buttons.alignment = BoxContainer.ALIGNMENT_CENTER
	buttons.add_theme_constant_override("separation", 12)
	lines.add_child(buttons)
	_ov_retry = _button(Strings.t("retry"), restart)
	_ov_next = _button(Strings.t("next"), func(): load_level(data.next_main(index)))
	for b in [_ov_retry, _ov_next]:
		b.focus_mode = Control.FOCUS_ALL # D-pad / arrows move between them, A / Enter presses
		buttons.add_child(b)
	_overlay.hide()

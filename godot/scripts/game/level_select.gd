extends Control
## The list of paintings (grey box; the map-like chapter screen comes with the art): chapters in order
## with their progress, a button per painting (stars once restored, par before; extras locked until
## their parent is restored), and the settings. Mouse, keyboard and pad (focus moves with the D-pad).

signal level_chosen(index: int)
signal settings_changed

const Strings := preload("res://scripts/ui/strings.gd")
const LevelData := preload("res://scripts/game/level_data.gd")
const Play := preload("res://scripts/game/play.gd")

const BG := Color("#1b170f")
const INK := Color("#f4e9c8")
const MUTED := Color("#9a8f7f")
const GOLD := Color("#b8915c")

var data: LevelData
var save

var _list: VBoxContainer
var _scroll: ScrollContainer
var _title_sub: Label
var _rec: Label
var _keys: Label
var _lang: Button
var _sight: CheckButton
var _sound: CheckButton
var _buttons := {}   ## level index -> Button
var rec_on := false  ## a playtest build that is recording (shows the REC mark)


func setup(level_data: LevelData, save_data) -> void:
	data = level_data
	save = save_data
	_build()


## Rebuild the list (after a clear or a language change) and put the focus on `focus_index`
## (-1: the first painting not yet restored; -2: leave the focus where it is).
func refresh(focus_index := -1) -> void:
	for child in _list.get_children():
		_list.remove_child(child) # at once: the old rows must not count in the scroll length
		child.queue_free()
	_buttons.clear()
	_title_sub.text = Strings.t("title_sub")
	_rec.visible = save.tester != "" and rec_on
	_rec.text = "%s · %s" % [Strings.t("rec"), save.tester]
	_keys.text = Strings.t("select_keys")
	_lang.text = Strings.t("lang_button")
	_sight.text = Strings.t("sight")
	_sound.text = Strings.t("sound")
	_sight.set_pressed_no_signal(save.sight)
	_sound.set_pressed_no_signal(save.sound)
	for ch in data.chapters:
		var mains := data.mains_of(ch)
		var done := mains.filter(func(d): return save.cleared(d.id)).size()
		var head := HBoxContainer.new()
		head.add_theme_constant_override("separation", 14)
		head.add_child(_label(22, INK, "%d · %s" % [data.chapter_number(ch), Strings.field(ch, "name")]))
		head.add_child(_label(16, GOLD if done == mains.size() else MUTED, "%d/%d" % [done, mains.size()]))
		var note := _label(15, MUTED, Strings.field(ch, "note"))
		note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART # (a phone held upright)
		head.add_child(note)
		_list.add_child(head)
		var row := HFlowContainer.new()
		row.add_theme_constant_override("h_separation", 10)
		row.add_theme_constant_override("v_separation", 10)
		_list.add_child(row)
		for i in data.levels.size():
			var def: Dictionary = data.levels[i]
			if def.chapter == ch.id:
				row.add_child(_level_button(i, def))
		var gap := Control.new()
		gap.custom_minimum_size.y = 8
		_list.add_child(gap)
	if focus_index == -2:
		return # (a settings change: the focus stays on the setting)
	var target: Button = _buttons.get(focus_index, _first_open_button())
	if target:
		target.grab_focus.call_deferred()


func _first_open_button() -> Button:
	for i in data.levels.size():
		if not save.cleared(data.levels[i].id) and not data.is_locked(data.levels[i], save):
			return _buttons.get(i)
	return _buttons.get(0)


func _level_button(i: int, def: Dictionary) -> Button:
	var b := Button.new()
	var locked := data.is_locked(def, save)
	var name := Strings.field(def, "name")
	if def.get("extra", false):
		name = "%s · %s" % [Strings.t("extra"), name]
	var meta: String
	if locked:
		meta = Strings.t("locked")
		var parent := data.index_of(String(def.get("parent", "")))
		if parent >= 0:
			b.tooltip_text = Strings.t("unlock_hint", {"name": Strings.field(data.levels[parent], "name")})
	elif save.cleared(def.id):
		meta = Play.stars(save.best[def.id], int(def.get("par", -1)))
	else:
		meta = "%s %d" % [Strings.t("par"), int(def.get("par", 0))]
	b.text = "%s\n%s" % [name, meta]
	b.custom_minimum_size = Vector2(196, 64)
	b.add_theme_font_size_override("font_size", 16)
	b.disabled = locked
	b.focus_mode = Control.FOCUS_ALL
	b.pressed.connect(func(): level_chosen.emit(i))
	_buttons[i] = b
	return b


func _label(size: int, color: Color, text := "") -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


func _build() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 28)
	add_child(margin)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 16)
	margin.add_child(col)

	var header := HFlowContainer.new() # the settings drop under the title on a narrow screen
	header.add_theme_constant_override("v_separation", 8)
	col.add_child(header)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(titles)
	titles.add_child(_label(40, INK, "THE OVERPAINTED"))
	_title_sub = _label(18, GOLD)
	titles.add_child(_title_sub)
	_rec = _label(14, Color("#d9826a"))
	_rec.visible = false
	titles.add_child(_rec)
	var settings := HBoxContainer.new()
	settings.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	settings.add_theme_constant_override("separation", 12)
	header.add_child(settings)
	_lang = Button.new()
	_lang.pressed.connect(func():
		Strings.lang = "en" if Strings.lang == "ko" else "ko"
		save.lang = Strings.lang
		settings_changed.emit())
	_sight = CheckButton.new()
	_sight.toggled.connect(func(on):
		save.sight = on
		settings_changed.emit())
	_sound = CheckButton.new()
	_sound.toggled.connect(func(on):
		save.sound = on
		settings_changed.emit())
	for c in [_lang, _sight, _sound]:
		c.add_theme_font_size_override("font_size", 16)
		settings.add_child(c)

	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.follow_focus = true
	col.add_child(_scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 10)
	_scroll.add_child(_list)
	_keys = _label(13, MUTED)
	col.add_child(_keys)
	var fit_keys := func(): _keys.visible = get_window().content_scale_factor <= 1.0
	fit_keys.call()
	get_tree().root.size_changed.connect(fit_keys)

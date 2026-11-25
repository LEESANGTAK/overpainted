extends Control
## First visit of a tester (playtest builds only; the prototype's welcome()): what to do, what is
## recorded, and who is playing. The name is required, remembered in the save; a web link with ?t=<name>
## fills it in.

signal done(name: String)

const Strings := preload("res://scripts/ui/strings.gd")

const INK := Color("#f4e9c8")
const MUTED := Color("#9a8f7f")
const GOLD := Color("#b8915c")

var _name: LineEdit
var _start: Button


func open(prefill: String) -> void:
	_build()
	_name.text = prefill
	_sync()
	_name.grab_focus.call_deferred()


func _sync(_t := "") -> void:
	_start.disabled = _name.text.strip_edges().is_empty()


func _submit(_t := "") -> void:
	var n := _name.text.strip_edges().left(40)
	if n.is_empty():
		return
	done.emit(n)


func _label(size: int, color: Color, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


func _build() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var shade := ColorRect.new()
	shade.color = Color(0.06, 0.05, 0.04, 0.92)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(shade)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var card := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color("#2a241b")
	style.border_color = GOLD
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(32)
	card.add_theme_stylebox_override("panel", style)
	center.add_child(card)
	var col := VBoxContainer.new()
	col.custom_minimum_size.x = 640
	col.add_theme_constant_override("separation", 12)
	card.add_child(col)
	col.add_child(_label(26, INK, Strings.t("w_title")))
	for i in 4:
		col.add_child(_label(17, INK, "%d. %s" % [i + 1, Strings.t("w%d" % (i + 1))]))
	col.add_child(_label(16, GOLD, Strings.t("w_name_label")))
	_name = LineEdit.new()
	_name.max_length = 40
	_name.placeholder_text = Strings.t("w_name_ph")
	_name.add_theme_font_size_override("font_size", 20)
	_name.text_changed.connect(_sync)
	_name.text_submitted.connect(_submit)
	col.add_child(_name)
	col.add_child(_label(14, MUTED, Strings.t("w_data")))
	_start = Button.new()
	_start.text = Strings.t("w_start")
	_start.add_theme_font_size_override("font_size", 20)
	_start.size_flags_horizontal = Control.SIZE_SHRINK_END
	_start.pressed.connect(_submit)
	col.add_child(_start)

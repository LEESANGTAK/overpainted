extends Control
## First visit of a tester (playtest builds only; the prototype's welcome()): what to do, what is
## recorded, and who is playing. The name is required, remembered in the save; a web link with ?t=<name>
## fills it in.
##
## On the web the name is typed into a real HTML <input> laid over the LineEdit (which stays as a
## spacer): iOS opens its keyboard only for an element focused inside the tap itself, and Godot's
## own text field focuses its hidden input a frame later, so on an iPhone nothing happened.

signal done(name: String)

const Strings := preload("res://scripts/ui/strings.gd")

const INK := Color("#f4e9c8")
const MUTED := Color("#9a8f7f")
const GOLD := Color("#b8915c")

var _name: LineEdit
var _start: Button
var _dom: JavaScriptObject          ## the HTML input (web only)
var _dom_cbs: Array[JavaScriptObject] = []  ## kept alive: JavaScriptBridge callbacks must be referenced
var _fit: Callable                 ## narrows the card on a phone held upright
var _dom_box := ""                  ## last position written, so the style is set only on a change


func open(prefill: String) -> void:
	_build()
	_name.text = prefill
	_sync()
	if OS.has_feature("web"):
		_open_dom_input(prefill)
	else:
		_name.grab_focus.call_deferred()


func _sync(_t := "") -> void:
	_start.disabled = _name.text.strip_edges().is_empty()


func _submit(_t := "") -> void:
	var n := _name.text.strip_edges().left(40)
	if n.is_empty():
		return
	_close_dom_input()
	done.emit(n)


func _exit_tree() -> void:
	_close_dom_input()
	if _fit.is_valid() and get_viewport().size_changed.is_connected(_fit):
		get_viewport().size_changed.disconnect(_fit)


func _open_dom_input(prefill: String) -> void:
	_name.modulate.a = 0.0
	_name.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_name.focus_mode = Control.FOCUS_NONE
	JavaScriptBridge.eval("""
		(function () {
			var old = document.getElementById('op-name'); if (old) old.remove();
			var el = document.createElement('input');
			el.id = 'op-name'; el.type = 'text'; el.maxLength = 40; el.autocomplete = 'off';
			el.setAttribute('autocapitalize', 'off'); el.setAttribute('autocorrect', 'off'); el.spellcheck = false;
			el.style.cssText = 'position:fixed;z-index:10;box-sizing:border-box;margin:0;padding:0 10px;'
				+ 'border:1px solid #b8915c;border-radius:4px;background:#1b170f;color:#f4e9c8;outline:none;'
				+ 'font-family:-apple-system,system-ui,"Noto Sans KR",sans-serif;display:none;';
			document.body.appendChild(el);
			// a tap on the game itself (the Start button, the card) closes the phone keyboard
			var canvas = document.querySelector('canvas');
			if (canvas) canvas.addEventListener('pointerdown', function () { el.blur(); });
			window.__opName = el;
		})();
	""", true)
	_dom = JavaScriptBridge.get_interface("window").__opName
	_dom.placeholder = Strings.t("w_name_ph")
	_dom.value = prefill
	var on_input := JavaScriptBridge.create_callback(func(_args):
		_name.text = String(_dom.value)
		_sync())
	var on_key := JavaScriptBridge.create_callback(func(args):
		if String(args[0].key) == "Enter":
			_name.text = String(_dom.value)
			_submit())
	_dom_cbs = [on_input, on_key]
	_dom.addEventListener("input", on_input)
	_dom.addEventListener("keydown", on_key)


func _close_dom_input() -> void:
	if _dom == null:
		return
	JavaScriptBridge.eval("window.__opName && window.__opName.remove(); window.__opName = null;", true)
	_dom = null
	_dom_cbs.clear()


## Keeps the HTML input over the LineEdit, in CSS pixels (the window is in device pixels).
func _process(_delta: float) -> void:
	if _dom == null or not _name.is_visible_in_tree():
		return
	var r := get_viewport().get_final_transform() * _name.get_global_transform_with_canvas() * Rect2(Vector2.ZERO, _name.size)
	var css: float = float(JavaScriptBridge.eval("window.innerWidth", true)) / float(get_window().size.x)
	var font := maxf(16.0, 20.0 * get_viewport().get_final_transform().get_scale().x * css) # under 16px iOS zooms the page
	var box := "left:%dpx;top:%dpx;width:%dpx;height:%dpx;font-size:%dpx;display:block;" % [
		roundi(r.position.x * css), roundi(r.position.y * css), roundi(r.size.x * css), roundi(r.size.y * css), roundi(font)]
	if box != _dom_box:
		_dom_box = box
		JavaScriptBridge.eval("(function(s){var e=window.__opName;if(!e)return;s.split(';').forEach(function(p){var i=p.indexOf(':');if(i>0)e.style.setProperty(p.slice(0,i),p.slice(i+1));});})(%s)" % JSON.stringify(box), true)


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
	# a phone held upright is narrower than the card
	_fit = func(): col.custom_minimum_size.x = minf(640.0, get_viewport_rect().size.x - 2 * 32 - 2 * 24)
	_fit.call()
	get_viewport().size_changed.connect(_fit)
	col.add_theme_constant_override("separation", 12)
	card.add_child(col)
	col.add_child(_label(26, INK, Strings.t("w_title")))
	for i in 4:
		col.add_child(_label(17, INK, "%d. %s" % [i + 1, Strings.t("w%d" % (i + 1))]))
	col.add_child(_label(16, GOLD, Strings.t("w_name_label")))
	_name = LineEdit.new()
	_name.max_length = 40
	_name.custom_minimum_size.y = 52 # a finger-sized field on a phone
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

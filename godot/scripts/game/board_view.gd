extends Control
## The board, drawn in plain shapes (grey box: the real art comes later).
## Shows a state, previews the lines of sight from the cell under the pointer, animates lifted tiles,
## and reports clicks on cells. It never changes the state itself: play.gd does.

signal cell_pressed(cell: int)

const Rules := preload("res://scripts/core/rules.gd")

## Pigments A..F (the prototype's palette: vermilion, ultramarine, ochre, verdigris, violet, bone white).
const PIGMENTS: Array[Color] = [
	Color("#c4472f"), Color("#2e4ea6"), Color("#d3a23c"), Color("#3d8c78"), Color("#7b4a8e"), Color("#d8cdb5"),
]
const CANVAS := Color("#2a241b")
const CELL_LINE := Color(1, 1, 1, 0.05)
const FRAME := Color("#8a6538")
const RAY := Color("#f4e9c8")
const OLD_TAPE := Color("#8f887a")
const MAX_CELL := 104.0
const DRY_IN := 7.0     ## seconds for the canvas to dry dull once the room turns
const DRY_OUT := 3.0    ## and to come back

## The drying: the prototype's CSS filter (saturate .3, brightness .74, contrast .9, sepia .18) as a
## canvas shader, scaled by `dry` (0..1).
const DRY_SHADER := """
shader_type canvas_item;
uniform float dry : hint_range(0.0, 1.0) = 0.0;
void fragment() {
	vec3 c = COLOR.rgb;
	float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
	c = mix(c, vec3(l), 0.7 * dry);
	vec3 sepia = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
	c = mix(c, sepia, 0.18 * dry);
	c = (c - 0.5) * (1.0 - 0.1 * dry) + 0.5;
	c *= 1.0 - 0.26 * dry;
	COLOR.rgb = c;
}
"""

var board: Rules.Board
var hp: PackedByteArray
var interactive := true   ## false while a strike plays, after a win, or on a ruined painting
var show_sight := true    ## preview the lines of sight under the pointer (or the cursor)
var cursor := -1          ## the keyboard / gamepad cursor's cell, -1 when the mouse or touch is in use

var _cell := 64.0
var _origin := Vector2.ZERO
var _hover := -1
var _lifting := {}        ## tile id -> true while a strike's lift plays
var _lift := 0.0          ## 0..1 progress of that lift
var _strike_cell := -1    ## where the strike came from (its lines stay drawn during the lift)
var _fizzle_cell := -1
var _fizzle := 0.0        ## 1 -> 0 flash on a strike that lifts nothing
var _hint := -1           ## cell the hint points at
var _dry := 0.0
var _dry_tween: Tween


func show_state(b: Rules.Board, state: PackedByteArray) -> void:
	board = b
	hp = state
	_layout()
	queue_redraw()


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	resized.connect(_layout)
	var shader := Shader.new()
	shader.code = DRY_SHADER
	material = ShaderMaterial.new()
	material.shader = shader


## Dry the canvas dull (true) or let it come back (false), slowly.
func set_dry(on: bool) -> void:
	if _dry_tween:
		_dry_tween.kill()
	_dry_tween = create_tween()
	_dry_tween.tween_method(_set_dry_amount, _dry, 1.0 if on else 0.0, DRY_IN if on else DRY_OUT)


## Jump straight to dry or fresh (a new painting).
func reset_dry() -> void:
	if _dry_tween:
		_dry_tween.kill()
	_set_dry_amount(0.0)


func _set_dry_amount(v: float) -> void:
	_dry = v
	material.set_shader_parameter("dry", v)


func dry_amount() -> float:
	return _dry


func set_hint(c: int) -> void:
	_hint = c
	queue_redraw()


func _process(_delta: float) -> void:
	if _hint >= 0:
		queue_redraw() # the hint ring pulses


func _layout() -> void:
	if board == null:
		return
	_cell = floorf(minf(minf(size.x / board.w, size.y / board.h), MAX_CELL))
	_origin = ((size - Vector2(board.w, board.h) * _cell) / 2.0).floor()
	queue_redraw()


## Cell under a point in this control's coordinates, or -1.
func cell_at(pos: Vector2) -> int:
	if board == null:
		return -1
	var p := (pos - _origin) / _cell
	if p.x < 0 or p.y < 0 or p.x >= board.w or p.y >= board.h:
		return -1
	return int(p.y) * board.w + int(p.x)


func center_of(c: int) -> Vector2:
	return _origin + (Vector2(c % board.w, c / board.w) + Vector2(0.5, 0.5)) * _cell


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		var c := cell_at(event.position)
		if c != _hover:
			_hover = c
			queue_redraw()
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var c := cell_at(event.position)
		if c >= 0 and interactive:
			cell_pressed.emit(c)
			accept_event()


func _notification(what: int) -> void:
	if what == NOTIFICATION_MOUSE_EXIT and _hover >= 0:
		_hover = -1
		queue_redraw()


func set_cursor(c: int) -> void:
	if c != cursor:
		cursor = c
		queue_redraw()


## Play the lift of `hits` (struck from `cell`); resolves when done. The caller applies the state after.
func play_lift(cell: int, hits: Array) -> void:
	_strike_cell = cell
	_lifting.clear()
	for t in hits:
		_lifting[t] = true
	_lift = 0.0
	var tw := create_tween()
	tw.tween_method(func(v: float): _lift = v; queue_redraw(), 0.0, 1.0, 0.28)
	await tw.finished
	_lifting.clear()
	_strike_cell = -1


## A short flash on a cell whose strike lifts nothing.
func play_fizzle(cell: int) -> void:
	_fizzle_cell = cell
	var tw := create_tween()
	tw.tween_method(func(v: float): _fizzle = v; queue_redraw(), 1.0, 0.0, 0.35)
	await tw.finished
	_fizzle_cell = -1


# ---------- drawing ----------

func _draw() -> void:
	if board == null:
		return
	var rect := Rect2(_origin, Vector2(board.w, board.h) * _cell)
	draw_rect(rect.grow(10), FRAME)
	draw_rect(rect, CANVAS)
	for c in board.w * board.h:
		var r := Rect2(_origin + Vector2(c % board.w, c / board.w) * _cell, Vector2(_cell, _cell))
		draw_rect(r, CELL_LINE, false, 1.0)
		if board.blocked[c]:
			_draw_x(r, OLD_TAPE, 0.55)
		elif Rules.is_taped(board, hp, c):
			_draw_x(r, Color("#f1e6c8"), 0.85)
	for c in board.w * board.h:
		var t := Rules.tile_on(board, hp, c)
		if t >= 0:
			_draw_tile(c, t)
	_draw_sight()
	if _hint >= 0 and board != null:
		var pulse := 0.5 + 0.5 * sin(Time.get_ticks_msec() / 1000.0 * TAU / 1.2)
		draw_arc(center_of(_hint), _cell * (0.3 + 0.08 * pulse), 0, TAU, 48, Color("#ffd27a", 0.5 + 0.4 * pulse), 3.0, true)
	if cursor >= 0:
		var r := Rect2(_origin + Vector2(cursor % board.w, cursor / board.w) * _cell, Vector2(_cell, _cell)).grow(-3)
		draw_rect(r, Color(RAY, 0.9 if interactive else 0.35), false, 3.0)
	if _fizzle_cell >= 0:
		draw_circle(center_of(_fizzle_cell), _cell * 0.3, Color(0.85, 0.3, 0.25, 0.5 * _fizzle))


func _draw_x(r: Rect2, color: Color, alpha: float) -> void:
	var m := r.size.x * 0.22
	var c := Color(color, alpha)
	draw_line(r.position + Vector2(m, m), r.end - Vector2(m, m), c, maxf(3.0, _cell * 0.07))
	draw_line(Vector2(r.end.x - m, r.position.y + m), Vector2(r.position.x + m, r.end.y - m), c, maxf(3.0, _cell * 0.07))


func _draw_tile(c: int, t: int) -> void:
	var at := center_of(c)
	var radius := _cell * 0.36
	if _lifting.has(t):
		# what stays once the strike lands (a double coat keeps its lower coat), under the fading top
		if not Rules.is_added(board, t) and hp[t] >= 2:
			_draw_disc(at, radius, PIGMENTS[board.under_color[t]], -1, false, 1.0)
		var grow := 1.0 + 0.18 * _lift
		_draw_tile_now(at, radius * grow, t, 1.0 - _lift)
	else:
		_draw_tile_now(at, radius, t, 1.0)


## Tile t as it looks in the current state.
func _draw_tile_now(at: Vector2, radius: float, t: int, alpha: float) -> void:
	if Rules.is_added(board, t):
		var ks := Rules.added_pigments(board, hp, t - board.off_add)
		_draw_disc(at, radius * 0.82, PIGMENTS[ks[0]], ks[1] if ks.size() > 1 else -1, false, alpha)
		return
	if hp[t] >= 2:
		# two coats, as in the prototype (style.css .tile.under / .varnish): a dab laid on a wider dab.
		# The coat beneath is darkened when it is the same paint, so a same-paint double coat is never
		# missed; another pigment beneath keeps its own colour. The top dab casts a small shadow.
		var under := PIGMENTS[board.under_color[t]]
		if board.under_color[t] == board.tile_color[t]:
			under = _under_shade(under)
		draw_circle(at, radius, Color(under, alpha))
		var top := radius * 0.62
		draw_circle(at + Vector2(0, maxf(1.5, _cell * 0.02)), top * 1.04, Color(0, 0, 0, 0.35 * alpha))
		draw_circle(at, top, Color(PIGMENTS[board.tile_color[t]], alpha))
		return
	var second := board.mix_color[t]
	_draw_disc(at, radius, PIGMENTS[board.under_color[t]], second, Rules.is_original(board, t), alpha)


## The prototype's same-paint undercoat: CSS brightness(.68) saturate(.9).
static func _under_shade(c: Color) -> Color:
	var d := Color(c.r * 0.68, c.g * 0.68, c.b * 0.68, c.a)
	var grey := d.get_luminance()
	return Color(lerpf(grey, d.r, 0.9), lerpf(grey, d.g, 0.9), lerpf(grey, d.b, 0.9), c.a)


## A disc of `color`, split with `second` if it is a mix; original paint is dulled and cracked.
func _draw_disc(at: Vector2, radius: float, color: Color, second: int, original: bool, alpha: float) -> void:
	if original:
		color = color.lerp(Color("#6d6458"), 0.45)
	draw_circle(at, radius, Color(color, alpha))
	if second >= 0:
		var half := PackedVector2Array()
		for i in 25:
			half.append(at + Vector2.from_angle(-PI / 4 + PI * i / 24.0) * radius)
		draw_colored_polygon(half, Color(PIGMENTS[second], alpha))
	if original:
		var crack := Color(0.1, 0.08, 0.06, 0.6 * alpha)
		draw_polyline(PackedVector2Array([at + Vector2(-0.5, -0.3) * radius, at + Vector2(-0.1, 0.05) * radius, at + Vector2(0.15, -0.1) * radius, at + Vector2(0.55, 0.35) * radius]), crack, 1.5, true)


func _draw_sight() -> void:
	var from := _strike_cell
	var lifted := _lifting.keys()
	if from < 0:
		from = cursor if cursor >= 0 else _hover
		if not (interactive and show_sight) or from < 0:
			return
	var r = Rules.probe(board, hp, from)
	if r == null:
		return
	var hits: Array = lifted if _strike_cell >= 0 else r.hits
	var striking := _strike_cell >= 0
	var at := center_of(from)
	for ray in r.rays:
		var d: Vector2i = Rules.DIRS[ray.dir]
		var end: Vector2
		if ray.end >= 0:
			end = center_of(ray.end) - Vector2(d) * _cell * 0.5
		else:
			end = Vector2(
				_origin.x + (board.w * _cell if d.x > 0 else (0.0 if d.x < 0 else at.x - _origin.x)),
				_origin.y + (board.h * _cell if d.y > 0 else (0.0 if d.y < 0 else at.y - _origin.y)))
		var hit: bool = ray.tile >= 0 and hits.has(ray.tile)
		var alpha := (0.85 if hit else 0.25) if striking else 0.45
		draw_dashed_line(at, end, Color(RAY, alpha), 2.0 if striking else 1.5, 4.0 if striking else 6.0)
		if hit and striking:
			draw_arc(center_of(ray.end), _cell * 0.4, 0, TAU, 48, Color(RAY, 0.9), 2.0, true)

extends RefCounted
## The game's input actions: keyboard and gamepad bound to the same names (the prototype's pad layout,
## prototype/pad.js). Registered in code so the bindings are readable here; call ensure() once at start.
##
##   cursor_up/down/left/right  D-pad, arrow keys (the left stick is read directly: the stronger axis wins)
##   strike    A, Space, Enter        undo      B, Z           restart   View (Back), R
##   prev_level LB, Page Up           next_level RB, Page Down
##   menu      Menu (Start), Esc: back to the list of paintings
##   hint      Y, H (port stage 5)    sound     M (stage 5; also in the settings)    tool  X, T (tools, later)

const STICK_DEAD := 0.5        ## how far the stick must lean to count as a direction
const REPEAT_DELAY := 0.26     ## a held direction steps again after this...
const REPEAT_EVERY := 0.11     ## ...and then this often

const ACTIONS := {
	"cursor_up": [KEY_UP, JOY_BUTTON_DPAD_UP],
	"cursor_down": [KEY_DOWN, JOY_BUTTON_DPAD_DOWN],
	"cursor_left": [KEY_LEFT, JOY_BUTTON_DPAD_LEFT],
	"cursor_right": [KEY_RIGHT, JOY_BUTTON_DPAD_RIGHT],
	"strike": [KEY_SPACE, KEY_ENTER, JOY_BUTTON_A],
	"undo": [KEY_Z, JOY_BUTTON_B],
	"restart": [KEY_R, JOY_BUTTON_BACK],
	"prev_level": [KEY_PAGEUP, JOY_BUTTON_LEFT_SHOULDER],
	"next_level": [KEY_PAGEDOWN, JOY_BUTTON_RIGHT_SHOULDER],
	"hint": [KEY_H, JOY_BUTTON_Y],
	"menu": [KEY_ESCAPE, JOY_BUTTON_START],
	"sound": [KEY_M],
	"tool": [KEY_T, JOY_BUTTON_X],
}

## Godot's own UI actions (buttons, focus moves) come with keys only: add the pad to them, so the
## result card and any menu work with A and the D-pad / left stick.
const UI_PAD := {
	"ui_accept": [JOY_BUTTON_A],
	"ui_up": [JOY_BUTTON_DPAD_UP], "ui_down": [JOY_BUTTON_DPAD_DOWN],
	"ui_left": [JOY_BUTTON_DPAD_LEFT], "ui_right": [JOY_BUTTON_DPAD_RIGHT],
}
const UI_STICK := {"ui_left": [JOY_AXIS_LEFT_X, -1.0], "ui_right": [JOY_AXIS_LEFT_X, 1.0], "ui_up": [JOY_AXIS_LEFT_Y, -1.0], "ui_down": [JOY_AXIS_LEFT_Y, 1.0]}

## Key codes and joypad button indices overlap as numbers; keys are all >= this.
const _KEY_MIN := 32


static func ensure() -> void:
	for action in ACTIONS:
		if InputMap.has_action(action):
			continue
		InputMap.add_action(action)
		for code in ACTIONS[action]:
			var e: InputEvent
			if code >= _KEY_MIN:
				e = InputEventKey.new()
				e.physical_keycode = code
			else:
				e = InputEventJoypadButton.new()
				e.button_index = code
			InputMap.action_add_event(action, e)
	for action in UI_PAD:
		for index in UI_PAD[action]:
			var e := InputEventJoypadButton.new()
			e.button_index = index
			if not InputMap.action_has_event(action, e):
				InputMap.action_add_event(action, e)
	for action in UI_STICK:
		var e := InputEventJoypadMotion.new()
		e.axis = UI_STICK[action][0]
		e.axis_value = UI_STICK[action][1]
		if not InputMap.action_has_event(action, e):
			InputMap.action_add_event(action, e)


## The direction held now: D-pad / arrows first, else the left stick of any pad (the stronger axis
## wins, so a slightly diagonal push still moves in a straight line). Vector2i.ZERO if none.
static func held_direction() -> Vector2i:
	var d := Vector2i(
		int(Input.is_action_pressed("cursor_right")) - int(Input.is_action_pressed("cursor_left")),
		int(Input.is_action_pressed("cursor_down")) - int(Input.is_action_pressed("cursor_up")))
	if d != Vector2i.ZERO:
		return Vector2i(d.x, 0) if d.x != 0 else Vector2i(0, d.y)
	for pad in Input.get_connected_joypads():
		var ax := Input.get_joy_axis(pad, JOY_AXIS_LEFT_X)
		var ay := Input.get_joy_axis(pad, JOY_AXIS_LEFT_Y)
		if absf(ax) > STICK_DEAD or absf(ay) > STICK_DEAD:
			return Vector2i(int(signf(ax)), 0) if absf(ax) >= absf(ay) else Vector2i(0, int(signf(ay)))
	return Vector2i.ZERO

extends Control
## The game's root (scenes/main.tscn): loads the save and the levels, and moves between the list of
## paintings and the play screen. A build exported with the "demo" feature tag (see
## export_presets.cfg) holds only the demo chapters.

const LevelData := preload("res://scripts/game/level_data.gd")
const SaveData := preload("res://scripts/game/save_data.gd")
const Play := preload("res://scripts/game/play.gd")
const LevelSelect := preload("res://scripts/game/level_select.gd")
const Strings := preload("res://scripts/ui/strings.gd")
const Music := preload("res://scripts/audio/music.gd")
const Playlog := preload("res://scripts/net/playlog.gd")
const Welcome := preload("res://scripts/game/welcome.gd")
const Sfx := preload("res://scripts/audio/sfx.gd")

var data: LevelData
var save: SaveData
var play: Play
var select: LevelSelect
var music: Music
var sfx: Sfx
var playlog: Playlog
var _pad_logged := false

## Web on a phone: the 1280x800 layout shrunk to fit a phone screen came out a third of its size. The
## content is scaled up so one design pixel is never under this many CSS pixels (desktop browsers and
## builds are big enough already). The containers then lay out in the smaller logical space.
const MIN_CSS_PER_PX := 0.8


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	if OS.has_feature("web"):
		_fit_small_screen()
		get_tree().root.size_changed.connect(_fit_small_screen)
	save = SaveData.new()
	save.load_file()
	Strings.lang = save.lang if save.lang in ["ko", "en"] else Strings.system_lang()
	data = LevelData.new(OS.has_feature("demo"))

	playlog = Playlog.new()
	add_child(playlog)
	playlog.start(OS.has_feature("playtest"))
	music = Music.new()
	add_child(music)
	music.set_muted(not save.sound)
	sfx = Sfx.new()
	add_child(sfx)
	sfx.set_muted(not save.sound)
	play = Play.new()
	add_child(play)
	select = LevelSelect.new()
	add_child(select)
	if data.error != "":
		push_error(data.error)
		return
	play.setup(data, save)
	select.setup(data, save)
	play.back_requested.connect(show_list)
	play.level_opened.connect(_show_play)
	select.level_chosen.connect(open_level)
	select.settings_changed.connect(_on_settings_changed)
	play.mood_changed.connect(music.set_lost)
	play.sound.connect(sfx.play)
	play.logged.connect(_on_logged)
	select.rec_on = playlog.enabled
	Input.joy_connection_changed.connect(func(device, connected):
		if connected and not _pad_logged:
			_pad_logged = true
			playlog.add("pad", {"id": Input.get_joy_name(device)}))
	play.sound_toggled.connect(func():
		save.sound = not save.sound
		_on_settings_changed())
	show_list()
	if playlog.enabled:
		_start_session()


## Playtest builds: the anonymous id, the tester's name (asked once), and the session's first event.
func _start_session() -> void:
	if save.browser == "":
		save.browser = Playlog.new_browser_id()
		save.save_file()
	var from_link := ""
	if OS.has_feature("web"):
		var t = JavaScriptBridge.eval("new URLSearchParams(location.search).get('t') || ''", true)
		from_link = String(t).left(40) if t != null else ""
	if from_link != "":
		save.tester = from_link
		save.save_file()
	var size := get_viewport().get_visible_rect().size
	playlog.add("session_start", {
		"w": int(size.x), "h": int(size.y), "tester": save.tester if save.tester != "" else null,
		"browser": save.browser, "lang": Strings.lang, "hosted": true, "engine": "godot",
		"platform": OS.get_name(), "version": ProjectSettings.get_setting("application/config/version", ""),
	})
	if save.welcomed and save.tester != "":
		return
	var w := Welcome.new()
	add_child(w)
	w.open(save.tester)
	playlog.add("welcome_shown")
	w.done.connect(func(name: String):
		save.tester = name
		save.welcomed = true
		save.save_file()
		playlog.add("tester", {"tester": name})
		w.queue_free()
		select.refresh(-1))


func _fit_small_screen() -> void:
	var css := Vector2(float(JavaScriptBridge.eval("window.innerWidth", true)), float(JavaScriptBridge.eval("window.innerHeight", true)))
	if css.x <= 0 or css.y <= 0:
		return
	var base := minf(css.x / 1280.0, css.y / 800.0)
	var factor := snappedf(maxf(1.0, MIN_CSS_PER_PX / base), 0.01)
	if not is_equal_approx(get_window().content_scale_factor, factor):
		get_window().content_scale_factor = factor


func _on_logged(type: String, event: Dictionary) -> void:
	playlog.level_id = play.def.get("id") if play.index >= 0 else null
	playlog.add(type, event)


func open_level(i: int) -> void:
	sfx.play("tick")
	play.load_level(i) # (emits level_opened -> _show_play)


func _show_play() -> void:
	select.hide()
	play.show()


func show_list() -> void:
	play.leave()
	music.set_lost(false) # the list is a calm place
	play.hide()
	select.show()
	select.refresh(play.index)


func _on_settings_changed() -> void:
	save.save_file()
	music.set_muted(not save.sound)
	sfx.set_muted(not save.sound)
	play.apply_language()
	select.refresh(-2) # (-2: no level to focus; the settings button keeps it)

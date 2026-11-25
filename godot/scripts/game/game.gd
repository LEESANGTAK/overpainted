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

var data: LevelData
var save: SaveData
var play: Play
var select: LevelSelect
var music: Music
var playlog: Playlog
var _pad_logged := false


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
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


func _on_logged(type: String, event: Dictionary) -> void:
	playlog.level_id = play.def.get("id") if play.index >= 0 else null
	playlog.add(type, event)


func open_level(i: int) -> void:
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
	play.apply_language()
	select.refresh(-2) # (-2: no level to focus; the settings button keeps it)

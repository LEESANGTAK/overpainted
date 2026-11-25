extends Control
## The game's root (scenes/main.tscn): loads the save and the levels, and moves between the list of
## paintings and the play screen. A build exported with the "demo" feature tag (see
## export_presets.cfg) holds only the demo chapters.

const LevelData := preload("res://scripts/game/level_data.gd")
const SaveData := preload("res://scripts/game/save_data.gd")
const Play := preload("res://scripts/game/play.gd")
const LevelSelect := preload("res://scripts/game/level_select.gd")
const Strings := preload("res://scripts/ui/strings.gd")

var data: LevelData
var save: SaveData
var play: Play
var select: LevelSelect


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	save = SaveData.new()
	save.load_file()
	Strings.lang = save.lang if save.lang in ["ko", "en"] else Strings.system_lang()
	data = LevelData.new(OS.has_feature("demo"))

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
	show_list()


func open_level(i: int) -> void:
	play.load_level(i) # (emits level_opened -> _show_play)


func _show_play() -> void:
	select.hide()
	play.show()


func show_list() -> void:
	play.hide()
	select.show()
	select.refresh(play.index)


func _on_settings_changed() -> void:
	save.save_file()
	play.apply_language()
	select.refresh(-2) # (-2: no level to focus; the settings button keeps it)

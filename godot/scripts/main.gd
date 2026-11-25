extends Control
## Stage 0 placeholder: proves the project runs, Korean text renders, and the level data loads.

const LEVELS_PATH := "res://data/levels.json"

@onready var _status: Label = %Status


func _ready() -> void:
	var data = _load_levels()
	if data == null:
		_status.text = "레벨 파일을 읽지 못했습니다 · Could not read the levels"
		return
	var demo: Array = data["demo"]
	var main_levels := 0
	for level in data["levels"]:
		if demo.has(level["chapter"]) and not level.get("extra", false):
			main_levels += 1
	_status.text = "%d장 · 레벨 %d개 · 데모 %d장, 메인 %d판" % [data["chapters"].size(), data["levels"].size(), demo.size(), main_levels]


func _load_levels():
	var text := FileAccess.get_file_as_string(LEVELS_PATH)
	if text.is_empty():
		push_error("Missing %s (run: node tools/export-godot.mjs)" % LEVELS_PATH)
		return null
	var data = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		push_error("Bad JSON in %s" % LEVELS_PATH)
		return null
	return data

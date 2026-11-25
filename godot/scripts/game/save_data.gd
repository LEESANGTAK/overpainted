extends RefCounted
## What the game remembers between visits: the best strike count per level, and the settings.
## A JSON file in user:// (on Windows %APPDATA%/Godot/app_userdata/The Overpainted/). Tests point
## `path_override` at a throwaway file so they never touch a player's save.

const VERSION := 1
const DEFAULT_PATH := "user://save.json"

static var path_override := ""

var best := {}         ## level id -> fewest strikes it was restored in
var lang := ""         ## "ko" or "en"; "" = follow the system language on first start
var sight := true      ## preview the lines of sight under the pointer / cursor
var sound := true


func path() -> String:
	return path_override if path_override != "" else DEFAULT_PATH


func load_file() -> void:
	var text := FileAccess.get_file_as_string(path())
	if text.is_empty():
		return
	var data = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		push_warning("Unreadable save file %s; starting fresh" % path())
		return
	for id in data.get("best", {}):
		best[id] = int(data.best[id])
	var settings: Dictionary = data.get("settings", {})
	lang = String(settings.get("lang", ""))
	sight = bool(settings.get("sight", true))
	sound = bool(settings.get("sound", true))


func save_file() -> void:
	var f := FileAccess.open(path(), FileAccess.WRITE)
	if f == null:
		push_error("Cannot write %s (%s)" % [path(), error_string(FileAccess.get_open_error())])
		return
	f.store_string(JSON.stringify({
		"version": VERSION,
		"best": best,
		"settings": {"lang": lang, "sight": sight, "sound": sound},
	}, "  "))


## Record a clear; true if it is the level's first clear or a better one.
func record(id: String, strikes: int) -> bool:
	if best.has(id) and best[id] <= strikes:
		return false
	best[id] = strikes
	save_file()
	return true


func cleared(id: String) -> bool:
	return best.has(id)

extends RefCounted
## The levels file (data/levels.json, written by tools/export-godot.mjs): chapters in order, levels in
## play order (each chapter's levels as listed), and the demo's chapters.

const PATH := "res://data/levels.json"

var chapters: Array = []   ## [{id, name, note, ko}]
var levels: Array = []     ## every level, in play order
var demo: Array = []       ## chapter ids in the demo
var error := ""


func _init() -> void:
	var text := FileAccess.get_file_as_string(PATH)
	if text.is_empty():
		error = "Missing %s (run: node tools/export-godot.mjs)" % PATH
		return
	var data = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		error = "Bad JSON in %s" % PATH
		return
	chapters = data.chapters
	demo = data.demo
	for ch in chapters:
		for def in data.levels:
			if def.chapter == ch.id:
				levels.append(def)


## The chapter a level belongs to, or {}.
func chapter_of(def: Dictionary) -> Dictionary:
	for ch in chapters:
		if ch.id == def.get("chapter"):
			return ch
	return {}


## 1-based chapter number.
func chapter_number(ch: Dictionary) -> int:
	return chapters.find(ch) + 1


## Index in `levels` of the next main (non-extra) level after index i, or -1.
func next_main(i: int) -> int:
	for j in range(i + 1, levels.size()):
		if not levels[j].get("extra", false):
			return j
	return -1

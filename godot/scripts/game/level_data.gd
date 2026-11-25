extends RefCounted
## The levels file (data/levels.json, written by tools/export-godot.mjs): chapters in order, levels in
## play order (each chapter's levels as listed), and the demo's chapters. With demo_only, only the demo
## chapters are kept (the demo build; see game.gd).
##
## Extra levels hang off a main level (`parent`) like side branches: optional, opened by restoring the
## parent, skipped by "Next". All chapters are open, as in the prototype.

const PATH := "res://data/levels.json"

var chapters: Array = []   ## [{id, name, note, ko}]
var levels: Array = []     ## every level, in play order
var demo: Array = []       ## chapter ids in the demo
var error := ""


func _init(demo_only := false) -> void:
	var text := FileAccess.get_file_as_string(PATH)
	if text.is_empty():
		error = "Missing %s (run: node tools/export-godot.mjs)" % PATH
		return
	var data = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		error = "Bad JSON in %s" % PATH
		return
	demo = data.demo
	for ch in data.chapters:
		if demo_only and not demo.has(ch.id):
			continue
		chapters.append(ch)
		for def in data.levels:
			if def.chapter == ch.id:
				levels.append(def)


func index_of(id: String) -> int:
	for i in levels.size():
		if levels[i].id == id:
			return i
	return -1


## The chapter a level belongs to, or {}.
func chapter_of(def: Dictionary) -> Dictionary:
	for ch in chapters:
		if ch.id == def.get("chapter"):
			return ch
	return {}


## 1-based chapter number.
func chapter_number(ch: Dictionary) -> int:
	return chapters.find(ch) + 1


func mains_of(ch: Dictionary) -> Array:
	return levels.filter(func(d): return d.chapter == ch.id and not d.get("extra", false))


## Extra levels that hang off this one.
func extras_of(def: Dictionary) -> Array:
	return levels.filter(func(d): return d.get("extra", false) and d.get("parent") == def.id)


## An extra stays locked until its parent is restored.
func is_locked(def: Dictionary, save) -> bool:
	return def.get("extra", false) and not save.cleared(String(def.get("parent", "")))


func chapter_cleared(ch: Dictionary, save) -> bool:
	return mains_of(ch).all(func(d): return save.cleared(d.id))


## Index of the next main level after level i (for an extra: after the main level it hangs off), or -1.
func next_main(i: int) -> int:
	var root: Dictionary = levels[i]
	while root.get("extra", false):
		var p := index_of(String(root.get("parent", "")))
		if p < 0:
			return -1
		root = levels[p]
	for j in range(levels.find(root) + 1, levels.size()):
		if not levels[j].get("extra", false):
			return j
	return -1

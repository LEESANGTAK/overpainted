extends SceneTree
## Solver timing on every shipped level from its start: godot --headless --path godot --script res://tests/bench.gd

const Rules := preload("res://scripts/core/rules.gd")
const Solver := preload("res://scripts/core/solver.gd")


func _init() -> void:
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/levels.json"))
	var rows := []
	for def in data.levels:
		var b := Rules.parse_level(def)
		var t0 := Time.get_ticks_usec()
		var a := Solver.analyze(b)
		rows.append([(Time.get_ticks_usec() - t0) / 1000.0, def.id, a.states, a.min_moves])
	rows.sort_custom(func(x, y): return x[0] > y[0])
	for r in rows.slice(0, 8):
		print("%8.1f ms  %-12s states %4d  par %d" % r)
	quit()

extends SceneTree
## Rules parity tests: the GDScript rules and solver must answer exactly as the JS reference.
##   node tools/parity.mjs                                   (writes tests/vectors.json from the JS)
##   godot --headless --path godot --script res://tests/run_tests.gd [-- quick]
## Exit code 0 = all equal. Prints the first mismatches otherwise. "quick" skips the solver checks.

const Rules := preload("res://scripts/core/rules.gd")
const Solver := preload("res://scripts/core/solver.gd")
const VECTORS := "res://tests/vectors.json"
const MAX_REPORTS := 25

var _checks := 0
var _failures := 0
var _quick := false


func _init() -> void:
	var text := FileAccess.get_file_as_string(VECTORS)
	if text.is_empty():
		printerr("Missing %s — run: node tools/parity.mjs" % VECTORS)
		quit(2)
		return
	_quick = OS.get_cmdline_user_args().has("quick")
	var data: Dictionary = JSON.parse_string(text)
	var states := 0
	var t0 := Time.get_ticks_msec()
	for bd in data.boards:
		states += _check_board(bd)
	var ms := Time.get_ticks_msec() - t0
	print("%d boards, %d states, %d checks, %d failures (%d ms)" % [data.boards.size(), states, _checks, _failures, ms])
	quit(1 if _failures > 0 else 0)


func _ints(a) -> Array:
	var out := []
	if a == null:
		return out
	for x in a:
		out.append(int(x))
	return out


func _expect(ok: bool, where: String, what: String, got, want) -> void:
	_checks += 1
	if ok:
		return
	_failures += 1
	if _failures <= MAX_REPORTS:
		printerr("FAIL %s: %s\n   got:  %s\n   want: %s" % [where, what, str(got), str(want)])


func _same(where: String, what: String, got, want) -> void:
	_expect(got == want, where, what, got, want)


func _move_code(m: Dictionary) -> Array:
	var kind := "p" if m.get("palette", false) else ("t" if m.get("tape", false) else "s")
	return [kind, int(m.cell)]


func _check_board(bd: Dictionary) -> int:
	var id: String = bd.id
	var b := Rules.parse_level(bd.def)
	if b == null:
		_expect(false, id, "parse", Rules.last_error, "a board")
		return 0
	var p: Dictionary = bd.parsed
	_same(id, "w,h", [b.w, b.h], [int(p.w), int(p.h)])
	_same(id, "nTiles,nPaint", [b.n_tiles, b.n_paint], [int(p.nTiles), int(p.nPaint)])
	if int(p.offAdd) >= 0:
		_same(id, "offAdd", b.off_add, int(p.offAdd))
	_same(id, "initHp", Array(b.init_hp), _ints(p.initHp))
	_same(id, "tileCell", Array(b.tile_cell), _ints(p.tileCell))
	_same(id, "tileColor", Array(b.tile_color), _ints(p.tileColor))
	_same(id, "underColor", Array(b.under_color), _ints(p.underColor))
	_same(id, "mixColor", Array(b.mix_color), _ints(p.mixColor))
	var count := 0
	for wi in bd.walks.size():
		var hp := b.init_hp
		var steps: Array = bd.walks[wi]
		for si in steps.size():
			var rec: Dictionary = steps[si]
			var where := "%s walk %d step %d" % [id, wi, si]
			_same(where, "state", Array(hp), _ints(rec.hp))
			if Array(hp) != _ints(rec.hp):
				break # everything after would differ for the same reason
			_check_state(where, b, hp, rec)
			count += 1
			if rec.has("next"):
				hp = _apply(b, hp, rec.next)
	return count


func _apply(b: Rules.Board, hp: PackedByteArray, code: Array) -> PackedByteArray:
	var cell := int(code[1])
	match code[0]:
		"p": return Rules.apply_palette(b, hp, cell)
		"t": return Rules.apply_tape(b, hp, cell)
	return Rules.apply_hits(hp, Rules.probe(b, hp, cell).hits)


func _check_state(where: String, b: Rules.Board, hp: PackedByteArray, rec: Dictionary) -> void:
	var n := b.w * b.h
	for c in n:
		var want = rec.looks[c]
		var r = Rules.probe(b, hp, c)
		if want == null:
			_expect(r == null, where, "cell %d is not empty" % c, r, null)
			continue
		if r == null:
			_expect(false, where, "cell %d is empty" % c, null, want)
			continue
		_same(where, "cell %d hits" % c, Array(r.hits), _ints(want[0]))
		var rays := []
		for ray in r.rays:
			rays.append_array([ray.tile, ray.end, 1 if ray.wall else 0])
		_same(where, "cell %d rays" % c, rays, _ints(want[1]))
	var empty := []
	for c in n:
		empty.append(1 if Rules.is_empty(b, hp, c) else 0)
	_same(where, "empty cells", empty, _ints(rec.empty))
	var moves := []
	for m in Rules.list_moves(b, hp):
		moves.append([m.cell, Array(m.hits)])
	var want_moves := []
	for m in rec.moves:
		want_moves.append([int(m[0]), _ints(m[1])])
	_same(where, "strikes", moves, want_moves)
	var tools := []
	for m in Rules.list_tool_moves(b, hp):
		tools.append(_move_code(m))
	var want_tools := []
	for m in rec.tools:
		want_tools.append([m[0], int(m[1])])
	_same(where, "tool moves", tools, want_tools)
	var flags := [
		1 if Rules.is_ruined(b, hp) else 0, 1 if Rules.paint_gone(b, hp) else 0, 1 if Rules.is_won(b, hp) else 0,
		Rules.layers_left(b, hp), Rules.tape_left(b, hp), Rules.palette_left(b, hp),
	]
	_same(where, "ruined,gone,won,layers,tape,palette", flags, _ints(rec.flags))
	if rec.has("pmask"):
		var masks := []
		for c in n:
			masks.append(Rules.palette_mask(b, hp, c))
		_same(where, "palette masks", masks, _ints(rec.pmask))
	if rec.get("solve") != null and not _quick:
		var a := Solver.analyze(b, hp, 50_000)
		_same(where, "solvable,min,states", [a.solvable, a.min_moves, a.states], [rec.solve.ok, int(rec.solve.min), int(rec.solve.states)])
		var line := []
		for m in a.solution:
			line.append(_move_code(m))
		var want_line := []
		for m in rec.solve.line:
			want_line.append([m[0], int(m[1])])
		_same(where, "solution", line, want_line)

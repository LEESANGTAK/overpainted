extends RefCounted
## The Overpainted — the solver the game needs, ported from core/solver.js.
##
## Only what play uses: can this state still be cleared, in how few moves, and one best line (hints,
## and noticing that an attempt has quietly gone wrong). Difficulty metrics stay in the JS tools.
## Moves are listed in the same order as the JS `movesFast`, so the line found is the same move for
## move (tools/parity.mjs + tests/run_tests.gd check it).

const Rules := preload("res://scripts/core/rules.gd")

const UNSOLVABLE := 1 << 30


## Lines of sight from every cell, per direction (up, right, down, left): the cells in order.
## Depends only on the board size; analyze() builds it once.
static func sight_lines(b: Rules.Board) -> Array:
	var lines := []
	for c in b.w * b.h:
		var dirs := []
		for d in Rules.DIRS:
			var list := PackedInt32Array()
			var x := c % b.w + d.x
			var y := c / b.w + d.y
			while x >= 0 and y >= 0 and x < b.w and y < b.h:
				list.append(y * b.w + x)
				x += d.x
				y += d.y
			dirs.append(list)
		lines.append(dirs)
	return lines


## The distinct moves in this state: strikes first (one per set of lifted tiles, the first cell in
## reading order), then tool moves (tape, then palette). [{cell, hits, tape?, palette?}]
## Same answers as building them from Rules.probe, without its per-cell dictionaries (the JS movesFast).
static func moves(b: Rules.Board, hp: PackedByteArray, lines: Array = []) -> Array[Dictionary]:
	if lines.is_empty():
		lines = sight_lines(b)
	var out: Array[Dictionary] = []
	var seen := {}
	var empties := PackedInt32Array()
	var found := PackedInt32Array([-1, -1, -1, -1])
	var masks := PackedInt32Array([0, 0, 0, 0])
	var n := b.w * b.h
	# once per state: what stands on each cell. -2 = old tape or masking tape (stops a look),
	# -1 = empty, otherwise the live tile; cell_mask = its pigments
	var on_cell := PackedInt32Array()
	var cell_mask := PackedInt32Array()
	on_cell.resize(n)
	cell_mask.resize(n)
	var tapes := b.tape > 0 or b.tools
	for c in n:
		if b.blocked[c] or (tapes and hp[b.n_tiles + c] == 1):
			on_cell[c] = -2
		else:
			var t := Rules.tile_on(b, hp, c)
			on_cell[c] = t
			if t >= 0:
				cell_mask[c] = Rules.mask_of(b, hp, t)
	for c in n:
		if on_cell[c] != -1:
			continue
		empties.append(c)
		var seen_tiles := 0
		var dirs: Array = lines[c]
		for d in 4:
			found[d] = -1
			for cc in dirs[d]:
				var t := on_cell[cc]
				if t == -1:
					continue
				if t >= 0:
					found[d] = t
					masks[d] = cell_mask[cc]
					seen_tiles += 1
				break
		if seen_tiles < 2:
			continue
		var hits: Array[int] = []
		for i in 4:
			if found[i] < 0:
				continue
			for j in 4:
				if j != i and found[j] >= 0 and (masks[j] & masks[i]):
					hits.append(found[i])
					break
		if hits.size() < 2:
			continue
		hits.sort()
		var key := 0
		for t in hits:
			key = key * 1024 + t + 1
		if not seen.has(key):
			seen[key] = true
			out.append({"cell": c, "hits": hits})
	if b.tools:
		for m in Rules.list_tool_moves(b, hp):
			m["hits"] = []
			out.append(m)
	elif b.tape > 0 and Rules.tape_left(b, hp) > 0:
		for c in empties:
			out.append({"cell": c, "hits": [], "tape": true})
	return out


## The state after move m.
static func step(b: Rules.Board, hp: PackedByteArray, m: Dictionary) -> PackedByteArray:
	if m.get("palette", false):
		return Rules.apply_palette(b, hp, m.cell)
	if m.get("tape", false):
		return Rules.apply_tape(b, hp, m.cell)
	return Rules.apply_hits(hp, m.hits)


## Full search from `hp` (the level start if empty).
## Returns {solvable, min_moves (-1 if not), solution: [moves], states, too_big}.
## `too_big` is true (and the rest unknown) if more than max_states positions are reachable.
static func analyze(b: Rules.Board, hp: PackedByteArray = PackedByteArray(), max_states: int = 1_000_000) -> Dictionary:
	if hp.is_empty():
		hp = b.init_hp
	var memo := {}
	var lines := sight_lines(b)
	var f := _visit(b, lines, hp, memo, max_states)
	if f < 0:
		return {"solvable": false, "min_moves": -1, "solution": [], "states": memo.size(), "too_big": true}
	var solution: Array[Dictionary] = []
	if f < UNSOLVABLE:
		var state := hp
		while not Rules.paint_gone(b, state):
			var want: int = memo[state.hex_encode()] - 1
			for m in moves(b, state, lines):
				var next := step(b, state, m)
				if memo.get(next.hex_encode(), -1) == want:
					solution.append(m)
					state = next
					break
	return {
		"solvable": f < UNSOLVABLE,
		"min_moves": f if f < UNSOLVABLE else -1,
		"solution": solution,
		"states": memo.size(),
		"too_big": false,
	}


## Fewest moves to clear from `state` (UNSOLVABLE if none), memoised; -1 if the search grew too big.
static func _visit(b: Rules.Board, lines: Array, state: PackedByteArray, memo: Dictionary, max_states: int) -> int:
	var key := state.hex_encode()
	if memo.has(key):
		return memo[key]
	if memo.size() >= max_states:
		return -1
	var f := UNSOLVABLE
	if Rules.is_ruined(b, state):
		f = UNSOLVABLE # an original was lifted: lost, whatever is left
	elif Rules.paint_gone(b, state):
		f = 0
	else:
		for m in moves(b, state, lines):
			var g := _visit(b, lines, step(b, state, m), memo, max_states)
			if g < 0:
				return -1
			if g < UNSOLVABLE and g + 1 < f:
				f = g + 1
	memo[key] = f
	return f


## True if the level can still be cleared from `hp`. (False also when the search is too big.)
static func can_still_win(b: Rules.Board, hp: PackedByteArray, max_states: int = 300_000) -> bool:
	return analyze(b, hp, max_states).solvable


## The first move of a shortest line from `hp`, or {} if there is none.
static func best_move(b: Rules.Board, hp: PackedByteArray, max_states: int = 300_000) -> Dictionary:
	var a := analyze(b, hp, max_states)
	return a.solution[0] if a.solvable and not a.solution.is_empty() else {}

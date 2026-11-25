extends RefCounted
## The Overpainted — core rules, ported from core/rules.js.
##
## core/rules.js is the reference: levels are designed and measured there. This port must give the
## same answers; tools/parity.mjs writes test vectors from the JS and tests/run_tests.gd checks them.
## Tiles are numbered and states are laid out exactly as in the JS, so states compare byte for byte.
##
## Level text (one string per row): "." empty, "A".."F" a paint tile of that pigment, "a".."f" a double
## coat, "#" old tape. Optional `under` rows give a coat beneath (it makes the tile two coats), `mix`
## rows a second pigment in a single-layer tile, `orig` rows ("o") original paint that must not be
## lifted. `tape: N` masking tape the player may lay, `palette: N` palette dabs the player may mix.
## (Retouch and split exist in the JS prototype only; they are not in the game.)
##
## A strike targets an empty cell and looks up/right/down/left to the nearest tile in each direction
## (tape stops the look). Every seen tile that shares a pigment with another seen tile loses a layer.
##
## State (`hp`, a PackedByteArray): one byte per tile = layers left. With tape or a palette, w*h tape
## bytes follow (1 = taped). With a palette, after those: w*h "added tile here" bytes, w*h added-tile
## pigment masks, two unused bytes (retouch/split in the JS) and one byte counting palette dabs used.
## Tile ids >= board.off_add are added tiles (palette dabs): id = off_add + cell.

const DIRS: Array[Vector2i] = [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]
const COLOR_CHARS := "ABCDEF"
const MAX_COLORS := 6

## Why the last parse_level() returned null.
static var last_error := ""


class Board extends RefCounted:
	var id := ""
	var name := ""
	var note := ""
	var par := -1
	var w := 0
	var h := 0
	var tile_at := PackedInt32Array()     ## cell -> tile index, or -1
	var blocked := PackedByteArray()      ## cell -> 1 for old tape
	var tile_cell := PackedInt32Array()   ## tile -> cell
	var tile_color := PackedInt32Array()  ## tile -> pigment of the top coat
	var under_color := PackedInt32Array() ## tile -> pigment once the top coat is gone
	var mix_color := PackedInt32Array()   ## tile -> second pigment of a mixed tile, or -1
	var init_hp := PackedByteArray()
	var n_tiles := 0  ## level tiles (overpaint, then originals)
	var n_paint := 0  ## overpaint tiles: indices 0..n_paint-1; the rest are original paint
	var tape := 0     ## masking tape the player may lay
	var palette := 0  ## palette dabs the player may mix
	var tools := false ## the state carries added tiles (a palette on this level)
	var off_add := 0
	var off_col := 0
	var off_palette := 0


static func _fail(message: String) -> Board:
	last_error = message
	push_error(message)
	return null


static func _char_at(rows, y: int, x: int) -> String:
	if rows == null or y >= rows.size():
		return "."
	var r := String(rows[y])
	return r[x] if x < r.length() else "."


static func _blank(ch: String) -> bool:
	return ch == "." or ch == " "


## Parse a level definition (a Dictionary as in levels.json). Returns null and sets last_error if it is malformed.
static func parse_level(def: Dictionary) -> Board:
	last_error = ""
	var rows = def.get("rows")
	if not (rows is Array) or rows.is_empty():
		return _fail("Level has no rows")
	var h: int = rows.size()
	var w := 0
	for r in rows:
		w = maxi(w, String(r).length())
	for key in ["under", "mix", "orig"]:
		var extra = def.get(key)
		if extra != null and (not (extra is Array) or extra.size() != h):
			return _fail("`%s` must have one row per row" % key)
	if String(def.get("retouch", "")) != "" or int(def.get("split", 0)) > 0:
		return _fail("Retouch and split are not in the game")
	var under = def.get("under")
	var mix = def.get("mix")
	var orig = def.get("orig")

	var b := Board.new()
	b.id = String(def.get("id", ""))
	b.name = String(def.get("name", b.id if b.id != "" else "untitled"))
	b.note = String(def.get("note", ""))
	b.par = int(def.get("par", -1))
	b.w = w
	b.h = h
	b.tape = maxi(0, int(def.get("tape", 0)))
	b.palette = maxi(0, int(def.get("palette", 0)))
	b.tools = b.palette > 0
	b.tile_at.resize(w * h)
	b.tile_at.fill(-1)
	b.blocked.resize(w * h)
	b.blocked.fill(0)
	var hp: Array[int] = []
	# two passes: overpaint tiles first, then originals, so originals take the highest indices
	for pass_no in 2:
		for y in h:
			for x in w:
				var ch := _char_at(rows, y, x)
				var original := not _blank(_char_at(orig, y, x))
				var empty := ch == "#" or _blank(ch)
				if original and empty:
					return _fail("Original at %d,%d is not on a paint tile" % [x, y])
				if (pass_no == 1) if empty else (original != (pass_no == 1)):
					continue # walls and empties once; originals in pass 1
				var c := y * w + x
				var mix_here := _char_at(mix, y, x)
				if empty and not _blank(mix_here):
					return _fail("Mix at %d,%d is not on a paint tile" % [x, y])
				if ch == "#":
					b.blocked[c] = 1
					continue
				if empty:
					continue
				var up := ch.to_upper()
				var k := COLOR_CHARS.find(up)
				if k < 0:
					return _fail("Unknown char '%s' at %d,%d" % [ch, x, y])
				b.tile_at[c] = b.tile_cell.size()
				b.tile_cell.append(c)
				var uch := _char_at(under, y, x)
				var ku := -1 if _blank(uch) else COLOR_CHARS.find(uch.to_upper())
				if not _blank(uch) and ku < 0:
					return _fail("Unknown undercoat '%s' at %d,%d" % [uch, x, y])
				b.tile_color.append(k)
				b.under_color.append(ku if ku >= 0 else k)
				var layers := 1 if ch == up and ku < 0 else 2
				hp.append(layers)
				var km := -1 if _blank(mix_here) else COLOR_CHARS.find(mix_here.to_upper())
				if not _blank(mix_here) and km < 0:
					return _fail("Unknown mix pigment '%s' at %d,%d" % [mix_here, x, y])
				if km >= 0 and (layers != 1 or km == k):
					return _fail("Mix at %d,%d needs a single-layer tile of another pigment" % [x, y])
				if original and (layers != 1 or km >= 0):
					return _fail("Original at %d,%d must be a single-layer, unmixed tile" % [x, y])
				b.mix_color.append(km)
				if pass_no == 0:
					b.n_paint += 1
	b.n_tiles = b.tile_cell.size()
	b.off_add = b.n_tiles + w * h
	b.off_col = b.off_add + w * h
	b.off_palette = b.off_add + 2 * w * h + 1 # (the JS keeps a retouch-less split byte before it)
	var extra_bytes := 3 * w * h + 2 if b.tools else (w * h if b.tape > 0 else 0)
	b.init_hp.resize(hp.size() + extra_bytes)
	b.init_hp.fill(0)
	for i in hp.size():
		b.init_hp[i] = hp[i]
	return b


# ---------- tiles ----------

## True if id is an added tile (a palette dab) rather than a level tile.
static func is_added(b: Board, id: int) -> bool:
	return b.tools and id >= b.off_add


static func _highest_bit(m: int) -> int:
	var k := -1
	while m > 0:
		m >>= 1
		k += 1
	return k


## Pigment tile t shows in state hp (an added tile: its highest pigment).
static func color_of(b: Board, hp: PackedByteArray, t: int) -> int:
	if is_added(b, t):
		return _highest_bit(hp[b.off_col + (t - b.off_add)])
	return b.tile_color[t] if hp[t] >= 2 else b.under_color[t]


## Pigments tile t counts as, as a bitmask. Two tiles pair if their masks overlap.
static func mask_of(b: Board, hp: PackedByteArray, t: int) -> int:
	if is_added(b, t):
		return hp[b.off_col + (t - b.off_add)]
	var m := b.mix_color[t]
	return (1 << color_of(b, hp, t)) | ((1 << m) if m >= 0 and hp[t] == 1 else 0)


## The live tile on cell c (a level tile index or an added-tile id), or -1.
static func tile_on(b: Board, hp: PackedByteArray, c: int) -> int:
	if b.tools and hp[b.off_add + c] != 0:
		return b.off_add + c
	var t := b.tile_at[c]
	return t if t >= 0 and hp[t] > 0 else -1


## Cell of a tile index or added-tile id.
static func cell_of(b: Board, id: int) -> int:
	return id - b.off_add if is_added(b, id) else b.tile_cell[id]


static func _added_left(b: Board, hp: PackedByteArray) -> int:
	if not b.tools:
		return 0
	var n := 0
	for c in b.w * b.h:
		n += hp[b.off_add + c]
	return n


## Pigments of the added tile on cell c, as a list.
static func added_pigments(b: Board, hp: PackedByteArray, c: int) -> Array[int]:
	var m: int = hp[b.off_col + c]
	var out: Array[int] = []
	for k in MAX_COLORS:
		if m & (1 << k):
			out.append(k)
	return out


static func is_mixed(b: Board, t: int) -> bool:
	return b.mix_color[t] >= 0


## True if tile t still has a top coat whose pigment differs from the coat beneath.
static func has_undercoat(b: Board, hp: PackedByteArray, t: int) -> bool:
	return hp[t] >= 2 and b.under_color[t] != b.tile_color[t]


## True if tile t is original paint (must not be lifted).
static func is_original(b: Board, t: int) -> bool:
	return t >= b.n_paint and t < b.n_tiles


# ---------- winning and losing ----------

## True if some original tile has been lifted: the attempt is lost.
static func is_ruined(b: Board, hp: PackedByteArray) -> bool:
	for t in range(b.n_paint, b.n_tiles):
		if hp[t] == 0:
			return true
	return false


## No overpaint left: no level overpaint tile and no added tile. (Originals may remain.)
static func paint_gone(b: Board, hp: PackedByteArray) -> bool:
	return is_clear(hp, b.n_paint) and _added_left(b, hp) == 0


## Cleared: no overpaint left and no original lifted.
static func is_won(b: Board, hp: PackedByteArray) -> bool:
	return paint_gone(b, hp) and not is_ruined(b, hp)


## No paint among the first n bytes.
static func is_clear(hp: PackedByteArray, n: int) -> bool:
	for i in n:
		if hp[i] != 0:
			return false
	return true


static func tiles_left(hp: PackedByteArray, n: int) -> int:
	var s := 0
	for i in n:
		if hp[i] > 0:
			s += 1
	return s


## Overpaint layers left, added tiles included (original paint is not counted: it stays).
static func layers_left(b: Board, hp: PackedByteArray) -> int:
	var s := _added_left(b, hp)
	for i in b.n_paint:
		s += hp[i]
	return s


# ---------- masking tape ----------

static func is_taped(b: Board, hp: PackedByteArray, c: int) -> bool:
	return (b.tape > 0 or b.tools) and hp[b.n_tiles + c] == 1


static func tape_left(b: Board, hp: PackedByteArray) -> int:
	if b.tape == 0:
		return 0
	var used := 0
	for i in range(b.n_tiles, b.n_tiles + b.w * b.h):
		used += hp[i]
	return b.tape - used


static func can_tape(b: Board, hp: PackedByteArray, c: int) -> bool:
	return tape_left(b, hp) > 0 and is_empty(b, hp, c)


static func apply_tape(b: Board, hp: PackedByteArray, c: int) -> PackedByteArray:
	var n := hp.duplicate()
	n[b.n_tiles + c] = 1
	return n


static func is_empty(b: Board, hp: PackedByteArray, c: int) -> bool:
	if b.blocked[c] or is_taped(b, hp, c):
		return false
	return tile_on(b, hp, c) < 0


# ---------- strikes ----------

## Look out from `cell`. Returns null if the cell is not empty, otherwise
## {rays: [{dir, end, tile, wall}] x4, hits: [tile ids, sorted]}. `end` = the cell where the look
## stopped (-1 if it ran off the board).
static func probe(b: Board, hp: PackedByteArray, cell: int):
	if not is_empty(b, hp, cell):
		return null
	var x0 := cell % b.w
	var y0 := cell / b.w
	var rays: Array[Dictionary] = []
	for d in 4:
		var x := x0 + DIRS[d].x
		var y := y0 + DIRS[d].y
		var end := -1
		var tile := -1
		var wall := false
		while x >= 0 and y >= 0 and x < b.w and y < b.h:
			var c := y * b.w + x
			if b.blocked[c] or is_taped(b, hp, c):
				end = c
				wall = true
				break
			var t := tile_on(b, hp, c)
			if t >= 0:
				end = c
				tile = t
				break
			x += DIRS[d].x
			y += DIRS[d].y
		rays.append({"dir": d, "end": end, "tile": tile, "wall": wall})
	var hits: Array[int] = []
	for i in 4:
		var t: int = rays[i].tile
		if t < 0:
			continue
		var mt := mask_of(b, hp, t)
		for j in 4:
			var u: int = rays[j].tile
			if j != i and u >= 0 and (mask_of(b, hp, u) & mt):
				hits.append(t)
				break
	hits.sort()
	return {"rays": rays, "hits": hits}


static func apply_hits(hp: PackedByteArray, hits: Array) -> PackedByteArray:
	var n := hp.duplicate()
	for t in hits:
		n[t] -= 1
	return n


## Every distinct effective strike: cells that hit the same tiles are one move.
## Returns [{cell, cells, hits}] where `cell` is the first such cell.
static func list_moves(b: Board, hp: PackedByteArray) -> Array[Dictionary]:
	var seen := {}
	var out: Array[Dictionary] = []
	for c in b.w * b.h:
		var r = probe(b, hp, c)
		if r == null or r.hits.size() < 2:
			continue
		var key := str(r.hits)
		if seen.has(key):
			seen[key].cells.append(c)
		else:
			var m := {"cell": c, "cells": [c], "hits": r.hits}
			seen[key] = m
			out.append(m)
	return out


# ---------- palette ----------

static func palette_left(b: Board, hp: PackedByteArray) -> int:
	return b.palette - hp[b.off_palette] if b.palette > 0 else 0


## Tiles a palette dab on empty cell c takes its paint from (every tile the cell sees), sorted.
static func palette_sources(b: Board, hp: PackedByteArray, c: int) -> Array[int]:
	var out: Array[int] = []
	var r = probe(b, hp, c)
	if r == null:
		return out
	for ray in r.rays:
		if ray.tile >= 0:
			out.append(ray.tile)
	out.sort()
	return out


## Pigments a palette dab on cell c would mix (a bitmask of exactly two), or 0 if it cannot:
## the cell must see at least two tiles, showing exactly two pigments.
static func palette_mask(b: Board, hp: PackedByteArray, c: int) -> int:
	var src := palette_sources(b, hp, c)
	if src.size() < 2:
		return 0
	var m := 0
	for t in src:
		m |= mask_of(b, hp, t)
	var bits := 0
	var k := m
	while k > 0:
		k &= k - 1
		bits += 1
	return m if bits == 2 else 0


static func can_palette(b: Board, hp: PackedByteArray, c: int) -> bool:
	return palette_left(b, hp) > 0 and palette_mask(b, hp, c) != 0


## New state: paint taken from the tiles cell c sees (one layer each, as if struck), a dab of the two
## pigments mixed on c.
static func apply_palette(b: Board, hp: PackedByteArray, c: int) -> PackedByteArray:
	var m := palette_mask(b, hp, c)
	var n := apply_hits(hp, palette_sources(b, hp, c))
	n[b.off_add + c] = 1
	n[b.off_col + c] = m
	n[b.off_palette] += 1
	return n


# ---------- tool moves ----------

## Every tool move in this state (not strikes): [{tape: true, cell} | {palette: true, cell}].
static func list_tool_moves(b: Board, hp: PackedByteArray) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var n := b.w * b.h
	if b.tape > 0 and tape_left(b, hp) > 0:
		for c in n:
			if is_empty(b, hp, c):
				out.append({"tape": true, "cell": c})
	if b.tools and palette_left(b, hp) > 0:
		for c in n:
			if palette_mask(b, hp, c) != 0:
				out.append({"palette": true, "cell": c})
	return out


static func apply_tool_move(b: Board, hp: PackedByteArray, m: Dictionary) -> PackedByteArray:
	if m.get("tape", false):
		return apply_tape(b, hp, m.cell)
	return apply_palette(b, hp, m.cell)

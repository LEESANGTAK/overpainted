// Cross Tiles — core rules. Shared by the browser prototype and the Node tools.
//
// Level text format (one string per row):
//   .        empty cell (part of the revealed original painting)
//   A..F     paint tile of pigment A..F (1 layer)
//   a..f     double coat of pigment A..F (2 layers: the first match only lifts the top coat)
//   #        old tape (masking tape already on the canvas): never removed, blocks the line of sight
//
// Optional `under` rows (same size): a letter under a double coat gives the coat beneath a
// different pigment. "c" in rows + "A" in under = a C coat over an A coat. Once the top coat
// is lifted the tile is an ordinary A tile. The undercoat is shown from the start.
//
// Optional `mix` rows (same size): a letter on a single-layer tile mixes a second pigment into
// it. "A" in rows + "B" in mix = a tile of red and blue together; it pairs with red, with blue,
// and with another mixed tile that shares either. (Only single-layer tiles can be mixed.)
//
// Optional `orig` rows (same size): any letter (by convention 'o') on a single-layer, unmixed tile
// marks it as ORIGINAL paint -- part of the painting, not overpaint. It is seen and pairs like any
// tile, but it must never be lifted: a strike that lifts it ruins the painting (the attempt is lost).
// The level is cleared when every overpaint tile is gone and no original was lifted.
// Original tiles get the highest tile indices (after all overpaint), so `board.nPaint` = number
// of overpaint tiles and isClear(hp, board.nPaint) ignores the originals.
//
// A strike targets an EMPTY cell. From it, look up/right/down/left and take the nearest
// non-empty cell in each direction (old tape stops the look and yields nothing).
// Among those (up to 4) tiles, every tile that shares a pigment with at least one of the others
// loses one layer (so red + blue + a red-blue mix lifts all three).
// A strike that hits nothing is a no-op. The level is cleared when no paint tiles remain.
//
// Masking tape (optional `tape: N` on a level): the player may tape up to N cells that are
// empty right now. A taped cell blocks the line of sight like old tape (`#`) and can no longer be
// struck. Tape stays on (only undo takes it off) and is not a strike.
//
// Retouching (optional `retouch: "AB"`): one retouch dab per letter, in that pigment. The player
// may put a dab on any empty cell; it is a new single-layer overpaint tile (it must be lifted too).
//
// Splitting (optional `split: N`): up to N times, the player may split a mixed tile in two: one of
// its pigments moves to an empty neighbouring cell (up/right/down/left), the other stays. Both are
// then ordinary single-layer overpaint tiles.
//
// Palette (optional `palette: N`): up to N times, the player may mix a dab on an empty cell from
// what that cell sees: if it sees at least two tiles (up/right/down/left, as a strike looks) and
// they show exactly two pigments, the paint is taken from them -- every seen tile loses one layer,
// as if struck (so a double coat keeps its lower coat, an undercoat shows, and taking from original
// paint ruins the painting) -- and a dab of those two pigments mixed is put on the cell. The dab is
// overpaint (it has to come off too) and pairs like a mixed tile, with either of its pigments.
//
// Retouch dabs, split halves and palette dabs are ADDED tiles. They live in the state, one slot per cell, and
// are identified by `board.offAdd + cell` wherever a tile index is expected (hits, maskOf, ...).
// Placing a dab, splitting and taping each cost a move, like a strike.
//
// State (`hp`): one byte per tile = layers left. On a level with tape or tools, w*h more bytes
// follow, one per cell: 1 = taped. On a level with tools (retouch/split) three more blocks follow:
// w*h "added tile here" bytes (1 = a live added tile), w*h added-tile pigment masks (bit k =
// pigment k), then one "used" byte per retouch dab, one byte counting splits used and one byte
// counting palette dabs used. Use board.nTiles (not hp.length) to
// walk the original tiles.

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left
export const COLOR_CHARS = 'ABCDEF';
export const MAX_COLORS = COLOR_CHARS.length;

export function parseLevel(def) {
  const rows = def.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Level has no rows');
  const h = rows.length;
  const w = Math.max(...rows.map(r => r.length));
  const tileAt = new Int32Array(w * h).fill(-1);
  const blocked = new Uint8Array(w * h);
  const under = def.under;
  if (under != null && (!Array.isArray(under) || under.length !== h)) throw new Error('`under` must have one row per row');
  const mix = def.mix;
  if (mix != null && (!Array.isArray(mix) || mix.length !== h)) throw new Error('`mix` must have one row per row');
  const orig = def.orig;
  if (orig != null && (!Array.isArray(orig) || orig.length !== h)) throw new Error('`orig` must have one row per row');
  const isOrig = (x, y) => { const o = orig?.[y]?.[x] ?? '.'; return o !== '.' && o !== ' '; };
  const tileCell = [], tileColor = [], underColor = [], mixColor = [], initHp = [];
  let nPaint = 0;
  const tape = Math.max(0, def.tape | 0);
  const retouch = [...(def.retouch ?? '')].map(ch => {
    const k = COLOR_CHARS.indexOf(ch.toUpperCase());
    if (k < 0) throw new Error(`Unknown retouch pigment '${ch}'`);
    return k;
  });
  const split = Math.max(0, def.split | 0);
  const palette = Math.max(0, def.palette | 0);
  const tools = retouch.length > 0 || split > 0 || palette > 0;
  // two passes: overpaint tiles first, then originals, so originals take the highest indices
  for (const pass of [0, 1]) for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x] ?? '.';
      const original = isOrig(x, y), empty = ch === '#' || ch === '.' || ch === ' ';
      if (original && empty) throw new Error(`Original at ${x},${y} is not on a paint tile`);
      if (empty ? pass === 1 : original !== (pass === 1)) continue; // walls and empties once; originals in pass 1
      const c = y * w + x;
      const mixHere = mix?.[y]?.[x] ?? '.';
      if ((ch === '#' || ch === '.' || ch === ' ') && mixHere !== '.' && mixHere !== ' ') throw new Error(`Mix at ${x},${y} is not on a paint tile`);
      if (ch === '#') blocked[c] = 1;
      else if (ch === '.' || ch === ' ') { /* empty */ }
      else {
        const up = ch.toUpperCase();
        const k = COLOR_CHARS.indexOf(up);
        if (k < 0) throw new Error(`Unknown char '${ch}' at ${x},${y}`);
        tileAt[c] = tileCell.length;
        tileCell.push(c);
        const uch = under?.[y]?.[x] ?? '.';
        const ku = uch === '.' || uch === ' ' ? -1 : COLOR_CHARS.indexOf(uch.toUpperCase());
        if (uch !== '.' && uch !== ' ' && ku < 0) throw new Error(`Unknown undercoat '${uch}' at ${x},${y}`);
        // (mix is read below, once the tile's layer count is known)
        tileColor.push(k);
        underColor.push(ku >= 0 ? ku : k);
        initHp.push(ch === up && ku < 0 ? 1 : 2);
        const mch = mix?.[y]?.[x] ?? '.';
        const km = mch === '.' || mch === ' ' ? -1 : COLOR_CHARS.indexOf(mch.toUpperCase());
        if (mch !== '.' && mch !== ' ' && km < 0) throw new Error(`Unknown mix pigment '${mch}' at ${x},${y}`);
        if (km >= 0 && (initHp.at(-1) !== 1 || km === k)) throw new Error(`Mix at ${x},${y} needs a single-layer tile of another pigment`);
        if (original && (initHp.at(-1) !== 1 || km >= 0)) throw new Error(`Original at ${x},${y} must be a single-layer, unmixed tile`);
        mixColor.push(km);
        if (pass === 0) nPaint++;
      }
    }
  }
  const nTilesAll = tileCell.length;
  const offAdd = nTilesAll + w * h; // (only meaningful when tools)
  const extraBytes = tools ? 3 * w * h + retouch.length + 2 : tape > 0 ? w * h : 0;
  return {
    id: def.id, name: def.name ?? def.id ?? 'untitled', note: def.note ?? '', par: def.par,
    w, h, tileAt, blocked,
    tileCell: Int32Array.from(tileCell),
    tileColor: Uint8Array.from(tileColor),   // pigment of the top coat (the only coat for single tiles)
    underColor: Uint8Array.from(underColor), // pigment once the top coat is gone (= tileColor unless undercoated)
    mixColor: Int8Array.from(mixColor),      // second pigment of a mixed single tile (-1 = none)
    initHp: Uint8Array.from([...initHp, ...new Array(extraBytes).fill(0)]),
    nTiles: tileCell.length,
    nPaint, // overpaint tiles (indices 0..nPaint-1); the rest, up to nTiles, are original paint
    tape, // masking tape the player may use (0 = none)
    retouch, // pigments of the retouch dabs the player has (one each)
    split,   // splits the player may make
    palette, // palette dabs the player may mix
    tools,   // the state carries added tiles (retouch or split on this level)
    offAdd, offCol: offAdd + w * h, offRetouch: offAdd + 2 * w * h, offSplit: offAdd + 2 * w * h + retouch.length, offPalette: offAdd + 2 * w * h + retouch.length + 1,
  };
}

/** True if id is an added tile (retouch dab or split half) rather than a level tile. */
export function isAdded(board, id) {
  return board.tools && id >= board.offAdd;
}

/** Pigment index tile t shows in state hp. */
export function colorOf(board, hp, t) {
  if (isAdded(board, t)) return 31 - Math.clz32(hp[board.offCol + (t - board.offAdd)]); // (its highest pigment)
  return hp[t] >= 2 ? board.tileColor[t] : board.underColor[t];
}

/** Pigments tile t counts as in state hp, as a bitmask (bit k = pigment k). Two tiles pair if their masks overlap. */
export function maskOf(board, hp, t) {
  if (isAdded(board, t)) return hp[board.offCol + (t - board.offAdd)];
  const m = board.mixColor[t];
  return (1 << colorOf(board, hp, t)) | (m >= 0 && hp[t] === 1 ? 1 << m : 0);
}

/** The live tile on cell c (a level tile index or an added-tile id), or -1. */
export function tileOn(board, hp, c) {
  if (board.tools && hp[board.offAdd + c]) return board.offAdd + c;
  const t = board.tileAt[c];
  return t >= 0 && hp[t] > 0 ? t : -1;
}

/** Cell of a tile index or added-tile id. */
export function cellOf(board, id) {
  return isAdded(board, id) ? id - board.offAdd : board.tileCell[id];
}

/** Number of live added tiles. */
function addedLeft(board, hp) {
  if (!board.tools) return 0;
  let n = 0;
  for (let c = 0; c < board.w * board.h; c++) n += hp[board.offAdd + c];
  return n;
}

/** Retouch dabs still unused: their indices into board.retouch. */
export function retouchLeft(board, hp) {
  const out = [];
  for (let i = 0; i < board.retouch.length; i++) if (!hp[board.offRetouch + i]) out.push(i);
  return out;
}

/** True if dab i can go on cell c now. */
export function canRetouch(board, hp, i, c) {
  return i >= 0 && i < board.retouch.length && !hp[board.offRetouch + i] && isEmpty(board, hp, c);
}

/** New state with retouch dab i on cell c. */
export function applyRetouch(board, hp, i, c) {
  const n = hp.slice();
  n[board.offAdd + c] = 1; n[board.offCol + c] = 1 << board.retouch[i]; n[board.offRetouch + i] = 1;
  return n;
}

/** Splits still available. */
export function splitLeft(board, hp) {
  return board.split ? board.split - hp[board.offSplit] : 0;
}

/** True if level tile t can be split now (a live mixed tile, a split left). */
export function canSplitTile(board, hp, t) {
  return splitLeft(board, hp) > 0 && t >= 0 && t < board.nTiles && board.mixColor[t] >= 0 && hp[t] === 1;
}

/** True if tile t can be split with pigment k moving to cell c (an empty neighbour). */
export function canSplit(board, hp, t, c, k) {
  if (!canSplitTile(board, hp, t) || (k !== board.tileColor[t] && k !== board.mixColor[t])) return false;
  const from = board.tileCell[t], w = board.w;
  const dx = Math.abs(c % w - from % w), dy = Math.abs(((c / w) | 0) - ((from / w) | 0));
  return dx + dy === 1 && isEmpty(board, hp, c);
}

/** New state: mixed tile t split, pigment k moved to cell c, the other pigment stays in place. */
export function applySplit(board, hp, t, c, k) {
  const n = hp.slice();
  const from = board.tileCell[t];
  const stay = k === board.tileColor[t] ? board.mixColor[t] : board.tileColor[t];
  n[t] = 0;
  n[board.offAdd + from] = 1; n[board.offCol + from] = 1 << stay;
  n[board.offAdd + c] = 1; n[board.offCol + c] = 1 << k;
  n[board.offSplit]++;
  return n;
}

/** Palette dabs still available. */
export function paletteLeft(board, hp) {
  return board.palette ? board.palette - hp[board.offPalette] : 0;
}

/** Tiles a palette dab on empty cell c takes its paint from (every tile the cell sees), sorted. */
export function paletteSources(board, hp, c) {
  const r = probe(board, hp, c);
  return r ? r.rays.filter(ray => ray.tile >= 0).map(ray => ray.tile).sort((a, b) => a - b) : [];
}

/** Pigments a palette dab on empty cell c would mix (a bitmask of exactly two), or 0 if it cannot. */
export function paletteMask(board, hp, c) {
  const src = paletteSources(board, hp, c);
  if (src.length < 2) return 0;
  let m = 0;
  for (const t of src) m |= maskOf(board, hp, t);
  let bits = 0;
  for (let k = m; k; k &= k - 1) bits++;
  return bits === 2 ? m : 0;
}

/** True if a palette dab can be mixed on cell c now. */
export function canPalette(board, hp, c) {
  return paletteLeft(board, hp) > 0 && paletteMask(board, hp, c) !== 0;
}

/** New state: paint taken from the tiles cell c sees (one layer each), a palette dab mixed on c. */
export function applyPalette(board, hp, c) {
  const m = paletteMask(board, hp, c);
  const n = applyHits(hp, paletteSources(board, hp, c));
  n[board.offAdd + c] = 1; n[board.offCol + c] = m; n[board.offPalette]++;
  return n;
}

/** Pigments of an added tile, as a list (one, or two for a palette dab). */
export function addedPigments(board, hp, c) {
  const m = hp[board.offCol + c], out = [];
  for (let k = 0; k < MAX_COLORS; k++) if (m & (1 << k)) out.push(k);
  return out;
}

/**
 * Every tool move in this state (not strikes): tape, retouch, split and palette.
 * Returns [{tape:true, cell} | {retouch:i, cell} | {split:t, cell, color} | {palette:true, cell}].
 */
export function listToolMoves(board, hp) {
  const out = [], N = board.w * board.h;
  if (board.tape && tapeLeft(board, hp) > 0) for (let c = 0; c < N; c++) if (isEmpty(board, hp, c)) out.push({ tape: true, cell: c });
  if (board.tools) {
    // two unused dabs of the same pigment are the same move
    const seen = new Set();
    for (const i of retouchLeft(board, hp)) {
      if (seen.has(board.retouch[i])) continue;
      seen.add(board.retouch[i]);
      for (let c = 0; c < N; c++) if (isEmpty(board, hp, c)) out.push({ retouch: i, cell: c });
    }
    if (splitLeft(board, hp) > 0) for (let t = 0; t < board.nTiles; t++) {
      if (!canSplitTile(board, hp, t)) continue;
      const from = board.tileCell[t], x = from % board.w, y = (from / board.w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= board.w || ny >= board.h) continue;
        const c = ny * board.w + nx;
        if (!isEmpty(board, hp, c)) continue;
        for (const k of [board.tileColor[t], board.mixColor[t]]) out.push({ split: t, cell: c, color: k });
      }
    }
    if (paletteLeft(board, hp) > 0) for (let c = 0; c < N; c++) if (paletteMask(board, hp, c)) out.push({ palette: true, cell: c });
  }
  return out;
}

/** Apply a tool move from listToolMoves. */
export function applyToolMove(board, hp, m) {
  if (m.tape) return applyTape(board, hp, m.cell);
  if (m.retouch != null) return applyRetouch(board, hp, m.retouch, m.cell);
  if (m.palette) return applyPalette(board, hp, m.cell);
  return applySplit(board, hp, m.split, m.cell, m.color);
}

/** True if tile t is original paint (must not be lifted). */
export function isOriginal(board, t) {
  return t >= board.nPaint && t < board.nTiles;
}

/** True if some original tile has been lifted in state hp: the attempt is lost. */
export function isRuined(board, hp) {
  for (let t = board.nPaint; t < board.nTiles; t++) if (hp[t] === 0) return true;
  return false;
}

/** No overpaint left: no level overpaint tile and no added tile. (Originals may remain.) */
export function paintGone(board, hp) {
  return isClear(hp, board.nPaint) && addedLeft(board, hp) === 0;
}

/** Cleared: no overpaint left and no original lifted. */
export function isWon(board, hp) {
  return paintGone(board, hp) && !isRuined(board, hp);
}

/** True if tile t is a mixed tile (two pigments). */
export function isMixed(board, t) {
  return board.mixColor[t] >= 0;
}

/** True if tile t still has a top coat whose pigment differs from the coat beneath. */
export function hasUndercoat(board, hp, t) {
  return hp[t] >= 2 && board.underColor[t] !== board.tileColor[t];
}

/** Rows (string[]) for the board in the given state. */
export function toRows(board, hp = board.initHp) {
  const rows = [];
  for (let y = 0; y < board.h; y++) {
    let s = '';
    for (let x = 0; x < board.w; x++) {
      const c = y * board.w + x;
      if (board.blocked[c]) { s += '#'; continue; }
      const t = board.tileAt[c];
      if (t < 0 || hp[t] === 0) { s += '.'; continue; }
      const ch = COLOR_CHARS[colorOf(board, hp, t)];
      s += hp[t] >= 2 ? ch.toLowerCase() : ch;
    }
    rows.push(s);
  }
  return rows;
}

/** `mix` rows for the board in the given state, or null if no tile is mixed. */
export function toMix(board, hp = board.initHp) {
  let any = false;
  const rows = [];
  for (let y = 0; y < board.h; y++) {
    let s = '';
    for (let x = 0; x < board.w; x++) {
      const t = board.tileAt[y * board.w + x];
      if (t >= 0 && hp[t] > 0 && board.mixColor[t] >= 0) { s += COLOR_CHARS[board.mixColor[t]]; any = true; }
      else s += '.';
    }
    rows.push(s);
  }
  return any ? rows : null;
}

/** `orig` rows for the board, or null if no tile is original paint. */
export function toOrig(board, hp = board.initHp) {
  if (board.nPaint === board.nTiles) return null;
  const rows = [];
  for (let y = 0; y < board.h; y++) {
    let s = '';
    for (let x = 0; x < board.w; x++) {
      const t = board.tileAt[y * board.w + x];
      s += t >= 0 && hp[t] > 0 && isOriginal(board, t) ? 'o' : '.';
    }
    rows.push(s);
  }
  return rows;
}

/** `under` rows for the board in the given state, or null if no tile has a different undercoat. */
export function toUnder(board, hp = board.initHp) {
  let any = false;
  const rows = [];
  for (let y = 0; y < board.h; y++) {
    let s = '';
    for (let x = 0; x < board.w; x++) {
      const t = board.tileAt[y * board.w + x];
      if (t >= 0 && hasUndercoat(board, hp, t)) { s += COLOR_CHARS[board.underColor[t]]; any = true; }
      else s += '.';
    }
    rows.push(s);
  }
  return any ? rows : null;
}

/** True if cell c carries masking tape in state hp. */
export function isTaped(board, hp, c) {
  return (board.tape > 0 || board.tools) && hp[board.nTiles + c] === 1;
}

/** Tape the player still has in state hp. */
export function tapeLeft(board, hp) {
  if (!board.tape) return 0;
  let used = 0;
  for (let i = board.nTiles, e = board.nTiles + board.w * board.h; i < e; i++) used += hp[i];
  return board.tape - used;
}

/** True if tape can go on cell c now (an empty, untaped cell, with tape left). */
export function canTape(board, hp, c) {
  return tapeLeft(board, hp) > 0 && isEmpty(board, hp, c);
}

/** New state with cell c taped. */
export function applyTape(board, hp, c) {
  const n = hp.slice();
  n[board.nTiles + c] = 1;
  return n;
}

export function isEmpty(board, hp, c) {
  if (board.blocked[c] || isTaped(board, hp, c)) return false;
  return tileOn(board, hp, c) < 0;
}

/**
 * Look out from `cell`. Returns null if the cell is not empty, otherwise
 * { rays: [{dir, end, tile, wall}], hits: [tileIndex...] }.
 * `end` is the cell where the look stopped (-1 if it ran off the board).
 */
export function probe(board, hp, cell) {
  if (!isEmpty(board, hp, cell)) return null;
  const { w, h } = board;
  const x0 = cell % w, y0 = (cell / w) | 0;
  const rays = [];
  for (let d = 0; d < 4; d++) {
    const [dx, dy] = DIRS[d];
    let x = x0 + dx, y = y0 + dy, end = -1, tile = -1, wall = false;
    while (x >= 0 && y >= 0 && x < w && y < h) {
      const c = y * w + x;
      if (board.blocked[c] || isTaped(board, hp, c)) { end = c; wall = true; break; }
      const t = tileOn(board, hp, c);
      if (t >= 0) { end = c; tile = t; break; }
      x += dx; y += dy;
    }
    rays.push({ dir: d, end, tile, wall });
  }
  const hits = [];
  for (let i = 0; i < 4; i++) {
    const t = rays[i].tile;
    if (t < 0) continue;
    const mt = maskOf(board, hp, t);
    for (let j = 0; j < 4; j++) {
      const u = rays[j].tile;
      if (j !== i && u >= 0 && (maskOf(board, hp, u) & mt)) { hits.push(t); break; }
    }
  }
  hits.sort((a, b) => a - b);
  return { rays, hits };
}

export function applyHits(hp, hits) {
  const n = hp.slice();
  for (const t of hits) n[t]--;
  return n;
}

/** No paint left. `n` = board.nTiles on a level with tape (the tape bytes are not paint). */
export function isClear(hp, n = hp.length) {
  for (let i = 0; i < n; i++) if (hp[i]) return false;
  return true;
}

export function tilesLeft(hp, n = hp.length) {
  let s = 0;
  for (let i = 0; i < n; i++) if (hp[i] > 0) s++;
  return s;
}

/** Overpaint layers left, added tiles included (original paint is not counted: it stays). */
export function layersLeft(board, hp) {
  let s = addedLeft(board, hp);
  for (let i = 0; i < board.nPaint; i++) s += hp[i];
  return s;
}

/**
 * All distinct effective strikes in this state. Different cells that hit the same set of
 * tiles are one move. Returns [{cell, cells, hits}] where `cell` is a representative.
 */
export function listMoves(board, hp) {
  const seen = new Map();
  const N = board.w * board.h;
  for (let c = 0; c < N; c++) {
    const r = probe(board, hp, c);
    if (!r || r.hits.length < 2) continue;
    const key = r.hits.join(',');
    const m = seen.get(key);
    if (m) m.cells.push(c);
    else seen.set(key, { cell: c, cells: [c], hits: r.hits });
  }
  return [...seen.values()];
}

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
// State (`hp`): one byte per tile = layers left. On a level with tape, w*h more bytes follow,
// one per cell: 1 = taped. Use board.nTiles (not hp.length) to walk the tiles.

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
  const tileCell = [], tileColor = [], underColor = [], mixColor = [], initHp = [];
  const tape = Math.max(0, def.tape | 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x] ?? '.';
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
        mixColor.push(km);
      }
    }
  }
  return {
    id: def.id, name: def.name ?? def.id ?? 'untitled', note: def.note ?? '', par: def.par,
    w, h, tileAt, blocked,
    tileCell: Int32Array.from(tileCell),
    tileColor: Uint8Array.from(tileColor),   // pigment of the top coat (the only coat for single tiles)
    underColor: Uint8Array.from(underColor), // pigment once the top coat is gone (= tileColor unless undercoated)
    mixColor: Int8Array.from(mixColor),      // second pigment of a mixed single tile (-1 = none)
    initHp: Uint8Array.from(tape > 0 ? [...initHp, ...new Array(w * h).fill(0)] : initHp),
    nTiles: tileCell.length,
    tape, // masking tape the player may use (0 = none)
  };
}

/** Pigment index tile t shows in state hp. */
export function colorOf(board, hp, t) {
  return hp[t] >= 2 ? board.tileColor[t] : board.underColor[t];
}

/** Pigments tile t counts as in state hp, as a bitmask (bit k = pigment k). Two tiles pair if their masks overlap. */
export function maskOf(board, hp, t) {
  const m = board.mixColor[t];
  return (1 << colorOf(board, hp, t)) | (m >= 0 && hp[t] === 1 ? 1 << m : 0);
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
  return board.tape > 0 && hp[board.nTiles + c] === 1;
}

/** Tape the player still has in state hp. */
export function tapeLeft(board, hp) {
  if (!board.tape) return 0;
  let used = 0;
  for (let i = board.nTiles; i < hp.length; i++) used += hp[i];
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
  const t = board.tileAt[c];
  return t < 0 || hp[t] === 0;
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
      const t = board.tileAt[c];
      if (t >= 0 && hp[t] > 0) { end = c; tile = t; break; }
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

/** Paint layers left. */
export function layersLeft(board, hp) {
  let s = 0;
  for (let i = 0; i < board.nTiles; i++) s += hp[i];
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

// Cross Tiles — core rules. Shared by the browser prototype and the Node tools.
//
// Level text format (one string per row):
//   .        empty cell (part of the revealed original painting)
//   A..F     paint tile of pigment A..F (1 layer)
//   a..f     varnished tile of pigment A..F (2 layers: first match only strips the varnish)
//   #        gold leaf: never removed, blocks the line of sight
//
// A strike targets an EMPTY cell. From it, look up/right/down/left and take the nearest
// non-empty cell in each direction (gold leaf stops the look and yields nothing).
// Among those (up to 4) tiles, every tile whose pigment appears 2+ times loses one layer.
// A strike that hits nothing is a no-op. The level is cleared when no paint tiles remain.

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
  const tileCell = [], tileColor = [], initHp = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x] ?? '.';
      const c = y * w + x;
      if (ch === '#') blocked[c] = 1;
      else if (ch === '.' || ch === ' ') { /* empty */ }
      else {
        const up = ch.toUpperCase();
        const k = COLOR_CHARS.indexOf(up);
        if (k < 0) throw new Error(`Unknown char '${ch}' at ${x},${y}`);
        tileAt[c] = tileCell.length;
        tileCell.push(c);
        tileColor.push(k);
        initHp.push(ch === up ? 1 : 2);
      }
    }
  }
  return {
    id: def.id, name: def.name ?? def.id ?? 'untitled', note: def.note ?? '', par: def.par,
    w, h, tileAt, blocked,
    tileCell: Int32Array.from(tileCell),
    tileColor: Uint8Array.from(tileColor),
    initHp: Uint8Array.from(initHp),
    nTiles: tileCell.length,
  };
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
      const ch = COLOR_CHARS[board.tileColor[t]];
      s += hp[t] >= 2 ? ch.toLowerCase() : ch;
    }
    rows.push(s);
  }
  return rows;
}

export function isEmpty(board, hp, c) {
  if (board.blocked[c]) return false;
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
      if (board.blocked[c]) { end = c; wall = true; break; }
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
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const u = rays[j].tile;
      if (u >= 0 && board.tileColor[u] === board.tileColor[t]) n++;
    }
    if (n >= 2) hits.push(t);
  }
  hits.sort((a, b) => a - b);
  return { rays, hits };
}

export function applyHits(hp, hits) {
  const n = hp.slice();
  for (const t of hits) n[t]--;
  return n;
}

export function isClear(hp) {
  for (let i = 0; i < hp.length; i++) if (hp[i]) return false;
  return true;
}

export function tilesLeft(hp) {
  let s = 0;
  for (let i = 0; i < hp.length; i++) if (hp[i] > 0) s++;
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

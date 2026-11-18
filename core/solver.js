// Cross Tiles — exhaustive solver and difficulty metrics.
//
// Every strike removes at least one paint layer, so the state graph is a DAG and a
// memoised DFS visits each reachable state exactly once. From that one pass we get:
//   minStrikes        fewest strikes to clear (the level's par)
//   pRandom           chance a player picking uniformly among distinct effective strikes clears it
//   trapBits          -log2(pRandom): "random play succeeds 1 in 2^trapBits"
//   startMoves/Safe   distinct strikes at the start, and how many keep the level solvable
//   optimalSolutions  number of distinct strike sequences that reach par (low = a sharper "aha")
//   deadStates        reachable positions with paint left and no effective strike
//   unsolvableRatio   share of reachable positions from which clearing is impossible

import { isClear } from './rules.js';

export class SearchLimit extends Error {
  constructor(states) { super(`State limit reached (${states})`); this.states = states; }
}

/** Precomputed look-out cell lists for each cell and direction. */
function buildRays(board) {
  const { w, h } = board;
  const rays = new Array(w * h);
  for (let c = 0; c < w * h; c++) {
    const x0 = c % w, y0 = (c / w) | 0;
    const dirs = [];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const list = [];
      for (let x = x0 + dx, y = y0 + dy; x >= 0 && y >= 0 && x < w && y < h; x += dx, y += dy) list.push(y * w + x);
      dirs.push(Int32Array.from(list));
    }
    rays[c] = dirs;
  }
  return rays;
}

/** Fast distinct-move enumeration for the solver. Returns [{cell, hits:number[]}]. */
function movesFast(board, rays, hp) {
  const { tileAt, blocked, tileColor, underColor } = board;
  const col = t => (hp[t] >= 2 ? tileColor[t] : underColor[t]);
  const N = board.w * board.h;
  const out = new Map();
  const found = [-1, -1, -1, -1];
  for (let c = 0; c < N; c++) {
    if (blocked[c]) continue;
    const t0 = tileAt[c];
    if (t0 >= 0 && hp[t0] > 0) continue;
    const r = rays[c];
    let n = 0;
    for (let d = 0; d < 4; d++) {
      found[d] = -1;
      const list = r[d];
      for (let i = 0; i < list.length; i++) {
        const cc = list[i];
        if (blocked[cc]) break;
        const t = tileAt[cc];
        if (t >= 0 && hp[t] > 0) { found[d] = t; n++; break; }
      }
    }
    if (n < 2) continue;
    const hits = [];
    for (let i = 0; i < 4; i++) {
      const t = found[i];
      if (t < 0) continue;
      const ct = col(t);
      let k = 0;
      for (let j = 0; j < 4; j++) if (found[j] >= 0 && col(found[j]) === ct) k++;
      if (k >= 2) hits.push(t);
    }
    if (hits.length < 2) continue;
    hits.sort((a, b) => a - b);
    // up to 4 tile indices < 256 -> one 32-bit-safe number key
    let key = 0;
    for (const t of hits) key = key * 256 + (t + 1);
    if (!out.has(key)) out.set(key, { cell: c, hits });
  }
  return [...out.values()];
}

function keyOf(hp) {
  return String.fromCharCode.apply(null, hp);
}

function step(hp, hits) {
  const n = hp.slice();
  for (const t of hits) n[t]--;
  return n;
}

/**
 * Full analysis from `hp` (defaults to the level start).
 * Throws SearchLimit if more than `maxStates` positions are reachable.
 */
export function analyze(board, { hp = board.initHp, maxStates = 1_000_000 } = {}) {
  if (board.nTiles > 255) throw new Error('Too many tiles for the solver (max 255)');
  const rays = buildRays(board);
  const memo = new Map();
  let dead = 0, unsolvable = 0;

  function visit(state) {
    const key = keyOf(state);
    const hit = memo.get(key);
    if (hit) return hit;
    if (memo.size >= maxStates) throw new SearchLimit(memo.size);
    let r;
    if (isClear(state)) {
      r = { f: 0, p: 1, ways: 1, nMoves: 0, safe: 0 };
    } else {
      const moves = movesFast(board, rays, state);
      if (moves.length === 0) {
        dead++;
        r = { f: Infinity, p: 0, ways: 0, nMoves: 0, safe: 0 };
      } else {
        let f = Infinity, p = 0, ways = 0, safe = 0;
        for (const m of moves) {
          const c = visit(step(state, m.hits));
          p += c.p;
          if (c.f < Infinity) safe++;
          const g = c.f + 1;
          if (g < f) { f = g; ways = c.ways; }
          else if (g === f && f < Infinity) ways = Math.min(ways + c.ways, Number.MAX_SAFE_INTEGER);
        }
        r = { f, p: p / moves.length, ways, nMoves: moves.length, safe };
      }
    }
    if (r.f === Infinity) unsolvable++;
    memo.set(key, r);
    return r;
  }

  const t0 = Date.now();
  const root = visit(hp);

  // Reconstruct one optimal line (representative cell per strike).
  const solution = [];
  if (root.f < Infinity) {
    let state = hp;
    while (!isClear(state)) {
      const want = memo.get(keyOf(state)).f - 1;
      let chosen = null;
      for (const m of movesFast(board, rays, state)) {
        const next = step(state, m.hits);
        if (memo.get(keyOf(next)).f === want) { chosen = { m, next }; break; }
      }
      solution.push({ cell: chosen.m.cell, hits: chosen.m.hits });
      state = chosen.next;
    }
  }

  return {
    solvable: root.f < Infinity,
    minStrikes: root.f < Infinity ? root.f : null,
    pRandom: root.p,
    trapBits: root.p > 0 ? -Math.log2(root.p) : Infinity,
    startMoves: root.nMoves,
    startSafe: root.safe,
    optimalSolutions: root.ways,
    states: memo.size,
    deadStates: dead,
    unsolvableRatio: unsolvable / memo.size,
    solution,
    ms: Date.now() - t0,
  };
}

/**
 * Cheaper "is there any way out?" search for big positions (used for hints when a full
 * analysis would be too large). Returns {path} or {path:null}; throws SearchLimit.
 */
export function findSolution(board, { hp = board.initHp, maxStates = 2_000_000 } = {}) {
  const rays = buildRays(board);
  const deadSet = new Set();
  function dfs(state, path) {
    if (isClear(state)) return true;
    const key = keyOf(state);
    if (deadSet.has(key)) return false;
    if (deadSet.size >= maxStates) throw new SearchLimit(deadSet.size);
    const moves = movesFast(board, rays, state);
    moves.sort((a, b) => b.hits.length - a.hits.length);
    for (const m of moves) {
      path.push({ cell: m.cell, hits: m.hits });
      if (dfs(step(state, m.hits), path)) return true;
      path.pop();
    }
    deadSet.add(key);
    return false;
  }
  const path = [];
  return { path: dfs(hp, path) ? path : null };
}

/** One-line summary used by the CLI tools. */
export function describe(a) {
  if (!a.solvable) return `UNSOLVABLE  states=${a.states} dead=${a.deadStates}`;
  return [
    `par=${a.minStrikes}`,
    `pRandom=${(a.pRandom * 100).toFixed(1)}%`,
    `trap=${a.trapBits.toFixed(2)}b`,
    `start=${a.startSafe}/${a.startMoves} safe`,
    `optimal=${a.optimalSolutions}`,
    `states=${a.states}`,
    `${a.ms}ms`,
  ].join('  ');
}

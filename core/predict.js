// First-move predictor: how likely is a player to pick each strike, by instinct, before
// calculating anything? Used to check whether a level's *tempting* move is its trap.
//
// Model: conditional logit. Each move gets a score w·f (features below); the probability of a
// move is softmax(score) over all moves available in the position. Weights start from the
// hypotheses we have and are refit from playtest logs with tools/predict.mjs --calibrate.
import { listMoves, probe, applyHits, colorOf } from './rules.js';

export const FEATURES = [
  // "solve the easy question first": the strike lifts every remaining tile of a pigment
  ['closes', 'finishes a pigment (all its remaining tiles)'],
  // that pigment is the rarest one left on the board
  ['rarest', 'lifts the pigment with the fewest tiles left'],
  ['hits', 'tiles lifted (÷4)'],
  // two tiles facing each other across the struck cell, like the first lesson
  ['straight', 'a pair facing each other in one straight line'],
  ['reach', 'mean distance from the struck cell to the tiles (÷ board size)'],
  ['varnish', 'only strips varnish from some of the tiles'],
  ['red', 'lifts vermilion (pigment A)'],
];

// Starting weights (hand-set from the first playtests; see memory: fewest-tiles colour is the bait).
export const DEFAULT_WEIGHTS = { closes: 2.0, rarest: 1.0, hits: 0.6, straight: 0.5, reach: -1.5, varnish: -0.4, red: 0.0 };

/** Remaining tile count per pigment. */
function countsByColor(board, hp) {
  const n = new Array(6).fill(0);
  for (let t = 0; t < hp.length; t++) if (hp[t] > 0) n[colorOf(board, hp, t)]++;
  return n;
}

/** Feature vector (object) for one move {cell, hits} in position hp. */
export function moveFeatures(board, hp, move, counts = countsByColor(board, hp)) {
  const { w, h } = board;
  const after = applyHits(hp, move.hits);
  const colors = [...new Set(move.hits.map(t => colorOf(board, hp, t)))];
  let closes = 0;
  for (const k of colors) {
    let left = 0;
    for (let t = 0; t < after.length; t++) if (after[t] > 0 && colorOf(board, after, t) === k) left++;
    if (left === 0) closes = 1;
  }
  const present = counts.filter(n => n > 0);
  const minCount = Math.min(...present);
  const rarest = colors.some(k => counts[k] === minCount) && present.length > 1 ? 1 : 0;
  const x0 = move.cell % w, y0 = (move.cell / w) | 0;
  let dist = 0;
  const dirs = [];
  for (const t of move.hits) {
    const c = board.tileCell[t], x = c % w, y = (c / w) | 0;
    dist += Math.abs(x - x0) + Math.abs(y - y0);
    dirs.push(x === x0 ? 'v' : 'h');
  }
  const straight = move.hits.length === 2 && dirs[0] === dirs[1] ? 1 : 0;
  return {
    closes, rarest,
    hits: move.hits.length / 4,
    straight,
    reach: dist / move.hits.length / Math.max(w, h),
    varnish: move.hits.some(t => hp[t] >= 2) ? 1 : 0,
    red: colors.includes(0) ? 1 : 0,
  };
}

/**
 * All moves in the position with features, score and probability, most likely first.
 * Different cells that lift the same tiles are one move; the player's cell maps via moveKey().
 */
export function predictMoves(board, hp, weights = DEFAULT_WEIGHTS) {
  const counts = countsByColor(board, hp);
  const moves = listMoves(board, hp).map(m => {
    const f = moveFeatures(board, hp, m, counts);
    let s = 0;
    for (const [k] of FEATURES) s += (weights[k] ?? 0) * f[k];
    return { cell: m.cell, cells: m.cells, hits: m.hits, key: m.hits.join(','), f, score: s };
  });
  const mx = Math.max(...moves.map(m => m.score));
  let z = 0;
  for (const m of moves) z += (m.p = Math.exp(m.score - mx));
  for (const m of moves) m.p /= z;
  return moves.sort((a, b) => b.p - a.p);
}

/** Key of the move a click on `cell` makes (null if it lifts nothing). */
export function moveKey(board, hp, cell) {
  const r = probe(board, hp, cell);
  return r && r.hits.length >= 2 ? r.hits.join(',') : null;
}

/**
 * Bait report for a level start: how much instinct points at losing moves.
 * `isLost(hp)` tells whether a position can no longer be restored (from the solver).
 */
export function baitReport(board, isLost, weights = DEFAULT_WEIGHTS, hp = board.initHp) {
  const moves = predictMoves(board, hp, weights);
  for (const m of moves) m.fatal = isLost(applyHits(hp, m.hits));
  const top = moves[0];
  return {
    moves,
    top,
    topFatal: !!top?.fatal,
    pFatal: moves.reduce((s, m) => s + (m.fatal ? m.p : 0), 0), // chance the instinctive first strike loses
  };
}

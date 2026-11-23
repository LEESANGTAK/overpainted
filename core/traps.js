// Mid-game traps: the overpainter's lines for the move that made a level unwinnable.
//
// A level may list `traps` (checked in order, first match wins):
//   { "lifts": [[x, y], ...], "voice": { "stuck": "...", "win": "..." }, "ko": { "voice": { ... } } }
//       a strike that lifts at least these tiles (it may lift more)
//   { "tape": [x, y] | "any", "voice": { ... } }
//       masking tape on that cell, or anywhere
//   optional "after": N  only when at least N moves were made before this one (the same move can
//       lose for a different reason at the start than later on)
// A trap only counts when its move was the blunder: the position was still winnable before it
// and is not after it. `stuck` is said at the dead end that follows; `win` when the level is then
// restored on a later attempt in the same visit (like the first-move bait's lines).

/**
 * The first trap of `def` that `move` ({tape, cell} or {hits}) matches, or null. `movesBefore` = moves
 * made before this one in the attempt. Does not check that the move was a blunder.
 */
export function matchTrap(def, board, move, movesBefore = 0) {
  for (const trap of def.traps ?? []) {
    if (movesBefore < (trap.after ?? 0)) continue;
    if (trap.tape != null) {
      if (!move.tape) continue;
      if (trap.tape === 'any' || trap.tape[1] * board.w + trap.tape[0] === move.cell) return trap;
    } else if (trap.lifts) {
      if (move.tape) continue;
      if (trap.lifts.every(([x, y]) => move.hits.includes(board.tileAt[y * board.w + x]))) return trap;
    }
  }
  return null;
}

/** Throws if a trap names a cell that is not a paint tile (lifts) or not a cell that can be empty (tape). */
export function checkTraps(def, board) {
  for (const trap of def.traps ?? []) {
    if (!trap.voice?.stuck) throw new Error(`${def.id}: trap without a stuck line`);
    if (trap.lifts) for (const [x, y] of trap.lifts) {
      if (board.tileAt[y * board.w + x] < 0) throw new Error(`${def.id}: trap lifts ${x},${y}, which is not a tile`);
    } else if (trap.tape !== 'any') {
      const [x, y] = trap.tape ?? [];
      const c = y * board.w + x;
      if (!(x >= 0 && y >= 0 && x < board.w && y < board.h) || board.blocked[c]) throw new Error(`${def.id}: bad tape cell for a trap`);
    }
  }
}

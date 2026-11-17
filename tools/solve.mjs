// Analyse every level in a levels file.
//   node tools/solve.mjs levels/prototype.json            print a report
//   node tools/solve.mjs levels/prototype.json --write    also store par + metrics in the file
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLevel } from '../core/rules.js';
import { analyze, describe, SearchLimit } from '../core/solver.js';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: node tools/solve.mjs <levels.json> [--write] [--max N]'); process.exit(1); }
const write = args.includes('--write');
const maxIdx = args.indexOf('--max');
const maxStates = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 3_000_000;

const data = JSON.parse(readFileSync(file, 'utf8'));
const levels = Array.isArray(data) ? data : data.levels;
let bad = 0;
for (const def of levels) {
  const board = parseLevel(def);
  let line;
  try {
    const a = analyze(board, { maxStates });
    line = describe(a);
    if (!a.solvable) bad++;
    if (write && a.solvable) {
      def.par = a.minStrikes;
      def.metrics = {
        pRandom: +a.pRandom.toFixed(4), trapBits: +a.trapBits.toFixed(2),
        startMoves: a.startMoves, startSafe: a.startSafe,
        optimalSolutions: a.optimalSolutions, states: a.states,
      };
    }
  } catch (e) {
    if (!(e instanceof SearchLimit)) throw e;
    line = `TOO LARGE (> ${maxStates} states)`;
  }
  console.log(`${(def.id ?? '?').padEnd(10)} ${String(board.w + 'x' + board.h).padEnd(6)} tiles=${String(board.nTiles).padEnd(3)} ${line}`);
}
if (write) { writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); console.log(`\nwrote ${file}`); }
if (bad) { console.log(`\n${bad} unsolvable level(s)`); process.exitCode = 1; }

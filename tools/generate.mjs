// Generate candidate levels: random solvable boards, then hill-climb towards more traps.
// The output is raw material for a designer to curate in the editor, not shippable levels.
//
//   node tools/generate.mjs --w 6 --h 6 --tiles 16 --colors 4 --count 8 --climb 300
//   options: --blockers N  --varnish N  --seed N  --min-par N  --max-trap B  --max-states N  --out file
import { writeFileSync } from 'node:fs';
import { parseLevel, COLOR_CHARS } from '../core/rules.js';
import { analyze, describe, SearchLimit } from '../core/solver.js';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (isNaN(+argv[i + 1]) ? argv[i + 1] : +argv[i + 1]) : def;
};
const W = opt('w', 6), H = opt('h', 6), TILES = opt('tiles', 16), COLORS = opt('colors', 4);
const BLOCKERS = opt('blockers', 0), VARNISH = opt('varnish', 0);
const COUNT = opt('count', 8), CLIMB = opt('climb', 300), MIN_PAR = opt('min-par', 0);
const MAX_TRAP = opt('max-trap', Infinity); // cap difficulty so a ramp can be built band by band
const MAX_STATES = opt('max-states', 300_000), OUT = opt('out', 'levels/candidates.json');
let seed = opt('seed', Date.now() % 1e9);
const startSeed = seed;

if (BLOCKERS + TILES > W * H - 1) throw new Error('Board too small');
if (COLORS < 1 || COLORS > COLOR_CHARS.length || TILES < COLORS * 2) throw new Error('Need 2+ tiles per colour');

function rnd() { // mulberry32
  seed = (seed + 0x6D2B79F5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = n => Math.floor(rnd() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function randomGrid() {
  const g = new Array(W * H).fill('.');
  const cells = shuffle([...Array(W * H).keys()]);
  let k = 0;
  for (let i = 0; i < BLOCKERS; i++) g[cells[k++]] = '#';
  const colors = [];
  for (let c = 0; c < COLORS; c++) colors.push(c, c);
  while (colors.length < TILES) colors.push(ri(COLORS));
  shuffle(colors);
  const tileCells = [];
  for (const c of colors) { tileCells.push(cells[k]); g[cells[k++]] = COLOR_CHARS[c]; }
  for (const c of shuffle(tileCells).slice(0, VARNISH)) g[c] = g[c].toLowerCase();
  return g;
}

const rowsOf = g => Array.from({ length: H }, (_, y) => g.slice(y * W, y * W + W).join(''));

function evaluate(g) {
  try {
    const a = analyze(parseLevel({ rows: rowsOf(g) }), { maxStates: MAX_STATES });
    if (!a.solvable || a.minStrikes < MIN_PAR || a.trapBits > MAX_TRAP) return null;
    // primary: how often random play fails; small bonus for a narrow set of optimal lines
    const score = a.trapBits + 0.15 * Math.log2(1 + 1 / a.optimalSolutions) + (a.startSafe < a.startMoves ? 0.2 : 0);
    return { a, score };
  } catch (e) {
    if (e instanceof SearchLimit) return null;
    throw e;
  }
}

function mutate(g) {
  const n = g.slice();
  const tiles = [], empties = [];
  n.forEach((ch, i) => (ch === '.' ? empties : ch !== '#' ? tiles : []).push(i));
  const op = rnd();
  if (op < 0.45 && tiles.length > 1) {          // swap two tiles
    const a = tiles[ri(tiles.length)], b = tiles[ri(tiles.length)];
    [n[a], n[b]] = [n[b], n[a]];
  } else if (op < 0.9 && empties.length) {      // move a tile
    const a = tiles[ri(tiles.length)], b = empties[ri(empties.length)];
    [n[a], n[b]] = [n[b], n[a]];
  } else {                                       // move a blocker, or swap again
    const bl = n.map((ch, i) => ch === '#' ? i : -1).filter(i => i >= 0);
    if (bl.length && empties.length) {
      const a = bl[ri(bl.length)], b = empties[ri(empties.length)];
      [n[a], n[b]] = [n[b], n[a]];
    }
  }
  return n;
}

const results = [];
let attempts = 0;
while (results.length < COUNT && attempts < COUNT * 400) {
  attempts++;
  let g = randomGrid();
  let cur = evaluate(g);
  if (!cur) continue;
  for (let i = 0; i < CLIMB; i++) {
    const n = mutate(g);
    const e = evaluate(n);
    if (e && e.score >= cur.score) { g = n; cur = e; }
  }
  const key = g.join('');
  if (results.some(r => r.key === key)) continue;
  results.push({ key, rows: rowsOf(g), a: cur.a, score: cur.score });
  console.log(`#${results.length}  ${describe(cur.a)}`);
}

results.sort((x, y) => x.score - y.score);
const levels = results.map((r, i) => ({
  id: `gen-${startSeed}-${i + 1}`,
  name: `Candidate ${i + 1}`,
  rows: r.rows,
  par: r.a.minStrikes,
  metrics: {
    pRandom: +r.a.pRandom.toFixed(4), trapBits: +r.a.trapBits.toFixed(2),
    startMoves: r.a.startMoves, startSafe: r.a.startSafe,
    optimalSolutions: r.a.optimalSolutions, states: r.a.states,
  },
}));
writeFileSync(OUT, JSON.stringify({ seed: startSeed, params: { W, H, TILES, COLORS, BLOCKERS, VARNISH, CLIMB }, levels }, null, 2) + '\n');
console.log(`\n${levels.length} candidates -> ${OUT}  (seed ${startSeed})`);

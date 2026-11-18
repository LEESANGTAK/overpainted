// First-move predictor tool.
//   node tools/predict.mjs                       per level: the instinctive first strike and whether it loses
//   node tools/predict.mjs --calibrate           score the predictor against playtests/*.jsonl and refit weights
//   node tools/predict.mjs --calibrate --save    ...and store the fitted weights in levels/predict-weights.json
//
// The weights file (if present) is used by this tool and by the editor's Analyze panel.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseLevel, probe, applyHits, COLOR_CHARS } from '../core/rules.js';
import { analyze } from '../core/solver.js';
import { predictMoves, moveKey, baitReport, FEATURES, DEFAULT_WEIGHTS } from '../core/predict.js';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const weightsFile = join(root, 'levels/predict-weights.json');
let weights = existsSync(weightsFile) ? { ...DEFAULT_WEIGHTS, ...JSON.parse(readFileSync(weightsFile, 'utf8')).weights } : { ...DEFAULT_WEIGHTS };
const levelDefs = JSON.parse(readFileSync(join(root, 'levels/prototype.json'), 'utf8')).levels;

const lostCache = new Map();
function lostFn(board) {
  return hp => {
    const k = board.id + '|' + hp.join(',');
    if (!lostCache.has(k)) lostCache.set(k, !analyze(board, { hp, maxStates: 2_000_000 }).solvable);
    return lostCache.get(k);
  };
}
const xy = (board, c) => `(${c % board.w},${(c / board.w) | 0})`;
const colorsOf = (board, hits) => [...new Set(hits.map(t => COLOR_CHARS[board.tileColor[t]]))].join('');
const pct = p => (p * 100).toFixed(0).padStart(3) + '%';

if (!args.includes('--calibrate')) {
  console.log(`weights: ${existsSync(weightsFile) ? 'levels/predict-weights.json' : 'defaults'}\n`);
  console.log('level      instinct (top move)              loses?   P(first strike loses)   safe moves (rank: p)');
  for (const def of levelDefs) {
    const board = parseLevel(def);
    const r = baitReport(board, lostFn(board), weights);
    const t = r.top;
    const safe = r.moves.map((m, i) => m.fatal ? null : `#${i + 1}:${pct(m.p).trim()}`).filter(Boolean).join(' ');
    console.log(
      def.id.padEnd(10) +
      `${xy(board, t.cell)} lifts ${colorsOf(board, t.hits)}×${t.hits.length} ${pct(t.p)}`.padEnd(33) +
      (t.fatal ? 'LOSES  ' : 'safe   ').padEnd(9) + pct(r.pFatal).padStart(12) + '            ' + safe);
  }
  console.log('\nA trap level wants the instinct to lose (top move LOSES, high P). A gentle level wants the opposite.');
  process.exit(0);
}

// ---------- calibration against playtest logs ----------
const dir = join(root, 'playtests');
const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f)) : [];
if (!files.length) { console.error('No playtest logs in playtests/.'); process.exit(1); }
const byId = new Map(levelDefs.map(d => [d.id, d]));

// A decision = (position, set of moves, the move the player chose, first strike of an attempt?)
const decisions = [];
for (const f of files) {
  const evs = readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).sort((a, b) => a.t - b.t);
  let cur = null;
  for (const e of evs) {
    if (e.type === 'level_start') {
      const src = byId.get(e.lvl) ?? e;
      if (!src.rows) { cur = null; continue; }
      const board = parseLevel({ id: e.lvl, rows: src.rows, under: src.under });
      cur = { id: e.lvl, board, hp: board.initHp.slice(), hist: [] };
      continue;
    }
    if (!cur || e.lvl !== cur.id) continue;
    if (e.type === 'strike' && !e.replay) {
      const key = moveKey(cur.board, cur.hp, e.cell);
      if (!key) continue; // fizzle
      const first = cur.hist.length === 0;
      decisions.push({ id: cur.id, board: cur.board, hp: cur.hp, key, first });
      const r = probe(cur.board, cur.hp, e.cell);
      cur.hist.push(cur.hp); cur.hp = applyHits(cur.hp, r.hits);
    } else if (e.type === 'undo') { if (cur.hist.length) cur.hp = cur.hist.pop(); }
    else if (e.type === 'restart') { cur.hp = cur.board.initHp.slice(); cur.hist = []; }
  }
}
// precompute features per decision; drop forced moves (no information)
const data = [];
for (const d of decisions) {
  const moves = predictMoves(d.board, d.hp, DEFAULT_WEIGHTS);
  if (moves.length < 2) continue;
  const chosen = moves.findIndex(m => m.key === d.key);
  if (chosen < 0) continue;
  data.push({ ...d, F: moves.map(m => FEATURES.map(([k]) => m.f[k])), chosen, n: moves.length });
}

const names = FEATURES.map(([k]) => k);
function evaluate(wv, subset) {
  let ll = 0, top1 = 0, rankSum = 0, base = 0;
  for (const d of subset) {
    const s = d.F.map(f => f.reduce((a, v, i) => a + v * wv[i], 0));
    const mx = Math.max(...s); const z = s.reduce((a, v) => a + Math.exp(v - mx), 0);
    ll += s[d.chosen] - mx - Math.log(z);
    const rank = s.filter(v => v > s[d.chosen]).length + 1;
    if (rank === 1) top1++;
    rankSum += rank; base += 1 / d.n;
  }
  const n = subset.length || 1;
  return { n: subset.length, ll: ll / n, top1: top1 / n, chance: base / n, meanRank: rankSum / n };
}
function fit(start, subset, lambda = 0.3, iters = 3000, lr = 0.2) {
  const wv = start.slice();
  for (let it = 0; it < iters; it++) {
    const g = wv.map((v, i) => -lambda * (v - start[i]) / subset.length); // shrink towards the prior
    for (const d of subset) {
      const s = d.F.map(f => f.reduce((a, v, i) => a + v * wv[i], 0));
      const mx = Math.max(...s); const ex = s.map(v => Math.exp(v - mx)); const z = ex.reduce((a, b) => a + b, 0);
      for (let i = 0; i < wv.length; i++) {
        let e = 0; for (let j = 0; j < d.n; j++) e += ex[j] / z * d.F[j][i];
        g[i] += (d.F[d.chosen][i] - e) / subset.length;
      }
    }
    for (let i = 0; i < wv.length; i++) wv[i] += lr * g[i];
  }
  return wv;
}
const show = (label, r) => console.log(`${label.padEnd(26)} n=${String(r.n).padStart(3)}  top-1 ${pct(r.top1)} (chance ${pct(r.chance)})  mean rank ${r.meanRank.toFixed(2)}  log-lik ${r.ll.toFixed(3)}`);

const w0 = names.map(k => weights[k] ?? 0);
const firsts = data.filter(d => d.first);
console.log(`Decisions from ${files.length} session(s): ${data.length} (first strikes: ${firsts.length}), forced moves skipped\n`);
show('current · all strikes', evaluate(w0, data));
show('current · first strikes', evaluate(w0, firsts));

const w1 = fit(w0, data);
console.log('');
show('fitted · all strikes', evaluate(w1, data));
show('fitted · first strikes', evaluate(w1, firsts));

// which features matter: drop each one from the fitted model
console.log('\nfeature      current   fitted   effect of removing it (log-lik)');
const full = evaluate(w1, data).ll;
names.forEach((k, i) => {
  const wd = w1.slice(); wd[i] = 0;
  console.log(`${k.padEnd(12)} ${w0[i].toFixed(2).padStart(7)} ${w1[i].toFixed(2).padStart(8)}   ${(evaluate(wd, data).ll - full).toFixed(3)}`);
});

// per-level first strikes: what the player did vs. the prediction
console.log('\nfirst strikes per level (player\'s pick → predicted rank)');
const per = new Map();
for (const d of firsts) {
  const s = d.F.map(f => f.reduce((a, v, i) => a + v * w1[i], 0));
  const rank = s.filter(v => v > s[d.chosen]).length + 1;
  if (!per.has(d.id)) per.set(d.id, []);
  per.get(d.id).push(`#${rank}/${d.n}`);
}
for (const [id, r] of per) console.log(`  ${id.padEnd(9)} ${r.join(' ')}`);

if (args.includes('--save')) {
  writeFileSync(weightsFile, JSON.stringify({ fitted: new Date().toISOString(), decisions: data.length, weights: Object.fromEntries(names.map((k, i) => [k, +w1[i].toFixed(3)])) }, null, 2) + '\n');
  console.log(`\nSaved ${weightsFile}`);
} else console.log('\n(--save to store the fitted weights)');
console.log('Note: until other people playtest, this is calibrated to one player who also designs the levels.');

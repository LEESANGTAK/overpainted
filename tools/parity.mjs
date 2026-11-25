// Test vectors for the Godot rules port: the JS rules (the reference) answer, Godot must agree.
//   node tools/parity.mjs        -> godot/tests/vectors.json  (then run the Godot tests, see godot/README.md)
//
// Boards: every shipped level, plus seeded random boards with walls, double coats, undercoats, mixed
// tiles, original paint, tape and palette dabs. On each board, a few seeded random walks; at every
// state along a walk we record what the game asks of the rules: each cell's look (probe), the
// distinct strikes, the tool moves, palette masks, win/lose flags, and the solver's answer.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import {
  parseLevel, probe, listMoves, listToolMoves, applyToolMove, applyHits, paletteMask, isRuined, paintGone, isWon,
  layersLeft, tapeLeft, paletteLeft, isEmpty, COLOR_CHARS,
} from '../core/rules.js';
import { analyze, SearchLimit } from '../core/solver.js';

const root = resolve(import.meta.dirname, '..');
const OUT = join(root, 'godot/tests/vectors.json');
const RANDOM_BOARDS = 140, WALKS = 2, MAX_STEPS = 16, MAX_STATES = 50_000;

let seed = 20261126;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = n => Math.floor(rnd() * n);

function randomDef(i) {
  const w = 3 + ri(3), h = 3 + ri(3), colors = 2 + ri(2);
  const rows = [], under = [], mix = [], orig = [];
  for (let y = 0; y < h; y++) {
    let r = '', u = '', m = '', o = '';
    for (let x = 0; x < w; x++) {
      const v = rnd(), k = ri(colors), other = (k + 1 + ri(colors - 1)) % colors;
      let ch = '.', uu = '.', mm = '.', oo = '.';
      if (v < 0.05) ch = '#';
      else if (v < 0.17) { ch = COLOR_CHARS[k].toLowerCase(); if (rnd() < 0.5) uu = COLOR_CHARS[other]; }
      else if (v < 0.55) {
        ch = COLOR_CHARS[k];
        const s = rnd();
        if (s < 0.15) mm = COLOR_CHARS[other];
        else if (s < 0.25) oo = 'o';
        else if (s < 0.3) uu = COLOR_CHARS[other]; // an undercoat under an uppercase tile: two coats
      }
      r += ch; u += uu; m += mm; o += oo;
    }
    rows.push(r); under.push(u); mix.push(m); orig.push(o);
  }
  const def = { id: `rand-${i}`, rows };
  if (under.some(r => /[A-F]/.test(r))) def.under = under;
  if (mix.some(r => /[A-F]/.test(r))) def.mix = mix;
  if (orig.some(r => r.includes('o'))) def.orig = orig;
  if (rnd() < 0.35) def.tape = 1 + ri(2);
  if (rnd() < 0.35) def.palette = 1 + ri(2);
  return def;
}

const moveCode = m => m.palette ? ['p', m.cell] : m.tape ? ['t', m.cell] : ['s', m.cell];

function record(b, hp) {
  const N = b.w * b.h;
  const looks = [];
  for (let c = 0; c < N; c++) {
    const r = probe(b, hp, c);
    looks.push(r ? [r.hits, r.rays.flatMap(ray => [ray.tile, ray.end, ray.wall ? 1 : 0])] : null);
  }
  const rec = {
    hp: [...hp],
    looks,
    moves: listMoves(b, hp).map(m => [m.cell, m.hits]),
    tools: listToolMoves(b, hp).map(moveCode),
    flags: [isRuined(b, hp) ? 1 : 0, paintGone(b, hp) ? 1 : 0, isWon(b, hp) ? 1 : 0, layersLeft(b, hp), tapeLeft(b, hp), b.palette ? paletteLeft(b, hp) : 0],
    empty: Array.from({ length: N }, (_, c) => isEmpty(b, hp, c) ? 1 : 0),
  };
  if (b.palette) rec.pmask = Array.from({ length: N }, (_, c) => paletteMask(b, hp, c));
  try {
    const a = analyze(b, { hp, maxStates: MAX_STATES });
    rec.solve = { ok: a.solvable, min: a.solvable ? a.minStrikes : -1, states: a.states, line: a.solution.map(moveCode) };
  } catch (e) {
    if (!(e instanceof SearchLimit)) throw e;
    rec.solve = null; // too big for the vectors; not compared
  }
  return rec;
}

function walk(b) {
  const out = [];
  let hp = b.initHp;
  for (let step = 0; step <= MAX_STEPS; step++) {
    const rec = record(b, hp);
    out.push(rec);
    if (isRuined(b, hp) || paintGone(b, hp)) break;
    const options = [...listMoves(b, hp).map(m => ({ cell: m.cell, hits: m.hits })), ...listToolMoves(b, hp)];
    if (!options.length) break;
    const m = options[ri(options.length)];
    rec.next = moveCode(m);
    hp = m.palette || m.tape ? applyToolMove(b, hp, m) : applyHits(hp, m.hits);
  }
  return out;
}

function board(def) {
  const b = parseLevel(def);
  return {
    id: def.id, def,
    parsed: {
      w: b.w, h: b.h, nTiles: b.nTiles, nPaint: b.nPaint, offAdd: b.tools ? b.offAdd : -1,
      initHp: [...b.initHp], tileCell: [...b.tileCell], tileColor: [...b.tileColor], underColor: [...b.underColor], mixColor: [...b.mixColor],
    },
    walks: Array.from({ length: WALKS }, () => walk(b)),
  };
}

const shipped = JSON.parse(readFileSync(join(root, 'godot/data/levels.json'), 'utf8')).levels;
const boards = shipped.map(board);
let made = 0, tries = 0;
while (made < RANDOM_BOARDS && tries++ < RANDOM_BOARDS * 20) {
  const def = randomDef(tries);
  try { parseLevel(def); } catch { continue; } // the generator can make an invalid combination; skip it
  boards.push(board(def));
  made++;
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ source: 'tools/parity.mjs', boards }) + '\n');
const states = boards.reduce((s, bd) => s + bd.walks.reduce((t, w) => t + w.length, 0), 0);
const feat = k => boards.filter(bd => bd.def[k]).length;
console.log(`godot/tests/vectors.json: ${boards.length} boards (${shipped.length} shipped, ${made} random), ${states} states`
  + ` · with under ${feat('under')}, mix ${feat('mix')}, orig ${feat('orig')}, tape ${feat('tape')}, palette ${feat('palette')}`);

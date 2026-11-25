// Rules + solver checks.   node tools/test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel, probe, listMoves, applyHits, isClear, toRows, toUnder, toOrig, canTape, applyTape, tapeLeft, isTaped, isRuined, isWon, isOriginal, paintGone, listToolMoves, applyToolMove, applyRetouch, canRetouch, retouchLeft, applySplit, canSplit, splitLeft, tileOn, maskOf, layersLeft, canPalette, applyPalette, paletteMask, paletteLeft, paletteSources } from '../core/rules.js';
import { analyze } from '../core/solver.js';
import { matchTrap, checkTraps } from '../core/traps.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
const at = (b, x, y) => y * b.w + x;

test('pair across a gap', () => {
  const b = parseLevel({ rows: ['A.A'] });
  const r = probe(b, b.initHp, at(b, 1, 0));
  assert.deepEqual(r.hits, [0, 1]);
  assert.equal(probe(b, b.initHp, at(b, 0, 0)), null, 'tile cell is not strikable');
});

test('only the nearest tile in a line counts', () => {
  const b = parseLevel({ rows: ['AB.A'] });
  assert.deepEqual(probe(b, b.initHp, at(b, 2, 0)).hits, [], 'B blocks the far A');
});

test('cross: three of a colour and an unmatched one', () => {
  const b = parseLevel({ rows: ['.A.', 'A.A', '.B.'] });
  const r = probe(b, b.initHp, at(b, 1, 1));
  assert.equal(r.hits.length, 3);
});

test('two pairs in one strike', () => {
  const b = parseLevel({ rows: ['.A.', 'B.B', '.A.'] });
  assert.equal(probe(b, b.initHp, at(b, 1, 1)).hits.length, 4);
});

test('mixed tile: pairs with either pigment, and with red + blue lifts all three', () => {
  // A+B mix in the middle of the top row
  const b = parseLevel({ rows: ['.A.', 'B.A', '.A.'], mix: ['.B.', '...', '...'] });
  const mixed = b.tileAt[at(b, 1, 0)];
  assert.equal(b.mixColor[mixed], 1);
  // centre sees: up = mix(A+B), right = A, down = A, left = B -> all four lift
  assert.equal(probe(b, b.initHp, at(b, 1, 1)).hits.length, 4);
  // mix + blue only
  const b2 = parseLevel({ rows: ['A.B'], mix: ['B..'] });
  assert.equal(probe(b2, b2.initHp, at(b2, 1, 0)).hits.length, 2);
  // red + blue alone do not pair
  const b3 = parseLevel({ rows: ['A.B'] });
  assert.equal(probe(b3, b3.initHp, at(b3, 1, 0)).hits.length, 0);
  // two mixes pair; a mix only on a single-layer tile of another pigment
  const b4 = parseLevel({ rows: ['A.C'], mix: ['B.B'] });
  assert.equal(probe(b4, b4.initHp, at(b4, 1, 0)).hits.length, 2);
  assert.throws(() => parseLevel({ rows: ['a'], mix: ['B'] }));
  assert.throws(() => parseLevel({ rows: ['A'], mix: ['A'] }));
  assert.throws(() => parseLevel({ rows: ['.'], mix: ['A'] }));
});

test('old tape blocks sight', () => {
  const b = parseLevel({ rows: ['A#.A'] });
  assert.deepEqual(probe(b, b.initHp, at(b, 2, 0)).hits, []);
});

test('masking tape: blocks sight, cannot be struck, limited, not paint', () => {
  const b = parseLevel({ rows: ['A...A'], tape: 1 });
  assert.equal(b.initHp.length, b.nTiles + 5);
  assert.equal(probe(b, b.initHp, at(b, 2, 0)).hits.length, 2);
  assert.ok(!canTape(b, b.initHp, at(b, 0, 0)), 'paint is not an empty cell');
  const hp = applyTape(b, b.initHp, at(b, 3, 0));
  assert.ok(isTaped(b, hp, at(b, 3, 0)));
  assert.equal(tapeLeft(b, hp), 0);
  assert.ok(!canTape(b, hp, at(b, 1, 0)), 'no tape left');
  assert.deepEqual(probe(b, hp, at(b, 2, 0)).hits, [], 'tape stops the look');
  assert.equal(probe(b, hp, at(b, 3, 0)), null, 'a taped cell is not empty');
  const clear = applyHits(hp, [0, 1]);
  assert.ok(isClear(clear, b.nTiles) && !isClear(clear), 'tape bytes are not paint');
  // without tape the state is exactly the old one
  assert.equal(parseLevel({ rows: ['A...A'] }).initHp.length, 2);
});

test('solver uses tape when it is the only way', () => {
  // the middle strike sees three B; taping its left look leaves exactly two
  const rows = ['..BB', 'B..B', '....'];
  assert.ok(!analyze(parseLevel({ rows })).solvable);
  const b = parseLevel({ rows, tape: 1 });
  const a = analyze(b);
  assert.ok(a.solvable);
  assert.equal(a.minStrikes, 3, 'the tape counts as a move');
  assert.deepEqual(a.solution[0], { cell: at(b, 1, 1), hits: [], tape: true });
});

test('varnish needs two matches', () => {
  const b = parseLevel({ rows: ['a.A', '...', 'A..'] });
  let hp = b.initHp;
  hp = applyHits(hp, probe(b, hp, at(b, 1, 0)).hits);
  assert.deepEqual(toRows(b, hp), ['A..', '...', 'A..']);
  hp = applyHits(hp, probe(b, hp, at(b, 0, 1)).hits);
  assert.ok(isClear(hp));
});

test('undercoat: a C coat over an A coat matches as C, then as A', () => {
  //  c . C        top coat C pairs with the C on the right;
  //  . . .        what is left is an A tile, which pairs with the A below.
  //  A . .
  const b = parseLevel({ rows: ['c.C', '...', 'A..'], under: ['A..', '...', '...'] });
  assert.deepEqual(toUnder(b), ['A..', '...', '...']);
  assert.deepEqual(probe(b, b.initHp, at(b, 0, 1)).hits, [], 'C on top does not pair with the A below');
  let hp = applyHits(b.initHp, probe(b, b.initHp, at(b, 1, 0)).hits);
  assert.deepEqual(toRows(b, hp), ['A..', '...', 'A..'], 'the coat beneath shows as A');
  assert.equal(toUnder(b, hp), null);
  hp = applyHits(hp, probe(b, hp, at(b, 0, 1)).hits);
  assert.ok(isClear(hp));
  assert.equal(analyze(b).minStrikes, 2);
});

test('undercoat on an uppercase tile still makes it two coats', () => {
  const b = parseLevel({ rows: ['C'], under: ['A'] });
  assert.equal(b.initHp[0], 2);
  assert.throws(() => parseLevel({ rows: ['C'], under: ['Z'] }));
  assert.throws(() => parseLevel({ rows: ['C', '.'], under: ['A'] }));
});

// Reference solver built only on the public rules API, to cross-check the fast one.
function slowSolve(b) {
  const memo = new Map();
  const go = hp => {
    const k = hp.join('');
    if (memo.has(k)) return memo.get(k);
    let r;
    if (isRuined(b, hp)) r = { f: Infinity, p: 0 };
    else if (paintGone(b, hp)) r = { f: 0, p: 1 };
    else {
      const ms = listMoves(b, hp).map(m => ({ next: applyHits(hp, m.hits) }));
      if (b.tools) for (const m of listToolMoves(b, hp)) ms.push({ next: applyToolMove(b, hp, m) });
      else for (let c = 0; c < b.w * b.h; c++) if (canTape(b, hp, c)) ms.push({ next: applyTape(b, hp, c) });
      if (!ms.length) r = { f: Infinity, p: 0 };
      else {
        let f = Infinity, p = 0;
        for (const m of ms) { const c = go(m.next); f = Math.min(f, c.f + 1); p += c.p; }
        r = { f, p: p / ms.length };
      }
    }
    memo.set(k, r);
    return r;
  };
  return go(b.initHp);
}

test('fast solver agrees with reference on random boards', () => {
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 150; i++) {
    const w = 3 + Math.floor(rnd() * 3), h = 3 + Math.floor(rnd() * 3);
    const rows = [], under = [];
    for (let y = 0; y < h; y++) {
      let r = '', u = '';
      for (let x = 0; x < w; x++) {
        const v = rnd();
        r += v < 0.45 ? '.' : v < 0.5 ? '#' : v < 0.6 ? 'abc'[Math.floor(rnd() * 3)] : 'ABC'[Math.floor(rnd() * 3)];
        u += v >= 0.5 && v < 0.6 && rnd() < 0.6 ? 'ABC'[Math.floor(rnd() * 3)] : '.';
      }
      rows.push(r); under.push(u);
    }
    // mix some single-layer tiles with a second pigment
    const mix = rows.map(r => [...r].map(ch => 'ABC'.includes(ch) && rnd() < 0.3 ? 'ABC'[('ABC'.indexOf(ch) + 1 + Math.floor(rnd() * 2)) % 3] : '.').join(''));
    const b = parseLevel({ rows, under: under.map((u, y) => [...u].map((c, x) => (mix[y][x] !== '.' ? '.' : c)).join('')), mix, tape: i % 3 === 0 ? 1 + (i % 2) : 0,
      retouch: i % 5 === 1 ? 'A' : i % 5 === 3 ? 'AB' : '', split: i % 4 === 2 ? 1 : 0, palette: i % 7 === 4 ? 1 : 0 });
    if (b.tools && b.w * b.h > 16) continue; // keep the slow reference quick
    const fast = analyze(b), slow = slowSolve(b);
    assert.equal(fast.solvable, slow.f < Infinity, rows.join('/'));
    if (fast.solvable) assert.equal(fast.minStrikes, slow.f, rows.join('/'));
    assert.ok(Math.abs(fast.pRandom - slow.p) < 1e-9, rows.join('/'));
    // replay the reported solution with the public rules
    if (fast.solvable) {
      let hp = b.initHp;
      for (const st of fast.solution) {
        if (st.tape) { assert.ok(canTape(b, hp, st.cell)); hp = applyTape(b, hp, st.cell); continue; }
        if (st.retouch != null) { assert.ok(canRetouch(b, hp, st.retouch, st.cell)); hp = applyRetouch(b, hp, st.retouch, st.cell); continue; }
        if (st.split != null) { assert.ok(canSplit(b, hp, st.split, st.cell, st.color)); hp = applySplit(b, hp, st.split, st.cell, st.color); continue; }
        if (st.palette) { assert.ok(canPalette(b, hp, st.cell)); hp = applyPalette(b, hp, st.cell); continue; }
        const r = probe(b, hp, st.cell);
        assert.ok(r && r.hits.length >= 2);
        hp = applyHits(hp, r.hits);
      }
      assert.ok(paintGone(b, hp), 'solution clears ' + rows.join('/'));
      assert.equal(fast.solution.length, fast.minStrikes);
    }
  }
});

test('every shipped level sits in a known chapter, chapters in one run each', () => {
  const data = JSON.parse(readFileSync(new URL('../levels/prototype.json', import.meta.url), 'utf8'));
  const ids = new Set(data.chapters.map(c => c.id));
  assert.equal(ids.size, data.chapters.length, 'chapter ids are unique');
  const seen = [];
  for (const d of data.levels) {
    assert.ok(ids.has(d.chapter), `${d.id}: unknown chapter ${d.chapter}`);
    if (seen.at(-1) !== d.chapter) { assert.ok(!seen.includes(d.chapter), `${d.id}: chapter ${d.chapter} is split`); seen.push(d.chapter); }
  }
  for (const c of data.chapters) assert.ok(data.levels.some(d => d.chapter === c.id && !d.extra), `${c.id} has a main level`);
});

test('mid-game traps: valid cells, and each one catches a real blunder', () => {
  const data = JSON.parse(readFileSync(new URL('../levels/prototype.json', import.meta.url), 'utf8'));
  for (const def of data.levels.filter(d => d.traps)) {
    const b = parseLevel(def);
    checkTraps(def, b);
    for (const trap of def.traps) assert.ok(trap.ko?.voice?.stuck && trap.voice.win && trap.ko.voice.win, `${def.id}: trap lines in both languages`);
    const memo = new Map();
    const ok = hp => { const k = hp.join(); if (!memo.has(k)) memo.set(k, analyze(b, { hp }).solvable); return memo.get(k); };
    const hit = new Set(), seen = new Set(), stack = [[b.initHp, 0]];
    while (stack.length) {
      const [hp, depth] = stack.pop();
      const k = hp.join() + '|' + depth;
      if (seen.has(k) || !ok(hp)) continue;
      seen.add(k);
      const moves = listMoves(b, hp).map(m => ({ hits: m.hits }));
      if (tapeLeft(b, hp) > 0) for (let c = 0; c < b.w * b.h; c++) if (canTape(b, hp, c)) moves.push({ tape: true, cell: c });
      for (const m of moves) {
        const next = m.tape ? applyTape(b, hp, m.cell) : applyHits(hp, m.hits);
        if (ok(next)) stack.push([next, depth + 1]);
        else { const t = matchTrap(def, b, m, depth); if (t) hit.add(t); }
      }
    }
    def.traps.forEach((t, i) => assert.ok(hit.has(t), `${def.id}: trap ${i} never catches a blunder`));
  }
});

test('trap matching: lifts is a subset, tape cell or any, after N moves', () => {
  const def = { rows: ['A.A.B', '.....'], traps: [
    { lifts: [[0, 0]], after: 1, voice: { stuck: 'late' } },
    { lifts: [[0, 0], [2, 0]], voice: { stuck: 'pair' } },
    { tape: [1, 1], voice: { stuck: 'here' } },
    { tape: 'any', voice: { stuck: 'tape' } }] };
  const b = parseLevel(def);
  assert.equal(matchTrap(def, b, { hits: [0, 1] }, 0).voice.stuck, 'pair');
  assert.equal(matchTrap(def, b, { hits: [0, 1] }, 1).voice.stuck, 'late');
  assert.equal(matchTrap(def, b, { hits: [1, 2] }, 0), null);
  assert.equal(matchTrap(def, b, { tape: true, cell: 6 }).voice.stuck, 'here');
  assert.equal(matchTrap(def, b, { tape: true, cell: 7 }).voice.stuck, 'tape');
});

test('original paint: seen and pairs, but lifting it loses; the level ends without it', () => {
  // row: A . A . A(original). Striking (1,0) lifts the two overpaint reds; (3,0) also lifts the original.
  const b = parseLevel({ rows: ['A.A.A'], orig: ['....o'] });
  assert.equal(b.nPaint, 2); assert.equal(b.nTiles, 3);
  const o = b.tileAt[4];
  assert.ok(isOriginal(b, o) && !isOriginal(b, b.tileAt[0]));
  assert.deepEqual(toOrig(b), ['....o']);
  const ruin = probe(b, b.initHp, 3);
  assert.ok(ruin.hits.includes(o), 'an original is seen and pairs');
  assert.ok(isRuined(b, applyHits(b.initHp, ruin.hits)));
  const good = applyHits(b.initHp, probe(b, b.initHp, 1).hits);
  assert.ok(isWon(b, good) && !isClear(good), 'won with the original still on the canvas');
  const a = analyze(b);
  assert.ok(a.solvable && a.minStrikes === 1 && a.startMoves === 2 && a.startSafe === 1);
  assert.equal(a.pRandom, 0.5);
  const slow = slowSolve(b);
  assert.equal(slow.f, 1); assert.equal(slow.p, 0.5);
  // an original on an empty cell, a double coat or a mixed tile is refused
  assert.throws(() => parseLevel({ rows: ['A.'], orig: ['.o'] }));
  assert.throws(() => parseLevel({ rows: ['a.'], orig: ['o.'] }));
  assert.throws(() => parseLevel({ rows: ['A.'], mix: ['B.'], orig: ['o.'] }));
});

test('retouch: a dab of a given pigment on an empty cell, a new tile that must be lifted too', () => {
  // A . . A . A : three reds, one red dab makes four
  const b = parseLevel({ rows: ['A..A.A'], retouch: 'A' });
  assert.ok(b.tools && retouchLeft(b, b.initHp).length === 1);
  assert.ok(!analyze(parseLevel({ rows: ['A..A.A'] })).solvable, 'three reds alone cannot clear');
  const hp = applyRetouch(b, b.initHp, 0, 1); // dab at (1,0)
  assert.ok(tileOn(b, hp, 1) >= b.offAdd && maskOf(b, hp, tileOn(b, hp, 1)) === 1);
  assert.ok(!canRetouch(b, hp, 0, 2), 'one dab only');
  assert.equal(layersLeft(b, hp), 4);
  const a = analyze(b);
  assert.ok(a.solvable && a.minStrikes === 3, 'dab + two strikes');
  assert.ok(a.solution.some(st => st.retouch === 0));
});

test('split: a mixed tile becomes two, one pigment moves to an empty neighbour', () => {
  // B . M . A . A  with M = red+blue at (2,0); split sends blue left to (1,0)? no: (1,0) is between
  const b = parseLevel({ rows: ['B.A.A.B'], mix: ['..B....'], split: 1 });
  const t = b.tileAt[2];
  assert.ok(canSplit(b, b.initHp, t, 1, 1) && canSplit(b, b.initHp, t, 3, 0));
  assert.ok(!canSplit(b, b.initHp, t, 0, 1), 'not onto a tile');
  assert.ok(!canSplit(b, b.initHp, t, 1, 2), 'only its own pigments');
  const hp = applySplit(b, b.initHp, t, 1, 1); // blue to (1,0), red stays at (2,0)
  assert.equal(hp[t], 0);
  assert.equal(maskOf(b, hp, tileOn(b, hp, 2)), 1, 'red stays');
  assert.equal(maskOf(b, hp, tileOn(b, hp, 1)), 2, 'blue moved');
  assert.equal(splitLeft(b, hp), 0);
  assert.equal(layersLeft(b, hp), 5);
  assert.ok(analyze(b).solvable === analyze(b).solvable); // (analysed without error)
});

test('palette: takes paint from the two pigments its cell sees and mixes a dab there', () => {
  // A . . B . B : from (2,0) the cell sees red (left) and blue (right): both lose their layer, a red-blue dab goes on (2,0)
  const rows = ['A..B.B'];
  const b = parseLevel({ rows, palette: 1 });
  assert.equal(paletteMask(b, b.initHp, 2), 0b11);
  assert.equal(paletteMask(b, b.initHp, 4), 0, 'sees only blue');
  assert.deepEqual(paletteSources(b, b.initHp, 2), [tileOn(b, b.initHp, 0), tileOn(b, b.initHp, 3)]);
  const hp = applyPalette(b, b.initHp, 2);
  assert.equal(maskOf(b, hp, tileOn(b, hp, 2)), 0b11);
  assert.equal(tileOn(b, hp, 0), -1, 'red was taken');
  assert.equal(tileOn(b, hp, 3), -1, 'blue was taken');
  assert.equal(layersLeft(b, hp), 2, 'the dab and the last blue');
  assert.ok(paletteLeft(b, hp) === 0 && !canPalette(b, hp, 4));
  // one red, two blues: mix the red with one blue, then the dab pairs the other blue
  const an = analyze(b);
  assert.ok(an.solvable && an.minStrikes === 2 && an.solution[0].palette && [1, 2].includes(an.solution[0].cell));
  assert.ok(!analyze(parseLevel({ rows })).solvable);
  // a single seen tile is not enough, even a mixed one
  const m = parseLevel({ rows: ['A..'], mix: ['B..'], palette: 1 });
  assert.equal(paletteMask(m, m.initHp, 1), 0);
  // a double coat gives one layer; taking from original paint ruins the painting
  const d = parseLevel({ rows: ['a.B'], palette: 1 });
  const dh = applyPalette(d, d.initHp, 1);
  assert.equal(dh[tileOn(d, d.initHp, 0)], 1, 'lower coat stays');
  const o = parseLevel({ rows: ['A.B'], orig: ['o..'], palette: 1 });
  assert.ok(isRuined(o, applyPalette(o, o.initHp, 1)));
});



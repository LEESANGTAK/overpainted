// Rules + solver checks.   node tools/test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel, probe, listMoves, applyHits, isClear, toRows, toUnder, canTape, applyTape, tapeLeft, isTaped } from '../core/rules.js';
import { analyze } from '../core/solver.js';

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
    if (isClear(hp, b.nTiles)) r = { f: 0, p: 1 };
    else {
      const ms = listMoves(b, hp).map(m => ({ next: applyHits(hp, m.hits) }));
      for (let c = 0; c < b.w * b.h; c++) if (canTape(b, hp, c)) ms.push({ next: applyTape(b, hp, c) });
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
    const b = parseLevel({ rows, under, tape: i % 3 === 0 ? 1 + (i % 2) : 0 });
    const fast = analyze(b), slow = slowSolve(b);
    assert.equal(fast.solvable, slow.f < Infinity, rows.join('/'));
    if (fast.solvable) assert.equal(fast.minStrikes, slow.f, rows.join('/'));
    assert.ok(Math.abs(fast.pRandom - slow.p) < 1e-9, rows.join('/'));
    // replay the reported solution with the public rules
    if (fast.solvable) {
      let hp = b.initHp;
      for (const st of fast.solution) {
        if (st.tape) { assert.ok(canTape(b, hp, st.cell)); hp = applyTape(b, hp, st.cell); continue; }
        const r = probe(b, hp, st.cell);
        assert.ok(r && r.hits.length >= 2);
        hp = applyHits(hp, r.hits);
      }
      assert.ok(isClear(hp, b.nTiles), 'solution clears ' + rows.join('/'));
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

console.log(`\n${n} tests passed`);

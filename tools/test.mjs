// Rules + solver checks.   node tools/test.mjs
import assert from 'node:assert/strict';
import { parseLevel, probe, listMoves, applyHits, isClear, toRows } from '../core/rules.js';
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

test('gold leaf blocks sight', () => {
  const b = parseLevel({ rows: ['A#.A'] });
  assert.deepEqual(probe(b, b.initHp, at(b, 2, 0)).hits, []);
});

test('varnish needs two matches', () => {
  const b = parseLevel({ rows: ['a.A', '...', 'A..'] });
  let hp = b.initHp;
  hp = applyHits(hp, probe(b, hp, at(b, 1, 0)).hits);
  assert.deepEqual(toRows(b, hp), ['A..', '...', 'A..']);
  hp = applyHits(hp, probe(b, hp, at(b, 0, 1)).hits);
  assert.ok(isClear(hp));
});

// Reference solver built only on the public rules API, to cross-check the fast one.
function slowSolve(b) {
  const memo = new Map();
  const go = hp => {
    const k = hp.join('');
    if (memo.has(k)) return memo.get(k);
    let r;
    if (isClear(hp)) r = { f: 0, p: 1 };
    else {
      const ms = listMoves(b, hp);
      if (!ms.length) r = { f: Infinity, p: 0 };
      else {
        let f = Infinity, p = 0;
        for (const m of ms) { const c = go(applyHits(hp, m.hits)); f = Math.min(f, c.f + 1); p += c.p; }
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
    const rows = [];
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) { const v = rnd(); r += v < 0.45 ? '.' : v < 0.5 ? '#' : v < 0.55 ? 'a' : 'ABC'[Math.floor(rnd() * 3)]; }
      rows.push(r);
    }
    const b = parseLevel({ rows });
    const fast = analyze(b), slow = slowSolve(b);
    assert.equal(fast.solvable, slow.f < Infinity, rows.join('/'));
    if (fast.solvable) assert.equal(fast.minStrikes, slow.f, rows.join('/'));
    assert.ok(Math.abs(fast.pRandom - slow.p) < 1e-9, rows.join('/'));
    // replay the reported solution with the public rules
    if (fast.solvable) {
      let hp = b.initHp;
      for (const st of fast.solution) {
        const r = probe(b, hp, st.cell);
        assert.ok(r && r.hits.length >= 2);
        hp = applyHits(hp, r.hits);
      }
      assert.ok(isClear(hp), 'solution clears ' + rows.join('/'));
      assert.equal(fast.solution.length, fast.minStrikes);
    }
  }
});

console.log(`\n${n} tests passed`);

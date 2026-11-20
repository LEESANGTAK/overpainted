// Analyse playtest logs recorded by the prototype (playtests/<session>.jsonl).
//   node tools/playtest.mjs                 all sessions
//   node tools/playtest.mjs playtests/X.jsonl ...
// Prints a per-level table and writes playtests/report.json (full detail, incl. per-strike timeline).
//
// Every strike is replayed through the rules and the solver, so for each move we know whether the
// position was still restorable and whether the strike stayed on an optimal line. That lets us see
// *blunders* (the strike that made the level unwinnable) and how long the player took to notice.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseLevel, probe, applyHits, applyTape, canTape, isClear } from '../core/rules.js';
import { analyze, SearchLimit } from '../core/solver.js';

const root = resolve(import.meta.dirname, '..');
const dir = join(root, 'playtests');
const IDLE_CAP = 60_000; // gaps longer than this count as 60 s of "thinking" at most

let files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!files.length) {
  if (!existsSync(dir)) { console.error('No playtests/ folder yet. Play the prototype first.'); process.exit(1); }
  files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().map(f => join(dir, f));
}
if (!files.length) { console.error('No playtest logs found.'); process.exit(1); }

const shipped = new Map();
for (const d of JSON.parse(readFileSync(join(root, 'levels/prototype.json'), 'utf8')).levels) shipped.set(d.id, d);
const order = [...shipped.keys()];

// ---------- solver cache: remaining optimal strikes from a position (Infinity = lost) ----------
const boards = new Map();
function boardFor(id, rows, under = null, tape = 0) {
  const key = id + '|' + rows.join('/') + '|' + (under ?? []).join('/') + '|' + tape;
  if (!boards.has(key)) boards.set(key, { board: parseLevel({ rows, under, tape }), f: new Map() });
  return boards.get(key);
}
function remaining(B, hp) {
  const k = hp.join(',');
  if (!B.f.has(k)) {
    let v;
    try { const a = analyze(B.board, { hp, maxStates: 2_000_000 }); v = a.solvable ? a.minStrikes : Infinity; }
    catch (e) { if (e instanceof SearchLimit) v = null; else throw e; }
    B.f.set(k, v);
  }
  return B.f.get(k);
}

// ---------- per-level aggregate ----------
const levels = new Map();
function agg(id, def) {
  if (!levels.has(id)) levels.set(id, {
    id, name: def?.name ?? id, par: def?.par ?? null, trapBits: def?.metrics?.trapBits ?? null,
    optimalLines: def?.metrics?.optimalSolutions ?? null,
    visits: 0, wins: 0, firstClearMs: null, firstClearStrikes: null, best: null, activeMs: 0,
    strikes: 0, fizzles: 0, optimalStrikes: 0, judgedStrikes: 0, undos: 0, restarts: 0, hints: 0,
    blunders: 0, noticeStrikes: [], noticeMs: [], deadEnds: 0, thinkMs: [], firstThinkMs: [],
    devUsed: false, replayUsed: false, abandoned: 0, timeline: [],
  });
  return levels.get(id);
}

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sec = ms => ms == null ? '–' : (ms / 1000).toFixed(ms < 10_000 ? 1 : 0) + 's';

for (const file of files) {
  const events = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).sort((a, b) => a.t - b.t);
  let cur = null;        // the level being played
  let lastT = null, away = false, dev = false;

  for (const e of events) {
    // active-time accounting (ignores time with the tab hidden; caps long idles)
    if (cur && lastT != null && !away) {
      const gap = Math.min(e.t - lastT, IDLE_CAP);
      cur.L.activeMs += gap; cur.active += gap; cur.sinceMove += gap;
    }
    lastT = e.t;
    if (e.type === 'away') { away = true; continue; }
    if (e.type === 'back') { away = false; continue; }
    if (e.type === 'dev') { dev = e.on; if (cur && dev) cur.L.devUsed = true; continue; }
    if (e.type === 'level_start') {
      const def = shipped.get(e.lvl) ?? { id: e.lvl, name: e.lvl, rows: e.rows, par: e.par };
      const src = shipped.get(e.lvl) ?? e;
      const B = boardFor(e.lvl, src.rows, src.under, src.tape ?? 0);
      const L = agg(e.lvl, def);
      L.visits++;
      if (dev || e.dev) L.devUsed = true;
      cur = { L, B, hp: B.board.initHp.slice(), hist: [], active: 0, sinceMove: 0, firstMove: true, won: false, lostAt: null };
      L.timeline.push({ at: new Date(e.t).toISOString(), ev: 'start' });
      continue;
    }
    if (!cur || e.lvl !== cur.L.id) continue;
    const { L, B } = cur;
    const tl = (ev, extra = {}) => L.timeline.push({ s: +(cur.active / 1000).toFixed(1), ev, ...extra });

    switch (e.type) {
      case 'strike': {
        if (e.replay) { L.replayUsed = true; break; }
        const think = cur.sinceMove; cur.sinceMove = 0;
        L.thinkMs.push(think);
        if (cur.firstMove) { L.firstThinkMs.push(think); cur.firstMove = false; }
        L.strikes++;
        const r = probe(B.board, cur.hp, e.cell);
        if (!r || r.hits.length < 2) { L.fizzles++; tl('fizzle', { cell: e.cell, think: +(think / 1000).toFixed(1) }); break; }
        const before = remaining(B, cur.hp);
        const next = applyHits(cur.hp, r.hits);
        const after = remaining(B, next);
        cur.hist.push(cur.hp); cur.hp = next;
        let verdict = 'ok';
        if (before != null && after != null && before !== Infinity) {
          L.judgedStrikes++;
          if (after === before - 1) { L.optimalStrikes++; verdict = 'optimal'; }
          if (after === Infinity) { L.blunders++; verdict = 'BLUNDER'; cur.lostAt = { t: cur.active, strikes: 0 }; }
        } else if (before === Infinity) { verdict = 'lost'; if (cur.lostAt) cur.lostAt.strikes++; }
        const dead = after === Infinity && r && !isClear(next, B.board.nTiles) && !anyMove(B.board, next);
        if (dead) L.deadEnds++;
        tl('strike', { cell: e.cell, cleared: r.hits.length, think: +(think / 1000).toFixed(1), left: after === Infinity ? 'LOST' : after, verdict, ...(dead ? { deadEnd: true } : {}) });
        break;
      }
      case 'tape': { // masking tape: a move like a strike (judged the same way), never a dead end by itself
        if (e.replay) { L.replayUsed = true; break; }
        const think = cur.sinceMove; cur.sinceMove = 0;
        L.thinkMs.push(think);
        if (cur.firstMove) { L.firstThinkMs.push(think); cur.firstMove = false; }
        L.strikes++;
        if (!canTape(B.board, cur.hp, e.cell)) { tl('tape?', { cell: e.cell }); break; }
        const before = remaining(B, cur.hp);
        const next = applyTape(B.board, cur.hp, e.cell);
        const after = remaining(B, next);
        cur.hist.push(cur.hp); cur.hp = next;
        let verdict = 'ok';
        if (before != null && after != null && before !== Infinity) {
          L.judgedStrikes++;
          if (after === before - 1) { L.optimalStrikes++; verdict = 'optimal'; }
          if (after === Infinity) { L.blunders++; verdict = 'BLUNDER'; cur.lostAt = { t: cur.active, strikes: 0 }; }
        } else if (before === Infinity) { verdict = 'lost'; if (cur.lostAt) cur.lostAt.strikes++; }
        tl('tape', { cell: e.cell, think: +(think / 1000).toFixed(1), left: after === Infinity ? 'LOST' : after, verdict });
        break;
      }
      case 'undo':
      case 'restart': {
        if (e.type === 'undo') { L.undos++; if (cur.hist.length) cur.hp = cur.hist.pop(); }
        else { L.restarts++; cur.hp = B.board.initHp.slice(); cur.hist = []; }
        cur.won = false;
        cur.sinceMove = 0;
        if (cur.lostAt && remaining(B, cur.hp) !== Infinity) {
          L.noticeStrikes.push(cur.lostAt.strikes); L.noticeMs.push(cur.active - cur.lostAt.t);
          tl(e.type, { recovered: true, lostFor: +((cur.active - cur.lostAt.t) / 1000).toFixed(1), extraStrikes: cur.lostAt.strikes });
          cur.lostAt = null;
        } else tl(e.type);
        break;
      }
      case 'hint': L.hints++; tl('hint', e.lost ? { lost: true } : { cell: e.cell }); break;
      case 'win': {
        cur.won = true; cur.lostAt = null;
        L.wins++;
        if (L.firstClearMs == null) { L.firstClearMs = L.activeMs; L.firstClearStrikes = e.strikes; }
        if (L.best == null || e.strikes < L.best) L.best = e.strikes;
        tl('WIN', { strikes: e.strikes, par: e.par, hints: e.hints });
        break;
      }
      case 'leave': if (!cur.won && !cur.firstMove) { L.abandoned++; tl('leave', { strikes: e.strikes }); } cur = null; break;
      case 'replay': L.replayUsed = true; tl('replay'); break;
    }
  }
}

function anyMove(board, hp) {
  for (let c = 0; c < board.w * board.h; c++) { const r = probe(board, hp, c); if (r && r.hits.length >= 2) return true; }
  return false;
}

// ---------- report ----------
const rows = [...levels.values()].sort((a, b) => {
  const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
  return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
});
for (const L of rows) {
  L.optimalRate = L.judgedStrikes ? L.optimalStrikes / L.judgedStrikes : null;
  L.medianThinkMs = median(L.thinkMs);
  L.maxThinkMs = L.thinkMs.length ? Math.max(...L.thinkMs) : null;
  L.medianNoticeStrikes = median(L.noticeStrikes);
  L.medianNoticeMs = median(L.noticeMs);
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
console.log(`Playtest sessions: ${files.length}\n`);
console.log(pad('level', 22) + lpad('par', 4) + lpad('trap', 6) + lpad('clear', 7) + lpad('time', 7) + lpad('strk', 6) + lpad('undo', 5) + lpad('rst', 4) + lpad('hint', 5) + lpad('blndr', 6) + lpad('notice', 8) + lpad('opt%', 6) + lpad('think', 7) + '  flags');
for (const L of rows) {
  const flags = [L.devUsed && 'dev', L.replayUsed && 'replay', L.abandoned && `quit×${L.abandoned}`, L.fizzles && `fizzle×${L.fizzles}`, L.deadEnds && `deadend×${L.deadEnds}`].filter(Boolean).join(' ');
  console.log(
    pad(L.name.slice(0, 21), 22) + lpad(L.par ?? '?', 4) + lpad(L.trapBits ?? '?', 6) +
    lpad(L.firstClearStrikes != null ? `${L.firstClearStrikes}${L.best < L.firstClearStrikes ? '→' + L.best : ''}` : 'no', 7) +
    lpad(sec(L.firstClearMs ?? L.activeMs), 7) + lpad(L.strikes, 6) + lpad(L.undos, 5) + lpad(L.restarts, 4) + lpad(L.hints, 5) +
    lpad(L.blunders, 6) + lpad(L.medianNoticeStrikes != null ? `${L.medianNoticeStrikes}/${sec(L.medianNoticeMs)}` : '–', 8) +
    lpad(L.optimalRate != null ? Math.round(L.optimalRate * 100) : '–', 6) + lpad(sec(L.medianThinkMs), 7) + '  ' + flags);
}
console.log(`
clear  = strikes on first clear (→ best later) · time = active time to first clear (or total if never cleared)
blndr  = strikes that turned a restorable position into a lost one
notice = median strikes made / time spent while lost, before undo/restart got back to a restorable position
opt%   = strikes that kept the minimum remaining strikes on track · think = median pause before a strike`);

// rank correlation between solver difficulty and observed struggle (needs ≥4 cleared shipped levels)
const sh = rows.filter(L => L.trapBits != null && L.firstClearMs != null);
if (sh.length >= 4) {
  const rank = a => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = []; s.forEach(([, i], k) => r[i] = k); return r; };
  const spearman = (x, y) => { const rx = rank(x), ry = rank(y), n = x.length; let d = 0; for (let i = 0; i < n; i++) d += (rx[i] - ry[i]) ** 2; return 1 - 6 * d / (n * (n * n - 1)); };
  const tb = sh.map(L => L.trapBits);
  console.log(`\nSpearman vs trap bits (n=${sh.length}):  time ${spearman(tb, sh.map(L => L.firstClearMs)).toFixed(2)}` +
    `  · undo+restart ${spearman(tb, sh.map(L => L.undos + L.restarts)).toFixed(2)}` +
    `  · blunders ${spearman(tb, sh.map(L => L.blunders)).toFixed(2)}`);
}

const out = join(dir, 'report.json');
writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), sessions: files.map(f => f.split(/[\\/]/).pop()), levels: rows }, null, 1));
console.log(`\nDetail (per-strike timeline): ${out}`);

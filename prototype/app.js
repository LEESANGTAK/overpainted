import { parseLevel, probe, applyHits, isClear, tilesLeft, listMoves, toRows, toUnder, COLOR_CHARS } from '../core/rules.js';
import { analyze, findSolution, SearchLimit } from '../core/solver.js';
import { baitReport, DEFAULT_WEIGHTS } from '../core/predict.js';
import { t, lt, applyStatic, toggleLang } from './i18n.js';
import { COLLECTOR_URL } from './config.js';
let predictWeights = DEFAULT_WEIGHTS; // replaced by levels/predict-weights.json when present

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PIGMENTS = ['Vermilion', 'Ultramarine', 'Ochre', 'Verdigris', 'Violet', 'Bone'];
const STORE_KEY = 'overpainted.proto.v1';

// ---------- persistence (per-browser conveniences only) ----------
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode etc. */ }
}
const store = loadStore();
store.custom ??= [];
store.best ??= {};

// ---------- playtest log ----------
// Local dev (tools/serve.mjs):   POST /api/playlog            -> playtests/<session>.jsonl
// Hosted build (GitHub Pages):   POST config.COLLECTOR_URL    -> the designer's Google Sheet
// The designer's own local plays never go to the collector (unless overridden for testing with
// localStorage 'overpainted.collector'), so tester data stays clean.
const pad2 = n => String(n).padStart(2, '0');
const SESSION = (d => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`)(new Date())
  + '-' + Math.random().toString(36).slice(2, 6);
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const SINKS = (() => {
  const s = [];
  if (IS_LOCAL) s.push({ url: '/api/playlog', remote: false });
  let remote = IS_LOCAL ? null : COLLECTOR_URL;
  try { remote = localStorage.getItem('overpainted.collector') || remote; } catch { }
  if (remote) s.push({ url: remote, remote: true });
  return s;
})();
// who is playing: ?t=<name> in the link the designer sends (remembered), plus an anonymous browser id
const TESTER = (() => {
  try {
    const q = new URLSearchParams(location.search).get('t');
    if (q) localStorage.setItem('overpainted.tester', q.slice(0, 40));
    let id = localStorage.getItem('overpainted.browser');
    if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem('overpainted.browser', id); }
    return { name: localStorage.getItem('overpainted.tester') || null, browser: id };
  } catch { return { name: null, browser: null }; }
})();
const logBuf = [];
let logOk = true;
function log(type, data = {}) {
  logBuf.push({ t: Date.now(), type, lvl: S.def?.id ?? null, ...data });
}
async function send(sink, events) {
  const body = JSON.stringify({ session: SESSION, events });
  if (!sink.remote) return (await fetch(sink.url, { method: 'POST', body, keepalive: true })).ok;
  // Apps Script answers with a cross-origin redirect: send as a "simple" request and don't read the reply
  await fetch(sink.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, keepalive: true });
  return true;
}
async function flushLog() {
  if (!logBuf.length || !SINKS.length) return;
  const events = logBuf.splice(0);
  let ok = true;
  for (const sink of SINKS) {
    try { ok = (await send(sink, events)) && ok; } catch { ok = false; }
  }
  if (!ok && events.length < 5000) logBuf.unshift(...events); // keep them for the next try
  logOk = ok;
  const rec = document.getElementById('rec');
  if (rec) { rec.classList.toggle('off', !logOk); rec.title = logOk ? `Recording playtest ${SESSION}` : 'Playtest log not saving (offline?)'; }
}
setInterval(flushLog, 2000);
addEventListener('pagehide', () => {
  log('session_end');
  const body = JSON.stringify({ session: SESSION, events: logBuf.splice(0) });
  for (const sink of SINKS) navigator.sendBeacon?.(sink.url, new Blob([body], { type: 'text/plain;charset=utf-8' }));
});
document.addEventListener('visibilitychange', () => {
  log(document.hidden ? 'away' : 'back');
  if (document.hidden) flushLog(); // tabs that get closed or frozen right after this still deliver
});

// ---------- state ----------
const S = {
  levels: [], def: null, board: null, hp: null, hist: [],
  levelInfo: null,          // analysis of the level start (par, metrics, solution)
  nowInfo: null,            // analysis of the current position (dev overlay / hints)
  mode: 'play', dev: false, busy: false, won: false, hints: 0, size: 56, hintCell: -1,
  edit: { rows: null, under: null, brush: 'A', varnish: false, underBrush: '', painting: false, info: null },
};

// ---------- procedural "original painting" revealed under the paint ----------
const paintCache = new Map();
function hashStr(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
function painting(id, wPx, hPx) {
  const key = `${id}|${wPx}|${hPx}`;
  if (paintCache.has(key)) return paintCache.get(key);
  let seed = hashStr(id);
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296);
  const cv = document.createElement('canvas');
  cv.width = wPx; cv.height = hPx;
  const g = cv.getContext('2d');
  const hue = Math.floor(rnd() * 360);
  const bg = g.createLinearGradient(0, 0, wPx * .3, hPx);
  bg.addColorStop(0, `hsl(${hue} 25% 30%)`);
  bg.addColorStop(1, `hsl(${(hue + 40) % 360} 30% 12%)`);
  g.fillStyle = bg; g.fillRect(0, 0, wPx, hPx);
  g.filter = `blur(${Math.round(Math.min(wPx, hPx) / 14)}px)`;
  for (let i = 0; i < 7; i++) {
    g.fillStyle = `hsla(${(hue + rnd() * 90) % 360} ${30 + rnd() * 30}% ${25 + rnd() * 40}% / .6)`;
    g.beginPath();
    g.ellipse(rnd() * wPx, rnd() * hPx, wPx * (.1 + rnd() * .3), hPx * (.1 + rnd() * .3), rnd() * 3, 0, 7);
    g.fill();
  }
  // the figure someone wanted gone
  g.filter = 'blur(2px)';
  const fx = wPx * (.35 + rnd() * .3), fy = hPx * .55, u = Math.min(wPx, hPx) / 6;
  g.fillStyle = '#0b0a0cd0';
  g.beginPath(); g.ellipse(fx, fy - u * 1.4, u * .55, u * .65, 0, 0, 7); g.fill();
  g.beginPath(); g.moveTo(fx - u * 1.3, hPx); g.quadraticCurveTo(fx - u * 1.1, fy - u * .5, fx, fy - u * .6);
  g.quadraticCurveTo(fx + u * 1.1, fy - u * .5, fx + u * 1.3, hPx); g.fill();
  g.filter = 'none';
  const img = g.getImageData(0, 0, wPx, hPx);
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - .5) * 18; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const vg = g.createRadialGradient(wPx / 2, hPx / 2, Math.min(wPx, hPx) * .3, wPx / 2, hPx / 2, Math.max(wPx, hPx) * .75);
  vg.addColorStop(0, '#0000'); vg.addColorStop(1, '#000a');
  g.fillStyle = vg; g.fillRect(0, 0, wPx, hPx);
  const url = `url(${cv.toDataURL('image/jpeg', .85)})`;
  paintCache.set(key, url);
  return url;
}

// ---------- rendering ----------
function boardShown() {
  if (S.mode === 'edit') {
    const b = parseLevel({ rows: S.edit.rows.map(r => r.join('')), under: S.edit.under.map(r => r.join('')) });
    return { b, hp: b.initHp, id: 'edit' };
  }
  return { b: S.board, hp: S.hp, id: S.def.id };
}

function fitSize(w, h) {
  const stage = $('stage');
  const mobile = window.innerWidth <= 1100 || window.matchMedia('(pointer: coarse), (hover: none)').matches;
  const stageW = stage.clientWidth > 200 ? Math.min(stage.clientWidth, window.innerWidth) : window.innerWidth;
  const aw = mobile ? stageW - 36 : stage.clientWidth - 80;
  const ah = mobile ? Math.max(220, window.innerHeight - 240) : window.innerHeight - 290;
  const maxFit = Math.floor(Math.min(aw / w, ah / h));
  // never below a few pixels: a hidden or not-yet-laid-out stage would otherwise give a negative size
  return Math.max(8, Math.min(26, Math.floor(aw / w)), Math.min(72, maxFit));
}

function tileHtml(k, varnish, u = k) {
  const other = varnish && u !== k;
  // Colour alone tells pigments apart (no glyphs: colour-blind play is out of scope).
  const top = `<div class="tile c${k}${varnish ? ' varnish' : ''}" style="--c:var(--p${k})"></div>`;
  // double coat: a second layer sits underneath and shows once the top peels off. Same paint by
  // default; an undercoat of another pigment is shown from the start (pure puzzle, no surprises),
  // laid out exactly like a same-paint double coat: a rim of the paint beneath around the top coat.
  return varnish ? `<div class="tile under c${u}${other ? ' other' : ''}" style="--c:var(--p${u})"></div>${top}` : top;
}

function renderBoard() {
  const { b, hp, id } = boardShown();
  const s = S.size = fitSize(b.w, b.h);
  const el = $('board');
  el.classList.toggle('edit', S.mode === 'edit');
  el.style.setProperty('--s', s + 'px');
  el.style.gridTemplateColumns = `repeat(${b.w}, ${s}px)`;
  el.style.gridAutoRows = s + 'px';
  el.style.backgroundImage = painting(id, b.w * s, b.h * s);
  let html = '';
  for (let c = 0; c < b.w * b.h; c++) {
    if (b.blocked[c]) { html += `<div class="cell" data-c="${c}"><div class="gold"></div></div>`; continue; }
    const t = b.tileAt[c];
    if (t >= 0 && hp[t] > 0) html += `<div class="cell" data-c="${c}">${hp[t] >= 2 ? tileHtml(b.tileColor[t], true, b.underColor[t]) : tileHtml(b.underColor[t], false)}</div>`;
    else html += `<div class="cell empty${c === S.hintCell ? ' hint' : ''}" data-c="${c}"></div>`;
  }
  el.innerHTML = html;
  const svg = $('rays');
  svg.setAttribute('width', b.w * s); svg.setAttribute('height', b.h * s);
  svg.innerHTML = '';
}

const cellEl = c => $('board').querySelector(`[data-c="${c}"]`);

function drawRays(cell, rays, hits, kind) {
  const b = S.board, s = S.size;
  const cx = (cell % b.w + .5) * s, cy = ((cell / b.w | 0) + .5) * s;
  let out = '';
  for (const r of rays) {
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][r.dir];
    let ex, ey;
    if (r.end >= 0) { ex = (r.end % b.w + .5 - dx * .5) * s; ey = ((r.end / b.w | 0) + .5 - dy * .5) * s; }
    else { ex = dx > 0 ? b.w * s : dx < 0 ? 0 : cx; ey = dy > 0 ? b.h * s : dy < 0 ? 0 : cy; }
    const isHit = hits.includes(r.tile);
    const cls = kind === 'hover' ? 'hover' : isHit ? '' : 'miss';
    out += `<line class="${cls}" x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}"/>`;
    if (kind !== 'hover' && isHit) {
      const tc = r.end;
      out += `<circle class="hit" cx="${(tc % b.w + .5) * s}" cy="${((tc / b.w | 0) + .5) * s}" r="${s * .38}"/>`;
    }
  }
  $('rays').innerHTML = out;
}
const clearRays = () => { $('rays').innerHTML = ''; };

function stars(strikes, par) {
  if (par == null) return '';
  return strikes <= par ? '★★★' : strikes <= par + 1 ? '★★☆' : '★☆☆';
}

// Extra levels hang off a main level (`parent`), like side branches: optional, opened by clearing
// the parent, and skipped by "Next". An extra can hang off another extra (A → B).
const isLocked = def => !!def.extra && store.best[def.parent] == null;
const extrasOf = def => S.levels.filter(d => d.extra && d.parent === def.id);
function nextMain(def) { // next main level after this one (for an extra: after the main level it hangs off)
  let root = def;
  while (root?.extra) root = S.levels.find(d => d.id === root.parent);
  const i = S.levels.indexOf(root);
  return i < 0 ? null : S.levels.slice(i + 1).find(d => !d.extra) ?? null;
}

function renderList() {
  const el = $('levelList');
  const item = (def, custom) => {
    const best = store.best[def.id];
    const active = S.mode === 'play' && S.def && S.def.id === def.id ? ' active' : '';
    const locked = S.mode === 'play' && isLocked(def);
    const meta = locked ? `<small>${t('locked')}</small>` : best != null ? `<small class="stars">${stars(best, def.par)}</small>` : `<small>${t('par')} ${def.par ?? '?'}</small>`;
    const name = (def.extra ? `<em class="tag">${t('extra')}</em>` : '') + escapeHtml(lt(def, 'name'));
    const tip = locked ? ` title="${escapeHtml(t('unlockHint', { name: lt(S.levels.find(d => d.id === def.parent) ?? {}, 'name') }))}"` : '';
    return `<button class="lvl${def.extra ? ' extra' : ''}${locked ? ' locked' : ''}${active}" data-id="${def.id}" data-custom="${custom ? 1 : ''}"${tip}><span>${name}</span>${meta}</button>`;
  };
  el.innerHTML = `<h3>${t('listProto')}</h3>` + S.levels.map(d => item(d, false)).join('') +
    `<h3>${t('listMine')}</h3>` + (store.custom.length ? store.custom.map(d => item(d, true)).join('') : `<small style="color:var(--muted)">${t('makeOne')}</small>`);
  el.querySelector('.lvl.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function updateHud() {
  const strikes = S.hist.length;
  $('strikes').textContent = strikes;
  $('par').textContent = S.def.par ?? S.levelInfo?.minStrikes ?? '–';
  $('left').textContent = S.hp.reduce((a, v) => a + v, 0);
  const st = $('status');
  st.className = '';
  st.textContent = '';
  if (S.won) return;
  if (!isClear(S.hp) && listMoves(S.board, S.hp).length === 0) {
    st.textContent = t('deadEnd');
    if (S.attemptBait) say('stuckAfterBait');
    st.className = 'bad';
  } else if (S.dev && S.nowInfo && !S.nowInfo.solvable) {
    st.textContent = t('devLost');
    st.className = 'bad';
  }
}

function renderDev() {
  $('devBody').hidden = !S.dev;
  if (!S.dev || S.mode !== 'play') return;
  const L = S.levelInfo, N = S.nowInfo;
  const row = (k, v, cls = '') => `<dt>${k}</dt><dd class="${cls}">${v}</dd>`;
  let html = '';
  if (L === 'big') html += row('Level', 'too large to analyse');
  else if (L) {
    html += row('Par', L.minStrikes ?? '—')
      + row('Random play clears', pct(L.pRandom))
      + row('Trap bits', fmtBits(L.trapBits))
      + row('Safe first strikes', `${L.startSafe} / ${L.startMoves}`)
      + row('Optimal lines', L.optimalSolutions)
      + row('Reachable states', L.states.toLocaleString());
  }
  html += '<dt style="grid-column:1/-1;margin-top:8px;color:var(--accent)">From here</dt>';
  if (N === 'big') html += row('Analysis', 'too large');
  else if (N) {
    html += row('Solvable', N.solvable ? 'yes' : 'no', N.solvable ? 'good' : 'bad')
      + row('Strikes to finish', N.solvable ? N.minStrikes : '—')
      + row('Random play clears', pct(N.pRandom))
      + row('Safe strikes now', `${N.startSafe} / ${N.startMoves}`);
  }
  $('devStats').innerHTML = html;
}
const pct = p => (p * 100).toFixed(p < .01 ? 2 : 1) + '%';
const fmtBits = b => (b === Infinity ? '∞' : b.toFixed(2));

// ---------- analysis ----------
function safeAnalyze(board, hp, maxStates) {
  try { return analyze(board, { hp, maxStates }); }
  catch (e) { if (e instanceof SearchLimit) return 'big'; throw e; }
}
let nowTimer = 0;
function refreshNow() {
  clearTimeout(nowTimer);
  nowTimer = setTimeout(() => {
    if (S.mode !== 'play') return;
    S.nowInfo = safeAnalyze(S.board, S.hp, 300_000);
    renderDev(); updateHud();
  }, 20);
}

// ---------- play ----------
function loadLevel(def) {
  if (S.mode === 'play' && S.def && !S.won) log('leave', { strikes: S.hist.length });
  S.mode = 'play';
  S.def = def;
  S.board = parseLevel(def);
  S.hp = S.board.initHp.slice();
  S.hist = []; S.won = false; S.hints = 0; S.hintCell = -1; S.busy = false; S.queued = null;
  S.gen = (S.gen ?? 0) + 1; // a strike still animating from the previous level checks this and drops out
  // the overpainter's bait for this level (if any): the move a click on def.bait makes at the start
  S.baitKey = def.bait ? probe(S.board, S.board.initHp, def.bait[1] * S.board.w + def.bait[0])?.hits.join(',') : null;
  S.attemptBait = false; S.fell = false; S.said = new Set();
  $('voice').hidden = true;
  S.levelInfo = safeAnalyze(S.board, S.board.initHp, 800_000);
  if (S.def.par == null && S.levelInfo && S.levelInfo !== 'big') S.def.par = S.levelInfo.minStrikes;
  S.nowInfo = S.levelInfo;
  $('levelName').textContent = lt(def, 'name');
  $('levelNote').textContent = lt(def, 'note') || '';
  $('overlay').hidden = true;
  showMode();
  renderBoard(); renderList(); updateHud(); renderDev();
  log('level_start', { rows: def.rows, under: def.under, par: def.par ?? null, dev: S.dev });
  try { localStorage.setItem(STORE_KEY + '.last', def.id); } catch { }
}

async function strikeAt(c) {
  if (S.won) return;
  if (S.busy) { S.queued = c; return; } // fast players: run it right after the animation
  const r = probe(S.board, S.hp, c);
  if (!r) return;
  S.hintCell = -1;
  cellEl(c)?.classList.remove('hint');
  drawRays(c, r.rays, r.hits, 'strike');
  log('strike', { cell: c, hits: r.hits.length, fizzle: r.hits.length < 2, replay: !!S.replaying || undefined });
  if (r.hits.length < 2) {
    const el = cellEl(c);
    el.classList.remove('fizzle'); void el.offsetWidth; el.classList.add('fizzle');
    setTimeout(clearRays, 350);
    return;
  }
  S.busy = true;
  const gen = S.gen;
  for (const t of r.hits) {
    const tile = cellEl(S.board.tileCell[t]).querySelector('.tile:not(.under)');
    tile.classList.add(S.hp[t] >= 2 ? 'strip' : 'dissolve');
  }
  await sleep(280);
  if (gen !== S.gen) return; // another level was loaded mid-animation: drop this strike
  if (S.mode !== 'play') { S.busy = false; return; } // editor opened mid-animation
  if (!S.hist.length && !S.replaying) {
    S.attemptBait = r.hits.join(',') === S.baitKey;
    if (S.attemptBait) S.fell = true;
  }
  S.hist.push(S.hp);
  S.hp = applyHits(S.hp, r.hits);
  S.busy = false;
  renderBoard();
  afterMove();
  if (S.queued != null) { const q = S.queued; S.queued = null; await strikeAt(q); }
}

function afterMove() {
  if (isClear(S.hp)) return win();
  updateHud();
  if (S.dev) refreshNow(); else S.nowInfo = null;
}

function win() {
  S.won = true;
  S.nowInfo = null; renderDev();
  const strikes = S.hist.length, par = S.def.par;
  const prev = store.best[S.def.id];
  if (prev == null || strikes < prev) { store.best[S.def.id] = strikes; saveStore(); }
  log('win', { strikes, par: par ?? null, hints: S.hints });
  const custom = store.custom.includes(S.def);
  const list = allLevels();
  const next = custom ? list[list.indexOf(S.def) + 1] : nextMain(S.def);
  const extra = custom ? null : extrasOf(S.def)[0]; // just opened by this clear
  $('overlay').innerHTML = `<div>
    <h2>${t('restored')}</h2>
    <div class="stars">${stars(strikes, par)}</div>
    <p>${t('result', { s: strikes, p: par ?? '?' })}${S.hints ? t('hints', { n: S.hints }) : ''}</p>
    <button id="ovRetry">${t('retry')}</button>
    ${extra ? `<button id="ovExtra" class="extra${next ? '' : ' primary'}">${t('extra')}: ${escapeHtml(lt(extra, 'name'))}</button>` : ''}
    ${next && S.def.id !== 'edit-test' ? `<button id="ovNext" class="primary">${t('next')}</button>` : ''}
    ${S.def.id === 'edit-test' ? `<button id="ovEdit" class="primary">${t('backEditor')}</button>` : ''}
  </div>`;
  if (S.baitKey) say(S.fell ? 'winAfterBait' : 'winClean');
  $('overlay').hidden = false;
  $('ovRetry').onclick = restart;
  if ($('ovNext')) $('ovNext').onclick = () => loadLevel(next);
  if ($('ovExtra')) $('ovExtra').onclick = () => loadLevel(extra);
  if ($('ovEdit')) $('ovEdit').onclick = enterEdit;
  updateHud(); renderList();
}

// First visit of a tester: what to do, what is recorded, and who is playing (name asked here,
// remembered in this browser; a ?t= link only pre-fills it).
function welcome() {
  try { if (localStorage.getItem('overpainted.welcomed') && TESTER.name) { showTester(); return; } } catch { }
  const el = document.createElement('div');
  el.id = 'welcome';
  el.innerHTML = `<form class="card" autocomplete="off">
    <h2>${t('wTitle')}</h2>
    <ol>${['w1', 'w2', 'w3', 'w4'].map(k => `<li>${t(k)}</li>`).join('')}</ol>
    <label class="name">${t('wNameLabel')}
      <input id="wName" maxlength="40" required placeholder="${t('wNamePh')}" value="${escapeHtml(TESTER.name ?? '')}">
    </label>
    <p class="fine">${t('wData')}</p>
    <button class="primary" id="wStart" type="submit">${t('wStart')}</button>
  </form>`;
  document.body.append(el);
  log('welcome_shown');
  const input = $('wName');
  const sync = () => { $('wStart').disabled = !input.value.trim(); };
  input.oninput = sync; sync();
  setTimeout(() => input.focus(), 50);
  el.querySelector('form').onsubmit = e => {
    e.preventDefault();
    const name = input.value.trim().slice(0, 40);
    if (!name) return;
    TESTER.name = name;
    try { localStorage.setItem('overpainted.tester', name); localStorage.setItem('overpainted.welcomed', '1'); } catch { }
    log('tester', { tester: name });
    el.remove();
    showTester();
  };
}
function showTester() {
  const rec = $('rec');
  if (rec && TESTER.name) rec.textContent = `${t('rec')} · ${TESTER.name}`;
}

// The overpainter speaks: one line per trigger per visit, from the level's `voice` (see levels file).
function say(trigger) {
  const line = lt(S.def, 'voice')?.[trigger];
  if (!line || S.said.has(trigger)) return;
  S.said.add(trigger);
  const el = $('voice');
  el.textContent = line;
  el.hidden = false;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  log('voice', { trigger });
}

function undo() {
  if (S.busy || !S.hist.length || S.mode !== 'play') return;
  log('undo', { wasWon: S.won || undefined });
  S.hp = S.hist.pop(); S.won = false; S.hintCell = -1;
  if (!S.hist.length) S.attemptBait = false;
  $('overlay').hidden = true;
  renderBoard(); afterMove();
}
function restart() {
  if (S.busy || S.mode !== 'play') return;
  log('restart', { strikes: S.hist.length, wasWon: S.won || undefined });
  S.hp = S.board.initHp.slice(); S.hist = []; S.won = false; S.hintCell = -1; S.attemptBait = false;
  $('overlay').hidden = true;
  renderBoard(); afterMove();
}

function hint() {
  if (S.busy || S.won || S.mode !== 'play') return;
  let first = null, lost = false;
  const a = safeAnalyze(S.board, S.hp, 300_000);
  if (a === 'big') {
    try { const r = findSolution(S.board, { hp: S.hp, maxStates: 1_000_000 }); if (r.path) first = r.path[0]; else lost = true; }
    catch { $('status').textContent = t('hintTooBig'); return; }
  } else if (a.solvable) first = a.solution[0];
  else lost = true;
  log('hint', lost ? { lost: true } : { cell: first.cell });
  if (lost) { $('status').textContent = t('hintLost'); $('status').className = 'bad'; return; }
  S.hints++;
  S.hintCell = first.cell;
  cellEl(first.cell)?.classList.add('hint');
}

async function replaySolution() {
  if (S.mode !== 'play' || !S.levelInfo || S.levelInfo === 'big' || !S.levelInfo.solvable) return;
  restart();
  log('replay');
  S.replaying = true;
  try {
    await sleep(300);
    for (const st of S.levelInfo.solution) {
      if (S.mode !== 'play') return;
      await strikeAt(st.cell);
      await sleep(380);
    }
  } finally { S.replaying = false; }
}

// ---------- editor ----------
const BRUSHES = ['.', ...COLOR_CHARS.split(''), '#'];
function enterEdit() {
  S.mode = 'edit';
  if (!S.edit.rows) setEditRows(S.def ? toRows(S.board, S.board.initHp) : ['......', '......', '......', '......', '......', '......'], S.def, S.def ? toUnder(S.board, S.board.initHp) : null);
  showMode();
  renderBoard(); renderList(); renderPalette();
}
function setEditRows(rows, def, under = null) {
  const w = Math.max(...rows.map(r => r.length));
  S.edit.rows = rows.map(r => r.padEnd(w, '.').split(''));
  S.edit.under = rows.map((_, y) => (under?.[y] ?? '').padEnd(w, '.').slice(0, w).split(''));
  S.edit.info = null;
  $('editW').value = w; $('editH').value = rows.length;
  if (def) { $('editName').value = def.name ?? ''; $('editNote').value = def.note ?? ''; }
  $('editStats').innerHTML = '';
}
function renderPalette() {
  $('palette').innerHTML = BRUSHES.map(ch => {
    const k = COLOR_CHARS.indexOf(ch);
    const u = S.edit.varnish && S.edit.underBrush ? COLOR_CHARS.indexOf(S.edit.underBrush) : k;
    const inner = ch === '#' ? '<div class="gold"></div>' : k >= 0 ? tileHtml(k, S.edit.varnish, u) : '';
    const lbl = ch === '.' ? 'erase' : ch === '#' ? 'gold' : PIGMENTS[k].slice(0, 5);
    return `<button class="brush${S.edit.brush === ch ? ' active' : ''}" data-b="${ch}" title="${lbl}">${inner}<span class="lbl">${lbl}</span></button>`;
  }).join('');
}
function paintCell(c) {
  const w = S.edit.rows[0].length;
  const x = c % w, y = c / w | 0;
  let ch = S.edit.brush;
  const isPaint = COLOR_CHARS.includes(ch);
  if (S.edit.varnish && isPaint) ch = ch.toLowerCase();
  const u = S.edit.varnish && isPaint && S.edit.underBrush && S.edit.underBrush !== S.edit.brush ? S.edit.underBrush : '.';
  if (S.edit.rows[y][x] === ch && S.edit.under[y][x] === u) return;
  S.edit.rows[y][x] = ch;
  S.edit.under[y][x] = u;
  S.edit.info = null;
  renderBoard();
}
function editDef() {
  const def = {
    id: 'edit-test', name: $('editName').value.trim() || 'Untitled', note: $('editNote').value.trim(),
    rows: S.edit.rows.map(r => r.join('')),
  };
  if (S.edit.under.some(r => r.some(ch => ch !== '.'))) def.under = S.edit.under.map(r => r.join(''));
  return def;
}
function runEditAnalysis() {
  $('editStats').innerHTML = '<dt>Analyzing…</dt><dd></dd>';
  return new Promise(res => setTimeout(() => {
    const def = editDef();
    const b = parseLevel(def);
    const warn = [];
    const counts = new Array(6).fill(0);
    b.tileColor.forEach((k, t) => { counts[k]++; if (b.underColor[t] !== k) counts[b.underColor[t]]++; });
    counts.forEach((n, k) => { if (n === 1) warn.push(`${PIGMENTS[k]} has a single tile`); });
    const a = safeAnalyze(b, b.initHp, 3_000_000);
    S.edit.info = a;
    const row = (k, v, cls = '') => `<dt>${k}</dt><dd class="${cls}">${v}</dd>`;
    let html = row('Tiles', b.nTiles);
    if (a === 'big') html += row('Result', 'too large (>3M states)', 'bad');
    else if (!a.solvable) html += row('Solvable', 'no', 'bad') + row('States', a.states.toLocaleString()) + row('Dead ends', a.deadStates);
    else html += row('Solvable', 'yes', 'good') + row('Par', a.minStrikes)
      + row('Random play clears', pct(a.pRandom)) + row('Trap bits', fmtBits(a.trapBits))
      + row('Safe first strikes', `${a.startSafe} / ${a.startMoves}`) + row('Optimal lines', a.optimalSolutions)
      + row('Reachable states', a.states.toLocaleString()) + row('Lost positions', pct(a.unsolvableRatio)) + row('Time', a.ms + ' ms');
    if (a !== 'big' && a.solvable) {
      // first-move predictor: does the player's instinct walk into the trap?
      const lost = hp => { const r = safeAnalyze(b, hp, 500_000); return r !== 'big' && !r.solvable; };
      const br = baitReport(b, lost, predictWeights);
      const t = br.top; // undefined when the board has no strike at all (e.g. empty board)
      if (t) {
        const where = `(${t.cell % b.w},${t.cell / b.w | 0})`;
        const what = [...new Set(t.hits.map(h => PIGMENTS[b.tileColor[h]]))].join('+');
        html += row('Instinct move', `${where} ${what}×${t.hits.length} · ${pct(t.p)}`)
          + row('…and it', t.fatal ? 'LOSES (bait works)' : 'is safe', t.fatal ? 'good' : '')
          + row('Instinct loses', pct(br.pFatal));
      }
    }
    for (const w of warn) html += `<dt style="grid-column:1/-1;color:var(--bad)">${w}</dt>`;
    $('editStats').innerHTML = html;
    res(a);
  }, 20));
}

// ---------- mode switching / wiring ----------
function showMode() {
  const edit = S.mode === 'edit';
  $('modePlay').classList.toggle('active', !edit);
  $('modeEdit').classList.toggle('active', edit);
  $('editPanel').hidden = !edit;
  $('devPanel').hidden = edit || !IS_LOCAL; // testers never see the dev overlay
  $('hud').style.visibility = edit ? 'hidden' : '';
  $('controls').style.visibility = edit ? 'hidden' : '';
  $('overlay').hidden = edit || !S.won;
  if (edit) { $('levelName').textContent = t('editorTitle'); $('levelNote').textContent = t('editorNote'); $('voice').hidden = true; }
  else if (S.def) { $('levelName').textContent = lt(S.def, 'name'); $('levelNote').textContent = lt(S.def, 'note') || ''; }
}

function allLevels() { return [...S.levels, ...store.custom]; }

function wire() {
  const board = $('board');
  board.addEventListener('mousedown', e => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const c = +cell.dataset.c;
    if (S.mode === 'edit') { S.edit.painting = true; paintCell(c); e.preventDefault(); }
    else strikeAt(c);
  });
  board.addEventListener('mousemove', e => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const c = +cell.dataset.c;
    if (S.mode === 'edit') { if (S.edit.painting) paintCell(c); return; }
    if (!window.matchMedia('(hover: hover)').matches) return;
    if (S.busy || S.won || !$('hoverRays').checked) return;
    const r = probe(S.board, S.hp, c);
    if (r) drawRays(c, r.rays, r.hits, 'hover'); else clearRays();
  });
  board.addEventListener('touchstart', e => {
    if (S.mode !== 'edit' || e.touches.length !== 1) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    S.edit.painting = true;
    paintCell(+cell.dataset.c);
    e.preventDefault();
  }, { passive: false });
  board.addEventListener('touchmove', e => {
    if (S.mode !== 'edit' || !S.edit.painting || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const cell = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.cell');
    if (cell && board.contains(cell)) paintCell(+cell.dataset.c);
    e.preventDefault();
  }, { passive: false });
  board.addEventListener('mouseleave', () => { if (!S.busy) clearRays(); });
  window.addEventListener('mouseup', () => { S.edit.painting = false; });
  window.addEventListener('touchend', () => { S.edit.painting = false; });
  window.addEventListener('touchcancel', () => { S.edit.painting = false; });

  $('levelList').addEventListener('click', e => {
    const btn = e.target.closest('.lvl');
    if (!btn) return;
    const def = allLevels().find(d => d.id === btn.dataset.id);
    if (!def) return;
    if (S.mode === 'edit') { setEditRows(def.rows, def, def.under); renderBoard(); }
    else if (!isLocked(def)) loadLevel(def);
  });

  $('undo').onclick = undo;
  $('restart').onclick = restart;
  $('hint').onclick = hint;
  $('devToggle').onchange = e => { S.dev = e.target.checked; log('dev', { on: S.dev }); if (S.dev) refreshNow(); renderDev(); updateHud(); };
  $('replay').onclick = replaySolution;
  $('modePlay').onclick = () => { if (S.mode === 'edit') loadLevel(S.def && S.def.id !== 'edit-test' ? S.def : editDef()); };
  $('modeEdit').onclick = () => { if (S.mode !== 'edit') enterEdit(); };

  $('palette').addEventListener('click', e => {
    const b = e.target.closest('.brush');
    if (!b) return;
    S.edit.brush = b.dataset.b; renderPalette();
  });
  $('varnishBrush').onchange = e => { S.edit.varnish = e.target.checked; renderPalette(); };
  $('underBrush').onchange = e => { S.edit.underBrush = e.target.value; renderPalette(); };
  $('resize').onclick = () => {
    const w = Math.max(2, Math.min(12, +$('editW').value)), h = Math.max(2, Math.min(12, +$('editH').value));
    const old = S.edit.rows;
    const oldU = S.edit.under;
    S.edit.rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => old[y]?.[x] ?? '.'));
    S.edit.under = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => oldU[y]?.[x] ?? '.'));
    S.edit.info = null; renderBoard();
  };
  $('clearEdit').onclick = () => { S.edit.rows = S.edit.rows.map(r => r.map(() => '.')); S.edit.under = S.edit.under.map(r => r.map(() => '.')); S.edit.info = null; renderBoard(); };
  $('analyze').onclick = runEditAnalysis;
  $('testPlay').onclick = () => loadLevel(editDef());
  $('saveLevel').onclick = async () => {
    const a = S.edit.info ?? await runEditAnalysis();
    const def = editDef();
    def.id = 'my-' + Date.now().toString(36);
    if (a && a !== 'big' && a.solvable) def.par = a.minStrikes;
    store.custom.push(def); saveStore(); renderList();
  };
  $('exportJson').onclick = () => {
    const def = editDef();
    const a = S.edit.info;
    const out = { id: def.name.toLowerCase().replace(/\W+/g, '-'), name: def.name, note: def.note, rows: def.rows };
    if (def.under) out.under = def.under;
    if (a && a !== 'big' && a.solvable) out.par = a.minStrikes;
    $('json').value = JSON.stringify(out, null, 2);
  };
  $('importJson').onclick = () => {
    try {
      let d = JSON.parse($('json').value);
      if (d.levels) d = d.levels[0];
      parseLevel(d);
      setEditRows(d.rows, d, d.under); renderBoard();
    } catch (err) { $('editStats').innerHTML = `<dt style="grid-column:1/-1;color:var(--bad)">${escapeHtml(err.message)}</dt>`; }
  };

  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'z') undo();
    else if (k === 'r') restart();
    else if (k === 'h') hint();
    else if (k === 'd' && IS_LOCAL) { $('devToggle').checked = !S.dev; $('devToggle').onchange({ target: $('devToggle') }); }
  });
  const onResize = () => { if (S.def || S.mode === 'edit') renderBoard(); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => { onResize(); setTimeout(onResize, 120); });
  window.visualViewport?.addEventListener('resize', onResize);
}

async function main() {
  if (!IS_LOCAL) document.querySelector('.keys').dataset.i18n = 'keysPlay';
  applyStatic();
  wire();
  $('langBtn').onclick = toggleLang;
  log('session_start', { w: innerWidth, h: innerHeight, tester: TESTER.name, browser: TESTER.browser, lang: document.documentElement.lang, hosted: !IS_LOCAL });
  if (!IS_LOCAL) $('modeEdit').hidden = true; // testers only play
  if (SINKS.some(s => s.remote)) welcome();
  try { const pw = await fetch('../levels/predict-weights.json').then(r => r.ok ? r.json() : null); if (pw) predictWeights = { ...DEFAULT_WEIGHTS, ...pw.weights }; } catch { }
  const data = await fetch('../levels/prototype.json').then(r => r.json());
  S.levels = data.levels;
  let last = null;
  try { last = localStorage.getItem(STORE_KEY + '.last'); } catch { }
  const lastDef = allLevels().find(d => d.id === last);
  loadLevel(lastDef && !isLocked(lastDef) ? lastDef : S.levels[0]);
}
main();

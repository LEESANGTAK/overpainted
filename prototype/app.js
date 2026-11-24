import { parseLevel, probe, applyHits, isClear, listMoves, toRows, toUnder, toMix, COLOR_CHARS, canTape, applyTape, tapeLeft, isTaped, layersLeft } from '../core/rules.js';
import { analyze, findSolution, SearchLimit } from '../core/solver.js';
import { baitReport, DEFAULT_WEIGHTS } from '../core/predict.js';
import { isMuted, toggleMute, unlock, preload, setLost } from './mood.js';
import { startPad } from './pad.js';
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
  edit: { rows: null, under: null, mix: null, brush: 'A', varnish: false, underBrush: '', mixBrush: '', painting: false, info: null },
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
    const b = parseLevel({ rows: S.edit.rows.map(r => r.join('')), under: S.edit.under.map(r => r.join('')), mix: S.edit.mix.map(r => r.join('')) });
    return { b, hp: b.initHp, id: 'edit' };
  }
  return { b: S.board, hp: S.hp, id: S.def.id };
}

function fitSize(w, h) {
  const stage = $('stage');
  const mobile = window.innerWidth <= 1100 || window.matchMedia('(pointer: coarse), (hover: none)').matches;
  const stageW = stage.clientWidth > 200 ? Math.min(stage.clientWidth, window.innerWidth) : window.innerWidth;
  const tray = S.mode === 'play' && S.board?.tape ? (mobile ? 58 : 74) : 0; // tape tray left of the canvas
  const aw = (mobile ? stageW - 36 : stage.clientWidth - 80) - tray;
  const ah = mobile ? Math.max(220, window.innerHeight - 240) : window.innerHeight - 290;
  const maxFit = Math.floor(Math.min(aw / w, ah / h));
  // never below a few pixels: a hidden or not-yet-laid-out stage would otherwise give a negative size
  return Math.max(8, Math.min(26, Math.floor(aw / w)), Math.min(72, maxFit));
}

// Impasto dabs vary a little per tile (tilt, shape, brush grain). Seeded by level and cell, so a
// tile keeps its shape across redraws and only changes when the level does.
function dabStyle(id, c) {
  let s = hashStr(`${id}|${c}`);
  const r = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296);
  const p = () => Math.round(6 + r() * 16) + '%';
  return `;--rot:${(r() * 8 - 4).toFixed(1)}deg;--br:${p()} ${p()} ${p()} ${p()} / ${p()} ${p()} ${p()} ${p()}`
    + `;--br2:${p()} ${p()} ${p()} ${p()} / ${p()} ${p()} ${p()} ${p()};--grain:${100 + Math.round(r() * 30)}deg`
    + marbleStyle(r);
}
// A mixed dab's marbling (used only by .tile.mixed): one of the #marble0..4 swirls, the angle of the
// pigment bands, their width, and a 40-60% share of each pigment, so both always show.
function marbleStyle(r) {
  const swirl = Math.floor(r() * 5), ang = Math.round(r() * 180);
  const band = 22 + r() * 12, b1 = band * (0.4 + r() * 0.2);
  return `;--marble:url(#marble${swirl});--ang:${ang}deg;--b1:${b1.toFixed(1)}%;--b2:${band.toFixed(1)}%`;
}

function tileHtml(k, varnish, u = k, dab = '', mix = -1) {
  const other = varnish && u !== k;
  // Colour alone tells pigments apart (no glyphs: colour-blind play is out of scope).
  // A mixed tile shows both of its pigments in one dab, split corner to corner: the rule is on the tile.
  const m = !varnish && mix >= 0 ? ` mixed" data-mix="${mix}` : '';
  const c2 = !varnish && mix >= 0 ? `;--c2:var(--p${mix})` : '';
  const top = `<div class="tile c${k}${varnish ? ' varnish' : ''}${m}" style="--c:var(--p${k})${c2}${dab}"></div>`;
  // double coat: a second dab sits underneath and shows once the top peels off. Same paint by
  // default; an undercoat of another pigment is shown from the start (pure puzzle, no surprises),
  // laid out exactly like a same-paint double coat: the wider dab beneath, the top coat on it.
  return varnish ? `<div class="tile under c${u}${other ? ' other' : ''}" style="--c:var(--p${u})${dab}"></div>${top}` : top;
}

function renderBoard() {
  const { b, hp, id } = boardShown();
  const s = S.size = fitSize(b.w, b.h);
  const el = $('board');
  el.classList.toggle('edit', S.mode === 'edit');
  el.classList.toggle('taping', S.mode === 'play' && !!S.tapeMode);
  el.style.setProperty('--s', s + 'px');
  el.style.gridTemplateColumns = `repeat(${b.w}, ${s}px)`;
  el.style.gridAutoRows = s + 'px';
  el.style.backgroundImage = painting(id, b.w * s, b.h * s);
  let html = '';
  for (let c = 0; c < b.w * b.h; c++) {
    if (b.blocked[c]) { html += `<div class="cell" data-c="${c}"><div class="oldtape"></div></div>`; continue; }
    if (isTaped(b, hp, c)) { html += `<div class="cell taped" data-c="${c}"><div class="tape"></div></div>`; continue; }
    const t = b.tileAt[c];
    const dab = dabStyle(id, c);
    if (t >= 0 && hp[t] > 0) html += `<div class="cell" data-c="${c}">${hp[t] >= 2 ? tileHtml(b.tileColor[t], true, b.underColor[t], dab) : tileHtml(b.underColor[t], false, b.underColor[t], dab, b.mixColor[t])}</div>`;
    else html += `<div class="cell empty${c === S.hintCell ? ' hint' : ''}" data-c="${c}"></div>`;
  }
  el.innerHTML = html;
  const svg = $('rays');
  svg.setAttribute('width', b.w * s); svg.setAttribute('height', b.h * s);
  svg.innerHTML = '';
  renderCursor();
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

// Chapters group the main course by mechanic (levels/prototype.json `chapters`, each level has `chapter`).
// All chapters stay open in the prototype: testers may skip ahead, and that is data too.
const chapterOf = def => S.chapters.find(c => c.id === def?.chapter) ?? null;
const chapterNo = ch => S.chapters.indexOf(ch) + 1;
const mainsOf = ch => S.levels.filter(d => d.chapter === ch.id && !d.extra);
const chapterCleared = ch => mainsOf(ch).every(d => store.best[d.id] != null);

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
  const head = ch => {
    const mains = mainsOf(ch), done = mains.filter(d => store.best[d.id] != null).length;
    return `<h3 class="chapter${done === mains.length ? ' done' : ''}"><span>${chapterNo(ch)} · ${escapeHtml(lt(ch, 'name'))}</span><small>${done}/${mains.length}</small></h3>`;
  };
  const loose = S.levels.filter(d => !chapterOf(d)); // a level not yet put in a chapter
  el.innerHTML = S.chapters.map(ch => head(ch) + S.levels.filter(d => d.chapter === ch.id).map(d => item(d, false)).join('')).join('') +
    (loose.length ? `<h3>${t('listProto')}</h3>` + loose.map(d => item(d, false)).join('') : '') +
    `<h3>${t('listMine')}</h3>` + (store.custom.length ? store.custom.map(d => item(d, true)).join('') : `<small style="color:var(--muted)">${t('makeOne')}</small>`);
  el.querySelector('.lvl.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function updateHud() {
  const strikes = S.hist.length; // tape counts as a move too
  $('strikes').textContent = strikes;
  $('strikesLabel').textContent = t(S.board.tape ? 'moves' : 'strikes');
  renderTray();
  $('par').textContent = S.def.par ?? S.levelInfo?.minStrikes ?? '–';
  $('left').textContent = layersLeft(S.board, S.hp);
  const st = $('status');
  st.className = '';
  st.textContent = '';
  if (S.won) return;
  if (!isClear(S.hp, S.board.nTiles) && listMoves(S.board, S.hp).length === 0) { // tape never makes a strike
    st.textContent = t('deadEnd');
    if (!S.lostAt) S.lostAt = S.hist.length; // (a board too big to analyse move by move)
    turnRoom(); // (the overpainter stays silent here; the room says it)
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
  S.hist = []; S.won = false; S.hints = 0; S.hintCell = -1; S.busy = false; S.queued = null; S.tapeMode = false;
  S.gen = (S.gen ?? 0) + 1; // a strike still animating from the previous level checks this and drops out
  S.lostAt = 0; // moves made when this attempt became unwinnable (0 = still winnable)
  S.cursor = Math.floor(S.board.h / 2) * S.board.w + Math.floor(S.board.w / 2); // gamepad cursor starts mid-canvas
  calmRoom();
  S.levelInfo = safeAnalyze(S.board, S.board.initHp, 800_000);
  if (S.def.par == null && S.levelInfo && S.levelInfo !== 'big') S.def.par = S.levelInfo.minStrikes;
  S.nowInfo = S.levelInfo;
  $('levelName').textContent = lt(def, 'name');
  $('levelNote').textContent = lt(def, 'note') || '';
  showChapter();
  renderTray();
  $('overlay').hidden = true;
  showMode();
  renderBoard(); renderList(); updateHud(); renderDev();
  log('level_start', { chapter: def.chapter ?? null, rows: def.rows, under: def.under, mix: def.mix, tape: def.tape || undefined, par: def.par ?? null, dev: S.dev });
  try { localStorage.setItem(STORE_KEY + '.last', def.id); } catch { }
}

// Masking tape lives in a tray left of the canvas: one piece per tape. Drag a piece onto an empty
// cell to tape it. A plain click on a piece (or T) arms tape instead; the next click on a cell tapes it.
function renderTray() {
  const tray = $('tapeTray');
  const n = S.mode === 'play' ? S.board?.tape ?? 0 : 0;
  tray.hidden = !n;
  if (!n) return;
  const left = tapeLeft(S.board, S.hp);
  tray.classList.toggle('armed', !!S.tapeMode);
  tray.classList.toggle('off', S.won || !left);
  tray.title = t('tapeTip');
  tray.innerHTML = Array.from({ length: n }, (_, i) => `<div class="piece${i >= left ? ' used' : ''}"></div>`).join('');
}
function trayDown(e) {
  const piece = e.target.closest('.piece:not(.used)');
  if (!piece || S.mode !== 'play' || S.won || S.busy || tapeLeft(S.board, S.hp) <= 0) return;
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY;
  // with a finger (Steam Deck touchscreen) the piece rides above the fingertip, and the cell under
  // the piece -- not under the finger -- is where it lands, so the target is never hidden
  const lift = e.pointerType === 'mouse' ? 0 : Math.round(S.size * .8 + 28);
  let ghost = null, over = -1;
  const mark = c => { cellEl(over)?.classList.remove('drop'); over = c; cellEl(over)?.classList.add('drop'); };
  const target = ev => { // the empty cell under the piece (not under a finger), or -1
    const el = document.elementFromPoint(ev.clientX, ev.clientY - lift)?.closest('#board .cell');
    const c = el ? +el.dataset.c : -1;
    return c >= 0 && canTape(S.board, S.hp, c) ? c : -1;
  };
  const move = ev => {
    if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.className = 'tape-ghost';
      ghost.style.width = S.size + 'px'; // cell-sized: the X you drag is the X that lands
      ghost.style.height = S.size + 'px';
      document.body.append(ghost);
      piece.classList.add('lifted');
      S.tapeMode = false; $('board').classList.remove('taping');
    }
    ghost.style.left = ev.clientX + 'px';
    ghost.style.top = ev.clientY - lift + 'px';
    const c = target(ev);
    if (c !== over) mark(c);
    ghost.classList.toggle('ok', c >= 0);
  };
  const end = ev => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    if (!ghost) { if (ev.type === 'pointerup') toggleTape(); return; } // a click, not a drag
    ghost.remove();
    piece.classList.remove('lifted');
    const c = target(ev); // where it is let go, not where it last moved
    mark(-1);
    if (c >= 0 && ev.type === 'pointerup') placeTape(c, 'drag');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

function toggleTape() {
  if (S.mode !== 'play' || S.won || S.busy || !S.board.tape) return;
  if (!S.tapeMode && tapeLeft(S.board, S.hp) <= 0) return;
  S.tapeMode = !S.tapeMode;
  renderBoard(); updateHud();
}
function placeTape(c, via = 'click') {
  S.tapeMode = false;
  if (!canTape(S.board, S.hp, c)) { renderBoard(); updateHud(); return; }
  S.hintCell = -1;
  clearRays();
  log('tape', { cell: c, via: S.replaying ? undefined : via, replay: !!S.replaying || undefined });
  S.hist.push(S.hp);
  S.hp = applyTape(S.board, S.hp, c);
  noteBlunder();
  renderBoard();
  afterMove();
}

async function strikeAt(c) {
  if (S.won) return;
  if (S.tapeMode && !S.busy) return placeTape(c);
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
  S.hist.push(S.hp);
  S.hp = applyHits(S.hp, r.hits);
  noteBlunder();
  S.busy = false;
  renderBoard();
  afterMove();
  if (S.queued != null) { const q = S.queued; S.queued = null; await strikeAt(q); }
}

// After a move: if this attempt was still winnable and no longer is, this move was the blunder.
function noteBlunder() {
  if (S.lostAt || S.replaying) return;
  const now = safeAnalyze(S.board, S.hp, 300_000);
  if (now === 'big' || now.solvable) return;
  S.lostAt = S.hist.length;
  // the room turns later, not on this move: after TURN_MOVES more moves, TURN_MS, or a dead end
  clearTimeout(S.turnTimer);
  S.turnTimer = setTimeout(turnRoom, TURN_MS);
}
function forgetBlunder() { // after undo/restart: the blunder is no longer on the board
  if (S.lostAt && S.hist.length < S.lostAt) { S.lostAt = 0; calmRoom(); }
}

// The quiet signal that a level has gone wrong: the music turns to its dark twin and the paint on
// the canvas dries dull. Never on the blunder itself (that would make every move a free test):
// only TURN_MOVES moves later, after TURN_MS, or at a dead end.
const TURN_MOVES = 2, TURN_MS = 25_000;
function turnRoom() {
  if (!S.lostAt || S.turned || S.won || S.mode !== 'play') return;
  S.turned = true;
  setLost(true);
  $('boardWrap').classList.add('dried');
  log('mood', { lost: true, moves: S.hist.length - S.lostAt });
}
function calmRoom() {
  clearTimeout(S.turnTimer);
  if (!S.turned) return;
  S.turned = false;
  setLost(false);
  $('boardWrap').classList.remove('dried');
  log('mood', { lost: false });
}

function afterMove() {
  if (S.lostAt && S.hist.length - S.lostAt >= TURN_MOVES) turnRoom();
  if (isClear(S.hp, S.board.nTiles)) return win();
  updateHud();
  if (S.dev) refreshNow(); else S.nowInfo = null;
}

function win() {
  S.won = true;
  calmRoom();
  S.nowInfo = null; renderDev();
  const strikes = S.hist.length, par = S.def.par;
  const prev = store.best[S.def.id];
  const ch = chapterOf(S.def), chWasDone = ch && chapterCleared(ch);
  if (prev == null || strikes < prev) { store.best[S.def.id] = strikes; saveStore(); }
  log('win', { strikes, par: par ?? null, hints: S.hints });
  const custom = store.custom.includes(S.def);
  const list = allLevels();
  const next = custom ? list[list.indexOf(S.def) + 1] : nextMain(S.def);
  const extra = custom ? null : extrasOf(S.def)[0]; // just opened by this clear
  const chJustDone = ch && !S.def.extra && !chWasDone && chapterCleared(ch);
  const nextCh = next && !custom ? chapterOf(next) : null;
  const nextLabel = nextCh && nextCh !== ch ? t('nextChapter', { n: chapterNo(nextCh), name: lt(nextCh, 'name') }) : t('next');
  if (chJustDone) log('chapter_clear', { chapter: ch.id });
  $('overlay').innerHTML = `<div>
    <h2>${t('restored')}</h2>
    <div class="stars">${stars(strikes, par)}</div>
    <p>${t(S.board.tape ? 'resultMoves' : 'result', { s: strikes, p: par ?? '?' })}${S.hints ? t('hints', { n: S.hints }) : ''}</p>
    ${chJustDone ? `<p class="chapter-done">${t('chapterDone', { n: chapterNo(ch), name: lt(ch, 'name') })}</p>` : ''}
    <button id="ovRetry">${t('retry')}</button>
    ${extra ? `<button id="ovExtra" class="extra${next ? '' : ' primary'}">${t('extra')}: ${escapeHtml(lt(extra, 'name'))}</button>` : ''}
    ${next && S.def.id !== 'edit-test' ? `<button id="ovNext" class="primary">${escapeHtml(nextLabel)}</button>` : ''}
    ${S.def.id === 'edit-test' ? `<button id="ovEdit" class="primary">${t('backEditor')}</button>` : ''}
  </div>`;
  $('overlay').hidden = false;
  $('ovRetry').onclick = restart;
  if ($('ovNext')) $('ovNext').onclick = () => loadLevel(next);
  if ($('ovExtra')) $('ovExtra').onclick = () => loadLevel(extra);
  if ($('ovEdit')) $('ovEdit').onclick = enterEdit;
  updateHud(); renderList();
  if (S.padActive) { clearRays(); padMove(0, 0); renderCursor(); } // the pad lands on the card's main button
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

function onMute() {
  const muted = toggleMute();
  $('status').textContent = t(muted ? 'soundOff' : 'soundOn');
  $('status').className = '';
}

function undo() {
  if (S.busy || !S.hist.length || S.mode !== 'play') return;
  log('undo', { wasWon: S.won || undefined });
  S.hp = S.hist.pop(); S.won = false; S.hintCell = -1; S.tapeMode = false;
  forgetBlunder();
  $('overlay').hidden = true;
  renderBoard(); afterMove();
}
function restart() {
  if (S.busy || S.mode !== 'play') return;
  log('restart', { strikes: S.hist.length, wasWon: S.won || undefined });
  S.hp = S.board.initHp.slice(); S.hist = []; S.won = false; S.hintCell = -1; S.tapeMode = false;
  forgetBlunder();
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
  log('hint', lost ? { lost: true } : { cell: first.cell, tape: first.tape || undefined });
  if (lost) { $('status').textContent = t('hintLost'); $('status').className = 'bad'; return; }
  S.hints++;
  S.hintCell = first.cell;
  cellEl(first.cell)?.classList.add('hint');
  if (first.tape) { $('status').textContent = t(S.padActive ? 'hintTapePad' : 'hintTape'); $('status').className = ''; }
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
      if (st.tape) placeTape(st.cell); else await strikeAt(st.cell);
      await sleep(380);
    }
  } finally { S.replaying = false; }
}

// ---------- editor ----------
const BRUSHES = ['.', ...COLOR_CHARS.split(''), '#'];
function enterEdit() {
  S.mode = 'edit';
  if (!S.edit.rows) setEditRows(S.def ? toRows(S.board, S.board.initHp) : ['......', '......', '......', '......', '......', '......'], S.def, S.def ? toUnder(S.board, S.board.initHp) : null, S.def ? toMix(S.board, S.board.initHp) : null);
  showMode();
  renderBoard(); renderList(); renderPalette();
}
function setEditRows(rows, def, under = null, mix = null) {
  const w = Math.max(...rows.map(r => r.length));
  S.edit.rows = rows.map(r => r.padEnd(w, '.').split(''));
  S.edit.under = rows.map((_, y) => (under?.[y] ?? '').padEnd(w, '.').slice(0, w).split(''));
  S.edit.mix = rows.map((_, y) => (mix?.[y] ?? '').padEnd(w, '.').slice(0, w).split(''));
  S.edit.info = null;
  $('editW').value = w; $('editH').value = rows.length;
  if (def) { $('editName').value = def.name ?? ''; $('editNote').value = def.note ?? ''; $('editTape').value = def.tape ?? 0; }
  $('editStats').innerHTML = '';
}
function renderPalette() {
  $('palette').innerHTML = BRUSHES.map(ch => {
    const k = COLOR_CHARS.indexOf(ch);
    const u = S.edit.varnish && S.edit.underBrush ? COLOR_CHARS.indexOf(S.edit.underBrush) : k;
    const mk = !S.edit.varnish && S.edit.mixBrush && S.edit.mixBrush !== ch ? COLOR_CHARS.indexOf(S.edit.mixBrush) : -1;
    const inner = ch === '#' ? '<div class="oldtape"></div>' : k >= 0 ? tileHtml(k, S.edit.varnish, u, '', mk) : '';
    const lbl = ch === '.' ? 'erase' : ch === '#' ? 'tape' : PIGMENTS[k].slice(0, 5);
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
  // mixing only on single-layer tiles
  const m = !S.edit.varnish && isPaint && S.edit.mixBrush && S.edit.mixBrush !== S.edit.brush ? S.edit.mixBrush : '.';
  if (S.edit.rows[y][x] === ch && S.edit.under[y][x] === u && S.edit.mix[y][x] === m) return;
  S.edit.rows[y][x] = ch;
  S.edit.under[y][x] = u;
  S.edit.mix[y][x] = m;
  S.edit.info = null;
  renderBoard();
}
function editDef() {
  const def = {
    id: 'edit-test', name: $('editName').value.trim() || 'Untitled', note: $('editNote').value.trim(),
    rows: S.edit.rows.map(r => r.join('')),
  };
  if (S.edit.under.some(r => r.some(ch => ch !== '.'))) def.under = S.edit.under.map(r => r.join(''));
  if (S.edit.mix.some(r => r.some(ch => ch !== '.'))) def.mix = S.edit.mix.map(r => r.join(''));
  const tape = Math.max(0, Math.min(5, +$('editTape').value | 0));
  if (tape) def.tape = tape;
  return def;
}
function runEditAnalysis() {
  $('editStats').innerHTML = '<dt>Analyzing…</dt><dd></dd>';
  return new Promise(res => setTimeout(() => {
    const def = editDef();
    const b = parseLevel(def);
    const warn = [];
    const counts = new Array(6).fill(0);
    b.tileColor.forEach((k, t) => { counts[k]++; if (b.underColor[t] !== k) counts[b.underColor[t]]++; if (b.mixColor[t] >= 0) counts[b.mixColor[t]]++; });
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
  if (edit) { $('levelName').textContent = t('editorTitle'); $('levelNote').textContent = t('editorNote'); }
  else if (S.def) { $('levelName').textContent = lt(S.def, 'name'); $('levelNote').textContent = lt(S.def, 'note') || ''; }
  showChapter();
  renderTray();
}

function showChapter() {
  const ch = S.mode === 'play' ? chapterOf(S.def) : null;
  $('levelChapter').textContent = ch ? t('chapterLabel', { n: chapterNo(ch), name: lt(ch, 'name') }) : '';
  $('levelChapter').hidden = !ch;
}

function allLevels() { return [...S.levels, ...store.custom]; }

// ---- Gamepad (Steam Deck and other pads; see pad.js) ----
// A frame over one cell is the cursor. A strikes (or tapes, when tape is armed) the cell under it;
// on the result card the D-pad picks a button and A presses it. Mouse or touch hides the cursor.
const padKeys = () => document.querySelector('header .keys');
function setPadActive(on) {
  if (S.padActive === on) return;
  S.padActive = on;
  const k = padKeys();
  if (!S.keysI18n) S.keysI18n = k.dataset.i18n;
  k.dataset.i18n = on ? 'keysPad' : S.keysI18n;
  k.textContent = t(k.dataset.i18n);
  if (!on) { clearRays(); $('overlay').querySelectorAll('.pad-focus').forEach(b => b.classList.remove('pad-focus')); }
  renderCursor();
}
function renderCursor() {
  const el = $('padCursor');
  const show = S.padActive && S.mode === 'play' && S.board && S.cursor >= 0 && $('overlay').hidden;
  el.hidden = !show;
  if (!show) return;
  const s = S.size, w = S.board.w;
  el.style.width = el.style.height = s + 'px';
  el.style.transform = `translate(${(S.cursor % w) * s}px, ${Math.floor(S.cursor / w) * s}px)`;
  el.classList.toggle('taping', !!S.tapeMode);
}
function padHover() { // the lines of sight from the cursor, as a mouse hover would show them
  if (S.busy || S.won || !$('hoverRays').checked) return clearRays();
  const r = probe(S.board, S.hp, S.cursor);
  if (r) drawRays(S.cursor, r.rays, r.hits, 'hover'); else clearRays();
}
const overlayButtons = () => [...$('overlay').querySelectorAll('button')];
function padMove(dx, dy) {
  const wasActive = S.padActive;
  setPadActive(true);
  if (S.mode !== 'play' || !S.board) return;
  if (!$('overlay').hidden) { // result card: move between its buttons
    const bs = overlayButtons(); if (!bs.length) return;
    let i = bs.findIndex(b => b.classList.contains('pad-focus'));
    if (i < 0) i = Math.max(0, bs.findIndex(b => b.classList.contains('primary')));
    else if (wasActive) i = (i + (dx || dy) + bs.length) % bs.length;
    bs.forEach((b, j) => b.classList.toggle('pad-focus', j === i));
    return;
  }
  if (wasActive) { // the first touch of the pad only shows the cursor where it was
    const w = S.board.w, h = S.board.h;
    const x = Math.min(w - 1, Math.max(0, S.cursor % w + dx)), y = Math.min(h - 1, Math.max(0, Math.floor(S.cursor / w) + dy));
    S.cursor = y * w + x;
  }
  renderCursor(); padHover();
}
function stepLevel(dir) { // LB / RB: the previous or next painting that is open, in list order
  const order = [...S.chapters.flatMap(ch => S.levels.filter(d => d.chapter === ch.id)), ...S.levels.filter(d => !chapterOf(d)), ...store.custom];
  let i = order.indexOf(S.def);
  for (let n = 0; n < order.length; n++) {
    i = (i + dir + order.length) % order.length;
    if (!isLocked(order[i])) return loadLevel(order[i]);
  }
}
function padPress(name) {
  setPadActive(true);
  // a pad press does not count as a gesture for browser audio; once the page has had one, it can
  if (navigator.userActivation?.hasBeenActive && !isMuted()) unlock();
  if (!S.padTold && navigator.userActivation && !navigator.userActivation.hasBeenActive) {
    S.padTold = true; $('status').textContent = t('padTapForSound'); $('status').className = '';
  }
  const welcomeForm = document.querySelector('#welcome form');
  if (welcomeForm) { if (name === 'a') welcomeForm.requestSubmit(); return; }
  if (S.mode !== 'play' || !S.board) return;
  if (!$('overlay').hidden) {
    const bs = overlayButtons();
    const b = bs.find(x => x.classList.contains('pad-focus')) ?? bs.find(x => x.classList.contains('primary')) ?? bs[0];
    if (name === 'a') b?.click();
    else if (name === 'b') undo();
    else if (name === 'view') restart();
    else if (name === 'lb' || name === 'rb') stepLevel(name === 'rb' ? 1 : -1);
    else if (name === 'menu') onMute();
    return;
  }
  if (name === 'a') { clearRays(); strikeAt(S.cursor); }
  else if (name === 'b') { if (S.tapeMode) toggleTape(); else undo(); }
  else if (name === 'x') toggleTape();
  else if (name === 'y') { hint(); if (S.hintCell >= 0) S.cursor = S.hintCell; renderCursor(); }
  else if (name === 'view') restart();
  else if (name === 'menu') onMute();
  else if (name === 'lb' || name === 'rb') stepLevel(name === 'rb' ? 1 : -1);
}

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
  window.addEventListener('pointermove', e => { if (S.padActive && e.pointerType === 'mouse' && (e.movementX || e.movementY)) setPadActive(false); });
  window.addEventListener('pointerdown', () => { if (S.padActive) setPadActive(false); });
  startPad({ move: padMove, press: padPress, connect: p => log('pad', { id: p.id, mapping: p.mapping }) });
  window.addEventListener('mouseup', () => { S.edit.painting = false; });
  window.addEventListener('touchend', () => { S.edit.painting = false; });
  window.addEventListener('touchcancel', () => { S.edit.painting = false; });

  $('levelList').addEventListener('click', e => {
    const btn = e.target.closest('.lvl');
    if (!btn) return;
    const def = allLevels().find(d => d.id === btn.dataset.id);
    if (!def) return;
    if (S.mode === 'edit') { setEditRows(def.rows, def, def.under, def.mix); renderBoard(); }
    else if (!isLocked(def)) loadLevel(def);
  });

  $('undo').onclick = undo;
  $('tapeTray').addEventListener('pointerdown', trayDown);
  $('editTape').onchange = () => { S.edit.info = null; };
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
  $('mixBrush').onchange = e => { S.edit.mixBrush = e.target.value; renderPalette(); };
  $('resize').onclick = () => {
    const w = Math.max(2, Math.min(12, +$('editW').value)), h = Math.max(2, Math.min(12, +$('editH').value));
    const old = S.edit.rows;
    const oldU = S.edit.under, oldM = S.edit.mix;
    S.edit.rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => old[y]?.[x] ?? '.'));
    S.edit.under = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => oldU[y]?.[x] ?? '.'));
    S.edit.mix = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => oldM[y]?.[x] ?? '.'));
    S.edit.info = null; renderBoard();
  };
  $('clearEdit').onclick = () => { S.edit.rows = S.edit.rows.map(r => r.map(() => '.')); S.edit.under = S.edit.under.map(r => r.map(() => '.')); S.edit.mix = S.edit.mix.map(r => r.map(() => '.')); S.edit.info = null; renderBoard(); };
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
    if (def.mix) out.mix = def.mix;
    if (def.tape) out.tape = def.tape;
    if (a && a !== 'big' && a.solvable) out.par = a.minStrikes;
    $('json').value = JSON.stringify(out, null, 2);
  };
  $('importJson').onclick = () => {
    try {
      let d = JSON.parse($('json').value);
      if (d.levels) d = d.levels[0];
      parseLevel(d);
      setEditRows(d.rows, d, d.under, d.mix); renderBoard();
    } catch (err) { $('editStats').innerHTML = `<dt style="grid-column:1/-1;color:var(--bad)">${escapeHtml(err.message)}</dt>`; }
  };

  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'z') undo();
    else if (k === 'r') restart();
    else if (k === 'h') hint();
    else if (k === 't') toggleTape();
    else if (k === 'm') onMute();
    else if (k === 'd' && IS_LOCAL) { $('devToggle').checked = !S.dev; $('devToggle').onchange({ target: $('devToggle') }); }
  });
  // browsers only start audio after a gesture: the music is fetched at page open and starts on the
  // first touch, click or key press
  preload();
  const firstGesture = () => { if (!isMuted()) unlock(); };
  window.addEventListener('pointerdown', firstGesture, { once: true });
  window.addEventListener('keydown', firstGesture, { once: true });
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
  S.chapters = data.chapters ?? [];
  let last = null;
  try { last = localStorage.getItem(STORE_KEY + '.last'); } catch { }
  const lastDef = allLevels().find(d => d.id === last);
  loadLevel(lastDef && !isLocked(lastDef) ? lastDef : S.levels[0]);
}
main();

// Minimal static server for the prototype (ES modules need http://, not file://).
//   node tools/serve.mjs [port]   ->  http://localhost:5173/prototype/
import { createServer } from 'node:http';
import { readFile, appendFile, mkdir, readdir, writeFile, unlink } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const { SOUNDS, CANDIDATES } = await import('./sfx.mjs');

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/api/playlog' && req.method === 'POST') return playlog(req, res);
  if (path === '/api/sfx' && req.method === 'GET') return sfxList(res);
  if (path === '/api/sfx-pick' && req.method === 'POST') return sfxPick(req, res);
  if (path === '/') { res.writeHead(302, { Location: '/prototype/' + new URL(req.url, 'http://x').search }); return res.end(); }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(port, () => console.log(`Cross Tiles prototype: http://localhost:${port}/prototype/`));

// Playtest log: the prototype POSTs batches of events; each session gets its own JSONL file.
//   playtests/<session>.jsonl  ->  analyse with: node tools/playtest.mjs
const logDir = join(root, 'playtests');
async function playlog(req, res) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 1e6) { res.writeHead(413); return res.end(); } }
  try {
    const { session, events } = JSON.parse(body);
    if (!/^[\w-]{1,64}$/.test(session) || !Array.isArray(events)) throw new Error('bad payload');
    await mkdir(logDir, { recursive: true });
    await appendFile(join(logDir, session + '.jsonl'), events.map(e => JSON.stringify(e) + '\n').join(''));
    res.writeHead(204); res.end();
  } catch (e) {
    res.writeHead(400); res.end(String(e.message));
  }
}

// Sound effects (tools/sfx.mjs, tools/sfx-pick.html): the candidates made so far, and the picks saved
// as godot/audio/sfx/<name>_<k>.wav (k = 1..MAX_PICKS; the game plays one of them at random).
const PICKED = join(root, 'godot', 'audio', 'sfx');
const MAX_PICKS = 3;
async function sfxList(res) {
  const sounds = {};
  const picked = await readdir(PICKED).catch(() => []);
  for (const [name, s] of Object.entries(SOUNDS)) {
    const files = await readdir(join(CANDIDATES, name)).catch(() => []);
    const candidates = [];
    for (const f of files.filter(f => f.endsWith('.mp3')).sort().reverse()) {
      const meta = JSON.parse(await readFile(join(CANDIDATES, name, f.replace(/\.mp3$/, '.json')), 'utf8').catch(() => '{}'));
      candidates.push({ url: `/audio-candidates/sfx/${name}/${f}`, file: f, text: meta.text ?? '' });
    }
    // which candidates the saved files came from, and the slider then (written by sfxPick)
    const from = JSON.parse(await readFile(join(CANDIDATES, name, 'picked.json'), 'utf8').catch(() => '{}'));
    sounds[name] = { ko: s.ko, text: s.text, candidates, pickedFrom: from.files ?? [], pickedGain: from.gainDb ?? 0,
      picked: picked.filter(f => f.startsWith(name + '_') && /^\d\.wav$/.test(f.slice(name.length + 1))).sort().map(f => `/godot/audio/sfx/${f}`) };
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ sounds, maxPicks: MAX_PICKS }));
}
async function sfxPick(req, res) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { chunks.push(c); size += c.length; if (size > 20e6) { res.writeHead(413); return res.end(); } }
  try {
    const { name, wavs, from = [], gainDb = 0 } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!SOUNDS[name] || !Array.isArray(wavs) || wavs.length > MAX_PICKS) throw new Error('bad payload');
    if (!Array.isArray(from) || from.length !== wavs.length || from.some(f => !/^[\w-]+\.mp3$/.test(f)) || !Number.isFinite(gainDb)) throw new Error('bad payload');
    const bytes = wavs.map(b64 => Buffer.from(b64, 'base64'));
    if (bytes.some(b => b.subarray(0, 4).toString() !== 'RIFF' || b.subarray(8, 12).toString() !== 'WAVE')) throw new Error('not a WAV');
    await mkdir(PICKED, { recursive: true });
    for (let k = 1; k <= MAX_PICKS; k++) {
      const f = join(PICKED, `${name}_${k}.wav`);
      if (k <= bytes.length) await writeFile(f, bytes[k - 1]);
      else { await unlink(f).catch(() => {}); await unlink(f + '.import').catch(() => {}); }
    }
    const record = join(CANDIDATES, name, 'picked.json');
    if (bytes.length) { await mkdir(join(CANDIDATES, name), { recursive: true }); await writeFile(record, JSON.stringify({ files: from, gainDb }, null, 2)); }
    else await unlink(record).catch(() => {});
    res.writeHead(204); res.end();
  } catch (e) {
    res.writeHead(400); res.end(String(e.message));
  }
}

// Minimal static server for the prototype (ES modules need http://, not file://).
//   node tools/serve.mjs [port]   ->  http://localhost:5173/prototype/
import { createServer } from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/api/playlog' && req.method === 'POST') return playlog(req, res);
  if (path === '/') { res.writeHead(302, { Location: '/prototype/' }); return res.end(); }
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

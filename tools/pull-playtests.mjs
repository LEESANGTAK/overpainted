// Download tester sessions from the Google Sheet collector into playtests/<session>.jsonl,
// so tools/playtest.mjs and tools/predict.mjs --calibrate can use them.
//   node tools/pull-playtests.mjs
// Needs playtests/collector.json (not committed):  { "url": "https://script.google.com/…/exec", "key": "<READ_KEY>" }
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = join(root, 'playtests');
const cfgFile = join(dir, 'collector.json');
if (!existsSync(cfgFile)) {
  console.error('Missing playtests/collector.json  ->  { "url": "<web app …/exec URL>", "key": "<READ_KEY>" }  (see docs/playtest-setup.md)');
  process.exit(1);
}
const { url, key } = JSON.parse(readFileSync(cfgFile, 'utf8'));
const res = await fetch(`${url}?key=${encodeURIComponent(key)}`, { redirect: 'follow' });
const text = await res.text();
if (!res.ok || text.startsWith('forbidden') || text.trimStart().startsWith('<')) {
  console.error(`Collector refused (${res.status}): ${text.slice(0, 200)}`);
  process.exit(1);
}

const sessions = new Map();
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  const { session, event } = JSON.parse(line);
  if (!/^[\w-]{1,64}$/.test(session)) continue;
  if (!sessions.has(session)) sessions.set(session, new Map());
  sessions.get(session).set(`${event.t}|${event.type}|${JSON.stringify(event)}`, event); // dedupe beacon/fetch repeats
}
mkdirSync(dir, { recursive: true });
let events = 0;
const rows = [];
for (const [session, evs] of sessions) {
  const list = [...evs.values()].sort((a, b) => a.t - b.t);
  events += list.length;
  writeFileSync(join(dir, session + '.jsonl'), list.map(e => JSON.stringify(e)).join('\n') + '\n');
  const start = list.find(e => e.type === 'session_start');
  rows.push({ session, tester: start?.tester ?? '–', strikes: list.filter(e => e.type === 'strike').length, wins: list.filter(e => e.type === 'win').length, last: list.at(-1)?.lvl ?? '–' });
}
console.log(`Pulled ${sessions.size} session(s), ${events} events into playtests/\n`);
for (const r of rows) console.log(`  ${r.session.padEnd(26)} tester ${String(r.tester).padEnd(12)} strikes ${String(r.strikes).padStart(4)}  cleared ${String(r.wins).padStart(3)}  last ${r.last}`);
console.log('\nNext:  node tools/playtest.mjs');

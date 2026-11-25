// Godot tests: rules parity (the JS answers from tools/parity.mjs, checked by the port), every level
// without tools played to the end through the real play screen, the demo played with the gamepad only
// and with touch only, the game's frame (list, saves, settings, demo build) and the room's mood and hints.
//   node tools/test-godot.mjs [quick]     ("quick" skips the solver checks and the play-throughs)
// Godot: $GODOT if set, else the Steam install of Godot 4.7.2 on Windows.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const godot = process.env.GODOT ?? 'C:/Program Files (x86)/Steam/steamapps/common/Godot Engine/godot.windows.opt.tools.64.exe';
if (!existsSync(godot) && !process.env.GODOT) { console.error(`Godot not found at ${godot}; set GODOT to the Godot 4.7.2 executable.`); process.exit(2); }

const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit' }).status;
if (run(process.execPath, [join(root, 'tools/parity.mjs')]) !== 0) process.exit(1);
run(godot, ['--headless', '--path', 'godot', '--import']); // pick up new or moved scripts
const args = ['--headless', '--path', 'godot', '--script', 'res://tests/run_tests.gd'];
const quick = process.argv.includes('quick');
if (quick) args.push('--', 'quick');
if (run(godot, args) !== 0) process.exit(1);
if (quick) process.exit(0);
for (const test of ['play_test', 'input_test', 'frame_test', 'mood_test'])
  if (run(godot, ['--headless', '--path', 'godot', '--script', `res://tests/${test}.gd`]) !== 0) process.exit(1);

// Playtest logging: a dev server on a spare port receives the session, tools/playtest.mjs must read it.
// The test's own log file is deleted by its session id; the designer's report.json is put back.
const PORT = 5199;
const server = spawn(process.execPath, [join(root, 'tools/serve.mjs'), String(PORT)], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const report = join(root, 'playtests/report.json');
const kept = existsSync(report) ? readFileSync(report) : null;
let failed = false;
try {
  const out = spawnSync(godot, ['--headless', '--path', 'godot', '--script', 'res://tests/playlog_test.gd', '--', `url=http://localhost:${PORT}/api/playlog`], { cwd: root, encoding: 'utf8' });
  const lines = (text, re) => text.split('\n').filter(l => re.test(l)).join('\n');
  console.log(lines(out.stdout, /playlog:|SESSION|FAIL/));
  const errors = lines(out.stderr, /FAIL|ERROR/);
  if (errors) console.error(errors);
  const session = /SESSION (\S+)/.exec(out.stdout)?.[1];
  if (out.status !== 0 || !session) failed = true;
  else {
    const file = join(root, 'playtests', session + '.jsonl');
    const a = spawnSync(process.execPath, [join(root, 'tools/playtest.mjs'), file], { cwd: root, encoding: 'utf8' });
    const ok = a.status === 0 && /First Solvent/.test(a.stdout) && /Playtest sessions: 1/.test(a.stdout);
    console.log(ok ? 'playtest.mjs reads the Godot session' : 'FAIL playtest.mjs could not read the Godot session\n' + a.stdout + a.stderr);
    if (!ok) failed = true;
    rmSync(file, { force: true });
  }
} finally {
  server.kill();
  if (kept) writeFileSync(report, kept); else rmSync(report, { force: true });
}
process.exit(failed ? 1 : 0);

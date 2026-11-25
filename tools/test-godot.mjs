// Godot tests: rules parity (the JS answers from tools/parity.mjs, checked by the port), every level
// without tools played to the end through the real play screen, and the demo played with the gamepad
// only and with touch only.
//   node tools/test-godot.mjs [quick]     ("quick" skips the solver checks and the play-throughs)
// Godot: $GODOT if set, else the Steam install of Godot 4.7.2 on Windows.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
for (const test of ['play_test', 'input_test', 'frame_test'])
  if (run(godot, ['--headless', '--path', 'godot', '--script', `res://tests/${test}.gd`]) !== 0) process.exit(1);

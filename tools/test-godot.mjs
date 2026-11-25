// Rules parity: write the JS answers (tools/parity.mjs), then let the Godot port check them.
//   node tools/test-godot.mjs [quick]     ("quick" skips the solver checks)
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
if (process.argv.includes('quick')) args.push('--', 'quick');
process.exit(run(godot, args) ?? 1);

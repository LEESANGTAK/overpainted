// Hand the levels to the Godot game: levels/prototype.json -> godot/data/levels.json.
//   node tools/export-godot.mjs
//
// Levels are designed here (web editor + Node tools) and only played in Godot, so this keeps what the
// game needs and drops design data (difficulty metrics). Chapters keep their order; `demo` lists the
// chapters in the demo build (decided 2026-11-26: chapters 1-5). Run it after every level change and
// commit both files together (tools/test.mjs fails while they disagree).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseLevel } from '../core/rules.js';

const root = resolve(import.meta.dirname, '..');

export const DEMO_CHAPTERS = ['solvent', 'shield', 'coat', 'under', 'mix'];
export const GODOT_DATA = join(root, 'godot/data/levels.json');

// Fields the game reads. Anything else (metrics, design notes) stays in the prototype file.
const LEVEL_FIELDS = ['id', 'chapter', 'name', 'note', 'rows', 'under', 'mix', 'orig', 'tape', 'palette', 'par', 'extra', 'parent', 'ko'];
const CHAPTER_FIELDS = ['id', 'name', 'note', 'ko'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] != null).map(k => [k, o[k]]));

/** The Godot data for a prototype levels file (throws on a level the game cannot play). */
export function buildGodotData(src) {
  const ids = new Set(src.chapters.map(c => c.id));
  for (const id of DEMO_CHAPTERS) if (!ids.has(id)) throw new Error(`demo chapter ${id} is not in levels/prototype.json`);
  const levels = [];
  for (const def of src.levels) {
    if (def.retouch || def.split) throw new Error(`${def.id}: retouch and split are not in the game`);
    if (!def.chapter || !ids.has(def.chapter)) throw new Error(`${def.id}: no known chapter`);
    parseLevel(def); // throws on a malformed level
    levels.push(pick(def, LEVEL_FIELDS));
  }
  return {
    source: 'levels/prototype.json (tools/export-godot.mjs; do not edit by hand)',
    demo: DEMO_CHAPTERS,
    chapters: src.chapters.map(c => pick(c, CHAPTER_FIELDS)),
    levels,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = buildGodotData(JSON.parse(readFileSync(join(root, 'levels/prototype.json'), 'utf8')));
  mkdirSync(dirname(GODOT_DATA), { recursive: true });
  writeFileSync(GODOT_DATA, JSON.stringify(out, null, 2) + '\n');
  const demo = out.levels.filter(l => DEMO_CHAPTERS.includes(l.chapter));
  console.log(`godot/data/levels.json: ${out.chapters.length} chapters, ${out.levels.length} levels`
    + ` (demo: ${DEMO_CHAPTERS.length} chapters, ${demo.filter(l => !l.extra).length} main + ${demo.filter(l => l.extra).length} extra)`);
}

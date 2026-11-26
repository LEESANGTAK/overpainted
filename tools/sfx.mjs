// Generate sound-effect candidates with the ElevenLabs Sound Effects API (needs ELEVENLABS_API_KEY).
//   node tools/sfx.mjs                 every sound, 4 candidates each
//   node tools/sfx.mjs lift peel -n 6  only these, 6 each
//   node tools/sfx.mjs --dry           print what would be made and the credits, make nothing
// Candidates go to audio-candidates/sfx/<name>/ (not in git: they cost credits, keep the folder).
// Then listen and pick in http://localhost:5173/tools/sfx-pick.html (node tools/serve.mjs): the page
// trims and levels the chosen ones and saves them as godot/audio/sfx/<name>_<k>.wav, which the game
// plays instead of its synthesized placeholder (scripts/audio/sfx.gd).
// Cost (ElevenLabs docs, 2026-11-26): 40 credits per second when the duration is given.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const SOUNDS = {
  lift: {
    seconds: 0.8, ko: '물감을 벗겨 냄',
    text: 'Close-up foley: a palette knife scrapes a thick dab of wet oil paint off a canvas in one short stroke. Soft, wet, slightly sticky. Quiet studio, no music, no voice.',
  },
  peel: {
    seconds: 0.6, ko: '위 겹만 벗겨짐 (아래 겹이 남음)',
    text: 'Close-up foley: a thin skin of dried paint peels off a canvas in one short crisp lift, lighter and drier than wet paint, another layer still underneath. No music, no voice.',
  },
  lift_mix: {
    seconds: 0.8, ko: '혼색 타일을 벗겨 냄',
    text: 'Close-up foley: a palette knife lifts a dab where two wet oil paints are mixed together, a short smeary squelch. No music, no voice.',
  },
  tape_on: {
    seconds: 0.5, ko: '테이프 붙이기 (도구 이식 후)',
    text: 'Close-up foley: a strip of masking tape pressed flat onto a canvas, a short soft sticky press. No music, no voice.',
  },
  tape_off: {
    seconds: 1.0, ko: '테이프 떼기 (도구 이식 후)',
    text: 'Close-up foley: masking tape peeled off a canvas in one quick pull, a short papery rip. No music, no voice.',
  },
  palette: {
    seconds: 0.6, ko: '팔레트 물감 찍기 (도구 이식 후)',
    text: 'Close-up foley: a brush picks up a small dab of wet paint from a wooden palette and taps it onto a canvas, soft and short. No music, no voice.',
  },
  ruin: {
    seconds: 1.2, ko: '원본 물감을 벗겨 버림 (데모 밖)',
    text: 'Close-up foley: brittle old paint cracks and flakes off a painting by mistake, a dull dry crack, a little ominous. No music, no voice, no boom.',
  },
  restart: {
    seconds: 0.8, ko: '처음부터',
    text: 'Close-up foley: a soft cloth sweeps once across a canvas, a gentle short whoosh. No music, no voice.',
  },
};

const CREDITS_PER_SECOND = 40;
const root = join(import.meta.dirname, '..');
export const CANDIDATES = join(root, 'audio-candidates', 'sfx');

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const ni = args.indexOf('-n');
  const n = ni >= 0 ? Number(args[ni + 1]) : 4;
  const names = args.filter((a, i) => !a.startsWith('-') && !(ni >= 0 && i === ni + 1));
  for (const name of names) if (!SOUNDS[name]) { console.error(`unknown sound "${name}" (${Object.keys(SOUNDS).join(', ')})`); process.exit(2); }
  const todo = names.length ? names : Object.keys(SOUNDS);
  if (!(n >= 1 && n <= 10)) { console.error('-n must be 1..10'); process.exit(2); }

  const credits = todo.reduce((s, k) => s + SOUNDS[k].seconds * CREDITS_PER_SECOND * n, 0);
  console.log(`${todo.length} sounds x ${n} candidates, about ${Math.round(credits)} credits`);
  if (dry) { for (const k of todo) console.log(`  ${k} (${SOUNDS[k].seconds}s): ${SOUNDS[k].text}`); return; }

  const KEY = process.env.ELEVENLABS_API_KEY;
  if (!KEY) { console.error('ELEVENLABS_API_KEY is not set'); process.exit(1); }
  const api = process.env.ELEVENLABS_API_BASE ?? 'https://api.elevenlabs.io'; // (a local stand-in in tests)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

  // one at a time: concurrency depends on the plan
  for (const name of todo) {
    const dir = join(CANDIDATES, name);
    mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= n; i++) {
      const s = SOUNDS[name];
      const res = await fetch(`${api}/v1/sound-generation?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: s.text, duration_seconds: s.seconds, prompt_influence: 0.5, model_id: 'eleven_text_to_sound_v3' }),
      });
      if (!res.ok) { console.error(`${name} #${i}: HTTP ${res.status} ${await res.text()}`); process.exitCode = 1; continue; }
      const file = `${stamp}-${i}`;
      writeFileSync(join(dir, file + '.mp3'), Buffer.from(await res.arrayBuffer()));
      writeFileSync(join(dir, file + '.json'), JSON.stringify({ text: s.text, seconds: s.seconds, model: 'eleven_text_to_sound_v3', made: new Date().toISOString() }, null, 2));
      console.log(`${name} #${i}: ${file}.mp3`);
    }
  }
  console.log('Pick them in http://localhost:5173/tools/sfx-pick.html (node tools/serve.mjs)');
}

if (import.meta.main ?? process.argv[1]?.endsWith('sfx.mjs')) await main();

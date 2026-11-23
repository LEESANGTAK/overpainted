// Generate the background music with the ElevenLabs Music API (needs ELEVENLABS_API_KEY, a paid plan).
//   node tools/music.mjs [calm|lost ...]      writes prototype/audio/<name>.mp3
// Two pieces with the same tempo and tonal centre: the game crossfades from `calm` to `lost`
// some time after the player has made the level unwinnable (see prototype/mood.js).
import { writeFileSync, mkdirSync } from 'node:fs';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY is not set'); process.exit(1); }

const COMMON = 'Instrumental background music for a quiet, mysterious puzzle game: a lone art restorer works at night in a dim studio, ' +
  'lifting paint that someone laid over old portraits. Around 60 BPM, tonal centre D. No vocals, no drums, no percussion. ' +
  'One steady texture from start to end, no intro build, no ending or fade, so it can loop seamlessly under gameplay. Restrained and intimate, mixed quietly.';

const PIECES = {
  calm: COMMON + ' Mood: calm, curious, absorbed. Sparse felt piano notes with long space between them in D major with a Lydian colour, ' +
    'soft sustained strings far in the background, faint warm room tone and the hush of an old building. Gentle, unresolved, never sentimental.',
  lost: COMMON + ' Mood: the same studio, but something has gone quietly wrong. Same slow tempo and the same D centre, now in D minor: ' +
    'a low cello drone, sparse piano notes that sink and hang, slightly detuned high harmonics, a faint uneasy pulse like a slow heartbeat felt rather than heard. ' +
    'Dark and cold but restrained; unsettling, not horror, no stingers or sudden hits.',
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PIECES);
mkdirSync(new URL('../prototype/audio/', import.meta.url), { recursive: true });
await Promise.all(names.map(async name => {
  const t0 = Date.now();
  const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: PIECES[name], music_length_ms: 120_000, model_id: 'music_v2_5', force_instrumental: true }),
  });
  if (!res.ok) { console.error(`${name}: HTTP ${res.status} ${await res.text()}`); process.exitCode = 1; return; }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(new URL(`../prototype/audio/${name}.mp3`, import.meta.url), buf);
  console.log(`${name}: ${(buf.length / 1e6).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}));

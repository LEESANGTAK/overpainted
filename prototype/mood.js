// The room's mood: background music, and how it turns once a level has quietly gone wrong.
//
// Two pieces with the same tempo and tonal centre (tools/music.mjs): `calm` and `lost`. Both play
// all the time, looped with a crossfade at the seam; setLost() moves the balance between them slowly
// (and closes a low-pass filter a little), so the change is felt rather than announced.
// Browsers start audio only after a gesture: call unlock() from the first click or touch.

const FILES = { calm: 'audio/calm.mp3', lost: 'audio/lost.mp3' };
const VOLUME = 0.42;     // music under everything
// loudness match: measured RMS calm -25.6 dB, lost -19.5 dB (2026-11-23 files), so lost plays ~6 dB lower
const LEVEL = { calm: 1, lost: 0.5 };
const SEAM = 6;          // seconds of crossfade where a loop meets its own start
const TURN = 9;          // seconds (time constant ×3) for calm → lost
const RETURN = 6;        // and back

const A = { ctx: null, master: null, lowpass: null, gains: {}, buffers: {}, started: false, muted: false, lost: false };
try { A.muted = localStorage.getItem('overpainted.muted') === '1'; } catch { }

function audioCtx() {
  if (!A.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    A.ctx = new AC();
    A.master = A.ctx.createGain();
    A.master.gain.value = A.muted ? 0 : 1;
    A.master.connect(A.ctx.destination);
  }
  if (A.ctx.state === 'suspended') A.ctx.resume();
  return A.ctx;
}
export function isMuted() { return A.muted; }
export function toggleMute() {
  A.muted = !A.muted;
  try { localStorage.setItem('overpainted.muted', A.muted ? '1' : '0'); } catch { }
  if (A.ctx) A.master.gain.setTargetAtTime(A.muted ? 0 : 1, A.ctx.currentTime, 0.08);
  if (!A.muted) unlock();
  return A.muted;
}

/** First gesture: open audio and start the music (if the files are there). */
export async function unlock() {
  const ctx = audioCtx();
  if (!ctx || A.started) return;
  A.started = true;
  try {
    const entries = await Promise.all(Object.entries(FILES).map(async ([k, url]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return [k, await ctx.decodeAudioData(await res.arrayBuffer())];
    }));
    for (const [k, b] of entries) A.buffers[k] = b;
  } catch (e) { console.info('music not loaded:', e.message); return; }
  A.lowpass = ctx.createBiquadFilter();
  A.lowpass.type = 'lowpass'; A.lowpass.frequency.value = 18000;
  A.lowpass.connect(A.master);
  for (const k of Object.keys(FILES)) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(A.lowpass);
    A.gains[k] = g;
    loop(k, ctx.currentTime + 0.1);
  }
  // fade in to wherever the board stands now
  apply(4);
}

// Play buffer k from `at`, and schedule the next pass so the two overlap by SEAM seconds.
function loop(k, at) {
  const ctx = A.ctx, buf = A.buffers[k];
  const src = ctx.createBufferSource(), fade = ctx.createGain();
  src.buffer = buf;
  src.connect(fade).connect(A.gains[k]);
  const len = buf.duration, seam = Math.min(SEAM, len / 4);
  fade.gain.setValueAtTime(0, at);
  fade.gain.linearRampToValueAtTime(1, at + seam);
  fade.gain.setValueAtTime(1, at + len - seam);
  fade.gain.linearRampToValueAtTime(0, at + len);
  src.start(at);
  const next = at + len - seam;
  // schedule the next pass well ahead: a hidden tab may only run timers about once a minute
  setTimeout(() => loop(k, next), Math.max(0, (next - ctx.currentTime - 60) * 1000));
}

function apply(seconds) {
  if (!A.ctx || !A.gains.calm) return;
  const t = A.ctx.currentTime, tc = seconds / 3;
  A.gains.calm.gain.setTargetAtTime((A.lost ? 0.12 : 1) * VOLUME * LEVEL.calm, t, tc);
  A.gains.lost.gain.setTargetAtTime((A.lost ? 1 : 0) * VOLUME * LEVEL.lost, t, tc);
  A.lowpass.frequency.setTargetAtTime(A.lost ? 2600 : 18000, t, tc);
}

/** Turn the room (true) or let it come back (false). Slow on purpose. */
export function setLost(lost) {
  if (A.lost === lost) return;
  A.lost = lost;
  apply(lost ? TURN : RETURN);
}

// Synthesises a warm 120 BPM coffee-clubbing groove that matches the film's
// scene timing (src/timeline.ts). No samples, no licences: pure maths.
import { writeFileSync } from 'node:fs';

const SR = 44100, FPS = 30;
const SCENES = { intro: 0, problem: 150, order: 350, guest: 646, queue: 1009, board: 1188, story: 1588, cockpit: 1768, report: 2554, facts: 2728, outro: 2938 };
const TOTAL = 3148, CALL = SCENES.board + 128;
const N = Math.ceil((TOTAL / FPS + 1) * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const t2i = (t) => Math.floor(t * SR);
const fr = (f) => f / FPS;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const BEAT = 0.5; // 120 BPM

function add(i, l, r = l) { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } }

// Kick on every beat from the end of the intro title.
function kick(t, g = 0.55) { const s = t2i(t); for (let i = 0; i < SR * 0.35; i++) { const x = i / SR; const f = 45 + 90 * Math.exp(-x * 30); const v = Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 9) * g; add(s + i, v); } }
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
function hat(t, g = 0.05) { const s = t2i(t); let p = 0; for (let i = 0; i < SR * 0.06; i++) { const n = rnd(); const v = (n - p) * Math.exp(-i / (SR * 0.012)) * g; p = n; add(s + i, v * 0.8, v); } }
function pad(t, dur, notes, g = 0.05) {
  const s = t2i(t), n = t2i(dur); let lp = 0, lpR = 0;
  for (let i = 0; i < n; i++) {
    const x = i / SR, env = Math.min(1, x / 0.8) * Math.min(1, (dur - x) / 0.8);
    let vl = 0, vr = 0;
    for (const m of notes) { const f = hz(m); vl += Math.sin(2 * Math.PI * f * 0.998 * x) + 0.3 * Math.sin(4 * Math.PI * f * x); vr += Math.sin(2 * Math.PI * f * 1.002 * x) + 0.3 * Math.sin(4 * Math.PI * f * 1.001 * x); }
    lp += (vl - lp) * 0.08; lpR += (vr - lpR) * 0.08;
    add(s + i, lp * env * g, lpR * env * g);
  }
}
function bass(t, dur, m, g = 0.16) { const s = t2i(t), n = t2i(dur), f = hz(m); for (let i = 0; i < n; i++) { const x = i / SR; const env = Math.min(1, x / 0.02) * Math.exp(-x * 1.6); add(s + i, Math.sin(2 * Math.PI * f * x) * env * g); } }
function chime(t, notes, g = 0.12) { const s = t2i(t); notes.forEach((m, k) => { const f = hz(m), o = t2i(k * 0.09); for (let i = 0; i < SR * 1.2; i++) { const x = i / SR; const v = (Math.sin(2 * Math.PI * f * x) + 0.25 * Math.sin(6 * Math.PI * f * x)) * Math.exp(-x * 3.2) * g; add(s + o + i, v, v * 0.9); } }); }
function whoosh(t, len = 0.9, g = 0.07) { const s = t2i(t), n = t2i(len); let lp = 0; for (let i = 0; i < n; i++) { const x = i / n; const env = Math.sin(Math.PI * x) ** 2; lp += (rnd() - lp) * (0.02 + 0.2 * x); add(s + i, lp * env * g, lp * env * g * 0.8); } }
function riser(t0, t1, g = 0.08) { const s = t2i(t0), n = t2i(t1 - t0); let lp = 0; for (let i = 0; i < n; i++) { const x = i / n; lp += (rnd() - lp) * (0.01 + 0.3 * x * x); add(s + i, lp * x * x * g); } }

// Chords: Am9 - Fmaj7 - Cmaj7 - G6, two bars each (4 s).
const CH = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 67], [48, 55, 59, 64, 67], [55, 59, 62, 64, 69]];
const BASS = [45, 41, 48, 43];
const end = TOTAL / FPS;
for (let t = 0, k = 0; t < end; t += 4, k++) { pad(t, 4.3, CH[k % 4], 0.032); if (t >= fr(30)) bass(t, 4, BASS[k % 4]); if (t >= fr(30)) bass(t + 2, 2, BASS[k % 4]); }
const grooveStart = fr(SCENES.problem);
for (let t = grooveStart; t < end - 3; t += BEAT) {
  const ducking = Math.abs(t - fr(CALL) - 1) < 1.6 ? 0.35 : 1;
  kick(t, 0.5 * ducking);
  hat(t + BEAT / 2, 0.045 * ducking);
  if (Math.round((t - grooveStart) / BEAT) % 4 === 2) hat(t, 0.03 * ducking);
}
riser(0.2, fr(30)); chime(fr(30), [69, 76, 81], 0.1);
for (const [k, f] of Object.entries(SCENES)) if (f > 0) whoosh(fr(f) - 0.45);
chime(fr(SCENES.order + 250), [76, 81], 0.08);          // Paid -> QR
chime(fr(SCENES.guest + 215), [69, 76, 81, 88], 0.11);  // guest ready
chime(fr(CALL) - 0.7, [76, 83, 88, 93], 0.1);           // board takeover
chime(fr(SCENES.board + 300), [72, 79, 84, 91], 0.1);    // milestone
chime(fr(SCENES.cockpit + 600), [74, 81, 86], 0.09);     // wifi back
chime(fr(SCENES.outro + 4), [57, 64, 69, 76], 0.12);

// Master: soft clip + fade in/out, 16-bit stereo WAV.
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const x = i / SR, fade = Math.min(1, x / 1.2) * Math.min(1, Math.max(0, (end - x) / 3));
  const l = Math.tanh(L[i] * 1.1) * fade * 0.9, r = Math.tanh(R[i] * 1.1) * fade * 0.9;
  buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
}
writeFileSync(new URL('./public/soundtrack.wav', import.meta.url), buf);
console.log('soundtrack', (N / SR).toFixed(1) + 's');

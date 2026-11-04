#!/usr/bin/env node
/**
 * Synthesises LifePilot's three ORIGINAL notification sounds as 16-bit mono WAV files.
 * No samples, no third-party audio: every waveform below is generated from scratch,
 * so the output is free to ship. Re-run to regenerate:  pnpm sounds
 *
 * Output: apps/web/public/sounds/*.wav (also usable as Android/iOS bundled notification sounds;
 * iOS requires ≤30 s, Android channels accept wav/ogg).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44100;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "apps/web/public/sounds");

/** A soft bell-like tone: fundamental + inharmonic partials, exponential decay, short attack. */
function bell(freq, start, dur, gain = 0.5, partials = [[1, 1], [2.01, 0.35], [3.98, 0.12]]) {
  return { freq, start, dur, gain, partials };
}

function render(notes, totalSec) {
  const n = Math.ceil(totalSec * RATE);
  const buf = new Float32Array(n);
  for (const note of notes) {
    const s0 = Math.floor(note.start * RATE);
    const len = Math.floor(note.dur * RATE);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const t = i / RATE;
      const attack = Math.min(1, t / 0.008);
      const decay = Math.exp(-t * (4.2 / note.dur));
      let v = 0;
      for (const [mult, amp] of note.partials) v += amp * Math.sin(2 * Math.PI * note.freq * mult * t);
      buf[s0 + i] += v * attack * decay * note.gain;
    }
  }
  // Normalise to -3 dBFS and apply a 20 ms fade-out to avoid clicks.
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? 0.707 / peak : 1;
  const fade = Math.floor(0.02 * RATE);
  for (let i = 0; i < n; i++) {
    const f = i > n - fade ? (n - i) / fade : 1;
    buf[i] *= k * f;
  }
  return buf;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Daily Chime — calm rising major sixth (G5 → E6), gentle and recognisable.
const daily = render([bell(783.99, 0, 1.1, 0.5), bell(1318.51, 0.16, 1.2, 0.42)], 1.4);

// Priority Alert — three quick ascending notes (C6 E6 G6), brighter, repeated once.
const priority = render(
  [0, 0.42].flatMap((o) => [bell(1046.5, o, 0.32, 0.5), bell(1318.51, o + 0.09, 0.32, 0.5), bell(1567.98, o + 0.18, 0.45, 0.55)]),
  1.1,
);

// Deadline Alert — distinctive descending-then-resolving motif (A5 E5 A5 C#6), firm but not harsh.
const deadline = render(
  [bell(880, 0, 0.35, 0.55), bell(659.25, 0.18, 0.35, 0.5), bell(880, 0.36, 0.35, 0.55), bell(1108.73, 0.54, 0.8, 0.6)],
  1.5,
);

mkdirSync(outDir, { recursive: true });
for (const [name, s] of [
  ["daily_chime", daily],
  ["priority_alert", priority],
  ["deadline_alert", deadline],
]) {
  const file = path.join(outDir, `${name}.wav`);
  writeFileSync(file, wav(s));
  console.log(`wrote ${path.relative(root, file)} (${(s.length / RATE).toFixed(2)}s)`);
}

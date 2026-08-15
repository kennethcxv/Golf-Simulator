// PHASE 1 (Goal 26) — FIND THE EVENTS INSIDE A COMPILATION RECORDING.
//
// Several of the best CC0 recordings are compilations: "cash register old antique
// open close drawer with bell ring various" is two and a half minutes containing
// perhaps thirty separate actions. One file is therefore several cue variants,
// which is exactly what stops a cue sounding machine-stamped -- but only if the
// slices land on the ACTIONS rather than on a guessed grid.
//
// So the boundaries are measured, not guessed: ffmpeg's silencedetect gives the
// gaps, the gaps give the events, and each event is reported with its own peak so
// a weak one can be rejected before it is ever cut.
//
//   node tools/audio/slice-events.mjs <file> [--noise -40dB] [--gap 0.18] [--min 0.05]
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { findFfmpeg } from './ffmpeg-path.mjs';

const ffmpeg = findFfmpeg();

/** Non-silent spans, as [{start, end, dur}]. */
export function detectEvents(file, { noise = '-40dB', gap = 0.18, min = 0.05 } = {}) {
  const run = spawnSync(ffmpeg, [
    '-hide_banner', '-i', file, '-af', `silencedetect=noise=${noise}:d=${gap}`, '-f', 'null', '-',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const log = `${run.stdout || ''}${run.stderr || ''}`;
  const duration = (() => {
    const m = log.match(/Duration: (\d+):(\d+):([\d.]+)/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  })();
  // silencedetect reports the SILENCES; the events are the complement.
  const silences = [];
  const starts = [...log.matchAll(/silence_start: ([-\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([-\d.]+)/g)].map((m) => Number(m[1]));
  for (let i = 0; i < starts.length; i += 1) {
    silences.push({ start: starts[i], end: i < ends.length ? ends[i] : duration });
  }
  const events = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start - cursor >= min) events.push({ start: cursor, end: s.start });
    cursor = s.end;
  }
  if (duration - cursor >= min) events.push({ start: cursor, end: duration });
  return events.map((e, i) => ({
    index: i, start: +e.start.toFixed(3), end: +e.end.toFixed(3), dur: +(e.end - e.start).toFixed(3),
  }));
}

/** Peak dBFS of one span, so a slice can be rejected for being too quiet to use. */
export function peakOf(file, start, dur) {
  const run = spawnSync(ffmpeg, [
    '-hide_banner', '-ss', String(start), '-t', String(dur), '-i', file,
    '-af', 'volumedetect', '-f', 'null', '-',
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const log = `${run.stdout || ''}${run.stderr || ''}`;
  const m = log.match(/max_volume: ([-\d.]+) dB/);
  return m ? Number(m[1]) : null;
}

function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) { console.error('usage: slice-events.mjs <file> [--noise -40dB] [--gap 0.18] [--min 0.05]'); process.exit(2); }
  const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const events = detectEvents(file, {
    noise: arg('noise', '-40dB'), gap: Number(arg('gap', 0.18)), min: Number(arg('min', 0.05)),
  });
  console.log(`${path.basename(file)} — ${events.length} events`);
  for (const e of events) {
    const peak = peakOf(file, e.start, e.dur);
    console.log(`  [${String(e.index).padStart(2)}] ${String(e.start).padStart(8)}s +${String(e.dur).padStart(6)}s  peak ${peak === null ? '?' : peak.toFixed(1)} dB`);
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) main();

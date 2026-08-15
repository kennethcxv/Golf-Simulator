// PHASE 1 (Goal 26) — WHAT KIND OF SOUND IS THIS SLICE?
//
// The best drawer recordings are compilations, and a compilation gives up its
// events but not their NAMES. Which of the fourteen spans in "Metal Till Cash
// Drawer Slide In And Out" is the slide, which is the stop at the end of travel,
// and which is the bell? Guessing is how a till ends up ringing when it should
// thud, and this project's ledger is full of things that were assigned by
// assumption and shipped wrong.
//
// So each slice is MEASURED and described by acoustic character:
//
//   centroid   where the energy sits. A bell is bright, a wooden thud is dark.
//   attack     time to peak. A transient (coin, stop, latch) spikes; a slide swells.
//   sustain    fraction of the span above a quarter of peak. A slide sustains,
//              an impact does not.
//   bands      low/mid/high split, which separates a body thump from a rattle.
//
// Those four separate every cue this phase needs, and they are read off the
// samples rather than inferred from the filename.
//
//   node tools/audio/describe-slice.mjs <file> [--start 0] [--dur 1.0]
//   node tools/audio/describe-slice.mjs <file> --events [--noise -30dB] [--gap 0.3]
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { findFfmpeg } from './ffmpeg-path.mjs';
import { detectEvents } from './slice-events.mjs';

const ffmpeg = findFfmpeg();
const RATE = 22050;

/** Decode a span to mono float PCM. */
export function pcmOf(file, start = 0, dur = null) {
  const args = ['-hide_banner', '-v', 'error'];
  if (start) args.push('-ss', String(start));
  if (dur) args.push('-t', String(dur));
  args.push('-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-');
  const run = spawnSync(ffmpeg, args, { maxBuffer: 256 * 1024 * 1024 });
  const buf = run.stdout;
  if (!buf || !buf.length) return new Float32Array(0);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

/** Goertzel-free band energy: one real DFT over a coarse bin set is enough to
 *  place the centroid, and it avoids pulling in an FFT dependency for a
 *  development-time描述 tool. */
function spectrum(samples) {
  // Downsample to a manageable window and take a 64-bin magnitude spectrum by
  // direct evaluation. 64 bins over 0..11 kHz is ~172 Hz resolution -- plenty to
  // tell a 3 kHz bell from a 120 Hz thud.
  const N = Math.min(samples.length, 8192);
  if (N < 64) return null;
  const bins = 64;
  const mags = new Float64Array(bins);
  for (let k = 1; k <= bins; k += 1) {
    let re = 0; let im = 0;
    const w = (2 * Math.PI * k * (bins / 2)) / N;
    for (let n = 0; n < N; n += 1) {
      const a = w * n;
      re += samples[n] * Math.cos(a);
      im -= samples[n] * Math.sin(a);
    }
    mags[k - 1] = Math.sqrt(re * re + im * im) / N;
  }
  return mags;
}

export function describe(file, start = 0, dur = null) {
  const s = pcmOf(file, start, dur);
  if (!s.length) return null;
  let peak = 0;
  let peakAt = 0;
  for (let i = 0; i < s.length; i += 1) {
    const v = Math.abs(s[i]);
    if (v > peak) { peak = v; peakAt = i; }
  }
  if (peak <= 0) return { silent: true };
  // sustain: how much of the span stays loud. A slide holds, an impact does not.
  const gate = peak * 0.25;
  let above = 0;
  for (let i = 0; i < s.length; i += 1) if (Math.abs(s[i]) >= gate) above += 1;
  // decay: samples from the peak until it falls under a tenth and stays there
  let decayEnd = peakAt;
  for (let i = peakAt; i < s.length; i += 1) if (Math.abs(s[i]) >= peak * 0.1) decayEnd = i;
  const mags = spectrum(s.subarray(Math.max(0, peakAt - 256)));
  let centroid = null;
  let low = 0;
  let mid = 0;
  let high = 0;
  if (mags) {
    let num = 0;
    let den = 0;
    for (let k = 0; k < mags.length; k += 1) {
      const hz = ((k + 1) * RATE) / (2 * mags.length);
      num += hz * mags[k];
      den += mags[k];
      if (hz < 400) low += mags[k];
      else if (hz < 2500) mid += mags[k];
      else high += mags[k];
    }
    centroid = den > 0 ? num / den : null;
    const total = low + mid + high || 1;
    low /= total; mid /= total; high /= total;
  }
  return {
    peakDb: +(20 * Math.log10(peak)).toFixed(1),
    attackMs: +((peakAt / RATE) * 1000).toFixed(0),
    decayMs: +(((decayEnd - peakAt) / RATE) * 1000).toFixed(0),
    sustainFrac: +(above / s.length).toFixed(3),
    centroidHz: centroid === null ? null : Math.round(centroid),
    low: +low.toFixed(2), mid: +mid.toFixed(2), high: +high.toFixed(2),
  };
}

/** A one-word guess, so a 27-row table can be skimmed. It is a HINT for choosing
 *  slices, never a claim in a report. */
export function label(d) {
  if (!d || d.silent) return 'silent';
  if (d.centroidHz > 2600 && d.decayMs > 250) return 'RING/bell';
  if (d.sustainFrac > 0.30 && d.attackMs > 40) return 'SLIDE/run';
  if (d.attackMs < 40 && d.decayMs < 200 && d.low > 0.35) return 'THUD/stop';
  if (d.attackMs < 60 && d.high > 0.40) return 'TICK/latch';
  if (d.sustainFrac > 0.20) return 'RUSTLE/run';
  return 'IMPACT';
}

function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) { console.error('usage: describe-slice.mjs <file> [--start s --dur s | --events]'); process.exit(2); }
  const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  if (argv.includes('--events')) {
    const events = detectEvents(file, {
      noise: arg('noise', '-30dB'), gap: Number(arg('gap', 0.3)), min: Number(arg('min', 0.12)),
    });
    console.log(`${path.basename(file)} — ${events.length} events`);
    console.log('  idx    start     dur   peak  atk   dec  sus  centroid  lo/mid/hi   guess');
    for (const e of events) {
      const d = describe(file, e.start, e.dur);
      if (!d || d.silent) { console.log(`  [${String(e.index).padStart(2)}] silent`); continue; }
      console.log(`  [${String(e.index).padStart(2)}] ${String(e.start).padStart(7)} ${String(e.dur).padStart(6)} ${String(d.peakDb).padStart(6)} ${String(d.attackMs).padStart(4)} ${String(d.decayMs).padStart(5)} ${String(d.sustainFrac).padStart(5)} ${String(d.centroidHz).padStart(8)}  ${d.low}/${d.mid}/${d.high}  ${label(d)}`);
    }
    return;
  }
  const d = describe(file, Number(arg('start', 0)), arg('dur') ? Number(arg('dur')) : null);
  console.log(JSON.stringify({ ...d, guess: label(d) }, null, 2));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) main();

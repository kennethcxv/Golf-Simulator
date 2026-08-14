// PHASE 1 (Goal 26) — CUT, CLEAN AND VENDOR THE RECORDINGS THE GAME PLAYS.
//
// Input: the raw CC0 downloads plus tools/audio/recipe.json, which says which span
// of which recording becomes which cue variant.
// Output: Assets/audio/*.ogg, Assets/audio/manifest.json and THIRD_PARTY_ASSETS.md.
//
// Every slice is trimmed to its own onset, peak-normalised to a stated target,
// given short fades so no cut can click, and encoded once. The MEASURED peak of
// the finished file is written into the manifest -- the brief asks for the peak of
// every cue, and a number that was measured off the shipped file cannot drift away
// from the file the way a hand-written one can.
//
// 1.8 asks for normalise / trim / fades / no clipping. All four happen here, and
// the report reads them back off the outputs rather than off this source.
//
//   node tools/audio/build-audio.mjs [--raw /tmp/aud/raw] [--kenney /tmp/aud/kenney]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findFfmpeg } from './ffmpeg-path.mjs';

const ffmpeg = findFfmpeg();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(REPO, 'Assets', 'audio');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const RAW = arg('raw', '/tmp/aud/raw');
const KENNEY = arg('kenney', '/tmp/aud/kenney');

function peakDbOf(file) {
  const run = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const log = `${run.stdout || ''}${run.stderr || ''}`;
  const m = log.match(/max_volume: ([-\d.]+) dB/);
  return m ? Number(m[1]) : null;
}

function durationOf(file) {
  const run = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const log = `${run.stdout || ''}${run.stderr || ''}`;
  const m = log.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/**
 * Cut one variant. `targetDb` is the peak the finished file is normalised to --
 * NOT a loudness match, because these are one-shots of wildly different length and
 * a coin normalised to the same LUFS as a page turn would be deafening.
 */
function cut(spec, source, outFile) {
  const filters = [];
  // Silence at the head of a slice is latency the player feels as a late cue, so
  // it goes -- but only from the FRONT, because a tail is the decay.
  if (spec.trimHead !== false) filters.push('silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.005');
  const fadeIn = spec.fadeIn ?? 0.004;
  filters.push(`afade=t=in:st=0:d=${fadeIn}`);
  if (spec.lowcut) filters.push(`highpass=f=${spec.lowcut}`);
  if (spec.highcut) filters.push(`lowpass=f=${spec.highcut}`);
  const chain = filters.filter(Boolean);

  const args = ['-hide_banner', '-v', 'error', '-y'];
  if (spec.start) args.push('-ss', String(spec.start));
  if (spec.dur) args.push('-t', String(spec.dur));
  args.push('-i', source);
  const af = [...chain];
  // fade-out has to be placed against the FINAL length, so it is applied in a
  // second pass below once the trimmed length is known.
  args.push('-af', af.join(','), '-ac', String(spec.channels || 1), '-ar', '44100',
    '-c:a', 'libvorbis', '-q:a', String(spec.quality ?? 5), `${outFile}.tmp.ogg`);
  const first = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  if (first.status !== 0) return { ok: false, why: (first.stderr || '').slice(0, 300) };

  const tmp = `${outFile}.tmp.ogg`;
  const len = durationOf(tmp) || 0;
  const measured = peakDbOf(tmp);
  const target = spec.targetDb ?? -1.0;
  const gain = measured === null ? 0 : target - measured;
  const fadeOut = Math.min(spec.fadeOut ?? 0.012, Math.max(0.002, len * 0.2));
  const second = spawnSync(ffmpeg, [
    '-hide_banner', '-v', 'error', '-y', '-i', tmp,
    '-af', `volume=${gain.toFixed(2)}dB,afade=t=out:st=${Math.max(0, len - fadeOut).toFixed(4)}:d=${fadeOut.toFixed(4)}`,
    '-ac', String(spec.channels || 1), '-ar', '44100', '-c:a', 'libvorbis', '-q:a', String(spec.quality ?? 5),
    outFile,
  ], { encoding: 'utf8' });
  fs.rmSync(tmp, { force: true });
  if (second.status !== 0) return { ok: false, why: (second.stderr || '').slice(0, 300) };
  return {
    ok: true,
    seconds: +(durationOf(outFile) || 0).toFixed(3),
    peakDb: peakDbOf(outFile),
    bytes: fs.statSync(outFile).size,
  };
}

function main() {
  const recipe = JSON.parse(fs.readFileSync(path.join(HERE, 'recipe.json'), 'utf8'));
  const provenancePath = path.join(RAW, 'provenance.json');
  const provenance = fs.existsSync(provenancePath)
    ? JSON.parse(fs.readFileSync(provenancePath, 'utf8')).results : [];
  const byBasename = new Map(provenance.map((p) => [p.basename, p]));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const samples = [];
  const failures = [];

  for (const spec of recipe.variants) {
    const isKenney = spec.source.startsWith('kenney:');
    const source = isKenney
      ? path.join(KENNEY, 'interface', 'Audio', `${spec.source.slice(7)}.ogg`)
      : path.join(RAW, `${spec.source}.mp3`);
    if (!fs.existsSync(source)) {
      failures.push({ file: spec.file, why: `source missing: ${source}` });
      continue;
    }
    const outFile = path.join(OUT_DIR, spec.file);
    const result = cut(spec, source, outFile);
    if (!result.ok) { failures.push({ file: spec.file, why: result.why }); continue; }

    const prov = byBasename.get(spec.source);
    const entry = {
      cue: spec.cue,
      file: `Assets/audio/${spec.file}`,
      seconds: result.seconds,
      peakDb: result.peakDb,
      bytes: result.bytes,
      licence: isKenney ? 'CC0-1.0' : (prov?.licence || 'UNKNOWN'),
      source: isKenney
        ? 'https://kenney.nl/assets/interface-sounds'
        : (prov?.pageUrl || 'UNKNOWN'),
      title: isKenney ? `${spec.source.slice(7)}.ogg (Interface Sounds)` : (prov?.title || 'UNKNOWN'),
      creator: isKenney ? 'Kenney (kenney.nl)' : (prov?.author || 'UNKNOWN'),
      attribution: isKenney ? null : (prov?.needsAttribution ? `${prov.title} by ${prov.author}` : null),
      obtained: (prov?.fetchedAt || new Date().toISOString()).slice(0, 10),
      conversions: [
        isKenney ? 'source OGG' : 'freesound HQ preview transcode',
        spec.start ? `sliced ${spec.start}s +${spec.dur}s` : 'whole file',
        'leading silence trimmed',
        `peak-normalised to ${spec.targetDb ?? -1.0} dBFS`,
        'short in/out fades',
        'encoded Vorbis q' + (spec.quality ?? 5) + ' mono 44.1 kHz',
      ].filter(Boolean),
    };
    if (entry.licence === 'UNKNOWN' || entry.source === 'UNKNOWN') {
      // A file whose provenance did not survive the pipeline must not ship. It is
      // deleted here rather than left on disk to be picked up by a later glob.
      fs.rmSync(outFile, { force: true });
      failures.push({ file: spec.file, why: 'provenance incomplete — refused' });
      continue;
    }
    samples.push(entry);
    console.log(`${spec.file.padEnd(30)} ${String(entry.seconds).padStart(6)}s ${String(entry.peakDb).padStart(6)}dB ${String((entry.bytes / 1024).toFixed(0)).padStart(5)}kB  ${spec.cue}`);
  }

  const manifest = {
    _comment: recipe.manifestComment,
    allowedLicences: ['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0'],
    generatedBy: 'tools/audio/build-audio.mjs',
    samples,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n${samples.length} files -> Assets/audio/manifest.json`);
  if (failures.length) {
    console.log(`\n${failures.length} FAILED:`);
    for (const f of failures) console.log(`  ${f.file}: ${f.why}`);
    process.exitCode = 1;
  }
}

main();

// PERF, MEASURED PROPERLY: N RUNS, COMPARE MEDIANS, NEVER ONE AGAINST ONE.
//
// This exists because of a mistake made on 2026-08-08 that is worth preventing
// permanently. The sixty-second walk's first-equip worst frame was measured at
// 8282 ms with one configuration and 2770 ms with another, and that single
// comparison was written into a commit message as a "measured" 5.5-second
// regression.
//
// It was not measured. At a FIXED configuration the same number came back as
// 1129, 2770 and 4947 ms across three runs — a 4.4x spread. The run-to-run
// variance is the same size as the effect that was claimed, so one sample
// against one sample could not support any conclusion at all.
//
// The rule this encodes: a perf claim needs a DISTRIBUTION. Worst-frame numbers
// on a real renderer are heavy-tailed — a single sample is dominated by whatever
// else the machine was doing — so the median across runs is the honest statistic
// and the spread must be reported beside it.
//
// WITHIN-RUN pairs are exempt and are the strongest evidence available here: the
// first-vs-second equip ratio (1129 vs 22, then 4947 vs 36) held across every
// run precisely because both halves shared one run's conditions. Prefer a paired
// measurement whenever the question allows one.
//
//   node tools/qa/perf-repeat.mjs [runs]        (default 5)
//
// Prints per-run values, the median, and min..max for every beat, so a change
// can be judged against the spread instead of against a single lucky sample.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const RUNS = Math.max(2, Number(process.argv[2] || 5));
const ARTIFACT = 'qa/electron/phase5-walk/phase5-walk.json';
const DRIVER = 'tools/qa/electron-sixty-second-walk.js';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const perBeat = new Map();
const overall = [];

for (let i = 0; i < RUNS; i += 1) {
  const dir = `${process.env.TEMP || '/tmp'}/perf-repeat-${i}`;
  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(`run ${i + 1}/${RUNS} ... `);
  try {
    execFileSync('node', [
      'tools/qa/run-electron.cjs', DRIVER,
      '--clubhouse=pine-hills-v2', `--user-data-dir=${dir}`,
    ], { stdio: 'ignore', timeout: 600000 });
  } catch {
    console.log('FAILED (run discarded)');
    continue;
  }
  const j = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  overall.push(j.frames.all.worst);
  for (const [beat, s] of Object.entries(j.frames.byBeat)) {
    if (!perBeat.has(beat)) perBeat.set(beat, []);
    perBeat.get(beat).push(s.worst);
  }
  console.log(`worst ${j.frames.all.worst} ms`);
}

if (overall.length < 2) {
  console.log('\nNot enough successful runs to report a distribution.');
  process.exit(1);
}

const fmt = (xs) => `${median(xs).toFixed(1).padStart(9)}   ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)}`;
console.log(`\n=== ${overall.length} runs — WORST FRAME per beat ===`);
console.log('beat          median      min..max     samples');
for (const [beat, xs] of perBeat) {
  console.log(`${beat.padEnd(12)} ${fmt(xs)}   ${xs.map((x) => x.toFixed(0)).join(', ')}`);
}
console.log(`${'ALL'.padEnd(12)} ${fmt(overall)}`);
console.log('\nCompare MEDIANS across configurations, and only when the medians');
console.log('differ by more than the spread. One run against one run proves nothing.');

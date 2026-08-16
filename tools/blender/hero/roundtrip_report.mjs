// THE ROUND-TRIP COLUMN, for every file the hero pipeline writes.
//
// The check itself lives inside `H.export_glb` now, so a builder that writes a
// scrambled GLB fails its own build. This turns a full build log into the table
// that says so: one row per exported file, with the worst part's displacement
// between what was built and what came back out of the file.
//
// Reading the LOG rather than re-deriving it is deliberate. The alternative is
// a script holding its own copy of each builder's export list -- twenty-five
// hand-written lists that go stale on whichever builder is edited next, which
// is the same fault shape as a hand-kept assertion-pair table. The builders
// already print the number; this only has to collect it.
//
//   node tools/blender/hero/roundtrip_report.mjs <build-log> [--gate]
import { readFileSync } from 'node:fs';

const [, , logPath, ...rest] = process.argv;
const gate = rest.includes('--gate');
if (!logPath) {
  console.error('usage: roundtrip_report.mjs <build-log> [--gate]');
  process.exit(2);
}

const lines = readFileSync(logPath, 'utf8').split(/\r?\n/);
const rows = [];
const failures = [];
let builder = null;
let pending = null;

for (const line of lines) {
  const b = line.match(/^=== (build_\w+)/);
  if (b) { builder = b[1]; continue; }

  const ex = line.match(/exported ([\w.\-]+\.glb)\s+\((\d+) bytes\)/);
  if (ex) { pending = { file: ex[1], bytes: Number(ex[2]), builder }; continue; }

  const ok = line.match(/round trip faithful: (\d+) parts, worst ([\d.]+) mm(?:, (\d+) socket)?/);
  if (ok && pending) {
    rows.push({ ...pending, parts: Number(ok[1]), worst: Number(ok[2]),
                sockets: ok[3] ? Number(ok[3]) : 0 });
    pending = null;
    continue;
  }

  const bad = line.match(/BUILD FAILED: ([\w.\-]+\.glb) is not the asset/);
  if (bad) { failures.push({ file: bad[1], builder, detail: line.trim() }); pending = null; }
}

rows.sort((a, b) => b.worst - a.worst || a.file.localeCompare(b.file));

console.log('');
console.log('file                                   parts  sockets   worst part moved');
console.log('-------------------------------------- -----  -------  -----------------');
for (const r of rows) {
  console.log(
    `${r.file.padEnd(38)} ${String(r.parts).padStart(5)}  ${String(r.sockets).padStart(7)}  `
    + `${r.worst.toFixed(3).padStart(10)} mm`);
}
console.log('');
for (const f of failures) console.log(`SCRAMBLED  ${f.file}  (${f.builder})`);

const worst = rows.length ? Math.max(...rows.map((r) => r.worst)) : 0;
console.log(`${rows.length} files verified, ${failures.length} scrambled, `
  + `worst displacement anywhere ${worst.toFixed(3)} mm`);

// A build log with no round-trip lines in it is not a clean result, it is a
// log from before the check existed. Silence must not read as success.
if (!rows.length && !failures.length) {
  console.log('');
  console.log('NO round-trip lines in this log at all. Either the run predates '
    + 'the check, or every builder failed before reaching its export.');
  if (gate) process.exit(1);
}
if (gate && (failures.length || worst > 0.2)) process.exit(1);

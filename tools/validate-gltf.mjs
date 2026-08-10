// glTF spec-validation gate — H3.
//
// Usage:
//   node tools/validate-gltf.mjs <file.glb | dir> [more...]
//
// Validates every .glb/.gltf under the given paths with the Khronos
// gltf-validator. Any ERROR-severity issue (a spec violation — the
// boolean-cutter-material-slot class) exits 1 and names the file and message.
// Warnings are counted but do not fail; hints/infos are ignored.
//
// This is a pipeline gate: asset builders call it after export, and the
// regression gate runs it over vendor/models/.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import validator from 'gltf-validator';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: node tools/validate-gltf.mjs <file.glb|dir> [more...]');
  process.exit(2);
}

function collect(p, out = []) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) collect(join(p, e), out);
  } else if (['.glb', '.gltf'].includes(extname(p).toLowerCase())) {
    out.push(p);
  }
  return out;
}

const files = args.flatMap((a) => collect(a));
if (!files.length) {
  console.error('no .glb/.gltf files under given paths');
  process.exit(2);
}

let failed = 0;
let warned = 0;
for (const f of files) {
  const bytes = readFileSync(f);
  const report = await validator.validateBytes(new Uint8Array(bytes));
  const errs = report.issues.messages.filter((m) => m.severity === 0);
  const warns = report.issues.messages.filter((m) => m.severity === 1);
  warned += warns.length;
  if (errs.length) {
    failed++;
    console.error(`FAIL ${f}`);
    for (const m of errs.slice(0, 10)) console.error(`  ERROR ${m.code} ${m.pointer || ''}: ${m.message}`);
    if (errs.length > 10) console.error(`  ...and ${errs.length - 10} more errors`);
  }
}
console.log(`validated ${files.length} files: ${failed} failed, ${warned} warnings total`);
process.exit(failed ? 1 : 0);

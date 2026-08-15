// THIRD PASS: put the shared renderer gate on the perf drivers that measure
// frame time and do not have it.
//
// HARNESS_TRUST rule 5: headless runs get SwiftShader, a CPU rasterizer, and
// absolute frame numbers from it are not evidence about the live game. The gate
// exists (tools/qa/perf-renderer-gate.mjs) and five drivers call it; the rest
// record a renderer string at best and leave every reader to remember to check.
//
// Two classes, and they get different treatment:
//   GATE          — the driver reports absolute numbers. Refuse software.
//   SOFTWARE-OK   — the driver pins its own swiftshader flags and compares two
//                   runs of ITSELF. Relative numbers survive a CPU rasterizer,
//                   so it declares allowSoftware and labels the result.
//
// Run: node tools/qa/lib/add-renderer-gate.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');
const IMPORT_LINE = "const { gateRenderer } = await import(`file:///${process.cwd().replace(/\\\\/g, '/')}/tools/qa/perf-renderer-gate.mjs`);";

// file -> { software: bool, why }
const TARGETS = new Map([
  ['tools/qa/assets-51-100-sheet06-performance.js', { software: false, why: 'reports absolute sheet-06 frame cost' }],
  ['tools/qa/cleaning-performance-baseline.js', { software: false, why: 'reports absolute cleaning-loop frame cost' }],
  ['tools/qa/course-perf.js', { software: false, why: 'reports absolute course frame cost' }],
  ['tools/qa/mountain-clubhouse-performance.js', { software: false, why: 'reports absolute variant frame cost' }],
  ['tools/qa/premium-clubhouse-performance.js', { software: false, why: 'reports absolute variant frame cost' }],
  ['tools/qa/scenario-performance-master.js', { software: false, why: 'the scenario table is quoted as live evidence' }],
  ['tools/qa/simplified-register-performance-overlay.js', { software: false, why: 'reports absolute register overlay cost' }],
  ['tools/qa/steam-release-checkout-performance.js', { software: false, why: 'a release gate on absolute numbers' }],
  ['tools/qa/customer-simulation-performance.mjs', { software: true, why: 'pins its own --enable-unsafe-swiftshader and compares itself run to run' }],
  ['tools/qa/simplified-register-performance.mjs', { software: true, why: 'A/B against its own baseline, relative only' }],
  ['tools/qa/player-experience-performance.mjs', { software: true, why: 'A/B against its own baseline, relative only' }],
  ['tools/qa/sheet06-performance-comparison.mjs', { software: true, why: 'a comparison BETWEEN two runs of itself' }],
]);

const report = { gated: [], skipped: [] };
for (const [rel, spec] of TARGETS) {
  const file = path.resolve(rel);
  if (!fs.existsSync(file)) { report.skipped.push({ file: rel, reason: 'missing' }); continue; }
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes('gateRenderer')) { report.skipped.push({ file: rel, reason: 'already gated' }); continue; }
  // Insert straight after the first wait that proves the scene exists — that is
  // the earliest point the renderer string can be read.
  const anchor = /([ \t]*)await\s+page\.waitForFunction\(\(\)\s*=>\s*window\.__fw\?\.scene3d[^\n]*\n/.exec(source);
  if (!anchor) { report.skipped.push({ file: rel, reason: 'no scene3d readiness wait to anchor to' }); continue; }
  const indent = anchor[1];
  const at = anchor.index + anchor[0].length;
  const call = spec.software
    ? `${indent}// ${spec.why} — relative numbers survive a CPU rasterizer, so this\n`
      + `${indent}// declares itself software-relative rather than refusing to run.\n`
      + `${indent}${IMPORT_LINE}\n${indent}const rendererGate = await gateRenderer(page, { allowSoftware: true });\n`
    : `${indent}// HARNESS_TRUST rule 5: ${spec.why}, so a CPU rasterizer's frame\n`
      + `${indent}// numbers are not evidence about the live game. Refuse them.\n`
      + `${indent}${IMPORT_LINE}\n${indent}const rendererGate = await gateRenderer(page);\n`;
  const next = source.slice(0, at) + call + source.slice(at);
  report.gated.push({ file: rel, software: spec.software });
  if (WRITE) fs.writeFileSync(file, next);
}
console.log(JSON.stringify({ wrote: WRITE, ...report }, null, 2));

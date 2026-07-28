// The permanent burial gate for the pro-shop prop population (assets 061+).
//
// tools/qa/proshop-part-visibility.js found six authored, correctly-built parts that no
// camera angle could ever see — after 2,383 tests had passed over them. This test makes
// that sweep load-bearing: an opaque part that renders ZERO pixels from all 26 sweep
// directions fails the suite unless it is whitelisted here, by asset and by name, with
// a reason.
//
// The sweep itself needs a browser and the dev server, so the suite does not re-render;
// instead it refuses to trust stale evidence. The instrument records the sha256 of every
// GLB it swept, and this test recomputes the hashes from disk: rebuild any pro-shop GLB
// — or add a new one to any sheet — and the suite fails with the re-run command until
// the sweep has actually looked at the new bytes. A new asset with a buried part cannot
// pass without anyone remembering to check.
//
// Regenerate the evidence:
//   node tools/serve.cjs                                          # port 8457
//   node tools/qa/run-playwright.cjs tools/qa/proshop-part-visibility.js
//
// Scope: asset numbers >= 61 under vendor/models/assets_51_100/sheet_*/ — the population
// the discriminator measured. Sheet 06 (assets 51-60) predates the programme and was
// never part of the sweep's charter.
//
// Naming caveat: entries like "Cube007" / "Cylinder_1" are three.js GLTFLoader children
// of multi-primitive meshes, named after Blender mesh data blocks. They are stable for a
// given GLB; any rebuild changes the file hash and forces a re-sweep, so a renamed part
// fails loudly at the rot gate instead of silently un-whitelisting itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DATA_PATH = path.join(
  ROOT, 'Designs', 'ProShop', 'Discriminator', 'data', 'part-visibility.json',
);
const GLB_ROOT = path.join(ROOT, 'vendor', 'models', 'assets_51_100');
const RERUN = 'node tools/qa/run-playwright.cjs tools/qa/proshop-part-visibility.js';

// --- the known exceptions, each with its reason ------------------------------------
// A part listed here is EXPECTED to be invisible at bind pose. If it becomes visible
// (someone fixed the burial, or the part was renamed by a rebuild), the rot gate fails
// so the entry gets removed instead of shielding the next real defect.
const EXPECT_INVISIBLE = new Map([
  // The nine animation-revealed interiors — hidden at bind pose, revealed by their
  // door, drawer, lever or print animations. Positioned correctly for the reveal.
  ['73:MESH_WringerPressPlate', 'tips out of the wringer cage at the lever\'s open pose'],
  ['82:MESH_CabinetTopBox', 'the top drawer\'s body; slides out on the drawer animation'],
  ['84:MESH_PrinterSheet', 'the print clip drives it out of the slot on the print animation'],
  ['92:MESH_FirstAidShelf_0', 'shelf behind the first-aid cabinet door; door opens'],
  ['92:MESH_FirstAidShelf_1', 'shelf behind the first-aid cabinet door; door opens'],
  ['92:Cube007', 'first-aid supplies behind the cabinet door; door opens'],
  ['92:Cube007_1', 'first-aid supplies behind the cabinet door; door opens'],
  ['97:Cylinder', 'keys behind the key-cabinet door; door opens'],
  ['97:Cylinder_1', 'keys behind the key-cabinet door; door opens'],
  // The door-gated shelf — same reveal family, called out by name in the brief.
  ['62:MESH_InternalShelf', 'builder marks it visible_when_door_open; behind the cabinet doors'],
  // Deferred structural burials — real defects, recorded in ASSEMBLY_FIXES.md, waiting
  // until after Phase 3 because 061 IS the reception counter Phase 3 may relocate.
  ['61:MESH_StaffDivider', 'DEFERRED: buried in the solid CounterCarcass; staff-bay carve waits until after Phase 3 settles the counter'],
  ['99:MESH_StandDrainTray', 'DEFERRED: sits inside a faked solid bore; no cavity exists to see into'],
  // Residual by geometry, not defect.
  ['71:MESH_VacHeadWheelL', 'genuine inboard caster: the drum flank owns the left wheel\'s whole viewing hemisphere'],
  // Pre-existing faked-cavity family, recorded in ASSEMBLY_FIXES.md, left alone.
  ['73:Cube007_1', 'the wringer\'s five-slat grate inside the solid body; the cavity it implies does not exist'],
]);

// A part listed here may report EITHER way without failing. 061's StaffLowerShelf is
// exactly as buried as the StaffDivider but escapes the probe by z-fighting its own
// coplanar rear face — a depth tie that must not be allowed to flake the suite.
const TOLERATED = new Map([
  ['61:MESH_StaffLowerShelf', 'buried; survives only by z-fighting its coplanar rear face — a depth-tie flip is not a regression'],
]);

// --- gates, pure over injected inputs so the teeth are themselves testable ---------
export function auditPartVisibility({ data, disk, expectInvisible, tolerated }) {
  const problems = [];
  const byFile = new Map(data.results.map((entry) => [entry.file, entry]));
  for (const [file, info] of disk) {
    const swept = byFile.get(file);
    if (!swept) {
      problems.push(`unswept: ${file} is on disk but absent from part-visibility.json — run: ${RERUN}`);
      continue;
    }
    if (swept.sha256 !== info.sha256) {
      problems.push(`stale: ${file} changed since the sweep — run: ${RERUN}`);
    }
  }
  for (const entry of data.results) {
    if (!disk.has(entry.file)) {
      problems.push(`ghost: ${entry.file} is in part-visibility.json but no longer on disk — run: ${RERUN}`);
    }
  }
  for (const entry of data.results) {
    for (const name of entry.invisible) {
      const key = `${entry.n}:${name}`;
      if (expectInvisible.has(key) || tolerated.has(key)) continue;
      problems.push(
        `buried: asset_${String(entry.n).padStart(3, '0')} part "${name}" renders zero pixels `
        + `from all ${data.directions} directions — the 087 class. Fix the assembly, or `
        + 'whitelist it in tests/proshop-part-visibility.test.js with a one-line reason.',
      );
    }
  }
  for (const key of expectInvisible.keys()) {
    const split = key.indexOf(':');
    const n = Number(key.slice(0, split));
    const name = key.slice(split + 1);
    const entry = data.results.find((candidate) => candidate.n === n);
    if (!entry) {
      problems.push(`whitelist rot: ${key} names an asset the sweep no longer contains — remove the entry`);
      continue;
    }
    if (!entry.invisible.includes(name)) {
      problems.push(
        `whitelist rot: ${key} is no longer invisible — the burial was fixed or the part `
        + 'renamed. Remove or update the entry so it cannot shield the next real defect.',
      );
    }
  }
  return problems;
}

function diskPopulation() {
  const out = new Map();
  for (const sheet of readdirSync(GLB_ROOT).filter((dir) => /^sheet_\d+$/.test(dir))) {
    for (const file of readdirSync(path.join(GLB_ROOT, sheet))) {
      const match = /^asset_(\d{3})_.+\.glb$/.exec(file);
      if (!match || Number(match[1]) < 61) continue;
      const bytes = readFileSync(path.join(GLB_ROOT, sheet, file));
      out.set(file, { n: Number(match[1]), sheet, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  return out;
}

const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const disk = diskPopulation();
const problems = auditPartVisibility({
  data, disk, expectInvisible: EXPECT_INVISIBLE, tolerated: TOLERATED,
});

test('part-visibility evidence is fresh: every pro-shop GLB on disk is the one the sweep hashed', () => {
  const freshness = problems.filter((p) => /^(unswept|stale|ghost):/.test(p));
  assert.deepEqual(freshness, [], `\n${freshness.join('\n')}`);
});

test('no opaque part is invisible from all 26 directions unless whitelisted by name', () => {
  const burials = problems.filter((p) => p.startsWith('buried:'));
  assert.deepEqual(burials, [], `\n${burials.join('\n')}`);
});

test('the whitelist cannot rot: every expected-invisible entry still matches the sweep', () => {
  const rot = problems.filter((p) => p.startsWith('whitelist rot:'));
  assert.deepEqual(rot, [], `\n${rot.join('\n')}`);
});

test('the sweep contract holds: 26 directions at 512^2 over the full population', () => {
  assert.equal(data.directions, 26);
  assert.equal(data.size, 512);
  assert.ok(data.results.length >= 40, `population shrank to ${data.results.length} — the sweep must cover every asset >= 061`);
  for (const entry of data.results) {
    assert.match(entry.sha256 || '', /^[0-9a-f]{64}$/, `asset_${entry.n} carries no sha256 — instrument predates the hash contract; run: ${RERUN}`);
  }
});

// --- the gate's own teeth ----------------------------------------------------------
const syntheticDisk = new Map([['asset_101_widget.glb', { n: 101, sheet: 'sheet_11', sha256: 'a'.repeat(64) }]]);
const syntheticEntry = {
  n: 101, file: 'asset_101_widget.glb', sheet: 'sheet_11', sha256: 'a'.repeat(64), invisible: [],
};

test('teeth: a buried part outside the whitelist fails', () => {
  const found = auditPartVisibility({
    data: { directions: 26, size: 512, results: [{ ...syntheticEntry, invisible: ['MESH_HiddenDial'] }] },
    disk: syntheticDisk,
    expectInvisible: new Map(),
    tolerated: new Map(),
  });
  assert.ok(found.some((p) => p.startsWith('buried: asset_101 part "MESH_HiddenDial"')), found.join('\n'));
});

test('teeth: a rebuilt GLB fails as stale until the sweep re-runs', () => {
  const found = auditPartVisibility({
    data: { directions: 26, size: 512, results: [{ ...syntheticEntry, sha256: 'b'.repeat(64) }] },
    disk: syntheticDisk,
    expectInvisible: new Map(),
    tolerated: new Map(),
  });
  assert.ok(found.some((p) => p.startsWith('stale: asset_101_widget.glb')), found.join('\n'));
});

test('teeth: a GLB the sweep never saw fails as unswept', () => {
  const found = auditPartVisibility({
    data: { directions: 26, size: 512, results: [] },
    disk: syntheticDisk,
    expectInvisible: new Map(),
    tolerated: new Map(),
  });
  assert.ok(found.some((p) => p.startsWith('unswept: asset_101_widget.glb')), found.join('\n'));
});

test('teeth: a whitelisted part that becomes visible fails as rot', () => {
  const found = auditPartVisibility({
    data: { directions: 26, size: 512, results: [syntheticEntry] },
    disk: syntheticDisk,
    expectInvisible: new Map([['101:MESH_HiddenDial', 'was buried once']]),
    tolerated: new Map(),
  });
  assert.ok(found.some((p) => p.startsWith('whitelist rot: 101:MESH_HiddenDial')), found.join('\n'));
});

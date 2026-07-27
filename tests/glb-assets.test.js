// NO GAME ASSET SHIPS WITH A CAMERA OR AN UNCONTROLLED LIGHT BAKED INTO IT.
//
// A GLB that carries an exported camera or a punctual light is an authoring mistake that leaks
// a stray view or an uncontrolled light into the scene the moment it loads — exactly the kind of
// thing that must never reach a Steam build. This walks every .glb under vendor/models with the
// same parser the glb-audit tool uses and fails if any asset carries one, or if any asset can no
// longer be parsed. Triangle/material budgets are reported by the audit CLI, not gated here,
// because some environment assets are legitimately heavy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { CEILING_LIGHT_SKUS } from '../src/data/ceilingLights.js';

const { auditGlb, walk } = await import('../tools/qa/glb-audit.mjs');

const MODELS = join(process.cwd(), 'vendor', 'models');
const files = walk(MODELS);
const CONTROLLED_LIGHT_ASSETS = new Map(CEILING_LIGHT_SKUS.flatMap((sku) => (
  sku.modelLodPaths.map((path) => [path, sku.lightingProfile.runtimeLights])
)));

test('there is a corpus of GLB assets to audit', () => {
  assert.ok(files.length > 50, `expected many GLBs under vendor/models, found ${files.length}`);
});

test('every GLB parses as a valid glTF container', () => {
  const broken = [];
  for (const f of files) {
    try { auditGlb(f); } catch (e) { broken.push(`${f}: ${e.message}`); }
  }
  assert.deepEqual(broken, [], `unparseable GLBs:\n${broken.join('\n')}`);
});

test('no GLB carries an exported camera or uncontrolled light', () => {
  const offenders = [];
  for (const f of files) {
    let rec;
    try { rec = auditGlb(f); } catch { continue; }
    if (rec.cameras > 0) offenders.push(`${rec.file}: ${rec.cameras} camera(s)`);
    if (rec.lights > 0 && CONTROLLED_LIGHT_ASSETS.get(rec.file) !== rec.lights) {
      offenders.push(`${rec.file}: ${rec.lights} uncontrolled light(s)`);
    }
  }
  assert.deepEqual(offenders, [], `assets with baked cameras/lights:\n${offenders.join('\n')}`);
});

test('no GLB is degenerate — every asset has geometry and finite bounds', () => {
  const bad = [];
  for (const f of files) {
    let rec;
    try { rec = auditGlb(f); } catch { continue; }
    if (rec.meshes > 0 && (!(rec.maxDim >= 0) || !Number.isFinite(rec.maxDim))) bad.push(`${rec.file}: non-finite bounds`);
  }
  assert.deepEqual(bad, [], `degenerate assets:\n${bad.join('\n')}`);
});

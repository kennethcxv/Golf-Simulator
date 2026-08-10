// H3 — the glTF spec-validation gate, armed.
//
// Every runtime GLB under vendor/models/ must pass the Khronos validator.
// A spec violation in a NEW or REBUILT asset fails the suite — the
// boolean-brings-the-cutter's-material-slot class has shipped twice, and both
// times the numbers looked fine while the file was out of spec.
//
// KNOWN_FAILURES is the debt ledger as of 2026-08-09: 9 files that already
// violate the spec. Each is listed with its violation so the list cannot rot
// invisibly. The gate is symmetric: a NEW failure fails the suite, and a
// whitelisted file that starts PASSING also fails the suite until its entry is
// removed — the list only shrinks.
//
// Negative control (watched fail 2026-08-09): a .gltf with an unresolved mesh
// reference exits 1 via tools/validate-gltf.mjs, and this test's walker feeds
// the same validator, so an in-repo regression produces the same shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const MODELS = join(ROOT, 'vendor', 'models');

// file (posix relpath under vendor/models) -> violation it is allowed to keep
const KNOWN_FAILURES = new Map([
  ['checkout/lounge_armchair.glb', 'MESH_PRIMITIVE_TOO_FEW_TEXCOORDS'],
  ['pro_shop_furniture/retail-shelving/shelf_basic.glb', 'MESH_PRIMITIVE_TOO_FEW_TEXCOORDS'],
  ['pro_shop_furniture/retail-shelving/shelf_basic_lod1.glb', 'MESH_PRIMITIVE_TOO_FEW_TEXCOORDS'],
  ['trees/tree_default.glb', 'SCENE_NON_ROOT_NODE'],
  ['trees/tree_detailed.glb', 'SCENE_NON_ROOT_NODE'],
  ['trees/tree_fat.glb', 'SCENE_NON_ROOT_NODE'],
  ['trees/tree_oak.glb', 'SCENE_NON_ROOT_NODE'],
  ['trees/tree_pineDefaultA.glb', 'SCENE_NON_ROOT_NODE'],
  ['trees/tree_pineRoundB.glb', 'SCENE_NON_ROOT_NODE'],
]);

function collect(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (['.glb', '.gltf'].includes(extname(p).toLowerCase())) out.push(p);
  }
  return out;
}

test('every runtime GLB passes Khronos validation (whitelist only shrinks)', async () => {
  const files = collect(MODELS);
  assert.ok(files.length > 500, `expected the full model tree, saw ${files.length}`);
  const newFailures = [];
  const staleWhitelist = [];
  for (const f of files) {
    const rel = relative(MODELS, f).replace(/\\/g, '/');
    const report = await validator.validateBytes(new Uint8Array(readFileSync(f)));
    const errs = report.issues.messages.filter((m) => m.severity === 0);
    const allowed = KNOWN_FAILURES.get(rel);
    if (errs.length && !allowed) {
      newFailures.push(`${rel}: ${errs[0].code} ${errs[0].message}`);
    } else if (errs.length && allowed && !errs.some((m) => m.code === allowed)) {
      newFailures.push(`${rel}: whitelisted for ${allowed} but now fails with ${errs[0].code}`);
    } else if (!errs.length && allowed) {
      staleWhitelist.push(rel);
    }
  }
  assert.deepEqual(newFailures, [], `spec violations outside the 2026-08-09 debt ledger:\n${newFailures.join('\n')}`);
  assert.deepEqual(staleWhitelist, [], `these files now PASS — remove them from KNOWN_FAILURES:\n${staleWhitelist.join('\n')}`);
});

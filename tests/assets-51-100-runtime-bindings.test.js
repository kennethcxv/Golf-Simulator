// Every Assets 51-100 binding is checked against the GLB the game actually loads.
//
// This closes the gap the Codex handoff audit named: the nine sheet06 test files all use a
// stubbed loader and never open a real binary, so a name drift between Blender output and
// the JS contract passes them. Green said the contract was self-consistent, not that it
// described anything on disk.
//
// Here the binaries are parsed. A socket the binding promises and the export does not
// contain is a failure, which is the only way this can stay true through a rebuild.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditGlbFile } from '../tools/qa/glb-structure-audit.mjs';
import {
  ALL_ASSETS, ASSETS_BY_NUMBER, SHEETS, VIEWMODEL_ASSETS, bindingFor, runtimeGlbPaths,
} from '../src/render3d/assets51to100/assetsRegistry.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(REPO_ROOT, 'qa', 'assets_51_100_master', 'claude_completion');

/** Clean-reimport records, keyed by the repo-relative runtime GLB path they cover. */
const REIMPORTS = (() => {
  const byGlb = new Map();
  for (const sheet of ['sheet_06', 'sheet_07', 'sheet_08', 'sheet_09', 'sheet_10']) {
    const file = join(EVIDENCE, sheet, 'clean_reimport.json');
    if (!existsSync(file)) continue;
    for (const result of JSON.parse(readFileSync(file, 'utf8')).results || []) {
      const posix = result.glb.replace(/\\/g, '/');
      const index = posix.indexOf('vendor/models/');
      if (index >= 0) byGlb.set(posix.slice(index), result);
    }
  }
  return byGlb;
})();

function reimportFor(glbPath) {
  const record = REIMPORTS.get(glbPath);
  assert.ok(record, `no clean-reimport evidence for ${glbPath}; re-run verify_assets_reimport.py`);
  return record;
}

/** Parse one GLB and return the identity facts a binding claims about it. */
function inspect(glbPath, requiredSockets, requiredAnimations) {
  const report = auditGlbFile({
    root: REPO_ROOT,
    glbPath,
    requiredSockets,
    requiredAnimations,
  });
  assert.equal(report.error, null, `${glbPath} failed to parse: ${report.error}`);
  assert.equal(report.exists, true, `${glbPath} does not exist`);
  return report;
}

test('the registry holds exactly the fifty assets 51 through 100, once each', () => {
  assert.equal(ALL_ASSETS.length, 50);
  const numbers = ALL_ASSETS.map((a) => a.assetNumber);
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), 'assets must stay in ascending order');
  assert.equal(new Set(numbers).size, 50, 'asset numbers must be unique');
  assert.equal(numbers[0], 51);
  assert.equal(numbers[49], 100);
  for (let n = 51; n <= 100; n += 1) assert.ok(ASSETS_BY_NUMBER[n], `asset ${n} missing`);
  assert.equal(Object.values(SHEETS).reduce((sum, s) => sum + s.length, 0), 50);
});

test('every binding points at a runtime GLB that exists on disk', () => {
  const missing = runtimeGlbPaths().filter((p) => !existsSync(join(REPO_ROOT, p)));
  assert.deepEqual(missing, [], 'runtime GLBs referenced by bindings must exist');
});

test('every world binding matches the binary it names', () => {
  for (const asset of ALL_ASSETS) {
    const report = inspect(asset.paths.runtimeGlb, asset.requiredSockets, asset.requiredAnimations);

    assert.deepEqual(
      report.missingRequiredSockets, [],
      `asset ${asset.assetNumber}: binding promises sockets its GLB does not contain`,
    );
    assert.deepEqual(
      report.missingRequiredAnimations, [],
      `asset ${asset.assetNumber}: binding promises animations its GLB does not contain`,
    );
    assert.deepEqual(
      report.rootNodeNames, [asset.rootName],
      `asset ${asset.assetNumber}: GLB must contain exactly the root its binding names`,
    );
  }
});

test('every viewmodel binding matches the binary it names', () => {
  assert.ok(VIEWMODEL_ASSETS.length > 0, 'at least one asset should ship a viewmodel');
  for (const asset of VIEWMODEL_ASSETS) {
    const fp = asset.firstPerson;
    const report = inspect(fp.runtimeGlb, fp.requiredSockets, fp.requiredAnimations);
    assert.deepEqual(
      report.missingRequiredSockets, [],
      `asset ${asset.assetNumber} viewmodel: promised sockets are absent from the GLB`,
    );
    assert.deepEqual(
      report.missingRequiredAnimations, [],
      `asset ${asset.assetNumber} viewmodel: promised animations are absent from the GLB`,
    );
  }
});

test('the eight tools that need a viewmodel have one, and nothing else claims to', () => {
  // The contract fixes this set. A tool gaining or losing a viewmodel is a decision, not
  // something that should happen because a builder was re-run.
  assert.deepEqual(VIEWMODEL_ASSETS.map((a) => a.assetNumber), [71, 72, 74, 75, 76, 77, 79, 80]);
  for (const asset of VIEWMODEL_ASSETS) {
    assert.equal(asset.firstPerson.collisionExpected, false,
      `asset ${asset.assetNumber}: a viewmodel must never block the player holding it`);
    assert.match(asset.firstPerson.runtimeGlb, /\/firstperson\//);
    assert.match(asset.firstPerson.rootName, /_FP_ROOT$/);
  }
});

test('the metres-to-yards scale is declared exactly once per asset', () => {
  // Applying it twice is a silent 20% error: plausible on a chair, absurd on a wall.
  for (const asset of ALL_ASSETS) {
    assert.equal(asset.mount.scaleExactlyOnce, true, `asset ${asset.assetNumber}`);
    assert.ok(Math.abs(asset.runtimeScale - 1.0936133) < 1e-9, `asset ${asset.assetNumber}`);
  }
});

test('no authored prop is allowed to become a navigation authority', () => {
  // The clubhouse shell owns the walkable world. A prop that quietly starts blocking is
  // how a player ends up wedged behind a filing cabinet with no way out.
  for (const asset of ALL_ASSETS) {
    assert.equal(asset.collision.runtimeNavigationAuthority, 'ANALYTIC_LAYOUT', `asset ${asset.assetNumber}`);
    assert.equal(asset.collision.glbNavigationAuthority, 'NONE', `asset ${asset.assetNumber}`);
    assert.equal(asset.collision.activateGlbCollision, false, `asset ${asset.assetNumber}`);
  }
});

test('assets that declare no collision ship no player blocker', () => {
  // "No collision" means no blocker, not no proxy. Asset 57's contract asks for exactly
  // this -- "No player blocker; use small placement/raycast proxies only where selection
  // requires them" -- and it ships a raycast-only trim proxy, which is correct. Asserting
  // zero COL_ nodes failed that asset for doing the right thing.
  //
  // Purpose lives on the proxy as a Blender property, which the Node GLB parser does not
  // surface, so this reads the clean-reimport evidence where it is recorded.
  const noCollision = ALL_ASSETS.filter((a) => a.collision.authoredCollisionExpected === false);
  assert.ok(noCollision.length > 0, 'some wall dressing should ship without collision');
  for (const asset of noCollision) {
    const record = reimportFor(asset.paths.runtimeGlb);
    assert.equal(
      record.stats.blockingCollisionCount, 0,
      `asset ${asset.assetNumber} declares no collision but ships a blocking proxy: `
      + JSON.stringify(record.stats.collisionPurposes),
    );
  }
});

test('assets that do expect collision actually ship it', () => {
  // The mirror of the check above. Without it, "collision_expected" could be set to false
  // everywhere and the suite would still be green.
  const withCollision = ALL_ASSETS.filter((a) => a.collision.authoredCollisionExpected === true);
  assert.ok(withCollision.length >= 30, 'most assets should expect collision');
  for (const asset of withCollision) {
    const report = inspect(asset.paths.runtimeGlb, [], []);
    assert.ok(
      report.collisionNodes.length > 0,
      `asset ${asset.assetNumber} expects collision but its GLB ships none`,
    );
  }
});

test('the viewmodel binaries ship no collision at all', () => {
  for (const asset of VIEWMODEL_ASSETS) {
    const report = inspect(asset.firstPerson.runtimeGlb, [], []);
    assert.deepEqual(
      report.collisionNodes, [],
      `asset ${asset.assetNumber} viewmodel ships collision and would block its holder`,
    );
    assert.deepEqual(report.rootNodeNames, [asset.firstPerson.rootName]);
  }
});

test('bindingFor resolves by number and refuses anything outside the range', () => {
  assert.equal(bindingFor(51).assetNumber, 51);
  assert.equal(bindingFor(100).assetNumber, 100);
  assert.throws(() => bindingFor(50), /No Assets 51-100 binding/);
  assert.throws(() => bindingFor(101), /No Assets 51-100 binding/);
});

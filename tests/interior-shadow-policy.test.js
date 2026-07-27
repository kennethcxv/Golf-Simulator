import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { suppressInteriorSunShadows } from '../src/render3d/clubhouse/interiorShadowPolicy.js';

const clubhouseSource = readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
);
const registerSource = readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

test('interior sun-shadow policy suppresses late nested casters and is idempotent', () => {
  const root = new THREE.Group();
  const mountedEmptyRoot = new THREE.Group();
  root.add(mountedEmptyRoot);
  const direct = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const nested = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  direct.castShadow = true;
  nested.castShadow = true;
  mountedEmptyRoot.add(direct);
  const deeper = new THREE.Group();
  deeper.add(nested);
  mountedEmptyRoot.add(deeper);

  assert.deepEqual(suppressInteriorSunShadows(root), { meshes: 2, suppressed: 2 });
  assert.equal(direct.castShadow, false);
  assert.equal(nested.castShadow, false);
  assert.deepEqual(suppressInteriorSunShadows(root), { meshes: 2, suppressed: 0 });

  direct.geometry.dispose();
  nested.geometry.dispose();
  direct.material.dispose();
  nested.material.dispose();
});

test('stock, animated restock, startup, and register mutations enforce the shared policy', () => {
  // The wrapper's loop body became a block when the shed presentation added its
  // interior whitelist, but suppressInteriorSunShadows(object) stays the FIRST
  // thing done for every added object — the sun-shadow contract is unchanged.
  assert.match(clubhouseSource, /interior\.add = \(\.\.\.objs\) => \{\s*for \(const object of objs\) \{\s*suppressInteriorSunShadows\(object\);/);
  assert.match(clubhouseSource, /function rebuildStock\(\) \{[\s\S]*?suppressInteriorSunShadows\(stockGroup\);\s*\}/);
  assert.match(clubhouseSource, /if \(!ghost\.children\.length\)[\s\S]*?suppressInteriorSunShadows\(ghost\);\s*return true;/);
  assert.match(clubhouseSource, /const g = char\.root;[\s\S]*?suppressInteriorSunShadows\(g\);/,
    'articulated customers stay out of the course-scale sun shadow atlas');
  assert.match(clubhouseSource, /merch\.onReady\(\(\) => \{[\s\S]*?rebuildBoxes\(\);[\s\S]*?suppressInteriorSunShadows\(interior\);/);

  const uses = registerSource.match(/suppressInteriorSunShadows\(/g) || [];
  assert.ok(uses.length >= 6, 'register products, money, prewarm kit, bag, drawer, and card must be covered');
  assert.doesNotMatch(registerSource, /castShadow\s*=\s*from !== 'drawer'/);
});

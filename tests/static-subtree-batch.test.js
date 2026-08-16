// GOAL 29 PHASE 2 — the static subtree batcher's contracts, pinned.
//
// The two corrections this module exists for are each watched failing on the
// shape that would break them:
//   - SHADOW PRESERVATION: two same-material meshes with different castShadow
//     flags refuse to merge under the honest key, and DO merge under the
//     debug key that drops shadow flags — the exact defect class the old
//     placed batch shipped (its batches stopped casting).
//   - NO QUANTISATION: a fold bucket forms only when every pixel-relevant
//     parameter is exactly equal; the folded vertex colours must equal the
//     source material colours to the float, and the bucket material must be
//     exactly white (white x c == c in IEEE).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchStaticSubtree, STATIC_SUBTREE_BATCH_DEBUG } from '../src/render3d/staticSubtreeBatch.js';

const box = () => new THREE.BoxGeometry(1, 1, 1);
const texture = () => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
};

test('identity bucket: shared-material meshes collapse to one draw with the SAME material object', () => {
  const root = new THREE.Group();
  const shared = new THREE.MeshStandardMaterial({ map: texture() });
  const meshes = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(box(), shared);
    m.position.set(i * 2, 0, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  });
  const report = batchStaticSubtree(root, { label: 'T' });
  assert.ok(report.visual, `expected a batch, got ${JSON.stringify(report)}`);
  assert.equal(report.sourceDrawCalls, 3);
  assert.equal(report.batchedDrawCalls, 1);
  assert.equal(report.savedDrawCalls, 2);
  const batchMesh = report.visual.children[0];
  assert.equal(batchMesh.material, shared, 'identity bucket must REUSE the material object (no new program)');
  assert.equal(batchMesh.castShadow, true, 'shadow flags must survive');
  assert.equal(batchMesh.receiveShadow, true);
  for (const m of meshes) {
    assert.equal(m.layers.mask, 0, 'sources are layer-suppressed, not removed');
    assert.equal(m.userData.staticSubtreeBatchSuppressed, true);
  }
  // transforms baked: vertices of the third cube live around x = 4
  const positions = batchMesh.geometry.getAttribute('position');
  let maxX = -Infinity;
  for (let i = 0; i < positions.count; i += 1) maxX = Math.max(maxX, positions.getX(i));
  assert.ok(Math.abs(maxX - 4.5) < 1e-6, `baked world transform expected max x 4.5, got ${maxX}`);
});

test('shadow flags split buckets — and the debug key that drops them reproduces the old defect', () => {
  const build = () => {
    const root = new THREE.Group();
    const shared = new THREE.MeshStandardMaterial({ map: texture() });
    const caster = new THREE.Mesh(box(), shared);
    caster.castShadow = true;
    const silent = new THREE.Mesh(box(), shared);
    silent.castShadow = false;
    silent.position.set(3, 0, 0);
    root.add(caster, silent);
    return { root, caster, silent };
  };
  // honest key: refuses (each bucket has one member; nothing reduces)
  const honest = build();
  const honestReport = batchStaticSubtree(honest.root, { label: 'T' });
  assert.equal(honestReport.skipped, 'no-bucket-reduces',
    'meshes differing only in castShadow must NOT merge');
  assert.notEqual(honest.caster.layers.mask, 0, 'a refused batch leaves sources untouched');
  // the debug key that drops shadow flags: merges them — the watched failure
  const broken = build();
  STATIC_SUBTREE_BATCH_DEBUG.dropShadowFlags = true;
  let brokenReport;
  try {
    brokenReport = batchStaticSubtree(broken.root, { label: 'T' });
  } finally {
    STATIC_SUBTREE_BATCH_DEBUG.dropShadowFlags = false;
  }
  assert.ok(brokenReport.visual, 'the shadow-blind key merges what must not merge — the defect is real and the key is what prevents it');
});

test('fold bucket: colour-only differences share one draw, byte-identically', () => {
  const root = new THREE.Group();
  const a = new THREE.Mesh(box(), new THREE.MeshStandardMaterial({ color: 0x8f8f8f, roughness: 0.92 }));
  const b = new THREE.Mesh(box(), new THREE.MeshStandardMaterial({ color: 0x6f6f6f, roughness: 0.92 }));
  b.position.set(2.5, 0, 0);
  root.add(a, b);
  const expectA = a.material.color.clone();
  const expectB = b.material.color.clone();
  const report = batchStaticSubtree(root, { label: 'T' });
  assert.ok(report.visual, `expected a fold batch, got ${JSON.stringify(report)}`);
  assert.equal(report.foldBuckets, 1);
  assert.equal(report.batchedDrawCalls, 1);
  const mesh = report.visual.children[0];
  assert.equal(mesh.material.vertexColors, true);
  assert.deepEqual(mesh.material.color.toArray(), [1, 1, 1], 'fold material must be exactly white');
  const colors = mesh.geometry.getAttribute('color');
  const positions = mesh.geometry.getAttribute('position');
  assert.equal(colors.count, positions.count);
  // Exactness is FLOAT32 exactness: the attribute stores float32, and the
  // uniform path the original material took (gl.uniform3f) converts the same
  // float64 to the same float32 — the GPU sees an identical value either way.
  assert.equal(colors.getX(0), Math.fround(expectA.r));
  assert.equal(colors.getY(0), Math.fround(expectA.g));
  let sawB = false;
  for (let i = 0; i < colors.count; i += 1) {
    if (positions.getX(i) > 1.5) {
      assert.equal(colors.getX(i), Math.fround(expectB.r), 'second source colour must be float32-exact');
      sawB = true;
      break;
    }
  }
  assert.ok(sawB, 'the merged geometry must contain the second cube');
});

test('a fold never crosses a parameter difference — near-equal roughness stays separate', () => {
  const root = new THREE.Group();
  const a = new THREE.Mesh(box(), new THREE.MeshStandardMaterial({ color: 0x8f8f8f, roughness: 0.92 }));
  const b = new THREE.Mesh(box(), new THREE.MeshStandardMaterial({ color: 0x6f6f6f, roughness: 0.95 }));
  root.add(a, b);
  const report = batchStaticSubtree(root, { label: 'T' });
  assert.equal(report.skipped, 'no-bucket-reduces',
    'quantising 0.92 and 0.95 together is the placed-batch restyle, not a merge');
});

test('the exclusion chain holds: flags, contracts, transparency, proxies, caller sets', () => {
  const root = new THREE.Group();
  const mat = () => new THREE.MeshStandardMaterial({ color: 0x8f8f8f, roughness: 0.9 });

  const fixtureParent = new THREE.Group();
  fixtureParent.userData.fixtureId = 'gondola-1';
  const underFixture = new THREE.Mesh(box(), mat());
  fixtureParent.add(underFixture);

  const transparent = new THREE.Mesh(box(), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 }));
  const proxy = new THREE.Mesh(box(), mat());
  proxy.name = 'COL_wall';
  const animated = new THREE.Group();
  animated.animations = [new THREE.AnimationClip('swing', 1, [])];
  const underAnimated = new THREE.Mesh(box(), mat());
  animated.add(underAnimated);
  const excludedByCaller = new THREE.Mesh(box(), mat());

  // two honest candidates so a batch CAN form around the exclusions
  const okA = new THREE.Mesh(box(), mat());
  const okB = new THREE.Mesh(box(), mat());
  okB.position.set(2, 0, 0);

  root.add(fixtureParent, transparent, proxy, animated, excludedByCaller, okA, okB);
  const report = batchStaticSubtree(root, {
    label: 'T',
    exclude: (node) => node === excludedByCaller,
  });
  assert.ok(report.visual);
  assert.equal(report.sourceDrawCalls, 2, 'only the two honest candidates may merge');
  for (const survivor of [underFixture, transparent, proxy, underAnimated, excludedByCaller]) {
    assert.notEqual(survivor.layers.mask, 0, `${survivor.name || 'survivor'} must remain untouched`);
    assert.ok(!survivor.userData.staticSubtreeBatchSuppressed);
  }
  assert.equal(report.skippedReasons['movable-fixture'], 1);
  assert.equal(report.skippedReasons['transparent-or-no-depth-write'], 1);
  assert.equal(report.skippedReasons['collision-proxy-name'], 1);
  assert.equal(report.skippedReasons['ancestor-animations'], 1);
  assert.equal(report.skippedReasons['excluded:Mesh'], 1);
});

test('aoMap uv channels survive the bake and gate the bucket', () => {
  const root = new THREE.Group();
  const shared = new THREE.MeshStandardMaterial({ map: texture() });
  shared.aoMap = texture();
  const withUv1 = new THREE.Mesh(box(), shared);
  const uv = withUv1.geometry.getAttribute('uv');
  withUv1.geometry.setAttribute('uv1', uv.clone());
  const withUv1b = new THREE.Mesh(box(), shared);
  withUv1b.geometry.setAttribute('uv1', uv.clone());
  withUv1b.position.set(2, 0, 0);
  const withoutUv1 = new THREE.Mesh(box(), shared);
  withoutUv1.position.set(4, 0, 0);
  root.add(withUv1, withUv1b, withoutUv1);
  const report = batchStaticSubtree(root, { label: 'T' });
  assert.ok(report.visual);
  assert.equal(report.sourceDrawCalls, 2, 'the uv1-less mesh must stay out of the uv1 bucket');
  const mesh = report.visual.children[0];
  assert.ok(mesh.geometry.getAttribute('uv1'), 'the aoMap channel must survive the bake');
  assert.notEqual(withoutUv1.layers.mask, 0);
});

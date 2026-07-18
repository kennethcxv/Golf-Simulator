import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import {
  MOVABLE_FIXTURE_CORE_DRAW_CALL_BUDGET,
  MOVABLE_FIXTURE_CORE_MODELS,
  createMovableFixtureCoreBatcher,
} from '../src/render3d/clubhouse/fixtureCoreBatching.js';

function fixturePrototype(model, { dynamicMesh = false } = {}) {
  const root = new THREE.Group();
  root.name = model;
  const material = new THREE.MeshStandardMaterial({ color: 0x78583e });
  material.name = 'FixtureMaterial';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.4), material);
  body.name = 'FixtureBody';
  body.position.set(1, 0.3, 0);
  body.castShadow = true;
  body.receiveShadow = false;
  root.add(body);

  const socket = new THREE.Object3D();
  socket.name = 'STOCK_SLOT_01';
  socket.position.set(0.25, 0.65, 0.1);
  socket.userData.socket = 'stock';
  root.add(socket);

  const collision = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.5), material);
  collision.name = 'COL_Fixture';
  collision.visible = false;
  collision.userData.collision_proxy = true;
  root.add(collision);

  if (dynamicMesh) {
    const dynamic = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
    dynamic.name = 'DynamicFixtureIndicator';
    dynamic.position.set(-0.35, 0.8, 0);
    dynamic.userData.dynamic = true;
    root.add(dynamic);
  }
  return root;
}

function fakeMerch(prototypes, { bake = true } = {}) {
  const calls = { instantiateKit: 0, bake: 0, scratchParents: [], scratchMatrices: [] };
  const api = {
    calls,
    instantiateKit(model) {
      calls.instantiateKit += 1;
      return prototypes.get(model)?.clone(true) || null;
    },
  };
  if (!bake) return api;
  api.bake = (scratch, options) => {
    calls.bake += 1;
    calls.scratchParents.push(scratch.parent);
    scratch.updateMatrixWorld(true);
    const buckets = new Map();
    scratch.traverseVisible((object) => {
      if (!object.isMesh) return;
      calls.scratchMatrices.push(object.matrixWorld.clone());
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      if (!buckets.has(object.material)) buckets.set(object.material, []);
      buckets.get(object.material).push(geometry);
    });
    const out = new THREE.Group();
    for (const [material, geometries] of buckets) {
      const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
      for (const source of geometries) if (source !== geometry) source.dispose();
      out.add(new THREE.Mesh(geometry, material));
    }
    out.userData.merchBaked = true;
    out.userData.merchBakeVisibleOnly = options?.visibleOnly === true;
    return out;
  };
  return api;
}

function worldBoundsCenter(object) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
}

function composedPlacementMatrix(spec, authoredRoot) {
  const placement = new THREE.Object3D();
  placement.position.fromArray(spec.position || [0, 0, 0]);
  placement.rotation.set(...(spec.rotation || [0, 0, 0]));
  if (Array.isArray(spec.scale)) placement.scale.fromArray(spec.scale);
  else placement.scale.setScalar(spec.scale ?? 1);
  placement.updateMatrix();
  authoredRoot.updateMatrix();
  return placement.matrix.clone().multiply(authoredRoot.matrix);
}

function assertMatrixClose(actual, expected, message) {
  const maxDelta = Math.max(...actual.elements.map((value, index) => (
    Math.abs(value - expected.elements[index])
  )));
  assert.ok(maxDelta < 1e-9, `${message}; max matrix delta ${maxDelta}`);
}

function assertVectorClose(actual, expected, message) {
  // BufferGeometry positions are Float32, so transformed baked bounds retain
  // roughly seven decimal digits even though Object3D matrices use Float64.
  assert.ok(actual.distanceTo(expected) < 1e-6,
    `${message}; ${actual.toArray()} vs ${expected.toArray()}`);
}

test('fixture cores bake in identity-local space while authored roots, sockets and helpers survive', () => {
  const model = 'snack_shelf';
  const prototypes = new Map([[model, fixturePrototype(model, { dynamicMesh: true })]]);
  const merch = fakeMerch(prototypes);
  const batcher = createMovableFixtureCoreBatcher(merch);
  const fixture = new THREE.Group();
  fixture.position.set(10, 0, -4);
  fixture.rotation.y = Math.PI / 2;

  const mounted = batcher.mount(
    fixture,
    [{ model, position: [2, 0, 0] }],
    { name: 'SnackFixtureCore' },
  );

  assert.equal(mounted.batched, true);
  assert.equal(merch.calls.bake, 1);
  assert.deepEqual(merch.calls.scratchParents, [null], 'bake scratch never inherits the fixture world pose');
  const bakedLocalPosition = new THREE.Vector3().setFromMatrixPosition(merch.calls.scratchMatrices[0]);
  assert.deepEqual(bakedLocalPosition.toArray(), [3, 0.3, 0], 'scratch contains only model-local arrangement transforms');

  const authoredRoot = fixture.getObjectByName(model);
  const socket = fixture.getObjectByName('STOCK_SLOT_01');
  const collision = fixture.getObjectByName('COL_Fixture');
  const originalBody = fixture.getObjectByName('FixtureBody');
  const dynamic = fixture.getObjectByName('DynamicFixtureIndicator');
  assert.ok(authoredRoot && socket && collision && originalBody && dynamic);
  assert.equal(originalBody.visible, true, 'authored visibility remains available to descendants');
  assert.equal(originalBody.layers.mask, 0, 'only this static mesh leaves the render camera layer');
  assert.equal(originalBody.userData.fixtureCoreRenderSuppressed, true);
  assert.equal(collision.visible, false, 'collision visibility is unchanged');
  assert.equal(dynamic.visible, true, 'hard-excluded dynamic meshes stay in their authored hierarchy');
  const socketInFixture = fixture.worldToLocal(socket.getWorldPosition(new THREE.Vector3()));
  assert.ok(socketInFixture.distanceTo(new THREE.Vector3(2.25, 0.65, 0.1)) < 1e-12,
    'authored socket keeps its exact fixture-local transform');

  const actualCenter = worldBoundsCenter(mounted.visual);
  const expectedCenter = new THREE.Vector3(3, 0.3, 0)
    .applyEuler(fixture.rotation)
    .add(fixture.position);
  assert.ok(actualCenter.distanceTo(expectedCenter) < 1e-6,
    `fixture world transform applies once (${actualCenter.toArray()} vs ${expectedCenter.toArray()})`);
  assert.ok([...mounted.visual.children].every((mesh) => mesh.castShadow && !mesh.receiveShadow));

  fixture.visible = false;
  let rendered = 0;
  const camera = new THREE.PerspectiveCamera();
  fixture.traverseVisible((object) => {
    if (object.isMesh && object.layers.test(camera.layers)) rendered += 1;
  });
  assert.equal(rendered, 0, 'build-mode visibility on the outer fixture root still hides the whole fixture');
});

test('placement rotation composes outside a non-identity authored root and keeps sockets aligned', () => {
  const model = 'apparel_table';
  const prototype = fixturePrototype(model);
  prototype.rotation.x = Math.PI / 2;
  const spec = { model, rotation: [0, Math.PI / 2, 0] };
  const expectedRootMatrix = composedPlacementMatrix(spec, prototype);
  const mounted = createMovableFixtureCoreBatcher(
    fakeMerch(new Map([[model, prototype]])),
  ).mount(new THREE.Group(), [spec]);

  mounted.structure.updateMatrixWorld(true);
  const authoredRoot = mounted.structure.getObjectByName(model);
  const socket = mounted.structure.getObjectByName('STOCK_SLOT_01');
  assertMatrixClose(authoredRoot.matrixWorld, expectedRootMatrix,
    'placement Y rotation must premultiply the authored X rotation');
  assertVectorClose(
    socket.getWorldPosition(new THREE.Vector3()),
    prototype.getObjectByName('STOCK_SLOT_01').position.clone().applyMatrix4(expectedRootMatrix),
    'socket follows the correctly composed authored root rotation',
  );
  assertVectorClose(
    worldBoundsCenter(mounted.visual),
    prototype.getObjectByName('FixtureBody').position.clone().applyMatrix4(expectedRootMatrix),
    'baked visual stays aligned with the composed authored root rotation',
  );
});

test('nonuniform placement scale composes outside an authored root offset and keeps sockets aligned', () => {
  const model = 'apparel_table';
  const prototype = fixturePrototype(model);
  prototype.position.set(1, 0.2, -0.3);
  const spec = { model, scale: [2, 0.5, 1.5] };
  const expectedRootMatrix = composedPlacementMatrix(spec, prototype);
  const mounted = createMovableFixtureCoreBatcher(
    fakeMerch(new Map([[model, prototype]])),
  ).mount(new THREE.Group(), [spec]);

  mounted.structure.updateMatrixWorld(true);
  const authoredRoot = mounted.structure.getObjectByName(model);
  const socket = mounted.structure.getObjectByName('STOCK_SLOT_01');
  assertMatrixClose(authoredRoot.matrixWorld, expectedRootMatrix,
    'placement scale must also scale the authored root offset');
  assertVectorClose(
    socket.getWorldPosition(new THREE.Vector3()),
    prototype.getObjectByName('STOCK_SLOT_01').position.clone().applyMatrix4(expectedRootMatrix),
    'socket follows the correctly composed authored root scale',
  );
  assertVectorClose(
    worldBoundsCenter(mounted.visual),
    prototype.getObjectByName('FixtureBody').position.clone().applyMatrix4(expectedRootMatrix),
    'baked visual stays aligned with the composed authored root scale',
  );
});

test('mesh-local suppression keeps descendant sockets and mounted products visible', () => {
  const model = 'apparel_wall';
  const prototype = fixturePrototype(model);
  const body = prototype.getObjectByName('FixtureBody');
  const socket = prototype.getObjectByName('STOCK_SLOT_01');
  body.add(socket);
  const product = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.18, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x315c43 }),
  );
  product.name = 'MountedStockProduct';
  product.userData.dynamic = true;
  socket.add(product);
  const merch = fakeMerch(new Map([[model, prototype]]));
  const fixture = new THREE.Group();
  const mounted = createMovableFixtureCoreBatcher(merch).mount(fixture, [{ model }]);

  const liveBody = fixture.getObjectByName('FixtureBody');
  const liveSocket = fixture.getObjectByName('STOCK_SLOT_01');
  const liveProduct = fixture.getObjectByName('MountedStockProduct');
  assert.equal(mounted.batched, true);
  assert.equal(liveBody.visible, true);
  assert.equal(liveBody.layers.mask, 0);
  assert.equal(liveSocket.parent, liveBody, 'the authored descendant hierarchy is unchanged');
  assert.equal(liveProduct.parent, liveSocket);
  assert.equal(liveProduct.layers.mask, 1, 'mounted stock remains on the render camera layer');
  const camera = new THREE.PerspectiveCamera();
  const renderedNames = [];
  fixture.traverseVisible((object) => {
    if (object.isMesh && object.layers.test(camera.layers)) renderedNames.push(object.name);
  });
  assert.ok(renderedNames.includes('MountedStockProduct'));
  assert.ok(!renderedNames.includes('FixtureBody'));
});

test('relay-equivalent mounts reuse one owned baked arrangement without geometry growth', () => {
  const model = 'club_rack';
  const prototype = fixturePrototype(model);
  const secondBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.5, 0.2),
    prototype.getObjectByName('FixtureBody').material,
  );
  secondBody.name = 'FixtureRail';
  secondBody.position.set(-0.25, 0.25, 0);
  secondBody.castShadow = true;
  prototype.add(secondBody);
  const merch = fakeMerch(new Map([[model, prototype]]));
  const batcher = createMovableFixtureCoreBatcher(merch);
  const visuals = [];
  const structures = [];

  for (let relay = 0; relay < 20; relay += 1) {
    const fixture = new THREE.Group();
    const mounted = batcher.mount(
      fixture,
      [
        { model, position: [-0.6, 0, 0] },
        { model, position: [0.6, 0, 0] },
      ],
      { name: `ClubRackRelay${relay}` },
    );
    assert.equal(mounted.batched, true);
    assert.equal(mounted.sourceDrawCalls, 4);
    assert.equal(mounted.batchedDrawCalls, 1);
    visuals.push(mounted.visual);
    structures.push(mounted.structure);
    fixture.removeFromParent();
  }

  assert.equal(merch.calls.instantiateKit, 40, 'each relay gets fresh authored roots and sockets');
  assert.equal(merch.calls.bake, 1, 'the identical two-rack arrangement bakes once');
  assert.equal(new Set(structures).size, 20, 'structural fixture roots are never cached or shared');
  assert.equal(new Set(visuals.map((visual) => visual.children[0].geometry)).size, 1,
    'all relay visuals share the one merchandise-owned baked geometry');
  assert.deepEqual(batcher.diagnostics(), {
    cacheEntries: 1,
    bakeCount: 1,
    cacheHits: 19,
    cacheMisses: 1,
    // 825, up from 790: asset 26's bag display now carries real structure
    // (plank deck, welded channel, legs, per-bay cradles) instead of a slab and
    // two posts. The batched ceiling is unchanged at 87 - the extra parts reuse
    // the fixture's existing materials, so the batcher still collapses them.
    expectedUnbatchedDrawCalls: 825,
    expectedBatchedDrawCallCeiling: 87,
  });
});

test('the hard whitelist rejects register/dynamic assets and keeps a no-bake fallback intact', () => {
  const safeModel = 'apparel_table';
  const prototypes = new Map([
    [safeModel, fixturePrototype(safeModel)],
    ['pos_monitor', fixturePrototype('pos_monitor')],
  ]);
  const merch = fakeMerch(prototypes, { bake: false });
  const batcher = createMovableFixtureCoreBatcher(merch);
  const target = new THREE.Group();

  assert.equal(batcher.mount(target, [{ model: 'pos_monitor' }]), null);
  assert.equal(merch.calls.instantiateKit, 0, 'hard exclusions are rejected before instantiation');
  const fallback = batcher.mount(target, [{ model: safeModel }]);
  assert.equal(fallback.batched, false);
  assert.equal(target.getObjectByName('FixtureBody').visible, true,
    'missing batching support preserves the original authored visual');
});

function parseGlb(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

test('the shipped safe fixture arrangement remains inside the exact 87-draw core ceiling', async () => {
  const arrangements = [
    ['ball_shelf', 3, 1],
    ['accessory_slatwall', 3, 2],
    ['club_rack', 2, 2],
    ['putter_rack', 2, 1],
    ['apparel_table', 1, 1],
    ['apparel_wall', 1, 1],
    ['apparel_wall_display', 1, 1],
    ['hat_wall', 1, 1],
    ['bag_display', 1, 1],
    ['shoe_wall', 2, 1],
    ['merch_table', 1, 1],
    ['rangefinder_display', 1, 1],
    ['stock_shelving', 2, 2],
    ['stock_shelving', 1, 1],
    ['snack_shelf', 1, 1],
  ];
  assert.deepEqual(new Set(arrangements.map(([model]) => model)), new Set(MOVABLE_FIXTURE_CORE_MODELS));

  const audit = new Map();
  for (const model of MOVABLE_FIXTURE_CORE_MODELS) {
    const bytes = await readFile(new URL(`../vendor/models/checkout/${model}.glb`, import.meta.url));
    const json = parseGlb(bytes);
    assert.equal((json.animations || []).length, 0, `${model} remains static`);
    const visiblePrimitives = [];
    for (const node of json.nodes || []) {
      if (!Number.isInteger(node.mesh)) continue;
      const helper = node.extras?.helper
        || node.extras?.collision_proxy
        || /^(?:COL_|COLLISION_|VOLUME_)/i.test(String(node.name || ''));
      for (const primitive of json.meshes[node.mesh]?.primitives || []) {
        if (!helper) visiblePrimitives.push(primitive);
      }
    }
    assert.ok(visiblePrimitives.length > 0, `${model} has a visible render core`);
    assert.ok(visiblePrimitives.every((primitive) => !primitive.targets), `${model} has no morph targets`);
    audit.set(model, {
      draws: visiblePrimitives.length,
      materials: new Set(visiblePrimitives.map((primitive) => primitive.material ?? null)).size,
    });
  }

  let unbatched = 0;
  let batchedCeiling = 0;
  for (const [model, modulesPerFixture, fixtureCount] of arrangements) {
    const modelAudit = audit.get(model);
    unbatched += modelAudit.draws * modulesPerFixture * fixtureCount;
    batchedCeiling += modelAudit.materials * fixtureCount;
  }
  assert.deepEqual({ unbatched, batchedCeiling }, MOVABLE_FIXTURE_CORE_DRAW_CALL_BUDGET);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  createSheet06ProductionAssembly,
} from '../src/render3d/assets51to100/sheet06ProductionAssembly.js';

const SCALE = 1.25;

function variant(root, id, {
  dimensions = [1, 1, 0.1],
  finish = false,
  damage = false,
  damageOverlay = false,
  resources,
  sourceMeshes,
  assetNumber,
} = {}) {
  const group = new THREE.Group();
  group.name = `LOD0_${id}`;
  group.visible = false; // Runtime assembly must not inherit parked preview visibility.
  group.userData.variant_id = id;
  group.userData.runtime_variant = true;
  if (finish) group.userData.finish_variant = id;
  if (damage) group.userData.damage_variant = id;
  const geometry = new THREE.BoxGeometry(...dimensions);
  const material = new THREE.MeshStandardMaterial({ color: 0x446644 });
  const counters = { geometry: 0, material: 0 };
  geometry.dispose = () => { counters.geometry += 1; };
  material.dispose = () => { counters.material += 1; };
  resources.push(counters);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `MESH_${id}`;
  if (dimensions[1] <= 0.05) mesh.position.y = dimensions[1] / 2;
  if (damageOverlay) mesh.userData.damage_overlay = true;
  group.add(mesh);
  root.add(group);
  sourceMeshes.get(assetNumber).set(id, mesh);
  return group;
}

function template(assetNumber, definitions, fixture) {
  const root = new THREE.Group();
  root.name = `A_${assetNumber}_ROOT`;
  root.scale.setScalar(SCALE);
  root.position.y = -256;
  root.userData.sheet06ScaleApplications = 1;
  fixture.sourceMeshes.set(assetNumber, new Map());
  for (const definition of definitions) {
    variant(root, definition.id, {
      ...definition,
      assetNumber,
      resources: fixture.resources,
      sourceMeshes: fixture.sourceMeshes,
    });
  }
  const collision = new THREE.Group();
  collision.name = `LOD0_Asset${assetNumber}Collision`;
  const collisionMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  collisionMesh.name = `COL_Asset${assetNumber}_Blocking`;
  collision.add(collisionMesh);
  root.add(collision);
  return root;
}

function templatesFixture() {
  const fixture = { resources: [], sourceMeshes: new Map(), templates: new Map() };
  fixture.templates.set(55, template(55, [
    { id: 'standard', dimensions: [2, 1.7, 0.12] },
    { id: 'narrow', dimensions: [1, 1.7, 0.12] },
    { id: 'wide', dimensions: [2, 1.3, 0.12] },
    { id: 'arched', dimensions: [1.5, 1.7, 0.12] },
    { id: 'construction_cheap_aluminum_municipal', dimensions: [2.19, 1.74, 0.23] },
    { id: 'construction_luxury_country_club_luxury', dimensions: [2.19, 1.74, 0.23] },
  ], fixture));
  fixture.templates.set(56, template(56, [
    { id: 'straight', dimensions: [1.2, 1.15, 0.08] },
    { id: 'inside_corner', dimensions: [0.12, 1.15, 0.12] },
    { id: 'outside_corner', dimensions: [0.12, 1.15, 0.12] },
    { id: 'door_connector', dimensions: [0.12, 1.15, 0.08] },
    { id: 'window_connector', dimensions: [0.12, 1.15, 0.08] },
    { id: 'construction_drywall_municipal', dimensions: [1.2, 1.15, 0.075] },
    { id: 'construction_luxury_moulding_luxury', dimensions: [1.2, 1.15, 0.075] },
  ], fixture));
  // Give the straight panel an independently refreshable damage overlay.
  const panelStraight = fixture.templates.get(56).children.find((child) => child.userData.variant_id === 'straight');
  const overlayGeometry = new THREE.BoxGeometry(0.25, 0.2, 0.01);
  const overlayMaterial = new THREE.MeshBasicMaterial({ color: 0x332211 });
  const overlayCounters = { geometry: 0, material: 0 };
  overlayGeometry.dispose = () => { overlayCounters.geometry += 1; };
  overlayMaterial.dispose = () => { overlayCounters.material += 1; };
  fixture.resources.push(overlayCounters);
  const panelDamage = new THREE.Mesh(overlayGeometry, overlayMaterial);
  panelDamage.name = 'MESH_PanelDamage';
  panelDamage.userData.damage_overlay = true;
  panelDamage.userData.damage_sample_stride = 2;
  panelDamage.userData.damage_sample_offset = 0;
  panelStraight.add(panelDamage);

  fixture.templates.set(57, template(57, [
    { id: 'baseboard', dimensions: [2.4, 0.14, 0.03] },
    { id: 'crown', dimensions: [2.4, 0.14, 0.03] },
    { id: 'chair_rail', dimensions: [2.4, 0.14, 0.03] },
    { id: 'door_casing', dimensions: [2.4, 0.14, 0.03] },
    { id: 'inside_corner', dimensions: [0.12, 0.14, 0.03] },
    { id: 'outside_corner', dimensions: [0.12, 0.14, 0.03] },
    { id: 'end_cap', dimensions: [0.12, 0.14, 0.03] },
    { id: 'junction', dimensions: [0.18, 0.14, 0.03] },
  ], fixture));
  fixture.templates.set(58, template(58, [
    { id: 'straight', dimensions: [3.6, 0.24, 0.2] },
    { id: 'half', dimensions: [1.8, 0.24, 0.2] },
    { id: 'cross_connector', dimensions: [0.6, 0.24, 0.6] },
    { id: 'end_cap', dimensions: [0.12, 0.24, 0.2] },
    { id: 'ceiling_panel', dimensions: [1.8, 0.08, 0.2] },
    { id: 'construction_drop_ceiling_municipal', dimensions: [1.8, 0.08, 0.2] },
    { id: 'construction_luxury_coffered_luxury', dimensions: [1.8, 0.08, 0.2] },
    { id: 'light_mount', dimensions: [0.18, 0.05, 0.18] },
    { id: 'wall_light_mount', dimensions: [0.18, 0.5, 0.12] },
    { id: 'construction_led_panels_municipal', dimensions: [0.7, 0.08, 0.4] },
    { id: 'construction_luxury_chandeliers_luxury', dimensions: [0.9, 1.05, 0.9] },
    { id: 'construction_wall_sconces_luxury', dimensions: [0.24, 0.6, 0.32] },
  ], fixture));
  fixture.templates.set(59, template(59, [
    { id: 'oak', dimensions: [1, 0.02, 1], finish: true },
    { id: 'walnut', dimensions: [1, 0.02, 1], finish: true },
    { id: 'sage_carpet', dimensions: [1, 0.02, 1], finish: true },
    { id: 'cream_tile', dimensions: [1, 0.02, 1], finish: true },
  ], fixture));
  fixture.templates.set(60, template(60, [
    { id: 'damaged_wood', dimensions: [1, 0.03, 1], damage: true },
    { id: 'damaged_carpet', dimensions: [1, 0.035, 1], damage: true },
    { id: 'damaged_tile', dimensions: [1, 0.028, 1], damage: true },
  ], fixture));
  return fixture;
}

function state({
  floorFinish = 'natural-oak',
  floorRestored = false,
  panelsRestored = false,
  windowsRestored = false,
  ceilingFinish = null,
  ceilingQuality = null,
  wallFinish = null,
  wallQuality = null,
  windowFinish = null,
  windowQuality = null,
  lightingFinish = null,
  lightingQuality = null,
} = {}) {
  const result = {
    shop: {
      reno: {
        windows: [0.9, 0.7, 0.5, 0.3],
        grime: [0.8, 0.4, 0.1],
        architecture: {
          components: {
            shell: { restored: false, finish: 'warm-cream' },
            porch: { restored: false, finish: 'natural-oak' },
            windows: { restored: windowsRestored, finish: 'deep-golf-green' },
            panels: { restored: panelsRestored, finish: 'muted-sage' },
            trim: { restored: false, finish: 'warm-cream' },
            ceiling: { restored: false, finish: 'warm-cream' },
            floor: { restored: floorRestored, finish: floorFinish },
          },
        },
      },
    },
  };
  if ((ceilingFinish && ceilingQuality)
    || (wallFinish && wallQuality)
    || (windowFinish && windowQuality)
    || (lightingFinish && lightingQuality)) {
    result.shop.reno.constructionFinishes = {
      installed: {},
    };
    if (ceilingFinish && ceilingQuality) {
      result.shop.reno.constructionFinishes.installed.ceilings = {
        finishId: ceilingFinish, qualityId: ceilingQuality,
      };
    }
    if (wallFinish && wallQuality) {
      result.shop.reno.constructionFinishes.installed.walls = {
        finishId: wallFinish, qualityId: wallQuality,
      };
    }
    if (windowFinish && windowQuality) {
      result.shop.reno.constructionFinishes.installed.windows = {
        finishId: windowFinish, qualityId: windowQuality,
      };
    }
    if (lightingFinish && lightingQuality) {
      result.shop.reno.constructionFinishes.installed.lighting = {
        finishId: lightingFinish, qualityId: lightingQuality,
      };
    }
  }
  return result;
}

function layoutFixture() {
  return {
    shellBounds: { minX: -3, maxX: 3, minZ: -2.5, maxZ: 2.5 },
    exteriorFloorY: 0.3,
    windowSill: 0.85,
    interiorFloorY: 0,
    wallPanelRuns: [
      { id: 'south-panels', start: [-1, 0, -1], end: [1.5, 0, -1] },
    ],
    panelConnectors: [
      { id: 'panel-corner', position: [1.5, 0, -1], variant: 'inside_corner' },
    ],
    trimRuns: [
      { id: 'south-baseboard', start: [-2.5, 0, -1.8], end: [2.5, 0, -1.8] },
    ],
    ceilingY: 3.2,
    beamRuns: [
      { id: 'beam-run', start: [-3.6, 3.2, 0], end: [3.6, 3.2, 0] },
    ],
    beamPlacements: [
      { id: 'ceiling-light', position: [0, 2.05, 0.6], variant: 'light_mount' },
    ],
    wallLightPlacements: [
      { id: 'wall-light', position: [0, 1.45, -1.9], rotationY: 0, variant: 'wall_light_mount' },
    ],
    ceilingPanelRuns: [
      {
        id: 'panel-run', start: [-2.25, 3.12, 1], end: [2.25, 3.12, 1],
        scaleAcross: 2, singleModule: true,
      },
    ],
    interiorBounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
    stockroomBounds: { minX: 1, maxX: 2, minZ: -2, maxZ: 0 },
    floorY: 0,
    damageSites: [
      { id: 'west-damage', x: -1.5, z: -1.5, rotationY: 0 },
      { id: 'entry-damage', x: 0.5, z: 0.5, rotationY: Math.PI / 2 },
    ],
  };
}

function windowDatumsFixture() {
  return [
    { id: 'south-standard', wall: 'S', c: -1, variant: 'standard' },
    { id: 'north-narrow', wall: 'N', c: 1, variant: 'narrow' },
    { id: 'east-wide', wall: 'E', c: 0.25, variant: 'wide' },
    { id: 'west-arched', wall: 'W', c: -0.5, variant: 'arched' },
  ];
}

function fallbacksFixture() {
  return new Map([55, 56, 57, 58, 59, 60].map((number) => {
    const fallback = new THREE.Group();
    fallback.name = `fallback-${number}`;
    fallback.visible = true;
    return [number, fallback];
  }));
}

function findMeshes(root) {
  const meshes = [];
  root.traverse((node) => { if (node.isMesh) meshes.push(node); });
  return meshes;
}

function instanceTransform(mesh, index) {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix);
  matrix.decompose(position, quaternion, scale);
  return { matrix, position, quaternion, scale };
}

function closeTo(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
}

function createCompleteAssembly({ mutateFixture, initialState = state() } = {}) {
  const fixture = templatesFixture();
  mutateFixture?.(fixture);
  const exterior = new THREE.Group();
  const interior = new THREE.Group();
  const fallbacks = fallbacksFixture();
  const assembly = createSheet06ProductionAssembly({
    templates: fixture.templates,
    exterior,
    interior,
    windowDatums: windowDatumsFixture(),
    layout: layoutFixture(),
    state: initialState,
    fallbacks,
  });
  return { fixture, exterior, interior, fallbacks, initialState, assembly };
}

test('production assembly instantiates every stable window and all modular kits from named shared-resource variants', () => {
  const { fixture, fallbacks, assembly } = createCompleteAssembly();
  const diagnostics = assembly.diagnostics();
  assert.equal(diagnostics.assembledKitCount, 6);
  assert.equal(diagnostics.fallbackKitCount, 0);
  assert.equal(diagnostics.instanceCount, 30);
  assert.equal(diagnostics.parkedTemplateSamples, 0);
  assert.equal(diagnostics.glbCollisionObjectsActivated, 0);
  assert.deepEqual(diagnostics.kits.map(({ assetNumber, instanceCount }) => [assetNumber, instanceCount]), [
    [55, 4], [56, 3], [57, 2], [58, 5], [59, 14], [60, 2],
  ]);
  assert.deepEqual(diagnostics.kits.map(({ variants }) => [...variants]), [
    ['arched', 'narrow', 'standard', 'wide'],
    ['inside_corner', 'straight'],
    ['baseboard'],
    ['ceiling_panel', 'construction_led_panels_municipal', 'straight', 'wall_light_mount'],
    ['oak'],
    ['damaged_wood'],
  ]);

  const windows = assembly.getRoot(55);
  assert.equal(windows.children.length, 4);
  assert.deepEqual(windows.children.map((instance) => instance.userData.sheet06Variant), [
    'standard', 'narrow', 'wide', 'arched',
  ]);
  assert.deepEqual(windows.children.map((instance) => instance.position.toArray()), [
    [-1, 1.15, 2.5],
    [1, 1.15, -2.5],
    [3, 1.15, 0.25],
    [-3, 1.15, -0.5],
  ]);
  assert.deepEqual(windows.children.map((instance) => instance.rotation.y), [
    0, Math.PI, Math.PI / 2, -Math.PI / 2,
  ]);
  const standardCloneMesh = findMeshes(windows.children[0])[0];
  const standardSourceMesh = fixture.sourceMeshes.get(55).get('standard');
  assert.equal(standardCloneMesh.geometry, standardSourceMesh.geometry);
  assert.equal(standardCloneMesh.material, standardSourceMesh.material);
  assert.equal(standardCloneMesh.visible, true);
  assert.equal(standardSourceMesh.parent.visible, false, 'parked source visibility is not mutated');

  const panels = assembly.getRoot(56);
  assert.equal(panels.children.every((child) => child.isInstancedMesh), true);
  assert.equal(panels.children.length, 3, 'two straight source meshes and one corner mesh become three batches');
  const straightPanelBatches = panels.children.filter((child) => child.userData.sheet06Variant === 'straight');
  assert.equal(straightPanelBatches.length, 2);
  assert.deepEqual(straightPanelBatches.map((batch) => batch.count).sort(), [1, 2]);
  const straightPanel = straightPanelBatches.find((batch) => batch.userData.damage_overlay !== true);
  const damageOverlay = straightPanelBatches.find((batch) => batch.userData.damage_overlay === true);
  assert.ok(straightPanel);
  assert.ok(damageOverlay);
  assert.equal(damageOverlay.count, 1, 'authored damage stride keeps panel wear sparse');
  assert.deepEqual(damageOverlay.userData.sheet06PlacementIds, ['south-panels-0']);
  assert.equal(damageOverlay.userData.sheet06DamageSampleStride, 2);
  assert.equal(straightPanel.geometry, fixture.sourceMeshes.get(56).get('straight').geometry);
  assert.equal(straightPanel.material, fixture.sourceMeshes.get(56).get('straight').material);
  assert.deepEqual(straightPanel.userData.sheet06PlacementIds, ['south-panels-0', 'south-panels-1']);
  const firstPanel = instanceTransform(straightPanel, 0);
  const secondPanel = instanceTransform(straightPanel, 1);
  closeTo(firstPanel.position.x, -0.375);
  closeTo(firstPanel.position.z, -1);
  closeTo(secondPanel.position.x, 0.875);
  closeTo(firstPanel.scale.x, 1.25 / 1.2);
  closeTo(firstPanel.scale.y, SCALE);
  closeTo(firstPanel.scale.z, SCALE);
  const cornerBatch = panels.children.find((child) => child.userData.sheet06Variant === 'inside_corner');
  assert.equal(cornerBatch.count, 1);
  closeTo(instanceTransform(cornerBatch, 0).position.x, 1.5);

  const trim = assembly.getRoot(57);
  assert.equal(trim.children.length, 1, 'two logical trim placements share one source-mesh batch');
  assert.equal(trim.children[0].isInstancedMesh, true);
  assert.equal(trim.children[0].count, 2);

  const ceiling = assembly.getRoot(58);
  assert.equal(ceiling.children.length, 4, 'beam, ceiling, ceiling-light and wall-light variants each reserve one batch');
  assert.equal(ceiling.children.every((child) => child.isInstancedMesh), true);
  assert.deepEqual(ceiling.children.map((child) => child.userData.sheet06Variant), [
    'straight', 'light_mount', 'ceiling_panel', 'wall_light_mount',
  ]);
  assert.deepEqual(ceiling.children.map((child) => child.count), [2, 1, 1, 1]);

  const floorRoot = assembly.getRoot(59);
  const floorMesh = floorRoot.children[0];
  assert.equal(floorMesh.isInstancedMesh, true);
  assert.equal(floorMesh.count, 14);
  assert.equal(floorMesh.geometry, fixture.sourceMeshes.get(59).get('oak').geometry);
  assert.equal(floorMesh.material, fixture.sourceMeshes.get(59).get('oak').material);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const floorCenters = [];
  for (let index = 0; index < floorMesh.count; index += 1) {
    floorMesh.getMatrixAt(index, matrix);
    matrix.decompose(position, quaternion, scale);
    floorCenters.push([position.x, position.z]);
  }
  assert.deepEqual(floorCenters[0], [-1.5, 0.5]);
  assert.equal(floorCenters.some(([x, z]) => x >= 1 && z <= 0), false, 'stockroom floor is excluded');

  const damageRoot = assembly.getRoot(60);
  assert.equal(damageRoot.children.length, 2);
  assert.ok(Math.abs(damageRoot.children[0].position.y - 0.025) < 1e-8);
  assert.ok(Math.abs(diagnostics.floor.surfaceY - 0.025) < 1e-8);
  assert.equal(diagnostics.floor.damageVisible, true);
  for (const site of damageRoot.children) {
    assert.equal(site.children.filter((child) => child.visible).length, 1);
    assert.match(site.children.find((child) => child.visible).name, /damaged_wood/);
  }

  for (const number of [55, 56, 57, 58, 59, 60]) {
    assert.equal(fallbacks.get(number).visible, false);
    assert.equal(fixture.templates.get(number).position.y, -256);
    const root = assembly.getRoot(number);
    root.traverse((node) => {
      assert.notEqual(node.position.y, -256, `${node.name} must not be a parked sample`);
      assert.doesNotMatch(node.name, /^(?:COL_|.*Collision$)/i);
      if (node.userData.sheet06ScaleApplications !== undefined) {
        assert.ok([0, 1].includes(node.userData.sheet06ScaleApplications));
      }
    });
  }
});

test('batched placement matrices apply meters-to-game-units once and scaleAcross only on local Z', () => {
  const { fixture, assembly } = createCompleteAssembly();
  const ceilingRoot = assembly.getRoot(58);
  const beamBatch = ceilingRoot.children.find((child) => child.userData.sheet06Variant === 'straight');
  const panelBatch = ceilingRoot.children.find((child) => child.userData.sheet06Variant === 'ceiling_panel');
  const beamTransform = instanceTransform(beamBatch, 0);
  const panelTransform = instanceTransform(panelBatch, 0);

  closeTo(beamTransform.scale.x, 1);
  closeTo(beamTransform.scale.y, SCALE);
  closeTo(beamTransform.scale.z, SCALE, 1e-7);
  closeTo(panelTransform.scale.x, 2.5);
  closeTo(panelTransform.scale.y, SCALE);
  closeTo(panelTransform.scale.z, SCALE * 2, 1e-7);
  closeTo(panelTransform.position.x, 0);
  closeTo(panelTransform.position.y, 3.12);
  closeTo(panelTransform.position.z, 1);

  const sourcePanel = fixture.sourceMeshes.get(58).get('ceiling_panel');
  sourcePanel.geometry.computeBoundingBox();
  const sourceSize = sourcePanel.geometry.boundingBox.getSize(new THREE.Vector3());
  closeTo(sourceSize.z, 0.2, 1e-7);
  assert.equal(sourcePanel.parent.visible, false, 'runtime scaleAcross does not mutate the parked source');
  assembly.dispose();
});

test('batch matrices preserve source hierarchy transforms while cancelling the parked template frame', () => {
  const fixture = templatesFixture();
  const sourceMesh = fixture.sourceMeshes.get(56).get('straight');
  const sourceVariant = sourceMesh.parent;
  sourceVariant.position.set(0.2, 0.1, -0.3);
  sourceVariant.rotation.y = 0.25;
  sourceVariant.scale.set(1.1, 0.9, 0.8);
  sourceMesh.position.set(0.05, 0.2, 0.08);
  sourceMesh.rotation.x = -0.15;

  const assembly = createSheet06ProductionAssembly({
    templates: fixture.templates,
    exterior: new THREE.Group(),
    interior: new THREE.Group(),
    windowDatums: windowDatumsFixture(),
    layout: layoutFixture(),
    state: state(),
    fallbacks: fallbacksFixture(),
  });
  const batch = assembly.getRoot(56).children.find((child) => child.geometry === sourceMesh.geometry);
  const actual = new THREE.Matrix4();
  batch.getMatrixAt(0, actual);

  sourceVariant.updateMatrix();
  sourceMesh.updateMatrix();
  const expected = new THREE.Matrix4()
    .makeTranslation(-0.375, 0, -1)
    .multiply(new THREE.Matrix4().makeScale(1.25 / 1.2, SCALE, SCALE))
    .multiply(sourceVariant.matrix)
    .multiply(sourceMesh.matrix);
  actual.elements.forEach((value, index) => closeTo(value, expected.elements[index], 1e-5));
  assert.ok(instanceTransform(batch, 0).position.y > -1, 'parked template Y is not present in the instance');
  assembly.dispose();
});

test('state refresh is read-only, switches borrowed floor resources without rebuild, and independently hides repaired damage', () => {
  const {
    fixture, exterior, interior, fallbacks, initialState, assembly,
  } = createCompleteAssembly({
    mutateFixture: (nextFixture) => {
      // A finish carrier is allowed to have its own authored mesh transform.
      // Runtime finish swaps must rebuild instance matrices from that carrier,
      // not retain the initially selected oak transform.
      nextFixture.sourceMeshes.get(59).get('sage_carpet').rotation.y = Math.PI;
    },
  });
  const initialJson = JSON.stringify(initialState);
  const windowsRoot = assembly.getRoot(55);
  const panelsRoot = assembly.getRoot(56);
  const floorRoot = assembly.getRoot(59);
  const floorMesh = floorRoot.children[0];
  const floorMatrixBefore = new THREE.Matrix4();
  floorMesh.getMatrixAt(0, floorMatrixBefore);
  const damageRoot = assembly.getRoot(60);
  const nextState = state({
    floorFinish: 'muted-sage-carpet',
    floorRestored: true,
    panelsRestored: true,
    windowsRestored: true,
  });
  const nextJson = JSON.stringify(nextState);

  const result = assembly.refreshState(nextState);
  assert.deepEqual(result, { applied: 6, failed: 0, disposed: false, rebuilt: 0 });
  assert.equal(JSON.stringify(initialState), initialJson);
  assert.equal(JSON.stringify(nextState), nextJson);
  assert.equal(assembly.getRoot(55), windowsRoot);
  assert.equal(assembly.getRoot(56), panelsRoot);
  assert.equal(assembly.getRoot(59), floorRoot);
  assert.equal(floorRoot.children[0], floorMesh);
  assert.equal(assembly.getRoot(60), damageRoot);
  assert.equal(floorMesh.count, 14);
  assert.equal(floorMesh.geometry, fixture.sourceMeshes.get(59).get('sage_carpet').geometry);
  assert.equal(floorMesh.material, fixture.sourceMeshes.get(59).get('sage_carpet').material);
  const floorMatrixAfter = new THREE.Matrix4();
  floorMesh.getMatrixAt(0, floorMatrixAfter);
  assert.ok(floorMatrixBefore.elements[0] > 0);
  assert.ok(floorMatrixAfter.elements[0] < 0, 'finish swap applies the selected carrier transform');
  assert.equal(damageRoot.visible, false);
  for (const site of damageRoot.children) {
    const selected = site.children.filter((child) => child.visible);
    assert.equal(selected.length, 1);
    assert.match(selected[0].name, /damaged_carpet/);
  }
  const panelDamage = findMeshes(panelsRoot).filter((mesh) => mesh.userData.damage_overlay === true);
  assert.ok(panelDamage.length > 0);
  assert.equal(panelDamage.every((mesh) => mesh.visible === false), true);
  assert.equal(windowsRoot.children.every((window) => window.userData.sheet06WindowBroken === false), true);
  assert.deepEqual(windowsRoot.children.map((window) => window.userData.sheet06WindowFilm), [0.9, 0.7, 0.5, 0.3]);
  assert.equal(assembly.diagnostics().stateApplications, 2);
  assert.equal(assembly.diagnostics().floor.selectedVariant, 'sage_carpet');
  assert.equal(assembly.diagnostics().floor.damageVariant, 'damaged_carpet');

  const ownedInstancedMeshes = [56, 57, 58, 59]
    .flatMap((number) => findMeshes(assembly.getRoot(number)))
    .filter((mesh) => mesh.isInstancedMesh);
  assert.equal(ownedInstancedMeshes.length, 9);
  const disposeEvents = new Map(ownedInstancedMeshes.map((mesh) => [mesh, 0]));
  for (const mesh of ownedInstancedMeshes) {
    mesh.addEventListener('dispose', () => disposeEvents.set(mesh, disposeEvents.get(mesh) + 1));
  }

  const first = assembly.dispose();
  assert.deepEqual(first, {
    alreadyDisposed: false, removedRoots: 6, restoredFallbacks: 6, disposedResources: 9,
  });
  assert.equal(exterior.children.length, 0);
  assert.equal(interior.children.length, 0);
  assert.equal([...fallbacks.values()].every((fallback) => fallback.visible), true);
  assert.equal(fixture.resources.every(({ geometry, material }) => geometry === 0 && material === 0), true);
  assert.equal(assembly.getRoot(59), null);
  assert.deepEqual(assembly.refreshState(state()), { applied: 0, failed: 0, disposed: true, rebuilt: 0 });
  assert.deepEqual(assembly.dispose(), {
    alreadyDisposed: true, removedRoots: 0, restoredFallbacks: 0, disposedResources: 0,
  });
  assert.equal([...disposeEvents.values()].every((count) => count === 1), true);
  assert.equal(fixture.resources.every(({ geometry, material }) => geometry === 0 && material === 0), true);
});

test('construction ceiling refresh swaps authored resources and transforms while toggling architectural beams', () => {
  const municipalState = state({ ceilingFinish: 'drop-ceiling', ceilingQuality: 'municipal' });
  const luxuryState = state({ ceilingFinish: 'luxury-coffered', ceilingQuality: 'luxury' });
  const { fixture, assembly } = createCompleteAssembly({
    initialState: municipalState,
    mutateFixture: (nextFixture) => {
      // A construction carrier may have its own authored hierarchy transform.
      // Live swaps must recompute matrices from the selected carrier rather
      // than retaining the initially installed drop-ceiling transform.
      nextFixture.sourceMeshes.get(58).get('construction_luxury_coffered_luxury').rotation.y = Math.PI;
    },
  });
  const ceilingRoot = assembly.getRoot(58);
  const panelBatch = findMeshes(ceilingRoot).find(
    (mesh) => mesh.isInstancedMesh && mesh.userData.sheet06Variant === 'ceiling_panel',
  );
  const beamBatches = findMeshes(ceilingRoot).filter(
    (mesh) => mesh.isInstancedMesh && mesh.userData.sheet06Variant === 'straight',
  );
  assert.ok(panelBatch);
  assert.ok(beamBatches.length > 0);
  assert.equal(panelBatch.geometry,
    fixture.sourceMeshes.get(58).get('construction_drop_ceiling_municipal').geometry);
  assert.equal(beamBatches.every((mesh) => mesh.visible === false), true);
  const municipalMatrix = new THREE.Matrix4();
  panelBatch.getMatrixAt(0, municipalMatrix);

  const result = assembly.refreshState(luxuryState);
  assert.deepEqual(result, { applied: 6, failed: 0, disposed: false, rebuilt: 0 });
  assert.equal(assembly.getRoot(58), ceilingRoot, 'live install reuses the production ceiling root');
  assert.equal(panelBatch.geometry,
    fixture.sourceMeshes.get(58).get('construction_luxury_coffered_luxury').geometry);
  assert.equal(panelBatch.material,
    fixture.sourceMeshes.get(58).get('construction_luxury_coffered_luxury').material);
  const luxuryMatrix = new THREE.Matrix4();
  panelBatch.getMatrixAt(0, luxuryMatrix);
  assert.ok(municipalMatrix.elements[0] > 0);
  assert.ok(luxuryMatrix.elements[0] < 0, 'live install applies the selected carrier transform');
  assert.equal(beamBatches.every((mesh) => mesh.visible === true), true);
  assert.deepEqual(assembly.diagnostics().ceiling, {
    selectedVariant: 'construction_luxury_coffered_luxury',
    architecturalBeamsVisible: true,
  });
  assembly.dispose();
});

test('construction lighting refresh switches stable ceiling, wall and landscape mounting modes', () => {
  const ledState = state({ lightingFinish: 'led-panels', lightingQuality: 'municipal' });
  const sconceState = state({ lightingFinish: 'wall-sconces', lightingQuality: 'luxury' });
  const landscapeState = state({ lightingFinish: 'landscape-lighting', lightingQuality: 'luxury' });
  const chandelierState = state({ lightingFinish: 'luxury-chandeliers', lightingQuality: 'luxury' });
  const { fixture, assembly } = createCompleteAssembly({ initialState: ledState });
  const ceilingRoot = assembly.getRoot(58);
  const ceilingBatch = findMeshes(ceilingRoot).find(
    (mesh) => mesh.isInstancedMesh && mesh.userData.sheet06Variant === 'light_mount',
  );
  const wallBatch = findMeshes(ceilingRoot).find(
    (mesh) => mesh.isInstancedMesh && mesh.userData.sheet06Variant === 'wall_light_mount',
  );
  assert.ok(ceilingBatch);
  assert.ok(wallBatch);
  assert.equal(ceilingBatch.visible, true);
  assert.equal(wallBatch.visible, false);
  assert.equal(ceilingBatch.geometry,
    fixture.sourceMeshes.get(58).get('construction_led_panels_municipal').geometry);
  assert.deepEqual(assembly.diagnostics().lighting, {
    selectedVariant: 'construction_led_panels_municipal',
    mountKind: 'ceiling',
    ceilingFixtureCount: 1,
    wallFixtureCount: 1,
    activeFixtureCount: 1,
  });

  assert.deepEqual(assembly.refreshState(sconceState), {
    applied: 6, failed: 0, disposed: false, rebuilt: 0,
  });
  assert.equal(ceilingBatch.visible, false);
  assert.equal(wallBatch.visible, true);
  assert.equal(wallBatch.geometry,
    fixture.sourceMeshes.get(58).get('construction_wall_sconces_luxury').geometry);
  assert.equal(assembly.diagnostics().lighting.mountKind, 'wall');

  assert.deepEqual(assembly.refreshState(landscapeState), {
    applied: 6, failed: 0, disposed: false, rebuilt: 0,
  });
  assert.equal(ceilingBatch.visible, false);
  assert.equal(wallBatch.visible, false);
  assert.deepEqual(assembly.diagnostics().lighting, {
    selectedVariant: 'construction_landscape_lighting_luxury',
    mountKind: 'landscape',
    ceilingFixtureCount: 1,
    wallFixtureCount: 1,
    activeFixtureCount: 24,
  });

  assert.deepEqual(assembly.refreshState(chandelierState), {
    applied: 6, failed: 0, disposed: false, rebuilt: 0,
  });
  assert.equal(ceilingBatch.visible, true);
  assert.equal(wallBatch.visible, false);
  assert.equal(ceilingBatch.geometry,
    fixture.sourceMeshes.get(58).get('construction_luxury_chandeliers_luxury').geometry);
  assert.equal(assembly.diagnostics().lighting.mountKind, 'ceiling');
  assembly.dispose();
});

test('construction wall refresh fits a one-piece carrier into the legacy panel batch and toggles joinery', () => {
  const municipalState = state({
    panelsRestored: true, wallFinish: 'drywall', wallQuality: 'municipal',
  });
  const luxuryState = state({
    panelsRestored: true, wallFinish: 'luxury-moulding', wallQuality: 'luxury',
  });
  const { fixture, assembly } = createCompleteAssembly({
    initialState: municipalState,
    mutateFixture: (nextFixture) => {
      nextFixture.sourceMeshes.get(56).get('construction_luxury_moulding_luxury').rotation.y = Math.PI;
      const straight = nextFixture.templates.get(56).children.find(
        (child) => child.userData.variant_id === 'straight',
      );
      straight.children.reverse();
    },
  });
  const wallRoot = assembly.getRoot(56);
  const straightBatches = findMeshes(wallRoot).filter(
    (mesh) => mesh.isInstancedMesh && mesh.userData.sheet06Variant === 'straight',
  );
  const connectorBatches = findMeshes(wallRoot).filter(
    (mesh) => mesh.isInstancedMesh && mesh.userData.sheet06Variant === 'inside_corner',
  );
  const activePanel = straightBatches.find((mesh) => (
    mesh.geometry === fixture.sourceMeshes.get(56).get('construction_drywall_municipal').geometry
  ));
  assert.ok(activePanel);
  assert.ok(straightBatches.length > 1, 'legacy multi-resource panel reserves its existing batches');
  assert.equal(straightBatches.filter((mesh) => mesh.visible).length, 1,
    'one-piece drywall hides unused legacy panel resources');
  assert.ok(connectorBatches.length > 0);
  assert.equal(connectorBatches.every((mesh) => mesh.visible === false), true);
  const municipalMatrix = new THREE.Matrix4();
  activePanel.getMatrixAt(0, municipalMatrix);

  assert.deepEqual(assembly.refreshState(luxuryState), {
    applied: 6, failed: 0, disposed: false, rebuilt: 0,
  });
  assert.equal(activePanel.geometry,
    fixture.sourceMeshes.get(56).get('construction_luxury_moulding_luxury').geometry);
  const luxuryMatrix = new THREE.Matrix4();
  activePanel.getMatrixAt(0, luxuryMatrix);
  assert.ok(municipalMatrix.elements[0] > 0);
  assert.ok(luxuryMatrix.elements[0] < 0, 'live wall install applies the selected carrier transform');
  assert.equal(connectorBatches.every((mesh) => mesh.visible === true), true);
  assert.deepEqual(assembly.diagnostics().walls, {
    selectedVariant: 'construction_luxury_moulding_luxury',
    walnutJoineryVisible: true,
  });
  assembly.dispose();
});

test('construction window refresh preserves stable aperture instances while replacing cloned resources', () => {
  const municipalState = state({
    windowsRestored: true, windowFinish: 'cheap-aluminum', windowQuality: 'municipal',
  });
  const luxuryState = state({
    windowsRestored: true, windowFinish: 'luxury-country-club', windowQuality: 'luxury',
  });
  const { fixture, assembly } = createCompleteAssembly({ initialState: municipalState });
  const windowsRoot = assembly.getRoot(55);
  const stableInstances = [...windowsRoot.children];
  const municipalGeometry = fixture.sourceMeshes.get(55).get('construction_cheap_aluminum_municipal').geometry;
  const luxuryGeometry = fixture.sourceMeshes.get(55).get('construction_luxury_country_club_luxury').geometry;
  assert.equal(stableInstances.length, 4);
  assert.equal(stableInstances.every((instance) => findMeshes(instance)[0].geometry === municipalGeometry), true);
  assert.equal(stableInstances.every((instance) => instance.userData.sheet06WindowBroken === false), true);

  assert.deepEqual(assembly.refreshState(luxuryState), {
    applied: 6, failed: 0, disposed: false, rebuilt: 0,
  });
  assert.equal(assembly.getRoot(55), windowsRoot);
  assert.equal(windowsRoot.children.every((instance, index) => instance === stableInstances[index]), true,
    'stable aperture placement groups are not rebuilt');
  assert.equal(stableInstances.every((instance) => findMeshes(instance)[0].geometry === luxuryGeometry), true);
  assert.equal(stableInstances.every((instance) => (
    instance.userData.sheet06SelectedVariant === 'construction_luxury_country_club_luxury'
  )), true);
  assert.deepEqual(assembly.diagnostics().windows, {
    selectedVariant: 'construction_luxury_country_club_luxury', instanceCount: 4,
  });
  assembly.dispose();
});

test('missing and malformed templates keep only their own fallbacks visible and leave no partial derived roots', () => {
  const fixture = templatesFixture();
  fixture.templates.delete(56);
  const arched = fixture.templates.get(55).children.find((child) => child.userData.variant_id === 'arched');
  fixture.templates.get(55).remove(arched);
  const creamTile = fixture.templates.get(59).children.find((child) => child.userData.variant_id === 'cream_tile');
  fixture.templates.get(59).remove(creamTile);
  const exterior = new THREE.Group();
  const interior = new THREE.Group();
  const fallbacks = fallbacksFixture();
  const assembly = createSheet06ProductionAssembly({
    templates: fixture.templates,
    exterior,
    interior,
    windowDatums: windowDatumsFixture(),
    layout: layoutFixture(),
    state: state(),
    fallbacks,
  });

  const diagnostics = assembly.diagnostics();
  assert.deepEqual(diagnostics.kits.map(({ status }) => status), [
    'fallback', 'fallback', 'assembled', 'assembled', 'fallback', 'fallback',
  ]);
  assert.deepEqual(diagnostics.kits.map(({ error }) => error?.code ?? null), [
    'VARIANT_MISSING', 'TEMPLATE_MISSING', null, null, 'VARIANT_MISSING', 'FLOOR_AUTHORITY_MISSING',
  ]);
  assert.deepEqual([...fallbacks].map(([number, fallback]) => [number, fallback.visible]), [
    [55, true], [56, true], [57, false], [58, false], [59, true], [60, true],
  ]);
  assert.equal(exterior.children.length, 0);
  assert.deepEqual(interior.children.map((root) => root.userData.sheet06AssetNumber), [57, 58]);
  assert.equal(assembly.getRoot(55), null);
  assert.equal(assembly.getRoot(56), null);
  assert.equal(assembly.getRoot(59), null);
  assert.equal(assembly.getRoot(60), null);
  assert.equal(JSON.stringify(assembly.diagnostics()), JSON.stringify(diagnostics), 'diagnostics are deterministic');

  const disposed = assembly.dispose();
  assert.deepEqual(disposed, {
    alreadyDisposed: false, removedRoots: 2, restoredFallbacks: 2, disposedResources: 5,
  });
  assert.equal([...fallbacks.values()].every((fallback) => fallback.visible), true);
  assert.equal(fixture.resources.every(({ geometry, material }) => geometry === 0 && material === 0), true);
});

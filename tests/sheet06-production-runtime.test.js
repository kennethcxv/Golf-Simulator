import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  SHEET06_FLOOR_VISUAL_CLEARANCE_YD,
  createCompositeVisibilityHandle,
  createSheet06ProductionLayout,
  createSheet06ProductionRuntime,
} from '../src/render3d/assets51to100/sheet06ProductionRuntime.js';

const SUPPRESS_51 = [
  'MESH_MainDoor_CreamCasing',
  'MESH_WindowMid_CreamCasing',
  'MESH_WindowWest_CreamCasing',
];
const SUPPRESS_52 = [
  'MESH_AlignedFrontWeatherSkin',
  'MESH_AlignedBackWeatherSkin',
  'MESH_AlignedEastWeatherSkin',
  'MESH_AlignedWestWeatherSkin',
  'MESH_FoundationDampBandFront',
  'MESH_FoundationDampBandBack',
];
const FALLBACK_KEYS = [
  'exteriorShellStructure', 'apertureTrim', 'porchVisuals', 'windowVisuals',
  'renovatedFloor', 'ceilingVisuals', 'wainscotPanels', 'interiorTrim',
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function renderMesh(name, { castShadow = true, receiveShadow = true } = {}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.2),
    new THREE.MeshStandardMaterial(),
  );
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

function namedGroup(name) {
  const group = new THREE.Group();
  group.name = name;
  return group;
}

function assetRoot(number) {
  const root = namedGroup(`ASSET_${number}_ROOT`);
  root.add(renderMesh(`Asset${number}Renderable`));
  if (number === 51) {
    for (const name of SUPPRESS_51) root.add(namedGroup(name));
    root.add(namedGroup('MESH_FieldstoneWaterTable'));
    for (const variant of ['construction_garage_door_municipal', 'construction_garage_door_luxury']) {
      const mesh = renderMesh(`Garage_${variant}`);
      mesh.userData.construction_garage_variant = variant;
      root.add(mesh);
    }
    for (const variant of ['construction_landscape_lighting_municipal', 'construction_landscape_lighting_luxury']) {
      const mesh = renderMesh(`Landscape_${variant}`);
      mesh.userData.construction_lighting_variant = variant;
      root.add(mesh);
    }
  }
  if (number === 52) {
    for (const name of SUPPRESS_52) root.add(namedGroup(name));
    root.add(namedGroup('MESH_RoofMoldPatch'));
    root.add(namedGroup('MESH_MossPatch'));
    root.add(namedGroup('MESH_BoardedWindow'));
    for (const name of ['MESH_BoardedApertureDamage', 'MESH_BoardedApertureFasteners']) {
      root.add(namedGroup(name));
    }
    root.add(namedGroup('MESH_WarpedTrim'));
  }
  if (number === 53) {
    const left = namedGroup('PIVOT_DoorLeft');
    const right = namedGroup('PIVOT_DoorRight');
    for (const [side, pivot] of [['Left', left], ['Right', right]]) {
      const legacy = renderMesh(`Door${side}LegacyVisual`);
      legacy.userData.construction_door_legacy_visual = true;
      pivot.add(legacy);
      for (const variant of ['construction_hollow_core_municipal', 'construction_double_entry_luxury']) {
        const mesh = renderMesh(`Door${side}_${variant}`);
        mesh.userData.construction_door_variant = variant;
        pivot.add(mesh);
      }
    }
    root.add(left, right);
  }
  return root;
}

function fallbackHandle(name, visibility = [true]) {
  const nodes = visibility.map((visible, index) => {
    const node = namedGroup(`${name}-${index}`);
    node.visible = visible;
    return node;
  });
  return Object.freeze({
    name,
    nodes: Object.freeze(nodes),
    getVisible: () => nodes.some((node) => node.visible),
    setVisible(value) { for (const node of nodes) node.visible = Boolean(value); },
  });
}

function fallbacks(overrides = {}) {
  return Object.fromEntries(FALLBACK_KEYS.map((key, index) => [
    key,
    overrides[key] || fallbackHandle(key, index === 5 ? [false, true] : [true]),
  ]));
}

function fakeAdapterFactory({ gate = null, roots = null, log = [], captures = {} } = {}) {
  const resources = Object.freeze({ token: Symbol('cache-owned') });
  const byNumber = roots || new Map(Array.from({ length: 10 }, (_, index) => {
    const number = 51 + index;
    return [number, assetRoot(number)];
  }));
  return (options) => {
    captures.adapterOptions = options;
    for (const [number, root] of byNumber) {
      (number <= 55 ? options.group : options.interior).add(root);
    }
    return {
      ready: gate?.promise || Promise.resolve(),
      getRoot: (number) => byNumber.get(Number(number)) || null,
      borrowedResources: () => resources,
      diagnostics: () => ({ fake: true }),
      update(dt) { log.push(['adapter-update', dt]); return 11; },
      async applyState(nextState) {
        log.push(['adapter-state', nextState]);
        const left = byNumber.get(53)?.getObjectByName('PIVOT_DoorLeft');
        const right = byNumber.get(53)?.getObjectByName('PIVOT_DoorRight');
        if (left) left.rotation.y = 100;
        if (right) right.rotation.y = -100;
        return { applied: 10 };
      },
      dispose() { log.push('adapter-dispose'); return { disposed: true }; },
    };
  };
}

function fakeAssemblyFactory({ complete = true, log = [], captures = {} } = {}) {
  return (options) => {
    captures.assemblyOptions = options;
    const roots = new Map();
    for (let number = 55; number <= 60; number += 1) {
      const root = namedGroup(`ASSEMBLY_${number}`);
      root.add(renderMesh(`Assembly${number}Renderable`));
      (number === 55 ? options.exterior : options.interior).add(root);
      roots.set(number, root);
    }
    let disposed = false;
    return {
      getRoot: (number) => roots.get(Number(number)) || null,
      diagnostics: () => ({
        glbCollisionObjectsActivated: 0,
        kits: Array.from({ length: 6 }, (_, index) => ({
          assetNumber: 55 + index,
          status: complete || index < 5 ? 'assembled' : 'fallback',
        })),
      }),
      update(dt) { log.push(['assembly-update', dt]); return 22; },
      async applyState(nextState) { log.push(['assembly-state', nextState]); return { applied: 6 }; },
      dispose() {
        log.push('assembly-dispose');
        if (disposed) return { alreadyDisposed: true, disposedResources: 0 };
        disposed = true;
        for (const root of roots.values()) root.parent?.remove(root);
        return { alreadyDisposed: false, disposedResources: 0 };
      },
    };
  };
}

function fakeDoorApi({ log = [], failBind = false } = {}) {
  let bound = null;
  let bindCount = 0;
  return {
    bindMainEntranceVisual(root) {
      log.push('door-bind');
      bindCount += 1;
      if (failBind) return { ok: false, reason: 'test-bind-failure' };
      bound = root;
      root.getObjectByName('PIVOT_DoorLeft').rotation.y = 0.25;
      root.getObjectByName('PIVOT_DoorRight').rotation.y = -0.25;
      return { ok: true, leafCount: 2 };
    },
    unbindMainEntranceVisual() { log.push('door-unbind'); bound = null; return { wasBound: true }; },
    syncMainEntranceFromState(state) { log.push(['door-state', state]); return { ok: true }; },
    mainEntranceDiagnostics: () => ({ authoredBound: Boolean(bound), bindCount }),
  };
}

function fakeLightingApi({ log = [] } = {}) {
  let visible = true;
  return {
    setLegacyFixtureVisualsVisible(nextVisible) {
      visible = Boolean(nextVisible);
      log.push(`lighting-visuals-${visible}`);
      return { visible, visualCount: 3 };
    },
    diagnostics: () => ({ visible }),
  };
}

function captureVisibility(registry) {
  return Object.fromEntries(Object.entries(registry).map(([key, handle]) => [
    key,
    Array.isArray(handle.nodes) ? handle.nodes.map((node) => node.visible) : handle.visible,
  ]));
}

test('production layout deterministically covers windows, perimeter/service finishes, ceiling and sparse floor damage', () => {
  const layout = createSheet06ProductionLayout();
  assert.equal(Object.isFrozen(layout), true);
  assert.equal(layout.windowDatums.length, 4);
  assert.deepEqual(layout.windowDatums.map((datum) => datum.wall), ['S', 'S', 'N', 'E']);
  assert.ok(layout.wallPanelRuns.some((run) => run.id.includes('partition-a')));
  assert.ok(layout.wallPanelRuns.some((run) => run.id.includes('partition-b')));
  const roomFacingContracts = new Map([
    ['south', { rotationY: Math.PI, normal: [0, 0, -1] }],
    ['north', { rotationY: 0, normal: [0, 0, 1] }],
    ['west', { rotationY: Math.PI / 2, normal: [1, 0, 0] }],
    ['east', { rotationY: -Math.PI / 2, normal: [-1, 0, 0] }],
    ['partition-a-west', { rotationY: -Math.PI / 2, normal: [-1, 0, 0] }],
    ['partition-a-east', { rotationY: Math.PI / 2, normal: [1, 0, 0] }],
    ['partition-b-north', { rotationY: Math.PI, normal: [0, 0, -1] }],
    ['partition-b-south', { rotationY: 0, normal: [0, 0, 1] }],
  ]);
  for (const [line, contract] of roomFacingContracts) {
    const runs = layout.wallPanelRuns.filter((run) => run.id.startsWith(`panel-${line}-`));
    assert.ok(runs.length > 0, `${line} retains at least one panel run`);
    for (const run of runs) {
      assert.equal(run.rotationY, contract.rotationY, `${run.id} uses its explicit face rotation`);
      const actualNormal = [Math.sin(run.rotationY), 0, Math.cos(run.rotationY)]
        .map((value) => Math.abs(value) < 1e-12 ? 0 : value);
      assert.deepEqual(actualNormal, contract.normal, `${run.id} presents local +Z into its room`);
    }
  }
  for (const variant of ['baseboard', 'chair_rail', 'crown']) {
    assert.ok(layout.trimRuns.some((run) => run.variant === variant), `${variant} is placed`);
  }
  assert.equal(layout.beamRuns.length, 6, 'reference-like three-by-three coffer rhythm');
  assert.ok(layout.beamRuns.every((run) => run.singleModule === true), 'each coffer run uses one continuous scale-safe beam');
  assert.equal(layout.ceilingPanelRuns.length, 10, 'roughly 1.2 m ceiling rows cover the room depth');
  assert.ok(layout.ceilingPanelRuns.every((run) => run.singleModule !== true),
    'finish rows retain repeating bays instead of stretching one authored strip');
  assert.ok(layout.ceilingPanelRuns.every((run) => run.scaleAcross > 5 && run.scaleAcross < 7),
    'the 0.20 m source carrier expands only to a believable architectural bay depth');
  assert.equal(new Set(layout.ceilingPanelRuns.map((run) => run.start.z)).size, 10,
    'each carrier row occupies its own depth datum');
  assert.equal(layout.beamPlacements.length, 8, 'recessed mounts remain restrained between coffers');
  assert.ok(layout.beamPlacements.every((placement) => placement.variant === 'light_mount'));
  assert.equal(layout.wallLightPlacements.length, 10, 'wall sconces retain their own perimeter datums');
  assert.ok(layout.wallLightPlacements.every((placement) => placement.variant === 'wall_light_mount'));
  assert.equal(layout.damageSites.length, 5);
  assert.ok(layout.damageSites.length >= 4 && layout.damageSites.length <= 6);
  assert.ok(layout.damageSites.every(({ rotationY }) => Math.abs(rotationY % Math.PI) < 1e-9),
    'wood-floor damage modules must remain parallel to the Asset 59 plank axis');
  assert.ok(Math.abs(
    layout.floorY + (0.018 / 0.9144) - SHEET06_FLOOR_VISUAL_CLEARANCE_YD,
  ) < 1e-9, '18 mm finish clears the structural foundation without changing collision');
  assert.ok(SHEET06_FLOOR_VISUAL_CLEARANCE_YD <= 0.002,
    'visual depth clearance stays below two millimetres in game-space units');
  assert.deepEqual(layout.stockroomBounds, { minX: 5.7, maxX: 10.25, minZ: -6.5, maxZ: 2 });
  assert.ok(layout.damageSites.every((site) => !(
    site.x >= layout.stockroomBounds.minX
    && site.x <= layout.stockroomBounds.maxX
    && site.z >= layout.stockroomBounds.minZ
    && site.z <= layout.stockroomBounds.maxZ
  )));
});

test('composite visibility lease restores mixed child and opaque-handle state exactly', () => {
  const nodeHandle = fallbackHandle('mixed', [true, false, true]);
  const opaque = { visible: false };
  const composite = createCompositeVisibilityHandle('test-composite', [nodeHandle, opaque]);
  composite.setVisible(false);
  assert.deepEqual(nodeHandle.nodes.map((node) => node.visible), [false, false, false]);
  assert.equal(opaque.visible, false);
  composite.restore();
  assert.deepEqual(nodeHandle.nodes.map((node) => node.visible), [true, false, true]);
  assert.equal(opaque.visible, false);
  composite.restore();
  assert.deepEqual(nodeHandle.nodes.map((node) => node.visible), [true, false, true]);
});

test('runtime stages invisibly, activates all ten assets atomically, forwards state/update, and disposes in ownership order', async () => {
  const group = new THREE.Group();
  const interior = new THREE.Group();
  const gate = deferred();
  const log = [];
  const captures = {};
  const registry = fallbacks();
  const originalFallbacks = captureVisibility(registry);
  const adapterFactory = fakeAdapterFactory({ gate, log, captures });
  const assemblyFactory = fakeAssemblyFactory({ log, captures });
  const doorApi = fakeDoorApi({ log });
  const lightingApi = fakeLightingApi({ log });
  const state = { shop: { reno: {
    architecture: { doors: { main: { left: 'closed', right: 'open' } } },
    constructionFinishes: { installed: {
      doors: { finishId: 'hollow-core', qualityId: 'municipal' },
      'garage-doors': { finishId: 'garage-door', qualityId: 'municipal' },
      lighting: { finishId: 'led-panels', qualityId: 'municipal' },
    } },
  } } };
  const stateBefore = JSON.stringify(state);

  const runtime = createSheet06ProductionRuntime({
    group, interior, state, shellFallbacks: registry, doorApi, lightingApi, adapterFactory, assemblyFactory,
  });
  assert.equal(runtime.mounts.exteriorStaging.visible, false);
  assert.equal(runtime.mounts.interiorStaging.visible, false);
  assert.equal(runtime.mounts.exteriorLive.visible, false);
  assert.equal(runtime.mounts.interiorLive.visible, false);
  assert.deepEqual(captureVisibility(registry), originalFallbacks);
  assert.equal(runtime.diagnostics().actualSharedGameIntegrated, false);
  assert.equal(captures.adapterOptions.fallbacks && Object.keys(captures.adapterOptions.fallbacks).length, 0);

  gate.resolve();
  const activated = await runtime.ready;
  assert.equal(activated.actualSharedGameIntegrated, true);
  assert.equal(activated.loadedAssetCount, 10);
  assert.equal(activated.assembledKitCount, 6);
  assert.equal(activated.glbCollisionObjectsActivated, 0);
  assert.equal(activated.hiddenFallbackCount, 7);
  assert.equal(activated.hiddenTemplateCount, 6);
  assert.equal(activated.legacyLightingVisualsHidden, true);
  assert.equal(activated.suppressionCount, 9);
  assert.equal(activated.apertureBoardingHidden, false);
  assert.deepEqual(activated.door.construction, {
    selectedVariant: 'construction_hollow_core_municipal',
    taggedNodeCount: 4,
    visibleTaggedNodeCount: 2,
    legacyMeshCount: 2,
  });
  assert.deepEqual(activated.garageDoor, {
    selectedVariant: 'construction_garage_door_municipal',
    taggedNodeCount: 2,
    visibleTaggedNodeCount: 1,
  });
  assert.deepEqual(activated.landscapeLighting, {
    selectedVariant: null,
    active: false,
    taggedNodeCount: 2,
    visibleTaggedNodeCount: 0,
    lightSourceCount: 3,
    lightSourcesActive: false,
  });
  assert.equal(activated.layout.windowCount, 4);
  assert.equal(activated.layout.damageSiteCount, 5);
  assert.equal(captures.assemblyOptions.exterior, runtime.mounts.exteriorLive);
  assert.equal(captures.assemblyOptions.interior, runtime.mounts.interiorLive);
  assert.equal(captures.assemblyOptions.fallbacks && Object.keys(captures.assemblyOptions.fallbacks).length, 0);
  assert.equal(runtime.mounts.exteriorStaging.visible, true);
  assert.equal(runtime.mounts.interiorStaging.visible, true);
  assert.equal(runtime.mounts.exteriorLive.visible, true);
  assert.equal(runtime.mounts.interiorLive.visible, true);

  for (const name of SUPPRESS_51) assert.equal(runtime.getRoot(51).getObjectByName(name).visible, false);
  for (const name of SUPPRESS_52) assert.equal(runtime.getRoot(52).getObjectByName(name).visible, false);
  for (const name of ['MESH_RoofMoldPatch', 'MESH_MossPatch', 'MESH_BoardedWindow', 'MESH_WarpedTrim']) {
    assert.equal(runtime.getRoot(52).getObjectByName(name).visible, true, `${name} remains authoritative`);
  }
  for (let number = 55; number <= 60; number += 1) {
    assert.equal(runtime.getRoot(number).visible, false);
    assert.equal(runtime.getRoot(number).parent, null,
      `Asset ${number} template library is detached from the live scene after assembly`);
  }
  assert.ok(Object.values(registry).every((handle) => (
    Array.isArray(handle.nodes) ? handle.nodes.every((node) => !node.visible) : !handle.visible
  )));
  assert.equal(runtime.getRoot(51).getObjectByName('Asset51Renderable').castShadow, true);
  const interiorMeshes = [];
  runtime.mounts.interiorStaging.traverse((node) => { if (node.isMesh) interiorMeshes.push(node); });
  runtime.mounts.interiorLive.traverse((node) => { if (node.isMesh) interiorMeshes.push(node); });
  assert.ok(interiorMeshes.length > 0);
  assert.ok(interiorMeshes.every((mesh) => mesh.castShadow === false));
  assert.ok(interiorMeshes.every((mesh) => mesh.receiveShadow === true));
  assert.equal(activated.interiorShadowMeshCount, interiorMeshes.length);

  assert.deepEqual(runtime.update(0.125), { disposed: false, adapter: 11, assembly: 22 });
  const nextState = { shop: { reno: {
    architecture: { doors: { main: { left: 'open', right: 'closed' } } },
    constructionFinishes: { installed: {
      doors: { finishId: 'double-entry', qualityId: 'luxury' },
      'garage-doors': { finishId: 'garage-door', qualityId: 'luxury' },
      lighting: { finishId: 'landscape-lighting', qualityId: 'luxury' },
    } },
  } } };
  const nextBefore = JSON.stringify(nextState);
  const applied = await runtime.applyState(nextState);
  assert.equal(applied.active, true);
  assert.deepEqual(applied.adapter, { applied: 10 });
  assert.deepEqual(applied.assembly, { applied: 6 });
  assert.equal(runtime.getRoot(53).getObjectByName('PIVOT_DoorLeft').rotation.y, 0.25,
    'door controller immediately reasserts the live angle after adapter state writes');
  assert.equal(runtime.getRoot(53).getObjectByName('PIVOT_DoorRight').rotation.y, -0.25);
  assert.equal(runtime.diagnostics().door.construction.selectedVariant, 'construction_double_entry_luxury');
  assert.equal(runtime.diagnostics().garageDoor.selectedVariant, 'construction_garage_door_luxury');
  assert.deepEqual(runtime.diagnostics().landscapeLighting, {
    selectedVariant: 'construction_landscape_lighting_luxury',
    active: true,
    taggedNodeCount: 2,
    visibleTaggedNodeCount: 1,
    lightSourceCount: 3,
    lightSourcesActive: true,
  });
  assert.equal(runtime.getRoot(51).getObjectByName('Garage_construction_garage_door_municipal').visible, false);
  assert.equal(runtime.getRoot(51).getObjectByName('Garage_construction_garage_door_luxury').visible, true);
  assert.equal(runtime.getRoot(51).getObjectByName('Landscape_construction_landscape_lighting_municipal').visible, false);
  assert.equal(runtime.getRoot(51).getObjectByName('Landscape_construction_landscape_lighting_luxury').visible, true);
  assert.equal(runtime.diagnostics().apertureBoardingHidden, true);
  const selectedDoorMeshes = [];
  runtime.getRoot(53).traverse((node) => {
    if (node.isMesh && node.userData.construction_door_variant && node.visible) selectedDoorMeshes.push(node);
  });
  assert.equal(selectedDoorMeshes.length, 2);
  assert.ok(selectedDoorMeshes.every((mesh) => mesh.userData.construction_door_variant === 'construction_double_entry_luxury'));
  assert.equal(JSON.stringify(nextState), nextBefore);
  assert.equal(JSON.stringify(state), stateBefore);
  const borrowed = runtime.borrowedResources();
  assert.equal(runtime.borrowedResources(), borrowed, 'borrowed cache identity is forwarded, not cloned');

  log.length = 0;
  const grimeOnlyState = structuredClone(nextState);
  grimeOnlyState.shop.reno.surfaceGrime = { floor: 0.42, walls: 0.18 };
  const grimeApplied = await runtime.applyState(grimeOnlyState);
  assert.deepEqual(grimeApplied.adapter, {
    applied: 0,
    failed: 0,
    skippedUnchangedArchitecture: true,
  });
  assert.deepEqual(grimeApplied.assembly, {
    applied: false,
    skippedUnchangedVisualState: true,
  });
  assert.equal(grimeApplied.door, null);
  assert.deepEqual(log, [],
    'grime-only simulation ticks do not rebuild adapters, finishes, or the door controller');

  log.length = 0;
  const disposed = runtime.dispose();
  assert.equal(disposed.disposedResources, 0);
  assert.deepEqual(log.slice(0, 3), ['assembly-dispose', 'door-unbind', 'adapter-dispose']);
  assert.equal(log.at(-1), 'lighting-visuals-true');
  assert.deepEqual(captureVisibility(registry), originalFallbacks);
  for (const name of [...SUPPRESS_51, ...SUPPRESS_52]) {
    const root = name.includes('Weather') || name.includes('Damp') ? 52 : 51;
    assert.equal((root === 51 ? captures.adapterOptions.group : captures.adapterOptions.group)
      .getObjectByName(name)?.visible ?? true, true);
  }
  assert.equal(group.children.includes(runtime.mounts.exteriorStaging), false);
  assert.equal(interior.children.includes(runtime.mounts.interiorStaging), false);
  assert.equal(runtime.diagnostics().actualSharedGameIntegrated, false);
  assert.equal(runtime.dispose().alreadyDisposed, true);
});

test('activation failure rolls back suppression, templates, door binding, and every previously hidden fallback', async () => {
  const group = new THREE.Group();
  const interior = new THREE.Group();
  const log = [];
  const roots = new Map(Array.from({ length: 10 }, (_, index) => [51 + index, assetRoot(51 + index)]));
  roots.get(51).getObjectByName(SUPPRESS_51[1]).visible = false;
  roots.get(56).visible = false;
  const bad = {
    _visible: true,
    get visible() { return this._visible; },
    set visible(value) {
      if (value === false) throw new Error('intentional fallback failure');
      this._visible = value;
    },
  };
  const registry = fallbacks({ interiorTrim: bad });
  registry.ceilingVisuals.nodes[0].visible = false;
  const originalFallbacks = captureVisibility(registry);
  const doorApi = fakeDoorApi({ log });
  const runtime = createSheet06ProductionRuntime({
    group,
    interior,
    state: {},
    shellFallbacks: registry,
    doorApi,
    adapterFactory: fakeAdapterFactory({ roots, log }),
    assemblyFactory: fakeAssemblyFactory({ log }),
  });

  const result = await runtime.ready;
  assert.equal(result.actualSharedGameIntegrated, false);
  assert.equal(result.activationStatus, 'fallback');
  assert.equal(result.activationError.code, 'ACTIVATION_FAILED');
  assert.match(result.activationError.message, /intentional fallback failure/);
  assert.deepEqual(captureVisibility(registry), originalFallbacks);
  assert.equal(roots.get(51).getObjectByName(SUPPRESS_51[0]).visible, true);
  assert.equal(roots.get(51).getObjectByName(SUPPRESS_51[1]).visible, false,
    'pre-existing mixed visibility is restored');
  assert.ok(SUPPRESS_52.every((name) => roots.get(52).getObjectByName(name).visible));
  assert.equal(roots.get(55).visible, true);
  assert.equal(roots.get(56).visible, false, 'pre-existing hidden template stays hidden');
  assert.equal(runtime.mounts.exteriorStaging.visible, false);
  assert.equal(runtime.mounts.interiorStaging.visible, false);
  assert.ok(log.includes('door-unbind'));
  assert.ok(log.includes('assembly-dispose'));
  runtime.dispose();
});

test('incomplete kit diagnostics fail closed before any fallback or door is changed', async () => {
  const group = new THREE.Group();
  const interior = new THREE.Group();
  const log = [];
  const registry = fallbacks();
  const original = captureVisibility(registry);
  const runtime = createSheet06ProductionRuntime({
    group,
    interior,
    state: {},
    shellFallbacks: registry,
    doorApi: fakeDoorApi({ log }),
    adapterFactory: fakeAdapterFactory({ log }),
    assemblyFactory: fakeAssemblyFactory({ complete: false, log }),
  });
  const result = await runtime.ready;
  assert.equal(result.actualSharedGameIntegrated, false);
  assert.equal(result.activationError.code, 'ASSEMBLY_INCOMPLETE');
  assert.deepEqual(captureVisibility(registry), original);
  assert.equal(log.includes('door-bind'), false);
  assert.ok(log.includes('assembly-dispose'));
  runtime.dispose();
});

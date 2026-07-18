import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { defaultClubhouseArchitecture } from '../src/sim/clubhouseRestoration.js';
import { SHEET06_RUNTIME_BY_NUMBER } from '../src/render3d/assets51to100/sheet06Architecture.js';
import {
  SHEET06_GROUP_FLOOR_Y,
  SHEET06_INTERIOR_FLOOR_Y,
  SHEET06_KIT_INSTANTIATION_POLICY,
  SHEET06_TEMPLATE_STORAGE_Y,
  SHEET06_WINDOW_DATUMS,
  applySheet06ClubhouseAssetState,
  createSheet06ClubhouseAdapter,
  createSheet06PlacementResolver,
  readSheet06ClubhouseState,
  resolveSheet06Placement,
} from '../src/render3d/assets51to100/sheet06ClubhouseAdapter.js';

function stateWith(mutator = () => {}) {
  const architecture = defaultClubhouseArchitecture();
  const state = {
    shop: {
      reno: {
        windows: [0.9, 0.7, 0.5, 0.3],
        grime: [0, 0, 0, 0],
        wash: { porch: { grime: [0.8, 0.4] } },
        architecture,
      },
    },
  };
  mutator(state, architecture);
  return state;
}

function namedRoot(number, names) {
  const root = new THREE.Group();
  root.name = SHEET06_RUNTIME_BY_NUMBER[number].rootName;
  for (const name of names) {
    const node = new THREE.Group();
    node.name = name;
    root.add(node);
  }
  return root;
}

function apply(number, root, state, extra = {}) {
  return applySheet06ClubhouseAssetState({
    binding: SHEET06_RUNTIME_BY_NUMBER[number],
    root,
    state,
    ...extra,
  });
}

test('placement resolver matches current group/interior coordinates and never applies scale', () => {
  assert.equal(SHEET06_GROUP_FLOOR_Y, 0.3);
  assert.equal(SHEET06_INTERIOR_FLOOR_Y, 0);

  const p51 = resolveSheet06Placement(SHEET06_RUNTIME_BY_NUMBER[51]);
  const p52 = resolveSheet06Placement(SHEET06_RUNTIME_BY_NUMBER[52]);
  assert.deepEqual(p51.position, [0, 0, 0]);
  assert.deepEqual(p52.position, p51.position, 'damage overlays share the canonical structural origin');
  assert.equal(p51.mountRoot, 'group');
  assert.equal(p52.mountRoot, 'group');

  const p53 = resolveSheet06Placement(SHEET06_RUNTIME_BY_NUMBER[53]);
  assert.deepEqual(p53.position, [-0.8, 0.3, 6.75]);
  assert.equal(p53.datum, 'MAIN_ENTRANCE_THRESHOLD_CENTER');

  const p54 = resolveSheet06Placement(SHEET06_RUNTIME_BY_NUMBER[54]);
  assert.deepEqual(p54.position, [-1, 0, 6.75]);
  assert.match(p54.datum, /SOCKET_Porch/);
  assert.ok(Math.abs(p54.position[1] + 0.27432 * 1.0936133 - SHEET06_GROUP_FLOOR_Y) < 1e-8,
    'the scaled authored porch entrance marker lands on the group finished floor');
  assert.deepEqual(
    [p54.position[0], SHEET06_GROUP_FLOOR_Y, p54.position[2]],
    [-1, p53.position[1], p53.position[2]],
    'porch and entrance resolve against the same registered south-wall marker plane',
  );

  const parked = [];
  for (let number = 55; number <= 60; number += 1) {
    const placement = resolveSheet06Placement(SHEET06_RUNTIME_BY_NUMBER[number]);
    assert.equal(placement.position[1], SHEET06_TEMPLATE_STORAGE_Y);
    assert.equal(placement.policy, SHEET06_KIT_INSTANTIATION_POLICY[number]);
    assert.equal(placement.scaleApplications, 0);
    assert.equal('scale' in placement, false);
    parked.push(placement.position.join(','));
  }
  assert.equal(new Set(parked).size, 6, 'template roots are spread instead of overlapping each other');

  const mount = new THREE.Group();
  const root = new THREE.Group();
  root.scale.setScalar(1.0936133);
  const resolved = createSheet06PlacementResolver()({
    binding: SHEET06_RUNTIME_BY_NUMBER[56], root, mount,
  });
  assert.equal(resolved.parent, mount);
  assert.equal('scale' in resolved, false);
  assert.equal(root.scale.x, 1.0936133, 'placement leaves the cache-owned conversion untouched');
  assert.equal(root.userData.sheet06TemplateOnly, true);
  assert.equal(root.userData.sheet06DirectArchitectureInstance, false);
});

test('assets 51 and 52 retain one structural authority and aligned additive state', () => {
  const state = stateWith();
  const before = structuredClone(state);
  const root51 = namedRoot(51, [
    'LOD0_StructuralShell', 'LOD0_RoofStructure', 'LOD0_ExteriorDetails',
    'FinishWarmCream', 'FinishMutedSage',
  ]);
  const root52 = namedRoot(52, [
    'LOD0_WallDamage', 'LOD0_RoofDamage', 'LOD0_TrimDamage', 'LOD0_DamageRaycast',
  ]);

  apply(51, root51, state);
  apply(52, root52, state);
  assert.equal(root51.userData.sheet06StructuralAuthority, true);
  assert.equal(root52.userData.sheet06StructuralAuthority, false);
  assert.equal(root52.userData.sheet06AdditiveDamageOnly, true);
  assert.equal(root52.getObjectByName('LOD0_WallDamage').visible, true);
  assert.equal(root52.getObjectByName('LOD0_RoofDamage').visible, true);
  assert.equal(root52.getObjectByName('LOD0_TrimDamage').visible, true);
  assert.equal(root51.getObjectByName('FinishWarmCream').visible, true);
  assert.equal(root51.getObjectByName('FinishMutedSage').visible, false);

  state.shop.reno.architecture.components.shell.restored = true;
  apply(51, root51, state);
  apply(52, root52, state);
  assert.equal(root52.getObjectByName('LOD0_WallDamage').visible, false);
  assert.equal(root52.getObjectByName('LOD0_RoofDamage').visible, false);
  assert.equal(root52.getObjectByName('LOD0_TrimDamage').visible, true, 'trim remains independently damaged');

  state.shop.reno.architecture.components.trim.restored = true;
  apply(52, root52, state);
  assert.equal(root52.getObjectByName('LOD0_TrimDamage').visible, false);
  assert.equal(root52.userData.sheet06DamageVisible, false);
  assert.deepEqual({ ...before.shop.reno, architecture: undefined }, {
    ...stateWith().shop.reno,
    architecture: undefined,
  }, 'existing cleaning siblings are not normalized or replaced');
});

test('asset 53 applies independent double-door leaves deterministically and idempotently', () => {
  const state = stateWith((_state, architecture) => {
    architecture.doors.main.left = 'open';
    architecture.doors.main.right = 'closed';
  });
  const root = namedRoot(53, ['PIVOT_DoorLeft', 'PIVOT_DoorRight']);
  const left = root.getObjectByName('PIVOT_DoorLeft');
  const right = root.getObjectByName('PIVOT_DoorRight');

  apply(53, root, state);
  assert.ok(Math.abs(left.rotation.y - 100 * Math.PI / 180) < 1e-12);
  assert.equal(right.rotation.y, 0);
  assert.equal(left.userData.sheet06TargetClip, 'DoorLeft_Open');
  assert.equal(right.userData.sheet06TargetClip, 'DoorRight_Close');
  const first = [left.rotation.y, right.rotation.y];
  apply(53, root, state);
  assert.deepEqual([left.rotation.y, right.rotation.y], first, 'same state has the same exact leaf transforms');

  state.shop.reno.architecture.doors.main.left = 'closed';
  state.shop.reno.architecture.doors.main.right = 'open';
  apply(53, root, state);
  assert.equal(left.rotation.y, 0);
  assert.ok(Math.abs(right.rotation.y + 100 * Math.PI / 180) < 1e-12);
  assert.deepEqual(root.userData.sheet06DoorState, { left: 'closed', right: 'open' });
});

test('assets 54-58 map restored/damaged groups and named finishes without touching save data', () => {
  const state = stateWith((_state, architecture) => {
    architecture.components.porch.finish = 'medium-walnut';
    architecture.components.panels.finish = 'medium-walnut';
    architecture.components.trim.finish = 'restrained-brass';
    architecture.components.ceiling.finish = 'natural-oak';
  });
  const snapshot = structuredClone(state);
  const fixtures = [
    [54, 'porch', ['PorchRestored', 'LOD0_PorchDamage', 'FinishNaturalOak', 'FinishMediumWalnut']],
    [56, 'panels', ['PanelsRestored', 'MESH_PanelDamage', 'FinishMutedSage', 'FinishMediumWalnut']],
    [57, 'trim', ['TrimRestored', 'TrimDamage', 'FinishWarmCream', 'FinishRestrainedBrass']],
    [58, 'ceiling', ['CeilingRestored', 'CeilingDamage', 'FinishWarmCream', 'FinishNaturalOak']],
  ];

  for (const [number, component, names] of fixtures) {
    const root = namedRoot(number, names);
    apply(number, root, state);
    assert.equal(root.getObjectByName(names[0]).visible, false);
    assert.equal(root.getObjectByName(names[1]).visible, true);
    assert.equal(root.getObjectByName(names.at(-1)).visible, true);
    state.shop.reno.architecture.components[component].restored = true;
    apply(number, root, state);
    assert.equal(root.getObjectByName(names[0]).visible, true);
    assert.equal(root.getObjectByName(names[1]).visible, false);
  }
  // Account only for the component flags deliberately changed by this test.
  fixtures.forEach(([, component]) => { snapshot.shop.reno.architecture.components[component].restored = true; });
  assert.deepEqual(state, snapshot);
});

test('window and floor variants keep cleaning arrays authoritative and repair channels separate', () => {
  const state = stateWith((_state, architecture) => {
    architecture.components.windows.finish = 'warm-charcoal';
    architecture.components.floor.finish = 'medium-walnut';
  });
  const snapshot = structuredClone(state);
  const windows = namedRoot(55, [
    'LOD0_WindowStandard', 'LOD0_WindowNarrow', 'LOD0_WindowWide', 'LOD0_WindowArched',
    'WindowClean', 'WindowBroken', 'FinishDeepGolfGreen', 'FinishWarmCharcoal',
  ]);
  const floor = namedRoot(59, [
    'MESH_FloorOak', 'MESH_FloorWalnut', 'MESH_FloorDarkWood', 'MESH_FloorSageCarpet',
    'MESH_FloorGrayCarpet', 'MESH_FloorCreamTile', 'MESH_FloorStoneTile', 'FloorRestored',
  ]);
  const floorDamage = namedRoot(60, ['LOD0_FloorDamage']);

  apply(55, windows, state, { selections: { windowVariant: 'wide' } });
  assert.equal(windows.getObjectByName('LOD0_WindowWide').visible, true);
  assert.equal(windows.getObjectByName('LOD0_WindowStandard').visible, false);
  assert.equal(windows.getObjectByName('WindowBroken').visible, true);
  assert.equal(windows.getObjectByName('WindowClean').visible, false);
  assert.equal(windows.getObjectByName('FinishWarmCharcoal').visible, true);
  assert.equal(windows.userData.sheet06WindowStateById[SHEET06_WINDOW_DATUMS[0].id].film, 0.9);
  assert.equal(windows.userData.sheet06WindowStateById[SHEET06_WINDOW_DATUMS[0].id].broken, true);

  apply(59, floor, state);
  apply(60, floorDamage, state);
  assert.equal(floor.getObjectByName('MESH_FloorWalnut').visible, true);
  assert.equal(floor.getObjectByName('MESH_FloorOak').visible, false);
  assert.equal(floorDamage.getObjectByName('LOD0_FloorDamage').visible, true,
    'a zero grime grid does not repair structural floor damage');
  assert.equal(floorDamage.userData.sheet06FloorGrimeAuthority, 'state.shop.reno.grime');

  state.shop.reno.architecture.components.windows.restored = true;
  state.shop.reno.architecture.components.floor.restored = true;
  apply(55, windows, state, { selections: { windowVariant: 'wide' } });
  apply(59, floor, state);
  apply(60, floorDamage, state);
  assert.equal(windows.getObjectByName('WindowBroken').visible, false);
  assert.equal(windows.getObjectByName('WindowClean').visible, true);
  assert.equal(floor.getObjectByName('FloorRestored').visible, true);
  assert.equal(floorDamage.getObjectByName('LOD0_FloorDamage').visible, false);

  snapshot.shop.reno.architecture.components.windows.restored = true;
  snapshot.shop.reno.architecture.components.floor.restored = true;
  assert.deepEqual(state, snapshot, 'visibility application is read-only with respect to save state');
  const stateView = readSheet06ClubhouseState(state);
  assert.equal(stateView.windowFilm, state.shop.reno.windows);
  assert.equal(stateView.floorGrime, state.shop.reno.grime);
});

test('adapter forwards lifecycle, mounts, fallback ownership and state application to the cache boundary', async () => {
  const state = stateWith();
  const group = new THREE.Group();
  const interior = new THREE.Group();
  const fallback = new THREE.Group();
  fallback.visible = true;
  const fallbacks = { 'sheet06.asset051.canonicalShell': fallback };
  let captured = null;
  let updateCalls = 0;
  let applyCalls = 0;
  let disposeCalls = 0;
  const root51 = namedRoot(51, ['LOD0_StructuralShell']);
  const fakeArchitecture = {
    ready: Promise.resolve({ settled: 1, succeeded: 0, failed: 1 }),
    diagnostics: () => ({ failed: 1, assets: [{ number: 51, status: 'failed' }] }),
    getRoot: (number) => (number === 51 ? root51 : null),
    applyState: async () => { applyCalls += 1; return { applied: 0, failed: 1, disposed: false }; },
    update: () => { updateCalls += 1; return 2; },
    borrowedResources: () => ({ geometries: new Set() }),
    dispose: () => { disposeCalls += 1; return { alreadyDisposed: false }; },
  };

  const adapter = createSheet06ClubhouseAdapter({
    group,
    interior,
    fallbacks,
    state,
    architectureFactory(options) { captured = options; return fakeArchitecture; },
  });
  assert.equal(captured.mounts.group, group);
  assert.equal(captured.mounts.interior, interior);
  assert.equal(captured.fallbacks, fallbacks);
  assert.equal(captured.initialState, state);
  assert.equal(fallback.visible, true, 'adapter does not pre-empt the cache fallback transaction');

  const placedRoot = new THREE.Group();
  const placement = captured.placementResolver({
    binding: SHEET06_RUNTIME_BY_NUMBER[51], root: placedRoot, mount: group,
  });
  assert.deepEqual(placement.position, [0, 0, 0]);
  captured.applyState({ binding: SHEET06_RUNTIME_BY_NUMBER[51], root: root51, state });
  assert.equal(root51.userData.sheet06StructuralAuthority, true);

  assert.deepEqual(await adapter.ready, { settled: 1, succeeded: 0, failed: 1 });
  assert.deepEqual(await adapter.applyState(state), { applied: 0, failed: 1, disposed: false });
  assert.equal(applyCalls, 1);
  assert.equal(fallback.visible, true, 'failure/fallback visibility remains delegated to the cache');
  assert.equal(adapter.update(1 / 60), 2);
  assert.equal(updateCalls, 1);
  assert.equal(adapter.diagnostics().actualSharedGameIntegrated, false);
  assert.equal(adapter.diagnostics().placementCount, 1);
  assert.equal(adapter.borrowedResources().geometries.size, 0);

  assert.deepEqual(adapter.dispose(), {
    alreadyDisposed: false,
    cache: { alreadyDisposed: false },
  });
  assert.equal(disposeCalls, 1);
  assert.equal(adapter.getRoot(51), null);
  assert.equal(adapter.update(1 / 60), 0);
  assert.deepEqual(await adapter.applyState(state), { applied: 0, failed: 0, disposed: true });
  assert.deepEqual(adapter.dispose(), { alreadyDisposed: true, cache: null });
  assert.equal(disposeCalls, 1);
});

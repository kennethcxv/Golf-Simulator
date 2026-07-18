import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { disposeSceneResources } from '../src/render3d/disposeSceneResources.js';
import {
  createSheet06AssetCache,
} from '../src/render3d/assets51to100/sheet06AssetCache.js';
import {
  SHEET06_ASSETS,
  SHEET06_BY_NUMBER,
  SHEET06_RUNTIME_ASSETS,
  SHEET06_RUNTIME_BY_NUMBER,
  createSheet06Architecture,
} from '../src/render3d/assets51to100/sheet06Architecture.js';

const METERS_TO_YARDS = 1.0936133;

class ControlledLoader {
  constructor() {
    this.calls = [];
    this.pending = new Map();
  }

  load(url, onLoad, _onProgress, onError) {
    this.calls.push(url);
    if (this.pending.has(url)) throw new Error(`duplicate fake load for ${url}`);
    this.pending.set(url, { onLoad, onError });
  }

  resolve(url, gltf) {
    const pending = this.pending.get(url);
    assert.ok(pending, `no pending load for ${url}`);
    this.pending.delete(url);
    pending.onLoad(gltf);
  }

  reject(url, error = new Error(`failed ${url}`)) {
    const pending = this.pending.get(url);
    assert.ok(pending, `no pending load for ${url}`);
    this.pending.delete(url);
    pending.onError(error);
  }
}

function binding(number, {
  url = `sheet06-${number}.glb`,
  rootName = `A_${number}_ROOT`,
  sockets = [],
  pivots = [],
  animations = [],
  mount = 'group',
  fallback = `fallback-${number}`,
  runtimeScale = METERS_TO_YARDS,
} = {}) {
  return {
    number,
    runtimeGlb: url,
    rootName,
    requiredSockets: sockets,
    requiredPivots: pivots,
    requiredAnimations: animations,
    mount: { root: mount, placementDatum: `DATUM_${number}`, scaleExactlyOnce: true },
    fallback,
    runtimeScale,
    collision: {
      runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
      glbNavigationAuthority: 'NONE',
      activateGlbCollision: false,
    },
  };
}

function makeResources() {
  const geometry = new THREE.BoxGeometry(0.4, 0.3, 0.2);
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const counts = { geometry: 0, material: 0, texture: 0 };
  geometry.addEventListener('dispose', () => { counts.geometry += 1; });
  material.addEventListener('dispose', () => { counts.material += 1; });
  texture.addEventListener('dispose', () => { counts.texture += 1; });
  return { geometry, material, texture, counts };
}

function gltfFor(bindings, {
  resources = makeResources(),
  omitRoots = new Set(),
  omitMarkers = new Set(),
  animations = null,
} = {}) {
  const scene = new THREE.Group();
  scene.name = 'Sheet06FixtureScene';
  for (const item of bindings) {
    if (omitRoots.has(item.number)) continue;
    const root = new THREE.Group();
    root.name = item.rootName;
    root.add(new THREE.Mesh(resources.geometry, resources.material));
    const collision = new THREE.Mesh(resources.geometry, resources.material);
    collision.name = `COL_${item.number}_AuthoringOnly`;
    root.add(collision);
    for (const marker of new Set([...item.requiredSockets, ...item.requiredPivots])) {
      if (omitMarkers.has(marker)) continue;
      const node = new THREE.Object3D();
      node.name = marker;
      root.add(node);
    }
    scene.add(root);
  }
  const clipNames = animations || [...new Set(bindings.flatMap((item) => item.requiredAnimations))];
  return {
    scene,
    animations: clipNames.map((name) => new THREE.AnimationClip(name, 1, [])),
    resources,
  };
}

function fallbackMap(bindings) {
  return new Map(bindings.map((item) => {
    const fallback = new THREE.Group();
    fallback.visible = true;
    return [item.fallback, fallback];
  }));
}

function diagnostic(cache, number) {
  return cache.diagnostics().assets.find((asset) => asset.number === number);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('architecture adapter imports the named manifest and injects normalized runtime bindings/cache', () => {
  assert.equal(SHEET06_ASSETS.length, 10);
  assert.equal(SHEET06_BY_NUMBER[51], SHEET06_ASSETS[0]);
  assert.equal(SHEET06_RUNTIME_ASSETS.length, 10);
  assert.equal(SHEET06_RUNTIME_BY_NUMBER[51].number, 51);
  assert.equal(SHEET06_RUNTIME_BY_NUMBER[51].runtimeGlb, SHEET06_ASSETS[0].paths.runtimeGlb);
  assert.equal(SHEET06_RUNTIME_BY_NUMBER[53].requiredPivots.includes('PIVOT_DoorLeft'), true);
  assert.equal(SHEET06_RUNTIME_BY_NUMBER[51].collision.runtimeNavigationAuthority, 'ANALYTIC_LAYOUT');
  SHEET06_RUNTIME_ASSETS.forEach((runtime, index) => {
    const manifest = SHEET06_ASSETS[index];
    assert.equal(runtime.number, manifest.assetNumber);
    assert.equal(runtime.runtimeGlb, manifest.paths.runtimeGlb);
    assert.equal(runtime.rootName, manifest.rootName);
    assert.deepEqual(runtime.requiredSockets, manifest.requiredSockets);
    assert.deepEqual(runtime.requiredPivots, manifest.requiredPivots);
    assert.deepEqual(runtime.requiredAnimations, manifest.requiredAnimations);
    assert.equal(runtime.mount, manifest.mount);
    assert.equal(runtime.fallback, manifest.fallbackKey);
    assert.equal(runtime.runtimeScale, manifest.runtimeScale);
    assert.equal(runtime.collision, manifest.collision);
    assert.equal(runtime.sourceBinding, manifest);
    assert.equal(SHEET06_RUNTIME_BY_NUMBER[runtime.number], runtime);
  });

  const injected = Object.freeze({ ready: Promise.resolve() });
  assert.equal(createSheet06Architecture({ cache: injected }), injected);

  let received = null;
  const returned = Object.freeze({ dispose() {} });
  const loader = new ControlledLoader();
  assert.equal(createSheet06Architecture({
    loader,
    cacheFactory(options) { received = options; return returned; },
  }), returned);
  assert.equal(received.loader, loader);
  assert.equal(received.bindings, SHEET06_RUNTIME_ASSETS);
});

test('one promise/prototype per URL mounts validated clones, hides COL nodes and scales exactly once', async () => {
  const url = 'shared-architecture.glb';
  const bindings = [binding(51, { url }), binding(52, { url })];
  const loader = new ControlledLoader();
  const group = new THREE.Group();
  const fallbacks = fallbackMap(bindings);
  const stateCalls = [];
  const cache = createSheet06AssetCache({
    loader,
    bindings,
    mounts: { group },
    fallbacks,
    initialState: { restored: false },
    applyState(context) { stateCalls.push(context); },
  });

  assert.deepEqual(loader.calls, [url]);
  loader.resolve(url, gltfFor(bindings));
  const ready = await cache.ready;
  assert.deepEqual({ settled: ready.settled, succeeded: ready.succeeded, failed: ready.failed }, {
    settled: 2, succeeded: 2, failed: 0,
  });
  assert.equal(cache.isSettled(), true);
  assert.equal(cache.diagnostics().prototypePromiseCount, 1);
  assert.equal(cache.diagnostics().prototypeCount, 1);
  assert.equal(group.children.length, 2);
  assert.equal(stateCalls.length, 2);

  for (const item of bindings) {
    const root = cache.getRoot(item.number);
    assert.ok(root);
    assert.equal(root.parent, group);
    assert.equal(root.scale.x, METERS_TO_YARDS);
    assert.equal(root.scale.y, METERS_TO_YARDS);
    assert.equal(root.scale.z, METERS_TO_YARDS);
    assert.equal(root.userData.sheet06ScaleApplications, 1);
    assert.equal(root.matrixAutoUpdate, false, 'static async roots freeze after their world matrices update');
    assert.equal(fallbacks.get(item.fallback).visible, false);
    const collision = root.getObjectByName(`COL_${item.number}_AuthoringOnly`);
    assert.equal(collision.visible, false);
    assert.equal(collision.userData.sheet06NavigationCollisionDisabled, true);
  }
  const root51Mesh = cache.getRoot(51).children.find(({ isMesh, name }) => isMesh && !name.startsWith('COL_'));
  const root52Mesh = cache.getRoot(52).children.find(({ isMesh, name }) => isMesh && !name.startsWith('COL_'));
  assert.equal(root51Mesh.geometry, root52Mesh.geometry, 'clones share immutable prototype geometry');
  assert.equal(root51Mesh.material, root52Mesh.material, 'clones share immutable prototype material');
  assert.equal(root51Mesh.userData.sheet06SharedRenderResources, true);

  const update = await cache.applyState({ restored: true });
  assert.deepEqual(update, { applied: 2, failed: 0, disposed: false });
  assert.equal(stateCalls.length, 4);
  assert.equal(cache.getRoot(51).userData.sheet06ScaleApplications, 1);
  cache.dispose();
});

test('network and invalid root/marker/animation contracts all settle as failures and leave fallbacks', async () => {
  const bindings = [
    binding(51, { url: 'network.glb' }),
    binding(52, { url: 'root.glb' }),
    binding(53, { url: 'marker.glb', sockets: ['SOCKET_Handle'] }),
    binding(54, { url: 'clip.glb', animations: ['door_open'] }),
  ];
  const loader = new ControlledLoader();
  const group = new THREE.Group();
  const fallbacks = fallbackMap(bindings);
  const cache = createSheet06AssetCache({ loader, bindings, mounts: { group }, fallbacks });

  loader.reject('network.glb', new Error('404 fixture'));
  loader.resolve('root.glb', gltfFor([bindings[1]], { omitRoots: new Set([52]) }));
  loader.resolve('marker.glb', gltfFor([bindings[2]], { omitMarkers: new Set(['SOCKET_Handle']) }));
  loader.resolve('clip.glb', gltfFor([bindings[3]], { animations: [] }));
  const ready = await cache.ready;

  assert.equal(ready.settled, 4);
  assert.equal(ready.succeeded, 0);
  assert.equal(ready.failed, 4);
  assert.equal(ready.pending, 0);
  assert.equal(group.children.length, 0);
  assert.deepEqual(ready.assets.map(({ error }) => error.code), [
    'LOAD_FAILED', 'ROOT_MISSING', 'MARKER_MISSING', 'ANIMATION_MISSING',
  ]);
  for (const item of bindings) {
    assert.equal(cache.getRoot(item.number), null);
    assert.equal(fallbacks.get(item.fallback).visible, true);
  }
  cache.dispose();
});

test('mount is transactional: initial state failure removes only that clone and never hides its fallback', async () => {
  const url = 'atomic.glb';
  const bindings = [binding(51, { url }), binding(52, { url })];
  const loader = new ControlledLoader();
  const group = new THREE.Group();
  const fallbacks = fallbackMap(bindings);
  const unrelated = new THREE.Group();
  unrelated.visible = true;
  fallbacks.set('unrelated', unrelated);
  const observed = [];
  const cache = createSheet06AssetCache({
    loader,
    bindings,
    mounts: { group },
    fallbacks,
    async applyState({ binding: item, root }) {
      observed.push({ number: item.number, parent: root.parent, visible: root.visible });
      if (item.number === 52) throw new Error('bad restored-state payload');
    },
  });
  loader.resolve(url, gltfFor(bindings));
  const ready = await cache.ready;

  assert.equal(ready.succeeded, 1);
  assert.equal(ready.failed, 1);
  assert.equal(cache.getRoot(51).parent, group);
  assert.equal(cache.getRoot(52), null);
  assert.equal(group.children.length, 1);
  assert.equal(fallbacks.get('fallback-51').visible, false);
  assert.equal(fallbacks.get('fallback-52').visible, true);
  assert.equal(unrelated.visible, true);
  assert.deepEqual(observed.map(({ number, parent, visible }) => [number, parent === group, visible]), [
    [51, true, false], [52, true, false],
  ]);
  assert.equal(diagnostic(cache, 52).error.code, 'INITIAL_STATE_FAILED');

  cache.dispose();
  assert.equal(fallbacks.get('fallback-51').visible, true, 'teardown restores the procedural fallback');
});

test('placement sees the one meter conversion and cannot introduce a second scale', async () => {
  const bindings = [binding(51), binding(52)];
  const loader = new ControlledLoader();
  const group = new THREE.Group();
  const fallbacks = fallbackMap(bindings);
  const seenScale = [];
  const cache = createSheet06AssetCache({
    loader,
    bindings,
    mounts: { group },
    fallbacks,
    placementResolver({ binding: item, root, mount }) {
      seenScale.push([item.number, root.scale.x]);
      if (item.number === 52) root.scale.multiplyScalar(2);
      return { parent: mount, position: new THREE.Vector3(item.number, 0, 0) };
    },
  });
  loader.resolve('sheet06-51.glb', gltfFor([bindings[0]]));
  loader.resolve('sheet06-52.glb', gltfFor([bindings[1]]));
  const ready = await cache.ready;

  assert.deepEqual(seenScale, [[51, METERS_TO_YARDS], [52, METERS_TO_YARDS]]);
  assert.equal(ready.succeeded, 1);
  assert.equal(ready.failed, 1);
  assert.equal(cache.getRoot(51).position.x, 51);
  assert.equal(cache.getRoot(51).userData.sheet06ScaleApplications, 1);
  assert.equal(diagnostic(cache, 52).error.code, 'PLACEMENT_SCALE_FORBIDDEN');
  assert.equal(fallbacks.get('fallback-52').visible, true);
  cache.dispose();
});

test('dispose-before-resolve settles immediately and late GLTF completion only releases resources', async () => {
  const bindings = [binding(51)];
  const loader = new ControlledLoader();
  const group = new THREE.Group();
  const fallbacks = fallbackMap(bindings);
  const callbacks = { state: 0, settled: 0, ready: 0 };
  const cache = createSheet06AssetCache({
    loader,
    bindings,
    mounts: { group },
    fallbacks,
    applyState() { callbacks.state += 1; },
    onAssetSettled() { callbacks.settled += 1; },
    onReady() { callbacks.ready += 1; },
  });
  const firstDispose = cache.dispose();
  const ready = await cache.ready;
  assert.equal(firstDispose.alreadyDisposed, false);
  assert.equal(ready.settled, 1);
  assert.equal(ready.failed, 1);
  assert.equal(ready.assets[0].error.code, 'DISPOSED');
  assert.deepEqual(callbacks, { state: 0, settled: 0, ready: 0 });

  const fixture = gltfFor(bindings);
  loader.resolve('sheet06-51.glb', fixture);
  await tick();
  await tick();
  assert.equal(group.children.length, 0);
  assert.equal(fallbacks.get('fallback-51').visible, true);
  assert.equal(cache.getRoot(51), null);
  assert.deepEqual(fixture.resources.counts, { geometry: 1, material: 1, texture: 1 });
  const repeated = cache.dispose();
  assert.equal(repeated.alreadyDisposed, true);
  assert.deepEqual(
    { geometries: repeated.geometries, materials: repeated.materials, textures: repeated.textures },
    { geometries: 1, materials: 1, textures: 1 },
  );
  assert.deepEqual(callbacks, { state: 0, settled: 0, ready: 0 });
});

test('borrowed prototype resources protect clones from outer teardown and cache disposes each identity once', async () => {
  const url = 'shared-resources.glb';
  const bindings = [binding(51, { url }), binding(52, { url })];
  const loader = new ControlledLoader();
  const group = new THREE.Group();
  const fixture = gltfFor(bindings);
  const cache = createSheet06AssetCache({
    loader,
    bindings,
    mounts: { group },
    fallbacks: fallbackMap(bindings),
  });
  loader.resolve(url, fixture);
  await cache.ready;

  const borrowed = cache.borrowedResources();
  assert.equal(borrowed.geometries.size, 1);
  assert.equal(borrowed.materials.size, 1);
  assert.equal(borrowed.textures.size, 1);
  const outer = disposeSceneResources(group, { protectedResources: borrowed });
  assert.deepEqual(
    { geometries: outer.geometries, materials: outer.materials, textures: outer.textures },
    { geometries: 0, materials: 0, textures: 0 },
  );
  assert.deepEqual(fixture.resources.counts, { geometry: 0, material: 0, texture: 0 });

  const first = cache.dispose();
  assert.deepEqual(
    { geometries: first.geometries, materials: first.materials, textures: first.textures },
    { geometries: 1, materials: 1, textures: 1 },
  );
  assert.deepEqual(fixture.resources.counts, { geometry: 1, material: 1, texture: 1 });
  const second = cache.dispose();
  assert.equal(second.alreadyDisposed, true);
  assert.deepEqual(fixture.resources.counts, { geometry: 1, material: 1, texture: 1 });
});

test('animation mixers/actions stop and uncache while animated branches remain updateable', async () => {
  const bindings = [binding(53, {
    pivots: ['PIVOT_Door'],
    animations: ['door_open'],
  })];
  const loader = new ControlledLoader();
  const group = new THREE.Group();
  const calls = { actionStop: 0, stopAll: 0, uncacheAction: 0, uncacheClip: 0, uncacheRoot: 0 };
  let actionPlay = 0;
  let rejectUpdate = false;
  const clip = new THREE.AnimationClip('door_open', 1, [
    new THREE.NumberKeyframeTrack('PIVOT_Door.rotation[z]', [0, 1], [0, 1]),
  ]);
  const mixerFactory = () => ({
    clipAction() {
      return {
        play() { actionPlay += 1; return this; },
        stop() { calls.actionStop += 1; return this; },
      };
    },
    update() { if (rejectUpdate) throw new Error('mixer clock rejected'); },
    stopAllAction() { calls.stopAll += 1; },
    uncacheAction() { calls.uncacheAction += 1; },
    uncacheClip() { calls.uncacheClip += 1; },
    uncacheRoot() { calls.uncacheRoot += 1; },
  });
  const cache = createSheet06AssetCache({
    loader,
    bindings,
    mounts: { group },
    fallbacks: fallbackMap(bindings),
    mixerFactory,
    applyState({ actions }) { actions.get('door_open').play(); },
  });
  const fixture = gltfFor(bindings, { animations: [] });
  fixture.animations = [clip];
  loader.resolve('sheet06-53.glb', fixture);
  await cache.ready;

  const root = cache.getRoot(53);
  assert.equal(actionPlay, 1);
  assert.equal(root.matrixAutoUpdate, true, 'root stays dynamic as an ancestor of an animated pivot');
  assert.equal(root.getObjectByName('PIVOT_Door').matrixAutoUpdate, true);
  assert.equal(cache.update(1 / 60), 1);
  assert.equal(diagnostic(cache, 53).updateError, null);
  rejectUpdate = true;
  assert.equal(cache.update(1 / 60), 0);
  assert.equal(diagnostic(cache, 53).updateError.code, 'MIXER_UPDATE_FAILED');
  rejectUpdate = false;
  assert.equal(cache.update(1 / 60), 1);
  assert.equal(diagnostic(cache, 53).updateError, null);

  cache.dispose();
  assert.deepEqual(calls, {
    actionStop: 1, stopAll: 1, uncacheAction: 1, uncacheClip: 1, uncacheRoot: 1,
  });
  cache.dispose();
  assert.deepEqual(calls, {
    actionStop: 1, stopAll: 1, uncacheAction: 1, uncacheClip: 1, uncacheRoot: 1,
  });
});

test('post-mount state failures are diagnosed without removing the valid root or fallback decision', async () => {
  const bindings = [binding(51)];
  const loader = new ControlledLoader();
  const group = new THREE.Group();
  const fallbacks = fallbackMap(bindings);
  const cache = createSheet06AssetCache({
    loader,
    bindings,
    mounts: { group },
    fallbacks,
    applyState({ state }) {
      if (state?.rejectUpdate) throw new Error('state revision rejected');
    },
  });
  loader.resolve('sheet06-51.glb', gltfFor(bindings));
  await cache.ready;

  const failedUpdate = await cache.applyState({ rejectUpdate: true });
  assert.deepEqual(failedUpdate, { applied: 0, failed: 1, disposed: false });
  assert.equal(diagnostic(cache, 51).stateError.code, 'STATE_APPLY_FAILED');
  assert.equal(cache.getRoot(51).parent, group);
  assert.equal(fallbacks.get('fallback-51').visible, false);

  const recovered = await cache.applyState({ rejectUpdate: false });
  assert.deepEqual(recovered, { applied: 1, failed: 0, disposed: false });
  assert.equal(diagnostic(cache, 51).stateError, null);
  cache.dispose();
});

test('zero bindings settle ready without I/O and dispose idempotently', async () => {
  const loader = new ControlledLoader();
  let readyCallbacks = 0;
  const cache = createSheet06AssetCache({
    loader,
    bindings: [],
    onReady() { readyCallbacks += 1; },
  });
  const ready = await cache.ready;
  assert.equal(cache.isSettled(), true);
  assert.deepEqual(
    { total: ready.total, pending: ready.pending, settled: ready.settled, succeeded: ready.succeeded, failed: ready.failed },
    { total: 0, pending: 0, settled: 0, succeeded: 0, failed: 0 },
  );
  assert.deepEqual(loader.calls, []);
  assert.equal(readyCallbacks, 1);
  assert.equal(cache.getRoot(51), null);
  assert.deepEqual(await cache.applyState({ any: 'state' }), { applied: 0, failed: 0, disposed: false });
  assert.equal(cache.dispose().alreadyDisposed, false);
  assert.equal(cache.dispose().alreadyDisposed, true);
});

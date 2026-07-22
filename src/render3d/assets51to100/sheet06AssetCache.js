import { AnimationMixer } from 'three';
import { clone as cloneSkeletonSafe } from 'three/addons/utils/SkeletonUtils.js';

import { closeTextureImages } from '../clubhouse/resourceLifecycle.js';

const COLLISION_NAME = /^(?:COL_|COLLISION_|VOLUME_)/i;

function emptyResources() {
  return {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
    skeletons: new Set(),
    instancedMeshes: new Set(),
  };
}

function emptyReleasedResources() {
  return {
    geometries: new WeakSet(),
    materials: new WeakSet(),
    textures: new WeakSet(),
    skeletons: new WeakSet(),
    instancedMeshes: new WeakSet(),
  };
}

function texturesIn(material, target) {
  if (!material) return;
  for (const value of Object.values(material)) if (value?.isTexture) target.add(value);
  for (const uniform of Object.values(material.uniforms || {})) {
    const value = uniform?.value;
    if (value?.isTexture) target.add(value);
    if (Array.isArray(value)) for (const item of value) if (item?.isTexture) target.add(item);
  }
}

export function collectSheet06Resources(root, resources = emptyResources()) {
  root?.traverse?.((object) => {
    if (object.geometry) resources.geometries.add(object.geometry);
    if (object.skeleton && typeof object.skeleton.dispose === 'function') resources.skeletons.add(object.skeleton);
    if (object.isInstancedMesh && typeof object.dispose === 'function') resources.instancedMeshes.add(object);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      resources.materials.add(material);
      texturesIn(material, resources.textures);
    }
  });
  return resources;
}

function mergeResources(target, source) {
  for (const key of Object.keys(target)) {
    for (const resource of source?.[key] || []) target[key].add(resource);
  }
  return target;
}

function snapshotResources(resources) {
  return Object.fromEntries(Object.entries(resources).map(([key, values]) => [key, new Set(values)]));
}

class Sheet06LoadError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'Sheet06LoadError';
    this.code = code;
  }
}

function asLoadError(error, fallbackCode = 'LOAD_FAILED') {
  if (error instanceof Sheet06LoadError) return error;
  const message = error instanceof Error ? error.message : String(error || 'Unknown GLTF load failure');
  return new Sheet06LoadError(fallbackCode, message, error instanceof Error ? error : null);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.length) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.length)) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
  return [...value];
}

export function normalizeSheet06RuntimeBinding(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Sheet-6 binding must be an object');
  const number = Number(input.number ?? input.assetNumber);
  if (!Number.isInteger(number)) throw new TypeError('Sheet-6 binding number must be an integer');
  const runtimeGlb = requiredString(input.runtimeGlb ?? input.paths?.runtimeGlb, `Asset ${number} runtimeGlb`);
  const rootName = requiredString(input.rootName, `Asset ${number} rootName`);
  const fallback = requiredString(input.fallback ?? input.fallbackKey, `Asset ${number} fallback`);
  const runtimeScale = Number(input.runtimeScale);
  if (!Number.isFinite(runtimeScale) || runtimeScale <= 0) {
    throw new RangeError(`Asset ${number} runtimeScale must be positive and finite`);
  }
  if (!input.mount || !['group', 'interior'].includes(input.mount.root)) {
    throw new TypeError(`Asset ${number} mount.root must be group or interior`);
  }
  const collision = input.collision;
  if (!collision || collision.runtimeNavigationAuthority !== 'ANALYTIC_LAYOUT'
    || collision.glbNavigationAuthority !== 'NONE' || collision.activateGlbCollision !== false) {
    throw new Sheet06LoadError(
      'UNSAFE_COLLISION_CONTRACT',
      `Asset ${number} must keep analytic navigation authoritative and GLB collision inactive`,
    );
  }
  return Object.freeze({
    number,
    runtimeGlb,
    rootName,
    requiredSockets: Object.freeze(stringArray(input.requiredSockets || [], `Asset ${number} requiredSockets`)),
    requiredPivots: Object.freeze(stringArray(input.requiredPivots || [], `Asset ${number} requiredPivots`)),
    requiredAnimations: Object.freeze(stringArray(input.requiredAnimations || [], `Asset ${number} requiredAnimations`)),
    mount: input.mount,
    fallback,
    runtimeScale,
    collision,
    sourceBinding: input.sourceBinding || input,
  });
}

function lookup(container, key, binding) {
  if (typeof container === 'function') return container(key, binding);
  if (container instanceof Map) return container.get(key);
  return container?.[key] ?? null;
}

function findExpectedRoot(scene, name) {
  if (!scene) return null;
  if (scene.name === name) return scene;
  return scene.getObjectByName?.(name) || null;
}

function validatePrototype(binding, gltf) {
  const root = findExpectedRoot(gltf?.scene, binding.rootName);
  if (!root) {
    throw new Sheet06LoadError('ROOT_MISSING', `Asset ${binding.number} expected root ${binding.rootName}`);
  }
  const names = new Set();
  root.traverse?.((object) => names.add(object.name));
  const requiredMarkers = new Set([...binding.requiredSockets, ...binding.requiredPivots]);
  const missingMarkers = [...requiredMarkers].filter((name) => !names.has(name));
  if (missingMarkers.length) {
    throw new Sheet06LoadError(
      'MARKER_MISSING',
      `Asset ${binding.number} is missing markers: ${missingMarkers.join(', ')}`,
    );
  }
  const clips = Array.isArray(gltf?.animations) ? gltf.animations : [];
  const clipNames = new Set(clips.map((clip) => clip?.name).filter(Boolean));
  const missingClips = binding.requiredAnimations.filter((name) => !clipNames.has(name));
  if (missingClips.length) {
    throw new Sheet06LoadError(
      'ANIMATION_MISSING',
      `Asset ${binding.number} is missing animations: ${missingClips.join(', ')}`,
    );
  }
  return { root, clips };
}

function hideGlbCollision(root) {
  root?.traverse?.((object) => {
    if (COLLISION_NAME.test(String(object.name || '')) || object.userData?.collision_proxy) {
      object.visible = false;
      object.userData.sheet06NavigationCollisionDisabled = true;
    }
  });
}

function scaleExactlyOnce(root, binding) {
  if (root.userData?.sheet06MetersToYardsApplied) {
    throw new Sheet06LoadError('SCALE_REAPPLIED', `Asset ${binding.number} meter scale was already applied`);
  }
  root.scale.multiplyScalar(binding.runtimeScale);
  root.userData.sheet06MetersToYardsApplied = true;
  root.userData.sheet06ScaleApplications = 1;
  root.userData.sheet06RuntimeScale = binding.runtimeScale;
  return root.scale.clone();
}

function sameScale(a, b, epsilon = 1e-10) {
  return Math.abs(a.x - b.x) <= epsilon
    && Math.abs(a.y - b.y) <= epsilon
    && Math.abs(a.z - b.z) <= epsilon;
}

function animationObjectNames(clips) {
  const names = new Set();
  for (const clip of clips) {
    for (const track of clip?.tracks || []) {
      const raw = String(track?.name || '').replace(/^\.?/, '');
      const target = raw.replace(/\.(?:position|quaternion|rotation|scale|morphTargetInfluences)(?:\[.*\])?$/, '');
      if (!target) continue;
      names.add(target);
      const leaf = target.split(/[/:]/).filter(Boolean).at(-1);
      if (leaf) names.add(leaf);
    }
  }
  return names;
}

function freezeStaticHierarchy(root, clips) {
  if (typeof root.updateWorldMatrix === 'function') root.updateWorldMatrix(true, true);
  else root.updateMatrixWorld?.(true);
  const animatedNames = animationObjectNames(clips);
  const dynamic = new Set();
  root.traverse?.((object) => {
    if (!animatedNames.has(object.name)) return;
    let cursor = object;
    while (cursor) {
      dynamic.add(cursor);
      if (cursor === root) break;
      cursor = cursor.parent;
    }
  });
  root.traverse?.((object) => {
    const staysDynamic = dynamic.has(object);
    object.matrixAutoUpdate = staysDynamic;
    if (!staysDynamic) object.matrixWorldNeedsUpdate = false;
  });
  root.userData.sheet06StaticFrozen = true;
  root.userData.sheet06DynamicNodeCount = dynamic.size;
}

function thawHierarchy(root) {
  root?.traverse?.((object) => { object.matrixAutoUpdate = true; });
}

function applyPlacement(root, placement, defaultParent) {
  if (placement?.isObject3D) placement = { parent: placement };
  const resolved = placement || {};
  if ('scale' in resolved) {
    throw new Sheet06LoadError('PLACEMENT_SCALE_FORBIDDEN', 'Placement cannot apply a second asset scale');
  }
  const parent = resolved.parent || defaultParent;
  if (!parent || typeof parent.add !== 'function') {
    throw new Sheet06LoadError('MOUNT_MISSING', 'Resolved Sheet-6 mount is not an Object3D parent');
  }
  if (resolved.position) {
    if (Array.isArray(resolved.position)) root.position.fromArray(resolved.position);
    else root.position.copy(resolved.position);
  }
  if (resolved.quaternion) {
    if (Array.isArray(resolved.quaternion)) root.quaternion.fromArray(resolved.quaternion);
    else root.quaternion.copy(resolved.quaternion);
  } else if (resolved.rotation) {
    if (Array.isArray(resolved.rotation)) root.rotation.fromArray(resolved.rotation);
    else root.rotation.copy(resolved.rotation);
  }
  return parent;
}

function stopEntryAnimation(entry) {
  for (const action of entry.actions?.values?.() || []) action?.stop?.();
  entry.mixer?.stopAllAction?.();
  for (const clip of entry.clips || []) {
    entry.mixer?.uncacheAction?.(clip, entry.root);
    entry.mixer?.uncacheClip?.(clip);
  }
  if (entry.root) entry.mixer?.uncacheRoot?.(entry.root);
  entry.actions?.clear?.();
  entry.mixer = null;
}

function detach(root) {
  root?.removeFromParent?.();
  if (root?.parent?.remove) root.parent.remove(root);
}

function diagnosticError(error) {
  if (!error) return null;
  return { code: error.code || 'LOAD_FAILED', message: error.message || String(error) };
}

function loadWith(loader, url) {
  return new Promise((resolve, reject) => {
    try {
      loader.load(url, resolve, undefined, reject);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Owns one eager Sheet-6 load graph. GLTF prototypes and their immutable render
 * resources are instance-scoped; mounted clones borrow those identities.
 */
export function createSheet06AssetCache({
  loader,
  bindings,
  mounts = {},
  fallbacks = {},
  placementResolver = null,
  applyState: applyStateToAsset = () => {},
  initialState = null,
  clonePrototype = cloneSkeletonSafe,
  mixerFactory = (root) => new AnimationMixer(root),
  onAssetSettled = null,
  onReady = null,
} = {}) {
  if (!loader || typeof loader.load !== 'function') throw new TypeError('A GLTF-compatible loader is required');
  if (!Array.isArray(bindings)) throw new TypeError('Sheet-6 bindings must be an array');
  if (typeof clonePrototype !== 'function') throw new TypeError('clonePrototype must be a function');
  if (typeof mixerFactory !== 'function') throw new TypeError('mixerFactory must be a function');
  if (typeof applyStateToAsset !== 'function') throw new TypeError('applyState must be a function');

  const normalized = bindings.map(normalizeSheet06RuntimeBinding);
  const numbers = new Set();
  for (const binding of normalized) {
    if (numbers.has(binding.number)) throw new Error(`Duplicate Sheet-6 asset number ${binding.number}`);
    numbers.add(binding.number);
  }

  const entries = new Map(normalized.map((binding) => [binding.number, {
    binding,
    status: 'pending',
    root: null,
    mixer: null,
    actions: new Map(),
    clips: [],
    runtimeScaleVector: null,
    error: null,
    fallback: null,
    fallbackWasVisible: null,
    fallbackHidden: false,
    stateRevision: -1,
    stateError: null,
    updateError: null,
    disposed: false,
  }]));
  const prototypePromises = new Map();
  const prototypeRecords = new Map();
  const ownedResources = emptyResources();
  const released = emptyReleasedResources();
  const closedImages = new WeakSet();
  const disposalTotals = {
    geometries: 0,
    materials: 0,
    textures: 0,
    imageBitmaps: 0,
    skeletons: 0,
    instancedMeshes: 0,
  };
  let currentState = initialState;
  let stateRevision = 0;
  let settled = 0;
  let succeeded = 0;
  let failed = 0;
  let disposed = false;
  let readyResolved = false;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  function diagnostics() {
    return Object.freeze({
      total: normalized.length,
      pending: normalized.length - settled,
      settled,
      succeeded,
      failed,
      isSettled: settled === normalized.length,
      disposed,
      prototypePromiseCount: prototypePromises.size,
      prototypeCount: prototypeRecords.size,
      resourceCounts: Object.freeze(Object.fromEntries(
        Object.entries(ownedResources).map(([key, values]) => [key, values.size]),
      )),
      disposal: Object.freeze({ ...disposalTotals }),
      assets: Object.freeze([...entries.values()].map((entry) => Object.freeze({
        number: entry.binding.number,
        url: entry.binding.runtimeGlb,
        status: entry.status,
        mounted: !!entry.root?.parent,
        fallbackHidden: entry.fallbackHidden,
        scaleApplications: entry.root?.userData?.sheet06ScaleApplications || 0,
        stateRevision: entry.stateRevision,
        stateError: diagnosticError(entry.stateError),
        updateError: diagnosticError(entry.updateError),
        error: diagnosticError(entry.error),
        disposed: entry.disposed,
      }))),
    });
  }

  function finishReady() {
    if (readyResolved || settled !== normalized.length) return;
    readyResolved = true;
    const snapshot = diagnostics();
    resolveReady(snapshot);
    if (!disposed && typeof onReady === 'function') onReady(snapshot);
  }

  function settle(entry, success, error = null, { callback = true } = {}) {
    if (entry.status !== 'pending' && entry.status !== 'loading') return false;
    entry.status = success ? 'ready' : (error?.code === 'DISPOSED' ? 'disposed' : 'failed');
    entry.error = error;
    settled += 1;
    if (success) succeeded += 1; else failed += 1;
    if (callback && !disposed && typeof onAssetSettled === 'function') {
      onAssetSettled(Object.freeze({
        number: entry.binding.number,
        success,
        root: success ? entry.root : null,
        error: diagnosticError(error),
      }));
    }
    finishReady();
    return true;
  }

  function releaseResources(resources) {
    for (const object of resources.instancedMeshes || []) {
      if (released.instancedMeshes.has(object) || typeof object.dispose !== 'function') continue;
      released.instancedMeshes.add(object);
      object.dispose();
      disposalTotals.instancedMeshes += 1;
    }
    for (const skeleton of resources.skeletons || []) {
      if (released.skeletons.has(skeleton) || typeof skeleton.dispose !== 'function') continue;
      released.skeletons.add(skeleton);
      skeleton.dispose();
      disposalTotals.skeletons += 1;
    }
    for (const texture of resources.textures || []) {
      if (released.textures.has(texture) || typeof texture.dispose !== 'function') continue;
      released.textures.add(texture);
      disposalTotals.imageBitmaps += closeTextureImages(texture, closedImages);
      texture.dispose();
      disposalTotals.textures += 1;
    }
    for (const material of resources.materials || []) {
      if (released.materials.has(material) || typeof material.dispose !== 'function') continue;
      released.materials.add(material);
      material.dispose();
      disposalTotals.materials += 1;
    }
    for (const geometry of resources.geometries || []) {
      if (released.geometries.has(geometry) || typeof geometry.dispose !== 'function') continue;
      released.geometries.add(geometry);
      geometry.dispose();
      disposalTotals.geometries += 1;
    }
  }

  function prototypeFor(url) {
    let promise = prototypePromises.get(url);
    if (promise) return promise;
    promise = loadWith(loader, url).then((gltf) => {
      if (!gltf?.scene) throw new Sheet06LoadError('SCENE_MISSING', `${url} has no GLTF scene`);
      const resources = collectSheet06Resources(gltf.scene);
      if (disposed) {
        releaseResources(resources);
        throw new Sheet06LoadError('DISPOSED', `Sheet-6 cache disposed before ${url} completed`);
      }
      const record = { gltf, resources };
      prototypeRecords.set(url, record);
      mergeResources(ownedResources, resources);
      return record;
    }).catch((error) => { throw asLoadError(error); });
    prototypePromises.set(url, promise);
    return promise;
  }

  function makeMixer(entry) {
    if (!entry.clips.length) return;
    entry.mixer = mixerFactory(entry.root, entry.binding);
    for (const clip of entry.clips) {
      const action = entry.mixer?.clipAction?.(clip, entry.root);
      if (action) entry.actions.set(clip.name, action);
    }
  }

  async function applyLatestState(entry, initial = false) {
    let initialPass = initial;
    do {
      const revision = stateRevision;
      thawHierarchy(entry.root);
      let applicationError = null;
      try {
        await applyStateToAsset({
          binding: entry.binding,
          root: entry.root,
          state: currentState,
          mixer: entry.mixer,
          actions: entry.actions,
          clips: entry.clips,
          initial: initialPass,
        });
      } catch (error) {
        applicationError = error;
      }
      if (entry.runtimeScaleVector && !sameScale(entry.root.scale, entry.runtimeScaleVector)) {
        entry.root.scale.copy(entry.runtimeScaleVector);
        throw new Sheet06LoadError(
          'STATE_SCALE_FORBIDDEN',
          `Asset ${entry.binding.number} state application attempted a second scale`,
        );
      }
      if (applicationError) throw applicationError;
      entry.stateRevision = revision;
      entry.stateError = null;
      initialPass = false;
    } while (!disposed && entry.stateRevision !== stateRevision);
  }

  async function loadEntry(entry) {
    entry.status = 'loading';
    try {
      const record = await prototypeFor(entry.binding.runtimeGlb);
      if (disposed) throw new Sheet06LoadError('DISPOSED', 'Cache disposed before instance creation');
      const contract = validatePrototype(entry.binding, record.gltf);
      const root = clonePrototype(contract.root);
      if (!root) throw new Sheet06LoadError('CLONE_FAILED', `Asset ${entry.binding.number} clone failed`);
      // SkeletonUtils clones any mutable skeleton state while geometry,
      // materials and textures remain immutable shared prototype identities.
      // Merge the instance view so clone-owned skeletons/instancing buffers are
      // protected from outer teardown and released by this owner as well.
      mergeResources(ownedResources, collectSheet06Resources(root));
      entry.root = root;
      entry.clips = contract.clips;
      root.userData.sheet06AssetNumber = entry.binding.number;
      root.userData.sheet06RuntimeUrl = entry.binding.runtimeGlb;
      root.traverse?.((object) => { object.userData.sheet06SharedRenderResources = true; });
      hideGlbCollision(root);
      const scaled = scaleExactlyOnce(root, entry.binding);
      entry.runtimeScaleVector = scaled;
      const defaultMount = lookup(mounts, entry.binding.mount.root, entry.binding);
      const placement = placementResolver
        ? await placementResolver({ binding: entry.binding, root, mount: defaultMount, mounts })
        : { parent: defaultMount };
      if (disposed) throw new Sheet06LoadError('DISPOSED', 'Cache disposed during placement resolution');
      if (!sameScale(root.scale, scaled)) {
        throw new Sheet06LoadError('PLACEMENT_SCALE_FORBIDDEN', `Asset ${entry.binding.number} placement changed scale`);
      }
      const parent = applyPlacement(root, placement, defaultMount);
      if (!sameScale(root.scale, scaled)) {
        throw new Sheet06LoadError('PLACEMENT_SCALE_FORBIDDEN', `Asset ${entry.binding.number} placement applied scale twice`);
      }
      root.visible = false;
      parent.add(root);
      makeMixer(entry);
      try {
        await applyLatestState(entry, true);
      } catch (error) {
        stopEntryAnimation(entry);
        detach(root);
        throw new Sheet06LoadError('INITIAL_STATE_FAILED', `Asset ${entry.binding.number} state apply failed: ${error.message}`, error);
      }
      if (disposed) {
        stopEntryAnimation(entry);
        detach(root);
        throw new Sheet06LoadError('DISPOSED', 'Cache disposed during initial state apply');
      }
      freezeStaticHierarchy(root, entry.clips);
      root.visible = true;
      entry.fallback = lookup(fallbacks, entry.binding.fallback, entry.binding);
      if (entry.fallback && 'visible' in entry.fallback) {
        entry.fallbackWasVisible = entry.fallback.visible;
        entry.fallback.visible = false;
        entry.fallbackHidden = true;
      }
      settle(entry, true);
    } catch (error) {
      const failure = asLoadError(error);
      if (entry.root && entry.status !== 'ready') {
        stopEntryAnimation(entry);
        detach(entry.root);
        entry.root = null;
      }
      settle(entry, false, failure);
    }
  }

  async function applyState(state) {
    if (disposed) return Object.freeze({ applied: 0, failed: 0, disposed: true });
    currentState = state;
    stateRevision += 1;
    const mounted = [...entries.values()].filter((entry) => entry.status === 'ready' && entry.root);
    const results = await Promise.allSettled(mounted.map(async (entry) => {
      try {
        await applyLatestState(entry, false);
        if (!disposed) freezeStaticHierarchy(entry.root, entry.clips);
      } catch (error) {
        entry.stateError = asLoadError(error, 'STATE_APPLY_FAILED');
        if (!disposed && entry.root) freezeStaticHierarchy(entry.root, entry.clips);
        throw entry.stateError;
      }
    }));
    return Object.freeze({
      applied: results.filter(({ status }) => status === 'fulfilled').length,
      failed: results.filter(({ status }) => status === 'rejected').length,
      disposed,
    });
  }

  function borrowedResources() {
    return snapshotResources(ownedResources);
  }

  function getRoot(number) {
    if (disposed) return null;
    const entry = entries.get(Number(number));
    return entry?.status === 'ready' ? entry.root : null;
  }

  function update(deltaSeconds) {
    if (disposed || !Number.isFinite(deltaSeconds)) return 0;
    let count = 0;
    for (const entry of entries.values()) {
      if (entry.status !== 'ready' || !entry.mixer) continue;
      try {
        entry.mixer.update(deltaSeconds);
        entry.updateError = null;
        count += 1;
      } catch (error) {
        entry.updateError = asLoadError(error, 'MIXER_UPDATE_FAILED');
      }
    }
    return count;
  }

  function dispose() {
    const alreadyDisposed = disposed;
    if (!disposed) {
      disposed = true;
      for (const entry of entries.values()) {
        if (entry.status === 'pending' || entry.status === 'loading') {
          settle(entry, false, new Sheet06LoadError('DISPOSED', 'Cache disposed before asset settled'), { callback: false });
        }
        if (entry.fallbackHidden && entry.fallback && 'visible' in entry.fallback) {
          entry.fallback.visible = entry.fallbackWasVisible;
          entry.fallbackHidden = false;
        }
        stopEntryAnimation(entry);
        detach(entry.root);
        entry.root = null;
        entry.clips = [];
        entry.runtimeScaleVector = null;
        entry.disposed = true;
        entry.fallback = null;
      }
      releaseResources(ownedResources);
      for (const values of Object.values(ownedResources)) values.clear();
      prototypeRecords.clear();
      prototypePromises.clear();
      currentState = null;
      mounts = null;
      fallbacks = null;
      placementResolver = null;
      applyStateToAsset = () => {};
      onAssetSettled = null;
      onReady = null;
      finishReady();
    }
    return Object.freeze({ ...disposalTotals, alreadyDisposed });
  }

  for (const entry of entries.values()) loadEntry(entry);
  finishReady();

  return Object.freeze({
    ready,
    isSettled: () => settled === normalized.length,
    diagnostics,
    getRoot,
    applyState,
    update,
    borrowedResources,
    dispose,
  });
}

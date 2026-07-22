import * as THREE from 'three';

// These are static, movable retail-fixture shells. Their visible meshes never
// animate or change independently, while their named stocking sockets and
// collision helpers remain live in the authored hierarchy.
export const MOVABLE_FIXTURE_CORE_MODELS = Object.freeze([
  'ball_shelf',
  'accessory_slatwall',
  'club_rack',
  'putter_rack',
  'apparel_table',
  'apparel_wall',
  'apparel_wall_display',
  'hat_wall',
  'bag_display',
  'shoe_wall',
  'merch_table',
  'rangefinder_display',
  'stock_shelving',
  'snack_shelf',
]);

// Audited against the shipped GLBs and the production fixture arrangement.
// This covers authored fixture cores only: products, signs, register devices,
// doors, renovation dressing and other dynamic props are intentionally absent.
export const MOVABLE_FIXTURE_CORE_DRAW_CALL_BUDGET = Object.freeze({
  // 825 submeshes, up from 790: asset 26's bag display was rebuilt to the
  // reference sheet and now carries a plank deck, a welded perimeter channel,
  // four legs and a cradle per bay rather than a slab and two posts.
  // The batched ceiling is deliberately unchanged - the new parts reuse
  // materials the fixture already had, so the batcher still collapses the whole
  // core to 87 draws. If a rebuild ever moves the ceiling, that is a real
  // regression and this number must not simply be raised to match.
  unbatched: 825,
  batchedCeiling: 87,
});

const BATCHABLE_MODELS = new Set(MOVABLE_FIXTURE_CORE_MODELS);
const HARD_EXCLUDED_NAME = /^(?:COL_|COLLISION_|VOLUME_|INTERACTION_|ANCHOR_|PICKUP_|BARCODE_)/i;

function isBatchableRenderMesh(object) {
  if (!object?.isMesh || object.visible === false || !object.geometry || !object.material) return false;
  if (object.isSkinnedMesh || object.isInstancedMesh || Array.isArray(object.material)) return false;
  if (object.material.visible === false || object.morphTargetInfluences) return false;
  if (object.layers.mask !== 1) return false;
  if (HARD_EXCLUDED_NAME.test(String(object.name || ''))) return false;
  const data = object.userData || {};
  return !(
    data.anchor
    || data.anchor_kind
    || data.socket
    || data.helper
    || data.collision_proxy
    || data.dynamic
    || data.interactive
    || data.animated
    || data.do_not_batch
    || data.batch_exclude
  );
}

function normalizedTuple(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return fallback.map((defaultValue, index) => {
    const next = Number(value[index]);
    return Number.isFinite(next) ? next : defaultValue;
  });
}

function normalizedSpec(spec) {
  const scalar = Number(spec?.scale);
  const scale = Array.isArray(spec?.scale)
    ? normalizedTuple(spec.scale, [1, 1, 1])
    : [Number.isFinite(scalar) ? scalar : 1, Number.isFinite(scalar) ? scalar : 1, Number.isFinite(scalar) ? scalar : 1];
  return Object.freeze({
    model: String(spec?.model || ''),
    position: normalizedTuple(spec?.position, [0, 0, 0]),
    rotation: normalizedTuple(spec?.rotation, [0, 0, 0]),
    scale,
  });
}

function arrangementKey(specs) {
  return JSON.stringify(specs.map((spec) => [spec.model, spec.position, spec.rotation, spec.scale]));
}

function countDrawCalls(root) {
  let count = 0;
  root?.traverseVisible((object) => {
    if (!object.isMesh || !object.geometry || object.material?.visible === false) return;
    count += Array.isArray(object.material) ? object.material.length : 1;
  });
  return count;
}

function buildIdentityLocalScratch(structure, candidates) {
  // The structure is deliberately unattached and identity-local. Still compute
  // each matrix relative to it explicitly, so a future structure transform
  // cannot accidentally bake world space and then apply the fixture pose twice.
  structure.updateMatrixWorld(true);
  const structureInverse = structure.matrixWorld.clone().invert();
  const scratch = new THREE.Group();
  scratch.name = 'MovableFixtureCoreBakeScratch';
  for (const source of candidates) {
    const mesh = new THREE.Mesh(source.geometry, source.material);
    mesh.name = `${source.name || 'FixtureMesh'}_BATCH_SOURCE`;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.multiplyMatrices(structureInverse, source.matrixWorld);
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    scratch.add(mesh);
  }
  return scratch;
}

function instantiateStructure(merch, specs, name) {
  const structure = new THREE.Group();
  structure.name = `${name}AuthoredStructure`;
  structure.userData.fixtureCoreStructure = true;
  for (const spec of specs) {
    const model = merch?.instantiateKit && merch.instantiateKit(spec.model);
    if (!model) return null;
    // A placement wrapper composes outside the authored root. Component-wise
    // position/rotation/scale mutation is not equivalent when the GLB already
    // carries an import correction or a non-zero root offset.
    const placement = new THREE.Group();
    placement.name = `${spec.model}FixturePlacement`;
    placement.position.fromArray(spec.position);
    placement.rotation.set(...spec.rotation);
    placement.scale.fromArray(spec.scale);
    placement.add(model);
    structure.add(placement);
  }
  return structure;
}

function attachUnbatched(target, structure, key, candidates) {
  target.add(structure);
  return Object.freeze({
    batched: false,
    key,
    structure,
    visual: null,
    sourceDrawCalls: candidates.length,
    batchedDrawCalls: candidates.length,
  });
}

function suppressStaticRenderMeshes(candidates) {
  for (const object of candidates) {
    // Object3D.visible cascades to children. A stocking socket or a product
    // mounted below a mesh must remain renderable, so suppress only this mesh's
    // camera-layer membership and leave the authored hierarchy visible.
    object.layers.mask = 0;
    object.userData.fixtureCoreRenderSuppressed = true;
  }
}

// One batcher belongs to one buildFixtures() lifetime and one merchandise
// resource owner. Cache templates stay unattached; relay clones share their
// baked geometries, which merch.disposeBaked()/dispose() owns and releases.
export function createMovableFixtureCoreBatcher(merch) {
  const cache = new Map();
  let bakeCount = 0;
  let cacheHits = 0;
  let cacheMisses = 0;

  function mount(target, rawSpecs, { name = 'MovableFixtureCore' } = {}) {
    if (!target?.isObject3D || !Array.isArray(rawSpecs) || !rawSpecs.length) return null;
    const specs = rawSpecs.map(normalizedSpec);
    if (specs.some((spec) => !BATCHABLE_MODELS.has(spec.model))) return null;

    const key = arrangementKey(specs);
    const structure = instantiateStructure(merch, specs, name);
    if (!structure) return null;
    structure.updateMatrixWorld(true);
    const candidates = [];
    structure.traverseVisible((object) => {
      if (isBatchableRenderMesh(object)) candidates.push(object);
    });
    if (!candidates.length || typeof merch?.bake !== 'function') {
      return attachUnbatched(target, structure, key, candidates);
    }

    let template = cache.get(key);
    if (template) {
      cacheHits += 1;
    } else {
      cacheMisses += 1;
      const scratch = buildIdentityLocalScratch(structure, candidates);
      const baked = merch.bake(scratch, { visibleOnly: true });
      if (!baked || baked === scratch || baked.userData?.merchBaked !== true) {
        return attachUnbatched(target, structure, key, candidates);
      }
      bakeCount += 1;
      baked.name = `${name}BatchTemplate`;
      baked.userData.fixtureCoreBatchTemplate = true;
      baked.userData.fixtureCoreBatchKey = key;
      baked.userData.fixtureCoreSourceDrawCalls = candidates.length;
      baked.traverse((object) => {
        if (!object.isMesh) return;
        // instantiateKit() makes authored fixture shells cast-only. merch.bake()
        // defaults to receive=true, so restore the shipped lighting contract.
        object.castShadow = true;
        object.receiveShadow = false;
      });
      template = Object.freeze({
        root: baked,
        sourceDrawCalls: candidates.length,
        batchedDrawCalls: countDrawCalls(baked),
      });
      cache.set(key, template);
    }

    // Keep every authored root, socket and helper addressable. Only the static
    // render meshes are suppressed; the cached batch draws their exact geometry.
    suppressStaticRenderMeshes(candidates);
    const visual = template.root.clone(true);
    visual.name = `${name}Batch`;
    visual.userData.fixtureCoreBatchTemplate = false;
    visual.userData.fixtureCoreBatchInstance = true;
    target.add(structure, visual);
    return Object.freeze({
      batched: true,
      key,
      structure,
      visual,
      sourceDrawCalls: template.sourceDrawCalls,
      batchedDrawCalls: template.batchedDrawCalls,
    });
  }

  function diagnostics() {
    return Object.freeze({
      cacheEntries: cache.size,
      bakeCount,
      cacheHits,
      cacheMisses,
      expectedUnbatchedDrawCalls: MOVABLE_FIXTURE_CORE_DRAW_CALL_BUDGET.unbatched,
      expectedBatchedDrawCallCeiling: MOVABLE_FIXTURE_CORE_DRAW_CALL_BUDGET.batchedCeiling,
    });
  }

  return Object.freeze({ mount, diagnostics });
}

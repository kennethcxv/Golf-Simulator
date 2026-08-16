// GOAL 29 PHASE 2 — COLLAPSE A STATIC SUBTREE TO ONE DRAW PER BUCKET,
// PIXEL-IDENTICALLY.
//
// This is the generalisation of propPlacement's placed-static batch, with the
// two corrections that phase demanded before it could touch the wider scene:
//
//   1. SHADOWS ARE PRESERVED. The placed batch set castShadow/receiveShadow
//      false on its output — acceptable for ten small props, a pixel bug for
//      architecture. Here the shadow flags are part of the bucket key and the
//      batch mesh carries them through.
//   2. NOTHING IS QUANTISED. The placed batch's vertex-palette fold rounds
//      roughness/metalness into four stylised responses — a deliberate
//      restyling, not a merge. Here two materials may share a fold bucket
//      ONLY when every pixel-relevant parameter is EXACTLY equal and only
//      the colour differs; the colour moves to a vertex attribute and the
//      bucket material goes white (white × c == c in IEEE — byte-identical).
//      Everything else buckets by material IDENTITY, and the merged mesh
//      REUSES the same material object, so no new program can appear.
//
// What refuses to join a batch (each reason recorded in the report):
//   skinned / instanced / morphed meshes, array materials, transparent or
//   non-depth-writing materials (blend order is draw order — merging reorders
//   it), collision proxies and helpers, anything under an ancestor carrying
//   animation clips or the entry-record mirrors (fixtureId / movable /
//   liveVisualHierarchy / visibilityGated / sim-item), anything the caller's
//   own exclude() names (the builder knows its mutable set better than any
//   generic walk), and any bucket whose merge would not reduce draw count.
//
// Sources are suppressed with layers.mask = 0 — the repo's standing pattern —
// so their matrices stay valid for interactions and instruments, and the
// batch can be reversed by clearing the mask.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const COLLISION_PROXY_NAME = /^(?:COL_|COLLISION_|VOLUME_)/i;

// Test hook: tests/golden red-green flips this to reproduce the exact defect
// class the shadow-preserving key exists to prevent. Never set in production.
export const STATIC_SUBTREE_BATCH_DEBUG = { dropShadowFlags: false };

function foldableKey(mesh, material) {
  // Fold across colours only when the material is an untextured, opaque,
  // fully-default-slot MeshStandardMaterial and EVERY other pixel-relevant
  // parameter agrees exactly. Anything else buckets by identity.
  if (!material.isMeshStandardMaterial) return null;
  if (material.map || material.normalMap || material.roughnessMap
    || material.metalnessMap || material.aoMap || material.emissiveMap
    || material.alphaMap || material.bumpMap || material.envMap
    || material.lightMap || material.displacementMap) return null;
  if (material.transparent || material.depthWrite === false) return null;
  return [
    'fold',
    material.roughness, material.metalness,
    material.emissive?.getHex?.() ?? 0,
    material.emissiveIntensity,
    material.alphaTest, material.side,
    material.flatShading ? 1 : 0,
    material.toneMapped === false ? 0 : 1,
    material.fog === false ? 0 : 1,
  ].join('|');
}

function bucketKeyFor(mesh, material) {
  const fold = foldableKey(mesh, material);
  const base = fold || `identity:${material.uuid}`;
  // mergeGeometries needs identical attribute sets, and an aoMap material
  // needs every member to carry the uv channel the map samples — so the
  // attribute signature is part of the key, and mismatched members split
  // into their own buckets instead of failing the merge.
  const a = mesh.geometry.attributes;
  const sig = `uv1:${a.uv1 ? 1 : 0}|uv2:${a.uv2 ? 1 : 0}`;
  if (STATIC_SUBTREE_BATCH_DEBUG.dropShadowFlags) return `${base}|${sig}`;
  return `${base}|${sig}|cs${mesh.castShadow ? 1 : 0}|rs${mesh.receiveShadow ? 1 : 0}|ro${mesh.renderOrder | 0}`;
}

function chainBlocked(mesh, root, exclude) {
  for (let node = mesh; node; node = node.parent) {
    if (typeof exclude === 'function' && exclude(node)) return `excluded:${node.name || node.type}`;
    if (node.userData) {
      const u = node.userData;
      if (u.fixtureId || u.movable) return 'movable-fixture';
      if (u.liveVisualHierarchy) return 'live-visual-hierarchy';
      if (u.visibilityGated) return 'visibility-gated';
      if (u.kind === 'item') return 'sim-item';
      if (u.collision_proxy || u.helper) return 'proxy-or-helper';
    }
    if (node.animations?.length) return 'ancestor-animations';
    if (COLLISION_PROXY_NAME.test(node.name || '')) return 'collision-proxy-name';
    if (node === root) break;
  }
  return null;
}

export function batchStaticSubtree(root, { label = 'StaticSubtreeBatch', exclude = null } = {}) {
  if (!root) return { skipped: 'no-root' };
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const candidates = [];
  const skippedReasons = new Map();
  const skip = (reason) => skippedReasons.set(reason, (skippedReasons.get(reason) || 0) + 1);

  root.traverseVisible((object) => {
    if (!object.isMesh) return;
    if (object.isInstancedMesh || object.isSkinnedMesh) return skip('instanced-or-skinned');
    if (object.morphTargetInfluences?.length) return skip('morph-targets');
    if (object.layers.mask === 0) return skip('already-suppressed');
    if (Array.isArray(object.material)) return skip('array-material');
    const material = object.material;
    if (!material || !object.geometry?.attributes?.position) return skip('no-material-or-geometry');
    if (material.transparent || material.depthWrite === false) return skip('transparent-or-no-depth-write');
    const blocked = chainBlocked(object, root, exclude);
    if (blocked) return skip(blocked);
    candidates.push(object);
  });
  if (candidates.length < 2) {
    return { skipped: 'insufficient-static-draws', candidates: candidates.length, skippedReasons: Object.fromEntries(skippedReasons) };
  }

  const buckets = new Map();
  for (const source of candidates) {
    const key = bucketKeyFor(source, source.material);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, fold: key.startsWith('fold'), sources: [] };
      buckets.set(key, bucket);
    }
    bucket.sources.push(source);
  }

  // Only buckets that actually reduce draws take their sources; a bucket of
  // one stays untouched, so a lone mesh never pays a rebuild for nothing.
  const taking = [...buckets.values()].filter((b) => b.sources.length >= 2);
  if (!taking.length) {
    return { skipped: 'no-bucket-reduces', candidates: candidates.length, skippedReasons: Object.fromEntries(skippedReasons) };
  }

  const batchRoot = new THREE.Group();
  batchRoot.name = label;
  batchRoot.userData.staticSubtreeBatch = true;
  let taken = 0;
  let batchedDrawCalls = 0;
  const relative = new THREE.Matrix4();

  for (const bucket of taking) {
    const geometries = [];
    for (const source of bucket.sources) {
      let geometry = source.geometry.clone();
      relative.copy(rootInverse).multiply(source.matrixWorld);
      geometry.applyMatrix4(relative);
      for (const name of Object.keys(geometry.attributes)) {
        // uv1/uv2 stay: architecture materials sample their dirt-mask aoMap
        // through the second channel, and stripping it would break the mask.
        if (!['position', 'normal', 'uv', 'uv1', 'uv2', 'color'].includes(name)) geometry.deleteAttribute(name);
      }
      if (geometry.index) {
        const indexed = geometry;
        geometry = indexed.toNonIndexed();
        indexed.dispose();
      }
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const vertexCount = geometry.getAttribute('position').count;
      if (!geometry.getAttribute('uv')) {
        geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertexCount * 2), 2));
      }
      if (bucket.fold) {
        // colour moves to the vertices. A source already using vertex colours
        // contributes material.color × its own attribute — the same product
        // the shader computed before the fold.
        const out = new Float32Array(vertexCount * 3);
        const c = source.material.color;
        const prior = source.material.vertexColors ? geometry.getAttribute('color') : null;
        for (let i = 0; i < vertexCount; i += 1) {
          out[i * 3] = c.r * (prior ? prior.getX(i) : 1);
          out[i * 3 + 1] = c.g * (prior ? prior.getY(i) : 1);
          out[i * 3 + 2] = c.b * (prior ? prior.getZ(i) : 1);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(out, 3));
      } else if (geometry.getAttribute('color') && !source.material.vertexColors) {
        // an unused authored colour attribute would poison the merge shape
        geometry.deleteAttribute('color');
      }
      geometries.push(geometry);
    }
    let merged;
    try {
      merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    } catch {
      merged = null;
    }
    if (!merged) {
      for (const geometry of geometries) geometry.dispose();
      skip(`merge-failed:${bucket.key.slice(0, 40)}`);
      continue;
    }
    for (const geometry of geometries) if (geometry !== merged) geometry.dispose();
    merged.computeBoundingSphere();
    merged.computeBoundingBox();

    let material;
    if (bucket.fold) {
      material = bucket.sources[0].material.clone();
      material.name = `${label}_fold`;
      material.color.set(0xffffff);
      material.vertexColors = true;
      material.userData.staticSubtreeBatchFoldMaterial = true; // minted here; the owner disposes it
    } else {
      material = bucket.sources[0].material; // identity bucket: SAME object, no new program
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `${label}_${batchedDrawCalls}`;
    const first = bucket.sources[0];
    if (!STATIC_SUBTREE_BATCH_DEBUG.dropShadowFlags) {
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder;
    }
    mesh.userData.staticSubtreeBatchMesh = true;
    mesh.userData.disposeGeometry = true;
    batchRoot.add(mesh);
    batchedDrawCalls += 1;
    for (const source of bucket.sources) {
      source.layers.mask = 0;
      source.userData.staticSubtreeBatchSuppressed = true;
      taken += 1;
    }
  }

  if (!batchedDrawCalls || batchedDrawCalls >= taken) {
    // every bucket failed to merge, or the arithmetic went wrong: undo
    for (const bucket of taking) {
      for (const source of bucket.sources) {
        if (source.userData.staticSubtreeBatchSuppressed) {
          source.layers.mask = 1;
          delete source.userData.staticSubtreeBatchSuppressed;
        }
      }
    }
    batchRoot.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
    return { skipped: 'no-draw-call-reduction', candidates: candidates.length, batchedDrawCalls, taken };
  }

  root.add(batchRoot);
  return {
    visual: batchRoot,
    label,
    candidates: candidates.length,
    sourceDrawCalls: taken,
    batchedDrawCalls,
    savedDrawCalls: taken - batchedDrawCalls,
    foldBuckets: taking.filter((b) => b.fold).length,
    identityBuckets: taking.filter((b) => !b.fold).length,
    skippedReasons: Object.fromEntries(skippedReasons),
  };
}

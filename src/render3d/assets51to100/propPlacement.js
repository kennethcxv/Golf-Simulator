// RUNTIME PLACEMENT + INTERACTION ADAPTER — Assets 61 through 100.
//
// Sheet 6 owns the structural runtime. This module consumes the complete runtime manifest for the
// remaining forty assets, aligns every SOCKET_PLACEMENT, follows persisted fixture anchors, adapts
// authored clips to ordinary walk interactions, and exposes cleaning-tool pickups without changing
// the cleaning simulation itself.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CLEANING_TOOLS } from '../../data/cleaningTools.js';
import { INTERIOR } from '../../data/shopLayout.js';
import { facilityInstalled } from '../../sim/campaign.js';
import { fixtureIsInstalled } from '../../sim/shopProgression.js';
import {
  collectMaterialResources,
  collectRenderableResources,
  disposeRenderableResources,
  mergeRenderableResources,
} from '../clubhouse/resourceLifecycle.js';
import {
  PLACED_ASSET_NUMBERS, PROP_PLACEMENTS, RUNTIME_ASSET_MANIFEST_BY_NUMBER,
} from './runtimeManifest.js';

export { PLACED_ASSET_NUMBERS, PROP_PLACEMENTS };

/** Authored replacements for temporary or older clubhouse visuals. */
export const SUPERSEDES = Object.freeze([
  { legacy: 'LegacyCheckoutCounter', replacedBy: [61] },
  { legacy: 'LegacyCheckoutProductionCounter', replacedBy: [61] },
  { legacy: 'LegacyPackingBench', replacedBy: [65] },
  { legacy: 'LegacyOfficeDesk', replacedBy: [66] },
  { legacy: 'LegacyOfficeDeskAuthored', replacedBy: [66] },
  { legacy: 'LegacyLoungeChairA', replacedBy: [67] },
  { legacy: 'LegacyLoungeChairB', replacedBy: [68] },
  { legacy: 'LegacyLoungeCoffeeTable', replacedBy: [69] },
  { legacy: 'LegacyLoungeTrophyDisplay', replacedBy: [70] },
  { legacy: 'LegacyCleaningCornerScenery', replacedBy: [71, 72, 73, 74, 75] },
  { legacy: 'LegacyOfficeChair', replacedBy: [81] },
  { legacy: 'LegacyOfficeFilingCabinet', replacedBy: [82] },
  { legacy: 'LegacyWelcomeMat', replacedBy: [100] },
]);

// Entrance-facing dressing can remain visible through the door and windows. Deeper interior
// props are fully occluded once the camera is beyond the porch, so culling them avoids needless
// draw calls during exterior cleaning without introducing a near-door pop.
export const EXTERIOR_VISIBLE_PROP_NUMBERS = Object.freeze([93, 94, 98, 99, 100]);
const EXTERIOR_VISIBLE_PROP_SET = new Set(EXTERIOR_VISIBLE_PROP_NUMBERS);
export const PROP_DETAIL_EXTERIOR_CLEARANCE_YD = 1.5;

// ...BUT A PROP THAT OWNS A RUNTIME LIGHT IS EXEMPT FROM THAT CULL.
//
// Hiding a root prunes the whole subtree out of three's per-frame walk — lights
// included — and the NUMBER of lights of each type is part of the cache key of
// every standard-material program in the scene. So crossing this 1.5 yd
// threshold took the point-light count from 5 to 3 and recompiled every
// `physical` program in the world. ANGLE defers the real HLSL compile to a
// program's first DRAW, so the bill arrives as a freeze, on the JS thread,
// while the player is walking.
//
// Measured in Electron on pine-hills-v2 (tools/qa/electron-stall-attribution.js,
// 2026-08-06): the first spin on the shop floor cost 2,460 ms across eight
// stalled frames, the worst 1,290 ms; the IDENTICAL spin immediately after cost
// 232 ms with no program arrivals. 42 programs arrived after the prewarm had
// finished, 36 of them `physical`. A fresh outdoor pose — where the prewarm
// camera stands — stalled not at all.
//
// What the cull was buying on these two props is a desk lamp and an emergency
// light: a few hundred triangles seen through a window. What it cost was a
// two-and-a-half-second freeze on the first walk into your own pro shop, and
// another every time a light-bearing prop is installed thereafter.
//
// Derived from `placement.light`, not from asset numbers, for the reason
// runtimeAssetNeedsLiveVisualHierarchy gives above: a new lamp added to
// PROP_PLACEMENTS must not silently reintroduce the stall.
export const LIGHT_BEARING_PROP_NUMBERS = Object.freeze(
  PROP_PLACEMENTS.filter((placement) => placement && placement.light).map((placement) => placement.n),
);
const LIGHT_BEARING_PROP_SET = new Set(LIGHT_BEARING_PROP_NUMBERS);

// The one gate the detail LOD may not close. Kept as a named function because
// three call sites ask the same question and they drifted apart once already.
const propSurvivesDetailCull = (number) => (
  EXTERIOR_VISIBLE_PROP_SET.has(Number(number)) || LIGHT_BEARING_PROP_SET.has(Number(number))
);
export const FACILITY_GATED_PROP_ASSETS = Object.freeze({
  61: 'frontCounter',
  66: 'officeDesk',
  81: 'officeChair',
});
export const FIXTURE_GATED_PROP_ASSETS = Object.freeze({
  // The premium fitting booth occupied the opening cooler's exact sightline
  // when all sheet assets were rendered at the basic Pine Hills tier.
  63: 'fittingroom',
});

/**
 * Stateful props must retain their authored render hierarchy. Their animation,
 * pickup, practical-light, or mutable presentation is driven after loading, so
 * baking either the root or its material into a cross-asset snapshot would
 * leave the visible copy behind when that live state changes.
 *
 * This is intentionally derived from placement metadata rather than asset
 * numbers. New interactive tools and practicals therefore fail safe without
 * extending an ID allow/deny list.
 */
export function runtimeAssetNeedsLiveVisualHierarchy(placement = null) {
  if (!placement || typeof placement !== 'object') return false;
  return !!(
    placement.interaction
    || placement.tool
    || (Array.isArray(placement.tools) && placement.tools.length)
    || placement.light
    || placement.mutableVisual
    || placement.runtimeVisualState
  );
}

/**
 * Whether one placement can share the deep-interior static batch.
 *
 * Dynamic presentation callbacks always require an independent root: their
 * answer can change after this one-time geometry snapshot has been created.
 * Callers with an immutable construction policy may opt into the separate
 * fixed callback; its allowed assets can safely share the global batch.
 */
export function runtimeAssetEligibleForPlacedStaticBatch(
  placement,
  {
    visibilityForAsset = null,
    fixedVisibilityForAsset = null,
    hasStaticVisual = true,
  } = {},
) {
  const number = Number(placement?.n);
  if (!Number.isInteger(number) || !hasStaticVisual) return false;
  if (typeof visibilityForAsset === 'function') return false;
  if (typeof fixedVisibilityForAsset === 'function'
    && fixedVisibilityForAsset(number) === false) return false;
  if (placement.fixtureId || (Array.isArray(placement.fixtureIds) && placement.fixtureIds.length)) {
    return false;
  }
  return !Object.hasOwn(FACILITY_GATED_PROP_ASSETS, number)
    && !Object.hasOwn(FIXTURE_GATED_PROP_ASSETS, number)
    && !propSurvivesDetailCull(number)
    && !runtimeAssetNeedsLiveVisualHierarchy(placement);
}

export function detailedPropsVisibleAt(
  cameraLocalX,
  cameraLocalZ,
  clearance = PROP_DETAIL_EXTERIOR_CLEARANCE_YD,
) {
  if (![cameraLocalX, cameraLocalZ, clearance].every(Number.isFinite) || clearance < 0) return true;
  const dx = Math.max(Math.abs(cameraLocalX) - INTERIOR.w / 2, 0);
  const dz = Math.max(Math.abs(cameraLocalZ) - INTERIOR.d / 2, 0);
  return Math.hypot(dx, dz) < clearance;
}

const vectorFromTransform = (record) => new THREE.Vector3(...record.defaultTransform.position);

const COLLISION_PROXY_NAME = /^(?:COL_|COLLISION_|VOLUME_)/i;

function isAuthoredCollisionProxy(object, root) {
  let current = object;
  while (current) {
    if (COLLISION_PROXY_NAME.test(current.name || '')
      || current.userData?.collision_proxy === true) return true;
    if (current === root) break;
    current = current.parent;
  }
  return false;
}

function animationBranches(root, clips) {
  const dynamic = new Set();
  const unresolved = [];
  for (const clip of clips || []) {
    for (const track of clip.tracks || []) {
      let nodeName = null;
      try {
        nodeName = THREE.PropertyBinding.parseTrackName(track.name)?.nodeName || null;
      } catch (_) {
        nodeName = null;
      }
      const target = nodeName ? root.getObjectByName(nodeName) : null;
      if (!target) {
        unresolved.push(track.name);
        continue;
      }
      // A transform/visibility track on a parent moves every renderable descendant. Keep that
      // complete branch live and batch only geometry that cannot participate in the clip.
      target.traverse((object) => dynamic.add(object));
    }
  }
  return { dynamic, unresolved };
}

function renderedMeshCount(root) {
  let count = 0;
  root?.traverse((object) => {
    if (object.isMesh && object.visible && object.layers.mask !== 0) count += 1;
  });
  return count;
}

function attributeComponent(attribute, index, component) {
  if (component === 0) return attribute.getX(index);
  if (component === 1) return attribute.getY(index);
  if (component === 2) return attribute.getZ(index);
  return attribute.getW(index);
}

// GLTF commonly stores a whole prop as one Mesh with many material groups. Three.js emits one
// draw for every group, while the generic clubhouse baker deliberately leaves material arrays
// loose. Expand a group to a temporary single-material geometry so identical authored materials
// can merge across the prop without changing UVs, normals or triangle order.
function geometryForMaterialGroup(source, group) {
  const start = Math.max(0, Math.floor(group.start || 0));
  const available = source.index?.count || source.attributes?.position?.count || 0;
  const count = Math.max(0, Math.min(Math.floor(group.count || 0), available - start));
  if (count < 3) return null;
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = source.getAttribute(name);
    if (!attribute) continue;
    const values = new Float32Array(count * attribute.itemSize);
    for (let offset = 0; offset < count; offset += 1) {
      const sourceIndex = source.index ? source.index.getX(start + offset) : start + offset;
      for (let component = 0; component < attribute.itemSize; component += 1) {
        values[offset * attribute.itemSize + component] = attributeComponent(
          attribute,
          sourceIndex,
          component,
        );
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
  }
  return geometry;
}

function roundedMaterialNumber(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(6)) : null;
}

function materialSignature(material) {
  if (!material || !material.isMaterial) return null;
  // Texture identities from separate GLBs are not proof that their pixels or colour spaces match.
  // Canonicalise only the generated untextured PBR palette shared by these authored sheets.
  if (Object.values(material).some((value) => value?.isTexture)) return null;
  return JSON.stringify({
    type: material.type,
    color: material.color?.getHexString?.() || null,
    emissive: material.emissive?.getHexString?.() || null,
    emissiveIntensity: roundedMaterialNumber(material.emissiveIntensity),
    roughness: roundedMaterialNumber(material.roughness),
    metalness: roundedMaterialNumber(material.metalness),
    opacity: roundedMaterialNumber(material.opacity),
    transparent: !!material.transparent,
    alphaTest: roundedMaterialNumber(material.alphaTest),
    side: material.side,
    vertexColors: !!material.vertexColors,
    flatShading: !!material.flatShading,
    depthTest: material.depthTest !== false,
    depthWrite: material.depthWrite !== false,
    blending: material.blending,
    toneMapped: material.toneMapped !== false,
  });
}

function canonicalizeRuntimeMaterials(root, canonicalMaterials, orphanedMaterials) {
  let replacements = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    const replace = (material) => {
      const signature = materialSignature(material);
      if (!signature) return material;
      const canonical = canonicalMaterials.get(signature);
      if (!canonical) {
        canonicalMaterials.set(signature, material);
        return material;
      }
      if (canonical !== material) {
        orphanedMaterials.add(material);
        replacements += 1;
      }
      return canonical;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(replace)
      : replace(object.material);
  });
  return replacements;
}

function hasMaterialTexture(material) {
  return !!material && Object.values(material).some((value) => value?.isTexture);
}

function vertexPaletteDescriptor(material) {
  if (hasMaterialTexture(material)) {
    return { key: `texture:${material.uuid}`, vertexColors: false };
  }
  const metal = Number(material.metalness) >= 0.45;
  const smooth = Number(material.roughness) < 0.55;
  const transparent = !!material.transparent;
  const emissive = material.emissive?.getHex?.() || 0;
  const descriptor = {
    type: material.type,
    metal,
    smooth,
    transparent,
    opacity: transparent ? Math.round(Number(material.opacity) * 20) / 20 : 1,
    emissive,
    emissiveIntensity: emissive ? roundedMaterialNumber(material.emissiveIntensity) : 0,
    alphaTest: roundedMaterialNumber(material.alphaTest),
    side: material.side,
    depthWrite: material.depthWrite !== false,
  };
  return {
    key: `vertex-palette:${JSON.stringify(descriptor)}`,
    vertexColors: true,
    // A restrained set of stylized PBR responses keeps the exact vertex colour while allowing
    // cream, green, walnut and charcoal pieces to share a draw. The two metal and two dielectric
    // responses preserve the important brass/wood and polished/matte distinctions.
    roughness: metal ? (smooth ? 0.32 : 0.58) : (smooth ? 0.48 : 0.82),
    metalness: metal ? 0.72 : 0,
    opacity: descriptor.opacity,
  };
}

function geometryForPlacedBatch(source, relative, color = null) {
  let geometry = source.geometry.clone();
  geometry.applyMatrix4(relative);
  for (const name of Object.keys(geometry.attributes)) {
    if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
  }
  if (geometry.index) {
    const indexed = geometry;
    geometry = indexed.toNonIndexed();
    indexed.dispose();
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const vertices = geometry.getAttribute('position')?.count || 0;
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertices * 2), 2));
  }
  if (color) {
    const values = new Float32Array(vertices * 3);
    for (let index = 0; index < vertices; index += 1) {
      values[index * 3] = color.r;
      values[index * 3 + 1] = color.g;
      values[index * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  }
  return geometry;
}

function batchPlacedStaticVisuals(parent, entries, merch) {
  if (!parent) return null;
  parent.updateMatrixWorld(true);
  const inverse = parent.matrixWorld.clone().invert();
  const candidates = [];
  for (const entry of entries) {
    // Persisted movable fixtures must carry their visual with their anchor. Everything else in
    // this runtime has a fixed clubhouse-local pose, including nested worktable pickups.
    if (entry.fixtureId || entry.needsLiveVisualHierarchy || !entry.staticBatch?.visual) continue;
    entry.staticBatch.visual.traverseVisible((object) => {
      if (object.isMesh && object.layers.mask !== 0 && object.geometry && object.material
        && !Array.isArray(object.material)) {
        candidates.push(object);
      }
    });
  }
  if (candidates.length < 2) return { skipped: 'insufficient-placed-static-draws' };

  const buckets = new Map();
  for (const source of candidates) {
    const descriptor = vertexPaletteDescriptor(source.material);
    let bucket = buckets.get(descriptor.key);
    if (!bucket) {
      const material = source.material.clone();
      material.name = `AssetRuntimeBatch_${source.material.name || source.material.type}`;
      if (descriptor.vertexColors) {
        material.color.set(0xffffff);
        material.vertexColors = true;
        material.roughness = descriptor.roughness;
        material.metalness = descriptor.metalness;
        material.opacity = descriptor.opacity;
      }
      bucket = { material, geometries: [], vertexColors: descriptor.vertexColors };
      buckets.set(descriptor.key, bucket);
    }
    const relative = inverse.clone().multiply(source.matrixWorld);
    bucket.geometries.push(geometryForPlacedBatch(
      source,
      relative,
      bucket.vertexColors ? source.material.color : null,
    ));
  }
  const visual = new THREE.Group();
  for (const bucket of buckets.values()) {
    let merged = null;
    try {
      merged = bucket.geometries.length === 1
        ? bucket.geometries[0]
        : mergeGeometries(bucket.geometries, false);
    } catch (_) {
      merged = null;
    }
    if (!merged) {
      for (const geometry of bucket.geometries) visual.add(new THREE.Mesh(geometry, bucket.material));
      continue;
    }
    for (const geometry of bucket.geometries) if (geometry !== merged) geometry.dispose();
    visual.add(new THREE.Mesh(merged, bucket.material));
  }
  const batchedDrawCalls = renderedMeshCount(visual);
  if (!batchedDrawCalls || batchedDrawCalls >= candidates.length) {
    visual.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose();
      object.material?.dispose();
    });
    return {
      skipped: 'no-placed-static-draw-reduction',
      sourceDrawCalls: candidates.length,
      batchedDrawCalls,
    };
  }
  visual.name = 'Assets61to100PlacedStaticBatch';
  visual.userData.assetRuntimePlacedStaticBatch = true;
  visual.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
  });
  for (const source of candidates) {
    source.layers.mask = 0;
    source.userData.assetRuntimePlacedStaticRenderSuppressed = true;
  }
  parent.add(visual);
  return {
    visual,
    sourceDrawCalls: candidates.length,
    batchedDrawCalls,
    savedDrawCalls: candidates.length - batchedDrawCalls,
  };
}

/**
 * Collapse the non-animated portion of one authored prop to one draw per shared material.
 *
 * Sockets, named nodes and animated branches stay in the original hierarchy. Their static source
 * meshes are removed only from camera layers, so attaching a pickup below a mesh or playing an
 * authored clip still works. This is the same non-destructive strategy used by movable fixtures.
 */
function batchStaticRenderMeshes(root, clips, merch, assetNumber) {
  if (!root || typeof merch?.bake !== 'function') return null;
  const { dynamic, unresolved } = animationBranches(root, clips);
  // Never guess when a shipped track cannot be resolved. A conservative loose render is cheaper
  // than an interaction whose moving panel silently disappears into a static batch.
  if (unresolved.length) return { skipped: 'unresolved-animation-track', unresolved };

  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const candidates = [];
  root.traverseVisible((object) => {
    if (!object.isMesh || !object.geometry || !object.material) return;
    if (object.isSkinnedMesh || object.morphTargetInfluences || dynamic.has(object)) return;
    if (isAuthoredCollisionProxy(object, root)) return;
    candidates.push(object);
  });
  const scratch = new THREE.Group();
  const temporaryGeometries = [];
  let sourceDrawCalls = 0;
  for (const source of candidates) {
    const relative = rootInverse.clone().multiply(source.matrixWorld);
    const addRelay = (geometry, material, suffix = '') => {
      if (!geometry || !material) return;
      const relay = new THREE.Mesh(geometry, material);
      relay.name = `${source.name}${suffix}`;
      relay.layers.mask = source.layers.mask;
      relay.visible = source.visible;
      relative.decompose(relay.position, relay.quaternion, relay.scale);
      scratch.add(relay);
      sourceDrawCalls += 1;
    };
    if (Array.isArray(source.material)) {
      for (const [groupIndex, materialGroup] of (source.geometry.groups || []).entries()) {
        const material = source.material[materialGroup.materialIndex];
        const geometry = geometryForMaterialGroup(source.geometry, materialGroup);
        if (geometry) temporaryGeometries.push(geometry);
        addRelay(geometry, material, `_MaterialGroup_${groupIndex}`);
      }
    } else {
      addRelay(source.geometry, source.material);
    }
  }
  if (sourceDrawCalls < 2) {
    for (const geometry of temporaryGeometries) geometry.dispose();
    return { skipped: 'insufficient-static-draws', sourceDrawCalls };
  }
  scratch.updateMatrixWorld(true);
  const visual = merch.bake(scratch, { visibleOnly: true });
  for (const geometry of temporaryGeometries) geometry.dispose();
  const batchedDrawCalls = renderedMeshCount(visual);
  if (!visual || visual === scratch || visual.userData?.merchBaked !== true
    || batchedDrawCalls >= sourceDrawCalls) {
    merch.disposeBaked?.(visual);
    return {
      skipped: 'no-draw-call-reduction',
      sourceDrawCalls,
      batchedDrawCalls,
    };
  }

  visual.name = `AssetRuntimeStaticBatch_${assetNumber}`;
  visual.userData.assetRuntimeStaticBatch = true;
  visual.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
  });
  for (const source of candidates) {
    source.layers.mask = 0;
    source.userData.assetRuntimeStaticRenderSuppressed = true;
  }
  root.add(visual);
  const publicResult = {
    sourceDrawCalls,
    batchedDrawCalls,
    savedDrawCalls: sourceDrawCalls - batchedDrawCalls,
    dynamicObjects: dynamic.size,
  };
  root.userData.assetRuntimeStaticBatch = Object.freeze(publicResult);
  return { ...publicResult, visual };
}

function ensureAssetState(state, assetNumber) {
  if (!state || typeof state !== 'object') return {};
  if (!state.shop || typeof state.shop !== 'object') state.shop = {};
  if (!state.shop.assetRuntime || typeof state.shop.assetRuntime !== 'object') {
    state.shop.assetRuntime = {};
  }
  const key = `asset_${String(assetNumber).padStart(3, '0')}`;
  if (!state.shop.assetRuntime[key] || typeof state.shop.assetRuntime[key] !== 'object') {
    state.shop.assetRuntime[key] = {};
  }
  return state.shop.assetRuntime[key];
}

function placeSocketAt(root, target, socketName = 'SOCKET_PLACEMENT') {
  const socket = root.getObjectByName(socketName);
  if (!socket) {
    root.position.copy(target);
    return false;
  }
  root.updateMatrixWorld(true);
  socket.updateWorldMatrix(true, false);
  const at = new THREE.Vector3().setFromMatrixPosition(socket.matrixWorld);
  // Targets are expressed in the mount parent's coordinate system (interior-local yards or a
  // fixture anchor). Convert the socket out of world space before calculating the correction.
  root.parent?.worldToLocal(at);
  root.position.add(target.clone().sub(at));
  root.updateMatrixWorld(true);
  return true;
}

function animationController(root, clips) {
  if (!clips?.length) return null;
  const mixer = new THREE.AnimationMixer(root);
  const byName = new Map(clips.map((clip) => [clip.name, clip]));
  const active = new Set();

  function play(names, { settle = false, loop = false } = {}) {
    let played = 0;
    for (const name of names || []) {
      const clip = byName.get(name);
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      action.stop();
      action.reset();
      action.enabled = true;
      action.clampWhenFinished = !loop;
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.play();
      if (settle) {
        action.time = Math.max(0, clip.duration);
        action.paused = true;
      }
      active.add(action);
      played += 1;
    }
    mixer.update(0);
    return played;
  }

  return {
    play,
    stop(names) {
      for (const name of names || []) {
        const clip = byName.get(name);
        if (clip) mixer.existingAction(clip)?.stop();
      }
    },
    stopAll() {
      for (const action of active) action.stop();
      mixer.stopAllAction();
      active.clear();
    },
    update(dt) { mixer.update(dt); },
    dispose() {
      for (const action of active) action.stop();
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      active.clear();
    },
  };
}

function localSocketWorld(root, name) {
  const socket = root.getObjectByName(name) || root;
  root.updateWorldMatrix(true, true);
  return socket.getWorldPosition(new THREE.Vector3());
}

function statefulLightEnabled(stateRecord, stateName) {
  return stateName === 'on' ? stateRecord?.[stateName] !== false : !!stateRecord?.[stateName];
}

function cloneStatefulEmissiveMaterials(root) {
  const clones = new Map();
  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const clone = (material) => {
      if (!material?.emissive?.getHex?.()) return material;
      let controlled = clones.get(material);
      if (!controlled) {
        controlled = material.clone();
        controlled.userData = {
          ...controlled.userData,
          runtimeEmissiveBaseIntensity: Number(material.emissiveIntensity) || 1,
        };
        clones.set(material, controlled);
      }
      return controlled;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(clone)
      : clone(object.material);
  });
  return [...clones.values()];
}

function setRuntimeLightState(light, enabled) {
  if (!light) return false;
  const on = enabled !== false;
  light.visible = on;
  for (const material of light.userData.runtimeEmissiveMaterials || []) {
    const base = Number(material.userData?.runtimeEmissiveBaseIntensity) || 1;
    material.emissiveIntensity = on ? base : 0.025;
  }
  return on;
}

function runtimeLight(root, placement, stateRecord) {
  if (!placement.light) return null;
  const spec = placement.light;
  const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance, 2);
  light.name = `AssetRuntimeLight_${placement.n}`;
  light.castShadow = false;
  light.userData.presentation = spec.presentation || 'physical';
  if (spec.presentation === 'emissive-only') {
    // These three shipped assets already carry authored emissive bulbs/lenses.
    // Retain the PointLight object as a compatibility/state handle, but keep it
    // out of Three's global fragment-light loop.
    light.layers.disableAll();
    light.userData.runtimeLightRenderSuppressed = true;
  }
  light.userData.runtimeEmissiveMaterials = placement.interaction?.state === 'on'
    ? cloneStatefulEmissiveMaterials(root)
    : [];
  const socketName = placement.n === 83 ? 'SOCKET_Bulb'
    : placement.n === 94 ? 'SOCKET_LightLeft'
      : placement.n === 95 ? 'SOCKET_Indicator' : null;
  const mount = (socketName ? root.getObjectByName(socketName) : null) || root;
  mount.add(light);
  setRuntimeLightState(
    light,
    placement.interaction?.state
      ? statefulLightEnabled(stateRecord, placement.interaction.state)
      : true,
  );
  return light;
}

function interactionLabel(placement, stateRecord) {
  const spec = placement.interaction;
  if (!spec) return null;
  if (spec.kind === 'toggle') {
    const on = statefulLightEnabled(stateRecord, spec.state);
    const verb = on ? (spec.state === 'on' ? 'switch off' : 'close')
      : (spec.state === 'on' ? 'switch on' : 'open');
    return `${spec.label} - [E] ${verb}`;
  }
  return `${spec.label} - [E] use`;
}

/**
 * Load and integrate the forty Sheet 7–10 world assets.
 *
 * `getFixtureAnchor` is deliberately a callback because build mode destroys and recreates anchors.
 * The returned detach/sync pair brackets that rebuild so GLB resources never get disposed with a
 * retired anchor and the authored fixture follows the persisted pose on the next frame.
 */
// WHO OWNS THE COLLIDER, per PROP_PLACEMENTS `collision`.
//
// The field reads like a contract and, until 2026-07-29, had no consumer:
// nothing anywhere read placement.collision. Eleven placements declared a hull
// and none of them got one. Whatever colliders those assets had came from a
// hand-written colBoxAt somewhere else, which is why coverage differed between
// the two room variants — the collision sweep found the fitting room and the
// lounge coffee table solid in neither room and the lounge armchair solid in
// only one.
//
// 'none'          nothing needed: small decor, wall fittings, tools on a bench.
// 'fixture-anchor' the fixture system already put a box here.
// 'existing-*'     the analytic layout already put a box here.
// anything else    THIS placement needs its own hull, fitted below.
//
// The default is deliberately "needs a hull": a new asset declaring
// `collision: 'display-case'` gets one automatically rather than silently
// getting nothing, which is the failure this whole field was supposed to prevent.
export function collisionIsOwnedElsewhere(collision) {
  if (!collision || collision === 'none') return true;
  return collision === 'fixture-anchor' || String(collision).startsWith('existing-');
}

export function buildProps({
  interior,
  loader,
  state = null,
  addProp = null,
  removeProp = null,
  addCol = null,
  removeCol = null,
  L2W = (x, z) => ({ x, z }),
  getFixtureAnchor = null,
  legacyReady = Promise.resolve(),
  merch = null,
  protectedRenderableResources = null,
  hooks = {},
  visibilityForAsset = null,
  fixedVisibilityForAsset = null,
} = {}) {
  const group = new THREE.Group();
  group.name = 'Assets61to100Runtime';
  interior.add(group);

  const placedByNumber = new Map();
  const failed = [];
  const mixers = [];
  const interactionProps = [];
  const lights = [];
  const superseded = [];
  const canonicalMaterials = new Map();
  const orphanedMaterials = new Set();
  let materialCanonicalizations = 0;
  let placedStaticBatch = null;
  let disposed = false;
  let disposalSummary = null;
  let lateLoaderSuccesses = 0;
  let lateLoaderErrors = 0;
  const lateLoaderResourcesDisposed = { geometries: 0, materials: 0, textures: 0 };
  const lateLoaderBorrowedResourcesRetained = { geometries: 0, materials: 0, textures: 0 };
  const borrowedRenderableResources = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
  };
  let detailedVisible = true;
  const runtimeCreatedAtMs = globalThis.performance?.now?.() ?? Date.now();
  let runtimeReadyAtMs = null;
  let staticBatchStartedAtMs = null;
  let staticBatchReadyAtMs = null;
  let staticBatchOutcome = null;
  let detailVisibilitySequence = 0;
  let lastDetailVisibilityTransition = null;

  const runtimeNowMs = () => globalThis.performance?.now?.() ?? Date.now();
  // Evaluate immutable presentation policy exactly once, before any asynchronous
  // loader can settle. This prevents later mutations in a caller-owned Set from
  // disagreeing with geometry already copied into the global static batch.
  const fixedVisibilitySnapshot = new Map(PROP_PLACEMENTS.map(({ n }) => [
    n,
    typeof fixedVisibilityForAsset !== 'function' || fixedVisibilityForAsset(n) !== false,
  ]));
  const fixedVisibilityAtConstruction = (number) => fixedVisibilitySnapshot.get(number) !== false;

  const passesVisibilityGate = (number) => {
    // Presentation callbacks are vetoes layered over the built-in facility/fixture
    // gates, not replacements: a presentation must not accidentally un-gate the
    // campaign-installed assets.
    if (!fixedVisibilityAtConstruction(number)) return false;
    if (typeof visibilityForAsset === 'function' && visibilityForAsset(number) === false) return false;
    const facilityId = FACILITY_GATED_PROP_ASSETS[number];
    if (facilityId && !facilityInstalled(state, facilityId)) return false;
    const fixtureId = FIXTURE_GATED_PROP_ASSETS[number];
    return !fixtureId || fixtureIsInstalled(state, fixtureId);
  };

  const entryUsesIndependentVisibility = (number) => (
    typeof visibilityForAsset === 'function'
    || !fixedVisibilityAtConstruction(number)
    || Object.hasOwn(FACILITY_GATED_PROP_ASSETS, number)
    || Object.hasOwn(FIXTURE_GATED_PROP_ASSETS, number)
    || propSurvivesDetailCull(number)
  );

  function anchorFor(fixtureId) {
    return typeof getFixtureAnchor === 'function' ? getFixtureAnchor(fixtureId) : null;
  }

  function uniqueRootName(number, fixtureId = null) {
    const binding = RUNTIME_ASSET_MANIFEST_BY_NUMBER[number].binding;
    return `AssetRuntime_${number}_${binding.stem}${fixtureId ? `_${fixtureId}` : ''}`;
  }

  function hideFixtureFallbacks(entry) {
    if (!entry.fixtureId || !entry.root.parent || entry.root.parent === group) return;
    for (const sibling of entry.root.parent.children) {
      if (sibling !== entry.root) sibling.visible = false;
    }
  }

  function mountFixtureEntry(entry) {
    const anchor = anchorFor(entry.fixtureId);
    if (!anchor) {
      if (entry.root.parent !== group) group.attach(entry.root);
      entry.root.visible = false;
      entry.root.position.set(0, -256, 0);
      return false;
    }
    if (entry.root.parent !== anchor) anchor.add(entry.root);
    const manifest = RUNTIME_ASSET_MANIFEST_BY_NUMBER[entry.n];
    entry.root.scale.setScalar(manifest.binding.runtimeScale);
    entry.root.rotation.set(0, entry.placement.ry || 0, 0);
    entry.root.position.set(0, 0, 0);
    placeSocketAt(entry.root, new THREE.Vector3(0, 0, 0));
    entry.root.visible = true;
    hideFixtureFallbacks(entry);
    return true;
  }

  function mountNestedEntry(entry) {
    const parentNumber = Number(entry.placement.parentAsset);
    if (!parentNumber) return false;
    const parentEntry = placedByNumber.get(parentNumber)?.[0];
    const socket = parentEntry?.root.getObjectByName(entry.placement.parentSocket);
    if (!socket) {
      failed.push({
        n: entry.n,
        reason: `parent asset ${parentNumber} socket ${entry.placement.parentSocket} unavailable`,
      });
      return false;
    }
    socket.add(entry.root);
    const manifest = RUNTIME_ASSET_MANIFEST_BY_NUMBER[entry.n];
    entry.root.scale.setScalar(manifest.binding.runtimeScale);
    entry.root.rotation.set(0, entry.placement.ry || 0, 0);
    entry.root.position.set(0, 0, 0);
    placeSocketAt(entry.root, new THREE.Vector3(0, 0, 0));
    entry.root.visible = true;
    return true;
  }

  function registerWalkProp(entry, { tool = null, socket = 'SOCKET_PLACEMENT', suffix = '' } = {}) {
    if (typeof addProp !== 'function') return null;
    const placement = entry.placement;
    const stateRecord = entry.stateRecord;
    const initial = localSocketWorld(entry.root, socket);
    const prop = {
      x: initial.x,
      z: initial.z,
      r: Number.isFinite(Number(placement.interaction?.radius))
        ? Math.max(0.25, Number(placement.interaction.radius))
        : (tool ? 2.0 : 2.25),
      aimY: initial.y,
      focusBias: Number(placement.interaction?.focusBias) || 0,
      tool,
      label: () => {
        if (!passesVisibilityGate(entry.n)) return null;
        if (tool) return `${CLEANING_TOOLS[tool]?.label || tool} - [E] equip`;
        return interactionLabel(placement, stateRecord);
      },
      focusPoint: () => localSocketWorld(entry.root, socket),
    };
    if (placement.interaction) {
      prop.action = () => {
        if (!passesVisibilityGate(entry.n)) return;
        const spec = placement.interaction;
        if (spec.kind === 'toggle') {
          const next = !statefulLightEnabled(stateRecord, spec.state);
          stateRecord[spec.state] = next;
          stateRecord.updatedAt = Date.now();
          entry.controller?.stop(spec.loop);
          entry.controller?.play(next ? spec.open : spec.close);
          if (next) entry.controller?.play(spec.loop, { loop: true });
          if (entry.light && spec.state === 'on') setRuntimeLightState(entry.light, next);
          hooks.assetStateChanged?.({
            assetNumber: entry.n,
            state: spec.state,
            value: next,
            stateRecord,
          });
          hooks.sfx?.(next ? 'open' : 'close');
        } else {
          stateRecord.uses = (Number(stateRecord.uses) || 0) + 1;
          stateRecord.updatedAt = Date.now();
          entry.controller?.play(spec.clips || []);
          hooks.sfx?.('click');
        }
      };
    }
    prop.userData = { assetNumber: entry.n, suffix };
    addProp(prop);
    interactionProps.push(prop);
    entry.walkProps.push(prop);
    return prop;
  }

  function prepareEntry(root, gltf, placement, fixtureId = null, instanceIndex = 0) {
    const manifest = RUNTIME_ASSET_MANIFEST_BY_NUMBER[placement.n];
    root.name = uniqueRootName(placement.n, fixtureId);
    root.userData.assetRuntime = Object.freeze({
      assetNumber: placement.n,
      saveStateKey: manifest.saveStateKey,
      performanceTier: manifest.performanceTier,
      placementCategory: manifest.placementCategory,
      instanceIndex,
      fixtureId,
    });
    materialCanonicalizations += canonicalizeRuntimeMaterials(
      root,
      canonicalMaterials,
      orphanedMaterials,
    );
    let hiddenCollisionMeshes = 0;
    root.traverse((object) => {
      if (!object.isMesh) return;
      // The exports retain simplified COL_ meshes as auditable authoring evidence. Navigation is
      // owned by clubhouse analytic colliders, so rendering these proxies would double silhouettes
      // and make several tools look like black blocks.
      if (isAuthoredCollisionProxy(object, root)) {
        object.visible = false;
        object.userData.runtimeCollisionProxyExcluded = true;
        hiddenCollisionMeshes += 1;
      }
      object.castShadow = false;
      object.receiveShadow = false;
    });
    const needsLiveVisualHierarchy = runtimeAssetNeedsLiveVisualHierarchy(placement);
    const staticBatch = needsLiveVisualHierarchy
      ? {
        skipped: 'live-runtime-visual-hierarchy',
        reasons: Object.freeze([
          placement.interaction ? 'interaction' : null,
          placement.tool ? 'tool' : null,
          Array.isArray(placement.tools) && placement.tools.length ? 'tools' : null,
          placement.light ? 'runtime-practical-light' : null,
          placement.mutableVisual ? 'mutable-visual' : null,
          placement.runtimeVisualState ? 'runtime-visual-state' : null,
        ].filter(Boolean)),
      }
      : batchStaticRenderMeshes(
        root,
        gltf.animations || [],
        merch,
        placement.n,
      );

    const stateRecord = ensureAssetState(state, placement.n);
    const entry = {
      n: placement.n,
      root,
      placement,
      fixtureId,
      stateRecord,
      walkProps: [],
      controller: animationController(root, gltf.animations || []),
      clips: [...(gltf.animations || [])],
      light: null,
      hiddenCollisionMeshes,
      staticBatch,
      needsLiveVisualHierarchy,
      visibilityGated: entryUsesIndependentVisibility(placement.n),
    };
    if (entry.controller) mixers.push(entry.controller);
    entry.light = runtimeLight(root, placement, stateRecord);
    if (entry.light) lights.push(entry.light);

    if (fixtureId) {
      mountFixtureEntry(entry);
    } else {
      group.add(root);
      root.scale.setScalar(manifest.binding.runtimeScale);
      root.rotation.set(0, placement.ry || 0, 0);
      root.position.set(0, 0, 0);
      const socketAligned = placeSocketAt(root, vectorFromTransform(manifest));
      if (!socketAligned) failed.push({ n: placement.n, reason: 'no SOCKET_PLACEMENT; positioned by origin' });
    }
    root.visible = passesVisibilityGate(placement.n)
      && (detailedVisible || propSurvivesDetailCull(placement.n));

    const spec = placement.interaction;
    if (spec?.kind === 'toggle' && stateRecord[spec.state]) {
      entry.controller?.play(spec.open, { settle: true });
      entry.controller?.play(spec.loop, { loop: true });
    }
    if (entry.light && spec?.state === 'on') entry.light.visible = stateRecord.on !== false;

    if (placement.tools) {
      for (const toolSpec of placement.tools) {
        registerWalkProp(entry, { ...toolSpec, suffix: toolSpec.tool });
      }
    } else if (placement.tool || placement.interaction) {
      const focusSocket = placement.interaction?.socket || (placement.tool
        ? (manifest.interactionSockets.find((name) => /Grip|Carry/i.test(name)) || 'SOCKET_PLACEMENT')
        : (manifest.interactionSockets.find((name) => /Handle|Trigger|Switch|Grip/i.test(name)) || 'SOCKET_PLACEMENT'));
      registerWalkProp(entry, { tool: placement.tool || null, socket: focusSocket });
    }

    // The declared hull, fitted to what actually loaded rather than to a number
    // typed next to the placement — an authored box drifts the moment the mesh
    // is re-exported, and this class of defect is expensive enough already.
    entry.collider = null;
    if (typeof addCol === 'function' && !collisionIsOwnedElsewhere(placement.collision)) {
      root.updateMatrixWorld(true);
      const hull = new THREE.Box3().setFromObject(root, true);
      if (!hull.isEmpty() && Number.isFinite(hull.min.x)) {
        // Inset slightly: a body should be able to brush past a chair arm
        // without the collider claiming the air around it.
        const inset = 0.06;
        const collider = {
          minX: hull.min.x + inset,
          maxX: hull.max.x - inset,
          minZ: hull.min.z + inset,
          maxZ: hull.max.z - inset,
          assetNumber: placement.n,
          collisionKind: placement.collision,
        };
        if (collider.maxX > collider.minX && collider.maxZ > collider.minZ) {
          addCol(collider);
          entry.collider = collider;
        }
      }
    }

    const entries = placedByNumber.get(placement.n) || [];
    entries.push(entry);
    placedByNumber.set(placement.n, entries);
    // Asset 61 can arrive long before the rest of the 40-prop sheet. Retire
    // its counter stand-ins immediately to prevent an extended z-fighting
    // window while unrelated GLBs finish loading. The all-ready sweep remains
    // as protection against a fallback that mounts late.
    retireNamedFallbacksFor(placement.n);
    return entry;
  }

  const jobs = PROP_PLACEMENTS.map((placement) => new Promise((resolve) => {
    const manifest = RUNTIME_ASSET_MANIFEST_BY_NUMBER[placement.n];
    loader.load(manifest.glbPath, (gltf) => {
      // CachedGLTFLoader clones the Object3D hierarchy but deliberately shares
      // the parsed prototype's geometry, material, and texture identities.
      // Capture those borrowed identities before prepareEntry canonicalises
      // materials or creates state-controlled emissive clones. They remain
      // owned by the loader cache across in-page clubhouse rebuilds.
      const loadedBorrowedResources = collectRenderableResources(gltf?.scene);
      for (const key of Object.keys(borrowedRenderableResources)) {
        for (const resource of loadedBorrowedResources[key]) {
          borrowedRenderableResources[key].add(resource);
        }
      }
      // A first-door readiness timeout forces a reload-only recovery. A loader
      // that completes after scene disposal must not resurrect roots, props, or
      // colliders into the dead scene while that recovery panel is visible. Its
      // render resources are still cache-owned, so dropping this unattached
      // hierarchy must not dispose them.
      if (disposed) {
        lateLoaderSuccesses += 1;
        for (const key of Object.keys(lateLoaderBorrowedResourcesRetained)) {
          lateLoaderBorrowedResourcesRetained[key] += loadedBorrowedResources[key].size;
        }
        resolve(false);
        return;
      }
      try {
        const fixtureIds = placement.fixtureIds?.length ? placement.fixtureIds : [null];
        // Clone every instance before prepareEntry mutates the first root with its static batch.
        // Otherwise a second persisted shelf would clone an already-suppressed render hierarchy.
        const roots = fixtureIds.map((_, index) => (index === 0 ? gltf.scene : gltf.scene.clone(true)));
        fixtureIds.forEach((fixtureId, index) => {
          const root = roots[index];
          prepareEntry(root, gltf, placement, fixtureId, index);
        });

        resolve(true);
      } catch (error) {
        failed.push({ n: placement.n, reason: error.message });
        resolve(false);
      }
    }, undefined, (error) => {
      if (disposed) {
        lateLoaderErrors += 1;
        resolve(false);
        return;
      }
      failed.push({ n: placement.n, reason: error?.message || 'load failed' });
      resolve(false);
    });
  }));

  function retireNamedFallbacksFor(assetNumber = null) {
    const placedNumbers = new Set(placedByNumber.keys());
    for (const rule of SUPERSEDES) {
      if (assetNumber != null && !rule.replacedBy.includes(assetNumber)) continue;
      if (!rule.replacedBy.every((number) => placedNumbers.has(number))) continue;
      let legacy = interior.getObjectByName(rule.legacy);
      while (legacy) {
        legacy.removeFromParent();
        superseded.push(rule.legacy);
        legacy = interior.getObjectByName(rule.legacy);
      }
    }
  }

  function retireNamedFallbacks() {
    retireNamedFallbacksFor(null);
  }

  function populateTrophyCabinet() {
    if (!merch) return 0;
    const entry = placedByNumber.get(70)?.[0];
    if (!entry) return 0;
    let populated = 0;
    for (const [index, socketName] of ['SOCKET_Trophy_01', 'SOCKET_Trophy_02', 'SOCKET_Collectible_01'].entries()) {
      const socket = entry.root.getObjectByName(socketName);
      const trophy = merch.instantiate?.('trophy');
      if (!socket || !trophy) continue;
      trophy.name = `Asset70SocketTrophy_${index + 1}`;
      trophy.scale.setScalar(index === 2 ? 0.68 : 0.78 + index * 0.08);
      trophy.position.set(0, 0, 0);
      socket.add(trophy);
      populated += 1;
    }
    entry.root.userData.populatedTrophySockets = populated;
    return populated;
  }

  const ready = Promise.all(jobs).then(async () => {
    // Merchandise disposal intentionally drops its pending onReady callbacks.
    // Once this runtime is disposed there is no legacy work left to join, and
    // waiting here would leave the production readiness promise unresolved.
    if (disposed) return { placed: 0, instances: 0, superseded: [] };
    await legacyReady.catch?.(() => {});
    if (disposed) return { placed: 0, instances: 0, superseded: [] };
    for (const entries of placedByNumber.values()) {
      for (const entry of entries) if (entry.placement.parentAsset) mountNestedEntry(entry);
    }
    retireNamedFallbacks();
    for (const entries of placedByNumber.values()) {
      for (const entry of entries) hideFixtureFallbacks(entry);
    }
    staticBatchStartedAtMs = runtimeNowMs();
    placedStaticBatch = batchPlacedStaticVisuals(
      group,
      [...placedByNumber.values()].flat().filter((entry) => (
        runtimeAssetEligibleForPlacedStaticBatch(entry.placement, {
          visibilityForAsset,
          fixedVisibilityForAsset: fixedVisibilityAtConstruction,
          hasStaticVisual: !!entry.staticBatch?.visual,
        })
      )),
      merch,
    );
    staticBatchReadyAtMs = runtimeNowMs();
    staticBatchOutcome = Object.freeze({
      sourceDrawCalls: placedStaticBatch?.sourceDrawCalls || 0,
      batchedDrawCalls: placedStaticBatch?.batchedDrawCalls || 0,
      savedDrawCalls: placedStaticBatch?.savedDrawCalls || 0,
    });
    if (placedStaticBatch?.visual) placedStaticBatch.visual.visible = detailedVisible;
    const trophySockets = populateTrophyCabinet();
    const outcome = {
      placed: placedByNumber.size,
      instances: [...placedByNumber.values()].reduce((sum, entries) => sum + entries.length, 0),
      superseded: [...superseded],
      trophySockets,
    };
    runtimeReadyAtMs = runtimeNowMs();
    return outcome;
  });

  function updateInteractionOrigins() {
    for (const entries of placedByNumber.values()) {
      for (const entry of entries) {
        for (const prop of entry.walkProps) {
          const point = prop.focusPoint?.();
          if (!point) continue;
          prop.x = point.x;
          prop.z = point.z;
          prop.aimY = point.y;
        }
      }
    }
  }

  function refreshVisibility() {
    let visible = 0;
    let total = 0;
    for (const [number, entries] of placedByNumber) {
      for (const entry of entries) {
        entry.root.visible = passesVisibilityGate(number)
          && (detailedVisible || propSurvivesDetailCull(number));
        if (entry.root.visible) visible += 1;
        total += 1;
      }
    }
    // Every mesh admitted to the global batch belongs to the deep-interior,
    // always-installed cohort. State-gated and entrance-visible entries remain
    // in their own roots, so one visibility flag cannot leak Asset 61 or hide
    // the welcome mat.
    if (placedStaticBatch?.visual) placedStaticBatch.visual.visible = detailedVisible;
    return { detailedVisible, visible, total };
  }

  return {
    group,
    ready,
    update(dt) {
      for (const controller of mixers) controller.update(dt);
      updateInteractionOrigins();
    },
    detachFixturePlacements() {
      for (const entries of placedByNumber.values()) {
        for (const entry of entries) {
          if (!entry.fixtureId || entry.root.parent === group) continue;
          group.attach(entry.root);
          entry.root.visible = false;
        }
      }
    },
    syncFixturePlacements() {
      let mounted = 0;
      for (const entries of placedByNumber.values()) {
        for (const entry of entries) if (entry.fixtureId && mountFixtureEntry(entry)) mounted += 1;
      }
      updateInteractionOrigins();
      return mounted;
    },
    roots: () => [...placedByNumber.values()].flat().map((entry) => entry.root),
    setCameraVisibility(cameraLocalX, cameraLocalZ) {
      const nextDetailedVisible = detailedPropsVisibleAt(cameraLocalX, cameraLocalZ);
      if (nextDetailedVisible !== detailedVisible) {
        const dx = Math.max(Math.abs(cameraLocalX) - INTERIOR.w / 2, 0);
        const dz = Math.max(Math.abs(cameraLocalZ) - INTERIOR.d / 2, 0);
        detailVisibilitySequence += 1;
        lastDetailVisibilityTransition = Object.freeze({
          atMs: runtimeNowMs(),
          sequence: detailVisibilitySequence,
          from: detailedVisible,
          to: nextDetailedVisible,
          cameraLocalX,
          cameraLocalZ,
          exteriorDistanceYards: Math.hypot(dx, dz),
          detailClearanceYards: PROP_DETAIL_EXTERIOR_CLEARANCE_YD,
        });
      }
      detailedVisible = nextDetailedVisible;
      return refreshVisibility();
    },
    refreshVisibility,
    interactionTargets: () => {
      updateInteractionOrigins();
      return interactionProps.map((prop) => ({
        assetNumber: prop.userData?.assetNumber || null,
        suffix: prop.userData?.suffix || '',
        x: prop.x,
        z: prop.z,
        aimY: prop.aimY,
        radius: prop.r,
        focusBias: prop.focusBias || 0,
        tool: prop.tool || null,
        label: typeof prop.label === 'function' ? prop.label() : prop.label,
      }));
    },
    getRoot: (number, fixtureId = null) => {
      const entries = placedByNumber.get(Number(number)) || [];
      return (fixtureId ? entries.find((entry) => entry.fixtureId === fixtureId) : entries[0])?.root || null;
    },
    rootFor(number) {
      const entries = placedByNumber.get(Number(number)) || [];
      return entries[0]?.root || null;
    },
    play(number, clipNeedles, { loop = false } = {}) {
      const entry = (placedByNumber.get(Number(number)) || [])[0];
      if (!entry?.controller) return false;
      const needles = (Array.isArray(clipNeedles) ? clipNeedles : [clipNeedles])
        .map((value) => String(value || '').toLowerCase());
      const clip = entry.clips.find((candidate) => needles.some((needle) => (
        String(candidate.name || '').toLowerCase().includes(needle)
      )));
      return !!(clip && entry.controller.play([clip.name], { loop }));
    },
    setBucketWater({ water = 'clean', level = 1 } = {}) {
      const root = (placedByNumber.get(73) || [])[0]?.root;
      const waterMesh = root?.getObjectByName('BucketWater')
        || root?.getObjectByName('MESH_BucketWater');
      if (!waterMesh) return false;
      waterMesh.visible = water !== 'empty' && level > 0.02;
      const materials = Array.isArray(waterMesh.material) ? waterMesh.material : [waterMesh.material];
      for (const material of materials) {
        if (!material?.color) continue;
        material.color.set(water === 'dirty' ? 0x736345 : 0x76aeb1);
        if ('opacity' in material) material.opacity = water === 'dirty' ? 0.78 : 0.68;
      }
      return true;
    },
    stopAnimations() {
      for (const controller of mixers) controller.stopAll();
      return mixers.length;
    },
    diagnostics: () => ({
      expected: PROP_PLACEMENTS.length,
      placed: placedByNumber.size,
      instances: [...placedByNumber.values()].reduce((sum, entries) => sum + entries.length, 0),
      failed: failed.length,
      failures: [...failed],
      assetNumbers: [...placedByNumber.keys()].sort((a, b) => a - b),
      superseded: [...superseded],
      interactions: interactionProps.length,
      animated: mixers.length,
      emittedLights: lights.length,
      physicalRuntimeLights: lights.filter((light) => light.layers.mask !== 0).length,
      emissiveOnlyRuntimeLights: lights.filter((light) => (
        light.userData.runtimeLightRenderSuppressed === true
      )).length,
      hiddenCollisionMeshes: [...placedByNumber.values()].flat()
        .reduce((sum, entry) => sum + entry.hiddenCollisionMeshes, 0),
      staticBatchSourceDrawCalls: [...placedByNumber.values()].flat()
        .reduce((sum, entry) => sum + (entry.staticBatch?.sourceDrawCalls || 0), 0),
      staticBatchDrawCalls: [...placedByNumber.values()].flat()
        .reduce((sum, entry) => sum + (entry.staticBatch?.batchedDrawCalls || 0), 0),
      staticBatchSavedDrawCalls: [...placedByNumber.values()].flat()
        .reduce((sum, entry) => sum + (entry.staticBatch?.savedDrawCalls || 0), 0),
      staticBatchCount: [...placedByNumber.values()].flat()
        .filter((entry) => (entry.staticBatch?.savedDrawCalls || 0) > 0).length,
      canonicalRuntimeMaterials: canonicalMaterials.size,
      materialCanonicalizations,
      placedStaticBatchSourceDrawCalls: placedStaticBatch?.sourceDrawCalls || 0,
      placedStaticBatchDrawCalls: placedStaticBatch?.batchedDrawCalls || 0,
      placedStaticBatchSavedDrawCalls: placedStaticBatch?.savedDrawCalls || 0,
      placedStaticBatchAssetNumbers: placedStaticBatch?.visual
        ? [...placedByNumber.values()].flat()
          .filter((entry) => !entry.fixtureId
            && !entry.visibilityGated
            && !entry.needsLiveVisualHierarchy
            && entry.staticBatch?.visual)
          .map((entry) => entry.n)
          .sort((a, b) => a - b)
        : [],
      detailedVisible,
      runtimeCreatedAtMs,
      runtimeReadyAtMs,
      staticBatchStartedAtMs,
      staticBatchReadyAtMs,
      staticBatchOutcome: staticBatchOutcome ? { ...staticBatchOutcome } : null,
      detailVisibilitySequence,
      lastDetailVisibilityTransition: lastDetailVisibilityTransition
        ? { ...lastDetailVisibilityTransition }
        : null,
      visible: [...placedByNumber.values()].flat().filter((entry) => entry.root.visible).length,
      disposed,
      lateLoaderSuccesses,
      lateLoaderErrors,
      lateLoaderResourcesDisposed: { ...lateLoaderResourcesDisposed },
      lateLoaderBorrowedResourcesRetained: { ...lateLoaderBorrowedResourcesRetained },
      borrowedRenderableResources: {
        geometries: borrowedRenderableResources.geometries.size,
        materials: borrowedRenderableResources.materials.size,
        textures: borrowedRenderableResources.textures.size,
      },
    }),
    dispose() {
      if (disposed) return disposalSummary;
      disposed = true;
      for (const prop of interactionProps) removeProp?.(prop);
      // Colliders outlive the geometry unless they are taken out here, and an
      // invisible box the player bumps into is the orphan half of this defect.
      for (const entry of [...placedByNumber.values()].flat()) {
        if (entry.collider) removeCol?.(entry.collider);
      }
      for (const controller of mixers) controller.dispose();
      const roots = [...placedByNumber.values()].flat().map((entry) => entry.root);
      const resourceRoots = placedStaticBatch?.visual ? [...roots, placedStaticBatch.visual] : roots;
      const resources = mergeRenderableResources(
        collectRenderableResources(resourceRoots),
        collectMaterialResources([...orphanedMaterials]),
      );
      // Cached GLTF clones borrow their render resources from the loader cache,
      // while per-asset bake() resources remain under the merchandise cache's
      // single-release boundary. Runtime-minted resources, including emissive
      // material clones and the global placed-static batch, are released here.
      const protectedResources = mergeRenderableResources(
        typeof protectedRenderableResources === 'function'
          ? protectedRenderableResources()
          : protectedRenderableResources,
        merch?.ownedResources?.() || null,
        borrowedRenderableResources,
      );
      const released = disposeRenderableResources(resources, protectedResources);
      for (const root of roots) root.removeFromParent();
      group.removeFromParent();
      placedByNumber.clear();
      canonicalMaterials.clear();
      orphanedMaterials.clear();
      disposalSummary = Object.freeze({
        ...released,
        protectedGeometries: protectedResources?.geometries?.size || 0,
        protectedMaterials: protectedResources?.materials?.size || 0,
        protectedTextures: protectedResources?.textures?.size || 0,
      });
      return disposalSummary;
    },
  };
}

// CARRIED-BOX PLACEMENT MODE
//
// This is deliberately renderer-only. Surface ownership, ray construction,
// placement rules, and the authoritative save mutation are injected so the
// same preview can serve floors, fixture tops, shelves, pallets, and carts.
// The nearest physical hit is selected before validation: an illegal shelf
// cannot be looked through to place the carton on a legal floor behind it.

import * as THREE from 'three';

export const BOX_PLACEMENT_GHOST_OK = 0x22c55e;
export const BOX_PLACEMENT_GHOST_BAD = 0xef4444;
export const BOX_PLACEMENT_CUE_OK = 0xf0c75e;
export const BOX_PLACEMENT_CUE_BAD = 0xffd1d1;

const QUARTER_TURN = Math.PI / 2;
const FULL_TURN = Math.PI * 2;
const FOOTPRINT_LIFT = 0.006;

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizedDimensions(value) {
  const dimensions = value || {};
  const w = finitePositive(dimensions.w ?? dimensions.width ?? dimensions.x);
  const h = finitePositive(dimensions.h ?? dimensions.height ?? dimensions.y);
  const d = finitePositive(dimensions.d ?? dimensions.depth ?? dimensions.z);
  if (w === null || h === null || d === null) {
    throw new TypeError('Box placement requires finite positive w, h, and d dimensions.');
  }
  return Object.freeze({ w, h, d });
}

function normalizeRotation(value) {
  const rotation = Number.isFinite(Number(value)) ? Number(value) : 0;
  return ((rotation % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

function surfaceIdOf(surface) {
  return surface?.surfaceId ?? surface?.id ?? surface?.name ?? null;
}

function hitDistance(hit) {
  const distance = Number(hit?.distance);
  return Number.isFinite(distance) && distance >= 0 ? distance : null;
}

function reasonOf(preview, fallback = null) {
  if (typeof preview?.reason === 'string' && preview.reason) return preview.reason;
  if (Array.isArray(preview?.reasons) && preview.reasons.length) return String(preview.reasons[0]);
  return fallback;
}

function finiteCoordinate(value, fallback = null) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : fallback;
}

// Preview callbacks return an opaque `target` for the simulation commit and may
// return a distinct parent-local `pose` for rendering. When pose is omitted, a
// conventional {x,y,z,ry} target is enough. Illegal results may omit both; the
// exact closest ray hit remains visible as a red fallback.
function previewPose(preview, hit, rotationY) {
  const target = preview?.target || null;
  const pose = preview?.pose || target?.pose || target || null;
  const point = hit?.point || null;
  const x = finiteCoordinate(pose?.x ?? pose?.position?.x, finiteCoordinate(point?.x));
  const y = finiteCoordinate(pose?.y ?? pose?.position?.y, finiteCoordinate(point?.y, 0));
  const z = finiteCoordinate(pose?.z ?? pose?.position?.z, finiteCoordinate(point?.z));
  if (x === null || y === null || z === null) return null;
  const ry = normalizeRotation(pose?.ry ?? pose?.rotationY ?? rotationY);
  return { x, y, z, ry };
}

function callbackRequired(name, callback) {
  if (typeof callback !== 'function') throw new TypeError(`${name} must be a function.`);
  return callback;
}

/**
 * Create one reusable carried-box preview.
 *
 * Callback contracts:
 * - enumerateSurfaces(context) -> iterable of placement surfaces
 * - raycastSurface(surface, rayInput, context) -> hit, hit[], or null
 * - previewPlacement(context) -> { ok, target, pose?, reason?/reasons? }
 * - commitPlacement(exactTarget, context) -> false/{ok:false} to reject,
 *   otherwise success
 *
 * Geometry and materials are allocated exactly once here. begin(), update(),
 * rotate(), and commit() only mutate the existing object graph.
 */
export function createBoxPlacementMode({
  parent,
  enumerateSurfaces,
  raycastSurface,
  previewPlacement,
  commitPlacement,
} = {}) {
  if (!parent?.isObject3D || typeof parent.add !== 'function') {
    throw new TypeError('Box placement requires a THREE.Object3D parent.');
  }
  callbackRequired('enumerateSurfaces', enumerateSurfaces);
  callbackRequired('raycastSurface', raycastSurface);
  callbackRequired('previewPlacement', previewPlacement);
  callbackRequired('commitPlacement', commitPlacement);

  // Unit geometry plus an exact per-box scale lets one preallocated envelope
  // serve every carton kind without rebuilding BufferGeometry on carry changes.
  const envelopeGeometry = new THREE.BoxGeometry(1, 1, 1);
  envelopeGeometry.name = 'BoxPlacementEnvelopeGeometry';
  const footprintGeometry = new THREE.BufferGeometry();
  footprintGeometry.name = 'BoxPlacementFootprintGeometry';
  // Four exact footprint edges plus a forward arrow in the same reusable
  // geometry. The arrow makes quarter-turns readable even for almost-square
  // cartons without allocating another marker object or material.
  footprintGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, -0.5,  0.5, 0, -0.5,
     0.5, 0, -0.5,  0.5, 0,  0.5,
     0.5, 0,  0.5, -0.5, 0,  0.5,
    -0.5, 0,  0.5, -0.5, 0, -0.5,
        0, 0, -0.16,     0, 0,  0.30,
        0, 0,  0.30, -0.12, 0, 0.16,
        0, 0,  0.30,  0.12, 0, 0.16,
  ], 3));
  // A separate, reusable brass facing cue keeps an otherwise featureless
  // translucent cuboid readable on green carpet, cream walls, and dark carts.
  // The top seam and front-face handling arrow rotate with the package, so a
  // quarter turn remains obvious even when its floor footprint is occluded.
  const facingCueGeometry = new THREE.BufferGeometry();
  facingCueGeometry.name = 'BoxPlacementFacingCueGeometry';
  facingCueGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
       0, 1, -0.5,     0, 1,  0.5,
       0, 0.20, 0.505, 0, 0.80, 0.505,
       0, 0.80, 0.505, -0.12, 0.62, 0.505,
       0, 0.80, 0.505,  0.12, 0.62, 0.505,
  ], 3));

  const envelopeMaterial = new THREE.MeshBasicMaterial({
    color: BOX_PLACEMENT_GHOST_OK,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    // A closed transparent volume rendered double-sided layers its rear faces
    // over shelving/counter detail and reads as z-fighting. Front faces retain
    // the exact envelope while producing one stable colour layer.
    side: THREE.FrontSide,
  });
  envelopeMaterial.name = 'BoxPlacementEnvelopeMaterial';
  const footprintMaterial = new THREE.LineBasicMaterial({
    color: BOX_PLACEMENT_GHOST_OK,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: false,
  });
  footprintMaterial.name = 'BoxPlacementFootprintMaterial';
  const facingCueMaterial = new THREE.LineBasicMaterial({
    color: BOX_PLACEMENT_CUE_OK,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  facingCueMaterial.name = 'BoxPlacementFacingCueMaterial';

  const root = new THREE.Group();
  root.name = 'BoxPlacementGhost';
  root.visible = false;
  root.renderOrder = 997;
  const envelope = new THREE.Mesh(envelopeGeometry, envelopeMaterial);
  envelope.name = 'BoxPlacementEnvelope';
  envelope.renderOrder = 997;
  const footprint = new THREE.LineSegments(footprintGeometry, footprintMaterial);
  footprint.name = 'BoxPlacementFootprint';
  footprint.position.y = FOOTPRINT_LIFT;
  footprint.renderOrder = 998;
  const facingCue = new THREE.LineSegments(facingCueGeometry, facingCueMaterial);
  facingCue.name = 'BoxPlacementFacingCue';
  facingCue.position.y = FOOTPRINT_LIFT;
  facingCue.renderOrder = 999;
  root.add(envelope, footprint, facingCue);
  parent.add(root);

  let disposed = false;
  let active = false;
  let carriedBox = null;
  let dimensions = null;
  let baseRotationY = 0;
  let quarterTurns = 0;
  let rotationY = 0;
  let closest = null;
  let current = null;
  let lastRayInput = null;
  let disposalSummary = null;
  const metrics = {
    begins: 0,
    updates: 0,
    rotations: 0,
    surfaceRaycasts: 0,
    previews: 0,
    commitAttempts: 0,
    commits: 0,
    rejectedCommits: 0,
  };

  function context(extra = null) {
    return {
      box: carriedBox,
      dimensions,
      rotationY,
      quarterTurns,
      ...(extra || {}),
    };
  }

  function setGhostColour(ok) {
    const colour = ok ? BOX_PLACEMENT_GHOST_OK : BOX_PLACEMENT_GHOST_BAD;
    envelopeMaterial.color.setHex(colour);
    footprintMaterial.color.setHex(colour);
    facingCueMaterial.color.setHex(ok ? BOX_PLACEMENT_CUE_OK : BOX_PLACEMENT_CUE_BAD);
  }

  function hidePreview() {
    closest = null;
    current = null;
    root.visible = false;
  }

  function applyPreview(candidate) {
    closest = candidate;
    metrics.previews += 1;
    const preview = previewPlacement(context({
      surface: candidate.surface,
      surfaceId: surfaceIdOf(candidate.surface),
      hit: candidate.hit,
      rayInput: lastRayInput,
    })) || {};
    const pose = previewPose(preview, candidate.hit, rotationY);
    // A legal preview is commit-ready only when it supplies its exact opaque
    // target. A malformed success can never leak through to the save mutation.
    const legal = preview.ok === true && preview.target != null && pose != null;
    current = {
      legal,
      target: preview.target ?? null,
      pose,
      reason: reasonOf(preview, legal ? null : 'That surface cannot accept this carton.'),
      preview,
    };
    if (!pose) {
      root.visible = false;
      return current;
    }
    root.position.set(pose.x, pose.y, pose.z);
    root.rotation.set(0, pose.ry, 0);
    root.visible = true;
    setGhostColour(legal);
    return current;
  }

  function considerHit(candidate, surface, hit) {
    const distance = hitDistance(hit);
    if (distance === null) return candidate;
    if (!candidate || distance < candidate.distance) return { surface, hit, distance };
    return candidate;
  }

  function closestSurfaceHit(rayInput) {
    let candidate = null;
    const surfaces = enumerateSurfaces(context({ rayInput }));
    if (!surfaces || typeof surfaces[Symbol.iterator] !== 'function') return null;
    for (const surface of surfaces) {
      metrics.surfaceRaycasts += 1;
      const result = raycastSurface(surface, rayInput, context({ surface }));
      if (Array.isArray(result)) {
        for (const hit of result) candidate = considerHit(candidate, surface, hit);
      } else {
        candidate = considerHit(candidate, surface, result);
      }
    }
    return candidate;
  }

  function begin({ box, dimensions: nextDimensions, rotationY: initialRotationY = 0 } = {}) {
    if (disposed) return false;
    dimensions = normalizedDimensions(nextDimensions);
    carriedBox = box ?? null;
    baseRotationY = normalizeRotation(initialRotationY);
    quarterTurns = 0;
    rotationY = baseRotationY;
    envelope.scale.set(dimensions.w, dimensions.h, dimensions.d);
    envelope.position.set(0, dimensions.h / 2, 0);
    footprint.scale.set(dimensions.w, 1, dimensions.d);
    facingCue.scale.set(dimensions.w, dimensions.h, dimensions.d);
    active = true;
    lastRayInput = null;
    hidePreview();
    metrics.begins += 1;
    return true;
  }

  function update(rayInput = null) {
    if (disposed || !active) return false;
    metrics.updates += 1;
    lastRayInput = rayInput;
    const candidate = closestSurfaceHit(rayInput);
    if (!candidate) {
      hidePreview();
      return false;
    }
    applyPreview(candidate);
    return true;
  }

  function rotate() {
    if (disposed || !active) return false;
    quarterTurns = (quarterTurns + 1) % 4;
    rotationY = normalizeRotation(baseRotationY + quarterTurns * QUARTER_TURN);
    metrics.rotations += 1;
    // Revalidate the retained closest hit immediately. Commit can never use a
    // legal target calculated for the previous orientation.
    if (closest) applyPreview(closest);
    else root.rotation.y = rotationY;
    return true;
  }

  function commit() {
    if (disposed || !active || !current?.legal || current.target == null) {
      metrics.rejectedCommits += 1;
      return false;
    }
    metrics.commitAttempts += 1;
    const exactTarget = current.target;
    const result = commitPlacement(exactTarget, context({
      surface: closest?.surface || null,
      surfaceId: surfaceIdOf(closest?.surface),
      hit: closest?.hit || null,
      preview: current.preview,
    }));
    const accepted = result !== false && result?.ok !== false;
    if (!accepted) {
      metrics.rejectedCommits += 1;
      current.legal = false;
      current.reason = reasonOf(result, 'Placement changed before the carton could be set down.');
      setGhostColour(false);
      return result;
    }
    metrics.commits += 1;
    active = false;
    root.visible = false;
    carriedBox = null;
    closest = null;
    current = null;
    return result === undefined ? true : result;
  }

  function cancel() {
    if (disposed || !active) return false;
    active = false;
    carriedBox = null;
    lastRayInput = null;
    hidePreview();
    return true;
  }

  function diagnostics() {
    return {
      disposed,
      active,
      visible: root.visible,
      legal: current?.legal === true,
      reason: current?.reason || null,
      surfaceId: surfaceIdOf(closest?.surface),
      hitDistance: closest?.distance ?? null,
      rotationY,
      quarterTurns,
      dimensions: dimensions ? { ...dimensions } : null,
      target: current?.target ?? null,
      colour: envelopeMaterial.color.getHex(),
      allocations: { geometries: 3, materials: 3 },
      metrics: { ...metrics },
    };
  }

  function dispose() {
    if (disposed) return { ...disposalSummary, alreadyDisposed: true };
    disposed = true;
    active = false;
    carriedBox = null;
    lastRayInput = null;
    hidePreview();
    root.removeFromParent();
    envelopeGeometry.dispose();
    footprintGeometry.dispose();
    facingCueGeometry.dispose();
    envelopeMaterial.dispose();
    footprintMaterial.dispose();
    facingCueMaterial.dispose();
    disposalSummary = Object.freeze({ geometries: 3, materials: 3 });
    return { ...disposalSummary, alreadyDisposed: false };
  }

  return Object.freeze({
    root,
    begin,
    update,
    rotate,
    commit,
    cancel,
    isActive: () => active,
    diagnostics,
    dispose,
  });
}

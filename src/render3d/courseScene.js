// FAIRWAY STATE — the realistic 3D course view.
// A Three.js scene driven entirely by the serialized GameState: smoothed heightmap
// terrain with a splat shader (mow stripes, health browning, disease mottle, data
// views, plan ghost), carved ponds with water surfaces, instanced trees, sun/sky
// with time-of-day and weather, and 3D hole furniture (flags, tee markers, badges).
// World units are YARDS; 1 cell = 8x8 yd. The sim never knows this file exists.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ZONE, HOLE_STATUS, CELL_YD, ZONE_TEX_SCALE } from '../sim/constants.js';
import { holeNumber } from '../sim/course.js';
import { BALANCE } from '../sim/balance.js';
import { clamp } from '../core/utils.js';
import { resolveOverlaps, createStuckMonitor, createSafeTrail, nearestFree } from '../core/unstick.js';
import { ownedWasher } from '../sim/washing.js';
import { makeFpHands, GRIPS } from './fpHands.js';
import { tractorStep, repairTractor, tractorRemaining, STEP_LABEL } from '../sim/tractor.js';
import { clearLitter, fixTeeSign, PROPS } from '../sim/props.js';
import { conditionRating } from '../sim/turf.js';
import { makeCameraRig } from './cameraRig.js';
import { makeCharacter } from './characterAsset.js';
import { clubhouseInteriorGtaoExcludedAt, makeClubhouse } from './clubhouse.js';
import { makeGrassTexture, makeSandTexture, makeScrubTexture, makePathTexture, makeAsphaltTexture } from './proceduralTextures.js';
import { applyMouseLook, setFirstPersonOrientation } from './mouseLook.js';
import {
  makeVisualField,
  makeSurfaceDistanceField,
  computeVisualField,
  computeSurfaceDistanceField,
  updateVisualFieldRegion,
  updateSurfaceDistanceFieldRegion,
  fieldZoneAt,
  FIELD_SCALE,
  SURFACE_DISTANCE_UNITS_PER_YD,
  SURFACE_DISTANCE_ZERO,
  SURFACE_COVERAGE_MIN_AA_YD,
  SURFACE_FIRST_CUT_YD,
  SURFACE_GREEN_FRINGE_YD,
} from './visualField.js';
import { buildRelief, reliefAt, getGeom, mowAngleAt } from '../sim/courseVec.js';
import {
  COURSE_CAMERA_MODES,
  courseCameraFlyoverPose,
  courseCameraPose,
} from '../sim/courseCamera.js';
import { ZONE_COLORS } from '../render/palette.js';
import {
  collectSceneResources, disposeSceneResources, mergeSceneResources,
} from './disposeSceneResources.js';
import { createCourseWaterReflectionGuard } from './courseWaterReflectionGuard.js';
import { computeHeightfieldNormals } from './terrainNormals.js';
import { buildCourseBridgeGeometry } from './courseBridgeGeometry.js';
import {
  buildCourseBridgeSurfaceIndex,
  queryCourseBridgeSurface,
} from '../sim/courseBridgeSurface.js';
import { createCoursePathCoordinateTransform } from '../sim/coursePathCoordinates.js';
import {
  FLORA_LOD_PROXY_BY_ID,
  FLORA_LOD_DEFAULTS,
  floraLodChoice,
  floraLodNeedsRefresh,
} from './floraLod.js';
import { attachSocket, socketWorld } from './toolSockets.js';
import { buildToolViewmodels } from './toolViewmodel.js';
import { CLEANING_TOOLS } from '../data/cleaningTools.js';

// tools worked against the boards; resolved once rather than filtered every frame
const FLOOR_ANCHORED_TOOLS = Object.values(CLEANING_TOOLS).filter((t) => t.floorAnchored).map((t) => t.id);

const ELEV_FT_TO_YD = (1 / 3) * 1.5; // real feet→yards with 1.5x readability exaggeration
const METERS_TO_YARDS = 1.0936133;
// Default water carves reach 4.5 ft (2.25 yd after readability exaggeration)
// and bunker bowls reach about 1.4 yd. Keep the coarse countryside underlay
// below every authored core plus interpolation headroom so it cannot punch
// through the playable terrain as a false turf island.
const ENV_RING_INTERIOR_TUCK_YD = 4;
// The ring meets the property at its own edge height; this is only enough drop
// to keep the two surfaces from z-fighting along the seam.
const ENV_RING_SEAM_BIAS_YD = 0.15;
// terrain vertices every ~1.33 yd on vector courses: bunker bowls, rolled lips,
// pond banks and sculpted slopes read as continuous surfaces. Legacy grid
// courses keep the coarser 2-yd spacing (their features are cell-blocky anyway).
const SEG_PER_CELL_VEC = 6;
const SEG_PER_CELL_LEGACY = 4;

const GRASS_STRUCTURE_MARGIN_YD = 1.5;

// These values are read for every accepted grass lattice point. Keep one
// immutable scalar record per grassy zone so the hot loop does not allocate a
// fresh object and tint array for each probe.
export const GRASS_ZONE_SPECS = Object.freeze({
  [ZONE.OUT]: Object.freeze({ h: 0.25, r: 0.40, g: 0.46, b: 0.20 }),
  [ZONE.ROUGH]: Object.freeze({ h: 0.14, r: 0.32, g: 0.54, b: 0.18 }),
  [ZONE.FAIRWAY]: Object.freeze({ h: 0.035, r: 0.38, g: 0.65, b: 0.22 }),
  [ZONE.TEE]: Object.freeze({ h: 0.025, r: 0.36, g: 0.62, b: 0.22 }),
  [ZONE.FRINGE]: Object.freeze({ h: 0.03, r: 0.34, g: 0.60, b: 0.21 }),
  [ZONE.HEAVY]: Object.freeze({ h: 0.32, r: 0.42, g: 0.48, b: 0.20 }),
  [ZONE.BED]: Object.freeze({ h: 0.12, r: 0.26, g: 0.40, b: 0.15 }),
  [ZONE.SEMI]: Object.freeze({ h: 0.065, r: 0.32, g: 0.57, b: 0.19 }),
});

export function grassSpecForZone(z) {
  // Keep the strict switch semantics of the original implementation: a
  // stringified zone id, for example, must not become a valid lookup.
  switch (z) {
    case ZONE.OUT:
    case ZONE.ROUGH:
    case ZONE.FAIRWAY:
    case ZONE.TEE:
    case ZONE.FRINGE:
    case ZONE.HEAVY:
    case ZONE.BED:
    case ZONE.SEMI:
      return GRASS_ZONE_SPECS[z];
    default:
      return null;
  }
}

export function buildGrassStructureBounds(
  structures,
  worldXAt,
  worldZAt,
  cellYd = CELL_YD,
  marginYd = GRASS_STRUCTURE_MARGIN_YD,
) {
  const source = structures || [];
  const bounds = new Float64Array(source.length * 4);
  let offset = 0;
  for (const structure of source) {
    bounds[offset++] = worldXAt(structure.x) - cellYd * 0.5 - marginYd;
    bounds[offset++] = worldXAt(structure.x + structure.w - 1) + cellYd * 0.5 + marginYd;
    bounds[offset++] = worldZAt(structure.y) - cellYd * 0.5 - marginYd;
    bounds[offset++] = worldZAt(structure.y + structure.h - 1) + cellYd * 0.5 + marginYd;
  }
  return bounds;
}

export function pointInsideGrassStructureBounds(bounds, wx, wz) {
  for (let offset = 0; offset < bounds.length; offset += 4) {
    if (wx >= bounds[offset] && wx <= bounds[offset + 1]
      && wz >= bounds[offset + 2] && wz <= bounds[offset + 3]) return true;
  }
  return false;
}

export function configureGrassInstanceBuffers(grassMesh) {
  grassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (grassMesh.instanceColor) grassMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
}

export function markGrassInstanceBuffersUpdated(grassMesh, instanceCount) {
  const matrixAttribute = grassMesh.instanceMatrix;
  matrixAttribute.clearUpdateRanges();
  matrixAttribute.addUpdateRange(0, instanceCount * matrixAttribute.itemSize);
  matrixAttribute.needsUpdate = true;

  const colorAttribute = grassMesh.instanceColor;
  if (!colorAttribute) return;
  colorAttribute.clearUpdateRanges();
  colorAttribute.addUpdateRange(0, instanceCount * colorAttribute.itemSize);
  colorAttribute.needsUpdate = true;
}

const WALK_FOCUS_MIN_FACING = 0.3;
const WALK_FOCUS_CROSS_TRACK_WEIGHT = 3.8;
const WALK_FOCUS_DEPTH_WEIGHT = 0.18;
const BOX_CUTTER_ACTION_SUFFIX = /\s+—\s+(?:\[LMB\] drag along tape · \[E\] hold alternative|hold \[E\] to (?:cut the tape|finish the cut))\s*$/i;

// A first-person prop with a real authored Y point should be selected by the
// crosshair, not merely by whichever XZ origin is closest to the player. The
// cross-track term makes vertically separated targets (for example a carton
// on a hand truck and the handle above it) independently reachable while the
// small depth term still breaks exact angular ties in favour of the nearer one.
export function walkPropFocusScore3d(spatialDistance, facingDot, focusBias = 0) {
  const spatial = Number(spatialDistance);
  const facing = Math.max(-1, Math.min(1, Number(facingDot)));
  const bias = Number(focusBias) || 0;
  if (!(spatial > 0) || !Number.isFinite(facing) || facing <= WALK_FOCUS_MIN_FACING) {
    return Infinity;
  }
  const along = spatial * facing;
  const crossTrack = spatial * Math.sqrt(Math.max(0, 1 - facing * facing));
  return crossTrack * WALK_FOCUS_CROSS_TRACK_WEIGHT
    + along * WALK_FOCUS_DEPTH_WEIGHT
    - bias;
}

// Moving equipment is allowed to keep the crosshair interaction it started,
// but only while its prop explicitly requests retention and the player remains
// inside the same authored reach. This prevents a tilting handle from moving
// its own focus target out from under the player without creating sticky props.
export function walkPropRetainsFocus(prop, planarDistance) {
  const distance = Number(planarDistance);
  const radius = Number(prop?.r);
  if (!Number.isFinite(distance) || distance < 0 || !(radius > 0) || distance > radius) return false;
  try {
    return !!(typeof prop.retainFocus === 'function' ? prop.retainFocus() : prop.retainFocus);
  } catch {
    return false;
  }
}

// A sealed carton advertises its eventual hold action in its simulation label.
// Until the cutter is equipped, replace that action instead of appending a
// second, contradictory instruction. Secondary repositioning remains visible.
export function walkFocusPromptLabel(label, requestedTool, equippedTool, secondaryLabel = null) {
  const secondary = secondaryLabel ? ` · [X] ${secondaryLabel}` : '';
  let primary = label == null ? '' : String(label);
  if (requestedTool === 'boxcutter' && equippedTool !== requestedTool) {
    primary = primary.replace(BOX_CUTTER_ACTION_SUFFIX, '');
    primary = `${primary} — tap [E] once to equip the box cutter`;
  }
  return `${primary}${secondary}`;
}

// Pointer-lock mouse movement has no stable cursor position, so cutting uses
// the direction of the authored world-space tape segment after it is projected
// to the screen. Only forward movement along that segment advances the blade;
// sideways motion and backtracking never award progress.
export function projectedToolDragDelta(
  startX,
  startY,
  endX,
  endY,
  movementX,
  movementY,
  minimumPathPixels = 24,
) {
  const values = [startX, startY, endX, endY, movementX, movementY].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return 0;
  const [sx, sy, ex, ey, mx, my] = values;
  const pathX = ex - sx;
  const pathY = ey - sy;
  const pathLength = Math.hypot(pathX, pathY);
  if (!(pathLength > 0.001)) return 0;
  const along = (mx * pathX + my * pathY) / pathLength;
  if (!(along > 0)) return 0;
  const divisor = Math.max(1, Number(minimumPathPixels) || 0, pathLength);
  return Math.min(1, along / divisor);
}

// --- asset-idle tracking: every loader here uses THREE.DefaultLoadingManager, so the
// prewarm can wait for in-flight GLB/texture loads before compiling and uploading
// (models finishing AFTER prewarm were the source of the remaining first-look hitches)
let assetsInFlight = false;
const assetIdleResolvers = [];
THREE.DefaultLoadingManager.onStart = () => { assetsInFlight = true; };
THREE.DefaultLoadingManager.onLoad = () => {
  assetsInFlight = false;
  while (assetIdleResolvers.length) assetIdleResolvers.shift()();
};
function whenAssetsIdle(timeoutMs) {
  if (!assetsInFlight) return Promise.resolve();
  return new Promise((res) => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      const index = assetIdleResolvers.indexOf(finish);
      if (index >= 0) assetIdleResolvers.splice(index, 1);
      res();
    };
    assetIdleResolvers.push(finish);
    timer = setTimeout(finish, timeoutMs); // never hold the veil hostage to a missing file
  });
}

// --- production flora kit (tools/blender/build_course_flora.py) — authored
// vertex-colored GLBs, loaded once and shared across scenes. Each variant
// normalizes to height 1 keeping its baked colors; placement scales to yards.
let floraAssetsPromise = null;
const floraSharedResources = {
  geometries: new Set(), materials: new Set(), textures: new Set(),
};

// The species pools the boundary forest and any untyped spot draw from.
const FLORA_FOREST = ['fill_a', 'fill_b', 'oak_b', 'oak_a', 'maple_a', 'pine_a', 'pine_b', 'spruce_a', 'birch_a', 'shade_a'];
const FLORA_PINE = ['pine_a', 'pine_b', 'spruce_a', 'cedar_a'];
// every object type the flora pipeline owns (so rebuildObjects skips them)
const FLORA_IDS = new Set([
  'oak_a', 'oak_b', 'maple_a', 'birch_a', 'shade_a', 'flower_a', 'fill_a', 'fill_b',
  'pine_a', 'pine_b', 'spruce_a', 'cedar_a', 'shrub_round', 'shrub_flower', 'bush_native',
  'reed_clump', 'grass_clump', 'rock_s', 'rock_m', 'boulder_a', 'shore_rock',
  'tree_default', 'tree_oak', 'tree_detailed', 'tree_fat', 'tree_pineDefaultA', 'tree_pineRoundB', 'reeds',
]);
// the tall canopy species (block the walker; the rest are stepped past)
const TREE_SPECIES = new Set([
  'oak_a', 'oak_b', 'maple_a', 'birch_a', 'shade_a', 'flower_a', 'fill_a', 'fill_b',
  'pine_a', 'pine_b', 'spruce_a', 'cedar_a',
  'tree_default', 'tree_oak', 'tree_detailed', 'tree_fat', 'tree_pineDefaultA', 'tree_pineRoundB',
]);

function loadFloraAssets() {
  if (floraAssetsPromise) return floraAssetsPromise;
  const loader = new GLTFLoader();
  const loadOne = (id) => new Promise((resolve) => {
    loader.load(
      `vendor/models/flora/${id}.glb`,
      (gltf) => {
        try {
          gltf.scene.updateMatrixWorld(true);
          const groups = new Map(); // material.uuid -> {mat, list}
          gltf.scene.traverse((o) => {
            if (!o.isMesh || !o.geometry) return;
            const mat = Array.isArray(o.material) ? o.material[0] : o.material;
            const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
            for (const attr of Object.keys(g.attributes)) {
              if (attr !== 'position' && attr !== 'normal' && attr !== 'color') g.deleteAttribute(attr);
            }
            if (!groups.has(mat.uuid)) groups.set(mat.uuid, { mat, list: [] });
            groups.get(mat.uuid).list.push(g);
          });
          const parts = [];
          for (const { mat, list } of groups.values()) {
            const merged = list.length === 1 ? list[0] : BufferGeometryUtils.mergeGeometries(list, false);
            const hasColor = !!merged.attributes.color;
            const material = new THREE.MeshStandardMaterial({
              vertexColors: hasColor,
              color: hasColor ? 0xffffff : (mat.color || new THREE.Color(0x6a7d4a)),
              roughness: 0.9,
              metalness: 0,
            });
            parts.push({ geometry: merged, material });
          }
          // normalize: feet on y=0, centered on xz, unit height
          const box = new THREE.Box3();
          for (const p of parts) {
            p.geometry.computeBoundingBox();
            box.union(p.geometry.boundingBox);
          }
          const height = Math.max(0.001, box.max.y - box.min.y);
          const cx = (box.min.x + box.max.x) / 2;
          const cz = (box.min.z + box.max.z) / 2;
          for (const p of parts) {
            p.geometry.translate(-cx, -box.min.y, -cz);
            p.geometry.scale(1 / height, 1 / height, 1 / height);
            p.geometry.computeBoundingSphere();
            floraSharedResources.geometries.add(p.geometry);
            floraSharedResources.materials.add(p.material);
          }
          resolve({ id, parts });
        } catch (e) {
          console.warn(`flora ${id} parse failed`, e);
          resolve(null);
        }
      },
      undefined,
      () => resolve(null),
    );
  });

  floraAssetsPromise = fetch('vendor/models/flora/_manifest.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((manifest) => {
      if (!manifest || !manifest.variants) return null;
      const meta = new Map(manifest.variants.map((v) => [v.id, v]));
      return Promise.all(manifest.variants.map((v) => loadOne(v.id))).then((loaded) => {
        const byId = new Map();
        for (const a of loaded) {
          if (!a) continue;
          const m = meta.get(a.id);
          a.kind = m.kind;
          a.baseH = (m.height[0] + m.height[1]) / 2; // yards
          a.tris = Number(m.tris) || 0;
          byId.set(a.id, a);
        }
        return byId.size ? byId : null;
      });
    })
    .catch(() => null);
  return floraAssetsPromise;
}


const GLSL_NOISE = /* glsl */ `
  float fwHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float fwNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(fwHash(i), fwHash(i + vec2(1, 0)), u.x),
               mix(fwHash(i + vec2(0, 1)), fwHash(i + vec2(1, 1)), u.x), u.y);
  }
  vec3 fwHeat(float h) {
    vec3 red = vec3(0.75, 0.16, 0.12);
    vec3 yel = vec3(0.88, 0.76, 0.22);
    vec3 grn = vec3(0.2, 0.62, 0.2);
    return h < 0.5 ? mix(red, yel, h * 2.0) : mix(yel, grn, (h - 0.5) * 2.0);
  }
`;

function hexToVec3(hex) {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

// First-person grounds tools are intentionally outside the ordinary course-boot
// asset set. Their authored textures are useful only after the player actually
// equips one, so loading them behind the startup veil pays residency for content
// that most sessions never show. Keep this manifest data-only so the deferred
// gate can be covered without constructing a WebGL scene.
export const HELD_TOOL_ASSET_MANIFEST = Object.freeze({
  hose: Object.freeze([
    Object.freeze({
      id: 'hose_nozzle', url: 'vendor/models/hose_nozzle.glb', scale: 0.38,
      position: Object.freeze([0.4, -0.52, -0.85]), rotation: Object.freeze([0.15, -0.4, 0]),
    }),
  ]),
  divot: Object.freeze([
    Object.freeze({
      id: 'hand_fork', url: 'vendor/models/hand_fork.glb', scale: 0.55,
      position: Object.freeze([0.38, -0.5, -0.72]), rotation: Object.freeze([0.75, 0.15, 0]),
    }),
    Object.freeze({
      id: 'bucket_soil', url: 'vendor/models/bucket_soil.glb', scale: 0.42,
      position: Object.freeze([-0.44, -0.66, -0.9]), rotation: Object.freeze([0, 0.3, 0]),
    }),
  ]),
  rake: Object.freeze([
    Object.freeze({
      id: 'rake', url: 'vendor/models/rake.glb', scale: 0.95,
      position: Object.freeze([0.42, -0.6, -0.95]), rotation: Object.freeze([0.6, 0.1, -0.18]),
    }),
  ]),
});

export function createHeldToolAssetRegistry({
  manifest = HELD_TOOL_ASSET_MANIFEST,
  loadTool,
  now = () => (globalThis.performance?.now?.() ?? Date.now()),
} = {}) {
  if (typeof loadTool !== 'function') throw new TypeError('loadTool must be a function');
  const records = new Map(Object.entries(manifest).map(([tool, assets]) => [tool, {
    tool,
    assets,
    status: 'idle',
    ensureCalls: 0,
    requestedAt: null,
    settledAt: null,
    reason: null,
    readyAssets: 0,
    failedAssets: 0,
    assetResults: [],
    error: null,
    promise: null,
  }]));

  const settle = (record, outcome = {}) => {
    record.settledAt = now();
    record.readyAssets = Math.max(0, Number(outcome.readyAssets) || 0);
    record.failedAssets = Math.max(0, Number(outcome.failedAssets) || 0);
    record.assetResults = Array.isArray(outcome.assetResults)
      ? outcome.assetResults.map((entry) => ({ ...entry }))
      : [];
    record.error = outcome.error ? String(outcome.error?.message || outcome.error) : null;
    record.status = outcome.disposed
      ? 'disposed'
      : record.readyAssets >= record.assets.length
        ? 'ready'
        : record.readyAssets > 0
          ? 'partial'
          : 'fallback';
    return outcome;
  };

  const ensure = (tool, reason = 'equip') => {
    const record = records.get(tool);
    if (!record) return Promise.resolve(null);
    record.ensureCalls += 1;
    if (record.promise) return record.promise;
    record.status = 'loading';
    record.reason = reason;
    record.requestedAt = now();
    let pending;
    try {
      // Deliberately invoke the loader synchronously. THREE's loading manager
      // then enters its busy state before callers can inspect assetBarrier().
      pending = loadTool(tool, record.assets);
    } catch (error) {
      record.promise = Promise.resolve(settle(record, {
        readyAssets: 0,
        failedAssets: record.assets.length,
        error,
      }));
      return record.promise;
    }
    record.promise = Promise.resolve(pending)
      .then((outcome) => settle(record, outcome || {}))
      .catch((error) => settle(record, {
        readyAssets: 0,
        failedAssets: record.assets.length,
        error,
      }));
    return record.promise;
  };

  const diagnostics = () => Object.fromEntries([...records].map(([tool, record]) => [tool, {
    status: record.status,
    assetCount: record.assets.length,
    urls: record.assets.map((asset) => asset.url),
    ensureCalls: record.ensureCalls,
    reason: record.reason,
    requestedAt: record.requestedAt,
    settledAt: record.settledAt,
    latencyMs: record.requestedAt === null || record.settledAt === null
      ? null
      : record.settledAt - record.requestedAt,
    readyAssets: record.readyAssets,
    failedAssets: record.failedAssets,
    assetResults: record.assetResults.map((entry) => ({ ...entry })),
    error: record.error,
  }]));

  return { ensure, diagnostics };
}

export function makeCourseScene(canvas, state) {
  let sceneDisposed = false;
  const adoptLoadedGltf = (gltf, adopt) => {
    if (sceneDisposed) {
      disposeSceneResources(gltf?.scene);
      return false;
    }
    adopt(gltf);
    return true;
  };
  const course = state.course;
  const W = course.w;
  const H = course.h;
  const worldW = W * CELL_YD;
  const worldH = H * CELL_YD;
  const SEG_PER_CELL = course.vec ? SEG_PER_CELL_VEC : SEG_PER_CELL_LEGACY;

  // --- renderer / scene / camera -------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // DPR 1.5 cap: above that the post chain pays quadratically for sharpness nobody reads
  // at gameplay distance — a 4K/200% desktop was rendering 78% more pixels than this.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // baked on the throttle in render(), not per frame
  // Neutral output with restrained exposure: the course should read as warm
  // parkland in sunlight, not emissive lime turf against crushed shadows.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  // The world root itself never moves. Leaving it on auto-update marks it dirty
  // before every render pass and forces a world-matrix multiply through every
  // descendant, including subtrees that deliberately opted out below.
  scene.matrixAutoUpdate = false;
  scene.fog = new THREE.FogExp2(0xc8d8cf, 0.00024); // warm atmospheric separation beyond the property

  const camera = new THREE.PerspectiveCamera(46, 1, 1, 6000);
  const rig = makeCameraRig(camera, worldW, worldH);
  // default view: standing behind the clubhouse looking up the course — the
  // natural "just stepped outside" framing, close enough to read the turf
  rig.target.set(-20, 0, 150);
  rig.yaw = 0.12;

  // --- post-processing: render → GTAO contact shadows → gentle bloom → output ---
  const composerTarget = new THREE.WebGLRenderTarget(2, 2, {
    samples: 4, // keep MSAA edges through the composer
    type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, composerTarget);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 2, 2);
  gtao.output = GTAOPass.OUTPUT.Default;
  // STYLE GUIDE §3: tight contact darkening only — no corner grime spread
  gtao.blendIntensity = 0.4;
  gtao.updateGtaoMaterial({
    radius: 1.5, // yards — hugs feet, wheels, and trunks; stays out of open turf
    distanceExponent: 1,
    thickness: 1,
    scale: 1.0,
    samples: 12,
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 8 });
  // AO at HALF resolution. The pass re-renders the whole scene for depth+normals and then
  // runs two more full-screen passes; at full size that measured ~5ms/frame on the fixed
  // spin route (90.5 → 175.8 fps with the pass off). setSize here touches only the pass's
  // own targets — the beauty image stays full-res and the soft contact darkening (§3) is
  // upsampled bilinearly, which its own denoiser already smooths past noticing.
  const gtaoFullSetSize = gtao.setSize.bind(gtao);
  gtao.setSize = (w, h) => gtaoFullSetSize(Math.max(1, Math.ceil(w * 0.5)), Math.max(1, Math.ceil(h * 0.5)));
  composer.addPass(gtao);
  // STYLE GUIDE §3: bloom effectively OFF for the scene — only the sun disc
  // (radiance in the thousands) may glint; turf and trim never halo
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.12, 0.3, 60.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let postEnabled = true;

  // --- lights & sky -----------------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xffffff, 2.8);
  sun.castShadow = true;
  // Walking is the default entry mode, so prewarm the map size that the first
  // playable frame will retain. Whole-course overview can still opt up later.
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -worldW * 0.62;
  sc.right = worldW * 0.62;
  sc.top = worldH * 0.75;
  sc.bottom = -worldH * 0.75;
  sc.near = 50;
  sc.far = 2600;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 1.2;
  scene.add(sun);
  scene.add(sun.target);

  // STYLE GUIDE §3: strong sky fill so shadows stay colorful (~60-70% of lit)
  const hemi = new THREE.HemisphereLight(0xcfe6fa, 0x5d7a44, 1.25);
  scene.add(hemi);

  const sky = new Sky();
  sky.scale.setScalar(20000);
  const skyU = sky.material.uniforms;
  skyU.turbidity.value = 2; // clear vivid blue, not milky (§1 sky)
  skyU.rayleigh.value = 4;
  skyU.mieCoefficient.value = 0.002;
  skyU.mieDirectionalG.value = 0.8;
  scene.add(sky);

  // §1 sky: puffy white cumulus — the physical Sky has none, so a stylized
  // billboard layer supplies them (toneMapped off so they stay paper-white)
  function makeCloudTexture() {
    const cnv = document.createElement('canvas');
    cnv.width = 256;
    cnv.height = 128;
    const c2 = cnv.getContext('2d');
    const puff = (x, y, r) => {
      const g = c2.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.8, 'rgba(255,255,255,0.4)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c2.fillStyle = g;
      c2.beginPath();
      c2.arc(x, y, r, 0, Math.PI * 2);
      c2.fill();
    };
    puff(64, 86, 40);
    puff(102, 66, 48);
    puff(148, 58, 52);
    puff(192, 80, 42);
    puff(120, 88, 56);
    puff(166, 90, 46);
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const cloudGroup = new THREE.Group();
  {
    const cloudTex = makeCloudTexture();
    const cloudHash = (i, s) => {
      let h = (i * 374761393 + s * 668265263) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.SpriteMaterial({
        map: cloudTex,
        transparent: true,
        opacity: 0.85 + cloudHash(i, 9) * 0.15,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      const sp = new THREE.Sprite(mat);
      const sc = 260 + cloudHash(i, 1) * 340;
      sp.scale.set(sc, sc * 0.42, 1);
      sp.position.set(
        (cloudHash(i, 2) - 0.5) * 4200,
        320 + cloudHash(i, 3) * 300,
        (cloudHash(i, 4) - 0.5) * 4200,
      );
      cloudGroup.add(sp);
    }
  }
  scene.add(cloudGroup);

  // --- ground textures: real CC0 PBR sets (Poly Haven), procedural fallback ------------
  const texLoader = new THREE.TextureLoader();

  function loadGroundTex(file, { srgb = false, fallback = null } = {}) {
    const tex = texLoader.load(
      `vendor/textures/${file}`,
      undefined,
      undefined,
      () => {
        if (sceneDisposed) return;
        // offline / missing file: fall back to the old procedural look for this slot
        if (fallback) {
          const proc = fallback();
          tex.image = proc.image;
          tex.needsUpdate = true;
          console.warn(`ground texture ${file} missing — procedural fallback in use`);
        }
      },
    );
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  const texFair = loadGroundTex('fairway_diff.jpg', { srgb: true, fallback: () => makeGrassTexture({ seed: 3, base: '#5f9c44', dark: '#4d8236', light: '#74b556' }) });
  const texFairN = loadGroundTex('fairway_nor.jpg');
  const texRough = loadGroundTex('rough_diff.jpg', { srgb: true, fallback: () => makeGrassTexture({ seed: 9, base: '#47752f', dark: '#385f24', light: '#568a3c', blades: 6500 }) });
  const texRoughN = loadGroundTex('rough_nor.jpg');
  const texSand = loadGroundTex('sand_diff.jpg', { srgb: true, fallback: () => makeSandTexture({}) });
  const texSandN = loadGroundTex('sand_nor.jpg');
  const texScrub = loadGroundTex('scrub_diff.jpg', { srgb: true, fallback: () => makeScrubTexture({}) });
  const texScrubN = loadGroundTex('scrub_nor.jpg');
  const texPath = loadGroundTex('path_diff.jpg', { srgb: true, fallback: () => makePathTexture({}) });
  // cool-gray asphalt just for the cart-path ribbons (the warm tPath reads as dirt)
  const texAsphalt = makeAsphaltTexture({});
  texAsphalt.wrapS = texAsphalt.wrapT = THREE.RepeatWrapping;
  texAsphalt.colorSpace = THREE.SRGBColorSpace;

  // --- data textures fed from sim state --------------------------------------------------
  const zoneData = new Uint8Array(W * H * 4);
  const auxData = new Uint8Array(W * H * 4);
  const planData = new Uint8Array(W * H * 4);
  const zoneTex = new THREE.DataTexture(zoneData, W, H);
  const auxTex = new THREE.DataTexture(auxData, W, H);
  const planTex = new THREE.DataTexture(planData, W, H);
  for (const t of [zoneTex, auxTex, planTex]) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  }

  // --- the HIGH-RESOLUTION visual surface field (visualField.js) -----------------
  // 16 texels per simulation cell (one per half yard): the renderer's surface truth.
  // Categorical ids → nearest filtering; smoothness lives in the DATA (warped,
  // feathered boundaries), not in texture interpolation.
  const visField = makeVisualField(course);
  // interleaved (zone, boundaryDist) bytes → an RG texture. zone is categorical
  // (nearest-sampled); the boundary-distance channel drives edge treatments
  // (bunker lip shading, green collar) at sub-yard precision.
  const zoneHiTex = new THREE.DataTexture(visField.data, visField.w, visField.h, THREE.RGFormat, THREE.UnsignedByteType);
  zoneHiTex.magFilter = THREE.NearestFilter;
  zoneHiTex.minFilter = THREE.NearestFilter;
  zoneHiTex.generateMipmaps = false;

  // Rendering-only half-yard signed distances (fairway, green, tee, bunker).
  // Linear sampling reconstructs each zero contour between texels; screen-space
  // fwidth below antialiases that sharp contour. The nearest zone texture above
  // remains authoritative for classes, lies, and interactions.
  const surfaceDistanceField = makeSurfaceDistanceField(visField);
  const surfaceDistanceTex = new THREE.DataTexture(surfaceDistanceField.data, surfaceDistanceField.w, surfaceDistanceField.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  surfaceDistanceTex.magFilter = THREE.LinearFilter;
  surfaceDistanceTex.minFilter = THREE.LinearFilter;
  surfaceDistanceTex.generateMipmaps = false;

  // Recompute the visual field from the sim grid — everything, or one padded
  // cell-rect while a paint stroke is in flight.
  function updateZoneField(st, rect = null) {
    if (rect) {
      updateVisualFieldRegion(st.course, visField, rect.x0, rect.y0, rect.x1, rect.y1);
      updateSurfaceDistanceFieldRegion(st.course, visField, surfaceDistanceField, rect.x0, rect.y0, rect.x1, rect.y1);
      // Upload only the recomputed rows. A brush stroke should not resend the
      // full 9.38 MiB course texture to the GPU.
      const dirty = surfaceDistanceField.updatedRect;
      const rowComponents = (dirty.tx1 - dirty.tx0 + 1) * 4;
      for (let ty = dirty.ty0; ty <= dirty.ty1; ty++) {
        surfaceDistanceTex.addUpdateRange((ty * surfaceDistanceField.w + dirty.tx0) * 4, rowComponents);
      }
    } else {
      computeVisualField(st.course, visField);
      computeSurfaceDistanceField(visField, surfaceDistanceField);
      surfaceDistanceTex.clearUpdateRanges();
    }
    zoneHiTex.needsUpdate = true;
    surfaceDistanceTex.needsUpdate = true;
  }

  function zoneAtWorld(x, z) {
    const fx = (x + worldW / 2) / CELL_YD;
    const fy = (z + worldH / 2) / CELL_YD;
    if (fx < 0 || fy < 0 || fx >= W || fy >= H) return ZONE.OUT;
    return fieldZoneAt(visField, course, fx, fy);
  }

  // --- terrain ------------------------------------------------------------------------------
  const segsX = W * SEG_PER_CELL;
  const segsY = H * SEG_PER_CELL;
  const vertsX = segsX + 1;
  const vertsY = segsY + 1;
  const heights = new Float32Array(vertsX * vertsY);
  let waterMeshes = [];
  const guardCourseWaterReflection = createCourseWaterReflectionGuard();

  function elevAtCell(cx, cy) {
    const x = clamp(cx, 0, W - 1);
    const y = clamp(cy, 0, H - 1);
    return course.elevation[y * W + x] * ELEV_FT_TO_YD;
  }

  function isWaterCell(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return 0;
    return course.zones[cy * W + cx] === ZONE.WATER ? 1 : 0;
  }

  // smooth (Catmull-Rom bicubic) ground height at fractional cell coords —
  // 8-yd elevation samples become continuous slopes, bowls, and banks instead
  // of bilinear facets
  function crSpline(p0, p1, p2, p3, t) {
    return 0.5 * ((2 * p1) + (-p0 + p2) * t
      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
      + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }

  function rawHeightAtCellCoords(fx, fy) {
    const x = fx - 0.5;
    const y = fy - 0.5;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = x - xi;
    const ty = y - yi;
    const r0 = crSpline(elevAtCell(xi - 1, yi - 1), elevAtCell(xi, yi - 1), elevAtCell(xi + 1, yi - 1), elevAtCell(xi + 2, yi - 1), tx);
    const r1 = crSpline(elevAtCell(xi - 1, yi), elevAtCell(xi, yi), elevAtCell(xi + 1, yi), elevAtCell(xi + 2, yi), tx);
    const r2 = crSpline(elevAtCell(xi - 1, yi + 1), elevAtCell(xi, yi + 1), elevAtCell(xi + 1, yi + 1), elevAtCell(xi + 2, yi + 1), tx);
    const r3 = crSpline(elevAtCell(xi - 1, yi + 2), elevAtCell(xi, yi + 2), elevAtCell(xi + 1, yi + 2), elevAtCell(xi + 2, yi + 2), tx);
    return crSpline(r0, r1, r2, r3, ty);
  }

  function waterMaskAtCellCoords(fx, fy) {
    const x0 = Math.floor(fx - 0.5);
    const y0 = Math.floor(fy - 0.5);
    const tx = fx - 0.5 - x0;
    const ty = fy - 0.5 - y0;
    const m00 = isWaterCell(x0, y0);
    const m10 = isWaterCell(x0 + 1, y0);
    const m01 = isWaterCell(x0, y0 + 1);
    const m11 = isWaterCell(x0 + 1, y0 + 1);
    return (m00 * (1 - tx) + m10 * tx) * (1 - ty) + (m01 * (1 - tx) + m11 * tx) * ty;
  }

  const terrainGeo = new THREE.PlaneGeometry(worldW, worldH, segsX, segsY);
  terrainGeo.rotateX(-Math.PI / 2); // XZ plane, +Y up; UV v runs 0 at -z edge after rotation? verify via raycast mapping below

  const terrainMat = new THREE.MeshStandardMaterial({
    map: texFair,
    normalMap: texFairN, // enables the tangent-frame normal path; shader picks per-zone
    normalScale: new THREE.Vector2(0.45, 0.45), // §4: texture whispers, tint talks
    roughness: 1.0,
    metalness: 0.0,
  });

  const shaderRefs = { uniforms: null };
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uZoneTex = { value: zoneTex };
    shader.uniforms.uZoneHi = { value: zoneHiTex };
    shader.uniforms.uSurfaceDistance = { value: surfaceDistanceTex };
    shader.uniforms.uHiTexel = { value: new THREE.Vector2(1 / visField.w, 1 / visField.h) };
    shader.uniforms.uAuxTex = { value: auxTex };
    shader.uniforms.uPlanTex = { value: planTex };
    shader.uniforms.uCells = { value: new THREE.Vector2(W, H) };
    shader.uniforms.uViewMode = { value: 0 };
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uStripeModes = { value: new THREE.Vector3(1, 1, 1) }; // green, fairway, tee
    shader.uniforms.tRough = { value: texRough };
    shader.uniforms.tSand = { value: texSand };
    shader.uniforms.tScrub = { value: texScrub };
    shader.uniforms.tPath = { value: texPath };
    shader.uniforms.tRoughN = { value: texRoughN };
    shader.uniforms.tSandN = { value: texSandN };
    shader.uniforms.tScrubN = { value: texScrubN };
    shaderRefs.uniforms = shader.uniforms;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWp;
        uniform sampler2D uZoneTex, uZoneHi, uSurfaceDistance, uAuxTex, uPlanTex, tRough, tSand, tScrub, tPath;
        uniform sampler2D tRoughN, tSandN, tScrubN;
        uniform vec2 uCells, uHiTexel;
        uniform float uViewMode, uTime;
        uniform vec3 uStripeModes;
        vec3 gSplatN = vec3(0.5, 0.5, 1.0);
        vec2 gSplatUv = vec2(0.0);
        float gSplatRough = 0.95;
        float surfaceInside(float distanceYd, float edgeYd) {
          // The distance field defines the world-space contour. Derivatives
          // provide only a roughly one-pixel analytic AA footprint, so close
          // views stay sharp and distant edges do not shimmer.
          // The architect's compact winner distance resolves to 0.25 yd. Keep
          // the coverage footprint at least half that quantum so its residual
          // half-yard sampling stair cannot become a visible close-view edge.
          float aa = max(fwidth(distanceYd) * 0.65, ${Number(SURFACE_COVERAGE_MIN_AA_YD).toFixed(3)});
          return 1.0 - smoothstep(edgeYd - aa, edgeYd + aa, distanceYd);
        }
        ${GLSL_NOISE}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        {
          // geometry row 0 sits at -z but UV v runs the other way — flip v so the
          // data textures line up with world positions
          vec2 flippedUv = vec2(vMapUv.x, 1.0 - vMapUv.y);
          vec2 cellUv = flippedUv * uCells;
          // THE SURFACE comes from the half-yard vector field. Categorical ids
          // stay nearest-filtered; a separate linear material-weight map below
          // provides stable sub-yard antialiasing without shader jitter/shimmer.
          vec2 zoneSample = texture2D(uZoneHi, flippedUv).rg;
          vec4 surfaceDistanceYd = (texture2D(uSurfaceDistance, flippedUv) * 255.0 - ${Number(SURFACE_DISTANCE_ZERO).toFixed(1)}) / ${Number(SURFACE_DISTANCE_UNITS_PER_YD).toFixed(1)};
          float zone = floor(zoneSample.r * 255.0 + 0.5);
          // signed distance to the winning zone's boundary, in yards (neg = inside)
          float edgeYd = (zoneSample.g * 255.0 - 128.0) / 32.0 * ${CELL_YD.toFixed(1)};
          // turf condition stays at simulation resolution (it IS sim data).
          // Disease TYPE is categorical, so it alone keeps the nearest read —
          // interpolating between two disease ids would name a third.
          vec2 sUv = (floor(cellUv) + 0.5) / uCells;
          vec4 ax = texture2D(uAuxTex, sUv);
          float disType = floor(ax.r * 255.0 / 100.0 + 0.5);

          // smooth (manual bilinear) reads for the condition tints so per-cell
          // variance doesn't render as camouflage blocks
          vec2 texel = 1.0 / uCells;
          vec2 bF = fract(cellUv - 0.5);
          vec2 b0 = (floor(cellUv - 0.5) + 0.5) * texel;
          vec4 z00 = texture2D(uZoneTex, b0);
          vec4 z10 = texture2D(uZoneTex, b0 + vec2(texel.x, 0.0));
          vec4 z01 = texture2D(uZoneTex, b0 + vec2(0.0, texel.y));
          vec4 z11 = texture2D(uZoneTex, b0 + texel);
          vec4 zSmooth = mix(mix(z00, z10, bF.x), mix(z01, z11, bF.x), bF.y);
          float health = zSmooth.g;
          float wear = zSmooth.b;
          vec4 a00 = texture2D(uAuxTex, b0);
          vec4 a10 = texture2D(uAuxTex, b0 + vec2(texel.x, 0.0));
          vec4 a01 = texture2D(uAuxTex, b0 + vec2(0.0, texel.y));
          vec4 a11 = texture2D(uAuxTex, b0 + texel);
          vec4 aSmooth = mix(mix(a00, a10, bF.x), mix(a01, a11, bF.x), bF.y);
          float moisture = aSmooth.b;
          // Grass height sets mow-stripe amplitude and disease severity sets
          // blotch strength. Read nearest, both stepped in hard 8-yard squares
          // while the tints beside them were already smooth.
          float hRel = zSmooth.a * 255.0 / 64.0;
          float disSev = aSmooth.g;

          // real PBR surfaces — sample every set in uniform control flow so mip
          // derivatives stay valid across warped zone borders, then select
          vec2 wxz = vWp.xz;
          vec2 uvFair = wxz * 0.16;   // ~6 yd repeat: blade detail at play zoom
          vec2 uvGreen = wxz * 0.30;  // tighter cut on the greens
          vec2 uvTee = wxz * 0.24;
          vec2 uvRough = wxz * 0.12;
          vec2 uvSand = wxz * 0.11;
          vec2 uvScrub = wxz * 0.14;
          vec2 uvPath = wxz * 0.30;

          vec3 dFair = texture2D(map, uvFair).rgb;
          vec3 dGreen = texture2D(map, uvGreen).rgb;
          vec3 dTee = texture2D(map, uvTee).rgb;
          vec3 dRough = texture2D(tRough, uvRough).rgb;
          vec3 dSand = texture2D(tSand, uvSand).rgb;
          vec3 dScrub = texture2D(tScrub, uvScrub).rgb;
          vec3 dPath = texture2D(tPath, uvPath).rgb;

          vec3 nFair = texture2D(normalMap, uvFair).xyz;
          // Normal detail is deliberately restrained, so one coherent turf
          // sample serves all close-cut surfaces. This saves two fragment
          // texture reads without changing diffuse scale or mowing patterns.
          vec3 nGreen = nFair;
          vec3 nTee = nFair;
          vec3 nRough = texture2D(tRoughN, uvRough).xyz;
          vec3 nSand = texture2D(tSandN, uvSand).xyz;
          vec3 nScrub = texture2D(tScrubN, uvScrub).xyz;
          // The visible asphalt is a separate ribbon mesh. Reuse the restrained
          // rough normal for its buried terrain bed and preserve a texture unit
          // for the high-resolution edge-weight map on 16-unit WebGL hardware.
          vec3 nPath = vec3(0.5, 0.5, 1.0);

          // Textures supply restrained brightness variation; warm, muted zone
          // tints carry the parkland palette without a fluorescent luma swing.
          #define FW_LUMA vec3(0.299, 0.587, 0.114)
          #define FW_STYLIZE(tex, tint) ((0.46 + dot(tex, FW_LUMA) * 1.28) * (tint))

          vec3 colRough = FW_STYLIZE(dRough, vec3(0.135, 0.205, 0.070));
          vec3 colFair = FW_STYLIZE(dFair, vec3(0.158, 0.318, 0.082));
          // First cut is a deliberate intermediate ribbon, not a blurred
          // fairway edge.  The darker sage value stays above rough while
          // remaining legible from tee height.
          vec3 colSemi = FW_STYLIZE(dFair, vec3(0.138, 0.260, 0.068));
          // Close-cut complexes need a readable identity from both the editor
          // camera and tee height.  Keep the parkland hue, but give greens a
          // brighter, cooler value and their collar a deliberate dark frame.
          vec3 colGreen = FW_STYLIZE(dGreen, vec3(0.188, 0.378, 0.084));
          vec3 colFringe = FW_STYLIZE(dGreen, vec3(0.128, 0.286, 0.060));
          vec3 colTee = FW_STYLIZE(dTee, vec3(0.180, 0.365, 0.090));
          vec3 colSand = (0.48 + dot(dSand, FW_LUMA) * 1.20) * vec3(0.70, 0.58, 0.40);

          vec3 col;
          float stripeAmp = 0.0;
          float stripeFreq = 0.0;
          float modeSel = 0.0;
          bool followFlow = false;
          if (zone < 0.5) {        // OUT — native scrub
            col = FW_STYLIZE(dScrub, vec3(0.145, 0.185, 0.082)); gSplatN = nScrub; gSplatUv = uvScrub; gSplatRough = 0.97;
          } else if (zone < 1.5) { // ROUGH
            col = colRough; gSplatN = nRough; gSplatUv = uvRough; gSplatRough = 0.96;
          } else if (zone < 2.5) { // FAIRWAY
            col = colFair; gSplatN = nFair; gSplatUv = uvFair; gSplatRough = 0.94;
            // Roughly six-yard alternating cuts make the mowing read down the
            // hole at player height as well as from the planning camera.
            stripeAmp = 0.18; stripeFreq = 0.082; modeSel = uStripeModes.y; followFlow = true;
          } else if (zone < 3.5) { // GREEN
            col = colGreen; gSplatN = nGreen; gSplatUv = uvGreen; gSplatRough = 0.9;
            stripeAmp = 0.075; stripeFreq = 0.24; modeSel = uStripeModes.x; followFlow = true;
          } else if (zone < 4.5) { // TEE
            col = colTee; gSplatN = nTee; gSplatUv = uvTee; gSplatRough = 0.93;
            stripeAmp = 0.085; stripeFreq = 0.16; modeSel = uStripeModes.z; followFlow = true;
          } else if (zone < 5.5) { // BUNKER — warm sand on a gentler curve (never blows to white)
            col = colSand;
            gSplatN = nSand; gSplatUv = uvSand; gSplatRough = 0.82;
          } else if (zone < 6.5) { // WATER bed
            col = FW_STYLIZE(dScrub, vec3(0.10, 0.16, 0.07)); gSplatN = nScrub; gSplatUv = uvScrub; gSplatRough = 0.85;
          } else if (zone < 7.5) { // PATH — a dusty worn shoulder; the ribbon mesh is the pavement
            col = colRough; gSplatN = nRough; gSplatUv = uvRough; gSplatRough = 0.95;
          } else if (zone < 8.5) { // FRINGE — a shade deeper than green, tight cut
            col = colFringe; gSplatN = nGreen; gSplatUv = uvGreen; gSplatRough = 0.92;
          } else if (zone < 9.5) { // HEAVY rough — tall, warm, golden-tipped
            col = FW_STYLIZE(dRough, vec3(0.155, 0.205, 0.072)); gSplatN = nRough; gSplatUv = uvRough; gSplatRough = 0.97;
            col = mix(col, vec3(0.34, 0.32, 0.13), fwNoise(cellUv * 2.7) * 0.2); // seedhead shimmer
          } else if (zone < 10.5) { // DIRT
            col = FW_STYLIZE(dPath, vec3(0.42, 0.31, 0.20)); gSplatN = nPath; gSplatUv = uvPath; gSplatRough = 0.95;
          } else if (zone < 11.5) { // BED — dark mulch
            col = FW_STYLIZE(dScrub, vec3(0.23, 0.15, 0.09)); gSplatN = nScrub; gSplatUv = uvScrub; gSplatRough = 0.98;
          } else {                 // SEMI — first cut between fairway and rough
            col = colSemi; gSplatN = nFair; gSplatUv = uvFair; gSplatRough = 0.95;
            stripeAmp = 0.055; stripeFreq = 0.082; modeSel = uStripeModes.y; followFlow = true;
          }
          // Sharp, subpixel categorical material contours reconstructed from
          // half-yard signed distances. R carries both fairway (zero) and the
          // real 1.4 yd first-cut threshold; G similarly carries green (zero)
          // and the 1 yd fringe edge. B/A leave tee and bunker independent.
          float fairCov = surfaceInside(surfaceDistanceYd.r, 0.0);
          float managedCov = surfaceInside(surfaceDistanceYd.r, ${Number(SURFACE_FIRST_CUT_YD).toFixed(2)});
          float greenCov = surfaceInside(surfaceDistanceYd.g, 0.0);
          float greenComplexCov = surfaceInside(surfaceDistanceYd.g, ${Number(SURFACE_GREEN_FRINGE_YD).toFixed(2)});
          float teeCov = surfaceInside(surfaceDistanceYd.b, 0.0);
          float sandCov = surfaceInside(surfaceDistanceYd.a, 0.0);

          vec3 managedCol = mix(colSemi, colFair, fairCov);
          vec3 baseTurfCol = mix(colRough, managedCol, managedCov);
          vec3 baseTurfN = mix(nRough, nFair, managedCov);
          bool edgeBlendSurface = (zone > 0.5 && zone < 5.5)
            || (zone > 7.5 && zone < 8.5) || zone > 11.5;
          if (edgeBlendSurface) {
            col = baseTurfCol;
            gSplatN = baseTurfN;
            gSplatUv = uvFair;
          }

          if (teeCov > 0.001 && edgeBlendSurface) {
            col = mix(baseTurfCol, colTee, teeCov);
            gSplatN = mix(baseTurfN, nTee, teeCov);
            gSplatUv = uvTee;
          }
          if (greenComplexCov > 0.001 && edgeBlendSurface) {
            vec3 greenComplexCol = mix(colFringe, colGreen, greenCov);
            col = mix(baseTurfCol, greenComplexCol, greenComplexCov);
            gSplatN = mix(baseTurfN, nGreen, greenComplexCov);
            gSplatUv = uvGreen;
          }
          // Bunkers have the same priority as the vector rasterizer: their
          // signed contour is applied last, including where one clips a green.
          if (sandCov > 0.001 && edgeBlendSurface) {
            col = mix(col, colSand, sandCov);
            gSplatN = mix(gSplatN, nSand, sandCov);
            gSplatUv = uvSand;
          }
          // The ROUGH -> HEAVY -> OUT gradient rings every hole, and those three
          // bands are the ones with no surface-distance channel: their colour
          // came straight off the nearest-filtered categorical id, so each band
          // edge was a hard half-yard step. They do carry a real signed distance
          // to their own outward boundary in edgeYd, so feather each band into
          // the neighbour it borders across the last yard and the step goes away
          // without softening anything that owns an SDF channel.
          vec3 heavyBand = FW_STYLIZE(dRough, vec3(0.155, 0.205, 0.072));
          heavyBand = mix(heavyBand, vec3(0.34, 0.32, 0.13), fwNoise(cellUv * 2.7) * 0.2);
          vec3 scrubBand = FW_STYLIZE(dScrub, vec3(0.145, 0.185, 0.082));
          const float bandFeatherYd = 1.25;
          if (zone < 0.5) {
            // native scrub, fading back toward the heavy band on its inner edge
            col = mix(heavyBand, col, smoothstep(0.0, bandFeatherYd, edgeYd));
          } else if (zone > 8.5 && zone < 9.5) {
            // the heavy band, fading out into native at its outer edge
            col = mix(col, scrubBand, smoothstep(-bandFeatherYd, 0.0, edgeYd));
          } else if (zone > 0.5 && zone < 1.5 && managedCov < 0.001) {
            // mown rough, fading into the heavy band where the mowing stops
            col = mix(col, heavyBand, smoothstep(-bandFeatherYd, 0.0, edgeYd));
          }

          // Broad, low-amplitude turf drift breaks repetition without turning
          // the playing surface into camouflage. One noise feature spans about
          // five simulation cells (roughly forty yards).
          col *= 0.93 + fwNoise(cellUv * 0.18 + vec2(9.7, 21.3)) * 0.14;

          if (stripeAmp > 0.001 && modeSel > 0.5) {
            // overgrown turf softens the bands but never erases the pattern —
            // a freshly-mown surface still pops the most
            float fade = max(0.4, clamp(1.7 - hRel, 0.0, 1.0));
            // mow bands follow the HOLE: per-cell direction from the flow field
            // (bilinear-smoothed so the bands bend around doglegs)
            vec2 texel2 = 1.0 / uCells;
            vec2 f0 = (floor(cellUv - 0.5) + 0.5) * texel2;
            vec2 fF = fract(cellUv - 0.5);
            float a00 = texture2D(uAuxTex, f0).a;
            float a10 = texture2D(uAuxTex, f0 + vec2(texel2.x, 0.0)).a;
            float a01 = texture2D(uAuxTex, f0 + vec2(0.0, texel2.y)).a;
            float a11 = texture2D(uAuxTex, f0 + texel2).a;
            // average as VECTORS (angles wrap); flow is stored as angle/2pi
            vec2 v00 = vec2(cos(a00 * 6.28318), sin(a00 * 6.28318));
            vec2 v10 = vec2(cos(a10 * 6.28318), sin(a10 * 6.28318));
            vec2 v01 = vec2(cos(a01 * 6.28318), sin(a01 * 6.28318));
            vec2 v11 = vec2(cos(a11 * 6.28318), sin(a11 * 6.28318));
            vec2 flow = normalize(mix(mix(v00, v10, fF.x), mix(v01, v11, fF.x), fF.y) + vec2(1e-5));
            vec2 dir1 = followFlow ? vec2(-flow.y, flow.x) : normalize(vec2(1.0, 0.32));
            vec2 dir2 = vec2(-dir1.y, dir1.x);
            float s1 = sin(dot(vWp.xz, dir1) * stripeFreq * 6.28318);
            float band = smoothstep(-0.35, 0.35, s1) * 2.0 - 1.0;
            if (modeSel > 1.5) {
              float s2 = sin(dot(vWp.xz, dir2) * stripeFreq * 6.28318);
              band = (band + (smoothstep(-0.35, 0.35, s2) * 2.0 - 1.0)) * 0.6;
            }
            col *= 1.0 + band * stripeAmp * fade;
          }

          bool isTurf = (zone > 0.5 && zone < 4.5) || (zone > 7.5 && zone < 9.5) || zone > 11.5;
          if (isTurf) {
            float dry = clamp(1.0 - health / 0.78, 0.0, 1.0);
            // §1: decay reads as OLIVE-TAN desaturation, never brown-black
            col = mix(col, vec3(0.42, 0.40, 0.16), dry * 0.55);
            col = mix(col, vec3(0.40, 0.35, 0.18), smoothstep(0.45, 1.0, wear) * 0.5);
            // freshly-watered turf reads darker until it drains — the hand-hose's
            // visible feedback, and honest for any saturated ground
            col *= 1.0 - smoothstep(0.58, 1.0, moisture) * 0.2;
            if (disSev > 0.03) {
              float spots = fwNoise(cellUv * (disType < 1.5 ? 6.5 : 3.2) + disType * 31.0);
              float cut = 1.0 - disSev * 0.6;
              float blot = smoothstep(cut, cut + 0.12, spots);
              vec3 blotch = disType < 1.5 ? vec3(0.84, 0.79, 0.6) : vec3(0.52, 0.4, 0.24);
              col = mix(col, blotch, blot * 0.78);
            }
          }

          if (zone > 4.5 && zone < 5.5) {
            // grass-lip shadow: the sand right under the rolled turf edge sits in
            // shade; the middle of the bunker takes full sun (negative inside).
            // Driven by the bunker's own LINEAR distance channel rather than the
            // nearest-sampled, quarter-yard-quantized edgeYd — a 20% darkening
            // ramp off a quantized input banded visibly across the sand.
            float lip = smoothstep(-3.5, -0.4, surfaceDistanceYd.a);
            col *= mix(1.0, 0.80, lip);
            // faint rake grooves following the sand's long axis
            float rake = sin(dot(vWp.xz, vec2(0.82, 0.30)) * 2.6) * 0.5 + 0.5;
            col *= 0.96 + 0.04 * rake * (1.0 - lip);
            // footprinted sand: visibly churned and shadowed — raking smooths it back
            float foot = smoothstep(0.1, 0.8, wear);
            col *= 1.0 - foot * 0.24;
            float churn = fwNoise(cellUv * 9.0) * 0.6 + fwNoise(cellUv * 23.0) * 0.4;
            col = mix(col, vec3(0.55, 0.44, 0.27), foot * smoothstep(0.35, 0.8, churn) * 0.6);
          }
          // green + fringe gain a whisper of edge shadow for depth off the collar,
          // off the green's linear distance channel for the same reason as the lip
          if (zone > 2.5 && zone < 3.5) col *= 0.95 + 0.05 * smoothstep(-0.5, -4.0, surfaceDistanceYd.g);

          if (uViewMode > 0.5 && uViewMode < 1.5) {
            col = isTurf ? fwHeat(health) : col * 0.22;
          } else if (uViewMode > 1.5) {
            col = isTurf
              ? mix(vec3(0.76, 0.66, 0.44), vec3(0.14, 0.34, 0.72), moisture)
              : col * 0.22;
          }

          vec2 pUv = (floor(cellUv) + 0.5) / uCells;
          vec4 plan = texture2D(uPlanTex, pUv);
          if (plan.a > 0.05) {
            float pulse = 0.7 + 0.3 * sin(uTime * 4.5);
            col = mix(col, plan.rgb, 0.6 * pulse * plan.a);
          }

          diffuseColor.rgb *= 0.0;
          diffuseColor.rgb += col;
        }
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        {
          // apply the per-zone PBR normal picked in the splat stage, using a
          // derivative tangent frame against the SAME world-scaled uv
          vec3 mapN = gSplatN * 2.0 - 1.0;
          mapN.xy *= normalScale;
          mat3 tbnSplat = getTangentFrame( - vViewPosition, normal, gSplatUv );
          normal = normalize( tbnSplat * mapN );
        }
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ 'float roughnessFactor = gSplatRough;',
      );
  };

  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  terrain.castShadow = true; // rolling land self-shadows at low sun
  scene.add(terrain);

  // --- surrounding countryside: the course sits IN a landscape, not on a slab
  // floating in the void. A big displaced ring matched to the boundary heights
  // rolls away into forested hills; fog and the boundary forest close the seam.
  const RING_REACH = 2600; // yards of world beyond the course edge
  let envRing = null;
  let horizonLandscape = null;
  function envHillNoise(x, z) {
    return (
      Math.sin(x * 0.0021 + 1.7) * Math.cos(z * 0.0017 + 0.4) * 26 +
      Math.sin(x * 0.0063 + 4.2) * Math.cos(z * 0.0051 + 2.1) * 9 +
      Math.sin(x * 0.017 + 0.8) * Math.cos(z * 0.013 + 5.2) * 2.5
    );
  }
  function buildEnvironmentRing() {
    if (envRing) {
      scene.remove(envRing);
      envRing.geometry.dispose();
    }
    const w = worldW + RING_REACH * 2;
    const h = worldH + RING_REACH * 2;
    // Denser than it needs to be for the hills, because the quads that straddle
    // the property line are the ones that decide whether the course looks like
    // a slab set down on a plain.
    const geo = new THREE.PlaneGeometry(w, h, 180, 150);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const halfW = worldW / 2;
    const halfH = worldH / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // how far outside the property this vertex sits
      const sdx = Math.abs(x) - halfW;
      const sdz = Math.abs(z) - halfH;
      const dx = Math.max(0, sdx);
      const dz = Math.max(0, sdz);
      const outside = Math.hypot(dx, dz);
      const edgeH = heightAt(clamp(x, -halfW + 1, halfW - 1), clamp(z, -halfH + 1, halfH - 1));
      if (outside <= 0.001) {
        // Inside the property the ring only has to stay hidden beneath the real
        // terrain. Ramp the tuck with depth instead of applying it flat: at this
        // quad size a full-depth vertex one step inside the line drags a visible
        // trench out past the boundary.
        const inside = Math.min(halfW - Math.abs(x), halfH - Math.abs(z));
        const tuck = ENV_RING_INTERIOR_TUCK_YD * Math.min(1, inside / 120);
        pos.setY(i, edgeH - Math.max(ENV_RING_SEAM_BIAS_YD, tuck));
        continue;
      }
      // Leave the property at its own edge height and let the wider landscape
      // grow in from there. The previous ramp dropped half a yard at the
      // boundary and decayed the edge height to sea level within 260 yd, which
      // is precisely what made the property read as a slab on empty ground.
      const blend = Math.min(1, outside / 240);
      const eased = blend * blend * (3 - 2 * blend);
      const hills = envHillNoise(x, z) * eased + outside * 0.012 * eased;
      pos.setY(i, edgeH - ENV_RING_SEAM_BIAS_YD + hills);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: texScrub,
      normalMap: texScrubN,
      normalScale: new THREE.Vector2(0.4, 0.4),
      // White base: the shader below ASSIGNS the OUT-zone colour outright rather
      // than tinting, so the ring cannot drift from the terrain it continues.
      // The course still reads as the bright subject for free — the fairway tint
      // (0.158, 0.318, 0.082) is already brighter than scrub (0.145, 0.185, 0.082).
      color: 0xffffff,
      roughness: 1,
    });
    mat.onBeforeCompile = (sh) => {
      // Reproduce the terrain shader's OUT branch exactly — same FW_STYLIZE
      // curve, same tint, same luma weights. Tinting a colour through a
      // different curve (0x99a878 through 0.35 + luma*1.9) resolved roughly
      // 2.6x brighter than the terrain it abuts; 0x7e8f5e narrowed that to
      // ~1.7x but left a tonal step that varied with luma, so it shimmered
      // with texture detail. Assigning the OUT branch outright lands at 1.00x
      // flat across the luma range, which is what removes the property edge.
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <map_fragment>',
        `{
          vec4 sampledDiffuseColor = texture2D( map, vMapUv * 90.0 );
          float luma = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = (0.46 + luma * 1.28) * vec3(0.145, 0.185, 0.082);
        }`,
      );
    };
    envRing = new THREE.Mesh(geo, mat);
    envRing.receiveShadow = true;
    scene.add(envRing);

    if (horizonLandscape) {
      scene.remove(horizonLandscape);
      horizonLandscape.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    horizonLandscape = new THREE.Group();
    horizonLandscape.name = 'DistantParklandRidges';
    const ridge = (radius, phase, baseY, heightYd, color) => {
      const segments = 192;
      const positions = [];
      const indices = [];
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const broad = Math.sin(a * 3 + phase) * 0.42 + Math.sin(a * 7 - phase * 1.7) * 0.2;
        const wooded = Math.abs(Math.sin(a * 31 + phase * 4.3)) * 0.12
          + Math.abs(Math.sin(a * 53 - phase * 2.1)) * 0.07;
        const radial = radius * (1 + Math.sin(a * 5 + phase) * 0.035);
        const x = Math.cos(a) * radial;
        const z = Math.sin(a) * radial;
        const top = baseY + heightYd * (0.78 + broad + wooded);
        positions.push(x, -45, z, x, top, z);
        if (i < segments) {
          const b = i * 2;
          indices.push(b, b + 2, b + 1, b + 2, b + 3, b + 1);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      // These are atmospheric silhouettes, not nearby lit geometry. An
      // unlit fogged material keeps the far ridge from turning into a charcoal
      // wall when its long normals face away from the midday sun.
      const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      return mesh;
    };
    // Two fog-separated silhouettes cost four hundred triangles and close the
    // ground-level horizon without instancing thousands of distant full trees.
    horizonLandscape.add(
      ridge(1250, 0.7, 12, 38, 0x66785d),
      ridge(1800, 2.2, 28, 54, 0x82907b),
    );
    scene.add(horizonLandscape);
  }

  // purely visual micro-undulation so gentle land still catches light;
  // damped on greens/tees so putting surfaces read flat and true
  function microReliefDampAtCell(cx, cy) {
    const zone = course.zones[clamp(cy, 0, H - 1) * W + clamp(cx, 0, W - 1)];
    return zone === ZONE.GREEN || zone === ZONE.TEE ? 0.12 : zone === ZONE.BUNKER ? 0.4 : 1;
  }

  function microRelief(fx, fy) {
    const n =
      Math.sin(fx * 0.9 + Math.sin(fy * 0.55) * 1.7) * Math.cos(fy * 0.74 + Math.sin(fx * 0.42) * 1.3) * 0.34 +
      Math.sin(fx * 2.3 + 1.7) * Math.cos(fy * 1.9 + 0.6) * 0.12;
    // The damp factor must be a continuous field, not a per-cell lookup. Picking
    // it with a bare floor() made it a step function on 8-yard borders: the noise
    // reaches ~0.46 yd and damp jumps 0.12 -> 1 across a cell edge, so terrain
    // vertices 1.33 yd apart could differ by ~0.4 yd. computeVertexNormals then
    // baked that cliff into the shading as visible 8-yard square facets — turf
    // that looked like a tile map even though the surface masks were smooth.
    //
    // zones is sampled at cell CENTRES (courseVec deriveZones), so the
    // interpolation lattice sits at -0.5, matching rawHeightAtCellCoords.
    // Interiors are unaffected (all four corners agree); only the edge ramps.
    const x = fx - 0.5;
    const y = fy - 0.5;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = x - xi;
    const ty = y - yi;
    const d0 = microReliefDampAtCell(xi, yi) * (1 - tx) + microReliefDampAtCell(xi + 1, yi) * tx;
    const d1 = microReliefDampAtCell(xi, yi + 1) * (1 - tx) + microReliefDampAtCell(xi + 1, yi + 1) * tx;
    return n * (d0 * (1 - ty) + d1 * ty);
  }

  // vector courses sculpt greens/tees/bunker bowls/water/mounds analytically
  // over the base rolling land, at the terrain-mesh resolution — no cell steps.
  let relief = null;
  function rebuildRelief() {
    relief = course.vec ? buildRelief(course, (cx, cy) => rawHeightAtCellCoords(cx, cy) / ELEV_FT_TO_YD) : null;
  }

  function terrainHeightAtVertex(vx, vy) {
    const fx = (vx / SEG_PER_CELL);
    const fy = (vy / SEG_PER_CELL);
    if (relief) {
      // base rolling land (feet) → analytic feature sculpt (feet) → yards
      const baseFt = rawHeightAtCellCoords(fx, fy) / ELEV_FT_TO_YD;
      return reliefAt(relief, fx, fy, baseFt) * ELEV_FT_TO_YD + microRelief(fx, fy);
    }
    const h = rawHeightAtCellCoords(fx, fy) + microRelief(fx, fy);
    const wm = waterMaskAtCellCoords(fx, fy);
    // smoothstep the carve so pond bowls curve into their banks
    return wm > 0.01 ? h - wm * wm * (3 - 2 * wm) * 2.3 : h;
  }

  // Delegates to the pure solver in terrainNormals.js, which is unit-tested to
  // produce bit-identical results for a windowed solve and a full one. That
  // property is what makes scoped terrain edits seam-free.
  //
  // The window must be padded by the caller: a vertex's normal depends on its
  // neighbours' POSITIONS, so moving a vertex changes the normals one ring out.
  function recomputeTerrainNormals(vx0, vy0, vx1, vy1) {
    const nrm = terrainGeo.attributes.normal;
    computeHeightfieldNormals(
      heights, vertsX, vertsY, worldW / segsX, worldH / segsY, nrm.array,
      { vx0, vy0, vx1, vy1 },
    );
    nrm.needsUpdate = true;
  }

  // three uploads the whole buffer when updateRanges is empty, so a scoped edit
  // must declare its span and a full rebuild must clear any span left behind.
  function markTerrainAttributeRange(attr, firstVertex, lastVertex, scoped) {
    attr.clearUpdateRanges();
    if (scoped) {
      const start = firstVertex * attr.itemSize;
      const count = (lastVertex - firstVertex + 1) * attr.itemSize;
      attr.addUpdateRange(start, count);
    }
    attr.needsUpdate = true;
  }

  // rectCells (course cells) scopes the rebuild to an edited region. Omit it
  // for a full rebuild. A terrain stroke used to pay the whole 346,801-vertex
  // loop plus a full computeVertexNormals() on every throttled tick.
  function rebuildTerrainHeights(rectCells = null) {
    if (course.vec && !relief) rebuildRelief();
    const pos = terrainGeo.attributes.position;
    const pa = pos.array;

    let vx0 = 0;
    let vy0 = 0;
    let vx1 = vertsX - 1;
    let vy1 = vertsY - 1;
    if (rectCells) {
      vx0 = clamp(Math.floor(rectCells.x0 * SEG_PER_CELL), 0, vertsX - 1);
      vy0 = clamp(Math.floor(rectCells.y0 * SEG_PER_CELL), 0, vertsY - 1);
      vx1 = clamp(Math.ceil(rectCells.x1 * SEG_PER_CELL), 0, vertsX - 1);
      vy1 = clamp(Math.ceil(rectCells.y1 * SEG_PER_CELL), 0, vertsY - 1);
    }

    for (let vy = vy0; vy <= vy1; vy++) {
      for (let vx = vx0; vx <= vx1; vx++) {
        const h = terrainHeightAtVertex(vx, vy);
        const i = vy * vertsX + vx;
        heights[i] = h;
        pa[i * 3 + 1] = h;
      }
    }
    // Upload only the touched span. needsUpdate alone re-sends the whole
    // 347k-vertex buffer (~4 MB position + ~4 MB normal) to the GPU every tick,
    // which was the remaining stroke hitch once the CPU work was scoped.
    // Rows are contiguous in the array, so one range covering first..last
    // vertex is a few rows rather than the entire mesh.
    markTerrainAttributeRange(pos, vy0 * vertsX + vx0, vy1 * vertsX + vx1, Boolean(rectCells));

    // normals reach one vertex beyond the moved positions
    const nvx0 = Math.max(0, vx0 - 1);
    const nvy0 = Math.max(0, vy0 - 1);
    const nvx1 = Math.min(vertsX - 1, vx1 + 1);
    const nvy1 = Math.min(vertsY - 1, vy1 + 1);
    recomputeTerrainNormals(nvx0, nvy0, nvx1, nvy1);
    markTerrainAttributeRange(
      terrainGeo.attributes.normal,
      nvy0 * vertsX + nvx0, nvy1 * vertsX + nvx1, Boolean(rectCells),
    );

    // A local sculpt moves land by a few yards inside a 960x640 yd plane, so it
    // cannot meaningfully change the bounding sphere; recomputing it is a full
    // pass over every vertex. Full rebuilds still refresh it.
    if (!rectCells) terrainGeo.computeBoundingSphere();
  }

  // ground height lookup in world coords (post-carve)
  function heightAt(x, z) {
    const fx = clamp((x + worldW / 2) / CELL_YD, 0, W - 0.001);
    const fy = clamp((z + worldH / 2) / CELL_YD, 0, H - 0.001);
    const vx = clamp(fx * SEG_PER_CELL, 0, vertsX - 1.001);
    const vy = clamp(fy * SEG_PER_CELL, 0, vertsY - 1.001);
    const x0 = Math.floor(vx);
    const y0 = Math.floor(vy);
    const tx = vx - x0;
    const ty = vy - y0;
    const h00 = heights[y0 * vertsX + x0];
    const h10 = heights[y0 * vertsX + Math.min(x0 + 1, vertsX - 1)];
    const h01 = heights[Math.min(y0 + 1, vertsY - 1) * vertsX + x0];
    const h11 = heights[Math.min(y0 + 1, vertsY - 1) * vertsX + Math.min(x0 + 1, vertsX - 1)];
    return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
  }
  // Bridge-aware consumers (the orbit/chase rig, walk mode, carts, and
  // playtest) must all agree on the same vertical surface. The index starts
  // empty and is rebuilt with the path meshes below.
  let bridgeSurfaceIndex = { cellYd: CELL_YD, sampleSpacingYd: 1.6, surfaces: [] };
  rig.heightAt = (x, z) => playHeightAt(x, z);

  function worldX(cx) {
    return (cx + 0.5) * CELL_YD - worldW / 2;
  }
  function worldZ(cy) {
    return (cy + 0.5) * CELL_YD - worldH / 2;
  }
  // Vector control points live on the continuous course-coordinate plane
  // (terrain vertex 0..W/H), unlike objects and integer hole markers which
  // live at simulation cell centres. Mixing these two mappings shifts paths
  // and bridges by half a cell (four yards).
  function vectorWorldX(cx) {
    return cx * CELL_YD - worldW / 2;
  }
  function vectorWorldZ(cy) {
    return cy * CELL_YD - worldH / 2;
  }
  const pathCoordinates = createCoursePathCoordinateTransform(course, {
    worldW,
    worldH,
    cellYd: CELL_YD,
  });
  function pathWorldX(cx) {
    return pathCoordinates.worldX(cx);
  }
  function pathWorldZ(cy) {
    return pathCoordinates.worldZ(cy);
  }
  function pathCourseX(x) {
    return pathCoordinates.courseX(x);
  }
  function pathCourseY(z) {
    return pathCoordinates.courseY(z);
  }

  // --- water surfaces: real reflective Water; the carved bowl makes the bank ----
  const waterNormalsTex = texLoader.load('vendor/textures/waternormals.jpg', (t) => {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  });

  // Trace the boundary of a flood-filled water component and round it off.
  // Editor-drawn and legacy ponds have no authored outline, and a disc sized to
  // the longest bbox axis is both far too big for an elongated pond and square
  // with nothing. Following the cells and smoothing the result gives every pond
  // its own shoreline without inventing an author for it.
  function cellComponentOutline(cells, gridW) {
    const member = new Set(cells);
    const has = (x, y) => member.has(y * gridW + x);
    const key = (x, y) => `${x},${y}`;
    // One directed edge per exposed cell side, wound consistently around each
    // cell so the segments chain head-to-tail around the component.
    const edges = new Map();
    for (const j of cells) {
      const x = j % gridW;
      const y = (j / gridW) | 0;
      if (!has(x, y - 1)) edges.set(key(x, y), { x: x + 1, y });
      if (!has(x + 1, y)) edges.set(key(x + 1, y), { x: x + 1, y: y + 1 });
      if (!has(x, y + 1)) edges.set(key(x + 1, y + 1), { x, y: y + 1 });
      if (!has(x - 1, y)) edges.set(key(x, y + 1), { x, y });
    }
    if (edges.size < 4) return null;

    // Longest closed chain wins; islands inside a pond are not cut out.
    let best = null;
    const used = new Set();
    for (const startKey of edges.keys()) {
      if (used.has(startKey)) continue;
      const loop = [];
      let cur = startKey;
      while (cur && edges.has(cur) && !used.has(cur)) {
        used.add(cur);
        const parts = cur.split(',');
        loop.push({ x: Number(parts[0]), y: Number(parts[1]) });
        const next = edges.get(cur);
        cur = key(next.x, next.y);
      }
      if (loop.length >= 4 && (!best || loop.length > best.length)) best = loop;
    }
    if (!best) return null;

    // Chaikin: corner-cutting turns the cell staircase into a shoreline.
    let pts = best;
    const passes = pts.length > 260 ? 2 : 3;
    for (let pass = 0; pass < passes; pass++) {
      const next = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
        next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      pts = next;
    }

    // Corner-cutting pulls the loop in; push it back out along the vertex
    // normal so the plane tucks under the bank instead of stopping on it.
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area2 += a.x * b.y - b.x * a.y;
    }
    const facing = area2 >= 0 ? 1 : -1;
    return pts.map((p, i) => {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      const nx = (next.y - prev.y) * facing;
      const ny = -(next.x - prev.x) * facing;
      const len = Math.hypot(nx, ny) || 1;
      return { x: p.x + (nx / len) * 0.3, y: p.y + (ny / len) * 0.3 };
    });
  }

  function rebuildWater() {
    for (const m of waterMeshes) {
      scene.remove(m);
      if (typeof m.dispose === 'function') m.dispose();
      m.geometry.dispose();
      if (m.material && m.material.dispose) m.material.dispose();
    }
    waterMeshes = [];
    // Every vec water carries the same sampled polygon that carves its bowl
    // (courseVec buildGeom feeds w.poly to both), so the surface can always use
    // it — and using it is what guarantees the plane lines up with the bowl.
    // This used to be gated on an opt-in `surface: 'outline'` tag that exactly
    // one authored millpond set; every other pond fell back to a disc sized from
    // the 8-yd cell bounding box, which overhangs any elongated pond and cannot
    // follow a shoreline. Legacy grid courses have no vec and still get the disc.
    const outlinedWaters = course.vec ? getGeom(course).waters : [];
    // find pond components on the cell grid
    const seen = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (seen[i] || course.zones[i] !== ZONE.WATER) continue;
      const cells = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        cells.push(j);
        const x = j % W;
        const y = (j / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (!seen[k] && course.zones[k] === ZONE.WATER) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      let minX = W;
      let maxX = 0;
      let minY = H;
      let maxY = 0;
      // the water table sits just under the LOWEST point of the shore ring —
      // carved beds vary, but a pond's surface answers its banks
      let shoreMin = Infinity;
      for (const j of cells) {
        const x = j % W;
        const y = (j / W) | 0;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (course.zones[ny * W + nx] === ZONE.WATER) continue;
          shoreMin = Math.min(shoreMin, rawHeightAtCellCoords(nx + 0.5, ny + 0.5));
        }
      }
      let bedAvg = 0;
      for (const j of cells) bedAvg += rawHeightAtCellCoords((j % W) + 0.5, ((j / W) | 0) + 0.5);
      bedAvg /= cells.length;
      const level = Number.isFinite(shoreMin) ? shoreMin - 0.32 : bedAvg - 0.7;
      const centerCellX = (minX + maxX) / 2 + 0.5;
      const centerCellY = (minY + maxY) / 2 + 0.5;
      const cx = centerCellX * CELL_YD - worldW / 2;
      const cz = centerCellY * CELL_YD - worldH / 2;
      // With every water eligible, two nearby ponds can both contain this
      // component's centre in their padded bbox. Take the tightest match rather
      // than the first, so a small pond beside a large one keeps its own shape.
      let outlined = null;
      let outlinedArea = Infinity;
      for (const feature of outlinedWaters) {
        const { x0, y0, x1, y1 } = feature.bbox;
        if (centerCellX < x0 || centerCellX > x1 || centerCellY < y0 || centerCellY > y1) continue;
        const area = Math.max(1e-6, (x1 - x0) * (y1 - y0));
        if (area < outlinedArea) {
          outlined = feature;
          outlinedArea = area;
        }
      }
      let geo;
      if (outlined?.poly?.length >= 3) {
        // Flood the same smooth analytic loop that sculpts the pond bowl. The
        // old max-dimension circle protruded far beyond elongated ponds and a
        // disconnected blue shard could show through neighboring low ground.
        const shape = new THREE.Shape();
        for (let pointIndex = 0; pointIndex < outlined.poly.length; pointIndex++) {
          const point = outlined.poly[pointIndex];
          const x = point.x * CELL_YD - worldW / 2 - cx;
          // ShapeGeometry is authored in XY, then laid onto XZ below.
          const y = -(point.y * CELL_YD - worldH / 2 - cz);
          if (pointIndex === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
        }
        shape.closePath();
        geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
      } else {
        // No authored outline: trace the pond's own cells instead of covering
        // them with a disc sized to its longest axis.
        const outline = cellComponentOutline(cells, W);
        if (outline && outline.length >= 3) {
          const shape = new THREE.Shape();
          for (let pointIndex = 0; pointIndex < outline.length; pointIndex++) {
            const point = outline[pointIndex];
            const x = point.x * CELL_YD - worldW / 2 - cx;
            // ShapeGeometry is authored in XY, then laid onto XZ below.
            const y = -(point.y * CELL_YD - worldH / 2 - cz);
            if (pointIndex === 0) shape.moveTo(x, y);
            else shape.lineTo(x, y);
          }
          shape.closePath();
          geo = new THREE.ShapeGeometry(shape);
        } else {
          // Degenerate component (a single cell, or a pinched trace): the disc
          // is still the safe answer at that size.
          const radius = (Math.max(maxX - minX, maxY - minY) / 2 + 1.4) * CELL_YD;
          geo = new THREE.CircleGeometry(radius, 40);
        }
        geo.rotateX(-Math.PI / 2);
      }
      const water = new Water(geo, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: waterNormalsTex,
        sunDirection: sun.position.clone().normalize(),
        sunColor: 0xf4ede0, // soften the specular so low angles don't read as ice
        waterColor: 0x3a7f9c, // §1: friendly stream blue-green, lifted so shaded ponds never read black
        distortionScale: 3.4, // choppier normals break the full-sky mirror
        alpha: 0.92, // a touch of the ground shows through — never a pure mirror
        fog: !!scene.fog,
      });
      guardCourseWaterReflection(water);
      water.material.uniforms.size.value = 5.5; // ripple scale
      // Water addon multiplies the reflection into its own colour; without a
      // floor a tree-shaded pond reflects dark canopy and reads BLACK. Inject a
      // minimum toward waterColor so every pond stays legibly blue-green.
      water.material.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          'gl_FragColor = vec4( outgoingLight, alpha );',
          'gl_FragColor = vec4( max( outgoingLight, waterColor * 0.34 ), alpha );',
        );
      };
      water.position.set(cx, level, cz);
      scene.add(water);
      waterMeshes.push(water);
    }
  }

  // --- trees --------------------------------------------------------------------------------
  // Placed trees come from course.objects — the editor's (and the generator's)
  // INTENTIONAL planting. Only the boundary forest outside the property line is
  // procedural: a deep hash ring that fades with distance and closes the horizon.
  let treeGroup = null;
  let floraLodUpdate = null;
  let floraLodSnapshot = {
    ready: false,
    mode: 'unbuilt',
    thresholds: { ...FLORA_LOD_DEFAULTS },
  };

  function floraDiagnostics() {
    return {
      ...floraLodSnapshot,
      thresholds: { ...(floraLodSnapshot.thresholds || {}) },
      lastCamera: floraLodSnapshot.lastCamera ? { ...floraLodSnapshot.lastCamera } : null,
      tiers: { ...(floraLodSnapshot.tiers || {}) },
      sourceById: { ...(floraLodSnapshot.sourceById || {}) },
      renderedById: { ...(floraLodSnapshot.renderedById || {}) },
    };
  }

  function treeHash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const RING_DEPTH = 34; // cells of procedural forest beyond the property line

  // legacy object types (courseShaping / old saves) → flora ids
  const FLORA_ALIAS = {
    tree_default: 'fill_a', tree_oak: 'oak_a', tree_detailed: 'shade_a', tree_fat: 'oak_b',
    tree_pineDefaultA: 'pine_a', tree_pineRoundB: 'pine_b', reeds: 'reed_clump',
  };
  function floraIdFor(type, assets) {
    if (assets.has(type)) return type;
    const a = FLORA_ALIAS[type];
    return a && assets.has(a) ? a : null;
  }

  function computeTreeSpots(assets) {
    const spots = [];
    // placed flora (trees/shrubs/rocks/reeds), exact positions
    for (const o of course.objects || []) {
      const id = assets ? floraIdFor(o.type, assets) : (o.type.startsWith('tree_') ? o.type : null);
      if (!id) continue;
      spots.push({ obj: o, id, x: o.x, y: o.y });
    }
    // boundary forest ring (outside the property line), density fading outward
    for (let y = -RING_DEPTH; y < H + RING_DEPTH; y++) {
      for (let x = -RING_DEPTH; x < W + RING_DEPTH; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) continue;
        const d = Math.max(x < 0 ? -x : x - (W - 1), y < 0 ? -y : y - (H - 1), 1);
        const p = d <= 3 ? 0.48 : d <= 8 ? 0.32 : d <= 16 ? 0.18 : 0.09;
        const h = treeHash(x * 11 + 5, y * 13 + 7);
        if (h < 1 - p) continue;
        spots.push({ x, y, r: h, edge: true, far: d });
      }
    }
    return spots;
  }

  function placeSpot(s) {
    if (s.obj) {
      const x = worldX(s.obj.x);
      const z = worldZ(s.obj.y);
      return { x, y: heightAt(x, z), z };
    }
    const jx = (treeHash(s.x + 91, s.y + 3) - 0.5) * 6;
    const jz = (treeHash(s.x + 7, s.y + 43) - 0.5) * 6;
    const x = worldX(s.x) + jx;
    const z = worldZ(s.y) + jz;
    // Ring trees stand ON the environment ring, so this MUST sample the same
    // surface buildEnvironmentRing() writes — see the vertex loop there. It used
    // to carry its own copy of an older profile that decayed edgeH to sea level
    // within 260 yd. Once the ring stopped decaying, that copy sank the outer
    // boundary forest into the ring by as much as ~16 yd at the far edge, which
    // is exactly the "one tree stamped a thousand times" symptom in reverse:
    // the trees were there, they were just buried.
    const halfW = worldW / 2;
    const halfH = worldH / 2;
    const dx = Math.max(0, Math.abs(x) - halfW);
    const dz = Math.max(0, Math.abs(z) - halfH);
    const outside = Math.hypot(dx, dz);
    const edgeH = heightAt(clamp(x, -halfW + 1, halfW - 1), clamp(z, -halfH + 1, halfH - 1));
    if (outside <= 0.001) return { x, y: edgeH, z }; // inside: stand on real terrain
    const blend = Math.min(1, outside / 240);
    const eased = blend * blend * (3 - 2 * blend);
    const hills = envHillNoise(x, z) * eased + outside * 0.012 * eased;
    // the same 0.5 yd embed the previous profile carried, so trunks bed into the
    // surface instead of floating on a 34 yd quad
    const y = edgeH - ENV_RING_SEAM_BIAS_YD + hills - 0.5;
    return { x, y, z };
  }

  let treeBuildToken = 0;

  function clearTreeGroup() {
    floraLodUpdate = null;
    if (treeGroup) {
      scene.remove(treeGroup);
      disposeSceneResources(treeGroup, { protectedResources: floraSharedResources });
    }
    treeGroup = new THREE.Group();
    treeGroup.name = 'CourseFlora';
  }

  function ensureFarEvergreenFloraAsset(assets) {
    if (assets.has('pine_far')) return;
    const pieces = [];
    const addPiece = (geometry, color) => {
      const rgb = new THREE.Color(color);
      const count = geometry.attributes.position.count;
      const values = new Float32Array(count * 3);
      for (let index = 0; index < count; index++) {
        values[index * 3] = rgb.r;
        values[index * 3 + 1] = rgb.g;
        values[index * 3 + 2] = rgb.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
      geometry.deleteAttribute('uv');
      pieces.push(geometry);
    };
    const trunk = new THREE.CylinderGeometry(0.035, 0.052, 0.38, 5, 1);
    trunk.translate(0, 0.19, 0);
    addPiece(trunk, 0x59452f);
    for (const [radius, height, centerY, color] of [
      [0.25, 0.48, 0.42, 0x315d3e],
      [0.20, 0.42, 0.62, 0x376947],
      [0.14, 0.36, 0.80, 0x3d7650],
    ]) {
      const cone = new THREE.ConeGeometry(radius, height, 6, 1);
      cone.translate(0, centerY, 0);
      addPiece(cone, color);
    }
    const geometry = BufferGeometryUtils.mergeGeometries(pieces, false);
    for (const piece of pieces) piece.dispose();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
    });
    floraSharedResources.geometries.add(geometry);
    floraSharedResources.materials.add(material);
    const tris = geometry.index
      ? Math.floor(geometry.index.count / 3)
      : Math.floor(geometry.attributes.position.count / 3);
    assets.set('pine_far', {
      id: 'pine_far',
      kind: 'evergreen',
      baseH: 14,
      tris,
      parts: [{ geometry, material }],
      derived: true,
    });
  }

  // Production flora kit. Intentional hero trees remain full-detail inside the
  // player band; distant authored trees and the boundary belt reuse normalized
  // lightweight variants. Counts are repacked only after meaningful camera
  // travel, with hysteresis at the hero boundary to avoid orbit/flyover popping.
  function rebuildFloraFromModels(assets) {
    clearTreeGroup();
    ensureFarEvergreenFloraAsset(assets);
    const spots = computeTreeSpots(assets);
    const records = [];
    const sourceById = {};
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();

    for (const s of spots) {
      let sourceId;
      if (s.id && assets.has(s.id)) {
        sourceId = s.id;
      } else {
        const belt = treeHash(Math.round(s.x) + 31, Math.round(s.y) + 17);
        const pool = belt >= 0.66 ? FLORA_PINE : FLORA_FOREST;
        sourceId = pool[Math.floor(treeHash(Math.round(s.x) + 57, Math.round(s.y) + 5) * pool.length) % pool.length];
      }
      const sourceVariant = assets.get(sourceId);
      if (!sourceVariant) continue;
      const p = placeSpot(s);
      const hx = Math.round(s.x);
      const hy = Math.round(s.y);
      let height;
      let rot;
      // Girth and lean are what stop a belt of one GLB reading as one tree
      // stamped a thousand times. A uniform scale keeps every silhouette
      // similar however much the height varies, so vary the width against the
      // height and let trunks lean a few degrees off vertical. Both pivot on
      // the spot's ground point, so a leaning trunk stays planted.
      let width;
      let leanX = 0;
      let leanZ = 0;
      if (s.obj) {
        height = sourceVariant.baseH * (s.obj.scale || 1);
        rot = s.obj.rot || 0;
        width = height; // player-placed objects stay exactly as authored
      } else {
        const farBoost = 1 + Math.min(0.5, (s.far || 1) * 0.02); // distant forest reads a touch taller
        height = sourceVariant.baseH * (0.82 + treeHash(hx + 3, hy + 77) * 0.5) * farBoost;
        rot = treeHash(hx, hy) * 6.28;
        width = height * (0.88 + treeHash(hx + 41, hy + 19) * 0.26);
        const lean = 0.075; // ~4 degrees at most
        leanX = (treeHash(hx + 7, hy + 53) - 0.5) * lean;
        leanZ = (treeHash(hx + 67, hy + 11) - 0.5) * lean;
      }
      eu.set(leanX, rot, leanZ);
      q.setFromEuler(eu);
      m.compose(v.set(p.x, p.y, p.z), q, sc.set(width, height, width));
      // Preserve the authored sage/canopy values. Instance color adds age and
      // exposure variety without crushing every shaded crown toward black.
      const brightness = 0.91 + treeHash(hx + 13, hy + 29) * 0.13;
      col.setRGB(
        brightness * (0.99 + treeHash(hx, hy + 1) * 0.035),
        brightness,
        brightness * 0.985,
      );
      records.push({
        sourceId,
        boundary: s.edge === true,
        tree: TREE_SPECIES.has(sourceId),
        position: p,
        matrix: m.clone(),
        color: col.clone(),
        hero: null,
      });
      sourceById[sourceId] = (sourceById[sourceId] || 0) + 1;
    }

    const bucketKey = (choice) => `${choice.castShadow ? 'shadow' : 'no-shadow'}:${choice.renderId}`;
    const bucketSpecs = new Map();
    const reserve = (choice) => {
      const key = bucketKey(choice);
      let spec = bucketSpecs.get(key);
      if (!spec) {
        spec = { key, choice, capacity: 0 };
        bucketSpecs.set(key, spec);
      }
      spec.capacity += 1;
    };

    for (const record of records) {
      const far = floraLodChoice(record.sourceId, Infinity, false, {
        boundary: record.boundary,
        tree: record.tree,
      });
      reserve(far);
      if (!record.boundary && FLORA_LOD_PROXY_BY_ID[record.sourceId]) {
        reserve(floraLodChoice(record.sourceId, 0, false));
      }
    }

    const renderBuckets = new Map();
    for (const spec of bucketSpecs.values()) {
      const variant = assets.get(spec.choice.renderId);
      if (!variant) continue;
      const isReed = variant.kind === 'reed';
      const meshes = variant.parts.map(({ geometry, material }, partIndex) => {
        if (isReed) material.side = THREE.DoubleSide; // thin blades read from both faces
        const im = new THREE.InstancedMesh(geometry, material, spec.capacity);
        im.name = `FloraLOD:${spec.choice.tier}:${spec.choice.renderId}:${partIndex}`;
        im.userData.floraLod = {
          renderId: spec.choice.renderId,
          castsShadow: spec.choice.castShadow,
        };
        im.count = 0;
        im.castShadow = spec.choice.castShadow && !isReed;
        im.receiveShadow = variant.kind === 'rock';
        im.frustumCulled = false; // base-geometry bounds cannot represent a repacked forest
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        return im;
      });
      renderBuckets.set(spec.key, { ...spec, variant, meshes });
      for (const im of meshes) treeGroup.add(im);
    }

    let lastCamera = null;
    let updateCount = 0;
    let totalUpdateMs = 0;
    let maxUpdateMs = 0;
    floraLodUpdate = (force = false) => {
      const nextCamera = { x: camera.position.x, z: camera.position.z };
      if (!force && !floraLodNeedsRefresh(
        lastCamera, nextCamera, FLORA_LOD_DEFAULTS.refreshDistanceYd,
      )) return false;

      lastCamera = nextCamera;
      updateCount += 1;
      const updateStarted = performance.now();
      const counts = new Map([...renderBuckets.keys()].map((key) => [key, 0]));
      const tiers = {};
      const renderedById = {};
      let renderedBaseTriangles = 0;
      for (const record of records) {
        const distance = Math.hypot(
          record.position.x - nextCamera.x,
          record.position.z - nextCamera.z,
        );
        const choice = floraLodChoice(record.sourceId, distance, record.hero, {
          boundary: record.boundary,
          tree: record.tree,
        });
        record.hero = choice.hero;
        const key = bucketKey(choice);
        const bucket = renderBuckets.get(key);
        if (!bucket) continue;
        const index = counts.get(key) || 0;
        for (const im of bucket.meshes) {
          im.setMatrixAt(index, record.matrix);
          im.setColorAt(index, record.color);
        }
        counts.set(key, index + 1);
        tiers[choice.tier] = (tiers[choice.tier] || 0) + 1;
        renderedById[choice.renderId] = (renderedById[choice.renderId] || 0) + 1;
        renderedBaseTriangles += bucket.variant.tris || 0;
      }

      for (const [key, bucket] of renderBuckets) {
        const count = counts.get(key) || 0;
        for (const im of bucket.meshes) {
          im.count = count;
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
        }
      }

      const lastUpdateMs = performance.now() - updateStarted;
      totalUpdateMs += lastUpdateMs;
      maxUpdateMs = Math.max(maxUpdateMs, lastUpdateMs);

      floraLodSnapshot = {
        ready: true,
        mode: 'dynamic-hero-proxy',
        thresholds: { ...FLORA_LOD_DEFAULTS },
        lastCamera: { x: +nextCamera.x.toFixed(2), z: +nextCamera.z.toFixed(2) },
        updates: updateCount,
        lastUpdateMs: +lastUpdateMs.toFixed(3),
        averageUpdateMs: +(totalUpdateMs / updateCount).toFixed(3),
        maxUpdateMs: +maxUpdateMs.toFixed(3),
        totalInstances: records.length,
        boundaryInstances: records.reduce((total, record) => total + (record.boundary ? 1 : 0), 0),
        authoredInstances: records.reduce((total, record) => total + (record.boundary ? 0 : 1), 0),
        meshBuckets: renderBuckets.size,
        renderedBaseTriangles,
        tiers,
        sourceById,
        renderedById,
      };
      return true;
    };

    floraLodUpdate(true);
    scene.add(treeGroup);
  }

  // offline fallback: the old primitive forest (flora GLBs missing)
  function rebuildTreesProcedural() {
    clearTreeGroup();
    const spots = computeTreeSpots(null);

    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.5, 2.8, 6);
    const crownGeo = new THREE.IcosahedronGeometry(2.7, 1);
    crownGeo.scale(1, 0.88, 1);
    const pineGeo = new THREE.ConeGeometry(2.1, 5.6, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.95 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });

    const deciduous = spots.filter((s) => treeHash(s.x + 31, s.y + 17) < 0.72);
    const pines = spots.filter((s) => treeHash(s.x + 31, s.y + 17) >= 0.72);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, deciduous.length);
    const pinesMesh = new THREE.InstancedMesh(pineGeo, pineMat, pines.length);
    for (const im of [trunks, crowns, pinesMesh]) {
      im.castShadow = true;
      im.frustumCulled = false;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const v = new THREE.Vector3();
    const col = new THREE.Color();
    spots.forEach((s, i) => {
      const p = placeSpot(s);
      const scale = 0.85 + treeHash(s.x + 3, s.y + 77) * 0.9;
      eu.set(0, treeHash(s.x, s.y) * 6.28, 0);
      q.setFromEuler(eu);
      m.compose(v.set(p.x, p.y + 1.4 * scale, p.z), q, new THREE.Vector3(scale, scale, scale));
      trunks.setMatrixAt(i, m);
    });
    deciduous.forEach((s, i) => {
      const p = placeSpot(s);
      const scale = 0.85 + treeHash(s.x + 3, s.y + 77) * 0.9;
      eu.set(0, treeHash(s.x, s.y) * 6.28, 0);
      q.setFromEuler(eu);
      m.compose(v.set(p.x, p.y + 5.0 * scale, p.z), q, new THREE.Vector3(scale, scale, scale));
      crowns.setMatrixAt(i, m);
      const g = 0.32 + treeHash(s.x + 13, s.y + 29) * 0.22;
      col.setRGB(0.16 + treeHash(s.x, s.y + 1) * 0.1, g, 0.13);
      crowns.setColorAt(i, col);
    });
    pines.forEach((s, i) => {
      const p = placeSpot(s);
      const scale = 0.85 + treeHash(s.x + 3, s.y + 77) * 0.9;
      eu.set(0, treeHash(s.x, s.y) * 6.28, 0);
      q.setFromEuler(eu);
      m.compose(v.set(p.x, p.y + 5.0 * scale, p.z), q, new THREE.Vector3(scale, scale, scale));
      pinesMesh.setMatrixAt(i, m);
      const g = 0.3 + treeHash(s.x + 3, s.y + 9) * 0.14;
      col.setRGB(0.1, g, 0.14);
      pinesMesh.setColorAt(i, col);
    });
    treeGroup.add(trunks, crowns, pinesMesh);
    floraLodSnapshot = {
      ready: true,
      mode: 'procedural-fallback',
      thresholds: { ...FLORA_LOD_DEFAULTS },
      totalInstances: spots.length,
      boundaryInstances: spots.reduce((total, spot) => total + (spot.edge ? 1 : 0), 0),
      authoredInstances: spots.reduce((total, spot) => total + (spot.obj ? 1 : 0), 0),
      tiers: { procedural: spots.length },
    };
    scene.add(treeGroup);
  }

  function rebuildTrees() {
    const token = ++treeBuildToken;
    loadFloraAssets().then((assets) => {
      if (sceneDisposed || token !== treeBuildToken) return; // superseded or lifetime ended
      if (assets && assets.size) {
        rebuildFloraFromModels(assets);
      } else {
        console.warn('flora models unavailable — procedural fallback in use');
        rebuildTreesProcedural();
      }
      freezeStaticCourse(); // freshly planted forests are still furniture
    });
  }

  // STATIC FURNITURE NEVER RECOMPOSES. The scene census counted every object paying a
  // matrix recompose in every render pass (beauty + AO G-buffer + shadow bakes) — for
  // things that never move after their rebuild. Each rebuild bakes world matrices once
  // and freezes the subtree; a later rebuild recreates fresh auto-updating nodes and
  // freezes them again. Movers stay auto: holeGroup's waving flags, and everything
  // under structGroup (the clubhouse hinges its doors and walks its customers).
  function freezeStatic(node) {
    if (!node) return;
    node.updateMatrixWorld(true);
    node.traverse((o) => { o.matrixAutoUpdate = false; });
  }
  // freezeStatic recursively updates world matrices and walks the whole
  // subtree, and treeGroup/objectGroup are the largest subtrees in the scene.
  // Re-freezing them on a refresh that did not rebuild them is pure waste — a
  // terrain stroke cannot move a tree. Callers pass what they actually rebuilt;
  // the default stays "everything" so full rebuilds are unchanged.
  function freezeStaticCourse({
    trees = true, objects = true, paths = true, env = true, water = true, terrain: terrainToo = true,
  } = {}) {
    if (trees) freezeStatic(treeGroup);
    if (objects) freezeStatic(objectGroup);
    if (paths) freezeStatic(pathGroup);
    if (env) {
      freezeStatic(envRing);
      freezeStatic(horizonLandscape);
    }
    if (water) for (const m of waterMeshes) freezeStatic(m);
    if (terrainToo) freezeStatic(terrain);
  }

  // --- near-camera grass blades ------------------------------------------------
  // A GPU-instanced tuft field that follows the ground-level camera: real
  // geometry within ~12yd, surface-gated (short on tees/fairway, tall on
  // rough/native, none on sand/water/paths), wind-swayed in the vertex shader.
  // Only alive on foot / in playtest — the overview never pays for it.
  const GRASS_COUNT = 12000; // bounded near-camera sward; at most ~336k blade tris
  const GRASS_RADIUS = 12; // yards from camera; texture carries the middle distance
  let grassMesh = null;
  let grassActive = false;

  function bladeGeometry() {
    // One instance is a small patch, not one stem. Seven offset ribbons fill
    // the lattice without multiplying the number of submitted instances.
    const g = new THREE.BufferGeometry();
    const seg = 2;
    const halfW = 0.035;
    const pos = [];
    const uv = [];
    const idx = [];
    let base = 0;
    const blades = [
      [0.00, 0.00, 0.10, 1.00, 0.12],
      [-0.30, -0.15, 0.72, 0.88, 0.08],
      [0.28, -0.20, 2.18, 0.94, 0.10],
      [-0.24, 0.27, 4.36, 0.80, 0.06],
      [0.32, 0.28, 5.25, 0.76, 0.09],
      [0.00, 0.36, 3.18, 0.68, 0.05],
      [0.08, -0.36, 1.66, 0.72, 0.07],
    ];
    for (const [ox, oz, ang, bladeH, lean] of blades) {
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      const wx = -dz;
      const wz = dx;
      for (let s = 0; s <= seg; s++) {
        const t = s / seg;
        const y = t * bladeH;
        const w = halfW * (1 - t * 0.82);
        const bend = t * t * lean;
        const cx = ox + dx * bend;
        const cz = oz + dz * bend;
        pos.push(cx - wx * w, y, cz - wz * w, cx + wx * w, y, cz + wz * w);
        uv.push(0, t, 1, t);
        if (s < seg) {
          idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
          base += 2;
        }
      }
      base += 2;
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function buildGrass() {
    const geo = bladeGeometry();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
      vertexColors: false, transparent: false,
      emissive: 0x14230d, emissiveIntensity: 0.12,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uGrassTime = { value: 0 };
      grassUniforms = sh.uniforms;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uGrassTime;
          varying float vBladeH;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // per-instance world base (from the instance matrix translation)
          vec3 iBase = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float sway = sin(uGrassTime * 1.6 + iBase.x * 0.35 + iBase.z * 0.28) * 0.12
                     + sin(uGrassTime * 2.7 + iBase.z * 0.5) * 0.05;
          // bend grows with height up the blade (uv.y)
          transformed.x += sway * uv.y * uv.y;
          transformed.z += sway * 0.5 * uv.y * uv.y;
          vBladeH = uv.y;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vBladeH;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          // slightly darker at the base, brighter tips — depth in the sward
          diffuseColor.rgb *= mix(0.96, 1.10, vBladeH);`);
    };
    grassMesh = new THREE.InstancedMesh(geo, mat, GRASS_COUNT);
    grassMesh.name = 'CourseGrassSward';
    grassMesh.userData.courseGrass = true;
    grassMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GRASS_COUNT * 3), 3);
    configureGrassInstanceBuffers(grassMesh);
    grassMesh.frustumCulled = false;
    grassMesh.castShadow = false;
    grassMesh.receiveShadow = false;
    grassMesh.count = 0; // nothing until placed
    grassMesh.visible = false;
    scene.add(grassMesh);
  }
  let grassUniforms = null;

  // deterministic per-index jitter so blades don't swim when the patch recenters
  const grassSeed = (i) => {
    let h = (i * 374761393) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  const _gm = new THREE.Matrix4();
  const _gq = new THREE.Quaternion();
  const _gv = new THREE.Vector3();
  const _gs = new THREE.Vector3();
  const _ge = new THREE.Euler();
  const _gc = new THREE.Color();

  let grassStructureBounds = new Float64Array(0);
  function insideStructure(wx, wz) {
    return pointInsideGrassStructureBounds(grassStructureBounds, wx, wz);
  }

  // WORLD-ANCHORED grass: patches live on a fixed 0.22yd lattice, so when the
  // camera moves the field stays put (no swimming, no camera-locked circle).
  // Each frame we fill the instance buffer from the lattice cells within radius.
  const GRASS_STEP = 0.22; // eight inches between stable sward anchors
  const grassAnchor = new THREE.Vector2(1e9, 1e9);
  function updateGrass(camX, camZ, force) {
    if (!grassActive) {
      if (grassMesh && grassMesh.visible) { grassMesh.visible = false; grassMesh.count = 0; }
      return;
    }
    if (!grassMesh) buildGrass();
    // rebuild only every ~1.5yd of camera travel — the field is world-anchored,
    // so this just changes WHICH lattice points are in range (rim fade hides lag)
    if (!force && Math.hypot(camX - grassAnchor.x, camZ - grassAnchor.y) < 1.5) return;
    grassAnchor.set(camX, camZ);
    const R = GRASS_RADIUS;
    const R2 = R * R;
    const gx0 = Math.floor((camX - R) / GRASS_STEP);
    const gx1 = Math.ceil((camX + R) / GRASS_STEP);
    const gz0 = Math.floor((camZ - R) / GRASS_STEP);
    const gz1 = Math.ceil((camZ + R) / GRASS_STEP);
    let n = 0;
    for (let gz = gz0; gz <= gz1 && n < GRASS_COUNT; gz++) {
      for (let gx = gx0; gx <= gx1 && n < GRASS_COUNT; gx++) {
        // deterministic hash keyed by WORLD lattice cell → stable per location
        const hk = ((gx * 92837111) ^ (gz * 689287499)) >>> 0;
        const s1 = ((hk ^ (hk >>> 13)) >>> 0) / 4294967296;
        const s2 = (((hk * 1274126177) ^ (hk >>> 16)) >>> 0) / 4294967296;
        const wx = gx * GRASS_STEP + (s1 - 0.5) * GRASS_STEP * 0.9;
        const wz = gz * GRASS_STEP + (s2 - 0.5) * GRASS_STEP * 0.9;
        const dx = wx - camX;
        const dz = wz - camZ;
        const d2 = dx * dx + dz * dz;
        if (d2 > R2) continue;
        const spec = grassSpecForZone(zoneAtWorld(wx, wz));
        if (!spec) continue;
        if (insideStructure(wx, wz)) continue;
        // ALSO honour the clubhouse's own footprint. insideStructure derives from
        // the structure-cell grid, which the terrain-resolution rebuild can desync
        // from where the interior actually stands; isInside is authoritative (it
        // asks the building). A margin catches blades that would poke under the
        // walls or through the floor from a steep indoor camera (the cash drawer).
        if (clubhouseApi && clubhouseApi.isInside) {
          const M = 1.0;
          if (clubhouseApi.isInside(wx, wz, M)) continue;
        }
        // density falls with distance so the far ring dissolves, no hard circle
        const distN = d2 / R2; // 0 near → 1 at the rim
        const s3 = (((hk * 2246822519) ^ (hk >>> 11)) >>> 0) / 4294967296;
        if (distN > 0.52 && s3 < (distN - 0.52) / 0.68) continue;
        const wy = heightAt(wx, wz) - 0.006;
        // fade height at the rim so blades sink out instead of popping
        const rimFade = distN > 0.8 ? 1 - (distN - 0.8) / 0.2 : 1;
        const hh = spec.h * (0.72 + s3 * 0.6) * rimFade;
        if (hh < 0.018) continue;
        const s4 = (((hk * 3266489917) ^ (hk >>> 15)) >>> 0) / 4294967296;
        _ge.set(0, s4 * 6.283, 0);
        _gq.setFromEuler(_ge);
        const wobble = 0.85 + s1 * 0.4;
        // A five-to-nine-inch footprint fills the lattice while height carries
        // the mowing distinction between fairway, first cut, and rough.
        const patchScale = clamp((0.16 + hh * 0.28) * wobble, 0.145, 0.255);
        _gm.compose(_gv.set(wx, wy, wz), _gq, _gs.set(patchScale, hh, patchScale));
        grassMesh.setMatrixAt(n, _gm);
        const b = 0.96 + s2 * 0.18;
        _gc.setRGB(spec.r * b, spec.g * b, spec.b * b);
        grassMesh.setColorAt(n, _gc);
        n++;
      }
    }
    grassMesh.count = n;
    grassMesh.visible = n > 0;
    markGrassInstanceBuffersUpdated(grassMesh, n);
  }

  function setGrassActive(on) {
    grassActive = on;
    if (on && !grassMesh) buildGrass();
    if (on) grassAnchor.set(1e9, 1e9); // force a rebuild on (re)activation
    if (!on && grassMesh) { grassMesh.visible = false; grassMesh.count = 0; }
  }

  // --- placed non-tree objects: shrubs, rocks, golf props, decorations -----------
  // GLBs from vendor/models/course/<type>.glb are preferred; a procedural
  // factory covers every type so the editor never places an invisible thing.
  let objectGroup = null;
  const objectGlbCache = new Map(); // type -> { parts: [{geometry, material}] } | 'missing'
  const proceduralObjectCache = new Map();
  let objectGlbPending = 0;
  // only probe GLBs the manifest lists — a 404 per missing type is console
  // noise even when the procedural fallback is intentional
  let objectGlbAvailable = null; // null until the manifest answers; [] = none
  fetch('vendor/models/course/_manifest.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      if (sceneDisposed) return;
      objectGlbAvailable = (m && m.available) || [];
      if (objectGlbAvailable.length) rebuildObjects();
    })
    .catch(() => { objectGlbAvailable = []; });

  function proceduralObjectParts(type) {
    const std = (color, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const parts = [];
    const push = (geo, mat) => parts.push({ geometry: geo, material: mat });
    switch (type) {
      case 'bush_round': {
        const g1 = new THREE.IcosahedronGeometry(0.55, 1);
        g1.scale(1, 0.8, 1);
        g1.translate(0, 0.42, 0);
        const g2 = new THREE.IcosahedronGeometry(0.4, 1);
        g2.translate(0.35, 0.32, 0.1);
        push(g1, std(0x3d5c2e));
        push(g2, std(0x466b34));
        break;
      }
      case 'bush_flower': {
        const g1 = new THREE.IcosahedronGeometry(0.5, 1);
        g1.scale(1, 0.75, 1);
        g1.translate(0, 0.38, 0);
        push(g1, std(0x44603a));
        for (let i = 0; i < 5; i++) {
          const f = new THREE.SphereGeometry(0.07, 6, 5);
          const a = (i / 5) * Math.PI * 2;
          f.translate(Math.cos(a) * 0.34, 0.62, Math.sin(a) * 0.34);
          push(f, std(i % 2 ? 0xd98bb0 : 0xe8e0c8, 0.7));
        }
        break;
      }
      case 'hedge': {
        const g = new THREE.BoxGeometry(1.6, 0.8, 0.5);
        g.translate(0, 0.4, 0);
        push(g, std(0x3a5730));
        break;
      }
      case 'grass_clump': {
        for (let i = 0; i < 7; i++) {
          const blade = new THREE.ConeGeometry(0.045, 0.7 + (i % 3) * 0.2, 4);
          const a = (i / 7) * Math.PI * 2;
          blade.translate(Math.cos(a) * 0.16, 0.36, Math.sin(a) * 0.16);
          blade.rotateZ((i % 2 ? 1 : -1) * 0.13);
          push(blade, std(0x8a8f4a, 0.95));
        }
        break;
      }
      case 'reeds': {
        for (let i = 0; i < 8; i++) {
          const reed = new THREE.CylinderGeometry(0.02, 0.03, 1.1 + (i % 4) * 0.22, 4);
          const a = (i / 8) * Math.PI * 2;
          reed.translate(Math.cos(a) * 0.2, 0.6, Math.sin(a) * 0.2);
          reed.rotateZ((i % 2 ? 1 : -1) * 0.08);
          push(reed, std(0x6d7a3f, 0.95));
        }
        break;
      }
      case 'flowers': {
        const bed = new THREE.CylinderGeometry(0.5, 0.55, 0.1, 10);
        bed.translate(0, 0.05, 0);
        push(bed, std(0x4a3421));
        for (let i = 0; i < 8; i++) {
          const f = new THREE.SphereGeometry(0.06, 6, 5);
          const a = (i / 8) * Math.PI * 2;
          f.translate(Math.cos(a) * 0.3, 0.26, Math.sin(a) * 0.3);
          push(f, std([0xd98bb0, 0xe8d34a, 0xe8e0c8][i % 3], 0.7));
        }
        break;
      }
      case 'rock_s':
      case 'rock_m':
      case 'rock_l': {
        const size = type === 'rock_s' ? 0.35 : type === 'rock_m' ? 0.7 : 1.15;
        const g = new THREE.IcosahedronGeometry(size, 1);
        g.scale(1, 0.62, 0.85);
        g.translate(0, size * 0.45, 0);
        push(g, std(0x8d8a82, 0.98));
        break;
      }
      case 'rock_cluster': {
        for (const [ox, oz, s] of [[0, 0, 0.7], [0.7, 0.3, 0.42], [-0.5, 0.4, 0.34], [0.2, -0.55, 0.4]]) {
          const g = new THREE.IcosahedronGeometry(s, 1);
          g.scale(1, 0.6, 0.85);
          g.translate(ox, s * 0.42, oz);
          push(g, std(0x8d8a82, 0.98));
        }
        break;
      }
      case 'bench': {
        const seat = new THREE.BoxGeometry(1.5, 0.08, 0.45);
        seat.translate(0, 0.48, 0);
        const back = new THREE.BoxGeometry(1.5, 0.4, 0.07);
        back.translate(0, 0.78, -0.2);
        push(seat, std(0x7a5c38, 0.8));
        push(back, std(0x7a5c38, 0.8));
        for (const sx of [-0.62, 0.62]) {
          const leg = new THREE.BoxGeometry(0.08, 0.48, 0.4);
          leg.translate(sx, 0.24, 0);
          push(leg, std(0x2e2b26, 0.7));
        }
        break;
      }
      case 'trash_bin': {
        const g = new THREE.CylinderGeometry(0.26, 0.22, 0.75, 10);
        g.translate(0, 0.38, 0);
        push(g, std(0x3d5c40, 0.7));
        const rim = new THREE.TorusGeometry(0.26, 0.03, 6, 12);
        rim.rotateX(Math.PI / 2);
        rim.translate(0, 0.76, 0);
        push(rim, std(0x2e2b26, 0.6));
        break;
      }
      case 'ball_washer': {
        const post = new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8);
        post.translate(0, 0.45, 0);
        push(post, std(0x2e4d24, 0.6));
        const body = new THREE.CylinderGeometry(0.14, 0.14, 0.34, 10);
        body.translate(0, 1.0, 0);
        push(body, std(0x2e4d24, 0.55));
        const crank = new THREE.SphereGeometry(0.05, 6, 5);
        crank.translate(0, 1.22, 0);
        push(crank, std(0xc9b98a, 0.5));
        break;
      }
      case 'distance_marker': {
        const g = new THREE.CylinderGeometry(0.09, 0.11, 0.55, 8);
        g.translate(0, 0.27, 0);
        push(g, std(0xe5ddc4, 0.7));
        const band = new THREE.CylinderGeometry(0.1, 0.1, 0.1, 8);
        band.translate(0, 0.42, 0);
        push(band, std(0xd8402e, 0.7));
        break;
      }
      case 'tee_sign': {
        const post = new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6);
        post.translate(0, 0.55, 0);
        push(post, std(0x5b4630, 0.85));
        const board = new THREE.BoxGeometry(0.85, 0.55, 0.06);
        board.translate(0, 1.25, 0);
        push(board, std(0x2e4d24, 0.7));
        break;
      }
      case 'planter': {
        const g = new THREE.CylinderGeometry(0.4, 0.32, 0.42, 10);
        g.translate(0, 0.21, 0);
        push(g, std(0x9a8f78, 0.9));
        const soil = new THREE.CylinderGeometry(0.36, 0.36, 0.05, 10);
        soil.translate(0, 0.42, 0);
        push(soil, std(0x4a3421, 1));
        const plant = new THREE.IcosahedronGeometry(0.3, 1);
        plant.translate(0, 0.62, 0);
        push(plant, std(0x466b34));
        break;
      }
      default: {
        const g = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        g.translate(0, 0.25, 0);
        push(g, std(0xb05fa0));
      }
    }
    return { parts, unitScale: 1 };
  }

  function objectParts(type) {
    const cached = objectGlbCache.get(type);
    if (cached && cached !== 'missing' && cached !== 'loading') return cached;
    if (!objectGlbAvailable || !objectGlbAvailable.includes(type)) {
      if (!proceduralObjectCache.has(type)) proceduralObjectCache.set(type, proceduralObjectParts(type));
      return proceduralObjectCache.get(type);
    }
    if (!cached) {
      objectGlbCache.set(type, 'loading');
      objectGlbPending++;
      new GLTFLoader().load(
        `vendor/models/course/${type}.glb`,
        (g) => {
          if (sceneDisposed) {
            disposeSceneResources(g.scene);
            objectGlbPending = Math.max(0, objectGlbPending - 1);
            return;
          }
          try {
            g.scene.updateMatrixWorld(true);
            const parts = [];
            g.scene.traverse((o) => {
              if (!o.isMesh || !o.geometry) return;
              const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
              parts.push({ geometry: geo, material: o.material });
            });
            // Course-kit GLBs are authored/exported in metres while the game
            // world uses yards. Keep procedural fallbacks at native yard scale.
            objectGlbCache.set(type, parts.length ? { parts, unitScale: METERS_TO_YARDS } : 'missing');
          } catch {
            objectGlbCache.set(type, 'missing');
          }
          if (--objectGlbPending === 0) rebuildObjects();
        },
        undefined,
        () => {
          if (sceneDisposed) {
            objectGlbPending = Math.max(0, objectGlbPending - 1);
            return;
          }
          objectGlbCache.set(type, 'missing');
          if (--objectGlbPending === 0) rebuildObjects();
        },
      );
    }
    if (!proceduralObjectCache.has(type)) proceduralObjectCache.set(type, proceduralObjectParts(type));
    return proceduralObjectCache.get(type);
  }

  function buildTeeSignLabel(object) {
    const nearest = (course.holes || []).reduce((best, hole) => {
      if (!hole.tee) return best;
      const d = Math.hypot(hole.tee.x - object.x, hole.tee.y - object.y);
      return !best || d < best.d ? { hole, d } : best;
    }, null);
    if (!nearest || nearest.d > 4) return null;
    const hole = nearest.hole;
    const n = holeNumber(course, hole.id) || 1;
    const vh = course.vec?.holes?.find((candidate) => candidate.id === hole.vecId);
    const yards = hole.tee && hole.pin
      ? Math.round(Math.hypot(hole.pin.x - hole.tee.x, hole.pin.y - hole.tee.y) * CELL_YD)
      : 0;
    const par = hole.parOverride || vh?.par || (yards <= 250 ? 3 : yards <= 470 ? 4 : 5);
    const name = String(hole.name || `Hole ${n}`).replace(/^Hole\s+\d+\s*[—-]?\s*/i, '').toUpperCase();

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#213d2d';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#b99450';
    ctx.lineWidth = 12;
    ctx.strokeRect(8, 8, 496, 240);
    ctx.fillStyle = '#f3ead4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 92px Arial, sans-serif';
    ctx.fillText(String(n), 62, 106);
    ctx.textAlign = 'left';
    ctx.font = '700 38px Arial, sans-serif';
    ctx.fillText(name.slice(0, 18), 124, 82);
    ctx.fillStyle = '#d8c9a7';
    ctx.font = '600 30px Arial, sans-serif';
    ctx.fillText(`PAR ${par}  ·  ${yards} YD`, 124, 150);
    ctx.fillStyle = '#b99450';
    ctx.fillRect(124, 184, 318, 5);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: false,
      // The readable face is intentionally one-sided: showing the back of a
      // text texture mirrors the label and makes the tee sign look broken.
      side: THREE.FrontSide,
      toneMapped: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -3,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.50 * METERS_TO_YARDS, 0.25 * METERS_TO_YARDS), material);
    const rot = object.rot || 0;
    // Blender's panel face exports toward local -Z in Three space.
    const front = -0.11 * METERS_TO_YARDS;
    const x = worldX(object.x) + Math.sin(rot) * front;
    const z = worldZ(object.y) + Math.cos(rot) * front;
    mesh.position.set(x, heightAt(x, z) + 1.0 * METERS_TO_YARDS, z);
    // PlaneGeometry faces local +Z, while the authored panel face is local -Z.
    // Turn the label toward that face so the player sees upright, unmirrored UI.
    mesh.rotation.set(THREE.MathUtils.degToRad(-18), rot + Math.PI, 0, 'YXZ');
    mesh.name = `teeSignLabel-hole${n}`;
    mesh.userData.courseLabel = true;
    mesh.renderOrder = 2;
    return mesh;
  }

  function rebuildObjects() {
    if (objectGroup) {
      scene.remove(objectGroup);
      objectGroup.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        if (o.userData.courseLabel) {
          o.geometry?.dispose();
          o.material?.map?.dispose();
          o.material?.dispose();
        }
      });
    }
    objectGroup = new THREE.Group();
    const byType = new Map();
    for (const o of course.objects || []) {
      if (FLORA_IDS.has(o.type)) continue; // flora (trees/shrubs/rocks/reeds) has its own pipeline
      if (!byType.has(o.type)) byType.set(o.type, []);
      byType.get(o.type).push(o);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (const [type, list] of byType) {
      const { parts, unitScale = 1 } = objectParts(type);
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        im.castShadow = true;
        im.frustumCulled = false;
        list.forEach((o, i) => {
          const x = worldX(o.x);
          const z = worldZ(o.y);
          eu.set(0, o.rot || 0, 0);
          q.setFromEuler(eu);
          const s = (o.scale || 1) * unitScale;
          m.compose(v.set(x, heightAt(x, z), z), q, sc.set(s, s, s));
          im.setMatrixAt(i, m);
        });
        objectGroup.add(im);
      }
      if (type === 'tee_sign') {
        for (const object of list) {
          const label = buildTeeSignLabel(object);
          if (label) objectGroup.add(label);
        }
      }
    }
    scene.add(objectGroup);
    // The manifest and individual GLBs finish asynchronously, so this rebuild can
    // replace the group after rebuildAll() performed its static-course freeze.
    freezeStatic(objectGroup);
  }

  // nearest placed object to a world point (for the Select tool)
  function pickObject(wx, wz, maxDistYd = 3) {
    let best = null;
    let bestD = maxDistYd;
    for (const o of course.objects || []) {
      const d = Math.hypot(worldX(o.x) - wx, worldZ(o.y) - wz);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  // --- cart-path ribbons: smooth curves laid on the terrain ------------------------
  let pathGroup = null;
  const editorGroundTargets = [terrain];
  // the diffuse map multiplies DOWN, so these read two shades lighter in place
  const PATH_MATERIALS = {
    asphalt: () => new THREE.MeshStandardMaterial({ map: texAsphalt, color: 0x9a968f, roughness: 0.95 }),
    concrete: () => new THREE.MeshStandardMaterial({ map: texAsphalt, color: 0xcac6bd, roughness: 0.9 }),
    gravel: () => new THREE.MeshStandardMaterial({ map: texPath, color: 0xd9cba4, roughness: 1 }),
    dirt: () => new THREE.MeshStandardMaterial({ map: texPath, color: 0xc09a6a, roughness: 1 }),
  };

  function pathBridgeEnabled(path) {
    if (path?.bridge === true) return true;
    return !!(path?.bridge && typeof path.bridge === 'object' && path.bridge.enabled !== false);
  }

  function bridgeCylinder(from, to, radius, material, radialSegments = 8) {
    const start = new THREE.Vector3(from.x, from.y, from.z);
    const end = new THREE.Vector3(to.x, to.y, to.z);
    const delta = end.clone().sub(start);
    const length = delta.length();
    if (!(length > 0.001)) return null;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, radialSegments, 1, false),
      material,
    );
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function bridgeForPath(path) {
    if (!pathBridgeEnabled(path)) return null;
    let built;
    try {
      built = buildCourseBridgeGeometry(path, {
        heightAt,
        pointToWorld: (point) => ({ x: pathWorldX(point.x), z: pathWorldZ(point.y) }),
      });
    } catch {
      return null;
    }
    const config = path.bridge && typeof path.bridge === 'object' ? path.bridge : {};
    const deckKind = config.deckMaterial || 'timber';
    const deckStyle = deckKind === 'concrete'
      ? { color: 0xb8b2a7, roughness: 0.92, metalness: 0 }
      : deckKind === 'steel'
        ? { color: 0x454b47, roughness: 0.5, metalness: 0.72 }
        : { color: 0x765438, roughness: 0.83, metalness: 0 };
    const deckMaterial = new THREE.MeshStandardMaterial({
      map: deckKind === 'steel' ? null : texPath,
      ...deckStyle,
    });
    const supportMaterial = new THREE.MeshStandardMaterial({
      color: deckKind === 'timber' ? 0x4e3726 : deckKind === 'steel' ? 0x343b38 : 0x77746d,
      roughness: deckKind === 'steel' ? 0.55 : 0.9,
      metalness: deckKind === 'steel' ? 0.65 : 0,
    });
    const railMaterial = new THREE.MeshStandardMaterial({
      color: deckKind === 'timber' ? 0x533a28 : 0x313c36,
      roughness: 0.72,
      metalness: deckKind === 'timber' ? 0 : 0.48,
    });
    const group = new THREE.Group();
    group.name = `coursePathBridge:${path.id ?? 'unassigned'}`;
    group.userData.pathId = path.id ?? null;
    group.userData.bridgeSpan = { startT: built.spanStartT, endT: built.spanEndT };

    const deckGeometry = new THREE.BufferGeometry();
    deckGeometry.setAttribute('position', new THREE.BufferAttribute(built.deck.positions, 3));
    deckGeometry.setAttribute('uv', new THREE.BufferAttribute(built.deck.uvs, 2));
    deckGeometry.setIndex(new THREE.BufferAttribute(built.deck.indices, 1));
    deckGeometry.computeVertexNormals();
    deckGeometry.computeBoundingSphere();
    const deck = new THREE.Mesh(deckGeometry, deckMaterial);
    deck.name = 'bridge-deck';
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);
    editorGroundTargets.push(deck);

    for (const support of built.supports) {
      const beam = bridgeCylinder(
        support.beam.from,
        support.beam.to,
        support.beam.depthYd * 0.54,
        supportMaterial,
        4,
      );
      if (beam) {
        beam.name = 'bridge-crossbeam';
        group.add(beam);
      }
      for (const pier of support.piers) {
        const mesh = bridgeCylinder(pier.bottom, pier.top, pier.radiusYd, supportMaterial, 8);
        if (mesh) {
          mesh.name = 'bridge-pier';
          group.add(mesh);
        }
      }
    }
    for (const segment of built.railSegments) {
      const rail = bridgeCylinder(segment.from, segment.to, segment.radiusYd, railMaterial, 8);
      if (rail) {
        rail.name = `bridge-rail-${segment.side}`;
        group.add(rail);
      }
    }
    for (const post of built.railPosts) {
      const railPost = bridgeCylinder(post.from, post.to, post.radiusYd, railMaterial, 8);
      if (railPost) {
        railPost.name = `bridge-post-${post.side}`;
        group.add(railPost);
      }
    }
    return group;
  }

  function rebuildBridgeSurfaceIndex() {
    bridgeSurfaceIndex = buildCourseBridgeSurfaceIndex(course, {
      terrainHeightYdAt: (x, y) => heightAt(pathWorldX(x), pathWorldZ(y)),
    });
  }

  function bridgeSurfaceAtWorld(x, z) {
    const courseX = pathCourseX(x);
    const courseY = pathCourseY(z);
    return queryCourseBridgeSurface(bridgeSurfaceIndex, courseX, courseY);
  }

  function playHeightAt(x, z) {
    return bridgeSurfaceAtWorld(x, z)?.deckHeightYd ?? heightAt(x, z);
  }

  function playZoneAtWorld(x, z) {
    return bridgeSurfaceAtWorld(x, z)?.zone ?? zoneAtWorld(x, z);
  }

  function ribbonForPath(path) {
    // Catmull-Rom through the stored points (cell coords → world)
    const pts = path.pts.map((p) => new THREE.Vector3(pathWorldX(p.x), 0, pathWorldZ(p.y)));
    if (pts.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const segs = Math.max(16, Math.round(curve.getLength() / 1.6));
    const half = (path.width || 2.6) / 2;
    const positions = [];
    const uvs = [];
    const indices = [];
    // Five cross-path samples let the pavement follow crowns and shallow
    // drainage swales instead of bridging them like a stiff raised plank.
    const crossSegments = 4;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const nx = -tan.z;
      const nz = tan.x;
      for (let j = 0; j <= crossSegments; j++) {
        const u = j / crossSegments;
        const lateral = half * (1 - u * 2);
        const x = p.x + nx * lateral;
        const z = p.z + nz * lateral;
        // Polygon offset handles coplanar precision; this sub-inch lift only
        // prevents literal z fighting and no longer casts a black trench edge.
        positions.push(x, heightAt(x, z) + 0.018, z);
        uvs.push(u, t * segs * 0.4);
      }
      if (i < segs) {
        const row = crossSegments + 1;
        const b = i * row;
        for (let j = 0; j < crossSegments; j++) {
          const a = b + j;
          indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    // the strip must face the sky: flip the winding if the curve ran the other way
    const nrm = geo.attributes.normal;
    let upSum = 0;
    for (let i = 0; i < nrm.count; i += 7) upSum += nrm.getY(i);
    if (upSum < 0) {
      const idx = geo.getIndex();
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, a);
      }
      idx.needsUpdate = true;
      geo.computeVertexNormals();
    }
    const mat = (PATH_MATERIALS[path.material] || PATH_MATERIALS.asphalt)();
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -2;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  function rebuildPaths() {
    if (pathGroup) {
      scene.remove(pathGroup);
      pathGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose) o.material.dispose();
      });
    }
    editorGroundTargets.length = 1;
    pathGroup = new THREE.Group();
    pathGroup.name = 'courseCartPaths';
    for (const p of course.paths || []) {
      const mesh = ribbonForPath(p);
      if (mesh) pathGroup.add(mesh);
      const bridge = bridgeForPath(p);
      if (bridge) pathGroup.add(bridge);
    }
    rebuildBridgeSurfaceIndex();
    scene.add(pathGroup);
  }

  // --- structures: a real little clubhouse ------------------------------------------------
  let structGroup = null;
  const windowMats = []; // glass panes that glow after dark

  function rebuildStructures() {
    grassStructureBounds = buildGrassStructureBounds(course.structures, worldX, worldZ);
    // THE CLUBHOUSE is a real building now (clubhouse.js): exterior shell and
    // pro-shop interior share one wall geometry, doors hinge and collide, and
    // the player walks in with no transition. It registers its own interaction
    // props and colliders into walkProps/propColliders.
    if (structGroup) scene.remove(structGroup);
    structGroup = new THREE.Group();
    windowMats.length = 0;
    if (clubhouseApi) {
      // never let a clubhouse teardown bug take the whole course rebuild down
      try {
        clubhouseApi.dispose();
      } catch (e) {
        console.warn('clubhouse dispose failed (continuing)', e);
      }
      clubhouseApi = null;
    }
    const s = course.structures[0];
    if (s) {
      const wx = (s.x + s.w / 2) * CELL_YD - worldW / 2;
      const wz = (s.y + s.h / 2) * CELL_YD - worldH / 2;
      clubhouseApi = makeClubhouse({
        scene, camera, renderer, state,
        center: { x: wx, z: wz },
        heightAt, walkProps, propColliders, walk,
        hooks: walkHooks,
        canvas, // register mode raycasts the CURSOR into the scene, so it needs the rect
        // The clubhouse is handed the raw walk STATE (x, z, yaw...), not the walk API,
        // so it cannot reach focusOn/clearFocus — register mode called walk.focusOn()
        // and threw. These are the two it needs: the cashier pose is a focus pose,
        // exactly like the laptop seat. (Both are function declarations, so hoisted.)
        focusOn: walkFocusOn,
        clearFocus: walkClearFocus,
        // Checkout owns only a temporary boolean override. These adapters keep
        // the post pass itself private to the course renderer and let the
        // register restore the exact player setting it observed on card entry.
        postEffects: {
          getGtaoEnabled: () => gtao.enabled,
          setGtaoEnabled: (enabled) => { gtao.enabled = enabled; },
        },
      });
    }
    scene.add(structGroup);
  }

  // --- hole furniture: flags, tee markers, status badges ------------------------------------------
  let holeGroup = null;

  function textSprite(text, { fg = '#ffffff', bg = 'rgba(20,30,16,0.85)', border = '#cfe3bd', w = 256, fontPx = 96, scaleW = 9 } = {}) {
    const cnv = document.createElement('canvas');
    cnv.width = w;
    cnv.height = 128;
    const c2 = cnv.getContext('2d');
    c2.fillStyle = bg;
    c2.beginPath();
    c2.roundRect(6, 10, w - 12, 108, 26);
    c2.fill();
    c2.strokeStyle = border;
    c2.lineWidth = 5;
    c2.stroke();
    c2.fillStyle = fg;
    c2.font = `700 ${fontPx}px "Segoe UI", sans-serif`;
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.fillText(text, w / 2, 68);
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    // toneMapped:false — the badge keeps its designed colors instead of being
    // crushed to a black square against a bright anti-sun sky (KNOWN_ISSUES)
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true, toneMapped: false }));
    sp.scale.set(scaleW, scaleW * (128 / w), 1);
    return sp;
  }

  // Hole furniture models (owner GLBs): loaded once, cloned per hole; clones
  // share geometry, so the rebuild-dispose pass must skip them (sharedGeo)
  let flagstickModel = null;
  let cupModel = null;
  function cloneShared(model) {
    const c = model.clone(true);
    c.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.userData.sharedGeo = true;
      }
    });
    return c;
  }
  new GLTFLoader().load('vendor/models/course/flagstick.glb', (g) => {
    adoptLoadedGltf(g, (loaded) => {
      flagstickModel = loaded.scene;
      updateHoles();
    });
  }, undefined, () => {});
  new GLTFLoader().load('vendor/models/course/cup_flag_base.glb', (g) => {
    adoptLoadedGltf(g, (loaded) => {
      cupModel = loaded.scene;
      updateHoles();
    });
  }, undefined, () => {});

  function hasAuthoredTeeMarkers(hole) {
    if (!hole?.tee) return false;
    const tees = course.vec?.holes?.find((vh) => vh.id === hole.vecId)?.tees || [hole.tee];
    return (course.objects || []).some((o) => {
      if (!String(o.type || '').startsWith('tee_marker_')) return false;
      return tees.some((tee) => Math.hypot(o.x - tee.x, o.y - tee.y) <= 3.5);
    });
  }

  function updateHoles() {
    if (sceneDisposed) return;
    if (holeGroup) {
      scene.remove(holeGroup);
      const sharedHoleResources = mergeSceneResources(
        collectSceneResources(flagstickModel), collectSceneResources(cupModel),
      );
      disposeSceneResources(holeGroup, { protectedResources: sharedHoleResources });
    }
    holeGroup = new THREE.Group();
    holeGroup.name = 'CourseHoleFurniture';

    const poleMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e4, roughness: 0.5 });

    for (const hole of course.holes) {
      const n = holeNumber(course, hole.id);
      const open = hole.status === HOLE_STATUS.OPEN;

      if (hole.pin) {
        const px = worldX(hole.pin.x);
        const pz = worldZ(hole.pin.y);
        const py = heightAt(px, pz);
        if (open && flagstickModel) {
          // the real flagstick (owner GLB) on every open hole
          const stick = cloneShared(flagstickModel);
          stick.scale.setScalar(METERS_TO_YARDS);
          stick.position.set(px, py, pz);
          stick.rotation.y = (n * 0.7) % 6.28; // flags don't all face one way
          holeGroup.add(stick);
        } else {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6), poleMat);
          pole.position.set(px, py + 1.25, pz);
          pole.castShadow = true;
          const flagCnv = document.createElement('canvas');
          flagCnv.width = 96;
          flagCnv.height = 64;
          const fc = flagCnv.getContext('2d');
          fc.fillStyle = open ? '#d8402e' : '#8b8b8b';
          fc.fillRect(0, 0, 96, 64);
          fc.fillStyle = '#ffffff';
          fc.font = '700 44px "Segoe UI", sans-serif';
          fc.textAlign = 'center';
          fc.textBaseline = 'middle';
          fc.fillText(String(n), 48, 34);
          const ftex = new THREE.CanvasTexture(flagCnv);
          ftex.colorSpace = THREE.SRGBColorSpace;
          const flag = new THREE.Mesh(
            new THREE.PlaneGeometry(1.35, 0.85),
            new THREE.MeshStandardMaterial({ map: ftex, side: THREE.DoubleSide, roughness: 0.7 }),
          );
          flag.position.set(px + 0.7, py + 2.12, pz);
          flag.castShadow = true;
          flag.userData.pole = { x: px, z: pz, y: py + 2.12 };
          flag.userData.isFlag = true;
          holeGroup.add(pole, flag);
        }

        // Regulation-size cup asset; the tiny fallback preserves old/offline loads.
        if (cupModel) {
          const cup = cloneShared(cupModel);
          cup.scale.setScalar(METERS_TO_YARDS);
          // The asset origin is under its 22mm body. Recess the body so only a
          // regulation-thin lip sits above the putting surface.
          cup.position.set(px, py - 0.022, pz);
          holeGroup.add(cup);
        } else {
          const cup = new THREE.Mesh(
            new THREE.CircleGeometry(0.06, 16),
            new THREE.MeshBasicMaterial({ color: 0x101408 }),
          );
          cup.rotation.x = -Math.PI / 2;
          cup.position.set(px, py + 0.002, pz);
          holeGroup.add(cup);
        }
      }

      if (hole.tee && !hasAuthoredTeeMarkers(hole)) {
        const tx = worldX(hole.tee.x);
        const tz = worldZ(hole.tee.y);
        const ty = heightAt(tx, tz);
        const aim = hole.pin
          ? Math.atan2(worldX(hole.pin.x) - tx, worldZ(hole.pin.y) - tz)
          : 0;
        const sx = Math.cos(aim);
        const sz = -Math.sin(aim);
        for (const off of [-1.25, 1.25]) {
          const mk = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 10, 8),
            new THREE.MeshStandardMaterial({ color: open ? 0x2d5f9b : 0x777973, roughness: 0.72 }),
          );
          mk.scale.y = 0.7;
          mk.position.set(tx + sx * off, ty + 0.07, tz + sz * off);
          mk.castShadow = true;
          holeGroup.add(mk);
        }
      }

      if (hole.tee && hole.pin && (hole.status === HOLE_STATUS.RENOVATION || hole.status === HOLE_STATUS.CONSTRUCTION)) {
        const mx = (worldX(hole.tee.x) + worldX(hole.pin.x)) / 2;
        const mz = (worldZ(hole.tee.y) + worldZ(hole.pin.y)) / 2;
        const my = heightAt(mx, mz);
        const label = hole.status === HOLE_STATUS.RENOVATION ? `⛏ H${n} · ${hole.daysLeft}d` : `🏗 H${n} · ${hole.daysLeft}d`;
        const badge = textSprite(label, { w: 512, fontPx: 72, fg: '#ffe9c4', bg: 'rgba(110,64,16,0.9)', border: '#ffd27a', scaleW: 22 });
        badge.position.set(mx, my + 10, mz);
        holeGroup.add(badge);
      }
    }
    scene.add(holeGroup);
  }

  // --- golfers out on the course (visual reflection of real play volume) ---------------
  const golferGroup = new THREE.Group();
  scene.add(golferGroup);
  const golfers = [];
  // STYLE GUIDE §5: one saturated polo per figure over khaki — the references'
  // golfer wardrobe (blue/navy/pink/orange/white/green)
  const POLO_COLORS = [0x3b6fb3, 0x2c3e66, 0xd98bb0, 0xd97538, 0xf0ede2, 0x3f7a34];
  const KHAKI_COLORS = [0xc2b190, 0xb9a67e, 0x9a8f78];
  const CAP_COLORS = [0xf2efe4, 0x2c3e66, 0x2f5c38, 0xe9e2cc];

  function golferHoleCorridor(course2) {
    const open = course2.holes.filter((h) => h.status === HOLE_STATUS.OPEN && h.tee && h.pin);
    if (!open.length) return null;
    return open[Math.floor(Math.random() * open.length)];
  }

  function spawnGolfer(st) {
    const hole = golferHoleCorridor(st.course);
    if (!hole) return;
    // §5: two-tone figure — khaki legs, saturated polo torso, skin head, cap —
    // articulated (real joints, procedural gait), variety from the wardrobe
    const polo = POLO_COLORS[Math.floor(Math.random() * POLO_COLORS.length)];
    const khaki = KHAKI_COLORS[Math.floor(Math.random() * KHAKI_COLORS.length)];
    const capC = CAP_COLORS[Math.floor(Math.random() * CAP_COLORS.length)];
    const char = makeCharacter({ polo, khaki, cap: capC });
    char.setMode('Walk');
    char.root.userData.char = char;
    golferGroup.add(char.root);
    golfers.push({
      mesh: char.root,
      hole,
      t: 0,
      lateral: (Math.random() - 0.5) * 10,
      speed: 0.011 + Math.random() * 0.005,
      pause: 0,
      nextStop: 0.12 + Math.random() * 0.1,
    });
  }

  function removeGolfer(index) {
    const golfer = golfers[index];
    if (!golfer) return false;
    golferGroup.remove(golfer.mesh);
    const char = golfer.mesh?.userData?.char;
    if (char && typeof char.dispose === 'function') char.dispose();
    if (golfer.mesh?.userData) golfer.mesh.userData.char = null;
    golfers.splice(index, 1);
    return true;
  }

  let golfersFrozen = false; // QA/photography: hold the walkers still
  let clubhouseApi = null; // the real building (clubhouse.js): doors, interior, customers
  const gtaoRender = gtao.render;
  gtao.render = function renderWithoutDistantClubhouseInterior(...args) {
    const interior = clubhouseApi?.interior;
    const exclude = interior?.visible === true
      && clubhouseInteriorGtaoExcludedAt(
        camera.position.x,
        camera.position.z,
        interior.position.x,
        interior.position.z,
      );
    if (!exclude) return gtaoRender.apply(this, args);
    const wasVisible = interior.visible;
    interior.visible = false;
    try {
      return gtaoRender.apply(this, args);
    } finally {
      interior.visible = wasVisible;
    }
  };

  function updateGolfers(dt, st) {
    if (golfersFrozen) return;
    const cal = st ? Math.floor((st.clock.minutes % 1440)) : 720;
    const openHours = cal >= 360 && cal <= 1200;
    const target = openHours ? clamp(Math.round((st.club && st.club.lastRounds ? st.club.lastRounds : 8) / 5), 0, 10) : 0;
    if (golfers.length < target && Math.random() < dt * 0.4) spawnGolfer(st);

    for (let i = golfers.length - 1; i >= 0; i--) {
      const w = golfers[i];
      const stillOpen = w.hole.status === HOLE_STATUS.OPEN && w.hole.tee && w.hole.pin;
      if (!stillOpen || (!openHours && w.pause <= 0) || (golfers.length > target && w.t >= 1)) {
        removeGolfer(i);
        continue;
      }
      if (w.pause > 0) {
        w.pause -= dt;
      } else {
        w.t += w.speed * dt;
        if (w.t >= w.nextStop && w.nextStop < 1) {
          w.pause = 1.4 + Math.random() * 1.6; // address the ball, swing, admire it
          w.nextStop += 0.28 + Math.random() * 0.15;
        }
        if (w.t >= 1) {
          // walk off to another hole
          const next = golferHoleCorridor(st.course);
          if (next) {
            w.hole = next;
            w.t = 0;
            w.nextStop = 0.12 + Math.random() * 0.1;
            w.lateral = (Math.random() - 0.5) * 10;
          } else {
            removeGolfer(i);
            continue;
          }
        }
      }
      // animation follows behavior: swing at a stop, idle at the green, walk between
      const char = w.mesh.userData.char;
      if (char) {
        char.setMode(w.pause > 0 ? (w.t > 0.88 ? 'Idle' : 'Swing') : 'Walk');
        char.update(dt);
      }
      const hx = worldX(w.hole.tee.x) + (worldX(w.hole.pin.x) - worldX(w.hole.tee.x)) * w.t;
      const hz = worldZ(w.hole.tee.y) + (worldZ(w.hole.pin.y) - worldZ(w.hole.tee.y)) * w.t;
      // gentle lateral wander that tapers near the green
      const taper = 1 - w.t * 0.8;
      const dirX = worldX(w.hole.pin.x) - worldX(w.hole.tee.x);
      const dirZ = worldZ(w.hole.pin.y) - worldZ(w.hole.tee.y);
      const len = Math.hypot(dirX, dirZ) || 1;
      const px = hx + (-dirZ / len) * w.lateral * taper;
      const pz = hz + (dirX / len) * w.lateral * taper;

      // separation: golfers give way to each other, the walking player, and
      // the tractor — a spring-back offset off the scripted line, not a
      // rewrite of it (they drift back once the way is clear)
      const decay = Math.min(1, dt * 2.2);
      w.avoidX = (w.avoidX || 0) * (1 - decay);
      w.avoidZ = (w.avoidZ || 0) * (1 - decay);
      const pushFrom = (ox, oz, r) => {
        const dx = px + w.avoidX - ox;
        const dz = pz + w.avoidZ - oz;
        const d = Math.hypot(dx, dz);
        if (d > 0.01 && d < r) {
          const f = (r - d) / r;
          w.avoidX += (dx / d) * f * 4.5 * dt;
          w.avoidZ += (dz / d) * f * 4.5 * dt;
        }
      };
      for (const o of golfers) {
        if (o !== w) pushFrom(o.mesh.position.x, o.mesh.position.z, 1.3);
      }
      if (walk.active && !cart.mounted) pushFrom(walk.x, walk.z, 1.5);
      if (!cartHidden) pushFrom(cart.x, cart.z, 2.6);
      const avMag = Math.hypot(w.avoidX, w.avoidZ);
      if (avMag > 2.5) {
        w.avoidX *= 2.5 / avMag;
        w.avoidZ *= 2.5 / avMag;
      }
      const fx = px + w.avoidX;
      const fz = pz + w.avoidZ;
      w.mesh.position.set(fx, heightAt(fx, fz), fz);
      w.mesh.rotation.y = Math.atan2(dirX, dirZ) + (w.pause > 0 ? 0.9 : 0);
    }
  }

  // --- walkable mode: first-person on the real course ------------------------------------
  // Adapted from shopScene's controller: WASD + pointer-lock look (arrows as
  // fallback), circle collision against what the course already has — tree
  // instances, the clubhouse body, and pond water. No new collision data:
  // trees come from the same computeTreeSpots/placeSpot the renderer plants,
  // structures from course.structures, water from course.zones.

  const walk = {
    active: false,
    x: 0,
    z: 0,
    yaw: Math.PI, // shop-door convention: forward = (-sin, -cos); π faces +z, down the course
    pitch: 0,
    eye: 1.75, // human eye height in yards over the terrain
    speed: 3.4, // yd/s — the shop's tuned 3.1 reads a hair brisker outdoors
    runMult: 1.8,
    radius: 0.34, // same body circle the shop uses
  };

  const walkHeld = new Set();
  const treeColliders = []; // {x, z, r}
  const structColliders = []; // {minX, maxX, minZ, maxZ}

  function refreshWalkColliders() {
    treeColliders.length = 0;
    // only tree-family flora blocks the walker; low shrubs/reeds/rocks are
    // brushed past. Boundary-ring trees sit outside the walkable clamp.
    for (const o of course.objects || []) {
      if (o.x < 0 || o.y < 0 || o.x >= W || o.y >= H) continue;
      if (!TREE_SPECIES.has(o.type)) continue;
      const x = worldX(o.x);
      const z = worldZ(o.y);
      treeColliders.push({ x, z, r: 0.55 }); // trunk-and-a-bit — forgiving under a wide canopy
    }
    structColliders.length = 0;
    // the clubhouse no longer blocks as one solid box — its walls register
    // real per-segment colliders (with door gaps) via clubhouse.js
  }

  function walkIsWaterAt(x, z) {
    if (bridgeSurfaceAtWorld(x, z)) return false;
    const cx = Math.floor((x + worldW / 2) / CELL_YD);
    const cy = Math.floor((z + worldH / 2) / CELL_YD);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
    return course.zones[cy * W + cx] === ZONE.WATER;
  }

  function walkSurfaceHeightAt(x, z) {
    return bridgeSurfaceAtWorld(x, z)?.deckHeightYd ?? heightAt(x, z);
  }

  function walkBlocked(nx, nz, r = walk.radius, ignoreCart = false) {
    for (const c of structColliders) {
      if (nx + r > c.minX && nx - r < c.maxX && nz + r > c.minZ && nz - r < c.maxZ) return true;
    }
    for (const c of propColliders) {
      if (c.minX !== undefined) {
        if (nx + r > c.minX && nx - r < c.maxX && nz + r > c.minZ && nz - r < c.maxZ) return true;
      } else {
        const dx = nx - c.x;
        const dz = nz - c.z;
        const rr = c.r + r;
        if (dx * dx + dz * dz < rr * rr) return true;
      }
    }
    for (const t of treeColliders) {
      const dx = nx - t.x;
      const dz = nz - t.z;
      const rr = t.r + r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    // the parked cart is solid too (you're never "inside" it except driving it)
    if (cartHidden) { /* a broken tractor elsewhere is its own collider */ } else
    if (!cart.mounted && !ignoreCart) {
      const dx = nx - cart.x;
      const dz = nz - cart.z;
      const rr = 1.1 + r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    // ponds: you stop at the water's edge (sample the toe of the step)
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (walkIsWaterAt(nx + ox, nz + oz)) return true;
    }
    return false;
  }

  // axis-separated so blocked diagonals slide along the obstacle, shop-style
  function walkTryMove(dx, dz, r = walk.radius) {
    const mX = worldW / 2 - 2;
    const mZ = worldH / 2 - 2;
    const nx = clamp(walk.x + dx, -mX, mX);
    if (!walkBlocked(nx, walk.z, r)) walk.x = nx;
    const nz = clamp(walk.z + dz, -mZ, mZ);
    if (!walkBlocked(walk.x, nz, r)) walk.z = nz;
  }

  // --- never permanently trapped ------------------------------------------------------
  // walkTryMove only ever refuses to move INTO something; it cannot get you OUT of something.
  // A door swinging shut, a box set down at your feet, a fixture placed on you — any of them
  // used to end the run. Every frame we now push out of overlaps, breadcrumb the good ground,
  // and escalate if the player is pressing a key and going nowhere anyway.
  const safeTrail = createSafeTrail(30);
  const stuckMon = createStuckMonitor({ softMs: 700, hardMs: 1800 });
  const cartCol = []; // the parked cart, as a collider, only while it is parked
  let safeClock = 0;

  function walkColliderGroups() {
    cartCol.length = 0;
    if (!cart.mounted && !cartHidden) cartCol.push({ x: cart.x, z: cart.z, r: 1.1 });
    return [structColliders, propColliders, treeColliders, cartCol];
  }

  // free = clear of every collider AND out of the water (walkBlocked knows about both)
  const walkFreeAt = (x, z, r) => !walkBlocked(x, z, r);

  function walkRecover(dtMs, px0, pz0) {
    const r = cart.mounted ? cart.radius : walk.radius;

    // 1. depenetrate: shortest way out of anything we are standing in
    const fixed = resolveOverlaps(walk.x, walk.z, r, walkColliderGroups());
    if (fixed.pushed) {
      walk.x = fixed.x;
      walk.z = fixed.z;
    }

    const overlapping = !walkFreeAt(walk.x, walk.z, r);
    const moved = Math.hypot(walk.x - px0, walk.z - pz0);

    // 2. breadcrumb ground we know is good
    safeClock += dtMs;
    if (!overlapping && safeClock > 180) {
      safeClock = 0;
      safeTrail.record(walk.x, walk.z);
    }

    // 3. still pinned? escalate. (read the keys, not walkMoving — a wedged cart counts too)
    const wants = walkHeld.has('w') || walkHeld.has('a') || walkHeld.has('s') || walkHeld.has('d');
    const escalate = stuckMon.update(dtMs, { wantsToMove: wants, moved, overlapping });
    if (escalate) walkUnstick(escalate);
  }

  // also the pause menu's manual fallback, so the player is never at the mercy of a heuristic
  function walkUnstick(how = 'auto') {
    const r = cart.mounted ? cart.radius : walk.radius;
    if (how === 'auto' || how === 'depenetrate') {
      const fixed = resolveOverlaps(walk.x, walk.z, r, walkColliderGroups());
      if (fixed.pushed && walkFreeAt(fixed.x, fixed.z, r)) {
        walk.x = fixed.x;
        walk.z = fixed.z;
        stuckMon.reset();
        return 'depenetrate';
      }
    }
    if (how !== 'nearestFree') {
      const back = safeTrail.recall((x, z) => walkFreeAt(x, z, r));
      if (back) {
        walk.x = back.x;
        walk.z = back.z;
        stuckMon.reset();
        if (walkHooks.recovered) walkHooks.recovered('lastSafe');
        return 'lastSafe';
      }
    }
    const spot = nearestFree(walk.x, walk.z, (x, z) => walkFreeAt(x, z, r), 0.25, 60);
    if (spot) {
      walk.x = spot.x;
      walk.z = spot.z;
      stuckMon.reset();
      if (walkHooks.recovered) walkHooks.recovered('nearestFree');
      return 'nearestFree';
    }
    return null; // nowhere to go: the caller can say so honestly rather than teleport into a wall
  }

  // --- generic walk-up props ([E] interactables placed by scene features) --------------
  const walkProps = []; // { x, z, r, label(), action()|null }
  const propColliders = []; // circles {x,z,r} or AABBs {minX,maxX,minZ,maxZ}
  let cartHidden = false; // the drivable tractor doesn't exist until repaired

  // one-shot scale tween so removals read as hauled away, not blinked out
  function tweenOut(obj, onDone) {
    const t0 = performance.now();
    const s0 = obj.scale.x;
    const step = () => {
      if (sceneDisposed) return;
      const t = Math.min(1, (performance.now() - t0) / 200);
      obj.scale.setScalar(s0 * (1 - t) + 0.01 * t);
      if (t < 1) requestAnimationFrame(step);
      else if (onDone) onDone();
    };
    requestAnimationFrame(step);
  }

  function removeOwnedObject(root) {
    if (!root) return null;
    root.removeFromParent();
    if (root.userData?.courseResourcesDisposed) return { alreadyDisposed: true };
    root.userData.courseResourcesDisposed = true;
    return disposeSceneResources(root, {
      protectedResources: root.userData?.courseSharedResources || null,
    });
  }

  // --- the golf cart: fast traversal, shop-convention interaction ---------------------
  // Not vehicle physics — a faster movement profile with steer-to-turn handling
  // and a wider collision circle, plus a real mesh that parks where you leave it.

  const cart = {
    x: 0, z: 0, yaw: Math.PI,
    mounted: false,
    speed: 10, // yd/s ≈ 20 mph — honest golf-cart pace, ~3× walking
    reverse: 3.5,
    turnRate: 1.6, // rad/s at driving speed
    eye: 1.9, // the tractor seat sits high
    radius: 1.15, // real tractor footprint (deck included, forgivingly)
  };
  let cartMesh = null;

  function buildCartMesh() {
    // STYLE GUIDE §1/§5 equipment: grounds-crew utility language — green body,
    // tan bench, cream canopy, black running gear (the references' "Turf Boss")
    const g = new THREE.Group();
    const green = new THREE.MeshStandardMaterial({ color: 0x3d5c40, roughness: 0.6 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xe5ddc4, roughness: 0.55 });
    const tan = new THREE.MeshStandardMaterial({ color: 0xc9b98a, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24221e, roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 2.4), green);
    body.position.y = 0.55;
    body.castShadow = true;
    g.add(body);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.45, 0.9), tan);
    seat.position.set(0, 0.95, 0.4);
    g.add(seat);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.35, 0.25), dark);
    dash.position.set(0, 0.95, -0.65);
    g.add(dash);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 2.0), cream);
    roof.position.y = 2.0;
    roof.castShadow = true;
    g.add(roof);
    for (const [px, pz] of [[-0.6, -0.9], [0.6, -0.9], [-0.6, 0.75], [0.6, 0.75]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.25, 6), dark);
      post.position.set(px, 1.38, pz);
      g.add(post);
    }
    const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [px, pz] of [[-0.62, -0.85], [0.62, -0.85], [-0.62, 0.85], [0.62, 0.85]]) {
      const wheel = new THREE.Mesh(wheelGeo, dark);
      wheel.position.set(px, 0.28, pz);
      g.add(wheel);
    }
    return g;
  }

  function placeCartMesh() {
    if (!cartMesh) return;
    cartMesh.visible = !cartHidden;
    cartMesh.position.set(cart.x, walkSurfaceHeightAt(cart.x, cart.z), cart.z);
    cartMesh.rotation.y = cart.yaw;
  }

  function parkCartAtClubhouse() {
    const spawn = walkDefaultSpawn();
    cart.x = spawn.x + 5.5;
    cart.z = spawn.z + 1.5;
    cart.yaw = Math.PI;
    for (let push = 1; push < 30 && walkBlocked(cart.x, cart.z, cart.radius + 0.4, true); push++) cart.z += 1.5;
    placeCartMesh();
  }

  function mountCart() {
    cart.mounted = true;
    walk.x = cart.x;
    walk.z = cart.z;
    walk.yaw = cart.yaw;
    if (walkHooks.engine) walkHooks.engine(true); // she idles the moment you're up
  }

  function dismountCart() {
    cart.mounted = false;
    if (walkHooks.engine) walkHooks.engine(false);
    cart.x = walk.x;
    cart.z = walk.z;
    cart.yaw = walk.yaw;
    // step out the side: right door first, then left, then out the back
    const rx = Math.cos(walk.yaw);
    const rz = -Math.sin(walk.yaw);
    const exits = [[rx * 1.7, rz * 1.7], [-rx * 1.7, -rz * 1.7], [Math.sin(walk.yaw) * 2.4, Math.cos(walk.yaw) * 2.4]];
    for (const [ox, oz] of exits) {
      if (!walkBlocked(walk.x + ox, walk.z + oz)) {
        walk.x += ox;
        walk.z += oz;
        break;
      }
    }
    placeCartMesh();
  }

  // --- the hand hose: instant, tangible watering ---------------------------------------
  // Hold-to-spray writes moisture straight into the SAME turf array the crew's
  // scheduled irrigation uses (via a main.js hook) — one source of truth. The
  // visual answer is immediate: spray particles, a live moisture readout on the
  // prompt, and the wet-darkening term in the turf shader above.

  let walkTool = null; // null | 'hose' | 'divot' | 'rake'
  let walkSpraying = false; // "holding the use button" for whichever tool is out
  let walkSoaping = false; // right button, pressure washer only: lay foam instead of water
  let washHintClock = 0; // don't nag about soap more than once every few seconds
  let walkWaterTexClock = 0;
  let mowTexClock = 0;

  // held tool models (owner-supplied GLBs) ride the camera like the shop's wand
  scene.add(camera);
  const heldRoot = new THREE.Group();
  heldRoot.visible = false;
  camera.add(heldRoot);

  // Somebody is holding the thing. The hands are re-parented INTO whichever tool group is out, so
  // the grip poses in fpHands.GRIPS are in the tool's own frame and a new tool declares its grip
  // rather than needing its own pair of hands modelled.
  const fpHands = makeFpHands();
  // reused: the nozzle is resolved every frame the trigger is down
  const _washNozzle = new THREE.Vector3();
  const _toolContact = new THREE.Vector3();
  let toolHintClock = 0;
  // The cleaning tools build themselves from src/data/cleaningTools.js — geometry, sockets and
  // placement all come from the registry, so adding a mop is a registry entry rather than another
  // hand-wired block down here. The groundskeeping tools and the box cutter are still authored
  // below; the vacuum's registry build replaces the two-box wand that stood in for it.
  const toolViewmodels = buildToolViewmodels();
  // The asset pipeline builds authored first-person viewmodels for the cleaning kit, and nothing
  // was loading them — finished geometry that never reached the screen. Adopt them in the
  // background: the procedural tools above are already usable, so equipping never waits on I/O,
  // and each authored mesh (with its own sockets) replaces its stand-in as it lands.
  let toolViewmodelsAuthored = null;
  toolViewmodels.adoptAuthored(new GLTFLoader()).then((r) => { toolViewmodelsAuthored = r; });
  const heldGroups = {
    hose: new THREE.Group(), divot: new THREE.Group(), rake: new THREE.Group(),
    washer: new THREE.Group(), boxcutter: new THREE.Group(),
    ...toolViewmodels.groups,
  };
  // the washer's geometry is authored below, so keep the empty group rather than the registry's
  // The washer's lance is authored below rather than from the registry, so discard the
  // registry's stand-in group and name the real one — several tools now carry a socket called
  // SOCKET_nozzle, so anything looking for the washer's must be able to scope its search.
  heldGroups.washer = heldGroups.washer.name === 'Tool_washer' ? new THREE.Group() : heldGroups.washer;
  heldGroups.washer.name = 'HeldWasher';
  for (const g of Object.values(heldGroups)) {
    g.visible = false;
    heldRoot.add(g);
  }
  {
    // the pressure-washer lance: a two-handed wand with a trigger grip and a fan tip
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3aa, roughness: 0.42, metalness: 0.7 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x1e2b22, roughness: 0.85 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: 0.6 });

    const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.023, 0.86, 10), steel);
    lance.rotation.x = Math.PI / 2 - 0.16;
    lance.position.set(0, 0, -0.28);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.2), grip);
    body.position.set(0, -0.05, 0.16);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.17, 0.06), grip);
    handle.position.set(0, -0.16, 0.2);
    handle.rotation.x = -0.22;
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.02), yellow);
    trigger.position.set(0, -0.11, 0.13);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.03, 0.09, 8), yellow);
    tip.rotation.x = Math.PI / 2 - 0.16;
    tip.position.set(0, 0.075, -0.7);
    // the hose, curling away out of frame
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.2, 0.26), new THREE.Vector3(0.1, -0.42, 0.5),
      new THREE.Vector3(-0.05, -0.6, 0.85), new THREE.Vector3(-0.3, -0.75, 1.1),
    ]);
    const hoseMesh = new THREE.Mesh(
      new THREE.TubeGeometry(hoseCurve, 14, 0.022, 6, false),
      new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.9 }),
    );
    heldGroups.washer.add(lance, body, handle, trigger, tip, hoseMesh);
    // The water leaves the far FACE of the fan tip, not its centre: the tip is 9 cm long, centred
    // at (0, 0.075, -0.7), and its axis is the lance's own -0.16 rad droop. Half its length along
    // that axis is the actual orifice. The socket is parented to the tool, so it inherits the gait
    // bob, the sway and the equip ease for free — which is the whole point of it existing.
    attachSocket(heldGroups.washer, 'nozzle', [0, 0.0678, -0.7444], [-0.16, 0, 0]);
    // brought in from the frame edge once it had hands on it: a two-handed tool has to be far
    // enough into shot that you can see somebody holding it
    heldGroups.washer.position.set(0.24, -0.34, -0.60);
    heldGroups.washer.rotation.set(0.06, -0.13, 0);
  }
  {
    // The vacuum used to be two boxes on a stick built right here — a grey cylinder and a red
    // slab, with no intake to speak of. It now comes from the registry with a proper chrome wand,
    // a wide floor head with a bristle strip, a corrugated hose, and a SOCKET_nozzle at the
    // intake mouth so suction starts where the head actually is.
  }
  {
    // the box cutter: a stubby retractable utility knife. Yellow body, a short angled blade — read
    // at arm's length, it is unmistakably the thing you run down a seam of tape.
    const cutterGroup = heldGroups.boxcutter;
    const cutterVisual = new THREE.Group();
    cutterVisual.name = 'DeliveryBoxCutterVisual';
    cutterVisual.scale.setScalar(1);
    cutterGroup.add(cutterVisual);
    const fallbackRoot = new THREE.Group();
    fallbackRoot.name = 'DeliveryBoxCutterLoadingFallback';
    cutterVisual.add(fallbackRoot);
    const fallback = () => {
      if (fallbackRoot.children.length) return;
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: 0.5 });
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcdd2d6, roughness: 0.25, metalness: 0.8 });
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.14), bodyMat);
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.012, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.7 }));
      slide.position.set(0.016, 0.02, 0.01);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.03, 0.05), bladeMat);
      blade.position.set(0, 0.03, -0.085);
      blade.rotation.x = -0.5;
      fallbackRoot.add(handle, slide, blade);
      cutterGroup.userData.deliveryCutterFallback = true;
      cutterGroup.userData.deliveryCutterBlade = blade;
      cutterGroup.userData.deliveryCutterSlider = slide;
    };
    fallback();
    new GLTFLoader().load(
      'vendor/models/clubhouse/delivery_box_cutter.glb',
      (gltf) => {
        if (!adoptLoadedGltf(gltf, () => {})) return;
        fallbackRoot.traverse((object) => {
          if (object.geometry) object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) if (material) material.dispose();
        });
        fallbackRoot.clear();
        cutterGroup.userData.deliveryCutterFallback = false;
        const model = gltf.scene;
        model.name = 'DeliveryBoxCutterAuthored';
        model.traverse((object) => {
          if (object.isMesh) { object.castShadow = true; object.receiveShadow = false; }
          if (object.name.startsWith('COL_')) object.visible = false;
        });
        cutterVisual.add(model);
        const contact = model.getObjectByName('BLADE_CONTACT');
        if (contact) {
          cutterVisual.updateMatrixWorld(true);
          const contactLocal = new THREE.Vector3();
          contact.getWorldPosition(contactLocal);
          cutterVisual.worldToLocal(contactLocal);
          model.position.sub(contactLocal);
        }
        cutterGroup.userData.deliveryCutterModel = model;
        cutterGroup.userData.deliveryCutterContact = contact || null;
        cutterGroup.userData.deliveryCutterBlade = model.getObjectByName('CUTTER_BLADE') || model.getObjectByName('BLADE');
        cutterGroup.userData.deliveryCutterSlider = model.getObjectByName('CUTTER_SLIDER') || model.getObjectByName('SLIDER');
      },
      undefined,
      () => {},
    );
    cutterGroup.position.set(0.22, -0.30, -0.5);
    cutterGroup.rotation.set(0.15, -0.2, 0);
  }
  const heldFallbacks = new Map();
  const heldAssetNow = () => (globalThis.performance?.now?.() ?? Date.now());
  const fallbackMaterial = (color, options = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 0.72, ...options,
  });
  const addFallbackMesh = (root, geometry, material, position = null, rotation = null) => {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    root.add(mesh);
    return mesh;
  };
  const makeHeldFallback = (tool, asset) => {
    const key = `${tool}:${asset.id}`;
    if (heldFallbacks.has(key)) return heldFallbacks.get(key);
    const root = new THREE.Group();
    root.name = `HeldToolLoadingFallback:${asset.id}`;
    root.position.set(...asset.position);
    root.rotation.set(...asset.rotation);

    if (asset.id === 'hose_nozzle') {
      const green = fallbackMaterial(0x244b38);
      const brass = fallbackMaterial(0xb7934f, { roughness: 0.42, metalness: 0.45 });
      addFallbackMesh(root, new THREE.CylinderGeometry(0.045, 0.052, 0.28, 10), green,
        [0, 0, -0.08], [Math.PI / 2, 0, 0]);
      addFallbackMesh(root, new THREE.BoxGeometry(0.065, 0.2, 0.07), green,
        [0, -0.12, 0.03], [-0.18, 0, 0]);
      addFallbackMesh(root, new THREE.CylinderGeometry(0.025, 0.04, 0.16, 10), brass,
        [0, 0, -0.29], [Math.PI / 2, 0, 0]);
    } else if (asset.id === 'hand_fork') {
      const wood = fallbackMaterial(0x8b633d);
      const steel = fallbackMaterial(0x899397, { roughness: 0.35, metalness: 0.65 });
      addFallbackMesh(root, new THREE.CylinderGeometry(0.027, 0.032, 0.48, 8), wood,
        [0, 0, -0.18], [Math.PI / 2, 0, 0]);
      addFallbackMesh(root, new THREE.BoxGeometry(0.16, 0.035, 0.09), steel, [0, 0, -0.45]);
      for (const x of [-0.065, -0.022, 0.022, 0.065]) {
        addFallbackMesh(root, new THREE.BoxGeometry(0.015, 0.022, 0.2), steel, [x, 0, -0.58]);
      }
    } else if (asset.id === 'bucket_soil') {
      const bucket = fallbackMaterial(0x6d765f, { roughness: 0.82 });
      const soil = fallbackMaterial(0x725033, { roughness: 1 });
      const metal = fallbackMaterial(0x8c9290, { roughness: 0.5, metalness: 0.45 });
      addFallbackMesh(root, new THREE.CylinderGeometry(0.17, 0.2, 0.25, 12), bucket);
      addFallbackMesh(root, new THREE.CylinderGeometry(0.145, 0.145, 0.018, 12), soil, [0, 0.134, 0]);
      addFallbackMesh(root, new THREE.TorusGeometry(0.22, 0.012, 6, 16), metal,
        [0, 0.09, 0], [Math.PI / 2, 0, 0]);
    } else if (asset.id === 'rake') {
      const wood = fallbackMaterial(0x9a6c42);
      const green = fallbackMaterial(0x315943, { roughness: 0.8 });
      addFallbackMesh(root, new THREE.CylinderGeometry(0.022, 0.026, 1.2, 8), wood,
        [0, 0, -0.28], [Math.PI / 2, 0, 0]);
      addFallbackMesh(root, new THREE.BoxGeometry(0.62, 0.055, 0.08), green, [0, 0, -0.9]);
      for (let i = -5; i <= 5; i++) {
        addFallbackMesh(root, new THREE.BoxGeometry(0.018, 0.035, 0.18), green,
          [i * 0.052, -0.018, -1.02]);
      }
    }
    heldGroups[tool].add(root);
    heldFallbacks.set(key, root);
    return root;
  };

  const loadHeldAsset = (tool, asset) => new Promise((resolve) => {
    const startedAt = heldAssetNow();
    new GLTFLoader().load(asset.url, (gltf) => {
      const adopted = adoptLoadedGltf(gltf, (loaded) => {
        const model = loaded.scene;
        model.name = `HeldToolAuthored:${asset.id}`;
        model.scale.setScalar(asset.scale);
        model.position.set(...asset.position);
        model.rotation.set(...asset.rotation);
        heldGroups[tool].add(model);
        const key = `${tool}:${asset.id}`;
        const fallback = heldFallbacks.get(key);
        if (fallback) {
          fallback.removeFromParent();
          disposeSceneResources(fallback);
          heldFallbacks.delete(key);
        }
      });
      resolve({
        id: asset.id,
        url: asset.url,
        status: adopted ? 'ready' : 'disposed',
        latencyMs: heldAssetNow() - startedAt,
      });
    }, undefined, (error) => resolve({
      id: asset.id,
      url: asset.url,
      status: sceneDisposed ? 'disposed' : 'fallback',
      latencyMs: heldAssetNow() - startedAt,
      error: String(error?.message || error || 'load failed'),
    }));
  });

  const heldAssetRegistry = createHeldToolAssetRegistry({
    loadTool: async (tool, assets) => {
      // Construct the tiny fallback synchronously before starting I/O. The same
      // equip frame can therefore raise a complete, recognizable tool into the
      // hands while the authored GLB finishes in the background.
      for (const asset of assets) makeHeldFallback(tool, asset);
      const assetResults = await Promise.all(assets.map((asset) => loadHeldAsset(tool, asset)));
      return {
        disposed: sceneDisposed,
        readyAssets: assetResults.filter((entry) => entry.status === 'ready').length,
        failedAssets: assetResults.filter((entry) => entry.status === 'fallback').length,
        assetResults,
      };
    },
    now: heldAssetNow,
  });

  const TOOL_SPRAY = {
    hose: { color: 0xbfe2ff, size: 0.04 },
    divot: { color: 0x9a7c4e, size: 0.05 }, // soil from the repair mix
    rake: { color: 0xd8c08c, size: 0.05 },  // kicked sand
  };

  // tool FEEL: equip/stow easing + a carried bob synced to the gait, so tools
  // read as held in hands rather than glued to the camera
  const heldAnim = { t: 1, show: false, pendingHide: false };
  let bobPhase = 0;
  let walkMoving = false;
  let mountBlend = 0; // 0 = on foot (first person) … 1 = in the seat (chase cam)
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  // FOCUS MODE: the camera settles onto a fixed pose (the laptop screen, a
  // seat) and input is parked until clearFocus() eases it back to the eyes.
  let walkFocusPose = null; // { x, y, z, yaw, pitch }
  let lastFocusPose = null; // survives the ease-out
  let focusBlend = 0;

  function walkFocusOn(pose) {
    walkFocusPose = pose;
  }
  function walkClearFocus() {
    walkFocusPose = null;
  }

  function updateHeldFeel(dt) {
    // the hands breathe, rise into frame, and shove back under the trigger — or draw the box
    // cutter down the seam while you hold E on a taped carton
    fpHands.update(dt, walkSpraying || walkSoaping || holdActive);
    if (!heldRoot.visible) return;
    heldAnim.t = Math.min(1, heldAnim.t + dt / 0.26);
    const k = heldAnim.show ? easeOutCubic(heldAnim.t) : 1 - easeOutCubic(heldAnim.t);
    if (!heldAnim.show && heldAnim.t >= 1) {
      heldRoot.visible = false;
      return;
    }
    // gait-synced bob: strong under way, a slow breathe at rest
    bobPhase += dt * (walkMoving ? 8.7 : 1.6); // 8.7 = the characters' stride rate
    const sway = walkMoving ? 1 : 0.25;
    // Recoil belongs to the RIG, not to the hands: the hands are parented into the tool group so
    // their grip stays in the tool's frame, and writing the kick to them slid them along the lance
    // instead of shoving the lance back. fpHands reports the offset; the rig applies it.
    const kickBack = fpHands.rigOffset;
    heldRoot.position.set(
      Math.cos(bobPhase * 0.5) * 0.01 * sway + kickBack.jitterX,
      -0.42 * (1 - k) + Math.sin(bobPhase) * 0.014 * sway,
      kickBack.back,
    );
    heldRoot.rotation.x = 0.45 * (1 - k) + kickBack.pitch;
    heldRoot.rotation.z = Math.sin(bobPhase * 0.5) * 0.012 * sway;
  }

  const sprayCount = 90;
  const sprayPositions = new Float32Array(sprayCount * 3);
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPositions, 3));
  const sprayPoints = new THREE.Points(
    sprayGeo,
    new THREE.PointsMaterial({ color: 0xbfe2ff, size: 0.04, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  sprayPoints.visible = false;
  sprayPoints.frustumCulled = false;

  // grass clippings behind the cutting deck — the mowing loop's visible juice
  const CLIP_N = 70;
  const clipPos = new Float32Array(CLIP_N * 3);
  const clipState = [];
  for (let i = 0; i < CLIP_N; i++) clipState.push({ t: 1 + Math.random(), ox: 0, oz: 0, vx: 0, vy: 0, vz: 0 });
  const clipGeo = new THREE.BufferGeometry();
  clipGeo.setAttribute('position', new THREE.BufferAttribute(clipPos, 3));
  const clipPoints = new THREE.Points(
    clipGeo,
    new THREE.PointsMaterial({ color: 0x7fa04b, size: 0.14, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  clipPoints.visible = false;
  clipPoints.frustumCulled = false;
  scene.add(clipPoints);
  let clipActive = 0; // seconds of spray left after the last real cut

  function updateClippings(dt, deckX, deckY, deckZ, cutting) {
    if (cutting) clipActive = 0.35;
    else clipActive = Math.max(0, clipActive - dt);
    if (clipActive <= 0) {
      clipPoints.visible = false;
      return;
    }
    clipPoints.visible = true;
    for (let i = 0; i < CLIP_N; i++) {
      const c = clipState[i];
      c.t += dt * 1.8;
      if (c.t >= 1) {
        c.t = Math.random() * 0.15;
        c.ox = deckX + (Math.random() - 0.5) * 2.2;
        c.oz = deckZ + (Math.random() - 0.5) * 0.8;
        c.oy = deckY + 0.25;
        c.vx = (Math.random() - 0.5) * 2.4;
        c.vy = 2.2 + Math.random() * 1.8;
        c.vz = (Math.random() - 0.5) * 2.4;
      }
      const tt = c.t;
      clipPos[i * 3] = c.ox + c.vx * tt;
      clipPos[i * 3 + 1] = Math.max(deckY + 0.03, c.oy + c.vy * tt - 6.5 * tt * tt);
      clipPos[i * 3 + 2] = c.oz + c.vz * tt;
    }
    clipGeo.attributes.position.needsUpdate = true;
  }
  scene.add(sprayPoints);

  function updateSpray(aimWorld) {
    // a loose parabolic arc from the nozzle to the patch; the arc starts a full
    // yard out and never hugs the camera, so attenuated points stay droplets
    const hx = walk.x - Math.sin(walk.yaw) * 1.1;
    const hz = walk.z - Math.cos(walk.yaw) * 1.1;
    const hy = heightAt(walk.x, walk.z) + walk.eye - 0.55;
    for (let i = 0; i < sprayCount; i++) {
      const t = 0.12 + Math.random() * 0.88;
      const o = i * 3;
      sprayPositions[o] = hx + (aimWorld.x - hx) * t + (Math.random() - 0.5) * 0.3 * t;
      sprayPositions[o + 1] = hy + (aimWorld.y - hy) * t + Math.sin(t * Math.PI) * 0.55 + (Math.random() - 0.5) * 0.08;
      sprayPositions[o + 2] = hz + (aimWorld.z - hz) * t + (Math.random() - 0.5) * 0.3 * t;
    }
    sprayGeo.attributes.position.needsUpdate = true;
  }

  function walkSetTool(tool) {
    const previousTool = walkTool;
    if (HELD_TOOL_ASSET_MANIFEST[tool]) {
      // Equipping is the first safe actual-use boundary: ordinary boots stay
      // lean, while the authored model begins loading before this frame makes
      // its group visible. The synchronous procedural fallback prevents a
      // blank-hand flash on cold storage or a missing asset.
      heldAssetRegistry.ensure(tool, 'equip');
    }
    walkTool = tool;
    for (const [name, g] of Object.entries(heldGroups)) g.visible = name === tool;
    // The box cutter is intentionally tool-only in first person: the previous
    // procedural hand/cuff covered both the blade contact and highlighted tape
    // path from the player camera. Other tools keep the shared hand rig.
    if (tool && tool !== 'boxcutter' && heldGroups[tool] && GRIPS[tool]) {
      heldGroups[tool].add(fpHands.root);
      fpHands.setTool(tool);
    } else {
      fpHands.setTool(null);
    }
    if (tool) {
      heldRoot.visible = true;
      heldAnim.show = true;
      heldAnim.t = 0; // rise into the hands
    } else if (heldRoot.visible) {
      heldAnim.show = false;
      heldAnim.t = 0; // drop away, then hide
    }
    if (tool && TOOL_SPRAY[tool]) {
      sprayPoints.material.color.set(TOOL_SPRAY[tool].color);
      sprayPoints.material.size = TOOL_SPRAY[tool].size;
    }
    if (!tool) {
      walkSpraying = false;
      sprayPoints.visible = false;
    }
    if (tool === 'boxcutter' && previousTool !== 'boxcutter' && walkHooks.sfx) {
      walkHooks.sfx('cutterExtend');
    }
  }

  function walkSetSpraying(on) {
    walkSpraying = !!(on && walkTool && !cart.mounted);
    if (!walkSpraying) sprayPoints.visible = false;
  }

  // --- what you're looking at (shop-style focus + [E]) -------------------------------
  let walkFocus = null; // { kind, label, cell? }
  const walkHooks = {}; // main.js provides turfLabelAt / inspectAt / waterAt / hoseLabelAt

  // the patch of ground a walking player is looking at, in cell coords
  function walkAimCell(dist = 2.4) {
    const ax = walk.x - Math.sin(walk.yaw) * dist;
    const az = walk.z - Math.cos(walk.yaw) * dist;
    const cx = Math.floor((ax + worldW / 2) / CELL_YD);
    const cy = Math.floor((az + worldH / 2) / CELL_YD);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
    return { x: cx, y: cy };
  }

  function walkFindFocus() {
    if (cart.mounted) {
      const cutting = state.tractor && state.tractor.repaired;
      walkFocus = { kind: 'cart', label: cutting ? 'Tractor — the deck cuts as you drive · [E] park here' : 'Tractor — [E] park here' };
      return;
    }
    if (!cartHidden) {
      const dx = cart.x - walk.x;
      const dz = cart.z - walk.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 3.6) {
        const facing = ((dx / dist) * -Math.sin(walk.yaw)) + ((dz / dist) * -Math.cos(walk.yaw));
        if (facing > 0.35) {
          walkFocus = { kind: 'cart', label: 'Tractor — [E] take the wheel' };
          return;
        }
      }
    }
    // An articulated prop may retain the interaction it has already started.
    // Resolve this before rescoring its moving focus point so the hand-truck
    // handle cannot discard its own prompt midway through the tilt animation.
    const retainedProp = walkFocus?.kind === 'prop' ? walkFocus.prop : null;
    if (retainedProp) {
      const retainedDistance = Math.hypot(retainedProp.x - walk.x, retainedProp.z - walk.z);
      if (walkPropRetainsFocus(retainedProp, retainedDistance)) {
        const retainedLabel = retainedProp.label();
        if (retainedLabel) {
          walkFocus = { kind: 'prop', label: retainedLabel, prop: retainedProp };
          return;
        }
      }
    }
    // placed props (repair yard, tools, signs): nearest one you're facing
    let bestProp = null;
    let bestScore = 1e9;
    for (const p of walkProps) {
      // Most props keep their stable XZ interaction origin. Authored moving
      // equipment can additionally expose one live 3D focus point; resolve it
      // only inside a coarse reach gate so distant props do no matrix work.
      const coarseDx = p.x - walk.x;
      const coarseDz = p.z - walk.z;
      if (Math.hypot(coarseDx, coarseDz) > p.r + 0.75) continue;
      let focusPoint = null;
      try {
        focusPoint = typeof p.focusPoint === 'function' ? p.focusPoint() : p.focusPoint;
      } catch {
        focusPoint = null;
      }
      const focusX = Number.isFinite(focusPoint?.x) ? focusPoint.x : p.x;
      const focusZ = Number.isFinite(focusPoint?.z) ? focusPoint.z : p.z;
      const focusY = Number.isFinite(focusPoint?.y) ? focusPoint.y : p.aimY;
      const dx = focusX - walk.x;
      const dz = focusZ - walk.z;
      const dist = Math.hypot(dx, dz);
      if (dist > p.r) continue;
      let facing;
      let focusDistance = dist;
      if (Number.isFinite(focusY)) {
        // Shelf cartons can share the same x/z on different authored levels.
        // Score those props against the real first-person aim ray so looking at
        // the upper carton cannot silently select one through the board below.
        const dy = focusY - camera.position.y;
        const spatial = Math.max(0.001, Math.hypot(dx, dy, dz));
        const cp = Math.cos(walk.pitch);
        facing = (dx / spatial) * -Math.sin(walk.yaw) * cp
          + (dy / spatial) * Math.sin(walk.pitch)
          + (dz / spatial) * -Math.cos(walk.yaw) * cp;
        const focusBias = Number(typeof p.focusBias === 'function' ? p.focusBias() : p.focusBias) || 0;
        focusDistance = walkPropFocusScore3d(spatial, facing, focusBias);
      } else {
        const safeDist = Math.max(0.001, dist);
        facing = ((dx / safeDist) * -Math.sin(walk.yaw))
          + ((dz / safeDist) * -Math.cos(walk.yaw));
        const focusBias = Number(typeof p.focusBias === 'function' ? p.focusBias() : p.focusBias) || 0;
        focusDistance -= focusBias;
      }
      if (focusDistance >= bestScore) continue;
      if (facing > 0.3 && p.label()) { // a falsy label = the prop is dormant right now
        bestProp = p;
        bestScore = focusDistance;
      }
    }
    if (bestProp) {
      walkFocus = { kind: 'prop', label: bestProp.label(), prop: bestProp };
      return;
    }
    // a tool out: the prompt becomes a live readout on the patch ahead
    if (walkTool === 'vacuum') {
      if (clubhouseApi) {
        const ax = walk.x - Math.sin(walk.yaw) * 1.5;
        const az = walk.z - Math.cos(walk.yaw) * 1.5;
        const label = clubhouseApi.isInside(ax, az)
          ? clubhouseApi.vacuumLabelAt(ax, az)
          : 'Vacuum — take it inside the shop';
        if (label) {
          walkFocus = { kind: 'hose', label, cell: null };
          return;
        }
      }
    } else if (walkTool) {
      const labelHook = { hose: walkHooks.hoseLabelAt, divot: walkHooks.divotLabelAt, rake: walkHooks.rakeLabelAt }[walkTool];
      const aim = walkAimCell(3.0);
      if (aim && labelHook) {
        walkFocus = { kind: 'hose', label: labelHook(aim.x, aim.y), cell: aim };
        return;
      }
    }
    // the ground ahead: the same inspect the top-down click used to open
    const aim = walkAimCell();
    if (aim && walkHooks.turfLabelAt) {
      const label = walkHooks.turfLabelAt(aim.x, aim.y);
      if (label) {
        walkFocus = { kind: 'turf', label, cell: aim };
        return;
      }
    }
    walkFocus = null;
  }

  // TAP verbs fire here, on the KEY-DOWN — once per press. HOLD verbs do not: a held key repeats
  // the keydown ~30 times a second, and a verb that fires 30 times a second is not a hold, it is a
  // machine gun. So `isRepeat` (the browser's own auto-repeat flag) drops those, and the per-frame
  // loop below drives anything the prop exposes as `hold(dt)` off walkHeld instead.
  function walkInteract(isRepeat = false) {
    if (!walk.active) return;
    if (cart.mounted) {
      if (!isRepeat) dismountCart();
      return;
    }
    if (!walkFocus) return;
    if (walkFocus.kind === 'cart') {
      if (isRepeat) return;
      walkSetTool(null); // hands on the wheel
      mountCart();
    } else if (walkFocus.kind === 'prop') {
      // a prop that has a hold verb is driven per-frame; the tap only fires its one-shot action
      if (isRepeat) return;
      const requestedTool = walkFocus.prop.tool || null;
      if (requestedTool && walkTool !== requestedTool && (!walkTool || walkTool === autoTool)) {
        walkSetTool(requestedTool);
        autoTool = requestedTool;
        contextToolRequiresRelease = true;
        return;
      }
      if (walkFocus.prop.action) walkFocus.prop.action();
    } else if ((walkFocus.kind === 'turf' || walkFocus.kind === 'hose') && walkFocus.cell && walkHooks.inspectAt) {
      if (!isRepeat) walkHooks.inspectAt(walkFocus.cell.x, walkFocus.cell.y);
    }
  }

  // Optional second prop verb. Delivery cartons use this to keep the familiar
  // [E] cutter/unboxing lifecycle while still letting the player lift and
  // reposition a carton from an unpacking surface. A secondary verb always
  // needs free hands, so a contextual tool is stowed before it fires.
  function walkInteractSecondary(isRepeat = false) {
    if (!walk.active || isRepeat || cart.mounted) return false;
    if (!walkFocus || walkFocus.kind !== 'prop' || !walkFocus.prop.secondaryAction) return false;
    // Never let X short-circuit the contextual E release gate. In particular,
    // the placement key may still be physically down during the first frame
    // after a carton lands on a work surface.
    if (walkHeld.has('e') || contextToolRequiresRelease) return false;
    if (walkTool) walkSetTool(null);
    autoTool = null;
    walkFocus.prop.secondaryAction();
    return true;
  }

  // --- HOLD-TO-PROGRESS + CONTEXTUAL TOOL ----------------------------------------------------
  // A prop can expose `hold(dt)` (run the box cutter down the seam, feed the shelf one at a time)
  // and `tool`. The first interaction equips that contextual tool; releasing E
  // arms the subsequent deliberate hold. Looking away stows it automatically.
  let autoTool = null;
  let contextToolRequiresRelease = false;
  let holdActive = false;      // are we mid-hold this frame? (drives the hands' cutting motion)
  let cutterContactBlend = 0;
  let cutterBladeBlend = 0;
  let cutterContactCueArmed = true;
  const cutterRestLocal = new THREE.Vector3(0.22, -0.30, -0.5);
  const cutterPathStartWorld = new THREE.Vector3();
  const cutterPathEndWorld = new THREE.Vector3();
  const cutterContactWorld = new THREE.Vector3();
  const cutterAimWorld = new THREE.Vector3();
  const cutterContactLocal = new THREE.Vector3();
  const cutterPathStartScreen = new THREE.Vector3();
  const cutterPathEndScreen = new THREE.Vector3();
  const cutterGuidePositions = new Float32Array(6);
  const cutterGuideGeometry = new THREE.BufferGeometry();
  cutterGuideGeometry.setAttribute('position', new THREE.BufferAttribute(cutterGuidePositions, 3));
  const cutterGuide = new THREE.Line(
    cutterGuideGeometry,
    new THREE.LineBasicMaterial({
      color: 0xd4b45f,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  cutterGuide.name = 'BoxCutterActiveTapeGuide';
  cutterGuide.visible = false;
  cutterGuide.frustumCulled = false;
  cutterGuide.renderOrder = 18;
  scene.add(cutterGuide);
  // WebGL line width is fixed to one pixel on the supported browsers, which
  // made the authored path look like a stray vertical artifact from normal
  // player distance. One preallocated millimetre-thin ribbon now provides a
  // physical tape highlight while the line retains exact projection data for
  // the drag solver and QA probes.
  const cutterGuideRibbon = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xd4b45f,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  cutterGuideRibbon.name = 'BoxCutterActiveTapeRibbon';
  cutterGuideRibbon.visible = false;
  cutterGuideRibbon.frustumCulled = false;
  cutterGuideRibbon.renderOrder = 17;
  scene.add(cutterGuideRibbon);
  const cutterGuideDirection = new THREE.Vector3();
  const cutterGuideMidpoint = new THREE.Vector3();
  const cutterGuideUnitZ = new THREE.Vector3(0, 0, 1);

  function reconcileAutoTool() {
    const want = (walkFocus && walkFocus.kind === 'prop' && walkFocus.prop.tool) || null;
    if (autoTool && (want !== autoTool || walkTool !== autoTool)) {
      if (walkTool === autoTool) walkSetTool(null);
      autoTool = null;
      contextToolRequiresRelease = false;
    }
  }

  function runHold(dt) {
    holdActive = false;
    if (!walkFocus || walkFocus.kind !== 'prop' || !walkFocus.prop.hold) return;
    if (!walkHeld.has('e')) return;
    if (contextToolRequiresRelease) return;
    const requestedTool = walkFocus.prop.tool || null;
    if (requestedTool && walkTool !== requestedTool) return;
    walkFocus.prop.hold(dt);
    holdActive = true;
  }

  function updateBoxCutterPose(dt) {
    const cutter = heldGroups.boxcutter;
    const focusedProp = walkFocus && walkFocus.kind === 'prop' ? walkFocus.prop : null;
    const path = focusedProp && focusedProp.toolPath;
    const wantsContact = walkTool === 'boxcutter' && path ? 1 : 0;
    const wantsBlade = walkTool === 'boxcutter' ? 1 : 0;
    cutterContactBlend += (wantsContact - cutterContactBlend) * Math.min(1, dt * 10);
    cutterBladeBlend += (wantsBlade - cutterBladeBlend) * Math.min(1, dt * 12);
    // Use a hysteretic physical edge, not focus/tool polling, so one approach
    // produces one contact tick and tiny focus changes cannot chatter it.
    if (wantsContact && cutterContactBlend >= 0.82 && cutterContactCueArmed) {
      if (walkHooks.sfx) walkHooks.sfx('bladeContact');
      cutterContactCueArmed = false;
    } else if (cutterContactBlend <= 0.15) {
      cutterContactCueArmed = true;
    }

    const blade = cutter.userData.deliveryCutterBlade;
    const slider = cutter.userData.deliveryCutterSlider;
    if (blade) {
      if (!blade.userData.cutterRetracted) {
        blade.userData.cutterRetracted = blade.position.clone();
        blade.userData.cutterExtended = blade.position.clone().add(new THREE.Vector3(0, 0, -0.016));
      }
      blade.position.lerpVectors(blade.userData.cutterRetracted, blade.userData.cutterExtended, cutterBladeBlend);
    }
    if (slider) {
      if (!slider.userData.cutterRetracted) {
        slider.userData.cutterRetracted = slider.position.clone();
        slider.userData.cutterExtended = slider.position.clone().add(new THREE.Vector3(0, 0, -0.012));
      }
      slider.position.lerpVectors(slider.userData.cutterRetracted, slider.userData.cutterExtended, cutterBladeBlend);
    }

    cutterGuide.visible = !!wantsContact;
    cutterGuideRibbon.visible = !!wantsContact;
    if (!path) {
      cutter.position.lerp(cutterRestLocal, Math.min(1, dt * 12));
      cutter.rotation.x += (0.15 - cutter.rotation.x) * Math.min(1, dt * 12);
      cutter.rotation.y += (-0.2 - cutter.rotation.y) * Math.min(1, dt * 12);
      cutter.rotation.z += (0 - cutter.rotation.z) * Math.min(1, dt * 12);
      return;
    }

    const progress = Math.max(0, Math.min(1,
      path.progress == null ? (Number(focusedProp.toolProgress) || 0) : Number(path.progress),
    ));
    cutterPathStartWorld.set(path.start.x, path.start.y, path.start.z);
    cutterPathEndWorld.set(path.end.x, path.end.y, path.end.z);
    cutterGuidePositions[0] = cutterPathStartWorld.x;
    cutterGuidePositions[1] = cutterPathStartWorld.y + 0.004;
    cutterGuidePositions[2] = cutterPathStartWorld.z;
    cutterGuidePositions[3] = cutterPathEndWorld.x;
    cutterGuidePositions[4] = cutterPathEndWorld.y + 0.004;
    cutterGuidePositions[5] = cutterPathEndWorld.z;
    cutterGuideGeometry.attributes.position.needsUpdate = true;
    cutterGuideDirection.subVectors(cutterPathEndWorld, cutterPathStartWorld);
    const cutterGuideLength = cutterGuideDirection.length();
    cutterGuideMidpoint.lerpVectors(cutterPathStartWorld, cutterPathEndWorld, 0.5);
    cutterGuideMidpoint.y += 0.0055;
    cutterGuideRibbon.position.copy(cutterGuideMidpoint);
    cutterGuideRibbon.scale.set(0.012, 0.0025, Math.max(0.001, cutterGuideLength));
    if (cutterGuideLength > 1e-6) {
      cutterGuideRibbon.quaternion.setFromUnitVectors(
        cutterGuideUnitZ,
        cutterGuideDirection.multiplyScalar(1 / cutterGuideLength),
      );
    }
    cutterContactWorld.lerpVectors(cutterPathStartWorld, cutterPathEndWorld, progress);
    heldRoot.updateMatrixWorld(true);
    cutterContactLocal.copy(cutterContactWorld);
    heldRoot.worldToLocal(cutterContactLocal);
    cutter.position.lerp(cutterContactLocal, cutterContactBlend);
    if (cutterContactBlend > 0.05) {
      cutterAimWorld.subVectors(cutterPathEndWorld, cutterPathStartWorld).normalize().add(cutterContactWorld);
      cutter.lookAt(cutterAimWorld);
      // The authored cutter's broad face is X-by-Z. A quarter-turn here put
      // that face edge-on to the downward player camera and let the hand hide
      // the entire handle; retain only a slight natural wrist roll instead.
      cutter.rotateZ(0.10);
      cutter.rotateY(0.42); // expose the handle side while the blade-contact origin stays pinned
    }
  }

  function walkKeyDown(e) {
    walkHeld.add(e.key.toLowerCase());
  }
  function walkKeyUp(e) {
    walkHeld.delete(e.key.toLowerCase());
    if (e.key.toLowerCase() === 'e') contextToolRequiresRelease = false;
  }
  function walkBlur() {
    walkHeld.clear();
    contextToolRequiresRelease = false;
  }
  // Ignore the first mouse events after (re)acquiring pointer lock. Browsers can
  // deliver a large accumulated movementX/Y in that first event — the classic
  // cause of a sudden 180 spin after an alt-tab, a click-back, or a re-lock.
  let walkLockGuard = 0;
  function walkLockChange() {
    if (document.pointerLockElement === canvas) walkLockGuard = 2;
  }

  function dragBoxCutterAlongFocusedPath(movementX, movementY) {
    if (!walkSpraying || walkTool !== 'boxcutter') return false;
    const prop = walkFocus && walkFocus.kind === 'prop' ? walkFocus.prop : null;
    const path = prop && prop.toolPath;
    if (!path || typeof prop.drag !== 'function') return true;

    camera.updateMatrixWorld(true);
    cutterPathStartScreen.set(path.start.x, path.start.y, path.start.z).project(camera);
    cutterPathEndScreen.set(path.end.x, path.end.y, path.end.z).project(camera);
    if (![cutterPathStartScreen.x, cutterPathStartScreen.y, cutterPathStartScreen.z,
      cutterPathEndScreen.x, cutterPathEndScreen.y, cutterPathEndScreen.z]
      .every(Number.isFinite)) return true;
    if (cutterPathStartScreen.z < -1 || cutterPathStartScreen.z > 1
      || cutterPathEndScreen.z < -1 || cutterPathEndScreen.z > 1) return true;

    const width = canvas.clientWidth || canvas.width || window.innerWidth || 1;
    const height = canvas.clientHeight || canvas.height || window.innerHeight || 1;
    const startX = (cutterPathStartScreen.x * 0.5 + 0.5) * width;
    const startY = (0.5 - cutterPathStartScreen.y * 0.5) * height;
    const endX = (cutterPathEndScreen.x * 0.5 + 0.5) * width;
    const endY = (0.5 - cutterPathEndScreen.y * 0.5) * height;
    const segmentFraction = projectedToolDragDelta(
      startX,
      startY,
      endX,
      endY,
      movementX,
      movementY,
    );
    if (!(segmentFraction > 0)) return true;

    const span = Math.max(0.001, Math.min(1, Number(path.span) || 1));
    const progress = Math.max(0, Math.min(1, Number(path.progress) || 0));
    const remaining = (1 - progress) * span;
    // A single browser event cannot skip a whole cut segment. This rejects
    // pointer-lock spikes while still allowing one natural pass over the seam.
    prop.drag(Math.min(remaining, span * segmentFraction, 0.12));
    return true;
  }

  function walkMouseMove(e) {
    if (document.pointerLockElement !== canvas) return;
    if (walkLockGuard > 0) { walkLockGuard -= 1; return; }
    if (dragBoxCutterAlongFocusedPath(e.movementX, e.movementY)) return;
    const sens = walk.sens || 1; // pause-menu mouse sensitivity
    // applyMouseLook clamps the per-event delta (no 180 whip on a reacquisition
    // jump), applies sensitivity, wraps yaw and clamps pitch — see mouseLook.js.
    const next = applyMouseLook(walk.yaw, walk.pitch, e.movementX, e.movementY, sens);
    walk.yaw = next.yaw;
    walk.pitch = next.pitch;
  }

  // where you land when stepping out the clubhouse door: just past the porch
  function walkDefaultSpawn() {
    const s = course.structures[0];
    if (!s) return { x: 0, z: 0, yaw: Math.PI };
    const wx = (s.x + s.w / 2) * CELL_YD - worldW / 2;
    const wz = (s.y + s.h / 2) * CELL_YD - worldH / 2;
    return { x: wx, z: wz + 8.2 + 5.5, yaw: Math.PI }; // beyond the body + porch, facing the course
  }

  function walkEnter(spawn) {
    if (walk.active) return;
    activeCourseCamera = null;
    walk.active = true;
    if (spawn !== 'resume') {
      if (cart.mounted) dismountCart(); // the cart stays where it was driven, not where you respawn
      const p = spawn || walkDefaultSpawn();
      walk.x = p.x;
      walk.z = p.z;
      walk.yaw = p.yaw ?? Math.PI;
      walk.pitch = 0;
    }
    refreshWalkColliders();
    if (walkBlocked(walk.x, walk.z)) {
      // never spawn inside a tree that grew since the spot was chosen
      for (let push = 1; push < 30 && walkBlocked(walk.x, walk.z); push++) walk.z += 1.5;
    }
    camera.fov = 66; // the shop's human FOV; the management rig uses 46
    camera.near = 0.15;
    camera.updateProjectionMatrix();
    heldRoot.visible = !!walkTool; // pick your tool back up
    window.addEventListener('keydown', walkKeyDown);
    window.addEventListener('keyup', walkKeyUp);
    window.addEventListener('blur', walkBlur);
    document.addEventListener('mousemove', walkMouseMove);
    document.addEventListener('pointerlockchange', walkLockChange);
    walkLockGuard = 2; // guard the initial lock too
  }

  function walkExit() {
    if (!walk.active) return;
    walk.active = false;
    walkSetSpraying(false);
    heldRoot.visible = false; // the overview camera carries no hand tools
    walkHeld.clear();
    window.removeEventListener('keydown', walkKeyDown);
    window.removeEventListener('keyup', walkKeyUp);
    window.removeEventListener('blur', walkBlur);
    document.removeEventListener('mousemove', walkMouseMove);
    document.removeEventListener('pointerlockchange', walkLockChange);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    camera.fov = 46; // hand the camera back to the management rig
    camera.near = 1;
    camera.updateProjectionMatrix();
    rig.apply();
  }

  function walkUpdate(dtMs) {
    if (!walk.active) return;
    const dt = dtMs / 1000;
    const px0 = walk.x; // where this frame started, so recovery can tell moving from pinned
    const pz0 = walk.z;

    // focus mode (laptop): ease the camera onto the pose, park all input
    focusBlend = clamp(focusBlend + (walkFocusPose ? 1 : -1) * (dt / 0.4), 0, 1);
    if (walkFocusPose || focusBlend > 0.001) {
      const fb = focusBlend * focusBlend * (3 - 2 * focusBlend);
      const gy = (clubhouseApi && clubhouseApi.groundYAt(walk.x, walk.z)) ?? walkSurfaceHeightAt(walk.x, walk.z);
      const p = lastFocusPose || walkFocusPose;
      if (walkFocusPose) lastFocusPose = walkFocusPose;
      if (p) {
        camera.position.set(
          walk.x + (p.x - walk.x) * fb,
          gy + walk.eye + (p.y - gy - walk.eye) * fb,
          walk.z + (p.z - walk.z) * fb,
        );
        let dy = p.yaw - walk.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        setFirstPersonOrientation(
          camera,
          walk.yaw + dy * fb,
          walk.pitch + (p.pitch - walk.pitch) * fb,
        );
      }
      if (walkFocusPose) {
        walkFocus = null; // no prompts while seated at the screen
        updateHeldFeel(dt);
        return;
      }
    } else {
      lastFocusPose = null;
    }

    // fallback look controls (also QA/accessibility — same as the shop)
    if (walkHeld.has('arrowleft')) walk.yaw += 1.9 * dt;
    if (walkHeld.has('arrowright')) walk.yaw -= 1.9 * dt;
    if (walkHeld.has('arrowup')) walk.pitch = clamp(walk.pitch + 1.3 * dt, -1.35, 1.35);
    if (walkHeld.has('arrowdown')) walk.pitch = clamp(walk.pitch - 1.3 * dt, -1.35, 1.35);

    if (cart.mounted) {
      walkMoving = false; // hands on the wheel
      // cart handling: W/S throttle along the heading, A/D steer — no strafing
      const throttle = (walkHeld.has('w') ? 1 : 0) - (walkHeld.has('s') ? 1 : 0);
      const steer = (walkHeld.has('a') ? 1 : 0) - (walkHeld.has('d') ? 1 : 0);
      if (steer) {
        // full authority under way, gentle pivot when stopped; reversed in reverse
        const authority = throttle > 0 ? 1 : throttle < 0 ? -0.7 : 0.35;
        walk.yaw += steer * cart.turnRate * authority * dt;
      }
      if (throttle > 0) {
        walkTryMove(-Math.sin(walk.yaw) * cart.speed * dt, -Math.cos(walk.yaw) * cart.speed * dt, cart.radius);
      } else if (throttle < 0) {
        walkTryMove(Math.sin(walk.yaw) * cart.reverse * dt, Math.cos(walk.yaw) * cart.reverse * dt, cart.radius);
      }
      cart.x = walk.x;
      cart.z = walk.z;
      cart.yaw = walk.yaw;
      placeCartMesh();

      // the hitched deck CUTS: cells under it (2.5 yd behind the seat, the
      // deck's width) mow to the zone's ideal height through the same hook
      // family the hose uses — real sim writes, stripes as the payoff
      if (throttle && walkHooks.mowAt && state.tractor && state.tractor.repaired) {
        const dxT = walk.x + Math.sin(walk.yaw) * 2.5;
        const dzT = walk.z + Math.cos(walk.yaw) * 2.5;
        const rx = Math.cos(walk.yaw);
        const rz = -Math.sin(walk.yaw);
        let cut = false;
        for (const off of [-1.1, 0, 1.1]) {
          const mx = dxT + rx * off;
          const mz = dzT + rz * off;
          const cx = Math.floor((mx + worldW / 2) / CELL_YD);
          const cy = Math.floor((mz + worldH / 2) / CELL_YD);
          if (cx >= 0 && cy >= 0 && cx < W && cy < H && walkHooks.mowAt(cx, cy)) cut = true;
        }
        if (cut) {
          mowTexClock += dt;
          if (mowTexClock >= 0.25) {
            mowTexClock = 0;
            updateTurf(state);
          }
        } else {
          mowTexClock = 0.25; // next cut repaints immediately
        }
        updateClippings(dt, dxT, heightAt(dxT, dzT), dzT, cut);
        if (mowerMesh) mowerMesh.position.y = 0.02 + (cut ? Math.sin(time * 42) * 0.02 : 0);
      } else {
        updateClippings(dt, walk.x, heightAt(walk.x, walk.z), walk.z, false);
      }
    } else {
      updateClippings(dt, walk.x, 0, walk.z, false); // clippings settle after you hop off
      const run = walkHeld.has('shift') ? walk.runMult : 1;
      // a full armful or a heavy carton slows you down — sim/stocking says by how much
      const load = clubhouseApi && clubhouseApi.carrySpeedFactor ? clubhouseApi.carrySpeedFactor() : 1;
      const carryRadius = clubhouseApi && clubhouseApi.carryCollisionRadius
        ? Math.max(walk.radius, clubhouseApi.carryCollisionRadius())
        : walk.radius;
      let mx = 0;
      let mz = 0;
      if (walkHeld.has('w')) mz -= 1;
      if (walkHeld.has('s')) mz += 1;
      if (walkHeld.has('a')) mx -= 1;
      if (walkHeld.has('d')) mx += 1;
      walkMoving = !!(mx || mz);
      if (mx || mz) {
        const len = Math.hypot(mx, mz);
        const s = (walk.speed * run * load * dt) / len;
        const sin = Math.sin(walk.yaw);
        const cos = Math.cos(walk.yaw);
        walkTryMove((mx * cos + mz * sin) * s, (-mx * sin + mz * cos) * s, carryRadius);
      }
    }

    walkRecover(dtMs, px0, pz0);

    // camera: first-person on foot, third-person chase in the seat — EASED
    // between the two so mounting reads as a real transition, not a cut
    mountBlend = clamp(mountBlend + (cart.mounted ? 1 : -1) * (dt / 0.45), 0, 1);
    const mb = mountBlend * mountBlend * (3 - 2 * mountBlend);
    // inside the clubhouse (or on its porch) you stand on the level floor slab
    const floorY = clubhouseApi ? clubhouseApi.groundYAt(walk.x, walk.z) : null;
    const groundY = floorY !== null && floorY !== undefined ? floorY : walkSurfaceHeightAt(walk.x, walk.z);
    if (mb <= 0.001) {
      camera.position.set(walk.x, groundY + walk.eye, walk.z);
      setFirstPersonOrientation(camera, walk.yaw, walk.pitch);
    } else {
      const cosP = Math.cos(walk.pitch);
      const fpx = walk.x;
      const fpy = groundY + (cart.mounted ? cart.eye : walk.eye);
      const fpz = walk.z;
      const fLookX = fpx - Math.sin(walk.yaw) * 6 * cosP;
      const fLookY = fpy + Math.sin(walk.pitch) * 6;
      const fLookZ = fpz - Math.cos(walk.yaw) * 6 * cosP;
      const back = 8.5;
      const up = 4.0;
      const cx = walk.x + Math.sin(walk.yaw) * back;
      const cz = walk.z + Math.cos(walk.yaw) * back;
      const cy = Math.max(walkSurfaceHeightAt(cx, cz) + 1.4, groundY + up);
      camera.position.set(
        fpx + (cx - fpx) * mb,
        fpy + (cy - fpy) * mb,
        fpz + (cz - fpz) * mb,
      );
      camera.lookAt(
        fLookX + (walk.x - fLookX) * mb,
        fLookY + (groundY + 1.7 - fLookY) * mb,
        fLookZ + (walk.z - fLookZ) * mb,
      );
    }
    walkFindFocus();
    reconcileAutoTool();   // the box cutter appears when you look at a taped box, and only then
    runHold(dt);           // holding E runs whatever the focused prop exposes as a hold verb
    updateHeldFeel(dt);
    updateBoxCutterPose(dt);

    // the pressure washer works against the BUILDING, not the turf: raycast where the player is
    // actually pointing, erode the grime mask at that exact spot, and put the stream on screen
    // between the nozzle and the contact point. Right button lays soap instead of water.
    if (walkTool === 'washer' && !cart.mounted && clubhouseApi && clubhouseApi.washAim) {
      const on = walkSpraying || walkSoaping;
      let hit = null;
      if (on) {
        const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
        hit = clubhouseApi.washAim(camera.position, dir);
        if (hit) {
          const w = ownedWasher(state);
          const mode = walkSoaping ? 'soap' : 'wash';
          const res = clubhouseApi.washApply(hit, mode, w.radius, w.power, dt, time);
          if (res.blocked && !walkSoaping) washHintClock -= dt;
          if (washHintClock <= 0 && res.blocked) {
            washHintClock = 4;
            if (walkHooks.toast) walkHooks.toast('The water is running straight off it — this needs soap first (hold the right button).', 'warn');
          }
          // The stream starts at the lance tip. This used to be a camera-local constant that
          // approximated the tip while the player stood still — it ignored heldRoot, so during the
          // equip ease the water appeared up to 42 cm below the nozzle it was supposedly leaving.
          // Reading the socket makes it right by construction instead of right by tuning.
          const nozzle = socketWorld(heldGroups.washer, 'nozzle', _washNozzle);
          clubhouseApi.washJet(nozzle, hit.point, true, dt);
        }
      }
      if (!hit) clubhouseApi.washJet(null, null, false, dt);
      clubhouseApi.washTick(dt);
    } else if (clubhouseApi && clubhouseApi.washJet) {
      clubhouseApi.washJet(null, null, false, dt);
    }

    // hold-to-use: each tool writes through its hook, with the same live
    // texture + particle feedback loop the hose established
    if (toolHintClock > 0) toolHintClock -= dt;

    // FLOOR TOOLS HOLD A FIXED ANGLE TO THE WORLD, NOT TO THE CAMERA.
    //
    // A mop, broom, dustpan and vacuum head are parented to the camera, so left alone they pitch
    // with it and the head swings into the air the moment you look up. The first fix cancelled the
    // camera pitch, which was worse in a subtler way: it held the tool LEVEL, so a head 1.8 yd
    // ahead sat at eye height instead of on the boards.
    //
    // What a held broom actually does is keep a constant downward angle — hands at the waist, head
    // on the floor a stride and a half ahead — regardless of where the player is looking. So the
    // tool declares its world pitch and we solve the local rotation that preserves it. Look at the
    // horizon and the head correctly swings below the frame; look down to work and it is there.
    for (const id of FLOOR_ANCHORED_TOOLS) {
      const g = heldGroups[id];
      if (!g || !g.visible) continue;
      g.rotation.x = CLEANING_TOOLS[id].worldPitch - walk.pitch;
    }
    if (walkSpraying && CLEANING_TOOLS[walkTool] && !CLEANING_TOOLS[walkTool].external
      && !cart.mounted && clubhouseApi && clubhouseApi.cleanWithTool) {
      // Every cleaning tool works at the point ON THE TOOL — the contact pad under a mop head, the
      // intake mouth of the vacuum, the orifice of the spray bottle — resolved from the socket the
      // registry authored. The old vacuum projected a point 1.5 yd in front of the player's feet
      // and cleaned in a circle around it, which is why it scrubbed through counters and walls.
      const def = CLEANING_TOOLS[walkTool];
      const group = heldGroups[walkTool];
      const socketName = def.sockets.contact ? 'contact' : 'nozzle';
      if (group && group.visible) {
        socketWorld(group, socketName, _toolContact);
        // the sweep direction is the way the player is facing, flattened onto the floor
        const dirX = -Math.sin(walk.yaw);
        const dirZ = -Math.cos(walk.yaw);
        if (clubhouseApi.isInside(_toolContact.x, _toolContact.z)) {
          const res = clubhouseApi.cleanWithTool(
            walkTool, _toolContact.x, _toolContact.z, dirX, dirZ, dt,
          );
          if (res.blocked && toolHintClock <= 0) {
            toolHintClock = 4;
            if (walkHooks.toast) {
              walkHooks.toast('Nothing to wipe up yet — spray the surface first.', 'warn');
            }
          }
        }
      }
    } else if (walkSpraying && walkTool && walkTool !== 'washer' && walkTool !== 'boxcutter' && !cart.mounted) {
      const useHook = { hose: walkHooks.waterAt, divot: walkHooks.repairAt, rake: walkHooks.rakeAt }[walkTool];
      const aim = walkAimCell(3.0);
      if (aim && useHook) {
        useHook(aim.x, aim.y, dt);
        const wx = (aim.x + 0.5) * CELL_YD - worldW / 2;
        const wz = (aim.y + 0.5) * CELL_YD - worldH / 2;
        sprayPoints.visible = true;
        updateSpray({ x: wx, y: heightAt(wx, wz) + 0.1, z: wz });
        walkWaterTexClock += dt;
        if (walkWaterTexClock >= 0.2) {
          walkWaterTexClock = 0;
          updateTurf(state); // moisture darkens / wear tint clears as you work
        }
      } else {
        sprayPoints.visible = false;
      }
    }
  }

  // --- brush ring / marker cursor -----------------------------------------------------------------
  const brushRing = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }),
  );
  brushRing.rotation.x = -Math.PI / 2;
  brushRing.name = 'editor-brush-ring';
  brushRing.renderOrder = 999;
  brushRing.visible = false;
  scene.add(brushRing);

  // The outer ring is the full brush footprint; this quieter inner ring marks
  // the flat-strength core before the configured falloff begins.
  const brushFalloffRing = new THREE.Mesh(
    new THREE.RingGeometry(0.965, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.48, depthTest: false, side: THREE.DoubleSide }),
  );
  brushFalloffRing.rotation.x = -Math.PI / 2;
  brushFalloffRing.name = 'editor-brush-falloff-ring';
  brushFalloffRing.renderOrder = 998;
  brushFalloffRing.visible = false;
  scene.add(brushFalloffRing);

  function setBrush(cell, radiusCells, kind) {
    if (!cell || !kind) {
      brushRing.visible = false;
      brushFalloffRing.visible = false;
      return;
    }
    const x = worldX(cell.x);
    const z = worldZ(cell.y);
    brushRing.visible = true;
    brushRing.position.set(x, heightAt(x, z) + 0.25, z);
    const r = Math.max(0.6, (radiusCells + 0.5)) * CELL_YD;
    brushRing.scale.setScalar(kind === 'marker' ? 3.5 : r);
    brushRing.material.color.set(kind === 'marker' ? 0xffe9a0 : 0xffffff);
    brushFalloffRing.visible = false;
  }

  // world-space editor brush: fractional position, yard radius, mood color
  function setEditorBrush(opts) {
    if (!opts) {
      brushRing.visible = false;
      brushFalloffRing.visible = false;
      return;
    }
    brushRing.visible = true;
    brushRing.position.set(opts.x, heightAt(opts.x, opts.z) + 0.25, opts.z);
    const radiusYd = Math.max(1.2, opts.radiusYd || 8);
    brushRing.scale.setScalar(radiusYd);
    brushRing.material.color.set(opts.color || 0xffffff);
    const falloff = Number(opts.falloff);
    const coreRadiusYd = Number.isFinite(falloff)
      ? radiusYd * (1 - clamp(falloff, 0, 1))
      : 0;
    brushFalloffRing.visible = coreRadiusYd >= 1.2;
    if (brushFalloffRing.visible) {
      brushFalloffRing.position.copy(brushRing.position);
      brushFalloffRing.position.y += 0.01;
      brushFalloffRing.scale.setScalar(coreRadiusYd);
      brushFalloffRing.material.color.copy(brushRing.material.color);
    }
  }

  // --- faithful shaped feature preview -------------------------------------------
  // The UI supplies pure world-X/Z geometry. Buffers and materials are retained
  // across pointer moves so a long editor session does not churn GPU resources.
  const PREVIEW_FILL_VERTS = 192;
  const PREVIEW_LINE_VERTS = 512;
  const editorFeaturePreview = new THREE.Group();
  editorFeaturePreview.name = 'editor-feature-preview';
  editorFeaturePreview.visible = false;
  scene.add(editorFeaturePreview);

  function dynamicPreviewGeometry(vertexCapacity) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array(vertexCapacity * 3), 3,
    ).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    return geometry;
  }

  const featureFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x7fd66b, transparent: true, opacity: 0.16, depthTest: false,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const featureLineMaterial = new THREE.LineBasicMaterial({
    color: 0x7fd66b, transparent: true, opacity: 0.96, depthTest: false,
    depthWrite: false,
  });
  const featureGuideMaterial = new THREE.LineBasicMaterial({
    color: 0x7fd66b, transparent: true, opacity: 0.72, depthTest: false,
    depthWrite: false,
  });
  const featureFill = new THREE.Mesh(dynamicPreviewGeometry(PREVIEW_FILL_VERTS), featureFillMaterial);
  const featureOutline = new THREE.Line(dynamicPreviewGeometry(PREVIEW_LINE_VERTS), featureLineMaterial);
  const featureGuide = new THREE.LineSegments(dynamicPreviewGeometry(PREVIEW_LINE_VERTS), featureGuideMaterial);
  featureFill.name = 'editor-feature-preview-fill';
  featureOutline.name = 'editor-feature-preview-outline';
  featureGuide.name = 'editor-feature-preview-guide';
  featureFill.renderOrder = 997;
  featureOutline.renderOrder = 999;
  featureGuide.renderOrder = 999;
  featureFill.frustumCulled = false;
  featureOutline.frustumCulled = false;
  featureGuide.frustumCulled = false;
  editorFeaturePreview.add(featureFill, featureOutline, featureGuide);

  function writePreviewVertex(attribute, index, x, z, lift) {
    if (index >= attribute.count) return index;
    attribute.setXYZ(index, x, heightAt(x, z) + lift, z);
    return index + 1;
  }

  function writePreviewPolyline(geometry, polylines, { closed = false, lift = 0.31 } = {}) {
    const attribute = geometry.getAttribute('position');
    let count = 0;
    for (const points of polylines) {
      if (!Array.isArray(points) || points.length < 2) continue;
      const edgeCount = closed ? points.length : points.length - 1;
      for (let i = 0; i < edgeCount && count < attribute.count; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3));
        for (let k = 0; k < steps && count < attribute.count; k++) {
          const t = k / steps;
          count = writePreviewVertex(
            attribute, count,
            a.x + (b.x - a.x) * t,
            a.z + (b.z - a.z) * t,
            lift,
          );
        }
      }
      const end = closed ? points[0] : points[points.length - 1];
      count = writePreviewVertex(attribute, count, end.x, end.z, lift);
    }
    attribute.needsUpdate = true;
    geometry.setDrawRange(0, count);
    return count;
  }

  function writePreviewSegments(geometry, polylines, { lift = 0.34 } = {}) {
    const attribute = geometry.getAttribute('position');
    let count = 0;
    for (const points of polylines) {
      if (!Array.isArray(points) || points.length < 2) continue;
      for (let index = 0; index + 1 < points.length && count + 1 < attribute.count; index += 1) {
        const a = points[index];
        const b = points[index + 1];
        count = writePreviewVertex(attribute, count, a.x, a.z, lift);
        count = writePreviewVertex(attribute, count, b.x, b.z, lift);
      }
    }
    attribute.needsUpdate = true;
    geometry.setDrawRange(0, count);
    return count;
  }

  function setEditorFeaturePreview(preview) {
    const points = preview?.outline?.points;
    const closed = preview?.outline?.closed !== false;
    if (!Array.isArray(points) || points.length < (closed ? 3 : 2)) {
      editorFeaturePreview.visible = false;
      featureFill.geometry.setDrawRange(0, 0);
      featureOutline.geometry.setDrawRange(0, 0);
      featureGuide.geometry.setDrawRange(0, 0);
      return;
    }
    const color = preview.validity?.color ?? 0x7fd66b;
    featureFillMaterial.color.set(color);
    featureLineMaterial.color.set(color);
    featureGuideMaterial.color.set(color);

    const fillPosition = featureFill.geometry.getAttribute('position');
    let fillCount = 0;
    if (closed) {
      const contour = points.map((p) => new THREE.Vector2(p.x, p.z));
      const faces = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const face of faces) {
        for (const pointIndex of face) {
          if (fillCount >= fillPosition.count) break;
          const p = points[pointIndex];
          fillCount = writePreviewVertex(fillPosition, fillCount, p.x, p.z, 0.22);
        }
      }
    }
    fillPosition.needsUpdate = true;
    featureFill.geometry.setDrawRange(0, fillCount);
    writePreviewPolyline(featureOutline.geometry, [points], { closed, lift: 0.31 });
    const guides = (preview.guides || []).map((guide) => guide?.points).filter(Boolean);
    writePreviewSegments(featureGuide.geometry, guides, { lift: 0.34 });
    editorFeaturePreview.visible = true;
  }

  // --- placement ghost: the object you are about to place, green/red ----------------
  let ghost = null;
  let ghostType = null;
  function setPlacementGhost(type, x, z, {
    rot = 0, scale = 1, valid = true, collisionRadiusYd = null,
  } = {}) {
    if (!type) {
      if (ghost) ghost.visible = false;
      ghostType = null;
      return;
    }
    if (ghostType !== type) {
      if (ghost) scene.remove(ghost);
      ghost = new THREE.Group();
      const { parts } = ghostPartsFor(type);
      for (const p of parts) {
        const mesh = new THREE.Mesh(p.geometry, p.material.clone());
        mesh.material.transparent = true;
        mesh.material.opacity = 0.62;
        ghost.add(mesh);
      }
      const disc = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1, 32),
        new THREE.MeshBasicMaterial({ color: 0x7fd66b, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.15;
      disc.renderOrder = 998;
      disc.userData.isDisc = true;
      ghost.add(disc);
      scene.add(ghost);
      ghostType = type;
    }
    ghost.visible = true;
    ghost.position.set(x, heightAt(x, z), z);
    ghost.rotation.y = rot;
    const tint = valid ? 0x7fd66b : 0xd84b3a;
    ghost.traverse((o) => {
      if (o.userData.isDisc) {
        o.material.color.set(tint);
        const footprint = Number.isFinite(collisionRadiusYd) && collisionRadiusYd > 0
          ? collisionRadiusYd
          : 2.2 * scale;
        o.scale.setScalar(footprint);
      } else if (o.isMesh) {
        o.material.emissive = new THREE.Color(valid ? 0x1a3a12 : 0x511710);
        o.scale.setScalar(type.startsWith('tree_') ? 7.3 * scale : scale);
      }
    });
  }

  function ghostPartsFor(type) {
    if (type.startsWith('tree_')) {
      // a light stand-in silhouette (trunk + crown) — the real instanced model
      // appears the moment it is placed
      const trunk = new THREE.CylinderGeometry(0.02, 0.03, 0.35, 6);
      trunk.translate(0, 0.17, 0);
      const crown = new THREE.IcosahedronGeometry(/pine/i.test(type) ? 0.22 : 0.3, 1);
      if (/pine/i.test(type)) crown.scale(1, 1.8, 1);
      crown.translate(0, /pine/i.test(type) ? 0.6 : 0.62, 0);
      return {
        parts: [
          { geometry: trunk, material: new THREE.MeshStandardMaterial({ color: 0x5a4630 }) },
          { geometry: crown, material: new THREE.MeshStandardMaterial({ color: 0x3f7a34 }) },
        ],
      };
    }
    return proceduralObjectParts(type);
  }

  // --- measure tool line -----------------------------------------------------------
  let measureGroup = null;
  function setMeasureLine(worldPts, label) {
    if (measureGroup) {
      scene.remove(measureGroup);
      measureGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.map && o.material.map.isCanvasTexture) o.material.map.dispose();
      });
      measureGroup = null;
    }
    if (!worldPts || worldPts.length < 1) return;
    measureGroup = new THREE.Group();
    const lift = (p) => new THREE.Vector3(p.x, heightAt(p.x, p.z) + 0.5, p.z);
    if (worldPts.length >= 2) {
      const pts = [];
      for (let i = 0; i < worldPts.length - 1; i++) {
        const a = lift(worldPts[i]);
        const b = lift(worldPts[i + 1]);
        for (let k = 0; k <= 18; k++) {
          const t = k / 18;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          pts.push(new THREE.Vector3(x, heightAt(x, z) + 0.5, z));
        }
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      measureGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff2c8, depthTest: false, transparent: true })));
    }
    for (const p of worldPts) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xfff2c8, depthTest: false }),
      );
      dot.renderOrder = 999;
      dot.position.copy(lift(p));
      measureGroup.add(dot);
    }
    if (label && worldPts.length >= 2) {
      const mid = lift(worldPts[Math.floor(worldPts.length / 2)]);
      const sp = textSprite(label, { w: 384, fontPx: 72, scaleW: 16 });
      sp.position.set(mid.x, mid.y + 4, mid.z);
      measureGroup.add(sp);
    }
    scene.add(measureGroup);
  }

  // --- the playtest ball + aim arc ----------------------------------------------------
  const ballMesh = new THREE.Mesh(
    // Near-regulation scale with a small readability allowance; the previous
    // five-inch silhouette read as a debug sphere at tee height.
    new THREE.SphereGeometry(0.035, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xf6f4ea, roughness: 0.35 }),
  );
  ballMesh.castShadow = true;
  ballMesh.visible = false;
  scene.add(ballMesh);
  const aimArcPositions = new Float32Array(33 * 3);
  const aimArcDistances = new Float32Array(33);
  const aimArcGeo = new THREE.BufferGeometry();
  aimArcGeo.setAttribute('position', new THREE.BufferAttribute(aimArcPositions, 3).setUsage(THREE.DynamicDrawUsage));
  aimArcGeo.setAttribute('lineDistance', new THREE.BufferAttribute(aimArcDistances, 1).setUsage(THREE.DynamicDrawUsage));
  aimArcGeo.setDrawRange(0, 0);
  const aimArc = new THREE.Line(
    aimArcGeo,
    new THREE.LineDashedMaterial({
      color: 0xfff2c8,
      dashSize: 0.7,
      gapSize: 0.55,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  // This line is rewritten into each selected hole's world-space location.
  // A cached bounding sphere from an earlier hole can otherwise cull the guide
  // after switching holes (most visibly on H2/H6). Keep this tiny 25-point
  // editor aid outside frustum culling and above other transparent accents.
  aimArc.frustumCulled = false;
  aimArc.renderOrder = 900;
  aimArc.visible = false;
  scene.add(aimArc);
  function setBallVisual(pos) {
    if (!pos) {
      ballMesh.visible = false;
      return;
    }
    ballMesh.visible = true;
    ballMesh.position.set(pos.x, pos.y + 0.035, pos.z);
  }
  function setAimArc(pts) {
    if (!pts || pts.length < 2) {
      aimArc.visible = false;
      aimArc.geometry.setDrawRange(0, 0);
      return;
    }
    const count = Math.min(33, pts.length);
    let distance = 0;
    for (let i = 0; i < count; i++) {
      const p = pts[i];
      if (i > 0) {
        const q = pts[i - 1];
        distance += Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      }
      aimArcPositions[i * 3] = p.x;
      aimArcPositions[i * 3 + 1] = p.y;
      aimArcPositions[i * 3 + 2] = p.z;
      aimArcDistances[i] = distance;
    }
    aimArc.geometry.setDrawRange(0, count);
    aimArc.geometry.attributes.position.needsUpdate = true;
    aimArc.geometry.attributes.lineDistance.needsUpdate = true;
    aimArc.visible = true;
  }

  // --- editor camera helpers -------------------------------------------------------------
  // Route-aware compositions sample the authored vector centerline, so doglegs
  // and strategic features frame correctly instead of being reduced to one
  // straight tee-to-pin chord.
  let activeCourseCamera = null;

  function cameraOptions(hole) {
    return {
      property: { w: W, h: H, cellYd: CELL_YD },
      vecHole: course.vec?.holes?.find((vh) => vh.id === hole?.vecId) || null,
      heightAt,
      aspect: camera.aspect,
      verticalFov: camera.fov,
      maxFrameDist: Math.min(440, rig.maxDist),
      maxOverviewDist: rig.maxDist,
    };
  }

  function applyCourseCameraPose(pose) {
    if (!pose?.target) return false;
    rig.target.set(pose.target.x, pose.target.y, pose.target.z);
    rig.yaw = pose.yaw;
    rig.pitch = clamp(pose.pitch, rig.minPitch, rig.maxPitch);
    rig.dist = clamp(pose.dist, rig.minDist, rig.maxDist);
    rig.clampTarget();
    rig.apply();
    return true;
  }

  function frameCourse() {
    activeCourseCamera = { kind: 'overview' };
    return applyCourseCameraPose(courseCameraPose(
      null,
      COURSE_CAMERA_MODES.COURSE_OVERVIEW,
      cameraOptions(null),
    ));
  }

  function frameHole(hole, mode = COURSE_CAMERA_MODES.FRAME_HOLE) {
    if (!hole || !hole.tee || !hole.pin) return frameCourse();
    activeCourseCamera = { kind: 'hole', hole, mode };
    return applyCourseCameraPose(courseCameraPose(hole, mode, cameraOptions(hole)));
  }

  function flyoverHole(hole, progress) {
    if (!hole || !hole.tee || !hole.pin) return frameCourse();
    activeCourseCamera = { kind: 'flyover', hole, progress };
    return applyCourseCameraPose(courseCameraFlyoverPose(hole, progress, cameraOptions(hole)));
  }

  function clearCourseCameraPreset() {
    activeCourseCamera = null;
  }

  // --- data texture refresh from sim state -----------------------------------------------------------
  const ideals = BALANCE.turf.ideal;
  const IDEAL_BY_ZONE = {
    [ZONE.GREEN]: ideals.green.height,
    [ZONE.TEE]: ideals.tee.height,
    [ZONE.FAIRWAY]: ideals.fairway.height,
    [ZONE.ROUGH]: ideals.rough.height,
    [ZONE.FRINGE]: ideals.tee.height,
    [ZONE.SEMI]: ideals.fairway.height,
    [ZONE.HEAVY]: ideals.rough.height,
  };

  // --- mow-direction flow field: every fairway/tee/green cell knows the local
  // direction of its hole, so stripe bands bend with the routing. Angle/2π is
  // packed into auxData alpha (recomputed only when holes or zones change).
  const flowField = new Float32Array(W * H); // angle / 2π, 0..1
  function rebuildFlowField() {
    const holes = course.holes.filter((h) => h.tee && h.pin);
    const segs = [];
    for (const h of holes) {
      // route through the hole's waypoints when the generator recorded them,
      // so stripes bend around doglegs instead of cutting the corner
      const pts = [h.tee, ...(h.wp || []), h.pin];
      for (let i = 0; i < pts.length - 1; i++) {
        segs.push({ ax: pts[i].x, ay: pts[i].y, bx: pts[i + 1].x, by: pts[i + 1].y });
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let best = null;
        let bestD = Infinity;
        for (const s of segs) {
          const vx = s.bx - s.ax;
          const vy = s.by - s.ay;
          const len2 = vx * vx + vy * vy || 1;
          const t = clamp(((x - s.ax) * vx + (y - s.ay) * vy) / len2, 0, 1);
          const dx = x - (s.ax + vx * t);
          const dy = y - (s.ay + vy * t);
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
        let ang = 0.13; // default diagonal for land that belongs to no hole
        if (best) ang = Math.atan2(best.by - best.ay, best.bx - best.ax);
        const norm = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        flowField[y * W + x] = norm / (Math.PI * 2);
      }
    }
  }
  rebuildFlowField();

  function updateTurf(st) {
    const t = st.turf;
    const zones = st.course.zones;
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      const zone = zones[i];
      // clamped pack: an unknown/oversized id must degrade to a sane surface,
      // never wrap the byte into a random one
      zoneData[o] = Math.min(255, zone * ZONE_TEX_SCALE);
      if (t) {
        zoneData[o + 1] = clamp(t.health[i] * 2.55, 0, 255);
        zoneData[o + 2] = clamp(t.wear[i] * 2.55, 0, 255);
        const ideal = IDEAL_BY_ZONE[zone] || 10;
        zoneData[o + 3] = clamp((t.heightMm[i] / ideal) * 64, 0, 255);
        auxData[o] = t.disType[i] * 100;
        auxData[o + 1] = clamp(t.disSev[i] * 2.55, 0, 255);
        auxData[o + 2] = clamp(t.moisture[i] * 2.55, 0, 255);
      } else {
        zoneData[o + 1] = 180;
        zoneData[o + 3] = 64;
      }
      auxData[o + 3] = clamp(Math.round(flowField[i] * 255), 0, 255);
      zoneData[o + 3] = zoneData[o + 3] || 64;
    }
    zoneTex.needsUpdate = true;
    auxTex.needsUpdate = true;
    // stripe modes from mowing pattern policies
    if (shaderRefs.uniforms && st.maintenance) {
      const modeOf = (p) => (p === 'stripes' ? 1 : p === 'cross' ? 2 : 0);
      const pol = st.maintenance.policies;
      shaderRefs.uniforms.uStripeModes.value.set(modeOf(pol.green.pattern), modeOf(pol.fairway.pattern), modeOf(pol.tee.pattern));
    }
  }

  const planColorCache = {};
  function planColor(zone) {
    if (!planColorCache[zone]) planColorCache[zone] = hexToVec3(ZONE_COLORS[zone]);
    return planColorCache[zone];
  }

  function updatePlan(plan) {
    planData.fill(0);
    if (plan) {
      for (const e of plan.cells.values()) {
        const o = (e.y * W + e.x) * 4;
        if (e.zone !== undefined) {
          const c = planColor(e.zone);
          planData[o] = c.x * 255;
          planData[o + 1] = c.y * 255;
          planData[o + 2] = c.z * 255;
          planData[o + 3] = 235;
        } else if (e.dElev !== undefined) {
          if (e.dElev > 0) {
            planData[o] = 255;
            planData[o + 1] = 214;
            planData[o + 2] = 120;
          } else {
            planData[o] = 120;
            planData[o + 1] = 184;
            planData[o + 2] = 255;
          }
          planData[o + 3] = 200;
        }
      }
    }
    planTex.needsUpdate = true;
  }

  // --- sun / time-of-day / weather ------------------------------------------------------------------
  const sunPos = new THREE.Vector3();

  // --- rain streaks: a recycling column around the camera, fed by the same
  // weather the turf drinks (KNOWN_ISSUES: "no rain particles" — shipped)
  const RAIN_N = 800;
  const rainPos = new Float32Array(RAIN_N * 6); // two verts per streak
  const rainSeed = [];
  for (let i = 0; i < RAIN_N; i++) {
    const x = (Math.random() - 0.5) * 52;
    const z = (Math.random() - 0.5) * 52;
    const y = Math.random() * 26;
    rainSeed.push({ x, z, y });
    rainPos[i * 6] = x; rainPos[i * 6 + 1] = y; rainPos[i * 6 + 2] = z;
    rainPos[i * 6 + 3] = x; rainPos[i * 6 + 4] = y + 0.8; rainPos[i * 6 + 5] = z;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(
    rainGeo,
    new THREE.LineBasicMaterial({ color: 0xcadcec, transparent: true, opacity: 0.34, toneMapped: false }),
  );
  rain.visible = false;
  rain.frustumCulled = false;
  scene.add(rain);
  let rainLevel = 0; // smoothed 0..1 from rainIn

  function updateRain(dt, weather) {
    const target = weather ? clamp(weather.today.rainIn / 0.6, 0, 1) : 0;
    rainLevel += (target - rainLevel) * Math.min(1, dt * 1.5);
    if (rainLevel < 0.02) {
      rain.visible = false;
      return;
    }
    rain.visible = true;
    rain.material.opacity = 0.14 + rainLevel * 0.28;
    rainGeo.setDrawRange(0, Math.floor(RAIN_N * rainLevel) * 2);
    rain.position.set(camera.position.x, 0, camera.position.z);
    const fall = 24 * dt;
    for (let i = 0; i < RAIN_N; i++) {
      let y = rainPos[i * 6 + 1] - fall;
      if (y < 0) y = 24 + Math.random() * 3;
      rainPos[i * 6 + 1] = y;
      rainPos[i * 6 + 4] = y + 0.8;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  // The editor edits in daylight regardless of the game clock: a lighting
  // override pins the sun to a preview preset until cleared.
  let lightingOverride = null; // null | 'day' | 'morning' | 'golden' | 'overcast'
  const LIGHT_PRESETS = {
    day: { minute: 10 * 60 + 30, rainIn: 0 },
    morning: { minute: 8 * 60 + 30, rainIn: 0 },
    golden: { minute: 19 * 60 + 35, rainIn: 0 },
    overcast: { minute: 13 * 60, rainIn: 0.28 },
  };
  function setLightingOverride(mode) {
    lightingOverride = LIGHT_PRESETS[mode] ? mode : null;
  }

  function applyTimeWeather(minuteOfDayIn, weatherIn) {
    let minuteOfDay = minuteOfDayIn;
    let weather = weatherIn;
    if (lightingOverride) {
      const p = LIGHT_PRESETS[lightingOverride];
      minuteOfDay = p.minute;
      weather = { today: { ...(weatherIn && weatherIn.today), rainIn: p.rainIn } };
    }
    const t = clamp((minuteOfDay - 330) / (1260 - 330), 0, 1); // 5:30 → 21:00
    const elevDeg = Math.sin(t * Math.PI) * 62 - 2;
    const azimDeg = 96 + t * 168;
    const phi = THREE.MathUtils.degToRad(90 - elevDeg);
    const theta = THREE.MathUtils.degToRad(azimDeg);
    sunPos.setFromSphericalCoords(1, phi, theta);
    skyU.sunPosition.value.copy(sunPos);

    const rainy = weather && weather.today.rainIn > 0;
    const heavyRain = weather && weather.today.rainIn > 0.5;
    skyU.turbidity.value = rainy ? 11 : 3;
    skyU.rayleigh.value = rainy ? 0.8 : 2.6;

    const day = elevDeg > 2;
    const dusk = elevDeg > -6 && elevDeg <= 2;
    // anchored on the shadow target (the world origin in overview, the player on foot) so the
    // shading direction and the fitted shadow frustum always agree
    sun.position.set(
      sun.target.position.x + sunPos.x * 1600,
      sunPos.y * 1600,
      sun.target.position.z + sunPos.z * 1600,
    );
    sun.position.y = Math.max(sun.position.y, -200);

    if (day) {
      const warm = 0.10 + clamp(1 - Math.abs(elevDeg) / 30, 0, 1) * (elevDeg < 25 ? 0.90 : 0);
      // §3: one bright slightly-warm sun; strong ambient keeps shadows colorful
      sun.color.setRGB(1, 0.985 - warm * 0.19, 0.93 - warm * 0.3);
      sun.intensity = (rainy ? 1.45 : 2.15) * clamp(elevDeg / 12, 0.4, 1);
      hemi.intensity = rainy ? 0.9 : 1.0;
      scene.fog.density = heavyRain ? 0.0009 : rainy ? 0.0005 : 0.00024;
    } else if (dusk) {
      sun.color.setRGB(1, 0.62, 0.42);
      sun.intensity = 0.8;
      hemi.intensity = 0.75;
      scene.fog.density = 0.0003;
    } else {
      // night: dim blue moonlight so the course stays readable
      sun.color.setRGB(0.55, 0.65, 0.95);
      sun.intensity = 0.3;
      sun.position.set(600, 900, 400);
      hemi.intensity = 0.45;
      scene.fog.density = 0.0004;
    }
    // the sun TARGET is owned by fitSunShadow — the world origin from the overview map,
    // the player on foot. Resetting it here every frame is what once yanked the fitted
    // shadow box back to the origin and left the player's surroundings shadowless.

    // stylized cumulus only belong to a bright sky
    cloudGroup.visible = day && !heavyRain;

    // keep the water's sun highlights in step with the real sun
    for (const w of waterMeshes) {
      w.material.uniforms.sunDirection.value.copy(sunPos).normalize();
      w.material.uniforms.sunColor.value.copy(sun.color).multiplyScalar(Math.max(0.15, sun.intensity / 3));
    }

    // the clubhouse follows the clock: practicals carry the room after dark,
    // daylight fills die at night, the glass glows warm from outside
    if (clubhouseApi && clubhouseApi.setTimeMood) clubhouseApi.setTimeMood(minuteOfDay);
  }

  // --- picking ------------------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function raycastCell(px, py) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((px - rect.left) / rect.width) * 2 - 1;
    ndc.y = -(((py - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(editorGroundTargets, false);
    if (!hits.length) return null;
    const p = hits[0].point;
    const cx = Math.floor((p.x + worldW / 2) / CELL_YD);
    const cy = Math.floor((p.z + worldH / 2) / CELL_YD);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
    return { x: cx, y: cy, point: p };
  }

  // the editor's ray: fractional cell coords + the world point (smooth brushes)
  function raycastGround(px, py) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((px - rect.left) / rect.width) * 2 - 1;
    ndc.y = -(((py - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(editorGroundTargets, false);
    if (!hits.length) return null;
    const p = hits[0].point;
    const fx = (p.x + worldW / 2) / CELL_YD - 0.5;
    const fy = (p.z + worldH / 2) / CELL_YD - 0.5;
    return {
      fx, fy,
      x: clamp(Math.round(fx), 0, W - 1),
      y: clamp(Math.round(fy), 0, H - 1),
      point: p,
      inBounds: fx >= -0.5 && fy >= -0.5 && fx <= W - 0.5 && fy <= H - 0.5,
    };
  }

  // --- frame -------------------------------------------------------------------------------------------
  let time = 0;

  // THE SHADOW THROTTLE. The sun's shadow map is world-space: moving the CAMERA never
  // changes it, only the sun's crawl and the handful of things that walk or get built do —
  // and none of those need a 4096² rebake 90 times a second. Measured on the fixed spin
  // route, the every-frame bake was ~5ms of GPU per frame (90.5 → 164.1 fps frozen). Ten
  // bakes a second keeps character shadows visually glued to their feet and gives almost
  // all of that time back.
  const SHADOW_BAKE_MS = 100;
  let shadowClock = Infinity; // Infinity → the very first frame always bakes
  let shadowBakes = 0; // perf probes read this to attribute frame spikes to bakes

  // SHADOW FITTING. On foot, only the ±120 yards around the player can ever be read — so
  // that is all the shadow map covers: a 2048 map over 240yd is 2.5× the texel density the
  // old whole-course 4096 had, for a quarter of the raster cost, and the pass culls to the
  // box so far-course casters stop being drawn at all. The overview map keeps the classic
  // whole-course fit. The box is snapped to the shadow texel grid in light space, so a
  // 10Hz rebake never swims as the player moves.
  const SHADOW_WALK_SPAN = 120;
  const SHADOW_EDITOR_SPAN = 220;
  const SHADOW_WALK_MAP = 2048;
  const SHADOW_EDITOR_MAP = 2048;
  const SHADOW_FULL_MAP = 4096;
  let shadowFitMode = null;
  let editorShadowFocus = false;
  const shadowFwd = new THREE.Vector3();
  const shadowRight = new THREE.Vector3();
  const shadowUp = new THREE.Vector3();
  const shadowFocus = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  function fitSunShadow() {
    const mode = walk.active ? 'walk' : editorShadowFocus ? 'editor' : 'full';
    const size = mode === 'walk' ? SHADOW_WALK_MAP
      : mode === 'editor' ? SHADOW_EDITOR_MAP
        : SHADOW_FULL_MAP;
    const span = mode === 'walk' ? SHADOW_WALK_SPAN : SHADOW_EDITOR_SPAN;
    // re-assert on size drift too, not just mode flips — a QA/debug hand on mapSize
    // must never leave the fit half-applied
    if (mode !== shadowFitMode || sun.shadow.mapSize.x !== size) {
      const sizeChanged = sun.shadow.mapSize.x !== size || sun.shadow.mapSize.y !== size;
      shadowFitMode = mode;
      sun.shadow.mapSize.set(size, size);
      // Walk and editor deliberately share a 2048 target. Changing only its
      // fitted camera must not throw that GPU allocation and its depth programs
      // away on every J / Exit cycle.
      if (sizeChanged && sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      if (mode === 'full') {
        sc.left = -worldW * 0.62;
        sc.right = worldW * 0.62;
        sc.top = worldH * 0.75;
        sc.bottom = -worldH * 0.75;
        sun.target.position.set(0, 0, 0);
      } else {
        sc.left = -span;
        sc.right = span;
        sc.top = span;
        sc.bottom = -span;
      }
      sc.updateProjectionMatrix();
    }
    if (mode !== 'full') {
      // sunPos is the unit sun direction applyTimeWeather maintains every frame
      shadowFwd.copy(sunPos).negate().normalize();
      shadowRight.crossVectors(WORLD_UP, shadowFwd);
      if (shadowRight.lengthSq() < 1e-6) shadowRight.set(1, 0, 0); else shadowRight.normalize();
      shadowUp.crossVectors(shadowFwd, shadowRight).normalize();
      if (mode === 'walk') shadowFocus.set(walk.x, 0, walk.z);
      else shadowFocus.set(rig.target.x, 0, rig.target.z);
      const texel = (span * 2) / size;
      const px = shadowFocus.dot(shadowRight);
      const py = shadowFocus.dot(shadowUp);
      shadowFocus.addScaledVector(shadowRight, Math.round(px / texel) * texel - px);
      shadowFocus.addScaledVector(shadowUp, Math.round(py / texel) * texel - py);
      sun.target.position.set(shadowFocus.x, 0, shadowFocus.z);
      sun.position.set(
        shadowFocus.x + sunPos.x * 1600,
        Math.max(sunPos.y * 1600, -200),
        shadowFocus.z + sunPos.z * 1600,
      );
      sun.target.updateMatrixWorld();
    }
  }

  function setEditorShadowFocus(active) {
    const next = !!active;
    if (editorShadowFocus === next) return;
    editorShadowFocus = next;
    shadowClock = Infinity;
  }

  function render(dtMs, st) {
    if (sceneDisposed) return;
    guardCourseWaterReflection.beginFrame();
    time += dtMs / 1000;
    // Repack flora at most once before a frame begins. A mesh onBeforeRender
    // hook is invoked again by AO and shadow passes and can also rebucket a
    // partly rendered frame when the player crosses an LOD refresh boundary.
    floraLodUpdate?.();
    shadowClock += dtMs;
    if (shadowClock >= SHADOW_BAKE_MS) {
      fitSunShadow();
      renderer.shadowMap.needsUpdate = true;
      shadowClock = 0;
      shadowBakes++;
    }
    if (shaderRefs.uniforms) shaderRefs.uniforms.uTime.value = time;
    for (const w of waterMeshes) {
      w.material.uniforms.time.value = time * 0.55;
    }
    // near-camera grass: alive whenever the camera is low (on foot, in
    // playtest, or a tee/green ground view) — the overview never pays for it
    let groundLevel = walk.active;
    let gx = walk.x;
    let gz = walk.z;
    if (!groundLevel) {
      const camAbove = camera.position.y - heightAt(camera.position.x, camera.position.z);
      if (camAbove < 14) {
        groundLevel = true;
        // look a little ahead of the camera so the field sits in view, not behind
        gx = camera.position.x - Math.sin(rig.yaw || 0) * 8;
        gz = camera.position.z - Math.cos(rig.yaw || 0) * 8;
      }
    }
    if (groundLevel !== grassActive) setGrassActive(groundLevel);
    if (grassActive) {
      updateGrass(gx, gz, false);
      if (grassUniforms) grassUniforms.uGrassTime.value = time;
    }
    if (st) updateGolfers(dtMs / 1000, st);
    if (st) updateRain(dtMs / 1000, st.weather);
    if (clubhouseApi) clubhouseApi.update(dtMs); // doors, shop customers, interior life
    // flag wave
    if (holeGroup) {
      for (const o of holeGroup.children) {
        if (o.userData && o.userData.isFlag) {
          const s = Math.sin(time * 2.2 + o.position.z * 0.05);
          o.position.x = o.userData.pole.x + 0.7 + s * 0.08;
          o.rotation.y = s * 0.35;
        }
      }
    }
    if (postEnabled) {
      try {
        composer.render();
      } catch (e) {
        console.warn('post-processing failed, falling back to direct render', e);
        postEnabled = false;
        renderer.render(scene, camera);
      }
    } else {
      renderer.render(scene, camera);
    }
    clubhouseApi?.renderDeliveryCarryOverlay?.();
  }

  function resize() {
    const wpx = canvas.clientWidth || window.innerWidth;
    const hpx = canvas.clientHeight || window.innerHeight;
    renderer.setSize(wpx, hpx, false);
    camera.aspect = wpx / hpx;
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    composer.setPixelRatio(pr);
    composer.setSize(wpx, hpx);
    const active = activeCourseCamera;
    if (active?.kind === 'overview') frameCourse();
    else if (active?.kind === 'hole') frameHole(active.hole, active.mode);
    else if (active?.kind === 'flyover') flyoverHole(active.hole, active.progress);
  }

  function setViewMode(mode) {
    if (shaderRefs.uniforms) {
      shaderRefs.uniforms.uViewMode.value = mode === 'health' ? 1 : mode === 'moisture' ? 2 : 0;
    }
  }

  function rebuildAll(st, {
    reusePreparedVisualFields = false,
    reusePreparedFlowField = false,
  } = {}) {
    relief = null; // the vector design may have changed — re-derive the sculpt
    rebuildTerrainHeights();
    buildEnvironmentRing();
    rebuildWater();
    rebuildTrees();
    rebuildObjects();
    rebuildPaths();
    rebuildStructures();
    updateHoles();
    if (!reusePreparedFlowField) rebuildFlowField();
    if (reusePreparedVisualFields) {
      // makeVisualField/makeSurfaceDistanceField already populated these
      // buffers during construction. Upload them without spending another
      // full CPU pass deriving identical initial data.
      zoneHiTex.needsUpdate = true;
      surfaceDistanceTex.clearUpdateRanges();
      surfaceDistanceTex.needsUpdate = true;
    } else {
      updateZoneField(st);
    }
    updateTurf(st);
    freezeStaticCourse();
    if (walk.active) refreshWalkColliders(); // works can plant or fell obstacles
  }

  // the editor's cheap incremental refresh after a stroke: terrain heights +
  // water + paths follow the land; trees/objects only when asked. zoneRect
  // limits the visual-field recompute to the edited cells.
  function refreshGround(st, { water = false, objects = false, paths = false, holes = false, flow = false, zoneRect = null, zones = true, relief: reReliefsculpt = false, terrainRect = null } = {}) {
    if (reReliefsculpt) relief = null; // a vector feature (green/bunker/water/tee) moved
    // terrainRect scopes the mesh rebuild to an edited region, and it is honoured
    // even alongside a relief invalidation. Dropping and rebuilding the relief
    // cache re-buckets every analytic feature, but a stamped green or bunker only
    // CHANGES the sculpt near itself — vertices outside the rect re-evaluate to
    // the heights they already hold. Callers that move something course-wide
    // (rebuildAll) pass no rect and still get the full pass.
    rebuildTerrainHeights(terrainRect);
    if (water) rebuildWater();
    const rebuiltPaths = paths
      || ((water || reReliefsculpt) && course.paths?.some(pathBridgeEnabled));
    if (rebuiltPaths) rebuildPaths();
    if (objects) {
      rebuildTrees();
      rebuildObjects();
    }
    if (holes) updateHoles();
    if (flow) rebuildFlowField();
    if (zones) updateZoneField(st, zoneRect);
    updateTurf(st);
    // Re-freeze only the subtrees this call rebuilt. envRing and
    // horizonLandscape are never rebuilt here, so they never need it.
    freezeStaticCourse({
      trees: objects, objects, paths: Boolean(rebuiltPaths), env: false, water, terrain: true,
    });
  }

  function dispose() {
    if (sceneDisposed) return { alreadyDisposed: true };
    sceneDisposed = true;
    gtao.render = gtaoRender;
    treeBuildToken += 1;
    if (walk.active) walkExit();
    const clubhouse = clubhouseApi?.dispose ? clubhouseApi.dispose() : null;
    while (golfers.length) removeGolfer(golfers.length - 1);

    const cachedObjectResources = mergeSceneResources();
    for (const cached of objectGlbCache.values()) {
      if (!cached || cached === 'missing' || cached === 'loading') continue;
      collectSceneResources({
        traverse(visitor) {
          for (const part of cached.parts || []) visitor({ geometry: part.geometry, material: part.material });
        },
      }, cachedObjectResources);
    }
    for (const cached of proceduralObjectCache.values()) {
      collectSceneResources({
        traverse(visitor) {
          for (const part of cached.parts || []) visitor({ geometry: part.geometry, material: part.material });
        },
      }, cachedObjectResources);
    }
    const explicitTextures = new Set([
      texFair, texFairN, texRough, texRoughN, texSand, texSandN,
      texScrub, texScrubN, texPath, texAsphalt,
      zoneTex, auxTex, planTex, zoneHiTex, surfaceDistanceTex, waterNormalsTex,
    ]);
    const explicitTargets = new Set();
    if (sun.shadow.map) explicitTargets.add(sun.shadow.map);
    const extraResources = mergeSceneResources(
      cachedObjectResources,
      collectSceneResources(flagstickModel),
      collectSceneResources(cupModel),
      ...[...sharedPutModelRoots].map((root) => collectSceneResources(root)),
      { textures: explicitTextures, renderTargets: explicitTargets },
    );
    const sceneResources = disposeSceneResources(scene, {
      protectedResources: floraSharedResources,
      extraResources,
    });
    // Pending GLTF callbacks retain only their own request state; fallback
    // groups already had their resources released with the scene above.
    heldFallbacks.clear();
    const disposedPasses = new Set();
    for (const pass of composer.passes) {
      if (!pass || disposedPasses.has(pass) || typeof pass.dispose !== 'function') continue;
      disposedPasses.add(pass);
      pass.dispose();
    }
    if (gtao.gtaoMaterial && typeof gtao.gtaoMaterial.dispose === 'function') gtao.gtaoMaterial.dispose();
    composer.dispose();
    renderer.resetState();
    renderer.dispose();
    return {
      alreadyDisposed: false,
      clubhouse,
      sceneResources,
      postPasses: disposedPasses.size,
    };
  }

  // initial build
  rebuildAll(state, {
    reusePreparedVisualFields: true,
    reusePreparedFlowField: true,
  });
  updatePlan(null);
  cartMesh = buildCartMesh(); // primitive placeholder until the real model lands
  scene.add(cartMesh);
  cartHidden = !!(state.tractor && !state.tractor.repaired); // earn it first

  // the mower deck rides behind the restored tractor (owner-supplied implement)
  let mowerMesh = null;
  function attachMower() {
    if (!cartMesh) return;
    if (mowerMesh) {
      if (mowerMesh.parent !== cartMesh) cartMesh.add(mowerMesh);
      return;
    }
    new GLTFLoader().load('vendor/models/mower_deck.glb', (g) => {
      adoptLoadedGltf(g, (loaded) => {
        const m = loaded.scene;
        m.scale.setScalar(2.6);
        m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        m.rotation.y = Math.PI / 2; // deck width across the tractor's tail
        m.position.set(0, 0.02, 2.45);
        mowerMesh = m;
        cartMesh.add(mowerMesh);
      });
    }, undefined, () => {});
  }

  // the real tractor: owner-supplied model first (Assets/, matches the Designs
  // references), the bpy-scripted one as fallback, primitives if offline
  function adoptTractor(m, scale, flip = false) {
    m.scale.setScalar(scale);
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const wrap = new THREE.Group();
    m.position.y = -0.1; // settle the tires into the turf on slopes
    if (flip) m.rotation.y = Math.PI; // model authored front-toward-viewer (+Z)
    wrap.add(m);
    const previousCart = cartMesh;
    if (mowerMesh?.parent === previousCart) previousCart.remove(mowerMesh);
    removeOwnedObject(previousCart);
    cartMesh = wrap;
    scene.add(cartMesh);
    if (mowerMesh) cartMesh.add(mowerMesh); // survive the mesh swap
    placeCartMesh();
  }
  let tractorModelRequested = false;
  function ensureTractorModel() {
    if (tractorModelRequested || sceneDisposed) return;
    tractorModelRequested = true;
    new GLTFLoader().load('vendor/models/tractor_red.glb',
      (g) => adoptLoadedGltf(g, (loaded) => adoptTractor(loaded.scene, 3.6, true)),
      undefined,
      () => {
        if (sceneDisposed) return;
        new GLTFLoader().load(
          'vendor/models/tractor.glb',
          (g) => adoptLoadedGltf(g, (loaded) => adoptTractor(loaded.scene, 1)),
          undefined,
          () => {},
        );
      });
  }
  // New properties begin with the broken machine in the yard. Keep the 48 MiB
  // decoded restored model (64 MiB with mips) off their boot path until the
  // repair interaction actually makes it visible. Existing repaired saves load
  // it immediately and receive the mower just as before.
  if (!cartHidden) {
    ensureTractorModel();
    attachMower();
  }

  // shared prop loader for the yard/entrance dressing
  const SHARED_PUT_MODELS = new Set(['vendor/models/leaves_pile.glb']);
  const sharedPutModelCache = new Map();
  const sharedPutModelRoots = new Set();
  const loadPutModel = (url, onLoaded) => {
    if (!SHARED_PUT_MODELS.has(url)) {
      new GLTFLoader().load(url, (g) => {
        adoptLoadedGltf(g, (loaded) => onLoaded(loaded.scene));
      }, undefined, () => {});
      return;
    }
    let pending = sharedPutModelCache.get(url);
    if (!pending) {
      pending = new Promise((resolve) => {
        new GLTFLoader().load(url, (g) => {
          if (sceneDisposed) {
            disposeSceneResources(g.scene);
            resolve(null);
            return;
          }
          const entry = { root: g.scene, resources: collectSceneResources(g.scene) };
          sharedPutModelRoots.add(entry.root);
          resolve(entry);
        }, undefined, () => resolve(null));
      });
      sharedPutModelCache.set(url, pending);
    }
    pending.then((entry) => {
      if (!entry || sceneDisposed) return;
      const clone = entry.root.clone(true);
      clone.userData.courseSharedResources = entry.resources;
      onLoaded(clone);
    });
  };
  const putModel = (url, scale, x, z, ry, onLoaded) => {
    loadPutModel(url, (m) => {
        m.scale.setScalar(scale);
        m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        m.position.set(x, heightAt(x, z), z);
        m.rotation.y = ry;
        scene.add(m);
        if (onLoaded) onLoaded(m);
    });
  };

  // --- the maintenance yard: shed, workbench, and the EARNED tractor -------------------
  // At game start the tractor sits here broken (weathered twin of the red one).
  // Three chores — clear the junk, fuel it, fit a belt — then [E] repairs it:
  // the broken shell swaps for the restored machine with the mower deck hitched.
  function buildMaintenanceYard(bx, bz) {
    // the yard sits on the open approach east of the porch — the west side has
    // the entrance sign and flags; the east side earns you the tractor
    const yard = { x: bx + 14.5, z: bz + 18.5, yaw: 0.7 };
    const t = state.tractor;

    putModel('vendor/models/shed.glb', 5.2, bx + 20.5, bz + 13, -1.9);
    propColliders.push({ minX: bx + 17.8, maxX: bx + 23.2, minZ: bz + 10.3, maxZ: bz + 15.7 });
    putModel('vendor/models/workbench.glb', 2.5, bx + 18.6, bz + 17.2, -Math.PI / 2);
    propColliders.push({ x: bx + 18.6, z: bz + 17.2, r: 1.0 });
    putModel('vendor/models/tool_chest.glb', 1.35, bx + 21.6, bz + 17.1, -Math.PI / 2);
    propColliders.push({ x: bx + 21.6, z: bz + 17.1, r: 0.75 });

    if (!t || t.repaired) {
      attachMower();
      return yard; // the machine already runs — the yard is scenery
    }

    // the broken tractor: same silhouette, visibly let go — dulled, rusted, sagging
    let brokenGroup = null;
    const brokenCollider = { x: yard.x, z: yard.z, r: 1.5 };
    propColliders.push(brokenCollider);
    putModel('vendor/models/tractor_broken.glb', 3.55, yard.x, yard.z, yard.yaw + Math.PI / 2, (m) => {
      brokenGroup = m;
      m.rotation.z = 0.045; // flat rear tire sag
      m.position.y -= 0.14;
      m.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          if (o.material.color) {
            o.material.color.multiplyScalar(0.6);
            o.material.color.lerp(new THREE.Color(0x6e4a2c), 0.28); // rust film
          }
          o.material.roughness = 1;
        }
      });
    });

    const say = (msg) => { if (walkHooks.toast) walkHooks.toast(msg); };
    const play = (n) => { if (walkHooks.sfx) walkHooks.sfx(n); };

    // chore 1: the junk heaped against it
    let leavesMesh = null;
    const leavesProp = {
      x: bx + 11.8, z: bz + 20.4, r: 2.4,
      label: () => 'Old leaves and junk — [E] clear it out',
      action: () => {
        if (!tractorStep(state, 'cleared').ok) return;
        if (leavesMesh) tweenOut(leavesMesh, () => removeOwnedObject(leavesMesh));
        walkProps.splice(walkProps.indexOf(leavesProp), 1);
        play('thunk');
        say('Junk cleared — you can get at the engine now.');
      },
    };
    putModel('vendor/models/leaves_pile.glb', 2.2, leavesProp.x, leavesProp.z, 0.4, (m) => { leavesMesh = m; });
    walkProps.push(leavesProp);

    // chore 2: the fuel can by the bench
    let canMesh = null;
    const canProp = {
      x: bx + 17.4, z: bz + 18.9, r: 2.0,
      label: () => 'Fuel can — [E] fill the tractor’s tank',
      action: () => {
        if (!tractorStep(state, 'fuel').ok) return;
        if (canMesh) tweenOut(canMesh, () => removeOwnedObject(canMesh));
        walkProps.splice(walkProps.indexOf(canProp), 1);
        play('thunk');
        say('Tank filled — smells like a running machine already.');
      },
    };
    putModel('vendor/models/gas_can.glb', 0.55, canProp.x, canProp.z, 0.9, (m) => { canMesh = m; });
    walkProps.push(canProp);

    // chore 3: the drive belt on the chest
    let beltMesh = null;
    const beltProp = {
      x: bx + 21.0, z: bz + 18.8, r: 2.0,
      label: () => 'Drive belt — [E] fit it to the tractor',
      action: () => {
        if (!tractorStep(state, 'belt').ok) return;
        if (beltMesh) tweenOut(beltMesh, () => removeOwnedObject(beltMesh));
        walkProps.splice(walkProps.indexOf(beltProp), 1);
        play('thunk');
        say('Belt on the pulleys — one pull of the starter to go.');
      },
    };
    putModel('vendor/models/belt.glb', 0.7, beltProp.x, beltProp.z, 0.3, (m) => { beltMesh = m; });
    walkProps.push(beltProp);

    // the machine itself: reports what it still needs, then comes alive
    const tractorProp = {
      x: yard.x, z: yard.z, r: 3.4,
      label: () => {
        const left = tractorRemaining(state);
        if (left.length) return `Broken tractor — needs ${left.map((s) => STEP_LABEL[s]).join(', ')}`;
        return 'Broken tractor — [E] get her running';
      },
      action: () => {
        if (!repairTractor(state).ok) return;
        if (brokenGroup) removeOwnedObject(brokenGroup);
        walkProps.splice(walkProps.indexOf(tractorProp), 1);
        propColliders.splice(propColliders.indexOf(brokenCollider), 1);
        cart.x = yard.x;
        cart.z = yard.z;
        cart.yaw = yard.yaw;
        cartHidden = false;
        ensureTractorModel();
        placeCartMesh();
        attachMower();
        play('chime');
        say('She lives! The tractor is yours — mower deck hitched. [E] to take the wheel.');
      },
    };
    walkProps.push(tractorProp);
    return yard;
  }

  // --- course restoration props: storm litter + the broken tee sign ------------------
  function buildCourseProps() {
    const props = state.props;
    if (!props) return;

    // litter piles (leaves GLB) at their seeded cells, hauled off with E
    props.litter.forEach((pile, idx) => {
      if (pile.cleared) return;
      const wx = (pile.cx + 0.5) * CELL_YD - worldW / 2;
      const wz = (pile.cy + 0.5) * CELL_YD - worldH / 2;
      let mesh = null;
      const prop = {
        x: wx, z: wz, r: 2.6,
        label: () => 'Storm debris — [E] haul it away',
        action: () => {
          if (!clearLitter(state, idx).ok) return;
          if (mesh) tweenOut(mesh, () => removeOwnedObject(mesh));
          walkProps.splice(walkProps.indexOf(prop), 1);
          updateTurf(state); // the flattened grass under it recovers
          if (walkHooks.sfx) walkHooks.sfx('thunk');
          if (walkHooks.toast) walkHooks.toast('Debris hauled off — the grass under it can breathe.');
        },
      };
      putModel('vendor/models/leaves_pile.glb', 1.9, wx, wz, (idx * 1.7) % 6.28, (m) => { mesh = m; });
      walkProps.push(prop);
    });

    // the first tee's sign: broken at start, repaired for real money
    const h0 = course.holes[0];
    if (!h0 || !h0.tee) return;
    const tx = h0.pin ? h0.pin.x - h0.tee.x : 1;
    const tz = h0.pin ? h0.pin.y - h0.tee.y : 0;
    const tl = Math.hypot(tx, tz) || 1;
    // Place the repairable sign on the outward side of the back tee, clear of
    // the player's aim line and camera. It remains easy to find on foot.
    const sideX = (tz / tl) * 16;
    const sideZ = (-tx / tl) * 16;
    const backX = (-tx / tl) * 2;
    const backZ = (-tz / tl) * 2;
    const sx = (h0.tee.x + 0.5) * CELL_YD - worldW / 2 + sideX + backX;
    const sz = (h0.tee.y + 0.5) * CELL_YD - worldH / 2 + sideZ + backZ;
    let signMesh = null;
    const placeSign = (broken) => {
      if (signMesh) removeOwnedObject(signMesh);
      putModel(broken ? 'vendor/models/tee_sign_broken.glb' : 'vendor/models/course_sign.glb',
        1.6, sx, sz, -0.5, (m) => { signMesh = m; });
    };
    placeSign(!props.teeSignFixed);
    if (!props.teeSignFixed) {
      const signProp = {
        x: sx, z: sz, r: 2.6,
        label: () => `Broken tee sign — [E] repair it (${PROPS.signRepairCost} dollars)`,
        action: () => {
          const res = fixTeeSign(state);
          if (!res.ok) {
            if (walkHooks.toast) walkHooks.toast(res.reason || 'Cannot repair it right now.', 'warn');
            return;
          }
          placeSign(false);
          walkProps.splice(walkProps.indexOf(signProp), 1);
          if (walkHooks.sfx) walkHooks.sfx('chime');
          if (walkHooks.toast) walkHooks.toast('Tee sign restored — first impressions matter.');
        },
      };
      walkProps.push(signProp);
    }
  }

  // entrance decor: the stone club sign on the approach, weathered to match the
  // course's actual condition at load. (The old small sign is now the tee sign;
  // the "pennant poles" were really flagsticks and moved to the holes.)
  let yardHome = null;
  {
    const s0 = course.structures[0];
    if (s0) {
      const bx = (s0.x + s0.w / 2) * CELL_YD - worldW / 2;
      const bz = (s0.y + s0.h / 2) * CELL_YD - worldH / 2;
      putModel('vendor/models/club_sign.glb', 3.4, bx - 15, bz + 16, 0.45, (m) => {
        // dead-course look: the sign dulls and leans with poor condition,
        // straightening up as the property recovers (applied per scene build)
        const cond = state.turf ? conditionRating(state) : 60;
        const neglect = clamp(1 - (cond - 35) / 40, 0, 1);
        if (neglect > 0.05) {
          m.rotation.z = 0.035 * neglect;
          m.traverse((o) => {
            if (o.isMesh && o.material) {
              o.material = o.material.clone();
              if (o.material.color) {
                o.material.color.multiplyScalar(1 - 0.3 * neglect);
                o.material.color.lerp(new THREE.Color(0x5c5648), 0.22 * neglect);
              }
              o.material.roughness = 1;
            }
          });
        }
      });
      propColliders.push({ x: bx - 15, z: bz + 16, r: 1.6 });
      yardHome = buildMaintenanceYard(bx, bz);

      // the groundskeeper's residence — the owner-supplied house GLB, optimized
      // (334k→67k tris, see DEV_LOG 2026-07-13) and finally on the property.
      // Its baked garden bed reads as its own yard on the entrance approach.
      putModel('vendor/models/clubhouse_ext_opt.glb', 20, bx - 30, bz + 27, 1.25, (m) => {
        m.position.y -= 0.12; // settle the baked landscaping bed into the turf
      });
      propColliders.push({ minX: bx - 40, maxX: bx - 20, minZ: bz + 21, maxZ: bz + 33 });
      walkProps.push({
        x: bx - 30, z: bz + 24, r: 4.5,
        label: () => "The groundskeeper's house — someone kept a nicer yard than the course",
        action: null,
      });

      // the club's golf cart, parked by the porch (ambient prop for now)
      putModel('vendor/models/golf_cart.glb', 2.6, bx + 9.5, bz + 12.5, 2.2);
      propColliders.push({ x: bx + 9.5, z: bz + 12.5, r: 1.3 });
      walkProps.push({
        x: bx + 9.5, z: bz + 12.5, r: 2.6,
        label: () => "The club's cart — members' shuttle (the tractor is yours)",
        action: null,
      });
    }
  }
  buildCourseProps();
  refreshWalkColliders(); // parking needs to see the world
  if (yardHome) {
    // the tractor lives at the yard, broken or not
    cart.x = yardHome.x;
    cart.z = yardHome.z;
    cart.yaw = yardHome.yaw;
    placeCartMesh();
  } else {
    parkCartAtClubhouse();
  }
  resize();
  rig.apply();

  // --- prewarm: compile every shader program + upload every texture behind the loading
  // veil so the first real look-around never hitches on lazy GPU work (356ms freezes
  // were measured on the first cold 360° turn before this existed)
  async function prewarm(onStep) {
    const tick = () => new Promise((res) => requestAnimationFrame(res));
    const alive = () => !sceneDisposed;
    const step = (label) => { if (alive() && onStep) onStep(label); };
    if (!alive()) return false;
    step('Loading models');
    await whenAssetsIdle(8000);
    if (!alive()) return false;
    // DefaultLoadingManager deliberately fails open after eight seconds. Give
    // checkout's exact cash prototypes their own bounded readiness handshake so
    // a slow local GLB decode cannot turn an empty representative root into a
    // false-success warm-up and permanently defer the cost to first tender.
    await clubhouseApi?.register?.waitForCashGpuPrewarmRepresentatives?.(12000);
    if (!alive()) return false;
    await tick();
    if (!alive()) return false;
    step('Compiling shaders');
    await tick();
    if (!alive()) return false;
    renderer.compile(scene, camera);
    await tick();
    if (!alive()) return false;
    step('Uploading textures');
    const seen = new Set();
    const texKeys = ['map', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap', 'alphaMap', 'bumpMap'];
    const pending = [];
    scene.traverse((o) => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of texKeys) {
          const t = m[k];
          if (t && t.isTexture && !seen.has(t)) { seen.add(t); pending.push(t); }
        }
      }
    });
    // batched across frames — one giant burst would itself be the hitch we're removing
    for (let i = 0; i < pending.length; i += 24) {
      for (let j = i; j < Math.min(i + 24, pending.length); j++) renderer.initTexture(pending[j]);
      await tick();
      if (!alive()) return false;
    }
    step('Warming the view');
    // linking programs is not enough — Windows/ANGLE drivers defer the real compile to a
    // program's FIRST DRAW. One frame with frustum culling off forces a draw of every
    // visible material (and uploads its geometry); fragments off-screen are clipped.
    const culled = [];
    scene.traverse((o) => {
      if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
    });
    renderer.shadowMap.needsUpdate = true; // bake once here so depth-pass programs compile behind the veil
    guardCourseWaterReflection.beginFrame();
    try { composer.render(); } catch (e) { renderer.render(scene, camera); }

    // The editor camera can move beyond the clubhouse's draw radius. That hides
    // its interior PointLights and changes the light-count defines on every
    // standard-material program. Warm the exact persisted editor camera and
    // render-only clubhouse visibility state behind the opaque veil; calling
    // clubhouse.update() here would incorrectly advance live transactions,
    // deliveries, customers, and animations.
    const persistedEditor = state.uiPrefs?.courseEditor || {};
    const editorHole = course.holes.find((hole) => hole.id === persistedEditor.selectedHoleId)
      || course.holes[0]
      || null;
    const editorView = Object.values(COURSE_CAMERA_MODES).includes(persistedEditor.cameraView)
      ? persistedEditor.cameraView
      : COURSE_CAMERA_MODES.FRAME_HOLE;
    const savedView = {
      walkActive: walk.active,
      heldVisible: heldRoot.visible,
      editorShadowFocus,
      activeCourseCamera,
      clubhouseInteriorVisible: clubhouseApi?.interior?.visible,
      cameraPosition: camera.position.clone(),
      cameraQuaternion: camera.quaternion.clone(),
      cameraFov: camera.fov,
      cameraNear: camera.near,
      rigTarget: rig.target.clone(),
      rigYaw: rig.yaw,
      rigPitch: rig.pitch,
      rigDist: rig.dist,
      rigMaxDist: rig.maxDist,
      rigMaxPitch: rig.maxPitch,
      rigMinDist: rig.minDist,
      rigMinPitch: rig.minPitch,
    };
    walk.active = false;
    heldRoot.visible = false;
    editorShadowFocus = true;
    rig.maxDist = 700;
    rig.maxPitch = 1.08;
    rig.minDist = 8;
    rig.minPitch = 0.08;
    camera.fov = 46;
    camera.near = 1;
    camera.updateProjectionMatrix();
    if (editorView === COURSE_CAMERA_MODES.COURSE_OVERVIEW) frameCourse();
    else frameHole(editorHole, editorView);
    floraLodUpdate?.(true);
    clubhouseApi?.syncCameraVisibility?.();
    fitSunShadow();
    renderer.shadowMap.needsUpdate = true;
    guardCourseWaterReflection.beginFrame();
    try { composer.render(); } catch (e) { renderer.render(scene, camera); }
    walk.active = savedView.walkActive;
    heldRoot.visible = savedView.heldVisible;
    editorShadowFocus = savedView.editorShadowFocus;
    activeCourseCamera = savedView.activeCourseCamera;
    rig.maxDist = savedView.rigMaxDist;
    rig.maxPitch = savedView.rigMaxPitch;
    rig.minDist = savedView.rigMinDist;
    rig.minPitch = savedView.rigMinPitch;
    rig.target.copy(savedView.rigTarget);
    rig.yaw = savedView.rigYaw;
    rig.pitch = savedView.rigPitch;
    rig.dist = savedView.rigDist;
    camera.position.copy(savedView.cameraPosition);
    camera.quaternion.copy(savedView.cameraQuaternion);
    camera.fov = savedView.cameraFov;
    camera.near = savedView.cameraNear;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (clubhouseApi?.interior && typeof savedView.clubhouseInteriorVisible === 'boolean') {
      clubhouseApi.interior.visible = savedView.clubhouseInteriorVisible;
    }
    floraLodUpdate?.(true);
    fitSunShadow();
    renderer.shadowMap.needsUpdate = true;
    for (const o of culled) o.frustumCulled = true;
    await tick();
    if (!alive()) return false;
    // A couple of normal frames settle the AO history and bloom targets. Keep
    // the exact restored pose: these diagnostic turns must not leak through the
    // loading veil into the first player frame.
    const settledQuaternion = camera.quaternion.clone();
    for (let i = 0; i < 3; i++) {
      camera.rotation.set(0, (i * Math.PI * 2) / 3, 0, 'YXZ');
      renderer.shadowMap.needsUpdate = true;
      guardCourseWaterReflection.beginFrame();
      try { composer.render(); } catch (e) { renderer.render(scene, camera); }
      await tick();
      if (!alive()) return false;
    }
    camera.quaternion.copy(settledQuaternion);
    camera.updateMatrixWorld(true);
    // Checkout cash representatives share the exact kit geometry/materials and
    // existed only so the forced warm-up draw above could realize them behind
    // the opaque veil. Keep the GPU residency, but remove their scene nodes
    // before the first player frame and before lifecycle baselines are sampled.
    clubhouseApi?.register?.releaseCashGpuPrewarmRepresentatives?.({ drawn: true });
    return true;
  }

  return {
    renderer,
    scene,
    prewarm,
    camera,
    rig,
    post: { composer, gtao, bloom, sun, stats: () => ({ shadowBakes }) },
    render,
    resize,
    raycastCell,
    raycastGround,
    updateTurf,
    updatePlan,
    updateHoles,
    rebuildAll,
    refreshGround,
    updateZoneField,
    rebuildObjects,
    rebuildPaths,
    rebuildStructures,
    rebuildTrees,
    floraDiagnostics,
    rebuildWater,
    rebuildFlowField,
    setViewMode,
    setBrush,
    setEditorBrush,
    setEditorFeaturePreview,
    setPlacementGhost,
    setMeasureLine,
    setBallVisual,
    setAimArc,
    setLightingOverride,
    frameCourse,
    frameHole,
    flyoverHole,
    clearCourseCameraPreset,
    pickObject,
    worldX,
    worldZ,
    vectorWorldX,
    vectorWorldZ,
    applyTimeWeather,
    heightAt,
    zoneAtWorld,
    bridgeSurfaceAtWorld,
    playHeightAt,
    playZoneAtWorld,
    inBoundsWorld: (x, z) => Math.abs(x) <= worldW / 2 + 40 && Math.abs(z) <= worldH / 2 + 40,
    setGolfersFrozen: (v) => { golfersFrozen = !!v; },
    clearGolfers: () => {
      let removed = 0;
      while (golfers.length) {
        if (removeGolfer(golfers.length - 1)) removed += 1;
      }
      return removed;
    },
    golferCount: () => golfers.length,
    setGolfersVisible: (v) => { golferGroup.visible = !!v; },
    setEditorShadowFocus,
    assetBarrier: (timeoutMs = 12000) => ({
      idle: !assetsInFlight,
      promise: whenAssetsIdle(timeoutMs),
    }),
    clubhouse: () => clubhouseApi,
    walk: {
      enter: walkEnter,
      exit: walkExit,
      update: walkUpdate,
      interact: walkInteract,
      interactSecondary: walkInteractSecondary,
      getFocusLabel: () => {
        if (!walkFocus) return null;
        const secondary = walkFocus.kind === 'prop'
          ? (typeof walkFocus.prop.secondaryLabel === 'function'
            ? walkFocus.prop.secondaryLabel()
            : walkFocus.prop.secondaryLabel)
          : null;
        const requestedTool = walkFocus.kind === 'prop' ? walkFocus.prop.tool : null;
        return walkFocusPromptLabel(walkFocus.label, requestedTool, walkTool, secondary);
      },
      getFocus: () => walkFocus,
      hooks: walkHooks,
      placeCart: (x, z, yaw) => {
        cart.x = x;
        cart.z = z;
        if (yaw !== undefined) cart.yaw = yaw;
        placeCartMesh();
      },
      setTool: walkSetTool,
      getTool: () => walkTool,
      heldAssetDiagnostics: heldAssetRegistry.diagnostics,
      setSpraying: walkSetSpraying,
      isSpraying: () => walkSpraying,
      setSoaping: (on) => { walkSoaping = !!on && walkTool === 'washer'; },
      isSoaping: () => walkSoaping,
      clearKeys: walkBlur, // a mode change drops whatever was held, so you never resume walking into a wall
      unstick: walkUnstick, // the pause menu's manual fallback; returns how it got you out, or null
      isFree: (x, z, r) => walkFreeAt(x, z, r ?? walk.radius), // also what placement validation asks
      focusOn: walkFocusOn,
      clearFocus: walkClearFocus,
      isFocused: () => !!walkFocusPose,
      aimCell: walkAimCell,
      isActive: () => walk.active,
      state: walk, // position/yaw/pitch — also the QA hook
      cart, // cart state, same purpose
      colliders: { trees: treeColliders, structures: structColliders }, // read-only for QA
    },
    dispose,
  };
}

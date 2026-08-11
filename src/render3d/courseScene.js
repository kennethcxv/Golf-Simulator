// FAIRWAY STATE — the realistic 3D course view.
// A Three.js scene driven entirely by the serialized GameState: smoothed heightmap
// terrain with a splat shader (mow stripes, health browning, disease mottle, data
// views, plan ghost), carved ponds with water surfaces, instanced trees, sun/sky
// with time-of-day and weather, and 3D hole furniture (flags, tee markers, badges).
// World units are YARDS; 1 cell = 8x8 yd. The sim never knows this file exists.

import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { BINDABLE_ACTIONS, DEFAULT_BINDINGS, keyForAction } from '../core/keyBindings.js';
import { CachedGLTFLoader as GLTFLoader, clearGltfCache } from './gltfCache.js';
import { initKTX2, ktx2Diagnostics } from './ktx2Support.js';
import { sharedTextureDiagnostics } from './sharedTexturePool.js';
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
import {
  isTextEntryTarget, reconcileModifiers, heldModifierNames, observedModifiers,
} from '../core/heldKeys.js';
import { ownedWasher } from '../sim/washing.js';
import { chargeGolfCart } from '../sim/golfCartFleet.js';
import { makeFpHands, GRIPS } from './fpHands.js';
import {
  tractorStep, repairTractor, tractorRemaining, recordTractorUse, STEP_LABEL,
} from '../sim/tractor.js';
import { clearLitter, fixTeeSign, PROPS } from '../sim/props.js';
import { conditionRating } from '../sim/turf.js';
import { makeCameraRig } from './cameraRig.js';
import { makeCharacter } from './characterAsset.js';
import { patchPoissonDenoiseMaterial } from './shaderPatches.js';
import { makeCourseMaintenanceTextureState } from './courseMaintenanceVisuals.js';
import { prepareFrameShadows, shouldRefreshPlanarReflection } from './renderBudget.js';
import { clubhouseInteriorGtaoExcludedAt, makeClubhouse } from './clubhouse.js';
import {
  makeGrassTexture, makeSandTexture, makeScrubTexture, makePathTexture, makeAsphaltTexture,
  makeSoftParticleTexture,
} from './proceduralTextures.js';
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
import { floraWindEligible, floraWindStrength } from './floraWind.js';
import { attachSocket, socketWorld } from './toolSockets.js';
import { buildToolViewmodels } from './toolViewmodel.js';
import { createBroomViewmodel } from './broomViewmodel.js';
import { BROOM_FEEL } from '../data/broomFeel.js';
import { TOOL_VM_FEEL, VM_RIG_TOOLS } from '../data/toolFeel.js';
import { CLEANING_TOOLS, DIRT } from '../data/cleaningTools.js';
import {
  WALK_SPEED_YD_S, RUN_MULTIPLIER, TOOL_RUN_MULTIPLIER, STRIDE_RATE_RAD_S, IDLE_SWAY_RATE_RAD_S,
  EYE_HEIGHT_YD, WALK_FOV_DEG,
} from '../data/locomotion.js';
import { GOLF_CART_TIERS, golfCartTier } from '../data/golfCarts.js';
import { CLUBHOUSE_VARIANT_REQUEST, DOOR_MAIN, SHELL } from '../data/shopLayout.js';
import {
  gradePremiumClubhouseTerrain,
  premiumClubhouseTerrainGradeAlpha,
} from './premiumClubhouseTerrainGrade.js';
import {
  gradeModernPublicClubhouseTerrain,
  modernPublicClubhouseTerrainGradeAlpha,
} from './modernPublicClubhouseTerrainGrade.js';

// tools worked against the boards; resolved once rather than filtered every frame
const FLOOR_ANCHORED_TOOLS = Object.values(CLEANING_TOOLS).filter((t) => t.floorAnchored).map((t) => t.id);
// How fast the ACCEPTED floor height under a held tool may travel. This is the
// stray-sample guard: a real floor does not jump, so a garbage groundYAt can
// only move the tool 1.6 yd/s (0.027 yd on a 60 Hz frame) no matter what it
// returns, while a genuine step is crossed in a fifth of a second. It bounds
// the INPUT, so the pose itself stays free to answer a fast look at full speed.
const FLOOR_SAMPLE_RATE = 1.6;
// A sanity bound on the solved offset, not a working range. Nothing legitimate
// asks a held tool to move two yards; anything that does is a broken sample.
const FLOOR_ANCHOR_ENVELOPE = 2.0;

const ELEV_FT_TO_YD = (1 / 3) * 1.5; // real feet→yards with 1.5x readability exaggeration
const METERS_TO_YARDS = 1.0936133;
// Default water carves reach 4.5 ft (2.25 yd after readability exaggeration)
// and bunker bowls reach about 1.4 yd. Keep the coarse countryside underlay
// below every authored core plus the coarse underlay's interpolation headroom
// so it cannot punch through the playable terrain as a false turf island.
// Eight yards is intentionally larger than the carve itself: the ring spans
// ~35-yard quads, whose interpolated base can sit several yards above a local
// hollow even when each source vertex sampled the course correctly.
const ENV_RING_INTERIOR_TUCK_YD = 8;
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
  [ZONE.OUT]: Object.freeze({ h: 0.25, r: 0.34, g: 0.43, b: 0.17 }),
  [ZONE.ROUGH]: Object.freeze({ h: 0.14, r: 0.29, g: 0.5, b: 0.17 }),
  [ZONE.FAIRWAY]: Object.freeze({ h: 0.035, r: 0.32, g: 0.57, b: 0.19 }),
  [ZONE.TEE]: Object.freeze({ h: 0.025, r: 0.31, g: 0.55, b: 0.19 }),
  [ZONE.FRINGE]: Object.freeze({ h: 0.03, r: 0.3, g: 0.53, b: 0.18 }),
  [ZONE.HEAVY]: Object.freeze({ h: 0.32, r: 0.36, g: 0.45, b: 0.17 }),
  [ZONE.BED]: Object.freeze({ h: 0.12, r: 0.25, g: 0.37, b: 0.14 }),
  [ZONE.SEMI]: Object.freeze({ h: 0.065, r: 0.29, g: 0.51, b: 0.17 }),
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

/**
 * Ground-truth GTAO configuration. Contact occlusion is the ONLY thing darkening where
 * indoor geometry meets the floor: RectAreaLights cannot cast shadows in three.js, and
 * interior meshes are deliberately kept out of the sun's shadow atlas
 * (clubhouse/interiorShadowPolicy.js). At half resolution and 0.4 blend that contact was
 * effectively absent — a table leg simply ended where it met the boards.
 *
 * Exported so tests/gtao-config.test.js can assert the LIVE uniform matches what this
 * file claims. That guard exists because `gtao.radius = x` looks like it works and does
 * nothing: GTAOPass keeps the radius in gtaoMaterial.uniforms.radius and never reads a
 * bare property, so two call sites spent their lives setting a field nobody consumed.
 *
 * `radius` stays at 1.5 on purpose. Raising it to 2.4 was measured and made the occlusion
 * read as broad blotchy staining rather than tight contact — see Designs/ProShop/Spike.
 * Intensity and resolution are what buy grounding; radius buys spread.
 */
export const GTAO_CONFIG = Object.freeze({
  radius: 1.5,
  blendIntensity: 1.0,
  // A3 2026-08-10: 24 samples / 16 pd / full res measured 4.34 ms of an
  // 8.17 ms GPU frame at 4K physical (the old "full res is free indoors"
  // number was taken at a smaller effective resolution). The sweep
  // (qa/electron/a3-gtao-sweep) walked samples/pd/scale with a screenshot per
  // rung at the ledger-desk pose — the exact surface the old full-res pin was
  // written about — and 12/8/0.75 keeps the box and counter contact shadows
  // while cutting the whole frame 8.7 -> 5.2 ms. Half res saved nothing more
  // (denoise is the remaining cost), so 0.75 is the floor worth paying for.
  samples: 12,
  resolutionScale: 0.75,
  pd: Object.freeze({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 2, radiusExponent: 1, rings: 2, samples: 8 }),
});

const WALK_FOCUS_MIN_FACING = 0.3;
const WALK_FOCUS_CROSS_TRACK_WEIGHT = 3.8;
const WALK_FOCUS_DEPTH_WEIGHT = 0.18;

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

// A prop's simulation label plus its optional secondary verb, composed one way
// everywhere. (The box-cutter equip rewrite that used to live here went with
// the cutter itself, 2026-07-30 — cartons tear on a press, no tool.)
export function walkFocusPromptLabel(label, requestedTool, equippedTool, secondaryLabel = null) {
  const secondary = secondaryLabel ? ` · [X] ${secondaryLabel}` : '';
  const primary = label == null ? '' : String(label);
  return `${primary}${secondary}`;
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
const floraWindUniforms = new Set();

function installFloraWind(material, id, kind) {
  if (!material || !floraWindEligible(id, kind)) return material;
  const record = {
    kind,
    time: { value: 0 },
    strength: { value: floraWindStrength(kind, 6) },
  };
  floraWindUniforms.add(record);
  material.userData.floraWind = { kind };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFloraTime = record.time;
    shader.uniforms.uFloraWindStrength = record.strength;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFloraTime;
        uniform float uFloraWindStrength;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        float fwFloraMask = smoothstep(0.12, 0.98, position.y);
        float fwFloraPhase = position.x * 4.1 + position.z * 3.7;
        #ifdef USE_INSTANCING
          fwFloraPhase += instanceMatrix[3].x * 0.043 + instanceMatrix[3].z * 0.037;
        #endif
        float fwFloraWave = sin(uFloraTime * 1.05 + fwFloraPhase + position.y * 2.4);
        float fwFloraCross = cos(uFloraTime * 0.73 + fwFloraPhase * 1.37);
        transformed.x += fwFloraWave * uFloraWindStrength * fwFloraMask;
        transformed.z += fwFloraCross * uFloraWindStrength * 0.58 * fwFloraMask;`,
      );
  };
  material.customProgramCacheKey = () => 'golf-flipper-flora-wind-v1';
  return material;
}

// The species pools the boundary forest and any untyped spot draw from.
const FLORA_FOREST = ['fill_a', 'fill_b', 'oak_b', 'oak_a', 'maple_a', 'pine_a', 'pine_b', 'spruce_a', 'birch_a', 'shade_a'];
const FLORA_PINE = ['pine_a', 'pine_b', 'spruce_a', 'cedar_a'];
// every object type the flora pipeline owns (so rebuildObjects skips them)
const FLORA_IDS = new Set([
  'oak_a', 'oak_b', 'maple_a', 'birch_a', 'shade_a', 'flower_a', 'fill_a', 'fill_b',
  'pine_a', 'pine_b', 'spruce_a', 'cedar_a', 'cypress_a', 'palm_a', 'acacia_a', 'eucalyptus_a',
  'ornamental_small_a', 'shrub_round', 'shrub_flower', 'bush_native', 'hedge_a',
  'reed_clump', 'grass_clump', 'groundcover_a', 'flower_bed_a',
  'rock_s', 'rock_m', 'boulder_a', 'shore_rock',
  'tree_default', 'tree_oak', 'tree_detailed', 'tree_fat', 'tree_pineDefaultA', 'tree_pineRoundB',
  'reeds', 'bush_round', 'bush_flower', 'hedge', 'flowers',
]);
// the tall canopy species (block the walker; the rest are stepped past)
const TREE_SPECIES = new Set([
  'oak_a', 'oak_b', 'maple_a', 'birch_a', 'shade_a', 'flower_a', 'fill_a', 'fill_b',
  'pine_a', 'pine_b', 'spruce_a', 'cedar_a', 'cypress_a', 'palm_a', 'acacia_a', 'eucalyptus_a',
  'ornamental_small_a',
  'tree_default', 'tree_oak', 'tree_detailed', 'tree_fat', 'tree_pineDefaultA', 'tree_pineRoundB',
]);

function loadFloraAssets() {
  if (floraAssetsPromise) return floraAssetsPromise;
  const loader = new GLTFLoader();
  const loadOne = (id, kind) => new Promise((resolve) => {
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
            installFloraWind(material, id, kind);
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
      return Promise.all(manifest.variants.map((v) => loadOne(v.id, v.kind))).then((loaded) => {
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

  // Bounded runtime aggregates let browser QA measure production editor work
  // without retaining per-frame samples during long editing sessions.
  const editorPerformanceKeys = [
    'visualField',
    'surfaceDistanceField',
    'visualFieldUpload',
    'terrainHeights',
    'terrainNormals',
    'terrainRefresh',
    'turfPack',
  ];
  const editorPerformanceStats = Object.create(null);

  function resetEditorPerformanceStats() {
    for (const key of editorPerformanceKeys) {
      editorPerformanceStats[key] = {
        calls: 0,
        totalMs: 0,
        maxMs: 0,
        lastMs: 0,
        units: 0,
        scopedCalls: 0,
        fullCalls: 0,
      };
    }
  }

  function recordEditorPerformance(key, startedAt, units = 0, scoped = null) {
    const stat = editorPerformanceStats[key];
    const elapsed = performance.now() - startedAt;
    stat.calls += 1;
    stat.totalMs += elapsed;
    stat.maxMs = Math.max(stat.maxMs, elapsed);
    stat.lastMs = elapsed;
    stat.units += units;
    if (scoped === true) stat.scopedCalls += 1;
    if (scoped === false) stat.fullCalls += 1;
  }

  function editorPerformanceSnapshot() {
    return Object.fromEntries(editorPerformanceKeys.map((key) => {
      const stat = editorPerformanceStats[key];
      return [key, {
        calls: stat.calls,
        totalMs: +stat.totalMs.toFixed(3),
        averageMs: +(stat.calls ? stat.totalMs / stat.calls : 0).toFixed(3),
        maxMs: +stat.maxMs.toFixed(3),
        lastMs: +stat.lastMs.toFixed(3),
        units: stat.units,
        scopedCalls: stat.scopedCalls,
        fullCalls: stat.fullCalls,
      }];
    }));
  }

  resetEditorPerformanceStats();

  // --- renderer / scene / camera -------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // DPR 1.5 cap: above that the post chain pays quadratically for sharpness nobody reads
  // at gameplay distance — a 4K/200% desktop was rendering 78% more pixels than this.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // baked on the throttle in render(), not per frame
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  // A no-op unless someone has explicitly opted back into the rejected KTX2 lever.
  // Kept as the call site because the block format a transcoder targets depends on
  // this renderer, so a re-measurement has to stand it up exactly here.
  initKTX2(renderer);

  const scene = new THREE.Scene();
  // The world root itself never moves. Leaving it on auto-update marks it dirty
  // before every render pass and forces a world-matrix multiply through every
  // descendant, including subtrees that deliberately opted out below.
  scene.matrixAutoUpdate = false;
  scene.fog = new THREE.FogExp2(0xd8d5cb, 0.00024);

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
  patchPoissonDenoiseMaterial(gtao.pdMaterial);
  gtao.output = GTAOPass.OUTPUT.Default;
  // STYLE GUIDE §3: tight contact darkening only — no corner grime spread. All values
  // come from GTAO_CONFIG so the source of truth is one object (see its comment).
  gtao.blendIntensity = GTAO_CONFIG.blendIntensity;
  gtao.updateGtaoMaterial({
    radius: GTAO_CONFIG.radius, // yards — hugs feet, wheels, and trunks; stays out of open turf
    distanceExponent: 1,
    thickness: 1,
    scale: 1.0,
    samples: GTAO_CONFIG.samples,
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  gtao.updatePdMaterial({ ...GTAO_CONFIG.pd });
  // AO runs at FULL resolution. It used to be halved here, on a measurement taken from the
  // outdoor spin route with the whole course in frame (~5ms/frame, 90.5 → 175.8 fps with
  // the pass off). Indoors, behind the 80yd interior draw gate, the same change measured
  // free: 7.78ms vs 7.82ms idle and 10.62 vs 10.69 spinning across 4 samples each. Half
  // resolution was also costing the one effect that grounds indoor objects at all, so the
  // interior trade was strictly bad. If the outdoor cost ever bites, scale by camera mode
  // rather than reinstating a blanket halving.
  if (GTAO_CONFIG.resolutionScale !== 1) {
    const scale = GTAO_CONFIG.resolutionScale;
    const gtaoFullSetSize = gtao.setSize.bind(gtao);
    gtao.setSize = (w, h) => gtaoFullSetSize(Math.max(1, Math.ceil(w * scale)), Math.max(1, Math.ceil(h * scale)));
  }
  composer.addPass(gtao);
  // STYLE GUIDE §3: bloom effectively OFF for the scene — only the sun disc
  // (radiance in the thousands) may glint; turf and trim never halo
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.12, 0.3, 60.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let postEnabled = true;

  // --- lights & sky -----------------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xfff1da, 2.8);
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
  const hemi = new THREE.HemisphereLight(0xfff4e0, 0xb9b4a5, 1.4);
  const ambient = new THREE.AmbientLight(0xfff2e0, 0.16);
  scene.add(hemi, ambient);

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
          console.warn(`ground texture ${file} missing - procedural fallback in use`);
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
  // CPU-only sources for renderer.copyTextureToTexture(). Unlike Texture's
  // updateRanges (which issue one texSubImage2D per row and only support RGBA),
  // this route uploads one true rectangle while retaining the destination's
  // existing GPU allocation.
  const zoneUploadSource = new THREE.DataTexture(zoneData, W, H);
  const auxUploadSource = new THREE.DataTexture(auxData, W, H);
  for (const t of [zoneTex, auxTex, planTex]) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  }
  const maintenanceTextures = makeCourseMaintenanceTextureState(state, worldW, worldH);

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
  const zoneHiUploadSource = new THREE.DataTexture(
    visField.data, visField.w, visField.h, THREE.RGFormat, THREE.UnsignedByteType,
  );
  const surfaceDistanceUploadSource = new THREE.DataTexture(
    surfaceDistanceField.data, surfaceDistanceField.w, surfaceDistanceField.h,
    THREE.RGBAFormat, THREE.UnsignedByteType,
  );
  const dataUploadBox = new THREE.Box2();
  const dataUploadPosition = new THREE.Vector2();

  function uploadDataTextureRegion(destination, source, tx0, ty0, tx1, ty1) {
    if (!renderer.properties.has(destination)) {
      // Construction and a pre-first-frame edit have no allocated destination
      // yet. A normal full upload is the only valid path in that state.
      destination.clearUpdateRanges();
      destination.needsUpdate = true;
      return false;
    }
    destination.clearUpdateRanges();
    dataUploadBox.min.set(tx0, ty0);
    dataUploadBox.max.set(tx1 + 1, ty1 + 1);
    dataUploadPosition.set(tx0, ty0);
    renderer.copyTextureToTexture(source, destination, dataUploadBox, dataUploadPosition);
    return true;
  }

  // Recompute the visual field from the sim grid — everything, or one padded
  // cell-rect while a paint stroke is in flight.
  function updateZoneField(st, rect = null, { padding } = {}) {
    if (rect) {
      const visualStarted = performance.now();
      updateVisualFieldRegion(st.course, visField, rect.x0, rect.y0, rect.x1, rect.y1, padding);
      recordEditorPerformance('visualField', visualStarted, 0, true);
      const distanceStarted = performance.now();
      updateSurfaceDistanceFieldRegion(
        st.course, visField, surfaceDistanceField,
        rect.x0, rect.y0, rect.x1, rect.y1, padding,
      );
      recordEditorPerformance(
        'surfaceDistanceField', distanceStarted,
        (surfaceDistanceField.updatedRect.tx1 - surfaceDistanceField.updatedRect.tx0 + 1)
          * (surfaceDistanceField.updatedRect.ty1 - surfaceDistanceField.updatedRect.ty0 + 1),
        true,
      );
      const dirty = surfaceDistanceField.updatedRect;
      // One rectangular upload per field. The previous row-range loop issued
      // thousands of WebGL calls during a normal drag, while the RG visual
      // texture had no legal update-range path and re-uploaded in full.
      const uploadStarted = performance.now();
      uploadDataTextureRegion(zoneHiTex, zoneHiUploadSource, dirty.tx0, dirty.ty0, dirty.tx1, dirty.ty1);
      uploadDataTextureRegion(
        surfaceDistanceTex, surfaceDistanceUploadSource,
        dirty.tx0, dirty.ty0, dirty.tx1, dirty.ty1,
      );
      recordEditorPerformance(
        'visualFieldUpload', uploadStarted,
        (dirty.tx1 - dirty.tx0 + 1) * (dirty.ty1 - dirty.ty0 + 1),
        true,
      );
    } else {
      const visualStarted = performance.now();
      computeVisualField(st.course, visField);
      recordEditorPerformance('visualField', visualStarted, visField.w * visField.h, false);
      const distanceStarted = performance.now();
      computeSurfaceDistanceField(visField, surfaceDistanceField);
      recordEditorPerformance(
        'surfaceDistanceField', distanceStarted,
        surfaceDistanceField.w * surfaceDistanceField.h,
        false,
      );
      const uploadStarted = performance.now();
      zoneHiTex.clearUpdateRanges();
      zoneHiTex.needsUpdate = true;
      surfaceDistanceTex.clearUpdateRanges();
      surfaceDistanceTex.needsUpdate = true;
      recordEditorPerformance(
        'visualFieldUpload', uploadStarted,
        surfaceDistanceField.w * surfaceDistanceField.h,
        false,
      );
    }
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
        uniform sampler2D tRoughN;
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
          // geometry row 0 sits at -z but UV v runs the other way - flip v so the
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
          // Disease TYPE is categorical, so it alone keeps the nearest read -
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

          // real PBR surfaces - sample every set in uniform control flow so mip
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
          // Reuse the rough-ground micro-normal for sand and scrub. Their
          // diffuse maps and UV scales remain distinct, while sharing detail keeps the
          // terrain shader within WebGL's 16 active texture-unit limit when the
          // production RectAreaLight lookup textures are present.
          vec3 nSand = texture2D(tRoughN, uvSand).xyz;
          vec3 nScrub = texture2D(tRoughN, uvScrub).xyz;
          // The visible asphalt is a separate ribbon mesh. Reuse the restrained
          // rough normal for its buried terrain bed and preserve a texture unit
          // for the high-resolution edge-weight map on 16-unit WebGL hardware.
          vec3 nPath = vec3(0.5, 0.5, 1.0);

          // Textures supply restrained brightness variation; warm, muted zone
          // tints carry the parkland palette without a fluorescent luma swing.
          #define FW_LUMA vec3(0.299, 0.587, 0.114)
          #define FW_STYLIZE(tex, tint) ((0.46 + dot(tex, FW_LUMA) * 1.28) * (tint))

          vec3 colRough = FW_STYLIZE(dRough, vec3(0.145, 0.235, 0.082));
          vec3 colFair = FW_STYLIZE(dFair, vec3(0.150, 0.325, 0.080));
          // First cut is a deliberate intermediate ribbon, not a blurred
          // fairway edge.  The darker sage value stays above rough while
          // remaining legible from tee height.
          vec3 colSemi = FW_STYLIZE(dFair, vec3(0.145, 0.275, 0.074));
          // Close-cut complexes need a readable identity from both the editor
          // camera and tee height.  Keep the parkland hue, but give greens a
          // brighter, cooler value and their collar a deliberate dark frame.
          vec3 colGreen = FW_STYLIZE(dGreen, vec3(0.180, 0.360, 0.082));
          vec3 colFringe = FW_STYLIZE(dGreen, vec3(0.150, 0.300, 0.070));
          vec3 colTee = FW_STYLIZE(dTee, vec3(0.168, 0.340, 0.084));
          vec3 colSand = (0.5 + dot(dSand, FW_LUMA) * 1.18) * vec3(0.78, 0.66, 0.46);

          vec3 col;
          float stripeAmp = 0.0;
          float stripeFreq = 0.0;
          float modeSel = 0.0;
          bool followFlow = false;
          if (zone < 0.5) {        // OUT - native scrub
            col = FW_STYLIZE(dScrub, vec3(0.170, 0.225, 0.100)); gSplatN = nScrub; gSplatUv = uvScrub; gSplatRough = 0.97;
          } else if (zone < 1.5) { // ROUGH
            col = colRough; gSplatN = nRough; gSplatUv = uvRough; gSplatRough = 0.96;
          } else if (zone < 2.5) { // FAIRWAY
            col = colFair; gSplatN = nFair; gSplatUv = uvFair; gSplatRough = 0.94;
            // Roughly six-yard alternating cuts make the mowing read down the
            // hole at player height as well as from the planning camera.
            stripeAmp = 0.12; stripeFreq = 0.082; modeSel = uStripeModes.y; followFlow = true;
          } else if (zone < 3.5) { // GREEN
            col = colGreen; gSplatN = nGreen; gSplatUv = uvGreen; gSplatRough = 0.9;
            stripeAmp = 0.055; stripeFreq = 0.24; modeSel = uStripeModes.x; followFlow = true;
          } else if (zone < 4.5) { // TEE
            col = colTee; gSplatN = nTee; gSplatUv = uvTee; gSplatRough = 0.93;
            stripeAmp = 0.06; stripeFreq = 0.16; modeSel = uStripeModes.z; followFlow = true;
          } else if (zone < 5.5) { // BUNKER - warm sand on a gentler curve (never blows to white)
            col = colSand;
            gSplatN = nSand; gSplatUv = uvSand; gSplatRough = 0.82;
          } else if (zone < 6.5) { // WATER bed
            col = FW_STYLIZE(dScrub, vec3(0.13, 0.205, 0.09)); gSplatN = nScrub; gSplatUv = uvScrub; gSplatRough = 0.85;
          } else if (zone < 7.5) { // PATH - a dusty worn shoulder; the ribbon mesh is the pavement
            col = colRough; gSplatN = nRough; gSplatUv = uvRough; gSplatRough = 0.95;
          } else if (zone < 8.5) { // FRINGE - a shade deeper than green, tight cut
            col = colFringe; gSplatN = nGreen; gSplatUv = uvGreen; gSplatRough = 0.92;
          } else if (zone < 9.5) { // HEAVY rough - tall, warm, golden-tipped
            col = FW_STYLIZE(dRough, vec3(0.170, 0.225, 0.085)); gSplatN = nRough; gSplatUv = uvRough; gSplatRough = 0.97;
            col = mix(col, vec3(0.30, 0.29, 0.12), fwNoise(cellUv * 2.7) * 0.16); // seedhead shimmer
          } else if (zone < 10.5) { // DIRT
            col = FW_STYLIZE(dPath, vec3(0.42, 0.31, 0.20)); gSplatN = nPath; gSplatUv = uvPath; gSplatRough = 0.95;
          } else if (zone < 11.5) { // BED - dark mulch
            col = FW_STYLIZE(dScrub, vec3(0.23, 0.15, 0.09)); gSplatN = nScrub; gSplatUv = uvScrub; gSplatRough = 0.98;
          } else {                 // SEMI - first cut between fairway and rough
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
          vec3 heavyBand = FW_STYLIZE(dRough, vec3(0.170, 0.225, 0.085));
          heavyBand = mix(heavyBand, vec3(0.30, 0.29, 0.12), fwNoise(cellUv * 2.7) * 0.16);
          vec3 scrubBand = FW_STYLIZE(dScrub, vec3(0.170, 0.225, 0.100));
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
          col *= 0.96 + fwNoise(cellUv * 0.18 + vec2(9.7, 21.3)) * 0.08;

          if (stripeAmp > 0.001 && modeSel > 0.5) {
            // overgrown turf softens the bands but never erases the pattern -
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
            // freshly-watered turf reads darker until it drains - the hand-hose's
            // visible feedback, and honest for any saturated ground
            col *= 1.0 - smoothstep(0.58, 1.0, moisture) * 0.2;
            if (disSev > 0.03) {
              float spots = fwNoise(cellUv * (disType < 1.5 ? 6.5 : 3.2) + disType * 31.0);
              float cut = 1.0 - disSev * 0.56;
              float blot = smoothstep(cut, cut + 0.16, spots);
              // Turf stress stays olive and embedded in the sward. Pale,
              // high-contrast flecks read as litter from green-camera height.
              vec3 blotch = disType < 1.5 ? vec3(0.45, 0.43, 0.22) : vec3(0.39, 0.32, 0.18);
              col = mix(col, blotch, blot * 0.34);
            }
          }

          if (zone > 4.5 && zone < 5.5) {
            // grass-lip shadow: the sand right under the rolled turf edge sits in
            // shade; the middle of the bunker takes full sun (negative inside).
            // Driven by the bunker's own LINEAR distance channel rather than the
            // nearest-sampled, quarter-yard-quantized edgeYd - a 20% darkening
            // ramp off a quantized input banded visibly across the sand.
            float lip = smoothstep(-3.5, -0.4, surfaceDistanceYd.a);
            col *= mix(1.0, 0.80, lip);
            // faint rake grooves following the sand's long axis
            float rake = sin(dot(vWp.xz, vec2(0.82, 0.30)) * 2.6) * 0.5 + 0.5;
            col *= 0.96 + 0.04 * rake * (1.0 - lip);
            // footprinted sand: visibly churned and shadowed - raking smooths it back
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
  terrain.name = 'CourseTerrain';
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
          diffuseColor.rgb = (0.46 + luma * 1.28) * vec3(0.170, 0.225, 0.100);
        }`,
      );
    };
    envRing = new THREE.Mesh(geo, mat);
    envRing.name = 'CourseEnvironmentRing';
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
    // Three fog-separated silhouettes cost well under a thousand triangles and
    // replace the old single-height wallpaper with near, middle, and distant
    // parkland ridges.
    horizonLandscape.add(
      ridge(1050, 4.1, 7, 31, 0x526a50),
      ridge(1450, 0.7, 18, 48, 0x66785d),
      ridge(2050, 2.2, 34, 66, 0x899687),
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

  function rawTerrainHeightAtVertex(vx, vy) {
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

  function premiumClubhouseSiteAlignment() {
    if (state.property?.tierId !== 'premiumPrivate') return null;
    const structure = course.structures?.[0];
    if (!structure) return null;
    const centerCellX = structure.x + structure.w / 2;
    const centerCellY = structure.y + structure.h / 2;
    const centerX = centerCellX * CELL_YD - worldW / 2;
    const centerZ = centerCellY * CELL_YD - worldH / 2;
    const facadeDoorZ = centerZ + SHELL.d / 2 - SHELL.wallT / 2;
    return {
      authoredOriginX: centerX + DOOR_MAIN.x,
      authoredOriginZ: facadeDoorZ - 5 * METERS_TO_YARDS,
      centerCellX,
      centerCellY,
    };
  }

  function premiumClubhouseTerrainGrade() {
    const alignment = premiumClubhouseSiteAlignment();
    if (!alignment) return null;
    return Object.freeze({
      ...alignment,
      targetHeight: rawTerrainHeightAtVertex(
        alignment.centerCellX * SEG_PER_CELL,
        alignment.centerCellY * SEG_PER_CELL,
      ),
    });
  }

  function modernPublicClubhouseTerrainGrade() {
    if (['resortStyle', 'premiumPrivate'].includes(state.property?.tierId)) return null;
    // Same resolution the layout seam used — see src/data/clubhouseVariant.js. Reading
    // only the query here would grade the terrain for a room the launch flag or the
    // persisted dev setting had already changed.
    const requested = CLUBHOUSE_VARIANT_REQUEST.variant || state.property?.clubhouseVariant;
    if (requested === 'mountain-lodge' || requested === 'legacy') return null;
    const structure = course.structures?.[0];
    if (!structure) return null;
    const centerCellX = structure.x + structure.w / 2;
    const centerCellY = structure.y + structure.h / 2;
    return Object.freeze({
      centerX: centerCellX * CELL_YD - worldW / 2,
      centerZ: centerCellY * CELL_YD - worldH / 2,
      targetHeight: rawTerrainHeightAtVertex(
        centerCellX * SEG_PER_CELL,
        centerCellY * SEG_PER_CELL,
      ),
    });
  }

  function premiumClubhouseOwnsSiteAt(worldXAtPoint, worldZAtPoint) {
    const alignment = premiumClubhouseSiteAlignment();
    if (!alignment) return false;
    return premiumClubhouseTerrainGradeAlpha({
      worldX: worldXAtPoint,
      worldZ: worldZAtPoint,
      authoredOriginX: alignment.authoredOriginX,
      authoredOriginZ: alignment.authoredOriginZ,
    }) >= 0.999999;
  }

  function suppressesCourseGroundCoverAt(worldXAtPoint, worldZAtPoint) {
    return premiumClubhouseOwnsSiteAt(worldXAtPoint, worldZAtPoint)
      || Boolean(clubhouseApi?.suppressesGroundCoverAt?.(worldXAtPoint, worldZAtPoint));
  }

  function terrainHeightAtVertex(vx, vy, premiumGrade = null, modernGrade = null) {
    const rawHeight = rawTerrainHeightAtVertex(vx, vy);
    const worldXAtVertex = vx / segsX * worldW - worldW / 2;
    const worldZAtVertex = vy / segsY * worldH - worldH / 2;
    if (premiumGrade) {
      const alpha = premiumClubhouseTerrainGradeAlpha({
        worldX: worldXAtVertex,
        worldZ: worldZAtVertex,
        authoredOriginX: premiumGrade.authoredOriginX,
        authoredOriginZ: premiumGrade.authoredOriginZ,
      });
      return gradePremiumClubhouseTerrain(rawHeight, premiumGrade.targetHeight, alpha);
    }
    if (modernGrade) {
      const alpha = modernPublicClubhouseTerrainGradeAlpha({
        worldX: worldXAtVertex,
        worldZ: worldZAtVertex,
        centerX: modernGrade.centerX,
        centerZ: modernGrade.centerZ,
      });
      return gradeModernPublicClubhouseTerrain(rawHeight, modernGrade.targetHeight, alpha);
    }
    return rawHeight;
  }

  // Delegates to the pure solver in terrainNormals.js, which is unit-tested to
  // produce bit-identical results for a windowed solve and a full one. That
  // property is what makes scoped terrain edits seam-free.
  //
  // The window must be padded by the caller: a vertex's normal depends on its
  // neighbours' POSITIONS, so moving a vertex changes the normals one ring out.
  function recomputeTerrainNormals(vx0, vy0, vx1, vy1) {
    const started = performance.now();
    const nrm = terrainGeo.attributes.normal;
    computeHeightfieldNormals(
      heights, vertsX, vertsY, worldW / segsX, worldH / segsY, nrm.array,
      { vx0, vy0, vx1, vy1 },
    );
    nrm.needsUpdate = true;
    const touchedVertices = (vx1 - vx0 + 1) * (vy1 - vy0 + 1);
    recordEditorPerformance(
      'terrainNormals', started, touchedVertices,
      touchedVertices < vertsX * vertsY,
    );
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
    const refreshStarted = performance.now();
    if (course.vec && !relief) rebuildRelief();
    const pos = terrainGeo.attributes.position;
    const pa = pos.array;
    const premiumGrade = premiumClubhouseTerrainGrade();
    const modernGrade = modernPublicClubhouseTerrainGrade();

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

    const heightsStarted = performance.now();
    for (let vy = vy0; vy <= vy1; vy++) {
      for (let vx = vx0; vx <= vx1; vx++) {
        const h = terrainHeightAtVertex(vx, vy, premiumGrade, modernGrade);
        const i = vy * vertsX + vx;
        heights[i] = h;
        pa[i * 3 + 1] = h;
      }
    }
    const touchedVertices = (vx1 - vx0 + 1) * (vy1 - vy0 + 1);
    recordEditorPerformance('terrainHeights', heightsStarted, touchedVertices, Boolean(rectCells));
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
    recordEditorPerformance('terrainRefresh', refreshStarted, touchedVertices, Boolean(rectCells));
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

  // The one-yard maintenance state intentionally lives in a separate draw.
  // The PBR terrain already uses the hardware's full 16-sampler budget, while
  // this transparent, terrain-conforming layer needs only the two maintenance
  // textures. Keeping the layers separate also makes dirty texture uploads
  // independent from the course-wide turf renderer.
  {
  const maintenanceOverlayGeo = new THREE.PlaneGeometry(
    maintenanceTextures.worldSize.x,
    maintenanceTextures.worldSize.y,
    Math.max(1, Math.ceil(maintenanceTextures.worldSize.x / 2)),
    Math.max(1, Math.ceil(maintenanceTextures.worldSize.y / 2)),
  );
  maintenanceOverlayGeo.rotateX(-Math.PI / 2);
  const maintenanceOverlayUniforms = {
    uCondition: { value: maintenanceTextures.conditionTexture },
    uTreatment: { value: maintenanceTextures.treatmentTexture },
    uWorldMin: { value: maintenanceTextures.worldMin },
    uWorldSize: { value: maintenanceTextures.worldSize },
    uInspect: { value: state.courseMaintenance?.inspection.active ? 1 : 0 },
    uVisible: { value: 1 },
  };
  const maintenanceOverlayMat = new THREE.ShaderMaterial({
    name: 'Course maintenance one-yard overlay',
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: maintenanceOverlayUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vWorldXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCondition;
      uniform sampler2D uTreatment;
      uniform vec2 uWorldMin;
      uniform vec2 uWorldSize;
      uniform float uInspect;
      uniform float uVisible;
      varying vec2 vWorldXZ;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float valueNoise(vec2 p) {
        vec2 cell = floor(p);
        vec2 blend = fract(p);
        blend = blend * blend * (3.0 - 2.0 * blend);
        return mix(
          mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), blend.x),
          mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0, 1.0)), blend.x),
          blend.y
        );
      }

      void main() {
        if (uVisible < 0.5) discard;
        vec2 uv = (vWorldXZ - uWorldMin) / uWorldSize;
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
        vec4 condition = texture2D(uCondition, uv);
        vec4 treatment = texture2D(uTreatment, uv);
        float surface = floor(condition.r * 255.0 / 30.0 + 0.5);
        if (surface < 0.5) discard;

        float health = condition.g;
        float moisture = condition.b;
        float heightMm = condition.a * 127.5;
        float disease = treatment.r;
        float fertilizer = treatment.g;
        float angle = treatment.b * 6.2831853;
        float packedWork = treatment.a * 255.0;
        float noise = valueNoise(vWorldXZ * 1.65);
        vec3 tint = vec3(0.55, 0.48, 0.18);
        float alpha = 0.0;

        // Honest condition reads: localized olive stress, dark wet turf, pale
        // disease, and restrained treatment colour. Inspection strengthens the
        // signal without turning the entire hole into a diagnostic heat map.
        float stress = smoothstep(0.54, 0.28, health);
        alpha = max(alpha, stress * (0.08 + uInspect * 0.22));
        float dry = smoothstep(0.25, 0.10, moisture);
        tint = mix(tint, vec3(0.77, 0.61, 0.24), dry);
        alpha = max(alpha, dry * (0.10 + uInspect * 0.24));
        float wet = smoothstep(0.83, 0.98, moisture);
        tint = mix(tint, vec3(0.04, 0.17, 0.12), wet);
        alpha = max(alpha, wet * (0.11 + uInspect * 0.13));
        float blotch = smoothstep(0.32, 0.78, noise + disease * 0.62);
        tint = mix(tint, vec3(0.83, 0.78, 0.50), disease * blotch);
        alpha = max(alpha, disease * blotch * (0.33 + uInspect * 0.24));
        float overFeed = smoothstep(0.74, 1.0, fertilizer);
        tint = mix(tint, vec3(0.22, 0.42, 0.10), overFeed);
        alpha = max(alpha, overFeed * uInspect * 0.20);

        // Surface-aware overgrowth is visible at a distance as a soft darker
        // cast. Targets are green/fringe/tee/fairway/rough/native in millimetres.
        float targetMm = surface < 1.5 ? 4.0
          : surface < 2.5 ? 8.0
          : surface < 3.5 ? 10.0
          : surface < 4.5 ? 14.0
          : surface < 5.5 ? 45.0
          : 90.0;
        if (surface < 6.5) {
          float overgrown = smoothstep(targetMm + 3.0, targetMm + 17.0, heightMm);
          tint = mix(tint, vec3(0.07, 0.22, 0.045), overgrown * 0.7);
          alpha = max(alpha, overgrown * uInspect * 0.14);
        }

        if (surface < 6.5 && packedWork >= 127.5) {
          float quality = clamp((packedWork - 128.0) / 127.0, 0.0, 1.0);
          vec2 direction = vec2(cos(angle), sin(angle));
          float stripe = sin(dot(vWorldXZ, direction) * 3.14159265);
          vec3 stripeTint = stripe > 0.0 ? vec3(0.055, 0.17, 0.035) : vec3(0.27, 0.42, 0.12);
          tint = stripeTint;
          alpha = max(alpha, 0.045 + quality * 0.055);
        } else if (surface > 6.5) {
          float smoothness = treatment.a;
          float rakeLine = smoothstep(0.62, 0.98, abs(sin(vWorldXZ.x * 10.5 + vWorldXZ.y * 1.3)));
          tint = mix(tint, vec3(0.84, 0.70, 0.42), rakeLine * smoothness);
          alpha = max(alpha, rakeLine * smoothness * 0.06);
        }

        alpha = clamp(alpha, 0.0, 0.58);
        if (alpha < 0.012) discard;
        gl_FragColor = vec4(clamp(tint, 0.0, 1.0), alpha);
      }
    `,
  });
  const maintenanceOverlay = new THREE.Mesh(maintenanceOverlayGeo, maintenanceOverlayMat);
  maintenanceOverlay.name = 'Course maintenance condition overlay';
  maintenanceOverlay.position.set(
    maintenanceTextures.worldMin.x + maintenanceTextures.worldSize.x / 2,
    0,
    maintenanceTextures.worldMin.y + maintenanceTextures.worldSize.y / 2,
  );
  maintenanceOverlay.renderOrder = 2;
  maintenanceOverlay.receiveShadow = false;
  maintenanceOverlay.castShadow = false;
  // Merge residue retained only as a scoped parse-safe block. The authoritative
  // overlay immediately below owns the scene mount and lifecycle.

  function rebuildMaintenanceOverlayHeights() {
    // During function initialization the terrain can be rebuilt before this
    // const exists only in theory; every actual rebuild happens after setup.
    if (!maintenanceOverlayGeo) return;
    const position = maintenanceOverlayGeo.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) + maintenanceOverlay.position.x;
      const z = position.getZ(i) + maintenanceOverlay.position.z;
      position.setY(i, heightAt(x, z) + 0.028);
    }
    position.needsUpdate = true;
    maintenanceOverlayGeo.computeBoundingSphere();
  }
  }

  // The one-yard maintenance state intentionally lives in a separate draw.
  // The PBR terrain already uses the hardware's full 16-sampler budget, while
  // this transparent, terrain-conforming layer needs only the two maintenance
  // textures. Keeping the layers separate also makes dirty texture uploads
  // independent from the course-wide turf renderer.
  const maintenanceOverlayGeo = new THREE.PlaneGeometry(
    maintenanceTextures.worldSize.x,
    maintenanceTextures.worldSize.y,
    Math.max(1, Math.ceil(maintenanceTextures.worldSize.x / 2)),
    Math.max(1, Math.ceil(maintenanceTextures.worldSize.y / 2)),
  );
  maintenanceOverlayGeo.rotateX(-Math.PI / 2);
  const maintenanceOverlayUniforms = {
    uCondition: { value: maintenanceTextures.conditionTexture },
    uTreatment: { value: maintenanceTextures.treatmentTexture },
    uWorldMin: { value: maintenanceTextures.worldMin },
    uWorldSize: { value: maintenanceTextures.worldSize },
    uInspect: { value: state.courseMaintenance?.inspection.active ? 1 : 0 },
    uVisible: { value: 1 },
  };
  const maintenanceOverlayMat = new THREE.ShaderMaterial({
    name: 'Course maintenance one-yard overlay',
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: maintenanceOverlayUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vWorldXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCondition;
      uniform sampler2D uTreatment;
      uniform vec2 uWorldMin;
      uniform vec2 uWorldSize;
      uniform float uInspect;
      uniform float uVisible;
      varying vec2 vWorldXZ;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float valueNoise(vec2 p) {
        vec2 cell = floor(p);
        vec2 blend = fract(p);
        blend = blend * blend * (3.0 - 2.0 * blend);
        return mix(
          mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), blend.x),
          mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0, 1.0)), blend.x),
          blend.y
        );
      }

      void main() {
        if (uVisible < 0.5) discard;
        vec2 uv = (vWorldXZ - uWorldMin) / uWorldSize;
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
        vec4 condition = texture2D(uCondition, uv);
        vec4 treatment = texture2D(uTreatment, uv);
        float surface = floor(condition.r * 255.0 / 30.0 + 0.5);
        if (surface < 0.5) discard;

        float health = condition.g;
        float moisture = condition.b;
        float heightMm = condition.a * 127.5;
        float disease = treatment.r;
        float fertilizer = treatment.g;
        float angle = treatment.b * 6.2831853;
        float packedWork = treatment.a * 255.0;
        float noise = valueNoise(vWorldXZ * 1.65);
        vec3 tint = vec3(0.55, 0.48, 0.18);
        float alpha = 0.0;

        // Honest condition reads: localized olive stress, dark wet turf, pale
        // disease, and restrained treatment colour. Inspection strengthens the
        // signal without turning the entire hole into a diagnostic heat map.
        float stress = smoothstep(0.54, 0.28, health);
        alpha = max(alpha, stress * (0.08 + uInspect * 0.22));
        float dry = smoothstep(0.25, 0.10, moisture);
        tint = mix(tint, vec3(0.77, 0.61, 0.24), dry);
        alpha = max(alpha, dry * (0.10 + uInspect * 0.24));
        float wet = smoothstep(0.83, 0.98, moisture);
        tint = mix(tint, vec3(0.04, 0.17, 0.12), wet);
        alpha = max(alpha, wet * (0.11 + uInspect * 0.13));
        float blotch = smoothstep(0.32, 0.78, noise + disease * 0.62);
        tint = mix(tint, vec3(0.83, 0.78, 0.50), disease * blotch);
        alpha = max(alpha, disease * blotch * (0.33 + uInspect * 0.24));
        float overFeed = smoothstep(0.74, 1.0, fertilizer);
        tint = mix(tint, vec3(0.22, 0.42, 0.10), overFeed);
        alpha = max(alpha, overFeed * uInspect * 0.20);

        // Surface-aware overgrowth is visible at a distance as a soft darker
        // cast. Targets are green/fringe/tee/fairway/rough/native in millimetres.
        float targetMm = surface < 1.5 ? 4.0
          : surface < 2.5 ? 8.0
          : surface < 3.5 ? 10.0
          : surface < 4.5 ? 14.0
          : surface < 5.5 ? 45.0
          : 90.0;
        if (surface < 6.5) {
          float overgrown = smoothstep(targetMm + 3.0, targetMm + 17.0, heightMm);
          tint = mix(tint, vec3(0.07, 0.22, 0.045), overgrown * 0.7);
          alpha = max(alpha, overgrown * uInspect * 0.14);
        }

        if (surface < 6.5 && packedWork >= 127.5) {
          float quality = clamp((packedWork - 128.0) / 127.0, 0.0, 1.0);
          vec2 direction = vec2(cos(angle), sin(angle));
          float stripe = sin(dot(vWorldXZ, direction) * 3.14159265);
          vec3 stripeTint = stripe > 0.0 ? vec3(0.055, 0.17, 0.035) : vec3(0.27, 0.42, 0.12);
          tint = stripeTint;
          alpha = max(alpha, 0.045 + quality * 0.055);
        } else if (surface > 6.5) {
          float smoothness = treatment.a;
          float rakeLine = smoothstep(0.62, 0.98, abs(sin(vWorldXZ.x * 10.5 + vWorldXZ.y * 1.3)));
          tint = mix(tint, vec3(0.84, 0.70, 0.42), rakeLine * smoothness);
          alpha = max(alpha, rakeLine * smoothness * 0.06);
        }

        alpha = clamp(alpha, 0.0, 0.58);
        if (alpha < 0.012) discard;
        gl_FragColor = vec4(clamp(tint, 0.0, 1.0), alpha);
      }
    `,
  });
  const maintenanceOverlay = new THREE.Mesh(maintenanceOverlayGeo, maintenanceOverlayMat);
  maintenanceOverlay.name = 'Course maintenance condition overlay';
  maintenanceOverlay.position.set(
    maintenanceTextures.worldMin.x + maintenanceTextures.worldSize.x / 2,
    0,
    maintenanceTextures.worldMin.y + maintenanceTextures.worldSize.y / 2,
  );
  maintenanceOverlay.renderOrder = 2;
  maintenanceOverlay.receiveShadow = false;
  maintenanceOverlay.castShadow = false;
  scene.add(maintenanceOverlay);

  function rebuildMaintenanceOverlayHeights() {
    // During function initialization the terrain can be rebuilt before this
    // const exists only in theory; every actual rebuild happens after setup.
    if (!maintenanceOverlayGeo) return;
    const position = maintenanceOverlayGeo.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) + maintenanceOverlay.position.x;
      const z = position.getZ(i) + maintenanceOverlay.position.z;
      position.setY(i, heightAt(x, z) + 0.028);
    }
    position.needsUpdate = true;
    maintenanceOverlayGeo.computeBoundingSphere();
  }

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
        sunColor: 0xcbd3c1, // muted specular: low angles read as water, never white ice
        waterColor: 0x34777d, // restrained golf-course blue-green
        distortionScale: 2.7,
        alpha: 0.95,
        fog: !!scene.fog,
      });
      guardCourseWaterReflection(water);
      water.material.uniforms.size.value = 5.5; // ripple scale
      // Water addon multiplies the reflection into its own colour; without a
      // floor a tree-shaded pond reflects dark canopy and reads BLACK. Keep a
      // restrained reflection range around waterColor as well: the bright-sky
      // half of a pond otherwise meets the bank reflection in a hard diagonal
      // that reads like a triangulation seam from the editor cameras.
      water.material.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          'gl_FragColor = vec4( outgoingLight, alpha );',
          `vec3 courseReflection = min( outgoingLight, waterColor * 1.25 + vec3( 0.05 ) );
          gl_FragColor = vec4( max( mix( waterColor * 0.84, courseReflection, 0.18 ), waterColor * 0.58 ), alpha );`,
        );
      };
      water.position.set(cx, level, cz);
      const renderReflection = water.onBeforeRender;
      const reflectionState = {
        lastAt: -Infinity,
        position: new THREE.Vector3(Infinity, Infinity, Infinity),
        quaternion: new THREE.Quaternion(),
      };
      water.onBeforeRender = function budgetedWaterReflection(renderContext, renderScene, renderCamera, ...args) {
        const inside = !!clubhouseApi?.isInside(renderCamera.position.x, renderCamera.position.z);
        const positionDeltaSq = reflectionState.position.distanceToSquared(renderCamera.position);
        const quaternionDot = reflectionState.quaternion.dot(renderCamera.quaternion);
        if (!shouldRefreshPlanarReflection({
          overrideMaterial: !!renderScene.overrideMaterial,
          inside,
          now: time,
          lastAt: reflectionState.lastAt,
          positionDeltaSq,
          quaternionDot,
        })) return;
        reflectionState.lastAt = time;
        reflectionState.position.copy(renderCamera.position);
        reflectionState.quaternion.copy(renderCamera.quaternion);
        renderReflection.call(this, renderContext, renderScene, renderCamera, ...args);
      };
      scene.add(water);
      waterMeshes.push(water);
    }
  }

  // --- trees --------------------------------------------------------------------------------
  // Placed trees come from course.objects — the editor's (and the generator's)
  // INTENTIONAL planting. Only the boundary forest outside the property line is
  // procedural: a deep hash ring that fades with distance and closes the horizon.
  let treeGroup = null;
  let activeFloraAssets = null;
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
    bush_round: 'shrub_round', bush_flower: 'shrub_flower', hedge: 'hedge_a', flowers: 'flower_bed_a',
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
      const wx = worldX(o.x);
      const wz = worldZ(o.y);
      if (suppressesCourseGroundCoverAt(wx, wz)) continue;
      spots.push({ obj: o, id, x: o.x, y: o.y });
    }
    // boundary forest ring (outside the property line), density fading outward
    for (let y = -RING_DEPTH; y < H + RING_DEPTH; y++) {
      for (let x = -RING_DEPTH; x < W + RING_DEPTH; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) continue;
        const d = Math.max(x < 0 ? -x : x - (W - 1), y < 0 ? -y : y - (H - 1), 1);
        const p = d <= 3 ? 0.42 : d <= 8 ? 0.27 : d <= 16 ? 0.14 : 0.07;
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

  // A — WHICH LAZY BUILDER COSTS THE PLAYER'S FIRST STEP?
  //
  // Measured with tools/qa/perf-repeat.mjs: the first 'w' hold costs ~375 ms
  // (371..387 across six runs, a 16 ms band), while the second and third
  // movements cost 84 ms and 34 ms. Something builds once, on the first step.
  //
  // Six builders construct on first need and any of them is a plausible story.
  // Six plausible stories is exactly how the tool-beat thread burned eight
  // hypotheses, so this measures instead of guessing: each builder is wrapped
  // once, and its FIRST invocation records name, duration and call order.
  //
  // Function declarations hoist and their bindings are mutable, so all six can
  // be wrapped here in one place rather than edited at six sites.
  //
  // The cost is one closure per builder and a single boolean test per call
  // after the first. Read it with `walk.lazyBuildTimings()`.
  const lazyBuildTimings = [];
  const timeFirstCall = (name, fn) => function timed(...args) {
    if (timed.__done) return fn.apply(this, args);
    timed.__done = true;
    const t0 = performance.now();
    try {
      return fn.apply(this, args);
    } finally {
      lazyBuildTimings.push({
        name, ms: +(performance.now() - t0).toFixed(1), order: lazyBuildTimings.length,
      });
    }
  };
  ensureFarEvergreenFloraAsset = timeFirstCall('ensureFarEvergreenFloraAsset', ensureFarEvergreenFloraAsset);
  ensureGolfCartRuntimeLights = timeFirstCall('ensureGolfCartRuntimeLights', ensureGolfCartRuntimeLights);
  ensureGolfFacilities = timeFirstCall('ensureGolfFacilities', ensureGolfFacilities);
  ensureGolferVisual = timeFirstCall('ensureGolferVisual', ensureGolferVisual);
  ensurePartyVisual = timeFirstCall('ensurePartyVisual', ensurePartyVisual);
  ensureTractorModel = timeFirstCall('ensureTractorModel', ensureTractorModel);

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
        // Boundary trees grow in coherent eight-cell stands. Most members use
        // the stand's primary species, with a restrained local secondary mix,
        // instead of changing species at every trunk like visual confetti.
        const standX = Math.floor(s.x / 8);
        const standY = Math.floor(s.y / 8);
        const stand = treeHash(standX * 17 + 31, standY * 19 + 17);
        const pool = stand >= 0.64 ? FLORA_PINE : FLORA_FOREST;
        const primary = pool[
          Math.floor(treeHash(standX * 29 + 57, standY * 31 + 5) * pool.length) % pool.length
        ];
        const local = treeHash(Math.round(s.x) + 71, Math.round(s.y) + 43);
        sourceId = local < 0.72
          ? primary
          : pool[
            Math.floor(treeHash(Math.round(s.x) + 57, Math.round(s.y) + 5) * pool.length)
              % pool.length
          ];
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
      const brightness = 0.95 + treeHash(hx + 13, hy + 29) * 0.12;
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
        lodTier: null,
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
      if (FLORA_LOD_PROXY_BY_ID[record.sourceId]) {
        reserve(floraLodChoice(record.sourceId, 0, null, {
          boundary: record.boundary,
          tree: record.tree,
        }));
        if (!record.boundary) {
          reserve(floraLodChoice(record.sourceId, FLORA_LOD_DEFAULTS.heroExitYd + 1, 'medium'));
        }
      }
    }

    const renderBuckets = new Map();
    for (const spec of bucketSpecs.values()) {
      const variant = assets.get(spec.choice.renderId);
      if (!variant) continue;
      const isReed = ['reed', 'groundcover', 'palm', 'flowerbed'].includes(variant.kind);
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
        const choice = floraLodChoice(record.sourceId, distance, record.lodTier, {
          boundary: record.boundary,
          tree: record.tree,
        });
        record.lodTier = choice.tier;
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
        mode: 'dynamic-near-medium-far',
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
        windMaterials: floraWindUniforms.size,
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
        activeFloraAssets = assets;
        ghostType = null; // the next hover upgrades any early fallback to the authored model
        rebuildFloraFromModels(assets);
      } else {
        activeFloraAssets = null;
        console.warn('flora models unavailable - procedural fallback in use');
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
  const GRASS_COUNT = 12000; // bounded near-camera sward; at most ~240k blade tris
  const GRASS_RADIUS = 12; // yards from camera; texture carries the middle distance
  let grassMesh = null;
  let grassActive = false;

  function bladeGeometry() {
    // One instance is a small patch, not one stem. Five irregular offset
    // ribbons fill the dense lattice without the old seven-point star grammar.
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
      emissive: 0x14230d, emissiveIntensity: 0.04,
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
          // slightly darker at the base, brighter tips - depth in the sward
          diffuseColor.rgb *= mix(0.97, 1.04, vBladeH);`);
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
        if (suppressesCourseGroundCoverAt(wx, wz)) continue;
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
            if (parts.length) ghostType = null;
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
      if (suppressesCourseGroundCoverAt(worldX(o.x), worldZ(o.y))) continue;
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
    asphalt: () => new THREE.MeshStandardMaterial({ map: texAsphalt, color: 0xb0a58e, roughness: 0.98 }),
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

  // Constructed pop-up sprinkler heads are deliberately low-profile but still
  // readable from the player camera. Two instanced meshes keep large layouts
  // cheap; coverage remains simulation data rather than dozens of effect objects.
  let irrigationGroup = null;
  function rebuildIrrigation() {
    if (irrigationGroup) {
      scene.remove(irrigationGroup);
      irrigationGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    irrigationGroup = new THREE.Group();
    const heads = course.irrigationHeads || [];
    if (!heads.length) {
      scene.add(irrigationGroup);
      return;
    }
    const body = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x343a35, roughness: 0.72, metalness: 0.18 }),
      heads.length,
    );
    const cap = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.025, 12),
      new THREE.MeshStandardMaterial({ color: 0xb39a59, roughness: 0.4, metalness: 0.48 }),
      heads.length,
    );
    const matrix = new THREE.Matrix4();
    for (let n = 0; n < heads.length; n++) {
      const head = heads[n];
      const x = worldX(head.x);
      const z = worldZ(head.y);
      const y = heightAt(x, z);
      matrix.makeTranslation(x, y + 0.06, z);
      body.setMatrixAt(n, matrix);
      matrix.makeTranslation(x, y + 0.13, z);
      cap.setMatrixAt(n, matrix);
    }
    body.receiveShadow = true;
    cap.castShadow = true;
    irrigationGroup.add(body, cap);
    scene.add(irrigationGroup);
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
    const lines = String(text).split('\n').slice(0, 2);
    let fittedFont = lines.length > 1 ? Math.min(fontPx, 38) : fontPx;
    c2.font = `700 ${fittedFont}px "Segoe UI", sans-serif`;
    while (fittedFont > 18 && Math.max(...lines.map((line) => c2.measureText(line).width)) > w - 44) {
      fittedFont -= 2;
      c2.font = `700 ${fittedFont}px "Segoe UI", sans-serif`;
    }
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    if (lines.length === 1) c2.fillText(lines[0], w / 2, 68);
    else {
      c2.fillText(lines[0], w / 2, 48);
      c2.font = `600 ${Math.max(16, fittedFont - 5)}px "Segoe UI", sans-serif`;
      c2.fillText(lines[1], w / 2, 87);
    }
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

  function updateGolfersLegacy(dt, st) {
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
      if (!cartHidden) pushFrom(tractorPark.x, tractorPark.z, 2.6);
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

  // Canonical live-play presentation. The legacy random walkers above remain
  // as readable history for the moment, but are never called: identities,
  // positions, phases, routes and shots below all come from state.golfDay.
  const METERS_TO_YARDS = 1.09361;
  const TRAVEL_STATES = new Set([
    'traveling-to-practice', 'traveling-to-starter', 'called-to-tee', 'traveling-to-ball', 'traveling-next-hole',
    'returning-cart', 'returning-scorecard', 'leaving-property',
  ]);
  const golferVisuals = new Map();
  const partyVisuals = new Map();
  const serviceCartVisuals = new Map();
  let playerGolfCartVisual = null;
  const golferVisualPool = [];
  const cartVisualPools = new Map(GOLF_CART_TIERS.map((tier) => [tier.id, []]));
  const bagVisualPool = [];
  const liveGolfColliders = [];
  const facilityGroup = new THREE.Group();
  const liveCartGroup = new THREE.Group();
  const liveBallGroup = new THREE.Group();
  facilityGroup.name = 'GolfFacilities';
  liveCartGroup.name = 'LiveGolfCarts';
  liveBallGroup.name = 'LiveGolfBalls';
  scene.add(facilityGroup, liveCartGroup, liveBallGroup);
  let gameplayKit = null;
  const golfCartTemplates = new Map();
  let legacyGolfCartTemplate = null;
  let facilityRevision = null;
  let starterCharacter = null;
  let starterDisplaySprite = null;
  let starterDisplayPoint = null;
  let starterDisplayKey = '';
  let facilityColliderRefs = [];
  let facilityWalkPropRefs = [];
  const golfCartWorldPoint = new THREE.Vector3();
  const golfCartWorldPointB = new THREE.Vector3();
  const golfCartWorldQuaternion = new THREE.Quaternion();
  const golfCartWorldForward = new THREE.Vector3();
  const golfCartLocalPlayer = new THREE.Vector3();
  const golfCartColliderCorner = new THREE.Vector3();
  const GOLF_CART_LOD0_DISTANCE_YD = 12;
  const GOLF_CART_LOD1_DISTANCE_YD = 72;
  const GOLF_CART_SEAT_ORDER = [
    'Seat_Driver',
    'Seat_Passenger_Front',
    'Seat_Passenger_Middle_Left',
    'Seat_Passenger_Middle_Right',
    'Seat_Passenger_Rear_Left',
    'Seat_Passenger_Rear_Right',
  ];

  // Slightly presentation-scaled so a real 1.68-inch ball remains readable at
  // first-person fairway distances in the game's stylized rendering.
  const liveBallGeometry = new THREE.SphereGeometry(0.1, 12, 8);
  const liveBallMaterial = new THREE.MeshStandardMaterial({
    color: 0xfffbed,
    emissive: 0x5f5428,
    emissiveIntensity: 0.28,
    roughness: 0.32,
  });
  const liveBallInstances = new THREE.InstancedMesh(liveBallGeometry, liveBallMaterial, 24);
  liveBallInstances.castShadow = true;
  liveBallInstances.count = 0;
  liveBallInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  liveBallGroup.add(liveBallInstances);
  const liveBallTrailPositions = new Float32Array(24 * 6);
  const liveBallTrailGeometry = new THREE.BufferGeometry();
  liveBallTrailGeometry.setAttribute('position', new THREE.BufferAttribute(liveBallTrailPositions, 3));
  liveBallTrailGeometry.setDrawRange(0, 0);
  const liveBallTrailMaterial = new THREE.LineBasicMaterial({
    color: 0xfff1b6,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    toneMapped: false,
  });
  const liveBallTrails = new THREE.LineSegments(liveBallTrailGeometry, liveBallTrailMaterial);
  liveBallTrails.frustumCulled = false;
  liveBallGroup.add(liveBallTrails);
  const presentationBalls = [];
  let lastPresentationSequence = 0;
  const liveBallMatrix = new THREE.Matrix4();

  const identityHash = (value) => {
    const text = String(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  function prepareLiveAsset(root) {
    root.traverse((object) => {
      // Some legacy GLBs use an extras string such as `pivot: floor-center`
      // as semantic metadata. The customized r185 GLTF loader interprets any
      // `pivot` extra as a numeric Vector3, producing string components and a
      // NaN transform. Preserve real numeric pivots and discard only malformed
      // loader pivots before a live prop is positioned or cloned.
      if (object.pivot && ![object.pivot.x, object.pivot.y, object.pivot.z].every(Number.isFinite)) {
        object.pivot = null;
      }
      if (object.name.startsWith('COLLIDER_') || object.name.startsWith('COL_')) object.visible = false;
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return root;
  }

  function golfCartLodLevel(object) {
    let cursor = object;
    while (cursor) {
      const explicit = Number(cursor.userData?.lod_level);
      if (Number.isFinite(explicit)) return explicit;
      const match = /^LOD([012])(?:_|$)/.exec(cursor.name || '');
      if (match) return Number(match[1]);
      cursor = cursor.parent;
    }
    return 0;
  }

  const golfCartArticulationPattern = /^(?:Wheel_(?:FL|FR|RL|RR)|SteeringPivot_(?:FL|FR)|SteeringWheel|BatteryCompartment_Lid|Windshield_Upper|StorageLid_Rear|Door_(?:FL|FR|ML|MR|RL|RR))$/;

  // The authored carts intentionally use many solid-color PBR materials. Keep
  // their exact base color, roughness, and metalness per vertex so opaque parts
  // can share one runtime material inside each static or articulated pivot.
  // Transparent glass and emissive/light materials remain independent.
  const golfCartVertexPbrMaterial = new THREE.MeshStandardMaterial({
    name: 'M_GF_RuntimeVertexPBR',
    color: 0xffffff,
    roughness: 1,
    metalness: 1,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  golfCartVertexPbrMaterial.customProgramCacheKey = () => 'golf-cart-vertex-pbr-v1';
  golfCartVertexPbrMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 golfCartPbr;\nvarying vec2 vGolfCartPbr;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvGolfCartPbr = golfCartPbr;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGolfCartPbr;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp( vGolfCartPbr.x, 0.04, 1.0 );')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp( vGolfCartPbr.y, 0.0, 1.0 );');
  };

  function golfCartCanUseVertexPbr(material) {
    if (!material?.isMeshStandardMaterial || material.transparent || material.opacity < 0.999) return false;
    if (material.alphaTest > 0 || material.side !== THREE.DoubleSide) return false;
    if ((material.emissive?.getHex?.() || 0) !== 0) return false;
    return ![
      material.map,
      material.alphaMap,
      material.aoMap,
      material.bumpMap,
      material.displacementMap,
      material.emissiveMap,
      material.lightMap,
      material.metalnessMap,
      material.normalMap,
      material.roughnessMap,
    ].some(Boolean);
  }

  function golfCartBakeVertexPbr(geometry, material) {
    const count = geometry.attributes.position?.count || 0;
    const colors = new Float32Array(count * 3);
    const pbr = new Float32Array(count * 2);
    const color = material.color || new THREE.Color(0xffffff);
    const roughness = THREE.MathUtils.clamp(Number(material.roughness ?? 1), 0.04, 1);
    const metalness = THREE.MathUtils.clamp(Number(material.metalness ?? 0), 0, 1);
    for (let index = 0; index < count; index++) {
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      pbr[index * 2] = roughness;
      pbr[index * 2 + 1] = metalness;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('golfCartPbr', new THREE.BufferAttribute(pbr, 2));
    return geometry;
  }

  function golfCartArticulationRoot(object, root) {
    let cursor = object;
    while (cursor && cursor !== root) {
      if (golfCartArticulationPattern.test(cursor.name || '')) return cursor;
      cursor = cursor.parent;
    }
    return root;
  }

  function golfCartGeometrySignature(geometry) {
    const attributes = Object.entries(geometry?.attributes || {})
      .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:${attribute.array?.constructor?.name || ''}`)
      .sort()
      .join(',');
    return `${geometry?.index ? geometry.index.array?.constructor?.name || 'indexed' : 'plain'}|${attributes}`;
  }

  // Blender keeps every functional part and anchor explicit. At runtime the
  // static panels are collapsed by material/LOD (and movable subassemblies are
  // collapsed only inside their own pivot), preserving authored controls while
  // avoiding a draw call for every seam, lamp housing, and trim strip.
  function batchGolfCartTemplate(root) {
    root.updateMatrixWorld(true);
    const buckets = new Map();
    root.traverse((object) => {
      if (!object.isMesh || !object.geometry || object.isSkinnedMesh) return;
      if (object.name.startsWith('COL_') || object.name.startsWith('COLLIDER_')) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.length !== 1 || !materials[0]) return;
      if (Object.keys(object.geometry.morphAttributes || {}).length) return;
      const owner = golfCartArticulationRoot(object, root);
      const lod = golfCartLodLevel(object);
      const sourceMaterial = materials[0];
      const vertexPbr = golfCartCanUseVertexPbr(sourceMaterial);
      const signature = golfCartGeometrySignature(object.geometry);
      const material = vertexPbr ? golfCartVertexPbrMaterial : sourceMaterial;
      const indicatorSide = /Indicator_(?:FRONT|REAR)_([LR])/.exec(object.name || '')?.[1] || null;
      const key = `${owner.uuid}|${lod}|${material.uuid}|${signature}|${indicatorSide || ''}`;
      if (!buckets.has(key)) buckets.set(key, {
        owner, lod, material, vertexPbr, indicatorSide, entries: [],
      });
      buckets.get(key).entries.push({ object, sourceMaterial });
    });

    let sourceMeshes = 0;
    let batchedMeshes = 0;
    for (const bucket of buckets.values()) {
      if (bucket.entries.length < 2) continue;
      bucket.owner.updateMatrixWorld(true);
      const ownerInverse = bucket.owner.matrixWorld.clone().invert();
      const geometries = bucket.entries.map(({ object, sourceMaterial }) => {
        const relative = ownerInverse.clone().multiply(object.matrixWorld);
        const geometry = object.geometry.clone().applyMatrix4(relative);
        return bucket.vertexPbr ? golfCartBakeVertexPbr(geometry, sourceMaterial) : geometry;
      });
      const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
      if (!merged) {
        for (const geometry of geometries) geometry.dispose();
        continue;
      }
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.name = `LOD${bucket.lod}_Batched_${bucket.material.name || batchedMeshes + 1}`;
      mesh.userData.lod_level = bucket.lod;
      mesh.userData.golfCartLod = bucket.lod;
      if (bucket.indicatorSide) mesh.userData.golfCartIndicatorSide = bucket.indicatorSide;
      mesh.userData.golfCartCastsShadow = !/^Door_(?:FL|FR|ML|MR|RL|RR)$/.test(bucket.owner.name || '')
        && bucket.entries.some(({ sourceMaterial }) => (
        /(?:Canopy|PowderCoatedFrame)/.test(sourceMaterial.name || '')
        ));
      mesh.castShadow = mesh.userData.golfCartCastsShadow;
      mesh.receiveShadow = bucket.entries.some(({ object }) => object.receiveShadow);
      bucket.owner.add(mesh);
      for (const { object } of bucket.entries) object.removeFromParent();
      sourceMeshes += bucket.entries.length;
      batchedMeshes++;
    }
    root.userData.golfCartBatch = {
      sourceMeshes,
      batchedMeshes,
      removedDrawCalls: Math.max(0, sourceMeshes - batchedMeshes),
    };
    root.updateMatrixWorld(true);
    return root;
  }

  function setGolfCartLod(root, level) {
    if (!root) return;
    const rig = root.userData.golfCartRig;
    if (rig && rig.lod === level) return;
    root.traverse((object) => {
      if (!object.isMesh) return;
      if (object.name.startsWith('COL_') || object.name.startsWith('COLLIDER_')) {
        object.visible = false;
        return;
      }
      object.visible = golfCartLodLevel(object) === level;
    });
    if (rig) rig.lod = level;
  }

  function captureGolfCartRig(root, tierId) {
    const rig = {
      tierId,
      wheels: [],
      steer: [],
      steeringWheel: null,
      steeringWheelBase: null,
      wheelRadiusYd: 0.32,
      wheelRoll: 0,
      steerVisual: 0,
      lod: -1,
      hinges: [],
      anchors: new Map(),
      colliders: [],
      seatAnchors: [],
      bagSlots: [],
      lightMaterials: {
        head: new Set(),
        tail: new Set(),
        indicator: { left: new Set(), right: new Set() },
      },
      runtimeLights: null,
      lightsOn: false,
      braking: false,
      indicatorSide: 0,
      indicatorPhase: 0,
      autoBatteryOpen: false,
    };
    const clonedLightMaterials = new Map();
    root.traverse((object) => {
      const name = object.name || '';
      if (/^(?:SEAT_ANCHOR_|FOOT_ANCHOR_|ENTRY_POINT_|EXIT_POINT_|GOLF_BAG_SLOT_|DRIVER_CAMERA_ANCHOR$|VEHICLE_CAMERA_ANCHOR$|LIGHT_(?:HEAD|TAIL|BRAKE|INDICATOR_(?:FRONT|REAR))_|PARKING_ANCHOR$|VEHICLE_(?:CENTER|FOOTPRINT)$|STORAGE_ZONE_|CARGO_ZONE_|SERVICE_POINT_)/.test(name)) {
        rig.anchors.set(name, object);
      }
      if (object.isMesh && (name.startsWith('COL_') || name.startsWith('COLLIDER_'))) rig.colliders.push(object);
      if (object.isMesh) {
        const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
        let replaced = false;
        const indicatorSide = object.userData?.golfCartIndicatorSide
          || /Indicator_(?:FRONT|REAR)_([LR])/.exec(name)?.[1]
          || null;
        const instanceMaterials = sourceMaterials.map((material) => {
          if (!material || !/(?:HeadlightLens|TailLens|IndicatorLens)/.test(material.name || '')) return material;
          const materialKey = /IndicatorLens/.test(material.name || '') && indicatorSide
            ? `${material.uuid}:${indicatorSide}`
            : material.uuid;
          let clone = clonedLightMaterials.get(materialKey);
          if (!clone) {
            clone = material.clone();
            clone.userData.golfCartLightOff = {
              color: clone.color?.getHex?.() ?? 0,
              emissive: clone.emissive?.getHex?.() ?? 0,
              emissiveIntensity: Number(clone.emissiveIntensity || 0),
            };
            clonedLightMaterials.set(materialKey, clone);
          }
          replaced = true;
          if (/HeadlightLens/.test(clone.name || '')) rig.lightMaterials.head.add(clone);
          else if (/TailLens/.test(clone.name || '')) rig.lightMaterials.tail.add(clone);
          else if (indicatorSide === 'L') rig.lightMaterials.indicator.left.add(clone);
          else if (indicatorSide === 'R') rig.lightMaterials.indicator.right.add(clone);
          return clone;
        });
        if (replaced) object.material = Array.isArray(object.material) ? instanceMaterials : instanceMaterials[0];
      }
      if (/^Wheel_(?:FL|FR|RL|RR)$/.test(name)) {
        rig.wheels.push({ node: object, baseX: object.rotation.x });
        const authoredRadius = Number(object.userData?.wheel_radius_m);
        if (Number.isFinite(authoredRadius) && authoredRadius > 0) rig.wheelRadiusYd = authoredRadius * METERS_TO_YARDS;
      } else if (/^SteeringPivot_(?:FL|FR)$/.test(name)) {
        rig.steer.push({ node: object, baseY: object.rotation.y });
      } else if (name === 'SteeringWheel') {
        rig.steeringWheel = object;
        rig.steeringWheelBase = object.rotation.clone();
      }
      if (/^(?:BatteryCompartment_Lid|Windshield_Upper|StorageLid_Rear|Door_(?:FL|FR|ML|MR|RL|RR))$/.test(object.name || '')) {
        const axis = String(object.userData?.animation_axis || 'local_x').replace(/^local_/, '');
        const openDegrees = Number(object.userData?.open_angle_degrees || 0);
        if (['x', 'y', 'z'].includes(axis) && Number.isFinite(openDegrees)) {
          rig.hinges.push({
            node: object,
            name: object.name,
            axis,
            base: object.rotation[axis],
            openRadians: THREE.MathUtils.degToRad(openDegrees),
            open: false,
            amount: 0,
          });
        }
      }
    });
    rig.seatAnchors = GOLF_CART_SEAT_ORDER
      .map((suffix) => rig.anchors.get(`SEAT_ANCHOR_${suffix}`))
      .filter(Boolean);
    rig.bagSlots = [...rig.anchors.entries()]
      .filter(([name]) => name.startsWith('GOLF_BAG_SLOT_'))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, node]) => node);
    root.userData.golfCartTierId = tierId;
    root.userData.golfCartRig = rig;
    setGolfCartLights(root, false, false);
    setGolfCartLod(root, 0);
    return rig;
  }

  function golfCartAnchor(root, name) {
    return root?.userData?.golfCartRig?.anchors?.get(name) || null;
  }

  function golfCartAnchorWorld(root, name, target = golfCartWorldPoint) {
    const anchor = golfCartAnchor(root, name);
    if (!anchor) return null;
    root.updateMatrixWorld(true);
    anchor.getWorldPosition(target);
    return target;
  }

  function ensureGolfCartRuntimeLights(root) {
    const rig = root?.userData?.golfCartRig;
    if (!rig || rig.runtimeLights) return rig?.runtimeLights || null;
    const runtimeLights = { head: [], tail: [] };
    for (const side of ['L', 'R']) {
      const anchor = golfCartAnchor(root, `LIGHT_HEAD_${side}`);
      if (!anchor) continue;
      const light = new THREE.SpotLight(0xffedc2, 0, 20, 0.42, 0.58, 1.8);
      light.name = `RuntimeHeadlight_${side}`;
      light.position.set(0, 0, 0);
      light.castShadow = false;
      const target = new THREE.Object3D();
      target.name = `RuntimeHeadlightTarget_${side}`;
      target.position.set(0, 0, -9);
      anchor.add(light, target);
      light.target = target;
      runtimeLights.head.push(light);
    }
    for (const side of ['L', 'R']) {
      const anchor = golfCartAnchor(root, `LIGHT_TAIL_${side}`);
      if (!anchor) continue;
      const light = new THREE.PointLight(0xe33424, 0, 3.0, 2);
      light.name = `RuntimeTailLight_${side}`;
      light.position.set(0, 0, 0);
      light.castShadow = false;
      anchor.add(light);
      runtimeLights.tail.push(light);
    }
    rig.runtimeLights = runtimeLights;
    return runtimeLights;
  }

  function setGolfCartLights(root, lightsOn, braking = false, indicatorSide = 0, dt = 0) {
    const rig = root?.userData?.golfCartRig;
    if (!rig) return false;
    rig.lightsOn = Boolean(lightsOn);
    rig.braking = Boolean(braking);
    const nextIndicatorSide = Math.sign(Number(indicatorSide) || 0);
    if (nextIndicatorSide !== rig.indicatorSide) rig.indicatorPhase = 0;
    rig.indicatorSide = nextIndicatorSide;
    rig.indicatorPhase = nextIndicatorSide
      ? (rig.indicatorPhase + Math.max(0, Number(dt) || 0)) % 0.8
      : 0;
    for (const material of rig.lightMaterials.head) {
      material.emissive?.setHex(rig.lightsOn ? 0xffdf9e : 0x000000);
      material.emissiveIntensity = rig.lightsOn ? 0.78 : 0;
    }
    for (const material of rig.lightMaterials.tail) {
      material.emissive?.setHex(rig.lightsOn || rig.braking ? 0xff2418 : 0x000000);
      material.emissiveIntensity = rig.braking ? 1.8 : rig.lightsOn ? 0.45 : 0;
    }
    const indicatorOn = rig.indicatorSide !== 0 && rig.indicatorPhase < 0.50;
    for (const [side, materials] of [
      [1, rig.lightMaterials.indicator.left],
      [-1, rig.lightMaterials.indicator.right],
    ]) {
      const active = indicatorOn && rig.indicatorSide === side;
      for (const material of materials) {
        material.color?.setHex(active ? 0xff9b24 : 0x5a2508);
        material.emissive?.setHex(active ? 0xff8512 : 0x000000);
        material.emissiveIntensity = active ? 1.9 : 0;
      }
    }
    const runtimeLights = rig.lightsOn || rig.braking
      ? ensureGolfCartRuntimeLights(root)
      : rig.runtimeLights;
    for (const light of runtimeLights?.head || []) light.intensity = rig.lightsOn ? 18 : 0;
    for (const light of runtimeLights?.tail || []) light.intensity = rig.braking ? 0.12 : rig.lightsOn ? 0.015 : 0;
    return rig.lightsOn;
  }

  function groundGolfCart(root, x, z, yaw) {
    const rig = root?.userData?.golfCartRig;
    if (!root || !rig?.wheels?.length) {
      if (root) {
        root.position.set(x, heightAt(x, z), z);
        root.rotation.set(0, yaw, 0, 'YXZ');
      }
      return;
    }

    root.position.set(x, 0, z);
    root.rotation.set(0, yaw, 0, 'YXZ');
    root.updateMatrixWorld(true);
    let front = 0;
    let frontCount = 0;
    let rear = 0;
    let rearCount = 0;
    let left = 0;
    let leftCount = 0;
    let right = 0;
    let rightCount = 0;
    for (const wheel of rig.wheels) {
      wheel.node.getWorldPosition(golfCartWorldPoint);
      const terrainY = heightAt(golfCartWorldPoint.x, golfCartWorldPoint.z);
      if (/_F[LR]$/.test(wheel.node.name)) {
        front += terrainY;
        frontCount++;
      } else {
        rear += terrainY;
        rearCount++;
      }
      if (/_L$/.test(wheel.node.name)) {
        left += terrainY;
        leftCount++;
      } else if (/_R$/.test(wheel.node.name)) {
        right += terrainY;
        rightCount++;
      }
    }
    const dimensions = golfCartTier(root.userData.golfCartTierId).dimensionsM;
    const wheelbaseYd = Math.max(1, dimensions[1] * METERS_TO_YARDS * 0.64);
    const trackYd = Math.max(0.8, dimensions[0] * METERS_TO_YARDS * 0.72);
    const frontY = frontCount ? front / frontCount : heightAt(x, z);
    const rearY = rearCount ? rear / rearCount : frontY;
    const leftY = leftCount ? left / leftCount : heightAt(x, z);
    const rightY = rightCount ? right / rightCount : leftY;
    const pitch = clamp(Math.atan2(frontY - rearY, wheelbaseYd), -0.22, 0.22);
    const roll = clamp(Math.atan2(rightY - leftY, trackYd), -0.22, 0.22);
    root.rotation.set(pitch, yaw, roll, 'YXZ');
    root.updateMatrixWorld(true);

    let requiredRootY = -Infinity;
    for (const wheel of rig.wheels) {
      wheel.node.getWorldPosition(golfCartWorldPoint);
      const terrainY = heightAt(golfCartWorldPoint.x, golfCartWorldPoint.z);
      requiredRootY = Math.max(
        requiredRootY,
        terrainY + Math.max(0.12, rig.wheelRadiusYd) - golfCartWorldPoint.y,
      );
    }
    root.position.y = Number.isFinite(requiredRootY) ? requiredRootY + 0.006 : heightAt(x, z);
    root.updateMatrixWorld(true);
  }

  function appendGolfCartWalkColliders(root, cartId) {
    const rig = root?.userData?.golfCartRig;
    if (!rig) return;
    root.updateMatrixWorld(true);
    for (const collider of rig.colliders) {
      if (!/^(?:COL_FrontBody|COL_RearBody|COL_Door_)/.test(collider.name || '')) continue;
      const geometry = collider.geometry;
      if (!geometry) continue;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      if (!bounds) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            golfCartColliderCorner.set(x, y, z).applyMatrix4(collider.matrixWorld);
            minX = Math.min(minX, golfCartColliderCorner.x);
            maxX = Math.max(maxX, golfCartColliderCorner.x);
            minZ = Math.min(minZ, golfCartColliderCorner.z);
            maxZ = Math.max(maxZ, golfCartColliderCorner.z);
          }
        }
      }
      if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
        liveGolfColliders.push({ minX, maxX, minZ, maxZ, cartId });
      }
    }
  }

  const golfCartSeatPoseScratch = { x: 0, y: 0, z: 0, yaw: 0, footY: 0 };
  function golfCartSeatPose(root, index, routeProgress = 0.5) {
    const rig = root?.userData?.golfCartRig;
    const seat = rig?.seatAnchors?.[index];
    if (!seat) return null;
    const suffix = seat.name.replace(/^SEAT_ANCHOR_/, '');
    seat.getWorldPosition(golfCartWorldPoint);
    seat.getWorldQuaternion(golfCartWorldQuaternion);
    golfCartWorldForward.set(0, 0, -1).applyQuaternion(golfCartWorldQuaternion);
    const pose = golfCartSeatPoseScratch;
    pose.x = golfCartWorldPoint.x;
    pose.y = golfCartWorldPoint.y - 0.98;
    pose.z = golfCartWorldPoint.z;
    pose.yaw = Math.atan2(golfCartWorldForward.x, golfCartWorldForward.z);
    const footLeft = rig.anchors.get(`FOOT_ANCHOR_L_${suffix}`);
    const footRight = rig.anchors.get(`FOOT_ANCHOR_R_${suffix}`);
    if (footLeft && footRight) {
      footLeft.getWorldPosition(golfCartWorldPointB);
      const leftY = golfCartWorldPointB.y;
      footRight.getWorldPosition(golfCartWorldPointB);
      pose.footY = (leftY + golfCartWorldPointB.y) * 0.5;
    } else pose.footY = pose.y;
    const transition = routeProgress < 0.1
      ? { anchor: rig.anchors.get(`ENTRY_POINT_${suffix}`), amount: clamp(routeProgress / 0.1, 0, 1) }
      : routeProgress > 0.9
        ? { anchor: rig.anchors.get(`EXIT_POINT_${suffix}`), amount: clamp((routeProgress - 0.9) / 0.1, 0, 1), exiting: true }
        : null;
    if (transition?.anchor) {
      transition.anchor.getWorldPosition(golfCartWorldPointB);
      const seatedAmount = transition.exiting ? 1 - transition.amount : transition.amount;
      pose.x = golfCartWorldPointB.x + (pose.x - golfCartWorldPointB.x) * seatedAmount;
      pose.y = golfCartWorldPointB.y + (pose.y - golfCartWorldPointB.y) * seatedAmount;
      pose.z = golfCartWorldPointB.z + (pose.z - golfCartWorldPointB.z) * seatedAmount;
    }
    return pose;
  }

  function configureGolfCartTemplate(root, tierId) {
    prepareLiveAsset(root);
    batchGolfCartTemplate(root);
    root.name = `GolfCartTemplate_${tierId}`;
    root.userData.golfCartTierId = tierId;
    root.traverse((object) => {
      if (!object.isMesh) return;
      object.userData.golfCartLod = golfCartLodLevel(object);
      object.visible = object.userData.golfCartLod === 0
        && !object.name.startsWith('COL_')
        && !object.name.startsWith('COLLIDER_');
      const materialName = (Array.isArray(object.material) ? object.material[0] : object.material)?.name || '';
      const articulationOwner = golfCartArticulationRoot(object, root);
      const allowsMovingShadow = articulationOwner === root
        || /^Wheel_(?:FL|FR|RL|RR)$/.test(articulationOwner.name || '');
      object.castShadow = allowsMovingShadow && (object.userData.golfCartCastsShadow
        ?? /(?:Canopy|PowderCoatedFrame)/.test(materialName));
    });
    return root;
  }

  function resetGolfCartRig(root) {
    const rig = root?.userData?.golfCartRig;
    if (!rig) return;
    for (const wheel of rig.wheels) wheel.node.rotation.x = wheel.baseX;
    for (const pivot of rig.steer) pivot.node.rotation.y = pivot.baseY;
    if (rig.steeringWheel && rig.steeringWheelBase) rig.steeringWheel.rotation.copy(rig.steeringWheelBase);
    for (const hinge of rig.hinges) {
      hinge.open = false;
      hinge.amount = 0;
      hinge.node.rotation[hinge.axis] = hinge.base;
    }
    rig.autoBatteryOpen = false;
    setGolfCartLights(root, false, false);
    rig.wheelRoll = 0;
    rig.steerVisual = 0;
    rig.lod = -1;
    setGolfCartLod(root, 0);
  }

  function acquireGolfCart(tierId) {
    const desiredTier = golfCartTier(tierId).id;
    const exactPool = cartVisualPools.get(desiredTier);
    if (exactPool?.length) {
      const pooled = exactPool.pop();
      resetGolfCartRig(pooled);
      pooled.visible = true;
      return pooled;
    }
    let sourceTier = desiredTier;
    let template = golfCartTemplates.get(desiredTier);
    if (!template) {
      sourceTier = golfCartTemplates.has('basic') ? 'basic' : null;
      template = sourceTier ? golfCartTemplates.get(sourceTier) : legacyGolfCartTemplate;
    }
    if (!template) return null;
    const root = template.clone(true);
    const authored = sourceTier != null;
    root.scale.setScalar(authored ? METERS_TO_YARDS : 2.6);
    captureGolfCartRig(root, sourceTier || 'legacy');
    root.name = `GolfCart_${sourceTier || 'legacy'}`;
    return root;
  }

  function releaseGolfCart(root) {
    if (!root) return;
    root.removeFromParent();
    root.visible = false;
    resetGolfCartRig(root);
    const tierId = root.userData.golfCartTierId;
    const pool = cartVisualPools.get(tierId);
    if (pool && pool.length < 6) pool.push(root);
  }

  function animateGolfCart(root, travel, turnDelta, lod) {
    const rig = root?.userData?.golfCartRig;
    if (!rig) return;
    if (Math.abs(travel) > 0.0001) rig.wheelRoll -= travel / Math.max(0.2, rig.wheelRadiusYd);
    for (const wheel of rig.wheels) wheel.node.rotation.x = wheel.baseX + rig.wheelRoll;
    rig.steerVisual += (clamp(turnDelta * 2.4, -0.48, 0.48) - rig.steerVisual) * 0.24;
    for (const pivot of rig.steer) pivot.node.rotation.y = pivot.baseY + rig.steerVisual;
    if (rig.steeringWheel && rig.steeringWheelBase) {
      rig.steeringWheel.rotation.z = rig.steeringWheelBase.z - rig.steerVisual * 1.5;
    }
    for (const hinge of rig.hinges) {
      const automaticallyOpen = rig.autoBatteryOpen && hinge.name === 'BatteryCompartment_Lid';
      const target = hinge.open || automaticallyOpen ? 1 : 0;
      hinge.amount += (target - hinge.amount) * 0.16;
      hinge.node.rotation[hinge.axis] = hinge.base + hinge.openRadians * hinge.amount;
    }
    setGolfCartLod(root, lod);
  }

  function golfCartHinge(root, name) {
    return root?.userData?.golfCartRig?.hinges?.find((hinge) => hinge.name === name) || null;
  }

  function toggleGolfCartHinge(root, name) {
    const hinge = golfCartHinge(root, name);
    if (!hinge) return false;
    hinge.open = !hinge.open;
    return hinge.open;
  }

  function golfCartServiceContext(visual) {
    const cartState = visual?.cartState;
    const root = visual?.root;
    if (!cartState || !root) return null;
    const tier = golfCartTier(cartState.tierId);
    golfCartLocalPlayer.set(walk.x, root.position.y, walk.z);
    root.worldToLocal(golfCartLocalPlayer);
    const dx = golfCartLocalPlayer.x;
    const dz = golfCartLocalPlayer.z;
    const prefix = `${cartState.id.toUpperCase()} ${tier.name}`;
    const toast = (message) => walkHooks.toast?.(message);
    const sfx = (name) => walkHooks.sfx?.(name);
    const toggleHinge = (name) => {
      const opened = toggleGolfCartHinge(root, name);
      sfx(opened ? 'doorSwing' : 'doorShut');
      return opened;
    };
    const driverEntry = golfCartAnchorWorld(root, 'ENTRY_POINT_Seat_Driver', golfCartWorldPointB);
    const driverDistance = driverEntry
      ? Math.hypot(driverEntry.x - walk.x, driverEntry.z - walk.z)
      : Infinity;
    if (driverDistance < 2.15 && dx < -0.42) {
      if (cartState.status === 'staff-assigned') {
        const employee = state.staff?.employees?.find((entry) => entry.id === cartState.assignedStaffId);
        return {
          label: `${prefix} - assigned to ${employee?.name || 'staff'} for duty`,
          action: () => toast(`${prefix} is reserved for ${employee?.name || 'staff duty'}. Release it from the Cart Fleet screen first.`),
        };
      }
      if (cartState.status === 'available' && cartState.batteryPercent < 5) {
        return {
          label: `${prefix} - battery depleted - [E] inspect`,
          action: () => toast(t('cart.needsCharging', { cart: prefix })),
        };
      }
      if (cartState.status === 'available' && cartState.condition < 15) {
        return {
          label: `${prefix} - unsafe condition - [E] inspect`,
          action: () => toast(t('cart.needsRepair', { cart: prefix })),
        };
      }
      if (cartState.status === 'available') {
        const driverDoor = golfCartHinge(root, 'Door_FL');
        if (driverDoor && !driverDoor.open) return {
          label: `${prefix} driver/passenger door - [E] open to enter`,
          action: () => {
          const on = toggleHinge('Door_FL');
          toast(t(on ? 'cart.driverDoorOpened' : 'cart.driverDoorClosed', { cart: prefix }));
        },
        };
        return {
          label: `${prefix} - [E] enter driver seat`,
          action: () => mountGolfCart(visual),
        };
      }
    }
    if (dz < -0.7 && golfCartHinge(root, 'Windshield_Upper')) {
      const hinge = golfCartHinge(root, 'Windshield_Upper');
      return {
        label: `${prefix} windshield - [E] ${hinge.open ? 'raise' : 'fold'}`,
        action: () => {
          const on = toggleHinge('Windshield_Upper');
          toast(t(on ? 'cart.windshieldFolded' : 'cart.windshieldRaised', { cart: prefix }));
        },
      };
    }
    if (dz > 0.7 && golfCartHinge(root, 'StorageLid_Rear')) {
      const hinge = golfCartHinge(root, 'StorageLid_Rear');
      return {
        label: `${prefix} rear storage - [E] ${hinge.open ? 'close' : 'open'}`,
        action: () => {
          const on = toggleHinge('StorageLid_Rear');
          toast(t(on ? 'cart.rearStorageOpened' : 'cart.rearStorageClosed', { cart: prefix }));
        },
      };
    }
    const atChargeSide = dx > 0.55 && dz > -0.25;
    if (atChargeSide && cartState.status === 'available' && cartState.batteryPercent < 99.5) {
      return {
        label: `${prefix} charge port - ${Math.round(cartState.batteryPercent)}% - [E] connect charger`,
        action: () => {
          const result = chargeGolfCart(state, cartState.id);
          if (result.ok) {
            const lid = golfCartHinge(root, 'BatteryCompartment_Lid');
            if (lid) lid.open = true;
            sfx('chime');
            toast(t('cart.charging', { cart: prefix }));
          } else {
            sfx('thunk');
            toast(result.reason);
          }
        },
      };
    }
    if (atChargeSide && golfCartHinge(root, 'BatteryCompartment_Lid')) {
      const hinge = golfCartHinge(root, 'BatteryCompartment_Lid');
      return {
        label: `${prefix} battery hatch - ${Math.round(cartState.batteryPercent)}% - [E] ${hinge.open ? 'close' : 'open'}`,
        action: () => {
          const on = toggleHinge('BatteryCompartment_Lid');
          toast(t(on ? 'cart.batteryHatchOpened' : 'cart.batteryHatchClosed', { cart: prefix }));
        },
      };
    }
    if (tier.id === 'luxury' && Math.abs(dx) > 0.55) {
      const row = dz < -0.55 ? 'F' : dz > 0.55 ? 'R' : 'M';
      const side = dx < 0 ? 'L' : 'R';
      const doorName = `Door_${row}${side}`;
      const hinge = golfCartHinge(root, doorName);
      if (hinge) return {
        label: `${prefix} passenger door - [E] ${hinge.open ? 'close' : 'open'}`,
        action: () => {
          const on = toggleHinge(doorName);
          toast(t(on ? 'cart.passengerDoorOpened' : 'cart.passengerDoorClosed', { cart: prefix }));
        },
      };
    }
    return {
      label: `${prefix} - ${Math.round(cartState.condition)}% condition - ${Math.round(cartState.batteryPercent)}% battery`,
      action: () => toast(`${prefix}: ${Math.round(cartState.condition)}% condition, ${Math.round(cartState.batteryPercent)}% battery, ${tier.capacity} seats.`),
    };
  }

  const liveAssetLoader = new GLTFLoader();
  liveCartGroup.userData.templateDiagnostics = { loaded: [], failed: [] };
  liveAssetLoader.load('vendor/models/golf_gameplay_kit.glb', (gltf) => {
    gameplayKit = prepareLiveAsset(gltf.scene);
  }, undefined, () => { gameplayKit = null; });
  for (const tier of GOLF_CART_TIERS) {
    liveAssetLoader.load(tier.modelUrl, (gltf) => {
      try {
        golfCartTemplates.set(tier.id, configureGolfCartTemplate(gltf.scene, tier.id));
        liveCartGroup.userData.templateDiagnostics.loaded.push(tier.id);
      } catch (error) {
        golfCartTemplates.delete(tier.id);
        const failure = { tierId: tier.id, message: String(error?.stack || error) };
        liveCartGroup.userData.templateDiagnostics.failed.push(failure);
        console.error(`Golf cart template preparation failed for ${tier.id}.`, error);
      }
    }, undefined, (error) => {
      golfCartTemplates.delete(tier.id);
      const failure = { tierId: tier.id, message: String(error?.stack || error) };
      liveCartGroup.userData.templateDiagnostics.failed.push(failure);
      console.error(`Golf cart GLB load failed for ${tier.id}.`, error);
    });
  }
  liveAssetLoader.load('vendor/models/golf_cart.glb', (gltf) => {
    legacyGolfCartTemplate = prepareLiveAsset(gltf.scene);
  }, undefined, () => { legacyGolfCartTemplate = null; });

  function cloneKit(name) {
    const source = gameplayKit?.getObjectByName(name);
    return source ? prepareLiveAsset(source.clone(true)) : null;
  }

  function placeKit(name, point, rotation = 0, scale = METERS_TO_YARDS) {
    const object = cloneKit(name);
    if (!object) return null;
    object.position.set(point.x, heightAt(point.x, point.z), point.z);
    object.rotation.y = rotation;
    object.scale.setScalar(scale);
    facilityGroup.add(object);
    return object;
  }

  function addFacilityLabel(text, point, y = 2.5, scaleW = 11) {
    const label = textSprite(text, {
      w: 512, fontPx: 70, scaleW,
      fg: '#f4edd7', bg: 'rgba(20,55,31,0.9)', border: '#b59a55',
    });
    label.position.set(point.x, heightAt(point.x, point.z) + y, point.z);
    facilityGroup.add(label);
    return label;
  }

  function clearGolfFacilities() {
    while (facilityGroup.children.length) facilityGroup.remove(facilityGroup.children[0]);
    for (const collider of facilityColliderRefs) {
      const index = propColliders.indexOf(collider);
      if (index >= 0) propColliders.splice(index, 1);
    }
    for (const prop of facilityWalkPropRefs) {
      const index = walkProps.indexOf(prop);
      if (index >= 0) walkProps.splice(index, 1);
    }
    facilityColliderRefs = [];
    facilityWalkPropRefs = [];
    starterCharacter = null;
    starterDisplaySprite = null;
    starterDisplayPoint = null;
    starterDisplayKey = '';
  }

  function ensureGolfFacilities(st) {
    const network = st.golfDay?.routeNetwork;
    if (!gameplayKit || !network || facilityRevision === network.revision) return;
    clearGolfFacilities();
    facilityRevision = network.revision;
    const facilities = network.facilities;
    const firstHole = network.holes[0];
    const teeYaw = firstHole ? Math.atan2(firstHole.pin.x - firstHole.tee.x, firstHole.pin.z - firstHole.tee.z) : 0;
    const teeSide = { x: Math.cos(teeYaw), z: -Math.sin(teeYaw) };
    const teeForward = { x: Math.sin(teeYaw), z: Math.cos(teeYaw) };
    placeKit('StarterStand', facilities.starterStand, teeYaw + Math.PI * 0.5);
    addFacilityLabel('STARTER', facilities.starterStand, 1.65, 2.0);
    starterDisplayPoint = {
      x: facilities.starterStand.x + teeSide.x * 1.9,
      z: facilities.starterStand.z + teeSide.z * 1.9,
    };
    placeKit('StarterDisplay', starterDisplayPoint, teeYaw + Math.PI * 0.5);
    if (firstHole) placeKit('TeeMarkers', firstHole.tee, teeYaw);
    const starter = makeCharacter({ polo: 0xf0ede2, khaki: 0x3f5944, cap: 0x2f5c38 });
    starter.root.position.set(
      facilities.starterStand.x - teeSide.x * 1.45 - teeForward.x * 0.25,
      heightAt(facilities.starterStand.x - teeSide.x * 1.45, facilities.starterStand.z - teeSide.z * 1.45),
      facilities.starterStand.z - teeSide.z * 1.45 - teeForward.z * 0.25,
    );
    starter.root.rotation.y = teeYaw + 0.35;
    facilityGroup.add(starter.root);
    starterCharacter = starter;
    const starterCollider = { x: facilities.starterStand.x, z: facilities.starterStand.z, r: 0.55 };
    propColliders.push(starterCollider);
    facilityColliderRefs.push(starterCollider);
    const starterDeskProp = {
      x: facilities.starterStand.x,
      z: facilities.starterStand.z,
      r: 3.1,
      label: () => {
        const waiting = (state.reservations?.booked || []).filter((reservation) => (
          ['arrived', 'late'].includes(reservation.arrival?.status)
          && reservation.checkIn?.status !== 'checked-in'
          && ['booked', 'confirmed'].includes(reservation.status)
        ));
        return waiting.length
          ? `Starter desk - [E] check in ${waiting[0].reservationHolder}${waiting.length > 1 ? ` · ${waiting.length - 1} more waiting` : ''}`
          : 'Starter desk - [E] arrivals, check-ins and walk-ins';
      },
      action: () => {
        const waiting = (state.reservations?.booked || []).filter((reservation) => (
          ['arrived', 'late'].includes(reservation.arrival?.status)
          && reservation.checkIn?.status !== 'checked-in'
          && ['booked', 'confirmed'].includes(reservation.status)
        ));
        walkHooks.openFrontDesk?.(waiting[0]?.id ?? null);
      },
    };
    walkProps.push(starterDeskProp);
    facilityWalkPropRefs.push(starterDeskProp);

    const displayCollider = { x: starterDisplayPoint.x, z: starterDisplayPoint.z, r: 0.85 };
    propColliders.push(displayCollider);
    facilityColliderRefs.push(displayCollider);
    for (const stagingPoint of facilities.staging) placeKit('TeeMarkers', stagingPoint, teeYaw, 0.58);
    placeKit('CartServiceBay', facilities.cartBarn, teeYaw + Math.PI * 0.5);
    const cartServiceLabel = addFacilityLabel('CART SERVICE', facilities.cartBarn, 2.25, 1.9);
    cartServiceLabel.userData.hideWithinYd = 7;
    cartServiceLabel.userData.hideBeyondYd = 56;

    const rangeYaw = Math.atan2(
      facilities.range.target.x - facilities.range.center.x,
      facilities.range.target.z - facilities.range.center.z,
    );
    for (const [index, bay] of facilities.range.bays.entries()) {
      placeKit('RangeBay', bay, rangeYaw);
      // A basket belongs just behind and to the side of its own bay. The old
      // index-based world-X offset drifted the last baskets through adjacent
      // stalls whenever the range was rotated.
      const basketPoint = {
        x: bay.x - Math.cos(rangeYaw) * 0.62 + Math.sin(rangeYaw) * 0.38,
        z: bay.z + Math.sin(rangeYaw) * 0.62 + Math.cos(rangeYaw) * 0.38,
      };
      placeKit('RangeBasket', basketPoint, rangeYaw + index * 0.04, METERS_TO_YARDS * 1.25);
    }
    const rangeSide = { x: Math.cos(rangeYaw), z: -Math.sin(rangeYaw) };
    const dispenserPoint = {
      x: facilities.range.bays[0].x - rangeSide.x * 2.2,
      z: facilities.range.bays[0].z - rangeSide.z * 2.2,
    };
    const netPoint = {
      x: facilities.range.bays[facilities.range.bays.length - 1].x + rangeSide.x * 3.1,
      z: facilities.range.bays[facilities.range.bays.length - 1].z + rangeSide.z * 3.1,
    };
    placeKit('BallDispenser', dispenserPoint, rangeYaw);
    placeKit('WarmupNet', netPoint, rangeYaw);
    const bagRackPoint = facilities.staging[facilities.staging.length - 1];
    placeKit('BagStagingRack', {
      x: bagRackPoint.x + rangeSide.x * 1.9,
      z: bagRackPoint.z + rangeSide.z * 1.9,
    }, teeYaw + Math.PI * 0.5);
    for (const [point, radius] of [[dispenserPoint, 0.45], [netPoint, 1.35]]) {
      const collider = { x: point.x, z: point.z, r: radius };
      propColliders.push(collider);
      facilityColliderRefs.push(collider);
    }
    placeKit('GolfBag', facilities.putting.center, 0.5);
    placeKit('GolfBag', facilities.chipping.center, -0.75);
    for (const point of facilities.putting.positions.filter((_, index) => index % 2 === 0)) {
      placeKit('PracticePin', point, teeYaw, METERS_TO_YARDS);
    }
    placeKit('PracticePin', facilities.chipping.center, teeYaw + Math.PI, METERS_TO_YARDS);
    addFacilityLabel('PRACTICE RANGE', facilities.range.center, 1.35, 2.8);
    addFacilityLabel('PUTTING GREEN', facilities.putting.center, 1.25, 2.4);
    addFacilityLabel('SHORT GAME', facilities.chipping.center, 1.25, 2.2);
    const target = new THREE.Mesh(
      new THREE.TorusGeometry(1.4, 0.09, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0xe7dfc4, roughness: 0.75 }),
    );
    target.position.set(
      facilities.range.target.x,
      heightAt(facilities.range.target.x, facilities.range.target.z) + 1.5,
      facilities.range.target.z,
    );
    target.rotation.y = Math.atan2(
      facilities.range.center.x - facilities.range.target.x,
      facilities.range.center.z - facilities.range.target.z,
    );
    facilityGroup.add(target);
  }

  function updateStarterDisplay(st) {
    if (!starterDisplayPoint) return;
    const display = st.golfDay?.starter?.display;
    const line = display?.partyName
      ? display.partyName
      : display?.nextUp ? `NEXT · ${display.nextUp}` : 'TEE OPEN';
    const subline = display?.partyName
      ? `${display.status} · ${display.teeTime} · H${display.hole}${display.delayMinutes ? ` · +${Math.ceil(display.delayMinutes)}M` : ''}`
      : display?.onDeck ? `ON DECK · ${display.onDeck}` : display?.notice ? display.notice.replaceAll('-', ' ') : 'CHECK IN AT THE CLUBHOUSE';
    const key = `${line}|${subline}`;
    if (key === starterDisplayKey) return;
    starterDisplayKey = key;
    if (starterDisplaySprite) facilityGroup.remove(starterDisplaySprite);
    starterDisplaySprite = textSprite(`${line}\n${subline}`, {
      w: 768, fontPx: 38, scaleW: 1.34,
      fg: '#f6f0db', bg: 'rgba(18,34,25,0.98)', border: '#ad9152',
    });
    starterDisplaySprite.position.set(
      starterDisplayPoint.x,
      heightAt(starterDisplayPoint.x, starterDisplayPoint.z) + 1.12,
      starterDisplayPoint.z,
    );
    facilityGroup.add(starterDisplaySprite);
  }

  function ensureGolferVisual(party, golfer) {
    const key = `${party.id}:${golfer.id}`;
    let visual = golferVisuals.get(key);
    if (visual) return visual;
    visual = golferVisualPool.pop() || null;
    if (!visual) {
      const hash = identityHash(golfer.id);
      const char = makeCharacter({
        polo: POLO_COLORS[hash % POLO_COLORS.length],
        khaki: KHAKI_COLORS[(hash >>> 3) % KHAKI_COLORS.length],
        cap: CAP_COLORS[(hash >>> 6) % CAP_COLORS.length],
      });
      visual = { char, club: null, lastX: golfer.position.x, lastZ: golfer.position.z, swingUntil: 0, swingMode: 'IronSwing', updateDebt: 0 };
    }
    visual.char.root.userData.char = visual.char;
    visual.char.root.userData.golferId = golfer.id;
    visual.char.root.visible = true;
    visual.lastX = golfer.position.x;
    visual.lastZ = golfer.position.z;
    visual.swingUntil = 0;
    visual.updateDebt = 0;
    golferGroup.add(visual.char.root);
    golferVisuals.set(key, visual);
    return visual;
  }

  function attachLiveClub(visual) {
    if (visual.club || !gameplayKit) return;
    const club = cloneKit('GolfClub');
    if (!club) return;
    club.scale.setScalar(METERS_TO_YARDS);
    club.position.set(0, -0.015, -0.02);
    club.rotation.set(0.15, 0, -0.16);
    (visual.char.grip || visual.char.root).add(club);
    visual.club = club;
  }

  function ensurePartyVisual(party) {
    let visual = partyVisuals.get(party.id);
    if (!visual) {
      visual = {
        bag: null, cart: null, cartTier: null, label: null,
        lastX: party.position.x, lastZ: party.position.z, yaw: 0, cartYaw: 0,
      };
      visual.label = textSprite(party.partyName, {
        w: 384, fontPx: 58, scaleW: 2.2,
        fg: '#f6efd9', bg: 'rgba(23,46,29,0.82)', border: '#9caf83',
      });
      golferGroup.add(visual.label);
      partyVisuals.set(party.id, visual);
    }
    if (!visual.bag && gameplayKit) {
      visual.bag = bagVisualPool.pop() || cloneKit('GolfBag');
      if (visual.bag) {
        // Golf bags are cloned from a kit that may have been matrix-frozen for
        // static presentation. Party bags move between carry, staging and
        // authored cart slots, so their root must recompose every placement.
        visual.bag.matrixAutoUpdate = true;
        visual.bag.matrixWorldAutoUpdate = true;
        visual.bag.scale.setScalar(METERS_TO_YARDS);
        golferGroup.add(visual.bag);
      }
    }
    if (visual.bag) {
      visual.bag.userData.golfCartAccessory = 'bag';
      visual.bag.userData.golfCartPartyId = party.id;
    }
    const fleetCart = state.golfDay?.carts?.find((entry) => entry.id === party.cartId);
    const desiredTier = golfCartTier(fleetCart?.tierId).id;
    if (visual.cart && visual.cartTier !== desiredTier && golfCartTemplates.has(desiredTier)) {
      releaseGolfCart(visual.cart);
      visual.cart = null;
      visual.cartTier = null;
    }
    if (party.transport === 'ride' && !party.cartReturned && !visual.cart) {
      visual.cart = acquireGolfCart(desiredTier);
      if (visual.cart) {
        visual.cart.name = `GolfCart_${desiredTier}_${party.id}`;
        visual.cartTier = visual.cart.userData.golfCartTierId;
        visual.cartYaw = visual.yaw;
        liveCartGroup.add(visual.cart);
      }
    }
    return visual;
  }

  function formationOffset(index, yaw, riding) {
    const local = riding
      ? [[-0.42, -0.1], [0.42, -0.1], [-0.42, 0.72], [0.42, 0.72]][index % 4]
      : [[-0.75, 0.25], [0.75, 0.15], [-0.5, 1.2], [0.55, 1.15]][index % 4];
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    return { x: local[0] * cos + local[1] * sin, z: -local[0] * sin + local[1] * cos };
  }

  function sampleLiveShot(shot, progress) {
    if (progress < 0.68) {
      const t = progress / 0.68;
      return {
        x: shot.start.x + (shot.landing.x - shot.start.x) * t,
        y: shot.start.y + (shot.landing.y - shot.start.y) * t + Math.sin(Math.PI * t) * shot.apexYd,
        z: shot.start.z + (shot.landing.z - shot.start.z) * t,
      };
    }
    if (progress < 0.8) {
      const t = (progress - 0.68) / 0.12;
      return {
        x: shot.landing.x + (shot.stop.x - shot.landing.x) * t * 0.18,
        y: shot.landing.y + Math.sin(Math.PI * t) * Math.min(0.7, shot.apexYd * 0.04),
        z: shot.landing.z + (shot.stop.z - shot.landing.z) * t * 0.18,
      };
    }
    const t = (progress - 0.8) / 0.2;
    const eased = 1 - (1 - t) * (1 - t);
    return {
      x: shot.landing.x + (shot.stop.x - shot.landing.x) * eased,
      y: shot.landing.y + (shot.stop.y - shot.landing.y) * eased,
      z: shot.landing.z + (shot.stop.z - shot.landing.z) * eased,
    };
  }

  function updateLiveBalls(st, nowSeconds) {
    const pending = (st.golfDay?.presentationShots || [])
      .filter((item) => item.sequence > lastPresentationSequence);
    if (pending.length) {
      lastPresentationSequence = Math.max(...pending.map((item) => item.sequence));
    }
    // Accelerated game time can resolve several strokes between rendered
    // frames. Show only the newest stroke for each party so the player sees
    // readable live play instead of a burst of historical balls.
    const newestByParty = new Map();
    for (const item of pending) newestByParty.set(item.partyId, item);
    for (const item of [...newestByParty.values()].slice(-6)) {
      const party = st.golfDay.parties.find((entry) => entry.id === item.partyId.replace(':practice', ''));
      if (party?.simulationTier === 'far') continue;
      const duration = item.shot.type === 'putt' ? 1.4 : item.shot.type === 'chip' ? 1.8 : 2.5;
      presentationBalls.push({ ...item, realStart: nowSeconds, duration });
      const visual = golferVisuals.get(`${item.partyId.replace(':practice', '')}:${item.golferId}`);
      if (visual) {
        visual.swingUntil = nowSeconds + Math.min(2.2, duration * 0.8);
        visual.swingMode = item.shot.type === 'driver' ? 'DriverSwing'
          : item.shot.type === 'putt' ? 'Putt'
            : item.shot.type === 'chip' ? 'Chip'
              : item.shot.type === 'bunker' ? 'BunkerSwing' : 'IronSwing';
      }
    }
    let count = 0;
    for (let index = presentationBalls.length - 1; index >= 0; index--) {
      const item = presentationBalls[index];
      const progress = (nowSeconds - item.realStart) / item.duration;
      if (progress >= 1) {
        presentationBalls.splice(index, 1);
        continue;
      }
      if (count >= 24) continue;
      const point = sampleLiveShot(item.shot, clamp(progress, 0, 1));
      const prior = sampleLiveShot(item.shot, clamp(progress - 0.045, 0, 1));
      const offset = count * 6;
      liveBallTrailPositions[offset] = prior.x;
      liveBallTrailPositions[offset + 1] = prior.y;
      liveBallTrailPositions[offset + 2] = prior.z;
      liveBallTrailPositions[offset + 3] = point.x;
      liveBallTrailPositions[offset + 4] = point.y;
      liveBallTrailPositions[offset + 5] = point.z;
      liveBallMatrix.makeTranslation(point.x, point.y, point.z);
      liveBallInstances.setMatrixAt(count++, liveBallMatrix);
    }
    liveBallInstances.count = count;
    liveBallInstances.instanceMatrix.needsUpdate = true;
    liveBallTrailGeometry.setDrawRange(0, count * 2);
    liveBallTrailGeometry.attributes.position.needsUpdate = true;
  }

  function updateGolfers(dt, st) {
    if (golfersFrozen || !st.golfDay) return;
    ensureGolfFacilities(st);
    for (const object of facilityGroup.children) {
      const hideWithinYd = Number(object.userData?.hideWithinYd || 0);
      const hideBeyondYd = Number(object.userData?.hideBeyondYd || 0);
      if (hideWithinYd > 0 || hideBeyondYd > 0) {
        const distance = Math.hypot(object.position.x - walk.x, object.position.z - walk.z);
        object.visible = !walk.active
          || ((hideWithinYd <= 0 || distance >= hideWithinYd)
            && (hideBeyondYd <= 0 || distance <= hideBeyondYd));
      }
    }
    updateStarterDisplay(st);
    if (starterCharacter) {
      starterCharacter.setMode(st.golfDay.starter.currentPartyId ? 'Browse' : 'Idle');
      starterCharacter.update(dt);
    }
    const nowSeconds = performance.now() / 1000;
    updateLiveBalls(st, nowSeconds);
    liveGolfColliders.length = 0;
    const activeGolferKeys = new Set();
    const activePartyKeys = new Set();
    const tierCounts = { near: 0, mid: 0, far: 0 };
    let renderedCharacters = 0;
    let renderedCarts = 0;
    for (const party of st.golfDay.parties) {
      const distanceToPlayer = Math.hypot(party.position.x - walk.x, party.position.z - walk.z);
      const tier = distanceToPlayer <= 95 ? 'near' : distanceToPlayer <= 260 ? 'mid' : 'far';
      tierCounts[tier]++;
      // Far parties continue their canonical, coarse event simulation but own
      // no scene objects. Crossing back into MID/NEAR reconstructs presentation
      // from the same positions, route progress and scorecard state.
      if (tier === 'far') continue;
      activePartyKeys.add(party.id);
      const partyVisual = ensurePartyVisual(party);
      const dx = party.position.x - partyVisual.lastX;
      const dz = party.position.z - partyVisual.lastZ;
      if (Math.hypot(dx, dz) > 0.02) partyVisual.yaw = Math.atan2(dx, dz);
      partyVisual.lastX = party.position.x;
      partyVisual.lastZ = party.position.z;
      const traveling = TRAVEL_STATES.has(party.state);
      const riding = party.routeTransport === 'ride' && traveling;
      const near = tier === 'near';
      if (partyVisual.cart) {
        partyVisual.cart.visible = party.transport === 'ride' && !party.cartReturned;
        if (partyVisual.cart.visible) {
          const parkedOffset = riding ? 0 : 3.2;
          const cartX = party.position.x + Math.cos(partyVisual.yaw) * parkedOffset;
          const cartZ = party.position.z - Math.sin(partyVisual.yaw) * parkedOffset;
          const previousCartX = partyVisual.cartPosition?.x ?? cartX;
          const previousCartZ = partyVisual.cartPosition?.z ?? cartZ;
          const travel = Math.hypot(cartX - previousCartX, cartZ - previousCartZ);
          const turnDelta = Math.atan2(
            Math.sin(partyVisual.yaw - partyVisual.cartYaw),
            Math.cos(partyVisual.yaw - partyVisual.cartYaw),
          );
          partyVisual.cartPosition = { x: cartX, z: cartZ };
          groundGolfCart(partyVisual.cart, cartX, cartZ, partyVisual.yaw + Math.PI);
          partyVisual.cartYaw = partyVisual.yaw;
          animateGolfCart(
            partyVisual.cart,
            travel,
            turnDelta,
            distanceToPlayer < 60 ? 0 : distanceToPlayer < 150 ? 1 : 2,
          );
          partyVisual.cart.updateMatrixWorld(true);
          liveGolfColliders.push({ x: cartX, z: cartZ, r: 1.35 });
          renderedCarts++;
        }
      }
      if (partyVisual.bag) {
        partyVisual.bag.visible = true;
        const carried = traveling && party.routeTransport === 'walk';
        const onCart = party.transport === 'ride' && party.cartLoaded && !party.cartReturned && partyVisual.cartPosition;
        const bagAnchor = onCart ? partyVisual.cart?.userData?.golfCartRig?.bagSlots?.[0] : null;
        if (bagAnchor) {
          bagAnchor.getWorldPosition(golfCartWorldPoint);
          bagAnchor.getWorldQuaternion(golfCartWorldQuaternion);
          golfCartWorldForward.set(0, 0, -1).applyQuaternion(golfCartWorldQuaternion);
          partyVisual.bag.position.copy(golfCartWorldPoint);
          partyVisual.bag.rotation.set(
            -0.10,
            Math.atan2(golfCartWorldForward.x, golfCartWorldForward.z),
            0,
          );
          partyVisual.bag.userData.golfCartBagSlot = bagAnchor.name;
        } else {
          const bagX = carried ? party.position.x + 0.26 : party.position.x + 1.1;
          const bagZ = carried ? party.position.z + 0.12 : party.position.z + 0.3;
          partyVisual.bag.position.set(bagX, heightAt(bagX, bagZ) + (carried ? 0.72 : 0), bagZ);
          partyVisual.bag.rotation.set(carried ? -0.32 : 0, partyVisual.yaw + 0.35, carried ? -0.18 : 0);
          partyVisual.bag.userData.golfCartBagSlot = null;
        }
        partyVisual.bag.updateMatrix();
        partyVisual.bag.updateMatrixWorld(true);
      }
      partyVisual.label.visible = near && distanceToPlayer < 5;
      partyVisual.label.position.set(
        party.position.x,
        heightAt(party.position.x, party.position.z) + 2.25 + (party.sequence % 2) * 0.42,
        party.position.z,
      );

      const visibleGolferCount = tier === 'near' ? party.golfers.length : Math.min(1, party.golfers.length);
      for (let index = 0; index < visibleGolferCount; index++) {
        const golfer = party.golfers[index];
        const key = `${party.id}:${golfer.id}`;
        activeGolferKeys.add(key);
        const visual = ensureGolferVisual(party, golfer);
        attachLiveClub(visual);
        const routeProgress = riding && party.routeEndsMinute > party.routeStartedMinute
          ? clamp((st.clock.minutes - party.routeStartedMinute) / (party.routeEndsMinute - party.routeStartedMinute), 0, 1)
          : 0.5;
        const seatPose = riding && partyVisual.cart
          ? golfCartSeatPose(partyVisual.cart, index, routeProgress)
          : null;
        const anchoredX = seatPose?.x;
        const anchoredY = seatPose?.y;
        const anchoredZ = seatPose?.z;
        const anchoredYaw = seatPose?.yaw;
        const offset = seatPose ? { x: 0, z: 0 } : formationOffset(index, partyVisual.yaw, riding);
        const isCurrent = index === party.currentGolferIndex;
        const base = traveling || !isCurrent ? party.position : golfer.position;
        let x = Number.isFinite(anchoredX) ? anchoredX : base.x + offset.x;
        let z = Number.isFinite(anchoredZ) ? anchoredZ : base.z + offset.z;
        if (walk.active && !cart.mounted) {
          const pdx = x - walk.x;
          const pdz = z - walk.z;
          const distance = Math.hypot(pdx, pdz);
          if (distance > 0.01 && distance < 1.4) {
            x += (pdx / distance) * (1.4 - distance);
            z += (pdz / distance) * (1.4 - distance);
          }
        }
        const moveX = x - visual.lastX;
        const moveZ = z - visual.lastZ;
        if (Number.isFinite(anchoredYaw)) {
          visual.char.root.rotation.y = anchoredYaw;
        } else if (Math.hypot(moveX, moveZ) > 0.02) {
          const wanted = Math.atan2(moveX, moveZ);
          const turn = Math.atan2(Math.sin(wanted - visual.char.root.rotation.y), Math.cos(wanted - visual.char.root.rotation.y));
          visual.char.root.rotation.y += turn * Math.min(1, dt * 7);
        }
        visual.lastX = x;
        visual.lastZ = z;
        let mode = 'Idle';
        if (riding) {
          mode = routeProgress < 0.1 ? 'CartEnter' : routeProgress > 0.9 ? 'CartExit' : 'CartSit';
        }
        else if (nowSeconds < visual.swingUntil || (isCurrent && party.state === 'ball-in-play')) mode = visual.swingMode || 'IronSwing';
        else if (traveling) mode = party.transport === 'walk' && index === 0 ? 'WalkBag' : 'Walk';
        else if (party.state === 'practicing') mode = party.practiceKind === 'putting' ? 'Putt' : party.practiceKind === 'chipping' ? 'Chip' : 'PracticeSwing';
        else if (party.state === 'waiting-for-starter' || party.state === 'waiting-on-group-ahead') mode = index % 2 ? 'Conversation' : 'Wait';
        else if (party.state === 'at-tee' || party.state === 'preparing-shot') mode = isCurrent ? 'Address' : 'Tee';
        else if (party.state === 'putting' || party.state === 'on-green') mode = isCurrent ? 'Putt' : 'Watch';
        else if (party.state === 'hole-complete') mode = index === 0 ? 'Scorecard' : golfer.holed ? 'Pickup' : 'Wait';
        else if (party.state === 'round-complete') mode = index % 2 ? 'Celebrate' : 'RoundComplete';
        else if (party.state === 'returning-scorecard') mode = index === 0 ? 'Scorecard' : index === 1 ? 'BagUnload' : 'Conversation';
        else if (golfer.animation === 'watching-ball') mode = 'Watch';
        else if (golfer.animation === 'celebrate') mode = 'Celebrate';
        else if (golfer.animation === 'frustration') mode = 'Frustration';
        else if (golfer.animation === 'pickup-ball') mode = 'Pickup';
        else if (golfer.animation === 'loading-bag') mode = 'BagLoad';
        else if (golfer.animation === 'unloading-bag') mode = 'BagUnload';
        else if (golfer.animation === 'cart-entry') mode = 'CartEnter';
        else if (golfer.animation === 'cart-exit') mode = 'CartExit';
        visual.char.setMode(mode);
        visual.char.root.userData.golfCartPartyId = party.id;
        visual.char.root.userData.golfCartSeatAnchor = seatPose
          ? partyVisual.cart?.userData?.golfCartRig?.seatAnchors?.[index]?.name || null
          : null;
        visual.updateDebt += dt;
        if (tier === 'near' || visual.updateDebt >= 0.12) {
          visual.char.update(visual.updateDebt);
          visual.updateDebt = 0;
        }
        visual.char.root.position.set(x, Number.isFinite(anchoredY) ? anchoredY : heightAt(x, z), z);
        visual.char.root.visible = true;
        if (visual.club) visual.club.visible = near && !riding && (mode.endsWith('Swing') || ['Chip', 'Putt', 'Address', 'Tee'].includes(mode) || isCurrent || party.state === 'practicing');
        if (!riding) liveGolfColliders.push({ x, z, r: 0.38 });
        renderedCharacters++;
      }
    }
    for (const [key, visual] of golferVisuals) {
      if (activeGolferKeys.has(key)) continue;
      golferGroup.remove(visual.char.root);
      golferVisuals.delete(key);
      if (golferVisualPool.length < 24) golferVisualPool.push(visual);
    }
    for (const [key, visual] of partyVisuals) {
      if (activePartyKeys.has(key)) continue;
      if (visual.bag) {
        golferGroup.remove(visual.bag);
        if (bagVisualPool.length < 12) bagVisualPool.push(visual.bag);
      }
      if (visual.cart) {
        releaseGolfCart(visual.cart);
      }
      if (visual.label) golferGroup.remove(visual.label);
      partyVisuals.delete(key);
    }
    // Every unassigned owned cart occupies a real fleet-yard slot. Cleaning and
    // charging are state changes on those same physical vehicles, not cosmetic
    // duplicates that pop in only while a service timer runs.
    const serviceCarts = st.golfDay.carts.filter((entry) => entry.status !== 'assigned');
    const activeServiceCartIds = new Set();
    const barn = st.golfDay.routeNetwork?.facilities?.cartBarn;
    if (barn && (golfCartTemplates.size || legacyGolfCartTemplate)) {
      for (let index = 0; index < serviceCarts.length; index++) {
        const fleetCart = serviceCarts[index];
        const desiredTier = golfCartTier(fleetCart.tierId).id;
        activeServiceCartIds.add(fleetCart.id);
        let visual = serviceCartVisuals.get(fleetCart.id);
        if (visual && visual.tier !== desiredTier && golfCartTemplates.has(desiredTier)) {
          releaseGolfCart(visual.root);
          visual.root = acquireGolfCart(desiredTier);
          visual.tier = visual.root?.userData?.golfCartTierId || null;
          if (visual.root) liveCartGroup.add(visual.root);
        }
        if (!visual) {
          const root = acquireGolfCart(desiredTier);
          if (!root) continue;
          liveCartGroup.add(root);
          visual = {
            root,
            tier: root.userData.golfCartTierId,
            cartState: fleetCart,
            prop: null,
          };
          visual.prop = {
            x: root.position.x,
            z: root.position.z,
            r: 3.25,
            aimY: 1.0,
            focusBias: 0.12,
            label: () => golfCartServiceContext(visual)?.label || '',
            action: () => golfCartServiceContext(visual)?.action?.(),
          };
          walkProps.push(visual.prop);
          serviceCartVisuals.set(fleetCart.id, visual);
        }
        if (!visual.root) continue;
        visual.cartState = fleetCart;
        const singlePresentationRow = st.golfDay.carts.length <= 5;
        const columns = singlePresentationRow ? Math.max(1, st.golfDay.carts.length) : 4;
        const slot = Math.max(0, Number(fleetCart.homeSlot ?? index));
        const column = slot % columns;
        const row = Math.floor(slot / columns);
        const displayColumn = columns - 1 - column;
        const columnSpacing = singlePresentationRow ? 3.10 : 2.3;
        const slotX = barn.x + (displayColumn - (columns - 1) / 2) * columnSpacing;
        // A five-tier fleet is the player's progression display: park it just
        // in front of the service shelter so posts and signage do not cut
        // through the silhouettes. Larger working fleets retain compact rows.
        const slotZ = barn.z + (singlePresentationRow ? -3.0 : row * 5.0);
        const mountedByPlayer = playerGolfCartVisual === visual
          && cart.mounted
          && cart.vehicleKind === 'golf-cart';
        const playerParked = fleetCart.parkedByPlayer
          && Number.isFinite(fleetCart.position?.x)
          && Number.isFinite(fleetCart.position?.z);
        const x = mountedByPlayer ? cart.x : playerParked ? fleetCart.position.x : slotX;
        const z = mountedByPlayer ? cart.z : playerParked ? fleetCart.position.z : slotZ;
        const yaw = mountedByPlayer ? cart.yaw : playerParked ? Number(fleetCart.yaw || 0) : 0;
        visual.root.name = `GolfCart_${desiredTier}_${fleetCart.id}`;
        groundGolfCart(visual.root, x, z, yaw);
        visual.root.visible = true;
        visual.prop.x = x;
        visual.prop.z = z;
        visual.prop.aimY = visual.root.position.y + 1.0;
        const distanceToPlayer = Math.hypot(x - walk.x, z - walk.z);
        visual.root.userData.golfCartRig.autoBatteryOpen = fleetCart.status === 'charging';
        if (!mountedByPlayer) {
          animateGolfCart(
            visual.root,
            0,
            0,
            distanceToPlayer < GOLF_CART_LOD0_DISTANCE_YD
              ? 0
              : distanceToPlayer < GOLF_CART_LOD1_DISTANCE_YD ? 1 : 2,
          );
          setGolfCartLights(visual.root, Boolean(fleetCart.lightsOn), false);
        }
        appendGolfCartWalkColliders(visual.root, fleetCart.id);
        renderedCarts++;
      }
    }
    for (const [id, visual] of serviceCartVisuals) {
      if (activeServiceCartIds.has(id)) continue;
      releaseGolfCart(visual.root);
      if (visual.prop) {
        const propIndex = walkProps.indexOf(visual.prop);
        if (propIndex >= 0) walkProps.splice(propIndex, 1);
      }
      serviceCartVisuals.delete(id);
    }
    st.golfDay.performance = {
      tiers: tierCounts,
      renderedCharacters,
      renderedCarts,
      visibleBalls: liveBallInstances.count,
      pools: {
        ballCapacity: 24,
        activeBalls: st.golfDay.balls.filter((ball) => ball.active).length,
        characterVisuals: golferVisuals.size,
        characterSpare: golferVisualPool.length,
        cartVisuals: renderedCarts,
        cartSpare: [...cartVisualPools.values()].reduce((sum, pool) => sum + pool.length, 0),
      },
      renderer: {
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        // THE ONE FIELD THAT DISTINGUISHES A SHADER COMPILE FROM EVERYTHING
        // ELSE. Section A measured first-interaction stalls from 339 ms to
        // 10 seconds whose placement and size moved unpredictably with input
        // order, and four models for them were refuted in four consecutive
        // runs. Every one of those models was arguing about a mechanism nobody
        // had observed. `programs.length` is observable: if it rises across an
        // expensive frame, that frame compiled shaders, and if it does not, no
        // amount of reasoning about first draws applies.
        programs: renderer.info.programs?.length ?? null,
      },
    };
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
    eye: EYE_HEIGHT_YD,
    speed: WALK_SPEED_YD_S,
    runMult: RUN_MULTIPLIER,
    radius: 0.34, // same body circle the shop uses
    sens: 1,
    invertY: false,
    cameraBob: true,
    reducedMotion: false,
    fov: WALK_FOV_DEG,
  };

  const walkHeld = new Set();
  // Modifiers dropped by the reconcile: each entry is one time the page believed
  // a modifier was down and the OS disagreed. Kept for diagnostics (?keydebug=1
  // and the HUD chip read it) because a phantom modifier is invisible in play —
  // it has no on-screen effect until an OS hotkey starts eating keys.
  const walkPhantomModifiers = [];
  // Which event type last caught a phantom. Names the instrument that is
  // actually doing the work, so "mousemove clears it" is a reading rather than
  // an assumption about which listener fired.
  let walkLastReconcileSource = null;
  // The OS's own answer, refreshed from every event that carries getModifierState.
  // Distinct from walkHeld on purpose: walkHeld is what the page believes, this is
  // what is actually eating the player's keys.
  let walkOsModifiers = [];
  // MOVEMENT INTENT, counted per frame while a probe is watching. Reported 2026-07-29:
  // "The tell I cannot explain is that Shift CHANGES the outcome." Deciding whether a key
  // was eaten before the page, filtered inside it, or accepted-and-then-blocked needs the
  // middle of that chain visible, and the movement block is the only place that knows it
  // saw the key. Off by default and untouched on a normal frame.
  const walkMoveIntent = {
    recording: false,
    frames: 0,
    movingFrames: 0,
    right: 0,
    left: 0,
    forward: 0,
    back: 0,
    last: null,
  };
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
    for (const c of liveGolfColliders) {
      if (cart.mounted && cart.vehicleKind === 'golf-cart' && c.cartId === cart.fleetCartId) continue;
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
      const dx = nx - tractorPark.x;
      const dz = nz - tractorPark.z;
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

  // Vehicles must not inherit the walker's axis-separated wall slide. At a
  // diagonal impact that lets an unsteered cart drift around a parked vehicle,
  // and a long frame can cross a thin authored proxy before either axis tests
  // inside it. Sweep short, atomic XZ steps instead: the first blocked step
  // stops the vehicle while ordinary steering can still choose a clear path on
  // the following frame.
  function golfCartTryMove(dx, dz, r) {
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(distance / 0.16));
    const stepX = dx / steps;
    const stepZ = dz / steps;
    const mX = worldW / 2 - 2;
    const mZ = worldH / 2 - 2;
    for (let step = 0; step < steps; step++) {
      const nx = clamp(walk.x + stepX, -mX, mX);
      const nz = clamp(walk.z + stepZ, -mZ, mZ);
      if (walkBlocked(nx, nz, r)) return false;
      walk.x = nx;
      walk.z = nz;
    }
    return true;
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
  let walkTrailClock = 0; // monotonic ms, so breadcrumbs can be aged (Goal 21)

  function walkColliderGroups() {
    cartCol.length = 0;
    if (!cart.mounted && !cartHidden) cartCol.push({ x: tractorPark.x, z: tractorPark.z, r: 1.1 });
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
    walkTrailClock += dtMs;
    if (!overlapping && safeClock > 180) {
      safeClock = 0;
      // stamped, so recall can tell "where I stood a moment ago" from "where I
      // stood before I walked across the lawn" (Verifier 3's warp trap)
      safeTrail.record(walk.x, walk.z, walkTrailClock);
    }

    // 3. still pinned? escalate. (read the keys, not walkMoving — a wedged cart counts too)
    const wants = heldAction('moveForward') || heldAction('moveLeft') || heldAction('moveBack') || heldAction('moveRight');
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
      // Recovery is LOCAL. 'manual' is the pause menu's own button, where the
      // player has explicitly asked to be moved and a longer reach is welcome;
      // the automatic escalation must never warp them back across the lawn.
      const from = how === 'manual' ? null : { x: walk.x, z: walk.z, atMs: walkTrailClock };
      const back = safeTrail.recall((x, z) => walkFreeAt(x, z, r), from);
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
  const maintenanceIssueEntries = [];
  const maintenanceIrrigationEntries = [];
  let maintenanceControllerMesh = null;
  let maintenanceVisualTime = 0;
  let maintenanceCullClock = 0;
  let cartHidden = false; // the drivable tractor doesn't exist until repaired

  const maintenancePropInRange = (x, z, rangeYd) => (
    !walk.active || ((x - walk.x) ** 2 + (z - walk.z) ** 2) <= rangeYd ** 2
  );

  function refreshMaintenanceWorldProps(timeSeconds = maintenanceVisualTime) {
    maintenanceVisualTime = timeSeconds;
    const inspection = !!state.courseMaintenance?.inspection?.active;
    for (const entry of maintenanceIssueEntries) {
      const complete = !!(entry.issue.repaired || entry.issue.cleared);
      entry.group.visible = !complete && maintenancePropInRange(
        entry.issue.x,
        entry.issue.z,
        inspection ? 42 : 26,
      );
      entry.halo.visible = !complete && inspection;
      if (entry.kind === 'divot') {
        entry.primary.material = entry.issue.stage === 'filled' ? entry.filledMaterial : entry.openMaterial;
        entry.primary.scale.setScalar(0.82 + (entry.issue.mixProgress || 0) * 0.18);
      } else if (entry.kind === 'debris') {
        entry.primary.scale.setScalar(Math.max(0.15, 1 - (entry.issue.bagProgress || 0) * 0.78));
      }
    }
    for (const entry of maintenanceIrrigationEntries) {
      const running = !!entry.head.enabled;
      entry.group.visible = maintenancePropInRange(
        entry.head.x,
        entry.head.z,
        running ? 50 : inspection ? 42 : 30,
      );
      entry.spray.visible = running;
      entry.ring.material = entry.head.status === 'clogged'
        ? entry.ringMaterials.clogged
        : running ? entry.ringMaterials.running : entry.ringMaterials.ready;
      if (!running) continue;
      const positions = entry.spray.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const ray = i % 12;
        const step = Math.floor(i / 12);
        const t = ((step / 5) + timeSeconds * 0.48) % 1;
        const angle = (ray / 12) * Math.PI * 2 + timeSeconds * 0.12;
        const radius = entry.head.radiusYd * 0.42 * t;
        positions.setXYZ(i, Math.cos(angle) * radius, 0.25 + Math.sin(t * Math.PI) * 2.2, Math.sin(angle) * radius);
      }
      positions.needsUpdate = true;
    }
    if (maintenanceControllerMesh) {
      maintenanceControllerMesh.visible = maintenancePropInRange(
        maintenanceControllerMesh.position.x,
        maintenanceControllerMesh.position.z,
        inspection ? 42 : 30,
      );
    }
  }

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

  const TRACTOR_DRIVE = Object.freeze({
    speed: 10,
    reverse: 3.5,
    turnRate: 1.6,
    eye: 1.9,
    radius: 1.15,
  });
  const tractorPark = { x: 0, z: 0, yaw: Math.PI };
  const cart = {
    x: 0, z: 0, yaw: Math.PI,
    mounted: false,
    vehicleKind: 'tractor',
    fleetCartId: null,
    cameraMode: 'driver',
    velocity: 0,
    acceleration: 0,
    braking: 0,
    ...TRACTOR_DRIVE,
  };
  let cartMesh = null;
  let tractorModel = null;
  let wheelRoll = 0;
  const tractorRig = {
    wheels: [], steer: [], steeringWheel: null, steeringBaseZ: 0,
    hitch: null, mowerPivot: null, mowerBlades: [], modelBaseY: 0,
  };

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
    cartMesh.position.set(tractorPark.x, walkSurfaceHeightAt(tractorPark.x, tractorPark.z), tractorPark.z);
    cartMesh.rotation.y = tractorPark.yaw;
  }

  function animateTractor(dt, travel, throttle, steer, cutting) {
    if (travel > 0.0001) wheelRoll -= Math.sign(throttle || 1) * travel / 0.47;
    for (const part of tractorRig.wheels) part.node.rotation.x = part.baseX + wheelRoll;
    const steerAngle = steer * 0.38;
    for (const part of tractorRig.steer) part.node.rotation.y = part.baseY + steerAngle;
    if (tractorRig.steeringWheel) {
      tractorRig.steeringWheel.rotation.z = tractorRig.steeringBaseZ - steer * 0.62;
    }
    if (tractorModel) {
      tractorModel.position.y = tractorRig.modelBaseY
        + (cart.mounted && cart.vehicleKind === 'tractor' ? Math.sin(time * 18) * 0.006 : 0);
    }
    if (tractorRig.mowerPivot) {
      tractorRig.mowerPivot.rotation.x = cutting ? Math.sin(time * 24) * 0.018 : 0;
    }
    for (const blade of tractorRig.mowerBlades) {
      if (cutting) blade.rotation.y += dt * 28;
    }
  }

  function parkCartAtClubhouse() {
    const spawn = walkDefaultSpawn();
    tractorPark.x = spawn.x + 5.5;
    tractorPark.z = spawn.z + 1.5;
    tractorPark.yaw = Math.PI;
    for (let push = 1; push < 30 && walkBlocked(tractorPark.x, tractorPark.z, TRACTOR_DRIVE.radius + 0.4, true); push++) tractorPark.z += 1.5;
    if (!cart.mounted || cart.vehicleKind === 'tractor') {
      cart.x = tractorPark.x;
      cart.z = tractorPark.z;
      cart.yaw = tractorPark.yaw;
    }
    placeCartMesh();
  }

  function mountCart() {
    if (state.courseMaintenance?.equipment?.tractor) {
      state.courseMaintenance.equipment.tractor.bladesEngaged = false;
    }
    Object.assign(cart, TRACTOR_DRIVE, {
      mounted: true,
      vehicleKind: 'tractor',
      fleetCartId: null,
      cameraMode: 'vehicle',
      velocity: 0,
      x: tractorPark.x,
      z: tractorPark.z,
      yaw: tractorPark.yaw,
    });
    walk.x = cart.x;
    walk.z = cart.z;
    walk.yaw = cart.yaw;
    if (walkHooks.engine) walkHooks.engine(true); // she idles the moment you're up
  }

  function dismountCart() {
    if (cart.vehicleKind === 'golf-cart') {
      dismountGolfCart();
      return;
    }
    if (state.courseMaintenance?.equipment?.tractor) {
      state.courseMaintenance.equipment.tractor.bladesEngaged = false;
    }
    cart.mounted = false;
    if (walkHooks.engine) walkHooks.engine(false);
    cart.x = walk.x;
    cart.z = walk.z;
    cart.yaw = walk.yaw;
    tractorPark.x = cart.x;
    tractorPark.z = cart.z;
    tractorPark.yaw = cart.yaw;
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

  function mountGolfCart(visual) {
    const fleetCart = visual?.cartState;
    const root = visual?.root;
    if (!fleetCart || !root || fleetCart.status !== 'available') return false;
    if (fleetCart.batteryPercent < 5 || fleetCart.condition < 15) return false;
    const tier = golfCartTier(fleetCart.tierId);
    const drive = tier.drive || {};
    const driverDoor = golfCartHinge(root, 'Door_FL');
    if (driverDoor) {
      driverDoor.open = false;
      driverDoor.amount = Math.max(driverDoor.amount, 0.72);
      walkHooks.sfx?.('doorShut');
    }
    playerGolfCartVisual = visual;
    fleetCart.status = 'player-driving';
    fleetCart.assignedPartyId = null;
    fleetCart.assignedStaffId = null;
    fleetCart.parkedByPlayer = true;
    Object.assign(cart, {
      mounted: true,
      vehicleKind: 'golf-cart',
      fleetCartId: fleetCart.id,
      cameraMode: 'driver',
      velocity: 0,
      speed: Number(drive.topSpeedYdPerSec || 8.5),
      reverse: Number(drive.reverseYdPerSec || 3.6),
      acceleration: Number(drive.accelerationYdPerSec2 || 5.0),
      braking: Number(drive.brakeYdPerSec2 || 9.0),
      turnRate: Number(drive.turnRateRadPerSec || 1.55),
      eye: 1.35,
      radius: Math.max(0.72, tier.dimensionsM[0] * METERS_TO_YARDS * 0.5 + 0.12),
      x: root.position.x,
      z: root.position.z,
      yaw: Number(fleetCart.yaw ?? root.rotation.y ?? 0),
    });
    camera.fov = 74;
    camera.updateProjectionMatrix();
    walk.x = cart.x;
    walk.z = cart.z;
    walk.yaw = cart.yaw;
    walk.pitch = 0;
    fleetCart.position = { x: cart.x, z: cart.z };
    fleetCart.yaw = cart.yaw;
    setGolfCartLights(root, Boolean(fleetCart.lightsOn), false);
    walkSetTool(null);
    walkHooks.engine?.(true, 'golf-cart');
    walkHooks.toast?.(`${fleetCart.id.toUpperCase()} ${tier.name}: W/S drive and brake, A/D steer, [Space] brake, [L] lights, [V] switch view, [E] exit.`);
    return true;
  }

  function dismountGolfCart() {
    const visual = playerGolfCartVisual;
    const fleetCart = visual?.cartState;
    const root = visual?.root;
    if (!fleetCart || !root) {
      cart.mounted = false;
      playerGolfCartVisual = null;
      Object.assign(cart, TRACTOR_DRIVE, { vehicleKind: 'tractor', fleetCartId: null, velocity: 0 });
      camera.fov = walk.fov || 66;
      camera.updateProjectionMatrix();
      return;
    }
    groundGolfCart(root, cart.x, cart.z, cart.yaw);
    root.updateMatrixWorld(true);
    const exitPoint = golfCartAnchorWorld(root, 'EXIT_POINT_Seat_Driver', golfCartWorldPointB);
    let exitX = exitPoint?.x;
    let exitZ = exitPoint?.z;
    if (Number.isFinite(exitX) && Number.isFinite(exitZ)) {
      const outwardX = exitX - root.position.x;
      const outwardZ = exitZ - root.position.z;
      const outwardLength = Math.max(0.001, Math.hypot(outwardX, outwardZ));
      exitX += outwardX / outwardLength * 0.32;
      exitZ += outwardZ / outwardLength * 0.32;
    }
    fleetCart.status = 'available';
    fleetCart.position = { x: cart.x, z: cart.z };
    fleetCart.yaw = cart.yaw;
    fleetCart.parkedByPlayer = true;
    fleetCart.lightsOn = false;
    setGolfCartLights(root, false, false);
    cart.velocity = 0;
    if (Number.isFinite(exitX) && Number.isFinite(exitZ) && !walkBlocked(exitX, exitZ, walk.radius)) {
      walk.x = exitX;
      walk.z = exitZ;
    } else {
      const rightX = Math.cos(cart.yaw) * -1.55;
      const rightZ = -Math.sin(cart.yaw) * -1.55;
      for (const [ox, oz] of [[rightX, rightZ], [-rightX, -rightZ], [Math.sin(cart.yaw) * 2.1, Math.cos(cart.yaw) * 2.1]]) {
        if (walkBlocked(cart.x + ox, cart.z + oz, walk.radius)) continue;
        walk.x = cart.x + ox;
        walk.z = cart.z + oz;
        break;
      }
    }
    const driverDoor = golfCartHinge(root, 'Door_FL');
    if (driverDoor) {
      driverDoor.open = true;
      walkHooks.sfx?.('doorSwing');
      window.setTimeout(() => {
        if (!sceneDisposed) driverDoor.open = false;
      }, 650);
    }
    walkHooks.engine?.(false);
    playerGolfCartVisual = null;
    Object.assign(cart, TRACTOR_DRIVE, {
      mounted: false,
      vehicleKind: 'tractor',
      fleetCartId: null,
      cameraMode: 'vehicle',
      velocity: 0,
      x: tractorPark.x,
      z: tractorPark.z,
      yaw: tractorPark.yaw,
    });
    camera.fov = walk.fov || 66;
    camera.updateProjectionMatrix();
    placeCartMesh();
  }

  function toggleGolfCartLights() {
    if (!cart.mounted || cart.vehicleKind !== 'golf-cart' || !playerGolfCartVisual?.root) return { handled: false };
    const fleetCart = playerGolfCartVisual.cartState;
    fleetCart.lightsOn = !Boolean(fleetCart.lightsOn);
    setGolfCartLights(playerGolfCartVisual.root, fleetCart.lightsOn, false);
    walkHooks.sfx?.('click');
    return { handled: true, enabled: fleetCart.lightsOn, label: `${fleetCart.id.toUpperCase()} lights` };
  }

  function toggleGolfCartCamera() {
    if (!cart.mounted || cart.vehicleKind !== 'golf-cart') return { handled: false };
    cart.cameraMode = cart.cameraMode === 'driver' ? 'vehicle' : 'driver';
    camera.fov = cart.cameraMode === 'driver' ? 74 : 66;
    camera.updateProjectionMatrix();
    return { handled: true, mode: cart.cameraMode };
  }

  // --- the hand hose: instant, tangible watering ---------------------------------------
  // Hold-to-spray writes moisture straight into the SAME turf array the crew's
  // scheduled irrigation uses (via a main.js hook) — one source of truth. The
  // visual answer is immediate: spray particles, a live moisture readout on the
  // prompt, and the wet-darkening term in the turf shader above.

  let walkTool = null; // hand tools plus the pushed greens mower / spreader
  let walkSpraying = false; // "holding the use button" for whichever tool is out
  // DIRT SENSE (House Flipper 2's Flipper Sense, Q by default): held to light up
  // every remaining pile through the walls, lingering a moment after release and
  // cancelled the instant you start working — you look, then you sweep.
  const DIRT_SENSE = { key: 'q', rise: 8.0, linger: 2.2, fade: 1.6 };
  let dirtSenseAlpha = 0;
  let dirtSenseLinger = 0;
  let dirtSenseAimed = null; // the cluster under the crosshair, for the reticle
  // Where the crosshair met the floor. A persistent object: this is written
  // every frame in the walk loop, so a fresh literal here is pure GC churn.
  const dirtSenseAim = { x: 0, z: 0, dist: 0, eyeY: 0, live: false };
  let walkSoaping = false; // right button, pressure washer only: lay foam instead of water
  let washHintClock = 0; // don't nag about soap more than once every few seconds
  let walkWaterTexClock = 0;
  let mowTexClock = 0;
  let maintenanceFeedbackClock = 0;
  let routeArrivalNotified = state.courseMaintenance?.route?.arrivedAtMinute !== null;

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
  const _washJetTo = new THREE.Vector3(); // the pressure-lag-ramped visual endpoint of the jet
  const _toolContact = new THREE.Vector3();
  // the same socket sampled AFTER the floor solve has moved the group. The
  // residual it yields is what proves the correction LANDED rather than merely
  // being computed — the distinction this whole item turned on.
  const _toolContactAfter = new THREE.Vector3();
  let cleaningLastResult = null;
  const cleaningLastContact = new THREE.Vector3();
  const cleaningLastTarget = new THREE.Vector3();
  let toolHintClock = 0;
  // The cleaning tools build themselves from src/data/cleaningTools.js — geometry, sockets and
  // placement all come from the registry, so adding a mop is a registry entry rather than another
  // hand-wired block down here. The groundskeeping tools are still authored below; the vacuum's
  // registry build replaces the two-box wand that stood in for it.
  const toolViewmodels = buildToolViewmodels();
  // The asset pipeline builds authored first-person viewmodels for the cleaning kit, and nothing
  // was loading them — finished geometry that never reached the screen. Adopt them in the
  // background: the procedural tools above are already usable, so equipping never waits on I/O,
  // and each authored mesh (with its own sockets) replaces its stand-in as it lands.
  let toolViewmodelsAuthored = null;
  // null means "adoption has not resolved yet" and nothing else. It is never
  // assigned a hand-written "did not run" value, because that is exactly the
  // string that made the previous attempt unfalsifiable.
  let toolPrecompile = null;
  toolViewmodels.adoptAuthored(new GLTFLoader()).then((r) => {
    toolViewmodelsAuthored = r;
    // A6 — THE FIRST TOOL A PLAYER EQUIPS COSTS A ONE-TIME STALL. MEASURED.
    //
    //   first equip (broom)   worst frame 1129 ms
    //   second equip (mop)    worst frame   22 ms      -> 50x, one-time
    //
    // The boot prewarm at the bottom of this file already reveals every hidden
    // object and calls renderer.compile(). It is thorough — and it RACES this
    // adoption. These authored meshes arrive with their own materials whenever
    // the GLB finishes, which is routinely after that compile has run, so their
    // programs are still cold when the player first takes a tool out.
    //
    // The async design is deliberate and worth keeping ("equipping never waits
    // on I/O"), so the fix is not to await adoption at boot. It is to compile
    // the late arrivals once, here, the moment they land.
    //
    // The groups are `visible = false` until equipped, and compile() only walks
    // what is visible — the same reason the boot prewarm force-reveals. Reveal,
    // compile, restore exactly what was revealed.
    try {
      if (renderer && scene && camera) {
        const hidden = [];
        for (const group of Object.values(toolViewmodels.groups || {})) {
          group.traverse((object) => {
            if (!object.visible && !object.isLight) { hidden.push(object); object.visible = true; }
          });
          if (!group.visible) { hidden.push(group); group.visible = true; }
        }
        // TELEMETRY THAT CANNOT LIE ABOUT ITSELF.
        //
        // The first attempt at this reported {ran:false, note:"not reached"} —
        // which was its DECLARED value, because the assignment never attached.
        // "Did not run" and "was never wired" were indistinguishable, and the
        // report nearly carried the wrong one as a measurement.
        //
        // Every field below is computed INSIDE this block, so a value here at
        // all proves the block executed. `revealed` and the before/after program
        // counts cannot be produced from outside it.
        // THE COMPILE ITSELF IS REMOVED. It ran, it worked, and it was useless:
        // measured {ran:true, revealed:18, before:0, after:66, compiled:66}.
        //
        // `before: 0` shows it fires before the boot prewarm, so its 66 programs
        // are keyed to a render state the scene has not finished building. And
        // retiming it would not help either: the 9 programs the first equip
        // compiles belong to materials that DO NOT EXIST until the equip runs —
        // `toolViewmodel.js` creates each strand rig's material lazily, guarded
        // on first equip. Nothing can pre-compile a material that has not been
        // constructed.
        //
        // So this cost 66 program compiles at boot and bought nothing. The
        // reveal/restore is kept only for the measurement below, which is cheap
        // and is the check that must fall from +9 to 0 when the real fix lands.
        for (const object of hidden) object.visible = false;
        toolPrecompile = {
          ran: true,
          revealed: hidden.length,
          programs: renderer.info.programs?.length ?? null,
          note: 'compile removed: the equip-time materials do not exist yet',
        };
      }
    } catch (err) {
      // a cold program is a stall, not a crash: never break boot for it
      toolPrecompile = { ran: false, threw: String((err && err.message) || err) };
    }
    if (walkTool && CLEANING_TOOLS[walkTool]) {
      fpHands.setTool(walkTool, toolViewmodels.gripsFor(walkTool));
      toolViewmodels.setEquipped(walkTool, true);
      toolViewmodels.setUsing(walkTool, walkSpraying || walkSoaping);
    }
  });
  const heldGroups = {
    hose: new THREE.Group(), divot: new THREE.Group(), rake: new THREE.Group(),
    washer: new THREE.Group(),
    ...toolViewmodels.groups,
  };
  // The washer starts with the synchronous procedural lance below, then this same registry-owned
  // group adopts Asset 79's authored viewmodel without changing its sockets or trigger state.
  // The stable name keeps scoped SOCKET_nozzle lookups unambiguous across all cleaning tools.
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
    if (!heldGroups.washer.getObjectByName('SOCKET_nozzle')) {
      attachSocket(heldGroups.washer, 'nozzle', [0, 0.0678, -0.7444], [-0.16, 0, 0]);
    }
    // brought in from the frame edge once it had hands on it: a two-handed tool has to be far
    // enough into shot that you can see somebody holding it
    heldGroups.washer.position.set(0.24, -0.20, -0.60);
    heldGroups.washer.rotation.set(0.06, -0.13, 0);
  }
  for (const [id, group] of Object.entries(heldGroups)) {
    group.userData.cleaningRestPosition = group.position.clone();
    group.userData.cleaningRestRotationZ = group.rotation.z;
    group.userData.cleaningToolId = id;
  }

  // PHASE 6 — the broom renders through its own viewmodel rig: real arms, its
  // own lens on layer BROOM_FEEL.camera.layer, a pitch-following head planted
  // on the boards, and a collider clamp so bristles stop AT furniture faces.
  // The other cleaning tools stay on the legacy floor-anchored path until the
  // broom is approved as the standard they copy.
  //
  // The clamp asks the same AABB/circle sets the player walks against, and
  // reports which face said no so the head can tilt to the surface it is
  // actually working. Water and golfers are omitted on purpose: a broom head
  // does not collide with a pond edge or a person the way a walking body does.
  function broomColliderQuery(x, z, r) {
    for (const group of [structColliders, propColliders]) {
      for (const c of group) {
        if (c.minX !== undefined) {
          if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) {
            // nearest-face normal: the axis with the shallowest penetration
            const left = (x + r) - c.minX;
            const right = c.maxX - (x - r);
            const near = (z + r) - c.minZ;
            const far = c.maxZ - (z - r);
            const smallest = Math.min(left, right, near, far);
            if (smallest === left) return { blocked: true, nx: -1, nz: 0 };
            if (smallest === right) return { blocked: true, nx: 1, nz: 0 };
            if (smallest === near) return { blocked: true, nx: 0, nz: -1 };
            return { blocked: true, nx: 0, nz: 1 };
          }
        } else {
          const dx = x - c.x;
          const dz = z - c.z;
          const rr = (c.r || 0.4) + r;
          if (dx * dx + dz * dz < rr * rr) {
            const len = Math.hypot(dx, dz) || 1;
            return { blocked: true, nx: dx / len, nz: dz / len };
          }
        }
      }
    }
    return { blocked: false, nx: 0, nz: 0 };
  }
  // I1 (2026-08-05): ONE RIG INSTANCE PER STICK TOOL, from the same factory
  // the broom was approved through. Each rig binds its own held group at
  // construction and reads its own feel (src/data/toolFeel.js); only the
  // active one updates and draws, so five rigs cost what one did. `broomVm`
  // stays as the broom's instance because a session's diagnostics and a
  // shelf of drivers address it by that name.
  // B2 — LIVE FEEL. Every rig reads a mutable deep clone of its feel table;
  // the tuning overlay writes leaves of these clones and the held tool
  // answers the same frame. structuredClone drops toolFeel's deep-freeze;
  // the values are identical until someone drags a slider. Overrides saved
  // by the overlay (src/data/toolFeelOverrides.json) are merged in at boot
  // through applyToolFeelOverrides below, so what was tuned is what ships.
  const liveToolFeel = {};
  for (const rigId of VM_RIG_TOOLS) liveToolFeel[rigId] = structuredClone(TOOL_VM_FEEL[rigId]);
  const feelDeepMerge = (base, patch) => {
    for (const [key, value] of Object.entries(patch || {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)
        && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        feelDeepMerge(base[key], value);
      } else base[key] = value;
    }
    return base;
  };
  const toolRigs = {};
  for (const rigId of VM_RIG_TOOLS) {
    if (!heldGroups[rigId]) continue;
    toolRigs[rigId] = createBroomViewmodel({
      camera,
      renderer,
      scene,
      broomGroup: heldGroups[rigId],
      fpHands,
      colliderQuery: broomColliderQuery,
      floorY: (x, z) => (clubhouseApi && clubhouseApi.groundYAt ? clubhouseApi.groundYAt(x, z) : null),
      feel: liveToolFeel[rigId],
      // A8: the REGISTRY decides how many hands here too. Q7 made the shared
      // toolViewmodel path read `support`, but this bespoke rig built both arms
      // unconditionally, so the broom - the one tool the ruling was written
      // against - kept two hands on screen while its registry entry said one.
      twoHanded: !!CLEANING_TOOLS[rigId]?.support,
      // B4: and the REGISTRY decides whether it has hands at all. The washer is
      // drawn bare, and it is a rig tool, so the flag has to reach the rig.
      showHands: CLEANING_TOOLS[rigId]?.hands !== false,
      // I5: the drawn interior for the mesh-true clamp (held tools are camera
      // children, so this root can never self-hit the tool)
      meshRoot: () => (clubhouseApi ? clubhouseApi.interior : null),
    });
  }
  const broomVm = toolRigs.broom;
  const rigFor = (id) => (id ? toolRigs[id] || null : null);
  const activeRig = () => rigFor(walkTool);
  // B2: apply saved overrides once the native bridge answers; push strand
  // params whenever the strand rig exists (it attaches when the authored
  // GLB adopts, so retry briefly).
  const pushStrandParams = (id) => {
    const rig = heldGroups[id]?.userData?.strandRig;
    const params = liveToolFeel[id]?.strands;
    if (rig?.setParams && params) rig.setParams(params);
    return !!(rig && params);
  };
  function applyToolFeelOverrides(overrides) {
    if (!overrides || typeof overrides !== 'object') return false;
    for (const [id, patch] of Object.entries(overrides)) {
      if (!liveToolFeel[id] || !patch) continue;
      feelDeepMerge(liveToolFeel[id], patch);
      toolRigs[id]?.refreshFromFeel?.();
    }
    let tries = 0;
    // Goal 17 R1: EVERY rig that carries fibres, not just the mop. The broom
    // grew a bristle rig in Goal 16 and this retry still named one tool, so a
    // saved broom `strands` block was merged into the live feel and then never
    // reached the rig that draws it — tuned values that silently did nothing.
    const fibreTools = VM_RIG_TOOLS.filter((id) => liveToolFeel[id]?.strands);
    const strandRetry = () => {
      tries += 1;
      const done = fibreTools.length > 0 && fibreTools.every((id) => pushStrandParams(id));
      if (!done && tries < 20) setTimeout(strandRetry, 500);
    };
    strandRetry();
    return true;
  }
  try {
    window.fairwayNative?.readToolFeel?.().then((saved) => {
      if (saved) applyToolFeelOverrides(saved);
    }).catch(() => {});
  } catch { /* browser QA has no bridge; defaults stand */ }
  // The viewmodel pass renders with the world's lights: every light learns the
  // rig layer once per equip (idempotent, and catches lights created since).
  // Every rig shares BROOM_FEEL.camera.layer, so one sweep serves them all.
  function enableBroomLightLayer() {
    scene.traverse((object) => {
      if (object.isLight) object.layers.enable(BROOM_FEEL.camera.layer);
    });
  }
  const dustpanLoadVisual = new THREE.Group();
  dustpanLoadVisual.name = 'DustpanCollectedDebris';
  dustpanLoadVisual.position.set(0, -0.035, -1.50);
  dustpanLoadVisual.visible = false;
  const dustpanLoadGeometry = new THREE.IcosahedronGeometry(0.048, 0);
  const dustpanLoadMaterial = new THREE.MeshStandardMaterial({ color: 0x776446, roughness: 0.98 });
  for (const [x, y, z, scale] of [
    [-0.065, 0, 0.01, 1], [0.01, 0.012, -0.015, 1.25], [0.072, 0, 0.025, 0.85],
  ]) {
    const bit = new THREE.Mesh(dustpanLoadGeometry, dustpanLoadMaterial);
    bit.position.set(x, y, z);
    bit.scale.setScalar(scale);
    dustpanLoadVisual.add(bit);
  }
  heldGroups.dustpan.add(dustpanLoadVisual);
  // Trash-swallow chunk: a few litter bits that fly into the bag mouth on each pickup, modelled on
  // the dustpan load visual (shared geometry/material). Hidden until a pickup arms it.
  const trashSwallowVisual = new THREE.Group();
  trashSwallowVisual.name = 'TrashSwallowChunk';
  trashSwallowVisual.visible = false;
  for (const [x, y, z, scale] of [
    [-0.03, 0, 0.01, 1.0], [0.02, 0.015, -0.01, 0.8], [0.01, -0.01, 0.02, 0.65],
  ]) {
    const bit = new THREE.Mesh(dustpanLoadGeometry, dustpanLoadMaterial);
    bit.position.set(x, y, z);
    bit.scale.setScalar(scale * 0.7);
    trashSwallowVisual.add(bit);
  }
  heldGroups.trashbag.add(trashSwallowVisual);
  // The swallow flies from just below the bag's intake up into its gathered mouth (tool-local yards;
  // the registry has no SOCKET_Opening, so the mouth is the neck the hand closes around).
  const TRASH_SWALLOW_FROM = new THREE.Vector3(0, -0.30, -0.05);
  const TRASH_SWALLOW_TO = new THREE.Vector3(0, 0.02, 0);
  const _trashSwallowPos = new THREE.Vector3();
  {
    // The vacuum used to be two boxes on a stick built right here — a grey cylinder and a red
    // slab, with no intake to speak of. It now comes from the registry with a proper chrome wand,
    // a wide floor head with a bristle strip, a corrugated hose, and a SOCKET_nozzle at the
    // intake mouth so suction starts where the head actually is.
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
    hose: { color: 0xbfe2ff, size: 0.020 },
    divot: { color: 0x9a7c4e, size: 0.025 }, // soil from the repair mix
    rake: { color: 0xd8c08c, size: 0.025 },  // kicked sand
    ballmark: { color: 0x72834c, size: 0.018 },
    debris: { color: 0x7b5a36, size: 0.025 },
    fungicide: { color: 0xc8d887, size: 0.020 },
    spreader: { color: 0xd7c081, size: 0.022 },
  };

  const courseEquipmentMaterials = new Map();
  const optimizeCourseEquipment = (root) => {
    // Share equivalent authored materials and batch only static sibling parts;
    // named pivots remain separate for wheel/reel/impeller animation.
    root.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const shared = materials.map((material) => {
        const key = material.name || material.uuid;
        if (!courseEquipmentMaterials.has(key)) courseEquipmentMaterials.set(key, material);
        return courseEquipmentMaterials.get(key);
      });
      object.material = Array.isArray(object.material) ? shared : shared[0];
    });
    const batches = new Map();
    root.traverse((object) => {
      if (!object.isMesh || object.isSkinnedMesh || Array.isArray(object.material)) return;
      if (object.name.startsWith('COLLISION_') || object.name.includes('_Pivot')) return;
      const key = `${object.parent?.uuid || 'root'}:${object.material.uuid}`;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(object);
    });
    for (const siblings of batches.values()) {
      if (siblings.length < 2) continue;
      const parent = siblings[0].parent;
      if (!parent || siblings.some((object) => object.parent !== parent)) continue;
      const geometries = siblings.map((object) => {
        object.updateMatrix();
        return object.geometry.clone().applyMatrix4(object.matrix);
      });
      const geometry = BufferGeometryUtils.mergeGeometries(geometries, false);
      for (const item of geometries) item.dispose();
      if (!geometry) continue;
      const merged = new THREE.Mesh(geometry, siblings[0].material);
      merged.name = `BATCH_${parent.name || 'Equipment'}_${siblings[0].material.name || 'Material'}`;
      merged.castShadow = siblings.some((object) => object.castShadow);
      merged.receiveShadow = siblings.some((object) => object.receiveShadow);
      for (const object of siblings) parent.remove(object);
      parent.add(merged);
    }
  };

  // Full-size push equipment stays in the world, not glued to the camera. The
  // authored wheel/reel/impeller pivots animate directly and collision proxies
  // remain available in the GLBs without ever being rendered.
  const pushedEquipment = { greensMower: null, spreader: null };
  const pushedParkPose = { greensMower: null, spreader: null };
  const placePushedAtPark = (tool) => {
    const root = pushedEquipment[tool];
    const pose = pushedParkPose[tool];
    if (!root || !pose) return;
    root.position.set(pose.x, heightAt(pose.x, pose.z) + 0.015, pose.z);
    root.rotation.y = pose.yaw;
    root.visible = true;
  };
  const loadPushedEquipment = (tool, url) => {
    new GLTFLoader().load(url, (gltf) => {
      const root = gltf.scene;
      optimizeCourseEquipment(root);
      root.scale.setScalar(1.09361); // Blender metres to this scene's yards
      root.visible = false;
      root.traverse((object) => {
        if (object.name.startsWith('COLLISION_')) object.visible = false;
        if (object.isMesh) object.castShadow = true;
      });
      pushedEquipment[tool] = root;
      scene.add(root);
      placePushedAtPark(tool);
    }, undefined, () => {});
  };
  loadPushedEquipment('greensMower', 'vendor/models/greens_mower.glb');
  loadPushedEquipment('spreader', 'vendor/models/rotary_spreader.glb');

  function updatePushedEquipment(dt, distanceMoved) {
    for (const [tool, root] of Object.entries(pushedEquipment)) {
      if (!root) continue;
      const active = !cart.mounted && walkTool === tool;
      if (!active) {
        placePushedAtPark(tool);
        continue;
      }
      root.visible = true;
      const ahead = tool === 'greensMower' ? 2.15 : 1.52;
      const x = walk.x - Math.sin(walk.yaw) * ahead;
      const z = walk.z - Math.cos(walk.yaw) * ahead;
      root.position.set(x, heightAt(x, z) + 0.015, z);
      root.rotation.y = walk.yaw - Math.PI;
      const using = walkSpraying && distanceMoved > 0.0001;
      root.traverse((object) => {
        if (/^Wheel_.*_Pivot/.test(object.name)) object.rotation.x -= distanceMoved / 0.18;
        if (tool === 'greensMower' && object.name === 'CuttingReel_Pivot' && using) object.rotation.x -= dt * 22;
        if (tool === 'spreader' && object.name === 'BroadcastImpeller_Pivot' && using) object.rotation.y += dt * 15;
      });
      if (tool === 'spreader' && state.courseMaintenance?.equipment?.spreader) {
        state.courseMaintenance.equipment.spreader.gateOpen = using;
      }
    }
  }

  // tool FEEL: equip/stow easing + a carried bob synced to the gait, so tools
  // read as held in hands rather than glued to the camera
  const heldAnim = { t: 1, show: false, pendingHide: false, settle: 0 };
  // Contact-phase stroke gating: a mop/broom/cloth/sponge cleans only while the stroke drags across
  // the surface, not at the lifted turnarounds. Skipped dt is banked here and released on the next
  // contact frame so the NET cleaning over a stroke is unchanged (the sim is linear in dt).
  let strokeGateAccum = 0;
  let strokeLastSign = 0;
  // Contact window as a |cos(phase)| threshold. With x = rest.x + sin(phase)·span, tool speed ∝
  // |cos(phase)|, so |cos| >= this selects the FAST middle of each pass (the visible mid-drag) and
  // lets the tool lift at the slow turnarounds. duty = (2/π)·acos(0.58) = 0.606 → contact covers
  // ~60.6% of each pass. (Phase 2 used |cos| < 0.82, which inversely gated the slow turnarounds.)
  const STROKE_CONTACT_COS = 0.58;
  // Per-tool stroke retiming (rate in rad/s, full push-pull cycle = 2π/rate; span in yards). Mop: a
  // slow, heavy push-pull. Broom: a brisker sweep. Cloth: a gentle wipe. Sponge: a quick scrub.
  const MOP_RATE = 4.0; const MOP_SPAN = 0.19;      // 2π/4.0 ≈ 1.57 s cycle — the heaviest pass
  const BROOM_RATE = 4.8; const BROOM_SPAN = 0.16;  // 2π/4.8 ≈ 1.31 s cycle
  const CLOTH_RATE = 8.0; const CLOTH_XSPAN = 0.10; // 2π/8.0 ≈ 0.79 s wipe loop
  const SPONGE_RATE = 13.0; const SPONGE_XSPAN = 0.055; // 2π/13 ≈ 0.48 s scrub loop
  const WIPE_SECOND_SPAN = 0.05;   // the wipe ellipse's second in-plane axis (cloth + sponge)
  const WIPE_JITTER = 0.006;       // scrub tremor amplitude in yards (×2 for the sponge)
  const WIPE_FLOOR_PITCH = -0.9;   // a steeper downward look than this wipes the floor plane, not a wall
  // Vacuum work sway + authored-clip alternation. 1.15 s full cycle = 2π/rate, two reversals/cycle.
  const VACUUM_RATE = (2 * Math.PI) / 1.15; const VACUUM_SPAN = 0.13;
  let vacuumLastSign = 0; let vacuumStrokeLeft = true;
  // Spray trigger cadence: a metronomic pump. Solution ticks on the squeeze only, scaled by the duty
  // ratio so net solution/sec is unchanged (application is linear in dt): scale = cycle / squeeze.
  const SPRAY_SQUEEZE = 0.09; const SPRAY_RELEASE = 0.16;
  const SPRAY_CYCLE = SPRAY_SQUEEZE + SPRAY_RELEASE;      // 0.25 s
  const SPRAY_DUTY_SCALE = SPRAY_CYCLE / SPRAY_SQUEEZE;   // 0.25 / 0.09 ≈ 2.778
  let sprayCadenceT = 0; let spraySqueezeActive = false;
  // E3: the live intensity of whatever tool is in use, so the audio layer can
  // follow the stroke for every tool instead of only for the broom.
  let toolFeelIntensity = 0; let toolFeelContact = false;
  // The bottle's own kick on each squeeze: full over SPRAY_RECOIL_FALL seconds,
  // squared so it snaps and settles. TWIST turns the same impulse into a small
  // roll, because a trigger is pulled off-centre.
  const SPRAY_RECOIL_FALL = 0.13; const SPRAY_RECOIL_TWIST = 2.4;
  let sprayRecoilT = 0;
  // The accepted floor height under each held floor tool — see FLOOR_SAMPLE_RATE.
  const floorAnchorSampleY = new Map();
  // E2: WHY THE SOLVE DID OR DID NOT RUN, per tool, per frame.
  //
  // The audit inferred from the outside that the old clamp was saturating.
  // It was not: the solve was not reaching the visible tool at all, and no
  // number anywhere could tell those two apart — both look like "the head
  // rides the view". This records the solve's own inputs and its decision, so
  // "it ran and could not correct enough" and "it never ran" are different
  // readings instead of the same one.
  const floorAnchorDebug = { frame: 0, tools: {} };
  // I5: per-frame pull applied to the held HAND tool when its carry point was
  // inside a blocked fixture face (0 in the open — the control's claim).
  const handToolClampDebug = {};
  // Held-tool idle: a slow ±0.4° yaw drift on the whole held rig, 7 s period, for life at rest.
  const IDLE_YAW_AMP = (0.4 * Math.PI) / 180; const IDLE_YAW_RATE = (2 * Math.PI) / 7;
  // Belt-switch debounce: at most one actual tool change per 0.12 s (rapid F-taps keep one pending).
  const TOOL_SWITCH_DEBOUNCE = 0.12;
  let toolSwitchCooldown = 0; let pendingBeltTool; let hasPendingBeltTool = false;
  // Washer pressure-lag: the drawn jet reaches full length over 0.2 s after the trigger (visual only).
  const WASHER_LAG = 0.2; let washerJetRamp = 0;
  // Trash swallow: each pickup lerps a litter chunk into the bag mouth (0.28 s) and pops the bag +4%.
  const TRASH_SWALLOW_DUR = 0.28; const TRASH_POP_DUR = 0.12;
  let trashSwallowT = 1; let trashPopT = 1; let lastBagLoad = 0;
  let bobPhase = 0;
  let walkMoving = false;
  // E2 footsteps: the gait bob's minima are the footfalls. Displacement
  // gates them (pushing into a wall pumps the bob but plants nothing) and
  // the clubhouse slab picks the surface voice.
  let stepBobSin = 0;
  let stepBobDelta = 0;
  let stepDistAccum = 0;
  let stepIdleS = 0;
  let mountBlend = 0; // 0 = on foot (first person) … 1 = in the seat (chase cam)
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  // FOCUS MODE: the camera settles onto a fixed pose (the laptop screen, a
  // seat) and input is parked until clearFocus() eases it back to the eyes.
  let walkFocusPose = null; // { x, y, z, yaw, pitch }
  let lastFocusPose = null; // survives the ease-out
  let focusBlend = 0;
  let focusBaseFov = null;
  let focusDuration = 0.4;

  function walkFocusOn(pose) {
    // Snapshot the WALK lens, not the camera's current one. Callers that need a
    // different lens for the focused pose set it before calling — enterLaptop must
    // (main.js:354-356: the seat distance is derived from the fov, so the lens has to
    // change first), and register mode does the same. Reading camera.fov here captured
    // that already-modified value, so the ease-out below restored the laptop's 34 deg
    // instead of the player's 66, permanently, and re-poisoned itself on every
    // subsequent cycle. walk.fov is the walk-mode authority and matches the idiom used
    // when walk mode re-applies its lens.
    if (!walkFocusPose && focusBaseFov == null) focusBaseFov = walk.fov || 66;
    walkFocusPose = pose;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    focusDuration = reduceMotion ? 0 : Math.max(0, pose?.duration ?? 0.4);
    if (focusDuration === 0) focusBlend = 1;
  }
  function walkClearFocus() {
    walkFocusPose = null;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    focusDuration = reduceMotion ? 0 : 0.2;
    if (focusDuration === 0) focusBlend = 0;
  }

  function updateHeldFeel(dt) {
    // Belt-switch debounce: tick the cooldown and, when it lapses, apply at most one queued switch.
    // Runs once per frame (this is the single per-frame held-feel update on every path).
    if (toolSwitchCooldown > 0) {
      toolSwitchCooldown = Math.max(0, toolSwitchCooldown - dt);
      if (toolSwitchCooldown <= 0 && hasPendingBeltTool) {
        hasPendingBeltTool = false;
        const queued = pendingBeltTool;
        pendingBeltTool = undefined;
        toolSwitchCooldown = TOOL_SWITCH_DEBOUNCE;
        if (queued !== walkTool) walkSetTool(queued);
      }
    }
    // the hands breathe, rise into frame, and shove back under the trigger — or draw the box
    toolViewmodels.update(dt, walkFloorWorldY());
    if (walkTool && CLEANING_TOOLS[walkTool]) {
      fpHands.syncGrips(toolViewmodels.gripsFor(walkTool));
    }
    // The spray bottle's recoil is a discrete pump: `using` follows the squeeze window (set by the
    // cadence a frame earlier) instead of the continuous hold, so the rig kicks and relaxes between
    // squeezes rather than staying pinned. Every other tool keeps the continuous held signal.
    const handsUsing = walkTool === 'spray'
      ? (walkSpraying && spraySqueezeActive)
      : (walkSpraying || walkSoaping || holdActive);
    fpHands.update(dt, handsUsing);
    if (!heldRoot.visible) return;
    // Rise on equip over 0.26 s; stow faster (0.18 s) so switching tools feels
    // crisp. The broom's rise/stow/settle timings come from its own tuning
    // file (Phase 6: every broom feel value lives in broomFeel.js).
    const ownRig = rigFor(walkTool);
    const rigOwned = !!(ownRig && ownRig.isActive());
    const ownFeel = rigOwned ? TOOL_VM_FEEL[walkTool] : null;
    const equipDur = walk.reducedMotion ? 0.001
      : (heldAnim.show
        ? (rigOwned ? ownFeel.equip.duration : 0.26)
        : (rigOwned ? ownFeel.unequip.duration : 0.18));
    heldAnim.t = Math.min(1, heldAnim.t + dt / equipDur);
    // a rig tool drops with an ease-IN (slow release, brisk exit); everything
    // else keeps the shared ease-out both ways
    const k = heldAnim.show ? easeOutCubic(heldAnim.t)
      : (rigOwned ? 1 - ownRig.easeInCubic(heldAnim.t) : 1 - easeOutCubic(heldAnim.t));
    if (!heldAnim.show && heldAnim.t >= 1) {
      heldRoot.visible = false;
      heldAnim.settle = 0;
      return;
    }
    // A brief settle overshoot as the tool lands in the hands, then back to
    // rest. Cosmetic only, so it is gated on !reducedMotion.
    const settleAmp = rigOwned ? ownFeel.equip.settleOvershoot : 0.012;
    const settleDur = rigOwned ? ownFeel.equip.settleTime : 0.06;
    let settleY = 0;
    if (heldAnim.show && heldAnim.t >= 1 && !walk.reducedMotion) {
      heldAnim.settle = Math.min(1, heldAnim.settle + dt / settleDur);
      settleY = Math.sin(heldAnim.settle * Math.PI) * settleAmp;
    } else if (heldAnim.show && heldAnim.t < 1) {
      heldAnim.settle = 0;
    }
    // gait-synced bob (the phase itself advances in the walk update — E2
    // moved it there so the gait exists barehanded; this block only reads it)
    const sway = walk.reducedMotion || !walk.cameraBob ? 0 : (walkMoving ? 1 : 0.25);
    // Recoil belongs to the RIG, not to the hands: the hands are parented into the tool group so
    // their grip stays in the tool's frame, and writing the kick to them slid them along the lance
    // instead of shoving the lance back. fpHands reports the offset; the rig applies it.
    const kickBack = fpHands.rigOffset;
    heldRoot.position.set(
      Math.cos(bobPhase * 0.5) * 0.01 * sway + kickBack.jitterX,
      -0.42 * (1 - k) + settleY + Math.sin(bobPhase) * 0.014 * sway,
      kickBack.back,
    );
    heldRoot.rotation.x = 0.45 * (1 - k) + kickBack.pitch;
    heldRoot.rotation.z = Math.sin(bobPhase * 0.5) * 0.012 * sway;
    // Idle life: a slow ±0.4° yaw drift on the whole held rig, so a tool at rest is never dead-still.
    // Gated with the rest of the cosmetic bob so reduced-motion and bob-off keep it perfectly steady.
    heldRoot.rotation.y = (walk.cameraBob && !walk.reducedMotion)
      ? Math.sin(time * IDLE_YAW_RATE) * IDLE_YAW_AMP : 0;
  }

  const particleCanvas = document.createElement('canvas');
  particleCanvas.width = 32;
  particleCanvas.height = 32;
  const particleContext = particleCanvas.getContext('2d');
  const particleGradient = particleContext.createRadialGradient(16, 16, 2, 16, 16, 15);
  particleGradient.addColorStop(0, 'rgba(255,255,255,1)');
  particleGradient.addColorStop(0.72, 'rgba(255,255,255,0.92)');
  particleGradient.addColorStop(1, 'rgba(255,255,255,0)');
  particleContext.fillStyle = particleGradient;
  particleContext.fillRect(0, 0, 32, 32);
  const softParticleTexture = new THREE.CanvasTexture(particleCanvas);

  const sprayCount = 90;
  const sprayPositions = new Float32Array(sprayCount * 3);
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPositions, 3));
  const sprayParticleTexture = makeSoftParticleTexture();
  const sprayPoints = new THREE.Points(
    sprayGeo,
    new THREE.PointsMaterial({
      color: 0xbfe2ff,
      size: 0.04,
      map: sprayParticleTexture,
      transparent: true,
      opacity: 0.72,
      alphaTest: 0.025,
      depthWrite: false,
    }),
  );
  sprayPoints.visible = false;
  sprayPoints.frustumCulled = false;

  // grass clippings behind the cutting deck — the mowing loop's visible juice
  const CLIP_N = 48;
  const clipPos = new Float32Array(CLIP_N * 3);
  const clipState = [];
  for (let i = 0; i < CLIP_N; i++) clipState.push({ t: 1 + Math.random(), ox: 0, oz: 0, vx: 0, vy: 0, vz: 0 });
  const clipGeo = new THREE.BufferGeometry();
  clipGeo.setAttribute('position', new THREE.BufferAttribute(clipPos, 3));
  const clipPoints = new THREE.Points(
    clipGeo,
    new THREE.PointsMaterial({
      color: 0x79944f, size: 0.045, map: softParticleTexture,
      transparent: true, opacity: 0.72, alphaTest: 0.04, depthWrite: false,
    }),
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

  function updateSpray(aimWorld, sourceWorld = null) {
    // a loose parabolic arc from the nozzle to the patch; the arc starts a full
    // yard out and never hugs the camera, so attenuated points stay droplets
    const hx = sourceWorld?.x ?? (walk.x - Math.sin(walk.yaw) * 1.1);
    const hz = sourceWorld?.z ?? (walk.z - Math.cos(walk.yaw) * 1.1);
    const hy = sourceWorld?.y ?? (heightAt(walk.x, walk.z) + walk.eye - 0.55);
    for (let i = 0; i < sprayCount; i++) {
      const t = 0.12 + Math.random() * 0.88;
      const o = i * 3;
      sprayPositions[o] = hx + (aimWorld.x - hx) * t + (Math.random() - 0.5) * 0.3 * t;
      sprayPositions[o + 1] = hy + (aimWorld.y - hy) * t + Math.sin(t * Math.PI) * 0.55 + (Math.random() - 0.5) * 0.08;
      sprayPositions[o + 2] = hz + (aimWorld.z - hz) * t + (Math.random() - 0.5) * 0.3 * t;
    }
    sprayGeo.attributes.position.needsUpdate = true;
  }

  // --- spray mist cone: a puff on each trigger squeeze (Task-6 feedback) -------------------------
  // 28 additive droplets fired from the spray nozzle socket in a ~17deg cone toward the aim point,
  // 0.35 s life; a 1.5 s glisten sprite blooms at the hit point so the spray's aim reads clearly.
  // Pre-allocated pools, RESET (never grown) on each pulse, so continuous spraying reads as a
  // metronomic puffing and the burst keeps fading after release. Reuses sprayParticleTexture.
  const MIST_N = 28;
  const mistPos = new Float32Array(MIST_N * 3);
  const mistVel = new Float32Array(MIST_N * 3);
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
  const mistPoints = new THREE.Points(mistGeo, new THREE.PointsMaterial({
    color: 0xd4f0ff, size: 0.05, map: sprayParticleTexture,
    transparent: true, opacity: 0, alphaTest: 0.02, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  mistPoints.name = 'SprayMistCone';
  mistPoints.visible = false;
  mistPoints.frustumCulled = false;
  scene.add(mistPoints);
  const sprayGlisten = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sprayParticleTexture, color: 0xcdeeff, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sprayGlisten.name = 'SprayGlisten';
  sprayGlisten.visible = false;
  sprayGlisten.scale.setScalar(0.12);
  scene.add(sprayGlisten);
  let mistActive = false;
  let mistBurstAge = 0;
  let glistenAge = 0;
  const MIST_CONE = 0.297; // ~17deg half-angle
  const MIST_TAU = Math.PI * 2;
  const _mistSrc = new THREE.Vector3();
  const _mistDir = new THREE.Vector3();
  const _mistTmp = new THREE.Vector3();
  const _mistU = new THREE.Vector3();
  const _mistW = new THREE.Vector3();

  function emitSprayMist(group, aimPoint) {
    if (!group) return;
    socketWorld(group, 'nozzle', _mistSrc);
    if (aimPoint) _mistDir.copy(aimPoint).sub(_mistSrc);
    else _mistDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    if (_mistDir.lengthSq() < 1e-6) _mistDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _mistDir.normalize();
    _mistTmp.set(0, 1, 0);
    if (Math.abs(_mistDir.y) > 0.9) _mistTmp.set(1, 0, 0);
    _mistU.crossVectors(_mistDir, _mistTmp).normalize();
    _mistW.crossVectors(_mistDir, _mistU).normalize();
    for (let i = 0; i < MIST_N; i++) {
      const o = i * 3;
      const ang = Math.random() * MIST_TAU;
      const rad = Math.sqrt(Math.random()) * MIST_CONE; // uniform-ish over the cone disc
      const s = Math.sin(rad); const c = Math.cos(rad);
      const ca = Math.cos(ang); const sa = Math.sin(ang);
      const speed = 2.1 + Math.random() * 1.7;
      mistVel[o] = (_mistDir.x * c + (_mistU.x * ca + _mistW.x * sa) * s) * speed;
      mistVel[o + 1] = (_mistDir.y * c + (_mistU.y * ca + _mistW.y * sa) * s) * speed;
      mistVel[o + 2] = (_mistDir.z * c + (_mistU.z * ca + _mistW.z * sa) * s) * speed;
      // Stagger spawns 0..0.2 down the aim axis (a plume snapshot) instead of
      // clumping every droplet at the orifice point: with point spawns, any
      // frame between metronomic pulses showed the whole cloud detached from
      // the nozzle with a clean gap back to the tip, which betrayed the aim
      // (shed visual-QA iteration 3, defect #4). Rooting the burst along the
      // axis keeps a connected tip-to-cloud plume for the burst's whole life.
      const along = Math.random() * 0.2;
      mistPos[o] = _mistSrc.x + _mistDir.x * along + (Math.random() - 0.5) * 0.02;
      mistPos[o + 1] = _mistSrc.y + _mistDir.y * along + (Math.random() - 0.5) * 0.02;
      mistPos[o + 2] = _mistSrc.z + _mistDir.z * along + (Math.random() - 0.5) * 0.02;
    }
    mistGeo.attributes.position.needsUpdate = true;
    mistBurstAge = 0;
    mistActive = true;
    mistPoints.visible = true;
    mistPoints.material.opacity = 0.7;
    if (aimPoint) {
      sprayGlisten.position.copy(aimPoint);
      glistenAge = 0;
      sprayGlisten.visible = true;
      sprayGlisten.material.opacity = 0.55;
    }
  }

  function updateSprayMist(dt) {
    if (mistActive) {
      mistBurstAge += dt;
      const k = mistBurstAge / 0.35;
      if (k >= 1) {
        mistActive = false;
        mistPoints.visible = false;
      } else {
        for (let i = 0; i < MIST_N; i++) {
          const o = i * 3;
          mistVel[o + 1] -= 3.5 * dt; // gravity droop on the droplets
          mistPos[o] += mistVel[o] * dt;
          mistPos[o + 1] += mistVel[o + 1] * dt;
          mistPos[o + 2] += mistVel[o + 2] * dt;
        }
        mistGeo.attributes.position.needsUpdate = true;
        mistPoints.material.opacity = 0.7 * (1 - k);
      }
    }
    if (sprayGlisten.visible) {
      glistenAge += dt;
      const gk = glistenAge / 1.5;
      if (gk >= 1) sprayGlisten.visible = false;
      else {
        sprayGlisten.material.opacity = 0.55 * (1 - gk);
        sprayGlisten.scale.setScalar(0.10 + gk * 0.14);
      }
    }
  }

  function walkSetTool(tool) {
    const previousTool = walkTool;
    if (previousTool && previousTool !== tool) {
      toolViewmodels.setUsing(previousTool, false);
      toolViewmodels.setEquipped(previousTool, false);
    }
    if (previousTool !== tool) {
      walkSpraying = false;
      walkSoaping = false;
      sprayPoints.visible = false;
      clubhouseApi?.stopCleaningEffects?.();
      // Drop any banked stroke-gate dt so it cannot leak into the next tool's first contact frame,
      // and clear the per-tool feel timers so the next tool starts its cadence/ramp from rest.
      strokeGateAccum = 0;
      strokeLastSign = 0;
      sprayCadenceT = 0;
      spraySqueezeActive = false;
      washerJetRamp = 0;
      walkHooks.toolChanged?.(tool || null, previousTool || null);
    }
    if (HELD_TOOL_ASSET_MANIFEST[tool]) {
      // Equipping is the first safe actual-use boundary: ordinary boots stay
      // lean, while the authored model begins loading before this frame makes
      // its group visible. The synchronous procedural fallback prevents a
      // blank-hand flash on cold storage or a missing asset.
      heldAssetRegistry.ensure(tool, 'equip');
    }
    walkTool = tool;
    toolViewmodels.setTool(tool, previousTool);
    for (const [name, g] of Object.entries(heldGroups)) g.visible = name === tool;
    // Every tool remains physically held.
    // B4: a tool declared `hands: false` is DRAWN BARE — it sits in view with
    // no first-person hand on it. The suppression is set before the grips are
    // applied so a bare tool never shows a hand for the frame in between.
    fpHands.setHandsSuppressed?.(CLEANING_TOOLS[tool]?.hands === false);
    if (tool && heldGroups[tool] && GRIPS[tool]) {
      heldGroups[tool].add(fpHands.root);
      fpHands.setTool(tool, toolViewmodels.gripsFor(tool));
      toolViewmodels.setEquipped(tool, true);
    } else {
      fpHands.setTool(null);
    }
    // Phase 6 → I1: a rig tool (with the hands ALREADY re-parented into it, so
    // the layer sweep catches them) leaves the world pass for the viewmodel
    // pass. Deactivations run FIRST: setActive(false) restores the shared hand
    // scale and arm stubs, so a deactivating rig running after the new one
    // would clobber what the new one just set.
    if (toolRigs[tool]) enableBroomLightLayer();
    for (const [rigId, rig] of Object.entries(toolRigs)) if (rigId !== tool) rig.setActive(false);
    toolRigs[tool]?.setActive(true);
    const pushed = tool === 'greensMower' || tool === 'spreader';
    if (tool && !pushed) {
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
    if (!tool) sprayPoints.visible = false;
  }

  // C10 — NOTHING IS HELD AT A WORK STATION, WHICHEVER PASS DRAWS IT.
  //
  // The previous fix was `broomVm.setActive(false)` inside walkExit(), which is
  // wrong twice over: walkExit() only runs on scene dispose, so it never fires
  // for the till at all, and it names ONE tool's private render pass. Every
  // other tool draws under heldRoot in the world pass and was never covered.
  //
  // This is the general case, and it is general because it does not enumerate
  // anything: it puts the tool DOWN through walkSetTool(), the one function
  // that already knows about every tool, every pass, the hands, the tool
  // viewmodels, the spray points and the effect timers. A tool added tomorrow
  // is covered the day it is added, because being held at all goes through the
  // same setter.
  // 2026-08-06 ruling: "make sure that items such as the spray, broom etc
  // switch to the hand automatically when we click on the book the same way
  // we did for the cash register". The READING DESK is a work station too -
  // you cannot hold a mop and a ledger. Same predicate, one more station, so
  // every tool present and future is covered by the same setter.
  let stationStowedTool = null;
  function syncStationToolStow() {
    // G1: ASK THE ONE PREDICATE, NOT A SECOND LIST OF STATIONS.
    //
    // This generalised over every TOOL and then hard-coded two STATIONS, so the
    // laptop was missed: you sat down at the back office with a mop still in
    // your hands. The host owns the real list (laptop, ledger, front desk,
    // register); the direct checks stay as a fallback for callers that never set
    // the hook. Adding a station now covers tool stowing for free.
    const stationOpen = !!walkHooks.stationOpen?.()
      || !!clubhouseApi?.register?.isActive?.()
      || !!clubhouseApi?.ledgerBook?.isOpen?.();
    if (stationOpen) {
      if (stationStowedTool !== null || !walkTool) return;
      stationStowedTool = walkTool;
      walkSetTool(null);
      return;
    }
    if (stationStowedTool === null) return;
    const tool = stationStowedTool;
    stationStowedTool = null;
    // Only restore into an empty hand: if the player picked something else up
    // at the counter, that is what they are holding now.
    if (tool && !walkTool) walkSetTool(tool);
  }

  // Belt cycling comes through the exposed setTool. Debounce it so a flurry of F-taps applies one
  // switch per TOOL_SWITCH_DEBOUNCE and keeps only the last as pending, rather than popping the
  // viewmodel through every intermediate tool. Internal auto-tool and cart swaps call walkSetTool
  // directly and stay immediate.
  function walkSetToolDebounced(tool) {
    if (toolSwitchCooldown > 0) {
      pendingBeltTool = tool;
      hasPendingBeltTool = true;
      return;
    }
    toolSwitchCooldown = TOOL_SWITCH_DEBOUNCE;
    walkSetTool(tool);
  }

  function walkSetSpraying(on) {
    const wasSpraying = walkSpraying;
    walkSpraying = !!(on && walkTool && !cart.mounted);
    if (walkTool && walkSpraying !== wasSpraying) {
      toolViewmodels.setUsing(walkTool, walkSpraying || walkSoaping);
    }
    if (!walkSpraying) {
      sprayPoints.visible = false;
      clubhouseApi?.stopCleaningEffects?.();
      // A release ends the stroke: drop the banked gate dt so a same-tool re-press starts clean
      // rather than dumping the bank as a lump on the next contact frame (the Task-4 minor). Reset
      // the spray pump too, so the next hold opens on a fresh squeeze.
      strokeGateAccum = 0;
      strokeLastSign = 0;
      sprayCadenceT = 0;
      spraySqueezeActive = false;
    }
  }

  function walkSetSoaping(on) {
    walkSoaping = !!(on && walkTool === 'washer' && !cart.mounted);
    toolViewmodels.setUsing(walkTool, walkSpraying || walkSoaping);
  }

  function cleaningBlockMessage(reason) {
    return ({
      carpet: 'Mops stay off carpet - use the vacuum there.',
      'mop-dry': 'The mop is dry - wring it in the cleaning-bay bucket.',
      'pan-full': 'The dustpan is full - empty it into the trash bag.',
      'bag-full': 'The trash bag is full - tie it at the cleaning bay.',
      'bag-tied': 'That bag is tied - dispose it at the stockroom waste station.',
      'spray-first': 'Loosen it with spray first.',
      'sweep-first': 'Sweep the pile together first.',
      dry: 'Nothing to wipe yet - spray the surface first.',
      blocked: 'The tool is against a fixture, not the floor.',
      occluded: 'A counter or wall blocks the tool contact.',
    })[reason] || 'Nothing to clean at that contact point.';
  }

  function toggleMowerBlades() {
    let equipment = null;
    let label = '';
    if (cart.mounted && cart.vehicleKind === 'tractor') {
      equipment = state.courseMaintenance?.equipment?.tractor;
      label = 'Tractor mower';
    } else if (walkTool === 'greensMower') {
      equipment = state.courseMaintenance?.equipment?.greensMower;
      label = 'Greens mower';
    }
    if (!equipment) return { handled: false };
    equipment.engineOn = true;
    equipment.bladesEngaged = !equipment.bladesEngaged;
    return { handled: true, enabled: equipment.bladesEngaged, label };
  }

  function toggleMowerBlades() {
    let equipment = null;
    let label = '';
    if (cart.mounted && cart.vehicleKind === 'tractor') {
      equipment = state.courseMaintenance?.equipment?.tractor;
      label = 'Tractor mower';
    } else if (walkTool === 'greensMower') {
      equipment = state.courseMaintenance?.equipment?.greensMower;
      label = 'Greens mower';
    }
    if (!equipment) return { handled: false };
    equipment.engineOn = true;
    equipment.bladesEngaged = !equipment.bladesEngaged;
    return { handled: true, enabled: equipment.bladesEngaged, label };
  }

  // --- what you're looking at (shop-style focus + [E]) -------------------------------
  let walkFocus = null; // { kind, label, cell? }
  const walkHooks = {}; // main.js provides turfLabelAt / inspectAt / waterAt / hoseLabelAt
  // N2/F2 - the walker's own read path through the binding table. main.js
  // provides walkHooks.bindings; headless tests without it get the defaults.
  const boundWalkKey = (actionId) => keyForAction(
    walkHooks.bindings ? walkHooks.bindings() : DEFAULT_BINDINGS,
    actionId,
  );
  const heldAction = (actionId) => walkHeld.has(boundWalkKey(actionId));
  walkHooks.getTool = () => walkTool;
  walkHooks.toolAction = (toolId, action) => {
    const clips = {
      'mop:service': ['headcompress', 'compress'],
      'dustpan:empty': ['empty'],
      'trashbag:tie': ['tie'],
      'trashbag:dispose': ['dispose'],
    }[`${toolId}:${action}`];
    if (clips) toolViewmodels.play(toolId, clips);
  };

  // the patch of ground a walking player is looking at, in cell coords
  function walkAimCell(dist = 2.4) {
    const ax = walk.x - Math.sin(walk.yaw) * dist;
    const az = walk.z - Math.cos(walk.yaw) * dist;
    const cx = Math.floor((ax + worldW / 2) / CELL_YD);
    const cy = Math.floor((az + worldH / 2) / CELL_YD);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
    return { x: cx, y: cy, worldX: ax, worldZ: az };
  }

  // F1 (Full_Goal_16): find a work station (till, ledger desk) within its
  // own radius. The cone is deliberately wide — anything not directly behind
  // you — because the player arrives at a counter looking DOWN at the floor
  // they were just mopping, and at point-blank range direction means nothing.
  // ONE AIM SCORE, USED EVERYWHERE (Goal 20, found by Verifier 2).
  //
  // A verifier could not open the ledger in forty minutes of play: the crosshair
  // was on the cover and the prompt said "Front desk". The cause was that
  // STATIONS were selected by a different rule from every other prop — first
  // match in registration order, gated only on facing > -0.2, which is a hundred
  // degrees off axis. The desk is registered eight thousand lines before the
  // book, so it always won, and the book's own focusBias and aimY — added in an
  // earlier goal specifically to beat it, with a comment saying so — were dead
  // code on that path.
  //
  // This is the general loop's scoring, lifted out and used by both, so the two
  // cannot hold different opinions about what you are looking at again.
  function walkPropAimScore(p) {
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
    const focusBias = Number(typeof p.focusBias === 'function' ? p.focusBias() : p.focusBias) || 0;
    if (Number.isFinite(focusY)) {
      // Props on different authored levels can share an x/z, so those score
      // against the real first-person aim ray rather than a flat bearing.
      const dy = focusY - camera.position.y;
      const spatial = Math.max(0.001, Math.hypot(dx, dy, dz));
      const cp = Math.cos(walk.pitch);
      const facing = (dx / spatial) * -Math.sin(walk.yaw) * cp
        + (dy / spatial) * Math.sin(walk.pitch)
        + (dz / spatial) * -Math.cos(walk.yaw) * cp;
      return { dist, facing, score: walkPropFocusScore3d(spatial, facing, focusBias) };
    }
    const safeDist = Math.max(0.001, dist);
    const facing = ((dx / safeDist) * -Math.sin(walk.yaw))
      + ((dz / safeDist) * -Math.cos(walk.yaw));
    return { dist, facing, score: dist - focusBias };
  }

  function walkStationPropInReach() {
    let best = null;
    let bestScore = Infinity;
    for (const p of walkProps) {
      if (!p.station) continue;
      const dx = p.x - walk.x;
      const dz = p.z - walk.z;
      const dist = Math.hypot(dx, dz);
      if (dist > (p.r || 0)) continue;
      // The forgiving gate STAYS. Standing at the counter and pressing E
      // without looking squarely at it has to keep working — that is what
      // `station` is for. It is an eligibility floor now rather than the whole
      // decision.
      const flat = dist < 0.6 ? 1
        : ((dx / dist) * -Math.sin(walk.yaw)) + ((dz / dist) * -Math.cos(walk.yaw));
      if (flat <= -0.2) continue;
      // ...and among the stations that qualify, the one you are LOOKING AT wins.
      // A station you are not aimed at scores Infinity from the shared rule, so
      // it falls back to a bearing-and-distance ranking that always loses to a
      // station under the crosshair. That is the whole fix in one line.
      const aimed = walkPropAimScore(p);
      const score = Number.isFinite(aimed.score) ? aimed.score : (dist + 100 - flat);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  function walkFindFocus() {
    if (cart.mounted) {
      if (cart.vehicleKind === 'golf-cart') {
        const fleetCart = playerGolfCartVisual?.cartState;
        const tier = golfCartTier(fleetCart?.tierId);
        const speedMph = Math.round(Math.abs(cart.velocity) * 2.045);
        const direction = speedMph === 0 ? 'idle' : cart.velocity < 0 ? 'reverse' : 'drive';
        const lightState = fleetCart?.lightsOn ? 'ON' : 'OFF';
        const cameraMode = cart.cameraMode === 'vehicle' ? 'chase' : 'driver';
        const battery = clamp(Number(fleetCart?.batteryPercent || 0), 0, 100);
        const batteryLabel = battery >= 99.95 ? '100' : battery.toFixed(1);
        walkFocus = {
          kind: 'cart',
          label: `${fleetCart?.id?.toUpperCase() || 'GOLF CART'} ${tier.name} · ${speedMph} mph ${direction} · ${batteryLabel}% battery · [L] lights ${lightState} · [V] ${cameraMode} view · [E] park`,
        };
        return;
      }
      const mower = state.courseMaintenance?.equipment?.tractor;
      const cutting = mower?.bladesEngaged;
      walkFocus = { kind: 'cart', label: cutting
        ? 'Tractor · mower blades ON [R] · [E] park here'
        : 'Tractor · engine running · [R] engage mower blades · [E] park here' };
      return;
    }
    if (!cartHidden) {
      const dx = cart.x - walk.x;
      const dz = cart.z - walk.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 3.6) {
        const facing = ((dx / dist) * -Math.sin(walk.yaw)) + ((dz / dist) * -Math.cos(walk.yaw));
        if (facing > 0.35) {
          walkFocus = { kind: 'cart', label: 'Tractor - [E] take the wheel' };
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
    // F1 (Full_Goal_16): a work station in reach OUTRANKS the equipped
    // tool's prompt — Q+mop at the till must read the till, not the mop.
    // The tool blocks below return early and used to leave E dead at the
    // counter (label hijack, facing gate, hose fallback — all three).
    const stationProp = walkStationPropInReach();
    if (stationProp) {
      const stationLabel = typeof stationProp.label === 'function' ? stationProp.label() : stationProp.label;
      if (stationLabel) {
        walkFocus = { kind: 'prop', label: stationLabel, prop: stationProp };
        return;
      }
    }
    // A tool the player deliberately equipped owns the prompt. Nearby props no
    // longer replace "vacuum this patch" or "water this turf" with an unrelated
    // clutter/fixture action. A contextual prop tool still uses its prop's own
    // hold prompt below.
    if (walkTool && walkTool !== autoTool) {
      if (walkTool === 'vacuum' && clubhouseApi) {
        const ax = walk.x - Math.sin(walk.yaw) * 1.5;
        const az = walk.z - Math.cos(walk.yaw) * 1.5;
        walkFocus = {
          kind: 'tool',
          label: clubhouseApi.isInside(ax, az)
            ? clubhouseApi.vacuumLabelAt(ax, az)
            : 'Vacuum - take it inside the shop · [F] choose another tool',
          cell: null,
        };
        return;
      }
      if (walkTool === 'washer') {
        walkFocus = {
          kind: 'tool',
          label: 'Pressure washer - hold [LMB] to wash · hold [RMB] to apply soap · [F] tools',
          cell: null,
        };
        return;
      }
      const labelHook = { hose: walkHooks.hoseLabelAt, divot: walkHooks.divotLabelAt, rake: walkHooks.rakeLabelAt }[walkTool];
      const aim = walkAimCell(3.0);
      if (aim && labelHook) {
        walkFocus = { kind: 'tool', label: labelHook(aim.x, aim.y), cell: aim };
        return;
      }
    }
    // placed props (repair yard, tools, signs): nearest one you're facing
    let bestProp = null;
    let bestLabel = '';
    let bestScore = 1e9;
    for (const p of walkProps) {
      // Most props keep their stable XZ interaction origin. Authored moving
      // equipment can additionally expose one live 3D focus point; resolve it
      // only inside a coarse reach gate so distant props do no matrix work.
      const coarseDx = p.x - walk.x;
      const coarseDz = p.z - walk.z;
      if (Math.hypot(coarseDx, coarseDz) > p.r + 0.75) continue;
      // Shelf cartons can share the same x/z on different authored levels, so
      // props carrying an aim height score against the real first-person ray.
      // walkPropAimScore is that rule, shared with the station selector above.
      const { dist, facing, score: focusDistance } = walkPropAimScore(p);
      if (dist > p.r) continue;
      if (focusDistance >= bestScore) continue;
      const candidateLabel = facing > 0.3 ? p.label() : '';
      if (candidateLabel) { // a falsy label = the prop is dormant right now
        bestProp = p;
        bestLabel = candidateLabel;
        bestScore = focusDistance;
      }
    }
    if (bestProp) {
      walkFocus = { kind: 'prop', label: bestLabel, prop: bestProp };
      return;
    }
    // a cleaning tool out: the prompt becomes a live capacity / readiness readout.
    if (CLEANING_TOOLS[walkTool] && clubhouseApi?.cleaningLabel) {
      const label = clubhouseApi.cleaningLabel(walkTool);
      if (label) {
        walkFocus = { kind: 'hose', label: `${label} · [F] next tool`, cell: null };
        return;
      }
    }
    // a tool out: the prompt becomes a live readout on the patch ahead
    if (walkTool === 'vacuum') {
      if (clubhouseApi) {
        const ax = walk.x - Math.sin(walk.yaw) * 1.5;
        const az = walk.z - Math.cos(walk.yaw) * 1.5;
        const label = clubhouseApi.isInside(ax, az)
          ? clubhouseApi.vacuumLabelAt(ax, az)
          : 'Vacuum - take it inside the shop';
        if (label) {
          walkFocus = { kind: 'hose', label, cell: null };
          return;
        }
      }
    } else if (walkTool) {
      const labelHook = {
        hose: walkHooks.hoseLabelAt,
        divot: walkHooks.divotLabelAt,
        ballmark: walkHooks.ballmarkLabelAt,
        rake: walkHooks.rakeLabelAt,
        debris: walkHooks.debrisLabelAt,
        fungicide: walkHooks.fungicideLabelAt,
        spreader: walkHooks.spreaderLabelAt,
        greensMower: walkHooks.greensMowerLabelAt,
      }[walkTool];
      const aim = walkAimCell(3.0);
      if (aim && labelHook) {
        walkFocus = { kind: 'hose', label: labelHook(aim.x, aim.y, aim.worldX, aim.worldZ), cell: aim };
        return;
      }
    }
    // the ground ahead: the same inspect the top-down click used to open
    const aim = walkAimCell();
    if (aim && premiumClubhouseOwnsSiteAt(aim.worldX, aim.worldZ)) {
      walkFocus = null;
      return;
    }
    if (aim && walkHooks.turfLabelAt) {
      const label = walkHooks.turfLabelAt(aim.x, aim.y, aim.worldX, aim.worldZ);
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
      if (!isRepeat) walkHooks.inspectAt(
        walkFocus.cell.x,
        walkFocus.cell.y,
        walkFocus.cell.worldX,
        walkFocus.cell.worldZ,
      );
    }
  }

  // Optional second prop verb. Delivery cartons use this to keep the familiar
  // [E] unboxing lifecycle while still letting the player lift and reposition
  // a carton from an unpacking surface. A secondary verb always needs free
  // hands, so a contextual tool is stowed before it fires.
  function walkInteractSecondary(isRepeat = false) {
    if (!walk.active || isRepeat || cart.mounted) return false;
    if (!walkFocus || walkFocus.kind !== 'prop' || !walkFocus.prop.secondaryAction) return false;
    // Never let X short-circuit the contextual E release gate. In particular,
    // the placement key may still be physically down during the first frame
    // after a carton lands on a work surface.
    if (heldAction('interact') || contextToolRequiresRelease) return false;
    if (walkTool) walkSetTool(null);
    autoTool = null;
    walkFocus.prop.secondaryAction();
    return true;
  }

  // --- HOLD-TO-PROGRESS + CONTEXTUAL TOOL ----------------------------------------------------
  // A prop can expose `hold(dt)` (feed the shelf one product at a time)
  // and `tool`. The first interaction equips that contextual tool; releasing E
  // arms the subsequent deliberate hold. Looking away stows it automatically.
  let autoTool = null;
  let contextToolRequiresRelease = false;
  let holdActive = false;      // are we mid-hold this frame? (drives the hands' cutting motion)
  let holdPressProp = null;    // a held interaction never transfers targets mid-press
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
    if (!heldAction('interact')) return;
    if (walkFocus.prop !== holdPressProp) return;
    if (contextToolRequiresRelease) return;
    const requestedTool = walkFocus.prop.tool || null;
    if (requestedTool && walkTool !== requestedTool) return;
    walkFocus.prop.hold(dt);
    holdActive = true;
  }

  // Modifiers stranded by a release the page never saw. Runs before the
  // text-entry filter: a phantom held while the player types is still a phantom,
  // and every event carrying getModifierState is a chance to see the OS's real
  // answer (heldKeys.js rules 4 and 5).
  //
  // Bound to mousemove above all. Keydown alone cannot fix this: a stranded
  // Meta turns D into Win+D, the OS eats it, and the keydown the reconcile was
  // waiting for never arrives. Looking around does arrive, constantly, and
  // needs no deliberate act from a player who cannot see the problem.
  function walkReconcileModifiers(e, source) {
    // What the OS says, recorded whether or not the page believes anything. This
    // is the half that was missing for three reports of the same bug: a reconcile
    // can only DROP what the page already holds, so an OS-level strand — where
    // the shell eats the keydown and walkHeld never learns of it — was invisible
    // to every instrument pointed at it. See heldKeys.js rule 6.
    const observed = observedModifiers(e);
    if (observed) walkOsModifiers = observed;
    const dropped = reconcileModifiers(walkHeld, e);
    if (!dropped.length) return;
    walkPhantomModifiers.push(...dropped);
    walkLastReconcileSource = source || e?.type || null;
  }

  // Keys the walker consumes. While pointer-locked these are swallowed outright
  // so that a modifier stuck BELOW the browser — the case no page code can
  // release — cannot turn a movement key into a browser shortcut mid-stride.
  // Escape and the F-keys are deliberately absent: the player must always be
  // able to break out, and Escape is what releases the lock.
  //
  // THE RULE IS "EVERY KEY THE GAME ACTS ON IN WALK MODE", and the set used to hold only
  // the movement half of it. Measured 2026-07-29 (six-key-cases-chromium.json): X — the
  // secondary-interact verb, the key the player opens boxes with — reached the listener
  // with preventDefault NEVER called, while D and W were swallowed correctly. A verb the
  // game consumes and the page also lets through is the definition of a key that does two
  // things at once. The single-letter verbs main.js binds in the walk branch are all here
  // now: x b j l i g c m v alongside e q r f.
  //
  // Safe because the text-entry filter runs FIRST: a key typed into the laptop search box
  // or a save-name field returns before this line, so Ctrl+C in a text field still copies.
  // While pointer-locked with no focused field there is nothing to copy, cut or paste.
  // This still cannot stop a browser-RESERVED chord (Ctrl+W, Ctrl+T, Ctrl+L) — only the
  // Keyboard Lock API can, and that is declined (needs fullscreen, makes Escape a
  // press-and-hold). It does stop everything the page is allowed to claim.
  // Literal keys the walker always swallows while pointer-locked, plus
  // whatever the binding table currently claims (N2/F2 - rebinding a verb to
  // any key must also stop that key reaching the page).
  const WALK_CONSUMED_LITERALS = new Set([
    ' ', 'tab',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
    'b', 'i', 'g', 'c', 'm',
  ]);
  function walkConsumesKey(key) {
    if (WALK_CONSUMED_LITERALS.has(key)) return true;
    const bindings = walkHooks.bindings ? walkHooks.bindings() : DEFAULT_BINDINGS;
    for (const action of BINDABLE_ACTIONS) {
      if ((bindings[action.id] || action.defaultKey) === key) return true;
    }
    return false;
  }

  function walkKeyDown(e) {
    walkReconcileModifiers(e, 'keydown');
    // A key typed into a form control (a laptop search field, a save-name box)
    // is text, not movement. Filter key-DOWN only — the matching release below
    // must always clear, or a field grabbing focus mid-press strands the key in
    // walkHeld and the walker drifts forever (heldKeys.js rule 3).
    if (isTextEntryTarget(e.target)) return;
    const key = e.key.toLowerCase();
    // Swallow the walk keys while the player is actually in the world. This is
    // the mitigation for the half of the bug the page cannot repair: preventDefault
    // stops the page-level default and any shortcut the browser allows a page to
    // claim. It cannot stop a browser-RESERVED chord (Ctrl+W, Ctrl+T, Ctrl+N in
    // Chrome) — only the Keyboard Lock API can, and that needs fullscreen and
    // makes Escape a press-and-hold. See OVERNIGHT_REPORT_2.md.
    if (document.pointerLockElement === canvas && walkConsumesKey(key)) e.preventDefault();
    if (key === boundWalkKey('interact') && !walkHeld.has(key)) {
      holdPressProp = walkFocus && walkFocus.kind === 'prop' && walkFocus.prop.hold
        ? walkFocus.prop
        : null;
    }
    walkHeld.add(key);
  }
  function walkKeyUp(e) {
    walkReconcileModifiers(e, 'keyup');
    const key = e.key.toLowerCase();
    if (document.pointerLockElement === canvas && walkConsumesKey(key)) e.preventDefault();
    walkHeld.delete(key);
    if (key === boundWalkKey('interact')) {
      contextToolRequiresRelease = false;
      holdPressProp = null;
    }
  }
  // Pointer and wheel events inherit getModifierState from MouseEvent, so they
  // reconcile too. Cheap, and they cover the player who clicks or scrolls
  // without moving the mouse far enough to fire a movement.
  function walkPointerEvent(e) {
    walkReconcileModifiers(e, e?.type || 'pointer');
  }
  // Everything the player is physically holding, released. Called from all three
  // ways input can be interrupted without the matching keyup ever arriving:
  // window blur, tab/window visibility, and pointer-lock loss.
  //
  // Two of those were already covered, but not from here: main.js's
  // resetCameraInput() reaches in through walk.clearKeys (which IS this
  // function) on both blur and pointerlockchange. visibilitychange was the real
  // gap — main.js's handler only recovers the register — and the walk
  // controller owning its own release is the right locus regardless, so all
  // three now bind locally. main.js's toolChanged hook is an audio release and
  // was already written for the pointer-lock case.
  //
  // None of this is sufficient on its own: a Windows-key tap can strand 'meta'
  // without ever firing any of the three, which is what the ?keydebug=1 capture
  // caught. That case is handled by the reconcile above, not here.
  function walkBlur() {
    walkHeld.clear();
    holdPressProp = null;
    contextToolRequiresRelease = false;
    walkSetSpraying(false);
    walkSetSoaping(false);
    walkHooks.toolChanged?.(walkTool || null, walkTool || null);
  }
  function walkVisibilityChange() {
    if (document.visibilityState === 'hidden') walkBlur();
  }

  // BACKSTOP. A timer carries no event, so it cannot ask getModifierState — there
  // is no way to reconcile from a tick, and pretending otherwise would be the
  // eleventh instrument measuring the wrong thing. What it CAN settle is the
  // precondition the whole class depends on: whether this document still has the
  // keyboard at all.
  //
  // Tapping the Windows key hands focus to the shell. The blur event is the
  // normal signal, but blur is not guaranteed — it is missed when focus moves to
  // browser chrome, and a page that never gets it holds its keys forever.
  // document.hasFocus() is a poll of the same fact that does not depend on an
  // event arriving, so a lost keyboard is caught within one tick either way.
  const WALK_FOCUS_POLL_MS = 500;
  let walkFocusPoll = 0;
  function walkFocusBackstop() {
    if (!walk.active) return;
    if (typeof document.hasFocus !== 'function' || document.hasFocus()) return;
    // No keyboard means no reading of the keyboard. A "Meta down" observed before
    // focus left would otherwise sit on the HUD as a live fault after the player
    // has already cleared it somewhere else. The next event repopulates it.
    walkOsModifiers = [];
    // The held-set check comes AFTER the clear above, and is only here to keep
    // walkBlur's tool-changed hook from firing every tick while the window is in
    // the background. Clearing everything on lost focus is the whole point.
    if (!walkHeld.size) return;
    walkBlur();
    walkLastReconcileSource = 'focus-backstop';
  }
  // Ignore the first mouse events after (re)acquiring pointer lock. Browsers can
  // deliver a large accumulated movementX/Y in that first event — the classic
  // cause of a sudden 180 spin after an alt-tab, a click-back, or a re-lock.
  let walkLockGuard = 0;
  function walkLockChange() {
    if (document.pointerLockElement === canvas) walkLockGuard = 2;
    else walkBlur(); // lock lost: whatever was down was released somewhere we cannot see
  }

  function walkMouseMove(e) {
    // BEFORE the pointer-lock gate on purpose. A phantom modifier is most likely
    // to be picked up exactly when the lock has just been lost and regained, and
    // the reconcile must not be gated on the state the bug interferes with.
    walkReconcileModifiers(e, 'mousemove');
    if (document.pointerLockElement !== canvas) return;
    if (walkLockGuard > 0) { walkLockGuard -= 1; return; }
    const sens = walk.sens || 1; // pause-menu mouse sensitivity
    // applyMouseLook clamps the per-event delta (no 180 whip on a reacquisition
    // jump), applies sensitivity, wraps yaw and clamps pitch — see mouseLook.js.
    const movementY = walk.invertY ? -e.movementY : e.movementY;
    const next = applyMouseLook(walk.yaw, walk.pitch, e.movementX, movementY, sens);
    walk.yaw = next.yaw;
    walk.pitch = next.pitch;
  }

  // where you land when stepping out the clubhouse door: just past the porch
  function walkDefaultSpawn() {
    const s = course.structures[0];
    if (!s) return { x: 0, z: 0, yaw: Math.PI };
    const wx = (s.x + s.w / 2) * CELL_YD - worldW / 2;
    const wz = (s.y + s.h / 2) * CELL_YD - worldH / 2;
    return { x: wx + DOOR_MAIN.x, z: wz + 8.2 + 5.5, yaw: 0 }; // aligned to the authored entry doors
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
    camera.fov = walk.fov || 66; // the management rig uses 46
    camera.near = 0.15;
    camera.updateProjectionMatrix();
    heldRoot.visible = !!walkTool && walkTool !== 'greensMower' && walkTool !== 'spreader';
    // Re-arm the held rig's own pass, which walkExit switched off so the till
    // and the overview camera would not inherit a floating tool. Without this
    // the tool would come back invisible after any trip to the counter.
    // Deactivations first — same ordering contract as setTool.
    if (toolRigs[walkTool]) enableBroomLightLayer();
    for (const [rigId, rig] of Object.entries(toolRigs)) if (rigId !== walkTool) rig.setActive(false);
    toolRigs[walkTool]?.setActive(true);
    window.addEventListener('keydown', walkKeyDown);
    window.addEventListener('keyup', walkKeyUp);
    window.addEventListener('blur', walkBlur);
    document.addEventListener('visibilitychange', walkVisibilityChange);
    document.addEventListener('mousemove', walkMouseMove);
    document.addEventListener('pointerdown', walkPointerEvent);
    document.addEventListener('pointerup', walkPointerEvent);
    document.addEventListener('wheel', walkPointerEvent, { passive: true });
    document.addEventListener('pointerlockchange', walkLockChange);
    clearInterval(walkFocusPoll);
    walkFocusPoll = setInterval(walkFocusBackstop, WALK_FOCUS_POLL_MS);
    walkLockGuard = 2; // guard the initial lock too
  }

  function walkExit() {
    if (!walk.active) return;
    if (cart.mounted) dismountCart();
    walk.active = false;
    walkSetSpraying(false);
    walkSetSoaping(false);
    heldRoot.visible = false; // the overview camera carries no hand tools
    // The broom draws in its OWN pass, after the world, gated only on the
    // viewmodel's `active` flag, so hiding the shared held rig is not enough
    // here either.
    //
    // C10: this used to claim it also covered the till. It never did — walkExit
    // runs on scene DISPOSE and on nothing else, so the counter never reached
    // it, and eight other tools were never in scope even if it had. The station
    // stow is syncStationToolStow(), ticked every frame.
    for (const rig of Object.values(toolRigs)) rig.setActive(false);
    walkHeld.clear();
    // The dirt reveal is driven from the walk update, so leaving on foot with Q
    // down (opening the laptop, stepping to the till) would strand it lit with
    // nothing left to turn it off. The overview re-asserts its own markers.
    dirtSenseAlpha = 0;
    dirtSenseLinger = 0;
    dirtSenseAimed = null;
    clubhouseApi?.setDirtReveal?.(0, false);
    window.removeEventListener('keydown', walkKeyDown);
    window.removeEventListener('keyup', walkKeyUp);
    window.removeEventListener('blur', walkBlur);
    document.removeEventListener('visibilitychange', walkVisibilityChange);
    document.removeEventListener('mousemove', walkMouseMove);
    document.removeEventListener('pointerdown', walkPointerEvent);
    document.removeEventListener('pointerup', walkPointerEvent);
    document.removeEventListener('wheel', walkPointerEvent);
    document.removeEventListener('pointerlockchange', walkLockChange);
    clearInterval(walkFocusPoll);
    walkFocusPoll = 0;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    camera.fov = 46; // hand the camera back to the management rig
    camera.near = 1;
    camera.updateProjectionMatrix();
    rig.apply();
  }

  // D1 (Goal 23): the boards under the player's feet, for the held tool's yarn
  // solver. Same source walkUpdate uses for the camera, so the mop's strands
  // land on the floor the player is standing on rather than passing through it.
  function walkFloorWorldY() {
    if (!walk.active) return null;
    const boards = clubhouseApi ? clubhouseApi.groundYAt(walk.x, walk.z) : null;
    if (boards !== null && boards !== undefined) return boards;
    const turf = walkSurfaceHeightAt(walk.x, walk.z);
    return Number.isFinite(turf) ? turf : null;
  }

  function walkUpdate(dtMs) {
    if (!walk.active) return;
    const dt = dtMs / 1000;
    toolViewmodels.update(dt, walkFloorWorldY());
    const px0 = walk.x; // where this frame started, so recovery can tell moving from pinned
    const pz0 = walk.z;

    // focus mode (laptop): ease the camera onto the pose, park all input
    focusBlend = walk.reducedMotion
      ? (walkFocusPose ? 1 : 0)
      : clamp(focusBlend + (walkFocusPose ? 1 : -1) * (dt / 0.4), 0, 1);
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
      if (focusBaseFov != null) {
        if (Math.abs(camera.fov - focusBaseFov) > 0.01) {
          camera.fov = focusBaseFov;
          camera.updateProjectionMatrix();
        }
        focusBaseFov = null;
      }
    }

    // fallback look controls (also QA/accessibility — same as the shop)
    if (walkHeld.has('arrowleft')) walk.yaw += 1.9 * dt;
    if (walkHeld.has('arrowright')) walk.yaw -= 1.9 * dt;
    if (walkHeld.has('arrowup')) walk.pitch = clamp(walk.pitch + 1.3 * dt, -1.35, 1.35);
    if (walkHeld.has('arrowdown')) walk.pitch = clamp(walk.pitch - 1.3 * dt, -1.35, 1.35);

    if (cart.mounted) {
      walkMoving = false; // hands on the wheel
      if (cart.vehicleKind === 'golf-cart' && playerGolfCartVisual?.root) {
        const visual = playerGolfCartVisual;
        const fleetCart = visual.cartState;
        const root = visual.root;
        const forwardHeld = heldAction('moveForward');
        const reverseHeld = heldAction('moveBack');
        const hardBrake = walkHeld.has(' ');
        const brakingInput = hardBrake
          || (reverseHeld && cart.velocity > 0.05)
          || (forwardHeld && cart.velocity < -0.05);
        let targetVelocity = forwardHeld ? cart.speed : reverseHeld ? -cart.reverse : 0;
        if (brakingInput || fleetCart.batteryPercent <= 0.01) targetVelocity = 0;
        const changingDirection = Math.sign(targetVelocity) !== 0
          && Math.sign(cart.velocity) !== 0
          && Math.sign(targetVelocity) !== Math.sign(cart.velocity);
        const response = hardBrake || brakingInput || changingDirection
          ? cart.braking
          : targetVelocity === 0 ? 2.2 : cart.acceleration;
        const velocityDelta = clamp(targetVelocity - cart.velocity, -response * dt, response * dt);
        cart.velocity += velocityDelta;
        if (Math.abs(cart.velocity) < 0.015 && targetVelocity === 0) cart.velocity = 0;
        const steer = (heldAction('moveLeft') ? 1 : 0) - (heldAction('moveRight') ? 1 : 0);
        let turnDelta = 0;
        if (steer && Math.abs(cart.velocity) > 0.035) {
          const speedAuthority = clamp(Math.abs(cart.velocity) / Math.max(2, cart.speed * 0.55), 0.22, 1);
          const direction = cart.velocity >= 0 ? 1 : -0.72;
          turnDelta = steer * cart.turnRate * speedAuthority * direction * dt;
          cart.yaw += turnDelta;
          walk.yaw += turnDelta;
        }
        const signedTravel = cart.velocity * dt;
        const beforeX = walk.x;
        const beforeZ = walk.z;
        golfCartTryMove(
          -Math.sin(cart.yaw) * signedTravel,
          -Math.cos(cart.yaw) * signedTravel,
          cart.radius,
        );
        const travel = Math.hypot(walk.x - beforeX, walk.z - beforeZ);
        if (Math.abs(signedTravel) > 0.02 && travel < Math.abs(signedTravel) * 0.2) cart.velocity *= 0.18;
        cart.x = walk.x;
        cart.z = walk.z;
        groundGolfCart(root, cart.x, cart.z, cart.yaw);
        animateGolfCart(root, Math.sign(cart.velocity || signedTravel) * travel, steer * 0.2, 0);
        setGolfCartLights(root, Boolean(fleetCart.lightsOn), brakingInput || hardBrake, steer, dt);
        fleetCart.position = { x: cart.x, z: cart.z };
        fleetCart.yaw = cart.yaw;
        fleetCart.parkedByPlayer = true;
        fleetCart.drivenDistanceYd = Number(fleetCart.drivenDistanceYd || 0) + travel;
        fleetCart.batteryPercent = clamp(
          fleetCart.batteryPercent - travel * 0.0031 - (fleetCart.lightsOn ? dt * 0.0012 : 0),
          0,
          100,
        );
        fleetCart.condition = clamp(fleetCart.condition - travel * 0.000035, 0, 100);
        if (fleetCart.batteryPercent <= 0.01 && !cart.batteryWarned) {
          cart.batteryWarned = true;
          walkHooks.toast?.(`${fleetCart.id.toUpperCase()} battery depleted. Park and charge the cart.`);
        } else if (fleetCart.batteryPercent > 1) cart.batteryWarned = false;
        animateTractor(dt, 0, 0, 0, false);
        updateClippings(dt, walk.x, 0, walk.z, false);
      } else {
      // cart handling: W/S throttle along the heading, A/D steer — no strafing
      const throttle = (heldAction('moveForward') ? 1 : 0) - (heldAction('moveBack') ? 1 : 0);
      const steer = (heldAction('moveLeft') ? 1 : 0) - (heldAction('moveRight') ? 1 : 0);
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
      let tractorCutting = false;

      // the hitched deck CUTS: cells under it (2.5 yd behind the seat, the
      // deck's width) mow to the zone's ideal height through the same hook
      // family the hose uses — real sim writes, stripes as the payoff
      const tractorMower = state.courseMaintenance?.equipment?.tractor;
      if (throttle && walkHooks.mowAt && state.tractor && state.tractor.repaired && tractorMower?.bladesEngaged) {
        const dxT = walk.x + Math.sin(walk.yaw) * 2.5;
        const dzT = walk.z + Math.cos(walk.yaw) * 2.5;
        const rx = Math.cos(walk.yaw);
        const rz = -Math.sin(walk.yaw);
        for (const off of [-1.1, 0, 1.1]) {
          const mx = dxT + rx * off;
          const mz = dzT + rz * off;
          const cx = Math.floor((mx + worldW / 2) / CELL_YD);
          const cy = Math.floor((mz + worldH / 2) / CELL_YD);
          if (cx >= 0 && cy >= 0 && cx < W && cy < H) {
            const result = walkHooks.mowAt(cx, cy, {
              x: mx,
              z: mz,
              radiusYd: 1.25,
              mowerType: tractorMower.mowerType,
              bladesEngaged: tractorMower.bladesEngaged,
              speedYdPerSec: throttle > 0 ? cart.speed : cart.reverse,
              directionRad: walk.yaw,
            });
            if (result?.changed) cut = true;
            if (!result?.ok && result?.reason && maintenanceFeedbackClock <= 0) {
              maintenanceFeedbackClock = 2.5;
              if (walkHooks.toast) walkHooks.toast(result.reason, 'warn');
            }
          }
        }
        if (tractorCutting) {
          mowTexClock += dt;
          if (mowTexClock >= 0.25) {
            mowTexClock = 0;
            updateTurf(state);
            updateCourseMaintenance(state);
            refreshMaintenanceWorldProps();
          }
        } else {
          mowTexClock = 0.25; // next cut repaints immediately
        }
        updateClippings(dt, dxT, heightAt(dxT, dzT), dzT, tractorCutting);
      } else {
        updateClippings(dt, walk.x, heightAt(walk.x, walk.z), walk.z, false);
      }
      const travel = Math.hypot(walk.x - px0, walk.z - pz0);
      animateTractor(dt, travel, throttle, steer, tractorCutting);
      recordTractorUse(state, {
        x: cart.x, z: cart.z, yaw: cart.yaw, seconds: dt, mowing: tractorCutting,
      });
      tractorPark.x = cart.x;
      tractorPark.z = cart.z;
      tractorPark.yaw = cart.yaw;
      }
    } else {
      animateTractor(dt, 0, 0, 0, false);
      updateClippings(dt, walk.x, 0, walk.z, false); // clippings settle after you hop off
      // I2: running with a cleaning tool out capped separately — 6.12 yd/s with
      // a broom in both hands read as flat sprinting. The cap lives in
      // locomotion.js so BROOM_FEEL.dirt.pushSpeed can derive from the SAME
      // number and the push-beats-run invariant cannot silently split into two
      // authorities again (the original pushSpeed defect, one layer up).
      const run = heldAction('run')
        ? (walkTool && CLEANING_TOOLS[walkTool] ? TOOL_RUN_MULTIPLIER : walk.runMult)
        : 1;
      // a full armful or a heavy carton slows you down — sim/stocking says by how much
      const load = clubhouseApi && clubhouseApi.carrySpeedFactor ? clubhouseApi.carrySpeedFactor() : 1;
      const carryRadius = clubhouseApi && clubhouseApi.carryCollisionRadius
        ? Math.max(walk.radius, clubhouseApi.carryCollisionRadius())
        : walk.radius;
      let mx = 0;
      let mz = 0;
      if (heldAction('moveForward')) mz -= 1;
      if (heldAction('moveBack')) mz += 1;
      if (heldAction('moveLeft')) mx -= 1;
      if (heldAction('moveRight')) mx += 1;
      walkMoving = !!(mx || mz);
      // DID THE MOVEMENT HANDLER RUN, and what did it want? The one question about the
      // input chain that cannot be answered from outside this closure: position delta is
      // a proxy that reads identically for "the key never arrived" and "the key arrived
      // and a wall was in the way". Recorded as intent, before collision has an opinion.
      if (walkMoveIntent.recording) {
        walkMoveIntent.frames += 1;
        if (mx || mz) {
          walkMoveIntent.movingFrames += 1;
          walkMoveIntent.last = { mx, mz };
          if (mx > 0) walkMoveIntent.right += 1;
          if (mx < 0) walkMoveIntent.left += 1;
          if (mz < 0) walkMoveIntent.forward += 1;
          if (mz > 0) walkMoveIntent.back += 1;
        }
      }
      if (mx || mz) {
        const len = Math.hypot(mx, mz);
        const s = (walk.speed * run * load * dt) / len;
        const sin = Math.sin(walk.yaw);
        const cos = Math.cos(walk.yaw);
        walkTryMove((mx * cos + mz * sin) * s, (-mx * sin + mz * cos) * s, carryRadius);
      }
    }

    walkRecover(dtMs, px0, pz0);
    const distanceMoved = Math.hypot(walk.x - px0, walk.z - pz0);
    // E2 (Full_Goal_16): the gait phase lives with the WALK, not with the
    // held-tool viewmodel — its old home early-returned whenever no tool was
    // drawn, freezing bobPhase (and with it the camera bob and any footfall)
    // for the bare-handed player. One advance per frame, here.
    bobPhase += dt * (walkMoving ? STRIDE_RATE_RAD_S : IDLE_SWAY_RATE_RAD_S);
    updatePushedEquipment(dt, distanceMoved);
    if (!routeArrivalNotified && yardHome && Math.hypot(walk.x - yardHome.x, walk.z - yardHome.z) < 12) {
      routeArrivalNotified = true;
      if (walkHooks.maintenanceArrive) walkHooks.maintenanceArrive();
    }

    // camera: first-person on foot, third-person chase in the seat — EASED
    // between the two so mounting reads as a real transition, not a cut
    mountBlend = walk.reducedMotion
      ? (cart.mounted ? 1 : 0)
      : clamp(mountBlend + (cart.mounted ? 1 : -1) * (dt / 0.45), 0, 1);
    const mb = mountBlend * mountBlend * (3 - 2 * mountBlend);
    // inside the clubhouse (or on its porch) you stand on the level floor slab
    const floorY = clubhouseApi ? clubhouseApi.groundYAt(walk.x, walk.z) : null;
    const groundY = floorY !== null && floorY !== undefined ? floorY : walkSurfaceHeightAt(walk.x, walk.z);
    const stepSin = Math.sin(bobPhase);
    const stepDelta = stepSin - stepBobSin;
    // a teleport (door warp, QA staging) is not a stride — a frame that moved
    // more than any legal step clears the gate instead of loading it
    if (distanceMoved < 1.0) stepDistAccum += distanceMoved;
    else stepDistAccum = 0;
    // standing still forfeits stride credit: the first step after a pause is
    // a full step, and credit can never carry across a staging teleport
    // (position assignment between frames is invisible to distanceMoved)
    if (!walkMoving) {
      stepIdleS += dt;
      if (stepIdleS > 0.35) stepDistAccum = 0;
    } else {
      stepIdleS = 0;
    }
    if (walkMoving && mb <= 0.001 && stepBobDelta < 0 && stepDelta >= 0 && stepDistAccum > 0.22) {
      if (walkHooks.footstep) {
        walkHooks.footstep(
          floorY !== null && floorY !== undefined ? 'boards' : 'turf',
          heldAction('run') ? 1.25 : 1,
        );
      }
      stepDistAccum = 0;
    }
    stepBobSin = stepSin;
    stepBobDelta = stepDelta;
    if (mb <= 0.001) {
      const bob = walk.cameraBob && !walk.reducedMotion && walkMoving
        ? Math.sin(bobPhase) * 0.018
        : 0;
      camera.position.set(walk.x, groundY + walk.eye + bob, walk.z);
      setFirstPersonOrientation(camera, walk.yaw, walk.pitch);
    } else {
      if (cart.mounted && cart.vehicleKind === 'golf-cart' && playerGolfCartVisual?.root) {
        const root = playerGolfCartVisual.root;
        root.updateMatrixWorld(true);
        const anchorName = cart.cameraMode === 'vehicle' ? 'VEHICLE_CAMERA_ANCHOR' : 'DRIVER_CAMERA_ANCHOR';
        const cameraAnchor = golfCartAnchorWorld(root, anchorName, golfCartWorldPoint);
        if (cameraAnchor) {
          if (cart.cameraMode === 'driver') {
            // Keep the authored eye point on the driver side, then ease it a
            // little lower and rearward so the wheel and dashboard stay in the
            // natural forward sightline without the roof lip pinching it.
            golfCartColliderCorner.set(0.08, -0.10, 0.24).applyQuaternion(root.quaternion);
            cameraAnchor.add(golfCartColliderCorner);
            camera.position.set(
              walk.x + (cameraAnchor.x - walk.x) * mb,
              groundY + walk.eye + (cameraAnchor.y - groundY - walk.eye) * mb,
              walk.z + (cameraAnchor.z - walk.z) * mb,
            );
            setFirstPersonOrientation(camera, walk.yaw, walk.pitch);
          } else {
            // The authored anchor is already a measured rear chase position.
            // Respecting it keeps the road ahead readable while the whole cart
            // remains in frame; exterior inspection is handled on foot.
            camera.position.copy(cameraAnchor);
            const center = golfCartAnchorWorld(root, 'VEHICLE_CENTER', golfCartWorldPointB);
            camera.lookAt(center?.x ?? walk.x, (center?.y ?? groundY) + 0.4, center?.z ?? walk.z);
          }
        } else {
          camera.position.set(walk.x, groundY + cart.eye, walk.z);
          setFirstPersonOrientation(camera, walk.yaw, walk.pitch);
        }
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
    }
    walkFindFocus();
    reconcileAutoTool();   // contextual prop tools equip on focus, stow on look-away
    runHold(dt);           // holding E runs whatever the focused prop exposes as a hold verb
    updateHeldFeel(dt);
    updateSprayMist(dt); // spray puff + hit-point glisten keep fading after the trigger releases

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
            if (walkHooks.toast) walkHooks.toast(t('world.theWaterIsRunning'), 'warn');
          }
          // The stream starts at the lance tip. This used to be a camera-local constant that
          // approximated the tip while the player stood still — it ignored heldRoot, so during the
          // equip ease the water appeared up to 42 cm below the nozzle it was supposedly leaving.
          // Reading the socket makes it right by construction instead of right by tuning.
          const nozzle = socketWorld(heldGroups.washer, 'nozzle', _washNozzle);
          // PRESSURE-LAG (visual only): the drawn stream reaches full length over WASHER_LAG after
          // the trigger, so the jet reads as pressure building instead of snapping to full extent.
          // The erosion above still bites at the TRUE hit — only the drawn endpoint ramps, and the
          // nozzle socket math and washAim are untouched. Deliberately NOT reducedMotion-gated:
          // the ramp is world-space state feedback (pressure building), not vestibular/UI motion.
          washerJetRamp = Math.min(1, washerJetRamp + dt / WASHER_LAG);
          const reach = 0.35 + 0.65 * easeOutCubic(washerJetRamp);
          _washJetTo.copy(nozzle).lerp(hit.point, reach);
          clubhouseApi.washJet(nozzle, _washJetTo, true, dt);
        }
      }
      if (!hit) {
        washerJetRamp = 0; // the trigger is off (or nothing hit): the next blast ramps up fresh
        clubhouseApi.washJet(null, null, false, dt);
      }
    } else if (clubhouseApi && clubhouseApi.washJet) {
      clubhouseApi.washJet(null, null, false, dt);
    }
    // Exterior wet feedback keeps drying after the washer is stowed. The tick is a no-op once all
    // runtime wet cells reach zero, so ordinary indoor/course frames pay only this branch.
    clubhouseApi?.washTick?.(dt);

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
    floorAnchorDebug.frame += 1;
    for (const id of FLOOR_ANCHORED_TOOLS) {
      const g = heldGroups[id];
      // Dropping the tool forgets its accepted floor sample, so the next equip
      // snaps to the boards on its first frame instead of easing up from
      // wherever the last room's floor happened to be.
      if (!g || !g.visible) {
        floorAnchorSampleY.delete(id);
        floorAnchorDebug.tools[id] = { ran: false, why: g ? 'group not visible' : 'no group' };
        continue;
      }
      // Phase 6 → I1: any tool owned by a viewmodel rig gets its pose from the
      // rig (pitch-driven reach with the head planted), not this floor-plane
      // re-solve. Was broom-only; now mop, vacuum and dustpan ride the same
      // exemption while equipped.
      if (toolRigs[id]?.isActive()) {
        floorAnchorSampleY.delete(id);
        floorAnchorDebug.tools[id] = { ran: false, why: 'viewmodel rig owns the pose' };
        continue;
      }
      g.rotation.x = CLEANING_TOOLS[id].worldPitch - walk.pitch;
      // FLOOR-CONTACT SOLVE. The fixed world pitch keeps the head aimed down, but the head can still
      // hover or clip depending on stance and the equip/bob height. Sample the flat interior floor
      // under the contact socket and nudge the whole group in Y so strands/bristles/nozzle just kiss
      // the boards. groundYAt is O(1) indoors (a flat constant — no raycast). Sampling runs AFTER
      // updateHeldFeel, so the socket already carries the gait bob.
      //
      // E1/E2: THE GUARD USED TO BE THE SOLVE, AND IT SATURATED ON FRAME ONE.
      //
      // This applied `clamp(floorY - contactY, ±0.06)`. The comment called that
      // clamp a guard against a stray groundYAt sample, which is a real thing to
      // want — but the correction it has to make is 0.6 yd across the carried
      // band, an order of magnitude larger than the guard. So the clamp was
      // pinned at its limit on every frame and the head simply rode the camera
      // the rest of the way: mop, vacuum and dustpan all declared
      // `floorAnchored: true` and measured 0.61-0.64 yd of carried spread
      // (Designs/ProShop/TOOL_STANDARD_AUDIT.md). The flag was honest about
      // intent; the implementation could not deliver it at any tuning.
      //
      // The fix is to put the guard where it belongs. A stray sample is a bad
      // FLOOR HEIGHT, so guard the floor height: a real floor does not jump, so
      // the accepted sample may only travel FLOOR_SAMPLE_RATE yd/s. The pose
      // then applies the whole remaining correction immediately, so it responds
      // to a fast look at full speed and cannot saturate. The absolute envelope
      // below it is a sanity bound on a garbage sample, not a working range —
      // nothing legitimate asks a held tool to move two yards.
      const rest = g.userData.cleaningRestPosition;
      const rawFloorY = clubhouseApi && clubhouseApi.groundYAt ? clubhouseApi.groundYAt(walk.x, walk.z) : null;
      if (!rest || rawFloorY == null) {
        floorAnchorDebug.tools[id] = {
          ran: false,
          why: !rest ? 'no cleaningRestPosition on the group' : 'no groundYAt sample',
        };
        continue;
      }
      const prevFloorY = floorAnchorSampleY.get(id);
      const step = FLOOR_SAMPLE_RATE * dt;
      const floorY = prevFloorY === undefined ? rawFloorY
        : prevFloorY + Math.max(-step, Math.min(step, rawFloorY - prevFloorY));
      floorAnchorSampleY.set(id, floorY);
      g.position.copy(rest);
      const contactSocket = CLEANING_TOOLS[id].sockets.contact ? 'contact' : 'nozzle';
      socketWorld(g, contactSocket, _toolContact);
      const need = floorY - _toolContact.y;
      const applied = Math.max(-FLOOR_ANCHOR_ENVELOPE, Math.min(FLOOR_ANCHOR_ENVELOPE, need));
      // THE CORRECTION IS A WORLD-Y MOVE AND THE GROUP IS A CHILD OF THE CAMERA.
      //
      // Writing `position.y += need` looks right and is not: local +Y under a
      // camera pitched by p delivers only cos(p) of world +Y and drags the tool
      // backwards by the rest. That under-correction is invisible at the horizon
      // (cos 0 = 1) and total at the top of the look range (cos 1.35 = 0.22),
      // which is exactly the shape of "anchored when you work, rides the view
      // when you look up". So the move is decomposed into the frame the group
      // actually lives in. `residual` below re-samples the socket afterwards and
      // is the proof: if this decomposition were wrong it would not be ~0.
      const cp = Math.cos(walk.pitch);
      const sp = Math.sin(walk.pitch);
      g.position.set(rest.x, rest.y + applied * cp, rest.z - applied * sp);
      socketWorld(g, contactSocket, _toolContactAfter);
      floorAnchorDebug.tools[id] = {
        ran: true,
        floorY: +floorY.toFixed(4),
        contactYBefore: +_toolContact.y.toFixed(4),
        need: +need.toFixed(4),
        applied: +applied.toFixed(4),
        saturated: Math.abs(applied) >= FLOOR_ANCHOR_ENVELOPE - 1e-6,
        residual: +(floorY - _toolContactAfter.y).toFixed(4),
      };
    }
    // E1/E2: THE FOUR STATIC TOOLS.
    //
    // dustpan, spray, washer and trashbag each returned ONE distinct transform
    // across two full seconds of held use — not a small animation, none at all —
    // while mop, cloth, sponge and vacuum all had a stroke. The machinery was
    // never per-tool: the cleaning block dispatches on toolClass, scoop, jet and
    // carry had no branch, and the washer does not even reach that block because
    // it is `external` and the pressure-jet path owns it.
    //
    // So the motion is declared on the tool (cleaningTools.js `useMotion`) and
    // driven HERE, above every one of those forks, where a held tool is a held
    // tool. A new class needs data rather than a fifth branch.
    //
    // x, z and roll only: the floor-contact solve above is authoritative on y
    // and pitch for anchored tools, and this is exactly the collision that cost
    // this item its first two attempts.
    if (walkSpraying && !cart.mounted && CLEANING_TOOLS[walkTool]?.useMotion
      && !rigFor(walkTool)?.isActive()) {
      const g = heldGroups[walkTool];
      const rest = g?.userData?.cleaningRestPosition;
      if (g && g.visible && rest) {
        const m = CLEANING_TOOLS[walkTool].useMotion;
        const phase = time * m.rate;
        const sx = Math.sin(phase);
        const cz = Math.cos(phase);
        const shake = m.jitter ? (Math.random() - 0.5) * m.jitter : 0;
        g.position.x = rest.x + sx * (m.swing?.[0] ?? 0) + shake;
        g.position.z = (CLEANING_TOOLS[walkTool].floorAnchored ? g.position.z : rest.z)
          + cz * (m.swing?.[1] ?? 0) + shake;
        g.rotation.z = g.userData.cleaningRestRotationZ + sx * (m.roll ?? 0);
        toolFeelIntensity = Math.abs(cz);
        toolFeelContact = true;
      }
    }
    // Phase 6: the broom viewmodel rig owns the broom pose. It runs BEFORE the
    // cleaning block so the contact socket resolves from the rig-posed group,
    // and its sub-2° eased contact kick rides the camera for this frame only
    // (the walk update rewrites camera pitch next frame).
    // I1: whichever rig owns the held tool updates here — same slot the broom
    // always used, same ordering contract (before the cleaning block so the
    // contact socket resolves from the rig-posed group). `broomPose` keeps its
    // name because the broom-specific dirt-push branches below key on it.
    const heldRig = rigFor(walkTool);
    // B2: the LIVE clone, not the frozen table — stroke.rate and anchor here
    // must answer the tuning overlay the same frame a slider moves.
    const rigFeel = heldRig ? liveToolFeel[walkTool] : null;
    const rigPose = heldRig && heldRig.isActive() ? heldRig.update(dt, {
      pitch: walk.pitch,
      yaw: walk.yaw,
      using: walkSpraying,
      moving: walkMoving,
      phase: time * (rigFeel ? rigFeel.stroke.rate : BROOM_RATE),
      reducedMotion: walk.reducedMotion,
      // NOT the walk speed, despite having been written as it: this is the
      // hand speed at which the sweep's audio and particles saturate, and it
      // sits deliberately BELOW a full walk so an ordinary stroke reads at
      // full strength. Named so it stops masquerading as a locomotion value.
      speedNorm: dt > 0
        ? Math.min(1, (distanceMoved / dt)
          / (liveToolFeel.broom || BROOM_FEEL).dirt.sweepIntensityFullYdS) : 0,
    }) : null;
    const broomPose = walkTool === 'broom' ? rigPose : null;
    if (rigPose && rigPose.cameraKickRad > 0.0001 && !walk.reducedMotion) {
      camera.rotation.x -= rigPose.cameraKickRad;
    }
    // The audio layers ride the rig's feel: intensity every frame, the
    // contact edge defined as "bristles in the fast window AND planted", and
    // the surface under the bristles so the loop's brightness answers it.
    if (broomPose) {
      const broomSurface = clubhouseApi?.cleaningSurfaceAt
        ? clubhouseApi.cleaningSurfaceAt(broomPose.contactX, broomPose.contactZ) : null;
      walkHooks.onBroomFeel?.(
        broomPose.intensity, broomPose.inContact && broomPose.planted, broomSurface,
      );
    } else if (rigPose) {
      // The other rig tools feed the same three audio layers through E3's
      // hook: intensity from the rig's stroke, contact from the plant (carry
      // rigs have no plant, so bare stroke contact carries them).
      toolFeelIntensity = rigPose.intensity;
      toolFeelContact = rigPose.inContact && (rigPose.planted || rigFeel?.anchor === 'carry');
    }
    // E3: THE SAME THREE LAYERS, FOR EVERY OTHER TOOL.
    //
    // onBroomFeel has driven the broom's start transient, its intensity- and
    // surface-following loop and its release tail since Phase 6. Nothing emitted
    // the equivalent for the other eight, so their loops were flat and their
    // declared start/stop sounds were never called (and did not exist). One hook,
    // same shape, for whatever is in hand.
    if (walkTool && walkTool !== 'broom' && CLEANING_TOOLS[walkTool]) {
      const surface = (toolFeelContact && clubhouseApi?.cleaningSurfaceAt)
        ? clubhouseApi.cleaningSurfaceAt(walk.x, walk.z) : null;
      walkHooks.onToolFeel?.(walkTool, toolFeelIntensity, toolFeelContact, surface);
    }
    toolFeelIntensity = 0;
    toolFeelContact = false;
    // --- DIRT SENSE ---------------------------------------------------------
    // Hold Q: every remaining pile lights up through the geometry, so the piles
    // behind the counter stop being invisible. Using a tool cancels it outright
    // (you are no longer looking, you are working), and it lingers briefly on
    // release so a glance survives letting go of the key.
    if (clubhouseApi?.setDirtReveal) {
      const senseHeld = heldAction('dirtSense') && !cart.mounted;
      // ITEM 11 (2026-08-06): "Q reveal invisible while brooming, exactly when
      // I need it."
      //
      // This branch used to test walkSpraying FIRST, so holding the use button
      // killed the reveal outright and an explicit Q hold could never be seen:
      // the alpha decayed to zero in 0.18 s and stayed there for as long as you
      // swept. The reasoning above ("you are no longer looking, you are
      // working") is sound for the LINGER — a reveal should not hang around
      // while you work — but it was applied to the deliberate hold too, which
      // is the one moment the player is asking for it on purpose.
      //
      // An explicit hold now wins. Working still cancels the linger, so the
      // reveal never trails a stroke you have stopped asking for.
      // F2: A PANEL IS NOT A GLANCE. With the register, the laptop or the
      // ledger open the player is reading a screen, not looking round the room —
      // and the reveal was still lit behind it, glowing through the furniture
      // under the UI, with the "[Q] reveal dirt" affordance still offered for a
      // key that now does nothing. Cut to zero immediately rather than fading:
      // a fade reads as the reveal following you into the panel.
      const stationOpen = !!walkHooks.stationOpen?.();
      if (stationOpen) {
        dirtSenseLinger = 0;
        dirtSenseAlpha = 0;
      } else if (senseHeld) {
        dirtSenseLinger = walkSpraying ? 0 : DIRT_SENSE.linger;
        dirtSenseAlpha = Math.min(1, dirtSenseAlpha + dt * DIRT_SENSE.rise);
      } else if (walkSpraying) {
        dirtSenseLinger = 0;
        dirtSenseAlpha = Math.max(0, dirtSenseAlpha - dt / 0.18);
      } else if (dirtSenseLinger > 0) {
        dirtSenseLinger = Math.max(0, dirtSenseLinger - dt);
      } else if (dirtSenseAlpha > 0) {
        dirtSenseAlpha = Math.max(0, dirtSenseAlpha - dt / DIRT_SENSE.fade);
      }
      // D3: the reveal answers the tool in your hands. A mop lights the grime
      // and not the piles it cannot lift; a broom does the reverse. With no
      // cleaning tool out it stays the whole-room "where is the mess" view.
      clubhouseApi.setDirtReveal(dirtSenseAlpha, false, walkTool);
    }
    // The reticle answers House Flipper 1's question: is the thing I am pointing
    // at actually cleanable? Only while a debris tool is out, and only within
    // its own reach, so the prompt never promises work the tool cannot do.
    dirtSenseAimed = null;
    if (clubhouseApi?.nearestDirt && walkTool && CLEANING_TOOLS[walkTool]
      && !cart.mounted && !walkSpraying) {
      const def = CLEANING_TOOLS[walkTool];
      const handlesDebris = Array.isArray(def.dirt) && def.dirt.includes(DIRT.DEBRIS);
      if (handlesDebris) {
        // Where the CROSSHAIR meets the floor — not simply the tool's maximum
        // reach, which aims past whatever you are actually looking at. Level or
        // upward looks never hit the boards, so they never prompt.
        const eyeY = clubhouseApi.groundYAt
          ? camera.position.y - clubhouseApi.groundYAt(walk.x, walk.z)
          : 1.62;
        const downPitch = -walk.pitch;
        if (downPitch > 0.06 && eyeY > 0.2) {
          const aimDist = Math.min(def.reach || 2.0, eyeY / Math.tan(downPitch));
          const ax = walk.x - Math.sin(walk.yaw) * aimDist;
          const az = walk.z - Math.cos(walk.yaw) * aimDist;
          dirtSenseAim.x = ax; dirtSenseAim.z = az;
          dirtSenseAim.dist = aimDist; dirtSenseAim.eyeY = eyeY; dirtSenseAim.live = true;
          dirtSenseAimed = clubhouseApi.nearestDirt(ax, az, Math.max(0.6, def.radius || 0.6));
        } else {
          dirtSenseAim.live = false;
        }
      }
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
        const rest = group.userData.cleaningRestPosition;
        let dirX = -Math.sin(walk.yaw);
        let dirZ = -Math.cos(walk.yaw);
        // Continuous tools (spray trigger, vacuum suction) clean every frame; a stroke tool gates on
        // contact below and passes a banked dt instead.
        let gatedDt = dt;
        // Resolve the surface aim FIRST for spray/cloth/sponge: a wipe orients its ellipse to the
        // surface it faces, and the aim feedback further down reuses this same hit. cleaningAim is a
        // floor-plane projection with no surface normal, so it only supplies the target point here.
        let aim = null;
        const aimedSurfaceTool = def.toolClass === 'spray' || walkTool === 'cloth' || walkTool === 'sponge';
        if (aimedSurfaceTool && clubhouseApi.cleaningAim) {
          const rayDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          aim = clubhouseApi.cleaningAim(camera.position, rayDir, def.reach + 1.0);
        }
        // B0: which tools' drawn pose belongs to the viewmodel rig this frame.
        // Mop+broom tonight (goal B6 scopes the change); vacuum/dustpan carry
        // the same two-writer defect and are logged for their own session.
        const rigOwnsHeldTool = (walkTool === 'broom' || walkTool === 'mop')
          && !!rigFor(walkTool)?.isActive();
        if (rest && (def.toolClass === 'stroke' || def.toolClass === 'sweep')) {
          // Per-tool retiming: mop = slow heavy push-pull, broom = brisker sweep, cloth = gentle
          // wipe, sponge = quick scrub. (Mop and broom were both the 4.8 / 0.16 fallback before.)
          const rate = walkTool === 'sponge' ? SPONGE_RATE
            : walkTool === 'cloth' ? CLOTH_RATE
              : walkTool === 'mop' ? MOP_RATE : BROOM_RATE;
          const span = walkTool === 'sponge' ? SPONGE_XSPAN
            : walkTool === 'cloth' ? CLOTH_XSPAN
              : walkTool === 'mop' ? MOP_SPAN : BROOM_SPAN;
          const phase = time * rate;
          const cosPhase = Math.cos(phase);
          const sign = Math.sign(cosPhase) || 1;
          if (walkTool === 'cloth' || walkTool === 'sponge') {
            // SURFACE-PLANE WIPE: a 2D ellipse, not a lateral-only slide. cleaningAim exposes no
            // surface normal, so the ellipse is built in the tool's screen-facing plane — which,
            // because the held rig rides the camera, lies in whatever surface the player is squared up
            // to: a window wiped head-on gets an ellipse in the glass. A steep downward look (past
            // WIPE_FLOOR_PITCH) falls back to the floor plane so a counter/floor wipe tracks too.
            const second = cosPhase * WIPE_SECOND_SPAN; // 90° out of phase with x → an ellipse
            const jitter = (Math.random() - 0.5) * WIPE_JITTER * (walkTool === 'sponge' ? 2 : 1);
            group.position.x = rest.x + Math.sin(phase) * span + jitter;
            if (walk.pitch > WIPE_FLOOR_PITCH) {
              group.position.y = rest.y + second;
              group.position.z = rest.z;
            } else {
              group.position.z = rest.z + second;
              group.position.y = rest.y;
            }
          } else if (!rigOwnsHeldTool) {
            // Mop: a lateral push-pull across the boards. (A rig tool's
            // stroke motion is composed by its viewmodel rig from the same
            // phase.)
            //
            // B0 (2026-08-07): this guard used to name the BROOM alone, so
            // the MOP's rig solved its pose at the rig slot above and then
            // THESE TWO WRITES clobbered the drawn x and roll every using
            // frame — measured live: drawn x swept exactly rest.x ± MOP_SPAN
            // and roll exactly ±0.035 while the rig's diagnostics reported a
            // perfect solve. Six rounds of mop feel tuning never reached the
            // screen while the button was held. Scoped to mop+broom tonight
            // per the goal's B6; the vacuum and dustpan rigs are clobbered
            // the same way and are logged for their own pass.
            group.position.x = rest.x + Math.sin(phase) * span;
          }
          if (!rigOwnsHeldTool) {
            group.rotation.z = group.userData.cleaningRestRotationZ + cosPhase * 0.035;
          }
          dirX = Math.cos(walk.yaw) * sign;
          dirZ = -Math.sin(walk.yaw) * sign;
          // Phase 6, the PUSH: a push broom drives debris AWAY — the pile
          // recedes up the lane ahead of the bristle face, the stroke adding
          // alternating side drift. (Purely lateral direction ping-ponged
          // piles and, at push speed, ejected them out of the lane.) sweepAt
          // normalises, so only the direction matters here.
          if (walkTool === 'broom' && broomVm.isActive() && broomPose) {
            const side = (liveToolFeel.broom || BROOM_FEEL).dirt.sideBias * sign;
            dirX = -Math.sin(walk.yaw) + Math.cos(walk.yaw) * side;
            dirZ = -Math.cos(walk.yaw) + -Math.sin(walk.yaw) * side;
          }
          // CONTACT-PHASE GATE (corrected polarity). x = rest.x + sin(phase)·span ⇒ tool speed ∝
          // |cos(phase)|, so the tool moves FASTEST through the middle of each pass and lifts/stalls
          // at the turnarounds. Cleaning must land on that visible mid-drag, so contact is the FAST
          // window |cos| >= STROKE_CONTACT_COS. (Phase 2 shipped |cos| < 0.82, which inversely gated
          // the slow turnarounds.) Skipped turnaround dt is BANKED and released on the next contact
          // frame; the sim is linear in dt, so this sum-preserving redistribution is outcome-
          // preserving — NET cleaning over any stroke equals the ungated loop (rate-neutral). The
          // invariant holds: strokeGateAccum resets to 0 on every contact frame, so Σ gatedDt == Σ dt.
          // the stroke is fastest mid-pass and stalls at the turnarounds, which is
          // exactly the envelope the loop should follow
          toolFeelIntensity = Math.abs(cosPhase);
          toolFeelContact = true;
          if (Math.abs(cosPhase) >= STROKE_CONTACT_COS) {
            gatedDt = dt + strokeGateAccum;
            strokeGateAccum = 0;
          } else {
            strokeGateAccum += dt;
            gatedDt = 0;
          }
          // Phase 6: a CARRIED tool cleans nothing. Until the rig's pose has
          // blended onto the boards, contact dt banks instead of landing —
          // sweeping only counts where the bristles visibly are.
          // B4 (2026-08-07): this guard named the BROOM alone — the same
          // broom-only family as the stroke clobber — so an unplanted mop
          // kept cleaning. Any rig-owned tool's planted flag gates now, and
          // with B4's reach authority in the flag, hands that cannot span
          // the floor clean nothing at any pitch.
          if (rigOwnsHeldTool && rigPose && !rigPose.planted && gatedDt > 0) {
            strokeGateAccum += gatedDt;
            gatedDt = 0;
          }
          // A stroke reversal is a phase sign flip (a turnaround). Route it through the hooks object
          // so Phase 6 audio can subscribe later; intensity tracks the swing speed at the turn.
          if (strokeLastSign !== 0 && sign !== strokeLastSign) {
            walkHooks.onStrokeReversal?.(walkTool, span * rate);
          }
          strokeLastSign = sign;
        } else if (rest && def.toolClass === 'suction') {
          // VACUUM: suction stays continuous (ungated), but the head works side to side and the
          // authored Vacuum_StrokeLeft/Right clips alternate on each reversal — through the same
          // play(id, needles) accessor — so the pass reads as deliberate back-and-forth instead of
          // one looping sweep. 1.15 s full cycle = two reversals. (Those clips are in the tool's
          // looping "active" set; play() overrides that loop with the directional one-shot on a turn.)
          const phase = time * VACUUM_RATE;
          const sign = Math.sign(Math.cos(phase)) || 1;
          group.position.x = rest.x + Math.sin(phase) * VACUUM_SPAN;
          if (vacuumLastSign !== 0 && sign !== vacuumLastSign) {
            vacuumStrokeLeft = !vacuumStrokeLeft;
            toolViewmodels.play('vacuum', vacuumStrokeLeft ? 'strokeleft' : 'strokeright');
            walkHooks.onStrokeReversal?.('vacuum', VACUUM_SPAN * VACUUM_RATE);
          }
          toolFeelIntensity = Math.abs(Math.cos(phase));
          toolFeelContact = true;
          vacuumLastSign = sign;
        } else if (rest && def.toolClass === 'spray') {
          // SPRAY CADENCE: a metronomic pump, not a continuous stream. Each cycle is one squeeze
          // (SPRAY_SQUEEZE) then a release (SPRAY_RELEASE). Solution ticks on the squeeze only —
          // gatedDt scaled by SPRAY_DUTY_SCALE = cycle / squeeze — so net solution/sec is unchanged
          // (application is linear in dt: ∫ over a cycle = squeeze·(dt·scale) = cycle·dt). On each
          // squeeze START the rig recoils (fpHands.kick), the onSprayPulse hook fires (Phase 6
          // mist/audio), and the authored SprayBottle_Trigger clip replays on the beat.
          sprayCadenceT += dt;
          if (sprayCadenceT >= SPRAY_CYCLE) sprayCadenceT %= SPRAY_CYCLE;
          const squeezing = sprayCadenceT < SPRAY_SQUEEZE;
          if (squeezing && !spraySqueezeActive) {
            fpHands.kick();
            walkHooks.onSprayPulse?.(walkTool);
            toolViewmodels.play(walkTool, 'trigger');
            emitSprayMist(group, aim?.point && !aim.blocked ? aim.point : null);
            sprayRecoilT = 1;
          }
          spraySqueezeActive = squeezing;
          // E1/E2: THE BOTTLE RECOILS, NOT ONLY THE HANDS.
          //
          // fpHands.kick() moved the rig and left the bottle rigid inside it, so
          // the spray tool measured ONE distinct transform across two seconds of
          // pumping — the pump had no tell on the object itself. It has the
          // pulse already; it just never reached the group. Squared decay, so
          // the kick is a snap and a settle rather than a wobble.
          sprayRecoilT = Math.max(0, sprayRecoilT - dt / SPRAY_RECOIL_FALL);
          const recoilNow = sprayRecoilT * sprayRecoilT;
          group.position.z = rest.z + (def.recoil ?? 0) * recoilNow;
          group.rotation.z = group.userData.cleaningRestRotationZ
            - (def.recoil ?? 0) * SPRAY_RECOIL_TWIST * recoilNow;
          toolFeelIntensity = squeezing ? 1 : 0.15;
          toolFeelContact = true;
          gatedDt = squeezing ? dt * SPRAY_DUTY_SCALE : 0;
        }
        socketWorld(group, socketName, _toolContact);
        let target = _toolContact;
        if (aim?.point && !aim.blocked) target = aim.point;
        // the sweep direction is the way the player is facing, flattened onto the floor
        // A failed or collider-blocked floor aim no longer swallows the
        // contact: wall-mounted discrete targets (scuffs, high marks) live
        // exactly where the floor ray cannot land, so the tool's own socket
        // contact falls through to cleanWithTool, whose pre-gate forward
        // serves those targets while its floor gate still protects grime/wet.
        const aimUsable = !!(aim?.point && !aim.blocked);
        if (aimedSurfaceTool && !aimUsable) target = _toolContact;
        if (clubhouseApi.isInside(target.x, target.z, 0.35)) {
          const res = clubhouseApi.cleanWithTool(
            walkTool, target.x, target.z, dirX, dirZ, gatedDt, { origin: camera.position },
          );
          cleaningLastResult = { ...res, tool: walkTool };
          cleaningLastContact.copy(_toolContact);
          cleaningLastTarget.copy(target);
          if (walkTool === 'spray' && !res.blocked && aimUsable) {
            sprayPoints.material.color.set(0xaee7d1);
            sprayPoints.material.size = 0.026;
            sprayPoints.visible = true;
            updateSpray(aim.point, _toolContact);
          } else if (walkTool !== 'spray' || !aimUsable) {
            sprayPoints.visible = false;
          }
          // A refusal on a DISCRETE target (targetId + blocked reason, e.g. spray-first /
          // sweep-first) must teach like the floor refusals do — without it the schedule
          // gates enforce silently and the player never learns the tool order.
          const targetRefusal = (res.did || 0) <= 0 && res.targetId && res.blocked && res.reason;
          const didNothing = (res.did || 0) <= 0 && !res.targetId;
          if ((didNothing || targetRefusal) && toolHintClock <= 0) {
            if (targetRefusal) {
              toolHintClock = 4;
              walkHooks.toast?.(cleaningBlockMessage(res.reason), 'warn');
            } else if (aimedSurfaceTool && !aim) {
              toolHintClock = 3;
              walkHooks.toast?.('Aim at a reachable surface or a marked mess.', 'warn');
            } else if (aimedSurfaceTool && aim?.blocked) {
              toolHintClock = 3;
              walkHooks.toast?.('The counter or wall blocks that surface.', 'warn');
            } else if (res.blocked) {
              toolHintClock = 4;
              walkHooks.toast?.(cleaningBlockMessage(res.reason), 'warn');
            }
          }
        } else {
          sprayPoints.visible = false;
        }
      }
    } else if (walkSpraying && walkTool && walkTool !== 'washer' && !cart.mounted) {
      const useHook = { hose: walkHooks.waterAt, divot: walkHooks.repairAt, rake: walkHooks.rakeAt }[walkTool];
      const aim = walkAimCell(3.0);
      if (aim && useHook) {
        const result = useHook(
          aim.x,
          aim.y,
          dt,
          aim.worldX,
          aim.worldZ,
          walk.yaw,
          dt > 0 ? distanceMoved / dt : 0,
        );
        const particles = walkTool !== 'greensMower';
        sprayPoints.visible = particles;
        if (particles) updateSpray({
          x: aim.worldX,
          y: heightAt(aim.worldX, aim.worldZ) + 0.1,
          z: aim.worldZ,
        });
        if (walkTool === 'greensMower') {
          updateClippings(dt, aim.worldX, heightAt(aim.worldX, aim.worldZ), aim.worldZ, !!result?.changed);
        }
        if (!result?.ok && result?.reason && maintenanceFeedbackClock <= 0) {
          maintenanceFeedbackClock = 2.5;
          if (walkHooks.toast) walkHooks.toast(result.reason, 'warn');
        }
        walkWaterTexClock += dt;
        if (walkWaterTexClock >= 0.2) {
          walkWaterTexClock = 0;
          updateTurf(state);
          updateCourseMaintenance(state);
          refreshMaintenanceWorldProps();
        }
      } else {
        sprayPoints.visible = false;
      }
    }
    if (!walkSpraying) {
      for (const [id, group] of Object.entries(heldGroups)) {
        const rest = group.userData.cleaningRestPosition;
        if (!rest || !CLEANING_TOOLS[id]) continue;
        // Phase 6 / round 3 → I1: a viewmodel rig OWNS its tool's transform —
        // it solves the tool onto the grip and the contact every frame.
        // Snapping it back to the registry rest pose here undid that solve on
        // every frame the player was not actively sweeping, which is exactly
        // why the idle broom hung in the air while a held stroke looked right.
        // Now guards every rig tool, not just the broom.
        if (toolRigs[id]?.isActive()) continue;
        // E2: THE SAME TRAP, THREE TOOLS OVER — AND THIS IS THE WHOLE E1 GAP.
        //
        // mop, vacuum and dustpan declare `floorAnchored: true` and the floor
        // solve above computes a real correction for them every frame: measured
        // -0.28, -0.99 and -1.00 yd. Every one of those was thrown away HERE, a
        // few hundred lines later, because `position.copy(rest)` restores y as
        // well — so the head rode the camera and the flag looked like a lie.
        //
        // Note what this means for the audit that sent us here: the ±0.06 clamp
        // it blamed was never the constraint. It was not saturating. The solve
        // ran, produced the right number, and was overwritten. From outside,
        // "corrected as far as it could and fell short" and "corrected fully and
        // was discarded" are the same picture, which is why the inference was
        // wrong and only the solve's own inputs could settle it
        // (walk.floorAnchorDiagnostics).
        //
        // The reset still owns x, z and roll — the idle pose should snap back.
        // It just may not own the axis another solve is authoritative on. The
        // broom exception above is the same fix, made once for one tool.
        if (CLEANING_TOOLS[id].floorAnchored && floorAnchorSampleY.has(id)) {
          group.rotation.z = group.userData.cleaningRestRotationZ;
          continue;
        }
        group.position.copy(rest);
        group.rotation.z = group.userData.cleaningRestRotationZ;
      }
    }
    // I5: A HAND TOOL PRESSED INTO A FIXTURE PULLS BACK TO ITS FACE.
    //
    // The rig tools carry the broom's own collision clamp; the four close-carry
    // tools (spray, cloth, sponge, trashbag) had nothing — walk chest-first
    // into a counter and the carried prop pierced it, because the player
    // collider stops the BODY 0.34 yd out while the tool rides ~0.6 yd ahead
    // of the lens. Probe the carry point along the view forward; when it is
    // inside a blocked face, bisect back to the face and pull the group toward
    // the camera by the overlap (camera-local +z).
    //
    // PLACED AFTER THE REST-POSE RESTORE ABOVE, ON PURPOSE. The first landing
    // of this block sat a few hundred lines earlier and its pull was recorded
    // in the debug map and then overwritten by `position.copy(rest)` — the
    // verbatim E2 trap this file already documents, caught because the probe
    // measured the drawn mesh (pull 0.60 logged, penetration unchanged).
    if (walkTool && CLEANING_TOOLS[walkTool] && !rigFor(walkTool)?.isActive() && !cart.mounted) {
      const g = heldGroups[walkTool];
      if (g && g.visible) {
        const carryDepth = Math.abs(CLEANING_TOOLS[walkTool].place?.[2] ?? 0.6) + 0.16;
        const fx = -Math.sin(walk.yaw);
        const fz = -Math.cos(walk.yaw);
        let pull = 0;
        if (broomColliderQuery(walk.x + fx * carryDepth, walk.z + fz * carryDepth, 0.07)?.blocked) {
          let lo = 0.05;
          let hi = carryDepth;
          for (let step = 0; step < 4; step += 1) {
            const mid = (lo + hi) / 2;
            if (broomColliderQuery(walk.x + fx * mid, walk.z + fz * mid, 0.07)?.blocked) hi = mid;
            else lo = mid;
          }
          pull = carryDepth - Math.max(0.05, lo - 0.05);
          g.position.z += pull;
        }
        handToolClampDebug[walkTool] = +pull.toFixed(4);
      }
    }
    const cleaning = clubhouseApi?.cleaningStatus?.();
    if (cleaning) {
      // TRASH SWALLOW: on a fresh pickup (bag load rose while the bag is out) fling a litter chunk
      // into the bag mouth over TRASH_SWALLOW_DUR and pop the bag ~+4% for TRASH_POP_DUR. The sim
      // owns the load; this is the visual answer, throttled to one chunk per swallow so a continuous
      // collect reads as repeated gulps. The pop rides setFillState's own bag-mesh scaling.
      const bagLoad = cleaning.bag.load;
      // Swallow flight + bag pop are decorative juice — reducedMotion skips them
      // (the clip + fill-state update still communicate the pickup).
      if (walkTool === 'trashbag' && bagLoad > lastBagLoad + 1e-4 && trashSwallowT >= 1
        && !walk.reducedMotion) {
        trashSwallowT = 0;
        trashPopT = 0;
        trashSwallowVisual.visible = true;
        toolViewmodels.play('trashbag', 'swallow');
      }
      lastBagLoad = bagLoad;
      if (trashSwallowT < 1) {
        trashSwallowT = Math.min(1, trashSwallowT + dt / TRASH_SWALLOW_DUR);
        const e = easeOutCubic(trashSwallowT);
        _trashSwallowPos.copy(TRASH_SWALLOW_FROM).lerp(TRASH_SWALLOW_TO, e);
        trashSwallowVisual.position.copy(_trashSwallowPos);
        trashSwallowVisual.scale.setScalar(Math.max(0.0001, 1 - e));
        if (trashSwallowT >= 1) trashSwallowVisual.visible = false;
      }
      let popBoost = 0;
      if (trashPopT < 1) {
        trashPopT = Math.min(1, trashPopT + dt / TRASH_POP_DUR);
        popBoost = Math.sin(trashPopT * Math.PI) * 0.14; // ≈ +4% on setFillState's bag-scale mapping
      }
      toolViewmodels.setFillState(
        'trashbag', Math.min(1, bagLoad / cleaning.bag.capacity + popBoost), cleaning.bag.tied,
      );
      const panFill = cleaning.pan.load / cleaning.pan.capacity;
      dustpanLoadVisual.visible = panFill > 0.005;
      dustpanLoadVisual.scale.set(0.72 + panFill * 0.34, 0.55 + panFill * 0.55, 0.72 + panFill * 0.34);
      // Damp-darken the mop skirt while it holds wring water; dries back out as charge falls.
      if (cleaning.mop) {
        toolViewmodels.setMopDamp('mop', cleaning.mop.charge, cleaning.mop.capacity);
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
  const featureHandleMaterial = new THREE.PointsMaterial({
    color: 0x7fd66b, transparent: true, opacity: 1, depthTest: false,
    depthWrite: false, size: 9, sizeAttenuation: false,
  });
  const featureFill = new THREE.Mesh(dynamicPreviewGeometry(PREVIEW_FILL_VERTS), featureFillMaterial);
  const featureOutline = new THREE.Line(dynamicPreviewGeometry(PREVIEW_LINE_VERTS), featureLineMaterial);
  const featureGuide = new THREE.LineSegments(dynamicPreviewGeometry(PREVIEW_LINE_VERTS), featureGuideMaterial);
  const featureHandles = new THREE.Points(dynamicPreviewGeometry(128), featureHandleMaterial);
  featureFill.name = 'editor-feature-preview-fill';
  featureOutline.name = 'editor-feature-preview-outline';
  featureGuide.name = 'editor-feature-preview-guide';
  featureHandles.name = 'editor-feature-preview-handles';
  featureFill.renderOrder = 997;
  featureOutline.renderOrder = 999;
  featureGuide.renderOrder = 999;
  featureHandles.renderOrder = 1000;
  featureFill.frustumCulled = false;
  featureOutline.frustumCulled = false;
  featureGuide.frustumCulled = false;
  featureHandles.frustumCulled = false;
  editorFeaturePreview.add(featureFill, featureOutline, featureGuide, featureHandles);

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

  function writePreviewPoints(geometry, points, lift = 0.4) {
    const attribute = geometry.getAttribute('position');
    let count = 0;
    for (const point of points || []) {
      if (count >= attribute.count) break;
      count = writePreviewVertex(attribute, count, point.x, point.z, lift);
    }
    attribute.needsUpdate = true;
    geometry.setDrawRange(0, count);
  }

  function setEditorFeaturePreview(preview) {
    const points = preview?.outline?.points;
    const closed = preview?.outline?.closed !== false;
    if (!Array.isArray(points) || points.length < (closed ? 3 : 2)) {
      editorFeaturePreview.visible = false;
      featureFill.geometry.setDrawRange(0, 0);
      featureOutline.geometry.setDrawRange(0, 0);
      featureGuide.geometry.setDrawRange(0, 0);
      featureHandles.geometry.setDrawRange(0, 0);
      return;
    }
    const color = preview.validity?.color ?? 0x7fd66b;
    featureFillMaterial.color.set(color);
    featureLineMaterial.color.set(color);
    featureGuideMaterial.color.set(color);
    featureHandleMaterial.color.set(color);

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
    writePreviewPoints(featureHandles.geometry, preview.controls || [], 0.4);
    editorFeaturePreview.visible = true;
  }

  // --- placement ghost: the object you are about to place, green/red ----------------
  let ghost = null;
  let ghostType = null;
  function disposePlacementGhost() {
    if (!ghost) return;
    ghost.traverse((object) => {
      if (object.userData.isDisc) object.geometry?.dispose();
      if (object.userData.previewOwnGeometry) object.geometry?.dispose();
      if (object.material?.userData?.placementPreviewClone) object.material.dispose();
    });
    scene.remove(ghost);
    ghost = null;
  }

  function setPlacementGhost(type, x, z, {
    rot = 0, scale = 1, valid = true, collisionRadiusYd = null,
  } = {}) {
    if (!type) {
      if (ghost) ghost.visible = false;
      ghostType = null;
      return;
    }
    if (ghostType !== type) {
      disposePlacementGhost();
      ghost = new THREE.Group();
      const { parts, unitScale = 1, ownedGeometry = false } = ghostPartsFor(type);
      for (const p of parts) {
        const material = p.material.clone();
        material.userData.placementPreviewClone = true;
        const mesh = new THREE.Mesh(p.geometry, material);
        mesh.material.transparent = true;
        mesh.material.opacity = 0.62;
        mesh.userData.previewUnitScale = unitScale;
        mesh.userData.previewOwnGeometry = ownedGeometry;
        ghost.add(mesh);
      }
      const disc = new THREE.Mesh(
        new THREE.RingGeometry(0.72, 1.08, 32),
        new THREE.MeshBasicMaterial({ color: 0x7fd66b, transparent: true, opacity: 1, depthTest: false, side: THREE.DoubleSide }),
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
        o.scale.setScalar((o.userData.previewUnitScale || 1) * scale);
      }
    });
  }

  function ghostPartsFor(type) {
    if (activeFloraAssets) {
      const floraId = floraIdFor(type, activeFloraAssets);
      const asset = floraId ? activeFloraAssets.get(floraId) : null;
      if (asset) return { parts: asset.parts, unitScale: asset.baseH };
    }
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
        ], unitScale: 7.3, ownedGeometry: true,
      };
    }
    return objectParts(type);
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

  function updateTurf(st, rect = null) {
    const started = performance.now();
    const t = st.turf;
    const zones = st.course.zones;
    const x0 = rect ? clamp(Math.floor(rect.x0), 0, W - 1) : 0;
    const y0 = rect ? clamp(Math.floor(rect.y0), 0, H - 1) : 0;
    const x1 = rect ? clamp(Math.ceil(rect.x1), 0, W - 1) : W - 1;
    const y1 = rect ? clamp(Math.ceil(rect.y1), 0, H - 1) : H - 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
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
    }
    if (rect) {
      uploadDataTextureRegion(zoneTex, zoneUploadSource, x0, y0, x1, y1);
      uploadDataTextureRegion(auxTex, auxUploadSource, x0, y0, x1, y1);
    } else {
      zoneTex.clearUpdateRanges();
      auxTex.clearUpdateRanges();
      zoneTex.needsUpdate = true;
      auxTex.needsUpdate = true;
    }
    // stripe modes from mowing pattern policies
    if (shaderRefs.uniforms && st.maintenance) {
      const modeOf = (p) => (p === 'stripes' ? 1 : p === 'cross' ? 2 : 0);
      const pol = st.maintenance.policies;
      shaderRefs.uniforms.uStripeModes.value.set(modeOf(pol.green.pattern), modeOf(pol.fairway.pattern), modeOf(pol.tee.pattern));
    }
    recordEditorPerformance(
      'turfPack', started,
      (x1 - x0 + 1) * (y1 - y0 + 1),
      Boolean(rect),
    );
  }

  function updateCourseMaintenance(st, force = false) {
    const changed = maintenanceTextures.update({ force });
    maintenanceOverlayUniforms.uInspect.value = st.courseMaintenance?.inspection.active ? 1 : 0;
    refreshMaintenanceWorldProps();
    return changed;
  }

  function updateCourseMaintenance(st, force = false) {
    const changed = maintenanceTextures.update({ force });
    maintenanceOverlayUniforms.uInspect.value = st.courseMaintenance?.inspection.active ? 1 : 0;
    refreshMaintenanceWorldProps();
    return changed;
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
        if (e.irrigation !== undefined) {
          planData[o] = e.irrigation ? 70 : 240;
          planData[o + 1] = e.irrigation ? 218 : 142;
          planData[o + 2] = e.irrigation ? 196 : 84;
          planData[o + 3] = 245;
        } else if (e.zone !== undefined) {
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
  rain.name = 'weather-rain';
  rain.visible = false;
  rain.frustumCulled = false;
  scene.add(rain);
  let rainLevel = 0; // smoothed 0..1 from rainIn

  function updateRain(dt, weather) {
    const target = weather ? clamp(weather.today.rainIn / 0.6, 0, 1) : 0;
    rainLevel += (target - rainLevel) * Math.min(1, dt * 1.5);
    // The precipitation column follows the camera, so without a shelter check it
    // also followed the player straight through the clubhouse roof. Keep the live
    // rain level while indoors (it resumes immediately outside), but never draw
    // outdoor streaks inside the pro shop or service rooms.
    if (clubhouseApi?.isInside(camera.position.x, camera.position.z)) {
      rain.visible = false;
      return;
    }
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

    // THE INTERIOR FILL SCALE — and it has to be the LAST thing in this function.
    //
    // AmbientLight and HemisphereLight are constant irradiance terms in three's
    // standard lighting loop: no shadow map, no volume, no falloff, no occlusion.
    // There is no "this light does not reach inside that building" in the engine,
    // and Light.layers cannot substitute — the renderer tests light layers
    // against the CAMERA, not per object, so layers can only switch the whole
    // scene at once. Measured contribution at the fixed poses: the hemisphere is
    // ~40% of interior luma and ~42% of course luma. It is not disproportionately
    // lighting the sealed room; it lights a windowless interior exactly as much as
    // open ground, which is the whole problem.
    //
    // So: scale it by whether the player is inside. The room is windowless with
    // one glazed door, so the only outdoors visible from in here is a doorway —
    // and at the door pose the fill is 7.8% of the frame, so the shot that would
    // expose the cheat is the one the cheat barely touches. The course, seen from
    // outside, is untouched: isInside is false and the factor is zero.
    //
    // WHY THE LAST LINE. applyTimeWeather runs every frame from main.js and
    // assigns hemi.intensity unconditionally in all three of its branches above.
    // Anything that scales it from anywhere else is undone before the next render,
    // and the symptom is "the change did nothing" rather than an error. This is
    // also what made the first A/B measurement report the hemisphere contributing
    // exactly 0.0% at all six poses: it turned off a light that was switched back
    // on before the frame drew.
    applyInteriorFill();
  }

  // How deep inside the threshold the fill has fully faded, in yards.
  const INTERIOR_FILL_BLEND_YD = 1.5;
  // Set by measurement, not by eye. B8 sweep 2026-07-30 (unpowered room, four
  // poses, tools/qa/proshop-dark-state-luma.js with DARK_STATE_SCALE):
  //   scale 0.40 -> whole 104.65   ceiling band 117.19   nav band 90.25
  //   scale 0.28 -> whole 100.72   ceiling band 113.47   nav band 85.95
  //   scale 0.18 -> whole  97.23   ceiling band 110.23   nav band 82.12
  //   scale 0.10 -> whole  94.27   ceiling band 107.46   nav band 78.86
  // Panel faces stayed readable (ceiling p95 >= 12) and the nav band kept shape
  // (p95-p05 >= 6) at EVERY step, so the floor of the ladder ships. The same
  // table is the honest limit of this lever: the whole remaining range moves
  // the room only ~10%, because what still lights an unpowered interior is sun
  // and sky through the glazing, not the hemisphere fill — going genuinely
  // dark needs occlusion or aperture work, not a smaller scale here.
  let interiorFillScale = 0.10;
  let interiorFillLast = 0;

  // 0 outside, 1 well inside, smooth across the threshold. isInside answers a
  // boolean, so the depth is bisected out of it rather than stepped: a
  // three-level ramp is visible as banding when you walk through the door.
  function interiorFillFactor(x, z) {
    const inside = clubhouseApi?.isInside;
    if (typeof inside !== 'function') return 0;
    if (!inside(x, z, 0)) return 0;
    if (inside(x, z, -INTERIOR_FILL_BLEND_YD)) return 1;
    let lo = 0;
    let hi = INTERIOR_FILL_BLEND_YD;
    for (let i = 0; i < 5; i += 1) {
      const mid = (lo + hi) / 2;
      if (inside(x, z, -mid)) lo = mid; else hi = mid;
    }
    const u = lo / INTERIOR_FILL_BLEND_YD;
    return u * u * (3 - 2 * u);
  }

  // WHAT THE CAMERA IS LOOKING AT.
  //
  // Keying the fill to the player's position alone made the doorway lie: stand
  // half a yard outside with the door open, look in, and the room was at full
  // brightness — then it snapped dark on the step across the threshold. The
  // room you can SEE should be lit like the room you are standing in, so the
  // fill also answers how much of the view lands inside the building.
  //
  // The sampling is deliberately coarse and boolean (isInside, no bisection):
  // a 4x4 fan of horizontal bearings across the frustum at four depths is 16
  // cheap tests a frame, where running the smooth depth solve per sample would
  // be ~96. The result is a coverage fraction, eased over time so walking past
  // an open door does not strobe the whole scene.
  // Round 4: the first pass ramped in VISIBLE steps on the approach — measured
  // hemi 1.00 -> 0.78 -> 0.55 -> 0.33 -> 0.10 walking in from 6 yd, because a
  // 4x4 fan can only report a handful of distinct coverage values and the raw
  // fraction was used directly. The fan is finer now, and coverage is pushed
  // through a saturating curve: once the interior occupies a MEANINGFUL part of
  // the frame the room is fully dark, so approaching and stepping through the
  // door changes nothing. The remaining fade lives out where the doorway is a
  // small feature of the image and the room is not what you are looking at —
  // which is also the only place a global lever can honestly be paid for.
  const VIEW_SAMPLE_DIST = [1.0, 1.9, 2.9, 4.0, 5.2, 6.6];
  const VIEW_SAMPLE_YAW = [-0.46, -0.30, -0.14, 0, 0.14, 0.30, 0.46];
  const VIEW_COVER_LO = 0.07;  // below this the interior is a sliver: leave it lit
  const VIEW_COVER_HI = 0.34;  // at this much interior in frame the room is fully dark
  const VIEW_FILL_EASE = 0.09; // per frame, ~0.35 s to settle — gradual, not steppy
  const _fillViewDir = new THREE.Vector3();
  let viewInsideEased = 0;
  let viewBlendEnabled = true;

  function viewInsideFraction() {
    const inside = clubhouseApi?.isInside;
    if (typeof inside !== 'function') return 0;
    camera.getWorldDirection(_fillViewDir);
    // only the horizontal bearing matters — looking down at the floor of a
    // room still means that room fills the frame
    const baseYaw = Math.atan2(-_fillViewDir.x, -_fillViewDir.z);
    let hit = 0;
    let total = 0;
    for (const dy of VIEW_SAMPLE_YAW) {
      const yaw = baseYaw + dy;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      for (const d of VIEW_SAMPLE_DIST) {
        total += 1;
        if (inside(camera.position.x + fx * d, camera.position.z + fz * d, 0)) hit += 1;
      }
    }
    if (!total) return 0;
    // saturating response: a sliver of doorway is not "you are looking at the
    // room", but a third of the frame is, and everything past that is the same
    // answer — which is what removes the ramp you could see while walking in
    const cover = hit / total;
    const t = Math.max(0, Math.min(1,
      (cover - VIEW_COVER_LO) / Math.max(1e-4, VIEW_COVER_HI - VIEW_COVER_LO)));
    return t * t * (3 - 2 * t);
  }

  function applyInteriorFill() {
    // The player's own position while walking — during a focus pose (the
    // register, the laptop) the camera leaves their head, and the light should
    // follow where the body is, not where the shot is framed from.
    // The interior fill is a FIRST-PERSON affordance: it exists so the room you
    // are standing in, or looking into, reads as unpowered. The overview is a
    // management map flown above the property, and with "inside is inside" now
    // a hard answer, panning it over the clubhouse would slam the whole course
    // dark. Off your feet, there is no fill.
    if (!walk.active) {
      viewInsideEased += (0 - viewInsideEased) * VIEW_FILL_EASE;
      interiorFillLast = viewInsideEased;
      hemi.intensity *= 1 - interiorFillLast * (1 - interiorFillScale);
      return;
    }
    const px = walk.x;
    const pz = walk.z;
    // INSIDE IS INSIDE. This used to ramp over the 1.5 yd nearest any boundary,
    // which measures distance to the CLOSEST wall — so standing near an interior
    // wall, or in a shallow part of the room, quietly brightened everything
    // (measured: 3 yd in, hard against a side wall, the fill fell to 0.38 and
    // the hemisphere came back up to 0.60). The soft approach is the view term's
    // job now, so the position term is a plain answer.
    const standing = interiorFillFactor(px, pz) > 0 ? 1 : 0;
    // Standing inside always wins outright; looking in from outside pulls the
    // fill down by however much of the view the interior actually occupies.
    const want = viewBlendEnabled
      ? Math.max(standing, viewInsideFraction()) : standing;
    viewInsideEased += (want - viewInsideEased) * VIEW_FILL_EASE;
    interiorFillLast = viewInsideEased;
    hemi.intensity *= 1 - interiorFillLast * (1 - interiorFillScale);
  }

  // --- picking ------------------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const _rayOrigin = new THREE.Vector3();
  const _rayDir = new THREE.Vector3();

  // THE EDITOR'S GROUND RAY.
  //
  // This used to be raycaster.intersectObjects(editorGroundTargets), which
  // brute-forces EVERY triangle of the terrain — at SEG_PER_CELL 6 that is
  // ~690k of them — and the editor calls it from onPointerMove, unthrottled.
  // A pointer device reporting 100+ moves a second therefore spent tens of
  // millions of triangle tests per second on the main thread just to know
  // where the cursor was. Hovering the brush cost more than sculpting with it.
  //
  // The terrain is a regular grid heightfield, so the ray does not need
  // triangles at all: march it in XZ and compare against heightAt(), which is
  // an O(1) bilinear sample of the same Float32Array every other consumer
  // reads. That makes picking O(steps) with a tiny constant, and it lands on
  // exactly the surface the rig, walk mode and playtest already agree on.
  const GROUND_MARCH_STEP_YD = CELL_YD * 0.25;
  const GROUND_MARCH_REFINE = 14;

  // Decks and bridges are separate small meshes; brute force is still the right
  // tool for those few triangles. Cache the slice so hovering allocates nothing.
  let deckTargetsCache = [];
  let deckTargetsCachedLen = -1;
  function deckTargets() {
    if (deckTargetsCachedLen !== editorGroundTargets.length) {
      deckTargetsCache = editorGroundTargets.slice(1);
      deckTargetsCachedLen = editorGroundTargets.length;
    }
    return deckTargetsCache;
  }

  // Signed height of the ray above the terrain at distance t. Positive = above.
  function groundRayGap(origin, dir, t) {
    return (origin.y + dir.y * t)
      - heightAt(origin.x + dir.x * t, origin.z + dir.z * t);
  }

  // Returns distance along the ray to the first terrain crossing, or null.
  function marchGroundRay(origin, dir) {
    // Clip to the terrain's XZ slab first so we never march empty space, and so
    // a ray angled away from the course exits immediately instead of stepping
    // to the far plane.
    const halfW = worldW / 2;
    const halfH = worldH / 2;
    let tMin = 0;
    let tMax = Infinity;
    for (let axis = 0; axis < 2; axis++) {
      const o = axis === 0 ? origin.x : origin.z;
      const d = axis === 0 ? dir.x : dir.z;
      const lo = axis === 0 ? -halfW : -halfH;
      const hi = axis === 0 ? halfW : halfH;
      if (Math.abs(d) < 1e-6) {
        if (o < lo || o > hi) return null; // parallel and outside the slab
        continue;
      }
      let t0 = (lo - o) / d;
      let t1 = (hi - o) / d;
      if (t0 > t1) { const swap = t0; t0 = t1; t1 = swap; }
      if (t0 > tMin) tMin = t0;
      if (t1 < tMax) tMax = t1;
      if (tMin > tMax) return null;
    }
    if (!Number.isFinite(tMax)) return null;
    if (groundRayGap(origin, dir, tMin) <= 0) return null; // starts underground
    for (let t = tMin + GROUND_MARCH_STEP_YD; ; t += GROUND_MARCH_STEP_YD) {
      const at = Math.min(t, tMax);
      if (groundRayGap(origin, dir, at) <= 0) {
        // Bracketed: bisect to well under a millimetre so the brush does not
        // visibly quantise to the march step as the pointer moves.
        let above = at - GROUND_MARCH_STEP_YD;
        let below = at;
        for (let i = 0; i < GROUND_MARCH_REFINE; i++) {
          const mid = (above + below) * 0.5;
          if (groundRayGap(origin, dir, mid) > 0) above = mid;
          else below = mid;
        }
        return (above + below) * 0.5;
      }
      if (at >= tMax) return null;
    }
  }

  // Shared world-space hit point for both editor pickers.
  function groundRayPoint(px, py) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((px - rect.left) / rect.width) * 2 - 1;
    ndc.y = -(((py - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(ndc, camera);
    _rayOrigin.copy(raycaster.ray.origin);
    _rayDir.copy(raycaster.ray.direction);
    const t = marchGroundRay(_rayOrigin, _rayDir);
    let best = t === null ? null : new THREE.Vector3(
      _rayOrigin.x + _rayDir.x * t,
      _rayOrigin.y + _rayDir.y * t,
      _rayOrigin.z + _rayDir.z * t,
    );
    const decks = deckTargets();
    if (decks.length) {
      const hits = raycaster.intersectObjects(decks, false);
      if (hits.length
        && (!best || hits[0].point.distanceToSquared(_rayOrigin) < best.distanceToSquared(_rayOrigin))) {
        best = hits[0].point.clone();
      }
    }
    return best;
  }

  function raycastCell(px, py) {
    const p = groundRayPoint(px, py);
    if (!p) return null;
    const cx = Math.floor((p.x + worldW / 2) / CELL_YD);
    const cy = Math.floor((p.z + worldH / 2) / CELL_YD);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
    return { x: cx, y: cy, point: p };
  }

  // the editor's ray: fractional cell coords + the world point (smooth brushes)
  function raycastGround(px, py) {
    const p = groundRayPoint(px, py);
    if (!p) return null;
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
  // ...and it is a SETTING, because it is the single biggest lever on the number
  // the player actually feels. Measured in Electron on pine-hills-v2 at a fixed
  // shop-floor pose (tools/qa/electron-frame-profile.js, 2026-08-06): frames
  // carrying a bake averaged 61.3 ms against 9.5 ms for frames that did not, and
  // the 1% low at that pose was 1.9 fps against 39.9 fps with the shadow map
  // switched off entirely. Average frame rate is not the problem in this game;
  // the bake frame is.
  let shadowBakeMs = 100;
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
  // Tunable by the quality preset. fitSunShadow re-asserts these every mode
  // change and on any drift, so they are the only place a size may be set from —
  // a QA or settings hand on sun.shadow.mapSize is overwritten within a frame.
  let SHADOW_WALK_MAP = 2048;
  let SHADOW_EDITOR_MAP = 2048;
  let SHADOW_FULL_MAP = 4096;
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

  // THE SHADOW QUALITY LEVER, exposed so the settings preset can actually reach
  // it. Sizes go through fitSunShadow's own re-assert rather than being written
  // to sun.shadow.mapSize here: it owns that field, disposes the old GL target
  // on a genuine size change, and re-fits the camera to match. Setting the map
  // directly from outside left the fit half-applied, which is the bug the
  // re-assert was added for.
  //
  // walkMap is the one that matters on foot — it is the map baked ten times a
  // second while the player is inside the shop. fullMap only bakes in the
  // overview. bakeMs trades shadow latency for frame time: at 100 ms a walking
  // character's shadow is glued to its feet; at 200 ms it lags perceptibly on a
  // fast turn, which is why that is a preset choice and not a default.
  function setShadowQuality({ walkMap, editorMap, fullMap, bakeMs } = {}) {
    const size = (value, current) => {
      const n = Number(value);
      return [512, 1024, 2048, 4096].includes(n) ? n : current;
    };
    SHADOW_WALK_MAP = size(walkMap, SHADOW_WALK_MAP);
    SHADOW_EDITOR_MAP = size(editorMap, SHADOW_EDITOR_MAP);
    SHADOW_FULL_MAP = size(fullMap, SHADOW_FULL_MAP);
    const ms = Number(bakeMs);
    if (Number.isFinite(ms) && ms >= 16 && ms <= 1000) shadowBakeMs = Math.round(ms);
    // force the next frame to re-fit and re-bake at the new size
    shadowFitMode = null;
    shadowClock = Infinity;
    return {
      walkMap: SHADOW_WALK_MAP, editorMap: SHADOW_EDITOR_MAP, fullMap: SHADOW_FULL_MAP, bakeMs: shadowBakeMs,
    };
  }

  // THE WHOLE POST CHAIN, off. Turning GTAO and bloom off individually still
  // pays for the composer: a RenderPass into a 4x-MSAA half-float target, a
  // resolve, and an OutputPass blit. On Low the player has already said they do
  // not want the look, so skip the target entirely and draw to the back buffer.
  // Kept separate from post.gtao.enabled / post.bloom.enabled so a player who
  // wants bloom without AO still gets the composer.
  function setPostEnabled(on) {
    postEnabled = on !== false;
    return postEnabled;
  }

  // Per-pass diagnostic lever, same philosophy as setAntialiasSamples above:
  // exposed, not changed. The A3 attribution sweep needs gtao and bloom
  // addressable individually — a saving locked inside a constructor cannot be
  // measured, and a measurement that toggles the whole composer cannot say
  // WHICH pass owns the milliseconds.
  const postDiag = {
    gtaoEnabled: () => gtao.enabled,
    setGtaoEnabled: (v) => { gtao.enabled = v !== false; return gtao.enabled; },
    bloomEnabled: () => bloom.enabled,
    setBloomEnabled: (v) => { bloom.enabled = v !== false; return bloom.enabled; },
    // The pass object itself, for parameter sweeps (updateGtaoMaterial /
    // updatePdMaterial / setSize). Read-write by design: a sweep that cannot
    // reconfigure the pass live costs one app relaunch per rung.
    gtaoPass: () => gtao,
  };

  // THE MOST EXPENSIVE SINGLE ATTRIBUTE IN THIS RENDERER, AND UNTIL NOW A LITERAL.
  //
  // `composerTarget` is built with `samples: 4` — 4x MSAA on a HalfFloatType
  // target. Measured with EXT_disjoint_timer_query_webgl2, indoors, against a
  // 0.00-0.04 ms drift control:
  //
  //   4x (shipped)   GPU 9.11 ms   100% of frames over the 8.33 ms refresh
  //   2x             GPU 8.75 ms   100%          <- 0.37 ms, clears nothing
  //   0x             GPU 7.84 ms    27%          <- 1.28 ms
  //
  // The GPU runs a FLAT 8.4-9.1 ms whatever the frame time does, so the indoor
  // stutter is not a spike: it is a pipeline permanently ~1% over a 120 Hz
  // interval. This one attribute is 14% of the whole GPU frame, and it was
  // reachable only by a QA driver reaching into `composer.renderTarget1`.
  //
  // Exposed, not changed. The default stays 4x because dropping it trades a
  // stutter for aliased edges on every surface in the game and that is a taste
  // decision, not a bug fix. What this does is make the lever addressable — by a
  // settings row, by a quality preset, or by a driver measuring the next idea —
  // instead of leaving a measured 1.28 ms locked inside a constructor.
  function setAntialiasSamples(next) {
    const n = Number(next);
    // three.js accepts any non-negative count and silently clamps to the
    // driver's max; 0, 2, 4 and 8 are the ones worth offering.
    if (!Number.isFinite(n) || n < 0) return composerTarget.samples;
    const want = Math.min(8, Math.round(n));
    if (want === composerTarget.samples
      && (!composer.renderTarget1 || composer.renderTarget1.samples === want)) {
      return composerTarget.samples;
    }
    composerTarget.samples = want;
    // The composer keeps two ping-pong targets cloned from this one; both have
    // to be told, and both have to be disposed so the GL object is rebuilt at
    // the new sample count rather than reused at the old one.
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      if (!rt) continue;
      rt.samples = want;
      rt.dispose();
    }
    return want;
  }

  // What it currently is, so a caller can read before it writes and a driver can
  // prove the write landed rather than assuming it did.
  function antialiasSamples() {
    return {
      target: composerTarget.samples,
      rt1: composer.renderTarget1?.samples ?? null,
      rt2: composer.renderTarget2?.samples ?? null,
    };
  }

  function setEditorShadowFocus(active) {
    const next = !!active;
    if (editorShadowFocus === next) return;
    editorShadowFocus = next;
    shadowClock = Infinity;
  }

  // X4 (Goal 21) — WHERE AM I ON THIS MAP?
  //
  // The stranger pressed Tab, got "18 dirty spots marked", saw blank forest with
  // none of them in frame, and could not tell where they were standing. An
  // overview you cannot locate yourself on is a picture, not a map.
  //
  // A pin at the walk position, built once and only ever shown while the
  // overview camera is live. Deliberately unlit and depth-test-free so it reads
  // through a hill rather than hiding behind one: the whole job of this object
  // is to be findable.
  let playerPin = null;
  function ensurePlayerPin() {
    if (playerPin) return playerPin;
    const group = new THREE.Group();
    group.name = 'OverviewPlayerPin';
    const mat = (color) => new THREE.MeshBasicMaterial({
      color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.96,
    });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9, 8), mat(0xf2f7ea));
    stem.position.y = 4.5;
    const head = new THREE.Mesh(new THREE.ConeGeometry(1.9, 4.2, 12), mat(0xd8482f));
    head.position.y = 11;
    head.rotation.x = Math.PI; // point DOWN at the spot, the way a map pin does
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.0, 24), mat(0xd8482f));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    group.add(stem, head, ring);
    // drawn last, over everything, so a tree cannot swallow the one thing the
    // player opened this view to find
    group.traverse((n) => { if (n.isMesh) n.renderOrder = 9000; });
    group.visible = false;
    scene.add(group);
    playerPin = group;
    return group;
  }

  // The app owns this, not the scene. `activeCourseCamera` looks like the right
  // signal and is not: nothing sets it when the player presses Tab — it is
  // written by frameCourse(), which only the resize handler and the editor call.
  // Gating the pin on it produced a pin that never once existed while the app
  // was demonstrably in overview mode.
  let overviewPinWanted = false;

  function updatePlayerPin() {
    const showing = overviewPinWanted || activeCourseCamera?.kind === 'overview';
    if (!showing && !playerPin) return; // never built, never needed
    const pin = ensurePlayerPin();
    pin.visible = showing;
    if (!showing) return;
    pin.position.set(walk.x, heightAt(walk.x, walk.z) ?? 0, walk.z);
    // a slow turn, so the eye catches it as the only moving thing on a still map
    pin.rotation.y += 0.012;
  }

  function render(dtMs, st) {
    if (sceneDisposed) return;
    guardCourseWaterReflection.beginFrame();
    updatePlayerPin();
    time += dtMs / 1000;
    // Repack flora at most once before a frame begins. A mesh onBeforeRender
    // hook is invoked again by AO and shadow passes and can also rebucket a
    // partly rendered frame when the player crosses an LOD refresh boundary.
    floraLodUpdate?.();
    shadowClock += dtMs;
    if (shadowClock >= shadowBakeMs) {
      fitSunShadow();
      renderer.shadowMap.needsUpdate = true;
      shadowClock = 0;
      shadowBakes++;
    }
    if (shaderRefs.uniforms) shaderRefs.uniforms.uTime.value = time;
    const floraWindMph = Number(state.weather?.today?.windMph) || 0;
    for (const record of floraWindUniforms) {
      record.time.value = time;
      record.strength.value = floraWindStrength(record.kind, floraWindMph);
    }
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
    if (maintenanceIrrigationEntries.some((entry) => entry.head.enabled)) {
      refreshMaintenanceWorldProps(time);
    }
    if (clubhouseApi) clubhouseApi.update(dtMs); // doors, shop customers, interior life
    // C10: after the clubhouse has settled this frame's station state, so
    // opening the till stows the tool in the same frame it opens.
    syncStationToolStow();
    prepareFrameShadows(renderer.shadowMap);
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
    const previousAutoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
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
    // Phase 6 → I1: the held rig's own pass, last — nearest to the face.
    // Every rig's render() no-ops unless it is the active one.
    for (const rig of Object.values(toolRigs)) rig.render();
  }

  function resize() {
    const wpx = canvas.clientWidth || window.innerWidth;
    const hpx = canvas.clientHeight || window.innerHeight;
    renderer.setSize(wpx, hpx, false);
    camera.aspect = wpx / hpx;
    camera.updateProjectionMatrix();
    for (const rig of Object.values(toolRigs)) rig.resize(camera.aspect);
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
    maintenanceOverlayUniforms.uVisible.value = mode === 'normal' ? 1 : 0;
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
    rebuildIrrigation();
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
  function refreshGround(st, { water = false, objects = false, paths = false, holes = false, flow = false, zoneRect = null, zones = true, relief: reReliefsculpt = false, terrain = true, terrainRect = null, turf = true } = {}) {
    if (reReliefsculpt) relief = null; // a vector feature (green/bunker/water/tee) moved
    // terrainRect scopes the mesh rebuild to an edited region, and it is honoured
    // even alongside a relief invalidation. Dropping and rebuilding the relief
    // cache re-buckets every analytic feature, but a stamped green or bunker only
    // CHANGES the sculpt near itself — vertices outside the rect re-evaluate to
    // the heights they already hold. Callers that move something course-wide
    // (rebuildAll) pass no rect and still get the full pass.
    if (terrain) rebuildTerrainHeights(terrainRect);
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
    if (turf) updateTurf(st, flow ? null : zoneRect);
    // Re-freeze only the subtrees this call rebuilt. envRing and
    // horizonLandscape are never rebuilt here, so they never need it.
    freezeStaticCourse({
      trees: objects, objects, paths: Boolean(rebuiltPaths), env: false, water, terrain,
    });
  }

  function dispose() {
    if (sceneDisposed) return { alreadyDisposed: true };
    sceneDisposed = true;
    gtao.render = gtaoRender;
    treeBuildToken += 1;
    if (walk.active) walkExit();
    const clubhouse = clubhouseApi?.dispose ? clubhouseApi.dispose() : null;
    const cleaningViewmodels = toolViewmodels.releaseForSceneDispose();
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
    // CachedGLTFLoader clones share decoded ImageBitmaps with their parsed
    // prototype. Full scene teardown closes those owned images, so the parsed
    // cache must not hand the detached backing stores to the next scene.
    clearGltfCache();
    return {
      alreadyDisposed: false,
      clubhouse,
      cleaningViewmodels,
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

  // The production mower is a separate authored implement mounted to the tractor's
  // named hitch. Keeping the roots separate lets the deck and blades animate without
  // making the tractor asset itself disposable or save-state aware.
  let mowerMesh = null;
  let mowerProduction = false;

  function mountMower() {
    if (!cartMesh || !mowerMesh) return;
    const parent = tractorRig.hitch || cartMesh;
    parent.add(mowerMesh);
    if (mowerProduction) {
      mowerMesh.scale.setScalar(1);
      mowerMesh.position.set(0, tractorRig.hitch ? 0 : 0.49, tractorRig.hitch ? 0 : 1.72);
      mowerMesh.rotation.set(0, 0, 0);
    } else {
      mowerMesh.scale.setScalar(2.6);
      mowerMesh.rotation.set(0, Math.PI / 2, 0);
      mowerMesh.position.set(0, 0.02, 2.45);
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

  function configureMower(m, production) {
    mowerProduction = production;
    tractorRig.mowerPivot = production ? m.getObjectByName('MowerDeck_Pivot') : null;
    tractorRig.mowerBlades = [];
    m.traverse((o) => {
      if (o.name.startsWith('COL_')) o.visible = false;
      if (o.isMesh) o.castShadow = true;
      if (production && o.name.startsWith('BladeDisc_')) tractorRig.mowerBlades.push(o);
    });
    mowerMesh = m;
    mountMower();
  }

  function attachMower() {
    if (!cartMesh || state.tractor?.attachment !== 'mower') return;
    if (mowerMesh) {
      mountMower();
      return;
    }
    new GLTFLoader().load('vendor/models/mower_deck_production.glb',
      (g) => configureMower(g.scene, true),
      undefined,
      () => new GLTFLoader().load('vendor/models/mower_deck.glb',
        (g) => configureMower(g.scene, false), undefined, () => {}));
  }

  function captureTractorRig(m) {
    tractorModel = m;
    tractorRig.wheels = [];
    tractorRig.steer = [];
    tractorRig.steeringWheel = null;
    tractorRig.hitch = null;
    m.traverse((o) => {
      if (o.name.startsWith('COL_')) o.visible = false;
      if (/^Wheel_[FR][LR]$/.test(o.name)) tractorRig.wheels.push({ node: o, baseX: o.rotation.x });
      if (/^Steer_F[LR]$/.test(o.name)) tractorRig.steer.push({ node: o, baseY: o.rotation.y });
      if (o.name === 'SteeringWheel') tractorRig.steeringWheel = o;
      if (o.name === 'Mower_Hitch') tractorRig.hitch = o;
    });
    tractorRig.steeringBaseZ = tractorRig.steeringWheel?.rotation.z || 0;
    tractorRig.modelBaseY = m.position.y;
    if (mowerMesh) mountMower();
  }

  // Original project-authored production machine first, legacy supplied assets as
  // fallbacks, and the primitive placeholder only if all network loads fail.
  function adoptTractor(m, scale, { flip = false, production = false } = {}) {
    m.scale.setScalar(scale);
    m.traverse((o) => {
      if (o.name.startsWith('COL_')) o.visible = false;
      if (o.isMesh) o.castShadow = true;
    });
    const wrap = new THREE.Group();
    m.position.y = production ? -0.02 : -0.1; // settle the tires into the turf on slopes
    if (flip) m.rotation.y = Math.PI; // model authored front-toward-viewer (+Z)
    wrap.add(m);
    const previousCart = cartMesh;
    if (mowerMesh?.parent === previousCart) previousCart.remove(mowerMesh);
    removeOwnedObject(previousCart);
    cartMesh = wrap;
    scene.add(cartMesh);
    if (production) captureTractorRig(m);
    else {
      tractorModel = null;
      tractorRig.wheels = [];
      tractorRig.steer = [];
      tractorRig.steeringWheel = null;
      tractorRig.hitch = null;
      if (mowerMesh) mountMower();
    }
    placeCartMesh();
    recordTractorUse(state, { x: cart.x, z: cart.z, yaw: cart.yaw });
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
    // The Course-4 resort owns the east-front apron for its bag drop and cart
    // staging. Keep the fully functional maintenance yard nearby, but move it
    // one service-bay farther east so the two authored workflows do not occupy
    // the same ground.
    const yardBx = bx + (state.property?.tierId === 'resortStyle' ? 42 : 0);
    const yard = { x: yardBx + 14.5, z: bz + 18.5, yaw: 0.7 };
    const t = state.tractor;

    putModel('vendor/models/shed.glb', 5.2, yardBx + 20.5, bz + 13, -1.9);
    propColliders.push({ minX: yardBx + 17.8, maxX: yardBx + 23.2, minZ: bz + 10.3, maxZ: bz + 15.7 });
    putModel('vendor/models/workbench.glb', 2.5, yardBx + 18.6, bz + 17.2, -Math.PI / 2);
    propColliders.push({ x: yardBx + 18.6, z: bz + 17.2, r: 1.0 });
    putModel('vendor/models/tool_chest.glb', 1.35, yardBx + 21.6, bz + 17.1, -Math.PI / 2);
    propColliders.push({ x: yardBx + 21.6, z: bz + 17.1, r: 0.75 });

    // A physical daily board anchors the route. Its large print is baked once
    // into a project-owned CanvasTexture; the full live list opens on the field
    // tablet, while this remains readable as an object in the actual yard.
    const boardCanvas = document.createElement('canvas');
    boardCanvas.width = 512;
    boardCanvas.height = 640;
    const boardCtx = boardCanvas.getContext('2d');
    boardCtx.fillStyle = '#ede4ca';
    boardCtx.fillRect(0, 0, 512, 640);
    boardCtx.fillStyle = '#244633';
    boardCtx.fillRect(0, 0, 512, 112);
    boardCtx.fillStyle = '#f4eedb';
    boardCtx.font = '700 37px Georgia';
    boardCtx.fillText('DAILY WORK', 36, 70);
    boardCtx.fillStyle = '#2c4734';
    boardCtx.font = '700 30px Arial';
    boardCtx.fillText(`HOLE ${state.courseMaintenance?.heroHoleNumber || 4}`, 36, 158);
    boardCtx.font = '600 23px Arial';
    ['INSPECT', 'MOW + WATER', 'REPAIR TURF', 'RAKE + CLEAR', 'REINSPECT'].forEach((line, index) => {
      boardCtx.fillStyle = '#b99b51';
      boardCtx.fillRect(38, 202 + index * 75, 24, 24);
      boardCtx.fillStyle = '#304b38';
      boardCtx.fillText(line, 82, 224 + index * 75);
    });
    boardCtx.fillStyle = '#765b32';
    boardCtx.font = 'italic 20px Georgia';
    boardCtx.fillText('Return it better than you found it.', 36, 594);
    const boardTexture = new THREE.CanvasTexture(boardCanvas);
    boardTexture.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Group();
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 1.55, 0.10),
      new THREE.MeshStandardMaterial({ color: 0x704b2d, roughness: 0.82 }),
    );
    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(1.13, 1.42),
      new THREE.MeshStandardMaterial({ map: boardTexture, roughness: 0.88, side: THREE.DoubleSide }),
    );
    paper.position.z = 0.056;
    board.add(backing, paper);
    const boardX = yardBx + 17.0;
    const boardZ = bz + 16.45;
    board.position.set(boardX, heightAt(boardX, boardZ) + 1.35, boardZ);
    board.rotation.y = 0;
    board.castShadow = true;
    scene.add(board);
    walkProps.push({
      x: boardX, z: boardZ, r: 3.0,
      label: () => 'Daily work board · [E] review Hole 4 route',
      action: () => { if (walkHooks.reviewMaintenance) walkHooks.reviewMaintenance(); },
    });

    const selectYardEquipment = (equipmentId, tool, label) => {
      const result = walkHooks.selectMaintenanceEquipment
        ? walkHooks.selectMaintenanceEquipment(equipmentId)
        : { ok: true };
      if (!result.ok) {
        if (walkHooks.toast) walkHooks.toast(result.reason, 'warn');
        return;
      }
      walkSetTool(tool);
      if (walkHooks.toast) walkHooks.toast(t('tool.selectedHint', { tool: label }));
    };
    const greensYard = { x: yardBx + 13.0, z: bz + 22.5 };
    pushedParkPose.greensMower = { ...greensYard, yaw: 0.25 };
    placePushedAtPark('greensMower');
    propColliders.push({ x: greensYard.x, z: greensYard.z, r: 0.72 });
    walkProps.push({
      ...greensYard, r: 3.0,
      label: () => 'Greens reel mower · [E] select for green, fringe, and tee',
      action: () => selectYardEquipment('greensMower', 'greensMower', 'Greens mower'),
    });
    const spreaderYard = { x: yardBx + 16.0, z: bz + 23.0 };
    pushedParkPose.spreader = { ...spreaderYard, yaw: -0.2 };
    placePushedAtPark('spreader');
    propColliders.push({ x: spreaderYard.x, z: spreaderYard.z, r: 0.62 });
    walkProps.push({
      ...spreaderYard, r: 2.8,
      label: () => 'Rotary spreader · [E] select for weak turf',
      action: () => selectYardEquipment('spreader', 'spreader', 'Rotary spreader'),
    });

    if (!t || t.repaired) {
      attachMower();
      return yard; // the machine already runs — the yard is scenery
    }

    // the broken tractor: same silhouette, visibly let go — dulled, rusted, sagging
    let brokenGroup = null;
    const brokenCollider = { x: yard.x, z: yard.z, r: 1.25 };
    propColliders.push(brokenCollider);
    putModel('vendor/models/tractor_production.glb', 1, yard.x, yard.z, yard.yaw, (m) => {
      brokenGroup = m;
      m.rotation.z = 0.045; // flat rear tire sag
      m.position.y -= 0.14;
      m.traverse((o) => {
        if (o.name.startsWith('COL_')) o.visible = false;
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
      x: yardBx + 11.8, z: bz + 20.4, r: 2.4,
      label: () => 'Old leaves and junk - [E] clear it out',
      action: () => {
        if (!tractorStep(state, 'cleared').ok) return;
        if (leavesMesh) tweenOut(leavesMesh, () => removeOwnedObject(leavesMesh));
        walkProps.splice(walkProps.indexOf(leavesProp), 1);
        play('thunk');
        say('Junk cleared - you can get at the engine now.');
      },
    };
    putModel('vendor/models/leaves_pile.glb', 2.2, leavesProp.x, leavesProp.z, 0.4, (m) => { leavesMesh = m; });
    walkProps.push(leavesProp);

    // chore 2: the fuel can by the bench
    let canMesh = null;
    const canProp = {
      x: yardBx + 17.4, z: bz + 18.9, r: 2.0,
      label: () => 'Fuel can - [E] fill the tractor’s tank',
      action: () => {
        if (!tractorStep(state, 'fuel').ok) return;
        if (canMesh) tweenOut(canMesh, () => removeOwnedObject(canMesh));
        walkProps.splice(walkProps.indexOf(canProp), 1);
        play('thunk');
        say('Tank filled - smells like a running machine already.');
      },
    };
    putModel('vendor/models/gas_can.glb', 0.55, canProp.x, canProp.z, 0.9, (m) => { canMesh = m; });
    walkProps.push(canProp);

    // chore 3: the drive belt on the chest
    let beltMesh = null;
    const beltProp = {
      x: yardBx + 21.0, z: bz + 18.8, r: 2.0,
      label: () => 'Drive belt - [E] fit it to the tractor',
      action: () => {
        if (!tractorStep(state, 'belt').ok) return;
        if (beltMesh) tweenOut(beltMesh, () => removeOwnedObject(beltMesh));
        walkProps.splice(walkProps.indexOf(beltProp), 1);
        play('thunk');
        say('Belt on the pulleys - one pull of the starter to go.');
      },
    };
    putModel('vendor/models/belt.glb', 0.7, beltProp.x, beltProp.z, 0.3, (m) => { beltMesh = m; });
    walkProps.push(beltProp);

    // the machine itself: reports what it still needs, then comes alive
    const tractorProp = {
      x: yard.x, z: yard.z, r: 3.4,
      label: () => {
        const left = tractorRemaining(state);
        if (left.length) return `Broken tractor - needs ${left.map((s) => STEP_LABEL[s]).join(', ')}`;
        return 'Broken tractor - [E] get her running';
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
        say('She lives! The tractor is yours - mower deck hitched. [E] to take the wheel.');
      },
    };
    walkProps.push(tractorProp);
    return yard;
  }

  function buildHeroMaintenanceProps() {
    const model = state.courseMaintenance;
    if (!model) return;
    const geometry = {
      divotPit: new THREE.CylinderGeometry(0.31, 0.37, 0.055, 18),
      divotLip: new THREE.TorusGeometry(0.34, 0.045, 5, 18),
      ballMark: new THREE.RingGeometry(0.10, 0.29, 18),
      footprint: new THREE.CircleGeometry(0.24, 16),
      halo: new THREE.RingGeometry(0.36, 0.43, 24),
      sprinklerStem: new THREE.CylinderGeometry(0.10, 0.13, 0.25, 12),
      sprinklerRing: new THREE.TorusGeometry(0.16, 0.035, 6, 16),
    };
    const darkSoil = new THREE.MeshStandardMaterial({ color: 0x49321f, roughness: 1 });
    const filledSoil = new THREE.MeshStandardMaterial({ color: 0x8b7346, roughness: 1 });
    const divotLip = new THREE.MeshStandardMaterial({ color: 0x6c7d43, roughness: 0.95 });
    const bruise = new THREE.MeshBasicMaterial({ color: 0x403524, transparent: true, opacity: 0.34, depthWrite: false });
    const debrisColors = [0x6e5931, 0x86683d, 0x4d6132].map((color) => new THREE.Color(color));
    const debrisMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xe2c268, transparent: true, opacity: 0.56, depthWrite: false, side: THREE.DoubleSide,
    });
    const irrigationStemMaterial = new THREE.MeshStandardMaterial({ color: 0x26332b, roughness: 0.72, metalness: 0.18 });
    const irrigationRingMaterials = {
      ready: new THREE.MeshStandardMaterial({ color: 0xb49c65, roughness: 0.45, metalness: 0.35 }),
      running: new THREE.MeshStandardMaterial({ color: 0x79bfe5, roughness: 0.45, metalness: 0.35 }),
      clogged: new THREE.MeshStandardMaterial({ color: 0xc58345, roughness: 0.45, metalness: 0.35 }),
    };
    const irrigationSprayMaterial = new THREE.PointsMaterial({
      color: 0xaedfff, size: 0.095, map: softParticleTexture,
      transparent: true, opacity: 0.72, alphaTest: 0.04, depthWrite: false,
    });
    const addHalo = (group) => {
      const halo = new THREE.Mesh(geometry.halo, haloMaterial);
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.065;
      halo.renderOrder = 5;
      halo.visible = false;
      group.add(halo);
      return halo;
    };
    const addIssue = (issue, kind) => {
      const group = new THREE.Group();
      group.name = `Maintenance_${kind}_${issue.id}`;
      group.position.set(issue.x, heightAt(issue.x, issue.z) + 0.02, issue.z);
      const entry = { issue, kind, group, primary: null, marks: [] };
      if (kind === 'divot') {
        const pit = new THREE.Mesh(geometry.divotPit, darkSoil);
        pit.position.y = -0.012;
        group.add(pit);
        entry.primary = pit;
        entry.openMaterial = darkSoil;
        entry.filledMaterial = filledSoil;
        const lip = new THREE.Mesh(
          geometry.divotLip,
          divotLip,
        );
        lip.rotation.x = Math.PI / 2;
        lip.scale.z = 0.72;
        group.add(lip);
      } else if (kind === 'ballmark') {
        const mark = new THREE.Mesh(geometry.ballMark, bruise);
        mark.rotation.x = -Math.PI / 2;
        mark.scale.y = 0.72;
        group.add(mark);
        entry.primary = mark;
      } else if (kind === 'footprint') {
        for (let foot = 0; foot < 2; foot++) {
          const mark = new THREE.Mesh(geometry.footprint, bruise);
          mark.rotation.x = -Math.PI / 2;
          mark.scale.set(0.62, 1.28, 1);
          mark.position.set((foot ? 1 : -1) * 0.17, 0.02, (foot ? 1 : -1) * 0.30);
          group.add(mark);
          entry.marks.push(mark);
        }
        entry.primary = entry.marks[0];
      } else {
        const pieces = [];
        for (let piece = 0; piece < 6; piece++) {
          let pieceGeometry;
          const rotation = new THREE.Euler(0, piece * 1.1, 0);
          const scale = new THREE.Vector3(1, 1, 1);
          if (issue.type === 'branch' || issue.type === 'storm-debris') {
            pieceGeometry = new THREE.CylinderGeometry(0.035, 0.055, 0.65 + piece * 0.04, 6);
            rotation.z = Math.PI / 2;
          } else {
            pieceGeometry = new THREE.SphereGeometry(0.12 + (piece % 3) * 0.035, 7, 5);
            scale.y = 0.28;
          }
          const position = new THREE.Vector3(
            Math.sin(piece * 2.2) * 0.36,
            0.05 + (piece % 2) * 0.025,
            Math.cos(piece * 1.7) * 0.32,
          );
          const matrix = new THREE.Matrix4().compose(
            position,
            new THREE.Quaternion().setFromEuler(rotation),
            scale,
          );
          pieceGeometry.applyMatrix4(matrix);
          const color = debrisColors[piece % debrisColors.length];
          const colors = new Float32Array(pieceGeometry.attributes.position.count * 3);
          for (let vertex = 0; vertex < pieceGeometry.attributes.position.count; vertex++) {
            colors[vertex * 3] = color.r;
            colors[vertex * 3 + 1] = color.g;
            colors[vertex * 3 + 2] = color.b;
          }
          pieceGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          pieces.push(pieceGeometry);
        }
        const debrisGeometry = BufferGeometryUtils.mergeGeometries(pieces, false);
        for (const piece of pieces) piece.dispose();
        const debris = new THREE.Mesh(debrisGeometry, debrisMaterial);
        debris.castShadow = true;
        group.add(debris);
        entry.primary = debris;
      }
      entry.halo = addHalo(group);
      scene.add(group);
      maintenanceIssueEntries.push(entry);
      const noun = kind === 'ballmark' ? 'Ball mark' : kind === 'footprint' ? 'Bunker footprints' : kind === 'debris' ? 'Loose debris' : 'Open divot';
      walkProps.push({
        x: issue.x, z: issue.z, r: 2.8,
        label: () => (issue.repaired || issue.cleared) ? null : `${noun} · [I] inspect · choose the matching tool`,
        action: null,
      });
    };
    for (const issue of model.issues.divots) addIssue(issue, 'divot');
    for (const issue of model.issues.ballMarks) addIssue(issue, 'ballmark');
    for (const issue of model.issues.bunkerFootprints) addIssue(issue, 'footprint');
    for (const issue of model.issues.debris) addIssue(issue, 'debris');

    // Irrigation hardware is small but readable, with a real spray pattern and
    // persistent running/clogged state. The radial effect is capped at 72 points.
    for (const head of model.irrigation.heads) {
      const group = new THREE.Group();
      const stem = new THREE.Mesh(
        geometry.sprinklerStem,
        irrigationStemMaterial,
      );
      stem.position.y = 0.11;
      const ring = new THREE.Mesh(
        geometry.sprinklerRing,
        irrigationRingMaterials.ready,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.24;
      group.add(stem, ring);
      group.position.set(head.x, heightAt(head.x, head.z), head.z);
      scene.add(group);
      const sprayGeo = new THREE.BufferGeometry();
      sprayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(72 * 3), 3));
      const spray = new THREE.Points(sprayGeo, irrigationSprayMaterial);
      spray.visible = false;
      spray.frustumCulled = false;
      group.add(spray);
      maintenanceIrrigationEntries.push({
        head, group, ring, spray, ringMaterials: irrigationRingMaterials,
      });
      walkProps.push({
        x: head.x, z: head.z, r: 3.2,
        label: () => head.status === 'clogged'
          ? 'Clogged sprinkler head · [E] clear it'
          : head.enabled ? 'Sprinkler running · [E] shut off' : 'Sprinkler ready · [E] run this zone',
        action: () => { if (walkHooks.manageIrrigationHead) walkHooks.manageIrrigationHead(head.id); },
      });
    }
    const controller = model.irrigation.controller;
    const controllerBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.82, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x415b45, roughness: 0.72, metalness: 0.15 }),
    );
    controllerBox.position.set(controller.x, heightAt(controller.x, controller.z) + 0.48, controller.z);
    controllerBox.castShadow = true;
    scene.add(controllerBox);
    maintenanceControllerMesh = controllerBox;
    walkProps.push({
      x: controller.x, z: controller.z, r: 2.8,
      label: () => `Irrigation controller · ${controller.enabled ? 'ON' : 'OFF'} · [E] toggle`,
      action: () => {
        controller.enabled = !controller.enabled;
        if (!controller.enabled) {
          for (const head of model.irrigation.heads) {
            head.enabled = false;
            if (head.status === 'running') head.status = 'ready';
          }
        }
        if (walkHooks.toast) walkHooks.toast(`Irrigation controller ${controller.enabled ? 'on' : 'off'}.`);
        refreshMaintenanceWorldProps();
      },
    });
    refreshMaintenanceWorldProps();
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
      if (suppressesCourseGroundCoverAt(wx, wz)) return;
      let mesh = null;
      const prop = {
        x: wx, z: wz, r: 2.6,
        label: () => 'Storm debris - [E] haul it away',
        action: () => {
          if (!clearLitter(state, idx).ok) return;
          if (mesh) tweenOut(mesh, () => removeOwnedObject(mesh));
          walkProps.splice(walkProps.indexOf(prop), 1);
          updateTurf(state); // the flattened grass under it recovers
          if (walkHooks.sfx) walkHooks.sfx('thunk');
          if (walkHooks.toast) walkHooks.toast(t('world.debrisHauledOffThe'));
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
        label: () => `Broken tee sign - [E] repair it (${PROPS.signRepairCost} dollars)`,
        action: () => {
          const res = fixTeeSign(state);
          if (!res.ok) {
            if (walkHooks.toast) walkHooks.toast(res.reason || 'Cannot repair it right now.', 'warn');
            return;
          }
          placeSign(false);
          walkProps.splice(walkProps.indexOf(signProp), 1);
          if (walkHooks.sfx) walkHooks.sfx('chime');
          if (walkHooks.toast) walkHooks.toast(t('world.teeSignRestoredFirst'));
        },
      };
      walkProps.push(signProp);
    }
  }

  // entrance decor: the stone club sign on the approach, weathered to match the
  // course's actual condition at load. (The old small sign is now the tee sign;
  // the "pennant poles" were really flagsticks and moved to the holes.)
  function addLiveClubNamePanel(model) {
    const clubName = (state.clubName || 'The Club').trim().toUpperCase();
    const cnv = document.createElement('canvas');
    cnv.width = 1024;
    cnv.height = 416;
    const c2 = cnv.getContext('2d');

    c2.fillStyle = '#f2edda';
    c2.fillRect(0, 0, cnv.width, cnv.height);
    c2.strokeStyle = '#1d4b32';
    c2.lineWidth = 24;
    c2.strokeRect(16, 16, cnv.width - 32, cnv.height - 32);
    c2.strokeStyle = '#b7943f';
    c2.lineWidth = 8;
    c2.strokeRect(43, 43, cnv.width - 86, cnv.height - 86);

    const fitText = (text, maxWidth, startPx, weight, family) => {
      let size = startPx;
      do {
        c2.font = `${weight} ${size}px ${family}`;
        if (c2.measureText(text).width <= maxWidth) return;
        size -= 2;
      } while (size > 30);
    };
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.fillStyle = '#173f2c';
    fitText(clubName, 850, 112, 700, 'Georgia, serif');
    c2.fillText(clubName, cnv.width / 2, 184);
    c2.fillStyle = '#6f5a2a';
    c2.font = '700 54px "Segoe UI", sans-serif';
    c2.letterSpacing = '12px';
    c2.fillText('GOLF CLUB', cnv.width / 2, 305);

    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.36),
      new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xffffff,
        roughness: 0.82,
        metalness: 0,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    // The source GLB is one baked mesh. Its sign face is the local +X plane;
    // this preserves the authored stone/foliage while replacing only its name.
    // Vertex inspection places the irregular cream face at local X ~= 0.007;
    // seat the art against it instead of using the foliage/stone bounding box.
    panel.position.set(0.012, 0.39, 0);
    panel.rotation.y = Math.PI / 2;
    panel.name = `Live club name: ${clubName}`;
    panel.userData.releaseRole = 'live-club-name';
    panel.userData.clubName = clubName;
    model.add(panel);
  }

  let yardHome = null;
  {
    const s0 = course.structures[0];
    if (s0) {
      const bx = (s0.x + s0.w / 2) * CELL_YD - worldW / 2;
      const bz = (s0.y + s0.h / 2) * CELL_YD - worldH / 2;
      const modernPresentation = clubhouseApi?.modernClubhouse?.diagnostics?.().lifecycle !== 'dormant';
      const resortPresentation = state.property?.tierId === 'resortStyle';
      const premiumPresentation = state.property?.tierId === 'premiumPrivate';
      const luxuryPresentation = resortPresentation || premiumPresentation;
      if (!modernPresentation && !luxuryPresentation) putModel('vendor/models/club_sign.glb', 3.4, bx - 15, bz + 16, 0.45, (m) => {
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
        addLiveClubNamePanel(m);
      });
      if (!modernPresentation && !luxuryPresentation) {
        propColliders.push({ x: bx - 15, z: bz + 16, r: 1.6 });
      }
      if (!luxuryPresentation) {
        yardHome = buildMaintenanceYard(
          modernPresentation ? bx + 14 : bx,
          modernPresentation ? bz - 35 : bz,
        );
      }

      // the groundskeeper's residence — the owner-supplied house GLB, optimized
      // (334k→67k tris, see DEV_LOG 2026-07-13) and finally on the property.
      // Its baked garden bed reads as its own yard on the entrance approach.
      if (!luxuryPresentation) {
        putModel('vendor/models/clubhouse_ext_opt.glb', 20, bx - 30, bz + 27, 1.25, (m) => {
          m.position.y -= 0.12; // settle the baked landscaping bed into the turf
        });
        propColliders.push({ minX: bx - 40, maxX: bx - 20, minZ: bz + 21, maxZ: bz + 33 });
        walkProps.push({
          x: bx - 30, z: bz + 24, r: 4.5,
          label: () => "The groundskeeper's house - someone kept a nicer yard than the course",
          action: null,
        });
      }

      // Golf carts are no longer parked scenery. The fleet is assigned to live
      // round parties and the same vehicle follows their canonical route.
    }
  }
  buildCourseProps();
  buildHeroMaintenanceProps();
  refreshWalkColliders(); // parking needs to see the world
  const savedTractor = state.tractor?.repaired ? state.tractor.location : null;
  if (savedTractor && [savedTractor.x, savedTractor.z, savedTractor.yaw].every(Number.isFinite)) {
    cart.x = savedTractor.x;
    cart.z = savedTractor.z;
    cart.yaw = savedTractor.yaw;
    placeCartMesh();
  } else if (yardHome) {
    // the tractor lives at the yard, broken or not
    cart.x = yardHome.x;
    cart.z = yardHome.z;
    cart.yaw = yardHome.yaw;
    placeCartMesh();
    if (state.tractor?.repaired) {
      recordTractorUse(state, { x: cart.x, z: cart.z, yaw: cart.yaw });
    }
  } else {
    parkCartAtClubhouse();
  }
  resize();
  rig.apply();

  // --- prewarm: compile every shader program + upload every texture behind the loading
  // veil so the first real look-around never hitches on lazy GPU work (356ms freezes
  // were measured on the first cold 360° turn before this existed)
  // PER-PHASE LOAD TIMING. PHASE_1_CLASSIFICATION §"The 18.2 s load, explained"
  // named every phase below and then said, correctly, that "which step dominates
  // is UNVERIFIED; no per-step timing exists". Ranking a budget without
  // measuring it is how the last three optimisation passes picked the wrong
  // target. Costs about a microsecond per phase and is read by
  // tools/qa/load-time-profile.js.
  // how far from the spawn eye counts as "the player will see this in the first
  // minute" — used only to report the near/far split of the warm set
  const PREWARM_NEAR_RADIUS_YD = 60;
  let programKeyBreakdown = null;
  const prewarmTimings = [];
  function markPrewarm(label, sinceMs) {
    prewarmTimings.push({ label, ms: +(performance.now() - sinceMs).toFixed(1) });
    return performance.now();
  }

  async function prewarm(onStep) {
    const tick = () => new Promise((res) => requestAnimationFrame(res));
    const alive = () => !sceneDisposed;
    const step = (label) => { if (alive() && onStep) onStep(label); };
    if (!alive()) return false;
    prewarmTimings.length = 0;
    const prewarmStartedAt = performance.now();
    let phaseAt = prewarmStartedAt;
    step('Loading models');
    await whenAssetsIdle(8000);
    phaseAt = markPrewarm('assets-idle', phaseAt);
    if (!alive()) return false;
    // DefaultLoadingManager deliberately fails open after eight seconds. Give
    // checkout's exact cash prototypes their own bounded readiness handshake so
    // a slow local GLB decode cannot turn an empty representative root into a
    // false-success warm-up and permanently defer the cost to first tender.
    await clubhouseApi?.register?.waitForCashGpuPrewarmRepresentatives?.(12000);
    phaseAt = markPrewarm('cash-kit-handshake', phaseAt);
    if (!alive()) return false;
    await tick();
    if (!alive()) return false;
    step('Compiling shaders');
    await tick();
    if (!alive()) return false;
    phaseAt = performance.now();
    // TRIED AND REJECTED, 2026-08-03: renderer.compileAsync(). It polls
    // KHR_parallel_shader_compile so the driver can compile off-thread, which
    // should have been exactly right for a load dominated by 132 program
    // compiles. Measured, it cost 1,350 ms here (against 107 ms for the sync
    // link) and returned only ~200 ms of the warm draw — a net 0.5 s LOSS. The
    // extension is either absent on this path or the HLSL compile still lands
    // at first draw regardless. Recorded so nobody spends the afternoon on it
    // twice.
    renderer.compile(scene, camera);
    phaseAt = markPrewarm('renderer.compile', phaseAt);
    // A3 (Goal 17): compile() walks only VISIBLE objects, and the ledger's page
    // faces live inside a closed book. So the first thing the player opens was
    // the one thing this whole pass could not reach: measured, its first open
    // cost 1624 ms to ink with a 1.4-2.8 s frozen frame, against 146 ms for
    // every reopen. The book reveals its open subtree for the length of one
    // compile and puts it back.
    if (alive()) {
      clubhouseApi?.ledgerBook?.prewarmVisual?.(renderer, camera, scene);
      phaseAt = markPrewarm('ledger-first-visibility', phaseAt);
    }
    // A1 (Goal 17) — AND THE SAME MECHANISM, GENERALISED.
    //
    // compile() walks traverseVisible, so NOTHING hidden at load has ever been
    // warmed by this pass. The ledger's page faces were one instance; measured
    // across a plain 30-second walk in a settled session, seven more programs
    // still compiled, and the two frames that carried them took 1600.0 ms and
    // 2201.7 ms with zero new geometries and zero new textures. That is the
    // "far laggier" the brief opens with, arriving minutes into play.
    //
    // So every hidden object is revealed for the length of one compile.
    //
    // LIGHTS ARE DELIBERATELY EXCLUDED. A program's cache key carries the
    // scene's light counts (A3 proved that the expensive way), so revealing a
    // hidden light here would warm programs keyed to a light list that never
    // occurs in play AND leave the real ones cold - strictly worse than doing
    // nothing.
    if (alive()) {
      const forced = [];
      scene.traverse((object) => {
        if (!object.visible && !object.isLight) {
          forced.push(object);
          object.visible = true;
        }
      });
      if (forced.length) {
        renderer.compile(scene, camera);
        for (const object of forced) object.visible = false;
      }
      prewarmTimings.push({ label: 'hidden-objects-revealed', ms: forced.length });
      phaseAt = markPrewarm('compile-hidden', phaseAt);
    }
    await tick();
    if (!alive()) return false;
    step('Uploading textures');
    phaseAt = performance.now();
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
      if (!alive()) return false;
      for (let j = i; j < Math.min(i + 24, pending.length); j++) {
        // A single unsupported or late texture must not abort the remainder of
        // the opaque GPU warm-up. Its normal draw can retry independently.
        try { renderer.initTexture(pending[j]); } catch (_) { /* draw path retries */ }
      }
      await tick();
      if (!alive()) return false;
    }
    prewarmTimings.push({ label: 'texture-count', ms: pending.length });
    phaseAt = markPrewarm('initTexture-batches', phaseAt);
    step('Warming the view');
    // linking programs is not enough — Windows/ANGLE drivers defer the real compile to a
    // program's FIRST DRAW. One frame with frustum culling off forces a draw of every
    // visible material (and uploads its geometry); fragments off-screen are clipped.
    // ONE REPRESENTATIVE PER PROGRAM, NOT EVERY OBJECT IN THE SCENE.
    //
    // Measured 2026-08-03 (tools/qa/load-time-profile.js): this single phase
    // cost 9,720 ms of an 18,578 ms load — 52% of the whole wait, and 77% of
    // prewarm. It disabled frustum culling on 5,310 objects and then drew all
    // of them, twice over, because the forced draw carries a full shadow bake
    // and the depth pass submits the same set.
    //
    // The reason the phase exists is that Windows/ANGLE defers a program's real
    // compile to its FIRST DRAW. But a program is a function of the MATERIAL and
    // the geometry's shape (skinned, instanced, morphed, vertex-coloured) — not
    // of the object. Five thousand fence posts sharing one material compile one
    // program between them, and drawing the other 5,309 buys nothing.
    //
    // So the warm set is deduplicated by that key. Anything already inside the
    // frustum draws normally and is left alone. If a program is somehow missed,
    // the cost is its own first draw later — the same hitch this phase trades
    // load time to avoid, for a vanishing subset instead of all of it.
    const culled = [];
    const warmedPrograms = new Set();
    // THIS KEY HAS TO BE AT LEAST AS FINE AS THREE'S OWN, or the phase warms one
    // representative of a group that is really several programs and the rest
    // compile later, in front of the player.
    //
    // It was not. Measured in Electron on pine-hills-v2 2026-08-06
    // (tools/qa/electron-stall-attribution.js): 42 programs arrived AFTER the
    // load veil lifted, 36 of them `physical`, and diffing each late cacheKey
    // against its nearest already-warm twin named the field that differed —
    // `morphAttributeCount` on 35 of the 42, going 1→2, 3→2 and 6→2. The old key
    // collapsed every morph count into one 'm' flag, so a material used by two
    // geometries with different numbers of morph targets warmed ONE of them.
    //
    // The bill for the rest landed on the first walk into the shop: 2,460 ms of
    // stalls across eight frames, worst 1,290 ms, against 232 ms for the
    // identical spin once they were resident. A control that forces twenty
    // brand-new programs in front of the eye costs 684 ms, so ~34 ms a program
    // is the going rate on an RTX 5080 and these numbers are the right size.
    //
    // Morph COUNTS (not a boolean), and the two shadow flags, are the parameters
    // three keys on that an object can differ in while sharing a material. The
    // rest of its key is a function of the material, the renderer and the light
    // set, which the representative already carries.
    const programKey = (object, material) => {
      const g = object.geometry;
      const morph = g?.morphAttributes || null;
      // KEYED ON THE MATERIAL INSTANCE, DELIBERATELY, AND IT IS NOT A PROGRAM
      // COUNT. Two materials with identical flags share ONE GL program, so this
      // set is an over-estimate by design: 846 keys covered 135 real programs
      // when measured. That is the SAFE direction for a warm pass - over-warming
      // costs a few extra draws behind the veil, under-warming ships a hitch at
      // the moment the player first sees the object - so the key stays as it is
      // and the LABEL was the thing that was wrong. See 'material-instances'
      // below, which used to be reported as 'distinct-programs'.
      return [
        material.uuid,
        object.isSkinnedMesh ? 's' : '',
        object.isInstancedMesh ? 'i' : '',
        // the count, and which attributes are morphed — three bakes both into the shader
        morph?.position?.length || 0,
        morph?.normal?.length || 0,
        morph?.color?.length || 0,
        g?.attributes?.color ? 'c' : '',
        g?.attributes?.uv2 ? '2' : '',
        object.receiveShadow ? 'r' : '',
        object.castShadow ? 'C' : '',
      ].join('|');
    };
    const _warmPos = new THREE.Vector3();
    const eyeNow = camera.getWorldPosition(new THREE.Vector3());
    let nearWarmed = 0;
    scene.traverse((o) => {
      if (!o.frustumCulled) return;
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      let needed = false;
      for (const m of mats) {
        if (!m) continue;
        const key = programKey(o, m);
        if (warmedPrograms.has(key)) continue;
        warmedPrograms.add(key);
        needed = true;
      }
      if (!needed) return;
      o.getWorldPosition(_warmPos);
      if (_warmPos.distanceTo(eyeNow) <= PREWARM_NEAR_RADIUS_YD) nearWarmed += 1;
      culled.push(o);
      o.frustumCulled = false;
    });
    prewarmTimings.push({ label: 'near-warm-objects', ms: nearWarmed });
    phaseAt = markPrewarm('warm-traverse', phaseAt);
    renderer.shadowMap.needsUpdate = true; // bake once here so depth-pass programs compile behind the veil
    guardCourseWaterReflection.beginFrame();
    try { composer.render(); } catch (e) { renderer.render(scene, camera); }
    // WHAT THIS FRAME COSTS, AND WHY (measured 2026-08-03):
    //   this render                     9,741 ms
    //   the IDENTICAL render after it      51 ms
    // So the bill is one-time program compilation — 132 GL programs at ~73 ms
    // each, ANGLE translating to HLSL and D3D compiling, serialized on the JS
    // thread because a program's real compile lands on its first draw. It is
    // not geometry throughput (cutting the submitted set from 5,310 objects to
    // 887 moved it by nothing), it is not the shadow bake or the post chain
    // (both are in that 51 ms repeat), and it is not distant course work
    // (785 of the 887 are within 60 yd of the spawn eye). The repeat draw was a
    // diagnostic and is not shipped; its number is recorded here instead.
    phaseAt = markPrewarm('warm-composer-render', phaseAt);
    prewarmTimings.push({ label: 'uncalled-object-count', ms: culled.length });
    prewarmTimings.push({ label: 'gl-programs', ms: renderer.info.programs?.length ?? -1 });
    // NOT 'distinct-programs'. This counts material INSTANCES warmed, which
    // over-states the program count roughly six-fold. The real figure is
    // renderer.info.programs, reported as 'gl-programs' above.
    prewarmTimings.push({ label: 'material-instances', ms: warmedPrograms.size });
    // A1: WHERE THE 132 PROGRAMS COME FROM.
    //
    // The load is dominated by one-time program compilation - measured at ~73 ms
    // each, serialized on the JS thread because a program's real compile lands on
    // its first draw. compileAsync was tried and cost more than it saved (see the
    // note above), so the only lever left is COMPILING FEWER, and nothing had
    // ever measured which axis of the key is generating the permutations.
    //
    // This breaks the warmed keys down by field so the biggest reducible axis is
    // a number rather than a guess. Diagnostic only: it reads keys already
    // collected and adds no GL work.
    programKeyBreakdown = (() => {
      const axes = {
        type: new Map(), lights: new Map(), morph: new Map(),
        vertexColor: new Map(), uv2: new Map(), shadow: new Map(),
      };
      const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
      for (const key of warmedPrograms) {
        const f = String(key).split('|');
        bump(axes.type, f[0] ?? '?');
        bump(axes.lights, f[1] ?? '?');
        bump(axes.morph, `${f[2] ?? '?'}/${f[3] ?? '?'}`);
        bump(axes.vertexColor, f[4] ? 'yes' : 'no');
        bump(axes.uv2, f[5] ? 'yes' : 'no');
        bump(axes.shadow, `${f[6] ? 'r' : '-'}${f[7] ? 'C' : '-'}`);
      }
      const top = (map) => [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, n]) => ({ value: k, programs: n }));
      return {
        total: warmedPrograms.size,
        // how many DISTINCT values each axis takes: an axis with one value
        // costs nothing, an axis with eight is multiplying the others
        spread: Object.fromEntries(
          Object.entries(axes).map(([name, map]) => [name, map.size]),
        ),
        byAxis: Object.fromEntries(
          Object.entries(axes).map(([name, map]) => [name, top(map)]),
        ),
      };
    })();
    phaseAt = markPrewarm('forced-full-draw', phaseAt);

    // THE SHOP FLOOR, WARMED FROM INSIDE IT.
    //
    // The forced draw above disables frustum culling, so it submits every warm
    // representative whatever the camera is looking at — geometry coverage is
    // complete from one pose. But a GL program's cache key is not a function of
    // the geometry alone: it carries the NUMBER of lights of each type, the
    // shadow-map type and the clipping-plane count, all of which are properties
    // of the FRAME. Standing at the spawn, outdoors, that frame has the exterior
    // light set. Walking into the shop is a different frame, and every physical
    // program in the world is a different program in it.
    //
    // Measured in Electron on pine-hills-v2 2026-08-06
    // (tools/qa/electron-stall-attribution.js): the first spin on the shop floor
    // cost 2.5-4.8 s across six to eight stalled frames, the worst 1,290 ms. The
    // IDENTICAL spin immediately afterwards cost 43-330 ms with no program
    // arrivals at all, and a fresh OUTDOOR pose — where the spawn warm stood —
    // cost nothing. Standing still at the spawn for twelve seconds with the world
    // running cost nothing either, so it is not the living world's churn.
    //
    // So: two more forced draws, one with the eye in the middle of the interior
    // and one with the interior hidden, to compile both light states behind the
    // veil. Geometry is already resident, so the marginal cost is the programs
    // themselves. clubhouse.update() is deliberately NOT called — that would
    // advance customers, deliveries and checkout state behind the veil, which is
    // the mistake the editor-camera warm below documents.
    const warmInterior = clubhouseApi?.interior || null;
    if (warmInterior) {
      const savedWarm = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        interiorVisible: warmInterior.visible,
        walkActive: walk.active,
        walkX: walk.x,
        walkZ: walk.z,
      };
      const anchor = warmInterior.getWorldPosition(new THREE.Vector3());
      // eye height above the floor the interior sits on, looking level
      camera.position.set(anchor.x, anchor.y + 1.7, anchor.z);
      camera.rotation.set(0, 0, 0, 'YXZ');
      camera.updateMatrixWorld(true);
      // walk mode picks the ±120yd fitted shadow box rather than the whole-course
      // 4096 — a different shadowMapType/size and therefore different programs.
      // fitSunShadow centres that box on walk.x/walk.z, NOT on the camera, so
      // moving the eye alone leaves the shadow box back at the spawn and the
      // interior's own depth pass never warms. (It did exactly that on the first
      // attempt, which is why that attempt measured as doing nothing.)
      walk.active = true;
      walk.x = anchor.x;
      walk.z = anchor.z;
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        if (!alive()) return false;
        camera.rotation.set(0, yaw, 0, 'YXZ');
        camera.updateMatrixWorld(true);
        clubhouseApi?.syncCameraVisibility?.();
        fitSunShadow();
        renderer.shadowMap.needsUpdate = true;
        guardCourseWaterReflection.beginFrame();
        try { composer.render(); } catch (e) { renderer.render(scene, camera); }
      }
      prewarmTimings.push({ label: 'gl-programs-after-interior', ms: renderer.info.programs?.length ?? -1 });
      // ...and the other side of the same switch: the exterior light set with the
      // interior explicitly down, so stepping back out of the door is warm too.
      warmInterior.visible = false;
      camera.position.copy(savedWarm.position);
      camera.quaternion.copy(savedWarm.quaternion);
      camera.updateMatrixWorld(true);
      walk.x = savedWarm.walkX;
      walk.z = savedWarm.walkZ;
      fitSunShadow();
      renderer.shadowMap.needsUpdate = true;
      guardCourseWaterReflection.beginFrame();
      try { composer.render(); } catch (e) { renderer.render(scene, camera); }
      warmInterior.visible = savedWarm.interiorVisible;
      walk.active = savedWarm.walkActive;
      camera.updateMatrixWorld(true);
      prewarmTimings.push({ label: 'gl-programs-after-both', ms: renderer.info.programs?.length ?? -1 });
      phaseAt = markPrewarm('interior-camera-warm', phaseAt);
      await tick();
      if (!alive()) return false;
    }

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
    phaseAt = markPrewarm('editor-camera-warm', phaseAt);
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
    phaseAt = markPrewarm('restore-pose', phaseAt);
    await tick();
    if (!alive()) return false;
    // A couple of normal frames settle the AO history and bloom targets. Keep
    // the exact restored pose: these diagnostic turns must not leak through the
    // loading veil into the first player frame.
    const settledQuaternion = camera.quaternion.clone();
    for (let i = 0; i < 3; i++) {
      if (!alive()) return false;
      camera.rotation.set(0, (i * Math.PI * 2) / 3, 0, 'YXZ');
      renderer.shadowMap.needsUpdate = true;
      guardCourseWaterReflection.beginFrame();
      try { composer.render(); } catch (e) { renderer.render(scene, camera); }
      await tick();
      if (!alive()) return false;
    }
    phaseAt = markPrewarm('three-spin-frames', phaseAt);
    camera.quaternion.copy(settledQuaternion);
    camera.updateMatrixWorld(true);
    prewarmTimings.push({ label: 'TOTAL', ms: +(performance.now() - prewarmStartedAt).toFixed(1) });
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
    // X4 (Goal 21): the APP tells the scene when the overview is up.
    // activeCourseCamera looks like the right signal and is not -- nothing
    // writes it when the player presses Tab, so a pin gated on it never once
    // existed while the game was demonstrably in overview mode.
    setOverviewPin: (on) => { overviewPinWanted = !!on; },
    prewarm,
    // Ranked, measured load cost. Empty until prewarm has run once.
    prewarmTimings: () => prewarmTimings.map((entry) => ({ ...entry })),
    // A1: which axis of the program key is generating the permutations that
    // dominate the load. Null until a prewarm has run.
    programKeyBreakdown: () => (programKeyBreakdown
      ? JSON.parse(JSON.stringify(programKeyBreakdown)) : null),
    whenAssetsIdle: () => whenAssetsIdle(10000),
    camera,
    rig,
    post: { composer, gtao, bloom, sun, stats: () => ({ shadowBakes }) },
    // Texture-memory infrastructure, exposed so the QA harness can assert that
    // sharing and compression are actually happening rather than assume it.
    textureMemory: () => ({ ktx2: ktx2Diagnostics(), shared: sharedTextureDiagnostics() }),
    render,
    resize,
    raycastCell,
    raycastGround,
    updateTurf,
    updateCourseMaintenance,
    updatePlan,
    updateHoles,
    rebuildAll,
    refreshGround,
    updateZoneField,
    editorPerformanceSnapshot,
    resetEditorPerformanceStats,
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
    // The interior fill, as a knob and a reading. The knob exists so the scale is
    // chosen by sweeping it against the legibility floors the measurement
    // established, rather than by picking a number that "looks dark".
    interiorFill: {
      scale: () => interiorFillScale,
      setScale: (v) => { if (Number.isFinite(v)) interiorFillScale = Math.max(0, Math.min(1, v)); },
      factor: () => interiorFillLast,
      hemiIntensity: () => hemi.intensity,
      blendYd: INTERIOR_FILL_BLEND_YD,
      // The view-coverage term, and a switch for it. The switch is what makes
      // the doorway fix measurable: off reproduces the old position-only
      // behaviour exactly, so before/after is one A/B in a fixed pose rather
      // than two builds.
      viewFraction: () => viewInsideFraction(),
      setViewBlend: (on) => { viewBlendEnabled = !!on; },
      viewBlendEnabled: () => viewBlendEnabled,
    },
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
    setShadowQuality,
    setPostEnabled,
    setAntialiasSamples,
    antialiasSamples,
    postDiag,
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
      // Read-only view of the movement key set. Until this existed, nothing
      // outside this closure could tell "the browser never delivered the key"
      // apart from "the key arrived and the walker ignored it" — the exact
      // ambiguity that let two D-key harnesses pass a broken D key.
      heldKeys: () => [...walkHeld],
      // Diagnostics for the stranded-modifier class: how many phantoms the
      // reconcile has caught, and which. Non-empty means the page WAS carrying a
      // modifier the OS had already released.
      phantomModifiers: () => [...walkPhantomModifiers],
      // What the walk controller believes is held RIGHT NOW, canonically spelled.
      // This is what the HUD chip renders. After a reconcile has run, anything
      // still in here is a modifier the OS agrees is down — genuinely stuck below
      // the browser, not a page-side phantom.
      heldModifiers: () => heldModifierNames(walkHeld),
      // What the OPERATING SYSTEM reports as held, from the last event that could
      // answer. Anything in here that the walker does not bind is eating the
      // player's keys right now, and no page code can release it — the only
      // remedy is the player tapping the physical key.
      osModifiers: () => [...walkOsModifiers],
      lastReconcileSource: () => walkLastReconcileSource,
      // Test seam: strand a modifier the way a Windows-key tap does — down on the
      // page, released somewhere the page never sees. Nothing in production calls
      // this; it exists so a probe can reproduce the bug rather than simulate a
      // fix. Named with the same word the defect uses.
      strandModifier: (name = 'meta') => { walkHeld.add(String(name).toLowerCase()); },
      // Test/diagnostic seam: force the same release the three interrupt signals
      // do, so a harness can prove the clear happens without faking a real blur.
      releaseAllInput: () => walkBlur(),
      // WHAT THE MOVEMENT BLOCK SAW. A probe watching from outside can tell whether a
      // key reached the page and whether it landed in walkHeld, but not whether the
      // per-frame movement code then acted on it — position delta conflates "never
      // arrived" with "arrived and a collider was in the way". Counted only between
      // begin() and end(); zero cost otherwise.
      moveIntent: {
        begin() {
          Object.assign(walkMoveIntent, {
            recording: true, frames: 0, movingFrames: 0, right: 0, left: 0, forward: 0, back: 0, last: null,
          });
        },
        read: () => ({
          frames: walkMoveIntent.frames,
          movingFrames: walkMoveIntent.movingFrames,
          right: walkMoveIntent.right,
          left: walkMoveIntent.left,
          forward: walkMoveIntent.forward,
          back: walkMoveIntent.back,
          last: walkMoveIntent.last ? { ...walkMoveIntent.last } : null,
        }),
        end() { walkMoveIntent.recording = false; },
      },
      hooks: walkHooks,
      placeCart: (x, z, yaw) => {
        tractorPark.x = x;
        tractorPark.z = z;
        if (yaw !== undefined) tractorPark.yaw = yaw;
        if (!cart.mounted || cart.vehicleKind === 'tractor') {
          cart.x = tractorPark.x;
          cart.z = tractorPark.z;
          cart.yaw = tractorPark.yaw;
        }
        placeCartMesh();
      },
      toggleLights: toggleGolfCartLights,
      toggleVehicleCamera: toggleGolfCartCamera,
      setTool: walkSetToolDebounced,
      getTool: () => walkTool,
      // E1 — the six axes the broom was fixed against, readable for EVERY tool
      // from the live rig rather than from its registry entry. The registry
      // says what a tool declares; this says where its geometry actually ended
      // up after the frame posed it.
      // I5: the hand-tool clamp's last applied pull per tool (yd). 0 = free.
      handToolClampDiagnostics: () => ({ ...handToolClampDebug }),
      floorAnchorDiagnostics: () => ({
        frame: floorAnchorDebug.frame,
        anchoredTools: FLOOR_ANCHORED_TOOLS,
        tools: JSON.parse(JSON.stringify(floorAnchorDebug.tools)),
        // What the group actually carries NOW, read from outside the frame. If
        // this disagrees with `applied` above, something downstream is
        // overwriting the solve and the solve is not the thing to fix.
        live: FLOOR_ANCHORED_TOOLS.map((id) => {
          const g = heldGroups[id];
          const rest = g?.userData?.cleaningRestPosition;
          return {
            id,
            visible: !!g?.visible,
            positionY: g ? +g.position.y.toFixed(4) : null,
            restY: rest ? +rest.y.toFixed(4) : null,
            offsetY: g && rest ? +(g.position.y - rest.y).toFixed(4) : null,
            restIsPosition: !!(g && rest === g.position),
          };
        }),
        walkAt: { x: +walk.x.toFixed(3), z: +walk.z.toFixed(3) },
        groundYAtWalk: clubhouseApi?.groundYAt ? +clubhouseApi.groundYAt(walk.x, walk.z).toFixed(4) : null,
      }),
      heldToolGeometry: () => {
        if (!walkTool) return null;
        const def = CLEANING_TOOLS[walkTool];
        const g = heldGroups[walkTool];
        if (!def || !g) return null;
        const contactName = def.sockets?.contact ? 'contact' : (def.sockets?.nozzle ? 'nozzle' : null);
        const contact = contactName ? socketWorld(g, contactName, new THREE.Vector3()) : null;
        const floorY = clubhouseApi?.groundYAt ? clubhouseApi.groundYAt(walk.x, walk.z) : null;
        const box = new THREE.Box3().setFromObject(g);
        const ndc = contact ? contact.clone().project(camera) : null;
        // hands: are they parented INTO this tool, and does the arm carry a
        // sleeve/cuff rather than ending in a bare stub?
        let handMeshes = 0;
        let sleeveMeshes = 0;
        g.traverse((o) => {
          if (/FirstPerson(Right|Left)Hand/.test(o.name || '')) handMeshes += 1;
          if (/Sleeve|Cuff|Forearm/i.test(o.name || '')) sleeveMeshes += 1;
        });
        return {
          tool: walkTool,
          floorAnchored: !!def.floorAnchored,
          worldPitch: def.worldPitch ?? null,
          contactSocket: contactName,
          contactWorldY: contact ? +contact.y.toFixed(4) : null,
          contactWorld: contact
            ? { x: +contact.x.toFixed(4), y: +contact.y.toFixed(4), z: +contact.z.toFixed(4) }
            : null,
          contactAboveFloor: (contact && floorY != null) ? +(contact.y - floorY).toFixed(4) : null,
          contactNdc: ndc ? { x: +ndc.x.toFixed(3), y: +ndc.y.toFixed(3) } : null,
          boxMinY: box.isEmpty() ? null : +box.min.y.toFixed(4),
          boxMaxY: box.isEmpty() ? null : +box.max.y.toFixed(4),
          // the group's own local pose, so an animation can be detected as a
          // spread of poses rather than assumed from the presence of a hook
          localPose: [
            +g.position.x.toFixed(4), +g.position.y.toFixed(4), +g.position.z.toFixed(4),
            +g.rotation.x.toFixed(4), +g.rotation.y.toFixed(4), +g.rotation.z.toFixed(4),
          ],
          handMeshes,
          sleeveMeshes,
          hasGrip: !!def.grip,
          hasSupport: !!def.support,
          geomSource: rigFor(walkTool)?.isActive() ? rigFor(walkTool).diagnostics().geomSource : null,
        };
      },
      // C10 — what is drawn in the hands, from every pass that can draw it, so
      // a driver can check the station stow without trusting one flag.
      heldToolDiagnostics: () => ({
        tool: walkTool,
        stationOpen: !!clubhouseApi?.register?.isActive?.(),
        stationStowedTool,
        heldRootVisible: heldRoot.visible,
        broomPassActive: Object.values(toolRigs).some((rig) => rig.isActive()),
        visibleHeldGroups: Object.entries(heldGroups)
          .filter(([, g]) => g.visible).map(([name]) => name),
      }),
      heldAssetDiagnostics: heldAssetRegistry.diagnostics,
      toolViewmodelDiagnostics: () => ({
        loadResults: toolViewmodelsAuthored,
        ...toolViewmodels.diagnostics(),
      }),
      getAutoTool: () => autoTool,
      configure(options = {}) {
        if (Number.isFinite(options.sensitivity)) walk.sens = options.sensitivity;
        if (Number.isFinite(options.fov)) walk.fov = options.fov;
        if (typeof options.invertY === 'boolean') walk.invertY = options.invertY;
        if (typeof options.cameraBob === 'boolean') walk.cameraBob = options.cameraBob;
        if (typeof options.reducedMotion === 'boolean') walk.reducedMotion = options.reducedMotion;
        if (walk.active && !walkFocusPose && Number.isFinite(options.fov)) {
          camera.fov = options.fov;
          camera.updateProjectionMatrix();
        }
      },
      // E7: WHAT configure() ACTUALLY TOOK. Three camera settings — sensitivity,
      // invert-Y and head bob — were delivered here by applySettings and then
      // vanished into closure variables nothing could read, so an audit asking
      // "does this control do anything" got null for all three and could not
      // tell a working setting from a dead one. A setting the game cannot be
      // asked about is a setting nobody can verify.
      diagnostics: () => ({
        sensitivity: walk.sens,
        fov: walk.fov,
        invertY: !!walk.invertY,
        cameraBob: !!walk.cameraBob,
        reducedMotion: !!walk.reducedMotion,
        active: !!walk.active,
        tool: walkTool,
      }),
      setSpraying: walkSetSpraying,
      isSpraying: () => walkSpraying,
      setSoaping: walkSetSoaping,
      isSoaping: () => walkSoaping,
      cleaningDiagnostics: () => ({
        tool: walkTool,
        using: walkSpraying,
        soaping: walkSoaping,
        contact: cleaningLastContact.toArray(),
        target: cleaningLastTarget.toArray(),
        result: cleaningLastResult ? { ...cleaningLastResult } : null,
        sprayVisible: sprayPoints.visible,
        viewmodels: toolViewmodels.diagnostics(),
        effects: clubhouseApi?.cleaningEffectsDiagnostics?.() || null,
      }),
      // Phase 6: the broom rig's acceptance numbers (head NDC at the current
      // pitch, reach, clamp state, tilt, intensity). Null-safe for QA that
      // probes before the rig exists.
      broomDiagnostics: () => broomVm.diagnostics(),
      // I1: the same instrument surface, addressable per rig tool. Null for a
      // tool the rig does not own, so a driver cannot mistake "no rig" for a
      // healthy pose.
      toolRigDiagnostics: (id) => (toolRigs[id] ? toolRigs[id].diagnostics() : null),
      // WHICH AUTHORED TOOL ASSETS ACTUALLY ADOPTED, AND WHY NOT.
      //
      // `adoptAuthored()` resolves an array of {id, ok, reason} and the result
      // was assigned to a closure variable that NOTHING READ. A tool whose GLB
      // fails to load falls back to its procedural stand-in on purpose - "not
      // fatal, the procedural tool is already on screen and fully playable" -
      // so the failure is invisible on screen AND unreadable from a driver.
      //
      // That combination is what cost this session's tool-beat investigation:
      // every asset-socket diagnostic (shaftDrop, assetHeadNdc, headAboveFloor)
      // returns null when the authored asset is absent, and qa-boot's
      // `toolIsLive` reads that null as "the rig is not running". The one fact
      // that separates "broken rig" from "asset never adopted" existed and was
      // thrown away.
      //
      // null here means adoption has not resolved yet, which is itself an
      // answer a driver needs to be able to tell apart from failure.
      // First-invocation cost of every lazy builder, in call order. Empty until
      // one actually builds, which is itself the answer to "does this fire on
      // the first step at all?"
      lazyBuildTimings: () => lazyBuildTimings.map((r) => ({ ...r })),
      // null until adoption resolves. Any object here was built inside the
      // compile block, so its presence proves the block ran.
      toolPrecompileInfo: () => (toolPrecompile ? { ...toolPrecompile } : null),
      toolAuthoredResults: () => (toolViewmodelsAuthored
        ? toolViewmodelsAuthored.map((r) => ({ id: r.id, ok: r.ok, reason: r.reason ?? null }))
        : null),
      // B2 — the tuning overlay's surface. toolFeelLive hands back the LIVE
      // mutable clone (the overlay writes leaves directly and calls refresh
      // for the constructor-captured set); toolFeelSet is the path-string
      // form the QA driver uses so its writes go through the same door.
      toolFeelLive: (id) => liveToolFeel[id] || null,
      toolFeelSet: (id, path, value) => {
        const feel = liveToolFeel[id];
        if (!feel || typeof path !== 'string') return null;
        const keys = path.split('.');
        let node = feel;
        for (let i = 0; i < keys.length - 1; i += 1) {
          if (node[keys[i]] == null || typeof node[keys[i]] !== 'object') return null;
          node = node[keys[i]];
        }
        const leaf = keys[keys.length - 1];
        const idx = Number(leaf);
        if (Array.isArray(node) && Number.isInteger(idx)) node[idx] = Number(value);
        else node[leaf] = typeof node[leaf] === 'number' ? Number(value) : value;
        toolRigs[id]?.refreshFromFeel?.();
        if (path.startsWith('strands')) pushStrandParams(id);
        return true;
      },
      toolFeelRefresh: (id) => (toolRigs[id]?.refreshFromFeel ? toolRigs[id].refreshFromFeel() : false),
      toolFeelSnapshot: () => JSON.parse(JSON.stringify(liveToolFeel)),
      toolFeelApplyOverrides: (overrides) => applyToolFeelOverrides(overrides),
      strandRigFor: (id) => heldGroups[id]?.userData?.strandRig || null,
      pushStrandParams,
      // B3/B4: the framing sweep sets a tool's hand anchor live and reads the
      // head's plant back, so the two constraints can be satisfied together
      // instead of one being tuned until the other breaks.
      toolRigSetGripAnchor: (id, next) => (
        toolRigs[id]?.setGripAnchorOverride ? toolRigs[id].setGripAnchorOverride(next) : null
      ),
      toolRigIds: () => Object.keys(toolRigs),
      // Dirt sense: the held-key reveal's own state, plus what the crosshair is
      // currently over. Both are what the acceptance driver reads.
      dirtSense: () => ({
        key: boundWalkKey('dirtSense'),
        alpha: +dirtSenseAlpha.toFixed(3),
        held: heldAction('dirtSense'),
        linger: +dirtSenseLinger.toFixed(2),
        aimed: dirtSenseAimed
          ? { kind: dirtSenseAimed.kind || 'grit', dist: +dirtSenseAimed.dist.toFixed(2) }
          : null,
        aim: dirtSenseAim.live
          ? {
            x: +dirtSenseAim.x.toFixed(2),
            z: +dirtSenseAim.z.toFixed(2),
            dist: +dirtSenseAim.dist.toFixed(2),
            eyeY: +dirtSenseAim.eyeY.toFixed(2),
          }
          : null,
        tool: walkTool,
        overlay: clubhouseApi?.dirtSenseDiagnostics?.() || null,
      }),
      // The rig renders through its own lens (BROOM_FEEL.camera), so any QA
      // that measures where a part lands ON SCREEN must project through this
      // camera, not the world one.
      broomViewmodelCamera: () => broomVm.vmCamera,
      // ...and there is one rig PER STICK TOOL, each with its own lens. Asking
      // the broom's camera where the dustpan landed projects through a lens
      // that did not draw it, which is how a tool with no dustpan in frame
      // measured 6.1% of screen and ranked mid-table. This returns the lens
      // that actually rendered `id`, or the world camera when no rig owns it.
      toolDrawCamera: (id) => (toolRigs[id]?.isActive() ? toolRigs[id].vmCamera : camera),
      clearKeys: walkBlur, // a mode change drops whatever was held, so you never resume walking into a wall
      unstick: walkUnstick, // the pause menu's manual fallback; returns how it got you out, or null
      isFree: (x, z, r) => walkFreeAt(x, z, r ?? walk.radius), // also what placement validation asks
      focusOn: walkFocusOn,
      clearFocus: walkClearFocus,
      isFocused: () => !!walkFocusPose,
      aimCell: walkAimCell,
      isActive: () => walk.active,
      state: walk, // position/yaw/pitch — also the QA hook
      // F1 read-only QA surface: where the work stations are, and whether one
      // outranks the tool prompt right now — the driver asserts the same
      // predicate the focus scan uses instead of reverse-engineering it.
      stations: () => walkProps.filter((p) => p.station).map((p) => ({ x: p.x, z: p.z, r: p.r })),
      stationInReach: () => {
        const p = walkStationPropInReach();
        return p ? { x: p.x, z: p.z, r: p.r } : null;
      },
      cart, // cart state, same purpose
      // read-only for QA. `props` is what the clubhouse and the facilities
      // register into — the list that decides whether a doorway is walkable, and
      // the one a clearway audit has to read.
      colliders: { trees: treeColliders, structures: structColliders, props: propColliders },
    },
    dispose,
  };
}

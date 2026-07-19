import * as THREE from 'three';

import {
  DOOR_BACK,
  DOOR_MAIN,
  DOOR_STOCK,
  INTERIOR,
  PARTITIONS,
  SHELL,
  STOCKROOM,
  WINDOW_DIM,
} from '../../data/shopLayout.js';
import {
  SHEET06_GROUP_FLOOR_Y,
  SHEET06_WINDOW_DATUMS,
  createSheet06ClubhouseAdapter,
} from './sheet06ClubhouseAdapter.js';
import { createSheet06ProductionAssembly } from './sheet06ProductionAssembly.js';
import { METERS_TO_YARDS } from './units.js';

const ASSET_NUMBERS = Object.freeze([51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
const KIT_NUMBERS = Object.freeze([55, 56, 57, 58, 59, 60]);
// Asset 51's structural foundation and Asset 59's finish skin otherwise land
// on the exact same depth plane. Keep the render-only finish just under 2 mm
// proud of the analytic walk plane; collision and saved placement coordinates
// remain owned by the unchanged layout plane.
export const SHEET06_FLOOR_VISUAL_CLEARANCE_YD = 0.002;

const ASSET_51_SUPPRESSIONS = Object.freeze([
  'MESH_MainDoor_CreamCasing',
  'MESH_WindowMid_CreamCasing',
  'MESH_WindowWest_CreamCasing',
]);

const ASSET_52_SUPPRESSIONS = Object.freeze([
  'MESH_AlignedFrontWeatherSkin',
  'MESH_AlignedBackWeatherSkin',
  'MESH_AlignedEastWeatherSkin',
  'MESH_AlignedWestWeatherSkin',
  'MESH_FoundationDampBandFront',
  'MESH_FoundationDampBandBack',
]);

const FALLBACK_BINDINGS = Object.freeze([
  Object.freeze({ assetNumber: 51, keys: Object.freeze(['exteriorShellStructure']) }),
  Object.freeze({ assetNumber: 54, keys: Object.freeze(['porchVisuals']) }),
  Object.freeze({ assetNumber: 55, keys: Object.freeze(['windowVisuals', 'apertureTrim']) }),
  Object.freeze({ assetNumber: 56, keys: Object.freeze(['wainscotPanels']) }),
  Object.freeze({ assetNumber: 57, keys: Object.freeze(['interiorTrim']) }),
  Object.freeze({ assetNumber: 58, keys: Object.freeze(['ceilingVisuals']) }),
  Object.freeze({ assetNumber: 59, keys: Object.freeze(['renovatedFloor']) }),
]);

class Sheet06ProductionRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Sheet06ProductionRuntimeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new Sheet06ProductionRuntimeError(code, message);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function visibleOf(handle) {
  if (typeof handle?.getVisible === 'function') return Boolean(handle.getVisible());
  if (typeof handle?.visible === 'boolean') return handle.visible;
  fail('FALLBACK_MALFORMED', 'A Sheet-6 fallback must expose visible or getVisible().');
}

function setVisible(handle, visible) {
  if (typeof handle?.setVisible === 'function') {
    handle.setVisible(Boolean(visible));
    return;
  }
  if (handle && 'visible' in handle) {
    handle.visible = Boolean(visible);
    return;
  }
  fail('FALLBACK_MALFORMED', 'A Sheet-6 fallback must expose visible or setVisible().');
}

/**
 * Creates one exact-state visibility lease over one or more fallback facades.
 * Node-backed facades retain every mixed child visibility bit. Opaque handles
 * retain their aggregate boolean. Repeated hide/restore calls are idempotent.
 */
export function createCompositeVisibilityHandle(name, sourceHandles) {
  const handles = Object.freeze([...(sourceHandles || [])].filter(Boolean));
  if (handles.length === 0) fail('FALLBACK_MISSING', `${name} has no fallback handles.`);
  const nodeBacked = handles.filter((handle) => Array.isArray(handle.nodes));
  const nodes = Object.freeze([...new Set(nodeBacked.flatMap((handle) => handle.nodes))]);
  const opaque = handles.filter((handle) => !Array.isArray(handle.nodes));
  let snapshot = null;

  function getVisible() {
    return nodes.some((node) => node.visible !== false)
      || opaque.some((handle) => visibleOf(handle));
  }

  function restoreSnapshot(value) {
    for (const entry of value?.nodes || []) entry.node.visible = entry.visible;
    for (const entry of value?.opaque || []) setVisible(entry.handle, entry.visible);
  }

  function setCompositeVisible(nextVisible) {
    if (!nextVisible) {
      if (snapshot !== null) return false;
      const nextSnapshot = {
        nodes: nodes.map((node) => ({ node, visible: node.visible })),
        opaque: opaque.map((handle) => ({ handle, visible: visibleOf(handle) })),
      };
      try {
        for (const node of nodes) node.visible = false;
        for (const handle of opaque) setVisible(handle, false);
        snapshot = nextSnapshot;
      } catch (error) {
        restoreSnapshot(nextSnapshot);
        throw error;
      }
      return false;
    }
    if (snapshot !== null) {
      const restoring = snapshot;
      snapshot = null;
      restoreSnapshot(restoring);
      return getVisible();
    }
    return getVisible();
  }

  const handle = {
    name,
    handles,
    nodes,
    nodeCount: nodes.length,
    getVisible,
    setVisible: setCompositeVisible,
    restore() { return setCompositeVisible(true); },
    get hiddenByLease() { return snapshot !== null; },
  };
  Object.defineProperty(handle, 'visible', {
    enumerable: true,
    get: getVisible,
    set: setCompositeVisible,
  });
  return Object.freeze(handle);
}

function gap(center, width, margin = 0.035) {
  return Object.freeze([center - width / 2 - margin, center + width / 2 + margin]);
}

function subtractGaps(from, to, gaps) {
  const spans = [];
  let cursor = from;
  for (const [rawStart, rawEnd] of [...gaps].sort((a, b) => a[0] - b[0])) {
    const start = Math.max(from, rawStart);
    const end = Math.min(to, rawEnd);
    if (end <= cursor) continue;
    if (start > cursor) spans.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < to) spans.push([cursor, to]);
  return spans.filter(([start, end]) => end - start > 1e-6);
}

function runsForLine(line, gaps, variant, y, purpose) {
  return subtractGaps(line.from, line.to, gaps).map(([start, end], index) => {
    const startPoint = line.axis === 'x'
      ? { x: start, y, z: line.at }
      : { x: line.at, y, z: start };
    const endPoint = line.axis === 'x'
      ? { x: end, y, z: line.at }
      : { x: line.at, y, z: end };
    return Object.freeze({
      id: `${purpose}-${line.id}-${index}`,
      start: Object.freeze(startPoint),
      end: Object.freeze(endPoint),
      rotationY: line.rotationY,
      variant,
    });
  });
}

function perimeterAndPartitionLines() {
  const halfW = INTERIOR.w / 2;
  const halfD = INTERIOR.d / 2;
  const partitionX = PARTITIONS.find((partition) => partition.axis === 'x')?.at ?? STOCKROOM.bounds.minX;
  const partitionZ = PARTITIONS.find((partition) => partition.axis === 'z')?.at ?? DOOR_STOCK.z;
  const face = SHELL.wallT / 2 + 0.012;
  const windowGaps = (wall) => SHEET06_WINDOW_DATUMS
    .filter((datum) => datum.wall === wall)
    .map((datum) => gap(datum.c, WINDOW_DIM.w));
  return [
    // Asset 56's decorated wainscot face is local +Z. Keep the run direction
    // stable for deterministic segmentation, but specify which side owns the
    // room-facing finish explicitly. Deriving rotation only from the ascending
    // start/end points turns the south/west and one face of each partition
    // outward, exposing the warm-cream backing over the walnut panels.
    { id: 'south', axis: 'x', at: halfD, from: -halfW, to: halfW, rotationY: Math.PI, doors: [gap(DOOR_MAIN.x, DOOR_MAIN.w)], windows: windowGaps('S') },
    { id: 'north', axis: 'x', at: -halfD, from: -halfW, to: halfW, rotationY: 0, doors: [], windows: windowGaps('N') },
    { id: 'west', axis: 'z', at: -halfW, from: -halfD, to: halfD, rotationY: Math.PI / 2, doors: [], windows: windowGaps('W') },
    { id: 'east', axis: 'z', at: halfW, from: -halfD, to: halfD, rotationY: -Math.PI / 2, doors: [gap(DOOR_BACK.z, DOOR_BACK.w)], windows: windowGaps('E') },
    { id: 'partition-a-west', axis: 'z', at: partitionX - face, from: -halfD, to: partitionZ, rotationY: -Math.PI / 2, doors: [], windows: [] },
    { id: 'partition-a-east', axis: 'z', at: partitionX + face, from: -halfD, to: partitionZ, rotationY: Math.PI / 2, doors: [], windows: [] },
    { id: 'partition-b-north', axis: 'x', at: partitionZ - face, from: partitionX, to: halfW, rotationY: Math.PI, doors: [gap(DOOR_STOCK.x, DOOR_STOCK.w)], windows: [] },
    { id: 'partition-b-south', axis: 'x', at: partitionZ + face, from: partitionX, to: halfW, rotationY: 0, doors: [gap(DOOR_STOCK.x, DOOR_STOCK.w)], windows: [] },
  ];
}

/** Exact, deterministic building-local production layout for Assets 55-60. */
export function createSheet06ProductionLayout() {
  const lines = perimeterAndPartitionLines();
  const panels = lines.flatMap((line) => runsForLine(
    line,
    [...line.doors, ...line.windows],
    'straight',
    0,
    'panel',
  ));
  const baseboards = lines.flatMap((line) => runsForLine(line, line.doors, 'baseboard', 0, 'baseboard'));
  const panelTop = 1.15 * METERS_TO_YARDS;
  const chairRailY = panelTop - 0.121 * METERS_TO_YARDS;
  const chairRails = lines.flatMap((line) => runsForLine(
    line,
    [...line.doors, ...line.windows],
    'chair_rail',
    chairRailY,
    'chair-rail',
  ));
  const crownY = SHELL.h - 0.14 * METERS_TO_YARDS;
  const crowns = lines.flatMap((line) => runsForLine(line, [], 'crown', crownY, 'crown'));
  const halfW = INTERIOR.w / 2;
  const halfD = INTERIOR.d / 2;
  const beamY = SHELL.h - 0.24 * METERS_TO_YARDS;
  const panelY = SHELL.h - 0.08 * METERS_TO_YARDS;
  const lightY = SHELL.h - 0.045 * METERS_TO_YARDS;
  // A three-by-three beam rhythm follows the Sheet-6 coffer reference without
  // turning the retail ceiling into a dense glossy lattice. One quiet cream
  // carrier spans beneath that rhythm: the source explicitly permits
  // perpendicular runtime scaling, and keeping it whole prevents broad tonal
  // bands and beveled module ends from showing across the room. The exact
  // 3.60 x 0.20 x 0.24 m source contract stays untouched.
  const cofferX = [-5.25, 0, 5.25];
  const cofferZ = [-3.4, 0, 3.4];
  const beamRuns = [
    ...cofferZ.map((z, index) => ({ id: `coffer-x-${index}`, start: { x: -halfW, y: beamY, z }, end: { x: halfW, y: beamY, z }, variant: 'straight', singleModule: true })),
    ...cofferX.map((x, index) => ({ id: `coffer-z-${index}`, start: { x, y: beamY, z: -halfD }, end: { x, y: beamY, z: halfD }, variant: 'straight', singleModule: true })),
  ];
  const panelDepthMeters = 0.20;
  const ceilingPanelRuns = [{
    id: 'ceiling-panel-continuous-field',
    start: { x: -halfW, y: panelY, z: 0 },
    end: { x: halfW, y: panelY, z: 0 },
    variant: 'ceiling_panel',
    scaleAcross: (halfD * 2) / (panelDepthMeters * METERS_TO_YARDS),
    singleModule: true,
  }];
  const lightPositions = [
    [-7.9, -5.05], [-7.9, 1.7],
    [-2.6, -1.7], [-2.6, 5.05],
    [2.6, -5.05], [2.6, 1.7],
    [7.9, -1.7], [7.9, 5.05],
  ];
  const wallCenterX = SHELL.w / 2 - SHELL.wallT / 2;
  const wallCenterZ = SHELL.d / 2 - SHELL.wallT / 2;
  // Asset 59 is an 18 mm finish layer. Its top is visually separated from the
  // coplanar Asset-51 foundation while staying within 2 mm of the established
  // analytic walk plane, so there is no depth fighting or navigation change.
  const floorY = -0.018 * METERS_TO_YARDS + SHEET06_FLOOR_VISUAL_CLEARANCE_YD;
  const windowDatums = SHEET06_WINDOW_DATUMS.map((datum) => ({
    ...datum,
    sill: WINDOW_DIM.sill,
    variant: 'standard',
  }));

  return deepFreeze({
    coordinateSpace: 'CLUBHOUSE_BUILDING_LOCAL_YARDS',
    exteriorFloorY: SHEET06_GROUP_FLOOR_Y,
    interiorFloorY: 0,
    floorY,
    ceilingY: beamY,
    windowSill: WINDOW_DIM.sill,
    windowWallOffset: 0,
    windowDatums,
    shellBounds: { minX: -wallCenterX, maxX: wallCenterX, minZ: -wallCenterZ, maxZ: wallCenterZ },
    interiorBounds: { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD },
    stockroomBounds: { ...STOCKROOM.bounds },
    wallPanelRuns: panels,
    trimRuns: [...baseboards, ...chairRails, ...crowns],
    beamRuns,
    ceilingPanelRuns,
    beamPlacements: lightPositions.map(([x, z], index) => ({
      id: `light-mount-${index}`,
      position: [x, lightY, z],
      rotationY: 0,
      variant: 'light_mount',
    })),
    damageSites: [
      { id: 'damage-west-north', x: -8.35, z: -4.75, rotationY: 0 },
      // Asset 59 installs every wood plank on the same local Y grain axis.
      // Damage may flip 180 degrees for variation, but quarter turns make a
      // lifted board cross intact planks and read as loose debris.
      { id: 'damage-west-entry', x: -4.15, z: 2.05, rotationY: Math.PI },
      { id: 'damage-center', x: -0.35, z: -2.45, rotationY: 0 },
      // Keep the repair site in the visible lounge-approach aisle. The former
      // z=-4.55 point overlapped the live 1.1 x 1.1 coffee-table collider.
      { id: 'damage-lounge', x: 3.65, z: -3.45, rotationY: Math.PI },
      { id: 'damage-office', x: 8.15, z: 4.45, rotationY: 0 },
    ],
  });
}

function traverse(root, visitor) {
  root?.traverse?.(visitor);
}

function requiredNamedNodes(root, names, assetNumber) {
  const records = [];
  for (const name of names) {
    const matches = [];
    traverse(root, (node) => { if (node?.name === name) matches.push(node); });
    if (matches.length === 0) fail('SUPPRESSION_TARGET_MISSING', `Asset ${assetNumber} is missing ${name}.`);
    for (const node of matches) records.push({ node, visible: node.visible });
  }
  return records;
}

function restoreNodeRecords(records) {
  for (const record of records) record.node.visible = record.visible;
}

function normalizedError(error) {
  return Object.freeze({
    code: String(error?.code || 'ACTIVATION_FAILED'),
    message: String(error?.message || 'Unknown Sheet-6 production activation failure.'),
  });
}

function validateMount(root, label) {
  if (!root || typeof root.add !== 'function' || typeof root.remove !== 'function') {
    throw new TypeError(`${label} must be a Three.js Object3D mount.`);
  }
}

/**
 * Coordinates the direct Sheet-6 GLBs, the six modular production assemblies,
 * the analytic double-door controller, and the procedural visual fallbacks.
 */
export function createSheet06ProductionRuntime({
  group,
  interior,
  state = null,
  shellFallbacks = null,
  doorApi = null,
  navigationApi = null,
  adapterFactory = createSheet06ClubhouseAdapter,
  assemblyFactory = createSheet06ProductionAssembly,
  adapterOptions = {},
  assemblyOptions = {},
} = {}) {
  validateMount(group, 'group');
  validateMount(interior, 'interior');
  if (typeof adapterFactory !== 'function') throw new TypeError('adapterFactory must be a function.');
  if (typeof assemblyFactory !== 'function') throw new TypeError('assemblyFactory must be a function.');

  const exteriorStaging = new THREE.Group();
  exteriorStaging.name = 'SHEET06_PRODUCTION_EXTERIOR_STAGING';
  exteriorStaging.visible = false;
  const interiorStaging = new THREE.Group();
  interiorStaging.name = 'SHEET06_PRODUCTION_INTERIOR_STAGING';
  interiorStaging.visible = false;
  const exteriorLive = new THREE.Group();
  exteriorLive.name = 'SHEET06_PRODUCTION_EXTERIOR_LIVE';
  exteriorLive.visible = false;
  const interiorLive = new THREE.Group();
  interiorLive.name = 'SHEET06_PRODUCTION_INTERIOR_LIVE';
  interiorLive.visible = false;
  group.add(exteriorStaging, exteriorLive);
  interior.add(interiorStaging, interiorLive);

  const layout = createSheet06ProductionLayout();
  let disposed = false;
  let active = false;
  let activationStatus = 'loading';
  let activationError = null;
  let assembly = null;
  let doorBound = false;
  let navigationBound = false;
  let suppressionRecords = [];
  let templateRecords = [];
  let fallbackLeases = [];
  let interiorShadowMeshCount = 0;
  let stateApplications = 0;
  let currentState = state;

  let adapter;
  try {
    adapter = adapterFactory({
      ...adapterOptions,
      group: exteriorStaging,
      interior: interiorStaging,
      state,
      fallbacks: {},
    });
    if (!adapter || typeof adapter !== 'object') {
      throw new TypeError('adapterFactory must return a lifecycle object.');
    }
  } catch (error) {
    group.remove(exteriorStaging, exteriorLive);
    interior.remove(interiorStaging, interiorLive);
    throw error;
  }

  function shellRegistry() {
    return shellFallbacks?.productionVisualFallbacks || shellFallbacks || {};
  }

  function createFallbackLeases() {
    const registry = shellRegistry();
    return FALLBACK_BINDINGS.map(({ assetNumber, keys }) => {
      const handles = keys.map((key) => {
        const handle = registry?.[key];
        if (!handle) fail('FALLBACK_MISSING', `Asset ${assetNumber} requires shell fallback '${key}'.`);
        return handle;
      });
      return {
        assetNumber,
        keys,
        handle: createCompositeVisibilityHandle(`sheet06-asset-${assetNumber}`, handles),
      };
    });
  }

  function hideFallbacksAtomically() {
    const leases = createFallbackLeases();
    const hidden = [];
    try {
      for (const lease of leases) {
        lease.handle.setVisible(false);
        hidden.push(lease);
      }
    } catch (error) {
      for (const lease of hidden.reverse()) lease.handle.restore();
      throw error;
    }
    fallbackLeases = leases;
  }

  function restoreFallbacks() {
    for (const lease of [...fallbackLeases].reverse()) {
      try { lease.handle.restore(); } catch { /* preserve teardown of remaining leases */ }
    }
    fallbackLeases = [];
  }

  function normalizeInteriorShadows() {
    let count = 0;
    for (const root of [interiorStaging, interiorLive]) {
      traverse(root, (node) => {
        if (node?.isMesh && node.geometry && node.material) {
          node.castShadow = false;
          count += 1;
        }
      });
      root.updateMatrixWorld?.(true);
    }
    interiorShadowMeshCount = count;
  }

  function unbindDoor() {
    if (!doorBound) return;
    try { doorApi?.unbindMainEntranceVisual?.({ restoreFallback: true }); } catch { /* continue teardown */ }
    doorBound = false;
  }

  function unbindNavigation() {
    if (!navigationBound) return;
    try { navigationApi?.deactivate?.(); } catch { /* continue teardown */ }
    navigationBound = false;
  }

  function rollbackActivation() {
    exteriorStaging.visible = false;
    interiorStaging.visible = false;
    exteriorLive.visible = false;
    interiorLive.visible = false;
    restoreFallbacks();
    unbindNavigation();
    unbindDoor();
    restoreNodeRecords(templateRecords);
    templateRecords = [];
    restoreNodeRecords(suppressionRecords);
    suppressionRecords = [];
    assembly?.dispose?.();
  }

  function assemblyIsComplete(value) {
    const diagnostics = value?.diagnostics?.();
    const byNumber = new Map((diagnostics?.kits || []).map((kit) => [Number(kit.assetNumber), kit]));
    return KIT_NUMBERS.every((number) => byNumber.get(number)?.status === 'assembled');
  }

  function reassertDoorControllerState(nextState) {
    const sync = doorApi?.syncMainEntranceFromState?.(nextState) ?? null;
    const rebound = doorApi?.bindMainEntranceVisual?.(adapter.getRoot?.(53));
    if (!rebound?.ok) fail('DOOR_BIND_FAILED', `Asset 53 door binding failed: ${rebound?.reason || 'unknown'}.`);
    doorBound = true;
    return Object.freeze({ sync, bind: rebound });
  }

  async function activate() {
    try {
      await (adapter.ready || Promise.resolve());
      if (disposed) return diagnostics();
      const roots = new Map();
      for (const number of ASSET_NUMBERS) {
        const root = adapter.getRoot?.(number);
        if (!root) fail('ASSET_ROOT_MISSING', `Sheet-6 Asset ${number} did not load a validated root.`);
        roots.set(number, root);
      }

      assembly = assemblyFactory({
        ...assemblyOptions,
        templates: adapter,
        exterior: exteriorLive,
        interior: interiorLive,
        windowDatums: layout.windowDatums,
        layout,
        state: currentState,
        fallbacks: {},
      });
      if (!assembly || typeof assembly !== 'object' || !assemblyIsComplete(assembly)) {
        fail('ASSEMBLY_INCOMPLETE', 'Assets 55-60 did not all report assembled.');
      }

      const nextSuppressions = [
        ...requiredNamedNodes(roots.get(51), ASSET_51_SUPPRESSIONS, 51),
        ...requiredNamedNodes(roots.get(52), ASSET_52_SUPPRESSIONS, 52),
      ];
      for (const record of nextSuppressions) record.node.visible = false;
      suppressionRecords = nextSuppressions;

      templateRecords = KIT_NUMBERS.map((number) => ({
        node: roots.get(number),
        visible: roots.get(number).visible,
      }));
      for (const record of templateRecords) record.node.visible = false;

      if (typeof doorApi?.bindMainEntranceVisual !== 'function') {
        fail('DOOR_API_MISSING', 'Sheet-6 production activation requires bindMainEntranceVisual().');
      }
      const bound = doorApi.bindMainEntranceVisual(roots.get(53));
      if (!bound?.ok) fail('DOOR_BIND_FAILED', `Asset 53 door binding failed: ${bound?.reason || 'unknown'}.`);
      doorBound = true;
      doorApi.syncMainEntranceFromState?.(currentState);
      // The adapter writes saved target angles; the analytic controller owns the
      // live angles. Rebinding is idempotent and immediately reasserts its pose.
      const rebound = doorApi.bindMainEntranceVisual(roots.get(53));
      if (!rebound?.ok) fail('DOOR_BIND_FAILED', 'Asset 53 controller pose reassertion failed.');

      normalizeInteriorShadows();
      hideFallbacksAtomically();
      if (navigationApi) {
        if (typeof navigationApi.activate !== 'function') {
          fail('NAVIGATION_API_MISSING', 'Sheet-6 analytic navigation requires activate().');
        }
        const navigation = navigationApi.activate();
        navigationBound = navigation?.active === true;
        if (navigation?.active !== true || navigation?.railColliderCount !== 2
          || navigation?.glbCollisionObjectsActivated !== 0) {
          fail('NAVIGATION_BIND_FAILED', 'Asset 54 analytic rail blockers did not activate exactly.');
        }
      }

      // No await or callback exists inside this final switch, so one render can
      // never observe a mixture of production roots and procedural fallbacks.
      exteriorStaging.visible = true;
      interiorStaging.visible = true;
      exteriorLive.visible = true;
      interiorLive.visible = true;
      active = true;
      activationStatus = 'active';
      activationError = null;
    } catch (error) {
      active = false;
      activationStatus = disposed ? 'disposed' : 'fallback';
      activationError = normalizedError(error);
      rollbackActivation();
    }
    return diagnostics();
  }

  const ready = activate();

  function diagnostics() {
    const adapterDiagnostics = adapter.diagnostics?.() || null;
    const assemblyDiagnostics = assembly?.diagnostics?.() || null;
    const loadedAssetCount = ASSET_NUMBERS.filter((number) => adapter.getRoot?.(number)).length;
    const assembledKitCount = (assemblyDiagnostics?.kits || [])
      .filter((kit) => kit.status === 'assembled' && KIT_NUMBERS.includes(Number(kit.assetNumber))).length;
    return Object.freeze({
      lifecycle: disposed ? 'disposed' : activationStatus,
      activationStatus: disposed ? 'disposed' : activationStatus,
      activationError,
      actualSharedGameIntegrated: active && !disposed,
      loadedAssetCount,
      assembledKitCount,
      glbCollisionObjectsActivated: assemblyDiagnostics?.glbCollisionObjectsActivated ?? null,
      stateApplications,
      suppressionCount: suppressionRecords.length,
      hiddenTemplateCount: templateRecords.filter((record) => record.node.visible === false).length,
      hiddenFallbackCount: fallbackLeases.filter((lease) => lease.handle.hiddenByLease).length,
      interiorShadowMeshCount,
      staging: Object.freeze({
        exteriorVisible: exteriorStaging.visible,
        interiorVisible: interiorStaging.visible,
        exteriorLiveVisible: exteriorLive.visible,
        interiorLiveVisible: interiorLive.visible,
      }),
      layout: Object.freeze({
        windowCount: layout.windowDatums.length,
        wallPanelRunCount: layout.wallPanelRuns.length,
        trimRunCount: layout.trimRuns.length,
        beamRunCount: layout.beamRuns.length,
        ceilingPanelRunCount: layout.ceilingPanelRuns.length,
        lightMountCount: layout.beamPlacements.length,
        damageSiteCount: layout.damageSites.length,
      }),
      adapter: adapterDiagnostics,
      assembly: assemblyDiagnostics,
      door: doorApi?.mainEntranceDiagnostics?.() || null,
      navigation: navigationApi?.diagnostics?.() || null,
    });
  }

  function update(deltaSeconds) {
    if (disposed) return Object.freeze({ disposed: true, adapter: 0, assembly: 0 });
    return Object.freeze({
      disposed: false,
      adapter: adapter.update?.(deltaSeconds) ?? 0,
      assembly: assembly?.update?.(deltaSeconds) ?? 0,
    });
  }

  async function applyState(nextState) {
    if (disposed) return Object.freeze({ disposed: true, active: false });
    currentState = nextState;
    await ready;
    if (disposed) return Object.freeze({ disposed: true, active: false });
    stateApplications += 1;
    const adapterResult = await (adapter.applyState?.(nextState) ?? null);
    const assemblyResult = await (assembly?.applyState?.(nextState) ?? null);
    let doorResult = null;
    if (doorBound) {
      try {
        doorResult = reassertDoorControllerState(nextState);
      } catch (error) {
        activationError = normalizedError(error);
        active = false;
        activationStatus = 'fallback';
        rollbackActivation();
      }
    }
    normalizeInteriorShadows();
    return Object.freeze({
      disposed: false,
      active,
      adapter: adapterResult,
      assembly: assemblyResult,
      door: doorResult,
    });
  }

  function dispose() {
    if (disposed) return Object.freeze({ alreadyDisposed: true, disposedResources: 0 });
    disposed = true;
    active = false;
    activationStatus = 'disposed';
    // Order is deliberate: derived roots borrow cache resources, the door owns
    // live pivots, and only then may the adapter release its cache instances.
    const assemblyResult = assembly?.dispose?.() || null;
    unbindDoor();
    unbindNavigation();
    const adapterResult = adapter.dispose?.() || null;
    restoreNodeRecords(templateRecords);
    restoreNodeRecords(suppressionRecords);
    templateRecords = [];
    suppressionRecords = [];
    restoreFallbacks();
    exteriorStaging.visible = false;
    interiorStaging.visible = false;
    exteriorLive.visible = false;
    interiorLive.visible = false;
    group.remove(exteriorStaging, exteriorLive);
    interior.remove(interiorStaging, interiorLive);
    return Object.freeze({
      alreadyDisposed: false,
      disposedResources: 0,
      assembly: assemblyResult,
      adapter: adapterResult,
    });
  }

  return Object.freeze({
    ready,
    layout,
    mounts: Object.freeze({ exteriorStaging, interiorStaging, exteriorLive, interiorLive }),
    getRoot: (number) => (disposed ? null : adapter.getRoot?.(number) || null),
    getAssemblyRoot: (number) => (disposed ? null : assembly?.getRoot?.(number) || null),
    borrowedResources: () => adapter.borrowedResources?.() || null,
    diagnostics,
    update,
    applyState,
    dispose,
  });
}

export default createSheet06ProductionRuntime;

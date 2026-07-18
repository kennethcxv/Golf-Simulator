import {
  DOOR_MAIN, SHELL, WINDOWS,
} from '../../data/shopLayout.js';
import {
  ARCHITECTURE_DEFAULTS,
  ARCHITECTURE_FINISH_OPTIONS,
  MAIN_DOOR_STATES,
} from '../../sim/clubhouseRestoration.js';
import {
  SHEET06_RUNTIME_ASSETS,
  createSheet06Architecture,
} from './sheet06Architecture.js';

// Current clubhouse coordinates are building-local yards. The always-visible
// `group` root sits on grade, its finished floor is +0.3 Y, and `interior` sits
// directly on that floor (local Y zero). Three.js +Z is the south/front side.
export const SHEET06_GROUP_FLOOR_Y = 0.3;
export const SHEET06_INTERIOR_FLOOR_Y = 0;
export const SHEET06_TEMPLATE_STORAGE_Y = -256;

const CANONICAL_PORCH_SOCKET_X = -1;
const DOOR_OPEN_RADIANS = 100 * Math.PI / 180;
const KIT_ASSET_NUMBERS = Object.freeze([55, 56, 57, 58, 59, 60]);
const KIT_ASSET_SET = new Set(KIT_ASSET_NUMBERS);

const freezeRecord = (value) => Object.freeze({ ...value });

function stableWindowId(window, index) {
  const coordinate = String(window.c).replace('-', 'm').replace('.', 'p');
  return `clubhouse-window-${index}-${String(window.wall).toLowerCase()}-${coordinate}`;
}

export const SHEET06_WINDOW_DATUMS = Object.freeze(WINDOWS.map((window, index) => Object.freeze({
  id: stableWindowId(window, index),
  index,
  wall: window.wall,
  c: window.c,
})));

export const SHEET06_KIT_INSTANTIATION_POLICY = Object.freeze({
  55: 'WINDOW_TEMPLATE_ONLY_STABLE_DATUM_INSTANCES_REQUIRED',
  56: 'PANEL_TEMPLATE_ONLY_LAYOUT_ASSEMBLY_REQUIRED',
  57: 'TRIM_TEMPLATE_ONLY_LAYOUT_ASSEMBLY_REQUIRED',
  58: 'CEILING_TEMPLATE_ONLY_LAYOUT_ASSEMBLY_REQUIRED',
  59: 'FLOOR_FINISH_TEMPLATE_ONLY_CANONICAL_WALK_PLANE_REQUIRED',
  60: 'FLOOR_DAMAGE_TEMPLATE_ONLY_ASSET_059_ALIGNMENT_REQUIRED',
});

function assetNumberOf(binding) {
  return Number(binding?.number ?? binding?.assetNumber);
}

function mountNameOf(binding) {
  return binding?.mount?.root || binding?.sourceBinding?.mount?.root;
}

function rootUserData(root) {
  if (!root.userData || typeof root.userData !== 'object') root.userData = {};
  return root.userData;
}

function templateStoragePosition(number) {
  // Spread parked templates as well as lowering them. That keeps authoring
  // previews legible in a scene inspector without placing any sample module in
  // the player/customer route or stacking the six template bounds together.
  return [(number - 57.5) * 4, SHEET06_TEMPLATE_STORAGE_Y, -32];
}

export function resolveSheet06Placement(binding) {
  const number = assetNumberOf(binding);
  const mountRoot = mountNameOf(binding);
  let position;
  let datum;
  let policy = 'DIRECT_ARCHITECTURE_INSTANCE';

  switch (number) {
    case 51:
    case 52:
      // The canonical structure and its additive damage overlay are authored
      // against one registered origin. Moving either independently is invalid.
      position = [0, 0, 0];
      datum = number === 51 ? 'GROUP_GRADE_ORIGIN' : 'ASSET_051_IDENTICAL_ORIGIN';
      break;
    case 53:
      position = [
        DOOR_MAIN.x,
        SHEET06_GROUP_FLOOR_Y,
        SHELL.d / 2,
      ];
      datum = 'MAIN_ENTRANCE_THRESHOLD_CENTER';
      break;
    case 54: {
      const runtimeScale = Number(binding?.runtimeScale);
      if (!Number.isFinite(runtimeScale) || runtimeScale <= 0) {
        throw new RangeError('Asset 54 requires its positive cache-owned runtime scale.');
      }
      // Asset 51 SOCKET_Porch is (-1 yd, floor, south wall). Asset 54's revised
      // SOCKET_MainEntrance/deck top is authored at FLOOR_Z (0.27432 m), which
      // becomes exactly 0.3 yd under the cache-owned conversion. Its root stays
      // on grade, aligning the markers without any placement scale or offset.
      // This exact layout value is also the load-order-safe socket fallback when
      // asset 54 happens to settle before asset 51.
      position = [
        CANONICAL_PORCH_SOCKET_X,
        0,
        SHELL.d / 2,
      ];
      datum = 'ASSET_051_SOCKET_Porch_LAYOUT_FALLBACK';
      break;
    }
    default:
      if (!KIT_ASSET_SET.has(number)) throw new RangeError(`Unknown Sheet-6 asset ${number}.`);
      position = templateStoragePosition(number);
      datum = 'PARKED_TEMPLATE_LIBRARY';
      policy = SHEET06_KIT_INSTANTIATION_POLICY[number];
  }

  return Object.freeze({
    assetNumber: number,
    mountRoot,
    position: Object.freeze(position),
    datum,
    policy,
    scaleApplications: 0,
  });
}

export function createSheet06PlacementResolver({ onPlacement = null } = {}) {
  return ({ binding, root, mount }) => {
    const placement = resolveSheet06Placement(binding);
    const userData = rootUserData(root);
    userData.sheet06PlacementDatum = placement.datum;
    userData.sheet06PlacementPolicy = placement.policy;
    userData.sheet06DirectArchitectureInstance = !KIT_ASSET_SET.has(placement.assetNumber);
    userData.sheet06TemplateOnly = KIT_ASSET_SET.has(placement.assetNumber);
    if (typeof onPlacement === 'function') onPlacement(placement);
    // Deliberately no `scale` member: the cache is the one and only place where
    // the meters-to-yards conversion may occur.
    return { parent: mount, position: [...placement.position] };
  };
}

function validFinish(component, finish) {
  return ARCHITECTURE_FINISH_OPTIONS[component]?.includes(finish);
}

function architectureSnapshot(state) {
  const source = state?.shop?.reno?.architecture;
  const components = {};
  for (const [component, defaults] of Object.entries(ARCHITECTURE_DEFAULTS.components)) {
    const candidate = source?.components?.[component];
    components[component] = Object.freeze({
      restored: typeof candidate?.restored === 'boolean' ? candidate.restored : defaults.restored,
      finish: validFinish(component, candidate?.finish) ? candidate.finish : defaults.finish,
    });
  }
  const main = source?.doors?.main;
  const doorState = (leaf) => (
    MAIN_DOOR_STATES.includes(main?.[leaf]) ? main[leaf] : ARCHITECTURE_DEFAULTS.doors.main[leaf]
  );
  return Object.freeze({
    components: Object.freeze(components),
    doors: Object.freeze({
      main: Object.freeze({ left: doorState('left'), right: doorState('right') }),
    }),
  });
}

export function readSheet06ClubhouseState(state) {
  const reno = state?.shop?.reno;
  return Object.freeze({
    architecture: architectureSnapshot(state),
    // These remain references to the pre-existing authoritative cleaning data.
    // The adapter only reads them and never normalizes, replaces, or writes them.
    windowFilm: Array.isArray(reno?.windows) ? reno.windows : null,
    floorGrime: Array.isArray(reno?.grime) ? reno.grime : null,
  });
}

function traverse(root, visitor) {
  if (!root) return;
  if (typeof root.traverse === 'function') {
    root.traverse(visitor);
    return;
  }
  const visit = (object) => {
    visitor(object);
    for (const child of object?.children || []) visit(child);
  };
  visit(root);
}

function nodes(root) {
  const result = [];
  traverse(root, (node) => result.push(node));
  return result;
}

function exportNameMatches(actualName, logicalName) {
  const actual = String(actualName || '');
  return actual === logicalName
    || actual === `MESH_${logicalName}`
    || actual === `EMPTY_${logicalName}`;
}

function findNode(root, name) {
  if (typeof root?.getObjectByName === 'function') {
    const exact = root.getObjectByName(name);
    if (exact) return exact;
  }
  return nodes(root).find((node) => exportNameMatches(node?.name, name)) || null;
}

function setNamedVisibility(root, names, visible) {
  let changed = 0;
  for (const name of names) {
    for (const node of nodes(root).filter((candidate) => exportNameMatches(candidate?.name, name))) {
      if (node.visible === visible) continue;
      node.visible = visible;
      changed += 1;
    }
  }
  return changed;
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function setFinish(root, component, finish, aliases = {}) {
  rootUserData(root).sheet06Finish = finish;
  const selected = slug(finish);
  const candidates = new Set([
    selected,
    slug(aliases[finish]),
  ].filter(Boolean));
  let variants = 0;
  traverse(root, (node) => {
    const declared = node?.userData?.finish_variant ?? node?.userData?.finishVariant;
    const name = String(node?.name || '');
    const namedFinish = /^\s*(?:LOD\d+_)?(?:VARIANT_)?Finish/i.test(name);
    if (declared === undefined && !namedFinish) return;
    const declaredSlug = slug(declared === undefined ? name.replace(/^.*?Finish_?/i, '') : declared);
    const visible = candidates.has(declaredSlug);
    node.visible = visible;
    if (!node.userData || typeof node.userData !== 'object') node.userData = {};
    node.userData.sheet06SelectedFinish = visible;
    variants += 1;
  });
  return variants;
}

function setWindowVariant(root, selectedVariant) {
  const selected = slug(selectedVariant || 'standard');
  let count = 0;
  traverse(root, (node) => {
    const declared = node?.userData?.variant;
    const match = /^LOD\d+_Window(Standard|Narrow|Wide|Arched)$/i.exec(String(node?.name || ''));
    if (declared === undefined && !match) return;
    const candidate = slug(declared ?? match[1]);
    if (!['standard', 'narrow', 'wide', 'arched'].includes(candidate)) return;
    node.visible = candidate === selected;
    count += 1;
  });
  rootUserData(root).sheet06WindowTemplateVariant = selected;
  return count;
}

function windowMetadata(root, stateView, restored, finish) {
  const film = stateView.windowFilm;
  const byId = {};
  for (const datum of SHEET06_WINDOW_DATUMS) {
    byId[datum.id] = Object.freeze({
      broken: !restored,
      film: film?.[datum.index] ?? null,
      finish,
    });
  }
  const finiteFilm = film?.filter?.(Number.isFinite) || [];
  const userData = rootUserData(root);
  userData.sheet06WindowStateById = Object.freeze(byId);
  userData.sheet06WindowFilmAuthority = 'state.shop.reno.windows';
  userData.sheet06WindowFilmAverage = finiteFilm.length
    ? finiteFilm.reduce((sum, value) => sum + value, 0) / finiteFilm.length
    : null;
  userData.sheet06WindowBroken = !restored;
}

function floorCleaningMetadata(root, stateView) {
  const grime = stateView.floorGrime;
  const finite = grime?.filter?.(Number.isFinite) || [];
  const userData = rootUserData(root);
  userData.sheet06FloorGrimeAuthority = 'state.shop.reno.grime';
  userData.sheet06FloorGrimeCellCount = grime?.length ?? 0;
  userData.sheet06FloorGrimeRemaining = finite.length
    ? finite.reduce((sum, value) => sum + value, 0)
    : 0;
}

const COMPONENT_STATE_NODES = Object.freeze({
  54: Object.freeze({
    restored: ['LOD0_PorchRestored', 'PorchRestored'],
    damaged: ['LOD0_PorchDamage', 'PorchDamage'],
  }),
  55: Object.freeze({
    restored: ['LOD0_WindowsRestored', 'WindowsRestored', 'WindowClean'],
    damaged: ['LOD0_WindowsDamaged', 'WindowsDamaged', 'WindowBroken'],
  }),
  56: Object.freeze({
    restored: ['LOD0_PanelsRestored', 'PanelsRestored'],
    damaged: ['LOD0_PanelsDamaged', 'PanelsDamaged', 'PanelDamage'],
  }),
  57: Object.freeze({
    restored: ['LOD0_TrimRestored', 'TrimRestored'],
    damaged: ['LOD0_TrimDamaged', 'TrimDamaged', 'TrimDamage'],
  }),
  58: Object.freeze({
    restored: ['LOD0_CeilingRestored', 'CeilingRestored'],
    damaged: ['LOD0_CeilingDamaged', 'CeilingDamaged', 'CeilingDamage'],
  }),
  59: Object.freeze({
    restored: ['LOD0_FloorRestored', 'FloorRestored'],
    damaged: [],
  }),
  60: Object.freeze({
    restored: [],
    damaged: ['LOD0_FloorDamage', 'FloorDamage'],
  }),
});

function setComponentStateNodes(root, number, restored) {
  const contract = COMPONENT_STATE_NODES[number];
  if (!contract) return 0;
  return setNamedVisibility(root, contract.restored, restored)
    + setNamedVisibility(root, contract.damaged, !restored);
}

function setDoorPivot(pivot, angle, leaf, doorState) {
  if (!pivot) throw new Error(`Asset 53 is missing PIVOT_Door${leaf}.`);
  if (!pivot.rotation || typeof pivot.rotation !== 'object') pivot.rotation = {};
  pivot.rotation.y = angle;
  const userData = rootUserData(pivot);
  userData.sheet06DoorLeaf = leaf.toLowerCase();
  userData.sheet06DoorState = doorState;
  userData.sheet06TargetClip = `Door${leaf}_${doorState === 'open' ? 'Open' : 'Close'}`;
  pivot.matrixWorldNeedsUpdate = true;
  pivot.updateMatrix?.();
}

function applyDoorState(root, architecture) {
  const leftState = architecture.doors.main.left;
  const rightState = architecture.doors.main.right;
  setDoorPivot(
    findNode(root, 'PIVOT_DoorLeft'),
    leftState === 'open' ? DOOR_OPEN_RADIANS : 0,
    'Left',
    leftState,
  );
  setDoorPivot(
    findNode(root, 'PIVOT_DoorRight'),
    rightState === 'open' ? -DOOR_OPEN_RADIANS : 0,
    'Right',
    rightState,
  );
  rootUserData(root).sheet06DoorState = freezeRecord({
    left: leftState,
    right: rightState,
  });
}

const FINISH_ALIASES = Object.freeze({
  shell: Object.freeze({ 'warm-cream': 'WarmCream', 'muted-sage': 'MutedSage' }),
  porch: Object.freeze({ 'natural-oak': 'NaturalOak', 'medium-walnut': 'MediumWalnut' }),
  windows: Object.freeze({ 'deep-golf-green': 'DeepGolfGreen', 'warm-charcoal': 'WarmCharcoal' }),
  panels: Object.freeze({
    'muted-sage': 'MutedSage', 'medium-walnut': 'MediumWalnut', 'warm-cream': 'WarmCream',
  }),
  trim: Object.freeze({
    'warm-cream': 'WarmCream', 'deep-golf-green': 'DeepGolfGreen', 'restrained-brass': 'RestrainedBrass',
  }),
  ceiling: Object.freeze({ 'warm-cream': 'WarmCream', 'natural-oak': 'NaturalOak' }),
});

const FLOOR_FINISH_NODES = Object.freeze({
  'natural-oak': 'FloorOak',
  'medium-walnut': 'FloorWalnut',
  'muted-sage-carpet': 'FloorSageCarpet',
  'warm-cream-tile': 'FloorCreamTile',
});

function setFloorFinish(root, finish) {
  const selected = FLOOR_FINISH_NODES[finish];
  if (!selected) throw new Error(`Unsupported Sheet-6 floor finish ${finish}.`);
  const nodeNames = [
    'FloorOak', 'FloorWalnut', 'FloorDarkWood', 'FloorSageCarpet',
    'FloorGrayCarpet', 'FloorCreamTile', 'FloorStoneTile',
  ];
  for (const name of nodeNames) setNamedVisibility(root, [name], name === selected);
  // Production GLBs also carry a finish_variant property. Honor it so an
  // exporter rename cannot accidentally leave coplanar material carriers on.
  traverse(root, (node) => {
    const declared = node?.userData?.finish_variant ?? node?.userData?.finishVariant;
    if (declared === undefined) return;
    const logicalName = `Floor${String(declared)}`;
    if (!nodeNames.includes(logicalName)) return;
    node.visible = logicalName === selected;
  });
  rootUserData(root).sheet06Finish = finish;
}

/**
 * Applies a read-only view of save state to one mounted Sheet-6 GLB clone.
 * Materials are shared immutable prototype resources, so finishes switch named
 * carriers/variants and metadata; this function never recolors shared material
 * instances and never writes to save data.
 */
export function applySheet06ClubhouseAssetState({
  binding,
  root,
  state,
  selections = {},
} = {}) {
  if (!root) throw new TypeError('Sheet-6 state application requires an asset root.');
  const number = assetNumberOf(binding);
  const stateView = readSheet06ClubhouseState(state);
  const architecture = stateView.architecture;
  const userData = rootUserData(root);
  userData.sheet06AssetNumber = number;
  userData.sheet06StateAuthority = 'state.shop.reno.architecture';

  let component = null;
  switch (number) {
    case 51: {
      component = 'shell';
      const value = architecture.components.shell;
      setNamedVisibility(root, ['LOD0_StructuralShell', 'LOD0_RoofStructure', 'LOD0_ExteriorDetails'], true);
      setFinish(root, component, value.finish, FINISH_ALIASES.shell);
      userData.sheet06StructuralAuthority = true;
      userData.sheet06StructuralRole = 'CANONICAL_STRUCTURAL_AUTHORITY';
      userData.sheet06Restored = value.restored;
      break;
    }
    case 52: {
      const shellDamaged = !architecture.components.shell.restored;
      const trimDamaged = !architecture.components.trim.restored;
      setNamedVisibility(root, ['LOD0_WallDamage', 'LOD0_RoofDamage'], shellDamaged);
      setNamedVisibility(root, ['LOD0_TrimDamage'], trimDamaged);
      setNamedVisibility(root, ['LOD0_DamageRaycast'], shellDamaged || trimDamaged);
      userData.sheet06StructuralAuthority = false;
      userData.sheet06StructuralRole = 'ADDITIVE_DAMAGE_VISUALS';
      userData.sheet06AdditiveDamageOnly = true;
      userData.sheet06DamageVisible = shellDamaged || trimDamaged;
      break;
    }
    case 53:
      component = 'doors.main';
      applyDoorState(root, architecture);
      break;
    case 54: {
      component = 'porch';
      const value = architecture.components.porch;
      setComponentStateNodes(root, number, value.restored);
      setFinish(root, component, value.finish, FINISH_ALIASES.porch);
      userData.sheet06Restored = value.restored;
      break;
    }
    case 55: {
      component = 'windows';
      const value = architecture.components.windows;
      setWindowVariant(root, selections.windowVariant || 'standard');
      setComponentStateNodes(root, number, value.restored);
      setFinish(root, component, value.finish, FINISH_ALIASES.windows);
      windowMetadata(root, stateView, value.restored, value.finish);
      userData.sheet06Restored = value.restored;
      break;
    }
    case 56: {
      component = 'panels';
      const value = architecture.components.panels;
      setComponentStateNodes(root, number, value.restored);
      setFinish(root, component, value.finish, FINISH_ALIASES.panels);
      userData.sheet06Restored = value.restored;
      break;
    }
    case 57: {
      component = 'trim';
      const value = architecture.components.trim;
      setComponentStateNodes(root, number, value.restored);
      setFinish(root, component, value.finish, FINISH_ALIASES.trim);
      userData.sheet06Restored = value.restored;
      break;
    }
    case 58: {
      component = 'ceiling';
      const value = architecture.components.ceiling;
      setComponentStateNodes(root, number, value.restored);
      setFinish(root, component, value.finish, FINISH_ALIASES.ceiling);
      userData.sheet06Restored = value.restored;
      break;
    }
    case 59: {
      component = 'floor';
      const value = architecture.components.floor;
      setComponentStateNodes(root, number, value.restored);
      setFloorFinish(root, value.finish);
      floorCleaningMetadata(root, stateView);
      userData.sheet06Restored = value.restored;
      break;
    }
    case 60: {
      component = 'floor';
      const value = architecture.components.floor;
      setComponentStateNodes(root, number, value.restored);
      floorCleaningMetadata(root, stateView);
      userData.sheet06Restored = value.restored;
      userData.sheet06AdditiveDamageOnly = true;
      // Structural damage remains independent of removable grime. A clean grime
      // array must never imply repaired boards, chips, stains, or cracks.
      userData.sheet06DamageVisible = !value.restored;
      break;
    }
    default:
      throw new RangeError(`Unknown Sheet-6 asset ${number}.`);
  }

  return Object.freeze({
    assetNumber: number,
    component,
    restored: component === 'doors.main' ? null : userData.sheet06Restored ?? null,
    finish: userData.sheet06Finish ?? null,
  });
}

/**
 * Isolated lifecycle wrapper ready for a narrow future hookup from clubhouse.js.
 * It intentionally does not edit or replace the current procedural clubhouse.
 */
export function createSheet06ClubhouseAdapter({
  group = null,
  interior = null,
  mounts = null,
  fallbacks = {},
  state = null,
  loader = null,
  cache = null,
  bindings = SHEET06_RUNTIME_ASSETS,
  selections = {},
  architectureFactory = createSheet06Architecture,
  onAssetSettled = null,
  onReady = null,
  clonePrototype,
  mixerFactory,
} = {}) {
  if (typeof architectureFactory !== 'function') throw new TypeError('architectureFactory must be a function.');
  const resolvedMounts = { ...(mounts || {}) };
  if (group) resolvedMounts.group = group;
  if (interior) resolvedMounts.interior = interior;
  const placementRecords = new Map();
  const placementResolver = createSheet06PlacementResolver({
    onPlacement(placement) { placementRecords.set(placement.assetNumber, placement); },
  });
  let disposed = false;
  let stateApplications = 0;

  const options = {
    loader,
    cache,
    bindings,
    mounts: resolvedMounts,
    fallbacks,
    placementResolver,
    applyState(context) {
      return applySheet06ClubhouseAssetState({ ...context, selections });
    },
    initialState: state,
    onAssetSettled,
    onReady,
  };
  if (clonePrototype) options.clonePrototype = clonePrototype;
  if (mixerFactory) options.mixerFactory = mixerFactory;
  const architecture = architectureFactory(options);
  if (!architecture || typeof architecture !== 'object') {
    throw new TypeError('architectureFactory must return a Sheet-6 lifecycle object.');
  }

  function diagnostics() {
    const cacheDiagnostics = architecture.diagnostics?.() || null;
    const loadedAuthorities = [51, 52]
      .map((number) => architecture.getRoot?.(number))
      .filter((root) => root?.userData?.sheet06StructuralAuthority === true).length;
    return Object.freeze({
      lifecycle: disposed ? 'disposed' : 'active',
      actualSharedGameIntegrated: false,
      stateApplications,
      structuralAuthorityCount: loadedAuthorities,
      placementCount: placementRecords.size,
      placements: Object.freeze([...placementRecords.values()]),
      cache: cacheDiagnostics,
    });
  }

  async function applyState(nextState) {
    if (disposed) return Object.freeze({ applied: 0, failed: 0, disposed: true });
    stateApplications += 1;
    if (typeof architecture.applyState !== 'function') {
      return Object.freeze({ applied: 0, failed: 0, disposed: false });
    }
    return architecture.applyState(nextState);
  }

  function update(deltaSeconds) {
    if (disposed) return 0;
    return architecture.update?.(deltaSeconds) || 0;
  }

  function dispose() {
    if (disposed) return Object.freeze({ alreadyDisposed: true, cache: null });
    disposed = true;
    const result = architecture.dispose?.() || null;
    placementRecords.clear();
    return Object.freeze({ alreadyDisposed: false, cache: result });
  }

  return Object.freeze({
    ready: architecture.ready || Promise.resolve(null),
    bindings,
    placementResolver,
    getRoot: (number) => (disposed ? null : architecture.getRoot?.(number) || null),
    borrowedResources: () => architecture.borrowedResources?.() || null,
    diagnostics,
    applyState,
    update,
    dispose,
  });
}

export default createSheet06ClubhouseAdapter;

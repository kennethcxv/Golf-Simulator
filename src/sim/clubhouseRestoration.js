// CLUBHOUSE ARCHITECTURE RESTORATION STATE
//
// This module owns only `state.shop.reno.architecture`. Floor grime, window
// film, pressure-wash masks, clutter, and every other renovation field remain
// with their existing systems. The local schema version deliberately does not
// participate in the global save version: callers may add this block to an old
// save without invalidating or rewriting the rest of that save.

export const ARCHITECTURE_STATE_VERSION = 1;

export const ARCHITECTURE_COMPONENTS = Object.freeze([
  'shell',
  'porch',
  'windows',
  'panels',
  'trim',
  'ceiling',
  'floor',
]);

export const MAIN_DOOR_LEAVES = Object.freeze(['left', 'right']);
export const MAIN_DOOR_STATES = Object.freeze(['closed', 'open']);

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

// IDs are save data, not display strings. They intentionally describe the
// Pinehollow palette and the four flooring families requested by Sheet 6.
export const ARCHITECTURE_FINISH_OPTIONS = deepFreeze({
  shell: ['warm-cream', 'muted-sage'],
  porch: ['natural-oak', 'medium-walnut'],
  windows: ['deep-golf-green', 'warm-charcoal'],
  panels: ['muted-sage', 'medium-walnut', 'warm-cream'],
  trim: ['warm-cream', 'deep-golf-green', 'restrained-brass'],
  ceiling: ['warm-cream', 'natural-oak'],
  floor: ['natural-oak', 'medium-walnut', 'muted-sage-carpet', 'warm-cream-tile'],
});

export const ARCHITECTURE_DEFAULTS = deepFreeze({
  version: ARCHITECTURE_STATE_VERSION,
  components: {
    shell: { restored: false, finish: 'warm-cream' },
    porch: { restored: false, finish: 'natural-oak' },
    windows: { restored: false, finish: 'deep-golf-green' },
    panels: { restored: false, finish: 'muted-sage' },
    trim: { restored: false, finish: 'warm-cream' },
    ceiling: { restored: false, finish: 'warm-cream' },
    floor: { restored: false, finish: 'natural-oak' },
  },
  doors: {
    main: { left: 'closed', right: 'closed' },
  },
});

const LEGACY_COMPLETE_EPSILON = 0.01;
const SHELL_WASH_SURFACES = Object.freeze(['sidingSW', 'sidingSE', 'foundation', 'trim']);

const isRecord = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const hasExactKeys = (value, expected) => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
};

const isComponent = (component) => ARCHITECTURE_COMPONENTS.includes(component);
const isDoorLeaf = (leaf) => MAIN_DOOR_LEAVES.includes(leaf);
const isDoorState = (doorState) => MAIN_DOOR_STATES.includes(doorState);
const isFinish = (component, finish) => (
  isComponent(component) && ARCHITECTURE_FINISH_OPTIONS[component].includes(finish)
);

export function defaultClubhouseArchitecture() {
  const components = {};
  for (const component of ARCHITECTURE_COMPONENTS) {
    components[component] = { ...ARCHITECTURE_DEFAULTS.components[component] };
  }
  return {
    version: ARCHITECTURE_STATE_VERSION,
    components,
    doors: { main: { ...ARCHITECTURE_DEFAULTS.doors.main } },
  };
}

export const createClubhouseArchitectureState = defaultClubhouseArchitecture;

function numericSeriesComplete(series) {
  return Array.isArray(series)
    && series.length > 0
    && series.every((value) => (
      Number.isFinite(value) && value >= 0 && value <= LEGACY_COMPLETE_EPSILON
    ));
}

function washSurfaceComplete(wash, surfaceId) {
  return isRecord(wash)
    && isRecord(wash[surfaceId])
    && numericSeriesComplete(wash[surfaceId].grime);
}

function exteriorJobsComplete(exterior) {
  if (!isRecord(exterior) || !Array.isArray(exterior.weeds) || exterior.weeds.length === 0) {
    return false;
  }
  const done = (value) => value === false || value === 0;
  return exterior.weeds.every(done)
    && done(exterior.gutter)
    && done(exterior.cobwebs)
    && done(exterior.light);
}

function legacyTrue(value) {
  return value === true
    || value === 1
    || value === 'restored'
    || value === 'complete'
    || value === 'completed';
}

function explicitLegacyCompletion(source, component) {
  if (!isRecord(source)) return false;
  const componentValue = isRecord(source.components) ? source.components[component] : undefined;
  const directValue = source[component];
  const restoredMap = isRecord(source.restored) ? source.restored[component] : undefined;
  const completionMap = isRecord(source.completion) ? source.completion[component] : undefined;
  return [
    componentValue,
    isRecord(componentValue) ? componentValue.restored : undefined,
    isRecord(componentValue) ? componentValue.complete : undefined,
    isRecord(componentValue) ? componentValue.status : undefined,
    directValue,
    isRecord(directValue) ? directValue.restored : undefined,
    isRecord(directValue) ? directValue.complete : undefined,
    isRecord(directValue) ? directValue.status : undefined,
    restoredMap,
    completionMap,
    source[`${component}Restored`],
    source[`${component}Complete`],
  ].some(legacyTrue);
}

function legacyCompletionEvidence(reno, source) {
  const completed = new Set();
  const allArchitectureComplete = (
    legacyTrue(source?.complete)
    || legacyTrue(source?.restored)
    || legacyTrue(reno?.architectureComplete)
    || legacyTrue(reno?.restorationComplete)
  );

  for (const component of ARCHITECTURE_COMPONENTS) {
    if (allArchitectureComplete || explicitLegacyCompletion(source, component)) {
      completed.add(component);
    }
  }

  // These are the only old systems with component-specific, unambiguous proof
  // of completed work. Merely having a dirt array is never enough.
  if (numericSeriesComplete(reno?.windows)) completed.add('windows');
  if (numericSeriesComplete(reno?.grime)) completed.add('floor');
  if (washSurfaceComplete(reno?.wash, 'porch')) completed.add('porch');
  if (
    SHELL_WASH_SURFACES.every((surfaceId) => washSurfaceComplete(reno?.wash, surfaceId))
    && exteriorJobsComplete(reno?.exterior)
  ) {
    completed.add('shell');
  }

  return completed;
}

function legacyFinish(source, component) {
  if (!isRecord(source)) return ARCHITECTURE_DEFAULTS.components[component].finish;
  const candidates = [
    isRecord(source.components?.[component]) ? source.components[component].finish : undefined,
    isRecord(source[component]) ? source[component].finish : undefined,
    isRecord(source.finishes) ? source.finishes[component] : undefined,
    source[`${component}Finish`],
  ];
  return candidates.find((finish) => isFinish(component, finish))
    || ARCHITECTURE_DEFAULTS.components[component].finish;
}

function legacyDoorState(source, leaf) {
  if (!isRecord(source)) return ARCHITECTURE_DEFAULTS.doors.main[leaf];
  const globalState = source.mainDoorOpen ?? source.doorOpen ?? source.mainDoor;
  const candidates = [
    source.doors?.main?.[leaf],
    source.mainDoor?.[leaf],
    source.mainDoor?.[`${leaf}Open`],
    source.door?.[leaf],
    source[`${leaf}Door`],
    source[`${leaf}DoorOpen`],
    globalState,
  ];
  for (const candidate of candidates) {
    if (isDoorState(candidate)) return candidate;
    if (candidate === true) return 'open';
    if (candidate === false) return 'closed';
  }
  return ARCHITECTURE_DEFAULTS.doors.main[leaf];
}

function normalizedArchitecture(reno, source) {
  const result = defaultClubhouseArchitecture();
  const completed = legacyCompletionEvidence(reno, source);
  for (const component of ARCHITECTURE_COMPONENTS) {
    result.components[component].restored = completed.has(component);
    result.components[component].finish = legacyFinish(source, component);
  }
  for (const leaf of MAIN_DOOR_LEAVES) {
    result.doors.main[leaf] = legacyDoorState(source, leaf);
  }
  return result;
}

function isCanonicalArchitecture(value) {
  if (!hasExactKeys(value, ['version', 'components', 'doors'])) return false;
  if (value.version !== ARCHITECTURE_STATE_VERSION) return false;
  if (!hasExactKeys(value.components, ARCHITECTURE_COMPONENTS)) return false;
  for (const component of ARCHITECTURE_COMPONENTS) {
    const entry = value.components[component];
    if (!hasExactKeys(entry, ['restored', 'finish'])) return false;
    if (typeof entry.restored !== 'boolean' || !isFinish(component, entry.finish)) return false;
  }
  return hasExactKeys(value.doors, ['main'])
    && hasExactKeys(value.doors.main, MAIN_DOOR_LEAVES)
    && MAIN_DOOR_LEAVES.every((leaf) => isDoorState(value.doors.main[leaf]));
}

function ensureRenoContainer(state) {
  if (!isRecord(state)) return null;
  try {
    if (!isRecord(state.shop)) state.shop = {};
    if (!isRecord(state.shop.reno)) state.shop.reno = {};
  } catch {
    return null;
  }
  return state.shop.reno;
}

// Idempotent and monotonic: an already-canonical object keeps its identity.
// Newly completed legacy work may promote a false flag to true, but this
// function never changes true back to false and never writes sibling reno data.
export function ensureClubhouseArchitecture(state) {
  const reno = ensureRenoContainer(state);
  if (!reno) return null;
  const source = reno.architecture;

  if (isCanonicalArchitecture(source)) {
    const evidence = legacyCompletionEvidence(reno, source);
    const needsPromotion = ARCHITECTURE_COMPONENTS.some(
      (component) => evidence.has(component) && !source.components[component].restored,
    );
    if (!needsPromotion) return source;

    try {
      for (const component of ARCHITECTURE_COMPONENTS) {
        if (evidence.has(component)) source.components[component].restored = true;
      }
      return source;
    } catch {
      // A frozen/corrupt imported block cannot be repaired in place. Normalize
      // into a fresh mutable value if its parent container permits replacement.
    }
  }

  const normalized = normalizedArchitecture(reno, source);
  try {
    reno.architecture = normalized;
    return normalized;
  } catch {
    return null;
  }
}

export const ensureClubhouseRestoration = ensureClubhouseArchitecture;
export const clubhouseArchitectureState = ensureClubhouseArchitecture;

const invalid = (reason) => ({ ok: false, changed: false, reason });

export function updateArchitectureComponent(state, component, patch) {
  if (!isComponent(component)) return invalid('Unknown architecture component.');
  if (!isRecord(patch)) return invalid('Component update must be an object.');
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => key !== 'restored' && key !== 'finish')) {
    return invalid('Component update contains no supported fields.');
  }
  if ('restored' in patch && typeof patch.restored !== 'boolean') {
    return invalid('Restored state must be a boolean.');
  }
  if ('finish' in patch && !isFinish(component, patch.finish)) {
    return invalid('Finish is not valid for this component.');
  }

  const architecture = ensureClubhouseArchitecture(state);
  if (!architecture) return invalid('Architecture state is unavailable.');
  const current = architecture.components[component];
  const next = {
    restored: 'restored' in patch ? patch.restored : current.restored,
    finish: 'finish' in patch ? patch.finish : current.finish,
  };
  const changed = next.restored !== current.restored || next.finish !== current.finish;
  if (!changed) return { ok: true, changed: false, component, value: current };
  try {
    architecture.components[component] = next;
  } catch {
    return invalid('Architecture state is read-only.');
  }
  return { ok: true, changed: true, component, value: next };
}

export function setArchitectureComponent(state, component, restored) {
  return updateArchitectureComponent(state, component, { restored });
}

export const setArchitectureComponentRestored = setArchitectureComponent;

export function setArchitectureFinish(state, component, finish) {
  return updateArchitectureComponent(state, component, { finish });
}

export const setShellRestored = (state, restored) => setArchitectureComponent(state, 'shell', restored);
export const setPorchRestored = (state, restored) => setArchitectureComponent(state, 'porch', restored);
export const setWindowsRestored = (state, restored) => setArchitectureComponent(state, 'windows', restored);
export const setPanelsRestored = (state, restored) => setArchitectureComponent(state, 'panels', restored);
export const setTrimRestored = (state, restored) => setArchitectureComponent(state, 'trim', restored);
export const setCeilingRestored = (state, restored) => setArchitectureComponent(state, 'ceiling', restored);
export const setFloorRestored = (state, restored) => setArchitectureComponent(state, 'floor', restored);

export function setMainDoorLeafState(state, leaf, doorState) {
  if (!isDoorLeaf(leaf)) return invalid('Unknown main-door leaf.');
  if (!isDoorState(doorState)) return invalid('Door state must be open or closed.');
  const architecture = ensureClubhouseArchitecture(state);
  if (!architecture) return invalid('Architecture state is unavailable.');
  const current = architecture.doors.main;
  if (current[leaf] === doorState) {
    return { ok: true, changed: false, leaf, state: doorState };
  }
  try {
    architecture.doors.main = { ...current, [leaf]: doorState };
  } catch {
    return invalid('Architecture state is read-only.');
  }
  return { ok: true, changed: true, leaf, state: doorState };
}

// Assembly-level operation used by the normal automatic entrance. Individual
// leaf control remains available for occupancy protection and debugging.
export function setMainDoorState(state, doorState) {
  if (!isDoorState(doorState)) return invalid('Door state must be open or closed.');
  const architecture = ensureClubhouseArchitecture(state);
  if (!architecture) return invalid('Architecture state is unavailable.');
  const current = architecture.doors.main;
  const changed = MAIN_DOOR_LEAVES.some((leaf) => current[leaf] !== doorState);
  if (!changed) return { ok: true, changed: false, state: doorState };
  try {
    architecture.doors.main = { left: doorState, right: doorState };
  } catch {
    return invalid('Architecture state is read-only.');
  }
  return { ok: true, changed: true, state: doorState };
}

export function toggleMainDoorLeafState(state, leaf) {
  if (!isDoorLeaf(leaf)) return invalid('Unknown main-door leaf.');
  const architecture = ensureClubhouseArchitecture(state);
  if (!architecture) return invalid('Architecture state is unavailable.');
  const next = architecture.doors.main[leaf] === 'open' ? 'closed' : 'open';
  return setMainDoorLeafState(state, leaf, next);
}

export function toggleMainDoorState(state) {
  const architecture = ensureClubhouseArchitecture(state);
  if (!architecture) return invalid('Architecture state is unavailable.');
  const bothOpen = MAIN_DOOR_LEAVES.every((leaf) => architecture.doors.main[leaf] === 'open');
  return setMainDoorState(state, bothOpen ? 'closed' : 'open');
}

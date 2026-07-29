import { applyReputationChange } from './reputation.js';
import { addExpense } from './economy.js';
import { availableSupplyUnits, consumeSupplyUnit } from './supplyUnits.js';

// CLUBHOUSE RESTORATION STATE
//
// This module owns the discrete furnished-but-neglected targets, light repairs,
// and restoration milestones directly under `state.shop.reno`. Architecture
// remains its own nested block. Floor grime, window film, pressure-wash masks,
// clutter, and every other renovation field remain with their existing systems.
// Local versions deliberately do not participate in the global save version.

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

// Player-facing structural work identity. Labels are display strings; the
// repair supply sku and refinish costs are persisted economy contracts.
export const ARCHITECTURE_REPAIR_SKU = 'repairkit1';

export const ARCHITECTURE_COMPONENT_LABELS = deepFreeze({
  shell: 'Exterior shell',
  porch: 'Porch boards and rail',
  windows: 'Window frames',
  panels: 'Wall panels',
  trim: 'Interior and entrance trim',
  ceiling: 'Ceiling and beams',
  floor: 'Flooring',
});

export const ARCHITECTURE_FINISH_LABELS = deepFreeze({
  'warm-cream': 'warm cream',
  'muted-sage': 'muted sage',
  'natural-oak': 'natural oak',
  'medium-walnut': 'medium walnut',
  'deep-golf-green': 'deep golf green',
  'warm-charcoal': 'warm charcoal',
  'restrained-brass': 'restrained brass',
  'muted-sage-carpet': 'muted sage carpet',
  'warm-cream-tile': 'warm cream tile',
});

// One refinish application per component is paid through the works ledger
// line. Larger surfaces cost more; the values sit beside the $38 repair
// components sku so early painting is a real but affordable spend.
export const ARCHITECTURE_PAINT_COSTS = deepFreeze({
  shell: 90,
  porch: 55,
  windows: 40,
  panels: 60,
  trim: 30,
  ceiling: 70,
  floor: 110,
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

export const CLUBHOUSE_RESTORATION_VERSION = 1;
export const CLUBHOUSE_LAYOUT_VERSION = 2;
export const STARTER_RESTOCK_VERSION = 1;
// Compatibility name retained for saves/tests written while the entitlement
// schema was being staged. Zero means the production entitlement is unclaimed.
export const STARTER_RESTOCK_VERSION_PLACEHOLDER = 0;

// These IDs are persisted integration contracts. Keep them stable even when a
// prop's display name, mesh, or position changes.
export const CLUBHOUSE_CLEANUP_TARGET_IDS = Object.freeze([
  'entry:leaves-trash',
  'corner:cobweb-nw',
  'corner:cobweb-ne',
  'wall:scuff-west',
  'wall:scuff-east',
  'lounge:pizza-box',
  'lounge:empty-cups',
  'lounge:chair-crooked',
  'wall:fallen-frame',
  'desk:paper-stack',
  'desk:overflow-bin',
  'desk:sticky-notes',
]);

export const CLUBHOUSE_LIGHT_TARGET_IDS = Object.freeze([
  'ceiling:panel-02',
  'ceiling:panel-07',
]);

export const CLUBHOUSE_RESTORATION_TARGET_IDS = Object.freeze([
  ...CLUBHOUSE_CLEANUP_TARGET_IDS,
  ...CLUBHOUSE_LIGHT_TARGET_IDS,
]);

export const CLUBHOUSE_PANEL_IDS = Object.freeze([
  'panel-01',
  'panel-02',
  'panel-03',
  'panel-04',
  'panel-05',
  'panel-06',
  'panel-07',
  'panel-08',
]);

export const CLUBHOUSE_PANEL_STATES = Object.freeze(['working', 'flicker', 'dead']);

export const CLUBHOUSE_RESTOCK_GROUP_IDS = Object.freeze([
  'balls',
  'accessories',
  'headwear',
  'apparel',
  'cooler',
  'snacks',
]);

// The existing grime, window-film, and generic clutter/debris systems announce
// their exact-once completion edges through these actions. This avoids a second
// implementation guessing at or mutating those systems' private array shapes.
export const CLUBHOUSE_CLEANUP_MILESTONE_IDS = Object.freeze([
  'floor',
  'windows',
  'generic-debris',
]);

export const CLUBHOUSE_RESTORATION_ACTION_TYPES = Object.freeze([
  'set-target-progress',
  'repair-light',
  'repair-component',
  'paint-component',
  'complete-restock-milestone',
  'complete-cleanup-milestone',
  'claim-full-cleanup',
]);

const LIGHT_TARGET_TO_PANEL = deepFreeze({
  'ceiling:panel-02': 'panel-02',
  'ceiling:panel-07': 'panel-07',
});

// THE CEILING CIRCUIT IS A SEPARATE GATE FROM THE PANEL ITSELF.
//
// The campaign's `ceiling` component is literally "Office power and ceiling"
// (CAMPAIGN_REPAIR_JOBS): until it is repaired, the ceiling ring has no power
// and no panel can light, whatever state the panel is in. That gate used to
// live only in the renderer (clubhouse.js), where the sim could not see it —
// so `repair-light` would happily report "Dead ceiling light repaired" while
// the room stayed pitch dark, because the OTHER gate was still shut. One
// predicate, exported, is what stops those two from drifting again.
//
// Deliberately not routed through campaign.js's repairComplete(): that module
// imports this one, and this is the same read without the cycle.
export function ceilingCircuitPowered(state) {
  if (!state?.campaign?.enabled) return true; // free play has working power
  return !!ensureClubhouseArchitecture(state)?.components?.ceiling?.restored;
}

// A panel repair spends one physical repair kit, exactly as a structural repair
// does. `availableSupplyUnits` is the authority on what counts: the backroom
// shelving plus what is in your hands. A kit sealed inside an unopened delivery
// box is NOT available — it has to be unboxed first, which is the whole point
// of a delivery having to be opened.
export function panelRepairKitAvailable(state) {
  return availableSupplyUnits(state, ARCHITECTURE_REPAIR_SKU) > 0;
}

// The prompt under a ceiling fitting, as a pure decision, shared by both rooms.
//
// It enforces one rule the rooms kept breaking in different ways: a prompt may
// only name a fault the player can actually SEE. While the ceiling circuit is
// dead every fitting is dark — applyPracticalLevels drives them all to zero
// intensity and updateFlicker returns before it animates anything — so at
// campaign start the two faults are indistinguishable. v2 named one of them
// "Flickering ceiling panel" anyway, describing a state that does not exist
// until the circuit is live and the player has never once observed.
//
// The per-panel fault name is therefore withheld until there is power to make
// it true. The gate order matches the order the player meets the gates.
export const CEILING_PANEL_UNPOWERED_NAME = 'Dark ceiling panel';

export function ceilingPanelPromptLabel({
  faultName,
  unpoweredName = CEILING_PANEL_UNPOWERED_NAME,
  powered,
  kitAvailable,
  repaired = false,
}) {
  if (repaired) return null;
  if (!powered) return `${unpoweredName} — the ceiling circuit is dead`;
  if (!kitAvailable) return `${faultName} — repair kit required`;
  return `${faultName} — [E] repair with clubhouse kit`;
}

const PANEL_FAULT_DEFAULTS = deepFreeze({
  'panel-02': 'flicker',
  'panel-07': 'dead',
});

const TARGET_LABELS = deepFreeze({
  'entry:leaves-trash': 'Entry leaves and trash cleared',
  'corner:cobweb-nw': 'Northwest cobweb vacuumed',
  'corner:cobweb-ne': 'Northeast cobweb vacuumed',
  'wall:scuff-west': 'West wall scuff cleaned',
  'wall:scuff-east': 'East wall scuff cleaned',
  'lounge:pizza-box': 'Pizza box cleared',
  'lounge:empty-cups': 'Empty cups cleared',
  'lounge:chair-crooked': 'Lounge chair straightened',
  'wall:fallen-frame': 'Fallen picture rehung',
  'desk:paper-stack': 'Desk papers organized',
  'desk:overflow-bin': 'Overflowing bin emptied',
  'desk:sticky-notes': 'Monitor sticky notes cleared',
  'ceiling:panel-02': 'Flickering ceiling light repaired',
  'ceiling:panel-07': 'Dead ceiling light repaired',
});

const RESTOCK_LABELS = deepFreeze({
  balls: 'Golf balls restocked',
  accessories: 'Accessories restocked',
  headwear: 'Headwear restocked',
  apparel: 'Apparel restocked',
  cooler: 'Drinks cooler restocked',
  snacks: 'Snacks restocked',
});

const CLEANUP_MILESTONE_LABELS = deepFreeze({
  floor: 'Floor cleaning complete',
  windows: 'Window cleaning complete',
  'generic-debris': 'General clutter and debris cleared',
});

const defaultTargetProgress = () => Object.fromEntries(
  CLUBHOUSE_RESTORATION_TARGET_IDS.map((targetId) => [targetId, 0]),
);

const defaultLightPanels = () => Object.fromEntries(
  CLUBHOUSE_PANEL_IDS.map((panelId) => [
    panelId,
    panelId === 'panel-02' ? 'flicker' : panelId === 'panel-07' ? 'dead' : 'working',
  ]),
);

const defaultRestockMilestones = () => Object.fromEntries(
  CLUBHOUSE_RESTOCK_GROUP_IDS.map((groupId) => [groupId, false]),
);

const defaultCleanupMilestones = () => Object.fromEntries(
  CLUBHOUSE_CLEANUP_MILESTONE_IDS.map((milestoneId) => [milestoneId, false]),
);

const defaultComponentRepairProgress = () => Object.fromEntries(
  ARCHITECTURE_COMPONENTS.map((component) => [component, 0]),
);

const defaultComponentPaintApplications = () => Object.fromEntries(
  ARCHITECTURE_COMPONENTS.map((component) => [component, 0]),
);

export const CLUBHOUSE_RESTORATION_DEFAULTS = deepFreeze({
  restorationVersion: CLUBHOUSE_RESTORATION_VERSION,
  clubhouseLayoutVersion: CLUBHOUSE_LAYOUT_VERSION,
  targetProgress: defaultTargetProgress(),
  lightPanels: defaultLightPanels(),
  restockMilestones: defaultRestockMilestones(),
  cleanupMilestones: defaultCleanupMilestones(),
  componentRepairProgress: defaultComponentRepairProgress(),
  componentPaintApplications: defaultComponentPaintApplications(),
  starterRestockVersion: STARTER_RESTOCK_VERSION_PLACEHOLDER,
  fullCleanupAwarded: false,
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

// Idempotent: an already-canonical object keeps its identity and is the sole
// authority for architecture restoration. Legacy cleaning/completion evidence
// is consumed exactly once while an absent or non-canonical block is normalized;
// later cleaning must not repair structural components behind the save's back.
export function ensureClubhouseArchitecture(state) {
  const reno = ensureRenoContainer(state);
  if (!reno) return null;
  const source = reno.architecture;

  if (isCanonicalArchitecture(source)) return source;

  const normalized = normalizedArchitecture(reno, source);
  try {
    reno.architecture = normalized;
    return normalized;
  } catch {
    return null;
  }
}

export const clubhouseArchitectureState = ensureClubhouseArchitecture;

const invalid = (reason) => ({ ok: false, changed: false, reason });

export function defaultClubhouseRestorationState() {
  return {
    restorationVersion: CLUBHOUSE_RESTORATION_VERSION,
    clubhouseLayoutVersion: CLUBHOUSE_LAYOUT_VERSION,
    targetProgress: defaultTargetProgress(),
    lightPanels: defaultLightPanels(),
    restockMilestones: defaultRestockMilestones(),
    cleanupMilestones: defaultCleanupMilestones(),
    componentRepairProgress: defaultComponentRepairProgress(),
    componentPaintApplications: defaultComponentPaintApplications(),
    starterRestockVersion: STARTER_RESTOCK_VERSION_PLACEHOLDER,
    fullCleanupAwarded: false,
  };
}

export const createClubhouseRestorationState = defaultClubhouseRestorationState;

function propertyIdForRestoration(state) {
  const candidates = [
    state?.property?.id,
    state?.propertyInventory?.propertyId,
    state?.propertyId,
  ];
  const persisted = candidates.find((candidate) => (
    (typeof candidate === 'string' || typeof candidate === 'number')
    && String(candidate).trim().length > 0
  ));
  return persisted == null ? `club-${state?.seed ?? 'unknown'}` : String(persisted).trim();
}

function restorationReputationId(state, targetId) {
  return [
    'clubhouse-restoration',
    propertyIdForRestoration(state),
    CLUBHOUSE_RESTORATION_VERSION,
    targetId,
  ].join(':');
}

function validProgress(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isCanonicalProgressMap(value) {
  return hasExactKeys(value, CLUBHOUSE_RESTORATION_TARGET_IDS)
    && CLUBHOUSE_RESTORATION_TARGET_IDS.every((targetId) => validProgress(value[targetId]));
}

function isCanonicalPanelMap(value) {
  return hasExactKeys(value, CLUBHOUSE_PANEL_IDS)
    && CLUBHOUSE_PANEL_IDS.every((panelId) => {
      const fault = PANEL_FAULT_DEFAULTS[panelId];
      return fault
        ? value[panelId] === fault || value[panelId] === 'working'
        : value[panelId] === 'working';
    });
}

function isCanonicalBooleanMap(value, ids) {
  return hasExactKeys(value, ids) && ids.every((id) => typeof value[id] === 'boolean');
}

function isCanonicalComponentRepairMap(value, architecture) {
  return hasExactKeys(value, ARCHITECTURE_COMPONENTS)
    && ARCHITECTURE_COMPONENTS.every((component) => (
      validProgress(value[component])
      && (!architecture?.components?.[component]?.restored || value[component] === 1)
    ));
}

function isCanonicalPaintApplicationMap(value) {
  return hasExactKeys(value, ARCHITECTURE_COMPONENTS)
    && ARCHITECTURE_COMPONENTS.every((component) => (
      Number.isSafeInteger(value[component]) && value[component] >= 0
    ));
}

function fullCleanupReady(reno) {
  return CLUBHOUSE_CLEANUP_TARGET_IDS.every((targetId) => reno.targetProgress[targetId] >= 1)
    && CLUBHOUSE_LIGHT_TARGET_IDS.every((targetId) => (
      reno.targetProgress[targetId] >= 1
      && reno.lightPanels[LIGHT_TARGET_TO_PANEL[targetId]] === 'working'
    ))
    && CLUBHOUSE_CLEANUP_MILESTONE_IDS.every((milestoneId) => (
      reno.cleanupMilestones[milestoneId]
    ));
}

function isCanonicalRestoration(reno) {
  if (reno.restorationVersion !== CLUBHOUSE_RESTORATION_VERSION) return false;
  if (!Number.isSafeInteger(reno.clubhouseLayoutVersion)
      || reno.clubhouseLayoutVersion < CLUBHOUSE_LAYOUT_VERSION) return false;
  if (!isCanonicalProgressMap(reno.targetProgress)) return false;
  if (!isCanonicalPanelMap(reno.lightPanels)) return false;
  if (!isCanonicalBooleanMap(reno.restockMilestones, CLUBHOUSE_RESTOCK_GROUP_IDS)) return false;
  if (!isCanonicalBooleanMap(reno.cleanupMilestones, CLUBHOUSE_CLEANUP_MILESTONE_IDS)) return false;
  if (!isCanonicalComponentRepairMap(reno.componentRepairProgress, reno.architecture)) return false;
  if (!isCanonicalPaintApplicationMap(reno.componentPaintApplications)) return false;
  if (!Number.isSafeInteger(reno.starterRestockVersion) || reno.starterRestockVersion < 0) return false;
  if (typeof reno.fullCleanupAwarded !== 'boolean') return false;
  for (const targetId of CLUBHOUSE_LIGHT_TARGET_IDS) {
    const repaired = reno.targetProgress[targetId] >= 1;
    const working = reno.lightPanels[LIGHT_TARGET_TO_PANEL[targetId]] === 'working';
    if (repaired !== working) return false;
  }
  return !reno.fullCleanupAwarded || fullCleanupReady(reno);
}

function normalizedProgressValue(value) {
  if (legacyTrue(value)) return 1;
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

function reputationAlreadyProcessed(state, targetId) {
  return state?.reputation?.processedIds?.[restorationReputationId(state, targetId)] === true;
}

function normalizedRestoration(state, reno) {
  const result = defaultClubhouseRestorationState();
  const sourceProgress = isRecord(reno.targetProgress) ? reno.targetProgress : {};
  const sourcePanels = isRecord(reno.lightPanels) ? reno.lightPanels : {};
  const sourceRestock = isRecord(reno.restockMilestones) ? reno.restockMilestones : {};
  const sourceCleanup = isRecord(reno.cleanupMilestones) ? reno.cleanupMilestones : {};

  for (const targetId of CLUBHOUSE_RESTORATION_TARGET_IDS) {
    result.targetProgress[targetId] = normalizedProgressValue(sourceProgress[targetId]);
  }
  for (const panelId of CLUBHOUSE_PANEL_IDS) {
    const panelState = sourcePanels[panelId];
    const fault = PANEL_FAULT_DEFAULTS[panelId];
    if (panelState === 'working') result.lightPanels[panelId] = 'working';
    else if (fault && panelState === fault) result.lightPanels[panelId] = fault;
  }
  for (const groupId of CLUBHOUSE_RESTOCK_GROUP_IDS) {
    result.restockMilestones[groupId] = legacyTrue(sourceRestock[groupId])
      || reputationAlreadyProcessed(state, `restock:${groupId}`);
  }
  for (const milestoneId of CLUBHOUSE_CLEANUP_MILESTONE_IDS) {
    result.cleanupMilestones[milestoneId] = legacyTrue(sourceCleanup[milestoneId])
      || reputationAlreadyProcessed(state, `milestone:${milestoneId}`);
  }

  for (const targetId of CLUBHOUSE_CLEANUP_TARGET_IDS) {
    if (reputationAlreadyProcessed(state, targetId)) result.targetProgress[targetId] = 1;
  }
  for (const targetId of CLUBHOUSE_LIGHT_TARGET_IDS) {
    const panelId = LIGHT_TARGET_TO_PANEL[targetId];
    const rewarded = reputationAlreadyProcessed(state, `${targetId}:cleanliness`)
      || reputationAlreadyProcessed(state, `${targetId}:service`);
    const repaired = result.targetProgress[targetId] >= 1
      || sourcePanels[panelId] === 'working'
      || rewarded;
    result.targetProgress[targetId] = repaired ? 1 : result.targetProgress[targetId];
    result.lightPanels[panelId] = repaired ? 'working' : result.lightPanels[panelId];
  }

  const sourceRepair = isRecord(reno.componentRepairProgress) ? reno.componentRepairProgress : {};
  const sourcePaint = isRecord(reno.componentPaintApplications) ? reno.componentPaintApplications : {};
  for (const component of ARCHITECTURE_COMPONENTS) {
    // A restored component is unambiguous evidence its repair completed; the
    // hold-progress map exists for partially repaired components only.
    const restored = !!reno.architecture?.components?.[component]?.restored;
    result.componentRepairProgress[component] = restored
      ? 1
      : normalizedProgressValue(sourceRepair[component]);
    const applications = sourcePaint[component];
    result.componentPaintApplications[component] = (
      Number.isSafeInteger(applications) && applications >= 0 ? applications : 0
    );
  }

  result.starterRestockVersion = Number.isSafeInteger(reno.starterRestockVersion)
    && reno.starterRestockVersion >= 0
    ? reno.starterRestockVersion
    : STARTER_RESTOCK_VERSION_PLACEHOLDER;
  result.clubhouseLayoutVersion = Math.max(
    CLUBHOUSE_LAYOUT_VERSION,
    Number.isSafeInteger(reno.clubhouseLayoutVersion) ? reno.clubhouseLayoutVersion : 0,
  );
  result.fullCleanupAwarded = legacyTrue(reno.fullCleanupAwarded)
    || reputationAlreadyProcessed(state, 'full-cleanup');

  // A saved full-cleanup flag is unambiguous evidence that these requirements
  // were once complete. Promote missing version-zero fields instead of re-dirtying
  // an already-restored clubhouse during local-schema migration.
  if (result.fullCleanupAwarded) {
    for (const targetId of CLUBHOUSE_RESTORATION_TARGET_IDS) result.targetProgress[targetId] = 1;
    for (const targetId of CLUBHOUSE_LIGHT_TARGET_IDS) {
      result.lightPanels[LIGHT_TARGET_TO_PANEL[targetId]] = 'working';
    }
    for (const milestoneId of CLUBHOUSE_CLEANUP_MILESTONE_IDS) {
      result.cleanupMilestones[milestoneId] = true;
    }
  }
  return result;
}

// Returns the live aggregate renovation record so existing cleaning systems and
// the nested architecture authority remain in one persisted local schema.
export function ensureClubhouseRestoration(state) {
  const reno = ensureRenoContainer(state);
  if (!reno || !ensureClubhouseArchitecture(state)) return null;
  if (isCanonicalRestoration(reno)) return reno;

  const normalized = normalizedRestoration(state, reno);
  try {
    Object.assign(reno, normalized);
    return reno;
  } catch {
    return null;
  }
}

function cloneArchitecture(architecture) {
  return {
    version: architecture.version,
    components: Object.fromEntries(ARCHITECTURE_COMPONENTS.map((component) => [
      component,
      { ...architecture.components[component] },
    ])),
    doors: { main: { ...architecture.doors.main } },
  };
}

export function restorationSnapshot(state) {
  const reno = ensureClubhouseRestoration(state);
  if (!reno) return null;
  const cleanupCompleted = CLUBHOUSE_CLEANUP_TARGET_IDS.filter(
    (targetId) => reno.targetProgress[targetId] >= 1,
  ).length;
  const lightsRepaired = CLUBHOUSE_LIGHT_TARGET_IDS.filter(
    (targetId) => reno.targetProgress[targetId] >= 1,
  ).length;
  const restockCompleted = CLUBHOUSE_RESTOCK_GROUP_IDS.filter(
    (groupId) => reno.restockMilestones[groupId],
  ).length;
  const cleanupMilestonesCompleted = CLUBHOUSE_CLEANUP_MILESTONE_IDS.filter(
    (milestoneId) => reno.cleanupMilestones[milestoneId],
  ).length;
  return {
    version: reno.restorationVersion,
    clubhouseLayoutVersion: reno.clubhouseLayoutVersion,
    propertyId: propertyIdForRestoration(state),
    architecture: cloneArchitecture(reno.architecture),
    targetProgress: { ...reno.targetProgress },
    lightPanels: { ...reno.lightPanels },
    restockMilestones: { ...reno.restockMilestones },
    cleanupMilestones: { ...reno.cleanupMilestones },
    componentRepairProgress: { ...reno.componentRepairProgress },
    componentPaintApplications: { ...reno.componentPaintApplications },
    starterRestockVersion: reno.starterRestockVersion,
    fullCleanupAwarded: reno.fullCleanupAwarded,
    counts: {
      cleanupCompleted,
      cleanupTotal: CLUBHOUSE_CLEANUP_TARGET_IDS.length,
      lightsRepaired,
      lightsTotal: CLUBHOUSE_LIGHT_TARGET_IDS.length,
      restockCompleted,
      restockTotal: CLUBHOUSE_RESTOCK_GROUP_IDS.length,
      cleanupMilestonesCompleted,
      cleanupMilestonesTotal: CLUBHOUSE_CLEANUP_MILESTONE_IDS.length,
    },
    complete: {
      discreteCleanup: cleanupCompleted === CLUBHOUSE_CLEANUP_TARGET_IDS.length,
      lighting: lightsRepaired === CLUBHOUSE_LIGHT_TARGET_IDS.length,
      restocking: restockCompleted === CLUBHOUSE_RESTOCK_GROUP_IDS.length,
      existingCleanupSystems: cleanupMilestonesCompleted === CLUBHOUSE_CLEANUP_MILESTONE_IDS.length,
      fullCleanupReady: fullCleanupReady(reno),
      fullCleanupAwarded: reno.fullCleanupAwarded,
    },
  };
}

function audioEvent(cue, targetId) {
  return { type: 'audio', cue, targetId };
}

function toastEvent(text, category, delta, targetId) {
  return { type: 'toast', tone: 'positive', text, category, delta, targetId };
}

function progressEvent(targetId, progress) {
  return { type: 'restoration-progress', targetId, progress };
}

function awardReputation(state, targetId, category, delta, reason) {
  return applyReputationChange(state, {
    id: restorationReputationId(state, targetId),
    category,
    delta,
    source: 'clubhouse-restoration',
    sourceId: targetId,
    reason,
  });
}

function awardFullCleanupIfReady(state, reno, awards, events) {
  if (reno.fullCleanupAwarded || !fullCleanupReady(reno)) return false;
  reno.fullCleanupAwarded = true;
  awards.push(awardReputation(
    state,
    'full-cleanup',
    'cleanliness',
    0.4,
    'Every required Pine Hills clubhouse cleanup and light repair was completed.',
  ));
  events.push(
    audioEvent('clubhouse-restoration-complete', 'full-cleanup'),
    toastEvent('Clubhouse cleanup complete | Cleanliness +0.4', 'cleanliness', 0.4, 'full-cleanup'),
  );
  return true;
}

function successfulAction(type, changed, details = {}) {
  return {
    ok: true,
    changed,
    type,
    awards: [],
    events: [],
    ...details,
  };
}

export function restorationAction(state, action) {
  if (!isRecord(action)) return invalid('Restoration action must be an object.');
  const { type } = action;
  if (!CLUBHOUSE_RESTORATION_ACTION_TYPES.includes(type)) {
    return invalid('Unknown restoration action type.');
  }

  if (type === 'set-target-progress') {
    if (!CLUBHOUSE_CLEANUP_TARGET_IDS.includes(action.targetId)) {
      return invalid('Unknown discrete cleanup target.');
    }
    if (!validProgress(action.progress)) {
      return invalid('Target progress must be a finite number from 0 through 1.');
    }
  } else if (type === 'repair-light') {
    if (!CLUBHOUSE_LIGHT_TARGET_IDS.includes(action.targetId)) {
      return invalid('Unknown repairable light target.');
    }
  } else if (type === 'repair-component') {
    if (!isComponent(action.component)) {
      return invalid('Unknown architecture component.');
    }
    if (!validProgress(action.progress)) {
      return invalid('Repair progress must be a finite number from 0 through 1.');
    }
  } else if (type === 'paint-component') {
    if (!isComponent(action.component)) {
      return invalid('Unknown architecture component.');
    }
    if (!isFinish(action.component, action.finish)) {
      return invalid('Finish is not valid for this component.');
    }
  } else if (type === 'complete-restock-milestone') {
    if (!CLUBHOUSE_RESTOCK_GROUP_IDS.includes(action.groupId)) {
      return invalid('Unknown restock group.');
    }
  } else if (type === 'complete-cleanup-milestone') {
    if (!CLUBHOUSE_CLEANUP_MILESTONE_IDS.includes(action.milestoneId)) {
      return invalid('Unknown cleanup milestone.');
    }
  }

  const reno = ensureClubhouseRestoration(state);
  if (!reno) return invalid('Clubhouse restoration state is unavailable.');

  if (type === 'set-target-progress') {
    const targetId = action.targetId;
    const progress = Math.round(action.progress * 1000) / 1000;
    const current = reno.targetProgress[targetId];
    if (progress <= current) {
      return successfulAction(type, false, { targetId, progress: current });
    }
    try {
      reno.targetProgress[targetId] = progress;
    } catch {
      return invalid('Clubhouse restoration state is read-only.');
    }
    const result = successfulAction(type, true, {
      targetId,
      progress,
      events: [progressEvent(targetId, progress)],
    });
    if (current < 1 && progress >= 1) {
      result.awards.push(awardReputation(
        state,
        targetId,
        'cleanliness',
        0.2,
        `${TARGET_LABELS[targetId]}.`,
      ));
      result.events.push(
        audioEvent('clubhouse-cleanup-complete', targetId),
        toastEvent(`${TARGET_LABELS[targetId]} | Cleanliness +0.2`, 'cleanliness', 0.2, targetId),
      );
      awardFullCleanupIfReady(state, reno, result.awards, result.events);
    }
    return result;
  }

  if (type === 'repair-light') {
    const targetId = action.targetId;
    const panelId = LIGHT_TARGET_TO_PANEL[targetId];
    if (reno.targetProgress[targetId] >= 1 && reno.lightPanels[panelId] === 'working') {
      return successfulAction(type, false, { targetId, panelId, panelState: 'working' });
    }
    // Refuse rather than "succeed" invisibly. Servicing a fitting on a dead
    // ring changes nothing the player can see, and reporting that as a repair
    // is the lie this gate exists to stop.
    if (!ceilingCircuitPowered(state)) {
      return invalid('The ceiling circuit is dead — repair the office power and ceiling first.');
    }
    // A panel costs a kit, like every other repair. Without this the first kit
    // the player ever owns services every panel in the building forever.
    const consumed = consumeSupplyUnit(state, ARCHITECTURE_REPAIR_SKU);
    if (!consumed.ok) return invalid(consumed.reason);
    try {
      reno.targetProgress[targetId] = 1;
      reno.lightPanels[panelId] = 'working';
    } catch {
      // Conserve the spent kit if the state refused the mutation, matching
      // repair-component's discipline — a refused write must not eat supplies.
      try {
        state.shop.inventory[ARCHITECTURE_REPAIR_SKU].back += 1;
      } catch { /* the same read-only state also blocked the consumption */ }
      return invalid('Clubhouse restoration state is read-only.');
    }
    const result = successfulAction(type, true, {
      targetId, panelId, panelState: 'working', consumedFrom: consumed.from,
    });
    result.awards.push(
      awardReputation(
        state,
        `${targetId}:cleanliness`,
        'cleanliness',
        0.2,
        `${TARGET_LABELS[targetId]} and improved clubhouse cleanliness.`,
      ),
      awardReputation(
        state,
        `${targetId}:service`,
        'service',
        0.5,
        `${TARGET_LABELS[targetId]} and improved clubhouse service.`,
      ),
    );
    result.events.push(
      audioEvent('clubhouse-light-repaired', targetId),
      toastEvent(`${TARGET_LABELS[targetId]} | Cleanliness +0.2`, 'cleanliness', 0.2, targetId),
      toastEvent(`${TARGET_LABELS[targetId]} | Service +0.5`, 'service', 0.5, targetId),
    );
    awardFullCleanupIfReady(state, reno, result.awards, result.events);
    return result;
  }

  if (type === 'repair-component') {
    const component = action.component;
    const label = ARCHITECTURE_COMPONENT_LABELS[component];
    const componentState = reno.architecture.components[component];
    if (componentState.restored) {
      return successfulAction(type, false, { component, restored: true, progress: 1 });
    }
    const progress = Math.round(action.progress * 1000) / 1000;
    const current = reno.componentRepairProgress[component];
    if (progress <= current) {
      return successfulAction(type, false, { component, restored: false, progress: current });
    }
    if (progress < 1) {
      try {
        reno.componentRepairProgress[component] = progress;
      } catch {
        return invalid('Clubhouse restoration state is read-only.');
      }
      return successfulAction(type, true, {
        component,
        restored: false,
        progress,
        events: [progressEvent(`repair:${component}`, progress)],
      });
    }
    // The completion edge is where the physical repair components are spent.
    // Failing the consumption leaves the accumulated hold progress in place so
    // the work resumes, not restarts, once components are brought over.
    const consumed = consumeSupplyUnit(state, ARCHITECTURE_REPAIR_SKU);
    if (!consumed.ok) return invalid(consumed.reason);
    const applied = updateArchitectureComponent(state, component, { restored: true });
    if (!applied.ok) {
      // Conserve the spent supply unit if the state refused the mutation.
      try {
        state.shop.inventory[ARCHITECTURE_REPAIR_SKU].back += 1;
      } catch { /* the same read-only state also blocked the consumption */ }
      return applied;
    }
    try {
      reno.componentRepairProgress[component] = 1;
    } catch {
      return invalid('Clubhouse restoration state is read-only.');
    }
    const result = successfulAction(type, true, {
      component,
      restored: true,
      progress: 1,
      consumedFrom: consumed.from,
    });
    result.awards.push(
      awardReputation(
        state,
        `repair:${component}:cleanliness`,
        'cleanliness',
        0.2,
        `${label} repaired and made presentable.`,
      ),
      awardReputation(
        state,
        `repair:${component}:service`,
        'service',
        0.5,
        `${label} repaired and returned to service.`,
      ),
    );
    result.events.push(
      progressEvent(`repair:${component}`, 1),
      audioEvent('clubhouse-component-repaired', `repair:${component}`),
      toastEvent(
        `${label} repaired | Cleanliness +0.2, Service +0.5`,
        'service',
        0.5,
        `repair:${component}`,
      ),
    );
    return result;
  }

  if (type === 'paint-component') {
    const component = action.component;
    const finish = action.finish;
    const label = ARCHITECTURE_COMPONENT_LABELS[component];
    const finishLabel = ARCHITECTURE_FINISH_LABELS[finish] || finish;
    const componentState = reno.architecture.components[component];
    // Paint never repairs: refinishing is only offered on a repaired surface,
    // and applying it never touches the restored flag.
    if (!componentState.restored) {
      return invalid(`${label} must be repaired before it can be refinished.`);
    }
    if (componentState.finish === finish) {
      return successfulAction(type, false, { component, finish, cost: 0 });
    }
    const cost = ARCHITECTURE_PAINT_COSTS[component];
    if (!Number.isFinite(state.cash) || state.cash < cost) {
      return invalid(`Not enough cash to refinish the ${label.toLowerCase()} ($${cost}).`);
    }
    const application = reno.componentPaintApplications[component] + 1;
    const charge = addExpense(state, 'works', cost, {
      idempotencyKey: [
        'clubhouse-paint',
        propertyIdForRestoration(state),
        component,
        application,
      ].join(':'),
      description: `${label} refinished (${finishLabel})`,
      source: 'clubhouse-restoration',
      relatedId: `paint:${component}`,
    });
    if (!charge.ok && !charge.duplicate) {
      return invalid(charge.reason || 'The refinish could not be paid for.');
    }
    const applied = updateArchitectureComponent(state, component, { finish });
    if (!applied.ok) return applied;
    try {
      reno.componentPaintApplications[component] = application;
    } catch {
      return invalid('Clubhouse restoration state is read-only.');
    }
    const result = successfulAction(type, true, {
      component,
      finish,
      cost,
      application,
    });
    result.awards.push(awardReputation(
      state,
      `paint:${component}`,
      'retail',
      0.2,
      `${label} refinished in ${finishLabel}.`,
    ));
    result.events.push(
      audioEvent('clubhouse-paint-applied', `paint:${component}`),
      toastEvent(
        `${label} refinished (${finishLabel}) | -$${cost}`,
        'retail',
        0.2,
        `paint:${component}`,
      ),
    );
    return result;
  }

  if (type === 'complete-restock-milestone') {
    const groupId = action.groupId;
    if (reno.restockMilestones[groupId]) {
      return successfulAction(type, false, { groupId, complete: true });
    }
    try {
      reno.restockMilestones[groupId] = true;
    } catch {
      return invalid('Clubhouse restoration state is read-only.');
    }
    const targetId = `restock:${groupId}`;
    const result = successfulAction(type, true, { groupId, complete: true });
    result.awards.push(awardReputation(
      state,
      targetId,
      'retail',
      0.3,
      `${RESTOCK_LABELS[groupId]}.`,
    ));
    result.events.push(
      audioEvent('clubhouse-restock-complete', targetId),
      toastEvent(`${RESTOCK_LABELS[groupId]} | Retail +0.3`, 'retail', 0.3, targetId),
    );
    return result;
  }

  if (type === 'complete-cleanup-milestone') {
    const milestoneId = action.milestoneId;
    if (reno.cleanupMilestones[milestoneId]) {
      return successfulAction(type, false, { milestoneId, complete: true });
    }
    try {
      reno.cleanupMilestones[milestoneId] = true;
    } catch {
      return invalid('Clubhouse restoration state is read-only.');
    }
    const targetId = `milestone:${milestoneId}`;
    const result = successfulAction(type, true, { milestoneId, complete: true });
    result.awards.push(awardReputation(
      state,
      targetId,
      'cleanliness',
      0.6,
      `${CLEANUP_MILESTONE_LABELS[milestoneId]}.`,
    ));
    result.events.push(
      audioEvent('clubhouse-cleanup-milestone', targetId),
      toastEvent(
        `${CLEANUP_MILESTONE_LABELS[milestoneId]} | Cleanliness +0.6`,
        'cleanliness',
        0.6,
        targetId,
      ),
    );
    awardFullCleanupIfReady(state, reno, result.awards, result.events);
    return result;
  }

  if (!fullCleanupReady(reno)) {
    return invalid('Full cleanup requires every cleanup target, light repair, and cleanup milestone.');
  }
  if (reno.fullCleanupAwarded) {
    return successfulAction(type, false, { complete: true });
  }
  const result = successfulAction(type, false, { complete: true });
  result.changed = awardFullCleanupIfReady(state, reno, result.awards, result.events);
  return result;
}

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

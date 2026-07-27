// SHED SCENE — turns a fresh starter empire into the dirty-maintenance-shed
// test scene: a state recipe (applyShedRecipe) plus the healer that owns
// state.shop.reno.shed (ensureShedScene). THREE-free — sim/data only.
//
// state.shop.reno RENO stays byte-identical (src/sim/shop.js); the recipe
// only zeroes grime cells whose centers fall outside the shed's smaller
// room and reuses every other reno field as-is under the shed's own key.

import { clamp } from '../core/utils.js';
import { newEmpire, buyProperty, activeState } from './empire.js';
import { STARTING_PROPERTY_ID } from './marketplace.js';
import { DAY_START_MIN } from './constants.js';
import { ensureShopReno, RENO } from './shop.js';
import { ensureCampaign, ensureCampaignRepairs } from './campaign.js';
import {
  ARCHITECTURE_COMPONENTS, ensureClubhouseArchitecture, ensureClubhouseRestoration,
  setArchitectureComponent,
} from './clubhouseRestoration.js';
import { placedFixtures, storeFixture } from './layout.js';
import { ensureWash } from './washing.js';
import { ensureCleaningToolState, CLEANING_CAPACITY } from './cleaningToolState.js';
import { SHED_DEBRIS_SEED, TARGET_POSES, insideShedRoom } from '../data/shedLayout.js';

// Every shed cleaning-target id, sourced from the layout's contact-pose map
// so ensureShedScene never hand-duplicates shedCleaning.js's own list.
const SHED_TARGET_KEYS = Object.keys(TARGET_POSES);

/** Repair a new, legacy, partial, or corrupt state.shop.reno.shed in place. */
export function ensureShedScene(state) {
  const reno = state?.shop?.reno;
  if (!reno) return null;
  if (!reno.shed || typeof reno.shed !== 'object' || Array.isArray(reno.shed)) {
    reno.shed = { version: 1, targets: {}, seeded: false, completedAt: null };
  }
  const shed = reno.shed;
  shed.version = 1;
  if (!shed.targets || typeof shed.targets !== 'object' || Array.isArray(shed.targets)) {
    shed.targets = {};
  }
  const targets = shed.targets;
  for (const key of Object.keys(targets)) {
    if (!SHED_TARGET_KEYS.includes(key)) delete targets[key]; // drop unknown keys
  }
  for (const id of SHED_TARGET_KEYS) {
    const value = Number(targets[id]);
    targets[id] = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
  }
  shed.seeded = true;
  shed.completedAt = Number.isFinite(shed.completedAt) ? shed.completedAt : null;
  return shed;
}

// grime cell-center mapping, kept byte-identical to cleanGrimeAt (shop.js)
function maskShedGrime(state) {
  const grime = state.shop.reno.grime;
  const cellW = RENO.room.w / RENO.grid.w;
  const cellD = RENO.room.d / RENO.grid.h;
  for (let cy = 0; cy < RENO.grid.h; cy++) {
    for (let cx = 0; cx < RENO.grid.w; cx++) {
      const x = -RENO.room.w / 2 + (cx + 0.5) * cellW;
      const z = -RENO.room.d / 2 + (cy + 0.5) * cellD;
      const idx = cy * RENO.grid.w + cx;
      if (!insideShedRoom(x, z)) {
        grime[idx] = 0;
      } else if (grime[idx] < 0.4) {
        grime[idx] = clamp(grime[idx], 0.58, 0.95);
      }
    }
  }
}

function zeroShedWash(state) {
  const wash = ensureWash(state);
  if (!wash) return;
  for (const key of Object.keys(wash)) {
    const surface = wash[key];
    if (surface && Array.isArray(surface.grime)) surface.grime = surface.grime.map(() => 0);
  }
}

// Evidence pass found the mop spawns DRY (charge 0) and refuses. Seed a
// fully-serviced loadout directly — this is a fresh test scene, not a
// mid-shift save, so there is no prior usage to preserve.
function seedShedCleaningTools(state) {
  const cleaning = ensureCleaningToolState(state);
  if (!cleaning) return;
  cleaning.mop.charge = CLEANING_CAPACITY.mopCharge;
  cleaning.mop.soil = 0;
  cleaning.bucket.level = CLEANING_CAPACITY.bucketLevel;
  cleaning.bucket.soil = 0;
  cleaning.bucket.water = 'clean';
  cleaning.pan.load = 0;
  cleaning.bag.load = 0;
  cleaning.bag.tied = false;
  cleaning.bag.disposed = 0;
  cleaning.bag.disposedLoad = 0;
  ensureCleaningToolState(state); // re-round/clamp + resync the legacy reno.pan/reno.bag aliases
}

/**
 * Idempotent. Mounts the shed presentation on an already-booted club state:
 * variant, campaign hidden/closed, repairs+architecture pre-restored, zero
 * fixtures, masked grime, cleared clutter, seeded debris/windows/wash,
 * charged cleaning tools, shed targets, and a daylight clock.
 */
export function applyShedRecipe(state) {
  if (!state) return null;
  ensureShopReno(state);
  ensureCampaign(state);

  // presentation variant
  if (!state.property) state.property = {};
  state.property.clubhouseVariant = 'shed';

  // campaign guide hidden; business explicitly forced closed — not just left at
  // fresh-game defaults, so a state whose business was already opened before the
  // recipe ran (e.g. re-applying onto a live save) is still pushed back closed.
  // Idempotent: reassigning the same false is a no-op on repeat application.
  if (state.campaign) {
    state.campaign.hidden = true;
    state.campaign.businessOpen = false;
  }

  // every campaign repair + architecture component restored; componentRepairProgress
  // is re-derived by ensureClubhouseRestoration once every component reads restored
  const architecture = ensureClubhouseArchitecture(state);
  if (architecture) {
    for (const id of ARCHITECTURE_COMPONENTS) setArchitectureComponent(state, id, true);
  }
  ensureClubhouseRestoration(state);
  // ensureCampaignRepairs only seeds entranceDoorRepaired once (guarded on it
  // already being a boolean); force it directly the same way the real
  // workCampaignRepair completion branch does, so the ceiling POWER gate and
  // every CAMPAIGN_REPAIR_JOBS id reads restored.
  ensureCampaignRepairs(state);
  state.shop.reno.entranceDoorRepaired = true;

  // tutorial hidden
  if (!state.tutorial) state.tutorial = {};
  state.tutorial.complete = true;
  state.tutorial.hidden = true;

  // zero fixtures: store every fixture the interior would otherwise place
  for (const fixture of placedFixtures(state)) storeFixture(state, fixture.id);

  // grime mask: shed footprint stays dirty, everything outside it goes to 0
  maskShedGrime(state);

  // every clutter pile already hauled out
  for (const pile of state.shop.reno.clutter || []) pile.cleared = true;

  // deterministic debris seed
  state.shop.reno.debris = SHED_DEBRIS_SEED.map((cluster) => ({ ...cluster }));
  state.shop.reno.debrisSeeded = true;

  // two real shed panes clean-ish, the other two (unused in the shed) already clear
  state.shop.reno.windows = [0.85, 0.78, 0, 0];

  // exterior wash grime zeroed (structure, incl. soap arrays, left intact)
  zeroShedWash(state);

  // shed cleaning-target tracking
  ensureShedScene(state);

  // cleaning tool loadout: charged mop, clean bucket, empty pan/bag
  seedShedCleaningTools(state);

  // daylight
  state.clock.minutes = DAY_START_MIN + 9 * 60;

  return state;
}

/**
 * A fresh empire via the same path the QA bootstrap uses (newEmpire + buy
 * the starting property, falling back to the first listing if the id ever
 * changes), with the shed recipe applied to the resulting active state.
 */
export function buildShedEmpire(seed = 1) {
  const empire = newEmpire('relaxed', seed);
  const first = empire.market.find((listing) => listing.id === STARTING_PROPERTY_ID) || empire.market[0];
  const bought = buyProperty(empire, first.id);
  if (!bought.ok) throw new Error(`Could not seed the shed empire: ${bought.reason}`);
  applyShedRecipe(activeState(empire));
  return empire;
}

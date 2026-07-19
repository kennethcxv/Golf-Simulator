// FAIRWAY STATE — the single serializable GameState and its master tick.
// Everything the game *is* lives in this object; rendering and UI only read it
// and call command functions. All randomness flows through state.rngState so a
// loaded save resumes the exact same stream.

import { makeRng, rngOf } from '../core/utils.js';
import { labelSections, ensureCourseShape } from './course.js';
import { buildStartingCourse } from './startingCourse.js';
import { GRID_W, GRID_H, HOLE_STATUS, ZONE, ZONE_MAX_ID } from './constants.js';
import { plantVegetation } from './courseShaping.js';
import { newClock, advanceClock, calendarOf } from './time.js';
import { tickRenovationsDaily } from './terrainEdit.js';
import { newWeather, rollDailyWeather } from './weather.js';
import { initTurf, turfHourlyTick, turfDailyTick, runMorningMaintenance, defaultPolicies } from './turf.js';
import { initGolfers } from './golfers.js';
import { initStaff, tickStaffDaily, refreshMarketIfDue } from './staff.js';
import { initClub, dailyMembershipTick, accrueDaily } from './club.js';
import { initShop, shopDailyAccrual, deliverOrdersDue, tickDeliveries, ensureShopReno, RENO } from './shop.js';
import { recoverCheckout } from './checkout.js';
import { migrateDrawer, newDrawer } from './register.js';
import { ensurePaymentBag, paymentBagStats } from './paymentBag.js';
import { ensureWash } from './washing.js';
import { ensureWet, wetGridForRoom } from './cleaningWet.js';
import { ensureDebris } from './cleaningDebris.js';
import { ensureLayout } from './layout.js';
import { ensureClubhouseArchitecture } from './clubhouseRestoration.js';
import { ensureProperty, tickProperty } from './property.js';
import {
  initReservations, ensureReservations, reservationsDailyTick,
  generateOnlineReservations, processReservationTimeline,
} from './reservations.js';
import {
  initCustomerDirectory, ensureCustomerDirectory, reconcileReservationCustomerIdentities,
} from './customerIdentity.js';
import { initTractor, ensureTractor } from './tractor.js';
import { bunkerDailyMess } from './bunkers.js';
import { initCourseProps, ensureCourseProps } from './props.js';
import { simulateDayRounds } from './rounds.js';
import { initProgression, prestigeDailyTick, resolveTournamentIfDue, solvencyDailyTick } from './progression.js';
import { initTutorial, ensureTutorial } from './tutorial.js';
import { initLedger, addExpense, closeBooks } from './economy.js';
import { initNotifications, ensureNotifications } from './notifications.js';
import { BALANCE } from './balance.js';
import { SHOP_CATALOG } from '../data/shopItems.js';
import { capacityOf, homeFixture } from '../data/fixtureSlots.js';
import { routesIntact, validatePlacement } from './layout.js';
import {
  SaveCompatibilityError,
  cloneSaveValue,
  createSaveReport,
  dedupeRecords,
  finishSaveReport,
  finiteNumber,
  isRecord,
  mergeSaveDefaults,
  noteMigration,
  noteRepair,
  parseSaveInput,
  recordsOnly,
} from './saveValidation.js';

export { rngOf }; // re-export: rngOf lives in core/utils to avoid import cycles

// v6: course.vec (the authored vector design) + course.paint joined the save.
// v7: legacy grid courses remain authoritative on migration. Loading an old
// save may add compatibility fields, but never replaces the player's zones,
// elevation, holes, placed objects, paths, or cell-for-cell turf state.
// v8: authored fixture capacity is authoritative for persisted shelf stock.
// Overflow moves to the backroom, and legacy saves restore the feature table
// that became the rangefinder's sellable home in the Sheet-03 retail pass.
// v9: the rangefinder feature promotes accessories instead of balls. Saves
// written before this version migrate the old default once, leaving future
// explicit merchandising choices authoritative.
// v10: fixture poses written against older approximate envelopes are checked
// once against the authored footprints. Only unsafe moved overrides fall back
// to the designed plan; valid player moves and all inventory remain untouched.
// v11: every persisted domain passes one validation/migration boundary before
// feature-owned healers run. Wetness/solution and all cleaning loads now survive
// an interrupted cleaning save, duplicate authorities are reconciled once, and
// future schemas are refused instead of being silently downgraded.
export const SAVE_VERSION = 11;

export const MIN_SUPPORTED_SAVE_VERSION = 1;
export const SAVE_MIGRATIONS = Object.freeze([
  Object.freeze({ version: 2, name: 'turf-and-maintenance' }),
  Object.freeze({ version: 3, name: 'club-and-shop' }),
  Object.freeze({ version: 4, name: 'customer-and-reservations' }),
  Object.freeze({ version: 5, name: 'course-editor-objects' }),
  Object.freeze({ version: 6, name: 'course-vector-and-paint' }),
  Object.freeze({ version: 7, name: 'non-destructive-legacy-course' }),
  Object.freeze({ version: 8, name: 'authored-fixture-capacity' }),
  Object.freeze({ version: 9, name: 'rangefinder-feature-category' }),
  Object.freeze({ version: 10, name: 'authored-fixture-footprints' }),
  Object.freeze({ version: 11, name: 'validated-lifecycle-state' }),
]);

const CLEANING_FIELD = wetGridForRoom(RENO.room);

const ROUTE_FAILURE = /customers could not get around/i;

// Keep every owned unit while making the serialized inventory agree with the
// physical display. Older builds allowed category caps (often 16/24) to exceed
// the number of authored product sockets. The excess is stockroom inventory,
// never discarded inventory.
function reconcileShelfCapacity(shop) {
  if (!shop || !shop.inventory) return;
  for (const sku of SHOP_CATALOG) {
    const inventory = shop.inventory[sku.id];
    if (!inventory) continue;
    const capacity = Math.max(0, capacityOf(sku.id));
    if (!Number.isFinite(inventory.shelf) || inventory.shelf <= capacity) continue;
    const excess = inventory.shelf - capacity;
    inventory.shelf = capacity;
    inventory.back = (Number.isFinite(inventory.back) ? inventory.back : 0) + excess;
  }
}

function migrateLegacyRetailLayout(shop, persistedVersion) {
  // Before v8 the entrance feature was decorative/nonstocking, so storing it
  // could hide no merchandise. It now owns range2's only physical facing. Heal
  // that legacy choice once; a v8+ player who intentionally stows an empty case
  // keeps that choice across every subsequent load.
  if (persistedVersion >= 8 || !Array.isArray(shop?.layout?.stored)) return;
  shop.layout.stored = shop.layout.stored.filter((fixtureId) => fixtureId !== 'feature');
}

function migrateFeatureCategory(shop, persistedVersion) {
  if (persistedVersion < 9 && shop?.featureCategory === 'balls') {
    shop.featureCategory = 'accessories';
  }
}

// Fixture envelopes became more exact over several retail passes (notably the
// asymmetric shoe wall and the authored apparel table), and hand-edited saves
// can carry the same impossible overlaps at any schema version. Validate every
// persisted override and delete only unsafe poses: the sparse layout then
// resolves that fixture to its known-safe authored default without changing
// inventory, stored state, or valid player moves.
function reconcileMovedFixturePoses(state, report) {
  const moved = state.shop?.layout?.moved;
  if (!moved || typeof moved !== 'object' || Array.isArray(moved)) return;

  const ids = Object.keys(moved);
  let repairedRotation = false;
  for (const id of ids) {
    const pose = moved[id];
    if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z)) {
      delete moved[id];
      continue;
    }
    if (!Number.isFinite(pose.ry)) {
      pose.ry = 0;
      repairedRotation = true;
    }
  }

  // A route-only failure can be caused by a different corrupt legacy pose.
  // Remove direct footprint/wall/fixture failures first, repeating because an
  // authored fallback can expose a second collision in the remaining plan.
  let removedDirectPose;
  do {
    removedDirectPose = false;
    for (const id of ids) {
      const pose = moved[id];
      if (!pose) continue;
      const result = validatePlacement(state, id, pose.x, pose.z, pose.ry);
      if (result.ok || result.reasons.every((reason) => ROUTE_FAILURE.test(reason))) continue;
      delete moved[id];
      removedDirectPose = true;
    }
  } while (removedDirectPose);

  // Once all direct faults are gone, attribute a remaining route failure by
  // testing the authored fallback for each legacy override. This preserves all
  // unrelated moves when one pose alone blocks a required shop route.
  let removedRoutePose = true;
  while (!routesIntact(state) && removedRoutePose) {
    removedRoutePose = false;
    for (const id of ids) {
      const pose = moved[id];
      if (!pose) continue;
      delete moved[id];
      if (routesIntact(state)) {
        removedRoutePose = true;
        break;
      }
      moved[id] = pose;
    }
  }

  // Multiple legacy overrides can jointly cut a route even when no single
  // fallback repairs it. Rebuild that rare case from the safe authored plan,
  // retaining each override only when the normal placement rules accept it.
  if (!routesIntact(state)) {
    const candidates = ids
      .filter((id) => moved[id])
      .map((id) => [id, moved[id]]);
    for (const [id] of candidates) delete moved[id];
    for (const [id, pose] of candidates) {
      if (validatePlacement(state, id, pose.x, pose.z, pose.ry).ok) moved[id] = pose;
    }
  }
  const removed = ids.filter((id) => !moved[id]);
  if (removed.length) {
    noteRepair(report, '$.shop.layout.moved', `${removed.length} unsafe fixture pose(s) removed`);
  }
  if (repairedRotation) {
    noteRepair(report, '$.shop.layout.moved', 'invalid fixture rotations normalized');
  }
}

// A stored authored fixture has no shelf in the world. Crafted/interrupted
// saves may still contain shelf units there, so conservatively return every
// such unit to back stock. Checkout-held units are recovered first and use the
// same fixture-presence rule; this final pass also heals already-persisted
// shelf counts without minting or discarding anything.
function reconcileStoredFixtureStock(shop) {
  if (!shop?.inventory || !Array.isArray(shop?.layout?.stored)) return;
  const stored = new Set(shop.layout.stored);
  for (const sku of SHOP_CATALOG) {
    const fixture = homeFixture(sku.id);
    const inventory = shop.inventory[sku.id];
    if (!fixture || !stored.has(fixture.id) || !inventory) continue;
    const shelf = Number.isFinite(inventory.shelf) ? inventory.shelf : 0;
    if (shelf <= 0) continue;
    inventory.shelf = 0;
    inventory.back = (Number.isFinite(inventory.back) ? inventory.back : 0) + shelf;
  }
}

// opts lets the GOLF EMPIRE layer boot this same fresh-club wiring onto a
// marketplace property: an injected course grid and club name, nothing else.
export function newGame(mode = 'relaxed', seed = Date.now() % 2147483647, opts = {}) {
  const rng = makeRng(seed);
  const course = ensureCourseShape(opts.course || buildStartingCourse(rng));
  const state = {
    version: SAVE_VERSION,
    mode, // 'relaxed' | 'realistic'
    seed,
    rngState: rng.getState(),
    clock: newClock(),
    cash: BALANCE.startingCash[mode],
    clubName: opts.clubName || 'Willow Creek Golf Club',
    course,
    sections: labelSections(course), // derived cache, rebuilt on load/edit
    weather: newWeather(),
    pendingMorning: true, // maintenance pass runs at the first 5 AM
  };
  // day-1 weather + turf initial condition draw from the same seeded stream
  rollDailyWeather(state.weather, rngOf(state), calendarOf(state.clock.minutes).dayOfYear);
  initTurf(state);
  initGolfers(state);
  initStaff(state);
  initClub(state);
  initShop(state);
  reconcileShelfCapacity(state.shop);
  // Persisted register authorities exist from the first save, not only after
  // the renderer happens to construct the clubhouse or register. Fixture
  // layout stays lazy because read-only placement queries must remain pure.
  state.shop.drawer = newDrawer();
  ensurePaymentBag(state);
  ensureShopReno(state);
  ensureClubhouseArchitecture(state);
  ensureDebris(state);
  state.shop.reno.pan = 0;
  state.shop.reno.bag = 0;
  ensureWet(state, CLEANING_FIELD.w, CLEANING_FIELD.h);
  ensureWash(state); // a fixer-upper arrives with a filthy exterior
  ensureProperty(state); // ...and a landlord
  initReservations(state);
  initCustomerDirectory(state);
  initTractor(state);
  initCourseProps(state);
  initLedger(state);
  initProgression(state);
  initTutorial(state);
  initNotifications(state);
  state.uiPrefs = {};
  if (!Array.isArray(state.club.reviews)) state.club.reviews = [];
  return state;
}

// --- master tick --------------------------------------------------------------

export function dailyTick(state) {
  // 1) settle the day that just ended: accrue its recurring economy, close books
  if (state.ledger) {
    accrueDaily(state);
    if (state.shop) shopDailyAccrual(state);
    if (state.golfers) simulateDayRounds(state, state.club.lastRounds || 0);
    if (state.progression) resolveTournamentIfDue(state, calendarOf(state.clock.minutes).dayAbs - 1);
    // the rent falls due whether or not it was a good week; it is announced two days out
    state.lastPropertyEvent = tickProperty(state, calendarOf(state.clock.minutes).dayAbs);
    closeBooks(state, calendarOf(state.clock.minutes).dayAbs - 1);
  }

  // 2) roll into the new day
  if (!state.weather.locked) {
    rollDailyWeather(state.weather, rngOf(state), calendarOf(state.clock.minutes).dayOfYear);
  } else {
    // locked weather still tracks drought for tests/scenarios
    state.weather.droughtDays = state.weather.today.rainIn > 0 ? 0 : state.weather.droughtDays + 1;
  }
  tickRenovationsDaily(state);
  turfDailyTick(state);
  if (state.staff) {
    tickStaffDaily(state);
    refreshMarketIfDue(state, calendarOf(state.clock.minutes).dayAbs);
  }
  if (state.club) dailyMembershipTick(state);
  if (state.shop) deliverOrdersDue(state, calendarOf(state.clock.minutes).dayAbs);
  if (state.reservations) reservationsDailyTick(state, calendarOf(state.clock.minutes).dayAbs);
  if (state.reservations) {
    const todayAbs = calendarOf(state.clock.minutes).dayAbs;
    if (state.reservations.lastOnlineGenerationDayAbs !== todayAbs) {
      state.reservations.lastOnlineGenerationDayAbs = todayAbs;
      generateOnlineReservations(state, {
        dayAbs: todayAbs + 2,
        count: 3,
        minGroupSize: 1,
        maxGroupSize: 4,
      });
    }
  }
  if (state.turf) bunkerDailyMess(state); // yesterday's traffic footprints the sand
  if (state.progression) {
    prestigeDailyTick(state);
    solvencyDailyTick(state);
  }
  state.pendingMorning = true;
}

export function hourlyTick(state, hourOfDay) {
  if (state.shop) tickDeliveries(state, state.clock.minutes); // windowed trucks land on time headless too
  // the crew starts at 5 AM; catch up later in the morning if time skipped past it
  if (state.pendingMorning && hourOfDay >= 5) {
    state.pendingMorning = false;
    const report = runMorningMaintenance(state, calendarOf(state.clock.minutes).dayAbs);
    if (report) {
      if (state.ledger) {
        addExpense(state, 'wagesDayLabor', report.costs.wages);
        addExpense(state, 'water', report.costs.water);
        addExpense(state, 'fertilizer', report.costs.fertilizer);
      } else {
        state.cash -= Math.round(report.costs.wages + report.costs.water + report.costs.fertilizer);
      }
    }
  }
  turfHourlyTick(state, hourOfDay);
}

export function update(state, gameMinutes) {
  // advance the clock INCREMENTALLY so every hourly/daily tick reads the calendar
  // at its own moment — batching several days into one update must behave exactly
  // like living through them (maintenance day-stamps, outing dates, book closes)
  const target = state.clock.minutes + gameMinutes;
  let daysPassed = 0;
  for (;;) {
    const nextHourMin = (Math.floor(state.clock.minutes / 60) + 1) * 60;
    if (nextHourMin > target) break;
    state.clock.minutes = nextHourMin;
    const hourOfDay = ((Math.floor(nextHourMin / 60) % 24) + 24) % 24;
    if (hourOfDay === 0) {
      dailyTick(state);
      daysPassed++;
    }
    hourlyTick(state, hourOfDay);
    if (state.reservations) processReservationTimeline(state, { at: nextHourMin, chargeFees: true });
  }
  state.clock.minutes = target;
  if (state.reservations) processReservationTimeline(state, { at: target, chargeFees: true });
  return { daysPassed };
}

// --- persistence ----------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10;

// Cleaning fields are short-lived, but a save taken during the spray/mop loop
// must resume what the player can still see. Quantizing to three decimals keeps
// the precision the cleaning simulation writes while avoiding float noise.
function shopForSave(shop) {
  if (!shop || !shop.reno) return shop;
  const reno = { ...shop.reno };
  if (Array.isArray(reno.wet)) reno.wet = reno.wet.map((value) => Math.round(value * 1000) / 1000);
  if (Array.isArray(reno.solution)) {
    reno.solution = reno.solution.map((value) => Math.round(value * 1000) / 1000);
  }
  return { ...shop, reno };
}

export function snapshot(state) {
  // Reservations keep compatibility name fields for old UI, but the directory
  // is their sole identity authority. Reconcile before every persisted snapshot.
  reconcileReservationCustomerIdentities(state);
  const { course, turf } = state;
  return ({
    version: SAVE_VERSION,
    mode: state.mode,
    seed: state.seed,
    rngState: state.rngState,
    clock: { minutes: state.clock.minutes },
    cash: Number.isFinite(state.cash) ? Math.round(state.cash * 100) / 100 : 0,
    clubName: state.clubName,
    pendingMorning: state.pendingMorning,
    course: {
      w: course.w,
      h: course.h,
      zones: Array.from(course.zones),
      elevation: Array.from(course.elevation, (v) => Math.round(v * 100) / 100),
      holes: course.holes,
      nextHoleId: course.nextHoleId,
      structures: course.structures,
      objects: course.objects ? course.objects.map((o) => ({
        ...o,
        // Editor snap increments are expressed in real yards. One yard is
        // 0.125 simulation cells, so two-decimal cell rounding visibly moved
        // snapped props after a reload.
        x: Math.round(o.x * 1000) / 1000,
        y: Math.round(o.y * 1000) / 1000,
        rot: Math.round(o.rot * 1000) / 1000,
        scale: Math.round(o.scale * 100) / 100,
      })) : [],
      nextObjectId: course.nextObjectId || 1,
      paths: course.paths ? course.paths.map((p) => ({
        ...p,
        pts: p.pts.map((q) => ({ x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 })),
      })) : [],
      nextPathId: course.nextPathId || 1,
      vec: course.vec || null,
      paint: course.paint && course.paint.some((v) => v !== 255) ? Array.from(course.paint) : null,
    },
    weather: {
      today: state.weather.today,
      droughtDays: state.weather.droughtDays,
      bias: state.weather.bias,
    },
    maintenance: state.maintenance,
    golfers: state.golfers,
    staff: state.staff,
    club: state.club,
    ledger: state.ledger,
    shop: shopForSave(state.shop),
    reservations: state.reservations,
    customerDirectory: state.customerDirectory,
    tractor: state.tractor,
    props: state.props,
    progression: state.progression,
    tutorial: state.tutorial,
    notifications: state.notifications, // unread warnings survive the reload
    uiPrefs: state.uiPrefs || null, // the office machine's own settings (scale, default views)
    property: state.property, // the rent schedule, or reloading is a rent holiday
    debtDays: state.debtDays || 0,
    failed: state.failed || null,
    turf: turf
      ? {
          health: Array.from(turf.health, round1),
          moisture: Array.from(turf.moisture, round1),
          nutrients: Array.from(turf.nutrients, round1),
          heightMm: Array.from(turf.heightMm, round1),
          wear: Array.from(turf.wear, round1),
          disType: Array.from(turf.disType),
          disSev: Array.from(turf.disSev, round1),
          treated: Array.from(turf.treated),
        }
      : null,
  });
}

// A NaN that ever reached the books serializes to JSON null and reloads as a
// hole every Finances page and close-of-books trips over. Money lines are
// numbers; anything else in a number slot heals to zero on load.
function healLedger(ledger) {
  const healLines = (lines, depth = 0) => {
    if (!lines || typeof lines !== 'object' || depth > 3) return lines;
    for (const k of Object.keys(lines)) {
      const v = lines[k];
      if (typeof v === 'number' || v === null) {
        if (!Number.isFinite(v)) lines[k] = 0;
      } else if (typeof v === 'object') {
        healLines(v, depth + 1);
      }
    }
    return lines;
  };
  healLines(ledger.today);
  healLines(ledger.yesterday);
  if (Array.isArray(ledger.history)) ledger.history.forEach((entry) => healLines(entry));
  // the transaction log: keep only well-formed rows, heal their money numbers
  if (!Array.isArray(ledger.txLog)) ledger.txLog = [];
  ledger.txLog = ledger.txLog
    .filter((t) => t && typeof t === 'object' && typeof t.key === 'string')
    .map((t) => ({
      m: Number.isFinite(t.m) ? t.m : 0,
      kind: t.kind === 'rev' || t.kind === 'refund' ? t.kind : 'exp',
      key: t.key,
      amt: Number.isFinite(t.amt) ? t.amt : 0,
      bal: Number.isFinite(t.bal) ? t.bal : 0,
    }));
  return ledger;
}

export function serialize(state) {
  return JSON.stringify(snapshot(state));
}

// Preserve a valid persisted allocator even when it intentionally leaves gaps,
// but repair missing/stale counters so the next editor operation cannot reuse
// an existing id. Existing records are never removed or renumbered.
function safeNextId(items, persisted) {
  const highest = (items || []).reduce((max, item) => {
    const id = Number(item && item.id);
    return Number.isSafeInteger(id) && id > max ? id : max;
  }, 0);
  return Number.isSafeInteger(persisted) && persisted > highest ? persisted : highest + 1;
}

const MAX_COURSE_CELLS = 512 * 512;
const MAX_SAVE_RECORDS = 100_000;

function normalizeMode(value) {
  return value === 'realistic' ? 'realistic' : 'relaxed';
}

function normalizeSeed(value) {
  const seed = finiteNumber(value, 1, { integer: true, min: 1, max: 2147483647 });
  return seed || 1;
}

function normalizeNumericArray(value, defaults, Type, report, path, transform = (number) => number) {
  const source = Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))
    ? value
    : null;
  const length = defaults.length;
  const out = Type === Array ? new Array(length) : new Type(length);
  let repaired = !source || source.length !== length;
  for (let index = 0; index < length; index += 1) {
    const number = source ? Number(source[index]) : NaN;
    if (Number.isFinite(number)) {
      const transformed = transform(number, index);
      if (!Number.isFinite(transformed)) {
        out[index] = defaults[index];
        repaired = true;
      } else {
        out[index] = transformed;
        if (typeof source[index] !== 'number' || !Object.is(transformed, number)) repaired = true;
      }
    } else {
      out[index] = defaults[index];
      if (source && index < source.length) repaired = true;
    }
  }
  if (repaired) noteRepair(report, path, `normalized to ${length} finite value(s)`);
  return out;
}

function finiteSave(value, fallback, options, report, path) {
  const normalized = finiteNumber(value, fallback, options);
  if (typeof value !== 'number' || !Number.isFinite(value) || !Object.is(normalized, value)) {
    noteRepair(report, path, 'invalid or out-of-range number normalized');
  }
  return normalized;
}

function normalizeIds(value, report, path, {
  accept = () => true,
  max = MAX_SAVE_RECORDS,
  duplicate = 'reassign',
} = {}) {
  const source = recordsOnly(value, report, path, { max });
  const valid = [];
  let removed = 0;
  for (const entry of source) {
    const clone = cloneSaveValue(entry, null);
    if (!clone || !accept(clone)) {
      removed += 1;
      continue;
    }
    valid.push(clone);
  }
  let next = valid.reduce((greatest, entry) => (
    Number.isSafeInteger(entry.id) && entry.id > 0 ? Math.max(greatest, entry.id) : greatest
  ), 0) + 1;
  const used = new Set();
  const normalized = [];
  let reassigned = 0;
  let duplicates = 0;
  for (const entry of valid) {
    const hasValidId = Number.isSafeInteger(entry.id) && entry.id > 0;
    if (hasValidId && used.has(entry.id) && duplicate === 'drop') {
      duplicates += 1;
      continue;
    }
    if (!hasValidId || used.has(entry.id)) {
      while (used.has(next)) next += 1;
      entry.id = next++;
      reassigned += 1;
    }
    used.add(entry.id);
    normalized.push(entry);
  }
  if (removed) noteRepair(report, path, `${removed} unusable record(s) removed`);
  if (duplicates) noteRepair(report, path, `${duplicates} duplicate authority record(s) removed`);
  if (reassigned) noteRepair(report, path, `${reassigned} duplicate or invalid id(s) reassigned`);
  return normalized;
}

function normalizePoint(value, report = null, path = '$') {
  if (!isRecord(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  const x = finiteNumber(value.x, 0, { min: -10_000, max: 10_000 });
  const y = finiteNumber(value.y, 0, { min: -10_000, max: 10_000 });
  if (!Object.is(x, value.x) || !Object.is(y, value.y)) {
    noteRepair(report, path, 'out-of-range point coordinates normalized');
  }
  return { ...value, x, y };
}

function normalizePointArray(value, minimum, report, path, { max = 20_000 } = {}) {
  if (!Array.isArray(value)) {
    noteRepair(report, path, 'missing or invalid point array removed');
    return null;
  }
  const points = [];
  let coordinatesRepaired = false;
  for (let index = 0; index < Math.min(value.length, max); index += 1) {
    const source = value[index];
    const point = normalizePoint(source, report, `${path}[${index}]`);
    if (!point) continue;
    if (!Object.is(point.x, source.x) || !Object.is(point.y, source.y)) coordinatesRepaired = true;
    points.push(point);
  }
  if (points.length !== value.length) noteRepair(report, path, 'invalid or excess points removed');
  if (coordinatesRepaired) noteRepair(report, path, 'out-of-range point coordinates normalized');
  if (points.length < minimum) {
    noteRepair(report, path, `feature requires at least ${minimum} valid point(s)`);
    return null;
  }
  return points;
}

function normalizeVecHole(hole, report, path) {
  const line = normalizePointArray(hole.line, 2, report, `${path}.line`);
  if (!line) return null;
  hole.line = line;
  hole.name = typeof hole.name === 'string' ? hole.name.slice(0, 200) : '';
  hole.par = finiteSave(hole.par, 4, { integer: true, min: 3, max: 5 }, report, `${path}.par`);
  hole.hcp = finiteSave(hole.hcp, 1, { integer: true, min: 1, max: 18 }, report, `${path}.hcp`);
  hole.roughW = finiteSave(hole.roughW, 26, { min: 1, max: 200 }, report, `${path}.roughW`);

  if (Array.isArray(hole.width)) {
    const width = [];
    let repaired = hole.width.length > 1000;
    for (const stop of hole.width.slice(0, 1000)) {
      if (!isRecord(stop) || !Number.isFinite(stop.t) || !Number.isFinite(stop.w)) {
        repaired = true;
        continue;
      }
      const normalized = {
        ...stop,
        t: finiteNumber(stop.t, 0, { min: 0, max: 1 }),
        w: finiteNumber(stop.w, 8, { min: 0.1, max: 500 }),
      };
      if (!Object.is(normalized.t, stop.t) || !Object.is(normalized.w, stop.w)) repaired = true;
      width.push(normalized);
    }
    const originalOrder = width.map((stop) => stop.t);
    width.sort((a, b) => a.t - b.t);
    if (width.some((stop, index) => !Object.is(stop.t, originalOrder[index]))) repaired = true;
    if (repaired) noteRepair(report, `${path}.width`, 'invalid or unordered width stops normalized');
    if (width.length) hole.width = width;
    else delete hole.width;
  } else if (hole.width != null) {
    delete hole.width;
    noteRepair(report, `${path}.width`, 'invalid width profile removed');
  }

  if (Array.isArray(hole.tees)) {
    const tees = [];
    let repaired = hole.tees.length > 100;
    for (let index = 0; index < Math.min(hole.tees.length, 100); index += 1) {
      const tee = hole.tees[index];
      const point = normalizePoint(tee, report, `${path}.tees[${index}]`);
      if (!point) continue;
      const normalized = {
        ...point,
        rot: finiteNumber(tee.rot, 0, { min: -Math.PI * 8, max: Math.PI * 8 }),
        tier: typeof tee.tier === 'string' ? tee.tier.slice(0, 40) : 'back',
        w: finiteNumber(tee.w, 8, { min: 0.1, max: 500 }),
        d: finiteNumber(tee.d, 10, { min: 0.1, max: 500 }),
        ...(Number.isFinite(tee.raise)
          ? { raise: finiteNumber(tee.raise, 0, { min: -100, max: 100 }) }
          : {}),
      };
      if (!Object.is(normalized.rot, tee.rot) || normalized.tier !== tee.tier
          || !Object.is(normalized.w, tee.w) || !Object.is(normalized.d, tee.d)
          || (Number.isFinite(tee.raise) && !Object.is(normalized.raise, tee.raise))) repaired = true;
      tees.push(normalized);
    }
    if (tees.length !== hole.tees.length) repaired = true;
    if (repaired) noteRepair(report, `${path}.tees`, 'invalid tee records normalized');
    hole.tees = tees;
  } else if (hole.tees != null) {
    hole.tees = [];
    noteRepair(report, `${path}.tees`, 'invalid tee array defaulted');
  }

  if (hole.green != null) {
    if (!isRecord(hole.green)) {
      hole.green = null;
      noteRepair(report, `${path}.green`, 'invalid green removed');
    } else {
      const pts = normalizePointArray(hole.green.pts, 3, report, `${path}.green.pts`);
      if (!pts) {
        hole.green = null;
      } else {
        const cx = pts.reduce((sum, point) => sum + point.x, 0) / pts.length;
        const cy = pts.reduce((sum, point) => sum + point.y, 0) / pts.length;
        const pinsWereArray = Array.isArray(hole.green.pins);
        const pins = pinsWereArray
          ? normalizePointArray(hole.green.pins, 0, report, `${path}.green.pins`, { max: 100 }) || []
          : [];
        hole.green = {
          ...hole.green,
          pts,
          cx: finiteSave(hole.green.cx, cx, { min: -10_000, max: 10_000 }, report, `${path}.green.cx`),
          cy: finiteSave(hole.green.cy, cy, { min: -10_000, max: 10_000 }, report, `${path}.green.cy`),
          fringe: finiteSave(hole.green.fringe, 1, { min: 0, max: 100 }, report, `${path}.green.fringe`),
          raise: finiteSave(hole.green.raise, 0, { min: -100, max: 100 }, report, `${path}.green.raise`),
          pins,
        };
        if (!pinsWereArray) {
          noteRepair(report, `${path}.green.pins`, 'invalid pin array defaulted');
        }
      }
    }
  }

  const bunkers = [];
  if (Array.isArray(hole.bunkers)) {
    for (let index = 0; index < Math.min(hole.bunkers.length, 1000); index += 1) {
      const bunker = hole.bunkers[index];
      if (!isRecord(bunker)) continue;
      const pts = normalizePointArray(
        bunker.pts, 3, report, `${path}.bunkers[${index}].pts`, { max: 2000 },
      );
      if (!pts) continue;
      bunkers.push({
        ...bunker,
        pts,
        depth: finiteSave(bunker.depth, 2.4, { min: 0, max: 100 }, report, `${path}.bunkers[${index}].depth`),
        lip: finiteSave(bunker.lip, 0.9, { min: 0, max: 100 }, report, `${path}.bunkers[${index}].lip`),
      });
    }
  }
  if (!Array.isArray(hole.bunkers) || bunkers.length !== hole.bunkers.length) {
    noteRepair(report, `${path}.bunkers`, 'invalid bunker records removed');
  }
  hole.bunkers = bunkers;
  return hole;
}

function normalizeHole(hole, report, path) {
  for (const key of ['tee', 'pin']) {
    if (hole[key] == null) continue;
    const point = normalizePoint(hole[key], report, `${path}.${key}`);
    if (!point) noteRepair(report, `${path}.${key}`, 'invalid point cleared');
    hole[key] = point;
  }
  for (const [containerKey, names] of [['tees', ['back', 'middle', 'forward']], ['pins', ['A', 'B', 'C']]]) {
    if (!isRecord(hole[containerKey])) continue;
    const normalized = {};
    for (const name of names) {
      const source = hole[containerKey][name];
      normalized[name] = normalizePoint(
        source, report, `${path}.${containerKey}.${name}`,
      );
      if (source != null && !normalized[name]) {
        noteRepair(report, `${path}.${containerKey}.${name}`, 'invalid point cleared');
      }
    }
    hole[containerKey] = normalized;
  }
  const validStatuses = new Set(Object.values(HOLE_STATUS));
  if (!validStatuses.has(hole.status)) {
    hole.status = HOLE_STATUS.UNBUILT;
    noteRepair(report, `${path}.status`, 'invalid hole status normalized');
  }
  hole.daysLeft = finiteSave(hole.daysLeft, 0, {
    integer: true, min: 0, max: 1_000_000,
  }, report, `${path}.daysLeft`);
  if (typeof hole.everOpen !== 'boolean') {
    hole.everOpen = !!hole.everOpen;
    noteRepair(report, `${path}.everOpen`, 'invalid open-history flag normalized');
  }
  if (hole.parOverride != null) {
    hole.parOverride = finiteSave(hole.parOverride, 4, {
      integer: true, min: 3, max: 5,
    }, report, `${path}.parOverride`);
  }
  return hole;
}

function normalizeCourseVector(value, seed, report) {
  if (!isRecord(value)) return null;
  const vector = cloneSaveValue(value, null);
  if (!vector) return null;
  vector.v = finiteSave(vector.v, 1, {
    integer: true, min: 1, max: 1000,
  }, report, '$.course.vec.v');
  vector.seed = finiteSave(vector.seed, seed, {
    integer: true, min: 1, max: 2147483647,
  }, report, '$.course.vec.seed');
  vector.holes = normalizeIds(vector.holes, report, '$.course.vec.holes', {
    max: 1000,
    accept: (hole) => !!normalizeVecHole(hole, report, '$.course.vec.holes[]'),
  });
  const polygonFeatures = (key, minimum, max) => normalizeIds(
    vector[key], report, `$.course.vec.${key}`, {
      max,
      accept: (feature) => {
        const pts = normalizePointArray(
          feature.pts, minimum, report, `$.course.vec.${key}[].pts`, { max: 20_000 },
        );
        if (!pts) return false;
        feature.pts = pts;
        if (key === 'waters') {
          feature.depth = finiteSave(feature.depth, 4.5, {
            min: 0, max: 1000,
          }, report, '$.course.vec.waters[].depth');
          const kind = typeof feature.kind === 'string' && feature.kind.trim()
            ? feature.kind.slice(0, 80)
            : 'pond';
          if (kind !== feature.kind) {
            noteRepair(report, '$.course.vec.waters[].kind', 'invalid water kind normalized');
          }
          feature.kind = kind;
        } else if (key === 'streams') {
          feature.w = finiteSave(feature.w, 4, {
            min: 0.1, max: 500,
          }, report, '$.course.vec.streams[].w');
          feature.depth = finiteSave(feature.depth, 2, {
            min: 0, max: 1000,
          }, report, '$.course.vec.streams[].depth');
        }
        return true;
      },
    },
  );
  vector.waters = polygonFeatures('waters', 3, 10_000);
  vector.streams = polygonFeatures('streams', 2, 10_000);
  vector.beds = polygonFeatures('beds', 3, 10_000);
  vector.mounds = normalizeIds(vector.mounds, report, '$.course.vec.mounds', {
    max: 10_000,
    accept: (mound) => {
      if (!Number.isFinite(mound.x) || !Number.isFinite(mound.y)
          || !Number.isFinite(mound.r) || mound.r <= 0) return false;
      mound.x = finiteSave(mound.x, 0, {
        min: -10_000, max: 10_000,
      }, report, '$.course.vec.mounds[].x');
      mound.y = finiteSave(mound.y, 0, {
        min: -10_000, max: 10_000,
      }, report, '$.course.vec.mounds[].y');
      mound.r = finiteSave(mound.r, 1, {
        min: 0.01, max: 1000,
      }, report, '$.course.vec.mounds[].r');
      mound.h = finiteSave(mound.h, 0, {
        min: -1000, max: 1000,
      }, report, '$.course.vec.mounds[].h');
      return true;
    },
  });
  const rawLawns = recordsOnly(vector.lawns, report, '$.course.vec.lawns', { max: 10_000 });
  vector.lawns = [];
  for (const lawn of rawLawns) {
    if (!Number.isFinite(lawn.x) || !Number.isFinite(lawn.y)
        || !Number.isFinite(lawn.w) || lawn.w <= 0
        || !Number.isFinite(lawn.d) || lawn.d <= 0) continue;
    vector.lawns.push({
      ...lawn,
      x: finiteSave(lawn.x, 0, {
        min: -10_000, max: 10_000,
      }, report, '$.course.vec.lawns[].x'),
      y: finiteSave(lawn.y, 0, {
        min: -10_000, max: 10_000,
      }, report, '$.course.vec.lawns[].y'),
      w: finiteSave(lawn.w, 1, {
        min: 0.01, max: 1000,
      }, report, '$.course.vec.lawns[].w'),
      d: finiteSave(lawn.d, 1, {
        min: 0.01, max: 1000,
      }, report, '$.course.vec.lawns[].d'),
      rot: finiteSave(lawn.rot, 0, {
        min: -Math.PI * 8, max: Math.PI * 8,
      }, report, '$.course.vec.lawns[].rot'),
    });
  }
  if (vector.lawns.length !== rawLawns.length) {
    noteRepair(report, '$.course.vec.lawns', 'invalid lawn records removed');
  }
  const all = ['holes', 'waters', 'streams', 'beds', 'mounds', 'lawns']
    .flatMap((key) => Array.isArray(vector[key]) ? vector[key] : []);
  vector.nextId = safeNextId(all, vector.nextId);
  return vector;
}

function normalizeCourse(savedCourse, seed, persistedVersion, report) {
  if (!isRecord(savedCourse)) {
    noteRepair(report, '$.course', 'missing course replaced with the deterministic starting course');
    return ensureCourseShape(buildStartingCourse(makeRng(seed)));
  }
  const w = finiteNumber(savedCourse.w, GRID_W, { integer: true, min: 1, max: 512 });
  const h = finiteNumber(savedCourse.h, GRID_H, { integer: true, min: 1, max: 512 });
  if (!Number.isSafeInteger(w * h) || w * h > MAX_COURSE_CELLS) {
    noteRepair(report, '$.course', 'unsafe grid dimensions replaced with the deterministic starting course');
    return ensureCourseShape(buildStartingCourse(makeRng(seed)));
  }
  const n = w * h;
  let fallback = null;
  const needsFallbackGrid = !Array.isArray(savedCourse.zones)
    || !Array.isArray(savedCourse.elevation)
    || savedCourse.zones.length !== n
    || savedCourse.elevation.length !== n;
  if (needsFallbackGrid && w === GRID_W && h === GRID_H) fallback = buildStartingCourse(makeRng(seed));
  const fallbackZones = fallback?.zones || new Uint8Array(n).fill(ZONE.OUT);
  const fallbackElevation = fallback?.elevation || new Float32Array(n);
  const zones = normalizeNumericArray(
    savedCourse.zones,
    fallbackZones,
    Uint8Array,
    report,
    '$.course.zones',
    (number, index) => Number.isInteger(number) && number >= ZONE.OUT && number <= ZONE_MAX_ID
      ? number
      : fallbackZones[index],
  );
  const elevation = normalizeNumericArray(
    savedCourse.elevation,
    fallbackElevation,
    Float32Array,
    report,
    '$.course.elevation',
    (number) => Math.min(5000, Math.max(-5000, number)),
  );
  const holes = normalizeIds(savedCourse.holes, report, '$.course.holes', { max: 1000 })
    .map((hole, index) => normalizeHole(hole, report, `$.course.holes[${index}]`));
  const rawStructures = recordsOnly(
    savedCourse.structures, report, '$.course.structures', { max: 10_000 },
  );
  const structures = [];
  for (let index = 0; index < rawStructures.length; index += 1) {
    const structure = rawStructures[index];
    if (typeof structure.type !== 'string' || !structure.type.trim()
        || !Number.isFinite(structure.x) || !Number.isFinite(structure.y)
        || !Number.isFinite(structure.w) || structure.w <= 0
        || !Number.isFinite(structure.h) || structure.h <= 0) continue;
    structures.push({
      ...structure,
      type: structure.type.trim().slice(0, 100),
      x: finiteSave(structure.x, 0, {
        min: -10_000, max: 10_000,
      }, report, `$.course.structures[${index}].x`),
      y: finiteSave(structure.y, 0, {
        min: -10_000, max: 10_000,
      }, report, `$.course.structures[${index}].y`),
      w: finiteSave(structure.w, 1, {
        min: 0.01, max: 10_000,
      }, report, `$.course.structures[${index}].w`),
      h: finiteSave(structure.h, 1, {
        min: 0.01, max: 10_000,
      }, report, `$.course.structures[${index}].h`),
    });
  }
  if (structures.length !== rawStructures.length) {
    noteRepair(report, '$.course.structures', 'invalid structure records removed');
  }
  const hadPersistedObjects = Array.isArray(savedCourse.objects);
  const objects = hadPersistedObjects
    ? normalizeIds(savedCourse.objects, report, '$.course.objects', {
      max: 100_000,
      accept: (object) => {
        if (typeof object.type !== 'string' || !object.type.trim()
            || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return false;
        const originalType = object.type;
        object.type = object.type.trim().slice(0, 100);
        object.x = finiteSave(object.x, 0, {
          min: -10_000, max: 10_000,
        }, report, '$.course.objects[].x');
        object.y = finiteSave(object.y, 0, {
          min: -10_000, max: 10_000,
        }, report, '$.course.objects[].y');
        object.rot = finiteSave(object.rot, 0, {
          min: -Math.PI * 100, max: Math.PI * 100,
        }, report, '$.course.objects[].rot');
        object.scale = finiteSave(object.scale, 1, {
          min: 0.01, max: 100,
        }, report, '$.course.objects[].scale');
        if (object.type !== originalType) {
          noteRepair(report, '$.course.objects[].type', 'invalid object type normalized');
        }
        return true;
      },
    })
    : [];
  const paths = normalizeIds(savedCourse.paths, report, '$.course.paths', {
    max: 10_000,
    accept: (path) => {
      const pts = normalizePointArray(path.pts, 2, report, '$.course.paths[].pts', { max: 4096 });
      if (!pts) return false;
      path.pts = pts;
      path.width = finiteSave(path.width, 3.2, {
        min: 0.1, max: 500,
      }, report, '$.course.paths[].width');
      const material = typeof path.material === 'string' && path.material.trim()
        ? path.material.slice(0, 100)
        : 'asphalt';
      if (material !== path.material) {
        noteRepair(report, '$.course.paths[].material', 'invalid path material normalized');
      }
      path.material = material;
      return true;
    },
  });
  const course = {
    w,
    h,
    zones,
    elevation,
    holes,
    nextHoleId: safeNextId(holes, savedCourse.nextHoleId),
    structures: cloneSaveValue(structures, []),
    objects,
    nextObjectId: safeNextId(objects, savedCourse.nextObjectId),
    paths,
    nextPathId: safeNextId(paths, savedCourse.nextPathId),
  };
  const vector = normalizeCourseVector(savedCourse.vec, seed, report);
  if (vector) course.vec = vector;
  // Paint is editing data, not proof that a course is vector-based. Preserve it
  // independently so even unusual intermediary saves lose nothing.
  if (savedCourse.paint) {
    const defaults = new Uint8Array(n).fill(255);
    course.paint = normalizeNumericArray(
      savedCourse.paint,
      defaults,
      Uint8Array,
      report,
      '$.course.paint',
      (number) => Math.min(255, Math.max(0, Math.trunc(number))),
    );
  }
  // A grid-only course is a supported legacy format. Absence of vec is not
  // corruption, and an explicitly empty object array remains authoritative.
  if (!hadPersistedObjects) {
    const specs = course.holes
      .filter((hole) => hole.tee && hole.pin)
      .map((hole) => ({ tee: hole.tee, pin: hole.pin, wp: [] }));
    plantVegetation(course, specs, makeRng(((seed >>> 0) ^ 0x7ee5) || 1), { density: 1 });
    course.nextObjectId = safeNextId(course.objects, 1);
    if (persistedVersion >= 5) noteRepair(report, '$.course.objects', 'missing object field restored deterministically');
  }
  return ensureCourseShape(course);
}

function normalizeTurf(rawTurf, defaults, report) {
  if (!isRecord(rawTurf)) {
    if (rawTurf !== undefined && rawTurf !== null) noteRepair(report, '$.turf', 'invalid turf block defaulted');
    return defaults;
  }
  const pct = (number) => Math.min(100, Math.max(0, number));
  return {
    health: normalizeNumericArray(rawTurf.health, defaults.health, Float32Array, report, '$.turf.health', pct),
    moisture: normalizeNumericArray(rawTurf.moisture, defaults.moisture, Float32Array, report, '$.turf.moisture', pct),
    nutrients: normalizeNumericArray(rawTurf.nutrients, defaults.nutrients, Float32Array, report, '$.turf.nutrients', pct),
    heightMm: normalizeNumericArray(rawTurf.heightMm, defaults.heightMm, Float32Array, report, '$.turf.heightMm', (number) => Math.min(250, Math.max(0, number))),
    wear: normalizeNumericArray(rawTurf.wear, defaults.wear, Float32Array, report, '$.turf.wear', pct),
    disType: normalizeNumericArray(rawTurf.disType, defaults.disType, Uint8Array, report, '$.turf.disType', (number) => Math.min(255, Math.max(0, Math.trunc(number)))),
    disSev: normalizeNumericArray(rawTurf.disSev, defaults.disSev, Float32Array, report, '$.turf.disSev', pct),
    treated: normalizeNumericArray(rawTurf.treated, defaults.treated, Uint8Array, report, '$.turf.treated', (number) => Math.min(255, Math.max(0, Math.trunc(number)))),
  };
}

function normalizeShopState(state, rawShop, defaults, report) {
  const shop = state.shop;
  if (!isRecord(shop.inventory)) shop.inventory = cloneSaveValue(defaults.inventory, {});
  for (const sku of SHOP_CATALOG) {
    const fallback = defaults.inventory[sku.id] || { shelf: 0, back: 0 };
    const source = isRecord(shop.inventory[sku.id]) ? shop.inventory[sku.id] : fallback;
    if (!isRecord(shop.inventory[sku.id])) noteRepair(report, `$.shop.inventory.${sku.id}`, 'inventory line defaulted');
    shop.inventory[sku.id] = {
      shelf: finiteSave(source.shelf, fallback.shelf, {
        integer: true, min: 0, max: 1_000_000_000,
      }, report, `$.shop.inventory.${sku.id}.shelf`),
      back: finiteSave(source.back, fallback.back, {
        integer: true, min: 0, max: 1_000_000_000,
      }, report, `$.shop.inventory.${sku.id}.back`),
    };
  }
  shop.orders = normalizeIds(shop.orders, report, '$.shop.orders', {
    max: 10_000,
    duplicate: 'drop',
    accept: (order) => typeof order.skuId === 'string' && !!shop.inventory[order.skuId],
  });
  shop.nextOrderId = safeNextId(shop.orders, shop.nextOrderId);
  shop.transactionHistory = dedupeRecords(
    recordsOnly(shop.transactionHistory, report, '$.shop.transactionHistory', { max: 100 }),
    (ticket) => Number.isSafeInteger(ticket.number) && ticket.number > 0 ? ticket.number : null,
    report,
    '$.shop.transactionHistory',
  );
  shop.nextTransactionNo = safeNextId(
    shop.transactionHistory.map((ticket) => ({ id: ticket.number })),
    shop.nextTransactionNo,
  );
  const held = recordsOnly(shop.held, report, '$.shop.held', { max: 10_000 })
    .filter((unit) => typeof unit.uid === 'string' && unit.uid && typeof unit.skuId === 'string'
      && !!shop.inventory[unit.skuId]);
  shop.held = dedupeRecords(held, (unit) => unit.uid, report, '$.shop.held');
  if (shop.carry !== null) {
    if (!isRecord(shop.carry) || typeof shop.carry.skuId !== 'string'
        || !shop.inventory[shop.carry.skuId]
        || !Number.isFinite(Number(shop.carry.qty)) || Number(shop.carry.qty) <= 0) {
      shop.carry = null;
      noteRepair(report, '$.shop.carry', 'invalid carried-goods state cleared');
    } else {
      shop.carry.qty = finiteSave(shop.carry.qty, 1, {
        integer: true, min: 1, max: 1_000_000_000,
      }, report, '$.shop.carry.qty');
    }
  }
  const bag = shop.paymentBag;
  const cashInBag = Array.isArray(bag) ? bag.filter((method) => method === 'cash').length : 0;
  const cardInBag = Array.isArray(bag) ? bag.filter((method) => method === 'card').length : 0;
  if (!Array.isArray(bag)
      || bag.some((method) => method !== 'cash' && method !== 'card')
      || bag.length > 10
      || cashInBag > 5
      || cardInBag > 5) {
    noteRepair(report, '$.shop.paymentBag', 'invalid payment-method bag reset');
  }
  ensurePaymentBag(state);

  ensureLayout(state);
  const layout = shop.layout;
  if (!isRecord(layout.moved)) layout.moved = {};
  for (const [id, pose] of Object.entries(layout.moved)) {
    if (!isRecord(pose) || !Number.isFinite(pose.x) || !Number.isFinite(pose.z)) {
      delete layout.moved[id];
      noteRepair(report, `$.shop.layout.moved.${id}`, 'invalid fixture pose removed');
      continue;
    }
    pose.ry = Number.isFinite(pose.ry) ? pose.ry : 0;
  }
  layout.stored = [...new Set((Array.isArray(layout.stored) ? layout.stored : [])
    .filter((id) => typeof id === 'string' && id))];
  layout.extra = dedupeRecords(
    recordsOnly(layout.extra, report, '$.shop.layout.extra', { max: 1000 })
      .filter((fixture) => typeof fixture.id === 'string' && fixture.id
        && Number.isFinite(fixture.x) && Number.isFinite(fixture.z)),
    (fixture) => fixture.id,
    report,
    '$.shop.layout.extra',
  );

  if (!isRecord(shop.deliveries)) shop.deliveries = {};
  const deliveries = shop.deliveries;
  deliveries.boxes = dedupeRecords(
    recordsOnly(deliveries.boxes, report, '$.shop.deliveries.boxes', { max: 10_000 })
      .filter((box) => Number.isSafeInteger(box.id) && box.id > 0
        && typeof box.skuId === 'string' && !!shop.inventory[box.skuId]),
    (box) => box.id,
    report,
    '$.shop.deliveries.boxes',
  );
  deliveries.shipments = dedupeRecords(
    recordsOnly(deliveries.shipments, report, '$.shop.deliveries.shipments', { max: 10_000 })
      .filter((shipment) => shipment.orderId !== null && shipment.orderId !== undefined),
    (shipment) => shipment.orderId,
    report,
    '$.shop.deliveries.shipments',
  );
  deliveries.arrivedOrderIds = [...new Set((Array.isArray(deliveries.arrivedOrderIds)
    ? deliveries.arrivedOrderIds : []).filter((id) => id !== null && id !== undefined))];
  if (isRecord(rawShop?.deliveries) && !Object.hasOwn(rawShop.deliveries, 'schemaVersion')) {
    delete deliveries.schemaVersion;
  }

  if (!isRecord(shop.reno)) shop.reno = cloneSaveValue(defaults.reno, {});
  const reno = shop.reno;
  const defaultReno = defaults.reno;
  const cells = CLEANING_FIELD.w * CLEANING_FIELD.h;
  reno.grime = normalizeNumericArray(reno.grime, defaultReno.grime, Array, report, '$.shop.reno.grime', (number) => Math.min(1, Math.max(0, number)));
  reno.windows = normalizeNumericArray(reno.windows, defaultReno.windows, Array, report, '$.shop.reno.windows', (number) => Math.min(1, Math.max(0, number)));
  reno.wet = normalizeNumericArray(reno.wet, new Array(cells).fill(0), Array, report, '$.shop.reno.wet', (number) => Math.min(1, Math.max(0, number)));
  reno.solution = normalizeNumericArray(reno.solution, new Array(cells).fill(0), Array, report, '$.shop.reno.solution', (number) => Math.min(1, Math.max(0, number)));
  reno.clutter = recordsOnly(reno.clutter, report, '$.shop.reno.clutter', { max: 1000 });
  reno.decor = dedupeRecords(
    recordsOnly(reno.decor, report, '$.shop.reno.decor', { max: 1000 })
      .filter((decor) => typeof decor.skuId === 'string' && Number.isFinite(decor.spot)),
    (decor) => `${decor.skuId}:${decor.spot}`,
    report,
    '$.shop.reno.decor',
  );
  reno.debris = recordsOnly(reno.debris, report, '$.shop.reno.debris', { max: 96 });
  reno.pan = finiteSave(reno.pan, 0, { min: 0, max: 1_000_000 }, report, '$.shop.reno.pan');
  reno.bag = finiteSave(reno.bag, 0, { min: 0, max: 1_000_000 }, report, '$.shop.reno.bag');
  if (isRecord(rawShop?.reno) && !Object.hasOwn(rawShop.reno, 'architecture')) {
    delete reno.architecture;
  }
}

function normalizeCollections(state, report) {
  if (isRecord(state.golfers)) {
    state.golfers.pool = normalizeIds(state.golfers.pool, report, '$.golfers.pool', {
      max: 100_000,
      duplicate: 'drop',
    });
    state.golfers.nextId = safeNextId(state.golfers.pool, state.golfers.nextId);
  }
  if (isRecord(state.staff)) {
    state.staff.employees = normalizeIds(state.staff.employees, report, '$.staff.employees', {
      max: 10_000,
      duplicate: 'drop',
    });
    state.staff.market = normalizeIds(state.staff.market, report, '$.staff.market', {
      max: 10_000,
      duplicate: 'drop',
    });
    const employeeIds = new Set(state.staff.employees.map((employee) => employee.id));
    const marketBefore = state.staff.market.length;
    state.staff.market = state.staff.market.filter((candidate) => !employeeIds.has(candidate.id));
    if (state.staff.market.length !== marketBefore) {
      noteRepair(report, '$.staff.market', 'hired employee identities removed from the candidate market');
    }
    state.staff.nextId = safeNextId([...state.staff.employees, ...state.staff.market], state.staff.nextId);
  }
  state.club.feed = recordsOnly(state.club.feed, report, '$.club.feed', { max: 100 });
  const championIds = Array.isArray(state.club.champions) ? state.club.champions : [];
  state.club.champions = [...new Set(championIds.filter(
    (id) => Number.isSafeInteger(id) && id > 0,
  ))].slice(0, 1000);
  if (state.club.champions.length !== championIds.length) {
    noteRepair(report, '$.club.champions', 'invalid or duplicate golfer ids removed');
  }
  state.club.reviews = recordsOnly(state.club.reviews, report, '$.club.reviews', { max: 60 })
    .filter((review) => typeof review.text === 'string' && Number.isFinite(review.stars))
    .map((review) => ({
      ...review,
      stars: finiteNumber(review.stars, 1, { integer: true, min: 1, max: 5 }),
      day: finiteNumber(review.day, 0, { integer: true, min: 0 }),
      cited: Array.isArray(review.cited) ? review.cited.filter((id) => typeof id === 'string') : [],
    }));
  state.ledger = healLedger(state.ledger);
  if (isRecord(state.reservations)) {
    state.reservations.booked = normalizeIds(state.reservations.booked, report, '$.reservations.booked', {
      max: 100_000,
      duplicate: 'drop',
    });
  }
  if (isRecord(state.notifications)) {
    state.notifications.items = dedupeRecords(
      recordsOnly(state.notifications.items, report, '$.notifications.items', { max: 60 }),
      (item) => Number.isFinite(Number(item.id)) ? Number(item.id) : null,
      report,
      '$.notifications.items',
    );
  }
}

function persistedVersionOf(raw) {
  return Number.isSafeInteger(raw.version) && raw.version >= 0 ? raw.version : 0;
}

export function deserializeWithReport(json) {
  const raw = parseSaveInput(json, { kind: 'game save' });
  const persistedVersion = persistedVersionOf(raw);
  if (persistedVersion > SAVE_VERSION) {
    throw new SaveCompatibilityError(
      `This save uses game schema ${persistedVersion}, but this build supports through ${SAVE_VERSION}.`,
      { path: '$.version' },
    );
  }
  const report = createSaveReport('game', persistedVersion, SAVE_VERSION);
  for (const migration of SAVE_MIGRATIONS) {
    if (migration.version > persistedVersion) noteMigration(report, migration.version, migration.name);
  }
  const mode = normalizeMode(raw.mode);
  const seed = normalizeSeed(raw.seed);
  if (raw.mode !== mode) noteRepair(report, '$.mode', 'unknown mode defaulted to relaxed');
  if (typeof raw.seed !== 'number' || raw.seed !== seed) noteRepair(report, '$.seed', 'invalid seed normalized');
  const course = normalizeCourse(raw.course, seed, persistedVersion, report);
  const clubName = typeof raw.clubName === 'string' && raw.clubName.trim()
    ? raw.clubName.slice(0, 200)
    : 'Willow Creek Golf Club';
  if (clubName !== raw.clubName) noteRepair(report, '$.clubName', 'missing or oversized club name normalized');
  const state = newGame(mode, seed, { course, clubName });
  const generatedRngState = state.rngState;
  const shopDefaults = cloneSaveValue(state.shop, {});
  const persistedDrawer = isRecord(raw.shop?.drawer)
    ? cloneSaveValue(raw.shop.drawer, {})
    : null;

  state.version = SAVE_VERSION;
  state.mode = mode;
  state.seed = seed;
  state.clock.minutes = finiteSave(
    raw.clock?.minutes,
    state.clock.minutes,
    { min: 0, max: Number.MAX_SAFE_INTEGER },
    report,
    '$.clock.minutes',
  );
  state.cash = finiteSave(
    raw.cash,
    0,
    { min: -1_000_000_000_000, max: 1_000_000_000_000 },
    report,
    '$.cash',
  );
  state.clubName = clubName;
  state.pendingMorning = typeof raw.pendingMorning === 'boolean' ? raw.pendingMorning : true;
  if (typeof raw.pendingMorning !== 'boolean') noteRepair(report, '$.pendingMorning', 'invalid flag defaulted');
  state.course = course;
  state.sections = labelSections(course);

  const domains = [
    'weather', 'maintenance', 'golfers', 'staff', 'club', 'ledger', 'shop',
    'reservations', 'customerDirectory', 'tractor', 'props', 'progression',
    'tutorial', 'notifications', 'uiPrefs', 'property',
  ];
  for (const key of domains) {
    state[key] = mergeSaveDefaults(state[key], raw[key], report, `$.${key}`);
  }
  // The restoration module owns legacy grime-grid resampling. Run that before
  // fixed-length validation so a 7x5 save retains its cleaning progress instead
  // of being replaced by the current dirty defaults.
  ensureShopReno(state);
  // Missing tractor state predates the repair arc. Do not let newGame's fresh,
  // broken default hide that absence from the compatibility adapter below.
  if (!isRecord(raw.tractor)) delete state.tractor;
  state.turf = normalizeTurf(raw.turf, state.turf, report);
  state.debtDays = finiteSave(
    raw.debtDays,
    0,
    { integer: true, min: 0, max: 1_000_000 },
    report,
    '$.debtDays',
  );
  state.failed = isRecord(raw.failed) ? cloneSaveValue(raw.failed) : null;
  if (raw.failed != null && !isRecord(raw.failed)) noteRepair(report, '$.failed', 'invalid failure state cleared');

  normalizeShopState(state, raw.shop, shopDefaults, report);
  normalizeCollections(state, report);
  // A drawer is a counted-value authority, not a preferences object. Deeply
  // filling absent denomination keys from the opening float would mint cash in
  // sparse or legacy drawers, so migrate only the persisted stack itself.
  state.shop.drawer = migrateDrawer(persistedDrawer || state.shop.drawer || newDrawer());
  ensurePaymentBag(state); // a half-used balanced batch survives the reload intact
  paymentBagStats(state);
  ensureLayout(state);
  ensureClubhouseArchitecture(state);
  ensureDebris(state);
  ensureWet(state, CLEANING_FIELD.w, CLEANING_FIELD.h);
  ensureWash(state);
  migrateLegacyRetailLayout(state.shop, persistedVersion);
  migrateFeatureCategory(state.shop, persistedVersion);
  reconcileMovedFixturePoses(state, report);
  recoverCheckout(state); // a save taken mid-sale: the shoppers are gone, so put their goods back
  reconcileShelfCapacity(state.shop); // authored shelf slots win; overflow remains owned in back stock
  reconcileStoredFixtureStock(state.shop); // absent fixtures cannot retain invisible shelf inventory
  ensureProperty(state); // pre-rent saves gain a schedule rather than a free ride
  ensureReservations(state); // pre-booking saves gain an empty tee sheet
  ensureCustomerDirectory(state); // pre-v4 saves gain stable full-name customer authority
  reconcileReservationCustomerIdentities(state); // enroll legacy bookings once, then repair their references
  ensureTractor(state, { legacyRepaired: true }); // old saves keep their working tractor
  ensureCourseProps(state); // old saves gain the litter/sign restoration props
  ensureTutorial(state); // older saves re-derive their spot in the chaptered arc
  ensureNotifications(state); // pre-feed saves gain an empty, well-formed inbox
  state.uiPrefs = isRecord(state.uiPrefs) ? state.uiPrefs : {};
  // Defaults and legacy adapters may need deterministic random data, but they
  // must never consume the saved game's future stream.
  state.rngState = finiteSave(raw.rngState, generatedRngState, {
    integer: true,
    min: 0,
    max: 0xffffffff,
  }, report, '$.rngState');
  state.version = SAVE_VERSION;
  return { state, report: finishSaveReport(report) };
}

export function deserialize(json) {
  return deserializeWithReport(json).state;
}

export function validateGameSave(json) {
  try {
    const { report } = deserializeWithReport(json);
    return { compatible: true, valid: !report.recovered, report, error: null };
  } catch (error) {
    return {
      compatible: error?.code !== 'SAVE_VERSION_UNSUPPORTED',
      valid: false,
      report: null,
      error: {
        name: error?.name || 'Error',
        code: error?.code || 'SAVE_DATA_ERROR',
        message: error?.message || String(error),
        path: error?.path || '$',
      },
    };
  }
}

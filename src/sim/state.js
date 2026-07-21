// FAIRWAY STATE — the single serializable GameState and its master tick.
// Everything the game *is* lives in this object; rendering and UI only read it
// and call command functions. All randomness flows through state.rngState so a
// loaded save resumes the exact same stream.

import { makeRng, rngOf } from '../core/utils.js';
import { labelSections, ensureCourseShape } from './course.js';
import { buildStartingCourse } from './startingCourse.js';
import { plantVegetation } from './courseShaping.js';
import { newClock, advanceClock, calendarOf } from './time.js';
import { tickRenovationsDaily } from './terrainEdit.js';
import { newWeather, rollDailyWeather } from './weather.js';
import { initTurf, turfHourlyTick, turfDailyTick, runMorningMaintenance, defaultPolicies } from './turf.js';
import { initGolfers } from './golfers.js';
import { initStaff, tickStaffDaily, refreshMarketIfDue } from './staff.js';
import { initClub, dailyMembershipTick, accrueDaily } from './club.js';
import { initShop, shopDailyAccrual, deliverOrdersDue, tickDeliveries, ensureShopReno } from './shop.js';
import { recoverCheckout } from './checkout.js';
import { migrateDrawer } from './register.js';
import { ensurePaymentBag } from './paymentBag.js';
import { ensureWash } from './washing.js';
import { ensureProperty, tickProperty } from './property.js';
import {
  initReservations, ensureReservations, reservationsDailyTick,
  generateOnlineReservations, processReservationTimeline,
} from './reservations.js';
import {
  initCustomerDirectory, ensureCustomerDirectory, reconcileReservationCustomerIdentities,
} from './customerIdentity.js';
import { initTractor, ensureTractor } from './tractor.js';
import { initVehicles, ensureVehicles } from './vehicles.js';
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
import {
  placedFixtures, routesIntact, validatePlacement, shopExpansionLayoutSafety,
} from './layout.js';
import { bindPropertyInventory, ensurePropertyInventory } from './propertyInventory.js';
import {
  ensureShopProgression, tickShopProgressionDaily,
} from './shopProgression.js';

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
// v11: durable property placeables gain their own property-scoped ownership,
// delivery, storage, and placement authority. Existing decor/backroom counts
// migrate conservatively without changing retail merchandise stock.
// v12: the pro shop begins as a compact BASIC operation and expands through
// constructed STANDARD, PREMIUM, and LUXURY tiers. Legacy saves retain their
// existing full fixture floor until they purchase their next tier.
// v13: property-scoped vehicles persist stable identity, legal parking pose,
// lights, operating state, condition, energy, odometer, and stored equipment.
export const SAVE_VERSION = 13;

export const FIXTURE_FOOTPRINT_SAVE_VERSION = 10;
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
// asymmetric shoe wall and the authored apparel table). A moved pose that was
// legal against an old approximate box can therefore load inside a wall or on
// another unit. Validate only legacy overrides and delete only the unsafe pose:
// the sparse layout then resolves that fixture to its known-safe authored
// default without changing inventory, stored state, or valid player moves.
function reconcileLegacyMovedFixturePoses(state, persistedVersion) {
  if (persistedVersion >= FIXTURE_FOOTPRINT_SAVE_VERSION) return;
  const moved = state.shop?.layout?.moved;
  if (!moved || typeof moved !== 'object' || Array.isArray(moved)) return;

  const ids = Object.keys(moved);
  for (const id of ids) {
    const pose = moved[id];
    if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z)) {
      delete moved[id];
      continue;
    }
    if (!Number.isFinite(pose.ry)) pose.ry = 0;
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
}

// A stored authored fixture has no shelf in the world. Crafted/interrupted
// saves may still contain shelf units there, so conservatively return every
// such unit to back stock. Checkout-held units are recovered first and use the
// same fixture-presence rule; this final pass also heals already-persisted
// shelf counts without minting or discarding anything.
function reconcileUnavailableFixtureStock(state) {
  const shop = state?.shop;
  if (!shop?.inventory) return;
  const installed = new Set(placedFixtures(state).map((fixture) => fixture.id));
  for (const sku of SHOP_CATALOG) {
    const fixture = homeFixture(sku.id);
    const inventory = shop.inventory[sku.id];
    if (!fixture || installed.has(fixture.id) || !inventory) continue;
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
  ensureWash(state); // a fixer-upper arrives with a filthy exterior
  ensureProperty(state); // ...and a landlord
  bindPropertyInventory(state, opts.propertyId || `property:${seed}`);
  initReservations(state);
  initCustomerDirectory(state);
  initTractor(state);
  initVehicles(state);
  initCourseProps(state);
  initLedger(state);
  initProgression(state);
  initTutorial(state);
  initNotifications(state);
  state.uiPrefs = {};
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
  if (state.shop) tickShopProgressionDaily(state, shopExpansionLayoutSafety);
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

// Mop water and cleaning solution are FEEDBACK, not progress. Both fade to nothing inside a minute
// of play, and at 0.25 yd over the whole floor they are 4,264 cells each — about 17 KB of zeroes in
// every save even on a bone-dry floor, and 50 KB on a wet one. A floor you mopped before saving is
// correctly dry when you come back, so they are rebuilt empty on load by ensureWet() instead.
//
// Everything that IS progress — the grime mask, the debris piles, the pan and bag loads — stays.
function shopForSave(shop) {
  if (!shop || !shop.reno) return shop;
  const { wet, solution, ...reno } = shop.reno;
  void wet;
  void solution;
  return { ...shop, reno };
}

export function snapshot(state) {
  // Reservations keep compatibility name fields for old UI, but the directory
  // is their sole identity authority. Reconcile before every persisted snapshot.
  reconcileReservationCustomerIdentities(state);
  const { course, turf } = state;
  return ({
    version: state.version,
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
    vehicles: state.vehicles,
    props: state.props,
    progression: state.progression,
    tutorial: state.tutorial,
    notifications: state.notifications, // unread warnings survive the reload
    uiPrefs: state.uiPrefs || null, // the office machine's own settings (scale, default views)
    property: state.property, // the rent schedule, or reloading is a rent holiday
    propertyInventory: state.propertyInventory,
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

function cloneSaveValue(value) {
  return value == null ? value : structuredClone(value);
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

export function deserialize(json) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  const persistedVersion = Number.isFinite(raw.version) ? raw.version : 0;
  const savedCourse = raw.course;
  const hadPersistedObjects = Array.isArray(savedCourse.objects);
  const course = {
    w: savedCourse.w,
    h: savedCourse.h,
    zones: Uint8Array.from(savedCourse.zones),
    elevation: Float32Array.from(savedCourse.elevation),
    holes: cloneSaveValue(Array.isArray(savedCourse.holes) ? savedCourse.holes : []),
    nextHoleId: savedCourse.nextHoleId,
    structures: cloneSaveValue(Array.isArray(savedCourse.structures) ? savedCourse.structures : []),
    objects: hadPersistedObjects ? cloneSaveValue(savedCourse.objects) : null,
    nextObjectId: savedCourse.nextObjectId,
    paths: cloneSaveValue(Array.isArray(savedCourse.paths) ? savedCourse.paths : []),
    nextPathId: savedCourse.nextPathId,
  };
  if (savedCourse.vec) course.vec = cloneSaveValue(savedCourse.vec);
  // Paint is editing data, not proof that a course is vector-based. Preserve it
  // independently so even unusual intermediary saves lose nothing.
  if (savedCourse.paint) course.paint = Uint8Array.from(savedCourse.paint);
  course.nextHoleId = safeNextId(course.holes, course.nextHoleId);
  course.nextPathId = safeNextId(course.paths, course.nextPathId);
  // A grid-only course is a supported legacy format. Earlier v6 code replaced
  // every <=9-hole legacy layout with a newly generated vector course, silently
  // discarding its terrain, routing, objects and paths. v7 keeps the persisted
  // grid authoritative; absence of vec is not corruption.
  if (!hadPersistedObjects) {
    // Pre-v5 saves had no authored object array (trees were renderer noise).
    // Keep the established deterministic compatibility planting only when the
    // field is truly absent. An explicitly empty array remains empty.
    course.objects = [];
    course.nextObjectId = 1;
    const specs = course.holes
      .filter((h) => h.tee && h.pin)
      .map((h) => ({ tee: h.tee, pin: h.pin, wp: [] }));
    plantVegetation(course, specs, makeRng(((raw.seed >>> 0) ^ 0x7ee5) || 1), { density: 1 });
  }
  course.nextObjectId = safeNextId(course.objects, course.nextObjectId);
  ensureCourseShape(course);
  const state = {
    version: SAVE_VERSION,
    mode: raw.mode,
    seed: raw.seed,
    rngState: raw.rngState,
    clock: { minutes: raw.clock.minutes },
    // a NaN balance serializes to JSON null; heal it or every register sale
    // refuses to bank ("The club books are not available") forever after
    cash: Number.isFinite(raw.cash) ? raw.cash : 0,
    clubName: raw.clubName || 'Willow Creek Golf Club',
    pendingMorning: raw.pendingMorning ?? true,
    course,
    sections: labelSections(course),
    weather: raw.weather
      ? { today: raw.weather.today, droughtDays: raw.weather.droughtDays, bias: raw.weather.bias || { temp: 0, dry: 0 } }
      : newWeather(),
    maintenance: raw.maintenance || null,
    property: cloneSaveValue(raw.property) || null,
    propertyInventory: cloneSaveValue(raw.propertyInventory) || null,
  };
  if (raw.turf) {
    state.turf = {
      health: Float32Array.from(raw.turf.health),
      moisture: Float32Array.from(raw.turf.moisture),
      nutrients: Float32Array.from(raw.turf.nutrients),
      heightMm: Float32Array.from(raw.turf.heightMm),
      wear: Float32Array.from(raw.turf.wear),
      disType: Uint8Array.from(raw.turf.disType),
      disSev: Float32Array.from(raw.turf.disSev),
      treated: Uint8Array.from(raw.turf.treated),
    };
  } else {
    // pre-turf (version 1) saves: initialize fresh turf so old saves stay loadable
    initTurf(state);
  }
  if (!state.maintenance) {
    state.maintenance = {
      policies: defaultPolicies(),
      lastMowDay: { green: -10, tee: -10, fairway: -10, rough: -10 },
      lastFertDay: { green: -10, tee: -10, fairway: -10, rough: -10 },
      crewUnits: 1,
      lastReport: null,
    };
  }
  // pre-v3 saves: bootstrap the club layer fresh
  if (raw.golfers) state.golfers = raw.golfers;
  else initGolfers(state);
  if (raw.staff) state.staff = raw.staff;
  else initStaff(state);
  if (raw.club) state.club = raw.club;
  else initClub(state);
  if (raw.ledger) state.ledger = healLedger(raw.ledger);
  else initLedger(state);
  if (raw.shop) state.shop = raw.shop;
  else initShop(state);
  ensureShopProgression(state, { legacy: persistedVersion < 12 });
  if (state.shop.drawer) state.shop.drawer = migrateDrawer(state.shop.drawer);
  ensurePaymentBag(state); // a half-used balanced batch survives the reload intact
  ensureShopReno(state); // pre-restoration saves gain the rundown shop state
  migrateLegacyRetailLayout(state.shop, persistedVersion);
  migrateFeatureCategory(state.shop, persistedVersion);
  reconcileLegacyMovedFixturePoses(state, persistedVersion);
  if (!Array.isArray(state.shop.transactionHistory)) state.shop.transactionHistory = [];
  if (!Number.isFinite(state.shop.nextTransactionNo)) {
    const greatestTicket = state.shop.transactionHistory.reduce(
      (greatest, ticket) => Math.max(greatest, Number(ticket && ticket.number) || 0),
      0,
    );
    state.shop.nextTransactionNo = greatestTicket + 1;
  }
  recoverCheckout(state); // a save taken mid-sale: the shoppers are gone, so put their goods back
  reconcileShelfCapacity(state.shop); // authored shelf slots win; overflow remains owned in back stock
  reconcileUnavailableFixtureStock(state); // absent fixtures cannot retain invisible shelf inventory
  ensureWash(state); // ...and a filthy exterior waiting for the pressure washer
  ensureProperty(state); // pre-rent saves gain a schedule rather than a free ride
  ensurePropertyInventory(state); // v11 owns placeables per property; legacy decor migrates once
  if (raw.reservations) state.reservations = raw.reservations;
  ensureReservations(state); // pre-booking saves gain an empty tee sheet
  if (raw.customerDirectory) state.customerDirectory = raw.customerDirectory;
  ensureCustomerDirectory(state); // pre-v4 saves gain stable full-name customer authority
  reconcileReservationCustomerIdentities(state); // enroll legacy bookings once, then repair their references
  if (raw.tractor) state.tractor = raw.tractor;
  ensureTractor(state, { legacyRepaired: true }); // old saves keep their working tractor
  if (raw.vehicles) state.vehicles = raw.vehicles;
  ensureVehicles(state, { recoverActive: true }); // v13 adds stable property-scoped identity; loading parks active input safely
  if (raw.props) state.props = raw.props;
  ensureCourseProps(state); // old saves gain the litter/sign restoration props
  if (raw.progression) state.progression = raw.progression;
  else initProgression(state);
  if (raw.tutorial) state.tutorial = raw.tutorial;
  else initTutorial(state);
  ensureTutorial(state); // older saves re-derive their spot in the chaptered arc
  if (raw.notifications) state.notifications = raw.notifications;
  ensureNotifications(state); // pre-feed saves gain an empty, well-formed inbox
  state.uiPrefs = raw.uiPrefs && typeof raw.uiPrefs === 'object' ? raw.uiPrefs : {};
  state.debtDays = raw.debtDays || 0;
  state.failed = raw.failed || null;
  return state;
}

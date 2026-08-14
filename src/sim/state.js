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
import { ensureReputation, initReputation } from './reputation.js';
import { initShop, shopDailyAccrual, deliverOrdersDue, tickDeliveries, ensureShopReno, RENO } from './shop.js';
import { recoverCheckout } from './checkout.js';
import {
  ensureInventoryLifecycle,
  INVENTORY_STAGE,
  moveInventory,
} from './inventoryLifecycle.js';
import { migrateDrawer, newDrawer } from './register.js';
import {
  CHECKOUT_SETTLEMENT_VERSION,
  checkoutInventoryIdentity,
  checkoutSettlementReceiptForPlan,
  checkoutSettlementTicketDigest,
  checkoutWalIsQuarantined,
  checkoutWalQuarantineAcknowledged,
  drainPendingCheckoutCore,
  quarantineCheckoutWal,
  reconcilePendingCheckouts,
  validateCheckoutSettlementAuthorities,
  validateCheckoutSettlementReceipt,
  validateCheckoutSettlementReceipts,
  validateCheckoutWalRecord,
} from './checkoutSettlement.js';
import { reconcileReservationCheckInTickets } from './reservationCheckIn.js';
import { ensurePaymentBag, paymentBagStats } from './paymentBag.js';
import { ensureWash } from './washing.js';
import { ensureWet, wetGridForRoom } from './cleaningWet.js';
import { ensureDebris } from './cleaningDebris.js';
import { ensureLayout } from './layout.js';
import { ensureClubhouseRestoration } from './clubhouseRestoration.js';
import { ensureProperty, tickProperty } from './property.js';
import {
  ensureSalesTax, normalizeSalesTax, reconstructSalesTaxFromLedger, tickSalesTax,
} from './salesTax.js';
import {
  initReservations, ensureReservations, reservationsDailyTick,
  generateOnlineReservations, processReservationTimeline, ensureReservationHorizon,
  golfOperationsTick,
} from './reservations.js';
import {
  initCustomerSimulation, planCustomerArrivals, recoverCustomerSimulation,
} from './customerSimulation.js';
import {
  initCustomerDirectory, ensureCustomerDirectory, reconcileReservationCustomerIdentities,
  reconcileCustomerVisitEvents,
} from './customerIdentity.js';
import { ensureGolfDay, initGolfDay } from './golfDay.js';
import { initTractor, ensureTractor } from './tractor.js';
import { bunkerDailyMess } from './bunkers.js';
import { ensureSurfaceDamage, surfaceDamageDaily } from './surfaceDamage.js';
import { ensureMaintenanceOrders, tickMaintenanceOrders } from './maintenanceOrders.js';
import {
  courseMaintenanceDailyTick,
  courseMaintenanceHourlyTick,
  ensureCourseMaintenance,
  restoreCourseMaintenance,
  snapshotCourseMaintenance,
} from './courseMaintenance.js';
import { initCourseProps, ensureCourseProps } from './props.js';
import { simulateDayRounds } from './rounds.js';
import { initProgression, prestigeDailyTick, resolveTournamentIfDue, solvencyDailyTick } from './progression.js';
import { initTutorial, ensureTutorial } from './tutorial.js';
import { initCampaign, ensureCampaign } from './campaign.js';
import {
  addExpense, beginLedgerClose, closeBooks, ensureLedger, initLedger, LEDGER_HISTORY_DAYS,
  preflightLedgerEntry, preflightOutcome,
} from './economy.js';
import { closeDayIndicators, ensureBusiness, initBusiness } from './business.js';
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
import { closeSignForNewDay, healShopSign } from './shopSign.js';
import {
  SaveCompatibilityError,
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
// v11: durable property placeables gain their own property-scoped ownership,
// delivery, storage, and placement authority. Existing decor/backroom counts
// migrate conservatively without changing retail merchandise stock.
// v12: the pro shop begins as a compact BASIC operation and expands through
// constructed STANDARD, PREMIUM, and LUXURY tiers. Legacy saves retain their
// existing full fixture floor until they purchase their next tier.
// v13: Pine Hills becomes the canonical display identity and the furnished
// clubhouse restoration is installed idempotently without changing property ids.
// v14: sales-tax liability becomes a durable authority. V13 ledger entries are
// replayed as migration evidence only; no cash or accounting entry is posted.
// v15: every current-schema shop save carries the signed checkout settlement
// journal. Its absence is therefore distinguishable from a legitimate V14
// legacy save and must fail closed instead of guessing whether banked money and
// held stock belonged to an interrupted checkout.
export const SAVE_VERSION = 15;
export const SALES_TAX_SAVE_VERSION = 14;
export const CHECKOUT_WAL_SAVE_VERSION = 15;
export const DEFAULT_CLUB_NAME = 'Pine Hills Municipal Golf';
const LEGACY_DEFAULT_CLUB_NAMES = new Set([
  'Willow Creek Golf Club',
  'Willow Creek Municipal',
  'Willow Creek Municipal Golf',
]);

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
  Object.freeze({ version: 11, name: 'property-inventory' }),
  Object.freeze({ version: 12, name: 'tiered-shop-progression' }),
  Object.freeze({ version: 13, name: 'pine-hills-furnished-clubhouse' }),
  Object.freeze({ version: SALES_TAX_SAVE_VERSION, name: 'durable-sales-tax-liability' }),
  Object.freeze({ version: CHECKOUT_WAL_SAVE_VERSION, name: 'durable-checkout-settlement-journal' }),
]);

export const FIXTURE_FOOTPRINT_SAVE_VERSION = 10;
const CLEANING_FIELD = wetGridForRoom(RENO.room);
const ROUTE_FAILURE = /customers could not get around/i;

function placedRetailShelfUnitsBySku(state) {
  const totals = new Map();
  const placements = Array.isArray(state?.propertyInventory?.placements)
    ? state.propertyInventory.placements
    : [];
  for (const placement of placements) {
    const zones = placement?.retailShelfStock?.zones;
    if (!zones || typeof zones !== 'object' || Array.isArray(zones)) continue;
    for (const record of Object.values(zones)) {
      const skuId = typeof record?.skuId === 'string' ? record.skuId : '';
      const quantity = Number.isFinite(record?.quantity)
        ? Math.max(0, Math.floor(record.quantity))
        : 0;
      if (!skuId || quantity <= 0) continue;
      totals.set(skuId, (totals.get(skuId) || 0) + quantity);
    }
  }
  return totals;
}

// Keep every owned unit while making the serialized inventory agree with the
// physical display. Older builds allowed category caps (often 16/24) to exceed
// the number of authored product sockets. Player-placed shelves add their own
// real authored capacity, so their assigned units must survive save repair.
function reconcileShelfCapacity(state) {
  const shop = state?.shop;
  if (!shop || !shop.inventory) return;
  const placedShelfUnits = placedRetailShelfUnitsBySku(state);
  for (const sku of SHOP_CATALOG) {
    const inventory = shop.inventory[sku.id];
    if (!inventory) continue;
    const capacity = Math.max(0, capacityOf(sku.id)) + (placedShelfUnits.get(sku.id) || 0);
    if (!Number.isFinite(inventory.shelf) || inventory.shelf <= capacity) continue;
    const excess = inventory.shelf - capacity;
    if (state.shop.inventoryLifecycle) {
      moveInventory(state, {
        from: INVENTORY_STAGE.SHELF,
        to: INVENTORY_STAGE.RESERVE,
        quantity: excess,
        skuId: sku.id,
        reason: 'Authored shelf-capacity repair',
        refreshOrder: false,
      });
    }
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
  if (shop.layout.objects?.feature?.state === 'stored') delete shop.layout.objects.feature;
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
  const layout = state.shop?.layout;
  const moved = layout?.moved;
  if (!moved || typeof moved !== 'object' || Array.isArray(moved)) return;

  const ids = Object.keys(moved);
  const objects = layout.objects && typeof layout.objects === 'object'
    ? layout.objects
    : (layout.objects = {});
  const detachPose = (id) => {
    const pose = moved[id];
    const record = objects[id];
    delete moved[id];
    delete objects[id];
    return { pose, record };
  };
  const restorePose = (id, detached) => {
    if (detached.pose) moved[id] = detached.pose;
    if (detached.record) objects[id] = detached.record;
  };
  let repairedRotation = false;
  for (const id of ids) {
    const pose = moved[id];
    if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z)) {
      detachPose(id);
      continue;
    }
    if (!Number.isFinite(pose.ry)) {
      pose.ry = 0;
      repairedRotation = true;
    }
  }

  // Validate each legacy override against the authored plan, not against the
  // other untrusted overrides. Otherwise one corrupt pose can make a separate
  // legal player move look like an overlap and both placements are discarded.
  // Keep route-only candidates for the route attribution pass below.
  const candidates = ids
    .filter((id) => moved[id])
    .map((id) => [id, detachPose(id)]);
  for (const [id, detached] of candidates) {
    const { pose } = detached;
    const result = validatePlacement(state, id, pose.x, pose.z, pose.ry);
    if (result.ok || result.reasons.every((reason) => ROUTE_FAILURE.test(reason))) {
      restorePose(id, detached);
    }
  }

  // Once all direct faults are gone, attribute a remaining route failure by
  // testing the authored fallback for each legacy override. This preserves all
  // unrelated moves when one pose alone blocks a required shop route.
  let removedRoutePose = true;
  while (!routesIntact(state) && removedRoutePose) {
    removedRoutePose = false;
    for (const id of ids) {
      const pose = moved[id];
      if (!pose) continue;
      const detached = detachPose(id);
      if (routesIntact(state)) {
        removedRoutePose = true;
        break;
      }
      restorePose(id, detached);
    }
  }

  // Multiple legacy overrides can jointly cut a route even when no single
  // fallback repairs it. Rebuild that rare case from the safe authored plan,
  // retaining each override only when the normal placement rules accept it.
  if (!routesIntact(state)) {
    const routeCandidates = ids
      .filter((id) => moved[id])
      .map((id) => [id, detachPose(id)]);
    for (const [id, detached] of routeCandidates) {
      const { pose } = detached;
      if (validatePlacement(state, id, pose.x, pose.z, pose.ry).ok) {
        restorePose(id, detached);
      }
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
function reconcileUnavailableFixtureStock(state) {
  const shop = state?.shop;
  if (!shop?.inventory) return;
  const installed = new Set(placedFixtures(state).map((fixture) => fixture.id));
  const placedShelfUnits = placedRetailShelfUnitsBySku(state);
  for (const sku of SHOP_CATALOG) {
    const fixture = homeFixture(sku.id);
    const inventory = shop.inventory[sku.id];
    if (!fixture || installed.has(fixture.id) || !inventory) continue;
    const shelf = Number.isFinite(inventory.shelf) ? inventory.shelf : 0;
    const retained = Math.min(shelf, placedShelfUnits.get(sku.id) || 0);
    const returned = shelf - retained;
    if (returned <= 0) continue;
    inventory.shelf = retained;
    inventory.back = (Number.isFinite(inventory.back) ? inventory.back : 0) + returned;
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
    clubName: opts.clubName || DEFAULT_CLUB_NAME,
    course,
    sections: labelSections(course), // derived cache, rebuilt on load/edit
    weather: newWeather(),
    pendingMorning: true, // maintenance pass runs at the first 5 AM
  };
  // day-1 weather + turf initial condition draw from the same seeded stream
  rollDailyWeather(state.weather, rngOf(state), calendarOf(state.clock.minutes).dayOfYear);
  initTurf(state);
  ensureMaintenanceOrders(state);
  ensureCourseMaintenance(state);
  initGolfers(state);
  initStaff(state);
  initClub(state);
  initReputation(state);
  initShop(state);
  // The furnished clubhouse and every headless inventory authority need the
  // same canonical placement record before a renderer is constructed.
  ensureLayout(state);
  reconcileShelfCapacity(state);
  // Keep the lot ledger lazy on a brand-new in-memory state. Campaign seeding
  // and code-level scenario builders still use the public numeric projection
  // during construction; the first lifecycle operation captures that finished
  // opening state atomically. Deserialization continues to ensure the ledger
  // explicitly once all persisted domains have been restored.
  // Persisted register authorities exist from the first save, not only after
  // the renderer happens to construct the clubhouse or register. Fixture
  // layout stays lazy because read-only placement queries must remain pure.
  state.shop.drawer = newDrawer();
  ensurePaymentBag(state);
  ensureShopReno(state);
  ensureClubhouseRestoration(state);
  ensureDebris(state);
  state.shop.reno.pan = 0;
  state.shop.reno.bag = 0;
  ensureWet(state, CLEANING_FIELD.w, CLEANING_FIELD.h);
  ensureWash(state); // a fixer-upper arrives with a filthy exterior
  ensureProperty(state); // ...and a landlord
  bindPropertyInventory(state, opts.propertyId || `property:${seed}`);
  // Sales-tax liability is a first-class save authority. Initialize it before
  // the first checkout so a collected cent can never live only in a lazy
  // runtime object and disappear across a save/load boundary.
  ensureSalesTax(state);
  initReservations(state);
  initGolfDay(state);
  initCustomerSimulation(state);
  planCustomerArrivals(state, calendarOf(state.clock.minutes).dayAbs);
  initCustomerDirectory(state);
  initTractor(state);
  initCourseProps(state);
  initLedger(state);
  initBusiness(state);
  initProgression(state);
  initTutorial(state);
  initNotifications(state);
  state.uiPrefs = {};
  if (opts.campaign) initCampaign(state, { fresh: true });
  if (!Array.isArray(state.club.reviews)) state.club.reviews = [];
  return state;
}

// --- master tick --------------------------------------------------------------

export function dailyTick(state) {
  // Midnight must not close books or roll sales while a prepared checkout still
  // owns economic projections from the prior operating day.
  const checkoutRecovery = drainPendingCheckoutCore(state);
  if (!checkoutRecovery.ok || checkoutRecovery.pending > 0) {
    return {
      ok: false,
      pendingCheckout: true,
      reason: checkoutRecovery.failures?.[0]?.reason
        || 'A pending checkout must recover before the operating day can close.',
      diagnostic: checkoutRecovery.failures?.[0]?.diagnostic,
    };
  }
  const todayAbs = calendarOf(state.clock.minutes).dayAbs;
  const closingDay = todayAbs - 1;
  // Midnight has advanced the clock already, but the newly exposed horizon and
  // all settlement work still belong to the operating day being closed.
  if (state.ledger) beginLedgerClose(state, closingDay);
  // Open the newly visible far edge of the tee sheet before closing the books.
  // Its advance card payments belong to the operating day that accepted them,
  // keeping the main ledger and wallet exactly reconciled at midnight.
  if (state.reservations && (!state.campaign?.enabled || state.campaign.businessOpen)) {
    ensureReservationHorizon(state, { todayAbs });
  }
  // 1) settle the day that just ended: accrue its recurring economy, close books
  if (state.ledger) {
    const todayAbs = calendarOf(state.clock.minutes).dayAbs;
    const closingDay = todayAbs - 1;
    beginLedgerClose(state, closingDay);
    if (!state.campaign?.enabled || state.campaign.businessOpen) accrueDaily(state);
    if (state.shop && (!state.campaign?.enabled || state.campaign.businessOpen)) {
      shopDailyAccrual(state);
    }
    if (state.golfers && (!state.campaign?.enabled || state.campaign.businessOpen)) {
      simulateDayRounds(state, state.club.lastRounds || 0);
    }
    if (state.progression) resolveTournamentIfDue(state, closingDay);
    if (state.reservations) reservationsDailyTick(state, todayAbs);
    // the rent falls due whether or not it was a good week; it is announced two days out
    state.lastPropertyEvent = tickProperty(state, todayAbs);
    // Sales tax rides the same 7-day cycle as the property bill: collected all week at the
    // till, paid to the state on the cycle day. It was never income, so remitting it does not
    // move profit — only cash.
    state.lastSalesTaxEvent = tickSalesTax(state, todayAbs);
    const indicators = closeDayIndicators(state, closingDay);
    closeBooks(state, closingDay, indicators);
  }

  // 2) roll into the new day
  if (!state.weather.locked) {
    rollDailyWeather(state.weather, rngOf(state), calendarOf(state.clock.minutes).dayOfYear);
  } else {
    // locked weather still tracks drought for tests/scenarios
    state.weather.droughtDays = state.weather.today.rainIn > 0 ? 0 : state.weather.droughtDays + 1;
  }
  tickRenovationsDaily(state);
  // THE SIGN GOES BACK TO CLOSED OVERNIGHT. The morning preparation window —
  // unlock, clean, stock, check the sheet, THEN open — is the whole point of
  // the sign; a sign that stayed open would delete it (src/sim/shopSign.js).
  if (state.shop) closeSignForNewDay(state);
  if (state.shop) tickShopProgressionDaily(state, shopExpansionLayoutSafety);
  turfDailyTick(state);
  courseMaintenanceDailyTick(state, { coarseAdvanced: true });
  if (state.staff) {
    tickStaffDaily(state);
    refreshMarketIfDue(state, calendarOf(state.clock.minutes).dayAbs);
  }
  if (state.club) dailyMembershipTick(state);
  if (state.shop) deliverOrdersDue(state, calendarOf(state.clock.minutes).dayAbs);
  if (state.reservations) reservationsDailyTick(state, calendarOf(state.clock.minutes).dayAbs);
  if (state.reservations && (!state.campaign?.enabled || state.campaign.businessOpen)) {
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
  if (state.turf) surfaceDamageDaily(state); // bounded divots + ball marks from actual play
  if (state.progression) {
    prestigeDailyTick(state);
    solvencyDailyTick(state);
  }
  state.pendingMorning = true;
}

export function hourlyTick(state, hourOfDay) {
  if (state.shop) tickDeliveries(state, state.clock.minutes); // windowed trucks land on time headless too
  if (state.maintenance) tickMaintenanceOrders(state, 60);
  // the crew starts at 5 AM; catch up later in the morning if time skipped past it
  if (state.pendingMorning && hourOfDay >= 5) {
    state.pendingMorning = false;
    const report = runMorningMaintenance(state, calendarOf(state.clock.minutes).dayAbs);
    if (report) {
      if (state.ledger) {
        if (report.costs.wages > 0) addExpense(state, 'wagesDayLabor', report.costs.wages, {
          idempotencyKey: `maintenance:${report.dayAbs}:day-labour`, relatedId: `maintenance-${report.dayAbs}`, source: 'morning-maintenance',
        });
        if (report.costs.water > 0) addExpense(state, 'water', report.costs.water, {
          idempotencyKey: `maintenance:${report.dayAbs}:water`, relatedId: `maintenance-${report.dayAbs}`, source: 'morning-maintenance',
        });
        if (report.costs.fertilizer > 0) addExpense(state, 'fertilizer', report.costs.fertilizer, {
          idempotencyKey: `maintenance:${report.dayAbs}:fertilizer`, relatedId: `maintenance-${report.dayAbs}`, source: 'morning-maintenance',
        });
      } else {
        state.cash -= Math.round(report.costs.wages + report.costs.water + report.costs.fertilizer);
      }
    }
  }
  turfHourlyTick(state, hourOfDay);
  if (state.reservations) golfOperationsTick(state, state.clock.minutes);
  courseMaintenanceHourlyTick(state, { coarseAdvanced: true });
}

export function update(state, gameMinutes) {
  // Drain before advancing the clock so recovery keeps the settlement's day,
  // sales window, and outcome aligned with the payment the player completed.
  const checkoutRecovery = reconcilePendingCheckouts(state);
  if (!checkoutRecovery.ok || checkoutRecovery.pending > 0) {
    return {
      daysPassed: 0,
      pendingCheckout: true,
      reason: checkoutRecovery.failures?.[0]?.reason
        || 'A pending checkout must recover before time can advance.',
      diagnostic: checkoutRecovery.failures?.[0]?.diagnostic,
    };
  }
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
const cloneSaveValue = (value, fallback = value) => {
  try {
    return value == null ? value : structuredClone(value);
  } catch (_) {
    return fallback;
  }
};

const STATE_SAVE_KEYS = new Set([
  'version', 'mode', 'seed', 'rngState', 'clock', 'cash', 'clubName',
  'pendingMorning', 'course', 'weather', 'maintenance', 'courseMaintenance',
  'golfers', 'staff', 'club', 'reputation', 'business', 'ledger', 'shop',
  'reservations', 'golfDay', 'customerDirectory', 'tractor', 'props',
  'progression', 'tutorial', 'campaign', 'notifications', 'uiPrefs',
  'property', 'propertyInventory', 'salesTax', 'surfaceDamage', 'debtDays', 'failed', 'turf',
]);
const COURSE_SAVE_KEYS = new Set([
  'w', 'h', 'zones', 'elevation', 'holes', 'nextHoleId', 'structures',
  'objects', 'nextObjectId', 'paths', 'nextPathId', 'irrigationHeads', 'vec', 'paint',
]);
const TURF_SAVE_KEYS = new Set([
  'health', 'moisture', 'nutrients', 'heightMm', 'wear', 'disType', 'disSev',
  'treated', 'divots', 'ballMarks',
]);
const UNSAFE_SAVE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function copyUnknownSaveFields(target, source, knownKeys, { hidden = false } = {}) {
  if (!target || !isRecord(source)) return;
  const entries = Object.entries(source)
    .filter(([key]) => !knownKeys.has(key) && !UNSAFE_SAVE_KEYS.has(key))
    .map(([key, value]) => [key, cloneSaveValue(value, undefined)])
    .filter(([, value]) => value !== undefined);
  if (!entries.length) return;
  const unknown = Object.fromEntries(entries);
  if (hidden) {
    Object.defineProperty(target, '__unknownSaveFields', {
      value: unknown,
      writable: true,
      configurable: true,
    });
  } else {
    Object.assign(target, unknown);
  }
}

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

function golfDayForSave(day) {
  if (!day) return null;
  const { routeNetwork: _routeNetwork, performance: _performance, ...persisted } = day;
  const carts = (persisted.carts || []).map((cart) => (cart.status === 'player-driving'
    ? {
      ...cart,
      status: 'available',
      assignedPartyId: null,
      assignedStaffId: null,
      parkedByPlayer: true,
    }
    : cart));
  return {
    ...persisted,
    carts,
    // Route paths are deterministic from the serialized course and can be large.
    // Rebuild them on restore; live parties retain their route snapshots.
    routeNetwork: null,
    // Recycled empty shells are an optimization, not player state.
    partyPool: [],
  };
}

export function snapshot(state) {
  const authorities = validateCheckoutSettlementAuthorities(state);
  if (!authorities.ok) {
    throw new Error(authorities.diagnostic || 'The checkout settlement authority is invalid.');
  }
  // Customer identity aliases must be canonical before a checkout tail tries
  // to publish its durable visit event.
  reconcileReservationCustomerIdentities(state);
  if (!checkoutWalIsQuarantined(state)) {
    const recovery = reconcilePendingCheckouts(state);
    if (!recovery.ok || recovery.pending !== 0) {
      throw new Error('Cannot save while checkout settlement recovery is incomplete.');
    }
  }
  // Reservations keep compatibility name fields for old UI, but the directory
  // is their sole identity authority. Reconcile before every persisted snapshot.
  // A prepared settlement is the durable commit decision. Drain its economic,
  // inventory, ticket, reservation, and customer projections before writing a
  // snapshot; exact targets make repeated snapshots no-ops.
  reconcileReservationCheckInTickets(state);
  // A banked ticket is the durable outbox for customer accounting. Drain any
  // pending event before snapshotting; event ids make repeat snapshots no-ops.
  reconcileCustomerVisitEvents(state);
  const { course, turf } = state;
  return ({
    ...(state.__unknownSaveFields || {}),
    version: SAVE_VERSION,
    mode: state.mode,
    seed: state.seed,
    rngState: state.rngState,
    clock: { ...state.clock, minutes: state.clock.minutes },
    cash: Number.isFinite(state.cash) ? Math.round(state.cash * 100) / 100 : 0,
    clubName: state.clubName,
    pendingMorning: state.pendingMorning,
    course: {
      ...course,
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
      ...state.weather,
      today: state.weather.today,
      droughtDays: state.weather.droughtDays,
      bias: state.weather.bias,
    },
    maintenance: state.maintenance,
    courseMaintenance: snapshotCourseMaintenance(state.courseMaintenance),
    golfers: state.golfers,
    staff: state.staff,
    club: state.club,
    reputation: state.reputation,
    business: state.business,
    ledger: state.ledger,
    shop: shopForSave(state.shop),
    reservations: state.reservations,
    golfDay: golfDayForSave(state.golfDay),
    customerDirectory: state.customerDirectory,
    tractor: state.tractor,
    props: state.props,
    progression: state.progression,
    tutorial: state.tutorial,
    campaign: state.campaign || null,
    notifications: state.notifications, // unread warnings survive the reload
    phone: state.phone || null, // A1: call history, missed calls, texts
    mail: state.mail || null, // A2: the laptop inbox
    uiPrefs: state.uiPrefs || null, // the office machine's own settings (scale, default views)
    property: state.property, // the rent schedule, or reloading is a rent holiday
    propertyInventory: state.propertyInventory,
    salesTax: ensureSalesTax(state),
    surfaceDamage: state.surfaceDamage,
    debtDays: state.debtDays || 0,
    failed: state.failed || null,
    turf: turf
      ? {
          ...turf,
          health: Array.from(turf.health, round1),
          moisture: Array.from(turf.moisture, round1),
          nutrients: Array.from(turf.nutrients, round1),
          heightMm: Array.from(turf.heightMm, round1),
          wear: Array.from(turf.wear, round1),
          disType: Array.from(turf.disType),
          disSev: Array.from(turf.disSev, round1),
          treated: Array.from(turf.treated),
          divots: Array.from(turf.divots || [] , round1),
          ballMarks: Array.from(turf.ballMarks || [], round1),
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
  const irrigationHeads = [];
  if (Array.isArray(savedCourse.irrigationHeads)) {
    for (let index = 0; index < Math.min(savedCourse.irrigationHeads.length, n); index += 1) {
      const head = savedCourse.irrigationHeads[index];
      if (!isRecord(head) || !Number.isFinite(head.x) || !Number.isFinite(head.y)) continue;
      const x = Math.min(w - 1, Math.max(0, Math.trunc(head.x)));
      const y = Math.min(h - 1, Math.max(0, Math.trunc(head.y)));
      if (!irrigationHeads.some((item) => item.x === x && item.y === y)) irrigationHeads.push({ x, y });
    }
    if (irrigationHeads.length !== savedCourse.irrigationHeads.length) {
      noteRepair(report, '$.course.irrigationHeads', 'invalid or duplicate sprinkler heads removed');
    }
  } else if (savedCourse.irrigationHeads != null) {
    noteRepair(report, '$.course.irrigationHeads', 'invalid sprinkler-head array defaulted');
  }
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
    irrigationHeads,
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
  course.nextObjectId = safeNextId(course.objects, course.nextObjectId);
  ensureCourseShape(course);
  return course;
}

function normalizeTurf(rawTurf, defaults, report) {
  if (!isRecord(rawTurf)) {
    if (rawTurf !== undefined && rawTurf !== null) {
      noteRepair(report, '$.turf', 'invalid turf block defaulted');
    }
    return defaults;
  }
  const pct = (number) => Math.min(100, Math.max(0, number));
  const emptyDamage = new Float32Array(defaults.health.length);
  return {
    health: normalizeNumericArray(rawTurf.health, defaults.health, Float32Array, report, '$.turf.health', pct),
    moisture: normalizeNumericArray(rawTurf.moisture, defaults.moisture, Float32Array, report, '$.turf.moisture', pct),
    nutrients: normalizeNumericArray(rawTurf.nutrients, defaults.nutrients, Float32Array, report, '$.turf.nutrients', pct),
    heightMm: normalizeNumericArray(rawTurf.heightMm, defaults.heightMm, Float32Array, report, '$.turf.heightMm', (number) => Math.min(250, Math.max(0, number))),
    wear: normalizeNumericArray(rawTurf.wear, defaults.wear, Float32Array, report, '$.turf.wear', pct),
    disType: normalizeNumericArray(rawTurf.disType, defaults.disType, Uint8Array, report, '$.turf.disType', (number) => Math.min(255, Math.max(0, Math.trunc(number)))),
    disSev: normalizeNumericArray(rawTurf.disSev, defaults.disSev, Float32Array, report, '$.turf.disSev', pct),
    treated: normalizeNumericArray(rawTurf.treated, defaults.treated, Uint8Array, report, '$.turf.treated', (number) => Math.min(255, Math.max(0, Math.trunc(number)))),
    divots: normalizeNumericArray(rawTurf.divots, emptyDamage, Float32Array, report, '$.turf.divots', pct),
    ballMarks: normalizeNumericArray(rawTurf.ballMarks, emptyDamage, Float32Array, report, '$.turf.ballMarks', pct),
  };
}

const CHECKOUT_LEDGER_SUFFIXES = Object.freeze([
  'sale', 'salestax', 'cogs', 'cash-over-short', 'cash-overage',
]);
const CHECKOUT_PROJECTION_SUFFIXES = Object.freeze([
  'sales-projection', 'tax-projection',
]);
const CHECKOUT_INVENTORY_PREFIX = 'checkout-sale-batch:v2:';

function checkoutTransactionFromKey(key, suffixes) {
  if (typeof key !== 'string' || !key.startsWith('checkout:')) return null;
  for (const suffix of suffixes) {
    const tail = `:${suffix}`;
    if (!key.endsWith(tail)) continue;
    const transactionId = key.slice('checkout:'.length, -tail.length);
    if (transactionId) return { transactionId, suffix };
  }
  return null;
}

function checkoutMarkerMatches(value, settlementId) {
  return isRecord(value)
    && value.version === CHECKOUT_SETTLEMENT_VERSION
    && value.settlementId === settlementId;
}

function settlementIdFromMarker(value) {
  return isRecord(value)
    && value.version === CHECKOUT_SETTLEMENT_VERSION
    && typeof value.settlementId === 'string'
    && value.settlementId
    ? value.settlementId : null;
}

function sameCheckoutValue(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function ticketMatchesCheckoutKey(ticket, key) {
  if (key?.kind === 'transaction') return ticket?.transactionId === key.transactionId;
  return key?.kind === 'service'
    && ticket?.type === key.type
    && ticket?.referenceId === key.referenceId;
}

function ticketRetailPairs(ticket) {
  if (!Array.isArray(ticket?.items)) return null;
  const pairs = ticket.items
    .filter((item) => typeof item?.skuId === 'string' && !item.skuId.startsWith('service:'))
    .map((item) => [item?.uid, item?.skuId]);
  if (pairs.some(([uid, skuId]) => typeof uid !== 'string' || !uid
      || typeof skuId !== 'string' || !skuId)) return null;
  const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
  return pairs.sort((left, right) => (
    compare(left[0], right[0]) || compare(left[1], right[1])
  ));
}

function checkoutEvidenceGroup(groups, settlementId) {
  if (!groups.has(settlementId)) {
    groups.set(settlementId, {
      settlementId,
      hard: false,
      plans: [],
      receipts: [],
      tickets: [],
      rows: [],
      outcomes: [],
      processed: [],
      processedOutcomes: [],
      projections: [],
      inventoryOperations: [],
    });
  }
  return groups.get(settlementId);
}

function currentCheckoutSchemaClaim(raw, persistedVersion) {
  const numericLikeVersion = Number(raw?.version);
  return persistedVersion >= CHECKOUT_WAL_SAVE_VERSION
    || (Number.isSafeInteger(numericLikeVersion)
      && numericLikeVersion >= CHECKOUT_WAL_SAVE_VERSION)
    || ['pendingCheckouts', 'checkoutSettlementReceipts',
      'checkoutSettlementReceiptKeys', 'checkoutProjectionIds']
      .some((field) => Object.hasOwn(raw?.shop || {}, field))
    || Object.values(isRecord(raw?.shop?.pendingCheckouts)
      ? raw.shop.pendingCheckouts : {}).some((plan) => (
      settlementIdFromMarker(plan?.checkoutSettlement) != null
    ))
    || Object.values(isRecord(raw?.shop?.checkoutSettlementReceipts)
      ? raw.shop.checkoutSettlementReceipts : {}).some((receipt) => (
      receipt?.version === CHECKOUT_SETTLEMENT_VERSION
    ))
    || (Array.isArray(raw?.shop?.transactionHistory)
      && raw.shop.transactionHistory.some((ticket) => (
        settlementIdFromMarker(ticket?.checkoutSettlement) != null
      )))
    || (Array.isArray(raw?.ledger?.entries) && raw.ledger.entries.some((entry) => (
      settlementIdFromMarker(entry?.metadata?.checkoutSettlement) != null
    )))
    || (Array.isArray(raw?.ledger?.outcomes) && raw.ledger.outcomes.some((outcome) => (
      settlementIdFromMarker(outcome?.metadata?.checkoutSettlement) != null
    )))
    || Object.keys(isRecord(raw?.shop?.inventoryLifecycle?.operations)
      ? raw.shop.inventoryLifecycle.operations : {})
      .some((key) => key.startsWith(CHECKOUT_INVENTORY_PREFIX));
}

function pendingPlanFinancialEvidenceIsCoherent(raw, plan, receipt = null) {
  const ledger = raw?.ledger;
  const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
  const processedIds = isRecord(ledger?.processedIds) ? ledger.processedIds : {};
  for (const posting of plan.postings || []) {
    const key = posting.spec.idempotencyKey;
    const expectedId = plan.ticketDraft?.ledgerEntryIds?.[posting.component];
    const rows = entries.filter((entry) => entry?.idempotencyKey === key);
    const checkpointPresent = Object.hasOwn(processedIds, key);
    const checked = (rows.length > 0 || checkpointPresent)
      ? preflightLedgerEntry(raw, posting.spec) : null;
    const receiptPosting = receipt?.postings?.find((item) => item.idempotencyKey === key) || null;
    if (rows.length > 1
        || (receipt && (!receiptPosting || receiptPosting.entryId !== expectedId))
        || (rows.length === 1 && (rows[0].id !== expectedId
          || rows[0].relatedId == null
          || posting.spec.relatedId == null
          || String(rows[0].relatedId) !== String(posting.spec.relatedId)
          || !checkoutMarkerMatches(rows[0].metadata?.checkoutSettlement, plan.settlementId)))
        || (checkpointPresent && (processedIds[key] !== expectedId
          || rows.length !== 1 || !checked?.ok || !checked.duplicate))
        || (!checkpointPresent && rows.length === 1 && (!checked?.orphan
          || checked.entry?.id !== expectedId))) return false;
  }

  if (plan.outcomeSpec == null) {
    return receipt?.outcomeId == null && receipt?.outcomeKey == null;
  }
  const outcomeKey = plan.outcomeSpec.idempotencyKey;
  const outcomes = Array.isArray(ledger?.outcomes) ? ledger.outcomes : [];
  const rows = outcomes.filter((outcome) => outcome?.idempotencyKey === outcomeKey);
  const processed = isRecord(ledger?.processedOutcomeIds) ? ledger.processedOutcomeIds : {};
  const checkpointPresent = Object.hasOwn(processed, outcomeKey);
  const checked = (rows.length > 0 || checkpointPresent)
    ? preflightOutcome(raw, plan.outcomeSpec) : null;
  const expectedId = checked?.preview?.id
    || plan.outcomeSpec.id
    || receipt?.outcomeId
    || null;
  return rows.length <= 1
    && (!receipt || (receipt.outcomeKey === outcomeKey && receipt.outcomeId === expectedId))
    && (rows.length === 0 || (rows[0].id === expectedId
      && rows[0].type === plan.outcomeSpec.type
      && rows[0].relatedId != null
      && plan.outcomeSpec.relatedId != null
      && String(rows[0].relatedId) === String(plan.outcomeSpec.relatedId)
      && checkoutMarkerMatches(rows[0].metadata?.checkoutSettlement, plan.settlementId)))
    && (!checkpointPresent || (processed[outcomeKey] === expectedId
      && rows.length === 1 && checked?.ok && checked.duplicate))
    && (checkpointPresent || rows.length === 0 || (checked?.orphan
      && checked.outcome?.id === expectedId));
}

function classifyCheckoutJournalCoherence(raw, persistedVersion) {
  const groups = new Map();
  const rawShop = raw?.shop;
  const schemaClaim = currentCheckoutSchemaClaim(raw, persistedVersion);
  if (!isRecord(rawShop)) {
    return schemaClaim
      ? { unsafe: true, diagnostic: 'missing-current-checkout-shop-authority' }
      : { unsafe: false };
  }

  const walPresent = Object.hasOwn(rawShop, 'pendingCheckouts');
  const requiredAuthorityFields = [
    'pendingCheckouts',
    'checkoutSettlementReceipts',
    'checkoutSettlementReceiptKeys',
    'checkoutProjectionIds',
  ];
  if (schemaClaim && requiredAuthorityFields.some((field) => !Object.hasOwn(rawShop, field))) {
    return { unsafe: true, diagnostic: 'missing-current-checkout-journal' };
  }
  if (walPresent) {
    const validation = validateCheckoutWalRecord(rawShop.pendingCheckouts, raw);
    if (!validation.ok) return { unsafe: true, diagnostic: 'invalid-current-checkout-journal' };
    for (const plan of Object.values(rawShop.pendingCheckouts)) {
      const group = checkoutEvidenceGroup(groups, plan.settlementId);
      group.hard = true;
      group.plans.push(plan);
    }
  }

  const receiptFieldsPresent = Object.hasOwn(rawShop, 'checkoutSettlementReceipts')
    || Object.hasOwn(rawShop, 'checkoutSettlementReceiptKeys');
  if (schemaClaim && !receiptFieldsPresent) {
    return { unsafe: true, diagnostic: 'missing-current-checkout-receipts' };
  }
  if (schemaClaim || receiptFieldsPresent) {
    const receiptValidation = validateCheckoutSettlementReceipts(
      rawShop.checkoutSettlementReceipts,
      rawShop.checkoutSettlementReceiptKeys,
      raw,
    );
    if (!receiptValidation.ok) {
      return { unsafe: true, diagnostic: 'invalid-current-checkout-receipts' };
    }
    for (const receipt of Object.values(rawShop.checkoutSettlementReceipts)) {
      const group = checkoutEvidenceGroup(groups, receipt.settlementId);
      group.hard = true;
      group.receipts.push(receipt);
    }
  }

  const retainedServiceSettlementIds = new Map();
  for (const receipt of Object.values(isRecord(rawShop.checkoutSettlementReceipts)
    ? rawShop.checkoutSettlementReceipts : {})) {
    if (receipt?.ticketKey?.kind !== 'service') continue;
    retainedServiceSettlementIds.set(
      `${receipt.ticketKey.type}\u0000${receipt.ticketKey.referenceId}`,
      receipt.settlementId,
    );
  }
  for (const plan of Object.values(isRecord(rawShop.pendingCheckouts)
    ? rawShop.pendingCheckouts : {})) {
    for (const key of [plan?.ticketKey, ...(Array.isArray(plan?.alternateTicketKeys)
      ? plan.alternateTicketKeys : [])]) {
      if (key?.kind !== 'service') continue;
      retainedServiceSettlementIds.set(
        `${key.type}\u0000${key.referenceId}`,
        plan.settlementId,
      );
    }
  }

  const projectionJournal = rawShop.checkoutProjectionIds;
  if (projectionJournal != null && !isRecord(projectionJournal)) {
    return { unsafe: true, diagnostic: 'invalid-current-checkout-projections' };
  }
  for (const [projectionId, projection] of Object.entries(projectionJournal || {})) {
    const parsed = checkoutTransactionFromKey(projectionId, CHECKOUT_PROJECTION_SUFFIXES);
    if (!parsed || !isRecord(projection)) {
      return { unsafe: true, diagnostic: 'invalid-current-checkout-projections' };
    }
    const markerId = settlementIdFromMarker(projection.checkoutSettlement);
    if (!markerId || markerId !== `checkout:${parsed.transactionId}`) {
      return { unsafe: true, diagnostic: 'invalid-current-checkout-projections' };
    }
    const group = checkoutEvidenceGroup(groups, markerId);
    group.hard = true;
    group.projections.push({ id: projectionId, projection, suffix: parsed.suffix });
  }

  const inventoryOperations = rawShop.inventoryLifecycle?.operations;
  if (isRecord(inventoryOperations)) {
    for (const [referenceId, operation] of Object.entries(inventoryOperations)) {
      if (!referenceId.startsWith(CHECKOUT_INVENTORY_PREFIX)) continue;
      const identity = checkoutInventoryIdentity(referenceId);
      if (!identity) {
        return { unsafe: true, diagnostic: 'invalid-current-checkout-inventory-marker' };
      }
      const group = checkoutEvidenceGroup(groups, `checkout:${identity.transactionId}`);
      group.hard = true;
      group.inventoryOperations.push({ referenceId, operation, identity });
    }
  }

  for (const ticket of Array.isArray(rawShop.transactionHistory)
    ? rawShop.transactionHistory : []) {
    const markerPresent = ticket?.checkoutSettlement != null;
    const serviceSettlementId = typeof ticket?.type === 'string'
      && typeof ticket?.referenceId === 'string'
      ? retainedServiceSettlementIds.get(`${ticket.type}\u0000${ticket.referenceId}`) || null
      : null;
    const currentShape = markerPresent
      || ticket?.checkoutKind === 'direct'
      || (typeof ticket?.transactionId === 'string' && ticket.transactionId)
      || serviceSettlementId != null;
    if (!currentShape) continue;
    const settlementId = markerPresent
      ? settlementIdFromMarker(ticket.checkoutSettlement)
      : (typeof ticket?.transactionId === 'string' && ticket.transactionId
        ? `checkout:${ticket.transactionId}` : serviceSettlementId);
    if (!settlementId || (markerPresent
        && !checkoutMarkerMatches(ticket.checkoutSettlement, settlementId))) {
      return { unsafe: true, diagnostic: 'invalid-current-checkout-ticket-marker' };
    }
    const group = checkoutEvidenceGroup(groups, settlementId);
    if (markerPresent) group.hard = true;
    group.tickets.push(ticket);
  }

  const ledger = raw?.ledger;
  for (const entry of Array.isArray(ledger?.entries) ? ledger.entries : []) {
    const parsed = checkoutTransactionFromKey(entry?.idempotencyKey, CHECKOUT_LEDGER_SUFFIXES);
    const marker = entry?.metadata?.checkoutSettlement;
    const markerId = settlementIdFromMarker(marker);
    if (marker != null && !markerId) {
      return { unsafe: true, diagnostic: 'invalid-current-checkout-ledger-marker' };
    }
    if (!parsed && !markerId) continue;
    const group = checkoutEvidenceGroup(groups, markerId || `checkout:${parsed.transactionId}`);
    if (marker != null) group.hard = true;
    group.rows.push({ entry, suffix: parsed?.suffix ?? null });
  }
  for (const [key, id] of Object.entries(isRecord(ledger?.processedIds)
    ? ledger.processedIds : {})) {
    const parsed = checkoutTransactionFromKey(key, CHECKOUT_LEDGER_SUFFIXES);
    if (!parsed) continue;
    checkoutEvidenceGroup(groups, `checkout:${parsed.transactionId}`).processed.push({ key, id, suffix: parsed.suffix });
  }
  for (const outcome of Array.isArray(ledger?.outcomes) ? ledger.outcomes : []) {
    const parsed = checkoutTransactionFromKey(outcome?.idempotencyKey, ['completed']);
    const marker = outcome?.metadata?.checkoutSettlement;
    const markerId = settlementIdFromMarker(marker);
    if (marker != null && !markerId) {
      return { unsafe: true, diagnostic: 'invalid-current-checkout-outcome-marker' };
    }
    if (!parsed && !markerId) continue;
    const group = checkoutEvidenceGroup(groups, markerId || `checkout:${parsed.transactionId}`);
    if (marker != null) group.hard = true;
    group.outcomes.push(outcome);
  }
  for (const [key, id] of Object.entries(isRecord(ledger?.processedOutcomeIds)
    ? ledger.processedOutcomeIds : {})) {
    const parsed = checkoutTransactionFromKey(key, ['completed']);
    if (!parsed) continue;
    checkoutEvidenceGroup(groups, `checkout:${parsed.transactionId}`).processedOutcomes.push({ key, id });
  }

  const rawHeldUids = (Array.isArray(rawShop.held) ? rawShop.held : [])
    .map((item) => item?.uid)
    .filter((uid) => typeof uid === 'string' && uid);
  const heldUids = new Set(rawHeldUids);
  const heldAllocationUids = new Set(Object.keys(
    isRecord(rawShop.inventoryLifecycle?.heldAllocations)
      ? rawShop.inventoryLifecycle.heldAllocations : {},
  ));
  const currentDay = Math.floor((Number(raw?.clock?.minutes) || 0) / 1440);

  for (const group of groups.values()) {
    if (!group.hard) continue;
    if (group.plans.length > 1 || group.receipts.length > 1) {
      return { unsafe: true, diagnostic: 'ambiguous-current-checkout-authority' };
    }
    const plan = group.plans[0] || null;
    if (plan) {
      const postingKeys = new Set(plan.postings.map((posting) => posting.spec.idempotencyKey));
      const projectionIds = new Set((plan.projections || []).map((projection) => projection.id));
      const outcomeKey = plan.outcomeSpec?.idempotencyKey || null;
      const inventoryReferenceId = plan.inventory?.referenceId || null;
      const plannedIdentity = checkoutInventoryIdentity(plan.inventory?.referenceId);
      const plannedPairs = Array.isArray(plan.inventory?.entries)
        ? plan.inventory.entries.map((item) => [item?.uid, item?.skuId]) : [];
      const matchingRawHeld = plannedPairs.map(([uid]) => (
        (Array.isArray(rawShop.held) ? rawShop.held : [])
          .filter((item) => item?.uid === uid)
      ));
      const rebuiltReceipt = group.receipts[0]
        ? checkoutSettlementReceiptForPlan(plan, group.receipts[0].outcomeId) : null;
      const planTicketKeys = [plan.ticketKey, ...(plan.alternateTicketKeys || [])];
      const receiptPostingIds = new Map((group.receipts[0]?.postings || [])
        .map((posting) => [posting.idempotencyKey, posting.entryId]));
      const receiptOutcomeId = group.receipts[0]?.outcomeId || null;
      if (group.tickets.length > 1
          || group.receipts.length > 1
          || (rebuiltReceipt && !sameCheckoutValue(rebuiltReceipt, group.receipts[0]))
          || !pendingPlanFinancialEvidenceIsCoherent(raw, plan, group.receipts[0] || null)
          || (plan.inventory != null && (!plannedIdentity
            || !sameCheckoutValue(plannedIdentity.items, plannedPairs)
            || matchingRawHeld.some((matches) => matches.length > 1
              || (matches.length === 1 && matches[0].skuId !== plannedPairs[matchingRawHeld.indexOf(matches)]?.[1]))))
          || group.rows.some(({ entry }) => !postingKeys.has(entry.idempotencyKey)
            || (group.receipts[0]
              && (entry.id !== receiptPostingIds.get(entry.idempotencyKey)
                || entry.relatedId == null)))
          || group.processed.some(({ key, id }) => !postingKeys.has(key)
            || (group.receipts[0] && id !== receiptPostingIds.get(key)))
          || group.projections.some(({ id }) => !projectionIds.has(id))
          || group.outcomes.some((outcome) => outcome.idempotencyKey !== outcomeKey
            || (group.receipts[0] && outcome.id !== receiptOutcomeId))
          || group.processedOutcomes.some(({ key, id }) => key !== outcomeKey
            || (group.receipts[0] && id !== receiptOutcomeId))
          || group.inventoryOperations.some(({ referenceId }) => referenceId !== inventoryReferenceId)
          || group.tickets.some((ticket) => ticket.number !== plan.ticketNumber
            || !planTicketKeys.every((key) => ticketMatchesCheckoutKey(ticket, key))
            || !sameCheckoutValue(
              ticket?.ledgerIdempotencyKeys,
              plan.ticketDraft?.ledgerIdempotencyKeys,
            )
            || !sameCheckoutValue(ticket?.ledgerEntryIds, plan.ticketDraft?.ledgerEntryIds)
            || (plan.ticketKey.kind === 'transaction'
              && !sameCheckoutValue(ticketRetailPairs(ticket), plannedPairs)))) {
        return { unsafe: true, diagnostic: 'checkout-evidence-owned-by-different-plan' };
      }
      continue;
    }

    const receipt = group.receipts[0] || null;
    const receiptValidation = receipt
      ? validateCheckoutSettlementReceipt(receipt, group.settlementId, raw) : { ok: false };
    if (!receipt || !receiptValidation.ok || receipt.settlementId !== group.settlementId) {
      return { unsafe: true, diagnostic: 'current-checkout-evidence-has-no-journal-or-receipt' };
    }
    if (receipt.minute != null && receipt.minute > Number(raw?.clock?.minutes)) {
      return { unsafe: true, diagnostic: 'terminal-checkout-receipt-time-is-invalid' };
    }
    if (group.projections.length > 0) {
      return { unsafe: true, diagnostic: 'terminal-checkout-retains-active-projection' };
    }
    const ticketKeys = [receipt.ticketKey, ...(receipt.alternateTicketKeys || [])];
    if (group.tickets.length > 1
        || group.tickets.some((ticket) => !ticketKeys.every((key) => (
          ticketMatchesCheckoutKey(ticket, key)
        )))) {
      return { unsafe: true, diagnostic: 'terminal-checkout-ticket-is-ambiguous' };
    }
    const receiptKeys = new Set(receipt.postings.map((posting) => posting.idempotencyKey));
    const receiptByKey = new Map(receipt.postings.map((posting) => [posting.idempotencyKey, posting]));
    if (group.rows.some(({ entry }) => !receiptKeys.has(entry.idempotencyKey))
        || group.processed.some(({ key }) => !receiptKeys.has(key))) {
      return { unsafe: true, diagnostic: 'terminal-checkout-ledger-bindings-conflict' };
    }
    const receiptDay = Number.isFinite(receipt.minute)
      ? Math.floor(receipt.minute / 1440) : null;
    const financialRowsMayBePruned = receiptDay != null
      && currentDay - receiptDay >= LEDGER_HISTORY_DAYS;
    for (const expected of receipt.postings) {
      const checkpointPresent = isRecord(ledger?.processedIds)
        && Object.hasOwn(ledger.processedIds, expected.idempotencyKey);
      const checkpointId = checkpointPresent
        ? ledger.processedIds[expected.idempotencyKey] : null;
      const rows = (Array.isArray(ledger?.entries) ? ledger.entries : [])
        .filter((entry) => entry?.idempotencyKey === expected.idempotencyKey);
      const exactRow = rows.length === 1
        ? preflightLedgerEntry(raw, expected.spec) : null;
      if (!checkpointPresent || checkpointId !== expected.entryId
          || rows.length > 1
          || (rows.length === 0 && !financialRowsMayBePruned)
          || (rows.length === 1 && (!exactRow?.ok || !exactRow.duplicate
            || rows[0].id !== expected.entryId
            || rows[0].relatedId == null
            || String(rows[0].relatedId) !== expected.relatedId
            || (receipt.minute != null && rows[0].timestamp !== receipt.minute)))) {
        return { unsafe: true, diagnostic: 'terminal-checkout-ledger-bindings-incomplete' };
      }
    }
    const exactOutcome = receiptValidation.kind === 'transaction'
      && group.outcomes.length === 1
      ? preflightOutcome(raw, receipt.outcomeSpec) : null;
    if (receiptValidation.kind === 'transaction' && (
      receipt.outcomeKey !== `${group.settlementId}:completed`
        || group.processedOutcomes.length !== 1
        || group.processedOutcomes[0].key !== receipt.outcomeKey
        || group.processedOutcomes[0].id !== receipt.outcomeId
        || group.outcomes.length > 1
        || (group.outcomes.length === 0 && !financialRowsMayBePruned)
        || (group.outcomes.length === 1 && (
          !exactOutcome?.ok || !exactOutcome.duplicate
          || group.outcomes[0].id !== receipt.outcomeId
          || group.outcomes[0].type !== 'checkoutCompleted'
          || String(group.outcomes[0].relatedId) !== receipt.transactionId
          || (receipt.minute != null && group.outcomes[0].timestamp !== receipt.minute)
        )))) {
      return { unsafe: true, diagnostic: 'terminal-checkout-outcome-binding-incomplete' };
    }
    if (receiptValidation.kind === 'service'
        && (group.outcomes.length > 0 || group.processedOutcomes.length > 0
          || group.inventoryOperations.length > 0)) {
      return { unsafe: true, diagnostic: 'terminal-service-checkout-retains-retail-authority' };
    }
    if (group.tickets.length === 1) {
      const ticket = group.tickets[0];
      const expectedPairs = receiptValidation.inventoryIdentity?.items || [];
      const expectedComponents = receipt.postings.map((posting) => posting.component).sort();
      if (ticket.number !== receipt.ticketNumber
          || (receipt.minute != null && ticket.minute !== receipt.minute)
          || checkoutSettlementTicketDigest(ticket)
            !== checkoutSettlementTicketDigest(receipt.ticketSnapshot)
          || !isRecord(ticket.ledgerIdempotencyKeys)
          || !isRecord(ticket.ledgerEntryIds)
          || !sameCheckoutValue(
            Object.keys(ticket.ledgerIdempotencyKeys).sort(),
            expectedComponents,
          )
          || !sameCheckoutValue(
            Object.keys(ticket.ledgerEntryIds).sort(),
            expectedComponents,
          )
          || (receiptValidation.kind === 'transaction'
            && !sameCheckoutValue(ticketRetailPairs(ticket), expectedPairs))
          || receipt.postings.some((posting) => (
            ticket.ledgerIdempotencyKeys[posting.component] !== posting.idempotencyKey
            || ticket.ledgerEntryIds[posting.component] !== posting.entryId
          ))) {
        return { unsafe: true, diagnostic: 'terminal-checkout-ticket-bindings-conflict' };
      }
    }
    if (receiptValidation.kind === 'transaction' && (group.inventoryOperations.length > 1
        || group.inventoryOperations.some(({ referenceId, operation, identity }) => (
          referenceId !== receipt.inventoryReferenceId
          || !isRecord(operation) || operation.ok !== true
          || operation.from !== INVENTORY_STAGE.CUSTOMER_HELD
          || operation.to !== INVENTORY_STAGE.SOLD
          || operation.moved !== identity.items.length
        )))) {
      return { unsafe: true, diagnostic: 'terminal-checkout-inventory-binding-conflicts' };
    }
    if (receipt.itemUids.some((uid) => heldUids.has(uid) || heldAllocationUids.has(uid))) {
      return { unsafe: true, diagnostic: 'terminal-checkout-retains-matching-held-inventory' };
    }
    for (const { key } of group.processed) {
      if (!receiptByKey.has(key)) {
        return { unsafe: true, diagnostic: 'terminal-checkout-has-extra-ledger-binding' };
      }
    }
  }
  return { unsafe: false };
}

function normalizeShopState(state, rawShop, defaults, report, { checkoutJournalCoherence = null } = {}) {
  const shop = state.shop;
  const persistedCheckoutWalPresent = isRecord(rawShop)
    && Object.hasOwn(rawShop, 'pendingCheckouts');
  const persistedCheckoutWalValidation = persistedCheckoutWalPresent
    ? validateCheckoutWalRecord(rawShop.pendingCheckouts)
    : { ok: true };
  const malformedPersistedCheckoutWal = persistedCheckoutWalPresent
    && !persistedCheckoutWalValidation.ok;
  if (malformedPersistedCheckoutWal) {
    shop.pendingCheckouts = {};
    quarantineCheckoutWal(
      state,
      isRecord(rawShop.pendingCheckouts)
        ? 'invalid-persisted-checkout-settlement'
        : 'malformed-persisted-checkout-journal',
      { pendingCheckouts: cloneSaveValue(rawShop.pendingCheckouts, null) },
    );
    noteRepair(
      report,
      '$.shop.pendingCheckouts',
      'invalid checkout journal quarantined; financial and inventory recovery blocked',
    );
  } else if (checkoutJournalCoherence?.unsafe
      && checkoutWalQuarantineAcknowledged(rawShop)) {
    // The owner already accepted this loss and the authorities are still empty.
    // Re-latching here is what made the manager's key useless: the coherence
    // verdict is derived partly from ledger rows a release cannot rewrite, so
    // without this the same acknowledged incident wedges the till on every boot
    // forever. A NEW half-committed sale writes a plan, receipt or projection,
    // fails the emptiness test above, and takes the branch below as normal.
    noteRepair(
      report,
      '$.shop.pendingCheckouts',
      `${checkoutJournalCoherence.diagnostic || 'incoherent checkout journal'} previously acknowledged; quarantine not re-applied`,
    );
  } else if (checkoutJournalCoherence?.unsafe) {
    const evidence = {};
    for (const field of [
      'pendingCheckouts',
      'checkoutSettlementReceipts',
      'checkoutSettlementReceiptKeys',
      'checkoutProjectionIds',
    ]) {
      if (isRecord(rawShop) && Object.hasOwn(rawShop, field)) {
        evidence[field] = cloneSaveValue(rawShop[field], null);
      }
    }
    shop.pendingCheckouts = {};
    shop.checkoutSettlementReceipts = {};
    shop.checkoutSettlementReceiptKeys = [];
    shop.checkoutProjectionIds = {};
    const missing = checkoutJournalCoherence.diagnostic?.startsWith('missing-');
    quarantineCheckoutWal(
      state,
      missing
        ? 'missing-checkout-journal-with-unresolved-evidence'
        : 'incoherent-persisted-checkout-settlement',
      evidence,
    );
    noteRepair(
      report,
      '$.shop.pendingCheckouts',
      `${checkoutJournalCoherence.diagnostic || 'incoherent checkout journal'} quarantined; financial and inventory recovery blocked`,
    );
  } else if (shop.pendingCheckouts != null && !isRecord(shop.pendingCheckouts)) {
    shop.pendingCheckouts = {};
    quarantineCheckoutWal(state, 'unavailable-checkout-journal');
    noteRepair(report, '$.shop.pendingCheckouts', 'unavailable checkout journal quarantined');
  }
  if (shop.checkoutProjectionIds != null && !isRecord(shop.checkoutProjectionIds)) {
    shop.checkoutProjectionIds = {};
    noteRepair(report, '$.shop.checkoutProjectionIds', 'invalid checkout projection journal reset');
  }
  if (!isRecord(shop.checkoutSettlementReceipts)) {
    shop.checkoutSettlementReceipts = {};
    noteRepair(report, '$.shop.checkoutSettlementReceipts', 'invalid checkout settlement receipts reset');
  }
  if (!Array.isArray(shop.checkoutSettlementReceiptKeys)) {
    shop.checkoutSettlementReceiptKeys = [];
    noteRepair(report, '$.shop.checkoutSettlementReceiptKeys', 'invalid checkout settlement receipt order reset');
  }
  if (shop.salesLive != null && (!isRecord(shop.salesLive)
      || !Number.isSafeInteger(shop.salesLive.units) || shop.salesLive.units < 0
      || typeof shop.salesLive.revenue !== 'number'
      || !Number.isFinite(shop.salesLive.revenue) || shop.salesLive.revenue < 0)) {
    shop.salesLive = { units: 0, revenue: 0 };
    noteRepair(report, '$.shop.salesLive', 'invalid live-sales totals reset');
  }
  if (shop.salesToday != null && (!isRecord(shop.salesToday)
      || Object.entries(shop.salesToday).some(([skuId, quantity]) => (
        !skuId || !Number.isSafeInteger(quantity) || quantity < 0
      )))) {
    shop.salesToday = {};
    noteRepair(report, '$.shop.salesToday', 'invalid daily sales totals reset');
  }
  if (!isRecord(shop.inventory)) shop.inventory = cloneSaveValue(defaults.inventory, {});
  for (const sku of SHOP_CATALOG) {
    const fallback = defaults.inventory[sku.id] || { shelf: 0, back: 0 };
    const source = isRecord(shop.inventory[sku.id]) ? shop.inventory[sku.id] : fallback;
    if (!isRecord(shop.inventory[sku.id])) {
      noteRepair(report, `$.shop.inventory.${sku.id}`, 'inventory line defaulted');
    }
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
    accept: (order) => Array.isArray(order.lines)
      ? order.lines.every((line) => typeof line.skuId === 'string' && !!shop.inventory[line.skuId])
      : typeof order.skuId === 'string' && !!shop.inventory[order.skuId],
  });
  shop.nextOrderId = safeNextId(shop.orders, shop.nextOrderId);
  shop.transactionHistory = dedupeRecords(
    recordsOnly(shop.transactionHistory, report, '$.shop.transactionHistory', { max: 100 }),
    (ticket) => Number.isSafeInteger(ticket.number) && ticket.number > 0 ? ticket.number : null,
    report,
    '$.shop.transactionHistory',
  );
  shop.transactionHistory = dedupeRecords(
    shop.transactionHistory,
    (ticket) => (typeof ticket.transactionId === 'string' && ticket.transactionId
      ? `transaction:${ticket.transactionId}`
      : `ticket:${ticket.number}`),
    report,
    '$.shop.transactionHistory',
  );
  shop.nextTransactionNo = safeNextId(
    shop.transactionHistory.map((ticket) => ({ id: ticket.number })),
    shop.nextTransactionNo,
  );
  const held = recordsOnly(shop.held, report, '$.shop.held', { max: 10_000 })
    .filter((unit) => typeof unit.uid === 'string' && unit.uid
      && typeof unit.skuId === 'string' && !!shop.inventory[unit.skuId]);
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
  if (!Array.isArray(bag) || bag.some((method) => method !== 'cash' && method !== 'card')
      || bag.length > 10 || cashInBag > 5 || cardInBag > 5) {
    shop.paymentBag = null;
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
  const savedGrime = Array.isArray(rawShop?.reno?.grime) ? rawShop.reno.grime : null;
  if (savedGrime && savedGrime.length > 0 && savedGrime.length !== defaultReno.grime.length) {
    reno.grime = savedGrime.slice(0, 10_000).map((value, index) => {
      const number = Number(value);
      if (Number.isFinite(number)) return Math.min(1, Math.max(0, number));
      noteRepair(report, `$.shop.reno.grime[${index}]`, 'invalid legacy grime value cleared');
      return 0;
    });
  } else {
    reno.grime = normalizeNumericArray(
      reno.grime, defaultReno.grime, Array, report, '$.shop.reno.grime',
      (number) => Math.min(1, Math.max(0, number)),
    );
  }
  reno.windows = normalizeNumericArray(reno.windows, defaultReno.windows, Array, report, '$.shop.reno.windows', (number) => Math.min(1, Math.max(0, number)));
  reno.wet = normalizeNumericArray(reno.wet, new Array(cells).fill(0), Array, report, '$.shop.reno.wet', (number) => Math.min(1, Math.max(0, number)));
  reno.solution = normalizeNumericArray(reno.solution, new Array(cells).fill(0), Array, report, '$.shop.reno.solution', (number) => Math.min(1, Math.max(0, number)));
  reno.clutter = recordsOnly(reno.clutter, report, '$.shop.reno.clutter', { max: 1000 });
  reno.decor = dedupeRecords(
    recordsOnly(reno.decor, report, '$.shop.reno.decor', { max: 1000 })
      .filter((decor) => (
        typeof decor.skuId === 'string'
        && (Number.isFinite(decor.spot)
          || (typeof decor.placementId === 'string' && /^placement:\d+$/.test(decor.placementId)))
      )),
    (decor) => (typeof decor.placementId === 'string'
      ? `placement:${decor.placementId}`
      : `authored:${decor.skuId}:${decor.spot}`),
    report,
    '$.shop.reno.decor',
  );
  reno.debris = recordsOnly(reno.debris, report, '$.shop.reno.debris', { max: 96 });
  reno.pan = finiteSave(reno.pan, 0, { min: 0, max: 1_000_000 }, report, '$.shop.reno.pan');
  reno.bag = finiteSave(reno.bag, 0, { min: 0, max: 1_000_000 }, report, '$.shop.reno.bag');
  if (isRecord(rawShop?.reno) && !Object.hasOwn(rawShop.reno, 'layoutVersion')) delete reno.layoutVersion;
  if (isRecord(rawShop?.reno) && !Object.hasOwn(rawShop.reno, 'clutterLayout')) delete reno.clutterLayout;
  if (isRecord(rawShop?.reno) && !Object.hasOwn(rawShop.reno, 'architecture')) delete reno.architecture;
}

function normalizeCollections(state, report) {
  if (isRecord(state.golfers)) {
    state.golfers.pool = normalizeIds(state.golfers.pool, report, '$.golfers.pool', {
      max: 100_000, duplicate: 'drop',
    });
    state.golfers.nextId = safeNextId(state.golfers.pool, state.golfers.nextId);
  }
  if (isRecord(state.staff)) {
    state.staff.employees = normalizeIds(state.staff.employees, report, '$.staff.employees', {
      max: 10_000, duplicate: 'drop',
    });
    state.staff.market = normalizeIds(state.staff.market, report, '$.staff.market', {
      max: 10_000, duplicate: 'drop',
    });
    const employeeIds = new Set(state.staff.employees.map((employee) => employee.id));
    const before = state.staff.market.length;
    state.staff.market = state.staff.market.filter((candidate) => !employeeIds.has(candidate.id));
    if (state.staff.market.length !== before) {
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
    state.reservations.booked = normalizeIds(
      state.reservations.booked, report, '$.reservations.booked',
      { max: 100_000, duplicate: 'drop' },
    );
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

function restoreSalesTax(state, rawSalesTax, persistedVersion, report) {
  const dayAbs = calendarOf(state.clock.minutes).dayAbs;
  // V13 never wrote this authority. Its immutable liability ledger entries are
  // migration evidence, not commands: reconstruction must not move cash or
  // append accounting rows a second time.
  if (persistedVersion < SALES_TAX_SAVE_VERSION && !isRecord(rawSalesTax)) {
    reconstructSalesTaxFromLedger(state, {
      dayAbs,
      onIgnoredEvidence: ({ index, reason }) => {
        noteRepair(
          report,
          `$.ledger.entries[${index}]`,
          `ignored as sales-tax migration evidence: ${reason}`,
        );
      },
    });
    return;
  }

  // Build feature-owned defaults for the loaded day before the generic merge.
  // This keeps a missing schedule current while retaining unknown nested keys.
  state.salesTax = {};
  normalizeSalesTax(state, { dayAbs });
  state.salesTax = mergeSaveDefaults(
    state.salesTax,
    rawSalesTax,
    report,
    '$.salesTax',
  );
  const normalized = normalizeSalesTax(state, { dayAbs, constrainToDay: true });
  for (const repair of normalized.repairs) {
    noteRepair(report, `$.salesTax.${repair.field}`, repair.message);
  }
}

export function deserializeWithReport(json) {
  const raw = parseSaveInput(json, { kind: 'game save' });
  const persistedVersion = persistedVersionOf(raw);
  const checkoutJournalCoherence = classifyCheckoutJournalCoherence(raw, persistedVersion);
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
  if (typeof raw.seed !== 'number' || raw.seed !== seed) {
    noteRepair(report, '$.seed', 'invalid seed normalized');
  }
  const course = normalizeCourse(raw.course, seed, persistedVersion, report);
  const rawClubName = typeof raw.clubName === 'string' ? raw.clubName.trim() : '';
  const clubName = !rawClubName || LEGACY_DEFAULT_CLUB_NAMES.has(rawClubName)
    ? DEFAULT_CLUB_NAME
    : rawClubName.slice(0, 200);
  if (clubName !== raw.clubName) {
    noteRepair(report, '$.clubName', 'legacy or invalid default club name migrated to Pine Hills');
  }

  const state = newGame(mode, seed, {
    course,
    clubName,
    propertyId: isRecord(raw.property) ? raw.property.id : undefined,
  });
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
  copyUnknownSaveFields(state.clock, raw.clock, new Set(['minutes']));
  state.cash = finiteSave(
    raw.cash,
    0,
    { min: -1_000_000_000_000, max: 1_000_000_000_000 },
    report,
    '$.cash',
  );
  state.clubName = clubName;
  state.pendingMorning = typeof raw.pendingMorning === 'boolean' ? raw.pendingMorning : true;
  if (typeof raw.pendingMorning !== 'boolean') {
    noteRepair(report, '$.pendingMorning', 'invalid flag defaulted');
  }
  state.course = course;
  copyUnknownSaveFields(state.course, raw.course, COURSE_SAVE_KEYS);
  state.sections = labelSections(course);

  const domains = [
    'weather', 'maintenance', 'golfers', 'staff', 'club', 'reputation', 'business',
    'ledger', 'shop', 'reservations', 'golfDay', 'customerDirectory', 'tractor', 'props',
    'progression', 'tutorial', 'notifications', 'uiPrefs', 'property',
    'propertyInventory', 'surfaceDamage',
  ];
  for (const key of domains) {
    state[key] = mergeSaveDefaults(state[key], raw[key], report, `$.${key}`);
  }
  // A3: the speed ladder above 1x is deleted, but golfDay.speedRung
  // PERSISTS in saves and prices golfer pace on load — a save written at
  // the old 2x/4x would walk its golfers at ghost speed between deserialize
  // and the first frame-loop overwrite. Clamp at the door.
  if (state.golfDay && Number(state.golfDay.speedRung) > 1) {
    state.golfDay.speedRung = 1;
    noteRepair(report, '$.golfDay.speedRung', 'legacy speed rung clamped to 1x');
  }
  if (!isRecord(raw.tractor)) state.tractor = null;
  if (!isRecord(raw.propertyInventory)) state.propertyInventory = null;
  state.turf = normalizeTurf(raw.turf, state.turf, report);
  copyUnknownSaveFields(state.turf, raw.turf, TURF_SAVE_KEYS);
  state.debtDays = finiteSave(
    raw.debtDays,
    0,
    { integer: true, min: 0, max: 1_000_000 },
    report,
    '$.debtDays',
  );
  state.failed = isRecord(raw.failed) ? cloneSaveValue(raw.failed) : null;
  if (raw.failed != null && !isRecord(raw.failed)) {
    noteRepair(report, '$.failed', 'invalid failure state cleared');
  }

  // Fixture availability participates in shelf-stock reconciliation below.
  // Restore the campaign envelope before those passes so a furnished Pine
  // Hills save does not temporarily look like an unfurnished BASIC shop and
  // have valid display lots moved back to reserve. Full campaign migration is
  // still deferred until the rest of the save authorities are ready.
  state.campaign = isRecord(raw.campaign) ? cloneSaveValue(raw.campaign) : null;
  normalizeShopState(state, raw.shop, shopDefaults, report, { checkoutJournalCoherence });
  normalizeCollections(state, report);
  ensureLedger(state);
  restoreSalesTax(state, raw.salesTax, persistedVersion, report);
  if (!isRecord(raw.shop?.inventoryLifecycle)) delete state.shop.inventoryLifecycle;
  ensureInventoryLifecycle(state);
  if (persistedVersion < 12 && !isRecord(raw.shop?.progression)) delete state.shop.progression;
  ensureShopProgression(state, { legacy: persistedVersion < 12 });
  // A save written before the door sign existed must not load into a shop that
  // silently refuses every customer — heal it to the state its player last
  // experienced (open during trading hours) rather than the new-game default.
  healShopSign(state);
  state.shop.drawer = migrateDrawer(persistedDrawer || state.shop.drawer || newDrawer());
  // Finish the economic core after the persisted drawer is normalized but
  // before orphan recovery can put a committed basket back on the shelf.
  // Customer/reservation tails wait until those authorities load below.
  reconcilePendingCheckouts(state, { applyCustomerEvents: false });
  ensurePaymentBag(state);
  paymentBagStats(state);
  ensureShopReno(state);
  ensureLayout(state);
  ensureClubhouseRestoration(state);
  ensureDebris(state);
  ensureWet(state, CLEANING_FIELD.w, CLEANING_FIELD.h);
  ensureWash(state);
  migrateLegacyRetailLayout(state.shop, persistedVersion);
  migrateFeatureCategory(state.shop, persistedVersion);
  // A historical campaign can predate the furnished-start marker even though
  // its paid/display inventory is already on the sales floor. Install the
  // conveyed Pine Hills fixtures before any route, checkout, or shelf repair
  // treats that stock as belonging to an unavailable BASIC-tier fixture.
  if (state.campaign) ensureCampaign(state);
  reconcileMovedFixturePoses(state, report);
  recoverCheckout(state);
  reconcileShelfCapacity(state);
  reconcileUnavailableFixtureStock(state);
  ensureProperty(state);
  ensurePropertyInventory(state);
  ensureReservations(state);
  ensureGolfDay(state, { restoring: true });
  ensureCustomerDirectory(state);
  reconcileReservationCustomerIdentities(state);
  reconcilePendingCheckouts(state);
  reconcileReservationCheckInTickets(state);
  reconcileCustomerVisitEvents(state);
  if (!checkoutWalIsQuarantined(state)) recoverCustomerSimulation(state);
  ensureTractor(state, { legacyRepaired: true });
  ensureCourseProps(state);
  ensureMaintenanceOrders(state);
  ensureSurfaceDamage(state);
  restoreCourseMaintenance(state, raw.courseMaintenance);
  ensureReputation(state);
  ensureBusiness(state);
  ensureTutorial(state);
  ensureNotifications(state);
  state.uiPrefs = isRecord(state.uiPrefs) ? state.uiPrefs : {};
  state.rngState = finiteSave(raw.rngState, generatedRngState, {
    integer: true,
    min: 0,
    max: 0xffffffff,
  }, report, '$.rngState');
  copyUnknownSaveFields(state, raw, STATE_SAVE_KEYS, { hidden: true });
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

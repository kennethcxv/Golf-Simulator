// FAIRWAY STATE — the single serializable GameState and its master tick.
// Everything the game *is* lives in this object; rendering and UI only read it
// and call command functions. All randomness flows through state.rngState so a
// loaded save resumes the exact same stream.

import { makeRng, rngOf } from '../core/utils.js';
import { labelSections } from './course.js';
import { buildStartingCourse } from './startingCourse.js';
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
import { bunkerDailyMess } from './bunkers.js';
import { initCourseProps, ensureCourseProps } from './props.js';
import { simulateDayRounds } from './rounds.js';
import { initProgression, prestigeDailyTick, resolveTournamentIfDue, solvencyDailyTick } from './progression.js';
import { initTutorial, ensureTutorial } from './tutorial.js';
import { initLedger, addExpense, closeBooks } from './economy.js';
import { BALANCE } from './balance.js';

export { rngOf }; // re-export: rngOf lives in core/utils to avoid import cycles

export const SAVE_VERSION = 4;

// opts lets the GOLF EMPIRE layer boot this same fresh-club wiring onto a
// marketplace property: an injected course grid and club name, nothing else.
export function newGame(mode = 'relaxed', seed = Date.now() % 2147483647, opts = {}) {
  const rng = makeRng(seed);
  const course = opts.course || buildStartingCourse(rng);
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
  ensureWash(state); // a fixer-upper arrives with a filthy exterior
  ensureProperty(state); // ...and a landlord
  initReservations(state);
  initCustomerDirectory(state);
  initTractor(state);
  initCourseProps(state);
  initLedger(state);
  initProgression(state);
  initTutorial(state);
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
    shop: state.shop,
    reservations: state.reservations,
    customerDirectory: state.customerDirectory,
    tractor: state.tractor,
    props: state.props,
    progression: state.progression,
    tutorial: state.tutorial,
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

export function serialize(state) {
  return JSON.stringify(snapshot(state));
}

export function deserialize(json) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  const course = {
    w: raw.course.w,
    h: raw.course.h,
    zones: Uint8Array.from(raw.course.zones),
    elevation: Float32Array.from(raw.course.elevation),
    holes: raw.course.holes,
    nextHoleId: raw.course.nextHoleId,
    structures: raw.course.structures || [],
  };
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
  if (raw.ledger) state.ledger = raw.ledger;
  else initLedger(state);
  if (raw.shop) state.shop = raw.shop;
  else initShop(state);
  if (state.shop.drawer) state.shop.drawer = migrateDrawer(state.shop.drawer);
  ensurePaymentBag(state); // a half-used balanced batch survives the reload intact
  ensureShopReno(state); // pre-restoration saves gain the rundown shop state
  if (!Array.isArray(state.shop.transactionHistory)) state.shop.transactionHistory = [];
  if (!Number.isFinite(state.shop.nextTransactionNo)) {
    const greatestTicket = state.shop.transactionHistory.reduce(
      (greatest, ticket) => Math.max(greatest, Number(ticket && ticket.number) || 0),
      0,
    );
    state.shop.nextTransactionNo = greatestTicket + 1;
  }
  recoverCheckout(state); // a save taken mid-sale: the shoppers are gone, so put their goods back
  ensureWash(state); // ...and a filthy exterior waiting for the pressure washer
  ensureProperty(state); // pre-rent saves gain a schedule rather than a free ride
  if (raw.reservations) state.reservations = raw.reservations;
  ensureReservations(state); // pre-booking saves gain an empty tee sheet
  if (raw.customerDirectory) state.customerDirectory = raw.customerDirectory;
  ensureCustomerDirectory(state); // pre-v4 saves gain stable full-name customer authority
  reconcileReservationCustomerIdentities(state); // enroll legacy bookings once, then repair their references
  if (raw.tractor) state.tractor = raw.tractor;
  ensureTractor(state, { legacyRepaired: true }); // old saves keep their working tractor
  if (raw.props) state.props = raw.props;
  ensureCourseProps(state); // old saves gain the litter/sign restoration props
  if (raw.progression) state.progression = raw.progression;
  else initProgression(state);
  if (raw.tutorial) state.tutorial = raw.tutorial;
  else initTutorial(state);
  ensureTutorial(state); // older saves re-derive their spot in the chaptered arc
  state.debtDays = raw.debtDays || 0;
  state.failed = raw.failed || null;
  return state;
}

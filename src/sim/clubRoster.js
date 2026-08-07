// THE CLUB ROSTER — what the ledger book on the front desk shows.
//
// Task #127's ruling (2026-08-04): the ledger IS the roster book from
// Designs/NamedGolfers/SLICE_BRIEF.md, and the spec's load-bearing rule
// applies — "the ledger and the wall are LENSES on progress the player
// earned". So this module owns NO state of its own. The customer identity
// directory already persists every golfer's visit history (and heals it on
// load); the roster is a read of it: everyone who has completed a check-in
// for a round, in the order they first came through the door.
//
// The book records only what the game genuinely tracks today: the signature
// (the golfer's name), the first visit, rounds played, and the last visit.
// The spec's remaining columns (best round, the fix that won them over)
// arrive with the named-golfers slice that tracks them; painting empty
// promises into the book would be recording things that never happened.
// An empty roster is a legitimate day-one state: blank pages.

import { ensureCustomerDirectory } from './customerIdentity.js';
import { dateKey, daySheet } from './reservations.js';
import { ARCHITECTURE_COMPONENT_LABELS, ceilingCircuitPoweredView } from './clubhouseRestoration.js';

/**
 * Every golfer with at least one completed round check-in, oldest first.
 * @returns {Array<{customerId, name, firstVisitDayAbs, lastVisitDayAbs, visits, spend}>}
 */
export function rosterEntries(state) {
  const directory = ensureCustomerDirectory(state);
  return directory.customers
    .filter((customer) => (customer.visitHistory?.completedCheckIns || 0) > 0)
    .map((customer) => ({
      customerId: customer.customerId,
      name: customer.fullName,
      firstVisitDayAbs: customer.visitHistory.firstVisitDayAbs ?? customer.visitHistory.lastVisitDayAbs ?? null,
      lastVisitDayAbs: customer.visitHistory.lastVisitDayAbs ?? null,
      visits: customer.visitHistory.completedCheckIns,
      spend: customer.visitHistory.lifetimeSpend || 0,
    }))
    .sort((a, b) => (
      (a.firstVisitDayAbs ?? Infinity) - (b.firstVisitDayAbs ?? Infinity)
      || a.name.localeCompare(b.name)
    ));
}

/** The book's own date column format, from the reservation calendar. */
export function rosterDateLabel(dayAbs) {
  return Number.isFinite(dayAbs) ? dateKey(dayAbs) : '';
}

/** The same date, short enough to fit a register column.
 *
 * `dateKey` writes `Y1-Spring-D1`, which is right on the tee sheet where the column is
 * wide. In the book's guest table it does not fit, and a truncated date reading
 * "Y1-Spr..." tells the player nothing at all - the day is the part that got cut. This
 * abbreviates the season instead, which is the part a reader can infer.
 */
export function rosterDateShort(dayAbs) {
  const full = rosterDateLabel(dayAbs);
  if (!full) return '';
  const parts = full.split('-');
  if (parts.length !== 3) return full;
  return `${parts[0]} ${parts[1].slice(0, 3)} ${parts[2].replace(/^D/, '')}`;
}

// --- HOUSE NOTES (L4) -------------------------------------------------------
// The register's back page: what the house itself needs, written the way the
// desk would write it. Another pure lens - it reads the restoration state the
// sim already keeps (light panels, architecture components) and never grants
// or decides anything. A first-time player who opens the book learns where to
// start without a tutorial; when everything is seen to, the page says so and
// goes quiet.

// The dead-panel note names the gate the player is actually behind. While the
// office circuit is unpowered the whole ring is out and the honest advice is
// the circuit; once power is restored and the panel STILL gives nothing, the
// note pins the fitting itself. Without the split the book would keep claiming
// "the ceiling circuit is dead" after the player repaired that very circuit.
const PANEL_STATE_NOTES = Object.freeze({
  dead: 'gives nothing. The ceiling circuit is dead.',
  deadPowered: 'still gives nothing. The fitting itself is done for.',
  flicker: 'flickers. The wiring is on its way out.',
});

const COMPONENT_NOTES = Object.freeze({
  shell: 'The outside walls have seen better decades.',
  porch: 'The porch boards give underfoot.',
  windows: 'The window frames stick and rattle.',
  panels: 'The wall panelling is scuffed through.',
  trim: 'The trim is chipped along the entrance.',
  ceiling: 'The ceiling beams want attention.',
  floor: 'The floor is worn to the nail heads.',
});

// ITEM 17 (2026-08-06): "Restoration must teach itself. The player should always
// know what is broken, what it needs, where to get it and what to press, from
// the world. The ledger can hold standing instructions."
//
// The book already said what was WRONG and stopped there, which answers one of
// the four questions. A note that says "the ceiling beams want attention" and
// nothing else leaves a first-timer to guess the verb. Each outstanding note now
// carries its standing instruction: the thing it needs, and the key that does
// it. Kept to one short clause so the page stays a ledger rather than a manual.
const COMPONENT_ACTIONS = Object.freeze({
  shell: 'Repair kit. Face it and hold [E].',
  porch: 'Repair kit. Face it and hold [E].',
  windows: 'Repair kit. Face the frame and hold [E].',
  panels: 'Repair kit. Face the wall and hold [E].',
  trim: 'Repair kit. Face the trim and hold [E].',
  ceiling: 'Repair kit. Face the ceiling and hold [E]. Power comes back with it.',
  floor: 'Repair kit. Face the boards and hold [E].',
});

const PANEL_ACTIONS = Object.freeze({
  dead: 'Repair the ceiling first; the circuit feeds every panel.',
  deadPowered: 'Replacement fitting. Face the panel and hold [E].',
  flicker: 'Replacement fitting. Face the panel and hold [E].',
});

/**
 * Outstanding house work, as dry desk notes. Empty house trouble = one
 * all-clear line, so the page never reads as broken.
 * @returns {Array<{id: string, text: string, outstanding: boolean}>}
 */
export function houseNotes(state) {
  const reno = state?.shop?.reno;
  const notes = [];
  const panels = reno && reno.lightPanels && typeof reno.lightPanels === 'object'
    ? reno.lightPanels
    : {};
  const circuitLive = ceilingCircuitPoweredView(state);
  for (const [panelId, panelState] of Object.entries(panels)) {
    if (panelState === 'working') continue;
    const line = panelState === 'dead' && circuitLive
      ? PANEL_STATE_NOTES.deadPowered
      : PANEL_STATE_NOTES[panelState];
    if (!line) continue;
    const panelKey = panelState === 'dead' && circuitLive ? 'deadPowered' : panelState;
    notes.push({
      id: `light:${panelId}`,
      text: `${panelId.toUpperCase()} ${line}`,
      action: PANEL_ACTIONS[panelKey] || null,
      outstanding: true,
    });
  }
  const components = reno?.architecture?.components || {};
  for (const component of Object.keys(ARCHITECTURE_COMPONENT_LABELS)) {
    const entry = components[component];
    if (!entry || entry.restored) continue;
    notes.push({
      id: `component:${component}`,
      text: COMPONENT_NOTES[component] || `${ARCHITECTURE_COMPONENT_LABELS[component]} needs seeing to.`,
      action: COMPONENT_ACTIONS[component] || 'Repair kit. Face it and hold [E].',
      outstanding: true,
    });
  }
  if (!notes.length) {
    notes.push({
      id: 'all-clear',
      text: 'Nothing outstanding. The house behaves.',
      action: null,
      outstanding: false,
    });
  }
  return notes;
}

// --- THE DAY SHEET PAGE ----------------------------------------------------
// Today at a glance, read from the reservation book the desk already keeps.
export function daySheetSummary(state) {
  const dayAbs = Math.floor((state?.clock?.minutes || 0) / 1440);
  let slots = [];
  try {
    slots = daySheet(state, dayAbs);
  } catch {
    slots = [];
  }
  let bookedPlayers = 0;
  let filledSlots = 0;
  let played = 0;
  let nextOpenMinute = null;
  const nowMinute = (state?.clock?.minutes || 0) % 1440;
  for (const slot of slots) {
    const players = slot.bookedPlayers ?? slot.reservedSeats ?? 0;
    if (players > 0) filledSlots += 1;
    bookedPlayers += players;
    for (const reservation of slot.reservations || []) {
      if (reservation.status === 'played') played += 1;
    }
    if (nextOpenMinute == null && slot.available && slot.minute >= nowMinute) {
      nextOpenMinute = slot.minute;
    }
  }
  return {
    dayAbs,
    dateLabel: rosterDateLabel(dayAbs),
    slotCount: slots.length,
    filledSlots,
    bookedPlayers,
    played,
    nextOpenMinute,
  };
}

// --- THE TAKINGS PAGE ------------------------------------------------------
// Today's money, from the financial ledger economy.js already balances. A
// read, never a write.
export function takingsSummary(state) {
  const today = state?.ledger?.today;
  const revenue = today?.revenue || {};
  const expense = today?.expense || {};
  const sum = (lines) => Object.values(lines).reduce(
    (total, value) => total + (Number.isFinite(value) ? value : 0),
    0,
  );
  const round2 = (value) => Math.round(value * 100) / 100;
  return {
    greenFees: round2((revenue.greenFees || 0) + (revenue.walkInRevenue || 0)
      + (revenue.bookingRevenue || 0)),
    shopSales: round2(revenue.shopSales || 0),
    otherRevenue: round2(sum(revenue) - (revenue.greenFees || 0)
      - (revenue.walkInRevenue || 0) - (revenue.bookingRevenue || 0)
      - (revenue.shopSales || 0)),
    revenueTotal: round2(sum(revenue)),
    expenseTotal: round2(sum(expense)),
    net: round2(sum(revenue) - sum(expense)),
  };
}

// --- THE JOURNAL'S SECTIONS ------------------------------------------------
// The book's table of contents, locks included. A locked section is a REAL
// set of pages the reader can turn to; what is withheld is the content - the
// completionist chase from the NamedGolfers spec made literal. Locks derive
// from world state and never grant anything by being read.
/**
 * The course's own page, once it is open for play. Every line is a read of
 * state the sim already keeps — the module still owns nothing.
 */
export function courseLogSummary(state) {
  const holes = Array.isArray(state?.course?.holes) ? state.course.holes : [];
  const count = (status) => holes.filter((hole) => hole.status === status).length;
  const par = holes.reduce((total, hole) => total + (Number(hole.par) || 0), 0);
  return {
    holeCount: holes.length,
    open: count('open'),
    renovating: count('renovation'),
    construction: count('construction'),
    unbuilt: count('unbuilt'),
    par,
    greenFee: Number(state?.club?.greenFee) || 0,
    reputation: Math.round(Number(state?.club?.reputation) || 0),
  };
}

/**
 * The golfers who keep coming back, most rounds first. "Champions" is what
 * the club has actually earned: regulars, not invented tournament winners.
 */
export function championEntries(state, limit = 6) {
  return rosterEntries(state)
    .filter((entry) => entry.visits > 1)
    .sort((a, b) => b.visits - a.visits
      || (a.firstVisitDayAbs ?? Infinity) - (b.firstVisitDayAbs ?? Infinity)
      || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * The book's sections, and which of them the club has EARNED.
 *
 * R5 (2026-08-06): "Lock by section, not the book." Every section already had
 * its own entry, but the two at the end were hardcoded `locked: true` — they
 * could never open, so per-section locking existed on paper only. Each lock is
 * now a read of the same state the rest of the book is a lens on, and each
 * carries the condition in words the reader can act on.
 */
export function journalSections(state) {
  const campaign = state?.campaign || null;
  const courseOpen = !!campaign?.businessOpen || !campaign?.enabled;
  const reviews = Array.isArray(state?.club?.reviews) ? state.club.reviews : [];
  const history = Array.isArray(state?.ledger?.history) ? state.ledger.history : [];
  const firsts = firstsEntries(state);
  // D3: the seven the brief names, in the order it names them. `House Notes`,
  // `Day Sheet` and `Champions` are gone as sections — what they held is now
  // inside Complaints and Fixes, The Takings and Firsts respectively, which is
  // where a reader would look for it.
  return [
    { id: 'guests', title: 'Guest Register', locked: false },
    {
      id: 'complaints',
      title: 'Complaints and Fixes',
      locked: !reviews.length && !state?.shop?.reno,
      lockedLine: 'Nobody has said anything yet. Open up and let them in.',
    },
    { id: 'restoration', title: 'The Restoration Record', locked: false },
    {
      id: 'firsts',
      title: 'Firsts',
      locked: firsts.every((entry) => !entry.done),
      lockedLine: 'Nothing has happened for the first time yet.',
    },
    {
      id: 'takings',
      title: 'The Takings',
      locked: false,
      // not a lock, a note: the page is a HISTORY, and on day one it is one row
      subtitle: history.length > 1 ? `${history.length} days closed` : 'Today only, so far',
    },
    {
      id: 'course',
      title: 'Course Log',
      locked: !courseOpen,
      lockedLine: 'Nothing to record until the course reopens for play.',
    },
    { id: 'deed', title: 'The Deed', locked: false },
  ];
}

// --- COMPLAINTS AND FIXES --------------------------------------------------
//
// The left column is what people actually SAID — the negative factors cited in
// the reviews the club has collected, tallied, worst first. The right column is
// what has been PUT RIGHT since, read from the restoration state. A complaint
// with a matching fix is struck through rather than deleted, because "we had
// that problem and we dealt with it" is the sentence the page exists to say.
//
// Nothing is invented: reviews only cite factors whose predicate was true, and
// every fix is a flag some player action set.
const COMPLAINT_LABELS = Object.freeze({
  shopClean: 'The shop was dirty',
  exterior: 'The place looked neglected outside',
  courseCondition: 'The course was in poor condition',
  stock: 'Half the shelves were empty',
  prices: 'The shop prices were steep',
  coursePrice: 'The green fee was steep',
  waitTime: 'They waited too long to get out',
  queue: 'The queue at the desk was long',
});

const FIX_FOR_COMPLAINT = Object.freeze({
  shopClean: 'cleanup',
  exterior: 'wash',
  stock: 'restock',
  courseCondition: 'course',
});

export function complaintsAndFixes(state) {
  const reviews = Array.isArray(state?.club?.reviews) ? state.club.reviews : [];
  const tally = new Map();
  for (const review of reviews) {
    // a review of three stars or fewer is a complaint; above that the cited
    // factors are what they LIKED and belong on nobody's problem list
    if (Number(review?.stars) > 3) continue;
    for (const id of review?.cited || []) {
      if (!COMPLAINT_LABELS[id]) continue;
      const row = tally.get(id) || { id, label: COMPLAINT_LABELS[id], count: 0, lastDay: null };
      row.count += 1;
      const day = Number(review.day);
      if (Number.isFinite(day) && (row.lastDay == null || day > row.lastDay)) row.lastDay = day;
      tally.set(id, row);
    }
  }
  const reno = state?.shop?.reno || null;
  const done = {
    cleanup: !!reno && Object.values(reno.cleanupMilestones || {}).every(Boolean)
      && Object.keys(reno.cleanupMilestones || {}).length > 0,
    restock: !!reno && Object.values(reno.restockMilestones || {}).every(Boolean)
      && Object.keys(reno.restockMilestones || {}).length > 0,
    wash: Number(state?.shop?.exteriorClean ?? 0) >= 0.98,
    course: Number(state?.club?.courseCondition ?? 0) >= 80,
  };
  const complaints = [...tally.values()]
    .map((row) => ({
      ...row,
      settled: !!done[FIX_FOR_COMPLAINT[row.id]],
      lastLabel: row.lastDay == null ? '' : rosterDateLabel(row.lastDay),
    }))
    .sort((a, b) => Number(a.settled) - Number(b.settled) || b.count - a.count);
  return {
    complaints,
    outstanding: complaints.filter((row) => !row.settled).length,
    settled: complaints.filter((row) => row.settled).length,
    reviewsRead: reviews.length,
    // the house's own outstanding jobs, which nobody has had to complain about
    // yet because the shop has not been open long enough for anyone to see them
    house: houseNotes(state).filter((note) => note.outstanding),
  };
}

// --- THE RESTORATION RECORD ------------------------------------------------
//
// The building's own repair log, in the order a surveyor would walk it: the
// power, then the lights it feeds, then the fabric, then the paint. Every line
// is a read of `shop.reno`, which is the same state the repair verbs write.
export function restorationRecord(state) {
  const reno = state?.shop?.reno || null;
  const rows = [];
  if (!reno) return { rows, done: 0, total: 0, circuitLive: false };
  const circuitLive = ceilingCircuitPoweredView(state);
  rows.push({
    id: 'circuit',
    group: 'Power',
    label: 'Ceiling circuit',
    state: circuitLive ? 'live' : 'dead',
    done: circuitLive,
  });
  for (const [panelId, panelState] of Object.entries(reno.lightPanels || {})) {
    rows.push({
      id: `panel:${panelId}`,
      group: 'Lights',
      label: `${String(panelId).toUpperCase()} panel`,
      state: panelState,
      done: panelState === 'working',
    });
  }
  const components = reno.architecture?.components || {};
  for (const [componentId, entry] of Object.entries(components)) {
    rows.push({
      id: `component:${componentId}`,
      group: 'Fabric',
      label: ARCHITECTURE_COMPONENT_LABELS[componentId] || componentId,
      state: entry?.restored ? 'restored' : 'needs work',
      done: !!entry?.restored,
    });
  }
  for (const [componentId, paint] of Object.entries(reno.componentPaintApplications || {})) {
    if (!paint) continue;
    rows.push({
      id: `paint:${componentId}`,
      group: 'Paint',
      label: `${ARCHITECTURE_COMPONENT_LABELS[componentId] || componentId} painted`,
      state: typeof paint === 'string' ? paint : 'done',
      done: true,
    });
  }
  const done = rows.filter((row) => row.done).length;
  return { rows, done, total: rows.length, circuitLive };
}

// --- FIRSTS ----------------------------------------------------------------
//
// The moments a club only gets once. Each is a read of state that already
// exists, with the day it happened where the day is recoverable and a plain
// "not yet" where it is not. A first that has not happened is still PRINTED —
// the empty line is the invitation.
export function firstsEntries(state) {
  const roster = rosterEntries(state);
  const firstGuest = roster.length
    ? roster.reduce((a, b) => ((a.firstVisitDayAbs ?? Infinity) <= (b.firstVisitDayAbs ?? Infinity) ? a : b))
    : null;
  const history = Array.isArray(state?.ledger?.history) ? state.ledger.history : [];
  const firstWith = (pick) => history.find((entry) => pick(entry) > 0) || null;
  const firstSaleDay = firstWith((entry) => Number(entry?.revenue?.shopSales) || 0);
  const firstFeeDay = firstWith((entry) => (Number(entry?.revenue?.greenFees) || 0)
    + (Number(entry?.revenue?.walkInRevenue) || 0) + (Number(entry?.revenue?.bookingRevenue) || 0));
  const firstProfitDay = history.find((entry) => Number(entry?.net) > 0) || null;
  const reviews = Array.isArray(state?.club?.reviews) ? state.club.reviews : [];
  const firstReview = reviews.length ? reviews[reviews.length - 1] : null;
  const fiveStar = reviews.filter((review) => Number(review?.stars) >= 5)
    .sort((a, b) => Number(a.day) - Number(b.day))[0] || null;
  const returning = roster.filter((entry) => entry.visits > 1)
    .sort((a, b) => (a.firstVisitDayAbs ?? 0) - (b.firstVisitDayAbs ?? 0))[0] || null;

  const line = (id, label, dayAbs, detail) => ({
    id,
    label,
    done: Number.isFinite(dayAbs),
    dayAbs: Number.isFinite(dayAbs) ? dayAbs : null,
    dateLabel: Number.isFinite(dayAbs) ? rosterDateLabel(dayAbs) : 'not yet',
    detail: detail || '',
  });

  return [
    line('guest', 'First guest through the door', firstGuest?.firstVisitDayAbs, firstGuest?.name || ''),
    line('fee', 'First green fee taken', Number(firstFeeDay?.dayAbs), ''),
    line('sale', 'First sale over the counter', Number(firstSaleDay?.dayAbs), ''),
    line('review', 'First review written', Number(firstReview?.day), firstReview ? `${firstReview.stars} stars` : ''),
    line('regular', 'First golfer who came back', returning?.lastVisitDayAbs, returning?.name || ''),
    line('fivestar', 'First five-star review', Number(fiveStar?.day), ''),
    line('profit', 'First day that finished ahead', Number(firstProfitDay?.dayAbs), firstProfitDay ? `$${Math.round(firstProfitDay.net)}` : ''),
  ];
}

// --- THE TAKINGS, AS HISTORY -----------------------------------------------
//
// The brief asks for the takings "as history", and the sim already keeps sixty
// closed days in `ledger.history`. Today is appended live from `ledger.today` so
// the page is never one day behind the room it is sitting in.
export function takingsHistory(state, limit = 14) {
  const history = Array.isArray(state?.ledger?.history) ? state.ledger.history : [];
  const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
  const rows = history.slice(-limit).map((entry) => ({
    dayAbs: Number(entry?.dayAbs),
    dateLabel: rosterDateLabel(Number(entry?.dayAbs)),
    revenue: round2(entry?.revenueTotal),
    expense: round2(entry?.expenseTotal),
    net: round2(entry?.net),
    closed: true,
  }));
  const today = takingsSummary(state);
  rows.push({
    dayAbs: Math.floor((state?.clock?.minutes || 0) / 1440),
    dateLabel: 'today, so far',
    revenue: today.revenueTotal,
    expense: today.expenseTotal,
    net: today.net,
    closed: false,
  });
  const closed = rows.filter((row) => row.closed);
  const best = closed.length ? closed.reduce((a, b) => (a.net >= b.net ? a : b)) : null;
  const worst = closed.length ? closed.reduce((a, b) => (a.net <= b.net ? a : b)) : null;
  return {
    rows,
    today,
    best,
    worst,
    runningNet: round2(rows.reduce((total, row) => total + row.net, 0)),
    daysClosed: closed.length,
  };
}

// --- THE DEED --------------------------------------------------------------
//
// What the club actually IS, on paper: the name, what was paid for it, when,
// what it sits on, and what it is worth now. The property record is the source;
// where a field was never recorded the line says so rather than printing a zero
// that reads like a fact.
export function deedSummary(state, empire = null) {
  const property = state?.property || empire?.property || null;
  const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  const paid = num(property?.purchasePrice ?? property?.price ?? property?.askingPrice);
  const acquiredDay = num(property?.acquiredDayAbs ?? property?.purchasedDayAbs);
  const holes = Array.isArray(state?.course?.holes) ? state.course.holes.length : null;
  return {
    clubName: state?.club?.name || state?.shop?.name || 'Pine Hills Municipal Golf',
    propertyName: property?.name || null,
    location: property?.location || property?.region || null,
    acres: num(property?.acres ?? property?.acreage),
    holes,
    paid,
    acquiredDayAbs: acquiredDay,
    acquiredLabel: acquiredDay == null ? 'not recorded' : rosterDateLabel(acquiredDay),
    valuation: num(property?.value ?? property?.estimatedValue),
    rent: num(property?.rent ?? property?.monthlyRent),
    reputation: Math.round(Number(state?.club?.reputation) || 0),
  };
}

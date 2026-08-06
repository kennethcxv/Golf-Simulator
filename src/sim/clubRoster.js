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
  const roster = rosterEntries(state);
  const returning = roster.filter((entry) => entry.visits > 1).length;
  return [
    { id: 'guests', title: 'Guest Register', locked: false },
    { id: 'house', title: 'House Notes', locked: false },
    { id: 'day', title: 'Day Sheet', locked: false },
    { id: 'takings', title: 'Takings', locked: false },
    {
      id: 'course',
      title: 'Course Log',
      locked: !courseOpen,
      lockedLine: 'Nothing to record until the course reopens for play.',
    },
    {
      id: 'champions',
      title: 'Champions',
      locked: returning < 3,
      lockedLine: `Waiting on regulars. ${returning} of 3 golfers have come back.`,
    },
  ];
}

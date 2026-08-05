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
    notes.push({
      id: `light:${panelId}`,
      text: `${panelId.toUpperCase()} ${line}`,
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
      outstanding: true,
    });
  }
  if (!notes.length) {
    notes.push({ id: 'all-clear', text: 'Nothing outstanding. The house behaves.', outstanding: false });
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
export function journalSections(state) {
  return [
    { id: 'guests', title: 'Guest Register', locked: false },
    { id: 'house', title: 'House Notes', locked: false },
    { id: 'day', title: 'Day Sheet', locked: false },
    { id: 'takings', title: 'Takings', locked: false },
    {
      id: 'course',
      title: 'Course Log',
      locked: true,
      lockedLine: 'Tied shut until the course reopens.',
    },
    {
      id: 'champions',
      title: 'Champions',
      locked: true,
      lockedLine: 'Reserved for the names this club will earn.',
    },
  ];
}

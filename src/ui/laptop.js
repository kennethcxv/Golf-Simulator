// GOLF SIMULATOR — the clubhouse's operating system.
//
// This is diegetic software. It renders into `.laptop-screen`, which main.js maps corner-to-
// corner onto the laptop's physical display every frame — the interface IS the screen, not a
// panel floating near it. Nothing here knows about 3D; it just has to be a good 1024x640
// application and stay inside its own rectangle.
//
// THE ONE RULE: every number on these pages is read live from the sim. Where the sim does not
// model something the brief asked for, the page SAYS SO, in place, rather than showing a
// plausible number. A management screen you cannot trust is worse than one that admits a gap —
// you make decisions on it.

import { el, toast } from './ui.js';
import { formatMoney } from '../core/utils.js';
import { calendarOf } from '../sim/time.js';
import {
  SHOP_CATALOG, skuById, LEAD_DAYS, SHELF_CAP, RETAIL_CATS,
} from '../data/shopItems.js';
import {
  placeOrder, cancelOrder, orderCost, shopCondition, priceFor,
  velocity, daysOfSupply, buyRentalSets,
} from '../sim/shop.js';
import {
  boxesOf, shipmentsOf, shipmentStatus, padCount, PAD_CAPACITY, boxOpened,
} from '../sim/deliveries.js';
import { planShipment, unitsPerBox } from '../data/boxes.js';
import { supplierFor, SUPPLIERS } from '../data/suppliers.js';
import {
  TEE_SHEET, daySheet, bookSlot, cancelReservation, fmtSlot, slotAvailability,
  markReservationNoShow,
} from '../sim/reservations.js';
import {
  createCustomerIdentity, customerIdentityById, ensureCustomerDirectory, identityForReservation,
} from '../sim/customerIdentity.js';
import { reviewSummary, explainVisitors, REVIEW_FACTORS } from '../sim/reviews.js';
import { weeklyCharge, propertyLine, arrearsOf } from '../sim/property.js';
import { members } from '../sim/golfers.js';
import {
  ROLE, hireStaff, fireStaff, trainStaff, staffDailyWages, refreshMarketIfDue, groundsCrewHours,
} from '../sim/staff.js';
import {
  sectionTurfSummary, sectionStatus, diagnoseSection, treatSection, aerateSection,
} from '../sim/turf.js';
import { TRACTOR_STEPS, STEP_LABEL } from '../sim/tractor.js';
import {
  clubRatings, fairGreenFee, TIERS, AMENITIES, memberCounts, fairDues, upgradeAmenity,
  acceptOuting, declineOuting, amenityScore,
} from '../sim/club.js';
import {
  UPGRADES, TOURNAMENTS, hasUpgrade, purchaseUpgrade, canScheduleTournament, scheduleTournament,
} from '../sim/progression.js';
import {
  ensureNotifications, unreadCount, markRead, markAllRead, dismissNotification, NOTIF_KINDS,
} from '../sim/notifications.js';
import { currentStep, TUTORIAL_STEPS } from '../sim/tutorial.js';
import { holePar, holeDistanceYd } from '../sim/course.js';
import { ZONE, HOLE_STATUS } from '../sim/constants.js';
import {
  SERIES, lineChart, donutChart, shortMoney, applyTableQuery, sortHeader, searchBox,
  pagerRow, filterTabs,
} from './laptopWidgets.js';

const CAT_LABEL = {
  clubs: 'Clubs', balls: 'Golf balls', apparel: 'Apparel', accessories: 'Accessories',
  supplies: 'Shop supplies', decor: 'Decor & fixtures',
};
const CAT_ICON = {
  clubs: '🏌', balls: '🥎', apparel: '👕', accessories: '🧢', supplies: '🧹', decor: '🪴',
};
const ROLE_LABEL = {
  groundskeeper: 'Groundskeeper', instructor: 'Teaching pro', fnb: 'Grill room', proshop: 'Pro shop',
};
const REV_LABEL = {
  greenFees: 'Green fees', dues: 'Membership dues', outings: 'Outings', range: 'Practice range',
  restaurant: 'Grill room', lessons: 'Lessons', shopSales: 'Shop sales', rentals: 'Rentals',
  fittings: 'Club fittings', reciprocal: 'Reciprocal', events: 'Events',
};
const EXP_LABEL = {
  wagesStaff: 'Wages', wagesDayLabor: 'Day labour', water: 'Water', fertilizer: 'Fertiliser',
  chemicals: 'Chemicals', upkeep: 'Upkeep', utilities: 'Utilities', works: 'Course works',
  severance: 'Severance', training: 'Training', shopOrders: 'Stock purchases',
  rentalFleet: 'Rental fleet', events: 'Events', rent: 'Rent / mortgage',
  cashOverShort: 'Register over/short',
};
const SHOP_OPEN_MIN = 6 * 60;
const SHOP_CLOSE_MIN = 20 * 60;

// The brief's eight order states, against the five the delivery sim actually produces. Naming a
// state the sim cannot reach would be inventing a feature on a screen.
// The nine, and all nine are real. Six are worn by an order still on the road (sim/deliveries
// ORDER_FLOW); three by a shipment standing on your floor, derived from the state of its boxes
// (shipmentStatus). Nothing here is a label with no machinery behind it.
const ORDER_STATUS = {
  received: { label: 'Received', tone: '' },
  processing: { label: 'Processing', tone: '' },
  packed: { label: 'Packed', tone: '' },
  shipped: { label: 'Shipped', tone: '' },
  out: { label: 'Out for delivery', tone: 'warn' },
  arriving: { label: 'Arriving soon', tone: 'warn' },
  delivered: { label: 'Delivered', tone: 'ok' },
  partial: { label: 'Partially unpacked', tone: 'warn' },
  unpacked: { label: 'Fully unpacked', tone: 'ok' },
};

const NAV = [
  { group: 'Operations' },
  { id: 'home', icon: '🏠', label: 'Dashboard' },
  { id: 'reservations', icon: '📅', label: 'Tee Times' },
  { id: 'customers', icon: '👤', label: 'Customers' },
  { id: 'memberships', icon: '🎖', label: 'Memberships' },
  { id: 'rentals', icon: '🛄', label: 'Rentals' },
  { group: 'Pro Shop' },
  { id: 'shop', icon: '🏪', label: 'Pro Shop' },
  { id: 'inventory', icon: '📋', label: 'Inventory' },
  { id: 'supplier', icon: '🛒', label: 'Suppliers' },
  { id: 'orders', icon: '📦', label: 'Orders' },
  { id: 'deliveries', icon: '🚚', label: 'Deliveries' },
  { id: 'pricing', icon: '🏷', label: 'Pricing' },
  { group: 'Management' },
  { id: 'finances', icon: '💰', label: 'Finances' },
  { id: 'employees', icon: '👥', label: 'Employees' },
  { id: 'reviews', icon: '⭐', label: 'Reviews' },
  { id: 'marketing', icon: '📣', label: 'Marketing' },
  { group: 'Course' },
  { id: 'course', icon: '⛳', label: 'Course' },
  { id: 'maintenance', icon: '🔧', label: 'Maintenance' },
  { id: 'upgrades', icon: '🏗', label: 'Upgrades' },
  { id: 'events', icon: '🏆', label: 'Events' },
  { id: 'reno', icon: '🔨', label: 'Renovation' },
  { group: 'System' },
  { id: 'analytics', icon: '📈', label: 'Reports' },
  { id: 'notifications', icon: '🔔', label: 'Notifications' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
  { id: 'help', icon: '❓', label: 'Help' },
];

const clock12 = (m) => {
  const mm = ((Math.floor(m) % 1440) + 1440) % 1440;
  const h = Math.floor(mm / 60);
  return `${((h + 11) % 12) + 1}:${String(mm % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const hour12 = (m) => {
  const mm = ((Math.floor(m) % 1440) + 1440) % 1440;
  const h = Math.floor(mm / 60);
  return `${((h + 11) % 12) + 1} ${h >= 12 ? 'PM' : 'AM'}`;
};
const pct = (v) => `${Math.round(v * 100)}%`;

const reservationBalance = (reservation) => {
  if (reservation.status !== 'booked') return 0;
  const explicit = reservation.balanceDue ?? reservation.remainingBalance;
  if (Number.isFinite(Number(explicit))) return Math.max(0, Number(explicit));
  const fee = Number(reservation.fee) || 0;
  const deposit = Number(reservation.depositPaid ?? reservation.deposit) || 0;
  return Math.max(0, fee - deposit);
};

/**
 * Capacity-aware projection used by the laptop and its headless tests. Names
 * always come from the persisted customer directory, never from an abbreviated
 * reservation label.
 */
export function laptopReservationSheet(state, dayAbs) {
  const slots = daySheet(state, dayAbs).map((slot) => {
    const reservations = (slot.reservations || (slot.res ? [slot.res] : [])).map((reservation) => {
      const identity = identityForReservation(state, reservation);
      return {
        reservation,
        identity,
        fullName: identity.fullName,
        groupSize: Math.max(1, Number(reservation.groupSize ?? reservation.partySize) || 1),
        outstandingRevenue: reservationBalance(reservation),
      };
    });
    return { ...slot, reservations };
  });
  return {
    slots,
    reservationCount: slots.reduce((sum, slot) => sum + slot.reservations.length, 0),
    bookedPlayers: slots.reduce((sum, slot) => sum + slot.bookedPlayers, 0),
    totalPlayerCapacity: slots.reduce((sum, slot) => sum + slot.capacity, 0),
    openPlayerCapacity: slots.reduce((sum, slot) => sum + slot.remainingCapacity, 0),
    expectedRevenue: slots.reduce((sum, slot) => sum
      + slot.reservations.reduce((slotSum, entry) => slotSum + entry.outstandingRevenue, 0), 0),
  };
}

/**
 * Laptop booking command. A blank guest choice gets a deterministic believable
 * full name, while selecting an existing directory customer keeps the same ID.
 */
export function bookLaptopReservation(state, {
  dayAbs,
  minute,
  partySize = 1,
  customerId = null,
  fullName = null,
} = {}) {
  const size = Number(partySize);
  const availability = slotAvailability(state, dayAbs, minute, size);
  if (!availability.available) {
    return {
      ok: false,
      reason: availability.remainingCapacity > 0
        ? `Only ${availability.remainingCapacity} player spot${availability.remainingCapacity === 1 ? '' : 's'} remain.`
        : 'That tee time is full.',
    };
  }

  const selectedIdentity = customerId ? customerIdentityById(state, customerId) : null;
  if (customerId && !selectedIdentity) return { ok: false, reason: 'That customer is no longer in the directory.' };
  const directory = ensureCustomerDirectory(state);
  const generated = createCustomerIdentity(
    directory.seed,
    `laptop-reservation:${state.reservations?.nextId ?? directory.nextOrdinal}`,
  );
  const bookingName = selectedIdentity?.fullName || String(fullName || '').trim() || generated.fullName;
  const result = bookSlot(state, dayAbs, minute, {
    name: bookingName,
    fullName: bookingName,
    partySize: size,
    customerId: selectedIdentity?.customerId,
    customerIdentity: selectedIdentity || undefined,
  });
  if (result.ok) identityForReservation(state, result.res);
  return result;
}

export function makeLaptop(app, opts) {
  let page = 'home';
  let history = [];        // the Back stack — every navigation pushes, Back pops
  let cart = new Map();    // supplier basket: skuId -> qty
  let teeDay = 0;
  let teePartySize = 1;
  let teeCustomerChoice = 'new';
  let supplierCat = 'all';
  let financeWindow = 'today';
  let scale = 1;           // interface scale, for anyone who finds 15px small on a 4K panel
  let pending = null;      // the live confirmation, if one is open

  // Per-page table state (search text, filters, sort, page). Session state, deliberately NOT
  // serialized — a half-typed search is not club data. One object per page, so switching pages
  // and coming back keeps your filters, exactly like a real back office.
  const tstates = {};
  const ts = (id, defaults = {}) => (tstates[id] ||= { search: '', filter: 'all', sortKey: null, sortDir: 1, page: 0, ...defaults });

  const content = el('div', { class: 'lt-content' });
  const navBtns = {};

  function click() {
    if (app.audio && app.audio.ready) app.audio.uiTick();
  }

  function go(p, { replace = false } = {}) {
    if (p === page) return;
    if (!replace) history.push(page);
    if (history.length > 24) history.shift();
    page = p;
    pending = null; // navigating away abandons an open confirmation — it is a cancellation
    click();
    content.scrollTop = 0;
    render();
  }
  function back() {
    if (!history.length) return go('home', { replace: true });
    page = history.pop();
    pending = null;
    click();
    content.scrollTop = 0;
    render();
  }

  const navBadges = {};
  const nav = el('nav', { class: 'lt-nav' },
    el('div', { class: 'lt-brand' }, el('span', { text: '⛳' }), el('span', { text: 'GOLF SIMULATOR' })),
    el('div', { class: 'lt-navlist' },
      ...NAV.map((n) => {
        if (n.group) return el('div', { class: 'lt-navgroup', text: n.group });
        const badge = el('span', { class: 'lt-navbadge', style: 'display:none' });
        const b = el('button', { class: 'lt-navbtn', title: n.label, onclick: () => go(n.id) },
          el('span', { class: 'lt-navicon', text: n.icon }), el('span', { text: n.label }), badge);
        navBtns[n.id] = b;
        navBadges[n.id] = badge;
        return b;
      })),
    el('button', { class: 'lt-navbtn lt-close', text: '⏻  Close the lid', onclick: () => opts.close() }),
  );

  const statusbar = el('div', { class: 'lt-status' });
  const frame = el('div', { class: 'lt-frame' }, nav, el('div', { class: 'lt-main' }, statusbar, content));
  const root = el('div', { class: 'laptop-screen', style: 'display:none' }, frame);
  root.addEventListener('click', (e) => e.stopPropagation());

  // --- the building blocks every page is made of ------------------------------------------
  // The brief wants each page to carry: a title, a help tooltip, a primary action, confirmation
  // and cancellation, an empty state and an error state. So they are components, not per-page
  // improvisation — which is how eleven pages end up with eleven different ideas of "empty".

  // replaceChildren() is the raw DOM API and it STRINGIFIES a null child into the literal text
  // "null". Every page here hands it conditionals — a confirm bar that is usually absent, an
  // error box that is usually not needed — and that is how the Supplier page ended up printing
  // "nullnull" above its category tabs. el() already filters; the DOM does not. So filter once,
  // here, and never hand the DOM a raw list again.
  const paint = (...kids) => content.replaceChildren(...kids.filter((k) => k != null && k !== false));

  const sect = (t) => el('div', { class: 'lt-sect', text: t });
  const row = (...kids) => el('div', { class: 'lt-row' }, ...kids);
  const chip = (t, kind = '') => el('span', { class: `lt-chip ${kind}`, text: t });
  const meta = (t) => el('span', { class: 'lt-meta', text: t });
  const card = (...kids) => el('div', { class: 'lt-card' }, ...kids);
  const note = (t) => el('div', { class: 'lt-card lt-note', text: t });
  const empty = (t) => el('div', { class: 'lt-empty' }, el('div', { class: 'lt-emptymark', text: '◌' }), el('div', { text: t }));
  const errBox = (t) => el('div', { class: 'lt-card lt-err' }, el('span', { text: '⚠ ' }), el('span', { text: t }));

  // page header: title, an optional help bubble, and an optional primary action on the right
  function head(title, help, primary) {
    const kids = [el('h1', { class: 'lt-h1', text: title })];
    if (help) kids.push(el('span', { class: 'lt-help', title: help, text: '?' }));
    kids.push(el('span', { class: 'lt-headspace' }));
    if (primary) kids.push(primary);
    return el('div', { class: 'lt-head' }, ...kids);
  }

  const primaryBtn = (label, onclick, disabled) => el('button', {
    class: 'lt-primary', text: label, disabled: disabled ? 'disabled' : undefined, onclick,
  });

  // CONFIRMATION + CANCELLATION. Never a browser confirm() — that is a detached modal, which is
  // the exact thing the brief rejected, and it would land in the middle of the real monitor
  // rather than on the laptop's glass.
  function askConfirm(message, confirmLabel, onYes) {
    pending = { message, confirmLabel, onYes };
    render();
  }
  function confirmBar() {
    if (!pending) return null;
    return el('div', { class: 'lt-confirm' },
      el('span', { class: 'lt-confirmmsg', text: pending.message }),
      el('button', {
        class: 'lt-mini lt-cancel',
        text: 'Cancel',
        onclick: () => { pending = null; click(); render(); },
      }),
      el('button', {
        class: 'lt-primary lt-danger',
        text: pending.confirmLabel,
        onclick: () => { const f = pending.onYes; pending = null; click(); f(); render(); },
      }),
    );
  }

  const thumbOf = (sku) => {
    const ch = app.scene3d && app.scene3d.clubhouse && app.scene3d.clubhouse();
    const url = ch && ch.productThumb ? ch.productThumb(sku) : null;
    return url
      ? el('img', { class: 'lt-prodimg', src: url, alt: sku.name, loading: 'lazy' })
      : el('div', { class: 'lt-prodicon', text: CAT_ICON[sku.cat] || '📦' });
  };

  const cashOf = () => (app.empire ? app.empire.cash : app.state.cash);
  const retailSkus = (st) => SHOP_CATALOG.filter((s) => RETAIL_CATS.has(s.cat) && s.tier <= st.shop.unlockedTier);
  const incomingOf = (st, id) => st.shop.orders.filter((o) => o.skuId === id).reduce((a, o) => a + o.qty, 0);
  // The screen must pack the shipment the SAME WAY the receiving pad will. It does not do its own
  // arithmetic — it calls the one packer (data/boxes.js), which is also what arriveOrder reads.
  const shipOf = (sku, qty) => planShipment(sku, Math.max(1, qty));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 'es'}`;
  const shopIsOpen = (st) => {
    const m = calendarOf(st.clock.minutes).minuteOfDay;
    return m >= SHOP_OPEN_MIN && m < SHOP_CLOSE_MIN;
  };
  const grimeAvgOf = (st) => (st.shop.reno
    ? st.shop.reno.grime.reduce((a, v) => a + v, 0) / st.shop.reno.grime.length : 0);

  function refreshStatus() {
    const st = app.state;
    if (!st) return;
    const cal = calendarOf(st.clock.minutes);
    const unread = unreadCount(st);
    const bellBadge = navBadges.notifications;
    if (bellBadge) {
      bellBadge.textContent = unread > 9 ? '9+' : String(unread);
      bellBadge.style.display = unread ? '' : 'none';
    }
    statusbar.replaceChildren(
      el('button', { class: 'lt-crumb', title: 'Back', text: '‹', disabled: history.length ? undefined : 'disabled', onclick: () => back() }),
      el('button', { class: 'lt-crumb', title: 'Home', text: '⌂', onclick: () => go('home') }),
      el('span', { class: 'lt-statusname', text: st.clubName || 'The Club' }),
      el('span', { text: `Y${cal.year} · ${cal.seasonName} · Day ${cal.dayOfSeason}` }),
      el('span', { text: clock12(cal.minuteOfDay) }),
      el('span', { class: `lt-chip ${shopIsOpen(st) ? 'ok' : ''}`, text: shopIsOpen(st) ? 'Shop open' : 'Shop closed' }),
      el('span', { class: 'lt-cash', text: formatMoney(cashOf()) }),
      el('button', {
        class: 'lt-crumb', title: unread ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications',
        text: '🔔', onclick: () => go('notifications'),
      }, unread ? el('span', { class: 'lt-belldot', text: unread > 9 ? '9+' : String(unread) }) : null),
    );
  }

  // =========================================================================================
  // 1. DASHBOARD
  // =========================================================================================
  const sumLines = (lines) => Object.values(lines || {}).reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);

  // The finance line chart, shared by Dashboard and Finances: real closed days from the
  // ledger, plus today's live running lines as the newest point.
  function financeChart(st, windowDays, height = 150) {
    const hist = Array.isArray(st.ledger?.history) ? st.ledger.history : [];
    const days = windowDays > 0 ? hist.slice(-windowDays) : hist.slice();
    const pts = days.map((d) => ({
      label: `Day ${(d.dayAbs ?? 0) + 1}`,
      rev: sumLines(d.revenue),
      exp: sumLines(d.expenses || d.expense),
    }));
    pts.push({ label: 'Today', rev: sumLines(st.ledger?.today?.revenue), exp: sumLines(st.ledger?.today?.expense) });
    if (pts.length < 2) return empty('The chart starts once a day has closed on the books.');
    return lineChart({
      series: [
        { label: 'Revenue', color: SERIES.revenue, values: pts.map((p) => p.rev) },
        { label: 'Expenses', color: SERIES.expenses, values: pts.map((p) => p.exp), dash: true },
      ],
      labels: pts.map((p) => p.label),
      h: height,
    });
  }
  const CHART_WINDOWS = [
    { value: 'week', label: '7 days', days: 7 },
    { value: 'season', label: 'Season (24d)', days: 24 },
    { value: 'all', label: 'All books', days: 0 },
  ];
  const windowDaysOf = (val) => (CHART_WINDOWS.find((w) => w.value === val) || CHART_WINDOWS[0]).days;

  function pageHome() {
    const st = app.state;
    const hs = ts('home', { win: 'week' });
    const cal = calendarOf(st.clock.minutes);
    const w = st.weather.today;
    const teeSheet = laptopReservationSheet(st, cal.dayAbs);
    const booked = teeSheet.slots.flatMap((slot) => slot.reservations.map((entry) => ({
      minute: slot.minute,
      ...entry,
    })));
    const upcoming = booked.filter((b) => b.reservation.status === 'booked' && b.minute >= cal.minuteOfDay);
    const checkedIn = booked.filter((b) => b.reservation.status === 'played')
      .reduce((a, b) => a + b.groupSize, 0);
    const lowLines = retailSkus(st).filter((s) => st.shop.inventory[s.id].shelf === 0);
    const thinLines = retailSkus(st).filter((s) => {
      const e = st.shop.inventory[s.id];
      return e.shelf > 0 && e.shelf < 3;
    });
    const rs = reviewSummary(st, { waitedSec: 0, queueLen: 0, played: true });
    const ratings = clubRatings(st);
    const step = st.tutorial && !st.tutorial.complete ? currentStep(st) : null;
    const owed = arrearsOf(st);
    const inbound = st.shop.orders;
    const boxes = boxesOf(st).filter((b) => b.loc !== 'gone');
    const revToday = sumLines(st.ledger?.today?.revenue);
    const expToday = sumLines(st.ledger?.today?.expense);
    const shopToday = st.ledger?.today?.revenue?.shopSales || 0;
    const working = st.staff.employees.filter((e) => !(e.trainingDays > 0));

    // per-zone turf health, the reference dashboard's condition bars
    const zoneBars = [['Greens', ZONE.GREEN], ['Fairways', ZONE.FAIRWAY], ['Tees', ZONE.TEE], ['Rough', ZONE.ROUGH]]
      .map(([label, zone]) => {
        let n = 0;
        let health = 0;
        for (let i = 0; i < st.course.zones.length; i++) {
          if (st.course.zones[i] !== zone) continue;
          n++;
          health += st.turf.health[i];
        }
        if (!n) return null;
        const h = health / n;
        return el('div', { class: 'lt-facrow' },
          el('span', { class: 'lt-faclabel', style: 'width:64px', text: label }),
          el('div', { class: 'lt-facbar' }, el('div', { class: `lt-facfill ${h < 45 ? 'bad' : h < 70 ? '' : 'ok'}`, style: `width:${Math.max(2, Math.min(100, h))}%` })),
          el('span', { class: 'lt-facpct', text: String(Math.round(h)) }));
      }).filter(Boolean);

    // the real calendar: staged tournament, booked outings, the next property bill
    const upcomingEvents = [];
    if (st.progression?.event) {
      const spec = TOURNAMENTS[st.progression.event.tier];
      upcomingEvents.push({ icon: '🏆', text: spec ? spec.name : 'Tournament', when: `Day ${st.progression.event.day + 1}` });
    }
    for (const o of (st.club.outings?.scheduled || []).slice(0, 3)) {
      upcomingEvents.push({ icon: '🏢', text: `${o.company} outing (${o.size})`, when: `Day ${o.day + 1}` });
    }
    if (st.property) upcomingEvents.push({ icon: '🏠', text: 'Property bill', when: propertyLine(st, cal.dayAbs).split('·')[1]?.trim() || 'soon' });

    const stat = (label, value, sub, tone = '') => el('div', { class: 'lt-stat' },
      el('div', { class: 'lt-statlabel', text: label }),
      el('div', { class: `lt-statvalue ${tone}`, text: value }),
      sub ? el('div', { class: 'lt-statsub', text: sub }) : null);

    const jump = (icon, title, sub, dest, tone = '') => el('button', { class: 'lt-tile', onclick: () => go(dest) },
      el('div', { class: 'lt-tileicon', text: icon }),
      el('div', { class: 'lt-tiletitle', text: title }),
      el('div', { class: `lt-tilesub ${tone}`, text: sub }));

    paint(
      head(`Good ${cal.minuteOfDay < 720 ? 'morning' : cal.minuteOfDay < 1020 ? 'afternoon' : 'evening'} — ${st.clubName}`,
        'Everything on this page is read live from the club. Every card jumps straight to the application that owns its number.'),

      el('div', { class: 'lt-stats' },
        stat('Cash', formatMoney(cashOf()), owed > 0 ? `${formatMoney(owed)} in arrears` : 'no arrears', owed > 0 ? 'bad' : 'gold'),
        stat("Today's revenue", formatMoney(revToday), `${formatMoney(expToday)} out`, revToday - expToday >= 0 ? 'ok' : ''),
        stat('Net today', `${revToday - expToday >= 0 ? '+' : ''}${formatMoney(revToday - expToday)}`, 'so far', revToday - expToday >= 0 ? 'ok' : 'bad'),
        stat('Tee times', String(teeSheet.reservationCount), `${checkedIn} player${checkedIn === 1 ? '' : 's'} checked in`),
        stat('Shop sales', formatMoney(shopToday), 'today'),
        stat('Course', `${Math.round(ratings.condition)}`, `overall ${Math.round(ratings.overall)}`, ratings.condition < 45 ? 'bad' : ''),
        stat('Rating', rs.count ? `${rs.average} ★` : '—', rs.count ? `${rs.count} reviews` : 'nobody yet'),
        stat('Deliveries', String(inbound.length), boxes.length ? `${boxes.length} box${boxes.length === 1 ? '' : 'es'} to unpack` : 'on the way', boxes.length ? 'warn' : ''),
      ),

      step ? el('div', { class: 'lt-card lt-objective' },
        el('div', { class: 'lt-objlabel', text: 'Current objective' }),
        el('div', { class: 'lt-objtitle', text: step.title }),
        el('div', { class: 'lt-objbody', text: step.hint || step.body || '' }),
      ) : null,

      sect('Today'),
      el('div', { class: 'lt-cols' },
        card(
          el('div', { class: 'lt-minihead', text: `📅  ${cal.seasonName}, Day ${cal.dayOfSeason} — Year ${cal.year}` }),
          row(el('span', { text: `${Math.round(w.tempHiF)}°F` }), meta(w.rainIn > 0.02 ? `rain ${w.rainIn.toFixed(2)}"` : 'dry'), chip(shopIsOpen(st) ? 'Course open' : 'Course closed', shopIsOpen(st) ? 'ok' : '')),
          upcoming.length
            ? row(el('span', { text: 'Next tee time' }), meta(`${fmtSlot(upcoming[0].minute)} — ${upcoming[0].fullName}`))
            : row(meta('No more tee times today.')),
          row(el('span', { text: 'Staff on duty' }), meta(working.length ? working.map((e) => e.name.split(' ')[0]).slice(0, 4).join(', ') + (working.length > 4 ? '…' : '') : 'just you')),
          el('button', { class: 'lt-mini', text: 'Open the tee sheet', onclick: () => go('reservations') }),
        ),
        card(
          el('div', { class: 'lt-minihead', text: '⛳  Course condition' }),
          ...zoneBars,
          el('button', { class: 'lt-mini', text: 'Open maintenance', onclick: () => go('maintenance') }),
        ),
        card(
          el('div', { class: 'lt-minihead', text: '⚠  Low stock' }),
          lowLines.length || thinLines.length
            ? el('div', {},
              ...lowLines.slice(0, 4).map((s) => row(el('span', { text: s.name }), chip(st.shop.inventory[s.id].back > 0 ? 'shelve it' : 'out', st.shop.inventory[s.id].back > 0 ? 'warn' : 'bad'))),
              ...thinLines.slice(0, 2).map((s) => row(el('span', { text: s.name }), chip(`${st.shop.inventory[s.id].shelf} left`, 'warn'))))
            : empty('Every line has stock on the shelf.'),
          el('button', { class: 'lt-mini', text: 'Order stock', onclick: () => go('supplier') }),
        ),
      ),

      sect('Revenue and expenses'),
      card(
        el('div', { class: 'lt-tabs' }, ...CHART_WINDOWS.map((cw) => el('button', {
          class: `lt-tab ${hs.win === cw.value ? 'on' : ''}`, text: cw.label,
          onclick: () => { hs.win = cw.value; click(); render(); },
        }))),
        financeChart(st, windowDaysOf(hs.win)),
      ),

      el('div', { class: 'lt-cols2' },
        card(
          el('div', { class: 'lt-minihead', text: '⭐  Reviews' }),
          rs.count
            ? el('div', {},
              row(el('span', { text: `${rs.average} ★ average` }), meta(`${rs.count} on file`)),
              rs.worst && rs.worst.score < 0.5 ? row(chip(`biggest complaint: ${rs.worst.label.toLowerCase()}`, 'bad')) : row(chip('nothing is badly wrong', 'ok')),
              rs.recent[0] ? row(meta(`"${rs.recent[0].text.slice(0, 64)}${rs.recent[0].text.length > 64 ? '…' : ''}"`)) : null)
            : empty('Reviews land as people come through.'),
          el('button', { class: 'lt-mini', text: 'Read reviews', onclick: () => go('reviews') }),
        ),
        card(
          el('div', { class: 'lt-minihead', text: '🏆  Coming up' }),
          upcomingEvents.length
            ? el('div', {}, ...upcomingEvents.slice(0, 4).map((e) => row(el('span', { text: `${e.icon} ${e.text}` }), meta(e.when))))
            : empty('Nothing on the calendar.'),
          el('button', { class: 'lt-mini', text: 'Open events', onclick: () => go('events') }),
        ),
      ),

      sect('Quick actions'),
      el('div', { class: 'lt-tiles' },
        jump('📅', 'Tee Times', 'book and manage the sheet', 'reservations'),
        jump('🛒', 'Order stock', 'restock from the suppliers', 'supplier'),
        jump('🔧', 'Maintenance', 'crew, policies, repairs', 'maintenance'),
        jump('⛳', 'Course', 'holes and the works desk', 'course'),
        jump('💰', 'Finances', 'the books, in full', 'finances'),
        jump('📈', 'Reports', 'what changed, and why', 'analytics'),
      ),
    );
  }

  // =========================================================================================
  // 2. PRO SHOP
  // =========================================================================================
  function pageShop() {
    const st = app.state;
    const inv = st.shop.inventory;
    const y = st.shop.salesYesterday;
    const lost = st.shop.lostSalesYesterday || 0;
    const avgTxn = y.units ? y.revenue / y.units : 0;
    // conversion: of the people who wanted something, how many got it? A walkout is a shopper
    // the shop had and lost — which is exactly what "conversion" is supposed to catch.
    const conversion = y.units + lost > 0 ? y.units / (y.units + lost) : 0;

    const catRows = ['balls', 'clubs', 'apparel', 'accessories'].map((cat) => {
      const skus = retailSkus(st).filter((s) => s.cat === cat);
      if (!skus.length) return null;
      const shelf = skus.reduce((a, s) => a + inv[s.id].shelf, 0);
      const back = skus.reduce((a, s) => a + inv[s.id].back, 0);
      const capacity = skus.length * SHELF_CAP[cat];
      const outLines = skus.filter((s) => inv[s.id].shelf === 0).length;
      const sold = skus.reduce((a, s) => a + velocity(st, s.id), 0);
      return el('tr', {},
        el('td', {}, el('span', { text: `${CAT_ICON[cat]} ${CAT_LABEL[cat]}` })),
        el('td', { class: 'lt-num', text: `${shelf} / ${capacity}` }),
        el('td', { class: 'lt-num', text: String(back) }),
        el('td', { class: 'lt-num', text: sold ? sold.toFixed(1) : '—' }),
        el('td', {}, outLines
          ? chip(`${outLines} line${outLines === 1 ? '' : 's'} out`, 'bad')
          : shelf < capacity * 0.3 ? chip('running thin', 'warn') : chip('stocked', 'ok')),
      );
    }).filter(Boolean);

    const featureSel = el('select', {
      class: 'lt-select',
      onchange: (e) => { st.shop.featureCategory = e.target.value; click(); render(); },
    }, ...['balls', 'clubs', 'apparel', 'accessories'].map((c) =>
      el('option', { value: c, text: CAT_LABEL[c], selected: st.shop.featureCategory === c ? 'selected' : undefined })));

    paint(
      head('Pro Shop', 'The shop trades while you are on the floor and while you are not. These are yesterday\'s closed numbers plus the live shelf.',
        primaryBtn('Restock from the supplier', () => go('supplier'))),
      confirmBar(),

      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' },
          el('div', { class: 'lt-statlabel', text: 'Trading' }),
          el('div', { class: `lt-statvalue ${shopIsOpen(st) ? 'ok' : ''}`, text: shopIsOpen(st) ? 'Open' : 'Closed' }),
          el('div', { class: 'lt-statsub', text: `${hour12(SHOP_OPEN_MIN)} – ${hour12(SHOP_CLOSE_MIN)}` })),
        el('div', { class: 'lt-stat' },
          el('div', { class: 'lt-statlabel', text: 'Sales yesterday' }),
          el('div', { class: 'lt-statvalue', text: String(y.units) }),
          el('div', { class: 'lt-statsub', text: formatMoney(y.revenue) })),
        el('div', { class: 'lt-stat' },
          el('div', { class: 'lt-statlabel', text: 'Average sale' }),
          el('div', { class: 'lt-statvalue', text: y.units ? formatMoney(avgTxn) : '—' }),
          el('div', { class: 'lt-statsub', text: y.units ? 'per transaction' : 'nothing sold' })),
        el('div', { class: 'lt-stat' },
          el('div', { class: 'lt-statlabel', text: 'Conversion' }),
          el('div', { class: `lt-statvalue ${conversion < 0.7 && y.units + lost > 0 ? 'bad' : ''}`, text: y.units + lost ? pct(conversion) : '—' }),
          el('div', { class: 'lt-statsub', text: lost ? `${lost} walked out empty-handed` : 'nobody walked out' })),
      ),

      sect('Categories'),
      card(el('table', { class: 'lt-table' },
        el('thead', {}, el('tr', {},
          el('th', { text: 'Category' }), el('th', { class: 'lt-num', text: 'On shelf' }),
          el('th', { class: 'lt-num', text: 'Back' }), el('th', { class: 'lt-num', text: 'Sold / day' }),
          el('th', { text: '' }))),
        el('tbody', {}, ...catRows))),

      sect('Feature table'),
      card(row(
        el('span', { class: 'lt-mulabel', text: 'Front display' }), featureSel,
        meta('the table by the door nudges shoppers toward this category'))),

      lost > 0
        ? errBox(`${lost} shopper${lost === 1 ? '' : 's'} walked out yesterday without buying. Empty shelves and prices they would not pay are the only two reasons.`)
        : note('Stocking is physical: order from the Supplier, then carry the boxes from the stockroom to the displays.'),
    );
  }

  // =========================================================================================
  // 3. SUPPLIER
  // =========================================================================================
  function pageSupplier() {
    const st = app.state;
    // Freight is part of the price. Quoting the goods alone and then taking more at the till is
    // the oldest trick in retail and it has no business being in the player's own back office.
    let goods = 0;
    let freight = 0;
    let boxCount = 0;
    let weight = 0;
    for (const [id, qty] of cart) {
      const sku = skuById(id);
      const ship = shipOf(sku, qty);
      goods += orderCost(sku, qty);
      freight += ship.fee;
      boxCount += ship.boxCount;
      weight += ship.weight;
    }
    goods = Math.round(goods * 100) / 100;
    freight = Math.round(freight * 100) / 100;
    weight = Math.round(weight * 10) / 10;
    const total = Math.round((goods + freight) * 100) / 100;
    const affordable = total <= cashOf();

    const ss = ts('supplier');
    const cats = ['balls', 'accessories', 'apparel', 'clubs', 'supplies', 'decor'];
    const tabs = el('div', { class: 'lt-toolbar' },
      searchBox(ss, () => { click(); render(); }, 'Search the catalog…'),
      el('button', {
        class: `lt-tab ${supplierCat === 'all' ? 'on' : ''}`, text: 'All',
        onclick: () => { supplierCat = 'all'; click(); render(); },
      }),
      ...cats.map((c) => el('button', {
        class: `lt-tab ${supplierCat === c ? 'on' : ''}`, text: CAT_LABEL[c],
        onclick: () => { supplierCat = c; click(); render(); },
      })));

    const needle = String(ss.search || '').trim().toLowerCase();
    const shown = SHOP_CATALOG
      .filter((s) => (supplierCat === 'all' ? true : s.cat === supplierCat))
      .filter((s) => !needle || s.name.toLowerCase().includes(needle)
        || supplierFor(s).name.toLowerCase().includes(needle));
    const cards = shown.map((s) => {
      const locked = s.tier > st.shop.unlockedTier;
      const owned = st.shop.inventory[s.id];
      const inCart = cart.get(s.id) || 0;
      const suggested = priceFor(s, st.shop.markup[s.cat] || 1, null);
      const per = unitsPerBox(s);
      const ship = shipOf(s, inCart);
      const setQty = (q) => {
        q = Math.max(0, Math.min(99, q));
        if (q === 0) cart.delete(s.id); else cart.set(s.id, q);
        render();
      };
      return el('div', { class: `lt-product ${locked ? 'locked' : ''}` },
        thumbOf(s),
        el('div', { class: 'lt-prodname', text: s.name }),
        el('div', { class: 'lt-prodcat', text: `${CAT_LABEL[s.cat]} · tier ${s.tier}` }),
        el('div', { class: 'lt-prodprice' },
          el('span', { class: 'lt-wholesale', text: formatMoney(s.cost) }),
          el('span', { class: 'lt-meta', text: ` → ${formatMoney(suggested)}` })),
        el('div', { class: 'lt-prodmeta', text: `${supplierFor(s).name} · ships in ${LEAD_DAYS[s.cat]}d` }),
        el('div', { class: 'lt-prodmeta', text: `${per} per box · ${plural(ship.boxCount, 'box')} · ${ship.weight} lb${s.fragile ? ' · fragile' : ''}` }),
        el('div', { class: 'lt-prodmeta', text: `on hand: ${owned.shelf + owned.back}` }),
        locked
          ? el('div', { class: 'lt-lock', text: `🔒 Needs supplier tier ${s.tier}` })
          : el('div', { class: 'lt-qtyrow' },
            el('button', { class: 'lt-qbtn', text: '−', onclick: () => setQty(inCart - 1) }),
            el('span', { class: 'lt-qty', text: String(inCart) }),
            el('button', { class: 'lt-qbtn', text: '+', onclick: () => setQty(inCart + 1) })),
      );
    });

    const placeAll = () => {
      let placed = 0;
      let spent = 0;
      let boxes = 0;
      const failed = [];
      for (const [id, qty] of [...cart]) {
        const res = placeOrder(st, id, qty);
        if (res.ok) {
          placed++; spent += res.cost; boxes += res.boxes; cart.delete(id);
        } else failed.push(`${skuById(id).name}: ${res.reason}`);
      }
      if (placed) {
        // THE ORDER-ACCEPTED NOTIFICATION. It says what is actually coming — how many cartons will
        // be standing on that pad — because that is the thing you have to make room for.
        toast(`Order accepted — ${formatMoney(spent)}. ${plural(boxes, 'box')} to the receiving pad.`);
        if (app.audio && app.audio.ready) app.audio.chime();
      }
      for (const f of failed) toast(f, 'warn');
      if (placed && !failed.length) go('orders');
      else render();
    };

    paint(
      head('Supplier', 'Wholesale cost is what you pay, plus freight. The arrow shows what it will ring up at, at your current markup — change that on the Pricing page.',
        primaryBtn(
          cart.size ? `Place order — ${formatMoney(total)}` : 'Basket is empty',
          () => askConfirm(
            `Order ${cart.size} line${cart.size === 1 ? '' : 's'} for ${formatMoney(total)} — ${formatMoney(goods)} of stock plus ${formatMoney(freight)} freight. ${plural(boxCount, 'box')}, ${weight} lb, to the receiving pad.`,
            'Place the order', placeAll,
          ),
          !cart.size || !affordable,
        )),
      confirmBar(),
      !affordable && cart.size ? errBox(`That basket is ${formatMoney(total - cashOf())} more than you have.`) : null,
      cart.size
        ? card(
          row(el('span', { text: 'Stock' }), chip(formatMoney(goods))),
          row(el('span', { text: 'Freight' }), meta(`${plural(boxCount, 'box')} · ${weight} lb`), chip(formatMoney(freight))),
          row(el('span', { class: 'lt-mulabel', text: 'Total' }), chip(formatMoney(total), affordable ? 'ok' : 'bad')),
        )
        : null,
      tabs,
      cards.length ? el('div', { class: 'lt-grid' }, ...cards) : empty('No products match that search.'),
    );
  }

  // =========================================================================================
  // 4. ORDERS
  // =========================================================================================
  function pageOrders() {
    const st = app.state;
    const cal = calendarOf(st.clock.minutes);
    const orders = st.shop.orders.slice().sort((a, b) => a.deliveryMin - b.deliveryMin);
    const boxes = boxesOf(st);

    const orderRow = (o) => {
      const sku = skuById(o.skuId);
      const s = ORDER_STATUS[o.status] || { label: o.status, tone: '' };
      const days = o.arrivesDay - cal.dayAbs;
      const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
      const canCancel = o.status !== 'arriving' && o.status !== 'delivered';
      // read the order's OWN manifest — the one it was packed with, not a fresh guess
      const man = o.manifest || shipOf(sku, o.qty);
      return el('div', { class: 'lt-order' },
        el('div', { class: 'lt-ordernum', text: `#${String(o.id).padStart(4, '0')}` }),
        thumbOf(sku),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: `${sku.name} × ${o.qty}` }),
          el('div', { class: 'lt-prodmeta', text: `${o.supplier || man.supplier} · ${plural(man.boxCount, 'box')} · ${man.weight} lb` }),
          el('div', { class: 'lt-prodmeta', text: `${formatMoney(o.goods != null ? o.goods : o.cost)} stock + ${formatMoney(o.fee || man.fee)} freight = ${formatMoney(o.cost)}` }),
          el('div', { class: 'lt-prodmeta', text: `${when}, ${hour12(o.window.open)}–${hour12(o.window.close)}` })),
        chip(s.label, s.tone),
        canCancel
          ? el('button', {
            class: 'lt-mini lt-cancel',
            text: 'Cancel',
            onclick: () => askConfirm(
              `Cancel order #${o.id} — ${sku.name} × ${o.qty}? You get ${formatMoney(o.cost)} back, freight included.`,
              'Cancel the order',
              () => {
                const res = cancelOrder(st, o.id);
                toast(res.ok ? `Order #${o.id} cancelled — ${formatMoney(res.refund)} refunded.` : res.reason, res.ok ? '' : 'warn');
              },
            ),
          })
          : meta('too late'),
      );
    };

    // A SHIPMENT ON THE FLOOR. Its status is derived from its boxes (sim/deliveries
    // shipmentStatus) — delivered until someone touches it, partially unpacked while stock is
    // still in the cardboard, fully unpacked when it is all out. The screen does not get a vote.
    const shipRow = (sh) => {
      const sku = skuById(sh.skuId);
      const status = shipmentStatus(st, sh);
      const s = ORDER_STATUS[status];
      const mine = boxes.filter((b) => b.orderId === sh.orderId);
      const left = mine.reduce((a, b) => a + b.qty, 0);
      const where = (b) => (b.loc === 'pad' ? 'on the pad'
        : b.loc === 'carried' ? 'in your arms'
          : b.flat ? 'flattened' : 'inside');
      const placesText = mine.length
        ? [...new Set(mine.map(where))].join(', ')
        : 'all cardboard recycled';
      return el('div', { class: 'lt-order' },
        el('div', { class: 'lt-ordernum', text: `#${String(sh.orderId).padStart(4, '0')}` }),
        thumbOf(sku),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: `${sku.name} × ${sh.units}` }),
          el('div', { class: 'lt-prodmeta', text: `${sh.supplier} · ${plural(sh.boxCount, 'box')} · ${sh.weight} lb` }),
          el('div', { class: 'lt-prodmeta', text: `${left} of ${sh.units} still in the cardboard · ${placesText}` })),
        chip(s.label, s.tone),
        el('button', {
          class: 'lt-mini', text: 'Reorder',
          title: 'Put the same line and quantity in the supplier basket',
          onclick: () => { cart.set(sh.skuId, (cart.get(sh.skuId) || 0) + sh.units); click(); go('supplier'); },
        }));
    };

    const shipments = shipmentsOf(st);

    paint(
      head('Orders', 'An order is paid for when you place it, freight and all. Cancelling before the van reaches its window puts the money straight back.',
        primaryBtn('Order more stock', () => go('supplier'))),
      confirmBar(),

      sect(`On the way (${orders.length})`),
      orders.length
        ? el('div', { class: 'lt-orderlist' }, ...orders.map(orderRow))
        : empty('No orders outstanding. Everything you have paid for has landed.'),

      sect(`Landed (${shipments.length})`),
      shipments.length
        ? el('div', { class: 'lt-orderlist' }, ...shipments.map(shipRow))
        : empty('Nothing waiting on the floor.'),
      shipments.length
        ? note('Boxes are physical. Carry them in from the pad, cut the tape, open the flaps, and take what is inside out to the fixtures. A shipment clears from this list when its last carton is recycled.')
        : null,
    );
  }

  // =========================================================================================
  // 5. DELIVERIES
  // =========================================================================================
  function pageDeliveries() {
    const st = app.state;
    const cal = calendarOf(st.clock.minutes);
    const nowMin = st.clock.minutes;
    const today = st.shop.orders.filter((o) => o.arrivesDay === cal.dayAbs);
    const later = st.shop.orders.filter((o) => o.arrivesDay > cal.dayAbs);
    const boxes = boxesOf(st);
    const onPad = boxes.filter((b) => b.loc === 'pad');
    const used = padCount(st);
    // THE BLOCKED-DELIVERY WARNING the brief asks for. This is not a decorative threshold: the
    // same PAD_CAPACITY is what tickDeliveries checks before it lets a van unload, and a van that
    // finds no room turns around and tells you (kind: 'blocked'). The screen and the yard agree.
    const blockedNow = st.shop.orders.filter((o) => o.blocked);
    const padTight = used >= PAD_CAPACITY - 2;

    const line = (o) => {
      const sku = skuById(o.skuId);
      const s = ORDER_STATUS[o.status] || { label: o.status, tone: '' };
      const eta = Math.round((o.deliveryMin - nowMin));
      const man = o.manifest || shipOf(sku, o.qty);
      return el('div', { class: 'lt-order' },
        thumbOf(sku),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: `${sku.name} × ${o.qty}` }),
          el('div', { class: 'lt-prodmeta', text: `${o.supplier || man.supplier} · ${plural(man.boxCount, 'box')} · ${man.weight} lb · to the receiving pad` }),
          el('div', { class: 'lt-prodmeta', text: `window ${hour12(o.window.open)}–${hour12(o.window.close)}${eta > 0 && eta < 600 ? ` · about ${eta} min away` : ''}` })),
        chip(s.label, s.tone));
    };

    paint(
      head('Deliveries', 'The van drops boxes on the receiving pad inside its window. Nobody carries them in for you.'),
      confirmBar(),

      blockedNow.length
        ? errBox(`A van could not unload — the receiving pad is full (${used} of ${PAD_CAPACITY}). ${blockedNow.map((o) => `Order #${o.id}`).join(', ')} ${blockedNow.length === 1 ? 'is' : 'are'} still circling. Carry cartons inside and the driver will try again.`)
        : padTight
          ? errBox(`The receiving pad is nearly full — ${used} of ${PAD_CAPACITY}. Clear some before the next van, or it will have nowhere to put them.`)
          : null,

      sect(`Expected today (${today.length})`),
      today.length ? el('div', { class: 'lt-orderlist' }, ...today.map(line)) : empty('No deliveries due today.'),

      sect(`On the receiving pad (${used} of ${PAD_CAPACITY})`),
      onPad.length
        ? card(...onPad.map((b) => row(
          el('span', { text: `${skuById(b.skuId).name} × ${b.qty}` }),
          meta(`box #${b.id} · ${b.lb ? `${b.lb} lb` : ''}${b.fragile ? ' · fragile' : ''}`),
          chip(boxOpened(b) ? 'Partially unpacked' : 'Delivered', boxOpened(b) ? 'warn' : 'ok'))))
        : empty('The pad is clear.'),

      sect(`Later this week (${later.length})`),
      later.length
        ? card(...later.map((o) => row(
          el('span', { text: `${skuById(o.skuId).name} × ${o.qty}` }),
          meta(`day ${o.arrivesDay - cal.dayAbs === 1 ? 'tomorrow' : `+${o.arrivesDay - cal.dayAbs}`} · ${hour12(o.window.open)}–${hour12(o.window.close)}`),
          chip((ORDER_STATUS[o.status] || {}).label || o.status))))
        : empty('Nothing further out.'),
    );
  }

  // =========================================================================================
  // 6. INVENTORY
  // =========================================================================================
  function pageInventory() {
    const st = app.state;
    const inv = st.shop.inventory;
    const is = ts('inventory', { cat: 'all', sortKey: 'name', sortDir: 1 });
    const rerender = () => { click(); render(); };

    // one row model per line; the table queries over these, never over DOM
    const models = retailSkus(st).map((s) => {
      const e = inv[s.id];
      const v = velocity(st, s.id);
      const retail = priceFor(s, st.shop.markup[s.cat] || 1, null);
      const dos = daysOfSupply(st, s.id);
      return {
        sku: s,
        e,
        cap: SHELF_CAP[s.cat],
        incoming: incomingOf(st, s.id),
        v,
        dos,
        retail,
        margin: retail > 0 ? (retail - s.cost) / retail : 0,
        short: e.shelf + e.back <= Math.max(2, Math.ceil(v * LEAD_DAYS[s.cat])),
      };
    });
    const SORTS = {
      name: (m) => m.sku.name,
      shelf: (m) => m.e.shelf,
      back: (m) => m.e.back,
      incoming: (m) => m.incoming,
      v: (m) => m.v,
      dos: (m) => (m.dos === Infinity ? 1e9 : m.dos),
      cost: (m) => m.sku.cost,
      retail: (m) => m.retail,
      margin: (m) => m.margin,
    };
    const q = applyTableQuery(models, {
      search: is.search,
      searchIn: (m) => [m.sku.name, CAT_LABEL[m.sku.cat]],
      filters: [
        is.cat !== 'all' ? (m) => m.sku.cat === is.cat : null,
        is.filter === 'low' ? (m) => m.short && m.e.shelf + m.e.back > 0 : null,
        is.filter === 'out' ? (m) => m.e.shelf + m.e.back === 0 : null,
        is.filter === 'back' ? (m) => m.e.back > 0 : null,
        is.filter === 'shelf' ? (m) => m.e.shelf > 0 : null,
        is.filter === 'incoming' ? (m) => m.incoming > 0 : null,
      ].filter(Boolean),
      sortVal: SORTS[is.sortKey] || SORTS.name,
      sortDir: is.sortDir,
      page: is.page,
      pageSize: 10,
    });

    const rows = q.rows.map((m) => el('tr', { class: m.short ? 'lt-tr-warn' : '' },
      el('td', {}, el('div', { class: 'lt-invcell' }, thumbOf(m.sku), el('span', { text: m.sku.name }))),
      el('td', { class: 'lt-num', text: `${m.e.shelf}/${m.cap}` }),
      el('td', { class: 'lt-num', text: String(m.e.back) }),
      el('td', { class: 'lt-num', text: m.incoming ? `+${m.incoming}` : '—' }),
      el('td', { class: 'lt-num', text: m.v ? m.v.toFixed(1) : '—' }),
      el('td', { class: 'lt-num', text: m.dos === Infinity ? '∞' : m.dos ? m.dos.toFixed(1) : '0' }),
      el('td', { class: 'lt-num', text: formatMoney(m.sku.cost) }),
      el('td', { class: 'lt-num', text: formatMoney(m.retail) }),
      el('td', { class: 'lt-num', text: pct(m.margin) }),
      el('td', {}, m.e.shelf === 0
        ? chip(m.e.back > 0 ? 'shelve it' : 'OUT', m.e.back > 0 ? 'warn' : 'bad')
        : m.short ? chip('reorder', 'warn') : chip('ok', 'ok')),
      el('td', {}, el('button', {
        class: 'lt-mini', text: 'Order',
        onclick: () => { cart.set(m.sku.id, (cart.get(m.sku.id) || 0) + Math.max(2, Math.ceil(m.v * LEAD_DAYS[m.sku.cat]) || 6)); go('supplier'); },
      })),
    ));
    const locked = SHOP_CATALOG.filter((s) => RETAIL_CATS.has(s.cat) && s.tier > st.shop.unlockedTier);
    const anyMoved = retailSkus(st).some((s) => velocity(st, s.id) > 0);
    const catSel = el('select', { class: 'lt-select', onchange: (e) => { is.cat = e.target.value; is.page = 0; rerender(); } },
      el('option', { value: 'all', text: 'All categories', selected: is.cat === 'all' ? 'selected' : undefined }),
      ...['balls', 'clubs', 'apparel', 'accessories'].map((c) => el('option', {
        value: c, text: CAT_LABEL[c], selected: is.cat === c ? 'selected' : undefined,
      })));

    paint(
      head('Inventory', 'Sold/day is a real seven-day average of what actually left the building — both the sales you rang up and the ones the shop made while you were out on the course. Days of supply is what is on hand divided by that.'),
      confirmBar(),
      !anyMoved
        ? note('No closed trading days on the books yet, so there is no velocity to average. Sold/day and days-of-supply fill in from tomorrow.')
        : null,
      card(
        el('div', { class: 'lt-toolbar' },
          searchBox(is, rerender, 'Search products…'),
          catSel,
          filterTabs(is, [
            { value: 'all', label: 'All' }, { value: 'low', label: 'Low' },
            { value: 'out', label: 'Out' }, { value: 'shelf', label: 'On shelf' },
            { value: 'back', label: 'In storage' }, { value: 'incoming', label: 'Incoming' },
          ], rerender)),
        el('div', { class: 'lt-scrollx' }, el('table', { class: 'lt-table lt-invtable' },
          el('thead', {}, el('tr', {},
            sortHeader('Product', 'name', is, rerender),
            sortHeader('Shelf', 'shelf', is, rerender, { num: true }),
            sortHeader('Back', 'back', is, rerender, { num: true }),
            sortHeader('Incoming', 'incoming', is, rerender, { num: true }),
            sortHeader('Sold/day', 'v', is, rerender, { num: true }),
            sortHeader('Days', 'dos', is, rerender, { num: true }),
            sortHeader('Cost', 'cost', is, rerender, { num: true }),
            sortHeader('Retail', 'retail', is, rerender, { num: true }),
            sortHeader('Margin', 'margin', is, rerender, { num: true }),
            el('th', { text: '' }), el('th', { text: '' }))),
          el('tbody', {}, ...rows))),
        !rows.length ? empty(models.length ? 'Nothing matches those filters.' : 'No retail lines unlocked yet.') : null,
        pagerRow(q, is, rerender),
      ),
      locked.length
        ? card(el('div', { class: 'lt-minihead', text: '🔒  Not unlocked' }),
          ...locked.map((s) => row(el('span', { text: s.name }), meta(`needs supplier tier ${s.tier}`))))
        : null,
      note('The laptop orders and prices stock. Physical products still ride the van, land on the pad, and get carried to the fixtures by hand.'),
    );
  }

  // =========================================================================================
  // 7. PRICING
  // =========================================================================================
  function pagePricing() {
    const st = app.state;
    const ratings = clubRatings(st);
    const fair = fairGreenFee(ratings.overall, st.club.amenities ? Object.values(st.club.amenities).reduce((a, v) => a + v, 0) : 0);

    // shop markup, per category
    const markups = ['clubs', 'balls', 'apparel', 'accessories'].map((cat) => {
      const val = st.shop.markup[cat] || 1;
      const sample = SHOP_CATALOG.find((s) => s.cat === cat && s.tier <= st.shop.unlockedTier);
      const out = el('span', { class: 'lt-muval' });
      const paintMarkup = (v) => {
        const price = sample ? priceFor(sample, v, null) : 0;
        const margin = sample && price > 0 ? (price - sample.cost) / price : 0;
        out.replaceChildren(
          el('span', { class: 'lt-mupct', text: `${Math.round(v * 100)}% of book` }),
          el('span', { class: 'lt-meta', text: sample ? ` · ${sample.name} rings up at ${formatMoney(price)} (${pct(margin)} margin)` : '' }),
          el('span', { class: `lt-chip ${v > 1.2 ? 'bad' : v > 1.05 ? 'warn' : v < 0.9 ? 'warn' : 'ok'}`, text: v > 1.2 ? 'they will baulk' : v > 1.05 ? 'punchy' : v < 0.9 ? 'leaving money on the table' : 'about right' }),
        );
      };
      paintMarkup(val);
      const slider = el('input', {
        type: 'range', min: '70', max: '150', value: String(Math.round(val * 100)), class: 'lt-range',
        oninput: (e) => {
          const v = Number(e.target.value) / 100;
          st.shop.markup[cat] = v;   // written straight to the sim — this IS the price
          paintMarkup(v);
        },
      });
      return row(el('span', { class: 'lt-mulabel', text: CAT_LABEL[cat] }), slider, out);
    });

    const feeOut = el('span', { class: 'lt-muval' });
    const paintFee = (v) => {
      const ratio = fair > 0 ? v / fair : 1;
      feeOut.replaceChildren(
        el('span', { class: 'lt-mupct', text: formatMoney(v) }),
        el('span', { class: 'lt-meta', text: ` · a fair fee for this course is about ${formatMoney(fair)}` }),
        el('span', { class: `lt-chip ${ratio > 1.25 ? 'bad' : ratio > 1.08 ? 'warn' : ratio < 0.8 ? 'warn' : 'ok'}`, text: ratio > 1.25 ? 'rounds will fall away' : ratio > 1.08 ? 'above the mark' : ratio < 0.8 ? 'under-charging' : 'fair' }),
      );
    };
    paintFee(st.club.greenFee);
    const feeRange = el('input', {
      type: 'range', min: '10', max: '150', step: '1', value: String(Math.round(st.club.greenFee)), class: 'lt-range',
      oninput: (e) => { st.club.greenFee = Number(e.target.value); paintFee(st.club.greenFee); },
    });

    const rentOut = el('span', { class: 'lt-muval' });
    const paintRent = (v) => rentOut.replaceChildren(el('span', { class: 'lt-mupct', text: `${formatMoney(v)} / round` }));
    paintRent(st.shop.rentalFleet.pricePerRound);
    const rentRange = el('input', {
      type: 'range', min: '5', max: '60', step: '1', value: String(Math.round(st.shop.rentalFleet.pricePerRound)), class: 'lt-range',
      oninput: (e) => { st.shop.rentalFleet.pricePerRound = Number(e.target.value); paintRent(st.shop.rentalFleet.pricePerRound); },
    });

    paint(
      head('Pricing', 'Every slider here writes straight into the club — there is nothing to save. The chip on the right is the market reading back at you.'),
      confirmBar(),
      sect('Green fee'),
      card(row(el('span', { class: 'lt-mulabel', text: 'Per round' }), feeRange, feeOut)),
      sect('Shop markup'),
      card(...markups),
      sect('Rentals'),
      card(row(el('span', { class: 'lt-mulabel', text: 'Club sets' }), rentRange, rentOut)),
      note('Membership dues are set at the Club desk, not here — they are a season-long commitment rather than a shelf price.'),
    );
  }

  // =========================================================================================
  // 8. RESERVATIONS
  // =========================================================================================
  function pageReservations() {
    const st = app.state;
    if (!st.reservations) {
      paint(head('Reservations'), empty('Reservations are not available on this property.'));
      return;
    }
    const dayBtns = [];
    for (let d = 0; d < TEE_SHEET.horizonDays; d++) {
      dayBtns.push(el('button', {
        class: `lt-day ${d === teeDay ? 'on' : ''}`,
        text: d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `+${d}d`,
        onclick: () => { teeDay = d; click(); render(); },
      }));
    }
    const dayAbs = calendarOf(st.clock.minutes).dayAbs + teeDay;
    const model = laptopReservationSheet(st, dayAbs);
    const directory = ensureCustomerDirectory(st);
    const directoryChoices = directory.customers
      .slice()
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((customer) => ({
        value: `customer:${customer.customerId}`,
        label: customer.fullName,
        customerId: customer.customerId,
      }));
    const directoryNames = new Set(directoryChoices.map((choice) => choice.label.toLowerCase()));
    const memberChoices = members(st)
      .filter((member) => !directoryNames.has(String(member.name).toLowerCase()))
      .slice(0, 40)
      .map((member, index) => ({ value: `member:${index}`, label: member.name, fullName: member.name }));
    const bookingChoices = [
      { value: 'new', label: 'New named guest' },
      ...directoryChoices,
      ...memberChoices,
    ];
    if (!bookingChoices.some((choice) => choice.value === teeCustomerChoice)) teeCustomerChoice = 'new';
    const nameSel = el('select', {
      class: 'lt-select',
      onchange: (event) => { teeCustomerChoice = event.target.value; click(); },
    }, ...bookingChoices.map((choice) => el('option', {
      value: choice.value,
      text: choice.label,
      selected: choice.value === teeCustomerChoice ? 'selected' : undefined,
    })));

    const configuredMax = Number(st.reservations.config?.maxGroupSize) || TEE_SHEET.maxGroupSize;
    const maxPartySize = Math.max(1, Math.min(16, configuredMax));
    teePartySize = Math.max(1, Math.min(maxPartySize, teePartySize));
    const partySel = el('select', {
      class: 'lt-select',
      onchange: (event) => {
        teePartySize = Number(event.target.value) || 1;
        click();
        render();
      },
    }, ...Array.from({ length: maxPartySize }, (_, index) => index + 1).map((size) => el('option', {
      value: String(size),
      text: `${size} player${size === 1 ? '' : 's'}`,
      selected: size === teePartySize ? 'selected' : undefined,
    })));

    const statusText = (status) => (status === 'played' ? 'checked in'
      : status === 'noShow' ? 'no-show'
        : status === 'cancelled' ? 'cancelled' : 'booked');
    const statusTone = (status) => (status === 'played' ? 'ok'
      : status === 'noShow' || status === 'cancelled' ? 'bad' : '');

    const rs = ts('reservations', { view: 'sheet', filter: 'all' });
    const nowAbsMin = st.clock.minutes;
    const viewTabs = el('div', { class: 'lt-tabs' }, ...[['sheet', 'Tee sheet'], ['list', 'List'], ['week', 'Week']].map(([v, label]) => el('button', {
      class: `lt-tab ${rs.view === v ? 'on' : ''}`, text: label,
      onclick: () => { rs.view = v; click(); render(); },
    })));

    // flat reservation entries for the selected day — the list view's row models
    const flat = model.slots.flatMap((slot) => slot.reservations.map((entry) => ({ slot, entry, r: entry.reservation })));
    const canMarkNoShow = (r) => r.status === 'booked'
      && nowAbsMin > (r.teeTimeAbs ?? (r.dayAbs * 1440 + r.minute)) + (TEE_SHEET.noShowGraceMin || 20);
    const listQ = applyTableQuery(flat, {
      search: rs.search,
      searchIn: (m) => [m.entry.fullName],
      filters: [
        rs.filter === 'upcoming' ? (m) => m.r.status === 'booked' && m.slot.minute >= (dayAbs === calendarOf(nowAbsMin).dayAbs ? calendarOf(nowAbsMin).minuteOfDay : 0) : null,
        rs.filter === 'checkedin' ? (m) => m.r.status === 'played' : null,
        rs.filter === 'unpaid' ? (m) => m.r.status === 'booked' && m.entry.outstandingRevenue > 0 : null,
        rs.filter === 'paid' ? (m) => m.r.status === 'played' || (m.r.status === 'booked' && m.entry.outstandingRevenue <= 0) : null,
        rs.filter === 'noshow' ? (m) => m.r.status === 'noShow' : null,
        rs.filter === 'cancelled' ? (m) => m.r.status === 'cancelled' : null,
      ].filter(Boolean),
      sortVal: (m) => m.slot.minute,
      sortDir: 1,
      page: rs.page,
      pageSize: 9,
    });
    const listRows = listQ.rows.map((m) => {
      const deposit = Number(m.r.depositPaid ?? m.r.deposit) || 0;
      return el('div', { class: 'lt-order' },
        el('span', { class: 'lt-slottime', text: fmtSlot(m.slot.minute) }),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: m.entry.fullName }),
          el('div', { class: 'lt-prodmeta', text: `${m.entry.groupSize} player${m.entry.groupSize === 1 ? '' : 's'} · fee ${formatMoney(m.r.fee || 0)}${deposit ? ` · deposit ${formatMoney(deposit)}` : ''}` }),
          el('div', { class: 'lt-prodmeta', text: m.r.status === 'booked' ? `${formatMoney(m.entry.outstandingRevenue)} due at the counter` : m.r.status === 'noShow' && m.r.noShowFeeStatus ? `no-show fee ${m.r.noShowFeeStatus.replace(/-/g, ' ')}` : '' })),
        chip(statusText(m.r.status), statusTone(m.r.status)),
        m.r.status === 'booked' && canMarkNoShow(m.r)
          ? el('button', {
            class: 'lt-mini lt-cancel',
            text: 'No-show',
            title: 'They missed their window. Settles the no-show fee once, against the deposit first.',
            onclick: () => askConfirm(`Mark ${m.entry.fullName}'s ${fmtSlot(m.slot.minute)} as a no-show? The fee settles once, deposit first.`, 'Mark no-show', () => {
              const res = markReservationNoShow(st, m.r.id, { at: nowAbsMin });
              toast(res && res.ok === false ? (res.reason || 'Could not mark it.') : `${m.entry.fullName} marked as a no-show.`, res && res.ok === false ? 'warn' : '');
            }),
          })
          : null,
        m.r.status === 'booked'
          ? el('button', {
            class: 'lt-mini lt-cancel',
            text: 'Cancel',
            onclick: () => askConfirm(`Cancel ${m.entry.fullName}'s ${fmtSlot(m.slot.minute)} tee time?`, 'Cancel the booking', () => {
              cancelReservation(st, m.r.id);
              toast(`${m.entry.fullName}'s ${fmtSlot(m.slot.minute)} capacity is open again.`);
            }),
          })
          : null);
    });

    // seven-day occupancy — the week at a glance, each day clickable
    const weekRows = Array.from({ length: TEE_SHEET.horizonDays }, (_, d) => {
      const wDay = calendarOf(st.clock.minutes).dayAbs + d;
      const wModel = laptopReservationSheet(st, wDay);
      const fill = wModel.totalPlayerCapacity > 0 ? wModel.bookedPlayers / wModel.totalPlayerCapacity : 0;
      return el('div', { class: 'lt-facrow' },
        el('span', { class: 'lt-faclabel', text: d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `+${d} days` }),
        el('div', { class: 'lt-facbar' }, el('div', { class: `lt-facfill ${fill > 0.75 ? 'ok' : ''}`, style: `width:${Math.max(2, fill * 100)}%` })),
        el('span', { class: 'lt-facpct', text: String(wModel.bookedPlayers) }),
        meta(`${wModel.reservationCount} booking${wModel.reservationCount === 1 ? '' : 's'} · ${formatMoney(wModel.expectedRevenue)} outstanding`),
        el('button', { class: 'lt-mini', text: 'Open', onclick: () => { teeDay = d; rs.view = 'sheet'; click(); render(); } }));
    });

    const slots = model.slots.map((slot) => {
      const canFitParty = slot.remainingCapacity >= teePartySize;
      const bookingButton = slot.remainingCapacity > 0
        ? el('button', {
          class: 'lt-mini lt-book',
          text: canFitParty ? `Book ${teePartySize}` : `${slot.remainingCapacity} open`,
          disabled: canFitParty ? undefined : 'disabled',
          onclick: () => {
            const choice = bookingChoices.find((entry) => entry.value === teeCustomerChoice)
              || bookingChoices[0];
            const result = bookLaptopReservation(st, {
              dayAbs,
              minute: slot.minute,
              partySize: teePartySize,
              customerId: choice.customerId,
              fullName: choice.fullName,
            });
            if (!result.ok) toast(result.reason, 'warn');
            else {
              toast(`${result.res.fullName} booked ${teePartySize} player${teePartySize === 1 ? '' : 's'} for ${fmtSlot(slot.minute)}.`);
              teeCustomerChoice = 'new';
              click();
            }
            render();
          },
        })
        : chip('full', 'warn');

      const reservationRows = slot.reservations.map((entry) => {
        const r = entry.reservation;
        return el('span', {
          style: 'display:flex;gap:6px;align-items:center;width:100%;min-width:0',
        },
        el('span', { style: 'font-weight:600;overflow:hidden;text-overflow:ellipsis', text: entry.fullName }),
        chip(`${entry.groupSize} player${entry.groupSize === 1 ? '' : 's'}`),
        chip(statusText(r.status), statusTone(r.status)),
        meta(r.status === 'booked' ? `${formatMoney(entry.outstandingRevenue)} due` : formatMoney(r.fee || 0)),
        r.status === 'booked'
          ? el('button', {
            class: 'lt-mini lt-cancel',
            text: 'Cancel',
            onclick: () => askConfirm(`Cancel ${entry.fullName}'s ${fmtSlot(slot.minute)} tee time?`, 'Cancel the booking', () => {
              cancelReservation(st, r.id);
              toast(`${entry.fullName}'s ${fmtSlot(slot.minute)} capacity is open again.`);
            }),
          })
          : null);
      });

      return el('div', {
        class: `lt-slot ${slot.reservations.length ? 'booked' : ''}`,
        style: 'align-items:flex-start',
      },
      el('span', { class: 'lt-slottime', text: fmtSlot(slot.minute) }),
      el('span', {
        class: 'lt-slotwho',
        style: 'flex-direction:column;align-items:stretch;gap:3px;min-width:0',
      },
      el('span', { style: 'display:flex;gap:6px;align-items:center;width:100%' },
        meta(`${slot.bookedPlayers}/${slot.capacity} players · ${slot.remainingCapacity} open`),
        el('span', { style: 'flex:1' }),
        bookingButton),
      ...reservationRows));
    });

    paint(
      head('Tee Times', 'Booked golfers walk into the shop around their time. The green fee is collected at the counter when you check them in — not when they book.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Reserved players' }), el('div', { class: 'lt-statvalue', text: String(model.bookedPlayers) }), el('div', { class: 'lt-statsub', text: `${model.reservationCount} reservation${model.reservationCount === 1 ? '' : 's'} · ${model.totalPlayerCapacity} daily spots` })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Open capacity' }), el('div', { class: 'lt-statvalue', text: String(model.openPlayerCapacity) }), el('div', { class: 'lt-statsub', text: 'player spots available' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Expected' }), el('div', { class: 'lt-statvalue gold', text: formatMoney(model.expectedRevenue) }), el('div', { class: 'lt-statsub', text: 'outstanding green fees' })),
      ),
      viewTabs,
      rs.view !== 'week'
        ? card(row(el('span', { class: 'lt-mulabel', text: 'Day' }), ...dayBtns),
          rs.view === 'sheet' ? row(el('span', { class: 'lt-mulabel', text: 'Customer' }), nameSel, meta('new guests receive a stable full identity')) : null,
          rs.view === 'sheet' ? row(el('span', { class: 'lt-mulabel', text: 'Party' }), partySel, meta('parties can share a tee time while capacity remains')) : null)
        : null,

      rs.view === 'sheet'
        ? (model.slots.length
          ? el('div', { class: 'lt-card lt-slots' }, ...slots)
          : empty('The sheet is closed for this day.'))
        : null,

      rs.view === 'list'
        ? card(
          el('div', { class: 'lt-toolbar' },
            searchBox(rs, () => { click(); render(); }, 'Search golfers…'),
            filterTabs(rs, [
              { value: 'all', label: 'All' }, { value: 'upcoming', label: 'Upcoming' },
              { value: 'checkedin', label: 'Checked in' }, { value: 'paid', label: 'Paid' },
              { value: 'unpaid', label: 'Unpaid' }, { value: 'noshow', label: 'No-show' },
              { value: 'cancelled', label: 'Cancelled' },
            ], () => { click(); render(); })),
          listRows.length ? el('div', { class: 'lt-orderlist' }, ...listRows) : empty(flat.length ? 'Nothing matches those filters.' : 'Nothing booked this day.'),
          pagerRow(listQ, rs, () => { click(); render(); }),
        )
        : null,

      rs.view === 'week'
        ? card(el('div', { class: 'lt-minihead', text: `The next ${TEE_SHEET.horizonDays} days` }), ...weekRows)
        : null,

      note('Check-in itself happens at the front desk, face to face — the laptop manages the sheet.'),
    );
  }

  // =========================================================================================
  // 9. COURSE
  // =========================================================================================
  function pageCourse() {
    const st = app.state;
    const ratings = clubRatings(st);
    const w = st.weather.today;
    const pol = st.maintenance ? st.maintenance.policies : null;

    // real per-zone turf readings, averaged over the cells that actually belong to each zone
    const ZONES = [
      ['green', ZONE.GREEN, 'Greens'], ['tee', ZONE.TEE, 'Tees'],
      ['fairway', ZONE.FAIRWAY, 'Fairways'], ['rough', ZONE.ROUGH, 'Rough'],
    ];
    const zoneRows = ZONES.map(([key, zone, label]) => {
      const t = st.turf;
      let n = 0; let health = 0; let moist = 0; let wear = 0; let dis = 0;
      for (let i = 0; i < st.course.zones.length; i++) {
        if (st.course.zones[i] !== zone) continue;
        n++;
        health += t.health[i];
        moist += t.moisture[i];
        wear += t.wear[i];
        if (t.disSev[i] > 8) dis++;
      }
      if (!n) return null;
      const h = health / n;
      const p = pol ? pol[key] : null;
      return el('tr', {},
        el('td', { text: label }),
        el('td', {}, el('div', { class: 'lt-bar' }, el('div', { class: `lt-barfill ${h < 45 ? 'bad' : h < 70 ? 'warn' : 'ok'}`, style: `width:${Math.max(2, Math.min(100, h))}%` }))),
        el('td', { class: 'lt-num', text: `${Math.round(h)}` }),
        el('td', { class: 'lt-num', text: `${Math.round(moist / n)}%` }),
        el('td', { class: 'lt-num', text: `${Math.round(wear / n)}` }),
        el('td', {}, dis ? chip(`${dis} cells`, 'bad') : chip('clear', 'ok')),
        el('td', {}, p ? meta(`${p.irrigation} · ${p.schedule} · mow ${p.mowHeightMm}mm/${p.mowEveryDays}d`) : meta('—')),
      );
    }).filter(Boolean);

    const bunkers = (st.sections || []).filter((s) => {
      if (s.zone !== ZONE.BUNKER) return false;
      let sum = 0;
      for (const i of s.cells) sum += st.turf.wear[i];
      return sum / s.cells.length > 25;
    }).length;

    const pinKeyOf = (h) => {
      if (!h.pins || !h.pin) return null;
      for (const k of ['A', 'B', 'C']) {
        const p = h.pins[k];
        if (p && Math.abs(p.x - h.pin.x) < 0.01 && Math.abs(p.y - h.pin.y) < 0.01) return k;
      }
      return null;
    };
    const holes = st.course.holes.map((h, i) => {
      const activePin = pinKeyOf(h);
      const isOpen = h.status === HOLE_STATUS.OPEN;
      return row(
        el('span', { class: 'lt-mulabel', style: 'width:64px', text: h.name || `Hole ${i + 1}` }),
        meta(h.tee && h.pin ? `par ${holePar(st.course, h)} · ${Math.round(holeDistanceYd(h))} yd` : 'unrouted'),
        chip(h.status === HOLE_STATUS.OPEN ? 'open' : h.status, isOpen ? 'ok' : 'warn'),
        (h.status === HOLE_STATUS.RENOVATION || h.status === HOLE_STATUS.CONSTRUCTION) && h.daysLeft > 0
          ? meta(`${h.daysLeft} day${h.daysLeft === 1 ? '' : 's'} left — reopens by itself`) : null,
        isOpen && h.pins && h.pins.A
          ? el('span', { style: 'display:flex;gap:3px;align-items:center' },
            meta('pin'),
            ...['A', 'B', 'C'].filter((k) => h.pins[k]).map((k) => el('button', {
              class: `lt-day ${activePin === k ? 'on' : ''}`,
              style: 'padding:1px 7px;font-size:0.74em',
              text: k,
              title: `Cut the cup at position ${k} — regulars notice a fresh pin`,
              onclick: () => {
                h.pin = { x: h.pins[k].x, y: h.pins[k].y };
                toast(`${h.name || `Hole ${i + 1}`} now plays to pin ${k}.`);
                click();
                render();
              },
            })))
          : null,
        isOpen
          ? el('button', {
            class: 'lt-mini',
            text: 'Rest 1 day',
            title: 'Close the hole for a day of recovery. Golfers route around it; it reopens on its own.',
            onclick: () => askConfirm(`Rest ${h.name || `hole ${i + 1}`} for a day? It closes now and reopens with tomorrow's works.`, 'Rest the hole', () => {
              h.status = HOLE_STATUS.RENOVATION;
              h.daysLeft = 1;
              toast(`${h.name || `Hole ${i + 1}`} is roped off until tomorrow.`);
            }),
          })
          : null,
      );
    });
    const closed = st.course.holes.filter((h) => h.status !== HOLE_STATUS.OPEN).length;

    paint(
      head('Course', 'Health, moisture and wear are averaged live over the cells that belong to each zone. Irrigation is a policy the crew follows at dawn — the club has no sprinkler hardware to fail.',
        opts.openCourseEditor
          ? primaryBtn('Open the works desk', () => askConfirm(
            'Head to the overview works desk? The laptop closes and the course opens under the editing camera — changes bill to course works when you apply the plan.',
            'Open the works desk',
            () => opts.openCourseEditor(),
          ))
          : null),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Overall' }), el('div', { class: 'lt-statvalue', text: String(Math.round(ratings.overall)) }), el('div', { class: 'lt-statsub', text: `design ${Math.round(ratings.design)}` })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Condition' }), el('div', { class: `lt-statvalue ${ratings.condition < 45 ? 'bad' : ''}`, text: String(Math.round(ratings.condition)) }), el('div', { class: 'lt-statsub', text: 'turf, live' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Weather' }), el('div', { class: 'lt-statvalue', text: `${Math.round(w.tempHiF)}°` }), el('div', { class: 'lt-statsub', text: w.rainIn > 0.02 ? `rain ${w.rainIn.toFixed(2)}"` : 'dry' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Holes' }), el('div', { class: `lt-statvalue ${closed ? 'bad' : 'ok'}`, text: closed ? `${closed} closed` : 'All open' }), el('div', { class: 'lt-statsub', text: `${st.course.holes.length} in play` })),
      ),
      sect('Turf by zone'),
      card(el('div', { class: 'lt-scrollx' }, el('table', { class: 'lt-table' },
        el('thead', {}, el('tr', {},
          el('th', { text: 'Zone' }), el('th', { text: 'Health' }), el('th', { class: 'lt-num', text: '' }),
          el('th', { class: 'lt-num', text: 'Moisture' }), el('th', { class: 'lt-num', text: 'Wear' }),
          el('th', { text: 'Disease' }), el('th', { text: 'Policy' }))),
        el('tbody', {}, ...zoneRows)))),
      bunkers ? errBox(`${bunkers} bunker${bunkers === 1 ? '' : 's'} need raking. Take the rake out to them — nobody else will.`) : null,
      sect('Holes'),
      card(...holes),
      note('Mowing, watering and fertiliser policy live on the Maintenance page. Course surgery — zones, terrain, new holes — happens at the works desk under the overview camera.'),
    );
  }

  // =========================================================================================
  // 10. CARTS & RENTALS
  // =========================================================================================
  function pageRentals() {
    const st = app.state;
    const f = st.shop.rentalFleet;
    const led = st.ledger || {};
    const yRent = led.yesterday ? (led.yesterday.revenue.rentals || 0) : 0;

    paint(
      head('Carts & rentals', 'This is the club-set rental fleet: the bags you lend to guests who arrive without clubs. It wears out as it is used and stops earning when it gets too rough.'),
      confirmBar(),

      // THE HONEST BIT. The brief asked for a golf-cart fleet — a list of vehicles with
      // cleanliness, reliability, comfort, assignment and maintenance. The club does not
      // simulate cart vehicles at all: `rentalFleet` is rental CLUB SETS. Rather than print a
      // page of invented cleanliness and reliability scores that no system produces and no
      // decision could safely rest on, the page says what is real and names what is not.
      errBox('Golf carts are not simulated yet — there is no cart fleet, no cart condition and no cart assignment in the club. Nothing on this page is about carts. What follows is the rental club-set fleet, which is real.'),

      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Sets' }), el('div', { class: 'lt-statvalue', text: String(f.sets) }), el('div', { class: 'lt-statsub', text: 'in the fleet' })),
        el('div', { class: 'lt-stat' },
          el('div', { class: 'lt-statlabel', text: 'Condition' }),
          el('div', { class: `lt-statvalue ${f.condition < 30 ? 'bad' : f.condition < 60 ? 'warn' : 'ok'}`, text: String(Math.round(f.condition)) }),
          el('div', { class: 'lt-statsub', text: f.condition <= 15 ? 'too rough to rent' : f.condition < 40 ? 'needs replacing' : 'serviceable' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Price' }), el('div', { class: 'lt-statvalue', text: formatMoney(f.pricePerRound) }), el('div', { class: 'lt-statsub', text: 'per round' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Earned' }), el('div', { class: 'lt-statvalue', text: formatMoney(yRent) }), el('div', { class: 'lt-statsub', text: 'yesterday' })),
      ),

      f.condition <= 15
        ? errBox('The fleet is too battered to rent out — it is earning nothing at all. Buy fresh sets.')
        : null,

      sect('The fleet'),
      card(
        row(el('span', { class: 'lt-mulabel', text: 'Maintenance' }),
          meta('Sets wear a little with every round rented. There is no repair — worn sets are replaced.')),
        row(el('span', { class: 'lt-mulabel', text: 'Price' }),
          meta(`${formatMoney(f.pricePerRound)} per round`),
          el('button', { class: 'lt-mini', text: 'Change on the Pricing page', onclick: () => go('pricing') })),
        row(
          el('span', { class: 'lt-mulabel', text: 'Buy sets' }),
          meta('$220 each — a new set lifts the fleet average'),
          el('button', {
            class: 'lt-primary',
            text: 'Buy 1 set — $220',
            disabled: cashOf() < 220 ? 'disabled' : undefined,
            onclick: () => askConfirm('Buy one fresh rental set for $220?', 'Buy the set', () => {
              const res = buyRentalSets(st, 1);
              toast(res.ok ? 'A fresh set joins the fleet.' : res.reason, res.ok ? '' : 'warn');
            }),
          }),
        ),
      ),
    );
  }

  // =========================================================================================
  // 11. EMPLOYEES
  // =========================================================================================
  function pageEmployees() {
    const st = app.state;
    const cal = calendarOf(st.clock.minutes);
    refreshMarketIfDue(st, cal.dayAbs);
    const emp = st.staff.employees;
    const daily = staffDailyWages(st);
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

    const empRow = (e) => el('div', { class: 'lt-order' },
      el('div', { class: 'lt-avatar', text: (e.name || '?').slice(0, 1) }),
      el('div', { class: 'lt-orderbody' },
        el('div', { class: 'lt-ordername', text: e.name }),
        el('div', { class: 'lt-prodmeta', text: `${ROLE_LABEL[e.role] || e.role} · ${stars(e.skill)} · ${formatMoney(e.wage)}/day` }),
        el('div', { class: 'lt-prodmeta', text: e.trainingDays > 0 ? `in training — ${e.trainingDays} day${e.trainingDays === 1 ? '' : 's'} to go` : 'on shift with the club\'s hours' })),
      e.trainingDays > 0 ? chip('training', 'warn') : chip('working', 'ok'),
      el('button', {
        class: 'lt-mini',
        text: 'Train',
        disabled: e.skill >= 5 || e.trainingDays > 0 ? 'disabled' : undefined,
        onclick: () => askConfirm(`Send ${e.name} on a course? They are off the floor while they learn.`, 'Train them', () => {
          const res = trainStaff(st, e.id);
          toast(res.ok ? `${e.name} is booked onto a course.` : res.reason, res.ok ? '' : 'warn');
        }),
      }),
      el('button', {
        class: 'lt-mini lt-cancel',
        text: 'Let go',
        onclick: () => askConfirm(`Let ${e.name} go? Severance is due immediately.`, 'Let them go', () => {
          const res = fireStaff(st, e.id);
          toast(res.ok ? `${e.name} has been let go.` : res.reason, res.ok ? '' : 'warn');
        }),
      }),
    );

    const candRow = (c) => el('div', { class: 'lt-order' },
      el('div', { class: 'lt-avatar', text: (c.name || '?').slice(0, 1) }),
      el('div', { class: 'lt-orderbody' },
        el('div', { class: 'lt-ordername', text: c.name }),
        el('div', { class: 'lt-prodmeta', text: `${ROLE_LABEL[c.role] || c.role} · ${stars(c.skill)}` }),
        el('div', { class: 'lt-prodmeta', text: `asking ${formatMoney(c.wage)}/day` })),
      el('button', {
        class: 'lt-primary',
        text: `Hire — ${formatMoney(c.wage)}/day`,
        onclick: () => askConfirm(`Hire ${c.name} as ${ROLE_LABEL[c.role]} at ${formatMoney(c.wage)} a day?`, 'Hire them', () => {
          const res = hireStaff(st, c.id);
          toast(res.ok ? `${c.name} starts today.` : res.reason, res.ok ? '' : 'warn');
        }),
      }),
    );

    const byRole = {};
    for (const e of emp) byRole[e.role] = (byRole[e.role] || 0) + 1;

    paint(
      head('Employees', 'A pro on the shop floor sells the big-ticket clubs that will not sell themselves. Groundskeepers cut the hours you would otherwise cut yourself.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'On the books' }), el('div', { class: 'lt-statvalue', text: String(emp.length) }), el('div', { class: 'lt-statsub', text: 'employees' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Wage bill' }), el('div', { class: 'lt-statvalue', text: formatMoney(daily) }), el('div', { class: 'lt-statsub', text: 'per day' })),
        ...Object.keys(ROLE).map((k) => {
          const r = ROLE[k];
          return el('div', { class: 'lt-stat' },
            el('div', { class: 'lt-statlabel', text: ROLE_LABEL[r] }),
            el('div', { class: `lt-statvalue ${byRole[r] ? '' : 'bad'}`, text: String(byRole[r] || 0) }),
            el('div', { class: 'lt-statsub', text: byRole[r] ? 'on staff' : 'nobody' }));
        }),
      ),
      sect(`Your staff (${emp.length})`),
      emp.length ? el('div', { class: 'lt-orderlist' }, ...emp.map(empRow)) : empty('Nobody works here but you. Every hour on the course is an hour you spend.'),
      sect(`Available to hire (${st.staff.market.length})`),
      st.staff.market.length
        ? el('div', { class: 'lt-orderlist' }, ...st.staff.market.map(candRow))
        : empty('Nobody is looking for work this week. The book refreshes every six days.'),
    );
  }

  // =========================================================================================
  // 12. FINANCES
  // =========================================================================================
  function pageFinances() {
    const st = app.state;
    const led = st.ledger || {};
    const cal = calendarOf(st.clock.minutes);

    // aggregate any window of the history
    const sumOf = (days) => {
      const out = { revenue: {}, expense: {} };
      for (const d of days) {
        for (const [k, v] of Object.entries(d.revenue || {})) out.revenue[k] = (out.revenue[k] || 0) + v;
        for (const [k, v] of Object.entries(d.expenses || d.expense || {})) out.expense[k] = (out.expense[k] || 0) + v;
      }
      return out;
    };
    const hist = Array.isArray(led.history) ? led.history : [];
    const today = led.today || { revenue: {}, expense: {} };
    // The books keep 30 closed days, so "everything" honestly means the last 30 — the
    // window label says so rather than implying an archive that does not exist.
    const windows = {
      today: { label: 'Today', data: today, chartDays: 7 },
      week: { label: '7 days', data: sumOf(hist.slice(-7)), chartDays: 7 },
      season: { label: 'Season (24d)', data: sumOf(hist.slice(-24)), chartDays: 24 },
      all: { label: `All books (${hist.length}d kept)`, data: sumOf(hist), chartDays: 0 },
    };

    const table = (data) => {
      const rev = Object.entries(data.revenue || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      const exp = Object.entries(data.expense || {}).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
      const revTotal = rev.reduce((a, [, v]) => a + v, 0);
      const expTotal = exp.reduce((a, [, v]) => a + v, 0);
      return el('div', { class: 'lt-cols2' },
        card(el('div', { class: 'lt-minihead', text: 'Revenue' }),
          ...(rev.length ? rev.map(([k, v]) => row(el('span', { text: REV_LABEL[k] || k }), el('span', { class: 'lt-num lt-pos', text: formatMoney(v) })))
            : [empty('Nothing came in.')]),
          el('div', { class: 'lt-total' }, el('span', { text: 'Total' }), el('span', { class: 'lt-pos', text: formatMoney(revTotal) }))),
        card(el('div', { class: 'lt-minihead', text: 'Expenses' }),
          ...(exp.length ? exp.map(([k, v]) => row(el('span', { text: EXP_LABEL[k] || k }), el('span', { class: 'lt-num lt-neg', text: formatMoney(v) })))
            : [empty('Nothing went out.')]),
          el('div', { class: 'lt-total' }, el('span', { text: 'Total' }), el('span', { class: 'lt-neg', text: formatMoney(expTotal) }))),
      );
    };

    const w = windows[financeWindow] || windows.today;
    const rev = Object.values(w.data.revenue || {}).reduce((a, v) => a + v, 0);
    const exp = Object.values(w.data.expense || {}).reduce((a, v) => a + v, 0);
    const net = rev - exp;
    const owed = arrearsOf(st);

    const tabs = el('div', { class: 'lt-tabs' }, ...Object.entries(windows).map(([k, v]) => el('button', {
      class: `lt-tab ${financeWindow === k ? 'on' : ''}`, text: v.label,
      onclick: () => { financeWindow = k; click(); render(); },
    })));

    // revenue mix for the window — fixed slice order = the validated palette adjacency
    const mix = w.data.revenue || {};
    const mixOther = Object.entries(mix)
      .filter(([k]) => !['greenFees', 'shopSales', 'dues', 'rentals'].includes(k))
      .reduce((a, [, v]) => a + (v > 0 ? v : 0), 0);
    const donutEntries = [
      { label: 'Green fees', value: mix.greenFees || 0, color: SERIES.greenFees },
      { label: 'Shop sales', value: mix.shopSales || 0, color: SERIES.shopSales },
      { label: 'Dues', value: mix.dues || 0, color: SERIES.dues },
      { label: 'Rentals', value: mix.rentals || 0, color: SERIES.rentals },
      { label: 'Other', value: mixOther, color: SERIES.other },
    ];

    // THE TRANSACTION FEED — the ledger's own event log, written at the addRevenue/addExpense
    // chokepoint, so it can never disagree with the category tables above it.
    const fs = ts('finances', { filter: 'all' });
    const txAll = Array.isArray(led.txLog) ? led.txLog : [];
    const txQ = applyTableQuery(txAll, {
      search: fs.search,
      searchIn: (t) => [REV_LABEL[t.key] || EXP_LABEL[t.key] || t.key],
      filters: [fs.filter === 'in' ? (t) => t.kind === 'rev'
        : fs.filter === 'out' ? (t) => t.kind === 'exp'
          : fs.filter === 'refund' ? (t) => t.kind === 'refund' : null].filter(Boolean),
      page: fs.page,
      pageSize: 9,
    });
    const txDay = (m) => calendarOf(m);
    const txRows = txQ.rows.map((t) => {
      const c = txDay(t.m);
      const label = t.kind === 'rev' ? (REV_LABEL[t.key] || t.key) : (EXP_LABEL[t.key] || t.key);
      const desc = t.kind === 'refund' ? `${label} — refunded` : label;
      return el('tr', {},
        el('td', { text: `${c.seasonName.slice(0, 3)} ${c.dayOfSeason} · ${clock12(c.minuteOfDay)}` }),
        el('td', { text: desc }),
        el('td', {}, chip(t.kind === 'exp' ? 'money out' : t.kind === 'refund' ? 'refund' : 'money in', t.kind === 'exp' ? '' : 'ok')),
        el('td', { class: `lt-num ${t.kind === 'exp' ? 'lt-neg' : 'lt-pos'}`, text: `${t.kind === 'exp' ? '−' : '+'}${formatMoney(t.amt)}` }),
        el('td', { class: 'lt-num', text: formatMoney(t.bal) }));
    });

    paint(
      head('Finances', 'Every cash movement in the club routes through this ledger, so it reconciles: across any midnight-to-midnight window, the net equals the cash that actually moved.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Cash' }), el('div', { class: 'lt-statvalue gold', text: formatMoney(cashOf()) }), el('div', { class: 'lt-statsub', text: 'empire-wide wallet' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: `Net · ${w.label.toLowerCase()}` }), el('div', { class: `lt-statvalue ${net >= 0 ? 'ok' : 'bad'}`, text: `${net >= 0 ? '+' : ''}${formatMoney(net)}` }), el('div', { class: 'lt-statsub', text: `${formatMoney(rev)} in, ${formatMoney(exp)} out` })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Property' }), el('div', { class: 'lt-statvalue', text: formatMoney(weeklyCharge(st)) }), el('div', { class: 'lt-statsub', text: 'per week' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Wages' }), el('div', { class: 'lt-statvalue', text: formatMoney(staffDailyWages(st)) }), el('div', { class: 'lt-statsub', text: 'per day' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'On the truck' }), el('div', { class: 'lt-statvalue', text: formatMoney(st.shop.orders.reduce((a, o) => a + o.cost, 0)) }), el('div', { class: 'lt-statsub', text: `${st.shop.orders.length} order${st.shop.orders.length === 1 ? '' : 's'} paid for` })),
      ),
      owed > 0 ? errBox(`${formatMoney(owed)} in arrears on the property, and it is accruing interest. It comes out of the next bill you can cover.`) : null,
      tabs,

      el('div', { class: 'lt-cols2' },
        card(el('div', { class: 'lt-minihead', text: 'Revenue vs expenses' }),
          financeChart(st, w.chartDays, 132)),
        card(el('div', { class: 'lt-minihead', text: `Revenue mix — ${w.label.toLowerCase()}` }),
          rev > 0 ? donutChart({ entries: donutEntries, size: 118, thickness: 14 }) : empty('Nothing came in over this window.')),
      ),

      table(w.data),

      sect('Recent transactions'),
      card(
        el('div', { class: 'lt-toolbar' },
          searchBox(fs, () => { click(); render(); }, 'Search transactions…'),
          filterTabs(fs, [
            { value: 'all', label: 'All' }, { value: 'in', label: 'Money in' },
            { value: 'out', label: 'Money out' }, { value: 'refund', label: 'Refunds' },
          ], () => { click(); render(); })),
        txRows.length
          ? el('table', { class: 'lt-table' },
            el('thead', {}, el('tr', {},
              el('th', { text: 'When' }), el('th', { text: 'Description' }), el('th', { text: 'Kind' }),
              el('th', { class: 'lt-num', text: 'Amount' }), el('th', { class: 'lt-num', text: 'Balance' }))),
            el('tbody', {}, ...txRows))
          : empty(txAll.length ? 'Nothing matches that search.' : 'Transactions appear as money moves.'),
        pagerRow(txQ, fs, () => { click(); render(); }),
      ),

      sect('Upcoming'),
      card(row(el('span', { text: 'Property' }), meta(propertyLine(st, cal.dayAbs)), chip(formatMoney(weeklyCharge(st)))),
        row(el('span', { text: 'Stock already paid for' }), meta(`${st.shop.orders.length} order${st.shop.orders.length === 1 ? '' : 's'} on the truck`), chip(formatMoney(st.shop.orders.reduce((a, o) => a + o.cost, 0))))),
    );
  }

  // =========================================================================================
  // 13. REVIEWS
  // =========================================================================================
  function pageReviews() {
    const st = app.state;
    const s = reviewSummary(st, { waitedSec: 0, queueLen: 0, played: true });
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
    const vs = ts('reviews', { filter: 'all' });
    const rerender = () => { click(); render(); };

    // where each judged factor gets fixed — the review's own cited ids drive the jump
    const FACTOR_PAGE = {
      shopClean: 'reno', exterior: 'reno', courseCondition: 'maintenance', stock: 'inventory',
      prices: 'pricing', coursePrice: 'pricing', waitTime: 'shop', queue: 'shop',
    };
    const factorLabel = Object.fromEntries(REVIEW_FACTORS.map((f) => [f.id, f.label]));

    const factorBar = (f) => {
      const p = Math.round(f.score * 100);
      const tone = f.score >= 0.7 ? 'ok' : f.score >= 0.45 ? '' : 'bad';
      return el('div', { class: 'lt-facrow' },
        el('span', { class: 'lt-faclabel', text: f.label }),
        el('div', { class: 'lt-facbar' }, el('div', { class: `lt-facfill ${tone}`, style: `width:${p}%` })),
        el('span', { class: 'lt-facpct', text: `${p}` }),
        FACTOR_PAGE[f.id] && f.score < 0.5
          ? el('button', { class: 'lt-mini', text: 'Fix it', onclick: () => go(FACTOR_PAGE[f.id]) })
          : null);
    };

    const all = st.club.reviews || [];
    const q = applyTableQuery(all, {
      search: vs.search,
      searchIn: (r) => [r.text],
      filters: [
        vs.filter === 'positive' ? (r) => r.stars >= 4 : null,
        vs.filter === 'negative' ? (r) => r.stars <= 2 : null,
        ['course', 'shop', 'pricing', 'service'].includes(vs.filter)
          ? (r) => (r.cited || []).some((raw) => {
            const id = typeof raw === 'string' ? raw : raw && raw.id;
            return vs.filter === 'course' ? ['courseCondition', 'coursePrice'].includes(id)
              : vs.filter === 'shop' ? ['shopClean', 'exterior', 'stock'].includes(id)
                : vs.filter === 'pricing' ? ['prices', 'coursePrice'].includes(id)
                  : ['waitTime', 'queue'].includes(id);
          })
          : null,
      ].filter(Boolean),
      page: vs.page,
      pageSize: 6,
    });

    paint(
      head('Reviews', 'Every bar below is read from the same model that decides what a visitor writes. The one at the bottom is what they are complaining about — fix that and the score follows. Reviews cannot be deleted; they can only be answered with a better club.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Score' }), el('div', { class: 'lt-statvalue gold', text: s.count ? `${s.average} ★` : '—' }), el('div', { class: 'lt-statsub', text: s.count ? `${s.count} reviews` : 'nobody has been in' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Reputation' }), el('div', { class: 'lt-statvalue', text: String(Math.round(st.club.reputation)) }), el('div', { class: 'lt-statsub', text: 'word of mouth' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Worst factor' }), el('div', { class: `lt-statvalue ${s.worst && s.worst.score < 0.5 ? 'bad' : ''}`, text: s.worst ? `${Math.round(s.worst.score * 100)}` : '—' }), el('div', { class: 'lt-statsub', text: s.worst ? s.worst.label.toLowerCase() : '' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Negative' }), el('div', { class: `lt-statvalue ${all.filter((r) => r.stars <= 2).length ? 'warn' : 'ok'}`, text: String(all.filter((r) => r.stars <= 2).length) }), el('div', { class: 'lt-statsub', text: '2★ and under' })),
      ),
      sect('What they are judging you on, right now'),
      card(...s.byFactor.map(factorBar)),
      s.worst && s.worst.score < 0.5
        ? errBox(`Biggest complaint: ${s.worst.label.toLowerCase()}.`)
        : note('Nothing is badly letting you down at the moment.'),
      sect(`On file (${all.length})`),
      card(
        el('div', { class: 'lt-toolbar' },
          searchBox(vs, rerender, 'Search reviews…'),
          filterTabs(vs, [
            { value: 'all', label: 'All' }, { value: 'positive', label: 'Positive' },
            { value: 'negative', label: 'Negative' }, { value: 'course', label: 'Course' },
            { value: 'shop', label: 'Pro shop' }, { value: 'pricing', label: 'Pricing' },
            { value: 'service', label: 'Service' },
          ], rerender)),
        q.rows.length
          ? el('div', {}, ...q.rows.map((r) => el('div', { class: 'lt-review' },
            el('div', { class: 'lt-revstars', text: stars(r.stars) }),
            el('div', { class: 'lt-revtext', text: r.text }),
            el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' },
              el('span', { class: 'lt-revday', text: `Day ${(r.day ?? 0) + 1}` }),
              ...(r.cited || []).map((raw) => {
                // legacy/damaged saves may carry factor OBJECTS or junk here — read gently
                const id = typeof raw === 'string' ? raw : raw && raw.id;
                if (!id) return null;
                const label = String(factorLabel[id] || id).toLowerCase();
                return FACTOR_PAGE[id]
                  ? el('button', {
                    class: 'lt-mini', style: 'padding:0 7px;font-size:0.72em',
                    text: label,
                    title: 'Open the desk that owns this complaint',
                    onclick: () => go(FACTOR_PAGE[id]),
                  })
                  : chip(label);
              })))))
          : empty(all.length ? 'Nothing matches that filter.' : 'Reviews land as people come through.'),
        pagerRow(q, vs, rerender),
      ),
    );
  }

  // =========================================================================================
  // 14. REPORTS — the closed books, cut every way the club can honestly cut them
  // =========================================================================================
  function pageAnalytics() {
    const st = app.state;
    const led = st.ledger || {};
    const hist = Array.isArray(led.history) ? led.history : [];
    const y = st.shop.salesYesterday;
    const lost = st.shop.lostSalesYesterday || 0;
    const as = ts('analytics', { win: 'week', sortKey: 'v', sortDir: -1 });
    const rerender = () => { click(); render(); };
    const winDays = windowDaysOf(as.win);
    const winHist = winDays > 0 ? hist.slice(-winDays) : hist.slice();
    const cal = calendarOf(st.clock.minutes);

    const agg = { revenue: {}, expense: {} };
    for (const d of winHist) {
      for (const [k, v] of Object.entries(d.revenue || {})) agg.revenue[k] = (agg.revenue[k] || 0) + v;
      for (const [k, v] of Object.entries(d.expenses || d.expense || {})) agg.expense[k] = (agg.expense[k] || 0) + v;
    }
    const revTotal = sumLines(agg.revenue);
    const expTotal = sumLines(agg.expense);

    // WHY did the gate move? The sim can explain itself — explainVisitors reads the same factors
    // the golfers actually used to decide, and hands back one sentence saying so.
    const why = explainVisitors(st, {
      today: st.club.lastRounds || 0,
      yesterday: st.club.prevRounds || 0,
      rainedToday: st.weather.today.rainIn > 0.1,
    });

    // product performance from the real seven-day per-SKU window (the sim's own record;
    // per-product revenue history is not tracked, so the money column is honest arithmetic
    // and says so: units/day × today's price)
    const ranked = retailSkus(st)
      .map((s) => ({
        sku: s,
        v: velocity(st, s.id),
        inv: st.shop.inventory[s.id],
        retail: priceFor(s, st.shop.markup[s.cat] || 1, null),
      }))
      .map((r) => ({ ...r, estRev: r.v * r.retail, margin: r.retail > 0 ? (r.retail - r.sku.cost) / r.retail : 0 }));
    const SORTS = {
      name: (m) => m.sku.name, v: (m) => m.v, estRev: (m) => m.estRev,
      margin: (m) => m.margin, onhand: (m) => m.inv.shelf + m.inv.back,
    };
    const pq = applyTableQuery(ranked, {
      search: as.search,
      searchIn: (m) => [m.sku.name, CAT_LABEL[m.sku.cat]],
      sortVal: SORTS[as.sortKey] || SORTS.v,
      sortDir: as.sortDir,
      page: as.page,
      pageSize: 8,
    });
    const sellouts = ranked.filter((r) => r.inv.shelf === 0 && r.inv.back === 0 && r.v > 0);
    const dead = ranked.filter((r) => r.v === 0 && r.inv.shelf + r.inv.back > 0);

    // review trend over the same window, from the reviews' own day stamps
    const winStart = winDays > 0 ? cal.dayAbs - winDays : -1;
    const winReviews = (st.club.reviews || []).filter((r) => (r.day ?? 0) >= winStart);
    const winAvg = winReviews.length
      ? Math.round((winReviews.reduce((a, r) => a + r.stars, 0) / winReviews.length) * 10) / 10 : 0;

    const catTable = (title, lines, labels, tone) => {
      const entries = Object.entries(lines).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((a, [, v]) => a + v, 0);
      return card(el('div', { class: 'lt-minihead', text: title }),
        ...(entries.length
          ? entries.map(([k, v]) => row(
            el('span', { text: labels[k] || k }),
            el('div', { class: 'lt-bar lt-barwide' }, el('div', { class: `lt-barfill ${tone}`, style: `width:${Math.max(2, (v / Math.max(1, entries[0][1])) * 100)}%` })),
            el('span', { class: `lt-num ${tone === 'ok' ? 'lt-pos' : 'lt-neg'}`, text: formatMoney(v) })))
          : [empty('Nothing in this window.')]),
        el('div', { class: 'lt-total' }, el('span', { text: 'Total' }), el('span', { class: tone === 'ok' ? 'lt-pos' : 'lt-neg', text: formatMoney(total) })));
    };

    paint(
      head('Reports', 'Everything here is cut from records the sim actually keeps: the closed ledger days, the seven-day product window, and the reviews\' own timestamps. Nothing is projected.'),
      confirmBar(),
      el('div', { class: 'lt-tabs' }, ...CHART_WINDOWS.map((cw) => el('button', {
        class: `lt-tab ${as.win === cw.value ? 'on' : ''}`, text: cw.label,
        onclick: () => { as.win = cw.value; rerender(); },
      }))),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Revenue' }), el('div', { class: 'lt-statvalue gold', text: formatMoney(revTotal) }), el('div', { class: 'lt-statsub', text: `${winHist.length} closed day${winHist.length === 1 ? '' : 's'}` })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Expenses' }), el('div', { class: 'lt-statvalue', text: formatMoney(expTotal) }), el('div', { class: 'lt-statsub', text: 'same window' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Net' }), el('div', { class: `lt-statvalue ${revTotal - expTotal >= 0 ? 'ok' : 'bad'}`, text: `${revTotal - expTotal >= 0 ? '+' : ''}${formatMoney(revTotal - expTotal)}` }), el('div', { class: 'lt-statsub', text: 'money earned after expenses' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Reviews' }), el('div', { class: 'lt-statvalue', text: winReviews.length ? `${winAvg} ★` : '—' }), el('div', { class: 'lt-statsub', text: `${winReviews.length} in the window` })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Walked out' }), el('div', { class: `lt-statvalue ${lost ? 'bad' : 'ok'}`, text: String(lost) }), el('div', { class: 'lt-statsub', text: `yesterday · ${y.units} sales made` })),
      ),

      why ? el('div', {}, sect('Why the gate moved'), card(el('div', { class: 'lt-why', text: why }))) : null,

      sect('The window, day by day'),
      card(financeChart(st, winDays, 140)),

      el('div', { class: 'lt-cols2' },
        catTable('Revenue by line', agg.revenue, REV_LABEL, 'ok'),
        catTable('Expenses by line', agg.expense, EXP_LABEL, 'bad'),
      ),

      sect('Product performance — rolling 7-day record'),
      card(
        el('div', { class: 'lt-toolbar' }, searchBox(as, rerender, 'Search products…')),
        pq.rows.length
          ? el('table', { class: 'lt-table' },
            el('thead', {}, el('tr', {},
              sortHeader('Product', 'name', as, rerender),
              sortHeader('Sold/day', 'v', as, rerender, { num: true }),
              sortHeader('Est $/day', 'estRev', as, rerender, { num: true }),
              sortHeader('Margin', 'margin', as, rerender, { num: true }),
              sortHeader('On hand', 'onhand', as, rerender, { num: true }))),
            el('tbody', {}, ...pq.rows.map((m) => el('tr', {},
              el('td', {}, el('div', { class: 'lt-invcell' }, thumbOf(m.sku), el('span', { text: m.sku.name }))),
              el('td', { class: 'lt-num', text: m.v ? m.v.toFixed(1) : '—' }),
              el('td', { class: 'lt-num', text: m.v ? formatMoney(m.estRev) : '—' }),
              el('td', { class: 'lt-num', text: pct(m.margin) }),
              el('td', { class: 'lt-num', text: String(m.inv.shelf + m.inv.back) })))))
          : empty('No product has a record yet.'),
        pagerRow(pq, as, rerender),
      ),

      sellouts.length
        ? el('div', {}, sect('Sold out while still moving'), card(...sellouts.map((r) => row(
          el('span', { text: r.sku.name }),
          meta(`was moving ${r.v.toFixed(1)} a day`),
          chip('nothing left', 'bad'),
          el('button', { class: 'lt-mini', text: 'Reorder', onclick: () => { cart.set(r.sku.id, (cart.get(r.sku.id) || 0) + 6); go('supplier'); } })))))
        : null,
      dead.length
        ? el('div', {}, sect('Not moving'), card(...dead.slice(0, 6).map((r) => row(
          el('span', { text: r.sku.name }),
          meta(`${r.inv.shelf + r.inv.back} on hand, none sold in seven days`),
          chip('dead stock', 'warn')))))
        : null,
    );
  }

  // =========================================================================================
  // 15. RENOVATION
  // =========================================================================================
  function pageReno() {
    const st = app.state;
    const reno = st.shop.reno;
    const cond = shopCondition(st);
    const grime = grimeAvgOf(st);
    const clutterLeft = reno ? reno.clutter.filter((c) => !c.cleared).length : 0;
    const decorSkus = SHOP_CATALOG.filter((s) => s.cat === 'decor');

    const stage = cond < 30
      ? ['Stage 1 — Abandoned', 'Heavy grime, clutter, dead lights. Haul the junk, run the vacuum, order the basics.']
      : cond < 55 ? ['Stage 2 — Clean & functional', 'The floor works. Keep the shelves stocked; start placing decor.']
        : cond < 85 ? ['Stage 3 — Established shop', 'Organised and lit. Full decor and full shelves push it premium.']
          : ['Stage 4 — Premium clubhouse shop', 'The room shows like the reference. Keep it that way.'];

    paint(
      head('Renovation', 'Cleanliness carries 70 points of shop condition; decor finish carries up to 30. Both are earned on the floor, not on this screen.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Condition' }), el('div', { class: `lt-statvalue ${cond < 45 ? 'bad' : ''}`, text: String(cond) }), el('div', { class: 'lt-statsub', text: stage[0] })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Clean' }), el('div', { class: 'lt-statvalue', text: pct(1 - grime) }), el('div', { class: 'lt-statsub', text: `${clutterLeft} clutter pile${clutterLeft === 1 ? '' : 's'} left` })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Decor' }), el('div', { class: 'lt-statvalue', text: String(reno ? reno.decor.length : 0) }), el('div', { class: 'lt-statsub', text: 'pieces placed' })),
      ),
      card(el('div', { text: stage[1] })),
      sect('Fixtures & decor — order here, place them in the room'),
      card(...decorSkus.map((s) => {
        const placed = reno ? reno.decor.filter((d) => d.skuId === s.id).length : 0;
        const back = st.shop.inventory[s.id].back;
        const incoming = incomingOf(st, s.id);
        return el('div', { class: 'lt-order' },
          thumbOf(s),
          el('div', { class: 'lt-orderbody' },
            el('div', { class: 'lt-ordername', text: s.name }),
            el('div', { class: 'lt-prodmeta', text: `${formatMoney(s.cost)} · finish +${s.finish}` }),
            el('div', { class: 'lt-prodmeta', text: `${placed} placed · ${back} in the back${incoming ? ` · ${incoming} inbound` : ''}` })),
          el('button', {
            class: 'lt-mini',
            text: 'Order one',
            disabled: cashOf() < s.cost ? 'disabled' : undefined,
            onclick: () => {
              const res = placeOrder(st, s.id, 1);
              toast(res.ok ? `${s.name} ordered — place it from its green ghost when it lands.` : res.reason, res.ok ? '' : 'warn');
              if (res.ok) click();
              render();
            },
          }));
      })),
      note('The exterior — siding, gutters, windows, weeds — is cleaned by hand outside, with the pressure washer.'),
    );
  }

  // =========================================================================================
  // 16. SETTINGS
  // =========================================================================================
  function pageSettings() {
    const st = app.state;
    const prefs = st.uiPrefs || (st.uiPrefs = {});

    const scaleRow = row(
      el('span', { class: 'lt-mulabel', text: 'Interface scale' }),
      ...[0.9, 1, 1.15, 1.3].map((s) => el('button', {
        class: `lt-day ${Math.abs(scale - s) < 0.01 ? 'on' : ''}`,
        text: `${Math.round(s * 100)}%`,
        onclick: () => { setScale(s); prefs.laptopScale = s; click(); render(); },
      })),
      meta('the screen is a real object at a real distance — make the type bigger if it reads small'),
    );

    const financeDefaultSel = el('select', {
      class: 'lt-select',
      onchange: (e) => { prefs.financeWindow = e.target.value; financeWindow = e.target.value; toast('Finances will open on that window.'); },
    }, ...[['today', 'Today'], ['week', '7 days'], ['season', 'Season'], ['all', 'All books']].map(([v, label]) => el('option', {
      value: v, text: label, selected: (prefs.financeWindow || 'today') === v ? 'selected' : undefined,
    })));
    const teeDefaultSel = el('select', {
      class: 'lt-select',
      onchange: (e) => { prefs.teeView = e.target.value; ts('reservations').view = e.target.value; toast('The tee sheet will open on that view.'); },
    }, ...[['sheet', 'Tee sheet'], ['list', 'List'], ['week', 'Week']].map(([v, label]) => el('option', {
      value: v, text: label, selected: (prefs.teeView || 'sheet') === v ? 'selected' : undefined,
    })));

    const nameInput = el('input', {
      class: 'lt-input', type: 'text', value: st.clubName || '',
      onchange: (e) => {
        const v = e.target.value.trim();
        if (!v) { toast('The club needs a name.', 'warn'); e.target.value = st.clubName; return; }
        st.clubName = v;
        toast(`The club is now ${v}.`);
        render();
      },
    });

    const simpleCheck = el('input', {
      type: 'checkbox', class: 'lt-check',
      checked: st.shop.simpleCheckout ? 'checked' : undefined,
      onchange: (e) => {
        st.shop.simpleCheckout = !!e.target.checked;
        toast(st.shop.simpleCheckout
          ? 'Checkout simplified — the register still opens, but change is counted for you.'
          : 'Checkout is fully manual again.');
      },
    });

    paint(
      head('Settings', 'Hours are the course\'s playing day — the shop trades while the course is open, and closing time empties the floor.'),
      confirmBar(),
      sect('Property'),
      card(
        row(el('span', { class: 'lt-mulabel', text: 'Club name' }), nameInput),
        row(el('span', { class: 'lt-mulabel', text: 'Shop hours' }), el('span', { text: `${hour12(SHOP_OPEN_MIN)} – ${hour12(SHOP_CLOSE_MIN)}` }), meta('fixed to the course\'s playing day')),
        row(el('span', { class: 'lt-mulabel', text: 'Course hours' }), el('span', { text: `${hour12(TEE_SHEET.openMin)} – ${hour12(TEE_SHEET.closeMin)}` }), meta('first and last tee time')),
      ),
      sect('Display'),
      card(
        scaleRow,
        row(el('span', { class: 'lt-mulabel', text: 'Finances opens on' }), financeDefaultSel, meta('the timeframe the books show first')),
        row(el('span', { class: 'lt-mulabel', text: 'Tee sheet opens on' }), teeDefaultSel, meta('sheet, list or the week overview')),
      ),
      sect('Difficulty'),
      card(
        el('label', { class: 'lt-row' }, simpleCheck,
          el('span', {},
            el('div', { text: 'Simplified checkout' }),
            el('div', { class: 'lt-meta', text: 'The register still opens and you still scan and bag — but the change is counted out for you rather than picked coin by coin.' }))),
      ),
      sect('Saving'),
      card(row(el('span', { class: 'lt-mulabel', text: 'Autosave' }), el('span', { text: 'Nightly, plus the office menu (Esc)' }))),
    );
  }

  // =========================================================================================
  // 17. CUSTOMERS — the persisted visitor directory, with each customer's real history
  // =========================================================================================
  function pageCustomers() {
    const st = app.state;
    const cs = ts('customers', { sortKey: 'visits', sortDir: -1, sel: null });
    const rerender = () => { click(); render(); };
    const directory = ensureCustomerDirectory(st);
    const cal = calendarOf(st.clock.minutes);
    const models = directory.customers.map((c) => {
      const h = c.visitHistory || {};
      return {
        c,
        name: c.fullName,
        visits: h.totalVisits || 0,
        purchases: h.completedPurchases || 0,
        checkIns: h.completedCheckIns || 0,
        noShows: h.noShows || 0,
        cancels: h.cancellations || 0,
        spend: h.lifetimeSpend || 0,
        lastDay: Number.isFinite(h.lastVisitDayAbs) ? h.lastVisitDayAbs : null,
      };
    });
    const SORTS = {
      name: (m) => m.name, visits: (m) => m.visits, spend: (m) => m.spend,
      noShows: (m) => m.noShows, lastDay: (m) => (m.lastDay == null ? -1 : m.lastDay),
    };
    const q = applyTableQuery(models, {
      search: cs.search,
      searchIn: (m) => [m.name],
      filters: [
        cs.filter === 'new' ? (m) => m.visits <= 1 : null,
        cs.filter === 'returning' ? (m) => m.visits >= 2 : null,
        cs.filter === 'high' ? (m) => m.spend >= 50 : null,
        cs.filter === 'noshow' ? (m) => m.noShows > 0 : null,
      ].filter(Boolean),
      sortVal: SORTS[cs.sortKey] || SORTS.visits,
      sortDir: cs.sortDir,
      page: cs.page,
      pageSize: 9,
    });
    const sel = cs.sel != null ? models.find((m) => m.c.customerId === cs.sel) : null;
    const selReservations = sel && st.reservations
      ? st.reservations.booked.filter((r) => r.customerId === sel.c.customerId).slice(-6).reverse()
      : [];

    paint(
      head('Customers', 'Everyone here walked through the door at least once — the directory is written by real visits, bookings and sales, never invented. It keeps business facts only: what they did at your club.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'On file' }), el('div', { class: 'lt-statvalue', text: String(models.length) }), el('div', { class: 'lt-statsub', text: 'customers' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Returning' }), el('div', { class: 'lt-statvalue', text: String(models.filter((m) => m.visits >= 2).length) }), el('div', { class: 'lt-statsub', text: '2+ visits' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Lifetime spend' }), el('div', { class: 'lt-statvalue gold', text: formatMoney(models.reduce((a, m) => a + m.spend, 0)) }), el('div', { class: 'lt-statsub', text: 'across the directory' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'No-shows' }), el('div', { class: `lt-statvalue ${models.some((m) => m.noShows) ? 'warn' : ''}`, text: String(models.reduce((a, m) => a + m.noShows, 0)) }), el('div', { class: 'lt-statsub', text: 'missed tee times' })),
      ),
      sel ? card(
        el('div', { class: 'lt-minihead', text: `👤  ${sel.name}` }),
        row(chip(`${sel.visits} visit${sel.visits === 1 ? '' : 's'}`), chip(`${sel.purchases} purchase${sel.purchases === 1 ? '' : 's'}`, sel.purchases ? 'ok' : ''),
          chip(`${sel.checkIns} check-in${sel.checkIns === 1 ? '' : 's'}`), sel.noShows ? chip(`${sel.noShows} no-show${sel.noShows === 1 ? '' : 's'}`, 'bad') : null,
          chip(`spent ${formatMoney(sel.spend)}`, 'gold')),
        row(meta(sel.lastDay != null ? `last seen day ${sel.lastDay + 1} (${cal.dayAbs - sel.lastDay === 0 ? 'today' : `${cal.dayAbs - sel.lastDay}d ago`})` : 'not seen yet')),
        selReservations.length
          ? el('div', {}, sect('Their reservations'),
            ...selReservations.map((r) => row(
              el('span', { class: 'lt-slottime', text: `Day ${r.dayAbs + 1} ${fmtSlot(r.minute)}` }),
              meta(`${Math.max(1, Number(r.groupSize ?? r.partySize) || 1)} player(s) · ${formatMoney(r.fee || 0)}`),
              chip(r.status === 'played' ? 'checked in' : r.status, r.status === 'played' ? 'ok' : r.status === 'booked' ? '' : 'bad'))))
          : null,
        el('button', { class: 'lt-mini', text: 'Close profile', onclick: () => { cs.sel = null; rerender(); } }),
      ) : null,
      card(
        el('div', { class: 'lt-toolbar' },
          searchBox(cs, rerender, 'Search customers…'),
          filterTabs(cs, [
            { value: 'all', label: 'All' }, { value: 'new', label: 'New' },
            { value: 'returning', label: 'Returning' }, { value: 'high', label: 'High value' },
            { value: 'noshow', label: 'No-show risk' },
          ], rerender)),
        q.rows.length
          ? el('table', { class: 'lt-table' },
            el('thead', {}, el('tr', {},
              sortHeader('Customer', 'name', cs, rerender),
              sortHeader('Visits', 'visits', cs, rerender, { num: true }),
              sortHeader('Spent', 'spend', cs, rerender, { num: true }),
              sortHeader('No-shows', 'noShows', cs, rerender, { num: true }),
              sortHeader('Last seen', 'lastDay', cs, rerender, { num: true }),
              el('th', { text: '' }))),
            el('tbody', {}, ...q.rows.map((m) => el('tr', {},
              el('td', {}, el('div', { class: 'lt-invcell' }, el('div', { class: 'lt-avatar', style: 'width:24px;height:24px;font-size:0.72em', text: m.name.slice(0, 1) }), el('span', { text: m.name }))),
              el('td', { class: 'lt-num', text: String(m.visits) }),
              el('td', { class: 'lt-num', text: formatMoney(m.spend) }),
              el('td', { class: 'lt-num' }, m.noShows ? chip(String(m.noShows), 'bad') : el('span', { class: 'lt-meta', text: '—' })),
              el('td', { class: 'lt-num', text: m.lastDay != null ? `day ${m.lastDay + 1}` : '—' }),
              el('td', {}, el('button', { class: 'lt-mini', text: 'Profile', onclick: () => { cs.sel = m.c.customerId; rerender(); } }))))))
          : empty(models.length ? 'Nothing matches those filters.' : 'Nobody is on file yet — the directory fills in as guests book and buy.'),
        pagerRow(q, cs, rerender),
      ),
      note('Members of the club — the golfers who pay dues — live on the Memberships page. This directory is the till-and-tee-sheet ledger of everyone who has done business here.'),
    );
  }

  // =========================================================================================
  // 18. MEMBERSHIPS — tiers, dues, and the roll (all real: club.js TIERS + golfers)
  // =========================================================================================
  function pageMemberships() {
    const st = app.state;
    const ms = ts('memberships', { tier: 'all', sortKey: 'name', sortDir: 1 });
    const rerender = () => { click(); render(); };
    const counts = memberCounts(st);
    const ratings = clubRatings(st);
    const amenity = amenityScore(st);
    const roll = members(st);
    const cal = calendarOf(st.clock.minutes);
    const duesToday = st.ledger?.today?.revenue?.dues || 0;
    const hist = Array.isArray(st.ledger?.history) ? st.ledger.history : [];
    const duesWeek = hist.slice(-7).reduce((a, d) => a + ((d.revenue || {}).dues || 0), 0) + duesToday;

    const tierCard = (key) => {
      const t = TIERS[key];
      const fair = fairDues(st, key, ratings.overall, amenity);
      const val = st.club.dues[key];
      const out = el('span', { class: 'lt-muval' });
      const paintDues = (v) => {
        const ratio = fair > 0 ? v / fair : 1;
        out.replaceChildren(
          el('span', { class: 'lt-mupct', text: `${formatMoney(v)} / season` }),
          el('span', { class: 'lt-meta', text: ` · fair for this club ≈ ${formatMoney(Math.round(fair))}` }),
          el('span', { class: `lt-chip ${ratio > 1.3 ? 'bad' : ratio > 1.1 ? 'warn' : ratio < 0.75 ? 'warn' : 'ok'}`, text: ratio > 1.3 ? 'members will walk' : ratio > 1.1 ? 'punchy' : ratio < 0.75 ? 'under-charging' : 'about right' }),
        );
      };
      paintDues(val);
      const slider = el('input', {
        type: 'range', min: '60', max: String(Math.max(1400, Math.round(fair * 2))), step: '10',
        value: String(Math.round(val)), class: 'lt-range',
        oninput: (e) => { st.club.dues[key] = Number(e.target.value); paintDues(st.club.dues[key]); },
      });
      return card(
        el('div', { class: 'lt-minihead', text: `${t.name} — ${counts[key]} member${counts[key] === 1 ? '' : 's'}` }),
        row(meta(t.blurb)),
        row(meta(`${t.guestPassesPerSeason} guest pass${t.guestPassesPerSeason === 1 ? '' : 'es'}/season · ${Math.round(t.shopDiscount * 100)}% shop discount`)),
        row(el('span', { class: 'lt-mulabel', text: 'Dues' }), slider, out),
      );
    };

    const rollModels = roll.map((g) => ({
      g,
      name: g.name,
      tier: g.memberTier,
      satisfaction: Math.round(g.satisfaction),
      joined: g.joinedDay,
      rounds: g.roundsPlayed || 0,
    }));
    const SORTS = {
      name: (m) => m.name, tier: (m) => m.tier, satisfaction: (m) => m.satisfaction,
      joined: (m) => m.joined, rounds: (m) => m.rounds,
    };
    const q = applyTableQuery(rollModels, {
      search: ms.search,
      searchIn: (m) => [m.name, TIERS[m.tier]?.name],
      filters: [ms.tier !== 'all' ? (m) => m.tier === ms.tier : null].filter(Boolean),
      sortVal: SORTS[ms.sortKey] || SORTS.name,
      sortDir: ms.sortDir,
      page: ms.page,
      pageSize: 9,
    });
    const joinsFeed = (st.club.feed || []).filter((f) => ['join', 'quit', 'quit-forever'].includes(f.kind)).slice(0, 5);

    paint(
      head('Memberships', 'Dues bill daily at a season rate — set them against what the club is actually worth. Existing members keep playing at whatever you charge; too far above fair and they quietly stop renewing.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Members' }), el('div', { class: 'lt-statvalue', text: String(roll.length) }), el('div', { class: 'lt-statsub', text: `of ${st.golfers.pool.length} golfers around` })),
        ...Object.keys(TIERS).map((k) => el('div', { class: 'lt-stat' },
          el('div', { class: 'lt-statlabel', text: TIERS[k].name }),
          el('div', { class: 'lt-statvalue', text: String(counts[k]) }),
          el('div', { class: 'lt-statsub', text: `${formatMoney(st.club.dues[k])}/season` }))),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Dues · 7 days' }), el('div', { class: 'lt-statvalue gold', text: formatMoney(duesWeek) }), el('div', { class: 'lt-statsub', text: `${formatMoney(duesToday)} today` })),
      ),
      sect('Tiers'),
      ...Object.keys(TIERS).map(tierCard),
      sect('The roll'),
      card(
        el('div', { class: 'lt-toolbar' },
          searchBox(ms, rerender, 'Search members…'),
          filterTabs(ms, [
            { value: 'all', label: 'All' },
            ...Object.keys(TIERS).map((k) => ({ value: k, label: TIERS[k].name })),
          ], rerender, 'tier')),
        q.rows.length
          ? el('table', { class: 'lt-table' },
            el('thead', {}, el('tr', {},
              sortHeader('Member', 'name', ms, rerender),
              sortHeader('Tier', 'tier', ms, rerender),
              sortHeader('Satisfaction', 'satisfaction', ms, rerender, { num: true }),
              sortHeader('Joined', 'joined', ms, rerender, { num: true }),
              sortHeader('Rounds', 'rounds', ms, rerender, { num: true }))),
            el('tbody', {}, ...q.rows.map((m) => el('tr', {},
              el('td', { text: m.name }),
              el('td', {}, chip(TIERS[m.tier]?.name || m.tier, m.tier === 'premium' ? 'gold' : '')),
              el('td', { class: 'lt-num' }, chip(`${m.satisfaction}`, m.satisfaction >= 60 ? 'ok' : m.satisfaction >= 35 ? 'warn' : 'bad')),
              el('td', { class: 'lt-num', text: m.joined >= 0 ? `day ${m.joined + 1}` : '—' }),
              el('td', { class: 'lt-num', text: String(m.rounds) })))))
          : empty(roll.length ? 'Nothing matches those filters.' : 'No members yet — reputation and fair dues bring them in.'),
        pagerRow(q, ms, rerender),
      ),
      joinsFeed.length
        ? el('div', {}, sect('Comings and goings'), card(...joinsFeed.map((f) => row(
          el('span', { text: f.kind === 'join' ? '🟢' : f.kind === 'quit' ? '🔴' : '⛔' }),
          el('span', { text: f.text }), meta(`day ${(f.day ?? 0) + 1}`)))))
        : null,
      note(`Joins and renewals are the golfers' own decision — day ${cal.dayAbs + 1}'s satisfaction, your dues and the club's rating drive them. There is no button that manufactures a member.`),
    );
  }

  // =========================================================================================
  // 19. MAINTENANCE — the crew's standing orders, this morning's report, and the problem list
  // =========================================================================================
  function pageMaintenance() {
    const st = app.state;
    const cal = calendarOf(st.clock.minutes);
    const pol = st.maintenance ? st.maintenance.policies : null;
    const report = st.maintenance ? st.maintenance.lastReport : null;
    const crewHours = groundsCrewHours(st);
    const gks = st.staff.employees.filter((e) => e.role === ROLE.GROUNDSKEEPER);

    if (!pol) {
      paint(head('Maintenance'), errBox('This property has no maintenance program yet.'));
      return;
    }

    const ZONE_RANGE = {
      green: { mow: [3, 7], label: 'Greens' },
      tee: { mow: [8, 14], label: 'Tees' },
      fairway: { mow: [10, 20], label: 'Fairways' },
      rough: { mow: [25, 60], label: 'Rough' },
    };
    const cycle = (options, current) => options[(options.indexOf(current) + 1) % options.length];
    const policyRow = (key) => {
      const p = pol[key];
      const range = ZONE_RANGE[key];
      const mowOut = el('span', { class: 'lt-mupct', text: `${p.mowHeightMm}mm` });
      const mowSlider = el('input', {
        type: 'range', min: String(range.mow[0]), max: String(range.mow[1]), step: '1',
        value: String(p.mowHeightMm), class: 'lt-range', style: 'max-width:110px',
        oninput: (e) => { p.mowHeightMm = Number(e.target.value); mowOut.textContent = `${p.mowHeightMm}mm`; },
      });
      const everyOut = el('span', { class: 'lt-mupct', text: `${p.mowEveryDays}d` });
      const everySlider = el('input', {
        type: 'range', min: '1', max: '10', step: '1',
        value: String(p.mowEveryDays), class: 'lt-range', style: 'max-width:90px',
        oninput: (e) => { p.mowEveryDays = Number(e.target.value); everyOut.textContent = `${p.mowEveryDays}d`; },
      });
      const cycleBtn = (label, field, options) => el('button', {
        class: 'lt-mini', text: `${label}: ${p[field]}`,
        title: `Click to change — the crew follows this from tomorrow's dawn pass`,
        onclick: (e) => { p[field] = cycle(options, p[field]); e.target.textContent = `${label}: ${p[field]}`; click(); },
      });
      return card(
        el('div', { class: 'lt-minihead', text: range.label }),
        row(el('span', { class: 'lt-mulabel', text: 'Mow height' }), mowSlider, mowOut,
          el('span', { class: 'lt-mulabel', style: 'width:auto', text: 'every' }), everySlider, everyOut),
        row(
          cycleBtn('Irrigation', 'irrigation', ['off', 'light', 'standard', 'heavy']),
          cycleBtn('Fertilizer', 'fertilizer', ['none', 'lean', 'standard', 'aggressive']),
          cycleBtn('Watering', 'schedule', ['dawn', 'both']),
          cycleBtn('Pattern', 'pattern', ['plain', 'stripes']),
        ),
      );
    };

    // the problem list: every labeled section the turf model says is suffering
    const problems = (st.sections || []).map((section) => {
      const status = sectionStatus(st, section);
      if (status === 'Healthy') return null;
      const summary = sectionTurfSummary(st, section);
      const diagnosis = diagnoseSection(st, section);
      return { section, status, summary, diagnosis };
    }).filter(Boolean).slice(0, 8);
    const rakes = (st.sections || []).filter((s) => {
      if (s.zone !== ZONE.BUNKER) return false;
      let sum = 0;
      for (const i of s.cells) sum += st.turf.wear[i];
      return sum / s.cells.length > 25;
    }).length;

    const problemRow = (p) => {
      const treatCost = Math.round(p.section.cells.length * 2.2);
      const aerateCost = Math.round(p.section.cells.length * 1.2);
      const diseased = !!p.summary.disease;
      const line = p.diagnosis
        || `Health ${p.summary.health}, wear ${p.summary.wear}, moisture ${p.summary.moisture} — worn ground that wants air and rest.`;
      return el('div', { class: 'lt-order' },
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: `${p.section.name || 'Section'} — ${p.status}` }),
          el('div', { class: 'lt-prodmeta', text: line })),
        chip(p.status, p.status === 'Declining' ? 'bad' : 'warn'),
        diseased ? el('button', {
          class: 'lt-mini',
          text: `Treat — ${formatMoney(treatCost)}`,
          disabled: cashOf() < treatCost ? 'disabled' : undefined,
          title: 'Fungicide, applied by the crew. Charged to chemicals.',
          onclick: () => askConfirm(`Send the crew over with fungicide for ${formatMoney(treatCost)}?`, 'Treat it', () => {
            const res = treatSection(st, p.section);
            toast(res && res.ok === false ? (res.reason || 'Could not treat it.') : 'The crew is on it — protection holds about 12 days.', res && res.ok === false ? 'warn' : '');
          }),
        }) : el('button', {
          class: 'lt-mini',
          text: `Aerate — ${formatMoney(aerateCost)}`,
          disabled: cashOf() < aerateCost ? 'disabled' : undefined,
          title: 'Relieves compaction and wear. Charged to upkeep.',
          onclick: () => askConfirm(`Aerate ${p.section.name || 'this section'} for ${formatMoney(aerateCost)}?`, 'Aerate it', () => {
            const res = aerateSection(st, p.section);
            toast(res && res.ok === false ? (res.reason || 'Could not aerate it.') : 'Cores pulled — the turf breathes again.', res && res.ok === false ? 'warn' : '');
          }),
        }));
    };

    const tractorFixed = st.tractor && st.tractor.repaired;
    const tractorMissing = st.tractor ? TRACTOR_STEPS.filter((s) => !st.tractor.steps[s]) : [];

    paint(
      head('Maintenance', 'The crew works one dawn pass a day, greens first, until its hours run out. Policies are standing orders; the report below is what actually got done this morning.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Crew hours' }), el('div', { class: 'lt-statvalue', text: crewHours.toFixed(1) }), el('div', { class: 'lt-statsub', text: `you + ${gks.length} groundskeeper${gks.length === 1 ? '' : 's'}` })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'This morning' }), el('div', { class: `lt-statvalue ${report && report.skipped && report.skipped.length ? 'warn' : 'ok'}`, text: report ? `${(report.done || []).length} done` : '—' }), el('div', { class: 'lt-statsub', text: report && report.skipped ? `${report.skipped.length} skipped` : 'no report yet' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Morning cost' }), el('div', { class: 'lt-statvalue', text: report ? formatMoney((report.costs?.wages || 0) + (report.costs?.water || 0) + (report.costs?.fertilizer || 0)) : '—' }), el('div', { class: 'lt-statsub', text: 'wages + water + feed' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Problem spots' }), el('div', { class: `lt-statvalue ${problems.length ? 'warn' : 'ok'}`, text: String(problems.length) }), el('div', { class: 'lt-statsub', text: rakes ? `+${rakes} bunker${rakes === 1 ? '' : 's'} to rake` : 'bunkers raked' })),
      ),

      report && report.skipped && report.skipped.length
        ? errBox(`The crew ran out of hours this morning: ${report.skipped.map((s) => `${s.zone} ${s.task}`).join(', ')} went undone. Hire groundskeepers or ask for less.`)
        : null,

      sect('Standing orders — the crew follows these at dawn'),
      ...Object.keys(ZONE_RANGE).map(policyRow),

      sect(`Needs attention (${problems.length})`),
      problems.length
        ? el('div', { class: 'lt-orderlist' }, ...problems.map(problemRow))
        : empty('The turf model reports nothing suffering right now.'),
      rakes ? errBox(`${rakes} bunker${rakes === 1 ? ' needs' : 's need'} raking. That is rake-in-hand work out on the sand — nobody does it from a desk.`) : null,

      sect('Equipment'),
      card(
        row(el('span', { class: 'lt-mulabel', text: 'Tractor' }),
          tractorFixed ? chip('running', 'ok') : chip('broken down', 'bad'),
          meta(tractorFixed ? 'parked by the shed' : `still needs: ${tractorMissing.map((s) => STEP_LABEL[s]).join(', ')} — hands-on work at the machine`)),
        ...Object.entries(UPGRADES).filter(([, u]) => u.cat === 'turf').map(([id, u]) => row(
          el('span', { class: 'lt-mulabel', text: u.name }),
          hasUpgrade(st, id) ? chip('owned', 'ok') : chip('not owned'),
          meta(u.blurb),
          !hasUpgrade(st, id) ? el('button', { class: 'lt-mini', text: 'View in Upgrades', onclick: () => go('upgrades') }) : null,
        )),
      ),
      note('Mowing and watering happen through the crew at dawn — the laptop sets policy and buys treatments; it does not teleport a mower.'),
    );
  }

  // =========================================================================================
  // 20. MARKETING — reputation and demand, told straight
  // =========================================================================================
  function pageMarketing() {
    const st = app.state;
    const ratings = clubRatings(st);
    const rs = reviewSummary(st, { waitedSec: 0, queueLen: 0, played: true });
    const counts = memberCounts(st);
    const fair = fairGreenFee(ratings.overall, st.club.amenities ? Object.values(st.club.amenities).reduce((a, v) => a + v, 0) : 0);
    const why = explainVisitors(st, {
      today: st.club.lastRounds || 0,
      yesterday: st.club.prevRounds || 0,
      rainedToday: st.weather.today.rainIn > 0.1,
    });
    const feed = (st.club.feed || []).slice(0, 8);

    paint(
      head('Marketing', 'This club\'s marketing is word of mouth: reputation, reviews and fair prices decide who shows up tomorrow. Every number here is the demand model itself.'),
      confirmBar(),
      errBox('Paid advertising campaigns are not part of this world yet — no flyers, no radio spots. If a campaign button existed it would be decoration, so it does not exist.'),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Reputation' }), el('div', { class: 'lt-statvalue gold', text: String(Math.round(st.club.reputation)) }), el('div', { class: 'lt-statsub', text: 'word of mouth' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Rating' }), el('div', { class: 'lt-statvalue', text: rs.count ? `${rs.average} ★` : '—' }), el('div', { class: 'lt-statsub', text: rs.count ? `${rs.count} reviews` : 'no reviews yet' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Rounds' }), el('div', { class: 'lt-statvalue', text: String(st.club.lastRounds || 0) }), el('div', { class: 'lt-statsub', text: `${st.club.prevRounds || 0} the day before` })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Members' }), el('div', { class: 'lt-statvalue', text: String(counts.weekday + counts.full + counts.premium) }), el('div', { class: 'lt-statsub', text: 'paying dues' })),
      ),
      why ? el('div', {}, sect('Why the gate moved'), card(el('div', { class: 'lt-why', text: why }))) : null,
      sect('What drives tomorrow'),
      card(
        row(el('span', { class: 'lt-mulabel', text: 'Green fee' }), meta(`${formatMoney(st.club.greenFee)} vs ≈${formatMoney(fair)} fair`),
          chip(st.club.greenFee > fair * 1.25 ? 'pricing people out' : st.club.greenFee < fair * 0.8 ? 'cheap — busy but poor' : 'fair', st.club.greenFee > fair * 1.25 ? 'bad' : 'ok'),
          el('button', { class: 'lt-mini', text: 'Pricing', onclick: () => go('pricing') })),
        row(el('span', { class: 'lt-mulabel', text: 'Course' }), meta(`condition ${Math.round(ratings.condition)}, design ${Math.round(ratings.design)}`),
          el('button', { class: 'lt-mini', text: 'Maintenance', onclick: () => go('maintenance') })),
        row(el('span', { class: 'lt-mulabel', text: 'Reviews' }), meta(rs.worst ? `weakest factor: ${rs.worst.label.toLowerCase()}` : 'nothing on file'),
          el('button', { class: 'lt-mini', text: 'Reviews', onclick: () => go('reviews') })),
        row(el('span', { class: 'lt-mulabel', text: 'Events' }), meta('tournaments and outings put the club\'s name around'),
          el('button', { class: 'lt-mini', text: 'Events', onclick: () => go('events') })),
      ),
      feed.length
        ? el('div', {}, sect('Around the club'), card(...feed.map((f) => row(
          el('span', { text: f.kind === 'join' ? '🟢' : f.kind === 'quit' ? '🔴' : f.kind === 'offer' ? '📨' : f.kind === 'outing' ? '🏢' : '💬' }),
          el('span', { text: f.text }), meta(`day ${(f.day ?? 0) + 1}`)))))
        : null,
    );
  }

  // =========================================================================================
  // 21. UPGRADES — business improvements + amenities (progression.js + club.js, real purchases)
  // =========================================================================================
  function pageUpgrades() {
    const st = app.state;
    const prestige = st.progression ? st.progression.prestige : 0;

    const upgradeRow = ([id, u]) => {
      const owned = hasUpgrade(st, id);
      const locked = prestige < u.prestige;
      const affordable = cashOf() >= u.cost;
      return el('div', { class: 'lt-order' },
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: u.name }),
          el('div', { class: 'lt-prodmeta', text: u.blurb }),
          el('div', { class: 'lt-prodmeta', text: `needs prestige ${u.prestige} · ${formatMoney(u.cost)}` })),
        owned ? chip('owned', 'ok')
          : locked ? chip(`prestige ${u.prestige}`, '')
            : el('button', {
              class: 'lt-primary', text: `Buy — ${formatMoney(u.cost)}`,
              disabled: affordable ? undefined : 'disabled',
              title: affordable ? undefined : 'Not enough cash',
              onclick: () => askConfirm(`Buy ${u.name} for ${formatMoney(u.cost)}? It bills to course works, once.`, 'Buy it', () => {
                const res = purchaseUpgrade(st, id);
                toast(res.ok ? `${u.name} — done. It starts working tomorrow morning.` : res.reason, res.ok ? '' : 'warn');
              }),
            }));
    };

    const amenityRow = (key) => {
      const spec = AMENITIES[key];
      const level = st.club.amenities[key] || 0;
      const maxed = level >= spec.maxLevel;
      const cost = maxed ? 0 : spec.cost[level];
      return el('div', { class: 'lt-order' },
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: `${spec.name} — level ${level}/${spec.maxLevel}` }),
          el('div', { class: 'lt-prodmeta', text: `upkeep ${formatMoney(spec.upkeepPerLevel)}/day per level${maxed ? '' : ` · next level ${formatMoney(cost)}`}` })),
        maxed ? chip('at its best', 'gold')
          : el('button', {
            class: 'lt-primary', text: `Upgrade — ${formatMoney(cost)}`,
            disabled: cashOf() < cost ? 'disabled' : undefined,
            onclick: () => askConfirm(`Take the ${spec.name.toLowerCase()} to level ${level + 1} for ${formatMoney(cost)}? Daily upkeep rises with it.`, 'Build it', () => {
              const res = upgradeAmenity(st, key);
              toast(res.ok ? `${spec.name} is now level ${level + 1}.` : res.reason, res.ok ? '' : 'warn');
            }),
          }));
    };

    paint(
      head('Upgrades', 'Everything here is a one-time purchase with a lasting effect the sim actually applies — mower hours, water costs, revenue lines, supplier tiers. Prestige gates what the golf world will sell you.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Prestige' }), el('div', { class: 'lt-statvalue gold', text: String(Math.round(prestige)) }), el('div', { class: 'lt-statsub', text: 'the golf world\'s opinion' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Owned' }), el('div', { class: 'lt-statvalue', text: String(Object.keys(st.progression?.unlocks || {}).length) }), el('div', { class: 'lt-statsub', text: `of ${Object.keys(UPGRADES).length} improvements` })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Cash' }), el('div', { class: 'lt-statvalue', text: formatMoney(cashOf()) }), el('div', { class: 'lt-statsub', text: 'available' })),
      ),
      sect('Course & business improvements'),
      el('div', { class: 'lt-orderlist' }, ...Object.entries(UPGRADES).map(upgradeRow)),
      sect('Amenities'),
      el('div', { class: 'lt-orderlist' }, ...Object.keys(AMENITIES).map(amenityRow)),
      note('The shop\'s own fixtures and decor are ordered on the Renovation page and placed by hand in the room.'),
    );
  }

  // =========================================================================================
  // 22. EVENTS — tournaments (progression.js) and corporate outings (club.js)
  // =========================================================================================
  function pageEvents() {
    const st = app.state;
    const cal = calendarOf(st.clock.minutes);
    const ev = st.progression ? st.progression.event : null;
    const hostReady = hasUpgrade(st, 'tournamentHost');
    const offers = st.club.outings ? st.club.outings.offers : [];
    const scheduled = st.club.outings ? st.club.outings.scheduled : [];
    const past = st.progression ? (st.progression.history || []) : [];

    const tournamentRow = (tier) => {
      const spec = TOURNAMENTS[tier];
      const gate = canScheduleTournament(st, tier);
      const hosted = st.progression.hosted?.[tier] || 0;
      return el('div', { class: 'lt-order' },
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: spec.name }),
          el('div', { class: 'lt-prodmeta', text: `stage ${formatMoney(spec.cost)} · entries ${formatMoney(spec.entryRevenue)} · needs condition ${spec.conditionReq}+ and 9 open holes on the day` }),
          el('div', { class: 'lt-prodmeta', text: `prestige ${spec.prestigeReq}+ · win +${spec.prestigeWin} prestige / flop ${spec.prestigeLose}` })),
        hosted ? chip(`hosted ×${hosted}`, 'gold') : null,
        gate.ok
          ? el('button', {
            class: 'lt-primary', text: `Schedule — ${formatMoney(spec.cost)}`,
            onclick: () => askConfirm(`Stage the ${spec.name}? ${formatMoney(spec.cost)} now, the field arrives in ${spec.leadDays} days — the course must be ready.`, 'Put it on the calendar', () => {
              const res = scheduleTournament(st, tier);
              toast(res.ok ? `${spec.name} — day ${res.day + 1}. Get the course ready.` : res.reason, res.ok ? '' : 'warn');
            }),
          })
          : chip(gate.reason, ''));
    };

    const offerRow = (o) => el('div', { class: 'lt-order' },
      el('div', { class: 'lt-orderbody' },
        el('div', { class: 'lt-ordername', text: `${o.company} — ${o.size} players` }),
        el('div', { class: 'lt-prodmeta', text: `pays ${formatMoney(o.payout)} · plays day ${o.day + 1} · offer expires day ${o.expiresDay + 1}` }),
        el('div', { class: 'lt-prodmeta', text: 'members lose a little patience when a company takes the course' })),
      el('button', {
        class: 'lt-primary', text: 'Accept',
        onclick: () => askConfirm(`Book ${o.company}'s ${o.size}-player outing for ${formatMoney(o.payout)}?`, 'Book it', () => {
          const res = acceptOuting(st, o.id);
          toast(res.ok ? `${o.company} is booked.` : res.reason, res.ok ? '' : 'warn');
        }),
      }),
      el('button', {
        class: 'lt-mini lt-cancel', text: 'Decline',
        onclick: () => askConfirm(`Turn down ${o.company}? The offer does not come back.`, 'Decline it', () => {
          declineOuting(st, o.id);
          toast(`${o.company} will take their outing elsewhere.`);
        }),
      }));

    paint(
      head('Events', 'Tournaments and corporate outings are the club\'s two real events: both move money, prestige and the members\' mood. Nothing here is scheduled for show.'),
      confirmBar(),
      ev
        ? card(el('div', { class: 'lt-minihead', text: `🏆  ${TOURNAMENTS[ev.tier]?.name || 'Tournament'} — day ${ev.day + 1} (${ev.day - cal.dayAbs === 0 ? 'today' : `in ${ev.day - cal.dayAbs} day${ev.day - cal.dayAbs === 1 ? '' : 's'}`})` }),
          row(meta(`The field needs condition ${TOURNAMENTS[ev.tier]?.conditionReq}+ and at least 9 open holes on the day. Current condition: ${Math.round(clubRatings(st).condition)}.`)),
          row(el('button', { class: 'lt-mini', text: 'Open maintenance', onclick: () => go('maintenance') })))
        : null,
      !hostReady
        ? errBox('Staging tournaments needs the Tournament operations upgrade — the timing crew, scoreboards and marshals. Find it on the Upgrades page.')
        : null,
      sect('Tournaments'),
      el('div', { class: 'lt-orderlist' }, ...Object.keys(TOURNAMENTS).map(tournamentRow)),
      sect(`Corporate outing offers (${offers.length})`),
      offers.length
        ? el('div', { class: 'lt-orderlist' }, ...offers.map(offerRow))
        : empty('No offers on the desk. Companies call when the club\'s reputation carries.'),
      scheduled.length
        ? el('div', {}, sect('Booked outings'), card(...scheduled.map((o) => row(
          el('span', { text: `🏢 ${o.company} — ${o.size} players` }),
          meta(`day ${o.day + 1}`), chip(formatMoney(o.payout), 'gold')))))
        : null,
      past.length
        ? el('div', {}, sect('Past events'), card(...past.slice(0, 6).map((h) => row(
          el('span', { text: h.success ? '✅' : '❌' }),
          el('span', { text: h.note }), meta(`day ${h.day + 1}`)))))
        : null,
    );
  }

  // =========================================================================================
  // 23. NOTIFICATIONS — the club's inbox; every entry is something the sim actually did
  // =========================================================================================
  function pageNotifications() {
    const st = app.state;
    const ns = ts('notifications', { filter: 'all' });
    const rerender = () => { click(); render(); };
    const feed = ensureNotifications(st);
    const unread = unreadCount(st);
    const kinds = [...new Set(feed.items.map((i) => i.kind))];

    const shown = feed.items.filter((i) => ns.filter === 'all' || i.kind === ns.filter
      || (ns.filter === 'unread' && !i.read));

    const itemRow = (i) => {
      const c = calendarOf(i.minute);
      const spec = NOTIF_KINDS[i.kind] || NOTIF_KINDS.system;
      return el('div', { class: `lt-order ${i.read ? '' : 'unread'}` },
        el('span', { style: 'font-size:1.1em', text: spec.icon }),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: i.text }),
          el('div', { class: 'lt-prodmeta', text: `${c.seasonName} ${c.dayOfSeason}, Y${c.year} · ${clock12(c.minuteOfDay)}` })),
        !i.read ? chip('new', 'gold') : null,
        i.page ? el('button', {
          class: 'lt-mini', text: 'Open',
          onclick: () => { markRead(st, i.id); go(i.page); },
        }) : null,
        !i.read ? el('button', { class: 'lt-mini', text: 'Mark read', onclick: () => { markRead(st, i.id); rerender(); } }) : null,
        el('button', { class: 'lt-mini lt-cancel', text: '✕', title: 'Dismiss', onclick: () => { dismissNotification(st, i.id); rerender(); } }));
    };

    paint(
      head('Notifications', 'Deliveries that landed, reviews that posted, bills that bounced — the feed is written by the sim at the moment things happen, and it survives a reload.',
        unread ? primaryBtn(`Mark all ${unread} read`, () => { markAllRead(st); click(); render(); }) : null),
      confirmBar(),
      el('div', { class: 'lt-tabs' },
        el('button', { class: `lt-tab ${ns.filter === 'all' ? 'on' : ''}`, text: `All (${feed.items.length})`, onclick: () => { ns.filter = 'all'; rerender(); } }),
        el('button', { class: `lt-tab ${ns.filter === 'unread' ? 'on' : ''}`, text: `Unread (${unread})`, onclick: () => { ns.filter = 'unread'; rerender(); } }),
        ...kinds.map((k) => el('button', {
          class: `lt-tab ${ns.filter === k ? 'on' : ''}`,
          text: `${(NOTIF_KINDS[k] || {}).icon || ''} ${k}`,
          onclick: () => { ns.filter = k; rerender(); },
        }))),
      shown.length
        ? el('div', { class: 'lt-orderlist' }, ...shown.map(itemRow))
        : empty(feed.items.length ? 'Nothing under that filter.' : 'Quiet. The feed fills in as the club lives — deliveries, reviews, bills, events.'),
    );
  }

  // =========================================================================================
  // 24. HELP — the arc so far, and what each desk is for
  // =========================================================================================
  function pageHelp() {
    const st = app.state;
    const step = st.tutorial && !st.tutorial.complete ? currentStep(st) : null;
    const stepIdx = st.tutorial ? st.tutorial.step : 0;
    const chapters = [];
    TUTORIAL_STEPS.forEach((s, i) => {
      if (!chapters.length || chapters[chapters.length - 1].name !== s.chapter) {
        chapters.push({ name: s.chapter, steps: [] });
      }
      chapters[chapters.length - 1].steps.push({ ...s, index: i });
    });

    const MANUAL = [
      ['Dashboard', 'the morning read: money, tee sheet, condition, what needs you'],
      ['Tee Times', 'book, cancel and review reservations; check-in happens at the front desk'],
      ['Pro Shop → Deliveries', 'order stock, watch the van, carry boxes in, price the shelves'],
      ['Finances', 'the ledger every dollar routes through — it always reconciles'],
      ['Maintenance & Course', 'standing orders for the crew, problem turf, the works desk for surgery'],
      ['Upgrades & Events', 'lasting improvements, tournaments and corporate outings'],
      ['Employees', 'hire the floor pro and the crew; they work while you golf-manage'],
    ];

    paint(
      head('Help', 'The arc below is the game\'s own tutorial state — it advances as you actually do things, not as you read about them.'),
      step ? el('div', { class: 'lt-card lt-objective' },
        el('div', { class: 'lt-objlabel', text: 'You are here' }),
        el('div', { class: 'lt-objtitle', text: step.title }),
        el('div', { class: 'lt-objbody', text: step.hint || '' }),
      ) : card(el('div', { class: 'lt-minihead', text: '🎓 Tutorial complete' }), row(meta('The club is yours. Everything below is reference.'))),
      sect('The arc'),
      card(...chapters.map((ch) => el('div', { style: 'margin-bottom:6px' },
        el('div', { class: 'lt-minihead', text: ch.name }),
        ...ch.steps.map((s) => row(
          el('span', { text: st.tutorial && (st.tutorial.complete || s.index < stepIdx) ? '✅' : s.index === stepIdx ? '➤' : '·' }),
          el('span', { style: s.index === stepIdx ? 'font-weight:600' : '', text: s.title }))),
      ))),
      sect('What each desk is for'),
      card(...MANUAL.map(([name, blurb]) => row(el('span', { class: 'lt-mulabel', style: 'width:170px', text: name }), meta(blurb)))),
      note('Esc closes the laptop. E opens it from the office chair. The register, the boxes and the mowing stay out in the world — this machine only manages.'),
    );
  }

  // --- shell --------------------------------------------------------------------------------

  const PAGES = {
    home: pageHome,
    shop: pageShop,
    supplier: pageSupplier,
    orders: pageOrders,
    deliveries: pageDeliveries,
    inventory: pageInventory,
    pricing: pagePricing,
    reservations: pageReservations,
    course: pageCourse,
    rentals: pageRentals,
    employees: pageEmployees,
    finances: pageFinances,
    reviews: pageReviews,
    analytics: pageAnalytics,
    reno: pageReno,
    settings: pageSettings,
    customers: pageCustomers,
    memberships: pageMemberships,
    maintenance: pageMaintenance,
    marketing: pageMarketing,
    upgrades: pageUpgrades,
    events: pageEvents,
    notifications: pageNotifications,
    help: pageHelp,
  };

  function setScale(s) {
    scale = s;
    frame.style.setProperty('--lt-scale', String(s));
  }

  function render() {
    if (root.style.display === 'none' || !app.state) return;
    refreshStatus();
    for (const [id, b] of Object.entries(navBtns)) b.classList.toggle('on', id === page);
    const fn = PAGES[page];
    if (!fn) {
      // an ERROR STATE that cannot itself throw: the shell survives a bad page id
      paint(head('Not found'), errBox(`There is no application called "${page}".`),
        el('button', { class: 'lt-primary', text: 'Back to Home', onclick: () => go('home') }));
      return;
    }
    try {
      fn();
    } catch (e) {
      paint(
        head('Something went wrong'),
        errBox(`The ${page} page could not be drawn: ${e && e.message ? e.message : e}`),
        el('button', { class: 'lt-primary', text: 'Back to Home', onclick: () => go('home') }));
    }
  }

  let liveTimer = null;

  return {
    root,
    open(startPage) {
      page = startPage || 'home';
      history = [];
      cart = new Map();
      pending = null;
      // saved office preferences: scale, default windows/views
      const prefs = app.state && app.state.uiPrefs;
      if (prefs) {
        if (Number.isFinite(prefs.laptopScale)) scale = prefs.laptopScale;
        if (prefs.financeWindow) financeWindow = prefs.financeWindow;
        if (prefs.teeView) ts('reservations').view = prefs.teeView;
      }
      setScale(scale);
      root.style.display = '';
      render();
      clearInterval(liveTimer);
      liveTimer = setInterval(refreshStatus, 1000); // the clock keeps ticking on the screen
    },
    close() {
      root.style.display = 'none';
      clearInterval(liveTimer);
      liveTimer = null;
      pending = null;
    },
    // main.js maps this rectangle onto the physical display's four projected corners
    setTransform(matrix3d) {
      frame.style.transform = matrix3d;
    },
    isOpen: () => root.style.display !== 'none',
    pageId: () => page,
    go,
    back,
    setScale,
    render,
  };
}

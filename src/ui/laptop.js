// GOLF SIMULATOR — the clubhouse laptop, in its final skin (LaptopUIFinal).
//
// This is diegetic software. It renders into `.laptop-screen`, which main.js maps corner-to-
// corner onto the laptop's physical display every frame — the interface IS the screen. Nothing
// here knows about 3D; it just has to be a good 1024x640 application.
//
// SEVEN PAGES, NO MORE. Home answers "what now?" on one screen; Tee Times is an appointment
// list; Shop folds stock, ordering, pricing and deliveries into four tabs; Course folds
// condition, tasks and holes into three; Upgrades is where money becomes lasting improvement;
// Finances is a money history a player can trust; Settings is small. The look is the approved
// reference set: white sidebar, soft gray canvas, white cards, one calm blue, colored words
// for status — a polished simulator screen, never accounting software.
//
// THE ONE RULE SURVIVES EVERY RESKIN: every number on these pages is read live from the sim.
// Where the sim does not model something, the page says so in place rather than showing a
// plausible number. And the laptop only MANAGES — boxes are carried, shelves are stocked,
// change is counted and greens are mowed out in the world, by hands.

import { el, toast } from './ui.js';
import { formatMoney } from '../core/utils.js';
import { calendarOf } from '../sim/time.js';
import {
  SHOP_CATALOG, skuById, LEAD_DAYS, SHELF_CAP, RETAIL_CATS,
} from '../data/shopItems.js';
import {
  placeOrder, cancelOrder, orderCost, priceFor, velocity, buyRentalSets,
} from '../sim/shop.js';
import {
  boxesOf, shipmentsOf, shipmentStatus, padCount, PAD_CAPACITY,
} from '../sim/deliveries.js';
import { planShipment, unitsPerBox } from '../data/boxes.js';
import {
  TEE_SHEET, daySheet, bookSlot, cancelReservation, fmtSlot, slotAvailability,
  markReservationNoShow,
} from '../sim/reservations.js';
import {
  createCustomerIdentity, customerIdentityById, ensureCustomerDirectory, identityForReservation,
} from '../sim/customerIdentity.js';
import { reviewSummary } from '../sim/reviews.js';
import { arrearsOf } from '../sim/property.js';
import {
  ROLE, hireStaff, fireStaff, trainStaff, staffDailyWages, refreshMarketIfDue, groundsCrewHours,
} from '../sim/staff.js';
import {
  sectionTurfSummary, sectionStatus, diagnoseSection, treatSection, aerateSection,
} from '../sim/turf.js';
import { TRACTOR_STEPS, STEP_LABEL } from '../sim/tractor.js';
import { clubRatings, fairGreenFee, AMENITIES, upgradeAmenity, acceptOuting, declineOuting } from '../sim/club.js';
import {
  UPGRADES, TOURNAMENTS, hasUpgrade, purchaseUpgrade, canScheduleTournament, scheduleTournament,
} from '../sim/progression.js';
import {
  NOTIF_KINDS, ensureNotifications, unreadCount, markRead, markAllRead,
} from '../sim/notifications.js';
import { currentStep } from '../sim/tutorial.js';
import {
  checkoutPreferences, setCheckoutPreference,
} from '../sim/checkoutPreferences.js';
import { holePar, holeDistanceYd } from '../sim/course.js';
import { capacityOf } from '../data/fixtureSlots.js';
import { ZONE, HOLE_STATUS } from '../sim/constants.js';
import {
  SERIES, svgEl, lineChart, applyTableQuery, searchBox, filterTabs,
} from './laptopWidgets.js';
import {
  CONSTRUCTION_CATEGORY_BY_ID, CONSTRUCTION_FINISH_CATEGORIES,
  CONSTRUCTION_QUALITY_BY_ID, CONSTRUCTION_QUALITY_LEVELS, constructionFinishVariant,
} from '../data/constructionFinishes.js';
import {
  ensureConstructionFinishes, installedConstructionFinish,
  ownsConstructionFinish, purchaseConstructionFinish,
} from '../sim/constructionFinishes.js';

const CAT_LABEL = {
  clubs: 'Clubs', balls: 'Golf balls', apparel: 'Apparel', accessories: 'Accessories',
  provisions: 'Drinks & snacks', supplies: 'Shop supplies', decor: 'Decor & fixtures',
};
const CAT_ICON = {
  clubs: '🏌', balls: '🥎', apparel: '👕', accessories: '🧢', provisions: '🥤', supplies: '🧹', decor: '🪴',
};
const ROLE_LABEL = {
  groundskeeper: 'Groundskeeper', instructor: 'Teaching pro', fnb: 'Grill room', proshop: 'Pro shop',
};
const SHOP_OPEN_MIN = 6 * 60;
const SHOP_CLOSE_MIN = 20 * 60;

// Order/shipment statuses — six worn on the road (sim/deliveries ORDER_FLOW), three by a
// shipment standing on the floor (shipmentStatus). Every label has machinery behind it.
const ORDER_STATUS = {
  received: { label: 'Ordered', tone: '' },
  processing: { label: 'Processing', tone: '' },
  packed: { label: 'Packed', tone: '' },
  shipped: { label: 'On the way', tone: '' },
  out: { label: 'Out for delivery', tone: 'warn' },
  arriving: { label: 'Arriving soon', tone: 'warn' },
  delivered: { label: 'Outside', tone: 'ok' },
  partial: { label: 'Half unpacked', tone: 'warn' },
  unpacked: { label: 'Unpacked', tone: 'ok' },
};

// --- the line-icon set — inline SVG, stroke follows the text color ---------------------------
// Each glyph is a few strokes on a 24-box; ['c', cx, cy, r] draws a circle.
const ICONS = {
  logo: [['p', 'M8 20.5V3.5l8.5 2.6L8 8.9'], ['c', 15.7, 18.6, 2.5], ['p', 'M3.5 20.5h8.7']],
  home: [['p', 'M3.5 10.4 12 3.2l8.5 7.2'], ['p', 'M5.6 8.9V20.5h12.8V8.9'], ['p', 'M9.9 20.5v-5.7h4.2v5.7']],
  calendar: [['p', 'M5 5.6h14a1.4 1.4 0 0 1 1.4 1.4v12A1.4 1.4 0 0 1 19 20.4H5A1.4 1.4 0 0 1 3.6 19V7A1.4 1.4 0 0 1 5 5.6z'], ['p', 'M3.6 9.6h16.8'], ['p', 'M8.2 3.4v4'], ['p', 'M15.8 3.4v4']],
  bag: [['p', 'M6.3 7.6h11.4l1.2 12.9H5.1L6.3 7.6z'], ['p', 'M9.1 10.1V6.4a2.9 2.9 0 0 1 5.8 0v3.7']],
  flag: [['p', 'M6.6 20.8V4'], ['p', 'M6.6 4.6l9.6 2.9-9.6 3'], ['p', 'M3.8 20.8h5.6']],
  up: [['p', 'M5 20.6h14'], ['p', 'M12 16.6V5.4'], ['p', 'M7.2 9.9 12 5.2l4.8 4.7']],
  dollar: [['p', 'M4.4 6.9h15.2a1.3 1.3 0 0 1 1.3 1.3v7.6a1.3 1.3 0 0 1-1.3 1.3H4.4a1.3 1.3 0 0 1-1.3-1.3V8.2a1.3 1.3 0 0 1 1.3-1.3z'], ['c', 12, 12, 2.6], ['p', 'M6.5 12h.01'], ['p', 'M17.5 12h.01']],
  gear: [['c', 12, 12, 3.1], ['p', 'M12 2.6v2.8'], ['p', 'M12 18.6v2.8'], ['p', 'M2.6 12h2.8'], ['p', 'M18.6 12h2.8'], ['p', 'M5.2 5.2l2 2'], ['p', 'M16.8 16.8l2 2'], ['p', 'M18.8 5.2l-2 2'], ['p', 'M7.2 16.8l-2 2']],
  bell: [['p', 'M17.8 8.8a5.8 5.8 0 1 0-11.6 0c0 6.2-2.4 7.2-2.4 7.2h16.4s-2.4-1-2.4-7.2'], ['p', 'M10.4 19.4a1.85 1.85 0 0 0 3.2 0']],
  power: [['p', 'M12 3.2v7.6'], ['p', 'M17.5 6.4a7.7 7.7 0 1 1-11 0']],
  target: [['c', 12, 12, 8.4], ['c', 12, 12, 4.6], ['c', 12, 12, 1.1]],
  clock: [['c', 12, 12, 8.5], ['p', 'M12 7.4V12l3.1 2']],
  users: [['c', 9, 8.4, 3.2], ['p', 'M3.4 19.6c0-3.1 2.5-5.1 5.6-5.1s5.6 2 5.6 5.1'], ['c', 16.6, 9.4, 2.5], ['p', 'M16.2 14.6c2.6.3 4.4 2.1 4.4 5']],
  box: [['p', 'M12 3 3.9 7.5v9L12 21l8.1-4.5v-9L12 3z'], ['p', 'M3.9 7.5 12 12l8.1-4.5'], ['p', 'M12 12v9']],
  leaf: [['p', 'M5.4 18.9C5.4 11 10.5 6 19 5c-1 8.5-6 13.6-13.6 13.9z'], ['p', 'M5.4 18.9C8.2 14 11.6 11 15.6 9']],
  back: [['p', 'M14.4 5.6 8 12l6.4 6.4']],
};
function icon(name, cls = 'lt-ic') {
  const parts = ICONS[name] || ICONS.target;
  return svgEl('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    ...parts.map((p) => (p[0] === 'c'
      ? svgEl('circle', { cx: p[1], cy: p[2], r: p[3] })
      : svgEl('path', { d: p[1] }))));
}

// --- the overhead course painting — the real splat, softened into an aerial ------------------
// Colors tuned for the light interface; the OUT scrub doubles as the frame around play.
const LAND = {
  [ZONE.OUT]: '#42502f',
  [ZONE.ROUGH]: '#5b7f42',
  [ZONE.FAIRWAY]: '#79b154',
  [ZONE.GREEN]: '#95d377',
  [ZONE.TEE]: '#88c166',
  [ZONE.BUNKER]: '#e3d3a3',
  [ZONE.WATER]: '#4f8ec2',
  [ZONE.PATH]: '#b9b09b',
  [ZONE.FRINGE]: '#86c465',
  [ZONE.HEAVY]: '#4e6a37',
  [ZONE.DIRT]: '#8f7a5b',
  [ZONE.BED]: '#6d5943',
  [ZONE.SEMI]: '#6a9d4b',
};
const LAND_RGB = Object.fromEntries(Object.entries(LAND).map(([z, hex]) => [z, [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
]]));

/**
 * Paint the property (or a window of it) into a canvas: one pixel per cell, then scaled up
 * with smoothing so the splat reads as an aerial photograph rather than a tile grid.
 * win: {x0, y0, w, h} cell window; marks: [{x, y, kind:'number'|'tee'|'pin', n}] in cell coords.
 */
function paintCourse(cnv, st, { win = null, marks = [] } = {}) {
  if (!cnv.getContext) return; // headless tests draw nothing
  const c = st.course;
  const ctx = cnv.getContext('2d');
  const W = cnv.width;
  const H = cnv.height;
  ctx.fillStyle = LAND[ZONE.OUT];
  ctx.fillRect(0, 0, W, H);
  const x0 = win ? win.x0 : 0;
  const y0 = win ? win.y0 : 0;
  const cw = Math.max(1, win ? win.w : c.w);
  const chh = Math.max(1, win ? win.h : c.h);
  const off = document.createElement('canvas');
  if (!off.getContext) return;
  off.width = cw;
  off.height = chh;
  const octx = off.getContext('2d');
  const img = octx.createImageData(cw, chh);
  for (let y = 0; y < chh; y++) {
    for (let x = 0; x < cw; x++) {
      const zx = x0 + x;
      const zy = y0 + y;
      const inb = zx >= 0 && zy >= 0 && zx < c.w && zy < c.h;
      const rgb = LAND_RGB[inb ? c.zones[zy * c.w + zx] : ZONE.OUT] || LAND_RGB[ZONE.OUT];
      const i = (y * cw + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const s = Math.min(W / cw, H / chh);
  const ox = (W - cw * s) / 2;
  const oy = (H - chh * s) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, ox, oy, cw * s, chh * s);
  for (const m of marks) {
    const px = ox + (m.x + 0.5 - x0) * s;
    const py = oy + (m.y + 0.5 - y0) * s;
    if (px < 6 || py < 6 || px > W - 6 || py > H - 6) continue;
    if (m.kind === 'number') {
      const r = Math.max(13, Math.min(17, s * 1.15));
      ctx.beginPath();
      ctx.arc(px, py, r, 0, 7);
      ctx.fillStyle = 'rgba(16,24,40,0.28)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py - 1, r, 0, 7);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.fillStyle = '#1d2531';
      ctx.font = `700 ${Math.round(r * 1.05)}px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(m.n), px, py);
    } else {
      ctx.beginPath();
      ctx.arc(px, py, m.kind === 'pin' ? 4.5 : 3.5, 0, 7);
      ctx.fillStyle = m.kind === 'pin' ? '#ffd75e' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(16,24,40,0.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

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
// The money history must visibly reconcile: amounts show cents when they carry them.
const exactMoney = (v) => {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const whole = Math.abs(a - Math.round(a)) < 0.005;
  const body = whole ? Math.round(a).toLocaleString('en-US')
    : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < -0.005 ? '-$' : '$') + body;
};
// A condition number, said in words a player reads faster than a percentage.
const conditionWord = (h) => (h >= 70 ? 'Good' : h >= 45 ? 'Fair' : 'Poor');
const conditionTone = (h) => (h >= 70 ? 'ok' : h >= 45 ? 'warn' : 'bad');

// THE WHOLE SIDEBAR. Seven entries, no groups, no scroll.
const NAV = [
  { id: 'home', icon: 'home', label: 'Home' },
  { id: 'reservations', icon: 'calendar', label: 'Tee Times' },
  { id: 'shop', icon: 'bag', label: 'Shop' },
  { id: 'course', icon: 'flag', label: 'Course' },
  { id: 'upgrades', icon: 'up', label: 'Upgrades' },
  { id: 'finances', icon: 'dollar', label: 'Finances' },
  { id: 'settings', icon: 'gear', label: 'Settings' },
];

// Every retired desk forwards to the page (and tab) that absorbed its job, so old links —
// notification targets, saved prefs, muscle memory — keep landing somewhere sensible.
const PAGE_ALIAS = {
  inventory: ['shop', 'stock'],
  supplier: ['shop', 'order'],
  pricing: ['shop', 'prices'],
  orders: ['shop', 'deliveries'],
  deliveries: ['shop', 'deliveries'],
  maintenance: ['course', 'tasks'],
  reno: ['course', 'tasks'],
  employees: ['upgrades', 'staff'],
  rentals: ['upgrades', 'equipment'],
  events: ['upgrades', 'course'],
  analytics: ['finances', null],
  reviews: ['home', null],
  marketing: ['home', null],
  customers: ['reservations', null],
  memberships: ['reservations', null],
  notifications: ['home', null],
  help: ['home', null],
};

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
  let cart = new Map();    // order basket: skuId -> qty
  let teeDay = 0;
  let teePartySize = 1;
  let scale = 1;
  let pending = null;      // the live confirmation, if one is open
  let modal = null;        // the open detail modal, if any — () => element

  // Per-page view state (search text, filter, active tab). Session-only, never serialized.
  const tstates = {};
  const ts = (id, defaults = {}) => (tstates[id] ||= { search: '', filter: 'all', page: 0, ...defaults });

  const content = el('div', { class: 'lt-content' });
  const navBtns = {};

  const prefsOf = () => (app.state ? (app.state.uiPrefs || (app.state.uiPrefs = {})) : {});

  function click() {
    if (prefsOf().uiSounds === false) return;
    if (app.audio && app.audio.ready) app.audio.uiTick();
  }

  function go(p, { replace = false } = {}) {
    // retired desks forward to the page that absorbed them, tab included
    if (PAGE_ALIAS[p]) {
      const [target, tab] = PAGE_ALIAS[p];
      if (tab) ts(target).tab = tab;
      p = target;
    }
    if (p === page) { render(); return; }
    if (!replace) history.push(page);
    if (history.length > 24) history.shift();
    page = p;
    pending = null;
    modal = null;
    click();
    content.scrollTop = 0;
    render();
  }
  function back() {
    if (!history.length) return go('home', { replace: true });
    page = history.pop();
    pending = null;
    modal = null;
    click();
    content.scrollTop = 0;
    render();
  }

  const nav = el('nav', { class: 'lt-nav lt-nav-simple' },
    el('div', { class: 'lt-brand' }, icon('logo'), el('span', { text: 'GOLF SIMULATOR' })),
    el('div', { class: 'lt-navlist' },
      ...NAV.map((n) => {
        const b = el('button', { class: 'lt-navbtn lt-navbtn-big', title: n.label, onclick: () => go(n.id) },
          el('span', { class: 'lt-navicon' }, icon(n.icon)), el('span', { text: n.label }));
        navBtns[n.id] = b;
        return b;
      })),
    el('button', { class: 'lt-navbtn lt-close', onclick: () => opts.close() },
      el('span', { class: 'lt-navicon' }, icon('power')), el('span', { text: 'Close Laptop' })),
  );

  const statusbar = el('div', { class: 'lt-status' });
  const frame = el('div', { class: 'lt-frame' }, nav, el('div', { class: 'lt-main' }, statusbar, content));
  const root = el('div', { class: 'laptop-screen', style: 'display:none' }, frame);
  root.addEventListener('click', (e) => e.stopPropagation());

  // --- building blocks ----------------------------------------------------------------------
  const paint = (...kids) => content.replaceChildren(...kids.filter((k) => k != null && k !== false));
  const sect = (t) => el('div', { class: 'lt-sect', text: t });
  const row = (...kids) => el('div', { class: 'lt-row' }, ...kids);
  const chip = (t, kind = '') => el('span', { class: `lt-chip ${kind}`, text: t });
  const word = (t, kind = '') => el('span', { class: `lt-word ${kind}`, text: t });
  const meta = (t) => el('span', { class: 'lt-meta', text: t });
  const card = (...kids) => el('div', { class: 'lt-card' }, ...kids);
  const note = (t) => el('div', { class: 'lt-card lt-note', text: t });
  const empty = (t) => el('div', { class: 'lt-empty' }, el('div', { class: 'lt-emptymark', text: '◌' }), el('div', { text: t }));
  const errBox = (t) => el('div', { class: 'lt-card lt-err' }, el('span', { text: '⚠ ' }), el('span', { text: t }));
  const stat = (label, value, sub, tone = '', extra = null) => el('div', { class: 'lt-stat' },
    el('div', { class: 'lt-statlabel', text: label }),
    el('div', { class: `lt-statvalue ${tone}`, text: value }),
    sub ? el('div', { class: `lt-statsub ${typeof sub === 'object' ? sub.tone || '' : ''}`, text: typeof sub === 'object' ? sub.text : sub }) : null,
    extra);

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

  // CONFIRMATION + CANCELLATION — an inline bar on the glass, never a detached browser modal.
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

  // A small detail modal INSIDE the laptop glass. One at a time; clicking the dimmed
  // surround or Close dismisses it. Escape still closes the whole laptop, as ever.
  function openModal(build) {
    modal = build;
    click();
    render();
  }
  function closeModal() {
    modal = null;
    click();
    render();
  }
  function modalLayer() {
    if (!modal) return null;
    const inner = modal();
    if (!inner) { modal = null; return null; }
    const overlay = el('div', { class: 'lt-modal' }, el('div', { class: 'lt-modalcard' }, inner));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    return overlay;
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
  // The screen packs a shipment the SAME WAY the receiving pad will — one packer, data/boxes.js.
  const shipOf = (sku, qty) => planShipment(sku, Math.max(1, qty));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 'es'}`;
  const shopIsOpen = (st) => {
    const m = calendarOf(st.clock.minutes).minuteOfDay;
    return m >= SHOP_OPEN_MIN && m < SHOP_CLOSE_MIN;
  };
  const sumLines = (lines) => Object.values(lines || {}).reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);

  // per-zone turf health, averaged over the cells that belong to each zone
  function zoneHealth(st, zone) {
    let n = 0;
    let health = 0;
    for (let i = 0; i < st.course.zones.length; i++) {
      if (st.course.zones[i] !== zone) continue;
      n++;
      health += st.turf.health[i];
    }
    return n ? health / n : null;
  }
  const rakeableBunkers = (st) => (st.sections || []).filter((s) => {
    if (s.zone !== ZONE.BUNKER) return false;
    let sum = 0;
    for (const i of s.cells) sum += st.turf.wear[i];
    return sum / s.cells.length > 25;
  }).length;

  // the short course-work list Home and the Course page agree on
  function courseChores(st) {
    const chores = [];
    const rakes = rakeableBunkers(st);
    if (rakes) chores.push({ icon: '🏖', name: `Rake ${rakes} bunker${rakes === 1 ? '' : 's'}`, detail: 'Take the rake out to the sand — nobody does it from a desk.' });
    const reno = st.shop.reno;
    const clutterLeft = reno ? reno.clutter.filter((c) => !c.cleared).length : 0;
    if (clutterLeft) chores.push({ icon: '🧹', name: `Haul ${clutterLeft} clutter pile${clutterLeft === 1 ? '' : 's'}`, detail: 'Old junk in the clubhouse — pick it up and carry it out.' });
    const grime = reno ? reno.grime.reduce((a, v) => a + v, 0) / reno.grime.length : 0;
    if (grime > 0.4) chores.push({ icon: '🧽', name: 'Vacuum the clubhouse floor', detail: 'The vacuum lives in the cleaning corner.' });
    if (st.tractor && !st.tractor.repaired) {
      const missing = TRACTOR_STEPS.filter((s2) => !st.tractor.steps[s2]);
      chores.push({ icon: '🚜', name: 'Repair the tractor', detail: `Still needs: ${missing.map((s2) => STEP_LABEL[s2]).join(', ')} — hands-on at the machine.`, tone: 'bad' });
    }
    return chores;
  }

  // the bell — a small in-glass list of what the club recorded, newest first
  function openNotifications() {
    const st = app.state;
    openModal(() => {
      const feed = ensureNotifications(st);
      const items = feed.items.slice(0, 10);
      return el('div', {},
        el('div', { class: 'lt-minihead' }, icon('bell'), el('span', { text: 'Notifications' })),
        items.length
          ? el('div', {}, ...items.map((i) => el('button', {
            class: `lt-notif ${i.read ? '' : 'unread'}`,
            onclick: () => {
              markRead(st, i.id);
              const dest = i.page;
              closeModal();
              if (dest) go(dest);
            },
          },
          el('span', { class: `lt-notifdot ${i.read ? 'read' : ''}` }),
          el('span', { class: 'lt-listbody' },
            el('div', { class: 'lt-listname', text: `${(NOTIF_KINDS[i.kind] || NOTIF_KINDS.system).icon}  ${i.text}` }),
            el('div', { class: 'lt-listsub', text: `Day ${calendarOf(i.minute).dayOfSeason} · ${clock12(calendarOf(i.minute).minuteOfDay)}` })))))
          : empty('Nothing yet — the club writes here when something happens.'),
        el('div', { class: 'lt-modalbtns' },
          items.some((i) => !i.read)
            ? el('button', { class: 'lt-mini', text: 'Mark all read', onclick: () => { markAllRead(st); click(); render(); } })
            : null,
          el('button', { class: 'lt-primary', text: 'Close', onclick: () => closeModal() })),
      );
    });
  }

  function refreshStatus() {
    const st = app.state;
    if (!st) return;
    const cal = calendarOf(st.clock.minutes);
    const unread = unreadCount(st);
    const showBadge = prefsOf().notifBadge !== false;
    statusbar.replaceChildren(
      el('button', { class: 'lt-crumb', title: 'Back', disabled: history.length ? undefined : 'disabled', onclick: () => back() }, icon('back')),
      el('span', { class: 'lt-statusname', text: (NAV.find((n) => n.id === page) || NAV[0]).label }),
      el('span', { text: `Day ${cal.dayOfSeason} · ${clock12(cal.minuteOfDay)}` }),
      el('span', { class: `lt-chip ${shopIsOpen(st) ? 'ok' : ''}`, text: shopIsOpen(st) ? 'Open' : 'Closed' }),
      el('span', { class: 'lt-headspace' }),
      el('button', {
        class: 'lt-crumb', title: unread ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications',
        onclick: () => openNotifications(),
      }, icon('bell'), unread && showBadge ? el('span', { class: 'lt-belldot', text: unread > 9 ? '9+' : String(unread) }) : null),
      el('button', { class: 'lt-cashcard', title: 'Open Finances', onclick: () => go('finances') },
        el('div', { class: 'lt-cashval', text: formatMoney(cashOf()) }),
        el('div', { class: 'lt-cashlabel', text: 'Cash balance' })),
    );
  }

  // ==========================================================================================
  // HOME — one screen: four numbers, today's objective, and the three lists that matter
  // ==========================================================================================
  function pageHome() {
    const st = app.state;
    const cal = calendarOf(st.clock.minutes);
    const ratings = clubRatings(st);
    const revToday = sumLines(st.ledger?.today?.revenue);
    const condition = ratings.condition;

    const teeSheet = laptopReservationSheet(st, cal.dayAbs);
    const upcoming = teeSheet.slots
      .flatMap((slot) => slot.reservations.map((entry) => ({ minute: slot.minute, ...entry })))
      .filter((b) => b.reservation.status === 'booked' && b.minute >= cal.minuteOfDay)
      .sort((a, b) => a.minute - b.minute);
    const next = upcoming[0] || null;

    // today's objective, straight from the tutorial — or an honest "all caught up"
    const step = st.tutorial && !st.tutorial.complete ? currentStep(st) : null;
    const rs = reviewSummary(st, { waitedSec: 0, queueLen: 0, played: true });

    // low stock — out lines first, then the thinnest shelves
    const lowStock = retailSkus(st)
      .map((s) => ({ sku: s, e: st.shop.inventory[s.id] }))
      .filter((m) => m.e.shelf < 3)
      .sort((a, b) => (a.e.shelf + a.e.back * 0.01) - (b.e.shelf + b.e.back * 0.01))
      .slice(0, 3);

    // course work — turf problems and hands-on chores, worst first
    const problems = (st.sections || [])
      .map((section) => ({ section, status: sectionStatus(st, section) }))
      .filter((p) => p.status !== 'Healthy');
    const chores = courseChores(st);
    const tasks = [
      ...problems.map((p) => ({ name: p.section.name || 'Section', detail: p.status, tone: p.status === 'Declining' ? 'bad' : 'warn' })),
      ...chores.map((c) => ({ name: c.name, detail: 'hands-on', tone: c.tone || 'warn' })),
    ].slice(0, 3);

    const listRow = (kids) => el('div', { class: 'lt-listrow' }, ...kids);
    const greetWord = cal.minuteOfDay < 12 * 60 ? 'Good morning' : cal.minuteOfDay < 17 * 60 ? 'Good afternoon' : 'Good evening';

    paint(
      confirmBar(),
      el('div', { class: 'lt-greet' },
        el('h1', { text: `${greetWord}, Manager` }),
        el('div', { class: 'lt-greetsub', text: `Here's what's happening at ${st.clubName || 'your club'}.` })),

      el('div', { class: 'lt-stats lt-stats4' },
        stat('Cash', formatMoney(cashOf())),
        stat("Today's Revenue", formatMoney(revToday), revToday > 0 ? { text: 'earned so far today', tone: 'ok' } : 'nothing banked yet'),
        stat('Next Tee Time', next ? fmtSlot(next.minute) : '—', next ? next.fullName : 'nothing later today'),
        stat('Course Condition', conditionWord(condition), `${Math.round(condition)} of 100`, conditionTone(condition),
          el('div', { class: 'lt-statbar' }, el('div', { class: conditionTone(condition), style: `width:${Math.max(2, Math.min(100, condition))}%` }))),
      ),

      el('div', { class: 'lt-objbar' },
        el('div', { class: 'lt-objicon' }, icon('target')),
        el('div', { class: 'lt-objbody' },
          el('div', { class: 'lt-objlabel', text: "Today's objective" }),
          el('div', { class: 'lt-tasktitle', text: step ? step.title : 'All caught up' }),
          el('div', { class: 'lt-listsub', text: step ? (step.hint || '') : (rs.count ? `${rs.average}★ from ${rs.count} reviews — keep it rolling.` : 'Run the club your way.') })),
      ),

      el('div', { class: 'lt-cols' },
        card(
          el('div', { class: 'lt-minihead' }, icon('clock'), el('span', { text: 'Upcoming Tee Times' })),
          upcoming.length
            ? el('div', {}, ...upcoming.slice(0, 3).map((b) => listRow([
              el('span', { class: 'lt-slottime', text: fmtSlot(b.minute) }),
              el('span', { class: 'lt-listbody' },
                el('div', { class: 'lt-listname', text: b.fullName }),
                el('div', { class: 'lt-listsub', text: `${b.groupSize} player${b.groupSize === 1 ? '' : 's'}${b.outstandingRevenue > 0 ? ` · ${formatMoney(b.outstandingRevenue)} due` : ''}` })),
            ])))
            : empty(`No more today — ${teeSheet.reservationCount} came through in all.`),
          el('div', { class: 'lt-cardfoot' },
            el('button', { class: 'lt-mini', text: 'View Tee Times', onclick: () => go('reservations') })),
        ),
        card(
          el('div', { class: 'lt-minihead' }, icon('box'), el('span', { text: 'Low Stock' })),
          lowStock.length
            ? el('div', {}, ...lowStock.map((m) => listRow([
              thumbOf(m.sku),
              el('span', { class: 'lt-listbody' },
                el('div', { class: 'lt-listname', text: m.sku.name }),
                el('div', { class: 'lt-listsub', text: m.e.back > 0 ? `${m.e.back} in the back room` : 'none in the back' })),
              word(m.e.shelf === 0 ? 'Out' : `Stock: ${m.e.shelf}`, m.e.shelf === 0 ? 'bad' : 'warn'),
            ])))
            : empty('Shelves are holding.'),
          el('div', { class: 'lt-cardfoot' },
            el('button', {
              class: 'lt-mini',
              text: 'Order Stock',
              onclick: () => { ts('shop').tab = 'order'; go('shop'); },
            })),
        ),
        card(
          el('div', { class: 'lt-minihead' }, icon('leaf'), el('span', { text: 'Course Tasks' })),
          tasks.length
            ? el('div', {}, ...tasks.map((t) => listRow([
              el('span', { class: 'lt-listbody' },
                el('div', { class: 'lt-listname', text: t.name }),
                el('div', { class: 'lt-listsub', text: t.detail })),
              word(t.tone === 'bad' ? 'Urgent' : 'Needs work', t.tone),
            ])))
            : empty('Nothing needs doing out there.'),
          el('div', { class: 'lt-cardfoot' },
            el('button', {
              class: 'lt-mini',
              text: 'View All Tasks',
              onclick: () => { ts('course').tab = 'tasks'; go('course'); },
            })),
        ),
      ),
    );
  }

  // ==========================================================================================
  // TEE TIMES — an appointment list for one day, with a small detail modal
  // ==========================================================================================
  function pageReservations() {
    const st = app.state;
    if (!st.reservations) {
      paint(head('Tee Times'), empty('Reservations are not available on this property.'));
      return;
    }
    const rs = ts('reservations', { filter: 'all', adding: false });
    teeDay = Math.max(0, Math.min(TEE_SHEET.horizonDays - 1, teeDay));
    const cal = calendarOf(st.clock.minutes);
    const dayAbs = cal.dayAbs + teeDay;
    const model = laptopReservationSheet(st, dayAbs);
    const nowAbsMin = st.clock.minutes;

    const statusText = (r) => (r.status === 'played' ? 'Checked in'
      : r.status === 'noShow' ? 'No show'
        : r.status === 'cancelled' ? 'Cancelled' : 'Waiting');
    const statusTone = (r) => (r.status === 'played' ? 'ok'
      : r.status === 'noShow' || r.status === 'cancelled' ? 'bad' : '');
    const canMarkNoShow = (r) => r.status === 'booked'
      && nowAbsMin > (r.teeTimeAbs ?? (r.dayAbs * 1440 + r.minute)) + (TEE_SHEET.noShowGraceMin || 20);

    const flat = model.slots.flatMap((slot) => slot.reservations.map((entry) => ({ slot, entry, r: entry.reservation })));
    const shown = flat.filter((m) => (rs.filter === 'waiting' ? m.r.status === 'booked'
      : rs.filter === 'checkedin' ? m.r.status === 'played'
        : rs.filter === 'noshow' ? m.r.status === 'noShow' : true));

    // the small detail modal the brief asks for — everything about one booking, in one place
    const viewReservation = (m) => openModal(() => {
      const deposit = Number(m.r.depositPaid ?? m.r.deposit) || 0;
      const due = m.entry.outstandingRevenue;
      return el('div', {},
        el('div', { class: 'lt-minihead', text: m.entry.fullName }),
        row(el('span', { class: 'lt-mulabel', text: 'Tee time' }), el('span', { style: 'font-size:0.84em', text: `${fmtSlot(m.slot.minute)}, ${teeDay === 0 ? 'today' : teeDay === 1 ? 'tomorrow' : `in ${teeDay} days`}` })),
        row(el('span', { class: 'lt-mulabel', text: 'Party' }), el('span', { style: 'font-size:0.84em', text: `${m.entry.groupSize} player${m.entry.groupSize === 1 ? '' : 's'}` })),
        row(el('span', { class: 'lt-mulabel', text: 'Green fee' }), el('span', { style: 'font-size:0.84em', text: formatMoney(m.r.fee || 0) }), deposit ? meta(`deposit ${formatMoney(deposit)} paid`) : null),
        row(el('span', { class: 'lt-mulabel', text: 'Due at desk' }), chip(due > 0 ? formatMoney(due) : 'Paid', due > 0 ? 'warn' : 'ok')),
        row(el('span', { class: 'lt-mulabel', text: 'Status' }), chip(statusText(m.r), statusTone(m.r))),
        m.r.status === 'noShow' && m.r.noShowFeeStatus
          ? row(el('span', { class: 'lt-mulabel', text: 'No-show fee' }), meta(m.r.noShowFeeStatus.replace(/-/g, ' ')))
          : null,
        el('div', { class: 'lt-modalbtns' },
          m.r.status === 'booked' && canMarkNoShow(m.r)
            ? el('button', {
              class: 'lt-mini lt-cancel',
              text: 'Mark no-show',
              onclick: () => {
                closeModal();
                askConfirm(`Mark ${m.entry.fullName}'s ${fmtSlot(m.slot.minute)} as a no-show? The fee settles once, deposit first.`, 'Mark no-show', () => {
                  const res = markReservationNoShow(st, m.r.id, { at: nowAbsMin });
                  toast(res && res.ok === false ? (res.reason || 'Could not mark it.') : `${m.entry.fullName} marked as a no-show.`, res && res.ok === false ? 'warn' : '');
                });
              },
            })
            : null,
          m.r.status === 'booked'
            ? el('button', {
              class: 'lt-mini lt-cancel',
              text: 'Cancel booking',
              onclick: () => {
                closeModal();
                askConfirm(`Cancel ${m.entry.fullName}'s ${fmtSlot(m.slot.minute)} tee time?`, 'Cancel the booking', () => {
                  cancelReservation(st, m.r.id);
                  toast(`${m.entry.fullName}'s ${fmtSlot(m.slot.minute)} spot is open again.`);
                });
              },
            })
            : null,
          el('button', { class: 'lt-primary', text: 'Close', onclick: () => closeModal() }),
        ),
      );
    });

    const rowOf = (m) => el('tr', {},
      el('td', {}, el('span', { class: 'lt-slottime', text: fmtSlot(m.slot.minute) })),
      el('td', {}, el('span', { style: 'font-weight:600', text: m.entry.fullName })),
      el('td', { text: `${m.entry.groupSize} player${m.entry.groupSize === 1 ? '' : 's'}` }),
      el('td', {}, word(statusText(m.r), statusTone(m.r))),
      el('td', { class: 'lt-num' },
        el('button', { class: 'lt-mini', text: 'View', onclick: () => viewReservation(m) })));

    // the walk-in adder: pick a time with room, pick a party size, done. A walk-in is
    // standing at the desk NOW — today's already-passed times are not on offer.
    const openSlots = model.slots.filter((s) => s.remainingCapacity >= teePartySize
      && (teeDay > 0 || s.minute >= cal.minuteOfDay - 10));
    const timeSel = el('select', { class: 'lt-select' },
      ...openSlots.map((s) => el('option', { value: String(s.minute), text: `${fmtSlot(s.minute)} (${s.remainingCapacity} open)` })));
    const partySel = el('select', {
      class: 'lt-select',
      onchange: (e) => { teePartySize = Number(e.target.value) || 1; click(); render(); },
    }, ...Array.from({ length: Math.max(1, Math.min(16, Number(st.reservations.config?.maxGroupSize) || TEE_SHEET.maxGroupSize)) }, (_, i) => i + 1)
      .map((size) => el('option', { value: String(size), text: `${size} player${size === 1 ? '' : 's'}`, selected: size === teePartySize ? 'selected' : undefined })));
    const addCard = rs.adding
      ? card(
        el('div', { class: 'lt-minihead', text: 'Add a walk-in' }),
        row(el('span', { class: 'lt-mulabel', text: 'Time' }), timeSel),
        row(el('span', { class: 'lt-mulabel', text: 'Party' }), partySel),
        row(
          el('button', { class: 'lt-mini', text: 'Never mind', onclick: () => { rs.adding = false; click(); render(); } }),
          el('button', {
            class: 'lt-primary',
            text: 'Book it',
            disabled: openSlots.length ? undefined : 'disabled',
            onclick: () => {
              const minute = Number(timeSel.value);
              const result = bookLaptopReservation(st, { dayAbs, minute, partySize: teePartySize });
              if (!result.ok) toast(result.reason, 'warn');
              else {
                toast(`${result.res.fullName} booked for ${fmtSlot(minute)}.`);
                rs.adding = false;
                click();
              }
              render();
            },
          }),
        ),
        openSlots.length ? null : meta('No slot this day fits that party size.'),
      )
      : null;

    paint(
      head('Tee Times', 'Booked golfers walk in around their time; the green fee is collected face to face at the front desk.',
        primaryBtn('+ Add Walk-In', () => { rs.adding = !rs.adding; click(); render(); })),
      confirmBar(),
      row(
        el('button', { class: 'lt-day', text: '‹', disabled: teeDay === 0 ? 'disabled' : undefined, onclick: () => { teeDay--; click(); render(); } }),
        el('button', { class: `lt-day ${teeDay === 0 ? 'on' : ''}`, text: 'Today', onclick: () => { teeDay = 0; click(); render(); } }),
        el('button', { class: 'lt-day', text: '›', disabled: teeDay >= TEE_SHEET.horizonDays - 1 ? 'disabled' : undefined, onclick: () => { teeDay++; click(); render(); } }),
        meta(teeDay === 0 ? 'today' : teeDay === 1 ? 'tomorrow' : `${teeDay} days out`),
        el('span', { style: 'flex:1' }),
        meta(`${model.bookedPlayers} booked · ${model.openPlayerCapacity} spots open · ${formatMoney(model.expectedRevenue)} to collect`),
      ),
      addCard,
      filterTabs(rs, [
        { value: 'all', label: 'All' }, { value: 'waiting', label: 'Waiting' },
        { value: 'checkedin', label: 'Checked in' }, { value: 'noshow', label: 'No show' },
      ], () => { click(); render(); }),
      shown.length
        ? card(el('table', { class: 'lt-table' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Time' }), el('th', { text: 'Customer' }), el('th', { text: 'Party' }),
            el('th', { text: 'Status' }), el('th', {}))),
          el('tbody', {}, ...shown.map(rowOf))))
        : empty(flat.length ? 'Nothing under that filter.' : 'Nothing booked this day — walk-ins welcome.'),
    );
  }

  // ==========================================================================================
  // SHOP — stock, order, pricing, deliveries. Four tabs, one page.
  // ==========================================================================================
  function pageShop() {
    const st = app.state;
    const ss = ts('shop', { tab: 'stock', cat: 'all' });
    const tabs = [['stock', 'Stock'], ['order', 'Order'], ['prices', 'Pricing'], ['deliveries', 'Deliveries']];

    const tabBar = el('div', { class: 'lt-tabs lt-tabs-big' }, ...tabs.map(([v, label]) => el('button', {
      class: `lt-tab ${ss.tab === v ? 'on' : ''}`, text: label,
      onclick: () => { ss.tab = v; click(); render(); },
    })));

    const body = ss.tab === 'order' ? shopOrderTab(st, ss)
      : ss.tab === 'prices' ? shopPricesTab(st)
        : ss.tab === 'deliveries' ? shopDeliveriesTab(st)
          : shopStockTab(st, ss);

    paint(
      head('Shop', 'The laptop orders and prices stock. Boxes still ride the van, land outside, and get carried in and shelved by hand.'),
      confirmBar(),
      tabBar,
      ...body,
    );
  }

  function shopStockTab(st, ss) {
    const inv = st.shop.inventory;
    // the display capacity is what the fixtures actually hold (fixtureSlots is THE
    // definition); SHELF_CAP is only the fallback for lines with no authored slots
    const models = retailSkus(st).map((s) => ({
      sku: s,
      e: inv[s.id],
      cap: capacityOf(s.id) || SHELF_CAP[s.cat],
      incoming: incomingOf(st, s.id),
    }));
    const q = applyTableQuery(models, {
      search: ss.search,
      searchIn: (m) => [m.sku.name, CAT_LABEL[m.sku.cat]],
      filters: [
        ss.filter === 'low' ? (m) => m.e.shelf > 0 && m.e.shelf < 3 : null,
        ss.filter === 'out' ? (m) => m.e.shelf === 0 : null,
      ].filter(Boolean),
      sortVal: (m) => m.sku.name,
      sortDir: 1,
      page: 0,
      pageSize: 200,
    });

    const suggestedQty = (m) => Math.max(2, Math.ceil(velocity(st, m.sku.id) * LEAD_DAYS[m.sku.cat]) || 6);
    const statusOf = (m) => (m.e.shelf === 0
      ? (m.e.back > 0 ? ['Shelve it', 'warn'] : ['Out of stock', 'bad'])
      : m.e.shelf < 3 ? ['Low stock', 'warn'] : ['In stock', 'ok']);
    const rows = q.rows.map((m) => {
      const [label, tone] = statusOf(m);
      return el('tr', {},
        el('td', {}, el('div', { style: 'display:flex;gap:8px;align-items:center' },
          thumbOf(m.sku),
          el('span', { style: 'font-weight:600', text: m.sku.name }))),
        el('td', { text: CAT_LABEL[m.sku.cat] }),
        el('td', {},
          el('div', { style: `font-weight:700;font-variant-numeric:tabular-nums${m.e.shelf === 0 ? ';color:var(--lt-bad)' : m.e.shelf < 3 ? ';color:var(--lt-warn)' : ''}`, text: `${m.e.shelf} / ${m.cap}` }),
          m.e.back || m.incoming
            ? el('div', { class: 'lt-listsub', text: `${m.e.back ? `${m.e.back} in back` : ''}${m.e.back && m.incoming ? ' · ' : ''}${m.incoming ? `${m.incoming} coming` : ''}` })
            : null),
        el('td', { class: 'lt-num', text: formatMoney(priceFor(m.sku, st.shop.markup[m.sku.cat] || 1, null)) }),
        el('td', {}, word(label, tone)),
        el('td', { class: 'lt-num' }, el('button', {
          class: 'lt-mini',
          text: 'Order',
          onclick: () => { cart.set(m.sku.id, (cart.get(m.sku.id) || 0) + suggestedQty(m)); ss.tab = 'order'; click(); render(); },
        })));
    });

    return [
      el('div', { class: 'lt-toolbar' },
        searchBox(ss, () => { click(); render(); }, 'Search products…'),
        filterTabs(ss, [
          { value: 'all', label: 'All' }, { value: 'low', label: 'Low' }, { value: 'out', label: 'Out' },
        ], () => { click(); render(); })),
      rows.length
        ? card(el('table', { class: 'lt-table' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Product' }), el('th', { text: 'Category' }), el('th', { text: 'On shelf' }),
            el('th', { class: 'lt-num', text: 'Price' }), el('th', { text: 'Status' }), el('th', {}))),
          el('tbody', {}, ...rows)))
        : empty(models.length ? 'Nothing matches.' : 'No product lines unlocked yet.'),
      note('Stocking is physical — carry goods from the storage room to the displays. "Shelve it" means the stock is already in the back.'),
    ];
  }

  function shopOrderTab(st, ss) {
    let goods = 0;
    let freight = 0;
    let boxCount = 0;
    for (const [id, qty] of cart) {
      const sku = skuById(id);
      const ship = shipOf(sku, qty);
      goods += orderCost(sku, qty);
      freight += ship.fee;
      boxCount += ship.boxCount;
    }
    goods = Math.round(goods * 100) / 100;
    freight = Math.round(freight * 100) / 100;
    const total = Math.round((goods + freight) * 100) / 100;
    const affordable = total <= cashOf();

    const cats = ['balls', 'clubs', 'apparel', 'accessories', 'provisions', 'supplies', 'decor'];
    const catBar = el('div', { class: 'lt-tabs' },
      el('button', { class: `lt-tab ${ss.cat === 'all' ? 'on' : ''}`, text: 'All', onclick: () => { ss.cat = 'all'; click(); render(); } }),
      ...cats.map((c) => el('button', {
        class: `lt-tab ${ss.cat === c ? 'on' : ''}`, text: CAT_LABEL[c],
        onclick: () => { ss.cat = c; click(); render(); },
      })));

    const needle = String(ss.search || '').trim().toLowerCase();
    const shown = SHOP_CATALOG
      .filter((s) => (ss.cat === 'all' ? RETAIL_CATS.has(s.cat) || s.cat === 'supplies' || s.cat === 'decor' : s.cat === ss.cat))
      .filter((s) => !needle || s.name.toLowerCase().includes(needle));

    const cards = shown.map((s) => {
      const locked = s.tier > st.shop.unlockedTier;
      const owned = st.shop.inventory[s.id];
      const inCart = cart.get(s.id) || 0;
      const suggested = priceFor(s, st.shop.markup[s.cat] || 1, null);
      const setQty = (q2) => {
        q2 = Math.max(0, Math.min(99, q2));
        if (q2 === 0) cart.delete(s.id); else cart.set(s.id, q2);
        render();
      };
      return el('div', { class: `lt-product ${locked ? 'locked' : ''}` },
        thumbOf(s),
        el('div', { class: 'lt-prodname', text: s.name }),
        el('div', { class: 'lt-prodprice' },
          el('span', { class: 'lt-wholesale', text: formatMoney(s.cost) }),
          el('span', { class: 'lt-meta', text: ` → sells ${formatMoney(suggested)}` })),
        el('div', { class: 'lt-prodmeta', text: `${unitsPerBox(s)} per box · arrives in ${LEAD_DAYS[s.cat]}d · have ${owned.shelf + owned.back}` }),
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
        toast(`Order accepted — ${formatMoney(spent)}. ${plural(boxes, 'box')} to the receiving pad.`);
        if (app.audio && app.audio.ready) app.audio.chime();
      }
      for (const f of failed) toast(f, 'warn');
      if (placed && !failed.length) { ts('shop').tab = 'deliveries'; }
      render();
    };
    const placeOrderFlow = () => {
      // small orders can skip the confirmation if the player turned that off in Settings
      if (prefsOf().confirmOrders === false && total < 100) { placeAll(); return; }
      askConfirm(
        `Order ${cart.size} line${cart.size === 1 ? '' : 's'} for ${formatMoney(total)} — ${formatMoney(goods)} of stock plus ${formatMoney(freight)} delivery. ${plural(boxCount, 'box')} to the pad outside.`,
        'Place the order', placeAll,
      );
    };

    return [
      el('div', { class: 'lt-ordersummary' },
        el('span', { style: 'font-weight:600', text: `${cart.size} item${cart.size === 1 ? '' : 's'}` }),
        meta(`delivery ${formatMoney(freight)}`),
        el('span', { class: 'lt-headspace' }),
        el('span', { class: `lt-cash ${affordable ? '' : 'bad'}`, text: `Total ${formatMoney(total)}` }),
        primaryBtn(cart.size ? 'Place Order' : 'Basket is empty', placeOrderFlow, !cart.size || !affordable)),
      !affordable && cart.size ? errBox(`That basket is ${formatMoney(total - cashOf())} more than you have.`) : null,
      el('div', { class: 'lt-toolbar' }, searchBox(ss, () => { click(); render(); }, 'Search products…')),
      catBar,
      cards.length ? el('div', { class: 'lt-grid' }, ...cards) : empty('No products match that search.'),
    ];
  }

  function shopPricesTab(st) {
    const ratings = clubRatings(st);
    const fair = fairGreenFee(ratings.overall, st.club.amenities ? Object.values(st.club.amenities).reduce((a, v) => a + v, 0) : 0);

    const markups = ['clubs', 'balls', 'apparel', 'accessories', 'provisions'].map((cat) => {
      const val = st.shop.markup[cat] || 1;
      const sample = SHOP_CATALOG.find((s) => s.cat === cat && s.tier <= st.shop.unlockedTier);
      const out = el('span', { class: 'lt-muval' });
      const paintMarkup = (v) => {
        const price = sample ? priceFor(sample, v, null) : 0;
        out.replaceChildren(
          el('span', { class: 'lt-mupct', text: sample ? formatMoney(price) : `${Math.round(v * 100)}%` }),
          el('span', { class: `lt-chip ${v > 1.2 ? 'bad' : v > 1.05 ? 'warn' : v < 0.9 ? 'warn' : 'ok'}`, text: v > 1.2 ? 'High price' : v > 1.05 ? 'Punchy' : v < 0.9 ? 'Below the mark' : 'Good price' }),
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
        el('span', { class: `lt-chip ${ratio > 1.25 ? 'bad' : ratio > 1.08 ? 'warn' : ratio < 0.8 ? 'warn' : 'ok'}`, text: ratio > 1.25 ? 'Too high' : ratio > 1.08 ? 'Above the mark' : ratio < 0.8 ? 'Under-charging' : 'Fair' }),
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

    return [
      card(el('div', { class: 'lt-minihead', text: 'Green fee' }),
        row(el('span', { class: 'lt-mulabel', text: 'Per round' }), feeRange, feeOut),
        row(meta(`a fair fee for this course is about ${formatMoney(fair)}`))),
      card(el('div', { class: 'lt-minihead', text: 'Shop prices' }), ...markups,
        row(meta('each slider shows what a sample product rings up at — the register uses these prices immediately'))),
      card(el('div', { class: 'lt-minihead', text: 'Rental club sets' }),
        row(el('span', { class: 'lt-mulabel', text: 'Per round' }), rentRange, rentOut)),
    ];
  }

  function shopDeliveriesTab(st) {
    const cal = calendarOf(st.clock.minutes);
    const orders = st.shop.orders.slice().sort((a, b) => a.deliveryMin - b.deliveryMin);
    const shipments = shipmentsOf(st);
    const boxes = boxesOf(st);
    const used = padCount(st);
    const blockedNow = orders.filter((o) => o.blocked);

    const orderRow = (o) => {
      const sku = skuById(o.skuId);
      const s = ORDER_STATUS[o.status] || { label: o.status, tone: '' };
      const days = o.arrivesDay - cal.dayAbs;
      const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
      // A blocked driver unloaded nothing, so the player can still turn that van away.
      const canCancel = !!o.blocked || (o.status !== 'arriving' && o.status !== 'delivered');
      const man = o.manifest || shipOf(sku, o.qty);
      return el('div', { class: 'lt-order' },
        thumbOf(sku),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: `${sku.name} × ${o.qty}` }),
          el('div', { class: 'lt-prodmeta', text: `${plural(man.boxCount, 'box')} · ${when}, ${hour12(o.window.open)}–${hour12(o.window.close)} · paid ${formatMoney(o.cost)}` })),
        chip(s.label, s.tone),
        canCancel
          ? el('button', {
            class: 'lt-mini lt-cancel',
            text: 'Cancel',
            onclick: () => askConfirm(
              `Cancel ${sku.name} × ${o.qty}? You get ${formatMoney(o.cost)} back, delivery fee included.`,
              'Cancel the order',
              () => {
                const res = cancelOrder(st, o.id);
                toast(res.ok ? `Cancelled — ${formatMoney(res.refund)} refunded.` : res.reason, res.ok ? '' : 'warn');
              },
            ),
          })
          : null);
    };

    const shipRow = (sh) => {
      const sku = skuById(sh.skuId);
      const status = shipmentStatus(st, sh);
      const s = ORDER_STATUS[status];
      const mine = boxes.filter((b) => b.orderId === sh.orderId);
      const left = mine.reduce((a, b) => a + b.qty, 0);
      return el('div', { class: 'lt-order' },
        thumbOf(sku),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: `${sku.name} × ${sh.units}` }),
          el('div', { class: 'lt-prodmeta', text: left ? `${left} still in the cardboard — your boxes are outside or in the back` : 'all unpacked' })),
        chip(s.label, s.tone),
        el('button', {
          class: 'lt-mini', text: 'Reorder',
          onclick: () => { cart.set(sh.skuId, (cart.get(sh.skuId) || 0) + sh.units); ts('shop').tab = 'order'; click(); render(); },
        }));
    };

    return [
      blockedNow.length
        ? errBox(`A van cannot unload — the receiving pad is full (${used} of ${PAD_CAPACITY}). Carry boxes inside and the driver returns.`)
        : row(meta(`Receiving pad: ${used} of ${PAD_CAPACITY} spots used`), used >= PAD_CAPACITY - 2 ? chip('nearly full', 'warn') : null),
      sect(`On the way (${orders.length})`),
      orders.length ? el('div', { class: 'lt-orderlist' }, ...orders.map(orderRow)) : empty('Nothing on the road.'),
      sect(`Delivered (${shipments.length})`),
      shipments.length ? el('div', { class: 'lt-orderlist' }, ...shipments.map(shipRow)) : empty('Nothing waiting outside.'),
      note('Boxes are physical: carry them in, cut the tape, and shelve what is inside. The laptop cannot do that part.'),
    ];
  }

  // ==========================================================================================
  // COURSE — overview, tasks, holes. A real aerial, condition in words, the editor one click.
  // ==========================================================================================
  function pageCourse() {
    const st = app.state;
    const cs = ts('course', { tab: 'overview' });
    const tabs = [['overview', 'Overview'], ['tasks', 'Tasks'], ['holes', 'Holes']];
    const tabBar = el('div', { class: 'lt-tabs lt-tabs-big' }, ...tabs.map(([v, label]) => el('button', {
      class: `lt-tab ${cs.tab === v ? 'on' : ''}`, text: label,
      onclick: () => { cs.tab = v; click(); render(); },
    })));

    const body = cs.tab === 'tasks' ? courseTasksTab(st)
      : cs.tab === 'holes' ? courseHolesTab(st)
        : courseOverviewTab(st, cs);

    paint(
      head('Course', 'Condition is read live from the turf. Mowing, raking and repairs happen out on the grass — the laptop plans and pays.',
        opts.openCourseEditor
          ? primaryBtn('Open Course Editor', () => askConfirm(
            'Head to the works desk? The laptop closes and the course opens under the editing camera.',
            'Open the editor',
            () => opts.openCourseEditor(),
          ))
          : null),
      confirmBar(),
      tabBar,
      ...body,
    );
  }

  function courseOverviewTab(st, cs) {
    const ratings = clubRatings(st);
    const w = st.weather.today;
    const closed = st.course.holes.filter((h) => h.status !== HOLE_STATUS.OPEN).length;
    const problems = (st.sections || []).filter((s) => sectionStatus(st, s) !== 'Healthy').length;
    const rakes = rakeableBunkers(st);
    const jobs = problems + rakes;

    const heroMap = el('canvas', { class: 'lt-heromap', width: '940', height: '620' });
    paintCourse(heroMap, st, {
      marks: st.course.holes
        .map((h, i) => (h.pin ? { x: h.pin.x, y: h.pin.y, kind: 'number', n: i + 1 } : null))
        .filter(Boolean),
    });

    const bar = (label, zone) => {
      const h = zoneHealth(st, zone);
      if (h == null) return null;
      return el('div', { class: 'lt-facrow' },
        el('span', { class: 'lt-faclabel', text: label }),
        el('div', { class: 'lt-facbar' }, el('div', { class: `lt-facfill ${h < 45 ? 'bad' : h < 70 ? 'warn' : 'ok'}`, style: `width:${Math.max(2, Math.min(100, h))}%` })),
        el('span', { class: 'lt-facpct', text: `${Math.round(h)}%` }));
    };

    return [
      el('div', { class: 'lt-hero' },
        heroMap,
        el('div', { class: 'lt-card', style: 'margin-bottom:0;display:flex;flex-direction:column' },
          el('div', { class: 'lt-minihead', text: 'Overall Course Condition' }),
          el('div', { class: 'lt-heropct' },
            el('span', { text: `${Math.round(ratings.condition)}%` }),
            word(conditionWord(ratings.condition), conditionTone(ratings.condition))),
          el('div', { class: 'lt-statbar', style: 'margin:8px 0 12px' },
            el('div', { class: conditionTone(ratings.condition), style: `width:${Math.max(2, Math.min(100, ratings.condition))}%` })),
          bar('Greens', ZONE.GREEN),
          bar('Fairways', ZONE.FAIRWAY),
          bar('Tees', ZONE.TEE),
          bar('Rough', ZONE.ROUGH),
          el('div', { class: 'lt-listrow', style: 'margin-top:8px' },
            el('span', { class: 'lt-listbody' }, el('div', { class: 'lt-listsub', text: `Weather ${Math.round(w.tempHiF)}°${w.rainIn > 0.02 ? `, rain ${w.rainIn.toFixed(2)}"` : ', dry'} · ${closed ? `${closed} hole${closed === 1 ? '' : 's'} closed` : 'all holes open'}` })),
            jobs ? word(`${jobs} job${jobs === 1 ? '' : 's'}`, 'warn') : word('No jobs', 'ok')),
          el('div', { class: 'lt-cardfoot' },
            el('button', { class: 'lt-mini', text: 'View Tasks', onclick: () => { cs.tab = 'tasks'; click(); render(); } })),
        ),
      ),
    ];
  }

  function courseTasksTab(st) {
    const pol = st.maintenance ? st.maintenance.policies : null;
    const report = st.maintenance ? st.maintenance.lastReport : null;
    const crewHours = groundsCrewHours(st);
    const gks = st.staff.employees.filter((e) => e.role === ROLE.GROUNDSKEEPER);

    // the job list: what the turf model says is suffering, plus the hands-on chores
    const problems = (st.sections || []).map((section) => {
      const status = sectionStatus(st, section);
      if (status === 'Healthy') return null;
      return { section, status, summary: sectionTurfSummary(st, section), diagnosis: diagnoseSection(st, section) };
    }).filter(Boolean).slice(0, 8);

    const problemRow = (p) => {
      const treatCost = Math.round(p.section.cells.length * 2.2);
      const aerateCost = Math.round(p.section.cells.length * 1.2);
      const diseased = !!p.summary.disease;
      return el('div', { class: 'lt-order' },
        el('span', { class: 'lt-alerticon', text: diseased ? '🦠' : '🌱' }),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: `${p.section.name || 'Section'} — ${p.status}` }),
          el('div', { class: 'lt-prodmeta', text: p.diagnosis || `Worn ground that wants air and rest.` })),
        chip(p.status, p.status === 'Declining' ? 'bad' : 'warn'),
        diseased ? el('button', {
          class: 'lt-mini',
          text: `Treat — ${formatMoney(treatCost)}`,
          disabled: cashOf() < treatCost ? 'disabled' : undefined,
          onclick: () => askConfirm(`Send the crew over with fungicide for ${formatMoney(treatCost)}?`, 'Treat it', () => {
            const res = treatSection(st, p.section);
            toast(res && res.ok === false ? (res.reason || 'Could not treat it.') : 'The crew is on it.', res && res.ok === false ? 'warn' : '');
          }),
        }) : el('button', {
          class: 'lt-mini',
          text: `Aerate — ${formatMoney(aerateCost)}`,
          disabled: cashOf() < aerateCost ? 'disabled' : undefined,
          onclick: () => askConfirm(`Aerate ${p.section.name || 'this section'} for ${formatMoney(aerateCost)}?`, 'Aerate it', () => {
            const res = aerateSection(st, p.section);
            toast(res && res.ok === false ? (res.reason || 'Could not aerate it.') : 'Cores pulled — the turf breathes again.', res && res.ok === false ? 'warn' : '');
          }),
        }));
    };
    const choreRow = (c) => el('div', { class: 'lt-order' },
      el('span', { class: 'lt-alerticon', text: c.icon }),
      el('div', { class: 'lt-orderbody' },
        el('div', { class: 'lt-ordername', text: c.name }),
        el('div', { class: 'lt-prodmeta', text: c.detail })),
      chip('hands-on', c.tone || 'warn'));
    const chores = courseChores(st).map(choreRow);

    // the crew's standing orders — the sliders write straight into the policy the crew reads at dawn
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
        value: String(p.mowHeightMm), class: 'lt-range', style: 'max-width:100px',
        oninput: (e) => { p.mowHeightMm = Number(e.target.value); mowOut.textContent = `${p.mowHeightMm}mm`; },
      });
      const cycleBtn = (label, field, options) => el('button', {
        class: 'lt-mini', text: `${label}: ${p[field]}`,
        onclick: (e) => { p[field] = cycle(options, p[field]); e.target.textContent = `${label}: ${p[field]}`; click(); },
      });
      return row(el('span', { class: 'lt-mulabel', text: range.label }), mowSlider, mowOut,
        cycleBtn('Water', 'irrigation', ['off', 'light', 'standard', 'heavy']),
        cycleBtn('Feed', 'fertilizer', ['none', 'lean', 'standard', 'aggressive']));
    };

    return [
      report && report.skipped && report.skipped.length
        ? errBox(`The crew ran out of hours this morning — ${report.skipped.length} job${report.skipped.length === 1 ? '' : 's'} went undone. Hire groundskeepers or ask for less.`)
        : row(meta(`Crew: you + ${gks.length} groundskeeper${gks.length === 1 ? '' : 's'} · ${crewHours.toFixed(1)} hours a morning`)),
      sect(`Jobs (${problems.length + chores.length})`),
      problems.length || chores.length
        ? el('div', { class: 'lt-orderlist' }, ...problems.map(problemRow), ...chores)
        : empty('Nothing needs doing. Enjoy it while it lasts.'),
      pol ? sect('Crew standing orders — followed at dawn') : null,
      pol ? card(...Object.keys(ZONE_RANGE).map(policyRow)) : null,
    ];
  }

  function courseHolesTab(st) {
    const pinKeyOf = (h) => {
      if (!h.pins || !h.pin) return null;
      for (const k of ['A', 'B', 'C']) {
        const p = h.pins[k];
        if (p && Math.abs(p.x - h.pin.x) < 0.01 && Math.abs(p.y - h.pin.y) < 0.01) return k;
      }
      return null;
    };
    const holeCard = (h, i) => {
      const activePin = pinKeyOf(h);
      const isOpen = h.status === HOLE_STATUS.OPEN;
      const routed = h.tee && h.pin;
      const map = el('canvas', { class: 'lt-holemap', width: '360', height: '128' });
      if (routed) {
        const pts = [h.tee, ...(h.wp || []), h.pin];
        let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
        for (const p of pts) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        paintCourse(map, st, {
          win: { x0: Math.floor(minX - 6), y0: Math.floor(minY - 6), w: Math.ceil(maxX - minX + 12), h: Math.ceil(maxY - minY + 12) },
          marks: [{ x: h.tee.x, y: h.tee.y, kind: 'tee' }, { x: h.pin.x, y: h.pin.y, kind: 'pin' }],
        });
      } else {
        paintCourse(map, st, { win: { x0: 0, y0: 0, w: st.course.w, h: st.course.h } });
      }
      return el('div', { class: 'lt-holecard' },
        el('div', { class: 'lt-holetop' },
          el('span', { class: 'lt-holename', text: h.name || `Hole ${i + 1}` }),
          word(isOpen ? 'Open' : 'Closed', isOpen ? 'ok' : 'warn')),
        map,
        el('div', { class: 'lt-listsub', text: routed ? `Par ${holePar(st.course, h)} · ${Math.round(holeDistanceYd(h))} yd${!isOpen && h.daysLeft > 0 ? ` · reopens in ${h.daysLeft} day${h.daysLeft === 1 ? '' : 's'}` : ''}` : 'Unrouted — draw it in the editor.' }),
        el('div', { class: 'lt-holebtns' },
          isOpen && h.pins && h.pins.A
            ? el('span', { style: 'display:flex;gap:3px;align-items:center' },
              meta('pin'),
              ...['A', 'B', 'C'].filter((k) => h.pins[k]).map((k) => el('button', {
                class: `lt-day ${activePin === k ? 'on' : ''}`,
                style: 'padding:1px 8px',
                text: k,
                onclick: () => {
                  h.pin = { x: h.pins[k].x, y: h.pins[k].y };
                  toast(`${h.name || `Hole ${i + 1}`} now plays to pin ${k}.`);
                  click();
                  render();
                },
              })))
            : null,
          el('span', { style: 'flex:1' }),
          isOpen
            ? el('button', {
              class: 'lt-mini',
              text: 'Rest',
              title: 'Close this hole for one day — golfers route around it and it reopens on its own.',
              onclick: () => askConfirm(`Rest ${h.name || `hole ${i + 1}`} for a day? Golfers route around it; it reopens on its own.`, 'Rest the hole', () => {
                h.status = HOLE_STATUS.RENOVATION;
                h.daysLeft = 1;
                toast(`${h.name || `Hole ${i + 1}`} is roped off until tomorrow.`);
              }),
            })
            : null,
          opts.openCourseEditor
            ? el('button', {
              class: 'lt-mini',
              text: 'Edit',
              onclick: () => askConfirm(
                `Redesign ${h.name || `hole ${i + 1}`}? The laptop closes and the course opens under the editing camera.`,
                'Open the editor',
                () => opts.openCourseEditor(),
              ),
            })
            : null));
    };
    return [
      el('div', { class: 'lt-holegrid' }, ...st.course.holes.map(holeCard)),
      note('Redesigning holes — terrain, zones, new routing — happens in the Course Editor.'),
    ];
  }

  // ==========================================================================================
  // UPGRADES — course & business improvements, amenities, staff, equipment. Money → lasting.
  // ==========================================================================================
  function pageUpgrades() {
    const st = app.state;
    const us = ts('upgrades', { tab: 'course' });
    const tabs = [['course', 'Course'], ['clubhouse', 'Clubhouse'], ['staff', 'Staff'], ['equipment', 'Equipment']];
    const tabBar = el('div', { class: 'lt-tabs lt-tabs-big' }, ...tabs.map(([v, label]) => el('button', {
      class: `lt-tab ${us.tab === v ? 'on' : ''}`, text: label,
      onclick: () => { us.tab = v; click(); render(); },
    })));

    const body = us.tab === 'clubhouse' ? upgradesClubhouseTab(st)
      : us.tab === 'staff' ? upgradesStaffTab(st)
        : us.tab === 'equipment' ? upgradesEquipmentTab(st)
          : upgradesCourseTab(st);

    paint(
      head('Upgrades', 'Everything here is a real purchase with a lasting effect the sim applies. Locked cards say exactly what they need.'),
      confirmBar(),
      tabBar,
      ...body,
    );
  }

  const UPGRADE_ICON = {
    greensMowerII: '🚜', fairwayMowerII: '🚜', aerator: '🌱', sprayRig: '🧪',
    smartIrrigation: '💧', premiumSupplier: '📦', reciprocalClubs: '🤝',
    corporatePartners: '💼', tournamentHost: '🏆',
  };

  function upgradeCard(st, id, u) {
    const prestige = st.progression ? st.progression.prestige : 0;
    const owned = hasUpgrade(st, id);
    const locked = prestige < u.prestige;
    const affordable = cashOf() >= u.cost;
    return el('div', { class: `lt-upcard ${locked && !owned ? 'locked' : ''}` },
      el('div', { class: 'lt-upicon', text: UPGRADE_ICON[id] || '🏗' }),
      el('div', { class: 'lt-uptitle', text: u.name }),
      el('div', { class: 'lt-updesc', text: u.blurb }),
      el('div', { class: 'lt-upfoot' },
        el('span', { class: 'lt-upprice', text: owned ? '' : formatMoney(u.cost) }),
        owned ? chip('Owned', 'ok')
          : locked ? chip(`Needs prestige ${u.prestige}`, '')
            : el('button', {
              class: 'lt-primary', text: 'Buy',
              disabled: affordable ? undefined : 'disabled',
              title: affordable ? undefined : 'Not enough cash',
              onclick: () => askConfirm(`Buy ${u.name} for ${formatMoney(u.cost)}? It bills once and starts working tomorrow.`, 'Buy it', () => {
                const res = purchaseUpgrade(st, id);
                toast(res.ok ? `${u.name} — done.` : res.reason, res.ok ? '' : 'warn');
              }),
            })));
  }

  function upgradesCourseTab(st) {
    const cal = calendarOf(st.clock.minutes);
    const ev = st.progression ? st.progression.event : null;
    const hostReady = hasUpgrade(st, 'tournamentHost');
    const offers = st.club.outings ? st.club.outings.offers : [];
    const prestige = st.progression ? st.progression.prestige : 0;

    const tournamentRow = (tier) => {
      const spec = TOURNAMENTS[tier];
      const gate = canScheduleTournament(st, tier);
      return el('div', { class: 'lt-order' },
        el('span', { class: 'lt-alerticon', text: '🏆' }),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: spec.name }),
          el('div', { class: 'lt-prodmeta', text: `stage ${formatMoney(spec.cost)} · entries ${formatMoney(spec.entryRevenue)} · needs ${spec.conditionReq}+ condition on the day` })),
        gate.ok
          ? el('button', {
            class: 'lt-primary', text: `Schedule — ${formatMoney(spec.cost)}`,
            onclick: () => askConfirm(`Stage the ${spec.name}? ${formatMoney(spec.cost)} now; the field arrives in ${spec.leadDays} days.`, 'Put it on', () => {
              const res = scheduleTournament(st, tier);
              toast(res.ok ? `${spec.name} — day ${res.day + 1}. Get the course ready.` : res.reason, res.ok ? '' : 'warn');
            }),
          })
          : chip(gate.reason, ''));
    };
    const offerRow = (o) => el('div', { class: 'lt-order' },
      el('span', { class: 'lt-alerticon', text: '🤝' }),
      el('div', { class: 'lt-orderbody' },
        el('div', { class: 'lt-ordername', text: `${o.company} outing — ${o.size} players` }),
        el('div', { class: 'lt-prodmeta', text: `pays ${formatMoney(o.payout)} · plays day ${o.day + 1}` })),
      el('button', {
        class: 'lt-primary', text: 'Accept',
        onclick: () => askConfirm(`Book ${o.company}'s outing for ${formatMoney(o.payout)}?`, 'Book it', () => {
          const res = acceptOuting(st, o.id);
          toast(res.ok ? `${o.company} is booked.` : res.reason, res.ok ? '' : 'warn');
        }),
      }),
      el('button', {
        class: 'lt-mini lt-cancel', text: 'Decline',
        onclick: () => askConfirm(`Turn down ${o.company}? The offer does not come back.`, 'Decline it', () => {
          declineOuting(st, o.id);
          toast(`${o.company} will go elsewhere.`);
        }),
      }));

    return [
      row(meta(`Prestige ${Math.round(prestige)} — the golf world's opinion. It rises with wins and good seasons, and it unlocks the locked cards.`)),
      el('div', { class: 'lt-upgrid' }, ...Object.entries(UPGRADES).map(([id, u]) => upgradeCard(st, id, u))),
      ev
        ? card(el('div', { class: 'lt-minihead', text: `🏆 ${TOURNAMENTS[ev.tier]?.name || 'Tournament'} — ${ev.day - cal.dayAbs === 0 ? 'today' : `in ${ev.day - cal.dayAbs} day${ev.day - cal.dayAbs === 1 ? '' : 's'}`}` }),
          row(meta(`Needs condition ${TOURNAMENTS[ev.tier]?.conditionReq}+ on the day. Current: ${Math.round(clubRatings(st).condition)}.`)))
        : null,
      hostReady ? sect('Events you can stage') : null,
      hostReady ? el('div', { class: 'lt-orderlist' }, ...Object.keys(TOURNAMENTS).map(tournamentRow)) : null,
      offers.length ? sect(`Outing offers (${offers.length})`) : null,
      offers.length ? el('div', { class: 'lt-orderlist' }, ...offers.map(offerRow)) : null,
    ];
  }

  function upgradesClubhouseTab(st) {
    const AMENITY_ICON = { range: '🎯', putting: '⛳', lounge: '🛋', lockers: '🚪', spa: '🧖', dining: '🍽' };
    const amenityRow = (key) => {
      const spec = AMENITIES[key];
      const level = st.club.amenities[key] || 0;
      const maxed = level >= spec.maxLevel;
      const cost = maxed ? 0 : spec.cost[level];
      return el('div', { class: 'lt-order' },
        el('span', { class: 'lt-alerticon', text: AMENITY_ICON[key] || '🏛' }),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: `${spec.name} — level ${level} of ${spec.maxLevel}` }),
          el('div', { class: 'lt-prodmeta', text: `upkeep ${formatMoney(spec.upkeepPerLevel)}/day per level` })),
        maxed ? chip('At its best', 'gold')
          : el('button', {
            class: 'lt-primary', text: `Upgrade — ${formatMoney(cost)}`,
            disabled: cashOf() < cost ? 'disabled' : undefined,
            onclick: () => askConfirm(`Take the ${spec.name.toLowerCase()} to level ${level + 1} for ${formatMoney(cost)}?`, 'Build it', () => {
              const res = upgradeAmenity(st, key);
              toast(res.ok ? `${spec.name} is now level ${level + 1}.` : res.reason, res.ok ? '' : 'warn');
            }),
          }));
    };
    const decorSkus = SHOP_CATALOG.filter((s) => s.cat === 'decor');
    const reno = st.shop.reno;
    const decorRow = (s) => {
      const placed = reno ? reno.decor.filter((d) => d.skuId === s.id).length : 0;
      const back = st.shop.inventory[s.id].back;
      return el('div', { class: 'lt-order' },
        thumbOf(s),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: s.name }),
          el('div', { class: 'lt-prodmeta', text: `${formatMoney(s.cost)} · ${placed} placed · ${back} in the back` })),
        el('button', {
          class: 'lt-mini',
          text: 'Order one',
          disabled: cashOf() < s.cost ? 'disabled' : undefined,
          onclick: () => {
            const res = placeOrder(st, s.id, 1);
            toast(res.ok ? `${s.name} ordered — place it by hand when it lands.` : res.reason, res.ok ? '' : 'warn');
            if (res.ok) click();
            render();
          },
        }));
    };
    const finishUi = ts('construction-finishes', { category: 'flooring', quality: 'municipal' });
    ensureConstructionFinishes(st);
    const category = CONSTRUCTION_CATEGORY_BY_ID[finishUi.category] || CONSTRUCTION_FINISH_CATEGORIES[0];
    const quality = CONSTRUCTION_QUALITY_BY_ID[finishUi.quality] || CONSTRUCTION_QUALITY_LEVELS[0];
    const installed = installedConstructionFinish(st, category.id);
    const categoryTabs = el('div', { class: 'lt-tabs' }, ...CONSTRUCTION_FINISH_CATEGORIES.map((entry) => el('button', {
      class: `lt-tab ${category.id === entry.id ? 'on' : ''}`, text: entry.label,
      onclick: () => { finishUi.category = entry.id; click(); render(); },
    })));
    const qualityTabs = el('div', { class: 'lt-tabs' }, ...CONSTRUCTION_QUALITY_LEVELS.map((entry) => el('button', {
      class: `lt-tab ${quality.id === entry.id ? 'on' : ''}`, text: entry.label,
      title: `${entry.craftsmanship}; ${entry.warrantyYears}-year warranty`,
      onclick: () => { finishUi.quality = entry.id; click(); render(); },
    })));
    const finishRow = (family) => {
      const variant = constructionFinishVariant(category.id, family.id, quality.id);
      const owned = ownsConstructionFinish(st, category.id, family.id, quality.id);
      const isInstalled = installed?.id === variant.id;
      return el('div', { class: 'lt-order' },
        el('span', { class: 'lt-alerticon', text: quality.level >= 5 ? '✦' : quality.level >= 3 ? '◆' : '▦' }),
        el('div', { class: 'lt-orderbody' },
          el('div', { class: 'lt-ordername', text: family.label }),
          el('div', { class: 'lt-prodmeta', text: `${variant.description} ${variant.rate.toFixed(2)} / ${variant.unit} · ${variant.warrantyYears}-year warranty.` })),
        isInstalled ? chip('Installed', 'gold') : el('button', {
          class: owned ? 'lt-mini' : 'lt-primary',
          text: owned ? 'Install' : `Buy — ${formatMoney(variant.cost)}`,
          disabled: !owned && cashOf() < variant.cost ? 'disabled' : undefined,
          onclick: () => askConfirm(
            owned
              ? `Install the ${variant.qualityLabel.toLowerCase()} ${variant.finishLabel.toLowerCase()} package? The owned package can be refitted at no charge.`
              : `Purchase and install ${variant.qualityLabel.toLowerCase()} ${variant.finishLabel.toLowerCase()} for ${formatMoney(variant.cost)}?`,
            owned ? 'Install it' : 'Purchase finish',
            () => {
              const res = purchaseConstructionFinish(st, category.id, family.id, quality.id);
              if (res.ok) { app.scene3d?.clubhouse?.()?.rebuildReno?.(); click(); render(); }
              toast(res.ok ? `${variant.finishLabel} — ${variant.qualityLabel} installed.` : res.reason, res.ok ? '' : 'warn');
            },
          ),
        }));
    };
    return [
      sect('Construction finishes — municipal to luxury country club'),
      note('Choose a construction family and one of five material grades. Every package is permanent once purchased; owned packages can be refitted without paying twice.'),
      categoryTabs,
      qualityTabs,
      row(meta(`Installed ${category.label.toLowerCase()}: ${installed?.finishLabel || 'None'} — ${installed?.qualityLabel || 'Unknown'}. Viewing ${quality.label.toLowerCase()} workmanship: ${quality.visual}.`)),
      el('div', { class: 'lt-orderlist' }, ...category.finishes.map(finishRow)),
      sect('Amenities'),
      el('div', { class: 'lt-orderlist' }, ...Object.keys(AMENITIES).map(amenityRow)),
      sect('Decor & fixtures — order here, place them in the room'),
      el('div', { class: 'lt-orderlist' }, ...decorSkus.map(decorRow)),
    ];
  }

  function upgradesStaffTab(st) {
    const cal = calendarOf(st.clock.minutes);
    refreshMarketIfDue(st, cal.dayAbs);
    const emp = st.staff.employees;
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

    const empRow = (e) => el('div', { class: 'lt-order' },
      el('div', { class: 'lt-avatar', text: (e.name || '?').slice(0, 1) }),
      el('div', { class: 'lt-orderbody' },
        el('div', { class: 'lt-ordername', text: e.name }),
        el('div', { class: 'lt-prodmeta', text: `${ROLE_LABEL[e.role] || e.role} · ${stars(e.skill)} · ${formatMoney(e.wage)}/day` })),
      e.trainingDays > 0 ? word('Training', 'warn') : word('On duty', 'ok'),
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
      }));

    const candRow = (c) => el('div', { class: 'lt-order' },
      el('div', { class: 'lt-avatar', text: (c.name || '?').slice(0, 1) }),
      el('div', { class: 'lt-orderbody' },
        el('div', { class: 'lt-ordername', text: c.name }),
        el('div', { class: 'lt-prodmeta', text: `${ROLE_LABEL[c.role] || c.role} · ${stars(c.skill)}` })),
      el('button', {
        class: 'lt-primary',
        text: `Hire — ${formatMoney(c.wage)}/day`,
        onclick: () => askConfirm(`Hire ${c.name} as ${ROLE_LABEL[c.role]} at ${formatMoney(c.wage)} a day?`, 'Hire them', () => {
          const res = hireStaff(st, c.id);
          toast(res.ok ? `${c.name} starts today.` : res.reason, res.ok ? '' : 'warn');
        }),
      }));

    return [
      row(meta(`Wage bill ${formatMoney(staffDailyWages(st))} a day. Groundskeepers add crew hours; a pro sells the big-ticket clubs.`)),
      sect(`Your staff (${emp.length})`),
      emp.length ? el('div', { class: 'lt-orderlist' }, ...emp.map(empRow)) : empty('Nobody works here but you.'),
      sect(`Available to hire (${st.staff.market.length})`),
      st.staff.market.length
        ? el('div', { class: 'lt-orderlist' }, ...st.staff.market.map(candRow))
        : empty('Nobody is looking for work this week.'),
    ];
  }

  function upgradesEquipmentTab(st) {
    const f = st.shop.rentalFleet;
    const tractorFixed = st.tractor && st.tractor.repaired;
    const tractorMissing = st.tractor ? TRACTOR_STEPS.filter((s2) => !st.tractor.steps[s2]) : [];
    return [
      card(
        el('div', { class: 'lt-minihead', text: 'Rental club sets' }),
        row(el('span', { class: 'lt-mulabel', text: 'Fleet' }),
          el('span', { style: 'font-size:0.84em;font-weight:600', text: `${f.sets} sets` }),
          chip(f.condition <= 15 ? 'Too rough to rent' : f.condition < 40 ? 'Needs replacing' : 'Serviceable', f.condition <= 15 ? 'bad' : f.condition < 40 ? 'warn' : 'ok')),
        row(
          el('span', { class: 'lt-mulabel', text: 'Buy sets' }),
          meta('a new set lifts the fleet average'),
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
      st.tractor
        ? card(
          el('div', { class: 'lt-minihead', text: 'Tractor' }),
          row(tractorFixed ? chip('Running', 'ok') : chip('Broken down', 'bad'),
            meta(tractorFixed ? 'parked by the shed' : `still needs: ${tractorMissing.map((s2) => STEP_LABEL[s2]).join(', ')} — hands-on at the machine`)),
        )
        : null,
      note('Turf machinery upgrades (mowers, irrigation) live under the Course tab — they are course improvements.'),
    ];
  }

  // ==========================================================================================
  // FINANCES — cash, today, one line chart, and the last ten money movements
  // ==========================================================================================
  function pageFinances() {
    const st = app.state;
    const fs = ts('finances', { win: 'week' });
    const revToday = sumLines(st.ledger?.today?.revenue);
    const expToday = sumLines(st.ledger?.today?.expense);
    const owed = arrearsOf(st);

    const hist = Array.isArray(st.ledger?.history) ? st.ledger.history : [];
    const windowDays = fs.win === 'season' ? 24 : 7;
    const days = hist.slice(-windowDays);
    const pts = days.map((d) => ({
      label: `Day ${(d.dayAbs ?? 0) + 1}`,
      rev: sumLines(d.revenue),
      exp: sumLines(d.expenses || d.expense),
    }));
    pts.push({ label: 'Today', rev: revToday, exp: expToday });

    const txAll = Array.isArray(st.ledger?.txLog) ? st.ledger.txLog : [];
    const REV_LABEL = {
      greenFees: 'Tee-time payment', dues: 'Membership dues', outings: 'Outing', range: 'Range',
      restaurant: 'Grill room', lessons: 'Lesson', shopSales: 'Pro-shop sale', rentals: 'Rental',
      fittings: 'Club fitting', reciprocal: 'Reciprocal', events: 'Event',
    };
    const EXP_LABEL = {
      wagesStaff: 'Employee pay', wagesDayLabor: 'Day labour', water: 'Water', fertilizer: 'Fertiliser',
      chemicals: 'Chemicals', upkeep: 'Upkeep', utilities: 'Utilities', works: 'Course works',
      severance: 'Severance', training: 'Training', shopOrders: 'Stock order',
      rentalFleet: 'Rental sets', events: 'Event costs', rent: 'Property bill',
      cashOverShort: 'Register over/short',
    };
    const txRow = (t) => {
      const c = calendarOf(t.m);
      const label = t.kind === 'rev' ? (REV_LABEL[t.key] || t.key) : (EXP_LABEL[t.key] || t.key);
      return el('tr', { title: `Balance after: ${exactMoney(t.bal)}` },
        el('td', { class: 'lt-listsub', text: `Day ${c.dayOfSeason} · ${clock12(c.minuteOfDay)}` }),
        el('td', {}, el('span', { style: 'font-weight:600', text: t.kind === 'refund' ? `${label} — refunded` : label })),
        el('td', {}, word(t.kind === 'exp' ? 'Expense' : t.kind === 'refund' ? 'Refund' : 'Income', t.kind === 'exp' ? '' : t.kind === 'refund' ? 'warn' : 'ok')),
        el('td', { class: 'lt-num' },
          el('div', { class: t.kind === 'exp' ? 'lt-neg' : 'lt-pos', text: `${t.kind === 'exp' ? '−' : '+'}${exactMoney(t.amt)}` }),
          el('div', { class: 'lt-listsub', text: `bal ${exactMoney(t.bal)}` })));
    };
    const rows = txAll.slice(-10).reverse().map(txRow);

    paint(
      head('Finances', 'Every cash movement routes through one ledger, so this history reconciles with the wallet to the cent.'),
      confirmBar(),
      el('div', { class: 'lt-stats lt-stats4' },
        stat('Current Cash', formatMoney(cashOf())),
        stat("Today's Revenue", formatMoney(revToday), null, revToday > 0 ? 'ok' : ''),
        stat("Today's Expenses", formatMoney(expToday), null, expToday > 0 ? 'bad' : ''),
        stat("Today's Profit", `${revToday - expToday >= 0 ? '+' : ''}${formatMoney(revToday - expToday)}`, null, revToday - expToday >= 0 ? 'ok' : 'bad'),
      ),
      owed > 0 ? errBox(`${formatMoney(owed)} behind on the property, and it accrues interest. It comes out of the next bill you can cover.`) : null,
      card(
        el('div', { class: 'lt-minihead' },
          el('span', { text: 'Revenue Trend' }),
          el('span', { class: 'lt-headspace' }),
          el('button', { class: `lt-day ${fs.win === 'week' ? 'on' : ''}`, text: '7 days', onclick: () => { fs.win = 'week'; click(); render(); } }),
          el('button', { class: `lt-day ${fs.win === 'season' ? 'on' : ''}`, text: 'Season', onclick: () => { fs.win = 'season'; click(); render(); } })),
        pts.length >= 2
          ? lineChart({
            series: [
              { label: 'Earned', color: SERIES.revenue, values: pts.map((p) => p.rev) },
              { label: 'Spent', color: SERIES.expenses, values: pts.map((p) => p.exp), dash: true },
            ],
            labels: pts.map((p) => p.label),
            h: 130,
          })
          : empty('The chart starts once a day has closed on the books.'),
      ),
      sect('Recent Transactions'),
      rows.length
        ? card(el('table', { class: 'lt-table' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'When' }), el('th', { text: 'Description' }), el('th', { text: 'Type' }),
            el('th', { class: 'lt-num', text: 'Amount' }))),
          el('tbody', {}, ...rows)))
        : empty('Money movements appear here as they happen.'),
    );
  }

  // ==========================================================================================
  // SETTINGS — small, honest, and everything on it works
  // ==========================================================================================
  function pageSettings() {
    const st = app.state;
    const prefs = prefsOf();
    const checkoutPrefs = checkoutPreferences(st);

    const checkRow = (label, detail, checked, onchange) => el('label', { class: 'lt-row' },
      el('input', { type: 'checkbox', class: 'lt-check', checked: checked ? 'checked' : undefined, onchange }),
      el('span', {},
        el('div', { style: 'font-size:0.84em;font-weight:600', text: label }),
        el('div', { class: 'lt-meta', text: detail })));

    // master volume — the audio engine's own persisted setting, not a fake knob
    const audio = app.audio;
    const volOut = el('span', { class: 'lt-mupct', text: audio ? `${Math.round((audio.getVolume ? audio.getVolume() : 0.8) * 100)}%` : '—' });
    const volRange = el('input', {
      type: 'range', min: '0', max: '100', step: '5', class: 'lt-range',
      value: String(Math.round((audio && audio.getVolume ? audio.getVolume() : 0.8) * 100)),
      disabled: audio ? undefined : 'disabled',
      oninput: (e) => {
        if (!audio || !audio.setVolume) return;
        const v = Number(e.target.value) / 100;
        audio.setVolume(v);
        volOut.textContent = `${Math.round(v * 100)}%`;
      },
    });

    paint(
      head('Settings'),
      confirmBar(),
      card(
        el('div', { class: 'lt-minihead', text: 'Sound' }),
        row(el('span', { class: 'lt-mulabel', text: 'Volume' }), volRange, volOut),
        audio ? null : row(meta('Sound wakes with your first click in the world.')),
        audio && audio.setMuted
          ? checkRow('Mute everything', 'Silence the whole game, laptop included.', audio.isMuted && audio.isMuted(),
            (e) => { audio.setMuted(!!e.target.checked); toast(e.target.checked ? 'Muted.' : 'Sound is back.'); })
          : null,
        checkRow('Laptop sounds', 'Clicks and chimes on this screen.', prefs.uiSounds !== false,
          (e) => { prefs.uiSounds = !!e.target.checked; toast(prefs.uiSounds ? 'Sounds on.' : 'Sounds off.'); }),
      ),
      card(
        el('div', { class: 'lt-minihead', text: 'Display' }),
        row(
          el('span', { class: 'lt-mulabel', text: 'Text size' }),
          ...[0.9, 1, 1.15, 1.3].map((s) => el('button', {
            class: `lt-day ${Math.abs(scale - s) < 0.01 ? 'on' : ''}`,
            text: `${Math.round(s * 100)}%`,
            onclick: () => { setScale(s); prefs.laptopScale = s; click(); render(); },
          })),
        ),
      ),
      card(
        el('div', { class: 'lt-minihead', text: 'Game' }),
        checkRow('Notification badge', 'Show the red unread count on the bell.', prefs.notifBadge !== false,
          (e) => { prefs.notifBadge = !!e.target.checked; toast(prefs.notifBadge ? 'Badge on.' : 'Badge hidden — the bell still keeps the list.'); render(); }),
        checkRow('Confirm every purchase', 'When off, stock orders under $100 skip the confirmation step.', prefs.confirmOrders !== false,
          (e) => { prefs.confirmOrders = !!e.target.checked; toast(prefs.confirmOrders ? 'Every order asks first.' : 'Small orders go straight through.'); }),
        row(el('span', { class: 'lt-mulabel', text: 'Club name' }),
          el('input', {
            class: 'lt-input', type: 'text', value: st.clubName || '',
            onchange: (e) => {
              const v = e.target.value.trim();
              if (!v) { toast('The club needs a name.', 'warn'); e.target.value = st.clubName; return; }
              st.clubName = v;
              toast(`The club is now ${v}.`);
              render();
            },
          })),
        row(el('span', { class: 'lt-mulabel', text: 'Hours' }),
          meta(`Shop ${hour12(SHOP_OPEN_MIN)}–${hour12(SHOP_CLOSE_MIN)} · tee times ${hour12(TEE_SHEET.openMin)}–${hour12(TEE_SHEET.closeMin)} · autosave nightly`)),
      ),
      card(
        el('div', { class: 'lt-minihead', text: 'Checkout accessibility' }),
        checkRow('Larger POS text and targets', 'Enlarges register copy and the safe click area around products, payment, and monitor controls.', checkoutPrefs.largeTextAndTargets,
          (e) => {
            setCheckoutPreference(st, 'largeTextAndTargets', !!e.target.checked);
            toast(e.target.checked ? 'Checkout text and targets enlarged.' : 'Checkout text and targets use standard size.');
          }),
        checkRow('Reduced checkout camera motion', 'Uses stable camera cuts and disables cursor-driven head sway at the register.', checkoutPrefs.reducedCameraMotion,
          (e) => {
            setCheckoutPreference(st, 'reducedCameraMotion', !!e.target.checked);
            toast(e.target.checked ? 'Checkout camera motion reduced.' : 'Checkout camera easing restored.');
          }),
        checkRow('Faster checkout animations', 'Shortens product, payment, drawer, receipt, and handoff choreography without skipping steps.', checkoutPrefs.fasterAnimations,
          (e) => {
            setCheckoutPreference(st, 'fasterAnimations', !!e.target.checked);
            toast(e.target.checked ? 'Checkout animations accelerated.' : 'Checkout animations use standard timing.');
          }),
        checkRow('Automatic exact change', 'Counts the fewest exact pieces the current drawer can safely provide; Undo and Clear still work.', checkoutPrefs.automaticExactChange,
          (e) => {
            setCheckoutPreference(st, 'automaticExactChange', !!e.target.checked);
            toast(e.target.checked ? 'Exact-change assistance on.' : 'Change selection is manual.');
          }),
        checkRow('Confirm cash purchases', 'When off, exact change hands over automatically. Card purchases still require the reader’s one Confirm.', checkoutPrefs.confirmCashPurchase,
          (e) => {
            setCheckoutPreference(st, 'confirmCashPurchase', !!e.target.checked);
            toast(e.target.checked ? 'Exact cash waits for Done.' : 'Exact cash hands over automatically.');
          }),
      ),
      row(el('span', { class: 'lt-headspace' }), primaryBtn('Close Laptop', () => opts.close())),
    );
  }

  // --- shell --------------------------------------------------------------------------------

  const PAGES = {
    home: pageHome,
    reservations: pageReservations,
    shop: pageShop,
    course: pageCourse,
    upgrades: pageUpgrades,
    finances: pageFinances,
    settings: pageSettings,
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
    // the modal rides above whatever page just painted — one layer, owned by the shell
    const overlay = modalLayer();
    if (overlay) content.appendChild(overlay);
  }

  let liveTimer = null;

  return {
    root,
    open(startPage) {
      page = 'home';
      history = [];
      cart = new Map();
      pending = null;
      modal = null;
      const prefs = app.state && app.state.uiPrefs;
      if (prefs && Number.isFinite(prefs.laptopScale)) scale = prefs.laptopScale;
      if (startPage) {
        const alias = PAGE_ALIAS[startPage];
        if (alias) {
          if (alias[1]) ts(alias[0]).tab = alias[1];
          page = alias[0];
        } else if (PAGES[startPage]) page = startPage;
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
      modal = null;
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

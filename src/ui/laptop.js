// FAIRWAY OFFICE — the clubhouse's operating system.
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
import { capacityOf } from '../data/fixtureSlots.js';
import {
  placeOrder, cancelOrder, orderCost, shopCondition, priceFor,
  velocity, daysOfSupply, buyRentalSets,
} from '../sim/shop.js';
import {
  boxesOf, shipmentsOf, shipmentStatus, padCount, PAD_CAPACITY, boxOpened,
} from '../sim/deliveries.js';
import { planShipment, unitsPerBox } from '../data/boxes.js';
import { supplierFor } from '../data/suppliers.js';
import { TEE_SHEET, daySheet, bookSlot, cancelReservation, fmtSlot } from '../sim/reservations.js';
import { reviewSummary, explainVisitors } from '../sim/reviews.js';
import { weeklyCharge, propertyLine, arrearsOf } from '../sim/property.js';
import { members } from '../sim/golfers.js';
import {
  ROLE, hireStaff, fireStaff, trainStaff, staffDailyWages, refreshMarketIfDue,
} from '../sim/staff.js';
import { clubRatings, fairGreenFee } from '../sim/club.js';
import { currentStep } from '../sim/tutorial.js';
import { ZONE } from '../sim/constants.js';

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
  { id: 'home', icon: '🏠', label: 'Home' },
  { group: 'Shop' },
  { id: 'shop', icon: '🏪', label: 'Pro Shop' },
  { id: 'supplier', icon: '🛒', label: 'Supplier' },
  { id: 'orders', icon: '📦', label: 'Orders' },
  { id: 'deliveries', icon: '🚚', label: 'Deliveries' },
  { id: 'inventory', icon: '📋', label: 'Inventory' },
  { id: 'pricing', icon: '🏷', label: 'Pricing' },
  { group: 'Club' },
  { id: 'reservations', icon: '📅', label: 'Reservations' },
  { id: 'course', icon: '⛳', label: 'Course' },
  { id: 'rentals', icon: '🛄', label: 'Carts & rentals' },
  { id: 'employees', icon: '👥', label: 'Employees' },
  { group: 'Books' },
  { id: 'finances', icon: '💰', label: 'Finances' },
  { id: 'reviews', icon: '⭐', label: 'Reviews' },
  { id: 'analytics', icon: '📈', label: 'Analytics' },
  { group: 'Estate' },
  { id: 'reno', icon: '🔨', label: 'Renovation' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
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

export function makeLaptop(app, opts) {
  let page = 'home';
  let history = [];        // the Back stack — every navigation pushes, Back pops
  let cart = new Map();    // supplier basket: skuId -> qty
  let teeDay = 0;
  let supplierCat = 'all';
  let financeWindow = 'today';
  let scale = 1;           // interface scale, for anyone who finds 15px small on a 4K panel
  let pending = null;      // the live confirmation, if one is open

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

  const nav = el('nav', { class: 'lt-nav' },
    el('div', { class: 'lt-brand' }, el('span', { text: '⛳' }), el('span', { text: 'Fairway Office' })),
    el('div', { class: 'lt-navlist' },
      ...NAV.map((n) => {
        if (n.group) return el('div', { class: 'lt-navgroup', text: n.group });
        const b = el('button', { class: 'lt-navbtn', title: n.label, onclick: () => go(n.id) },
          el('span', { class: 'lt-navicon', text: n.icon }), el('span', { text: n.label }));
        navBtns[n.id] = b;
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
    statusbar.replaceChildren(
      el('button', { class: 'lt-crumb', title: 'Back', text: '‹', disabled: history.length ? undefined : 'disabled', onclick: () => back() }),
      el('button', { class: 'lt-crumb', title: 'Home', text: '⌂', onclick: () => go('home') }),
      el('span', { class: 'lt-statusname', text: st.clubName || 'The Club' }),
      el('span', { text: `Y${cal.year} · ${cal.seasonName} · Day ${cal.dayOfSeason}` }),
      el('span', { text: clock12(cal.minuteOfDay) }),
      el('span', { class: `lt-chip ${shopIsOpen(st) ? 'ok' : ''}`, text: shopIsOpen(st) ? 'Shop open' : 'Shop closed' }),
      el('span', { class: 'lt-cash', text: formatMoney(cashOf()) }),
    );
  }

  // =========================================================================================
  // 1. HOME
  // =========================================================================================
  function pageHome() {
    const st = app.state;
    const cal = calendarOf(st.clock.minutes);
    const w = st.weather.today;
    const sheet = daySheet(st, cal.dayAbs);
    const booked = sheet.filter((s) => s.res);
    const lowLines = retailSkus(st).filter((s) => st.shop.inventory[s.id].shelf === 0);
    const thinLines = retailSkus(st).filter((s) => {
      const e = st.shop.inventory[s.id];
      return e.shelf > 0 && e.shelf < 3;
    });
    const rs = reviewSummary(st, { waitedSec: 0, queueLen: 0, played: true });
    const cond = shopCondition(st);
    const ratings = clubRatings(st);
    const step = st.tutorial && !st.tutorial.complete ? currentStep(st) : null;
    const wages = staffDailyWages(st);
    const rent = weeklyCharge(st);
    const owed = arrearsOf(st);
    const inbound = st.shop.orders;
    const nextIn = inbound.slice().sort((a, b) => a.deliveryMin - b.deliveryMin)[0];
    const boxes = boxesOf(st).filter((b) => b.loc !== 'gone');

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
        'Everything on this page is read live from the club. The tiles below jump straight to the application that owns each number.'),

      el('div', { class: 'lt-stats' },
        stat('Cash', formatMoney(cashOf()), owed > 0 ? `${formatMoney(owed)} in arrears` : 'no arrears', owed > 0 ? 'bad' : ''),
        stat('Weather', `${Math.round(w.tempHiF)}°F`, w.rainIn > 0.02 ? `rain ${w.rainIn.toFixed(2)}"` : 'dry'),
        stat('Visitors', `${st.club.lastRounds || 0}`, 'rounds yesterday'),
        stat('Reviews', rs.count ? `${rs.average} ★` : '—', rs.count ? `${rs.count} in` : 'nobody yet'),
        stat('Shop floor', `${Math.round((1 - grimeAvgOf(st)) * 100)}% clean`, `condition ${cond}`, cond < 45 ? 'bad' : ''),
        stat('Course', `${Math.round(ratings.overall)}`, `condition ${Math.round(ratings.condition)}`),
      ),

      step ? el('div', { class: 'lt-card lt-objective' },
        el('div', { class: 'lt-objlabel', text: 'Current objective' }),
        el('div', { class: 'lt-objtitle', text: step.title }),
        el('div', { class: 'lt-objbody', text: step.body || '' }),
      ) : null,

      sect('Today'),
      el('div', { class: 'lt-cols' },
        card(
          el('div', { class: 'lt-minihead', text: '📅  Reservations' }),
          booked.length
            ? el('div', {}, ...booked.slice(0, 4).map((s) => row(
              el('span', { class: 'lt-slottime', text: fmtSlot(s.minute) }),
              el('span', { text: s.res.name }),
              meta(formatMoney(s.res.fee)))),
            booked.length > 4 ? meta(`+${booked.length - 4} more`) : null)
            : empty('Nothing booked today.'),
          el('button', { class: 'lt-mini', text: 'Open the tee sheet', onclick: () => go('reservations') }),
        ),
        card(
          el('div', { class: 'lt-minihead', text: '🚚  Deliveries' }),
          inbound.length || boxes.length
            ? el('div', {},
              nextIn ? row(el('span', { text: skuById(nextIn.skuId).name }),
                meta(`${ORDER_STATUS[nextIn.status] ? ORDER_STATUS[nextIn.status].label : nextIn.status} · ${hour12(nextIn.window.open)}–${hour12(nextIn.window.close)}`)) : null,
              inbound.length > 1 ? meta(`${inbound.length - 1} more on the way`) : null,
              boxes.length ? row(chip(`${boxes.length} box${boxes.length === 1 ? '' : 'es'} to unpack`, 'warn')) : null)
            : empty('Nothing on the truck.'),
          el('button', { class: 'lt-mini', text: 'Track deliveries', onclick: () => go('deliveries') }),
        ),
        card(
          el('div', { class: 'lt-minihead', text: '⚠  Low stock' }),
          lowLines.length || thinLines.length
            ? el('div', {},
              ...lowLines.slice(0, 4).map((s) => row(el('span', { text: s.name }), chip(st.shop.inventory[s.id].back > 0 ? 'shelve it' : 'out', st.shop.inventory[s.id].back > 0 ? 'warn' : 'bad'))),
              ...thinLines.slice(0, 2).map((s) => row(el('span', { text: s.name }), chip(`${st.shop.inventory[s.id].shelf} left`, 'warn'))))
            : empty('Every line has stock on the shelf.'),
          el('button', { class: 'lt-mini', text: 'Open inventory', onclick: () => go('inventory') }),
        ),
      ),

      sect('Upcoming expenses'),
      card(
        row(el('span', { class: 'lt-mulabel', text: 'Property' }), meta(propertyLine(st, cal.dayAbs)), chip(`${formatMoney(rent)} / week`, owed > 0 ? 'bad' : '')),
        row(el('span', { class: 'lt-mulabel', text: 'Wages' }), meta(`${st.staff.employees.length} on the books`), chip(`${formatMoney(wages)} / day`)),
        row(el('span', { class: 'lt-mulabel', text: 'On the truck' }), meta(`${inbound.length} order${inbound.length === 1 ? '' : 's'} already paid for`), chip(formatMoney(inbound.reduce((a, o) => a + o.cost, 0)))),
      ),

      sect('Jump to'),
      el('div', { class: 'lt-tiles' },
        jump('🛒', 'Supplier', 'restock the shop', 'supplier'),
        jump('🏷', 'Pricing', 'set what you charge', 'pricing'),
        jump('📈', 'Analytics', 'what changed, and why', 'analytics'),
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
      const capacity = skus.reduce((sum, sku) => sum + capacityOf(sku.id), 0);
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

    const cats = ['balls', 'accessories', 'apparel', 'clubs', 'supplies', 'decor'];
    const tabs = el('div', { class: 'lt-tabs' },
      el('button', {
        class: `lt-tab ${supplierCat === 'all' ? 'on' : ''}`, text: 'All',
        onclick: () => { supplierCat = 'all'; click(); render(); },
      }),
      ...cats.map((c) => el('button', {
        class: `lt-tab ${supplierCat === c ? 'on' : ''}`, text: CAT_LABEL[c],
        onclick: () => { supplierCat = c; click(); render(); },
      })));

    const shown = SHOP_CATALOG.filter((s) => (supplierCat === 'all' ? true : s.cat === supplierCat));
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
      el('div', { class: 'lt-grid' }, ...cards),
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
        chip(s.label, s.tone));
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
    const rows = retailSkus(st).map((s) => {
      const e = inv[s.id];
      const cap = capacityOf(s.id) || SHELF_CAP[s.cat];
      const incoming = incomingOf(st, s.id);
      const v = velocity(st, s.id);
      const dos = daysOfSupply(st, s.id);
      const retail = priceFor(s, st.shop.markup[s.cat] || 1, null);
      const margin = retail > 0 ? (retail - s.cost) / retail : 0;
      const reorder = Math.max(2, Math.ceil(v * LEAD_DAYS[s.cat])); // enough to survive the lead time
      const short = e.shelf + e.back <= reorder;
      return el('tr', { class: short ? 'lt-tr-warn' : '' },
        el('td', {}, el('div', { class: 'lt-invcell' }, thumbOf(s), el('span', { text: s.name }))),
        el('td', { class: 'lt-num', text: `${e.shelf}/${cap}` }),
        el('td', { class: 'lt-num', text: String(e.back) }),
        el('td', { class: 'lt-num', text: incoming ? `+${incoming}` : '—' }),
        el('td', { class: 'lt-num', text: v ? v.toFixed(1) : '—' }),
        el('td', { class: 'lt-num', text: dos === Infinity ? '∞' : dos ? dos.toFixed(1) : '0' }),
        el('td', { class: 'lt-num', text: formatMoney(s.cost) }),
        el('td', { class: 'lt-num', text: formatMoney(retail) }),
        el('td', { class: 'lt-num', text: pct(margin) }),
        el('td', {}, e.shelf === 0
          ? chip(e.back > 0 ? 'shelve it' : 'OUT', e.back > 0 ? 'warn' : 'bad')
          : short ? chip('reorder', 'warn') : chip('ok', 'ok')),
      );
    });
    const locked = SHOP_CATALOG.filter((s) => RETAIL_CATS.has(s.cat) && s.tier > st.shop.unlockedTier);
    const anyMoved = retailSkus(st).some((s) => velocity(st, s.id) > 0);

    paint(
      head('Inventory', 'Sold/day is a real seven-day average of what actually left the building — both the sales you rang up and the ones the shop made while you were out on the course. Days of supply is what is on hand divided by that.'),
      confirmBar(),
      !anyMoved
        ? note('No closed trading days on the books yet, so there is no velocity to average. Sold/day and days-of-supply fill in from tomorrow.')
        : null,
      card(el('div', { class: 'lt-scrollx' }, el('table', { class: 'lt-table lt-invtable' },
        el('thead', {}, el('tr', {},
          el('th', { text: 'Product' }),
          el('th', { class: 'lt-num', title: 'On the shelf / shelf capacity', text: 'Shelf' }),
          el('th', { class: 'lt-num', text: 'Back' }),
          el('th', { class: 'lt-num', text: 'Incoming' }),
          el('th', { class: 'lt-num', text: 'Sold/day' }),
          el('th', { class: 'lt-num', title: 'How long the stock on hand lasts at that rate', text: 'Days' }),
          el('th', { class: 'lt-num', text: 'Cost' }),
          el('th', { class: 'lt-num', text: 'Retail' }),
          el('th', { class: 'lt-num', text: 'Margin' }),
          el('th', { text: '' }))),
        el('tbody', {}, ...rows)))),
      locked.length
        ? card(el('div', { class: 'lt-minihead', text: '🔒  Not unlocked' }),
          ...locked.map((s) => row(el('span', { text: s.name }), meta(`needs supplier tier ${s.tier}`))))
        : null,
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
    const ms = members(st);
    const nameSel = el('select', { class: 'lt-select' },
      el('option', { value: '', text: 'Walk-in guest' }),
      ...ms.slice(0, 40).map((m) => el('option', { value: m.name, text: m.name })));

    const dayAbs = calendarOf(st.clock.minutes).dayAbs + teeDay;
    const sheet = daySheet(st, dayAbs);
    const booked = sheet.filter((s) => s.res);
    const free = sheet.length - booked.length;
    const takings = booked.reduce((a, s) => a + (s.res.fee || 0), 0);

    const slots = sheet.map((s) => {
      const r = s.res;
      return el('div', { class: `lt-slot ${r ? 'booked' : ''}` },
        el('span', { class: 'lt-slottime', text: fmtSlot(s.minute) }),
        r
          ? el('span', { class: 'lt-slotwho' },
            el('span', { text: r.name }),
            chip(r.status === 'played' ? 'checked in' : r.status === 'noShow' ? 'no-show' : 'booked',
              r.status === 'played' ? 'ok' : r.status === 'noShow' ? 'bad' : ''),
            meta(formatMoney(r.fee)),
            r.status === 'booked'
              ? el('button', {
                class: 'lt-mini lt-cancel',
                text: 'Cancel',
                onclick: () => askConfirm(`Cancel ${r.name}'s ${fmtSlot(s.minute)} tee time?`, 'Cancel the booking', () => {
                  cancelReservation(st, r.id);
                  toast(`${r.name}'s ${fmtSlot(s.minute)} is free again.`);
                }),
              })
              : null)
          : el('button', {
            class: 'lt-mini lt-book',
            text: 'Book',
            onclick: () => {
              const name = nameSel.value || `Guest ${Math.floor(Math.random() * 900) + 100}`;
              const res = bookSlot(st, dayAbs, s.minute, name);
              if (!res.ok) toast(res.reason, 'warn');
              else { toast(`${name} booked for ${fmtSlot(s.minute)}.`); click(); }
              render();
            },
          }),
      );
    });

    paint(
      head('Reservations', 'Booked golfers walk into the shop around their time. The green fee is collected at the counter when you check them in — not when they book.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Booked' }), el('div', { class: 'lt-statvalue', text: String(booked.length) }), el('div', { class: 'lt-statsub', text: `of ${sheet.length} slots` })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Open' }), el('div', { class: 'lt-statvalue', text: String(free) }), el('div', { class: 'lt-statsub', text: 'still available' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Expected' }), el('div', { class: 'lt-statvalue', text: formatMoney(takings) }), el('div', { class: 'lt-statsub', text: 'in green fees' })),
      ),
      card(row(el('span', { class: 'lt-mulabel', text: 'Day' }), ...dayBtns),
        row(el('span', { class: 'lt-mulabel', text: 'Golfer' }), nameSel, meta('members book by name; walk-ins get a guest slip'))),
      booked.length || free
        ? el('div', { class: 'lt-card lt-slots' }, ...slots)
        : empty('The sheet is closed for this day.'),
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

    const holes = st.course.holes.map((h, i) => row(
      el('span', { text: `Hole ${i + 1}` }),
      chip(h.status, h.status === 'open' ? 'ok' : 'warn')));
    const closed = st.course.holes.filter((h) => h.status !== 'open').length;

    paint(
      head('Course', 'Health, moisture and wear are averaged live over the cells that belong to each zone. Irrigation is a policy the crew follows at dawn — the club has no sprinkler hardware to fail.'),
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
      note('Mowing, watering and fertiliser policy live at the Grounds desk. Course surgery is done on the wall map, at the overview camera.'),
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
    };

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
    const windows = {
      today: { label: 'Today', data: today },
      week: { label: 'Last 7 days', data: sumOf(hist.slice(-7)) },
      month: { label: 'Last 24 days', data: sumOf(hist.slice(-24)) },
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

    const histRows = hist.slice(-10).reverse().map((d) => {
      const r = Object.values(d.revenue || {}).reduce((a, v) => a + v, 0);
      const e = Object.values(d.expenses || d.expense || {}).reduce((a, v) => a + v, 0);
      return row(
        el('span', { text: d.label || `Day ${d.dayAbs ?? ''}` }),
        meta(`in ${formatMoney(r)} · out ${formatMoney(e)}`),
        chip(`${r - e >= 0 ? '+' : ''}${formatMoney(r - e)}`, r - e >= 0 ? 'ok' : 'bad'));
    });

    paint(
      head('Finances', 'Every cash movement in the club routes through this ledger, so it reconciles: across any midnight-to-midnight window, the net equals the cash that actually moved.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Cash' }), el('div', { class: 'lt-statvalue', text: formatMoney(cashOf()) }), el('div', { class: 'lt-statsub', text: 'empire-wide wallet' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: `Net · ${w.label.toLowerCase()}` }), el('div', { class: `lt-statvalue ${net >= 0 ? 'ok' : 'bad'}`, text: `${net >= 0 ? '+' : ''}${formatMoney(net)}` }), el('div', { class: 'lt-statsub', text: `${formatMoney(rev)} in, ${formatMoney(exp)} out` })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Property' }), el('div', { class: 'lt-statvalue', text: formatMoney(weeklyCharge(st)) }), el('div', { class: 'lt-statsub', text: 'per week' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Wages' }), el('div', { class: 'lt-statvalue', text: formatMoney(staffDailyWages(st)) }), el('div', { class: 'lt-statsub', text: 'per day' })),
      ),
      owed > 0 ? errBox(`${formatMoney(owed)} in arrears on the property, and it is accruing interest. It comes out of the next bill you can cover.`) : null,
      tabs,
      table(w.data),
      sect('Upcoming'),
      card(row(el('span', { text: 'Property' }), meta(propertyLine(st, cal.dayAbs)), chip(formatMoney(weeklyCharge(st)))),
        row(el('span', { text: 'Stock already paid for' }), meta(`${st.shop.orders.length} order${st.shop.orders.length === 1 ? '' : 's'} on the truck`), chip(formatMoney(st.shop.orders.reduce((a, o) => a + o.cost, 0))))),
      sect('Recent days'),
      histRows.length ? card(...histRows) : empty('The books fill in as days close.'),
    );
  }

  // =========================================================================================
  // 13. REVIEWS
  // =========================================================================================
  function pageReviews() {
    const st = app.state;
    const s = reviewSummary(st, { waitedSec: 0, queueLen: 0, played: true });
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

    const factorBar = (f) => {
      const p = Math.round(f.score * 100);
      const tone = f.score >= 0.7 ? 'ok' : f.score >= 0.45 ? '' : 'bad';
      return el('div', { class: 'lt-facrow' },
        el('span', { class: 'lt-faclabel', text: f.label }),
        el('div', { class: 'lt-facbar' }, el('div', { class: `lt-facfill ${tone}`, style: `width:${p}%` })),
        el('span', { class: 'lt-facpct', text: `${p}` }));
    };

    paint(
      head('Reviews', 'Every bar below is read from the same model that decides what a visitor writes. The one at the bottom is what they are complaining about — fix that and the score follows.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Score' }), el('div', { class: 'lt-statvalue', text: s.count ? `${s.average} ★` : '—' }), el('div', { class: 'lt-statsub', text: s.count ? `${s.count} reviews` : 'nobody has been in' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Reputation' }), el('div', { class: 'lt-statvalue', text: String(Math.round(st.club.reputation)) }), el('div', { class: 'lt-statsub', text: 'word of mouth' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Worst factor' }), el('div', { class: `lt-statvalue ${s.worst && s.worst.score < 0.5 ? 'bad' : ''}`, text: s.worst ? `${Math.round(s.worst.score * 100)}` : '—' }), el('div', { class: 'lt-statsub', text: s.worst ? s.worst.label.toLowerCase() : '' })),
      ),
      sect('What they are judging you on, right now'),
      card(...s.byFactor.map(factorBar)),
      s.worst && s.worst.score < 0.5
        ? errBox(`Biggest complaint: ${s.worst.label.toLowerCase()}.`)
        : note('Nothing is badly letting you down at the moment.'),
      sect('Recent'),
      s.recent.length
        ? card(...s.recent.map((r) => el('div', { class: 'lt-review' },
          el('div', { class: 'lt-revstars', text: stars(r.stars) }),
          el('div', { class: 'lt-revtext', text: r.text }),
          el('div', { class: 'lt-revday', text: `Day ${r.day}` }))))
        : empty('Reviews land as people come through.'),
    );
  }

  // =========================================================================================
  // 14. ANALYTICS
  // =========================================================================================
  function pageAnalytics() {
    const st = app.state;
    const led = st.ledger || {};
    const hist = Array.isArray(led.history) ? led.history : [];
    const y = st.shop.salesYesterday;
    const lost = st.shop.lostSalesYesterday || 0;

    // WHY did the gate move? The sim can explain itself — explainVisitors reads the same factors
    // the golfers actually used to decide, and hands back one sentence saying so.
    const why = explainVisitors(st, {
      today: st.club.lastRounds || 0,
      yesterday: st.club.prevRounds || 0,
      rainedToday: st.weather.today.rainIn > 0.1,
    });

    // best sellers and sellouts, from the real seven-day per-SKU window
    const ranked = retailSkus(st)
      .map((s) => ({ sku: s, v: velocity(st, s.id), inv: st.shop.inventory[s.id] }))
      .sort((a, b) => b.v - a.v);
    const movers = ranked.filter((r) => r.v > 0).slice(0, 6);
    const sellouts = ranked.filter((r) => r.inv.shelf === 0 && r.inv.back === 0);
    const dead = ranked.filter((r) => r.v === 0 && r.inv.shelf + r.inv.back > 0);

    // a simple 10-day net sparkline from the closed books
    const spark = hist.slice(-10).map((d) => {
      const r = Object.values(d.revenue || {}).reduce((a, v) => a + v, 0);
      const e = Object.values(d.expenses || d.expense || {}).reduce((a, v) => a + v, 0);
      return r - e;
    });
    const peak = Math.max(1, ...spark.map((v) => Math.abs(v)));
    const trend = spark.length >= 2 ? spark[spark.length - 1] - spark[0] : 0;

    paint(
      head('Analytics', 'Movers and sellouts come from a real seven-day record of what left the building — both the sales you rang up by hand and the ones the shop made while you were out.'),
      confirmBar(),
      el('div', { class: 'lt-stats' },
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Rounds' }), el('div', { class: 'lt-statvalue', text: String(st.club.lastRounds || 0) }), el('div', { class: 'lt-statsub', text: 'yesterday' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Shop sales' }), el('div', { class: 'lt-statvalue', text: String(y.units) }), el('div', { class: 'lt-statsub', text: formatMoney(y.revenue) })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Walked out' }), el('div', { class: `lt-statvalue ${lost ? 'bad' : 'ok'}`, text: String(lost) }), el('div', { class: 'lt-statsub', text: 'bought nothing' })),
        el('div', { class: 'lt-stat' }, el('div', { class: 'lt-statlabel', text: 'Members' }), el('div', { class: 'lt-statvalue', text: String(members(st).length) }), el('div', { class: 'lt-statsub', text: 'on the roll' })),
      ),

      why ? el('div', {}, sect('Why the gate moved'), card(el('div', { class: 'lt-why', text: why }))) : null,

      sect('Net, last 10 closed days'),
      spark.length
        ? card(el('div', { class: 'lt-spark' }, ...spark.map((v) => el('div', {
          class: `lt-sparkbar ${v >= 0 ? 'pos' : 'neg'}`,
          style: `height:${Math.max(3, (Math.abs(v) / peak) * 56)}px`,
          title: formatMoney(v),
        }))),
        row(meta(spark.length >= 2
          ? `${trend >= 0 ? 'Up' : 'Down'} ${formatMoney(Math.abs(trend))} a day across the window.`
          : 'One day on the books so far.')))
        : empty('No closed days yet.'),

      sect('Best sellers'),
      movers.length
        ? card(...movers.map((r) => row(
          thumbOf(r.sku),
          el('span', { text: r.sku.name }),
          el('div', { class: 'lt-bar lt-barwide' }, el('div', { class: 'lt-barfill ok', style: `width:${(r.v / movers[0].v) * 100}%` })),
          meta(`${r.v.toFixed(1)} / day`))))
        : empty('Nothing has sold in a closed day yet.'),

      sect('Sold out'),
      sellouts.length
        ? card(...sellouts.map((r) => row(
          el('span', { text: r.sku.name }),
          meta(r.v > 0 ? `was moving ${r.v.toFixed(1)} a day` : 'never stocked'),
          chip('nothing left', 'bad'),
          el('button', { class: 'lt-mini', text: 'Reorder', onclick: () => { cart.set(r.sku.id, (cart.get(r.sku.id) || 0) + 6); go('supplier'); } }))))
        : empty('Nothing is sold out.'),

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
    const ui = app.ui || (app.ui = {});

    const scaleRow = row(
      el('span', { class: 'lt-mulabel', text: 'Interface scale' }),
      ...[0.9, 1, 1.15, 1.3].map((s) => el('button', {
        class: `lt-day ${Math.abs(scale - s) < 0.01 ? 'on' : ''}`,
        text: `${Math.round(s * 100)}%`,
        onclick: () => { setScale(s); click(); render(); },
      })),
      meta('the screen is a real object at a real distance — make the type bigger if it reads small'),
    );

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
      card(scaleRow),
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

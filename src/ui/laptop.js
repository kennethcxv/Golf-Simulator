// FAIRWAY OFFICE — the laptop's operating portal. This is diegetic software:
// paper-light pages, a green nav rail, a real cursor, and every number read
// live from (and written through) the sim. It renders inside .laptop-screen,
// which the camera has settled in front of — the UI *is* the laptop display.

import { el, toast } from './ui.js';
import { formatMoney } from '../core/utils.js';
import { calendarOf } from '../sim/time.js';
import {
  SHOP_CATALOG, skuById, LEAD_DAYS, SHELF_CAP, RETAIL_CATS,
} from '../data/shopItems.js';
import {
  placeOrder, orderCost, shopCondition, priceFor, RENO,
} from '../sim/shop.js';
import { TEE_SHEET, daySheet, bookSlot, cancelReservation, fmtSlot } from '../sim/reservations.js';
import { members } from '../sim/golfers.js';
import { ZONE } from '../sim/constants.js';

const CAT_LABEL = { clubs: 'Clubs', balls: 'Golf balls', apparel: 'Apparel', accessories: 'Accessories', supplies: 'Shop supplies', decor: 'Decor & fixtures' };
const CAT_ICON = { clubs: '🏌', balls: '🥎', apparel: '👕', accessories: '🧢', supplies: '🧹', decor: '🪴' };

export function makeLaptop(app, opts) {
  let page = 'home';
  let cart = new Map(); // skuId -> qty (supplier basket)
  let teeDay = 0;

  const content = el('div', { class: 'lt-content' });
  const navBtns = {};

  const NAV = [
    ['home', '🏠', 'Home'],
    ['shop', '🏪', 'Pro Shop'],
    ['supplier', '🛒', 'Supplier'],
    ['tee', '📅', 'Tee Sheet'],
    ['course', '⛳', 'Course'],
    ['reno', '🔨', 'Renovation'],
    ['books', '💰', 'Finances'],
    ['settings', '⚙', 'Settings'],
  ];

  function click() {
    if (app.audio && app.audio.ready) app.audio.uiTick();
  }

  function go(p) {
    page = p;
    click();
    render();
  }

  const nav = el('nav', { class: 'lt-nav' },
    el('div', { class: 'lt-brand' }, el('span', { text: '⛳' }), el('span', { text: 'Fairway Office' })),
    ...NAV.map(([id, icon, label]) => {
      const b = el('button', { class: 'lt-navbtn', onclick: () => go(id) },
        el('span', { class: 'lt-navicon', text: icon }), el('span', { text: label }));
      navBtns[id] = b;
      return b;
    }),
    el('div', { class: 'lt-navspacer' }),
    el('button', { class: 'lt-navbtn lt-close', text: '⏻  Close the lid', onclick: () => opts.close() }),
  );

  const statusbar = el('div', { class: 'lt-status' });
  const root = el('div', { class: 'laptop-screen', style: 'display:none' },
    el('div', { class: 'lt-frame' }, nav, el('div', { class: 'lt-main' }, statusbar, content)),
  );
  root.addEventListener('click', (e) => e.stopPropagation());

  const h1 = (t) => el('h1', { class: 'lt-h1', text: t });
  const sect = (t) => el('div', { class: 'lt-sect', text: t });
  const row = (...kids) => el('div', { class: 'lt-row' }, ...kids);
  const chip = (t, kind = '') => el('span', { class: `lt-chip ${kind}`, text: t });
  const meta = (t) => el('span', { class: 'lt-meta', text: t });

  function refreshStatus() {
    const st = app.state;
    if (!st) return;
    const cal = calendarOf(st.clock.minutes);
    const mins = Math.floor(cal.minuteOfDay);
    const hh = Math.floor(mins / 60);
    const mm = String(mins % 60).padStart(2, '0');
    statusbar.replaceChildren(
      el('span', { class: 'lt-statusname', text: st.clubName || 'The Club' }),
      el('span', { text: `Y${cal.year} · ${cal.seasonName} · Day ${cal.dayOfSeason}` }),
      el('span', { text: `${((hh + 11) % 12) + 1}:${mm} ${hh >= 12 ? 'PM' : 'AM'}` }),
      el('span', { class: 'lt-cash', text: formatMoney(app.empire ? app.empire.cash : st.cash) }),
    );
  }

  // --- pages ---------------------------------------------------------------------

  function pageHome() {
    const st = app.state;
    const cond = shopCondition(st);
    const dueOrders = st.shop.orders.length;
    const sheet = daySheet(st, calendarOf(st.clock.minutes).dayAbs);
    const booked = sheet.filter((s) => s.res).length;
    const emptyLines = SHOP_CATALOG.filter((s) => RETAIL_CATS.has(s.cat) && st.shop.inventory[s.id].shelf === 0).length;
    const tile = (icon, title, sub, dest) => el('button', { class: 'lt-tile', onclick: () => go(dest) },
      el('div', { class: 'lt-tileicon', text: icon }),
      el('div', { class: 'lt-tiletitle', text: title }),
      el('div', { class: 'lt-tilesub', text: sub }));
    content.replaceChildren(
      h1(`Good ${calendarOf(st.clock.minutes).minuteOfDay < 720 ? 'morning' : 'afternoon'} — ${st.clubName}`),
      el('div', { class: 'lt-tiles' },
        tile('🏪', 'Pro Shop', `${emptyLines ? `${emptyLines} lines with empty shelves` : 'shelves stocked'}`, 'shop'),
        tile('🛒', 'Supplier', dueOrders ? `${dueOrders} order${dueOrders > 1 ? 's' : ''} inbound` : 'no orders inbound', 'supplier'),
        tile('📅', 'Tee Sheet', `${booked} booking${booked === 1 ? '' : 's'} today`, 'tee'),
        tile('🔨', 'Renovation', `shop condition ${cond}`, 'reno'),
        tile('⛳', 'Course', `rating ${Math.round(app.overallRating || 0)}`, 'course'),
        tile('💰', 'Finances', `${st.shop.salesYesterday.units} sales yesterday`, 'books'),
      ),
      sect('Notes'),
      el('div', { class: 'lt-card' },
        el('div', { text: cond < 45 ? 'The shop still reads rundown — haul the clutter, run the vacuum, and get some stock out.' : cond < 80 ? 'The floor is coming together. Decor and full shelves push the shop toward premium.' : 'The shop shows well. Keep the shelves full and the floor clean.' }),
      ),
    );
  }

  function pageShop() {
    const st = app.state;
    const inv = st.shop.inventory;
    const rows = SHOP_CATALOG.filter((s) => RETAIL_CATS.has(s.cat) && s.tier <= st.shop.unlockedTier).map((s) => {
      const e = inv[s.id];
      const price = priceFor(s, st.shop.markup[s.cat] || 1, null);
      return el('tr', {},
        el('td', {}, el('span', { text: `${CAT_ICON[s.cat]} ${s.name}` })),
        el('td', { class: 'lt-num', text: String(e.shelf) }),
        el('td', { class: 'lt-num', text: String(e.back) }),
        el('td', { class: 'lt-num', text: String(SHELF_CAP[s.cat]) }),
        el('td', { class: 'lt-num', text: formatMoney(price) }),
        el('td', {}, e.shelf === 0 ? chip(e.back > 0 ? 'shelve it' : 'order', e.back > 0 ? 'warn' : 'bad') : e.shelf < 3 ? chip('low', 'warn') : chip('ok', 'ok')),
      );
    });
    const markups = ['clubs', 'balls', 'apparel', 'accessories'].map((cat) => {
      const val = st.shop.markup[cat] || 1;
      const out = el('span', { class: 'lt-muval', text: `${Math.round(val * 100)}% of book` });
      const slider = el('input', {
        type: 'range', min: '70', max: '150', value: String(Math.round(val * 100)),
        oninput: (e) => {
          st.shop.markup[cat] = Number(e.target.value) / 100;
          out.textContent = `${e.target.value}% of book`;
        },
      });
      return row(el('span', { class: 'lt-mulabel', text: CAT_LABEL[cat] }), slider, out);
    });
    const featureSel = el('select', {
      onchange: (e) => { st.shop.featureCategory = e.target.value; click(); },
    }, ...['balls', 'clubs', 'apparel', 'accessories'].map((c) =>
      el('option', { value: c, text: CAT_LABEL[c], selected: st.shop.featureCategory === c ? 'selected' : undefined })));
    content.replaceChildren(
      h1('Pro Shop'),
      sect('Live stock'),
      el('div', { class: 'lt-card lt-scroll' },
        el('table', { class: 'lt-table' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Product' }), el('th', { text: 'Shelf' }), el('th', { text: 'Back' }),
            el('th', { text: 'Cap' }), el('th', { text: 'Price' }), el('th', { text: '' }))),
          el('tbody', {}, ...rows))),
      sect('Pricing'),
      el('div', { class: 'lt-card' }, ...markups,
        row(el('span', { class: 'lt-mulabel', text: 'Feature table' }), featureSel,
          meta('the front display nudges shoppers toward this category'))),
      el('div', { class: 'lt-card lt-note', text: 'Stocking is physical: order from the Supplier, then walk the boxes from the stockroom to the displays.' }),
    );
  }

  function pageSupplier() {
    const st = app.state;
    const cal = calendarOf(st.clock.minutes);
    let total = 0;
    for (const [id, qty] of cart) total += orderCost(skuById(id), qty);

    const catBlocks = [];
    for (const cat of ['balls', 'accessories', 'apparel', 'clubs', 'supplies', 'decor']) {
      const skus = SHOP_CATALOG.filter((s) => s.cat === cat && s.tier <= st.shop.unlockedTier);
      if (!skus.length) continue;
      catBlocks.push(sect(`${CAT_ICON[cat]} ${CAT_LABEL[cat]} · ships in ${LEAD_DAYS[cat]} day${LEAD_DAYS[cat] > 1 ? 's' : ''}`));
      catBlocks.push(el('div', { class: 'lt-grid' }, ...skus.map((s) => {
        const owned = st.shop.inventory[s.id];
        const inCart = cart.get(s.id) || 0;
        const qtyOut = el('span', { class: 'lt-qty', text: String(inCart) });
        const setQty = (q) => {
          q = Math.max(0, Math.min(99, q));
          if (q === 0) cart.delete(s.id); else cart.set(s.id, q);
          qtyOut.textContent = String(q);
          render(); // refresh totals
        };
        return el('div', { class: 'lt-product' },
          el('div', { class: 'lt-prodicon', text: CAT_ICON[cat] }),
          el('div', { class: 'lt-prodname', text: s.name }),
          el('div', { class: 'lt-prodmeta', text: `cost ${formatMoney(s.cost)}${s.msrp ? ` · book ${formatMoney(s.msrp)}` : ''}${s.finish ? ` · finish +${s.finish}` : ''}` }),
          el('div', { class: 'lt-prodmeta', text: `on hand: ${owned.shelf + owned.back}` }),
          el('div', { class: 'lt-qtyrow' },
            el('button', { class: 'lt-qbtn', text: '−', onclick: () => setQty(inCart - 1) }),
            qtyOut,
            el('button', { class: 'lt-qbtn', text: '+', onclick: () => setQty(inCart + 1) })),
        );
      })));
    }

    const confirm = el('button', {
      class: 'lt-primary',
      text: cart.size ? `Place order — ${formatMoney(total)}` : 'Basket is empty',
      disabled: cart.size ? undefined : 'disabled',
      onclick: () => {
        let placed = 0;
        let spent = 0;
        for (const [id, qty] of [...cart]) {
          const res = placeOrder(st, id, qty);
          if (res.ok) {
            placed++;
            spent += res.cost;
            cart.delete(id);
          } else {
            toast(`${skuById(id).name}: ${res.reason}`, 'warn');
          }
        }
        if (placed) {
          toast(`Order placed — ${formatMoney(spent)}. The truck is on its way.`);
          if (app.audio && app.audio.ready) app.audio.chime();
        }
        render();
      },
    });

    const inbound = st.shop.orders.map((o) => {
      const s = skuById(o.skuId);
      const days = o.arrivesDay - cal.dayAbs;
      return row(
        el('span', { text: `${s ? s.name : o.skuId} ×${o.qty}` }),
        meta(`${formatMoney(o.cost)} · ${days <= 0 ? 'arriving today' : days === 1 ? 'arrives tomorrow' : `arrives in ${days} days`}`),
      );
    });

    content.replaceChildren(
      h1('Fairway Supply Co. — wholesale'),
      el('div', { class: 'lt-card lt-cart' },
        el('span', { text: `Basket: ${cart.size} line${cart.size === 1 ? '' : 's'}` }),
        el('span', { class: 'lt-cash', text: formatMoney(total) }),
        meta(`wallet ${formatMoney(app.empire ? app.empire.cash : st.cash)}`),
        confirm),
      ...catBlocks,
      sect('Inbound'),
      el('div', { class: 'lt-card' }, ...(inbound.length ? inbound : [meta('Nothing on the truck. Orders arrive by category lead time.')])),
    );
  }

  function pageTee() {
    const st = app.state;
    if (!st.reservations) {
      content.replaceChildren(h1('Tee Sheet'), el('div', { class: 'lt-card', text: 'Reservations are not available on this property.' }));
      return;
    }
    const dayBtns = [];
    for (let d = 0; d < TEE_SHEET.horizonDays; d++) {
      dayBtns.push(el('button', {
        class: `lt-day ${d === teeDay ? 'on' : ''}`,
        text: d === 0 ? 'Today' : d === 1 ? 'Tmrw' : `+${d}d`,
        onclick: () => { teeDay = d; go('tee'); },
      }));
    }
    const ms = members(st);
    const nameSel = el('select', {},
      el('option', { value: '', text: 'Walk-in guest' }),
      ...ms.slice(0, 40).map((m) => el('option', { value: m.name, text: m.name })));
    const dayAbs = calendarOf(st.clock.minutes).dayAbs + teeDay;
    const sheet = daySheet(st, dayAbs);
    const slots = sheet.map((s) => {
      const r = s.res;
      return el('div', { class: `lt-slot ${r ? 'booked' : ''}` },
        el('span', { class: 'lt-slottime', text: fmtSlot(s.minute) }),
        r
          ? el('span', { class: 'lt-slotwho' },
            el('span', { text: `${r.name} · ${formatMoney(r.fee)}${r.status === 'played' ? ' · ✅ checked in' : r.status === 'noShow' ? ' · 💨 no-show' : ''}` }),
            r.status === 'booked' ? el('button', { class: 'lt-mini', text: 'Cancel', onclick: () => { cancelReservation(st, r.id); click(); render(); } }) : null)
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
    content.replaceChildren(
      h1('Tee Sheet'),
      el('div', { class: 'lt-card' }, row(el('span', { text: 'Day:' }), ...dayBtns), row(el('span', { text: 'Golfer:' }), nameSel, meta('members book by name; walk-ins get a guest slip'))),
      el('div', { class: 'lt-card lt-scroll lt-slots' }, ...slots),
      el('div', { class: 'lt-card lt-note', text: 'Booked golfers walk into the shop around their time — check them in at the register to collect the green fee.' }),
    );
  }

  function pageCourse() {
    const st = app.state;
    const chores = [];
    if (st.turf) {
      let worn = 0;
      for (let i = 0; i < st.turf.wear.length; i++) {
        if (st.course.zones[i] !== ZONE.BUNKER && st.turf.wear[i] > 30) worn++;
      }
      const dirtyBunkers = (st.sections || []).filter((s) => {
        if (s.zone !== ZONE.BUNKER) return false;
        let sum = 0;
        for (const i of s.cells) sum += st.turf.wear[i];
        return sum / s.cells.length > 25;
      }).length;
      if (dirtyBunkers) chores.push(`${dirtyBunkers} bunker${dirtyBunkers > 1 ? 's' : ''} need raking`);
      if (worn) chores.push(`${worn} worn turf patches (divot kit)`);
    }
    if (st.props) {
      const litter = st.props.litter.filter((l) => !l.cleared).length;
      if (litter) chores.push(`${litter} debris piles to haul`);
      if (!st.props.teeSignFixed) chores.push('the tee sign is still broken');
    }
    if (st.tractor && !st.tractor.repaired) chores.push('the tractor is still broken (shed yard)');
    const grimeAvg = st.shop.reno ? st.shop.reno.grime.reduce((a, v) => a + v, 0) / st.shop.reno.grime.length : 0;
    if (grimeAvg > 0.18) chores.push('the shop floor needs a vacuum pass');

    const holes = st.course.holes.map((h, i) =>
      row(el('span', { text: `Hole ${i + 1}` }), chip(h.status, h.status === 'open' ? 'ok' : 'warn')));
    const w = st.weather.today;
    content.replaceChildren(
      h1('Course management'),
      el('div', { class: 'lt-tiles' },
        el('div', { class: 'lt-tile lt-static' }, el('div', { class: 'lt-tiletitle', text: `Course ${Math.round(app.overallRating || 0)}` }), el('div', { class: 'lt-tilesub', text: `design ${Math.round(app.designRating || 0)} · condition ${Math.round(app.conditionRatingVal || 0)}` })),
        el('div', { class: 'lt-tile lt-static' }, el('div', { class: 'lt-tiletitle', text: `${Math.round(w.tempHiF)}°F` }), el('div', { class: 'lt-tilesub', text: w.rainIn > 0.02 ? `rain ${w.rainIn.toFixed(2)}"` : 'dry' })),
        el('div', { class: 'lt-tile lt-static' }, el('div', { class: 'lt-tiletitle', text: `${st.club.lastRounds || 0} rounds` }), el('div', { class: 'lt-tilesub', text: 'yesterday' })),
      ),
      sect('Grounds chores'),
      el('div', { class: 'lt-card' }, ...(chores.length ? chores.map((c) => row(el('span', { text: `• ${c}` }))) : [meta('All caught up — the grounds look after themselves today.')])),
      sect('Holes'),
      el('div', { class: 'lt-card lt-scroll' }, ...holes),
      el('div', { class: 'lt-card lt-note', text: 'Deeper grounds policy (crew, mowing, irrigation) lives at the Grounds desk; course surgery at the wall map (overview camera).' }),
    );
  }

  function pageReno() {
    const st = app.state;
    const reno = st.shop.reno;
    const cond = shopCondition(st);
    const grimeAvg = reno ? reno.grime.reduce((a, v) => a + v, 0) / reno.grime.length : 0;
    const clutterLeft = reno ? reno.clutter.filter((c) => !c.cleared).length : 0;
    const decorSkus = SHOP_CATALOG.filter((s) => s.cat === 'decor');
    const decorRows = decorSkus.map((s) => {
      const placed = reno ? reno.decor.filter((d) => d.skuId === s.id).length : 0;
      const back = st.shop.inventory[s.id].back;
      return row(
        el('span', { text: `${s.name}` }),
        meta(`placed ${placed} · in the back ${back} · ${formatMoney(s.cost)} · finish +${s.finish}`),
        el('button', {
          class: 'lt-mini',
          text: 'Order 1',
          onclick: () => {
            const res = placeOrder(st, s.id, 1);
            toast(res.ok ? `${s.name} ordered — place it from its green ghost when it lands.` : res.reason, res.ok ? '' : 'warn');
            if (res.ok) click();
            render();
          },
        }),
      );
    });
    const stage = cond < 30 ? ['Stage 1 — Abandoned', 'Heavy grime, clutter, dead lights. Haul junk, run the vacuum, order the basics.']
      : cond < 55 ? ['Stage 2 — Clean & functional', 'The floor works. Keep the shelves stocked; start placing decor.']
        : cond < 85 ? ['Stage 3 — Established shop', 'Organized and lit. Full decor and full shelves push it premium.']
          : ['Stage 4 — Premium clubhouse shop', 'The room shows like the reference. Keep it that way.'];
    content.replaceChildren(
      h1('Renovation'),
      el('div', { class: 'lt-tiles' },
        el('div', { class: 'lt-tile lt-static' }, el('div', { class: 'lt-tiletitle', text: `Condition ${cond}` }), el('div', { class: 'lt-tilesub', text: stage[0] })),
        el('div', { class: 'lt-tile lt-static' }, el('div', { class: 'lt-tiletitle', text: `${Math.round((1 - grimeAvg) * 100)}% clean` }), el('div', { class: 'lt-tilesub', text: `${clutterLeft} clutter pile${clutterLeft === 1 ? '' : 's'} left` })),
      ),
      el('div', { class: 'lt-card', text: stage[1] }),
      sect('Decor & fixtures (order here, place in the room)'),
      el('div', { class: 'lt-card' }, ...decorRows),
      el('div', { class: 'lt-card lt-note', text: 'Cleanliness carries 70 points of condition; decor finish carries up to 30. Both are earned on the floor, not on this screen.' }),
    );
  }

  function pageBooks() {
    const st = app.state;
    const s = st.shop;
    const led = st.ledger || {};
    const hist = Array.isArray(led.history) ? led.history.slice(-7).reverse() : [];
    const histRows = hist.map((d) => {
      const rev = d.revenue ? Object.values(d.revenue).reduce((a, v) => a + v, 0) : 0;
      const exp = d.expenses ? Object.values(d.expenses).reduce((a, v) => a + v, 0) : 0;
      return row(
        el('span', { text: d.label || `Day ${d.dayAbs ?? ''}` }),
        meta(`revenue ${formatMoney(rev)} · expenses ${formatMoney(exp)}`),
        chip(`${rev - exp >= 0 ? '+' : ''}${formatMoney(rev - exp)}`, rev - exp >= 0 ? 'ok' : 'bad'),
      );
    });
    content.replaceChildren(
      h1('Finances'),
      el('div', { class: 'lt-tiles' },
        el('div', { class: 'lt-tile lt-static' }, el('div', { class: 'lt-tiletitle', text: formatMoney(app.empire ? app.empire.cash : st.cash) }), el('div', { class: 'lt-tilesub', text: 'wallet (empire-wide)' })),
        el('div', { class: 'lt-tile lt-static' }, el('div', { class: 'lt-tiletitle', text: `${s.salesYesterday.units} sales` }), el('div', { class: 'lt-tilesub', text: `${formatMoney(s.salesYesterday.revenue)} yesterday${s.lostSalesYesterday ? ` · ${s.lostSalesYesterday} walked out` : ''}` })),
        el('div', { class: 'lt-tile lt-static' }, el('div', { class: 'lt-tiletitle', text: `${st.shop.orders.length} inbound` }), el('div', { class: 'lt-tilesub', text: `${formatMoney(st.shop.orders.reduce((a, o) => a + o.cost, 0))} on the truck` })),
      ),
      sect('Recent days'),
      el('div', { class: 'lt-card lt-scroll' }, ...(histRows.length ? histRows : [meta('The books fill in as days close.')])),
      sect('Notable sales'),
      el('div', { class: 'lt-card' }, ...(s.log.length ? s.log.map((line) => row(el('span', { text: line }))) : [meta('Nothing notable yet.')])),
    );
  }

  function pageSettings() {
    const st = app.state;
    content.replaceChildren(
      h1('Store settings'),
      el('div', { class: 'lt-card' },
        row(el('span', { class: 'lt-mulabel', text: 'Club' }), el('span', { text: st.clubName })),
        row(el('span', { class: 'lt-mulabel', text: 'Shop hours' }), el('span', { text: '6:00 AM – 8:00 PM (the course’s playing day)' })),
        row(el('span', { class: 'lt-mulabel', text: 'Autosave' }), el('span', { text: 'nightly, plus office-menu slots (Esc)' })),
      ),
      el('div', { class: 'lt-card lt-note', text: 'Pricing and the feature table live on the Pro Shop page. Deeper club management (membership, staff, amenities) is at the Club desk.' }),
    );
  }

  const PAGES = { home: pageHome, shop: pageShop, supplier: pageSupplier, tee: pageTee, course: pageCourse, reno: pageReno, books: pageBooks, settings: pageSettings };

  function render() {
    if (root.style.display === 'none' || !app.state) return;
    refreshStatus();
    for (const [id, b] of Object.entries(navBtns)) b.classList.toggle('on', id === page);
    PAGES[page]();
  }

  let liveTimer = null;

  return {
    root,
    open(startPage) {
      if (startPage) page = startPage;
      cart = new Map();
      root.style.display = '';
      render();
      clearInterval(liveTimer);
      liveTimer = setInterval(refreshStatus, 1000); // the clock keeps ticking on screen
    },
    close() {
      root.style.display = 'none';
      clearInterval(liveTimer);
    },
    isOpen: () => root.style.display !== 'none',
    render,
  };
}

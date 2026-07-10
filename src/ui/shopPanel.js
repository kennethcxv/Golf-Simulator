// FAIRWAY STATE — Pro Shop desk: ordering, pricing, rentals, and the door to
// the walkable floor. Inventory truth lives in sim/shop.js.

import { el, toast } from './ui.js';
import { formatMoney } from '../core/utils.js';
import { SHOP_CATALOG, LEAD_DAYS, SHELF_CAP } from '../data/shopItems.js';
import { placeOrder, orderCost, buyRentalSets, restockShelfFromBackroom, shopCondition } from '../sim/shop.js';
import { calendarOf } from '../sim/time.js';
import { TEE_SHEET, daySheet, bookSlot, cancelReservation, fmtSlot } from '../sim/reservations.js';
import { members } from '../sim/golfers.js';

const CAT_LABEL = {
  clubs: 'Clubs', balls: 'Balls', apparel: 'Apparel', accessories: 'Accessories',
  supplies: 'Shop supplies', decor: 'Decor & fixtures',
};
// shop equipment/decor is bought one at a time and never shelved for sale
const OWN_USE = new Set(['supplies', 'decor']);

export function makeShopPanel(app, handlers) {
  const body = el('div');
  const root = el('div', { class: 'panel grounds-panel', style: 'display:none' },
    el('h3', { text: 'Pro Shop desk' }), body);

  // the office computer's two screens: supplier orders, and the tee sheet
  let tab = 'orders';
  let teeDayOffset = 1; // bookings default to tomorrow — today's sheet is mostly gone by open
  let teeName = '';

  function refresh() {
    const st = app.state;
    if (!st || !st.shop) return;
    const rows = [];
    rows.push(el('div', { class: 'row' },
      el('button', {
        class: tab === 'orders' ? 'primary' : '', text: '🛒 Supplier orders',
        onclick: () => { tab = 'orders'; refresh(); },
      }),
      el('button', {
        class: tab === 'tee' ? 'primary' : '', text: '📅 Tee sheet',
        onclick: () => { tab = 'tee'; refresh(); },
      }),
      el('button', {
        class: tab === 'summary' ? 'primary' : '', text: '📊 Summary',
        onclick: () => { tab = 'summary'; refresh(); },
      }),
    ));
    if (tab === 'tee') refreshTeeSheet(rows);
    else if (tab === 'summary') refreshSummary(rows);
    else refreshOrders(rows);
    body.replaceChildren(...rows);
  }

  // the shop's real information hub: everything below reads live game state
  function refreshSummary(rows) {
    const st = app.state;
    const shop = st.shop;
    const cal = calendarOf(st.clock.minutes);

    const cond = shopCondition(st);
    const condWord = cond < 25 ? 'filthy' : cond < 45 ? 'grimy' : cond < 70 ? 'getting there' : cond < 90 ? 'clean' : 'showroom';
    rows.push(el('div', { class: 'row' },
      el('span', { class: 'status-chip', text: `🧹 Condition ${cond} — ${condWord}` }),
      el('span', { class: 'status-chip', text: `💰 ${formatMoney(st.cash)}` }),
    ));

    // yesterday, from the REAL closed books
    rows.push(el('h3', { text: 'Yesterday', style: 'margin-top:10px' }));
    const sy = shop.salesYesterday || { units: 0, revenue: 0 };
    rows.push(el('div', { class: 'row muted', text: `🛍 Shop: ${sy.units} sales · ${formatMoney(sy.revenue)}${shop.lostSalesYesterday ? ` · ${shop.lostSalesYesterday} left empty-handed` : ''}${shop.fittingsYesterday ? ` · ${shop.fittingsYesterday} fittings` : ''}` }));
    const closed = st.ledger && st.ledger.history.length ? st.ledger.history[st.ledger.history.length - 1] : null;
    if (closed) {
      rows.push(el('div', { class: 'row muted', text: `📗 Books day ${closed.dayAbs}: revenue ${formatMoney(closed.revenueTotal)} · expenses ${formatMoney(closed.expenseTotal)} · net ${formatMoney(closed.net)}` }));
      rows.push(el('div', { class: 'row muted', text: `⛳ Green fees ${formatMoney(closed.revenue.greenFees || 0)} · dues ${formatMoney(closed.revenue.dues || 0)} · shop ${formatMoney(closed.revenue.shopSales || 0)}` }));
    }
    // the shelves tell on themselves: what's empty, what's sitting in the back
    let emptyRetail = 0;
    let backUnits = 0;
    for (const sku of SHOP_CATALOG) {
      if (sku.cat === 'supplies' || sku.cat === 'decor') continue;
      const inv = shop.inventory[sku.id];
      if (!inv) continue;
      if (inv.shelf === 0) emptyRetail++;
      backUnits += inv.back;
    }
    if (emptyRetail > 0) {
      rows.push(el('div', {
        class: 'row muted',
        text: `🛒 ${emptyRetail} product line${emptyRetail > 1 ? 's' : ''} with empty shelves` +
          (backUnits > 0 ? ` — ${backUnits} units waiting in the backroom` : ' — nothing in the back either; order stock'),
      }));
    }

    // today's tee sheet at a glance
    rows.push(el('h3', { text: 'Today’s tee sheet', style: 'margin-top:10px' }));
    const sheet = daySheet(st, cal.dayAbs);
    const booked = sheet.filter((s) => s.res && s.res.status === 'booked');
    const played = sheet.filter((s) => s.res && s.res.status === 'played').length;
    const next = booked.find((s) => s.minute >= cal.minuteOfDay - TEE_SHEET.dueLeadMin);
    rows.push(el('div', { class: 'row muted', text: `${booked.length} booked · ${played} checked in${next ? ` · next: ${next.res.name} at ${fmtSlot(next.minute)}` : ' · no one else due today'}` }));

    // grounds chores: the systems that make work also report it here
    const chores = [];
    if (st.turf && st.sections) {
      let dirtyBunkers = 0;
      let wornPatches = 0;
      for (const sec of st.sections) {
        if (sec.zone === 5) { // bunker sections, avg footprints
          let sum = 0;
          for (const i of sec.cells) sum += st.turf.wear[i];
          if (sum / sec.cells.length > 25) dirtyBunkers++;
        }
      }
      for (let i = 0; i < st.course.zones.length; i++) {
        const z = st.course.zones[i];
        if ((z === 1 || z === 2 || z === 3 || z === 4) && st.turf.wear[i] > 30) wornPatches++;
      }
      if (dirtyBunkers) chores.push(`🧹 ${dirtyBunkers} bunker${dirtyBunkers > 1 ? 's' : ''} need${dirtyBunkers > 1 ? '' : 's'} raking`);
      if (wornPatches) chores.push(`⛏ ${wornPatches} worn patch${wornPatches > 1 ? 'es' : ''} for the divot kit`);
    }
    if (st.props) {
      const piles = st.props.litter.filter((p) => !p.cleared).length;
      if (piles) chores.push(`🍂 ${piles} debris pile${piles > 1 ? 's' : ''} to haul`);
      if (!st.props.teeSignFixed) chores.push('🪧 the tee sign is still broken');
    }
    if (st.tractor && !st.tractor.repaired) chores.push('🚜 the tractor is still broken at the shed');
    if (st.shop.reno) {
      const avgDirt = st.shop.reno.grime.reduce((a, v) => a + v, 0) / st.shop.reno.grime.length;
      if (avgDirt > 0.18) chores.push(`🧽 the shop floor needs a vacuum pass (${Math.round(avgDirt * 100)}% tracked in)`);
    }
    rows.push(el('h3', { text: 'Grounds chores', style: 'margin-top:10px' }));
    if (chores.length) {
      for (const line of chores) rows.push(el('div', { class: 'row muted', text: line }));
    } else {
      rows.push(el('div', { class: 'row muted', text: 'All caught up out there — the course looks after itself today.' }));
    }

    // inbound stock
    rows.push(el('h3', { text: 'Orders inbound', style: 'margin-top:10px' }));
    if (!shop.orders.length) {
      rows.push(el('div', { class: 'row muted', text: 'Nothing on a truck right now.' }));
    } else {
      for (const o of shop.orders.slice(0, 6)) {
        const sku = SHOP_CATALOG.find((s) => s.id === o.skuId);
        const days = o.arrivesDay - cal.dayAbs;
        rows.push(el('div', { class: 'row muted', text: `🚚 ${o.qty}× ${sku ? sku.name : o.skuId} — ${days <= 0 ? 'arrives today' : `${days} day${days > 1 ? 's' : ''} out`}` }));
      }
    }

    // notable sales, straight from the shop log
    if (shop.log && shop.log.length) {
      rows.push(el('h3', { text: 'Notable sales', style: 'margin-top:10px' }));
      for (const line of shop.log.slice(0, 4)) {
        rows.push(el('div', { class: 'row muted', style: 'font-size:0.86rem', text: `🛍 ${line}` }));
      }
    }
  }

  function refreshTeeSheet(rows) {
    const st = app.state;
    const todayAbs = calendarOf(st.clock.minutes).dayAbs;
    const day = todayAbs + teeDayOffset;

    const dayBtns = [];
    for (let off = 0; off <= TEE_SHEET.horizonDays; off++) {
      dayBtns.push(el('button', {
        class: off === teeDayOffset ? 'primary' : '',
        text: off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : `+${off}d`,
        style: 'padding:3px 8px;font-size:0.84rem',
        onclick: () => { teeDayOffset = off; refresh(); },
      }));
    }
    rows.push(el('div', { class: 'row', style: 'flex-wrap:wrap;gap:4px' }, ...dayBtns));

    // who is the booking for — members by name, or a walk-in guest
    const ms = members(st);
    const nameSel = el('select', { onchange: (e) => { teeName = e.target.value; } },
      el('option', { value: '', text: 'Walk-in guest' }),
      ...ms.slice(0, 14).map((m) => el('option', { value: m.name, text: `${m.name} (member)` })),
    );
    nameSel.value = teeName;
    rows.push(el('div', { class: 'row' },
      el('strong', { text: 'Book for', style: 'width:80px' }), nameSel,
      el('span', { class: 'muted', text: `green fee ${formatMoney(st.club.greenFee)} at check-in` }),
    ));

    const sheet = daySheet(st, day);
    const booked = sheet.filter((s) => s.res).length;
    rows.push(el('div', { class: 'row muted', text: `${booked}/${sheet.length} slots booked · payment collected at the counter when they arrive` }));

    const nowMin = calendarOf(st.clock.minutes).minuteOfDay;
    for (const slot of sheet) {
      const gone = teeDayOffset === 0 && slot.minute < nowMin;
      const cells = [el('strong', { text: fmtSlot(slot.minute), style: 'width:76px' })];
      if (slot.res) {
        const r = slot.res;
        const chip = r.status === 'booked' ? '📌 booked' : r.status === 'played' ? '✅ checked in' : r.status === 'noShow' ? '💨 no-show' : r.status;
        cells.push(el('span', { text: `${r.name}`, style: 'flex:1' }));
        cells.push(el('span', { class: 'status-chip', text: `${chip} · ${formatMoney(r.fee)}` }));
        if (r.status === 'booked') {
          cells.push(el('button', {
            text: 'Cancel', style: 'padding:2px 8px;font-size:0.82rem',
            onclick: () => { cancelReservation(st, r.id); refresh(); },
          }));
        }
      } else if (gone) {
        cells.push(el('span', { class: 'muted', text: 'gone by', style: 'flex:1' }));
      } else {
        cells.push(el('span', { class: 'muted', text: 'open', style: 'flex:1' }));
        cells.push(el('button', {
          text: 'Book', style: 'padding:2px 10px;font-size:0.82rem',
          onclick: () => {
            const name = teeName || 'Walk-in guest';
            const res = bookSlot(st, day, slot.minute, name);
            toast(res.ok ? `${name} booked for ${fmtSlot(slot.minute)}.` : res.reason, res.ok ? '' : 'warn');
            refresh();
          },
        }));
      }
      rows.push(el('div', { class: 'row', style: 'font-size:0.88rem' }, ...cells));
    }
  }

  function refreshOrders(rows) {
    const st = app.state;
    const shop = st.shop;
    const dayAbs = calendarOf(st.clock.minutes).dayAbs;

    rows.push(el('div', { class: 'row' },
      el('button', { class: 'primary', text: '🚶 Walk the floor (P)', onclick: () => handlers.enterShop() }),
      el('span', { class: 'muted', text: 'Restock by hand, greet whoever is in.' }),
    ));

    const sy = shop.salesYesterday || { units: 0, revenue: 0 };
    rows.push(el('div', { class: 'row' },
      el('span', { class: 'status-chip', text: `Yesterday ${sy.units} sales · ${formatMoney(sy.revenue)}` }),
      shop.lostSalesYesterday > 0
        ? el('span', { class: 'status-chip', text: `⚠ ${shop.lostSalesYesterday} left empty-handed`, style: 'border-color:var(--warn);color:var(--warn)' })
        : null,
      shop.fittingsYesterday > 0 ? el('span', { class: 'status-chip', text: `${shop.fittingsYesterday} fittings` }) : null,
    ));

    // --- pricing (retail categories only — your own equipment has no markup) --
    rows.push(el('h3', { text: 'Markup', style: 'margin-top:10px' }));
    for (const cat of Object.keys(CAT_LABEL).filter((c) => shop.markup[c] !== undefined)) {
      const val = el('span', { class: 'muted', text: `${Math.round(shop.markup[cat] * 100)}% of book`, style: 'width:110px;display:inline-block' });
      rows.push(el('div', { class: 'row' },
        el('strong', { text: CAT_LABEL[cat], style: 'width:110px' }),
        el('input', {
          type: 'range', min: '0.8', max: '2', step: '0.05', value: String(shop.markup[cat]), style: 'flex:1',
          oninput: (e) => {
            shop.markup[cat] = Number(e.target.value);
            val.textContent = `${Math.round(shop.markup[cat] * 100)}% of book`;
          },
        }),
        val,
      ));
    }
    const featureSel = el('select', {
      onchange: (e) => { shop.featureCategory = e.target.value; } },
      ...Object.keys(CAT_LABEL).filter((c) => shop.markup[c] !== undefined)
        .map((c) => el('option', { value: c, text: CAT_LABEL[c] })),
    );
    featureSel.value = shop.featureCategory;
    rows.push(el('div', { class: 'row' },
      el('strong', { text: 'Feature table', style: 'width:110px' }), featureSel,
      el('span', { class: 'muted', text: 'nudges shoppers toward a category' })));

    // --- stock & ordering -----------------------------------------------------
    rows.push(el('h3', { text: 'Stock & orders', style: 'margin-top:10px' }));
    let currentCat = '';
    for (const sku of SHOP_CATALOG) {
      const locked = sku.tier > shop.unlockedTier;
      if (sku.cat !== currentCat) {
        currentCat = sku.cat;
        rows.push(el('div', { class: 'muted', text: `— ${CAT_LABEL[currentCat]} (ships in ${LEAD_DAYS[currentCat]}d) —`, style: 'margin-top:6px' }));
      }
      const inv = shop.inventory[sku.id];
      const pending = shop.orders.filter((o) => o.skuId === sku.id).reduce((a, o) => a + o.qty, 0);
      const ownUse = OWN_USE.has(sku.cat);
      const qty = ownUse ? 1 : sku.cat === 'clubs' ? 3 : 12;
      rows.push(el('div', { class: 'row', style: 'font-size:0.88rem' },
        el('span', { text: sku.name + (locked ? ' 🔒' : ''), style: `width:170px;${locked ? 'opacity:.45' : ''}` }),
        el('span', {
          class: 'muted',
          text: ownUse
            ? `owned ${inv.back}${pending ? ` · 🚚${pending}` : ''}`
            : `shelf ${inv.shelf}/${SHELF_CAP[sku.cat]} · back ${inv.back}${pending ? ` · 🚚${pending}` : ''}`,
          style: 'flex:1',
        }),
        locked ? el('span', { class: 'muted', text: 'unlocks later' }) : el('button', {
          text: `Order ${qty} (${formatMoney(orderCost(sku, qty))})`,
          onclick: () => {
            const res = placeOrder(app.state, sku.id, qty);
            toast(res.ok ? `Ordered ${qty}× ${sku.name} — arrives in ${LEAD_DAYS[sku.cat]} days.` : res.reason, res.ok ? '' : 'warn');
            refresh();
          },
        }),
        !locked && !ownUse && inv.back > 0 ? el('button', {
          text: 'Shelve',
          title: 'Or walk the floor and do it by hand',
          onclick: () => {
            restockShelfFromBackroom(app.state, sku.id);
            refresh();
          },
        }) : null,
      ));
    }

    // --- rentals ------------------------------------------------------------------
    rows.push(el('h3', { text: 'Rental fleet', style: 'margin-top:10px' }));
    rows.push(el('div', { class: 'row' },
      el('span', { class: 'muted', text: `${shop.rentalFleet.sets} sets · condition ${Math.round(shop.rentalFleet.condition)} · ${formatMoney(shop.rentalFleet.pricePerRound)}/round`, style: 'flex:1' }),
      el('button', {
        text: `Buy set ${formatMoney(220)}`,
        onclick: () => {
          const res = buyRentalSets(app.state, 1);
          toast(res.ok ? 'A fresh rental set arrives.' : res.reason, res.ok ? '' : 'warn');
          refresh();
        },
      }),
    ));

    // --- recent sales ------------------------------------------------------------------
    if (shop.log && shop.log.length) {
      rows.push(el('h3', { text: 'Notable sales', style: 'margin-top:10px' }));
      for (const line of shop.log.slice(0, 6)) {
        rows.push(el('div', { class: 'row muted', style: 'font-size:0.86rem', text: `🛍 ${line}` }));
      }
    }
  }

  function setVisible(v) {
    root.style.display = v ? '' : 'none';
    app.shopOpen = v;
    if (v) refresh();
  }

  return { root, refresh, setVisible };
}

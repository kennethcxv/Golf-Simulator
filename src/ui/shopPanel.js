// FAIRWAY STATE — Pro Shop desk: ordering, pricing, rentals, and the door to
// the walkable floor. Inventory truth lives in sim/shop.js.

import { el, toast } from './ui.js';
import { formatMoney } from '../core/utils.js';
import { SHOP_CATALOG, LEAD_DAYS, SHELF_CAP } from '../data/shopItems.js';
import { placeOrder, orderCost, buyRentalSets, restockShelfFromBackroom } from '../sim/shop.js';
import { calendarOf } from '../sim/time.js';

const CAT_LABEL = { clubs: 'Clubs', balls: 'Balls', apparel: 'Apparel', accessories: 'Accessories' };

export function makeShopPanel(app, handlers) {
  const body = el('div');
  const root = el('div', { class: 'panel grounds-panel', style: 'display:none' },
    el('h3', { text: 'Pro Shop desk' }), body);

  function refresh() {
    const st = app.state;
    if (!st || !st.shop) return;
    const shop = st.shop;
    const dayAbs = calendarOf(st.clock.minutes).dayAbs;
    const rows = [];

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

    // --- pricing -----------------------------------------------------------
    rows.push(el('h3', { text: 'Markup', style: 'margin-top:10px' }));
    for (const cat of Object.keys(CAT_LABEL)) {
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
      ...Object.keys(CAT_LABEL).map((c) => el('option', { value: c, text: CAT_LABEL[c] })),
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
      const qty = sku.cat === 'clubs' ? 3 : 12;
      rows.push(el('div', { class: 'row', style: 'font-size:0.88rem' },
        el('span', { text: sku.name + (locked ? ' 🔒' : ''), style: `width:170px;${locked ? 'opacity:.45' : ''}` }),
        el('span', { class: 'muted', text: `shelf ${inv.shelf}/${SHELF_CAP[sku.cat]} · back ${inv.back}${pending ? ` · 🚚${pending}` : ''}`, style: 'flex:1' }),
        locked ? el('span', { class: 'muted', text: 'unlocks later' }) : el('button', {
          text: `Order ${qty} (${formatMoney(orderCost(sku, qty))})`,
          onclick: () => {
            const res = placeOrder(app.state, sku.id, qty);
            toast(res.ok ? `Ordered ${qty}× ${sku.name} — arrives in ${LEAD_DAYS[sku.cat]} days.` : res.reason, res.ok ? '' : 'warn');
            refresh();
          },
        }),
        !locked && inv.back > 0 ? el('button', {
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

    body.replaceChildren(...rows);
  }

  function setVisible(v) {
    root.style.display = v ? '' : 'none';
    app.shopOpen = v;
    if (v) refresh();
  }

  return { root, refresh, setVisible };
}

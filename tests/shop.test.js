import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY } from '../src/sim/constants.js';
import { newGame, update, serialize, deserialize } from '../src/sim/state.js';
import { SHOP_CATALOG, skuById } from '../src/data/shopItems.js';
import {
  placeOrder, priceFor, restockShelvesByStaff, restockShelfFromBackroom,
  demandWeight, shopOpenStock,
} from '../src/sim/shop.js';
import { ROLE } from '../src/sim/staff.js';
import { openBox } from '../src/sim/deliveries.js';

function boostCourse(st) {
  st.turf.health.fill(80);
  st.turf.disType.fill(0);
  st.turf.disSev.fill(0);
  st.club.reputation = 60;
}

test('newGame initializes a bare-bones shop', () => {
  const st = newGame('realistic', 42);
  assert.ok(st.shop, 'shop state exists');
  assert.ok(SHOP_CATALOG.length >= 14, `catalog has range: ${SHOP_CATALOG.length}`);
  const stocked = Object.values(st.shop.inventory).filter((v) => v.shelf + v.back > 0);
  assert.ok(stocked.length >= 2 && stocked.length <= 8, `fixer-upper opens nearly empty: ${stocked.length} skus stocked`);
  assert.equal(st.shop.markup.balls, 1.0);
  assert.ok(st.shop.rentalFleet.sets >= 2, 'a few tired rental sets');
});

test('supplier orders cost cash and arrive after their lead time', () => {
  const st = newGame('realistic', 42);
  const sku = SHOP_CATALOG.find((s) => s.cat === 'balls' && s.tier === 1);
  const cashBefore = st.cash;
  const res = placeOrder(st, sku.id, 12);
  assert.equal(res.ok, true);
  assert.ok(st.cash < cashBefore, 'order paid up front');
  assert.equal(st.shop.orders.length, 1);
  const backBefore = st.shop.inventory[sku.id].back;
  update(st, 5 * MINUTES_PER_DAY); // longest lead is 4 days
  assert.equal(st.shop.orders.length, 0, 'order delivered');
  // 2026-07-13 physical retail: the truck leaves BOXES on the pad; contents
  // reach the backroom when they're opened (by hand, or by the morning staff)
  const boxes = st.shop.deliveries.boxes.filter((b) => b.skuId === sku.id);
  assert.ok(boxes.reduce((a, b) => a + b.qty, 0) >= 12, 'the order waits on the pad in boxes');
  for (const b of [...boxes]) openBox(st, b.id);
  assert.ok(st.shop.inventory[sku.id].back >= backBefore + 12, 'unboxed stock landed in the backroom');
});

test('pricing respects markup and member discounts', () => {
  const sku = SHOP_CATALOG.find((s) => s.cat === 'balls' && s.tier === 2);
  const base = priceFor(sku, 1.0, null);
  assert.ok(Math.abs(base - sku.msrp) < 0.01);
  assert.ok(priceFor(sku, 1.4, null) > base * 1.3);
  assert.ok(priceFor(sku, 1.0, 'premium') < base, 'premium members get the shop discount');
});

test('floor staff restock shelves in the morning; nobody means shelves stay empty', () => {
  const staffed = newGame('realistic', 42);
  const sku = SHOP_CATALOG.find((s) => s.cat === 'balls' && s.tier === 1);
  staffed.shop.inventory[sku.id].back = 30;
  staffed.shop.inventory[sku.id].shelf = 0;
  staffed.staff.employees.push({ id: 990, name: 'Floor Pro', role: ROLE.PROSHOP, skill: 3, wage: 110, trainingDays: 0 });
  restockShelvesByStaff(staffed);
  assert.ok(staffed.shop.inventory[sku.id].shelf > 6, `staff shelved stock: ${staffed.shop.inventory[sku.id].shelf}`);

  const unstaffed = newGame('realistic', 42);
  unstaffed.shop.inventory[sku.id].back = 30;
  unstaffed.shop.inventory[sku.id].shelf = 0;
  restockShelvesByStaff(unstaffed);
  assert.equal(unstaffed.shop.inventory[sku.id].shelf, 0, 'no staff, no elves');

  // the player can always do it by hand (the walkable-shop interaction)
  const moved = restockShelfFromBackroom(unstaffed, sku.id);
  assert.ok(moved.ok && unstaffed.shop.inventory[sku.id].shelf > 0);
});

test('stocked shelves sell; empty shelves lose sales and annoy members', () => {
  const st = newGame('realistic', 500);
  boostCourse(st);
  // stock the staples generously
  for (const sku of SHOP_CATALOG.filter((s) => s.tier <= 2)) {
    st.shop.inventory[sku.id].shelf = 24;
  }
  update(st, 6 * MINUTES_PER_DAY);
  const sales = st.ledger.history.reduce((a, d) => a + (d.revenue.shopSales || 0), 0);
  assert.ok(sales > 100, `shop sold things: ${sales}`);
  const ballStock = st.shop.inventory[SHOP_CATALOG.find((s) => s.cat === 'balls' && s.tier === 1).id];
  assert.ok(ballStock.shelf < 24, 'shelves actually depleted');

  const bare = newGame('realistic', 500);
  boostCourse(bare);
  for (const sku of SHOP_CATALOG) {
    bare.shop.inventory[sku.id].shelf = 0;
    bare.shop.inventory[sku.id].back = 0;
  }
  update(bare, 6 * MINUTES_PER_DAY);
  const bareSales = bare.ledger.history.reduce((a, d) => a + (d.revenue.shopSales || 0), 0);
  assert.ok(bareSales < sales * 0.2, `bare shop barely sells: ${bareSales} vs ${sales}`);
  assert.ok(bare.shop.lostSalesYesterday + bare.shop.lostSalesTotal > 0, 'lost sales are tracked');
});

test('greedy markup kills volume', () => {
  const fair = newGame('realistic', 613);
  const greedy = newGame('realistic', 613);
  for (const st of [fair, greedy]) {
    boostCourse(st);
    for (const sku of SHOP_CATALOG.filter((s) => s.tier <= 2)) st.shop.inventory[sku.id].shelf = 24;
  }
  greedy.shop.markup = { clubs: 2.0, balls: 2.0, apparel: 2.0, accessories: 2.0 };
  update(fair, 6 * MINUTES_PER_DAY);
  update(greedy, 6 * MINUTES_PER_DAY);
  const unitsSold = (st) => {
    let units = 0;
    for (const sku of SHOP_CATALOG) {
      units += Math.max(0, 24 - st.shop.inventory[sku.id].shelf) * (sku.tier <= 2 ? 1 : 0);
    }
    return units;
  };
  assert.ok(unitsSold(greedy) < unitsSold(fair) * 0.6,
    `double pricing moves far fewer units: ${unitsSold(greedy)} vs ${unitsSold(fair)}`);
});

test('fittings need a pro and pay off in member satisfaction', () => {
  const st = newGame('realistic', 42);
  boostCourse(st);
  st.staff.employees.push({ id: 991, name: 'Fit Pro', role: ROLE.INSTRUCTOR, skill: 4, wage: 170, trainingDays: 0 });
  update(st, 8 * MINUTES_PER_DAY);
  const fittingRev = st.ledger.history.reduce((a, d) => a + (d.revenue.fittings || 0), 0);
  assert.ok(fittingRev > 0, `fittings happened: ${fittingRev}`);

  const noPro = newGame('realistic', 42);
  boostCourse(noPro);
  update(noPro, 8 * MINUTES_PER_DAY);
  const noProRev = noPro.ledger.history.reduce((a, d) => a + (d.revenue.fittings || 0), 0);
  assert.equal(noProRev, 0, 'no pro, no fittings');
});

test('rentals earn from guests and wear the fleet down', () => {
  const st = newGame('realistic', 900);
  boostCourse(st);
  st.shop.rentalFleet.sets = 6;
  st.shop.rentalFleet.condition = 90;
  update(st, 8 * MINUTES_PER_DAY);
  const rentalRev = st.ledger.history.reduce((a, d) => a + (d.revenue.rentals || 0), 0);
  assert.ok(rentalRev > 0, `rentals earned: ${rentalRev}`);
  assert.ok(st.shop.rentalFleet.condition < 90, 'fleet wears with use');
});

test('demand shifts with the seasons', () => {
  // apparel (jackets, beanies) matters more in cold seasons; balls dominate summer
  assert.ok(demandWeight('apparel', 3) > demandWeight('apparel', 1) * 1.3);
  assert.ok(demandWeight('balls', 1) > demandWeight('balls', 3) * 1.5);
});

test('shop state survives save/load', () => {
  const st = newGame('realistic', 42);
  const sku = SHOP_CATALOG[0];
  placeOrder(st, sku.id, 6);
  update(st, 2 * MINUTES_PER_DAY);
  const back = deserialize(serialize(st));
  assert.deepEqual(back.shop.inventory, st.shop.inventory);
  assert.deepEqual(back.shop.orders, st.shop.orders);
  assert.deepEqual(back.shop.markup, st.shop.markup);
  assert.equal(shopOpenStock(back), shopOpenStock(st));
  assert.ok(skuById(sku.id), 'catalog lookup works');
});

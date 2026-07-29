import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize, dailyTick } from '../src/sim/state.js';
import { placeOrder, cancelOrder } from '../src/sim/shop.js';
import {
  CLUBHOUSE_CLEANUP_MILESTONE_IDS,
  CLUBHOUSE_CLEANUP_TARGET_IDS,
  CLUBHOUSE_LIGHT_TARGET_IDS,
  CLUBHOUSE_RESTOCK_GROUP_IDS,
  ensureClubhouseRestoration,
  restorationAction,
  restorationSnapshot,
} from '../src/sim/clubhouseRestoration.js';
import { objectRecord, placedFixtures, storeFixture } from '../src/sim/layout.js';
import {
  STARTER_CARTON_SPECS,
  STARTER_RETAIL_ENTITLEMENT,
  STARTER_RETAIL_SKU_IDS,
  STARTER_RESTOCK_VERSION,
  starterRetailQuantity,
} from '../src/sim/clubhouseStarterStock.js';
import {
  CAMPAIGN_FACILITIES,
  CAMPAIGN_REPAIR_JOBS,
  CAMPAIGN_VERSION,
  FURNISHED_START_FIXTURES,
  FURNISHED_START_VERSION,
  workCampaignRepair,
  campaignItemAccounting,
  campaignView,
  ensureCampaign,
  firstDayProgress,
  laptopReadiness,
  openClubhouse,
  openingReadiness,
  tickCampaign,
} from '../src/sim/campaign.js';
import { RESERVATION_CHECK_IN_TYPE } from '../src/sim/reservationCheckIn.js';
import { INVENTORY_STAGE, moveInventory } from '../src/sim/inventoryLifecycle.js';

const OBSOLETE_FLATPACK_SKUS = Object.freeze([
  'desk1', 'chair1', 'laptop1', 'counter1', 'shelfkit1', 'safetykit1',
]);
function campaignState(seed = 8101) {
  return newGame('relaxed', seed, { campaign: true });
}

function cleanProperty(state) {
  state.shop.reno.grime.fill(0);
  state.shop.reno.clutter.forEach((pile) => { pile.cleared = true; });
  state.shop.reno.debris = [];
  state.shop.reno.pan = 0;
  state.shop.reno.bag = 0;
  state.shop.reno.windows.fill(0);
  for (const wash of Object.values(state.shop.reno.wash)) wash.grime.fill(0);
  state.shop.reno.exterior.weeds.fill(0);
  state.shop.reno.exterior.gutter = 0;
  state.shop.reno.exterior.cobwebs = 0;
  state.shop.reno.exterior.light = 0;
}

function completeRestoration(state, { skipLight = null } = {}) {
  cleanProperty(state);
  for (const targetId of CLUBHOUSE_CLEANUP_TARGET_IDS) {
    assert.equal(restorationAction(state, {
      type: 'set-target-progress', targetId, progress: 1,
    }).ok, true);
  }
  for (const milestoneId of CLUBHOUSE_CLEANUP_MILESTONE_IDS) {
    assert.equal(restorationAction(state, {
      type: 'complete-cleanup-milestone', milestoneId,
    }).ok, true);
  }
  for (const groupId of CLUBHOUSE_RESTOCK_GROUP_IDS) {
    assert.equal(restorationAction(state, {
      type: 'complete-restock-milestone', groupId,
    }).ok, true);
  }
  // The dilapidated start leaves every structural component broken; opening
  // requires them repaired. Run the real two-stage campaign verb per job
  // (remove the damaged piece, install components) with the kits it consumes.
  state.shop.inventory.repairkit1.back = (state.shop.inventory.repairkit1.back || 0)
    + CAMPAIGN_REPAIR_JOBS.length;
  for (const job of CAMPAIGN_REPAIR_JOBS) {
    const removal = workCampaignRepair(state, job.id);
    assert.equal(removal.ok, true, `${job.id} removal: ${removal.reason || ''}`);
    const install = workCampaignRepair(state, job.id);
    assert.equal(install.ok, true, `${job.id} install: ${install.reason || ''}`);
  }
  // Lights come LAST, and deliberately so: the `ceiling` job is "Office power
  // and ceiling", so until it is installed the ring is dead and a panel repair
  // correctly refuses. This is the order a player has to work in. Each panel
  // also spends its own kit.
  state.shop.inventory.repairkit1.back = (state.shop.inventory.repairkit1.back || 0)
    + CLUBHOUSE_LIGHT_TARGET_IDS.length;
  for (const targetId of CLUBHOUSE_LIGHT_TARGET_IDS) {
    if (targetId === skipLight) continue;
    const result = restorationAction(state, { type: 'repair-light', targetId });
    assert.equal(result.ok, true, `${targetId}: ${result.reason || ''}`);
  }
}

function starterAuthoritySnapshot(state) {
  const starterBoxes = state.shop.deliveries.boxes
    .filter((box) => box.starterRestockVersion === STARTER_RESTOCK_VERSION)
    .map((box) => ({
      carton: box.starterCartonId,
      contents: (box.contents || []).map((line) => `${line.skuId}:${line.quantity}`).sort(),
    }))
    .sort((a, b) => a.carton.localeCompare(b.carton));
  const starterLines = state.shop.inventoryLifecycle.lots
    .map((lot) => lot.lineId)
    .filter((lineId) => typeof lineId === 'string' && lineId.startsWith('pine-hills-starter-'))
    .sort();
  return {
    version: restorationSnapshot(state).starterRestockVersion,
    quantities: Object.fromEntries(STARTER_RETAIL_SKU_IDS.map((skuId) => [
      skuId,
      starterRetailQuantity(state, skuId),
    ])),
    shelf: Object.fromEntries(STARTER_RETAIL_SKU_IDS.map((skuId) => [
      skuId,
      state.shop.inventory[skuId].shelf,
    ])),
    starterBoxes,
    starterLines,
  };
}

function starterDurableSnapshot(state) {
  const { shelf: _displayProjection, ...durable } = starterAuthoritySnapshot(state);
  return durable;
}

function buckets(stage, quantity = 1) {
  return {
    inTransit: 0,
    deliveredUnopened: 0,
    openedBox: 0,
    reserve: 0,
    shelf: 0,
    customerHeld: 0,
    sold: 0,
    disposedLost: 0,
    [stage]: quantity,
  };
}

function legacyOrder(id, skuId, overrides = {}) {
  return {
    id,
    skuId,
    qty: 1,
    campaign: true,
    inherited: true,
    cost: 0,
    goods: 0,
    fee: 0,
    ...overrides,
  };
}

function legacyLot(order, stage = 'inTransit', quantity = 1) {
  return {
    id: `legacy-lot-${order.id}`,
    source: 'supplier',
    orderId: order.id,
    lineId: `legacy-line-${order.id}`,
    skuId: order.skuId,
    orderedQuantity: quantity,
    buckets: buckets(stage, quantity),
    createdMin: 300,
    active: true,
  };
}

test('fresh Pine Hills campaign is furnished, neglected, stocked, and closed', () => {
  const state = campaignState();
  assert.equal(state.campaign.version, CAMPAIGN_VERSION);
  assert.equal(state.campaign.furnishedStartVersion, FURNISHED_START_VERSION);
  assert.equal(state.campaign.businessOpen, false);
  assert.equal(state.shop.orders.length, 0, 'furniture is conveyed, not ordered as flat-packs');
  assert.equal(state.shop.inventory.vac1.back, 1);
  assert.equal(state.shop.inventory.repairkit1.back, 1);
  assert.equal(laptopReadiness(state).ready, true, 'the furnished office laptop works at arrival');

  for (const id of Object.keys(CAMPAIGN_FACILITIES)) {
    assert.equal(state.shop.reno.facilities[id], true, `${id} is installed`);
  }
  const placed = new Set(placedFixtures(state).map((fixture) => fixture.id));
  for (const id of FURNISHED_START_FIXTURES) {
    assert.equal(placed.has(id), true, `${id} is placed in the authored layout`);
  }

  const starter = starterAuthoritySnapshot(state);
  assert.equal(starter.version, STARTER_RESTOCK_VERSION);
  assert.deepEqual(
    starter.starterBoxes.map((box) => box.carton),
    STARTER_CARTON_SPECS.map((spec) => spec.id).sort(),
    'exactly the three authored mixed-SKU cartons are present',
  );
  for (const skuId of STARTER_RETAIL_SKU_IDS) {
    assert.equal(starter.quantities[skuId], STARTER_RETAIL_ENTITLEMENT[skuId], `${skuId} entitlement`);
    assert.equal(
      starter.shelf[skuId],
      Math.floor(STARTER_RETAIL_ENTITLEMENT[skuId] * 0.5),
      `${skuId} begins half displayed`,
    );
  }
  assert.equal(new Set(starter.starterLines).size, starter.starterLines.length, 'starter lots are unique');

  const restoration = restorationSnapshot(state);
  assert.equal(restoration.complete.discreteCleanup, false);
  assert.equal(restoration.complete.lighting, false);
  assert.equal(restoration.complete.restocking, false);
  assert.equal(state.shop.reno.debris.length, 18, 'neglect remains authored gameplay work');
  assert.equal(openingReadiness(state).ready, false);

  const taskIds = campaignView(state).tasks.map((task) => task.id);
  for (const id of ['furnished-inspection', 'cleanup-details', 'lighting-repairs', 'starter-stock', 'organize-floor']) {
    assert.equal(taskIds.includes(id), true, `${id} is projected`);
  }
  for (const id of [
    'starter-delivery', 'office-desk', 'office-chair', 'laptop-install',
    'order-opening-supplies', 'stockroom-shelves', 'display-shelves', 'counter', 'safety', 'lounge',
  ]) {
    assert.equal(taskIds.includes(id), false, `${id} legacy assembly objective is retired`);
  }
});

test('starter stock entitlement and its durable marker survive repeated ensure and save/load', () => {
  const state = campaignState(8102);
  const initial = starterDurableSnapshot(state);
  ensureCampaign(state);
  ensureCampaign(state);
  assert.deepEqual(starterDurableSnapshot(state), initial);

  const loaded = deserialize(serialize(state));
  assert.deepEqual(starterDurableSnapshot(loaded), initial);
  ensureCampaign(loaded);
  const loadedAgain = deserialize(serialize(loaded));
  assert.deepEqual(starterDurableSnapshot(loadedAgain), initial);
});

test('legacy furnished migration restores authored office fixtures without changing cash', () => {
  const state = campaignState(81_021);
  const storedOffice = ['office_desk', 'office_chair', 'office_filing', 'packing_bench'];
  for (const fixtureId of storedOffice) {
    assert.equal(storeFixture(state, fixtureId), true, `${fixtureId} can enter legacy storage`);
    assert.equal(objectRecord(state, fixtureId).state, 'stored');
  }
  state.campaign.version = 1;
  delete state.campaign.furnishedStartVersion;
  state.cash = 54_321.75;

  ensureCampaign(state);

  const placed = new Set(placedFixtures(state).map((fixture) => fixture.id));
  assert.equal(state.cash, 54_321.75, 'furnishing migration never posts money');
  for (const fixtureId of storedOffice) {
    assert.equal(objectRecord(state, fixtureId).state, 'placed', `${fixtureId} record is restored`);
    assert.equal(placed.has(fixtureId), true, `${fixtureId} is installed and visible to layout consumers`);
  }
});

test('legacy furnished migration retires only inherited zero-cost construction flat-packs', () => {
  const state = campaignState(8103);
  state.campaign.version = 1;
  delete state.campaign.furnishedStartVersion;
  state.campaign.completedObjectiveIds = ['survey', 'enter'];
  state.campaign.purchased = { counter1: 2, balls1: 4 };
  state.cash = 54_321.75;
  state.club.reputation = 41;
  state.reputation.overall = 41;
  state.reputation.categories.service = 39;
  state.reservations.booked.push({ id: 777, status: 'booked', fullName: 'Preserved Golfer' });
  state.shop.transactionHistory.push({ number: 77, minute: 350, total: 19 });
  state.shop.drawer['20'] += 1;

  const lifecycle = state.shop.inventoryLifecycle;
  const obsolete = OBSOLETE_FLATPACK_SKUS.map((skuId, index) => legacyOrder(9000 + index, skuId));
  const paidDesk = legacyOrder(9100, 'desk1', { cost: 180, goods: 170, fee: 10 });
  const nonInheritedChair = legacyOrder(9101, 'chair1', { inherited: false });
  const inheritedRepairKit = legacyOrder(9102, 'repairkit1');
  const preservedOrders = [paidDesk, nonInheritedChair, inheritedRepairKit];
  state.shop.orders.push(...obsolete, ...preservedOrders);
  lifecycle.orders.push(...obsolete.map((order) => ({ ...order })), ...preservedOrders.map((order) => ({ ...order })));

  state.shop.inventory.desk1.back = 2;
  lifecycle.lots.push(legacyLot(paidDesk, 'reserve', 2));
  const playerInventory = structuredClone(state.shop.inventory);
  state.shop.inventory.desk1.back += 1;
  lifecycle.lots.push(...obsolete.map((order) => legacyLot(
    order,
    order.skuId === 'desk1' ? 'reserve' : 'inTransit',
  )));
  lifecycle.lots.push(legacyLot(inheritedRepairKit));
  lifecycle.lots.push(legacyLot(nonInheritedChair));

  const everyOrder = [...obsolete, ...preservedOrders];
  state.shop.deliveries.boxes.push(...everyOrder.map((order) => ({
    id: order.id,
    orderId: order.id,
    skuId: order.skuId,
    loc: 'pad',
  })));
  state.shop.deliveries.shipments.push(...everyOrder.map((order) => ({
    orderId: order.id,
    skuId: order.skuId,
  })));
  state.shop.deliveries.arrivedOrderIds.push(...everyOrder.map((order) => order.id));

  const protectedState = structuredClone({
    cash: state.cash,
    clubReputation: state.club.reputation,
    reputation: state.reputation,
    reservations: state.reservations,
    drawer: state.shop.drawer,
    paymentBag: state.shop.paymentBag,
    held: state.shop.held,
    transactionHistory: state.shop.transactionHistory,
    purchased: state.campaign.purchased,
    completedObjectiveIds: state.campaign.completedObjectiveIds,
  });

  ensureCampaign(state);

  assert.equal(state.campaign.version, CAMPAIGN_VERSION);
  assert.equal(state.campaign.furnishedStartVersion, FURNISHED_START_VERSION);
  assert.deepEqual(state.shop.inventory, playerInventory, 'only the inherited desk projection is removed');
  assert.deepEqual({
    cash: state.cash,
    clubReputation: state.club.reputation,
    reputation: state.reputation,
    reservations: state.reservations,
    drawer: state.shop.drawer,
    paymentBag: state.shop.paymentBag,
    held: state.shop.held,
    transactionHistory: state.shop.transactionHistory,
    purchased: state.campaign.purchased,
    completedObjectiveIds: state.campaign.completedObjectiveIds,
  }, protectedState, 'progress, money, reputation, reservations, and checkout state survive');

  const retiredIds = new Set(obsolete.map((order) => order.id));
  for (const collection of [
    state.shop.orders,
    lifecycle.orders,
    state.shop.deliveries.boxes,
    state.shop.deliveries.shipments,
  ]) {
    assert.equal(collection.some((entry) => retiredIds.has(entry.orderId ?? entry.id)), false);
  }
  assert.equal(state.shop.deliveries.arrivedOrderIds.some((id) => retiredIds.has(id)), false);
  for (const order of preservedOrders) {
    assert.equal(state.shop.orders.some((candidate) => candidate.id === order.id), true, `${order.id} order remains`);
    assert.equal(state.shop.deliveries.boxes.some((box) => box.orderId === order.id), true, `${order.id} box remains`);
  }
  assert.equal(
    lifecycle.lots.some((lot) => lot.orderId === inheritedRepairKit.id),
    true,
    'the inherited repair kit remains part of the cleanup-and-repair flow',
  );

  const stable = serialize(state);
  ensureCampaign(state);
  assert.equal(serialize(state), stable, 'migration is idempotent after its durable marker is written');
});

test('legacy furnished load installs conveyed fixtures before reconciling display stock', () => {
  const state = campaignState(81_031);
  state.campaign.version = 1;
  delete state.campaign.furnishedStartVersion;
  const protectedSkus = [
    'range2', 'scorecard1', 'polo1', 'polo2', 'pants2', 'shorts1', 'jacket2',
    'water1', 'sportdrink2', 'soda1', 'chips1', 'bar2', 'crackers1', 'snack1',
  ];
  const expected = Object.fromEntries(protectedSkus.map((skuId) => [
    skuId,
    structuredClone(state.shop.inventory[skuId]),
  ]));
  const raw = JSON.parse(serialize(state));
  raw.version = 12;

  const loaded = deserialize(raw);
  for (const skuId of protectedSkus) {
    assert.deepEqual(
      loaded.shop.inventory[skuId],
      expected[skuId],
      `${skuId} remains on its conveyed Pine Hills fixture`,
    );
  }
});

test('legacy starter shortfall grants a unique replacement lot without erasing the sale', () => {
  const state = campaignState(81_032);
  const moved = moveInventory(state, {
    from: INVENTORY_STAGE.SHELF,
    to: INVENTORY_STAGE.SOLD,
    quantity: 1,
    skuId: 'balls1',
    referenceId: 'campaign-test-historical-sale',
    reason: 'Historical sale before furnished migration',
  });
  assert.equal(moved.ok, true);
  state.shop.inventory.balls1.shelf -= 1;
  state.campaign.version = 1;
  delete state.campaign.furnishedStartVersion;
  delete state.shop.reno.starterRestockVersion;
  const raw = JSON.parse(serialize(state));
  raw.version = 12;

  const loaded = deserialize(raw);
  const lots = loaded.shop.inventoryLifecycle.lots;
  const lineIds = lots
    .map((lot) => lot.lineId)
    .filter((lineId) => typeof lineId === 'string' && lineId.startsWith('pine-hills-starter-'));
  const position = loaded.shop.inventoryLifecycle.lots
    .filter((lot) => lot.active !== false && lot.skuId === 'balls1')
    .reduce((totals, lot) => {
      totals.sold += lot.buckets.sold || 0;
      totals.present += Object.entries(lot.buckets)
        .filter(([stage]) => !['sold', 'disposedLost'].includes(stage))
        .reduce((sum, [, quantity]) => sum + quantity, 0);
      return totals;
    }, { sold: 0, present: 0 });

  assert.equal(position.sold, 1, 'the historical sale remains in the lot ledger');
  assert.equal(position.present, STARTER_RETAIL_ENTITLEMENT.balls1, 'only the missing entitlement is replaced');
  assert.equal(new Set(lineIds).size, lineIds.length, 'every starter grant has a unique stable line id');
});

test('migrating an already-open clubhouse never re-dirties its completed restoration', () => {
  const state = campaignState(8104);
  state.campaign.version = 1;
  delete state.campaign.furnishedStartVersion;
  state.campaign.businessOpen = true;
  state.campaign.openedAt = 420;
  const reno = ensureClubhouseRestoration(state);
  for (const targetId of [...CLUBHOUSE_CLEANUP_TARGET_IDS, ...CLUBHOUSE_LIGHT_TARGET_IDS]) {
    reno.targetProgress[targetId] = 0;
  }
  reno.lightPanels['panel-02'] = 'flicker';
  reno.lightPanels['panel-07'] = 'dead';
  for (const milestoneId of CLUBHOUSE_CLEANUP_MILESTONE_IDS) reno.cleanupMilestones[milestoneId] = false;
  for (const groupId of CLUBHOUSE_RESTOCK_GROUP_IDS) reno.restockMilestones[groupId] = false;
  reno.fullCleanupAwarded = false;
  const reputationBefore = structuredClone(state.reputation);

  ensureCampaign(state);
  const migrated = restorationSnapshot(state);
  assert.equal(migrated.complete.discreteCleanup, true);
  assert.equal(migrated.complete.lighting, true);
  assert.equal(migrated.complete.existingCleanupSystems, true);
  assert.equal(migrated.complete.restocking, true);
  assert.equal(migrated.complete.fullCleanupAwarded, true);
  assert.deepEqual(state.reputation, reputationBefore, 'migration does not replay restoration awards');

  const loaded = deserialize(serialize(state));
  assert.deepEqual(restorationSnapshot(loaded), migrated);
  assert.equal(loaded.campaign.businessOpen, true);
  assert.equal(loaded.campaign.openedAt, 420);
});

test('opening readiness is projected from furnished inspection, cleanup, repair, restock, and routes', () => {
  const state = campaignState(8105);
  completeRestoration(state);
  const readiness = openingReadiness(state);
  assert.equal(
    readiness.ready,
    true,
    readiness.requirements.filter((item) => !item.ok).map((item) => item.reason).join('; '),
  );
  assert.deepEqual(
    readiness.requirements.map((item) => item.id),
    ['furnished', 'laptop', 'cleanup-details', 'cleanup-systems', 'lighting', 'repairs', 'stock', 'lobby', 'trash', 'routes'],
  );

  const reno = ensureClubhouseRestoration(state);
  reno.restockMilestones.balls = false;
  assert.equal(openingReadiness(state).requirements.find((item) => item.id === 'stock').ok, false);

  const missingLight = campaignState(81_051);
  completeRestoration(missingLight, { skipLight: 'ceiling:panel-02' });
  assert.equal(openingReadiness(missingLight).requirements.find((item) => item.id === 'lighting').ok, false);
});

test('opening schedules a real reservation and first-day goals read real transactions and books', () => {
  const state = campaignState(8106);
  completeRestoration(state);
  const opened = openClubhouse(state);
  assert.equal(opened.ok, true);
  assert.equal(state.campaign.businessOpen, true);
  assert.ok(opened.booking?.ok, 'opening day receives a real reservation');
  assert.equal(
    state.reservations.booked.some((reservation) => reservation.id === state.campaign.openingReservationId),
    true,
  );

  const minute = state.campaign.openedAt + 5;
  state.shop.transactionHistory.unshift({
    type: RESERVATION_CHECK_IN_TYPE,
    number: 2,
    minute,
    total: 80,
    items: [{ skuId: 'service:green-fee' }],
  });
  state.shop.transactionHistory.unshift({
    number: 3,
    minute: minute + 1,
    total: 15,
    items: [{ skuId: 'balls1' }],
  });
  state.shop.inventory.balls1.shelf -= 1;
  state.ledger.txLog.unshift({ m: minute, kind: 'rev', key: 'greenFees', amt: 80, bal: state.cash + 80 });
  state.ledger.txLog.unshift({ m: minute + 1, kind: 'rev', key: 'shopSales', amt: 15, bal: state.cash + 95 });
  state.club.reviews = [{ stars: 5, text: 'The reopening felt cared for.', day: state.campaign.operatingDayAbs, cited: [] }];
  state.ledger.history.push({
    dayAbs: state.campaign.operatingDayAbs,
    revenueTotal: 95,
    expenseTotal: 0,
    net: 95,
    revenue: { greenFees: 80, shopSales: 15 },
    expense: {},
  });

  const first = firstDayProgress(state);
  assert.deepEqual(
    {
      checkIn: first.checkIn,
      sale: first.merchandiseSale,
      shelfGap: first.shelfGap,
      review: first.review,
      books: first.booksClosed,
      complete: first.complete,
    },
    { checkIn: true, sale: true, shelfGap: true, review: true, books: true, complete: true },
  );
  assert.equal(tickCampaign(state).firstDayCompleted, true);
  assert.equal(state.campaign.firstDayComplete, true);
});

test('campaign supplier orders remain expedited, tracked, and safely cancellable', () => {
  const state = campaignState(8107);
  const now = state.clock.minutes;
  const placed = placeOrder(state, 'counter1', 1);
  assert.equal(placed.ok, true);
  assert.equal(placed.order.arrivesDay, Math.floor(placed.order.deliveryMin / 1440));
  assert.ok(placed.order.deliveryMin > now && placed.order.deliveryMin < now + 30);
  assert.equal(state.campaign.purchased.counter1, 1);
  assert.equal(campaignItemAccounting(state, 'counter1').expected, 1);

  assert.equal(cancelOrder(state, placed.order.id).ok, true);
  assert.equal(state.campaign.purchased.counter1, 0);
  assert.equal(campaignItemAccounting(state, 'counter1').expected, 0);
});

test('a closed campaign cannot earn abstract or booking revenue at midnight', () => {
  const state = campaignState(8108);
  state.club.lastRounds = 100;
  state.shop.inventory.balls1.shelf = 12;
  const before = {
    cash: state.cash,
    bookings: state.reservations.booked.length,
    financeEntries: state.reservations.financeEntries.length,
    generatedDays: [...state.reservations.generator.generatedDays],
  };
  dailyTick(state);
  assert.equal(state.shop.salesYesterday.units, 0);
  assert.equal(state.ledger.yesterday.revenue.shopSales, 0);
  assert.equal(state.ledger.yesterday.revenue.greenFees, 0);
  assert.equal(state.ledger.yesterday.revenue.bookingRevenue, 0);
  assert.equal(state.ledger.yesterday.revenue.bookingDeposits, 0);
  assert.deepEqual({
    cash: state.cash,
    bookings: state.reservations.booked.length,
    financeEntries: state.reservations.financeEntries.length,
    generatedDays: state.reservations.generator.generatedDays,
  }, before, 'a locked clubhouse cannot accept paid online bookings');
});

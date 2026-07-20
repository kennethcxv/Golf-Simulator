import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize, dailyTick } from '../src/sim/state.js';
import { placeOrder, cancelOrder } from '../src/sim/shop.js';
import { setArchitectureComponent } from '../src/sim/clubhouseRestoration.js';
import { restoreFixture } from '../src/sim/layout.js';
import {
  CAMPAIGN_FACILITIES,
  CAMPAIGN_REPAIR_JOBS,
  campaignItemAccounting,
  campaignRecoveryStatus,
  campaignView,
  campaignZoneProgress,
  ensureCampaignFacilities,
  firstDayProgress,
  installCampaignFacility,
  laptopReadiness,
  openClubhouse,
  openingReadiness,
  recordCampaignEvent,
  recoverCampaignItem,
  repairComplete,
  resetCampaignGuide,
  tickCampaign,
  workCampaignRepair,
} from '../src/sim/campaign.js';
import { RESERVATION_CHECK_IN_TYPE } from '../src/sim/reservationCheckIn.js';

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

function readyProperty(state) {
  cleanProperty(state);
  for (const job of CAMPAIGN_REPAIR_JOBS) {
    if (job.id === 'entranceDoor') state.shop.reno.entranceDoorRepaired = true;
    else assert.equal(setArchitectureComponent(state, job.id, true).ok, true);
  }
  const facilities = ensureCampaignFacilities(state);
  for (const id of Object.keys(CAMPAIGN_FACILITIES)) facilities[id] = true;
  for (const id of [
    'shelf_balls', 'shelf_acc', 'shelf_small', 'backcounter',
    'backshelf_n', 'backshelf_e', 'backshelf_e2',
  ]) restoreFixture(state, id);
  state.shop.inventory.balls1.shelf = 6;
  state.shop.inventory.tees1.shelf = 4;
}

test('fresh campaign starts closed, empty, neglected, and with physical inherited deliveries', () => {
  const state = campaignState();
  assert.equal(state.campaign.enabled, true);
  assert.equal(state.campaign.businessOpen, false);
  assert.equal(state.shop.inventory.balls1.shelf, 0);
  assert.equal(state.shop.inventory.tees1.shelf, 0);
  assert.equal(state.shop.inventory.vac1.back, 1, 'the essential cleaning kit cannot be lost at start');
  assert.deepEqual(state.shop.orders.map((order) => order.skuId).sort(),
    ['chair1', 'desk1', 'laptop1', 'repairkit1']);
  assert.ok(state.shop.orders.every((order) => order.inherited && order.cost === 0));
  assert.ok(state.shop.reno.debris.length > 0, 'loose debris is real save state before the renderer exists');
  assert.equal(campaignView(state).currentTask.id, 'survey');
  assert.equal(openingReadiness(state).ready, false);
});

test('arrival and room objectives advance from real events and cleaning masks in alternate order', () => {
  const state = campaignState(8102);
  const before = campaignZoneProgress(state);
  assert.ok(before.lobby < 0.5);

  // Cleaning can happen before the arrival presentation completes; it banks.
  cleanProperty(state);
  const cleaned = campaignZoneProgress(state);
  assert.equal(cleaned.lobby, 1);
  assert.equal(cleaned.windows, 1);
  assert.equal(cleaned.looseDebris, 1);

  recordCampaignEvent(state, 'walkedToClubhouse');
  recordCampaignEvent(state, 'lookedAround');
  recordCampaignEvent(state, 'enteredClubhouse');
  const result = tickCampaign(state);
  assert.ok(result.advanced.some((task) => task.id === 'survey'));
  assert.ok(result.advanced.some((task) => task.id === 'lobby-clean'));
  assert.ok(state.campaign.completedObjectiveIds.includes('enter'));
});

test('office installation consumes unpacked inventory and laptop remains diegetically gated', () => {
  const state = campaignState(8103);
  cleanProperty(state);
  state.shop.inventory.desk1.back = 1;
  state.shop.inventory.chair1.back = 1;
  state.shop.inventory.laptop1.back = 1;
  state.shop.inventory.repairkit1.back = 1;

  assert.equal(laptopReadiness(state).ready, false);
  assert.equal(installCampaignFacility(state, 'officeDesk').ok, true);
  assert.equal(state.shop.inventory.desk1.back, 0);
  assert.equal(installCampaignFacility(state, 'officeChair').ok, true);

  const removed = workCampaignRepair(state, 'ceiling');
  assert.deepEqual({ ok: removed.ok, stage: removed.stage }, { ok: true, stage: 'removed' });
  const installed = workCampaignRepair(state, 'ceiling');
  assert.deepEqual({ ok: installed.ok, stage: installed.stage }, { ok: true, stage: 'installed' });
  assert.equal(repairComplete(state, 'ceiling'), true);
  assert.equal(installCampaignFacility(state, 'laptop').ok, true);
  assert.equal(laptopReadiness(state).ready, true);
  assert.equal(state.shop.inventory.laptop1.back, 0);
});

test('supplier campaign orders are expedited, tracked, and cancellation unwinds recovery entitlement', () => {
  const state = campaignState(8104);
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

test('lost entitled furnishings recover exactly once without duplication', () => {
  const state = campaignState(8105);
  state.shop.orders = state.shop.orders.filter((order) => order.skuId !== 'desk1');
  const missing = campaignItemAccounting(state, 'desk1');
  assert.equal(missing.expected, 1);
  assert.equal(missing.accounted, 0);
  assert.equal(campaignRecoveryStatus(state).needed, true);

  const recovered = recoverCampaignItem(state, 'desk1');
  assert.equal(recovered.ok, true);
  assert.equal(recovered.qty, 1);
  assert.equal(campaignItemAccounting(state, 'desk1').missing, 0);
  assert.equal(recoverCampaignItem(state, 'desk1').ok, false, 'a second recovery cannot mint another desk');
});

test('opening readiness is entirely derived from repairs, installations, stock, trash, and routes', () => {
  const state = campaignState(8106);
  readyProperty(state);
  const readiness = openingReadiness(state);
  assert.equal(readiness.ready, true, readiness.requirements.filter((item) => !item.ok).map((item) => item.reason).join('; '));

  state.shop.inventory.balls1.shelf = 0;
  state.shop.inventory.tees1.shelf = 0;
  const noStock = openingReadiness(state);
  assert.equal(noStock.ready, false);
  assert.equal(noStock.requirements.find((item) => item.id === 'stock').ok, false);

  state.shop.inventory.balls1.shelf = 6;
  state.shop.inventory.tees1.shelf = 4;
  state.shop.reno.clutter[0].cleared = false;
  assert.equal(openingReadiness(state).requirements.find((item) => item.id === 'trash').ok, false);
});

test('opening schedules one real reservation and first-day completion reads real tickets, books, stock, and review', () => {
  const state = campaignState(8107);
  readyProperty(state);
  const opened = openClubhouse(state);
  assert.equal(opened.ok, true);
  assert.equal(state.campaign.businessOpen, true);
  assert.ok(opened.booking?.ok, 'opening day receives a real reservation');
  assert.equal(state.reservations.booked.some((reservation) => reservation.id === state.campaign.openingReservationId), true);

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
    { checkIn: first.checkIn, sale: first.merchandiseSale, shelfGap: first.shelfGap, review: first.review, books: first.booksClosed, complete: first.complete },
    { checkIn: true, sale: true, shelfGap: true, review: true, books: true, complete: true },
  );
  const ticked = tickCampaign(state);
  assert.equal(ticked.firstDayCompleted, true);
  assert.equal(state.campaign.firstDayComplete, true);
});

test('campaign survives save/load at intermediate work stages and reset never rewinds the world', () => {
  const state = campaignState(8108);
  cleanProperty(state);
  state.shop.inventory.repairkit1.back = 1;
  assert.equal(workCampaignRepair(state, 'ceiling').stage, 'removed');
  recordCampaignEvent(state, 'lookedAround');
  tickCampaign(state);

  const loaded = deserialize(serialize(state));
  assert.equal(loaded.shop.reno.repairWork.ceiling.removed, true);
  assert.equal(loaded.campaign.events.lookedAround, true);
  assert.equal(campaignZoneProgress(loaded).lobby, 1);
  const beforeOrders = loaded.shop.orders.length;
  resetCampaignGuide(loaded);
  assert.equal(loaded.shop.reno.repairWork.ceiling.removed, true);
  assert.equal(loaded.shop.orders.length, beforeOrders);
  assert.equal(loaded.campaign.hidden, false);
});

test('a closed campaign cannot earn abstract shop revenue at midnight', () => {
  const state = campaignState(8109);
  state.club.lastRounds = 100;
  state.shop.inventory.balls1.shelf = 12;
  dailyTick(state);
  assert.equal(state.shop.salesYesterday.units, 0);
  assert.equal(state.ledger.yesterday.revenue.shopSales, 0);
  assert.equal(state.ledger.yesterday.revenue.greenFees, 0);
});


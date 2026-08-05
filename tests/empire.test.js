import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY, ZONE } from '../src/sim/constants.js';
import { BALANCE } from '../src/sim/balance.js';
import { update } from '../src/sim/state.js';
import { courseDesignRating } from '../src/sim/course.js';
import { conditionRating, sectionTurfSummary, DISEASE } from '../src/sim/turf.js';
import { memberCounts } from '../src/sim/club.js';
import { appraiseProperty } from '../src/sim/valuation.js';
import {
  newEmpire,
  newStarterEmpire,
  buyProperty,
  sellProperty,
  activeState,
  serializeEmpire,
  deserializeEmpire,
} from '../src/sim/empire.js';

function memberTotal(st) {
  const c = memberCounts(st);
  return c.weekday + c.full + c.premium;
}

test('newEmpire starts with a wallet, a full market, and no holdings', () => {
  const e = newEmpire('realistic', 42);
  assert.equal(e.cash, BALANCE.startingCash.realistic);
  assert.ok(e.market.length >= 6);
  assert.equal(e.holdings.length, 0);
  assert.equal(e.activeId, null);
  assert.equal(e.market.find((property) => property.id === 'willow-creek')?.name, 'Pine Hills Municipal Golf');
  const relaxed = newEmpire('relaxed', 42);
  assert.equal(relaxed.cash, BALANCE.startingCash.relaxed);
});

test('player-facing New Game owns and enters the three-hole Pine Hills starter immediately', () => {
  const e = newStarterEmpire('relaxed', 42);
  const st = activeState(e);
  assert.equal(e.activeId, 'willow-creek');
  assert.equal(e.holdings.length, 1);
  assert.equal(e.holdings[0].property.size, 3);
  assert.equal(st.course.holes.length, 3);
  assert.equal(st.tutorial.complete, false, 'the live state-driven tutorial starts with the course');
  assert.equal(e.market.some((property) => property.id === 'willow-creek'), false);

  const loaded = deserializeEmpire(serializeEmpire(e));
  assert.equal(loaded.holdings[0].property.size, 3, 'the compact starter survives save/load');
  assert.equal(activeState(loaded).course.holes.length, 3);
});

test('buying deducts the asking price and boots a fully-initialized club', () => {
  const e = newEmpire('relaxed', 42);
  const listing = e.market.find((p) => p.id === 'willow-creek');
  const cashBefore = e.cash;
  const res = buyProperty(e, 'willow-creek');
  assert.equal(res.ok, true, res.reason);
  assert.equal(e.cash, cashBefore - listing.askingPrice, 'exact ask deducted');
  assert.equal(e.holdings.length, 1);
  assert.equal(e.activeId, 'willow-creek', 'first purchase becomes the active property');
  assert.ok(!e.market.some((p) => p.id === 'willow-creek'), 'listing left the market');

  const st = activeState(e);
  assert.equal(st.cash, e.cash, 'active club banks the empire wallet');
  assert.equal(st.clubName, listing.name);
  assert.equal(st.clubName, 'Pine Hills Municipal Golf');
  assert.equal(st.course.holes.length, listing.size);
  for (const system of ['turf', 'club', 'staff', 'shop', 'golfers', 'ledger', 'progression', 'tutorial', 'maintenance']) {
    assert.ok(st[system], `${system} initialized like a fresh newGame`);
  }
  assert.ok(st.sections.length > 0);
  // and it actually RUNS: two full days of the whole simulation stack
  const r = update(st, 2 * MINUTES_PER_DAY);
  assert.equal(r.daysPassed, 2);
  assert.ok(st.ledger.history.length >= 2, 'books close while owned');
});

test('custom starting-property and club names survive portfolio serialization', () => {
  const e = newEmpire('relaxed', 43);
  assert.equal(buyProperty(e, 'willow-creek').ok, true);
  e.holdings[0].property.name = 'Cedar Crest Golf Property';
  activeState(e).clubName = 'Cedar Crest Golf';

  const loaded = deserializeEmpire(serializeEmpire(e));

  assert.equal(loaded.holdings[0].property.id, 'willow-creek', 'the stable internal ID is unchanged');
  assert.equal(loaded.holdings[0].property.name, 'Cedar Crest Golf Property');
  assert.equal(activeState(loaded).clubName, 'Cedar Crest Golf');
});

test('legacy default starting-property and club names migrate to Pine Hills', () => {
  const e = newEmpire('relaxed', 44);
  assert.equal(buyProperty(e, 'willow-creek').ok, true);
  e.holdings[0].property.name = 'Willow Creek Municipal';
  activeState(e).clubName = 'Willow Creek Golf Club';

  const migrated = deserializeEmpire(serializeEmpire(e));

  assert.equal(migrated.holdings[0].property.name, 'Pine Hills Municipal Golf');
  assert.equal(activeState(migrated).clubName, 'Pine Hills Municipal Golf');
});

test('a bought property realizes the stats on its listing', () => {
  const e = newEmpire('realistic', 4242);
  e.cash = 10_000_000;
  buyProperty(e, 'flatiron-meadows');
  const h = e.holdings[0];
  const st = h.state;
  assert.ok(Math.abs(conditionRating(st) - h.property.condition) <= 4,
    `condition seeded to target: wanted ${h.property.condition}, got ${conditionRating(st)}`);
  assert.ok(Math.abs(courseDesignRating(st.course, st.sections) - h.property.design) < 0.5);
  assert.equal(memberTotal(st), h.property.startingMembers, 'membership book matches the listing');
  assert.equal(st.club.reputation, h.property.startingReputation);
  const sickGreens = st.sections.filter((s) => s.zone === ZONE.GREEN && s.holeId != null && sectionTurfSummary(st, s).disease);
  assert.equal(sickGreens.length, h.property.sickGreens, 'exactly the listed number of sick greens');
});

test('a waterlogged listing seeds its flavor disease', () => {
  const e = newEmpire('realistic', 4242);
  e.cash = 10_000_000;
  buyProperty(e, 'cypress-hollow');
  const st = e.holdings[0].state;
  const diseased = st.sections
    .filter((s) => s.zone === ZONE.GREEN)
    .map((s) => sectionTurfSummary(st, s).disease)
    .filter(Boolean);
  assert.ok(diseased.length > 0, 'cypress hollow arrives sick');
  assert.ok(diseased.some((d) => d.type === DISEASE.BROWN_PATCH), 'and it is brown patch, per the story');
});

test('every archetype initializes to spec and appraises near its hidden true value', () => {
  const roster = newEmpire('realistic', 777).market.map((p) => p.id);
  assert.ok(roster.length >= 6);
  for (const id of roster) {
    const e = newEmpire('realistic', 777);
    e.cash = 10_000_000;
    const res = buyProperty(e, id);
    assert.equal(res.ok, true, `${id}: ${res.reason}`);
    const h = e.holdings[0];
    const st = h.state;
    assert.ok(Math.abs(conditionRating(st) - h.property.condition) <= 4,
      `${id}: condition ${conditionRating(st)} vs target ${h.property.condition}`);
    const v = appraiseProperty(st);
    const drift = Math.abs(v - h.property.trueValue) / h.property.trueValue;
    assert.ok(drift <= 0.15, `${id}: appraisal ${v} within 15% of listed true value ${h.property.trueValue}`);
    const r = update(st, MINUTES_PER_DAY);
    assert.equal(r.daysPassed, 1, `${id}: a full simulated day runs clean`);
  }
});

test('buying without sufficient funds is refused with a clear reason', () => {
  const e = newEmpire('realistic', 42);
  e.cash = 900;
  const marketBefore = e.market.length;
  const res = buyProperty(e, 'willow-creek');
  assert.equal(res.ok, false);
  assert.ok(/cash|asking|afford/i.test(res.reason), `reason explains the money problem: "${res.reason}"`);
  assert.equal(e.market.length, marketBefore, 'listing not consumed');
  assert.equal(e.holdings.length, 0);
  assert.equal(e.cash, 900, 'no money moved');
});

test('buying a listing that does not exist is refused', () => {
  const e = newEmpire('realistic', 42);
  const res = buyProperty(e, 'augusta-national');
  assert.equal(res.ok, false);
  assert.ok(res.reason.length > 5);
});

test('selling pays the live valuation and the property is genuinely gone', () => {
  const e = newEmpire('relaxed', 42);
  buyProperty(e, 'willow-creek');
  const st = activeState(e);
  update(st, 3 * MINUTES_PER_DAY);
  const expected = appraiseProperty(st);
  const cashBefore = st.cash;
  const res = sellProperty(e, 'willow-creek');
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.payout, expected, 'payout is exactly the displayed valuation');
  assert.ok(Math.abs(e.cash - (cashBefore + expected)) < 0.01, 'payout landed in the wallet');
  assert.equal(e.holdings.length, 0, 'holding removed');
  assert.equal(e.activeId, null, 'no active property after selling it');
  assert.ok(!e.market.some((p) => p.id === 'willow-creek'), 'sold forever - not quietly re-listed');
  assert.equal(activeState(e), null);
});

test('selling a property you do not own is refused', () => {
  const e = newEmpire('realistic', 42);
  const res = sellProperty(e, 'willow-creek');
  assert.equal(res.ok, false);
  assert.ok(/own/i.test(res.reason), res.reason);
  buyProperty(e, 'willow-creek');
  const res2 = sellProperty(e, 'bent-pines');
  assert.equal(res2.ok, false);
});

test('the first property runs the tutorial; later acquisitions skip it', () => {
  const e = newEmpire('relaxed', 42);
  buyProperty(e, 'willow-creek');
  assert.equal(e.holdings[0].state.tutorial.complete, false, 'first club teaches the ropes');
  buyProperty(e, 'bent-pines');
  const second = e.holdings.find((h) => h.property.id === 'bent-pines').state;
  assert.equal(second.tutorial.complete, true, 'you already know how to run a club');
});

test('owning two properties keeps one wallet and a shared world clock', () => {
  const e = newEmpire('relaxed', 42);
  const start = e.cash;
  const askA = e.market.find((p) => p.id === 'willow-creek').askingPrice;
  buyProperty(e, 'willow-creek');
  const a = activeState(e);
  update(a, 5 * MINUTES_PER_DAY); // live at Willow for five days
  const askB = e.market.find((p) => p.id === 'bent-pines').askingPrice;
  const res = buyProperty(e, 'bent-pines');
  assert.equal(res.ok, true, res.reason);
  assert.equal(e.activeId, 'willow-creek', 'buying does not yank you to the new property');
  const b = e.holdings.find((h) => h.property.id === 'bent-pines').state;
  assert.equal(a.cash, e.cash, 'active club still carries the wallet');
  assert.ok(Math.abs(a.cash - (start - askA - askB + sumNet(a))) < 2000, 'wallet reflects both purchases plus a few days of trading');
  assert.equal(b.cash, 0, 'parked property holds no separate cash');
  assert.equal(b.clock.minutes, a.clock.minutes, 'new property joins at world time, not day one');
});

function sumNet(st) {
  return st.ledger.history.reduce((sum, d) => sum + d.net, 0);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY } from '../src/sim/constants.js';
import { conditionRating } from '../src/sim/turf.js';
import { memberCounts } from '../src/sim/club.js';
import { newGame, serialize } from '../src/sim/state.js';
import { appraiseStats } from '../src/sim/marketplace.js';
import {
  newEmpire, buyProperty, sellProperty, activeState, activeHolding,
  switchProperty, empireUpdate, serializeEmpire, deserializeEmpire, holdingValue,
} from '../src/sim/empire.js';

function ownTwo(seed = 42) {
  const e = newEmpire('relaxed', seed);
  buyProperty(e, 'willow-creek'); // becomes active
  buyProperty(e, 'bent-pines'); // parked from birth
  return e;
}

function boostTurf(st) {
  st.turf.health.fill(90);
  st.turf.moisture.fill(55);
  st.turf.nutrients.fill(55);
  st.turf.heightMm.fill(6);
  st.turf.wear.fill(3);
  st.turf.disType.fill(0);
  st.turf.disSev.fill(0);
}

test('switching restores the target completely and preserves the parked club', () => {
  const e = ownTwo();
  const willow = activeState(e);
  empireUpdate(e, 3 * MINUTES_PER_DAY); // live three days at Willow

  // fingerprint Willow before leaving (cash is the wallet, clock is world time — both excluded)
  const fingerprint = (st) => {
    const s = JSON.parse(serialize(st));
    delete s.cash;
    delete s.clock;
    return s;
  };
  const willowBefore = fingerprint(willow);
  const wallet = e.cash;

  const res = switchProperty(e, 'bent-pines');
  assert.equal(res.ok, true, res.reason);
  assert.equal(e.activeId, 'bent-pines');
  const bent = activeState(e);
  assert.equal(bent.clubName, 'Bent Pines Golf Club');
  assert.equal(bent.clock.minutes, willow.clock.minutes, 'parked club rejoins world time on activation');
  assert.ok(Math.abs(bent.cash - wallet) < 0.01, 'the wallet follows you');

  const back = switchProperty(e, 'willow-creek');
  assert.equal(back.ok, true);
  assert.deepEqual(fingerprint(activeState(e)), willowBefore,
    'everything at Willow — golfers, staff, turf, books — survived the round trip untouched');
});

test('only the active property advances; parked ones tick a summary, not a sim', () => {
  const e = ownTwo();
  const bent = e.holdings.find((h) => h.property.id === 'bent-pines');
  empireUpdate(e, 5 * MINUTES_PER_DAY);
  assert.equal(activeState(e).ledger.history.length, 5, 'the active club closed five real books');
  assert.equal(bent.state.ledger.history.length, 0, 'the parked club closed none');
  assert.equal(bent.passive.days, 5, 'but it accrued five passive days');
  assert.ok(Number.isFinite(bent.passive.sinceVisitNet));
  assert.equal(bent.state.clock.minutes < activeState(e).clock.minutes, true, 'parked clock stands still until reconciled');
});

test('passive income credits the one wallet', () => {
  const e = ownTwo();
  const bent = e.holdings.find((h) => h.property.id === 'bent-pines');
  const before = activeState(e).cash;
  empireUpdate(e, 4 * MINUTES_PER_DAY);
  const activeNet = activeState(e).ledger.history.reduce((a, d) => a + d.net, 0)
    + Object.values(activeState(e).ledger.today.revenue).reduce((a, v) => a + v, 0)
    - Object.values(activeState(e).ledger.today.expense).reduce((a, v) => a + v, 0);
  const expected = before + activeNet + bent.passive.sinceVisitNet;
  assert.ok(Math.abs(activeState(e).cash - expected) < 1.5,
    `wallet = own books + parked trickle (got ${activeState(e).cash}, expected ${expected})`);
  assert.equal(e.cash, activeState(e).cash);
});

test('passive drift and income stay bounded over very long absences', () => {
  const e = ownTwo();
  const bent = e.holdings.find((h) => h.property.id === 'bent-pines');

  // park a THRIVING version: switch there, restore it, come back
  switchProperty(e, 'bent-pines');
  boostTurf(bent.state);
  switchProperty(e, 'willow-creek');
  const estAtPark = bent.passive.conditionEst;
  assert.ok(estAtPark >= 80, `parked in glory: ${estAtPark}`);

  let prev = estAtPark;
  for (let d = 0; d < 192; d++) { // two full unvisited years
    empireUpdate(e, MINUTES_PER_DAY);
    const p = bent.passive;
    assert.ok(p.conditionEst <= prev + 1e-9, 'decay is monotonic');
    assert.ok(p.conditionEst >= 38 - 1e-6, 'the caretaker floor holds');
    assert.ok(Number.isFinite(p.lastNet) && p.lastNet >= -1600 && p.lastNet <= 5200, `daily net stays in bounds: ${p.lastNet}`);
    prev = p.conditionEst;
  }
  assert.ok(bent.passive.conditionEst < estAtPark - 25, 'two unvisited years genuinely cost condition');
  assert.ok(bent.passive.conditionEst >= 38, 'but never below the floor');
  assert.ok(Number.isFinite(e.cash) && e.cash > -100000, 'wallet never runs away');
});

test('a wreck parked below the floor holds — the caretaker does not restore it for free', () => {
  const e = ownTwo(); // bent pines arrives at C≈30, parked from birth
  const bent = e.holdings.find((h) => h.property.id === 'bent-pines');
  const est0 = bent.passive.conditionEst;
  assert.ok(est0 <= 34, `bent pines parks as a wreck: ${est0}`);
  empireUpdate(e, 40 * MINUTES_PER_DAY);
  assert.ok(Math.abs(bent.passive.conditionEst - est0) < 0.01, 'no free restoration while parked');
});

test('returning reconciles the drift into the real turf', () => {
  const e = ownTwo();
  switchProperty(e, 'bent-pines');
  boostTurf(activeState(e));
  switchProperty(e, 'willow-creek'); // parks Bent in restored shape
  const bent = e.holdings.find((h) => h.property.id === 'bent-pines');
  const estAtPark = bent.passive.conditionEst;

  for (let d = 0; d < 40; d++) empireUpdate(e, MINUTES_PER_DAY);
  const estBeforeReturn = bent.passive.conditionEst;
  assert.ok(estBeforeReturn < estAtPark - 15, 'forty days away hurt');

  switchProperty(e, 'bent-pines');
  const realized = conditionRating(activeState(e));
  assert.ok(Math.abs(realized - estBeforeReturn) <= 4,
    `the real course shows the decay: estimated ${estBeforeReturn}, walked onto ${realized}`);
  assert.equal(activeState(e).clock.minutes, e.clockMinutes, 'clock caught up to the world');
});

test('a parked property sells at its decayed estimate, not its parked-day glory', () => {
  const e = ownTwo();
  switchProperty(e, 'bent-pines');
  boostTurf(activeState(e));
  switchProperty(e, 'willow-creek');
  const bent = e.holdings.find((h) => h.property.id === 'bent-pines');
  const valueAtPark = holdingValue(e, bent);
  for (let d = 0; d < 60; d++) empireUpdate(e, MINUTES_PER_DAY);
  const displayed = holdingValue(e, bent);
  assert.ok(displayed < valueAtPark, `decay priced in: ${valueAtPark} → ${displayed}`);
  const res = sellProperty(e, 'bent-pines');
  assert.equal(res.ok, true);
  assert.equal(res.payout, displayed, 'payout is exactly the number the empire screen showed');
});

test('save/load round-trips an entire multi-property portfolio', () => {
  const e = ownTwo();
  empireUpdate(e, 6 * MINUTES_PER_DAY);
  const json = serializeEmpire(e);
  assert.equal(typeof json, 'string');
  const back = deserializeEmpire(json);

  assert.equal(back.mode, e.mode);
  assert.ok(Math.abs(back.cash - e.cash) < 0.01);
  assert.equal(back.activeId, e.activeId);
  assert.deepEqual(back.market.map((p) => p.id), e.market.map((p) => p.id));
  assert.equal(back.holdings.length, 2);
  for (const h of e.holdings) {
    const bh = back.holdings.find((x) => x.property.id === h.property.id);
    assert.ok(bh, `${h.property.id} survived`);
    assert.deepEqual(bh.property, h.property, 'property record intact');
    assert.deepEqual(bh.passive, h.passive, 'passive block intact');
    assert.deepEqual(memberCounts(bh.state), memberCounts(h.state));
    assert.deepEqual(
      Array.from(bh.state.turf.health),
      Array.from(h.state.turf.health).map((v) => Math.fround(Math.round(v * 10) / 10)),
      'turf survives at save precision',
    );
    assert.equal(bh.state.clock.minutes, h.state.clock.minutes);
  }
  // and the loaded empire actually plays
  const r = empireUpdate(back, MINUTES_PER_DAY);
  assert.equal(r.daysPassed, 1);
});

test('a sold property never resurrects through a save cycle', () => {
  const e = ownTwo();
  sellProperty(e, 'bent-pines');
  const back = deserializeEmpire(serializeEmpire(e));
  assert.ok(!back.holdings.some((h) => h.property.id === 'bent-pines'));
  assert.ok(!back.market.some((p) => p.id === 'bent-pines'));
  // only the transaction log may remember it — no state, no listing
  assert.ok(!JSON.stringify(back.holdings).includes('Bent Pines'), 'no state survives');
  assert.ok(!JSON.stringify(back.market).includes('Bent Pines'), 'not quietly re-listed');
});

test('a legacy single-club save loads as a one-property empire', () => {
  const legacy = newGame('realistic', 42);
  const empire = deserializeEmpire(serialize(legacy));
  assert.equal(empire.holdings.length, 1);
  assert.equal(empire.activeId, empire.holdings[0].property.id);
  assert.ok(Math.abs(empire.cash - legacy.cash) < 0.01);
  assert.equal(activeState(empire).clubName, legacy.clubName);
  const r = empireUpdate(empire, MINUTES_PER_DAY);
  assert.equal(r.daysPassed, 1);
});

test('switching to a property you do not own is refused; switching to yourself is a no-op', () => {
  const e = ownTwo();
  const res = switchProperty(e, 'augusta-national');
  assert.equal(res.ok, false);
  const same = switchProperty(e, 'willow-creek');
  assert.equal(same.ok, true);
  assert.equal(e.activeId, 'willow-creek');
  assert.equal(activeHolding(e).passive, null, 'active holding carries no passive block');
});

test('parked estimates match appraiseStats over the frozen summary', () => {
  const e = ownTwo();
  empireUpdate(e, 10 * MINUTES_PER_DAY);
  const bent = e.holdings.find((h) => h.property.id === 'bent-pines');
  const p = bent.passive;
  const expected = appraiseStats({
    size: bent.property.size,
    design: p.design,
    condition: p.conditionEst,
    members: p.members,
    reputation: p.reputation,
    monthlyNet: p.lastNet * 24,
  });
  assert.equal(holdingValue(e, bent), expected, 'displayed parked value is the documented formula');
});

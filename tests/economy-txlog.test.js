// The ledger's transaction log: written at the addRevenue/addExpense chokepoint, so the
// Finances page's feed can never disagree with the category lines.
import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, snapshot, deserialize } from '../src/sim/state.js';
import { addRevenue, addExpense, unbill, TX_LOG_CAP } from '../src/sim/economy.js';

test('revenue, expense and refund each file one row with the running balance', () => {
  const st = newGame('relaxed', 61);
  const start = st.cash;
  addRevenue(st, 'greenFees', 45);
  addExpense(st, 'shopOrders', 120.5);
  unbill(st, 'shopOrders', 120.5);
  const log = st.ledger.txLog;
  assert.equal(log.length, 3);
  // newest first
  assert.equal(log[0].kind, 'refund');
  assert.equal(log[1].kind, 'exp');
  assert.equal(log[2].kind, 'rev');
  assert.equal(log[2].bal, Math.round((start + 45) * 100) / 100);
  assert.equal(log[0].bal, Math.round((start + 45) * 100) / 100); // refund restored it
  assert.equal(log[1].key, 'shopOrders');
});

test('a NaN or non-positive amount never reaches the log', () => {
  const st = newGame('relaxed', 62);
  addRevenue(st, 'greenFees', NaN);
  addRevenue(st, 'greenFees', -5);
  addExpense(st, 'water', undefined);
  assert.equal(st.ledger.txLog.length, 0);
});

test('the log is bounded at TX_LOG_CAP', () => {
  const st = newGame('relaxed', 63);
  for (let i = 0; i < TX_LOG_CAP + 20; i++) addRevenue(st, 'greenFees', 1 + (i % 3));
  assert.equal(st.ledger.txLog.length, TX_LOG_CAP);
});

test('the log survives save/load, and damaged rows heal', () => {
  const st = newGame('relaxed', 64);
  addRevenue(st, 'greenFees', 32);
  addExpense(st, 'rent', 900);
  const raw = JSON.parse(JSON.stringify(snapshot(st)));
  raw.ledger.txLog.push({ key: 'water', kind: 'exp', m: NaN, amt: null, bal: Infinity });
  raw.ledger.txLog.push('garbage');
  raw.ledger.txLog.push({ noKey: true });
  const loaded = deserialize(JSON.stringify(raw));
  const log = loaded.ledger.txLog;
  assert.equal(log.length, 3); // two real + one healed; the two malformed rows dropped
  const healed = log.find((t) => t.key === 'water');
  assert.equal(healed.m, 0);
  assert.equal(healed.amt, 0);
  assert.equal(healed.bal, 0);
});

test('a pre-log legacy ledger gains an empty log on load', () => {
  const st = newGame('relaxed', 65);
  const raw = JSON.parse(JSON.stringify(snapshot(st)));
  delete raw.ledger.txLog;
  const loaded = deserialize(JSON.stringify(raw));
  assert.ok(Array.isArray(loaded.ledger.txLog));
  assert.equal(loaded.ledger.txLog.length, 0);
});

test('laptop office preferences persist through save/load', () => {
  const st = newGame('relaxed', 66);
  st.uiPrefs.laptopScale = 1.15;
  st.uiPrefs.financeWindow = 'season';
  const loaded = deserialize(JSON.stringify(snapshot(st)));
  assert.equal(loaded.uiPrefs.laptopScale, 1.15);
  assert.equal(loaded.uiPrefs.financeWindow, 'season');
  const rawNoPrefs = JSON.parse(JSON.stringify(snapshot(st)));
  delete rawNoPrefs.uiPrefs;
  const legacy = deserialize(JSON.stringify(rawNoPrefs));
  assert.deepEqual(legacy.uiPrefs, {});
});

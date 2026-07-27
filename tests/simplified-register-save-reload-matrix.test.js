import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  DEFAULT_QUICK_CASE_IDS,
  SAVE_RELOAD_MATRIX,
  resolveSaveReloadCaseIds,
} from '../tools/qa/simplified-register-save-reload.mjs';
import { CHECKOUT_STATES } from '../src/sim/registerFlow.js';

const driverSource = fs.readFileSync(
  new URL('../tools/qa/simplified-register-save-reload.mjs', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

function functionBody(name) {
  const start = driverSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const parametersOpen = driverSource.indexOf('(', start);
  let parameterDepth = 0;
  let parametersClose = -1;
  for (let index = parametersOpen; index < driverSource.length; index += 1) {
    if (driverSource[index] === '(') parameterDepth += 1;
    if (driverSource[index] === ')' && --parameterDepth === 0) {
      parametersClose = index;
      break;
    }
  }
  assert.notEqual(parametersClose, -1, `${name} has a complete parameter list`);
  const open = driverSource.indexOf('{', parametersClose);
  let depth = 0;
  for (let index = open; index < driverSource.length; index += 1) {
    if (driverSource[index] === '{') depth += 1;
    if (driverSource[index] === '}' && --depth === 0) {
      return driverSource.slice(start, index + 1);
    }
  }
  throw new Error(`${name} has an unterminated body`);
}

const REQUIRED_CASES = [
  'customer-waiting',
  'products-staged-before-scanning',
  'mid-scan',
  'all-scanned-payment-choice',
  'card-presented',
  'post-x-cancellation',
  'card-declined',
  'cash-presented',
  'drawer-open',
  'cash-deposited',
  'change-selected',
  'receipt-printing',
  'completed-card',
  'completed-cash',
];

test('browser save/reload matrix names every required register checkpoint once', () => {
  const ids = SAVE_RELOAD_MATRIX.map((entry) => entry.id);
  assert.deepEqual(ids, REQUIRED_CASES);
  assert.equal(new Set(ids).size, ids.length);

  for (const entry of SAVE_RELOAD_MATRIX) {
    assert.ok(entry.outputKey);
    assert.ok(entry.evidenceDir);
    assert.ok(['card', 'cash'].includes(entry.payment));
    assert.ok(entry.skuIds.length > 0);
    if (entry.kind === 'rollback') {
      assert.ok(entry.flowStates.length > 0, `${entry.id} needs a visible flow state`);
      assert.ok(entry.stage, `${entry.id} needs a domain stage`);
      for (const state of entry.flowStates) {
        assert.ok(Object.hasOwn(CHECKOUT_STATES, state), `${entry.id} names unknown flow ${state}`);
      }
    } else {
      assert.equal(entry.kind, 'completed');
    }
  }

  assert.deepEqual(
    SAVE_RELOAD_MATRIX.find((entry) => entry.id === 'card-presented').flowStates,
    ['CardAmountEntry'],
  );
  assert.equal(
    SAVE_RELOAD_MATRIX.find((entry) => entry.id === 'card-presented').workspace,
    'card',
  );
  assert.deepEqual(
    SAVE_RELOAD_MATRIX.find((entry) => entry.id === 'drawer-open').flowStates,
    ['DrawerOpening', 'DepositingCash'],
  );
});

test('quick and explicit subset selection are deterministic and configurable', () => {
  assert.deepEqual(
    resolveSaveReloadCaseIds({ quick: true }),
    [...DEFAULT_QUICK_CASE_IDS],
  );
  assert.deepEqual(
    resolveSaveReloadCaseIds({ quick: true, quickCases: 'customer-waiting,completed-cash' }),
    ['customer-waiting', 'completed-cash'],
  );
  assert.deepEqual(
    resolveSaveReloadCaseIds({
      quick: true,
      quickCases: 'mid-scan',
      cases: 'receipt_handoff,completed_sale,receipt_handoff',
    }),
    ['receipt-printing', 'completed-card'],
  );
  assert.throws(
    () => resolveSaveReloadCaseIds({ cases: 'not-a-checkpoint' }),
    /Unknown register save\/reload case/,
  );
});

test('save/reload card checkpoints use automatic insertion and exact-total keypad entry', () => {
  const total = functionBody('totalTransaction');
  assert.match(total, /tx\.method === payment/);
  assert.match(total, /CardAmountEntry/);

  const entry = functionBody('enterExactCardTotal');
  assert.match(entry, /cardKeyScreenPoint\(key\)/);
  assert.match(entry, /`digit:\$\{digit\}`/);
  assert.match(entry, /page\.mouse\.click\(point\.x, point\.y\)/);
  assert.match(entry, /cardKeyScreenPoint\('confirm'\)/);
  assert.match(entry, /CardProcessing/);

  assert.doesNotMatch(driverSource, /CardSwipeReady|CardSwiping|swipeAt/);
  assert.doesNotMatch(driverSource, /page\.keyboard\.press\('t'\)/);
});

test('save/reload cash checkpoints use one-click acceptance, automatic deposit, and POS Done', () => {
  const pickup = functionBody('takePresentedCash');
  assert.match(pickup, /presentedCashScreenPoint\(\)/);
  assert.match(pickup, /page\.mouse\.click\(handful\.x, handful\.y\)/);
  assert.match(pickup, /tx\.drawerOpen && tx\.deposited/);
  assert.match(pickup, /SelectingChange/);

  const open = functionBody('takePresentedCashAtDrawerOpening');
  assert.match(open, /DrawerOpening/);
  assert.match(open, /DepositingCash/);

  const handoff = functionBody('handSelectedChangeToCustomer');
  assert.match(handoff, /monitorScreenPoint\('confirm-change'\)/);
  assert.match(handoff, /page\.mouse\.click\(done\.x, done\.y\)/);
  assert.match(handoff, /GivingChange/);
  assert.doesNotMatch(driverSource, /page\.keyboard\.press\('d'\)/);

  assert.match(driverSource,
    /case 'drawer-open':[\s\S]*?snapshot\.tx\.drawerStart && snapshot\.tx\.drawerPending/,
    'automatic cash acceptance must checkpoint its transaction-local money journal');
  assert.match(driverSource,
    /case 'cash-deposited':[\s\S]*?snapshot\.tx\.drawerStart && snapshot\.tx\.drawerPending/,
    'the deposited checkpoint must retain both transaction-local drawer snapshots');
});

test('completed matrix rows wait for automatic receipt, bag, and customer handoff', () => {
  const card = functionBody('completeCardTransaction');
  assert.match(card, /Receipt packing, bag handoff, and customer departure are intentionally/);
  assert.match(card, /!window\.__fw\.scene3d\.clubhouse\(\)\.register\.getTx\(\)/);

  const cash = functionBody('completeCashTransaction');
  assert.match(cash, /handSelectedChangeToCustomer\(page\)/);
  assert.match(cash, /!window\.__fw\.scene3d\.clubhouse\(\)\.register\.getTx\(\)/);

  assert.doesNotMatch(driverSource,
    /dragReceiptIntoBag|dragProductsIntoBag|handBagToCustomer|completePhysicalFulfillment/);
});

test('direct authorization mutation remains inside the documented fixture boundary', () => {
  const fixture = functionBody('createFixture');
  assert.match(fixture, /tx\.__qaSaveReloadRngTrace = \[\]/);
  assert.match(fixture, /tx\.rng = \(\) =>/);

  const normalControlRoute = driverSource.slice(driverSource.indexOf('async function enterCheckout'));
  assert.doesNotMatch(normalControlRoute, /tx\.rng\s*=/);
  assert.doesNotMatch(normalControlRoute,
    /\b(?:scanItem|requestPayment|insertCard|submitCardAmount|acceptCash|openDrawer|depositPiece|takeFromDrawer|confirmChange|packReceipt|bagItem|handOverGoods|finalizeTransaction)\s*\(/);
});

test('completed reconciliation understands revenue, COGS, and idempotent ledger entries', () => {
  const start = driverSource.indexOf('function assertCompletedReconciliation(');
  const end = driverSource.indexOf('function assertCleanCompletedReload(', start);
  assert.ok(start >= 0 && end > start);
  const reconciliation = driverSource.slice(start, end);

  assert.match(reconciliation, /ledger\?\.entries/);
  assert.match(reconciliation, /entry\?\.category === 'shopSales'/);
  assert.match(reconciliation, /entry\?\.source === 'checkout'/);
  assert.match(reconciliation, /processedIds\?\.\[saleEntry\.idempotencyKey\] === saleEntry\.id/);
  assert.match(reconciliation, /row\?\.key === 'shopSales'/);
  assert.doesNotMatch(reconciliation, /afterTxLog === beforeTxLog \+ 1/,
    'COGS and drawer variance may legitimately add linked rows');
});

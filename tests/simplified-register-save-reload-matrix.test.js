import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_QUICK_CASE_IDS,
  SAVE_RELOAD_MATRIX,
  resolveSaveReloadCaseIds,
} from '../tools/qa/simplified-register-save-reload.mjs';

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
    } else {
      assert.equal(entry.kind, 'completed');
    }
  }
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

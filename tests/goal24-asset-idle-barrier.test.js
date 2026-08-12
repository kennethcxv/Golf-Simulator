import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssetIdleBarrier } from '../src/render3d/assetIdleBarrier.js';

function fixture({ idle = false, clock = 100 } = {}) {
  let isIdle = idle;
  let listener = null;
  let timeout = null;
  let unsubscribed = 0;
  return {
    options: {
      isIdle: () => isIdle,
      subscribe(next) {
        listener = next;
        return () => { listener = null; unsubscribed += 1; };
      },
      now: () => clock,
      scheduleTimeout(next, delay) {
        timeout = { next, delay };
        return timeout;
      },
      cancelTimeout(handle) {
        assert.strictEqual(handle, timeout);
        timeout = null;
      },
    },
    setClock(value) { clock = value; },
    settleIdle() { isIdle = true; listener?.(); },
    fireTimeout() { timeout?.next(); },
    diagnostics: () => ({ timeout, listener, unsubscribed }),
  };
}

test('already-idle assets resolve immediately as safe', async () => {
  const f = fixture({ idle: true });
  const report = await createAssetIdleBarrier({ ...f.options, timeoutMs: 80 });
  assert.deepEqual(report, {
    status: 'idle', safeToPrewarm: true, startedAtMs: 100, deadlineAtMs: 180,
    settledAtMs: 100, durationMs: 0, timeoutMs: 80, initiallyIdle: true,
  });
  assert.equal(Object.isFrozen(report), true);
  assert.equal(f.diagnostics().timeout, null);
});

test('busy assets report real idle and unsubscribe exactly once', async () => {
  const f = fixture();
  const pending = createAssetIdleBarrier({ ...f.options, timeoutMs: 80 });
  f.setClock(145);
  f.settleIdle();
  const report = await pending;
  assert.equal(report.status, 'idle');
  assert.equal(report.safeToPrewarm, true);
  assert.equal(report.durationMs, 45);
  assert.equal(f.diagnostics().unsubscribed, 1);
  assert.equal(f.diagnostics().timeout, null);
});

test('deadline is explicit and unsafe instead of silently impersonating idle', async () => {
  const f = fixture();
  const pending = createAssetIdleBarrier({ ...f.options, timeoutMs: 25 });
  f.setClock(125);
  f.fireTimeout();
  const report = await pending;
  assert.equal(report.status, 'timed-out');
  assert.equal(report.safeToPrewarm, false);
  assert.equal(report.durationMs, 25);
  assert.equal(f.diagnostics().unsubscribed, 1);

  f.settleIdle();
  assert.equal(report.status, 'timed-out', 'late idle cannot rewrite the issued report');
});

test('subscription setup failure resolves unsafe', async () => {
  const report = await createAssetIdleBarrier({
    isIdle: () => false,
    subscribe: () => { throw new Error('manager unavailable'); },
    timeoutMs: 10,
  });
  assert.equal(report.status, 'timed-out');
  assert.equal(report.safeToPrewarm, false);
});

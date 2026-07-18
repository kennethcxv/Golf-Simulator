import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import lockModule from '../tools/qa/playwright-run-lock.cjs';

const {
  acquirePlaywrightRunLock,
  releasePlaywrightRunLock,
} = lockModule;

function temporaryLockPath(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-flipper-playwright-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'runner.lock');
}

test('Playwright runner lock records one owner and only its nonce can release it', async (t) => {
  const lockPath = temporaryLockPath(t);
  const token = await acquirePlaywrightRunLock({ lockPath, pollMs: 1, timeoutMs: 50 });
  const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.nonce, token.nonce);
  assert.equal(releasePlaywrightRunLock({ ...token, fd: undefined, nonce: 'not-the-owner' }), false);
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(releasePlaywrightRunLock(token), true);
  assert.equal(fs.existsSync(lockPath), false);
});

test('Playwright runner lock queues a live contender and heals a stale owner', async (t) => {
  const lockPath = temporaryLockPath(t);
  const owner = await acquirePlaywrightRunLock({ lockPath, pollMs: 1, timeoutMs: 50 });
  await assert.rejects(
    acquirePlaywrightRunLock({ lockPath, pollMs: 1, timeoutMs: 5 }),
    /Timed out waiting for Playwright runner/,
  );
  releasePlaywrightRunLock(owner);

  fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, nonce: 'stale' }));
  const replacement = await acquirePlaywrightRunLock({ lockPath, pollMs: 1, timeoutMs: 50 });
  assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, process.pid);
  assert.equal(releasePlaywrightRunLock(replacement), true);
});

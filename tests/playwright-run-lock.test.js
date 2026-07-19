import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import lockModule from '../tools/qa/playwright-run-lock.cjs';

const {
  DEFAULT_LOCK_PATH,
  acquirePlaywrightRunLock,
  gitCommonDirectory,
  releasePlaywrightRunLock,
  repositoryLockPath,
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

test('all worktrees from one Git repository derive the same shared lock', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-flipper-lock-worktrees-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'repository');
  const commonGit = path.join(repository, '.git');
  const worktree = path.join(root, 'feature-worktree');
  const worktreeGit = path.join(commonGit, 'worktrees', 'feature-worktree');
  fs.mkdirSync(worktreeGit, { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(
    path.join(worktree, '.git'),
    `gitdir: ${worktreeGit.replaceAll('\\', '/')}\n`,
  );

  assert.equal(gitCommonDirectory(repository), fs.realpathSync(commonGit));
  assert.equal(gitCommonDirectory(worktree), fs.realpathSync(commonGit));
  assert.equal(repositoryLockPath(repository), repositoryLockPath(worktree));
  assert.equal(path.dirname(repositoryLockPath(worktree)), os.tmpdir());
  if (process.env.PLAYWRIGHT_RUN_LOCK_PATH) {
    assert.equal(DEFAULT_LOCK_PATH, path.resolve(process.env.PLAYWRIGHT_RUN_LOCK_PATH));
  } else {
    assert.equal(path.dirname(DEFAULT_LOCK_PATH), os.tmpdir());
  }
});

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function gitCommonDirectory(start = process.cwd()) {
  let directory = path.resolve(start);
  while (true) {
    const marker = path.join(directory, '.git');
    try {
      const stat = fs.statSync(marker);
      if (stat.isDirectory()) return fs.realpathSync(marker);
      if (stat.isFile()) {
        const match = /^gitdir:\s*(.+)$/im.exec(fs.readFileSync(marker, 'utf8'));
        if (match) {
          const gitDirectory = path.resolve(directory, match[1].trim());
          const parent = path.dirname(gitDirectory);
          const common = path.basename(parent).toLowerCase() === 'worktrees'
            ? path.dirname(parent)
            : gitDirectory;
          return fs.realpathSync(common);
        }
      }
    } catch (_) { /* keep walking toward the filesystem root */ }
    const parent = path.dirname(directory);
    if (parent === directory) return path.resolve(start);
    directory = parent;
  }
}

function repositoryLockPath(start = process.cwd()) {
  const identity = gitCommonDirectory(start);
  const normalized = process.platform === 'win32' ? identity.toLowerCase() : identity;
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return path.join(os.tmpdir(), `golf-flipper-playwright-${digest}.lock`);
}

const DEFAULT_LOCK_PATH = process.env.PLAYWRIGHT_RUN_LOCK_PATH
  ? path.resolve(process.env.PLAYWRIGHT_RUN_LOCK_PATH)
  : repositoryLockPath();
const DEFAULT_POLL_MS = 500;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readOwner(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function tryAcquire(lockPath, metadata) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') return null;
    throw error;
  }
  const token = {
    lockPath,
    fd,
    pid: process.pid,
    nonce: crypto.randomUUID(),
  };
  const owner = {
    pid: token.pid,
    nonce: token.nonce,
    startedAt: new Date().toISOString(),
    command: process.argv.join(' '),
    ...metadata,
  };
  fs.writeFileSync(fd, `${JSON.stringify(owner, null, 2)}\n`);
  return token;
}

async function acquirePlaywrightRunLock({
  lockPath = DEFAULT_LOCK_PATH,
  pollMs = DEFAULT_POLL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  metadata = {},
} = {}) {
  const startedAt = Date.now();
  while (true) {
    const token = tryAcquire(lockPath, metadata);
    if (token) return token;

    const owner = readOwner(lockPath);
    if (!owner || !processAlive(Number(owner.pid))) {
      try {
        fs.unlinkSync(lockPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      continue;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out waiting for Playwright runner ${owner.pid} (${owner.command || 'unknown command'}).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function releasePlaywrightRunLock(token) {
  if (!token) return false;
  try {
    if (Number.isInteger(token.fd)) fs.closeSync(token.fd);
  } catch (_) { /* already closed */ }
  const owner = readOwner(token.lockPath);
  if (owner?.pid !== token.pid || owner?.nonce !== token.nonce) return false;
  try {
    fs.unlinkSync(token.lockPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

module.exports = {
  DEFAULT_LOCK_PATH,
  acquirePlaywrightRunLock,
  gitCommonDirectory,
  processAlive,
  releasePlaywrightRunLock,
  repositoryLockPath,
};

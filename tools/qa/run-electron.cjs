// Run one of the repository's Playwright QA function files INSIDE ELECTRON.
//
// Usage (existing call sites remain valid):
//   node tools/qa/run-electron.cjs tools/qa/first-run-legibility.js
//   node tools/qa/run-electron.cjs tools/qa/foo.js --clubhouse=pine-hills-v2
//
// Isolation and measurement policy:
//   * one runner may launch from this repository at a time;
//   * the default userData directory is a fresh, temporary profile;
//   * --user-data-dir=... or QA_ELECTRON_USER_DATA_DIR explicitly selects a
//     reusable profile, which the runner never deletes;
//   * VIDEO_DIR enables video instrumentation;
//   * QA_CHROMIUM_TRACE_PATH enables a Chromium CDP trace;
//   * QA_INSTRUMENTATION_MODE may pin the derived mode to low-overhead, video,
//     cdp-trace, or cdp-trace+video. A contradictory request fails closed.
//
// A function file written for run-playwright.cjs runs here unmodified. The two
// browser-only calls are shimmed:
//   * page.goto(...)            - Electron has already loaded file://index.html.
//                                 Becomes a no-op (page.reload() still works).
//   * page.setViewportSize(...) - resizes the real BrowserWindow.
//
// Drivers may inspect page.qaRunner.metadata and may request a fresh readback
// with await page.qaRunner.snapshot('label'). The runner API is also passed as
// the optional second argument to the function. The final JSON always includes
// the same metadata under its top-level `runner` key.
'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance: nodePerformance } = require('node:perf_hooks');

const ROOT = process.cwd();
const EXECUTABLE = path.join(
  ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);
const RUNNER_SCHEMA = 'golf-flipper/electron-runner/v1';
const LOCK_STALE_AFTER_MS = 10 * 60 * 1000;

function loadPlaywright() {
  try { return require('playwright'); } catch { /* fall through */ }
  throw new Error('Playwright is unavailable. npm install playwright.');
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  let canonical = resolved;
  try { canonical = fs.realpathSync.native(resolved); } catch { /* path may not exist yet */ }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function repoScopeId(root) {
  return crypto.createHash('sha256').update(canonicalPath(root)).digest('hex').slice(0, 20);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') return false;
    // EPERM means the process exists but this account cannot signal it. Every
    // unknown error is treated conservatively too: never reap a possibly-live
    // runner merely because its liveness could not be established.
    return true;
  }
}

function processCreationTimeUs(identity) {
  if (Number.isSafeInteger(identity?.creationTimeEpochUs) && identity.creationTimeEpochUs > 0) {
    return identity.creationTimeEpochUs;
  }
  const epochMs = Number(identity?.creationTimeEpochMs);
  const derived = Math.round(epochMs * 1000);
  return Number.isSafeInteger(derived) && derived > 0 ? derived : null;
}

async function waitForOwnedProcessExit(child, timeoutMs = 5000) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return false;
  if (child.exitCode != null || !isPidAlive(child.pid)) return true;
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.('exit', onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    child.once?.('exit', onExit);
    timer = setTimeout(() => finish(!isPidAlive(child.pid)), timeoutMs);
  });
}

function normalizeElectronProcessMetrics(metrics, {
  expectedBrowserPid = null,
  capturedAtEpochMs = Date.now(),
} = {}) {
  if (!Array.isArray(metrics) || metrics.length === 0) {
    throw new Error('Electron app.getAppMetrics returned no process identities.');
  }
  const processes = metrics.map((metric, index) => {
    const pid = Number(metric?.pid);
    const creationTimeEpochMs = Number(metric?.creationTime);
    const creationTimeEpochUs = Math.round(creationTimeEpochMs * 1000);
    const type = typeof metric?.type === 'string' ? metric.type : '';
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`Electron process metric ${index} has an invalid PID.`);
    }
    if (!Number.isFinite(creationTimeEpochMs) || creationTimeEpochMs <= 0
        || !Number.isSafeInteger(creationTimeEpochUs) || creationTimeEpochUs <= 0) {
      throw new Error(`Electron process metric ${pid} has no exact OS creation time.`);
    }
    if (!type) throw new Error(`Electron process metric ${pid} has no process type.`);
    return {
      pid,
      creationTimeEpochMs,
      creationTimeEpochUs,
      type,
      name: typeof metric.name === 'string' && metric.name ? metric.name : null,
      serviceName: typeof metric.serviceName === 'string' && metric.serviceName
        ? metric.serviceName : null,
    };
  });
  const identityKeys = processes.map((entry) => `${entry.pid}:${entry.creationTimeEpochUs}`);
  if (new Set(identityKeys).size !== identityKeys.length) {
    throw new Error('Electron app.getAppMetrics returned duplicate process identities.');
  }
  const browserProcesses = processes.filter((entry) => entry.type === 'Browser');
  if (browserProcesses.length !== 1) {
    throw new Error(
      `Electron app.getAppMetrics must contain exactly one Browser process; got ${browserProcesses.length}.`,
    );
  }
  if (expectedBrowserPid != null && browserProcesses[0].pid !== expectedBrowserPid) {
    throw new Error(
      `Expected Electron Browser PID ${expectedBrowserPid} does not match observed Browser PID `
      + `${browserProcesses[0].pid}.`,
    );
  }
  return {
    source: 'electron-app-getAppMetrics',
    capturedAtEpochMs,
    browserIdentity: { ...browserProcesses[0] },
    processes,
  };
}

async function captureElectronProcessSnapshot(app, {
  expectedBrowserPid = null,
  now = () => Date.now(),
} = {}) {
  if (!app || typeof app.evaluate !== 'function') {
    throw new TypeError('A live Playwright ElectronApplication is required for process capture.');
  }
  const capturedAtEpochMs = now();
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics()
    .map((metric) => ({
      pid: metric.pid,
      creationTime: metric.creationTime,
      type: metric.type,
      name: metric.name || null,
      serviceName: metric.serviceName || null,
    })));
  return normalizeElectronProcessMetrics(metrics, { expectedBrowserPid, capturedAtEpochMs });
}

function readWindowsProcessIdentities(pids, {
  spawnSync = childProcess.spawnSync,
} = {}) {
  const uniquePids = [...new Set(pids)].sort((left, right) => left - right);
  if (uniquePids.some((pid) => !Number.isInteger(pid) || pid <= 0)) {
    throw new TypeError('Windows process identity readback accepts only positive integer PIDs.');
  }
  if (uniquePids.length === 0) return [];
  const filter = uniquePids.map((pid) => `ProcessId = ${pid}`).join(' OR ');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$rows = @(Get-CimInstance Win32_Process -Filter '${filter}')`,
    '$identities = @($rows | ForEach-Object {',
    '  if ($null -eq $_.CreationDate) { throw "Win32_Process CreationDate is unavailable for PID $($_.ProcessId)" }',
    '  $created = [DateTimeOffset]$_.CreationDate',
    '  $unixEpochTicks = [long]621355968000000000',
    '  $epochUs = [long](($created.UtcTicks - $unixEpochTicks) / 10)',
    '  [pscustomobject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; creationTimeEpochMs = [double]$epochUs / 1000; creationTimeEpochUs = $epochUs; name = [string]$_.Name; executablePath = if ($null -eq $_.ExecutablePath) { $null } else { [string]$_.ExecutablePath } }',
    '})',
    '[Console]::Out.Write(($identities | ConvertTo-Json -Compress))',
  ].join('; ');
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  if (result?.error) throw result.error;
  if (result?.status !== 0) {
    const detail = String(result?.stderr || '').trim() || `exit status ${result?.status}`;
    throw new Error(`Exact Windows process creation-time readback failed: ${detail}`);
  }
  const stdout = String(result.stdout || '').replace(/^\uFEFF/, '').trim();
  if (!stdout) return [];
  let decoded;
  try { decoded = JSON.parse(stdout); } catch (error) {
    throw new Error(`Exact Windows process identity readback was not JSON: ${error.message}`, {
      cause: error,
    });
  }
  const rows = Array.isArray(decoded) ? decoded : [decoded];
  return rows.map((row, index) => {
    const pid = Number(row?.pid);
    const creationTimeEpochMs = Number(row?.creationTimeEpochMs);
    const creationTimeEpochUs = Number(row?.creationTimeEpochUs);
    if (!Number.isInteger(pid) || !uniquePids.includes(pid)
        || !Number.isFinite(creationTimeEpochMs) || creationTimeEpochMs <= 0
        || !Number.isSafeInteger(creationTimeEpochUs) || creationTimeEpochUs <= 0) {
      throw new Error(`Exact Windows process identity row ${index} is invalid.`);
    }
    const parentPid = Number(row?.parentPid);
    if (!Number.isInteger(parentPid) || parentPid < 0) {
      throw new Error(`Exact Windows process identity row ${index} has no parent PID.`);
    }
    return {
      pid,
      parentPid,
      creationTimeEpochMs,
      creationTimeEpochUs,
      name: typeof row?.name === 'string' && row.name ? row.name : null,
      executablePath: typeof row?.executablePath === 'string' && row.executablePath
        ? row.executablePath : null,
    };
  });
}

function attestWindowsLaunchRelationship(snapshot, playwrightProcessPid, {
  platform = process.platform,
  readWindows = readWindowsProcessIdentities,
} = {}) {
  const relationship = {
    platform,
    source: platform === 'win32'
      ? 'playwright-app-process+electron-app-getAppMetrics+Win32_Process' : null,
    shellBehavior: platform === 'win32'
      ? 'Playwright launches Electron with shell=true; app.process() is the cmd.exe wrapper.' : null,
    kind: null,
    confirmed: false,
    playwrightProcessIdentity: null,
    electronMainProcessIdentity: snapshot?.browserIdentity ? { ...snapshot.browserIdentity } : null,
    electronMainOsIdentity: null,
    error: null,
  };
  try {
    if (platform !== 'win32') {
      throw new Error(`Exact Playwright-to-Electron process lineage is unavailable on ${platform}.`);
    }
    if (!Number.isInteger(playwrightProcessPid) || playwrightProcessPid <= 0) {
      throw new Error('Playwright ElectronApplication process handle has no positive PID.');
    }
    const browser = snapshot?.browserIdentity;
    if (!browser) throw new Error('Electron process snapshot has no Browser identity.');
    const observed = readWindows([playwrightProcessPid, browser.pid]);
    const byPid = new Map(observed.map((entry) => [entry.pid, entry]));
    const wrapper = byPid.get(playwrightProcessPid);
    const browserOs = byPid.get(browser.pid);
    if (!wrapper) throw new Error('Playwright shell wrapper exited before its OS identity was attested.');
    if (!browserOs) throw new Error('Electron Browser process was absent from OS identity readback.');
    if (processCreationTimeUs(browserOs) !== processCreationTimeUs(browser)) {
      throw new Error(
        `Electron Browser appMetrics (${processCreationTimeUs(browser)} us) and OS `
        + `(${processCreationTimeUs(browserOs)} us) creation times disagree.`,
      );
    }
    if (browserOs.parentPid !== wrapper.pid) {
      throw new Error(
        `Electron Browser PID ${browser.pid} has OS parent ${browserOs.parentPid}, `
        + `not Playwright shell wrapper ${wrapper.pid}.`,
      );
    }
    relationship.kind = 'direct-shell-parent';
    relationship.playwrightProcessIdentity = { ...wrapper };
    relationship.electronMainOsIdentity = { ...browserOs };
    relationship.confirmed = true;
  } catch (error) {
    relationship.error = String(error && error.message ? error.message : error);
  }
  return relationship;
}

function mergeCapturedProcessSnapshots(...snapshots) {
  const processes = [];
  const seen = new Set();
  for (const snapshot of snapshots) {
    for (const entry of snapshot?.processes || []) {
      const key = `${entry.pid}:${processCreationTimeUs(entry)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      processes.push({ ...entry });
    }
  }
  if (processes.length === 0) {
    throw new Error('Cannot build an Electron exit set from empty process snapshots.');
  }
  return {
    source: 'union-of-electron-app-getAppMetrics-snapshots',
    capturedAtEpochMs: Math.max(...snapshots
      .map((snapshot) => snapshot?.capturedAtEpochMs)
      .filter(Number.isFinite)),
    processes,
  };
}

function inspectCapturedProcessSet(snapshot, observed) {
  if (!snapshot || !Array.isArray(snapshot.processes) || snapshot.processes.length === 0) {
    throw new Error('A non-empty Electron process snapshot is required for exit proof.');
  }
  if (!Array.isArray(observed)) {
    throw new Error('OS process identity readback must return an array.');
  }
  const byPid = new Map();
  for (const identity of observed) {
    if (!Number.isInteger(identity?.pid) || identity.pid <= 0
        || processCreationTimeUs(identity) == null) {
      throw new Error('OS process identity readback contained an invalid identity.');
    }
    if (byPid.has(identity.pid)) {
      throw new Error(`OS process identity readback duplicated PID ${identity.pid}.`);
    }
    byPid.set(identity.pid, identity);
  }
  const liveIdentities = [];
  const reusedPids = [];
  const exitedIdentities = [];
  for (const captured of snapshot.processes) {
    const current = byPid.get(captured.pid);
    if (!current) {
      exitedIdentities.push({ ...captured, exitProof: 'pid-absent' });
    } else if (processCreationTimeUs(current) === processCreationTimeUs(captured)) {
      liveIdentities.push({ ...captured });
    } else {
      reusedPids.push({
        pid: captured.pid,
        capturedCreationTimeEpochMs: captured.creationTimeEpochMs,
        observedCreationTimeEpochMs: current.creationTimeEpochMs,
        capturedCreationTimeEpochUs: processCreationTimeUs(captured),
        observedCreationTimeEpochUs: processCreationTimeUs(current),
      });
      exitedIdentities.push({ ...captured, exitProof: 'pid-reused-with-different-creation-time' });
    }
  }
  return {
    confirmedExited: liveIdentities.length === 0,
    liveIdentities,
    reusedPids,
    exitedIdentities,
  };
}

async function waitForElectronProcessSetExit(snapshot, {
  platform = process.platform,
  readWindows = readWindowsProcessIdentities,
  timeoutMs = 5000,
  pollIntervalMs = 200,
  now = () => Date.now(),
  wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
} = {}) {
  const verification = {
    platform,
    source: platform === 'win32' ? 'Win32_Process.CreationDate' : null,
    exactCreationTimeRequired: true,
    attempts: 0,
    confirmedExited: false,
    liveIdentities: snapshot?.processes ? snapshot.processes.map((entry) => ({ ...entry })) : [],
    reusedPids: [],
    exitedIdentities: [],
    error: null,
  };
  if (platform !== 'win32') {
    verification.error = `Exact OS process identity readback is unavailable on ${platform}; refusing cleanup.`;
    return verification;
  }
  const startedAt = now();
  do {
    verification.attempts += 1;
    try {
      const observed = readWindows(snapshot.processes.map((entry) => entry.pid));
      const inspected = inspectCapturedProcessSet(snapshot, observed);
      Object.assign(verification, inspected);
      if (inspected.confirmedExited) return verification;
    } catch (error) {
      verification.error = String(error && error.message ? error.message : error);
      return verification;
    }
    const remainingMs = timeoutMs - (now() - startedAt);
    if (remainingMs <= 0) break;
    await wait(Math.min(pollIntervalMs, remainingMs));
  } while ((now() - startedAt) <= timeoutMs);
  return verification;
}

function attestElectronProcessSnapshot(snapshot, {
  platform = process.platform,
  readWindows = readWindowsProcessIdentities,
} = {}) {
  const attestation = {
    platform,
    source: platform === 'win32' ? 'Win32_Process.CreationDate' : null,
    exactCreationTimeRequired: true,
    identityCount: snapshot?.processes?.length ?? 0,
    exactIdentityMatches: [],
    alreadyExitedIdentities: [],
    mismatchedIdentities: [],
    confirmed: false,
    error: null,
  };
  try {
    if (platform !== 'win32') {
      throw new Error(`Exact OS process identity readback is unavailable on ${platform}.`);
    }
    const observed = readWindows(snapshot.processes.map((entry) => entry.pid));
    const byPid = new Map(observed.map((entry) => [entry.pid, entry]));
    for (const captured of snapshot.processes) {
      const current = byPid.get(captured.pid);
      if (!current) {
        attestation.alreadyExitedIdentities.push({ ...captured });
      } else if (processCreationTimeUs(current) === processCreationTimeUs(captured)) {
        attestation.exactIdentityMatches.push({ ...captured });
      } else {
        attestation.mismatchedIdentities.push({
          pid: captured.pid,
          capturedCreationTimeEpochMs: captured.creationTimeEpochMs,
          observedCreationTimeEpochMs: current.creationTimeEpochMs,
          capturedCreationTimeEpochUs: processCreationTimeUs(captured),
          observedCreationTimeEpochUs: processCreationTimeUs(current),
        });
      }
    }
    const browser = snapshot.browserIdentity;
    const exactBrowser = attestation.exactIdentityMatches.some((entry) => (
      entry.pid === browser.pid && processCreationTimeUs(entry) === processCreationTimeUs(browser)
    ));
    if (!exactBrowser) throw new Error('Electron Browser identity was not exactly attested by the OS.');
    if (attestation.mismatchedIdentities.length) {
      throw new Error('Electron and OS process creation times disagree.');
    }
    attestation.confirmed = true;
  } catch (error) {
    attestation.error = String(error && error.message ? error.message : error);
  }
  return attestation;
}

function sameProcessIdentity(left, right) {
  return Number.isInteger(left?.pid)
    && left.pid === right?.pid
    && processCreationTimeUs(left) != null
    && processCreationTimeUs(left) === processCreationTimeUs(right)
    && left.type === right?.type;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function classifyQaEarlyDiagnostics(entries, categorizedDiagnostics, diagnostics) {
  const journal = Array.isArray(entries) ? entries : [];
  if (!Array.isArray(categorizedDiagnostics.earlyLifecycle)) {
    categorizedDiagnostics.earlyLifecycle = [];
  }
  const seen = new Set(categorizedDiagnostics.earlyLifecycle.map((entry) => JSON.stringify(entry)));
  for (const entry of journal) {
    const copy = entry && typeof entry === 'object' ? JSON.parse(JSON.stringify(entry)) : null;
    if (!copy) continue;
    const fingerprint = JSON.stringify(copy);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    categorizedDiagnostics.earlyLifecycle.push(copy);
    const message = `${copy.kind}: ${copy.message || copy.error || copy.errorDescription || copy.reason || ''}`.trim();
    if (copy.kind === 'console-message') {
      if (Number(copy.level) >= 3) categorizedDiagnostics.consoleErrors.push(`[startup] ${message}`);
      else if (Number(copy.level) === 2) categorizedDiagnostics.consoleWarnings.push(`[startup] ${message}`);
    } else if (['preload-error', 'did-fail-load', 'render-process-gone'].includes(copy.kind)) {
      categorizedDiagnostics.pageErrors.push(`[startup] ${message}`);
    }
    if (copy.kind !== 'web-contents-created') diagnostics.push(`early:${message}`);
  }
  return categorizedDiagnostics.earlyLifecycle.length;
}

function lockOwnerIsLive(owner, pidAlive = isPidAlive) {
  return !!owner && (
    pidAlive(owner.pid)
    || (Number.isInteger(owner.electronPid) && owner.electronPid > 0 && pidAlive(owner.electronPid))
  );
}

function lockConflict(lockPath, owner, reason) {
  const detail = owner && Number.isInteger(owner.pid)
    ? `owner pid ${owner.pid}, acquired ${owner.acquiredAt || 'at an unknown time'}`
    : reason;
  const error = new Error(
    `Another Electron QA run owns this repository lock (${detail}). Lock: ${lockPath}`,
  );
  error.code = 'QA_ELECTRON_LOCKED';
  error.lockPath = lockPath;
  error.owner = owner;
  return error;
}

/**
 * Cross-process, repository-scoped launch lock. A valid lock is reclaimed only
 * when its owning PID is confirmed dead. A corrupt/partial lock gets a long
 * grace period because deleting a directory while another process is still
 * writing owner.json would be less safe than refusing one QA launch.
 */
function acquireRepoLaunchLock({
  root = ROOT,
  lockBase = path.join(os.tmpdir(), 'golf-flipper-electron-qa-locks'),
  pid = process.pid,
  launchId = crypto.randomUUID(),
  now = () => Date.now(),
  pidAlive = isPidAlive,
  staleAfterMs = LOCK_STALE_AFTER_MS,
} = {}) {
  const scopeId = repoScopeId(root);
  fs.mkdirSync(lockBase, { recursive: true });
  const lockPath = path.join(lockBase, `${scopeId}.lock`);
  const ownerPath = path.join(lockPath, 'owner.json');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.mkdirSync(lockPath);
      const token = crypto.randomUUID();
      const acquiredEpochMs = now();
      const owner = {
        schemaVersion: 1,
        repoRoot: canonicalPath(root),
        scopeId,
        pid,
        launchId,
        token,
        acquiredAt: new Date(acquiredEpochMs).toISOString(),
        acquiredEpochMs,
        processStartedEpochMs: Math.round(Date.now() - process.uptime() * 1000),
      };
      try {
        fs.writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, { flag: 'wx' });
      } catch (error) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }

      let released = false;
      return {
        path: lockPath,
        scopeId,
        owner: { ...owner },
        setElectronMainProcessIdentity(identity) {
          const electronPid = Number(identity?.pid);
          const creationTimeEpochMs = Number(identity?.creationTimeEpochMs);
          const creationTimeEpochUs = processCreationTimeUs(identity);
          if (!Number.isInteger(electronPid) || electronPid <= 0
              || !Number.isFinite(creationTimeEpochMs) || creationTimeEpochMs <= 0
              || creationTimeEpochUs == null
              || identity?.type !== 'Browser') {
            throw new TypeError('Invalid Electron Browser process identity.');
          }
          const current = readJson(ownerPath);
          if (!current || current.token !== token || current.pid !== pid) {
            throw new Error(`Refusing to update a repository lock no longer owned by this runner: ${lockPath}`);
          }
          const electronMainProcessIdentity = {
            pid: electronPid,
            creationTimeEpochMs,
            creationTimeEpochUs,
            type: identity.type,
          };
          const nextOwner = { ...owner, electronPid, electronMainProcessIdentity };
          const temporaryOwnerPath = path.join(
            lockPath,
            `.owner-${pid}-${token}-${crypto.randomUUID()}.tmp`,
          );
          let handle = null;
          try {
            handle = fs.openSync(temporaryOwnerPath, 'wx');
            fs.writeFileSync(handle, `${JSON.stringify(nextOwner, null, 2)}\n`);
            fs.fsyncSync(handle);
            fs.closeSync(handle);
            handle = null;
            const beforeReplace = readJson(ownerPath);
            if (!beforeReplace || beforeReplace.token !== token || beforeReplace.pid !== pid) {
              throw new Error(
                `Refusing to replace a repository lock no longer owned by this runner: ${lockPath}`,
              );
            }
            fs.renameSync(temporaryOwnerPath, ownerPath);
          } finally {
            if (handle != null) fs.closeSync(handle);
            if (fs.existsSync(temporaryOwnerPath)) fs.rmSync(temporaryOwnerPath, { force: false });
          }
          owner.electronPid = electronPid;
          owner.electronMainProcessIdentity = electronMainProcessIdentity;
          return { ...electronMainProcessIdentity };
        },
        release() {
          if (released) return false;
          const current = readJson(ownerPath);
          if (!current || current.token !== token || current.pid !== pid) {
            const error = new Error(`Refusing to release a repository lock no longer owned by this runner: ${lockPath}`);
            error.code = 'QA_ELECTRON_LOCK_OWNERSHIP_LOST';
            throw error;
          }
          // The exact per-repository lock directory is the only lock path this
          // runner removes. The shared parent and neighbouring locks survive.
          fs.rmSync(lockPath, { recursive: true, force: false });
          released = true;
          return true;
        },
      };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }

    const owner = readJson(ownerPath);
    let stat;
    try { stat = fs.statSync(lockPath); } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    const ageMs = Math.max(0, now() - stat.mtimeMs);
    const validOwner = owner
      && owner.schemaVersion === 1
      && owner.scopeId === scopeId
      && owner.repoRoot === canonicalPath(root)
      && Number.isInteger(owner.pid)
      && typeof owner.launchId === 'string'
      && owner.launchId.length > 0
      && typeof owner.token === 'string';

    if (validOwner && lockOwnerIsLive(owner, pidAlive)) {
      throw lockConflict(lockPath, owner, 'the recorded owner is still alive');
    }
    if (!validOwner && ageMs < staleAfterMs) {
      throw lockConflict(
        lockPath,
        owner,
        `owner metadata is incomplete and the ${Math.round(ageMs)} ms safety grace has not elapsed`,
      );
    }

    // Claim stale recovery inside the stale directory before moving it. This
    // is the compare-and-swap missing from a read-then-rm sequence: exactly one
    // reclaimer can create this file, and all others stop without touching a
    // lock path that may soon belong to a successor.
    const reclaimPath = path.join(lockPath, 'reclaim.json');
    const reclaimToken = crypto.randomUUID();
    try {
      fs.writeFileSync(reclaimPath, `${JSON.stringify({
        pid,
        token: reclaimToken,
        expectedOwnerToken: validOwner ? owner.token : null,
        claimedAtEpochMs: now(),
      })}\n`, { flag: 'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST') {
        const existingClaim = readJson(reclaimPath);
        const validClaim = existingClaim
          && Number.isInteger(existingClaim.pid)
          && existingClaim.pid > 0
          && typeof existingClaim.token === 'string'
          && existingClaim.token.length > 0;
        if (validClaim && pidAlive(existingClaim.pid)) {
          throw lockConflict(lockPath, owner, 'another live process already claimed stale-lock recovery');
        }
        if (!validClaim && ageMs < staleAfterMs) {
          throw lockConflict(lockPath, owner, 'stale-lock recovery metadata is incomplete and still inside its safety grace');
        }

        // The previous reclaimer died before it could move the stale lock.
        // Rename the entire lock directory to a unique quarantine path. That
        // rename is the takeover CAS: concurrent reclaimers cannot both move
        // the same directory, and nobody unlinks a possibly newer claim file.
        const takeoverToken = crypto.randomUUID();
        const takeoverQuarantine = `${lockPath}.takeover-${pid}-${takeoverToken}`;
        try {
          fs.renameSync(lockPath, takeoverQuarantine);
        } catch (renameError) {
          if (renameError?.code === 'ENOENT') continue;
          throw renameError;
        }
        const takeoverOwner = readJson(path.join(takeoverQuarantine, 'owner.json'));
        const takeoverClaim = readJson(path.join(takeoverQuarantine, 'reclaim.json'));
        const ownerStillMatches = validOwner
          ? takeoverOwner?.token === owner.token && takeoverOwner?.pid === owner.pid
          : takeoverOwner == null;
        const claimStillMatches = validClaim
          ? takeoverClaim?.token === existingClaim.token
            && takeoverClaim?.pid === existingClaim.pid
          : takeoverClaim == null;
        if (!ownerStillMatches || !claimStillMatches) {
          throw new Error(
            `Dead-reclaimer quarantine ownership changed; retained for manual inspection: ${takeoverQuarantine}`,
            { cause: error },
          );
        }
        fs.rmSync(takeoverQuarantine, { recursive: true, force: false });
        continue;
      }
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    // Re-read immediately after the exclusive claim. If ownership changed,
    // fail rather than moving a successor's lock.
    const current = readJson(ownerPath);
    const sameOwner = validOwner
      ? current && current.token === owner.token && current.pid === owner.pid
      : current == null;
    if (!sameOwner) throw lockConflict(lockPath, current, 'ownership changed during stale recovery');
    if (validOwner && lockOwnerIsLive(owner, pidAlive)) {
      throw lockConflict(lockPath, owner, 'the owner became live during stale recovery');
    }
    const quarantinePath = `${lockPath}.reclaim-${pid}-${reclaimToken}`;
    try {
      fs.renameSync(lockPath, quarantinePath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const quarantinedOwner = readJson(path.join(quarantinePath, 'owner.json'));
    const quarantinedClaim = readJson(path.join(quarantinePath, 'reclaim.json'));
    const quarantinedMatches = quarantinedClaim?.token === reclaimToken
      && (validOwner
        ? quarantinedOwner?.token === owner.token && quarantinedOwner?.pid === owner.pid
        : quarantinedOwner == null);
    if (!quarantinedMatches) {
      throw new Error(
        `Stale-lock quarantine ownership changed; retained for manual inspection: ${quarantinePath}`,
      );
    }
    fs.rmSync(quarantinePath, { recursive: true, force: false });
  }

  throw new Error(`Could not acquire Electron QA repository lock: ${lockPath}`);
}

function userDataFlagValue(args) {
  const flags = args.filter((arg) => String(arg).startsWith('--user-data-dir='));
  if (flags.length > 1) {
    throw new Error('Pass at most one --user-data-dir=... override.');
  }
  if (args.includes('--user-data-dir')) {
    throw new Error('--user-data-dir requires the compatible --user-data-dir=PATH form.');
  }
  return flags.length ? flags[0].slice('--user-data-dir='.length) : null;
}

function prepareUserDataProfile({
  root = ROOT,
  argv = process.argv.slice(3),
  env = process.env,
  profileBase = path.join(os.tmpdir(), 'golf-flipper-electron-qa-profiles'),
} = {}) {
  const cliValue = userDataFlagValue(argv);
  const envValues = [env.QA_ELECTRON_USER_DATA_DIR, env.QA_REUSABLE_PROFILE]
    .filter((value) => typeof value === 'string' && value.trim());
  if (envValues.length > 1
      && canonicalPath(path.resolve(root, envValues[0])) !== canonicalPath(path.resolve(root, envValues[1]))) {
    throw new Error('QA_ELECTRON_USER_DATA_DIR and QA_REUSABLE_PROFILE disagree.');
  }
  const envValue = envValues[0] || null;
  if (cliValue && envValue
      && canonicalPath(path.resolve(root, cliValue)) !== canonicalPath(path.resolve(root, envValue))) {
    throw new Error('--user-data-dir and the reusable-profile environment override disagree.');
  }

  const explicit = cliValue || envValue;
  if (explicit) {
    const profilePath = path.resolve(root, explicit);
    fs.mkdirSync(profilePath, { recursive: true });
    return {
      mode: 'reusable-explicit',
      profileId: crypto.randomUUID(),
      source: cliValue ? '--user-data-dir' : (env.QA_ELECTRON_USER_DATA_DIR
        ? 'QA_ELECTRON_USER_DATA_DIR' : 'QA_REUSABLE_PROFILE'),
      path: canonicalPath(profilePath),
      generated: false,
      cleanup: false,
      electronArg: `--user-data-dir=${canonicalPath(profilePath)}`,
    };
  }

  fs.mkdirSync(profileBase, { recursive: true });
  const prefix = path.join(profileBase, `${repoScopeId(root)}-`);
  const profilePath = fs.mkdtempSync(prefix);
  const profileId = crypto.randomUUID();
  const profileStat = fs.statSync(profilePath, { bigint: true });
  const creationIdentity = {
    dev: profileStat.dev.toString(),
    ino: profileStat.ino.toString(),
    birthtimeMs: Number(profileStat.birthtimeMs),
  };
  const ownershipMarker = path.join(profilePath, '.goal24-qa-profile-owner.json');
  fs.writeFileSync(ownershipMarker, `${JSON.stringify({ profileId, creationIdentity })}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return {
    mode: 'isolated-temporary',
    profileId,
    source: 'runner-default',
    path: canonicalPath(profilePath),
    cleanupPath: path.resolve(profilePath),
    generated: true,
    cleanup: true,
    electronArg: `--user-data-dir=${canonicalPath(profilePath)}`,
    generatedUnder: path.resolve(profileBase),
    ownershipMarker,
    creationIdentity,
  };
}

function cleanupUserDataProfile(profile) {
  if (!profile || !profile.cleanup || !profile.generated) return false;
  const cleanupPath = path.resolve(profile.cleanupPath || profile.path);
  const generatedUnder = path.resolve(profile.generatedUnder || '');
  const parent = path.dirname(cleanupPath);
  if (!profile.generatedUnder || canonicalPath(parent) !== canonicalPath(generatedUnder)) {
    throw new Error(`Refusing to remove an unverified Electron QA profile: ${profile.path}`);
  }
  const stat = fs.lstatSync(cleanupPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Refusing to remove a reparse/symlink or non-directory profile leaf: ${cleanupPath}`);
  }
  if (canonicalPath(cleanupPath) !== canonicalPath(profile.path)) {
    throw new Error(`Refusing to remove a profile leaf whose resolved identity changed: ${cleanupPath}`);
  }
  const currentStat = fs.statSync(cleanupPath, { bigint: true });
  const currentIdentity = {
    dev: currentStat.dev.toString(),
    ino: currentStat.ino.toString(),
    birthtimeMs: Number(currentStat.birthtimeMs),
  };
  if (JSON.stringify(currentIdentity) !== JSON.stringify(profile.creationIdentity)) {
    throw new Error(`Refusing to remove a replaced Electron QA profile directory: ${cleanupPath}`);
  }
  const markerPath = path.resolve(profile.ownershipMarker || '');
  if (!profile.ownershipMarker || path.dirname(markerPath) !== cleanupPath) {
    throw new Error(`Refusing to remove an Electron QA profile without its owned marker: ${cleanupPath}`);
  }
  const markerStat = fs.lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new Error(`Refusing to remove an Electron QA profile with an invalid owned marker: ${cleanupPath}`);
  }
  const marker = readJson(markerPath);
  if (marker?.profileId !== profile.profileId
    || JSON.stringify(marker?.creationIdentity) !== JSON.stringify(profile.creationIdentity)) {
    throw new Error(`Refusing to remove an Electron QA profile whose ownership marker changed: ${cleanupPath}`);
  }
  // Remove exactly the generated leaf. An explicit/reusable profile never sets
  // cleanup=true and the shared profile parent is intentionally retained.
  fs.rmSync(cleanupPath, { recursive: true, force: false, maxRetries: 5, retryDelay: 100 });
  return true;
}

function electronArgs(profile, argv = process.argv.slice(3), env = process.env) {
  const passthrough = argv.filter((arg) => arg.startsWith('--')
    && !arg.startsWith('--user-data-dir='));
  const fromEnv = env.QA_CLUBHOUSE ? [`--clubhouse=${env.QA_CLUBHOUSE}`] : [];
  if (env.QA_FORCE_DEVICE_SCALE_FACTOR != null && env.QA_FORCE_DEVICE_SCALE_FACTOR !== '') {
    const scale = Number(env.QA_FORCE_DEVICE_SCALE_FACTOR);
    if (!Number.isFinite(scale) || scale <= 0 || scale > 4) {
      throw new Error('QA_FORCE_DEVICE_SCALE_FACTOR must be a finite number above 0 and at most 4.');
    }
    fromEnv.push(`--force-device-scale-factor=${scale}`);
  }
  const merged = [...passthrough, ...fromEnv, profile.electronArg];
  const seen = new Set();
  const unique = merged.filter((arg) => {
    const key = arg.split('=')[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return ['.', ...unique];
}

function deriveInstrumentation(env = process.env) {
  const videoDir = env.VIDEO_DIR ? path.resolve(env.VIDEO_DIR) : null;
  const videoSizeValue = env.QA_VIDEO_SIZE || env.GOAL24_PERF_RESOLUTION || null;
  const videoSizeMatch = videoSizeValue == null
    ? null : /^(\d+)x(\d+)$/u.exec(videoSizeValue);
  if (videoSizeValue != null && (!videoSizeMatch
    || Number(videoSizeMatch[1]) < 640 || Number(videoSizeMatch[1]) > 4096
    || Number(videoSizeMatch[2]) < 360 || Number(videoSizeMatch[2]) > 2160)) {
    throw new Error('QA video size must be WIDTHxHEIGHT within 640x360 through 4096x2160.');
  }
  const videoSize = videoSizeMatch
    ? { width: Number(videoSizeMatch[1]), height: Number(videoSizeMatch[2]) } : null;
  const chromiumTracePath = env.QA_CHROMIUM_TRACE_PATH
    ? path.resolve(env.QA_CHROMIUM_TRACE_PATH) : null;
  const enabled = [videoDir ? 'video' : null, chromiumTracePath ? 'cdp-trace' : null]
    .filter(Boolean);
  const mode = enabled.length === 0
    ? 'low-overhead'
    : enabled.length === 2 ? 'cdp-trace+video' : enabled[0];
  const requested = env.QA_INSTRUMENTATION_MODE || null;
  const allowed = new Set(['low-overhead', 'video', 'cdp-trace', 'cdp-trace+video']);
  if (requested && !allowed.has(requested)) {
    throw new Error(`Unknown QA_INSTRUMENTATION_MODE=${requested}.`);
  }
  if (requested && requested !== mode) {
    throw new Error(
      `QA_INSTRUMENTATION_MODE=${requested} contradicts configured capture; derived mode is ${mode}.`,
    );
  }
  const categories = (env.QA_CHROMIUM_TRACE_CATEGORIES
    || 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8,renderer.scheduler,cc,gpu')
    .split(',').map((value) => value.trim()).filter(Boolean);
  return {
    mode,
    lowOverheadEligible: mode === 'low-overhead',
    captureKinds: enabled,
    video: {
      enabled: !!videoDir,
      directory: videoDir,
      size: videoSize,
      sizeSource: env.QA_VIDEO_SIZE ? 'QA_VIDEO_SIZE'
        : env.GOAL24_PERF_RESOLUTION ? 'GOAL24_PERF_RESOLUTION' : null,
      status: videoDir ? 'configured' : 'disabled',
    },
    chromiumTrace: {
      enabled: !!chromiumTracePath,
      path: chromiumTracePath,
      categories,
      status: chromiumTracePath ? 'configured' : 'disabled',
      bytes: null,
    },
  };
}

function roundMs(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function createTimingRecorder({
  epochNow = () => Date.now(),
  monotonicNow = () => nodePerformance.now(),
} = {}) {
  const originEpochMs = epochNow();
  const originMonotonicMs = monotonicNow();
  const runnerPerformanceTimeOriginEpochMs = originEpochMs - originMonotonicMs;
  const anchors = {};

  const write = (name, epochMs, monotonicMs, detail) => {
    if (anchors[name]) throw new Error(`Timing anchor ${name} was already recorded.`);
    anchors[name] = {
      epochMs: roundMs(epochMs),
      iso: new Date(epochMs).toISOString(),
      sinceParentLaunchRequestMs: roundMs(epochMs - originEpochMs),
      ...detail,
    };
    if (Number.isFinite(monotonicMs)) anchors[name].runnerMonotonicMs = roundMs(monotonicMs);
    return anchors[name];
  };

  write('parentLaunchRequest', originEpochMs, originMonotonicMs, { source: 'runner-entry' });
  return {
    mark(name, detail = {}) {
      const mono = monotonicNow();
      const epoch = originEpochMs + (mono - originMonotonicMs);
      return write(name, epoch, mono, { source: 'runner-observation', ...detail });
    },
    markEpoch(name, epochMs, detail = {}) {
      return write(name, epochMs, null, { source: 'external-clock', ...detail });
    },
    snapshot() {
      return {
        clock: {
          epochUnit: 'milliseconds since Unix epoch',
          runnerMonotonicUnit: 'milliseconds since runner performance time origin',
          runnerPerformanceTimeOriginEpochMs: roundMs(runnerPerformanceTimeOriginEpochMs),
          processStartedAt: {
            epochMs: roundMs(runnerPerformanceTimeOriginEpochMs),
            iso: new Date(runnerPerformanceTimeOriginEpochMs).toISOString(),
            estimated: true,
            basis: 'runner-entry Date.now minus node:perf_hooks performance.now; not an OS process-start query',
          },
          conversion: 'epochMs = runnerPerformanceTimeOriginEpochMs + runnerMonotonicMs',
        },
        anchors: JSON.parse(JSON.stringify(anchors)),
      };
    },
  };
}

function publicProfile(profile) {
  return {
    mode: profile.mode,
    profileId: profile.profileId,
    source: profile.source,
    path: profile.path,
    generatedUnder: profile.generatedUnder || null,
    generated: profile.generated,
    cleanupPolicy: profile.cleanup ? 'delete-exact-generated-leaf' : 'preserve-explicit-profile',
  };
}

function createRunnerMetadata({ root, args, profile, instrumentation, timing, lock, launchId }) {
  const initialTiming = timing.snapshot();
  const freshProfile = profile.mode === 'isolated-temporary';
  if (!Number.isInteger(lock?.owner?.pid) || lock.owner.pid !== process.pid) {
    throw new Error('Electron repository lock ownerPid must equal the runner parentPid.');
  }
  if (typeof launchId !== 'string' || !launchId || lock.owner.launchId !== launchId) {
    throw new Error('Electron repository lock must be bound to this exact launchId.');
  }
  return {
    schemaVersion: RUNNER_SCHEMA,
    repository: {
      root: canonicalPath(root),
      launchLock: {
        scopeId: lock.scopeId,
        path: lock.path,
        ownerPid: lock.owner.pid,
        ownerLaunchId: lock.owner.launchId,
      },
    },
    launch: {
      launchId,
      executable: EXECUTABLE,
      electronArgs: [...args],
      parentPid: process.pid,
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      runnerProcessStartedAt: initialTiming.clock.processStartedAt,
      runnerPerformanceTimeOriginEpochMs: initialTiming.clock.runnerPerformanceTimeOriginEpochMs,
    },
    profile: publicProfile(profile),
    cachePolicy: {
      electronProcess: 'fresh-process-per-run',
      userData: freshProfile ? 'fresh-empty-temporary-profile' : 'explicit-reusable-profile',
      chromiumDiskCache: freshProfile ? 'fresh-with-generated-profile' : 'preserved-with-explicit-profile',
      gpuDriverShaderCache: 'host-managed-not-cleared',
      warmProfileReuse: freshProfile ? 'disabled-by-default' : 'explicitly-enabled',
    },
    instrumentation: JSON.parse(JSON.stringify(instrumentation)),
    timing: initialTiming,
    readbacks: { beforeDriver: null, driverSnapshots: [], afterDriver: null },
    processes: { initialSnapshot: null, preCloseSnapshot: null },
  };
}

async function captureRuntimeReadback(app, window) {
  const captureStartedAtEpochMs = Date.now();
  const capturedAt = new Date(captureStartedAtEpochMs).toISOString();
  const errors = [];
  let main = null;
  let renderer = null;

  try {
    const expectedUrl = window.url();
    main = await app.evaluate(async ({ app: electronApp, BrowserWindow, screen }, wantedUrl) => {
      const windows = BrowserWindow.getAllWindows().filter((entry) => !entry.isDestroyed());
      const target = windows.find((entry) => entry.webContents.getURL() === wantedUrl) || windows[0] || null;
      const gpu = { featureStatus: electronApp.getGPUFeatureStatus(), basicInfo: null, error: null };
      const processes = electronApp.getAppMetrics().map((metric) => ({
        pid: metric.pid,
        creationTimeEpochMs: metric.creationTime,
        creationTimeEpochUs: Math.round(metric.creationTime * 1000),
        type: metric.type,
        name: metric.name || null,
        serviceName: metric.serviceName || null,
      }));
      const browserProcesses = processes.filter((entry) => entry.type === 'Browser');
      const earlyDiagnostics = typeof globalThis.__fwQaEarlyDiagnosticsSnapshot === 'function'
        ? globalThis.__fwQaEarlyDiagnosticsSnapshot() : null;
      if (browserProcesses.length !== 1) {
        throw new Error(`Expected one Electron Browser process; got ${browserProcesses.length}.`);
      }
      try { gpu.basicInfo = await electronApp.getGPUInfo('basic'); } catch (error) {
        gpu.error = String(error && error.message ? error.message : error);
      }
      if (!target) {
        return {
          userDataPath: electronApp.getPath('userData'),
          process: browserProcesses[0],
          processes,
          earlyDiagnostics,
          runtimeVersions: {
            electron: process.versions.electron || null,
            chrome: process.versions.chrome || null,
            node: process.versions.node || null,
            v8: process.versions.v8 || null,
          },
          windowCount: windows.length,
          window: null,
          display: null,
          gpu,
        };
      }
      const bounds = target.getBounds();
      const display = screen.getDisplayMatching(bounds);
      return {
        userDataPath: electronApp.getPath('userData'),
        process: browserProcesses[0],
        processes,
        earlyDiagnostics,
        runtimeVersions: {
          electron: process.versions.electron || null,
          chrome: process.versions.chrome || null,
          node: process.versions.node || null,
          v8: process.versions.v8 || null,
        },
        windowCount: windows.length,
        window: {
          id: target.id,
          bounds,
          contentBounds: target.getContentBounds(),
          normalBounds: target.getNormalBounds(),
          mode: target.isFullScreen() ? 'fullscreen'
            : target.isMaximized() ? 'maximized-windowed' : 'windowed',
          focused: target.isFocused(),
          visible: target.isVisible(),
          minimized: target.isMinimized(),
          maximized: target.isMaximized(),
          fullscreen: target.isFullScreen(),
          resizable: target.isResizable(),
          url: target.webContents.getURL(),
          rendererPid: target.webContents.getOSProcessId(),
        },
        display: display ? {
          id: display.id,
          bounds: display.bounds,
          workArea: display.workArea,
          scaleFactor: display.scaleFactor,
          displayFrequency: Number.isFinite(display.displayFrequency)
            ? display.displayFrequency : null,
          rotation: display.rotation,
          touchSupport: display.touchSupport,
        } : null,
        gpu,
      };
    }, expectedUrl);
  } catch (error) {
    errors.push(`main:${String(error && error.message ? error.message : error)}`);
  }

  try {
    renderer = await window.evaluate(() => {
      const sampledAtPerformanceNowMs = performance.now();
      const fw = window.__fw;
      const threeRenderer = fw?.scene3d?.renderer || null;
      const gl = threeRenderer?.getContext?.() || null;
      let webgl = null;
      if (gl) {
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const parameter = (name) => {
          try { return gl.getParameter(name); } catch { return null; }
        };
        webgl = {
          context: gl.constructor?.name || null,
          vendor: parameter(gl.VENDOR),
          renderer: parameter(gl.RENDERER),
          version: parameter(gl.VERSION),
          shadingLanguageVersion: parameter(gl.SHADING_LANGUAGE_VERSION),
          unmaskedVendor: debug ? parameter(debug.UNMASKED_VENDOR_WEBGL) : null,
          unmaskedRenderer: debug ? parameter(debug.UNMASKED_RENDERER_WEBGL) : null,
          drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
          antialias: gl.getContextAttributes?.()?.antialias ?? null,
          contextLost: typeof gl.isContextLost === 'function' ? gl.isContextLost() : null,
        };
      }
      const display = fw?.preferences?.values?.display || null;
      const canvas = document.querySelector('#game');
      return {
        clock: {
          performanceTimeOriginEpochMs: performance.timeOrigin,
          sampledAtPerformanceNowMs,
          sampledAtEpochMs: performance.timeOrigin + sampledAtPerformanceNowMs,
          conversion: 'epochMs = performanceTimeOriginEpochMs + performanceNowMs',
        },
        documentFocused: document.hasFocus(),
        visibilityState: document.visibilityState,
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
        screen: {
          width: window.screen.width,
          height: window.screen.height,
          availWidth: window.screen.availWidth,
          availHeight: window.screen.availHeight,
          colorDepth: window.screen.colorDepth,
          pixelDepth: window.screen.pixelDepth,
        },
        quality: display ? JSON.parse(JSON.stringify(display)) : null,
        renderer: {
          available: !!threeRenderer,
          pixelRatio: threeRenderer?.getPixelRatio?.() ?? null,
          canvasClient: canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : null,
          canvasBacking: canvas ? { width: canvas.width, height: canvas.height } : null,
          webgl,
        },
        screenState: fw?.screen || null,
      };
    });
  } catch (error) {
    errors.push(`renderer:${String(error && error.message ? error.message : error)}`);
  }

  const captureCompletedAtEpochMs = Date.now();
  return {
    capturedAt,
    captureStartedAtEpochMs,
    captureCompletedAtEpochMs,
    captureDurationMs: captureCompletedAtEpochMs - captureStartedAtEpochMs,
    main,
    renderer,
    errors,
  };
}

async function readCdpStream(session, stream, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const fd = fs.openSync(outputPath, 'w');
  let bytes = 0;
  try {
    let eof = false;
    while (!eof) {
      const chunk = await session.send('IO.read', { handle: stream });
      const buffer = Buffer.from(chunk.data || '', chunk.base64Encoded ? 'base64' : 'utf8');
      if (buffer.length) {
        fs.writeSync(fd, buffer);
        bytes += buffer.length;
      }
      eof = !!chunk.eof;
    }
  } finally {
    fs.closeSync(fd);
    await session.send('IO.close', { handle: stream }).catch(() => {});
  }
  return bytes;
}

function cdpEvent(session, name, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.off(name, onEvent);
      reject(new Error(`Timed out waiting for CDP ${name}.`));
    }, timeoutMs);
    const onEvent = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    session.once(name, onEvent);
  });
}

async function startChromiumTrace(context, window, config, timing) {
  const session = await context.newCDPSession(window);
  await session.send('Tracing.start', {
    categories: config.categories.join(','),
    options: 'record-as-much-as-possible',
    transferMode: 'ReturnAsStream',
  });
  timing.mark('chromiumTraceStarted', { source: 'cdp-Tracing.start-resolved' });
  let stopped = false;
  return {
    async stop() {
      if (stopped) return null;
      stopped = true;
      const complete = cdpEvent(session, 'Tracing.tracingComplete', 120_000);
      await session.send('Tracing.end');
      const payload = await complete;
      if (!payload || !payload.stream) throw new Error('Chromium trace completed without a stream handle.');
      const bytes = await readCdpStream(session, payload.stream, config.path);
      timing.mark('chromiumTraceWritten', { source: 'cdp-stream-drained', bytes });
      await session.detach().catch(() => {});
      return { bytes };
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function observeInteractiveMainMenu() {
  const menu = document.querySelector('.menu-screen');
  const saveState = menu?.querySelector?.('.menu-save-state');
  if (!menu || saveState?.getAttribute('aria-busy') !== 'false') return false;
  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0
      && style.pointerEvents !== 'none'
      && rect.width > 0
      && rect.height > 0;
  };
  if (!visible(menu)) return false;
  const actions = [...menu.querySelectorAll('.menu-actions > .menu-action')];
  const byLabel = (wanted) => actions.find((button) => (
    button.querySelector('.menu-action-label')?.textContent?.trim() === wanted
  ));
  const continueButton = byLabel('Continue');
  const newGameButton = byLabel('New game');
  const continueEnabled = !!continueButton
    && !continueButton.disabled
    && continueButton.getAttribute('aria-disabled') !== 'true'
    && continueButton.matches(':enabled');
  const primary = continueEnabled ? continueButton : newGameButton;
  const label = primary?.querySelector('.menu-action-label')?.textContent?.trim() || '';
  const expectedLabel = continueEnabled ? 'Continue' : 'New game';
  const enabled = !!primary
    && !primary.disabled
    && primary.getAttribute('aria-disabled') !== 'true'
    && primary.matches(':enabled');
  if (!enabled || label !== expectedLabel || !visible(primary)) return false;
  const bounds = primary.getBoundingClientRect();
  const hit = document.elementFromPoint(
    bounds.left + bounds.width / 2,
    bounds.top + bounds.height / 2,
  );
  if (!hit || (hit !== primary && !primary.contains(hit))) return false;
  return {
    discriminator: 'main-menu-interactive',
    selectionPolicy: 'Continue when enabled; otherwise New Game',
    label: label === 'New game' ? 'New Game' : label,
    domLabel: label,
    selector: continueEnabled
      ? '.menu-action.menu-action-primary'
      : '.menu-actions > .menu-action:nth-of-type(2)',
    menuVisible: true,
    saveRefreshSettled: true,
    visible: true,
    enabled: true,
    centerHitTest: true,
  };
}

function makeRunnerApi({ metadata, timing, app, window }) {
  const refreshTiming = () => { metadata.timing = timing.snapshot(); };
  const api = {
    get metadata() {
      refreshTiming();
      return clone(metadata);
    },
    async snapshot(label = 'driver') {
      const readback = await captureRuntimeReadback(app, window);
      metadata.readbacks.driverSnapshots.push({ label: String(label), ...readback });
      refreshTiming();
      return clone(metadata);
    },
  };
  return Object.freeze(api);
}

// A Proxy rather than mutating the Page: Playwright's Page methods are on the
// prototype and several are non-writable.
function shimPage(window, app, runnerApi) {
  return new Proxy(window, {
    get(target, prop) {
      if (prop === 'goto') return async () => null;
      if (prop === 'electronApp') return app;
      if (prop === 'qaRunner') return runnerApi;
      // The game launches maximized. Windows ignores content resizing in that
      // state, so unmaximize, resize the real BrowserWindow, then read it back.
      if (prop === 'setViewportSize') {
        return async (size) => {
          if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
          const got = await app.evaluate(async ({ BrowserWindow }, wanted) => {
            const win = BrowserWindow.getAllWindows()[0];
            if (!win) return null;
            if (win.isFullScreen()) win.setFullScreen(false);
            if (win.isMaximized()) win.unmaximize();
            win.setResizable(true);
            win.setContentSize(Math.round(wanted.width), Math.round(wanted.height));
            const bounds = win.getContentBounds();
            return { width: bounds.width, height: bounds.height, maximized: win.isMaximized() };
          }, size);
          await target.waitForTimeout(220);
          const want = { width: Math.round(size.width), height: Math.round(size.height) };
          if (got && (got.width !== want.width || got.height !== want.height)) {
            const line = `[qa] setViewportSize asked ${want.width}x${want.height} DIP, `
              + `window is ${got.width}x${got.height}`;
            if (got.maximized) throw new Error(`${line} - the window refused to leave maximized.`);
            console.log(`${line} (clamped by the display; every coordinate below is at the second size)`);
          }
          return got;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function main() {
  const timing = createTimingRecorder();
  const rel = process.argv[2];
  if (!rel) throw new Error('Pass a QA function file, for example tools/qa/electron-first-run.js.');
  const file = path.resolve(rel);
  const qaRoot = path.resolve('tools/qa') + path.sep;
  if (!file.startsWith(qaRoot)) throw new Error('QA script must be inside tools/qa/.');

  const source = fs.readFileSync(file, 'utf8');
  const run = Function(`"use strict"; return (${source});`)();
  if (typeof run !== 'function') throw new Error(`${rel} did not evaluate to a function.`);

  const instrumentation = deriveInstrumentation(process.env);
  const launchId = crypto.randomUUID();
  const lock = acquireRepoLaunchLock({ root: ROOT, launchId });
  let profile = null;
  let app = null;
  let electronProcess = null;
  let window;
  let trace = null;
  let traceStopped = false;
  let videoArtifact = null;
  let args;
  let metadata = null;
  let completedResult;
  let driverCompleted;
  let returnedNotOk = false;
  let cleanupFailure = null;
  const diagnostics = [];
  const categorizedDiagnostics = {
    pageErrors: [],
    consoleErrors: [],
    consoleWarnings: [],
    stderr: [],
    traceErrors: [],
    earlyLifecycle: [],
  };

  try {
    profile = prepareUserDataProfile({ root: ROOT });
    args = electronArgs(profile);
    metadata = createRunnerMetadata({
      root: ROOT, args, profile, instrumentation, timing, lock, launchId,
    });
    const { _electron: electron } = loadPlaywright();
    const videoDir = instrumentation.video.directory;
    if (videoDir) fs.mkdirSync(videoDir, { recursive: true });

    timing.mark('electronLaunchRequested', { source: 'parent-before-playwright-electron-launch' });
    app = await electron.launch({
      executablePath: EXECUTABLE,
      args,
      cwd: ROOT,
      timeout: 120_000,
      env: { ...process.env, FW_QA: '1' },
      ...(videoDir ? {
        recordVideo: {
          dir: videoDir,
          ...(instrumentation.video.size ? { size: instrumentation.video.size } : {}),
        },
      } : {}),
    });
    timing.mark('electronLaunchResolved', { source: 'playwright-electron-launch-resolved' });
    electronProcess = app.process();
    if (!electronProcess || !Number.isInteger(electronProcess.pid) || electronProcess.pid <= 0) {
      throw new Error('Playwright Electron launch returned no valid owned child process handle.');
    }
    metadata.launch.playwrightProcessPid = electronProcess.pid;
    const initialProcessSnapshot = await captureElectronProcessSnapshot(app);
    metadata.processes.initialSnapshot = initialProcessSnapshot;
    // Bind the conservative Browser candidate before waiting for a window or
    // menu. If the runner dies in that boot window, a live Electron PID keeps
    // the repository lock from being reclaimed. OS creation-time/parentage
    // attestation below is still mandatory before the driver receives control.
    lock.setElectronMainProcessIdentity(initialProcessSnapshot.browserIdentity);
    metadata.repository.launchLock.candidateElectronPid = initialProcessSnapshot.browserIdentity.pid;
    metadata.repository.launchLock.candidateBoundAtEpochMs = Date.now();
    const actualUserDataPath = await app.evaluate(
      ({ app: electronApp }) => electronApp.getPath('userData'),
    );
    metadata.profile.actualPath = actualUserDataPath;
    metadata.profile.matchesPinnedPath = canonicalPath(actualUserDataPath) === canonicalPath(profile.path);
    if (!metadata.profile.matchesPinnedPath) {
      throw new Error(
        `Electron ignored the pinned QA userData path. Requested ${profile.path}; `
        + `actual ${actualUserDataPath}.`,
      );
    }
    timing.mark('userDataVerified', { source: 'electron-app-getPath-userData' });
    if (videoDir) metadata.instrumentation.video.status = 'recording-until-app-close';
    electronProcess?.stderr?.on('data', (chunk) => {
      const diagnostic = chunk.toString().trim();
      if (diagnostic) {
        categorizedDiagnostics.stderr.push(diagnostic);
        diagnostics.push(`stderr: ${diagnostic}`);
      }
    });

    window = await app.firstWindow({ timeout: 120_000 });
    timing.mark('firstWindow', { source: 'playwright-firstWindow-resolved' });
    if (videoDir) videoArtifact = window.video();
    window.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        categorizedDiagnostics[message.type() === 'error' ? 'consoleErrors' : 'consoleWarnings']
          .push(message.text());
        diagnostics.push(`console:${message.type()}: ${message.text()}`);
      }
    });
    window.on('pageerror', (error) => {
      categorizedDiagnostics.pageErrors.push(error.message);
      diagnostics.push(`pageerror: ${error.message}`);
    });
    await window.waitForLoadState('domcontentloaded');
    const navigation = await window.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0];
      return entry ? {
        timeOrigin: performance.timeOrigin,
        domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
      } : null;
    });
    if (navigation && navigation.domContentLoadedEventEnd > 0) {
      timing.markEpoch(
        'domContentLoaded',
        navigation.timeOrigin + navigation.domContentLoadedEventEnd,
        { source: 'renderer-navigation-timing' },
      );
    } else {
      timing.mark('domContentLoaded', { source: 'playwright-load-state-observation' });
    }
    const menuReadyHandle = await window.waitForFunction(
      observeInteractiveMainMenu,
      null,
      { timeout: 120_000 },
    );
    const menuReadyEvidence = await menuReadyHandle.jsonValue();
    await menuReadyHandle.dispose();
    // COMPOSITOR STATE, STAMPED INTO EVERY RUN. Boot and latency numbers taken
    // while the compositor is throttled describe the machine, not the build
    // (6.05 s and 34.8 s were the same build on the same profile) -- so every
    // run now carries a 700 ms three-queue sample taken right after the menu.
    // rAF starved while the timer runs = throttled compositor; both starved =
    // blocked main thread; the verdict prints beside the run and rides the
    // result envelope. HARNESS_DEBT #11.
    const compositorSample = await window.evaluate(async () => {
      const res = { raf: [], timer: [] };
      let lr = 0; let lt = 0; let stop = false;
      const rl = () => { const t = performance.now(); if (lr) res.raf.push(t - lr); lr = t; if (!stop) requestAnimationFrame(rl); };
      requestAnimationFrame(rl);
      const tl = () => { const t = performance.now(); if (lt) res.timer.push(t - lt); lt = t; if (!stop) setTimeout(tl, 0); };
      setTimeout(tl, 0);
      await new Promise((r) => { setTimeout(r, 700); });
      stop = true;
      const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
      const rafMed = med(res.raf); const timerMed = med(res.timer);
      let verdict = 'HEALTHY';
      if (rafMed == null || rafMed > 400) verdict = (timerMed != null && timerMed < 50) ? 'THROTTLED-COMPOSITOR' : 'BLOCKED-MAIN-THREAD';
      return { rafMedianMs: rafMed == null ? null : +rafMed.toFixed(1), timerMedianMs: timerMed == null ? null : +timerMed.toFixed(1), rafN: res.raf.length, verdict };
    }).catch(() => null);
    if (compositorSample) {
      timing.mark('compositorSampled', { source: 'renderer-three-queue-sample', verdict: compositorSample.verdict });
      console.log('compositor at menu: ' + compositorSample.verdict + ' (raf median ' + compositorSample.rafMedianMs + ' ms, n=' + compositorSample.rafN + ')');
      if (compositorSample.verdict !== 'HEALTHY') {
        console.log('WARNING: numbers from this run describe the MACHINE STATE, not the build — see HARNESS_DEBT #11');
      }
    }
    global.__fwCompositorSample = compositorSample;
    if (!menuReadyEvidence || menuReadyEvidence.discriminator !== 'main-menu-interactive') {
      throw new Error('Main-menu readiness observation did not return its exact discriminator.');
    }
    metadata.launch.menuReadyEvidence = menuReadyEvidence;
    timing.mark('menuReady', {
      source: 'visible-enabled-primary-menu-action-after-save-refresh',
      ...menuReadyEvidence,
    });

    // Playwright 1.61 uses shell=true on Windows, so app.process() is cmd.exe.
    // Run the comparatively expensive CIM read only after the production menu
    // readiness anchor is recorded. The appMetrics snapshot itself was taken
    // immediately at launch resolution, and exact creation times bind it here.
    const launchOsReadback = {
      source: 'Win32_Process.CreationDate',
      capturedAtEpochMs: Date.now(),
      processes: readWindowsProcessIdentities([
        electronProcess.pid,
        ...initialProcessSnapshot.processes.map((entry) => entry.pid),
      ]),
    };
    metadata.processes.launchOsReadback = launchOsReadback;
    const useLaunchOsReadback = () => launchOsReadback.processes;
    const launchRelationship = attestWindowsLaunchRelationship(
      initialProcessSnapshot,
      electronProcess.pid,
      { readWindows: useLaunchOsReadback },
    );
    launchRelationship.osReadbackCapturedAtEpochMs = launchOsReadback.capturedAtEpochMs;
    if (!launchRelationship.confirmed) {
      throw new Error(
        `Could not prove the Playwright shell-wrapper to Electron Browser lineage: `
        + `${launchRelationship.error || 'unknown lineage mismatch'}`,
      );
    }
    const initialProcessAttestation = attestElectronProcessSnapshot(initialProcessSnapshot, {
      readWindows: useLaunchOsReadback,
    });
    if (!initialProcessAttestation.confirmed) {
      throw new Error(
        `Could not attest the launched Electron main process identity: `
        + `${initialProcessAttestation.error || 'unknown identity mismatch'}`,
      );
    }
    metadata.launch.playwrightProcessIdentity = {
      ...launchRelationship.playwrightProcessIdentity,
    };
    metadata.launch.electronMainProcessIdentity = { ...initialProcessSnapshot.browserIdentity };
    metadata.launch.electronPid = initialProcessSnapshot.browserIdentity.pid;
    metadata.launch.processRelationship = launchRelationship;
    metadata.processes.initialOsAttestation = initialProcessAttestation;

    metadata.readbacks.beforeDriver = await captureRuntimeReadback(app, window);
    if (!sameProcessIdentity(
      metadata.readbacks.beforeDriver?.main?.process,
      metadata.launch.electronMainProcessIdentity,
    )) {
      throw new Error('Runtime readback Electron Browser identity does not match the launched process.');
    }
    metadata.timing = timing.snapshot();
    const runnerApi = makeRunnerApi({ metadata, timing, app, window });
    const page = shimPage(window, app, runnerApi);

    if (instrumentation.chromiumTrace.enabled) {
      trace = await startChromiumTrace(
        app.context(), window, instrumentation.chromiumTrace, timing,
      );
      metadata.instrumentation.chromiumTrace.status = 'recording';
    }

    try {
      const result = await run(page, runnerApi);
      completedResult = result;
      driverCompleted = true;
      timing.mark('driverComplete', { source: 'driver-promise-resolved' });
      if (trace) {
        const traceResult = await trace.stop();
        traceStopped = true;
        metadata.instrumentation.chromiumTrace.status = 'written';
        metadata.instrumentation.chromiumTrace.bytes = traceResult.bytes;
      }
      metadata.readbacks.afterDriver = await captureRuntimeReadback(app, window);
      if (!sameProcessIdentity(
        metadata.readbacks.afterDriver?.main?.process,
        metadata.launch.electronMainProcessIdentity,
      )) {
        throw new Error('Post-driver Electron Browser identity does not match the launched process.');
      }
      metadata.timing = timing.snapshot();
      if (result && typeof result === 'object' && result.ok === false) {
        returnedNotOk = true;
        const failureDir = path.resolve('qa/electron/diagnostics');
        fs.mkdirSync(failureDir, { recursive: true });
        await window.screenshot({ path: path.join(failureDir, 'runner-failure.png') }).catch(() => {});
      }
    } catch (error) {
      if (trace && !traceStopped) {
        await trace.stop().then((traceResult) => {
          traceStopped = true;
          metadata.instrumentation.chromiumTrace.status = 'written-after-driver-failure';
          metadata.instrumentation.chromiumTrace.bytes = traceResult.bytes;
        }).catch((traceError) => {
          metadata.instrumentation.chromiumTrace.status = 'failed';
          categorizedDiagnostics.traceErrors.push(traceError.message);
          diagnostics.push(`trace:${traceError.message}`);
        });
      }
      const failureDir = path.resolve('qa/electron/diagnostics');
      fs.mkdirSync(failureDir, { recursive: true });
      await window.screenshot({ path: path.join(failureDir, 'runner-failure.png') }).catch(() => {});
      if (diagnostics.length) process.stderr.write(`${diagnostics.slice(0, 40).join('\n')}\n`);
      throw error;
    }
  } finally {
    const cleanup = {
      electronApplication: {
        attempted: !!app,
        closed: !app,
        exitCode: null,
        error: null,
        gracefulCloseError: null,
        forcedTerminationAttempted: false,
        confirmedExited: !app,
        playwrightProcessConfirmedExited: !app,
        mainProcessConfirmedExited: !app,
        processTree: {
          required: !!app,
          source: process.platform === 'win32'
            ? 'electron-app-getAppMetrics+Win32_Process.CreationDate' : null,
          snapshotCaptured: false,
          identityCount: 0,
          preCloseAttestation: null,
          verification: null,
          confirmedExited: !app,
          error: null,
        },
      },
      profile: profile ? {
        path: profile.path,
        action: profile.cleanup ? 'remove-generated-leaf' : 'preserve-explicit-profile',
        removed: null,
        existsAfterCleanup: null,
        error: null,
      } : null,
      launchLock: {
        path: lock.path,
        released: false,
        existsAfterCleanup: null,
        error: null,
      },
      completedAt: null,
    };

    if (app) {
      let preCloseProcessSnapshot = null;
      try {
        const earlyDiagnostics = await app.evaluate(() => (
          typeof globalThis.__fwQaEarlyDiagnosticsSnapshot === 'function'
            ? globalThis.__fwQaEarlyDiagnosticsSnapshot() : null
        ));
        if (!Array.isArray(earlyDiagnostics)) {
          // This throw is caught by the cleanup-local catch immediately below.
          // eslint-disable-next-line no-unsafe-finally
          throw new Error('QA launch did not expose the early lifecycle diagnostics bridge.');
        }
        classifyQaEarlyDiagnostics(earlyDiagnostics, categorizedDiagnostics, diagnostics);
        metadata.earlyLifecycleDiagnostics = JSON.parse(JSON.stringify(earlyDiagnostics));
        preCloseProcessSnapshot = await captureElectronProcessSnapshot(app, {
          expectedBrowserPid: metadata?.launch?.electronMainProcessIdentity?.pid ?? null,
        });
        const preCloseAttestation = attestElectronProcessSnapshot(preCloseProcessSnapshot);
        metadata.processes.preCloseSnapshot = preCloseProcessSnapshot;
        metadata.processes.preCloseOsAttestation = preCloseAttestation;
        cleanup.electronApplication.processTree.snapshotCaptured = true;
        cleanup.electronApplication.processTree.identityCount = preCloseProcessSnapshot.processes.length;
        cleanup.electronApplication.processTree.preCloseAttestation = preCloseAttestation;
        if (!preCloseAttestation.confirmed) {
          // This throw is caught by the cleanup-local catch immediately below.
          // eslint-disable-next-line no-unsafe-finally
          throw new Error(
            `Could not exactly attest the pre-close Electron process set: `
            + `${preCloseAttestation.error || 'unknown identity mismatch'}`,
          );
        }
      } catch (error) {
        cleanup.electronApplication.processTree.error = String(
          error && error.message ? error.message : error,
        );
        cleanupFailure ||= error;
      }
      try {
        await app.close();
      } catch (error) {
        cleanup.electronApplication.gracefulCloseError = String(
          error && error.message ? error.message : error,
        );
      }
      let childExited = await waitForOwnedProcessExit(electronProcess, 5000);
      if (!childExited && electronProcess) {
        cleanup.electronApplication.forcedTerminationAttempted = true;
        try {
          electronProcess.kill();
        } catch (error) {
          cleanup.electronApplication.error = String(error && error.message ? error.message : error);
        }
        childExited = await waitForOwnedProcessExit(electronProcess, 5000);
      }
      cleanup.electronApplication.playwrightProcessConfirmedExited = childExited;
      cleanup.electronApplication.exitCode = electronProcess?.exitCode ?? null;
      if (!childExited) {
        const error = new Error(
          `Electron child ${electronProcess?.pid ?? '(unknown)'} did not exit; `
          + 'retaining its userData profile and repository lock.',
        );
        cleanup.electronApplication.error ||= error.message;
        cleanupFailure ||= error;
      }
      if (preCloseProcessSnapshot
          && cleanup.electronApplication.processTree.preCloseAttestation?.confirmed) {
        const exitSnapshot = mergeCapturedProcessSnapshots(
          metadata?.processes?.initialSnapshot,
          preCloseProcessSnapshot,
          {
            capturedAtEpochMs: metadata?.launch?.processRelationship
              ?.osReadbackCapturedAtEpochMs ?? preCloseProcessSnapshot.capturedAtEpochMs,
            processes: metadata?.launch?.playwrightProcessIdentity
              ? [{
                ...metadata.launch.playwrightProcessIdentity,
                type: 'Playwright shell wrapper',
              }] : [],
          },
        );
        cleanup.electronApplication.processTree.exitSnapshot = exitSnapshot;
        cleanup.electronApplication.processTree.identityCount = exitSnapshot.processes.length;
        const verification = await waitForElectronProcessSetExit(exitSnapshot, {
          timeoutMs: 5000,
        });
        cleanup.electronApplication.processTree.verification = verification;
        cleanup.electronApplication.processTree.confirmedExited = verification.confirmedExited;
        const electronMainIdentity = metadata?.launch?.electronMainProcessIdentity
          || preCloseProcessSnapshot.browserIdentity;
        cleanup.electronApplication.mainProcessConfirmedExited = verification.confirmedExited
          && verification.exitedIdentities.some((entry) => (
            sameProcessIdentity(entry, electronMainIdentity)
          ));
        if (!verification.confirmedExited) {
          const detail = verification.error
            || `${verification.liveIdentities.length} captured process identity/identities remain live`;
          const error = new Error(
            `Electron process tree did not receive exact exit proof (${detail}); `
            + 'retaining its userData profile and repository lock.',
          );
          cleanup.electronApplication.processTree.error ||= error.message;
          cleanupFailure ||= error;
        }
      }
      const processTreeExited = cleanup.electronApplication.processTree.confirmedExited === true;
      cleanup.electronApplication.confirmedExited = childExited
        && processTreeExited
        && cleanup.electronApplication.mainProcessConfirmedExited;
      cleanup.electronApplication.closed = cleanup.electronApplication.confirmedExited;
    }
    if (metadata?.instrumentation.video.enabled && cleanup.electronApplication.confirmedExited) {
      if (!videoArtifact) {
        metadata.instrumentation.video.status = 'missing-video-handle';
        cleanupFailure ||= new Error('Electron video was configured but the page exposed no video handle.');
      } else {
        try {
          const videoPath = await videoArtifact.path();
          metadata.instrumentation.video.path = videoPath;
          metadata.instrumentation.video.exists = fs.existsSync(videoPath);
          metadata.instrumentation.video.bytes = metadata.instrumentation.video.exists
            ? fs.statSync(videoPath).size : null;
          metadata.instrumentation.video.status = metadata.instrumentation.video.exists
            ? 'written' : 'missing-after-app-close';
          if (!metadata.instrumentation.video.exists) {
            cleanupFailure ||= new Error(`Configured Electron video was not written: ${videoPath}`);
          }
        } catch (error) {
          metadata.instrumentation.video.status = 'failed';
          metadata.instrumentation.video.error = String(error && error.message ? error.message : error);
          cleanupFailure ||= error;
        }
      }
    }
    try {
      if (profile && cleanup.electronApplication.confirmedExited) {
        cleanup.profile.removed = cleanupUserDataProfile(profile);
        cleanup.profile.existsAfterCleanup = fs.existsSync(profile.path);
        const profileStateMatchesPolicy = profile.cleanup
          ? !cleanup.profile.existsAfterCleanup
          : cleanup.profile.existsAfterCleanup && cleanup.profile.removed === false;
        if (!profileStateMatchesPolicy) {
          // This throw is caught by the cleanup-local catch immediately below.
          // eslint-disable-next-line no-unsafe-finally
          throw new Error(`Electron profile cleanup did not match policy for ${profile.path}.`);
        }
      } else if (profile) {
        cleanup.profile.action = 'retained-because-electron-process-tree-exit-is-unproven';
        cleanup.profile.removed = false;
        cleanup.profile.existsAfterCleanup = fs.existsSync(profile.path);
      }
    } catch (error) {
      if (cleanup.profile) cleanup.profile.error = String(error && error.message ? error.message : error);
      cleanupFailure ||= error;
    }
    try {
      if (cleanup.electronApplication.confirmedExited) {
        cleanup.launchLock.released = lock.release();
        cleanup.launchLock.existsAfterCleanup = fs.existsSync(lock.path);
        if (!cleanup.launchLock.released || cleanup.launchLock.existsAfterCleanup) {
          // This throw is caught by the cleanup-local catch immediately below.
          // eslint-disable-next-line no-unsafe-finally
          throw new Error(`Electron repository lock was not removed: ${lock.path}`);
        }
      } else {
        cleanup.launchLock.released = false;
        cleanup.launchLock.existsAfterCleanup = fs.existsSync(lock.path);
        cleanup.launchLock.retainedBecauseElectronPid = metadata?.launch?.electronPid ?? null;
        cleanup.launchLock.retainedBecausePlaywrightProcessPid = electronProcess?.pid ?? null;
        cleanup.launchLock.retainedBecauseProcessTreeExitIsUnproven = true;
        if (!cleanup.launchLock.existsAfterCleanup) {
          // This throw is caught by the cleanup-local catch immediately below.
          // eslint-disable-next-line no-unsafe-finally
          throw new Error(`Electron lock disappeared before process-tree exit was proven: ${lock.path}`);
        }
      }
    } catch (error) {
      cleanup.launchLock.error = String(error && error.message ? error.message : error);
      cleanupFailure ||= error;
    }
    cleanup.completedAt = new Date().toISOString();
    if (metadata) {
      timing.mark('runnerCleanupComplete', { source: 'app-profile-lock-teardown' });
      metadata.timing = timing.snapshot();
      metadata.cleanup = cleanup;
      metadata.diagnostics = JSON.parse(JSON.stringify(categorizedDiagnostics));
    }
  }

  if (diagnostics.length) process.stderr.write(`${diagnostics.slice(0, 40).join('\n')}\n`);
  if (cleanupFailure) throw cleanupFailure;
  if (returnedNotOk) throw new Error(`${rel} returned ok:false`);
  if (driverCompleted && metadata) {
    const json = `${JSON.stringify({
      electronArgs: args,
      compositorAtMenu: global.__fwCompositorSample || null,
      runner: metadata,
      result: completedResult,
    }, null, 2)}\n`;
    process.stdout.write(json);
    if (process.env.QA_RESULT_PATH) {
      const out = path.resolve(process.env.QA_RESULT_PATH);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, json);
    }
  }
}

module.exports = {
  RUNNER_SCHEMA,
  acquireRepoLaunchLock,
  attestElectronProcessSnapshot,
  attestWindowsLaunchRelationship,
  captureElectronProcessSnapshot,
  captureRuntimeReadback,
  canonicalPath,
  classifyQaEarlyDiagnostics,
  cleanupUserDataProfile,
  createRunnerMetadata,
  createTimingRecorder,
  deriveInstrumentation,
  electronArgs,
  inspectCapturedProcessSet,
  mergeCapturedProcessSnapshots,
  normalizeElectronProcessMetrics,
  observeInteractiveMainMenu,
  prepareUserDataProfile,
  readWindowsProcessIdentities,
  repoScopeId,
  sameProcessIdentity,
  waitForElectronProcessSetExit,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

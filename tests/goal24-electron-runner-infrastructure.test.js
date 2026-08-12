import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  RUNNER_SCHEMA,
  acquireRepoLaunchLock,
  attestElectronProcessSnapshot,
  attestWindowsLaunchRelationship,
  captureElectronProcessSnapshot,
  canonicalPath,
  captureRuntimeReadback,
  cleanupUserDataProfile,
  classifyQaEarlyDiagnostics,
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
  waitForElectronProcessSetExit,
} = require('../tools/qa/run-electron.cjs');

test('early lifecycle diagnostics fail closed on startup renderer/preload errors', () => {
  const categorized = {
    pageErrors: [], consoleErrors: [], consoleWarnings: [], stderr: [], traceErrors: [],
    earlyLifecycle: [],
  };
  const diagnostics = [];
  const entries = [
    { kind: 'web-contents-created', atEpochMs: 1, webContentsId: 4 },
    { kind: 'console-message', atEpochMs: 2, level: 2, message: 'warning' },
    { kind: 'console-message', atEpochMs: 3, level: 3, message: 'startup boom' },
    { kind: 'preload-error', atEpochMs: 4, error: 'preload boom' },
  ];
  assert.equal(classifyQaEarlyDiagnostics(entries, categorized, diagnostics), 4);
  assert.equal(categorized.consoleWarnings.length, 1);
  assert.equal(categorized.consoleErrors.length, 1);
  assert.equal(categorized.pageErrors.length, 1);
  assert.match(categorized.consoleErrors[0], /startup boom/);
  assert.match(categorized.pageErrors[0], /preload boom/);
  assert.equal(classifyQaEarlyDiagnostics(entries, categorized, diagnostics), 4,
    'reading the bounded main-process journal twice does not duplicate failures');
});

function tempTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-flipper-runner-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const locks = path.join(root, 'locks');
  const profiles = path.join(root, 'profiles');
  fs.mkdirSync(repo, { recursive: true });
  return { root, repo, locks, profiles };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('repository launch lock rejects a concurrent live owner and removes only its own leaf', (t) => {
  const { repo, locks } = tempTree(t);
  const first = acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4101,
    now: () => 1_800_000_000_000,
    pidAlive: (pid) => pid === 4101,
  });
  const neighbour = path.join(locks, 'unrelated.lock');
  fs.mkdirSync(neighbour);

  assert.throws(() => acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4102,
    now: () => 1_800_000_000_500,
    pidAlive: (pid) => pid === 4101,
  }), (error) => error.code === 'QA_ELECTRON_LOCKED' && error.owner.pid === 4101);

  assert.equal(first.release(), true);
  assert.equal(fs.existsSync(first.path), false);
  assert.equal(fs.existsSync(neighbour), true, 'a neighbouring repository lock is preserved');
  assert.equal(first.release(), false, 'release is idempotent');
});

test('repository launch lock recovers a confirmed-dead owner but never reaps an old live owner', (t) => {
  const { repo, locks } = tempTree(t);
  const deadOwner = acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4201,
    now: () => 1_800_000_000_000,
    pidAlive: () => true,
  });

  const recovered = acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4202,
    now: () => 1_800_000_900_000,
    pidAlive: (pid) => pid === 4202,
  });
  assert.equal(recovered.owner.pid, 4202);
  assert.equal(recovered.path, deadOwner.path);

  assert.throws(() => acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4203,
    now: () => 1_900_000_000_000,
    pidAlive: (pid) => pid === 4202,
  }), (error) => error.code === 'QA_ELECTRON_LOCKED' && error.owner.pid === 4202);
  recovered.release();
});

test('dead runner cannot lose its pre-menu lock while the bound Browser candidate is live', (t) => {
  const { repo, locks } = tempTree(t);
  const parentPid = 4251;
  const electronPid = 4252;
  const first = acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: parentPid,
    now: () => 1_800_000_000_000,
    pidAlive: (pid) => pid === parentPid,
  });
  const ownerPath = path.join(first.path, 'owner.json');

  const identity = { pid: electronPid, creationTimeEpochMs: 1_800_000_000_250, type: 'Browser' };
  const boundIdentity = {
    ...identity,
    creationTimeEpochUs: 1_800_000_000_250_000,
  };
  assert.deepEqual(first.setElectronMainProcessIdentity(identity), boundIdentity);
  assert.equal(readJson(ownerPath).electronPid, electronPid);
  assert.deepEqual(readJson(ownerPath).electronMainProcessIdentity, boundIdentity);

  assert.throws(() => acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4253,
    now: () => 1_800_000_001_000,
    pidAlive: (pid) => pid === electronPid,
  }), (error) => error.code === 'QA_ELECTRON_LOCKED'
    && error.owner.pid === parentPid
    && error.owner.electronPid === electronPid);

  const recovered = acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4253,
    now: () => 1_800_000_002_000,
    pidAlive: () => false,
  });
  assert.equal(recovered.owner.pid, 4253);
  recovered.release();
});

test('main binds the Browser candidate to owner.json before any window, menu, or CIM wait', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/run-electron.cjs', import.meta.url),
    'utf8',
  );
  const mainStart = source.indexOf('async function main()');
  const capture = source.indexOf(
    'const initialProcessSnapshot = await captureElectronProcessSnapshot(app);',
    mainStart,
  );
  const bind = source.indexOf(
    'lock.setElectronMainProcessIdentity(initialProcessSnapshot.browserIdentity);',
    capture,
  );
  const firstWindow = source.indexOf('window = await app.firstWindow', capture);
  const cimRead = source.indexOf('const launchOsReadback = {', capture);
  assert.ok(mainStart >= 0 && capture > mainStart);
  assert.ok(bind > capture, 'candidate identity is written after the appMetrics capture');
  assert.ok(bind < firstWindow, 'candidate identity is written before firstWindow');
  assert.ok(bind < cimRead, 'candidate identity is written before menu/CIM attestation');
});

test('dead stale-recovery claimant does not strand a repository lock forever', (t) => {
  const { repo, locks } = tempTree(t);
  const acquiredEpochMs = Date.now() - 60_000;
  const deadOwner = acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4261,
    now: () => acquiredEpochMs,
    pidAlive: () => true,
  });
  const reclaimPath = path.join(deadOwner.path, 'reclaim.json');
  const reclaim = {
    pid: 4262,
    token: 'abandoned-reclaim-token',
    expectedOwnerToken: deadOwner.owner.token,
    claimedAtEpochMs: acquiredEpochMs,
  };
  fs.writeFileSync(reclaimPath, `${JSON.stringify(reclaim)}\n`, { flag: 'wx' });

  assert.throws(() => acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4263,
    now: () => Date.now(),
    pidAlive: (pid) => pid === reclaim.pid,
    staleAfterMs: 10_000,
  }), (error) => error.code === 'QA_ELECTRON_LOCKED');
  assert.deepEqual(readJson(reclaimPath), reclaim, 'a live recovery claim remains untouched');

  const recovered = acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4263,
    now: () => Date.now(),
    pidAlive: () => false,
    staleAfterMs: 10_000,
  });
  assert.equal(recovered.owner.pid, 4263);
  recovered.release();
});

test('Electron child PID update atomically preserves the prior owner if replacement fails', (t) => {
  const { repo, locks } = tempTree(t);
  const lock = acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4271,
    pidAlive: (pid) => pid === 4271,
  });
  const ownerPath = path.join(lock.path, 'owner.json');
  const ownerBefore = fs.readFileSync(ownerPath, 'utf8');
  const originalRenameSync = fs.renameSync;
  const injected = Object.assign(new Error('injected owner replacement failure'), {
    code: 'QA_TEST_RENAME_FAILURE',
  });
  let replacementAttempted = false;

  fs.renameSync = (from, to) => {
    if (path.resolve(to) === path.resolve(ownerPath)) {
      replacementAttempted = true;
      throw injected;
    }
    return originalRenameSync(from, to);
  };
  try {
    assert.throws(() => lock.setElectronMainProcessIdentity({
      pid: 4272,
      creationTimeEpochMs: 1_800_000_000_275,
      type: 'Browser',
    }), (error) => error === injected);
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.equal(replacementAttempted, true, 'owner update uses a same-leaf atomic replacement');
  assert.equal(fs.readFileSync(ownerPath, 'utf8'), ownerBefore);
  assert.equal(lock.release(), true);
});

test('repository lock scope is stable per canonical repo and different between repos', (t) => {
  const { root, repo } = tempTree(t);
  const other = path.join(root, 'other-repo');
  fs.mkdirSync(other);
  assert.equal(repoScopeId(repo), repoScopeId(path.join(repo, '.')));
  assert.notEqual(repoScopeId(repo), repoScopeId(other));
});

test('partial lock metadata receives a safety grace before stale recovery', (t) => {
  const { repo, locks } = tempTree(t);
  fs.mkdirSync(locks, { recursive: true });
  const lockPath = path.join(locks, `${repoScopeId(repo)}.lock`);
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, 'owner.json'), '{partial');
  const mtime = fs.statSync(lockPath).mtimeMs;

  assert.throws(() => acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4301,
    now: () => mtime + 1_000,
    pidAlive: () => false,
    staleAfterMs: 10_000,
  }), (error) => error.code === 'QA_ELECTRON_LOCKED');
  assert.ok(fs.existsSync(lockPath), 'fresh partial ownership is not deleted');

  const recovered = acquireRepoLaunchLock({
    root: repo,
    lockBase: locks,
    pid: 4301,
    now: () => mtime + 11_000,
    pidAlive: (pid) => pid === 4301,
    staleAfterMs: 10_000,
  });
  assert.equal(recovered.owner.pid, 4301);
  recovered.release();
});

test('profile policy isolates defaults, pins the Electron flag, and cleans only generated profiles', (t) => {
  const { repo, profiles } = tempTree(t);
  const sibling = path.join(profiles, 'keep-me');
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'sentinel.txt'), 'keep');

  const profile = prepareUserDataProfile({ root: repo, argv: [], env: {}, profileBase: profiles });
  assert.equal(profile.mode, 'isolated-temporary');
  assert.equal(profile.generated, true);
  assert.equal(path.dirname(profile.path), canonicalPath(profiles));
  assert.ok(fs.existsSync(profile.path));

  const args = electronArgs(profile, ['--label=before', '--clubhouse=pine-hills-v2'], {});
  assert.equal(args[0], '.');
  assert.ok(args.includes('--label=before'));
  assert.ok(args.includes('--clubhouse=pine-hills-v2'));
  assert.deepEqual(args.filter((arg) => arg.startsWith('--user-data-dir=')), [profile.electronArg]);
  const scaledArgs = electronArgs(profile, [], { QA_FORCE_DEVICE_SCALE_FACTOR: '1' });
  assert.ok(scaledArgs.includes('--force-device-scale-factor=1'));
  assert.throws(
    () => electronArgs(profile, [], { QA_FORCE_DEVICE_SCALE_FACTOR: '0' }),
    /finite number above 0/,
  );

  assert.equal(cleanupUserDataProfile(profile), true);
  assert.equal(fs.existsSync(profile.path), false);
  assert.equal(fs.readFileSync(path.join(sibling, 'sentinel.txt'), 'utf8'), 'keep');
});

test('generated profile cleanup refuses a leaf replaced by a reparse point or symlink', (t) => {
  const { root, repo, profiles } = tempTree(t);
  const profile = prepareUserDataProfile({ root: repo, argv: [], env: {}, profileBase: profiles });
  const external = path.join(root, 'must-not-delete');
  const sentinel = path.join(external, 'sentinel.txt');
  fs.mkdirSync(external);
  fs.writeFileSync(sentinel, 'keep');
  fs.rmSync(profile.cleanupPath, { recursive: true, force: false });

  try {
    fs.symlinkSync(external, profile.cleanupPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory links unavailable in this environment (${error.code})`);
      return;
    }
    throw error;
  }

  try {
    assert.throws(
      () => cleanupUserDataProfile(profile),
      /Refusing to remove a reparse\/symlink or non-directory profile leaf/,
    );
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
  } finally {
    fs.unlinkSync(profile.cleanupPath);
  }
});

test('generated profile cleanup refuses an ordinary directory replacement at the same path', (t) => {
  const { repo, profiles } = tempTree(t);
  const profile = prepareUserDataProfile({ root: repo, argv: [], env: {}, profileBase: profiles });
  fs.rmSync(profile.cleanupPath, { recursive: true, force: false });
  fs.mkdirSync(profile.cleanupPath);
  const replacementSentinel = path.join(profile.cleanupPath, 'replacement.txt');
  fs.writeFileSync(replacementSentinel, 'keep');
  assert.throws(
    () => cleanupUserDataProfile(profile),
    /Refusing to remove a replaced Electron QA profile directory|owned marker/,
  );
  assert.equal(fs.readFileSync(replacementSentinel, 'utf8'), 'keep');
});

test('explicit reusable profiles are normalized, de-duplicated, and always preserved', (t) => {
  const { repo, profiles } = tempTree(t);
  const explicit = path.join(profiles, 'warm-profile');
  const profile = prepareUserDataProfile({
    root: repo,
    argv: [`--user-data-dir=${explicit}`],
    env: {},
    profileBase: profiles,
  });
  fs.writeFileSync(path.join(profile.path, 'sentinel.txt'), 'reuse');

  assert.equal(profile.mode, 'reusable-explicit');
  assert.equal(profile.generated, false);
  assert.equal(cleanupUserDataProfile(profile), false);
  assert.equal(fs.readFileSync(path.join(profile.path, 'sentinel.txt'), 'utf8'), 'reuse');
  const args = electronArgs(profile, [
    `--user-data-dir=${explicit}`,
    '--clubhouse=pine-hills-v2',
  ], {});
  assert.deepEqual(args.filter((arg) => arg.startsWith('--user-data-dir=')), [profile.electronArg]);

  assert.throws(() => prepareUserDataProfile({
    root: repo,
    argv: [`--user-data-dir=${explicit}`],
    env: { QA_ELECTRON_USER_DATA_DIR: path.join(profiles, 'different') },
    profileBase: profiles,
  }), /disagree/);
});

test('instrumentation mode makes video and CDP traces ineligible for low-overhead claims', () => {
  const low = deriveInstrumentation({});
  assert.equal(low.mode, 'low-overhead');
  assert.equal(low.lowOverheadEligible, true);

  const video = deriveInstrumentation({
    VIDEO_DIR: 'qa/video',
    GOAL24_PERF_RESOLUTION: '1920x1080',
  });
  assert.equal(video.mode, 'video');
  assert.equal(video.lowOverheadEligible, false);
  assert.deepEqual(video.video.size, { width: 1920, height: 1080 });
  assert.equal(video.video.sizeSource, 'GOAL24_PERF_RESOLUTION');
  assert.throws(() => deriveInstrumentation({
    VIDEO_DIR: 'qa/video',
    QA_VIDEO_SIZE: '800-by-450',
  }), /WIDTHxHEIGHT/);

  const both = deriveInstrumentation({
    VIDEO_DIR: 'qa/video',
    QA_CHROMIUM_TRACE_PATH: 'qa/trace/renderer.json',
    QA_INSTRUMENTATION_MODE: 'cdp-trace+video',
  });
  assert.equal(both.mode, 'cdp-trace+video');
  assert.deepEqual(both.captureKinds, ['video', 'cdp-trace']);
  assert.throws(() => deriveInstrumentation({
    VIDEO_DIR: 'qa/video',
    QA_INSTRUMENTATION_MODE: 'low-overhead',
  }), /contradicts/);
});

test('timing anchors and runner metadata serialize with the required launch schema', () => {
  let epoch = 1_800_000_000_000;
  let monotonic = 50;
  const timing = createTimingRecorder({
    epochNow: () => epoch,
    monotonicNow: () => monotonic,
  });
  monotonic = 82.5;
  timing.mark('electronLaunchResolved');
  timing.markEpoch('domContentLoaded', epoch + 50, { source: 'renderer-navigation-timing' });
  monotonic = 125;
  timing.mark('menuReady');

  const profile = {
    mode: 'isolated-temporary', source: 'runner-default', path: '/tmp/profile',
    generated: true, cleanup: true,
  };
  const launchId = '87bb7f5c-36c4-4497-9486-e64146448d67';
  const lock = {
    scopeId: 'abc123', path: '/tmp/lock', owner: { pid: process.pid, launchId },
  };
  const instrumentation = deriveInstrumentation({});
  const metadata = createRunnerMetadata({
    root: process.cwd(),
    args: ['.', '--user-data-dir=/tmp/profile'],
    profile,
    instrumentation,
    timing,
    lock,
    launchId,
  });
  const encoded = JSON.stringify(metadata);
  const decoded = JSON.parse(encoded);

  assert.equal(decoded.schemaVersion, RUNNER_SCHEMA);
  assert.equal(decoded.launch.launchId, launchId);
  assert.equal(decoded.launch.parentPid, decoded.repository.launchLock.ownerPid);
  assert.equal(decoded.repository.launchLock.ownerLaunchId, launchId);
  assert.equal(decoded.profile.cleanupPolicy, 'delete-exact-generated-leaf');
  assert.equal(decoded.cachePolicy.userData, 'fresh-empty-temporary-profile');
  assert.equal(decoded.cachePolicy.gpuDriverShaderCache, 'host-managed-not-cleared');
  assert.equal(decoded.instrumentation.mode, 'low-overhead');
  assert.equal(
    decoded.timing.clock.conversion,
    'epochMs = runnerPerformanceTimeOriginEpochMs + runnerMonotonicMs',
  );
  assert.equal(
    decoded.launch.runnerPerformanceTimeOriginEpochMs,
    decoded.timing.clock.runnerPerformanceTimeOriginEpochMs,
  );
  assert.equal(decoded.timing.anchors.parentLaunchRequest.epochMs, epoch);
  assert.equal(decoded.timing.anchors.electronLaunchResolved.sinceParentLaunchRequestMs, 32.5);
  assert.equal(decoded.timing.anchors.domContentLoaded.sinceParentLaunchRequestMs, 50);
  assert.equal(decoded.timing.anchors.menuReady.sinceParentLaunchRequestMs, 75);
  assert.deepEqual(Object.keys(decoded.readbacks), ['beforeDriver', 'driverSnapshots', 'afterDriver']);
});

test('menu readiness selects one exact visible enabled primary player action', () => {
  const makeButton = (label, disabled) => {
    const labelNode = { textContent: label };
    const button = {
      disabled,
      isConnected: true,
      getAttribute: () => null,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 70 }),
      matches: (selector) => selector === ':enabled' && !disabled,
      querySelector: (selector) => selector === '.menu-action-label' ? labelNode : null,
      contains: (node) => node === labelNode,
    };
    return { button, labelNode };
  };
  const evaluate = ({ continueDisabled, busy = 'false' }) => {
    const continueAction = makeButton('Continue', continueDisabled);
    const newGameAction = makeButton('New game', false);
    const saveState = { getAttribute: (name) => name === 'aria-busy' ? busy : null };
    const menu = {
      isConnected: true,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
      querySelector: (selector) => selector === '.menu-save-state' ? saveState : null,
      querySelectorAll: () => [continueAction.button, newGameAction.button],
    };
    const globals = {
      document: {
        querySelector: (selector) => selector === '.menu-screen' ? menu : null,
        elementFromPoint: () => (continueDisabled
          ? newGameAction.button : continueAction.button),
      },
      getComputedStyle: () => ({
        display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto',
      }),
    };
    return vm.runInNewContext(`(${observeInteractiveMainMenu.toString()})()`, globals);
  };

  const freshProfile = evaluate({ continueDisabled: true });
  assert.equal(freshProfile.discriminator, 'main-menu-interactive');
  assert.equal(freshProfile.label, 'New Game');
  assert.equal(freshProfile.visible, true);
  assert.equal(freshProfile.enabled, true);
  assert.equal(freshProfile.centerHitTest, true);

  const savedProfile = evaluate({ continueDisabled: false });
  assert.equal(savedProfile.label, 'Continue');
  assert.equal(evaluate({ continueDisabled: true, busy: 'true' }), false);
});

test('Electron metrics bind the Playwright main PID to one exact Browser identity', async () => {
  const metrics = [
    { pid: 5101, creationTime: 1_800_000_000_100, type: 'Browser' },
    { pid: 5102, creationTime: 1_800_000_000_200, type: 'Tab', name: 'Renderer' },
    { pid: 5103, creationTime: 1_800_000_000_300, type: 'GPU' },
  ];
  const snapshot = normalizeElectronProcessMetrics(metrics, {
    expectedBrowserPid: 5101,
    capturedAtEpochMs: 1_800_000_000_500,
  });
  assert.equal(snapshot.source, 'electron-app-getAppMetrics');
  assert.deepEqual(snapshot.browserIdentity, {
    pid: 5101,
    creationTimeEpochMs: 1_800_000_000_100,
    creationTimeEpochUs: 1_800_000_000_100_000,
    type: 'Browser',
    name: null,
    serviceName: null,
  });
  assert.equal(snapshot.processes.length, 3);
  assert.throws(
    () => normalizeElectronProcessMetrics(metrics, { expectedBrowserPid: 9999 }),
    /does not match observed Browser PID/,
  );
  assert.throws(
    () => normalizeElectronProcessMetrics([{ pid: 5101, type: 'Browser' }]),
    /no exact OS creation time/,
  );

  const app = {
    evaluate: async (callback) => callback({
      app: { getAppMetrics: () => metrics },
    }),
  };
  const captured = await captureElectronProcessSnapshot(app, {
    expectedBrowserPid: 5101,
    now: () => 1_800_000_000_500,
  });
  assert.deepEqual(captured, snapshot);
});

test('Windows launch evidence proves the Playwright cmd wrapper is the Electron Browser parent', () => {
  // Playwright 1.61 launches Electron with shell=true on Windows. Consequently
  // ElectronApplication.process() is cmd.exe, not the Browser process returned
  // by Electron app.getAppMetrics(). The exact OS lineage is the required bind.
  const snapshot = normalizeElectronProcessMetrics([
    { pid: 5152, creationTime: 1_800_000_000_200, type: 'Browser' },
    { pid: 5153, creationTime: 1_800_000_000_300, type: 'Tab' },
  ]);
  const relationship = attestWindowsLaunchRelationship(snapshot, 5151, {
    platform: 'win32',
    readWindows: () => [
      {
        pid: 5151,
        parentPid: 5100,
        creationTimeEpochMs: 1_800_000_000_100,
        name: 'cmd.exe',
        executablePath: 'C:\\Windows\\System32\\cmd.exe',
      },
      {
        pid: 5152,
        parentPid: 5151,
        creationTimeEpochMs: 1_800_000_000_200,
        name: 'electron.exe',
        executablePath: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
      },
    ],
  });
  assert.equal(relationship.confirmed, true);
  assert.equal(relationship.kind, 'direct-shell-parent');
  assert.equal(relationship.playwrightProcessIdentity.pid, 5151);
  assert.equal(relationship.electronMainProcessIdentity.pid, 5152);
  assert.equal(relationship.electronMainOsIdentity.parentPid, 5151);
  assert.match(relationship.shellBehavior, /shell=true/);

  const unrelated = attestWindowsLaunchRelationship(snapshot, 5151, {
    platform: 'win32',
    readWindows: () => [
      { pid: 5151, parentPid: 5100, creationTimeEpochMs: 1_800_000_000_100 },
      { pid: 5152, parentPid: 9999, creationTimeEpochMs: 1_800_000_000_200 },
    ],
  });
  assert.equal(unrelated.confirmed, false);
  assert.match(unrelated.error, /not Playwright shell wrapper/);
});

test('pre-close process snapshot requires an exact OS attestation of the Browser identity', () => {
  const snapshot = normalizeElectronProcessMetrics([
    { pid: 5201, creationTime: 1_800_000_000_100, type: 'Browser' },
    { pid: 5202, creationTime: 1_800_000_000_200, type: 'GPU' },
  ]);
  const exact = attestElectronProcessSnapshot(snapshot, {
    platform: 'win32',
    readWindows: () => [
      { pid: 5201, creationTimeEpochMs: 1_800_000_000_100 },
      { pid: 5202, creationTimeEpochMs: 1_800_000_000_200 },
    ],
  });
  assert.equal(exact.confirmed, true);
  assert.equal(exact.exactIdentityMatches.length, 2);

  const mismatch = attestElectronProcessSnapshot(snapshot, {
    platform: 'win32',
    readWindows: () => [
      { pid: 5201, creationTimeEpochMs: 1_800_000_000_101 },
    ],
  });
  assert.equal(mismatch.confirmed, false);
  assert.match(mismatch.error, /Browser identity was not exactly attested|creation times disagree/);

  const unavailable = attestElectronProcessSnapshot(snapshot, { platform: 'linux' });
  assert.equal(unavailable.confirmed, false);
  assert.match(unavailable.error, /unavailable/);
});

test('Electron fractional-millisecond creation time is compared to Windows at microsecond precision', () => {
  const snapshot = normalizeElectronProcessMetrics([
    { pid: 5251, creationTime: 1_800_000_000_100.975, type: 'Browser' },
  ]);
  assert.equal(snapshot.browserIdentity.creationTimeEpochUs, 1_800_000_000_100_975);
  const exact = attestElectronProcessSnapshot(snapshot, {
    platform: 'win32',
    readWindows: () => [{
      pid: 5251,
      creationTimeEpochMs: 1_800_000_000_100.975,
      creationTimeEpochUs: 1_800_000_000_100_975,
    }],
  });
  assert.equal(exact.confirmed, true);
  const oneMicrosecondOff = attestElectronProcessSnapshot(snapshot, {
    platform: 'win32',
    readWindows: () => [{
      pid: 5251,
      creationTimeEpochMs: 1_800_000_000_100.976,
      creationTimeEpochUs: 1_800_000_000_100_976,
    }],
  });
  assert.equal(oneMicrosecondOff.confirmed, false);
});

test('Windows CIM readback supplies the current process exact identity and parent', {
  skip: process.platform !== 'win32',
}, () => {
  const rows = readWindowsProcessIdentities([process.pid]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pid, process.pid);
  assert.ok(Number.isInteger(rows[0].parentPid) && rows[0].parentPid > 0);
  assert.ok(Number.isSafeInteger(rows[0].creationTimeEpochUs));
  assert.equal(rows[0].creationTimeEpochUs, Math.round(rows[0].creationTimeEpochMs * 1000));
  assert.match(rows[0].name, /node/i);
});

test('process-tree exit proof distinguishes a still-live identity from safe PID reuse', async () => {
  const snapshot = normalizeElectronProcessMetrics([
    { pid: 5301, creationTime: 1_800_000_000_100, type: 'Browser' },
    { pid: 5302, creationTime: 1_800_000_000_200, type: 'Tab' },
  ]);
  const live = inspectCapturedProcessSet(snapshot, [
    { pid: 5301, creationTimeEpochMs: 1_800_000_000_100 },
  ]);
  assert.equal(live.confirmedExited, false);
  assert.deepEqual(live.liveIdentities.map((entry) => entry.pid), [5301]);

  const reused = inspectCapturedProcessSet(snapshot, [
    { pid: 5301, creationTimeEpochMs: 1_800_000_999_999 },
  ]);
  assert.equal(reused.confirmedExited, true);
  assert.equal(reused.reusedPids.length, 1);
  assert.equal(reused.exitedIdentities.length, 2);

  let elapsed = 0;
  let reads = 0;
  const verification = await waitForElectronProcessSetExit(snapshot, {
    platform: 'win32',
    timeoutMs: 100,
    pollIntervalMs: 25,
    now: () => elapsed,
    wait: async (durationMs) => { elapsed += durationMs; },
    readWindows: () => {
      reads += 1;
      return reads === 1 ? [
        { pid: 5301, creationTimeEpochMs: 1_800_000_000_100 },
        { pid: 5302, creationTimeEpochMs: 1_800_000_000_200 },
      ] : [
        { pid: 5301, creationTimeEpochMs: 1_800_000_999_999 },
      ];
    },
  });
  assert.equal(verification.confirmedExited, true);
  assert.equal(verification.attempts, 2);
  assert.equal(verification.reusedPids.length, 1);
});

test('exit set is the identity-deduplicated union of launch, pre-close, and shell snapshots', () => {
  const initial = normalizeElectronProcessMetrics([
    { pid: 5351, creationTime: 1_800_000_000_100, type: 'Browser' },
    { pid: 5352, creationTime: 1_800_000_000_200, type: 'GPU' },
  ], { capturedAtEpochMs: 100 });
  const preClose = normalizeElectronProcessMetrics([
    { pid: 5351, creationTime: 1_800_000_000_100, type: 'Browser' },
    { pid: 5353, creationTime: 1_800_000_000_300, type: 'Tab' },
  ], { capturedAtEpochMs: 200 });
  const exitSet = mergeCapturedProcessSnapshots(initial, preClose, {
    capturedAtEpochMs: 250,
    processes: [{
      pid: 5350,
      creationTimeEpochMs: 1_800_000_000_050,
      type: 'Playwright shell wrapper',
    }],
  });
  assert.equal(exitSet.source, 'union-of-electron-app-getAppMetrics-snapshots');
  assert.equal(exitSet.capturedAtEpochMs, 250);
  assert.deepEqual(exitSet.processes.map((entry) => entry.pid), [5351, 5352, 5353, 5350]);
});

test('process-tree exit proof fails closed when exact OS creation time is unavailable', async () => {
  const snapshot = normalizeElectronProcessMetrics([
    { pid: 5401, creationTime: 1_800_000_000_100, type: 'Browser' },
  ]);
  const unsupported = await waitForElectronProcessSetExit(snapshot, { platform: 'darwin' });
  assert.equal(unsupported.confirmedExited, false);
  assert.match(unsupported.error, /unavailable/);

  const unreadable = await waitForElectronProcessSetExit(snapshot, {
    platform: 'win32',
    readWindows: () => { throw new Error('creation time denied'); },
  });
  assert.equal(unreadable.confirmedExited, false);
  assert.match(unreadable.error, /creation time denied/);
});

test('runtime readback records actual Electron display and renderer viewport metadata', async () => {
  assert.equal(
    typeof captureRuntimeReadback,
    'function',
    'captureRuntimeReadback must be exported so the evidence schema can be contract-tested',
  );
  const url = 'file:///golf-flipper/index.html';
  const bounds = { x: 40, y: 60, width: 1620, height: 980 };
  const contentBounds = { x: 50, y: 90, width: 1600, height: 940 };
  const display = {
    id: 17,
    bounds: { x: 0, y: 0, width: 2560, height: 1440 },
    workArea: { x: 0, y: 0, width: 2560, height: 1400 },
    scaleFactor: 1.25,
    displayFrequency: 144,
    rotation: 0,
    touchSupport: 'unknown',
  };
  const browserWindow = {
    id: 9,
    isDestroyed: () => false,
    getBounds: () => bounds,
    getContentBounds: () => contentBounds,
    getNormalBounds: () => bounds,
    isFullScreen: () => false,
    isMaximized: () => false,
    isFocused: () => true,
    isVisible: () => true,
    isMinimized: () => false,
    isResizable: () => true,
    webContents: {
      getURL: () => url,
      getOSProcessId: () => 4282,
    },
  };
  const electronApp = {
    getPath: (name) => name === 'userData' ? '/tmp/profile' : null,
    getGPUFeatureStatus: () => ({ webgl: 'enabled' }),
    getGPUInfo: async () => ({ gpuDevice: [{ vendorId: 1234 }] }),
    getAppMetrics: () => [
      { pid: process.pid, creationTime: 1_800_000_000_100, type: 'Browser' },
      { pid: 4282, creationTime: 1_800_000_000_200, type: 'Tab', name: 'Renderer' },
    ],
  };
  const app = {
    evaluate: async (callback, wantedUrl) => callback({
      app: electronApp,
      BrowserWindow: { getAllWindows: () => [browserWindow] },
      screen: {
        getDisplayMatching: (receivedBounds) => {
          assert.deepEqual(receivedBounds, bounds);
          return display;
        },
      },
    }, wantedUrl),
  };

  const gl = {
    VENDOR: 'VENDOR',
    RENDERER: 'RENDERER',
    VERSION: 'VERSION',
    SHADING_LANGUAGE_VERSION: 'SHADING_LANGUAGE_VERSION',
    drawingBufferWidth: 2000,
    drawingBufferHeight: 1175,
    getExtension: () => null,
    getParameter: (name) => ({
      VENDOR: 'QA Vendor',
      RENDERER: 'QA Renderer',
      VERSION: 'WebGL 2 QA',
      SHADING_LANGUAGE_VERSION: 'GLSL QA',
    })[name],
    getContextAttributes: () => ({ antialias: true }),
    isContextLost: () => false,
  };
  const rendererGlobals = {
    performance: { timeOrigin: 1_800_000_000_000, now: () => 125.5 },
    window: {
      __fw: {
        preferences: { values: { display: { preset: 'high', renderScale: 1 } } },
        scene3d: { renderer: { getContext: () => gl, getPixelRatio: () => 1.25 } },
        screen: 'playing',
      },
      innerWidth: 1600,
      innerHeight: 940,
      outerWidth: 1620,
      outerHeight: 980,
      devicePixelRatio: 1.25,
      screen: {
        width: 2048,
        height: 1152,
        availWidth: 2048,
        availHeight: 1120,
        colorDepth: 24,
        pixelDepth: 24,
      },
    },
    document: {
      hasFocus: () => true,
      visibilityState: 'visible',
      querySelector: (selector) => selector === '#game' ? {
        clientWidth: 1600,
        clientHeight: 940,
        width: 2000,
        height: 1175,
      } : null,
    },
  };
  const window = {
    url: () => url,
    evaluate: async (callback) => vm.runInNewContext(`(${callback.toString()})()`, rendererGlobals),
  };

  const readback = JSON.parse(JSON.stringify(await captureRuntimeReadback(app, window)));
  assert.deepEqual(readback.errors, []);
  assert.deepEqual(readback.main.process, {
    pid: process.pid,
    creationTimeEpochMs: 1_800_000_000_100,
    creationTimeEpochUs: 1_800_000_000_100_000,
    type: 'Browser',
    name: null,
    serviceName: null,
  });
  assert.deepEqual(readback.main.window.bounds, bounds);
  assert.deepEqual(readback.main.window.contentBounds, contentBounds);
  assert.deepEqual(readback.main.display, display);
  assert.deepEqual(readback.renderer.viewport, {
    innerWidth: 1600,
    innerHeight: 940,
    outerWidth: 1620,
    outerHeight: 980,
    devicePixelRatio: 1.25,
  });
  assert.deepEqual(readback.renderer.screen, {
    width: 2048,
    height: 1152,
    availWidth: 2048,
    availHeight: 1120,
    colorDepth: 24,
    pixelDepth: 24,
  });
  assert.equal(readback.renderer.renderer.webgl.contextLost, false);
  assert.deepEqual(readback.renderer.renderer.canvasClient, { width: 1600, height: 940 });
  assert.deepEqual(readback.renderer.renderer.canvasBacking, { width: 2000, height: 1175 });
});

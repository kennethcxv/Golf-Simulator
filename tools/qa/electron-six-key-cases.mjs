// SIX KEY CASES IN THE PACKAGED SHELL — the comparison that decides what is a game bug.
//
//   node tools/qa/electron-six-key-cases.mjs
//
// The brief: "Most of what I reported is Chrome eating keys: X closing tabs, Shift+X
// opening things, Shift+W reloading. The packaged app has no tabs and none of those
// shortcuts. Then re-verify the input work in Electron and tell me which symptoms survive
// there. My expectation is that most of them are Chrome and vanish, leaving one real bug."
//
// This is the Electron half of tools/qa/walk-six-key-cases.js. Both drivers call the SAME
// in-page instrument, src/debug/inputProbe.js — two copies of a measurement are two
// measurements, and the entire question here is browser-versus-desktop, which is
// meaningless if the numbers come from different code. The drivers differ only in how they
// reach the world (real menu vs seeded save) and how they press keys.
//
// The room: --clubhouse=pine-hills-v2 through the launch flag, which is the whole reason
// that flag exists. Before it, the greybox room was unreachable in the shell.
//
// WHAT NEITHER RUN CAN SHOW. Playwright presses keys through CDP in both runtimes, below
// the browser's shortcut layer, so neither file can reproduce "Chrome ate the key". What
// the pair CAN establish is whether the page-side chain behaves identically in both — and
// if it does, every surviving symptom is above the page, where the shell differs from the
// tab. That is the actual question.
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const OUT = path.resolve(process.env.QA_ELECTRON_OUT
  || path.join(ROOT, 'Designs', 'ProShop', 'Greybox', 'data'));
const executablePath = path.join(
  ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);
await fs.mkdir(OUT, { recursive: true });

const report = {
  what: 'six key cases, pointer-locked, in the packaged Electron shell',
  runtime: 'electron',
  consoleErrors: [],
  pageErrors: [],
  processErrors: [],
  variant: null,
  lock: null,
  probe: null,
  table: [],
  detail: [],
  findings: {},
  limitations: {
    cdpBypassesBrowserShortcuts: true,
    provesPageSideChain: true,
    canExhibitBrowserLevelSteal: false,
    canExhibitOsLevelSteal: false,
    shellHasNoTabShortcuts: true,
  },
  ok: false,
};

let app = null;
try {
  app = await electron.launch({
    executablePath,
    // --dev exposes the input probe (devSessionActive), --clubhouse picks the greybox room
    // with no address bar involved.
    args: ['.', '--dev', '--clubhouse=pine-hills-v2'],
    cwd: ROOT,
    timeout: 90_000,
  });
  app.process()?.stderr?.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message) report.processErrors.push(message.slice(0, 300));
  });
  const window = await app.firstWindow({ timeout: 90_000 });
  window.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 300)); });
  window.on('pageerror', (e) => report.pageErrors.push((e.stack || e.message).slice(0, 300)));

  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => window.__fw?.screen === 'menu', null, { timeout: 90_000 });
  await window.setViewportSize({ width: 1600, height: 900 }).catch(() => {});

  // The launch flag must actually have carried, or the rest of the run is about the wrong
  // room. Reported, not assumed.
  report.variant = await window.evaluate(() => ({
    launchArgs: window.fairwayNative?.launchArgs || null,
    probeAttached: !!window.__fw?.inputProbe,
  }));

  // A real first launch through the menu — the same route a player takes.
  await window.getByRole('button', { name: /New game/i }).click();
  await window.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = window.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await window.waitForFunction(
    () => window.__fw?.screen === 'game' && window.__fw?.scene3d?.walk?.isActive?.(),
    null, { timeout: 180_000 },
  );
  await window.waitForTimeout(3000);
  // A fresh campaign opens the guide overlay, and while it is up walk keys are swallowed —
  // the first Electron sweep ever run measured all four keys at zero for exactly this
  // reason. Dismiss it by its BUTTON: a blind Escape opens the pause menu instead, which
  // swallows everything and looks identical in the results.
  await window.getByRole('button', { name: /Hide the guide/i }).click({ timeout: 4000 }).catch(() => {});
  await window.waitForTimeout(800);

  report.variant = {
    ...report.variant,
    resolved: await window.evaluate(async () => {
      const walk = window.__fw?.scene3d?.walk;
      return {
        layoutVariantVisible: !!document.querySelector('canvas'),
        walkActive: !!walk?.isActive?.(),
        probeAttached: !!window.__fw?.inputProbe,
      };
    }),
  };
  if (!report.variant.resolved.probeAttached) {
    throw new Error('the input probe did not attach — devSessionActive() was false in the shell');
  }

  // Stand somewhere a strafe is unobstructed, re-applied before every case.
  const stance = () => window.evaluate(() => {
    const app2 = window.__fw;
    const walk = app2.scene3d.walk;
    const target = walk.state && 'x' in walk.state ? walk.state : walk;
    const ch = app2.scene3d.clubhouse?.();
    const spot = ch?.localToWorld ? ch.localToWorld(1.6, 1.2) : { x: target.x, z: target.z };
    target.x = spot.x;
    target.z = spot.z;
    target.yaw = Math.PI;
    target.pitch = 0;
    return { x: +target.x.toFixed(2), z: +target.z.toFixed(2) };
  });
  const stanceAt = await stance();
  await window.waitForTimeout(400);

  // Pointer lock: the preventDefault branch is gated on it, so an unlocked run measures a
  // different code path and is reported as a miss rather than passed.
  //
  // DEVTOOLS HAS TO GO FIRST. --dev opens DevTools detached, and a detached DevTools window
  // holds the OS focus — requestPointerLock is refused for an unfocused document. The first
  // run of this file reported lock:false and preventDefault:false on all six cases, which
  // reads exactly like "the shell does not swallow walk keys" and is in fact "the shell was
  // not the focused window". Close DevTools, focus the game window, then click.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return false;
    if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
    win.focus();
    win.moveTop();
    return true;
  }).catch(() => false);
  await window.waitForTimeout(700);
  report.focus = await window.evaluate(() => ({ documentHasFocus: document.hasFocus() }));
  await window.mouse.move(800, 450);
  await window.mouse.click(800, 450);
  const locked = await window.waitForFunction(
    () => document.pointerLockElement?.tagName === 'CANVAS', null, { timeout: 6000 },
  ).then(() => true).catch(() => false);
  report.lock = await window.evaluate(() => ({
    locked: !!document.pointerLockElement,
    lockedTag: document.pointerLockElement?.tagName || null,
  }));
  report.lock.engaged = locked && report.lock.lockedTag === 'CANVAS';

  report.probe = await window.evaluate(() => window.__fw.inputProbe.arm());
  const cases = await window.evaluate(() => window.__fw.inputProbe.cases.map((c) => ({ ...c })));

  for (const c of cases) {
    await stance();
    await window.waitForTimeout(150);
    await window.evaluate(() => window.__fw.inputProbe.beginCase());
    if (c.hold) await window.keyboard.down(c.hold);
    await window.keyboard.down(c.code);
    await window.waitForTimeout(320);
    const during = await window.evaluate(() => window.__fw.inputProbe.sample());
    await window.keyboard.up(c.code);
    if (c.hold) await window.keyboard.up(c.hold);
    await window.waitForTimeout(120);
    const row = await window.evaluate((label) => window.__fw.inputProbe.endCase(label), c.label);
    report.detail.push({ ...row, during, expectedCode: c.code, holdModifier: c.hold });
  }
  await window.evaluate(() => window.__fw.inputProbe.disarm());

  // Same reduction as the Chromium driver, and for the same reasons: select the keydown by
  // CODE (in a Shift+D case the first keydown is ShiftLeft), read defaultPrevented off the
  // last listener in the chain, and read the held set from the sample taken while the key
  // was still down.
  report.table = report.detail.map((r) => {
    const down = r.events.find((e) => e.type === 'keydown' && e.phase === 'window-capture' && e.code === r.expectedCode) || null;
    const bubbled = r.events.find((e) => e.type === 'keydown' && e.phase === 'window-bubble' && e.code === r.expectedCode) || null;
    const movement = r.moveIntent || {};
    const held = r.during?.heldKeys || r.heldDuringPress || null;
    return {
      case: r.case,
      key: down?.key ?? null,
      code: down?.code ?? null,
      modifiersReported: down?.modifiersReported ?? null,
      flags: down?.flags ?? null,
      isTrusted: down?.isTrusted ?? null,
      reachedPage: !!down,
      reachedWalkListener: !!bubbled,
      preventDefaultCalled: !!bubbled?.defaultPrevented,
      landedInHeldSet: Array.isArray(held) && !!down && held.includes(String(down.key).toLowerCase()),
      heldDuringPress: held,
      movementRan: (movement.movingFrames ?? 0) > 0,
      movementFramesWithIntent: movement.movingFrames ?? null,
      movementFramesObserved: movement.frames ?? null,
      movementWanted: movement.last ?? null,
      interactSecondaryCalls: r.interactSecondaryCalls,
      movedYd: r.movedYd,
      pointerLocked: r.pointerLocked,
      osModifiers: r.osModifiers,
    };
  });

  const byCase = Object.fromEntries(report.table.map((r) => [r.case, r]));
  const pair = (plain, shifted, field) => ({
    plain: byCase[plain]?.[field] ?? null,
    shifted: byCase[shifted]?.[field] ?? null,
    same: JSON.stringify(byCase[plain]?.[field] ?? null) === JSON.stringify(byCase[shifted]?.[field] ?? null),
  });
  report.findings = {
    pointerLockEngaged: !!report.lock.engaged,
    probeArmed: !!report.probe?.armed,
    secondaryWrapped: !!report.probe?.secondaryWrapped,
    launchFlagCarried: Array.isArray(report.variant?.launchArgs)
      && report.variant.launchArgs.includes('--fw-clubhouse=pine-hills-v2'),
    everyCaseReachedThePage: report.table.every((r) => r.reachedPage),
    everyCaseReachedTheWalkListener: report.table.every((r) => r.reachedWalkListener),
    everyCaseWasTrusted: report.table.every((r) => r.isTrusted),
    everyWalkVerbIsPreventDefaulted: report.table.every((r) => r.preventDefaultCalled),
    // The verdict must fail when the thing under test fails — see the same note in the
    // Chromium driver.
    everyMovementCaseMoved: ['D alone', 'Shift+D', 'W alone', 'Shift+W']
      .every((label) => byCase[label]?.movementRan === true),
    everySecondaryCaseFired: ['X alone', 'Shift+X']
      .every((label) => (byCase[label]?.interactSecondaryCalls || 0) > 0),
    shiftChangesD: {
      delivery: pair('D alone', 'Shift+D', 'reachedWalkListener'),
      preventDefault: pair('D alone', 'Shift+D', 'preventDefaultCalled'),
      heldSet: pair('D alone', 'Shift+D', 'landedInHeldSet'),
      movementRan: pair('D alone', 'Shift+D', 'movementRan'),
      direction: pair('D alone', 'Shift+D', 'movementWanted'),
    },
    shiftChangesW: {
      delivery: pair('W alone', 'Shift+W', 'reachedWalkListener'),
      preventDefault: pair('W alone', 'Shift+W', 'preventDefaultCalled'),
      heldSet: pair('W alone', 'Shift+W', 'landedInHeldSet'),
      movementRan: pair('W alone', 'Shift+W', 'movementRan'),
      direction: pair('W alone', 'Shift+W', 'movementWanted'),
    },
    shiftChangesX: {
      delivery: pair('X alone', 'Shift+X', 'reachedWalkListener'),
      preventDefault: pair('X alone', 'Shift+X', 'preventDefaultCalled'),
      secondary: pair('X alone', 'Shift+X', 'interactSecondaryCalls'),
    },
  };
  report.ok = report.findings.pointerLockEngaged
    && report.findings.probeArmed
    && report.findings.secondaryWrapped
    && report.findings.launchFlagCarried
    && report.findings.everyCaseReachedThePage
    && report.findings.everyCaseReachedTheWalkListener
    && report.findings.everyWalkVerbIsPreventDefaulted
    && report.findings.everyMovementCaseMoved
    && report.findings.everySecondaryCaseFired
    && report.pageErrors.length === 0;
} catch (error) {
  report.error = (error?.stack || String(error)).slice(0, 1200);
} finally {
  await app?.close().catch(() => {});
}

await fs.writeFile(path.join(OUT, 'six-key-cases-electron.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

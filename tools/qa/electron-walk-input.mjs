// ELECTRON WALK-INPUT — the first Band-A acceptance inside the shipped desktop
// shell (HARNESS_TRUST.md rule 13). Until this file, the Electron build's
// instruments stopped at the main menu: nothing ever walked in the shell every
// player actually runs. This boots a REAL fresh empire through the menu (no
// dev server, no in-page /src imports — both die under file://), then proves:
//
//   1. W/A/S/D through genuine keydown/keyup move the player along the correct
//      axes (the walk-input-parity claim, in the desktop shell),
//   2. a canvas click engages pointer lock in the shell (recorded and gated —
//      mouse-look's entire input path depends on it).
//
//   node tools/qa/electron-walk-input.mjs
//
// Same viewport and verdict shape as tools/qa/walk-input-parity.js so the two
// results are directly comparable browser-vs-desktop.
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const OUT = path.resolve(process.env.QA_ELECTRON_OUT || path.join(ROOT, 'qa', 'integration', 'electron-walk-input'));
const executablePath = path.join(
  ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);
await fs.mkdir(OUT, { recursive: true });

const report = {
  consoleErrors: [],
  pageErrors: [],
  processErrors: [],
  lockEngaged: null,
  rows: [],
  verdicts: [],
};

let app = null;
try {
  app = await electron.launch({ executablePath, args: ['.'], cwd: ROOT, timeout: 60_000 });
  app.process()?.stderr?.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message) report.processErrors.push(message);
  });
  const window = await app.firstWindow({ timeout: 60_000 });
  window.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text().slice(0, 300));
  });
  window.on('pageerror', (error) => report.pageErrors.push((error.stack || error.message).slice(0, 300)));

  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => window.__fw?.screen === 'menu', null, { timeout: 60_000 });
  await window.setViewportSize({ width: 1600, height: 900 }).catch(() => {});

  // A genuinely fresh empire through the real menu — the same route a first
  // desktop launch takes.
  await window.getByRole('button', { name: /New game/i }).click();
  await window.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = window.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await window.waitForFunction(
    () => window.__fw?.screen === 'game' && window.__fw?.scene3d?.walk?.isActive?.(),
    null, { timeout: 120_000 },
  );
  await window.waitForTimeout(2500);
  // A fresh campaign opens the guide overlay; while it is up, walk keys are
  // swallowed (first Electron run measured all four keys at 0 movement). Only
  // the button click — a blind Escape here opens the PAUSE menu and the later
  // lock-engagement click lands on the overlay instead of the canvas.
  await window.getByRole('button', { name: /Hide the guide/i }).click({ timeout: 3000 }).catch(() => {});
  await window.waitForTimeout(600);

  // Pointer lock in the shell: the entire mouse-look path gates on it.
  await window.mouse.move(800, 450);
  await window.mouse.click(800, 450);
  report.lockEngaged = await window.waitForFunction(
    () => document.pointerLockElement?.tagName === 'CANVAS', null, { timeout: 5000 },
  ).then(() => true).catch(() => false);
  // Keep the lock held for the sweep — walk keys work under pointer lock, and
  // an Escape here opens the PAUSE MENU, which swallows every key (the
  // chain-3c run measured exactly that: lock true, all four keys at 0).

  // The walk-input sweep, at the arrival spawn (open ground), yaw zeroed so the
  // W/A/S/D axis mapping is deterministic: W → -z, A → -x, S → +z, D → +x.
  const expected = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };
  const spawn = await window.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: w.x, z: w.z };
  });
  report.spawn = spawn;
  for (const key of ['w', 'a', 's', 'd']) {
    const before = await window.evaluate((origin) => {
      const w = window.__fw.scene3d.walk.state;
      w.x = origin.x;
      w.z = origin.z;
      w.yaw = 0;
      w.pitch = 0;
      return { x: w.x, z: w.z };
    }, spawn);
    await window.waitForTimeout(120);
    await window.keyboard.down(key);
    await window.waitForTimeout(600);
    await window.keyboard.up(key);
    await window.waitForTimeout(150);
    const after = await window.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      return { x: w.x, z: w.z };
    });
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const [ex, ez] = expected[key];
    const moved = Math.hypot(dx, dz);
    const alongExpected = dx * ex + dz * ez;
    report.rows.push({ key, dx: +dx.toFixed(3), dz: +dz.toFixed(3) });
    report.verdicts.push({
      key,
      moved: +moved.toFixed(3),
      ok: moved > 0.25 && alongExpected > 0.8 * moved,
    });
  }

  await window.screenshot({ path: path.join(OUT, 'electron-walk-input.png'), animations: 'disabled' });
  report.pass = report.verdicts.every((verdict) => verdict.ok)
    && report.lockEngaged === true
    && report.pageErrors.length === 0;
} catch (error) {
  report.processErrors.push(error.stack || error.message);
  report.pass = false;
} finally {
  await app?.close().catch(() => {});
}

await fs.writeFile(path.join(OUT, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;

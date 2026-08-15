// A3 — the ladder is gone, measured live. The goal asks for the day length
// as a MEASURED number ("report what the day length is now and how long a
// full trading day takes in real minutes"), the old keys dead, and legacy
// saves clamped — each with a control.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a3-speed');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  await page.bringToFront().catch(() => {});

  const out = { errs };
  out.hudGlyph = await page.evaluate(() => {
    const chip = document.querySelector('.hud-clock, [class*="clock"]');
    return chip ? chip.textContent.slice(0, 60) : null;
  });
  await page.screenshot({ path: path.join(OUT, 'hud.png') });

  // MEASURE the clock rate at the one speed, over 45 real seconds
  const rate = await page.evaluate(() => new Promise((resolve) => {
    const app = window.__fw;
    app.speedIdx = 1;
    const m0 = app.state.clock.minutes;
    const t0 = performance.now();
    setTimeout(() => {
      const gameMin = app.state.clock.minutes - m0;
      const realSec = (performance.now() - t0) / 1000;
      resolve({ gameMin: +gameMin.toFixed(2), realSec: +realSec.toFixed(1) });
    }, 45000);
  }));
  out.rate = rate;
  const gameMinPerRealSec = rate.gameMin / rate.realSec;
  out.measured = {
    gameMinPerRealSec: +gameMinPerRealSec.toFixed(4),
    fullCalendarDayRealMin: +((1440 / gameMinPerRealSec) / 60).toFixed(1),
    tradingWindowRealMin: +((840 / gameMinPerRealSec) / 60).toFixed(1),
  };

  // the old keys are DEAD: rate unchanged across '2'/'3' presses, and the
  // pause key still works (the control that proves the key probe can see a
  // key that DOES something)
  await page.keyboard.press('2');
  await page.keyboard.press('3');
  const after = await page.evaluate(() => new Promise((resolve) => {
    const app = window.__fw;
    const m0 = app.state.clock.minutes;
    setTimeout(() => resolve({
      speedIdx: app.speedIdx,
      gameMin10s: +(app.state.clock.minutes - m0).toFixed(2),
    }), 10000);
  }));
  out.afterOldKeys = after;
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  out.pausedByBoundSpace = await page.evaluate(() => window.__fw.speedIdx === 0);
  const pausedDrift = await page.evaluate(() => new Promise((resolve) => {
    const m0 = window.__fw.state.clock.minutes;
    setTimeout(() => resolve(+(window.__fw.state.clock.minutes - m0).toFixed(3)), 4000);
  }));
  out.pausedDrift = pausedDrift;
  await page.keyboard.press(' ');

  // LEGACY SAVE CLAMP through a real reload: plant rung 4, save, reload,
  // Continue — the deserializer must hand back 1.
  await page.evaluate(() => { window.__fw.state.golfDay.speedRung = 4; });
  await page.evaluate(() => window.__fw.handlers?.saveNow?.() ?? null);
  await page.waitForTimeout(2500); // autosave cadence backstop
  await page.reload();
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(1500);
  out.rungAfterReload = await page.evaluate(() => window.__fw.state.golfDay.speedRung);

  const expected = 4 / 30; // the day-compression constant, for reference only
  out.checks = {
    clockRunsAtOneSpeed: Math.abs(gameMinPerRealSec - expected) / expected < 0.06,
    oldKeysDead: after.speedIdx === 1 && after.gameMin10s > 0.8,
    spaceStillPauses: out.pausedByBoundSpace === true && pausedDrift === 0,
    legacyRungClamped: out.rungAfterReload === 1,
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'a3.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

// POINT-LIGHT PAD — THE FOUR-STATE PIXEL A/B. Zero-intensity padding must
// change NOTHING visually in any state the day walks through. Per state:
// shot with the pad ON, shot with the pad KILLED (__FW_DISABLE_POINT_LIGHT_PAD),
// then ON again — the on/on pair is that state's ambient noise floor, and
// the on/off diff must sit at or under it. Pad diagnostics are read per
// state so the pad's own arithmetic (padsOn = target - real) is on record.
//
//   node tools/qa/run-electron.cjs tools/qa/goal-pad-pixel-ab.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/ownerplay/pad-ab');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], states: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);
  await boot.ownerResolution(page, page.electronApp);

  const setClock = (h, m = 0) => page.evaluate(({ h, m }) => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + h * 60 + m;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0; // stillness for the pixel pair; the arrivals sweep runs live
  }, { h, m });
  const setPad = (on) => page.evaluate((v) => { globalThis.__FW_DISABLE_POINT_LIGHT_PAD = !v; }, on);
  const padDiag = () => page.evaluate(() => window.__fw.scene3d.pointLightPadDiagnostics?.() || null);

  const shoot = async (file) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, file) });
  };

  const visitState = async (name, setup) => {
    await page.evaluate(setup);
    await page.waitForTimeout(2000);
    await setPad(true);
    await shoot(`${name}-on1.png`);
    const diag = await padDiag();
    await setPad(false);
    await shoot(`${name}-off.png`);
    await setPad(true);
    await shoot(`${name}-on2.png`);
    out.states.push({ name, padDiag: diag });
  };

  // dawn walk — the boot state as-is
  await visitState('dawn-walk', () => {});
  // overview — the real Tab
  await page.evaluate(() => {});
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(400);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(2500);
  await visitState('overview', () => {});
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1500);
  // night
  await setClock(23, 0);
  await visitState('night-2300', () => {});
  // trading morning
  await setClock(10, 0);
  await visitState('morning-1000', () => {});

  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(OUT, 'pad-ab-meta.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

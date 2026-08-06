// ITEM 11 — "Q reveal invisible while brooming, exactly when I need it."
//
// The reveal's alpha is the whole claim, and the walk controller reports it in
// dirtSense(). Four states, measured:
//
//   idle,  Q up      alpha ~0        (nothing asked for)
//   idle,  Q held    alpha -> 1      (the control: the reveal works at all)
//   sweep, Q held    alpha -> 1      (THE ITEM: it must survive working)
//   sweep, Q up      alpha -> 0      (working still cancels the linger)
//
// The third line is the fix; the second and fourth are what stop the third
// meaning nothing. If Q-held-at-idle did not light, "it lights while sweeping"
// would be measuring a stuck value; if sweeping-with-Q-up did not fall, the
// reveal would simply be on forever and the item would be "fixed" by breaking
// the cancel.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/dirt-sense');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const W = 1600; const H = 900;

  await page.setViewportSize({ width: W, height: H });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3200);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = -0.42;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
  });
  await page.mouse.click(W / 2, H / 2);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForFunction(() => window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive === true,
    null, { timeout: 30000 });
  await page.waitForTimeout(2400);

  const sense = () => page.evaluate(() => {
    const s = window.__fw.scene3d.walk.dirtSense();
    return { alpha: s?.alpha ?? null, clusters: s?.overlay?.clusters ?? null, tool: s?.tool ?? null };
  });
  const sweep = (on) => page.evaluate((v) => window.__fw.scene3d.walk.setSpraying(v), on);
  const holdQ = async () => { await page.keyboard.down('q'); };
  const releaseQ = async () => { await page.keyboard.up('q'); };

  // settle to a known floor
  await page.waitForTimeout(1200);
  const idleQUp = await sense();

  await holdQ();
  await page.waitForTimeout(1400);
  const idleQHeld = await sense();
  await page.screenshot({ path: path.join(OUT, '01-idle-q-held.png') });

  // THE ITEM: keep Q down and start sweeping
  await sweep(true);
  await page.waitForTimeout(1800);
  const sweepQHeld = await sense();
  await page.screenshot({ path: path.join(OUT, '02-sweeping-q-held.png') });

  // and working with Q up must still cancel it
  await releaseQ();
  await page.waitForTimeout(1600);
  const sweepQUp = await sense();
  await page.screenshot({ path: path.join(OUT, '03-sweeping-q-up.png') });
  await sweep(false);

  const checks = {
    thereIsDirtToFind: (idleQHeld.clusters ?? 0) > 0,
    revealWorksAtIdle: (idleQHeld.alpha ?? 0) > 0.6,
    idleFloorIsLow: (idleQUp.alpha ?? 1) < 0.2,
    // ITEM 11
    revealSurvivesSweeping: (sweepQHeld.alpha ?? 0) > 0.6,
    // and the cancel still works when it should
    workingStillCancelsIt: (sweepQUp.alpha ?? 1) < 0.2,
    broomIsTheHeldTool: idleQHeld.tool === 'broom',
    noPageErrors: errs.length === 0,
  };
  const out = { idleQUp, idleQHeld, sweepQHeld, sweepQUp, errs: errs.slice(0, 8), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'dirt-sense.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

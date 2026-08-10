// C5 — DO THE Q MARKERS FOLLOW THE PLAYER INTO THE REGISTER?
//
// Repro from the brief (image 6): hold a tool, hold Q, click the register.
// The tool leaves; the blue markers stay lit behind the till UI.
//
// Mechanism under test: the per-frame stationOpen zeroing lives in the WALK
// update; if that update stops when the register takes the camera, nobody
// ever writes alpha 0 and the last-lit markers freeze on screen.
//
// Sequence: equip broom -> hold Q (real key) -> confirm reveal alive ->
// register.enter() with Q still held (the user's exact shape) -> read
// diagnostics + screenshot. FIXED = alpha 0 and no reveal layer visible while
// the till is up, and the reveal comes back after leaving only if Q is still
// held. Watched FAIL on the unfixed build first.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-c5-reveal-into-register.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c5-reveal-into-register');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(3000);

  // Stand at the till, holding the broom.
  await page.evaluate(async () => {
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const c = app.scene3d.clubhouse();
    const w = app.scene3d.walk;
    const off = c.interior.position;
    app.speedIdx = 0;
    w.clearKeys();
    w.state.x = REGISTER.stand.x + off.x;
    w.state.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    w.state.yaw = Math.atan2(-dx / h, -dz / h);
    w.state.pitch = Math.atan2(1.18 - 1.62, h);
    w.setTool('broom');
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1200);

  const diag = () => page.evaluate(() => {
    const c = window.__fw.scene3d.clubhouse();
    return { ...c.dirtSenseDiagnostics(), registerActive: !!c.register.isActive() };
  });

  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(700);
  out.holdingQ = await diag();

  // The user's shape: Q still held when the register takes over.
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.enter(); });
  await page.waitForTimeout(900);
  out.inRegisterQHeld = await diag();
  const canvas = await page.$('#game');
  await (canvas || page).screenshot({ path: path.join(OUT, 'in-register.png') });

  await page.keyboard.up('KeyQ');
  await page.waitForTimeout(600);
  out.inRegisterQReleased = await diag();

  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.leave({ restorePointer: false }); });
  await page.waitForTimeout(600);
  out.afterLeave = await diag();

  out.verdict = {
    revealAliveBeforeEntry: out.holdingQ.alpha > 0.05,
    // The defect: any reveal alpha surviving while the till is active.
    FAILS_markersSurviveTill: out.inRegisterQHeld.alpha > 0.002 || out.inRegisterQReleased.alpha > 0.002,
    pass: null,
  };
  out.verdict.pass = out.verdict.revealAliveBeforeEntry && !out.verdict.FAILS_markersSurviveTill;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('C5-REVEAL', JSON.stringify(out.verdict), 'held:', JSON.stringify({ before: out.holdingQ.alpha, inQHeld: out.inRegisterQHeld.alpha, inQUp: out.inRegisterQReleased.alpha, after: out.afterLeave.alpha }));
}

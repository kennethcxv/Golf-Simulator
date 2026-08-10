// E1 — THE BROOM'S GRIP, TUNED WITH THE LIVE OVERLAY API AND EYES.
//
// Three complaints in one image: one hand (support socket reversed per Goal
// 18), the hand reading low/backwards on the shaft, the head edge-on. The
// head angle is frame.yaw in BROOM_FEEL ("turned so the head clears LEFT") —
// this driver applies candidate yaw values through the same
// toolFeelApplyOverrides the tuning overlay uses, screenshots each at the
// fixed pose, and the picked value gets BAKED into the feel file with the
// number reported. No guessed numbers.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-e1-broom-grip.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/e1-broom-grip');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = -0.15;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.speedIdx = 0;
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
    w.setTool('broom');
  });
  await page.waitForFunction(() => window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive === true, null, { timeout: 30000 });
  await page.waitForTimeout(2500);

  const CANDS = [
    { name: 'yaw-022-baseline', value: 0.22 },
    { name: 'yaw-010', value: 0.10 },
    { name: 'yaw-002', value: 0.02 },
    { name: 'yaw-neg006', value: -0.06 },
  ];
  const canvas = await page.$('#game');
  for (const c of CANDS) {
    const applied = await page.evaluate((v) => window.__fw.scene3d.walk.toolFeelSet?.('broom', 'frame.yaw', v), c.value);
    await page.waitForTimeout(900);
    await (canvas || page).screenshot({ path: path.join(OUT, `${c.name}.png`) });
    console.log('candidate', c.name, 'applied:', applied);
  }
  const diag = await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics?.() || null);
  console.log('E1-GRIP', JSON.stringify({ twoHanded: diag?.twoHanded ?? diag?.leftArmVisible ?? 'see screenshots', vmActive: diag?.vmActive }));
}

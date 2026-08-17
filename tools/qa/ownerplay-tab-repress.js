// TAB-BACK MOVEMENT — is the held W eaten by the transition (release and
// re-press required)? Measures movement latency for BOTH shapes.
//   node tools/qa/run-electron.cjs tools/qa/ownerplay-tab-repress.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(8000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(500);

  const pos = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    return { x: w.state.x, z: w.state.z };
  });
  const movedWithin = async (ms) => {
    const start = await pos();
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const p = await pos();
      if (Math.hypot(p.x - start.x, p.z - start.z) > 0.08) return Date.now() - t0;
      await page.waitForTimeout(60);
    }
    return -1;
  };

  const snap = (label) => page.evaluate((l) => ({
    label: l,
    mode: window.__fw.courseMode,
    walkActive: window.__fw.scene3d.walk?.isActive?.() || false,
    lock: !!document.pointerLockElement,
    focused: document.activeElement ? `${document.activeElement.tagName}.${String(document.activeElement.className).slice(0, 30)}` : null,
  }), label);

  out.beforeTab = await snap('beforeTab');
  // shape A: W held from BEFORE Tab-back, straight through it
  await page.keyboard.press('Tab');
  await page.waitForTimeout(2500);
  out.inOverview = await snap('inOverview');
  await page.keyboard.down('w');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600);
  out.afterTabBack = await snap('afterTabBack');
  out.heldThroughMs = await movedWithin(4000);
  await page.keyboard.up('w');
  await page.waitForTimeout(400);

  // shape B: release, then RE-press after the transition
  await page.keyboard.down('w');
  out.repressMs = await movedWithin(4000);
  await page.keyboard.up('w');

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.resolve('qa/ownerplay/tab-repress.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

// G (Goal 19) — WHAT SHARE OF THE RENDER SUBMIT IS THE MATRIX WALK?
//
// Before freezing 2,208 interior objects (and risking every animated one),
// measure: wrap scene.updateMatrixWorld and renderer.render for 300 frames
// indoors, and report the walk's share of the whole submit. The freeze only
// happens if the number says it is worth the risk.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-g-matrix-share.js --clubhouse=pine-hills-v2
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  const out = await page.evaluate(() => new Promise((resolve) => {
    const app = window.__fw;
    const scene = app.scene3d.scene || app.scene3d.camera.parent;
    // find the scene through the renderer if not exposed
    const renderer = app.scene3d.renderer;
    const target = scene && scene.isScene ? scene : null;
    const counts = { objects: 0, interior: 0 };
    const ch = app.scene3d.clubhouse();
    if (target) target.traverse(() => { counts.objects += 1; });
    ch.interior.traverse(() => { counts.interior += 1; });

    let walkMs = 0;
    let frames = 0;
    const origUMW = (target || ch.interior).updateMatrixWorld;
    const host = target || ch.interior;
    host.updateMatrixWorld = function wrapped(...args) {
      const t0 = performance.now();
      const r = origUMW.apply(this, args);
      walkMs += performance.now() - t0;
      return r;
    };
    const t0 = performance.now();
    const tick = () => {
      frames += 1;
      if (frames < 300) { requestAnimationFrame(tick); return; }
      host.updateMatrixWorld = origUMW;
      const wall = performance.now() - t0;
      resolve({
        sceneFound: !!target,
        objects: counts.objects,
        interiorObjects: counts.interior,
        frames,
        wallMs: +wall.toFixed(0),
        walkMsTotal: +walkMs.toFixed(1),
        walkMsPerFrame: +(walkMs / frames).toFixed(3),
        renderer: renderer ? renderer.info.render.calls : null,
      });
    };
    requestAnimationFrame(tick);
  }));
  console.log('G-MATRIX', JSON.stringify(out));
}

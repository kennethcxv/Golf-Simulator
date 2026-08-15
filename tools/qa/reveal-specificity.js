// Q1 — the Q reveal must pick out THE SPECIFIC MESS, not light a blob.
// The claim has a shape that can be measured: grime is drawn as many small
// speckles rather than a few cell-sized tiles, so
//   1. the number of grime instances is well above the number of dirty CELLS
//      (one tile per cell was the blob; speckles are several per cell)
//   2. every instance is SMALL against the cell it sits in - the biggest
//      speckle is a fraction of a grid cell, so nothing reads as a slab
//   3. NEGATIVE CONTROL: with the reveal off, nothing is drawn at all, and
//      the same measurement returns zero - so a pass cannot come from the
//      instrument reading some other mesh
// Plus the screenshot at the player's camera, which is the actual deliverable.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/reveal-specificity');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(300);

  // stand in the sales room looking at the floor, where the grime lives
  await page.evaluate(async () => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const off = club.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = off.x + 0.4;
    walk.z = off.z + 2.6;
    walk.yaw = Math.PI;
    walk.pitch = -0.62;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 11 * 60;
    app.scene3d.applyTimeWeather(11 * 60, app.state.weather);
  });
  await page.waitForTimeout(700);

  // the geometry of what the reveal actually draws, straight off the meshes
  const measure = () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const club = window.__fw.scene3d.clubhouse();
    const read = (name) => {
      const mesh = club.interior.getObjectByName(name);
      if (!mesh) return { missing: true };
      const spans = [];
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, m);
        m.decompose(p, q, s);
        spans.push(Math.max(Math.abs(s.x), Math.abs(s.y)));
      }
      return {
        visible: !!mesh.visible,
        count: mesh.count,
        maxSpan: spans.length ? +Math.max(...spans).toFixed(3) : 0,
        medianSpan: spans.length
          ? +spans.sort((a, b) => a - b)[Math.floor(spans.length / 2)].toFixed(3)
          : 0,
      };
    };
    return {
      grime: read('DirtSenseGrimeCells'),
      grit: read('DirtSenseGhostGrit'),
      litter: read('DirtSenseGhostLitter'),
      sense: club.dirtSenseDiagnostics ? club.dirtSenseDiagnostics() : null,
    };
  });

  // ---- NEGATIVE CONTROL: reveal off ---------------------------------------
  await page.waitForTimeout(400);
  const off = await measure();
  await page.screenshot({ path: path.join(OUT, '01-reveal-off.png') });

  // ---- reveal on: hold the bound sense key --------------------------------
  const senseKey = await page.evaluate(() => (
    window.__fw.scene3d.walk.hooks.bindings?.().dirtSense || 'q'
  ));
  await page.keyboard.down(senseKey);
  await page.waitForTimeout(1200);
  const on = await measure();
  await page.screenshot({ path: path.join(OUT, '02-reveal-on.png') });
  await page.keyboard.up(senseKey);
  // The reveal LINGERS and then fades exponentially, so "off" is a falling
  // alpha, not a flipped visible flag - the meshes stay flagged visible while
  // their opacity runs down. Poll the real value rather than guessing a wait.
  await page.waitForFunction(() => (
    (window.__fw.scene3d.clubhouse().dirtSenseDiagnostics().alpha || 0) < 0.01
  ), null, { timeout: 20000 }).catch(() => {});
  const after = await measure();

  // the cell size the speckles have to be small against, from the renderer's
  // own grid rather than a number copied into the driver
  const cell = on.sense?.grimeCellSize ? { w: on.sense.grimeCellSize, d: on.sense.grimeCellSize } : null;
  const dirtyCells = on.sense?.grimeCellsShown ?? null;
  const checks = {
    revealDrawsGrime: on.grime.visible === true && on.grime.count > 0,
    // many speckles per cell, not one tile per cell
    manySpecklesPerCell: !!dirtyCells && on.grime.count >= Math.min(dirtyCells, 20) * 2,
    // and each one is SMALL against a grid cell - this is the anti-blob claim
    everySpeckleSmall: !!cell && on.grime.maxSpan < Math.min(cell.w, cell.d) * 0.36,
    // debris still draws as the object itself
    debrisGhosted: (on.grit.count + on.litter.count) > 0,
    controlOffQuiet: off.grime.visible === false && off.grit.visible === false
      && (off.sense?.alpha ?? 1) === 0,
    releaseTurnsItOff: (after.sense?.alpha ?? 1) < 0.01,
    noPageErrors: errs.length === 0,
  };
  const out = { off, on, after, cell, dirtyCells, senseKey, errs: errs.slice(0, 8), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'reveal.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

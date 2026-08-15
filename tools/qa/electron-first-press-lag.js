// ROUND 4 — "the game is a bit glitchy with first time button presses":
// first cashier E, first check-in, first ledger page turn, bottle -> dustpan.
//
// One driver, every gesture he named, each timed with the renderer's program
// count beside it. The program delta is what separates "this frame compiled
// shaders" (fixable by warming) from "this frame did expensive work" (not).
//
//   node tools/qa/run-electron.cjs tools/qa/electron-first-press-lag.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/first-press');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], label: process.env.LABEL || 'current' };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  // Give any post-veil warm time to run before measuring: the whole point of
  // the warm is what the player feels AFTER it, so measuring during it would
  // fail an intervention that works.
  await page.waitForTimeout(6000);

  const canvas = await page.$('#game') || await page.$('canvas');
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(500);

  const start = () => page.evaluate(() => {
    window.__t = [];
    window.__tStop = false;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__t.push(+(now - last).toFixed(1));
      last = now;
      if (!window.__tStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const stop = () => page.evaluate(() => { window.__tStop = true; return window.__t; });
  // Programs alone cannot tell a shader compile from a texture upload, and the
  // two need different warms. renderer.info.memory counts what has been
  // REALIZED on the GPU, so a first-use spike that moves `textures` is an
  // upload and one that moves `programs` is a compile.
  const counters = () => page.evaluate(() => {
    const info = window.__fw?.scene3d?.renderer?.info;
    return {
      programs: info?.programs?.length ?? null,
      textures: info?.memory?.textures ?? null,
      geometries: info?.memory?.geometries ?? null,
    };
  });

  const gesture = async (label, run, settleMs = 2500) => {
    await start();
    await page.waitForTimeout(200);
    const before = await counters();
    await run();
    await page.waitForTimeout(settleMs);
    const dts = (await stop()).slice(1);
    const after = await counters();
    const row = {
      label,
      maxMs: dts.length ? +Math.max(...dts).toFixed(1) : null,
      programDelta: (after.programs ?? 0) - (before.programs ?? 0),
      textureDelta: (after.textures ?? 0) - (before.textures ?? 0),
      geometryDelta: (after.geometries ?? 0) - (before.geometries ?? 0),
    };
    out[label] = row;
    console.log('PRESS', JSON.stringify(row));
    return row;
  };

  // Did the deferred warm actually run, and how far did it get? Without this a
  // green run cannot be told from a run where the warm silently skipped.
  out.warmState = await page.evaluate(() => window.__fwWarm ?? null);
  console.log('WARM', JSON.stringify(out.warmState));

  // ---- bottle -> dustpan (the withdrawn warm's territory) ------------------
  await gesture('equipSpray', () => page.evaluate(() => window.__fw.scene3d.walk.setTool('spray')), 2000);
  await gesture('equipDustpan_first', () => page.evaluate(() => window.__fw.scene3d.walk.setTool('dustpan')), 3000);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
  await page.waitForTimeout(600);

  // ---- first cashier entry -------------------------------------------------
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const st = s3.walk.stations()[0];
    const w = s3.walk.state;
    w.x = st.x; w.z = st.z + 1.15;
    w.yaw = Math.atan2(-(st.x - w.x), -(st.z - w.z));
    w.pitch = -0.2; w.vx = 0; w.vz = 0;
  });
  await page.waitForTimeout(800);
  await gesture('cashierEnter_first', () => page.keyboard.press('e'), 3000);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave?.());
  await page.waitForTimeout(800);
  await gesture('cashierEnter_second', () => page.keyboard.press('e'), 2000);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave?.());
  await page.waitForTimeout(600);

  // ---- the ledger: raise, open, first page turn ----------------------------
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const r = ch.ledgerBook?.root;
    if (!r) return;
    r.updateWorldMatrix(true, false);
    const e = r.matrixWorld.elements;
    const w = window.__fw.scene3d.walk.state;
    const c = ch.interior.position;
    let dx = c.x - e[12]; let dz = c.z - e[14];
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    w.x = e[12] + dx * 1.9; w.z = e[14] + dz * 1.9; w.vx = 0; w.vz = 0;
    const lx = e[12] - w.x; const lz = e[14] - w.z;
    const h = Math.hypot(lx, lz) || 0.001;
    w.yaw = Math.atan2(-lx / h, -lz / h);
    const eye = window.__fw.scene3d?.camera?.position?.y;
    w.pitch = Math.atan2(e[13] - (Number.isFinite(eye) ? eye : 1.62), h);
  });
  await page.waitForTimeout(1000);
  await gesture('ledgerRaise', () => page.keyboard.press('k'), 2200);
  await gesture('ledgerOpen', () => page.keyboard.press('e'), 2600);
  await gesture('pageTurn_first', () => page.keyboard.press('e'), 2200);
  await gesture('pageTurn_second', () => page.keyboard.press('e'), 2000);

  const brief = (row) => (row ? {
    maxMs: row.maxMs, prog: row.programDelta, tex: row.textureDelta, geo: row.geometryDelta,
  } : null);
  out.summary = {
    label: out.label,
    warmState: out.warmState,
    dustpanFirst: brief(out.equipDustpan_first),
    cashierFirst: brief(out.cashierEnter_first),
    cashierSecond: brief(out.cashierEnter_second),
    ledgerRaise: brief(out.ledgerRaise),
    ledgerOpen: brief(out.ledgerOpen),
    pageTurnFirst: brief(out.pageTurn_first),
    pageTurnSecond: brief(out.pageTurn_second),
  };
  fs.writeFileSync(path.join(OUT, `press-${out.label}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log('FIRST-PRESS', JSON.stringify(out.summary, null, 2));
  return out;
}

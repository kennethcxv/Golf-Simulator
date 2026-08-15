// P2 (owner playtest) — "opening the book and pressing E to turn a page lags;
// first equip of the broom or mop lags heavily."
//
// MEASURE BEFORE TOUCHING ANYTHING. Both of these have been "fixed" before, and
// one of them (first equip) has a standing instruction in this project's notes
// not to attempt a seventeenth renderer.compile() configuration -- sixteen were
// measured and every one left the shader-program delta at +9. So the first job
// is honest current numbers, per gesture, on the real frame clock.
//
// FRAME TIME, NOT A SELF-REPORTED COST. The ledger's own paintStats says a turn
// costs 1.6 ms, and the owner still feels lag -- so the interesting number is
// the longest FRAME around the gesture, which catches texture uploads, shader
// links and anything else that lands outside the module's own accounting.
//
// The 33 ms bar is the brief's; 50 ms is the adversarial-review bar.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p2-lag-measure.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p2-lag');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  const canvas = await page.$('#game') || await page.$('canvas');
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(700);

  // A rolling frame-time recorder. Started before a gesture, read after, so the
  // window is exactly the gesture and not a 60-second average that buries a
  // single 2-second hitch under 3600 good frames.
  const startFrames = () => page.evaluate(() => {
    window.__p2 = [];
    window.__p2stop = false;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__p2.push(+(now - last).toFixed(2));
      last = now;
      if (window.__p2stop) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const stopFrames = () => page.evaluate(() => {
    window.__p2stop = true;
    const f = (window.__p2 || []).slice(1); // the first delta spans the start call
    if (!f.length) return null;
    const sorted = [...f].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    return {
      frames: f.length,
      max: +Math.max(...f).toFixed(1),
      p95: +pct(0.95).toFixed(1),
      median: +pct(0.5).toFixed(1),
      over33: f.filter((x) => x > 33).length,
      over50: f.filter((x) => x > 50).length,
      worstFive: [...sorted].slice(-5).map((x) => +x.toFixed(1)),
    };
  });

  const gesture = async (label, run, settleMs = 1800) => {
    await startFrames();
    await run();
    await page.waitForTimeout(settleMs);
    const stats = await stopFrames();
    out[label] = stats;
    console.log('P2', label, JSON.stringify(stats));
    return stats;
  };

  // ---- baseline: standing still, nothing happening -------------------------
  // Without this every number below is unanchored -- a 40 ms frame means one
  // thing on a machine that idles at 16 and another on one that idles at 35.
  await gesture('idleBaseline', async () => { await page.waitForTimeout(2500); }, 0);

  // ---- FIRST EQUIP, per tool, in order -------------------------------------
  // The tools the owner named. Each is measured as its OWN gesture so "first"
  // and "already warm" are separate numbers rather than one blended average.
  const equip = async (toolKey) => {
    await page.evaluate((k) => {
      const w = window.__fw.scene3d.walk;
      if (w.setTool) w.setTool(k);
      else if (w.hooks?.setTool) w.hooks.setTool(k);
    }, toolKey);
  };
  await gesture('equipBroom_first', () => equip('broom'), 2500);
  await gesture('equipMop_first', () => equip('mop'), 2500);
  await gesture('equipBroom_second', () => equip('broom'), 2000);
  await gesture('equipMop_second', () => equip('mop'), 2000);
  await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    if (w.setTool) w.setTool(null);
  });
  await page.waitForTimeout(800);

  // ---- THE LEDGER: open, then page turns -----------------------------------
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const r = ch?.ledgerBook?.root;
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
  await page.waitForTimeout(1200);

  await gesture('ledgerRaise', async () => { await page.keyboard.press('k'); }, 2200);
  await gesture('ledgerOpen_first', async () => { await page.keyboard.press('e'); }, 2600);
  // E turns the page once the book is open -- the owner's exact gesture
  await gesture('pageTurn_first', async () => { await page.keyboard.press('e'); }, 2000);
  await gesture('pageTurn_second', async () => { await page.keyboard.press('e'); }, 2000);
  await gesture('pageTurn_third', async () => { await page.keyboard.press('e'); }, 2000);

  const bad = (s) => !!s && s.max > 50;
  out.summary = {
    idleMedianMs: out.idleBaseline?.median ?? null,
    firstEquipBroomMaxMs: out.equipBroom_first?.max ?? null,
    firstEquipMopMaxMs: out.equipMop_first?.max ?? null,
    warmEquipBroomMaxMs: out.equipBroom_second?.max ?? null,
    warmEquipMopMaxMs: out.equipMop_second?.max ?? null,
    ledgerOpenMaxMs: out.ledgerOpen_first?.max ?? null,
    firstPageTurnMaxMs: out.pageTurn_first?.max ?? null,
    laterPageTurnMaxMs: Math.max(out.pageTurn_second?.max ?? 0, out.pageTurn_third?.max ?? 0),
    gesturesOver50ms: ['equipBroom_first', 'equipMop_first', 'equipBroom_second',
      'equipMop_second', 'ledgerRaise', 'ledgerOpen_first', 'pageTurn_first',
      'pageTurn_second', 'pageTurn_third'].filter((k) => bad(out[k])),
  };
  out.ok = out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'lag.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P2-LAG', JSON.stringify(out.summary, null, 2));
  return out;
}

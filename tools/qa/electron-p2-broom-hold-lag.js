// P2 (round 3) — "I got a lag spike when I moved forward and clicked with the
// broom to hold down."
//
// Distinct from the first-equip stall already measured (8 GL programs on the
// first frame that draws the hands). This is a spike on the first SWEEP: holding
// the trigger while walking, which is the first time the debris/dust effects,
// their materials and their instanced buffers are actually asked to draw.
//
// So the gesture is reproduced exactly: equip, walk forward, hold the button.
// Each stage is timed separately and the renderer's program count is sampled
// with it, because "this frame was long" and "this frame compiled six shaders"
// are different findings and only the second one names a cause.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p2-broom-hold-lag.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p2-broom-hold');
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
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(700);

  // Indoors, where the broom is used and where its dirt actually exists.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const w = window.__fw.scene3d.walk.state;
    const c = ch.interior.position;
    w.x = c.x; w.z = c.z; w.vx = 0; w.vz = 0;
  });
  await page.waitForTimeout(1500);

  const startTrace = () => page.evaluate(() => {
    window.__b = [];
    window.__bStop = false;
    let last = performance.now();
    const t0 = last;
    const tick = () => {
      const now = performance.now();
      window.__b.push({
        ms: +(now - t0).toFixed(1),
        dt: +(now - last).toFixed(1),
        programs: window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null,
      });
      last = now;
      if (!window.__bStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const readTrace = () => page.evaluate(() => {
    window.__bStop = true;
    return window.__b;
  });

  const stage = async (label, run, settleMs = 3000) => {
    await startTrace();
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null);
    await run();
    await page.waitForTimeout(settleMs);
    const trace = await readTrace();
    const after = await page.evaluate(() => window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null);
    const dts = trace.map((f) => f.dt);
    const row = {
      label,
      frames: trace.length,
      maxMs: +Math.max(...dts).toFixed(1),
      over100: dts.filter((d) => d > 100).length,
      over500: dts.filter((d) => d > 500).length,
      programsBefore: before,
      programsAfter: after,
      programDelta: (after ?? 0) - (before ?? 0),
    };
    out[label] = row;
    console.log('BROOM', JSON.stringify(row));
    return row;
  };

  const hold = async (ms) => {
    await page.mouse.down();
    // walk forward WHILE holding, which is the owner's gesture
    await page.keyboard.down('w');
    await page.waitForTimeout(ms);
    await page.keyboard.up('w');
    await page.mouse.up();
  };

  await stage('idle', async () => { await page.waitForTimeout(1500); }, 0);
  await stage('equipBroom', async () => {
    await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  }, 3500);
  await stage('walkOnly', async () => {
    await page.keyboard.down('w');
    await page.waitForTimeout(900);
    await page.keyboard.up('w');
  }, 1500);
  await stage('firstHoldSweep', () => hold(1400), 3500);
  await stage('secondHoldSweep', () => hold(1400), 2500);
  await stage('thirdHoldSweep', () => hold(1400), 2500);

  out.summary = {
    idleMaxMs: out.idle?.maxMs,
    equipMaxMs: out.equipBroom?.maxMs,
    equipPrograms: out.equipBroom?.programDelta,
    walkOnlyMaxMs: out.walkOnly?.maxMs,
    FIRST_SWEEP_MAX_MS: out.firstHoldSweep?.maxMs,
    firstSweepPrograms: out.firstHoldSweep?.programDelta,
    secondSweepMaxMs: out.secondHoldSweep?.maxMs,
    thirdSweepMaxMs: out.thirdHoldSweep?.maxMs,
    // the shape that matters: is the first sweep worse than the ones after it?
    firstSweepIsTheSpike:
      (out.firstHoldSweep?.maxMs ?? 0) > Math.max(out.secondHoldSweep?.maxMs ?? 0, out.thirdHoldSweep?.maxMs ?? 0) * 1.8,
  };
  out.ok = out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'broom.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P2-BROOM-HOLD', JSON.stringify(out.summary, null, 2));
  return out;
}

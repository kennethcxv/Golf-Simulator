// I3 — the look-up TRANSITION, watched, not measured.
//
// The numbers are already right (head anchored, cap engages, stow exits) and
// the complaint is about what the SEQUENCE looks like. This drives the pitch
// smoothly — a real pan, springs and lerps live, not settled samples — and
// captures a dense flip-book both ways:
//   up:   -0.40 → +1.35 over ~4.5 s   (frames up-NN.png)
//   down: +1.35 → -0.40 over ~4.5 s   (frames dn-NN.png)
// The judge is eyes on the frames. The driver's own checks are only the
// mechanical floor: rig active, live geometry, no page errors, and the
// working-range pose identical before/after any fix (structural, per review).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve(process.env.FLIPBOOK_OUT || 'qa/electron/broom-lookup-i3');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = -0.40;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    app.speedIdx = 0;
  });
  await page.mouse.click(640, 360);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForFunction(() => window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive === true,
    null, { timeout: 30000 });
  await page.waitForTimeout(2400);

  // a smooth pan: advance pitch a step at a time and let real frames render
  const pan = async (from, to, steps, tag) => {
    const rows = [];
    for (let i = 0; i <= steps; i += 1) {
      const p = from + (to - from) * (i / steps);
      await page.evaluate((pitch) => { window.__fw.scene3d.walk.state.pitch = pitch; }, p);
      await page.waitForTimeout(140); // ~7 fps flip-book; springs stay live
      if (i % 2 === 0) {
        const nn = String(i / 2).padStart(2, '0');
        await page.screenshot({ path: path.join(OUT, `${tag}-${nn}.png`) });
        const d = await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics());
        rows.push({
          frame: `${tag}-${nn}.png`,
          pitch: +p.toFixed(3),
          headAboveFloor: d.headAboveFloor,
          gripCapYd: d.gripCapYd,
          gripStowYd: d.gripStowYd,
          handNdcUpper: d.handNdcUpper,
          assetHeadNdc: d.assetHeadNdc,
        });
      }
    }
    return rows;
  };

  const up = await pan(-0.40, 1.35, 32, 'up');
  await page.waitForTimeout(400);
  const down = await pan(1.35, -0.40, 32, 'dn');

  const out = {
    up, down,
    errs: errs.slice(0, 8),
    checks: {
      rigActive: await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics().vmActive),
      liveGeom: await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics().geomSource) === 'live',
      noPageErrors: errs.length === 0,
    },
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'flipbook.json'), `${JSON.stringify(out, null, 1)}\n`);
  return { frames: up.length + down.length, checks: out.checks, ok: out.ok };
}

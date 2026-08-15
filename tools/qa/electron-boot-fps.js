// BOOT FRAMERATE — "I literally can't move around, it's so laggy on load."
//
// One number, taken the way he experiences it: frame times for a few seconds
// after the veil lifts, while walking. Reported as median/p95/worst and as an
// effective FPS, so "3 fps" is either confirmed or it is not.
//
// Also samples the renderer's own counters, because a frame-time number alone
// cannot say whether the cost is draw submission, geometry, or the simulation.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-boot-fps.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/boot-fps');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], label: process.env.FPS_LABEL || 'current' };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const t0 = Date.now();
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  out.msToPlayable = Date.now() - t0;
  await page.waitForTimeout(1200);

  const canvas = await page.$('#game') || await page.$('canvas');
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(500);

  const measure = async (label, seconds, act) => {
    await page.evaluate(() => {
      window.__f = [];
      window.__fStop = false;
      let last = performance.now();
      const t = performance.now();
      const tick = () => {
        const now = performance.now();
        const info = window.__fw?.scene3d?.renderer?.info;
        window.__f.push({
          ms: +(now - t).toFixed(1),
          dt: +(now - last).toFixed(2),
          calls: info?.render?.calls ?? null,
          tris: info?.render?.triangles ?? null,
          geometries: info?.memory?.geometries ?? null,
          textures: info?.memory?.textures ?? null,
          programs: info?.programs?.length ?? null,
        });
        last = now;
        if (!window.__fStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (act) await act();
    await page.waitForTimeout(seconds * 1000);
    const trace = await page.evaluate(() => { window.__fStop = true; return window.__f; });
    const dts = trace.slice(2).map((f) => f.dt).sort((a, b) => a - b);
    if (!dts.length) return { label, error: 'no frames' };
    const pick = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
    const last = trace[trace.length - 1] || {};
    const row = {
      label,
      frames: dts.length,
      medianMs: +pick(0.5).toFixed(2),
      p95Ms: +pick(0.95).toFixed(2),
      worstMs: +dts[dts.length - 1].toFixed(1),
      effectiveFps: +(1000 / pick(0.5)).toFixed(1),
      over100: dts.filter((d) => d > 100).length,
      drawCalls: last.calls ?? null,
      triangles: last.tris ?? null,
      geometries: last.geometries ?? null,
      textures: last.textures ?? null,
      programs: last.programs ?? null,
    };
    out[label] = row;
    console.log('FPS', JSON.stringify(row));
    return row;
  };

  await measure('standingStill', 4, null);
  await measure('walkingForward', 4, async () => { await page.keyboard.down('w'); });
  await page.keyboard.up('w');
  await measure('afterWalking', 3, null);

  out.summary = {
    label: out.label,
    msToPlayable: out.msToPlayable,
    standingFps: out.standingStill?.effectiveFps,
    walkingFps: out.walkingForward?.effectiveFps,
    standingMedianMs: out.standingStill?.medianMs,
    walkingMedianMs: out.walkingForward?.medianMs,
    walkingWorstMs: out.walkingForward?.worstMs,
    drawCalls: out.walkingForward?.drawCalls,
    triangles: out.walkingForward?.triangles,
    geometries: out.walkingForward?.geometries,
    UNPLAYABLE: (out.walkingForward?.effectiveFps ?? 60) < 25,
  };
  out.ok = out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, `fps-${out.label}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log('BOOT-FPS', JSON.stringify(out.summary, null, 2));
  return out;
}

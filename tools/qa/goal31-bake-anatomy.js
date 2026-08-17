// THE BAKE FRAME'S ANATOMY — what a 10 Hz shadow-bake frame actually spends,
// walking and standing, so the p95 lever is named before it is pulled. Per
// rAF frame: delta, full-frame draw calls (the loop resets info manually, so
// info.render.calls read after the frame is the WHOLE frame including the
// shadow pass), triangles, and whether the frame carried a bake
// (post.stats().shadowBakes delta — the perf-probe pattern).
//
// The verdict this feeds: if bake frames carry hundreds more draw CALLS, the
// lever is shadow-pass submission (casters); if calls are close and only the
// time spikes, the lever is raster (map size / span).
//
//   node tools/qa/run-electron.cjs tools/qa/goal31-bake-anatomy.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal31');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'bake-anatomy', errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);
  out.ownerRes = (await boot.ownerResolution(page, page.electronApp)).caption;
  await page.waitForTimeout(1000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const S = { rows: [], seg: 'walk', on: true };
    window.__bakeAnat = S;
    const info = window.__fw.scene3d.renderer.info;
    const stats = window.__fw.scene3d.post?.stats;
    let last = performance.now();
    let lastBakes = stats ? stats().shadowBakes : 0;
    const tick = (t) => {
      if (!S.on) return;
      const bakes = stats ? stats().shadowBakes : -1;
      S.rows.push({
        seg: S.seg,
        dt: +(t - last).toFixed(1),
        calls: info.render.calls,
        tris: info.render.triangles,
        bake: bakes !== lastBakes,
      });
      lastBakes = bakes;
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // segment 1: 20 s of real held-W walking with quarter turns
  await page.keyboard.down('w');
  for (let leg = 0; leg < 4; leg += 1) {
    await page.waitForTimeout(5000);
    await page.evaluate(() => {
      const w = window.__fw.scene3d.walk;
      if (w.state) w.state.yaw += Math.PI / 2;
    });
  }
  await page.keyboard.up('w');
  // segment 2: 8 s standing still
  await page.evaluate(() => { window.__bakeAnat.seg = 'stand'; });
  await page.waitForTimeout(8000);

  out.result = await page.evaluate(() => {
    const S = window.__bakeAnat;
    S.on = false;
    const stat = (rows) => {
      if (!rows.length) return null;
      const dts = rows.map((r) => r.dt).sort((a, b) => a - b);
      const at = (q) => +dts[Math.min(dts.length - 1, Math.floor(dts.length * q))].toFixed(1);
      const avg = (k) => +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(0);
      return {
        frames: rows.length,
        medianMs: at(0.5),
        p95Ms: at(0.95),
        worstMs: dts[dts.length - 1],
        avgCalls: avg('calls'),
        avgTris: avg('tris'),
      };
    };
    const seg = (name) => {
      const rows = S.rows.filter((r) => r.seg === name).slice(5);
      return {
        all: stat(rows),
        bakeFrames: stat(rows.filter((r) => r.bake)),
        plainFrames: stat(rows.filter((r) => !r.bake)),
      };
    };
    return { walk: seg('walk'), stand: seg('stand') };
  });

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, `${out.tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

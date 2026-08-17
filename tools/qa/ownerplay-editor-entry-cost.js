// EDITOR ENTRY COST — how long the main thread blocks across J, what
// arrives (programs/geometry/textures), on the fixed build with warms
// running and with them bailed. The owner's dead editor smells like one
// long entry block painting nothing over his last walk frame.
//
//   [QA_OWNERPLAY_NO_BAILOUT=1] node tools/qa/run-electron.cjs \
//     tools/qa/ownerplay-editor-entry-cost.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/ownerplay/editor');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'entry-cost';
  const out = { tag, noBailout: process.env.QA_OWNERPLAY_NO_BAILOUT === '1', errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  if (out.noBailout) await page.evaluate(() => { globalThis.__FW_PREWARM_NO_BAILOUT = true; });
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000);

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const w = window.__fw.scene3d?.walk;
    (w?.setToolImmediate || w?.setTool)?.call(w, 'spray');
  });
  await page.waitForTimeout(1200);

  // gap sampler + snapshot, then J
  await page.evaluate(() => {
    const S = { gaps: [], last: performance.now(), on: true };
    window.__ed = S;
    const info = window.__fw.scene3d.renderer.info;
    S.before = {
      p: info.programs?.length ?? -1,
      g: info.memory.geometries,
      t: info.memory.textures,
      keys: (info.programs || []).map((x) => String(x.cacheKey)),
    };
    const tick = () => {
      if (!S.on) return;
      const now = performance.now();
      const gap = now - S.last;
      if (gap > 100) S.gaps.push({ t: +now.toFixed(0), ms: +gap.toFixed(1) });
      S.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  await page.keyboard.press('j');
  // wait until a frame actually PAINTS the editor (mode set + one gap-free beat)
  await page.waitForFunction(() => window.__fw.courseMode === 'editor', null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  out.entry = await page.evaluate(() => {
    const S = window.__ed;
    S.on = false;
    const info = window.__fw.scene3d.renderer.info;
    const keys = (info.programs || []).map((x) => String(x.cacheKey));
    const B = new Set(S.before.keys);
    const fresh = keys.filter((k) => !B.has(k));
    const named = fresh.slice(0, 8).map((key) => {
      const f = key.split(',');
      let best = null;
      for (const oldKey of B) {
        const o = oldKey.split(',');
        if (o.length !== f.length) continue;
        const diffs = [];
        for (let i = 0; i < f.length && diffs.length <= 4; i += 1) {
          if (o[i] !== f[i]) diffs.push({ i, was: o[i], is: f[i] });
        }
        if (diffs.length && (!best || diffs.length < best.length)) best = diffs;
      }
      return { family: f[0]?.slice(0, 12), diffs: best };
    });
    return {
      arrivals: fresh.length,
      named,
      geometries: info.memory.geometries - S.before.g,
      textures: info.memory.textures - S.before.t,
      gapsOver100: S.gaps,
      worstMs: Math.max(0, ...S.gaps.map((g) => g.ms)),
    };
  });
  out.wallToEditorMs = Date.now() - t0;
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

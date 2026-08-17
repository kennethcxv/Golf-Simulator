// THE LAPTOP OPEN, PROFILED ON THE OWNER'S OWN SAVE SHAPE.
//
// D5 (2026-08-17) COLD VARIANT of goal32-laptop-owner-shape.js.
// The fresh-save profile run measured a CLEAN open (no longtask, 58.8 ms of
// thumbs) — so the owner's 3.5 s lives in his WORLD SHAPE, not the bare code
// path. This driver boots a profile seeded with a copy of his real autosave
// (822 KB: weeks of tx log, tee sheet, low-stock list) via the menu's own
// Continue, then brackets walk.hooks.openLaptop with the CDP sampling
// profiler, a longtask observer, and a per-SKU productThumb clock.
//
//   QA_ELECTRON_USER_DATA_DIR=<seeded dir> node tools/qa/run-electron.cjs \
//     tools/qa/goal32-laptop-owner-shape.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal32');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'laptop-owner-shape', errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  // COLD, which is the case D5 asks about: "the first open in a fresh session".
  // A brand new profile and a brand new game — no seeded save, no Continue.
  // Measured with ownerplay-laptop-cost.js on exactly this shape: 951 ms
  // bar-to-usable with arrivals 0, geometries 0, textures 0 and ONE 686 ms
  // main-thread longtask. So the remaining cold cost is not shaders and not
  // uploads, and this run exists to name the function inside that task.
  const how = await boot.clickThroughMenu(page, { forceNew: true });
  out.bootPath = how || null;
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000);

  out.saveShape = await page.evaluate(() => {
    const st = window.__fw.state || {};
    return {
      day: st.day ?? null,
      txLog: st.txLog?.length ?? null,
      notifications: st.notifications?.length ?? null,
      products: st.products ? Object.keys(st.products).length : null,
      sections: st.sections?.length ?? null,
    };
  });

  await page.evaluate(() => {
    window.__thumbTimes = [];
    const ch = window.__fw.scene3d.clubhouse?.();
    if (ch && typeof ch.productThumb === 'function') {
      const orig = ch.productThumb;
      ch.productThumb = (sku) => {
        const t0 = performance.now();
        const r = orig(sku);
        window.__thumbTimes.push({ id: sku?.id || null, ms: +(performance.now() - t0).toFixed(1) });
        return r;
      };
    }
  });

  let cdp = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
    await cdp.send('Profiler.start');
    out.profiler = 'cdp';
  } catch (e) {
    out.profiler = `unavailable: ${e.message}`;
  }

  await page.evaluate(() => {
    const S = { longtasks: [] };
    window.__lapProf = S;
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) S.longtasks.push({ t: +e.startTime.toFixed(0), ms: +e.duration.toFixed(0) });
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* profile still stands */ }
    S.openAt = performance.now();
    window.__fw.scene3d.walk.hooks.openLaptop?.(null);
  });
  await page.waitForFunction(() => document.body.classList.contains('laptop-mode'), null, { timeout: 30000 });
  await page.waitForTimeout(8000);

  if (cdp) {
    try {
      const { profile } = await cdp.send('Profiler.stop');
      const self = new Map();
      const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
      for (let i = 0; i < (profile.samples?.length || 0); i += 1) {
        const id = profile.samples[i];
        const dt = profile.timeDeltas?.[i] || 0;
        self.set(id, (self.get(id) || 0) + dt);
      }
      out.topSelf = [...self.entries()]
        .map(([id, us]) => {
          const n = nodeById.get(id);
          const f = n?.callFrame || {};
          return {
            selfMs: +(us / 1000).toFixed(1),
            fn: f.functionName || '(anonymous)',
            url: (f.url || '').split('/').slice(-2).join('/'),
            line: (f.lineNumber ?? -2) + 1,
          };
        })
        .filter((r) => r.selfMs >= 5)
        .sort((a, b) => b.selfMs - a.selfMs)
        .slice(0, 30);
      fs.writeFileSync(path.join(OUT, `${out.tag}-raw.json`), JSON.stringify(profile));
    } catch (e) {
      out.profiler = `stop failed: ${e.message}`;
    }
  }

  out.longtasks = await page.evaluate(() => {
    const S = window.__lapProf;
    return { openAt: +S.openAt.toFixed(0), tasks: S.longtasks.filter((t) => t.ms > 100) };
  });
  out.thumbTimes = await page.evaluate(() => window.__thumbTimes);
  out.thumbTotalMs = +(out.thumbTimes.reduce((a, t) => a + t.ms, 0)).toFixed(1);
  out.thumbCalls = out.thumbTimes.length;
  await page.screenshot({ path: path.join(OUT, 'laptop-owner-shape.png') });

  console.log(JSON.stringify({
    tag: out.tag,
    bootPath: out.bootPath,
    saveShape: out.saveShape,
    longtasks: out.longtasks,
    thumbCalls: out.thumbCalls,
    thumbTotalMs: out.thumbTotalMs,
    topSelf: (out.topSelf || []).slice(0, 12),
  }, null, 2));
  fs.writeFileSync(path.join(OUT, `${out.tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

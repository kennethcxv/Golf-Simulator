// THE LAPTOP LONGTASK, NAMED BY A REAL PROFILER — not by suspicion.
//
// Last session attributed the ~3.6 s post-bar block to "laptopUi.open()'s
// home render (search index suspect)". The code reading since says the search
// index is NOT on the open path at all (it builds per keystroke inside
// pageSearch, and open() lands on home with an empty query), so the suspect
// list is re-opened: productThumb's second WebGLRenderer + toDataURL chain,
// the tee-sheet derivation, or something unnamed. This driver ends the
// guessing: a CDP sampling profile brackets the exact open, and the answer is
// function names with self-times.
//
// Also carried in the same boot: the longtask observer (the headline number),
// and a timing wrap on clubhouse().productThumb so its share is a number even
// if the profiler's attribution is fragmented.
//
//   node tools/qa/run-electron.cjs tools/qa/goal31-laptop-profile.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal31');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'laptop-profile', errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000);

  // wrap productThumb so its calls carry their own clock
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

  // longtask observer + the real open through the same hook the E press runs
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
  await page.waitForTimeout(7000);

  if (cdp) {
    try {
      const { profile } = await cdp.send('Profiler.stop');
      // self-time per node, the accurate way: sum timeDeltas at each sample
      const self = new Map();
      const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
      for (let i = 0; i < (profile.samples?.length || 0); i += 1) {
        const id = profile.samples[i];
        const dt = profile.timeDeltas?.[i] || 0;
        self.set(id, (self.get(id) || 0) + dt);
      }
      const rows = [...self.entries()]
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
      out.topSelf = rows;
      fs.writeFileSync(path.join(OUT, `${out.tag}-raw-profile.json`), JSON.stringify(profile));
    } catch (e) {
      out.profiler = `stop failed: ${e.message}`;
    }
  }

  out.longtasks = await page.evaluate(() => {
    const S = window.__lapProf;
    return { openAt: +S.openAt.toFixed(0), tasks: S.longtasks.filter((t) => t.ms > 200) };
  });
  out.thumbTimes = await page.evaluate(() => window.__thumbTimes);
  out.thumbTotalMs = +(out.thumbTimes.reduce((a, t) => a + t.ms, 0)).toFixed(1);

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, `${out.tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

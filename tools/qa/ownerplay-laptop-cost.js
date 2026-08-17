// LAPTOP OPEN COST — the bar fills at a scripted 1,350 ms; "usable" is when
// a click actually reacts. Everything between is measured and attributed:
// rAF gaps, longtasks, program/geometry/texture arrivals, DOM growth, and
// the first-reaction latency of a real click on the laptop's own nav.
//
//   node tools/qa/run-electron.cjs tools/qa/ownerplay-laptop-cost.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/ownerplay');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
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

  // samplers + snapshots, then the REAL open (the same hook the E press runs)
  await page.evaluate(() => {
    const S = { gaps: [], longtasks: [], last: performance.now(), on: true };
    window.__lap = S;
    const info = window.__fw.scene3d.renderer.info;
    S.before = {
      p: info.programs?.length ?? -1,
      g: info.memory.geometries,
      t: info.memory.textures,
      dom: document.querySelectorAll('*').length,
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
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) S.longtasks.push({ t: +e.startTime.toFixed(0), ms: +e.duration.toFixed(0) });
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* gaps still stand */ }
    S.openAt = performance.now();
    window.__fw.scene3d.walk.hooks.openLaptop?.(null);
  });

  // wait for the laptop DOM, then click a nav item repeatedly until the page
  // reacts — the delta from bar-complete (openAt + 1350) is HIS five seconds
  await page.waitForFunction(() => document.body.classList.contains('laptop-mode'), null, { timeout: 30000 });
  out.firstReaction = await page.evaluate(async () => {
    const S = window.__lap;
    const barDoneAt = S.openAt + 1350;
    const deadline = performance.now() + 25000;
    const navSelector = '.lt-nav button, .lt-nav a, .lt-sidebar button, [class*="lt-"] button';
    let reactedAt = null;
    let clicks = 0;
    while (performance.now() < deadline && reactedAt === null) {
      const buttons = [...document.querySelectorAll(navSelector)].filter((b) => b.offsetParent !== null);
      if (buttons.length) {
        const target = buttons[Math.min(1, buttons.length - 1)];
        const beforeHtml = document.querySelector('.lt-page, .lt-body, [class*="lt-content"]')?.innerHTML.length || 0;
        target.click();
        clicks += 1;
        await new Promise((r) => setTimeout(r, 180));
        const afterHtml = document.querySelector('.lt-page, .lt-body, [class*="lt-content"]')?.innerHTML.length || 0;
        if (afterHtml !== beforeHtml) reactedAt = performance.now();
      } else {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    return {
      barDoneAt: +barDoneAt.toFixed(0),
      reactedAt: reactedAt && +reactedAt.toFixed(0),
      msFromBarToUsable: reactedAt && +(reactedAt - barDoneAt).toFixed(0),
      clicksTried: clicks,
      visibleNavButtons: [...document.querySelectorAll(navSelector)].filter((b) => b.offsetParent !== null).length,
    };
  });

  out.window = await page.evaluate(() => {
    const S = window.__lap;
    S.on = false;
    const info = window.__fw.scene3d.renderer.info;
    return {
      arrivals: (info.programs?.length ?? -1) - S.before.p,
      geometries: info.memory.geometries - S.before.g,
      textures: info.memory.textures - S.before.t,
      domGrowth: document.querySelectorAll('*').length - S.before.dom,
      gaps: S.gaps,
      longtasks: S.longtasks.filter((t) => t.ms > 200),
    };
  });
  await page.screenshot({ path: path.join(OUT, 'laptop-open.png') });
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'laptop-cost.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

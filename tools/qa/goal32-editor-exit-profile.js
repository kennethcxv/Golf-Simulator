// THE EDITOR EXIT'S 4.8 s LONGTASK, NAMED BY SELF-TIMES.
//
// The stopwatch driver measured entry clean (27 ms flip, 0 compiles) and exit
// frozen (one 4,803 ms longtask on the Exit click). Suspects in exitEditor:
// rebuildSectionIndex, recomputeRating, autosave, enterWalk('resume'). A CDP
// sampling profile brackets the click; the answer is function names.
//
//   node tools/qa/run-electron.cjs tools/qa/goal32-editor-exit-profile.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal32');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'editor-exit-profile', errs: [] };
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
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(400);
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.courseMode === 'editor', null, { timeout: 20000 });
  await page.waitForTimeout(2500);

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
    const b = [...document.querySelectorAll('button')].find((x) => /Exit\s*$/.test((x.textContent || '').trim()));
    b?.click();
  });
  await page.waitForFunction(() => window.__fw.courseMode === 'walk', null, { timeout: 30000 });
  await page.waitForTimeout(2000);

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
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, `${out.tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

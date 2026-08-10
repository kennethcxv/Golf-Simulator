// A1 — WHERE DOES THE 10.5 ms WALL FRAME GO, NOW THAT THE GPU IS 5.14?
//
// Uncapped runs 95 fps focused; the GPU median is 5.14 ms; something on the
// main thread is spending the rest. scene3d.render is patchable from outside,
// so the split is measured, not guessed: wall time INSIDE the render call
// (three.js submit + composer, CPU side) versus the rest of the frame body
// (sim, UI, input). Control: the two must sum to ≈ the frame interval.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-cpu-split.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-cpu-split');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(5000);

  const out = await page.evaluate(() => new Promise((resolve) => {
    const fw = window.__fw;
    fw.preferences.set('display.fpsCap', 0);
    fw.state.clock.minutes = Math.floor(fw.state.clock.minutes / 1440) * 1440 + 14 * 60;
    fw.speedIdx = 0;
    const s = fw.scene3d;
    const orig = s.render;
    const renderMs = [];
    const frameMs = [];
    let lastEnd = 0;
    s.render = function patched(...args) {
      const t0 = performance.now();
      if (lastEnd) frameMs.push(t0 - lastEnd);
      const r = orig.apply(this, args);
      const t1 = performance.now();
      renderMs.push(t1 - t0);
      lastEnd = t1;
      return r;
    };
    setTimeout(() => {
      s.render = orig;
      fw.preferences.set('display.fpsCap', 120);
      const stat = (xs) => {
        const v = xs.slice(10).sort((a, b) => a - b);
        const at = (q) => +v[Math.floor(v.length * q)].toFixed(2);
        return { n: v.length, median: at(0.5), p95: at(0.95) };
      };
      resolve({ renderCall: stat(renderMs), betweenRenders: stat(frameMs) });
    }, 8000);
  }));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('A1-CPUSPLIT', JSON.stringify(out));
}

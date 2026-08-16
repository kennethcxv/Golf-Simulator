// GOAL 28 P4 — WHERE DOES THE FIRST TAB'S 1.5 s GO?
//
// The census measured tab-overview at 1,490/1,550 ms first press (second
// press ~14 ms) on both tiers. This splits that cost: the handler's own
// stages (marks ov-* planted in toggleCourseMode) versus the first overview
// FRAME (render/compile work that lands on the rAF after the handler
// returns). Census program counter is VOID (its fresh-program control
// misses); this driver measures time and marks only.
//
// NEGATIVE CONTROL: a planted 150 ms busy-block must appear in the gap log.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-overview-first-press.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/overview-first-press');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000); // settle: post-veil deferred work drains

  await page.evaluate(() => {
    const T = { gaps: [], t0: performance.now() };
    window.__ovT = T;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (now - last > 30) T.gaps.push({ t: +now.toFixed(0), ms: +(now - last).toFixed(1) });
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(300);

  // program count straight off the live renderer — NOT the census's void
  // counter; this is the same read asset20's acceptance uses
  out.programsBefore = await page.evaluate(() => window.__fw.scene3d.renderer.info.programs.length);

  // the real input path: Tab keydown on the window, like a hand on the key
  const pressAt = await page.evaluate(() => {
    const t = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }));
    return +t.toFixed(1);
  });
  out.pressAt = pressAt;
  await page.waitForFunction(() => window.__fw?.courseMode === 'overview', null, { timeout: 30000 });
  await page.waitForTimeout(2500); // let the first overview frames land

  // CONTROL: planted stall must register
  await page.evaluate(() => {
    const t0 = performance.now();
    while (performance.now() - t0 < 150) { /* planted */ }
  });
  await page.waitForTimeout(300);

  out.programsAfter = await page.evaluate(() => window.__fw.scene3d.renderer.info.programs.length);
  out.programArrivalsAtFirstTab = out.programsAfter - out.programsBefore;

  const data = await page.evaluate(() => ({
    marks: Object.fromEntries(performance.getEntriesByType('mark').map((m) => [m.name, +m.startTime.toFixed(1)])),
    gaps: window.__ovT.gaps,
  }));
  out.marks = Object.fromEntries(Object.entries(data.marks).filter(([k]) => k.startsWith('ov-')));
  out.gapsAfterPress = data.gaps.filter((g) => g.t >= pressAt - 10);
  const planted = out.gapsAfterPress.filter((g) => g.ms >= 140 && g.ms <= 400);
  out.control_stall = planted.length ? `caught (${planted[planted.length - 1].ms} ms)` : 'MISSED - GAP LOG VOID';

  const m = out.marks;
  if (m['ov-enter-start'] != null) {
    out.split = {
      handlerTotalMs: +(m['ov-enter-end'] - m['ov-enter-start']).toFixed(1),
      pinMs: +(m['ov-pin'] - m['ov-enter-start']).toFixed(1),
      exitWalkMs: +(m['ov-exitwalk'] - m['ov-pin']).toFixed(1),
      dirtDiagMs: +(m['ov-dirt-diag'] - m['ov-exitwalk']).toFixed(1),
      dirtRevealMs: +(m['ov-dirt-reveal'] - m['ov-dirt-diag']).toFixed(1),
      toastMs: +(m['ov-enter-end'] - m['ov-dirt-reveal']).toFixed(1),
    };
    const post = out.gapsAfterPress.filter((g) => g.t > m['ov-enter-end'] && g.t < m['ov-enter-end'] + 2000);
    out.firstFrameAfterHandlerMs = post.length ? Math.max(...post.map((g) => g.ms)) : 0;
  }

  const file = path.join(OUT, `${tag}-result.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (out.control_stall.startsWith('MISSED')) process.exitCode = 1;
  if (out.errs.length) process.exitCode = 1;
}

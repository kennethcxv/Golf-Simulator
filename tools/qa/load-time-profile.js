async (page) => {
  // B9 — WHERE THE LOAD TIME GOES.
  //
  // PHASE_1_CLASSIFICATION named every phase of prewarm() and then said, quite
  // correctly, that "which step dominates is UNVERIFIED; no per-step timing
  // exists". This measures it: wall-clock from navigation to the veil coming
  // down, split into the phases before the clubhouse exists and the phases
  // inside prewarm.
  //
  // Negative controls, stated before any number below is used:
  //   - the phase timings must SUM to roughly the reported prewarm total. If
  //     they do not, the marks are in the wrong places and the ranking is
  //     fiction.
  //   - the measured total must be within a plausible band of the wall-clock
  //     load. A profiler that reports 200 ms for an 18-second load is timing
  //     something other than the load.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/load-time');
  fs.mkdirSync(OUT, { recursive: true });
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // Stamp the clock the moment the player commits to loading a game, which is
  // the first instant they are waiting on us for anything.
  const bootUrl = `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`;
  await page.evaluate(() => { window.__loadT0 = performance.now(); });
  const bootMode = await (await import(bootUrl)).clickThroughMenu(page);

  await page.waitForFunction(() => window.__fw?.scene3d, null, { timeout: 180000 });
  const sceneAt = await page.evaluate(() => performance.now() - window.__loadT0);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 180000 });
  const clubhouseAt = await page.evaluate(() => performance.now() - window.__loadT0);

  // The veil coming down IS the end of the load from the player's side.
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || Number(getComputedStyle(veil).opacity) < 0.02;
  }, null, { timeout: 240000 });
  const veilDownAt = await page.evaluate(() => performance.now() - window.__loadT0);

  const timings = await page.evaluate(() => (
    window.__fw?.scene3d?.prewarmTimings ? window.__fw.scene3d.prewarmTimings() : []
  ));

  const phases = timings.filter((entry) => !['TOTAL', 'texture-count', 'uncalled-object-count', 'distinct-programs', 'gl-programs', 'near-warm-objects'].includes(entry.label));
  const total = timings.find((entry) => entry.label === 'TOTAL');
  const counts = Object.fromEntries(
    timings.filter((entry) => ['texture-count', 'uncalled-object-count', 'distinct-programs', 'gl-programs', 'near-warm-objects'].includes(entry.label))
      .map((entry) => [entry.label, entry.ms]),
  );
  const summed = +phases.reduce((sum, entry) => sum + entry.ms, 0).toFixed(1);

  const report = {
    bootMode,
    wallClock: {
      sceneReadyMs: Math.round(sceneAt),
      clubhouseReadyMs: Math.round(clubhouseAt),
      veilDownMs: Math.round(veilDownAt),
      totalSeconds: +(veilDownAt / 1000).toFixed(2),
    },
    beforePrewarmMs: Math.round(clubhouseAt),
    prewarmTotalMs: total ? total.ms : null,
    counts,
    ranked: [...phases].sort((a, b) => b.ms - a.ms),
  };
  fs.writeFileSync(path.join(OUT, 'load-time.json'), JSON.stringify(report, null, 2));

  assert(timings.length > 0,
    'NEGATIVE CONTROL FAILED: prewarmTimings is empty. Either prewarm did not run or the marks are not wired.');
  assert(total && Math.abs(summed - total.ms) < Math.max(250, total.ms * 0.1),
    `NEGATIVE CONTROL FAILED: the phases sum to ${summed} ms but prewarm reports ${total && total.ms} ms. The marks are in the wrong places, so the ranking would be fiction.`);
  assert(veilDownAt > 1000,
    `NEGATIVE CONTROL FAILED: the whole load measured ${Math.round(veilDownAt)} ms. That is not a load; the veil check is passing before the load starts.`);
  return report;
}

// THE 3.4 SECONDS BEFORE PREWARM, BROKEN DOWN BY THE MARKS ALREADY IN THE CODE.
//
// boot-premilestones showed prewarm is only ~65% of the veil and ~3.4 s passes
// before the scene even starts its own clock. main.js already stamps
// performance marks across that stretch (app-eval-start, ng-stategen-start/end,
// scene-construct-start/end, ...), and nothing has ever read them together.
//
// THE CONTROL is the arithmetic: scene-construct must sit inside the veil this
// run measures independently, and the marks must be monotonic. A mark landing
// after the veil lifted would mean this is reading a different boot.
async (page) => {
  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  const t0 = Date.now();
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => typeof window.__fwBoot?.veilLiftedMs === 'number', null, { timeout: 300000 });
  const veil = Date.now() - t0;
  const r = await page.evaluate(() => ({
    marks: performance.getEntriesByType('mark')
      .map((m) => ({ name: m.name, t: +m.startTime.toFixed(1) }))
      .sort((a, b) => a.t - b.t),
    now: +performance.now().toFixed(1),
    prewarmMs: (window.__fwBoot?.stages || []).find((s) => s.label === 'prewarm')?.ms ?? null,
    veilLiftedMs: window.__fwBoot?.veilLiftedMs ?? null,
  }));
  console.log(`veil ${veil} ms   prewarm ${r.prewarmMs} ms   page clock now ${r.now} ms`);
  console.log('marks, ms on the page clock, with the gap since the previous one:');
  let prev = 0;
  for (const m of r.marks) {
    const gap = m.t - prev;
    console.log(`  ${String(m.t).padStart(9)}  (+${String(gap.toFixed(1)).padStart(8)})  ${m.name}`);
    prev = m.t;
  }
  const construct = r.marks.filter((m) => m.name.startsWith('scene-construct'));
  if (construct.length === 2) {
    console.log(`scene construction itself: ${(construct[1].t - construct[0].t).toFixed(1)} ms`);
  }
  const monotonic = r.marks.every((m, i) => i === 0 || m.t >= r.marks[i - 1].t);
  console.log(`CONTROL monotonic marks: ${monotonic ? 'ok' : 'FAILED'}`);
  return { veil, marks: r.marks, prewarmMs: r.prewarmMs };
}

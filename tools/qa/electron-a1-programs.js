// A1 — WHERE THE 132 GL PROGRAMS COME FROM.
//
// The load is dominated by one-time program compilation: ~73 ms each,
// serialized on the JS thread because a program's real compile lands on its
// first draw. `warm-composer-render` is 5,532 ms of an 8,803 ms prewarm - 63%
// of the load in one phase.
//
// compileAsync was tried on 2026-08-03 and cost more than it saved (1,350 ms
// spent to return ~200 ms). So the only lever left is COMPILING FEWER, and
// nothing had ever measured WHICH AXIS of the program key is multiplying.
//
// This reads the breakdown the prewarm now records and reports it. It is a
// measurement, not a fix, and it says so.
//
// NEGATIVE CONTROL: the axis counts must multiply to at least the program
// total. If some axis is being read as a constant when it is not, the product
// falls below the total and the breakdown is not describing these programs.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-programs');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(6000);

  out.timings = await page.evaluate(() => (window.__fw.scene3d.prewarmTimings
    ? window.__fw.scene3d.prewarmTimings() : null));
  out.breakdown = await page.evaluate(() => (window.__fw.scene3d.programKeyBreakdown
    ? window.__fw.scene3d.programKeyBreakdown() : null));

  if (out.breakdown) {
    const spread = out.breakdown.spread || {};
    const product = Object.values(spread).reduce((a, b) => a * b, 1);
    out.verdict = {
      distinctPrograms: out.breakdown.total,
      spread,
      // the control: the axes must be able to ACCOUNT for the programs seen
      productOfAxes: product,
      controlValid: product >= out.breakdown.total,
      // the axis with the most distinct values is the one multiplying the rest
      worstAxis: Object.entries(spread).sort((a, b) => b[1] - a[1])[0],
    };
  }
  // A1: HOW MUCH OF THE CLUBHOUSE IS STILL RECOMPOSING ITS MATRIX EVERY FRAME.
  //
  // The shell freeze (walls, roof, porch, exterior dressing) runs INLINE at
  // construction, but fixtures, the register kit and stock are added to the
  // interior later, in ready callbacks. Anything registered after that walk is
  // still matrixAutoUpdate. This sizes the lever before anyone touches it.
  out.matrices = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse?.();
    if (!ch?.group) return null;
    let total = 0; let auto = 0; let frozen = 0;
    let autoInInterior = 0; let interiorTotal = 0;
    const interior = ch.interior || null;
    const walk = (o, insideInterior) => {
      total += 1;
      if (insideInterior) interiorTotal += 1;
      if (o.matrixAutoUpdate) {
        auto += 1;
        if (insideInterior) autoInInterior += 1;
      } else frozen += 1;
      for (const c of o.children) walk(c, insideInterior || o === interior);
    };
    walk(ch.group, false);
    // THE INTERIOR IS NOT UNDER `group`. The first run of this census returned
    // interiorTotal: 0 while ch.interior exists - which is the finding, not a
    // bug in the count: the shell freeze walks `group`, so it can never have
    // reached the interior subtree at all. Walk it separately and report both.
    let iTotal = 0; let iAuto = 0;
    if (interior && !interiorTotal) {
      const walkI = (o) => {
        iTotal += 1;
        if (o.matrixAutoUpdate) iAuto += 1;
        for (const c of o.children) walkI(c);
      };
      walkI(interior);
    }
    return {
      total, auto, frozen, interiorTotal, autoInInterior,
      autoPct: +(100 * auto / Math.max(1, total)).toFixed(1),
      interiorUnderGroup: interiorTotal > 0,
      interiorSubtree: { total: iTotal, auto: iAuto,
        autoPct: +(100 * iAuto / Math.max(1, iTotal)).toFixed(1) },
    };
  });

  const phase = (label) => (out.timings || []).find((t) => t.label === label)?.ms ?? null;
  out.load = {
    warmComposerRenderMs: phase('warm-composer-render'),
    rendererCompileMs: phase('renderer.compile'),
    glPrograms: phase('gl-programs'),
    materialInstances: phase('material-instances'),
    totalMs: (out.timings || []).filter((t) => /ms$|^warm|^renderer|^forced|^ledger/.test(t.label))
      .reduce((a, t) => a + (t.ms > 0 ? t.ms : 0), 0),
  };
  fs.writeFileSync(path.join(OUT, 'a1-programs.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1 load', JSON.stringify(out.load));
  console.log('A1 verdict', JSON.stringify(out.verdict));
  console.log('A1 matrices', JSON.stringify(out.matrices));
  for (const [axis, rows] of Object.entries(out.breakdown?.byAxis || {})) {
    console.log(`A1 ${axis}:`, JSON.stringify(rows.slice(0, 5)));
  }
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}

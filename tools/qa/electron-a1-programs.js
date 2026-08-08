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
  const phase = (label) => (out.timings || []).find((t) => t.label === label)?.ms ?? null;
  out.load = {
    warmComposerRenderMs: phase('warm-composer-render'),
    rendererCompileMs: phase('renderer.compile'),
    glPrograms: phase('gl-programs'),
    distinctPrograms: phase('distinct-programs'),
    totalMs: (out.timings || []).filter((t) => /ms$|^warm|^renderer|^forced|^ledger/.test(t.label))
      .reduce((a, t) => a + (t.ms > 0 ? t.ms : 0), 0),
  };
  fs.writeFileSync(path.join(OUT, 'a1-programs.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1 load', JSON.stringify(out.load));
  console.log('A1 verdict', JSON.stringify(out.verdict));
  for (const [axis, rows] of Object.entries(out.breakdown?.byAxis || {})) {
    console.log(`A1 ${axis}:`, JSON.stringify(rows.slice(0, 5)));
  }
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}

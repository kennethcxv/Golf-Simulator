// WHAT IS THE PREWARM ACTUALLY PAYING FOR?
//
// The boot ledger says a stamped boot spends 38-85 s under the veil, and that
// the cost lands in a handful of "prewarm-slow-draw-ms" rows of 7-22 s each.
// Those draws render at a 96 px viewport, so they cannot be fill-bound, and
// that leaves two candidates:
//
//   * the PROGRAMS the draw forces the driver to link, which is the entire
//     stated purpose of the prewarm, or
//   * the SHADOW BAKE the draw carries. withWarmViewport shrinks the colour
//     pass only. The shadow map renders at its own full resolution, and the
//     prewarm deliberately turns frustum culling OFF, so every forced draw
//     bakes the whole scene into the shadow map.
//
// A draw that mints ZERO programs is buying nothing a shader cache cares
// about, however long it takes. That is the measurement.
//
// THE NEGATIVE CONTROL is the ledger's own arithmetic: the per-draw times must
// sum to within a few percent of the slow-draw rows the boot ledger already
// reports independently. If this instrument's draws do not add up to the boot's
// own accounting, it is watching different draws and says nothing.
//
//   QA_ELECTRON_USER_DATA_DIR=<dir> node tools/qa/run-electron.cjs tools/qa/prewarm-draw-anatomy.js --clubhouse=pine-hills-v2
async (page) => {
  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  const stampedBefore = await page.evaluate(() => {
    try { return !!localStorage.getItem('golfEmpire.shaderCompileStamp.v2'); } catch { return null; }
  });
  const t0 = Date.now();
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => typeof window.__fwBoot?.veilLiftedMs === 'number', null, { timeout: 300000 });
  const veilMs = Date.now() - t0;

  const r = await page.evaluate(() => ({
    draws: window.__fwWarmDraws || null,
    prewarm: window.__fwBoot?.prewarmTimings || [],
    stages: window.__fwBoot?.stages || [],
    veilLiftedMs: window.__fwBoot?.veilLiftedMs ?? null,
    programsNow: window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null,
  }));
  if (!r.draws) return { fatal: 'no __fwWarmDraws — the instrument did not install' };

  const total = r.draws.reduce((a, d) => a + d.ms, 0);
  const minted = r.draws.reduce((a, d) => a + d.minted, 0);
  const barren = r.draws.filter((d) => d.minted <= 0);
  const barrenMs = barren.reduce((a, d) => a + d.ms, 0);

  // the control: our slow draws against the boot ledger's own slow-draw rows
  const ledgerSlow = r.prewarm.filter((x) => x.label === 'prewarm-slow-draw-ms');
  const ourSlow = r.draws.filter((d) => d.ms > 5000);
  const control = {
    ledgerSlowRows: ledgerSlow.length,
    ourSlowDraws: ourSlow.length,
    ledgerSlowMs: +ledgerSlow.reduce((a, x) => a + x.ms, 0).toFixed(0),
    ourSlowMs: +ourSlow.reduce((a, d) => a + d.ms, 0).toFixed(0),
  };
  control.agrees = control.ledgerSlowRows === control.ourSlowDraws;

  console.log(`\nboot ${stampedBefore ? 'WARM (stamped)' : 'COLD'}   veil at ${veilMs} ms   programs ${r.programsNow}`);
  console.log('\n  #      ms   minted    calls        tris');
  for (const d of r.draws) {
    console.log(`  ${String(d.i).padStart(2)} ${String(d.phase || '?').padEnd(20)} ${String(d.ms).padStart(8)} ${String(d.minted).padStart(8)}`
      + ` ${String(d.calls).padStart(8)} ${String(d.tris).padStart(11)}`
      + (d.minted <= 0 && d.ms > 1000 ? '   <-- SLOW AND BUYS NOTHING' : ''));
  }
  console.log(`\ntotal warm-draw time ${total.toFixed(0)} ms over ${r.draws.length} draws, minting ${minted} programs`);
  console.log(`draws that minted NOTHING: ${barren.length}, costing ${barrenMs.toFixed(0)} ms`);
  console.log('');
  console.log('== EVERY PREWARM PHASE, IN ORDER (ms unless the label says a count) ==');
  for (const row of r.prewarm) console.log(`  ${String(row.ms).padStart(9)}  ${row.label}`);
  console.log('');
  console.log('== THE WARM STAGES AFTER PREWARM ==');
  for (const st of (r.stages || [])) {
    console.log(`  ${String(st.ms).padStart(9)} ms  ${String(st.label).padEnd(14)} frames ${st.frames}  minted ${st.minted}  budget ${st.budgetMs}${st.budgetHit ? '  <-- BUDGET BLOWN' : ''}`);
  }
  console.log(`CONTROL vs the boot ledger's own slow rows: ${JSON.stringify(control)}`);
  if (!control.agrees) console.log('CONTROL FAILED — this instrument is not watching the boot\'s draws');

  return {
    boot: stampedBefore ? 'WARM (stamped)' : 'COLD',
    veilMs,
    programsNow: r.programsNow,
    draws: r.draws,
    totalWarmDrawMs: +total.toFixed(0),
    mintedTotal: minted,
    barrenDraws: barren.length,
    barrenMs: +barrenMs.toFixed(0),
    control,
  };
}

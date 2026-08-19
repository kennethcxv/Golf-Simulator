// WHAT DOES A STAMPED BOOT ACTUALLY SPEND?
//
// The compile SCREEN is gated on the stamp (src/ui/compileScreen.js). The five
// warm stages under the veil are not: prewarm, then belt, laptop-view, editor
// and overview all run on every boot, stamped or not. Nobody has ever measured
// what that costs on a boot where every program is already in the driver's disk
// cache, so "loading is slow again" has had no number attached to it.
//
// This reads window.__fwBoot, the ledger main.js now writes: per stage, the
// wall time and the programs minted. A stage that mints ZERO on a stamped boot
// is doing work whose entire purpose was to be paid once.
//
// Run it twice against the SAME profile to get the pair that matters:
//
//   QA_ELECTRON_USER_DATA_DIR=<dir> node tools/qa/run-electron.cjs tools/qa/boot-cost-ledger.js --clubhouse=pine-hills-v2
//
// The first run of a fresh dir is COLD (no stamp, screen shows); every run
// after it is WARM (stamped, screen suppressed). The driver reports which one
// it got rather than assuming, because a profile that failed to stamp would
// otherwise be reported as a warm boot that happens to be slow.
async (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  // THE STAMP, READ BEFORE THE BOOT WRITES ONE. The first cut read it at the
  // END and so reported every successful COLD boot as "WARM (stamped)" -- it
  // was reading the stamp the run had just earned. A 184 s cold boot went into
  // the record labelled warm, which is the shape of a wrong conclusion, not a
  // slow one.
  const stampedBefore = await page.evaluate(() => {
    try { return !!localStorage.getItem('golfEmpire.shaderCompileStamp.v2'); } catch { return null; }
  });
  const t0 = Date.now();
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d, null, { timeout: 120000 });

  // The ledger is complete when the veil lifts. Wait on the ledger itself, not
  // on the veil's opacity: the veil is a CSS fade and the ledger is the fact.
  // Is there a ledger at all? Asked ONCE, immediately, because on a build that
  // predates it the wait below would otherwise burn its whole timeout before
  // the veil is even looked at -- which is how the first baseline run reported
  // a 304 s boot that was actually a 300 s wait for a global that never comes.
  const hasLedger = await page.evaluate(() => !!window.__fwBoot);
  let complete = true;
  if (hasLedger) {
    try {
      await page.waitForFunction(
        () => typeof window.__fwBoot?.veilLiftedMs === 'number',
        null,
        { timeout: 300000 },
      );
    } catch {
      complete = false;
    }
  }
  const menuToVeilMs = Date.now() - t0;

  // The veil, timed independently of the ledger, so this driver still returns a
  // comparable end-to-end number on a build that predates the ledger. That is
  // the whole point of the A/B: "is the ground work the cost?" cannot be
  // answered by an instrument that only exists on one side of it.
  let veilGoneMs = null;
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 300000 });
    veilGoneMs = Date.now() - t0;
  } catch { /* recorded as null, not as fast */ }

  const ledger = await page.evaluate(() => {
    const b = window.__fwBoot;
    if (!b) return null;
    return {
      stamped: b.stamped,
      mode: b.mode,
      warmsDoneMs: b.warmsDoneMs ?? null,
      veilLiftedMs: b.veilLiftedMs ?? null,
      stages: b.stages,
      prewarmTimings: b.prewarmTimings,
      warmSummary: window.__fwWarm || null,
      programsNow: window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null,
    };
  });
  if (!ledger) {
    // A build without the ledger (anything before it landed). Report the
    // end-to-end number and say plainly that the breakdown is unavailable,
    // rather than throwing and losing the comparison.
    return {
      boot: stampedBefore ? 'WARM (stamped)' : 'COLD',
      ledger: 'absent — this build predates window.__fwBoot',
      menuToVeilMs, veilGoneMs, errors,
      programsNow: await page.evaluate(() => window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null),
    };
  }

  // The table, printed rather than left in JSON, because the point of this run
  // is a thing a person reads.
  const rows = ledger.stages.map((s) => ({
    stage: s.label,
    ms: s.ms,
    frames: s.frames,
    msPerFrame: s.msPerFrame,
    budgetMs: s.budgetMs,
    budgetHit: s.budgetHit,
    minted: s.minted,
  }));
  const warmTotal = ledger.stages.reduce((a, s) => a + s.ms, 0);
  const mintedTotal = ledger.stages.reduce((a, s) => a + s.minted, 0);

  // The prewarm's own phases, sorted by cost, so the expensive ones are named.
  const phases = (ledger.prewarmTimings || [])
    .filter((r) => r.label !== 'TOTAL')
    .slice()
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 14);

  // "Warming the day" specifically: the owner named it, so it gets its own line.
  const dayRows = (ledger.prewarmTimings || []).filter((r) => /^light-state/.test(r.label));
  const dayMs = dayRows.filter((r) => /^light-state-/.test(r.label)).reduce((a, r) => a + r.ms, 0);
  const dayStates = (ledger.prewarmTimings || []).find((r) => r.label === 'light-states-beyond-boot')?.ms ?? null;

  return {
    boot: ledger.stamped ? 'WARM (stamped)' : `COLD (${ledger.mode})`,
    stampedBefore,
    complete,
    menuToVeilMs,
    veilGoneMs,
    warmsDoneMs: ledger.warmsDoneMs,
    veilLiftedMs: ledger.veilLiftedMs,
    programsNow: ledger.programsNow,
    stageTable: rows,
    stageTotals: { ms: +warmTotal.toFixed(1), minted: mintedTotal },
    warmingTheDay: { states: dayStates, ms: +dayMs.toFixed(1), rows: dayRows.length },
    prewarmTopPhases: phases,
    warmSummary: ledger.warmSummary,
    errors,
  };
}

// ROUND 5 — DID ledgerBook.prewarmVisual ACTUALLY RUN?
//
// courseScene calls it during prewarm as
//   clubhouseApi?.ledgerBook?.prewarmVisual?.(renderer, camera, scene)
// -- three optional chains in a row, every one of which no-ops SILENTLY if the
// link is missing. The evidence says it did not do its job: the first open
// uploads +25 geometries and the first turn +2 with a fresh `basic` program,
// which is exactly the first-visibility cost prewarmVisual exists to pay.
//
// So ask the object, rather than reading the call site and believing it. The
// ledger reports its own prewarm flags through diagnostics(); this reads them
// straight after boot, before anything has opened the book.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-ledger-prewarm-ran.js --clubhouse=pine-hills-v2
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6500);

  const info = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse?.();
    const lb = ch?.ledgerBook;
    const out = {
      hasClubhouseApi: !!ch,
      hasLedgerBook: !!lb,
      hasPrewarmVisual: typeof lb?.prewarmVisual === 'function',
      prewarmTimings: null,
      diagnostics: null,
    };
    try {
      const d = lb?.diagnostics?.();
      if (d) {
        out.diagnostics = {
          state: d.state,
          glbReady: d.glbReady,
          spread: d.spread,
          pageCount: d.pageCount,
        };
      }
    } catch (e) { out.diagnosticsError = String(e.message || e); }
    // The prewarm's own phase log names every step it ran, including
    // 'ledger-first-visibility'. If that label is absent the call never landed.
    try {
      const t = s3.prewarmTimings?.() ?? s3.loadTimings?.() ?? null;
      out.prewarmTimings = Array.isArray(t) ? t.map((x) => x.label) : t;
    } catch (e) { out.timingsError = String(e.message || e); }
    return out;
  });
  console.log('LEDGER-PREWARM', JSON.stringify(info, null, 2));
  return info;
}

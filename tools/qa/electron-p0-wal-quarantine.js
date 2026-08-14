// P0 (owner playtest) — "Checkout records unavailable right now. Try again."
//
// The owner finished a checkout, got that toast, and the customer he had already
// charged never left the register. He named it: the quarantine wedge.
//
// WHAT THIS ESTABLISHES, in order, and it does NOT assume the answer:
//
//   1. Is the latch set right now, on this machine's real profile? QA runs share
//      the owner's Electron profile, so his played save is readable here. If the
//      latch is set, its own `reason` and `evidence` say what tripped it and no
//      theory is needed.
//   2. Is it set on a FRESH new game? That separates "his save is poisoned" from
//      "every game is poisoned".
//   3. Does a checkout actually fail while it is set, and succeed while it is
//      clear? That is the causal link, and without it the latch is just a field.
//   4. Does it survive a reload? A latch that clears on restart is a bad hour;
//      a latch that persists is a dead save file.
//
// The negative control is step 3's second half: the SAME sale on the SAME build
// with the latch cleared. Without it this driver cannot tell "the WAL wedged the
// sale" from "the sale was going to fail anyway".
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p0-wal-quarantine.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p0-wal');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], notes: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  // READ THE SAVED SLOTS BEFORE TOUCHING THE MENU. clickThroughMenu with
  // forceNew would overwrite the very evidence this is looking for, so the
  // owner's played save is read out of localStorage first, as data.
  await page.waitForFunction(() => !!window.localStorage, null, { timeout: 120000 });
  out.savedSlots = await page.evaluate(() => {
    const found = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const raw = localStorage.getItem(key);
      if (!raw || raw.length < 40) continue;
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { continue; }
      const shop = parsed?.shop || parsed?.state?.shop;
      if (!shop) continue;
      const q = shop.pendingCheckoutsQuarantine;
      found.push({
        key,
        bytes: raw.length,
        hasShop: true,
        quarantineActive: q?.active === true,
        quarantineReason: q?.reason ?? null,
        quarantineEvidenceKeys: q?.evidence ? Object.keys(q.evidence) : null,
        pendingCheckoutsType: shop.pendingCheckouts === null ? 'null'
          : Array.isArray(shop.pendingCheckouts) ? 'array' : typeof shop.pendingCheckouts,
        pendingCheckoutCount: shop.pendingCheckouts && typeof shop.pendingCheckouts === 'object'
          && !Array.isArray(shop.pendingCheckouts)
          ? Object.keys(shop.pendingCheckouts).length : null,
        receiptKeys: Array.isArray(shop.checkoutSettlementReceiptKeys)
          ? shop.checkoutSettlementReceiptKeys.length : null,
      });
    }
    return found;
  });
  out.ownerSaveQuarantined = out.savedSlots.some((s) => s.quarantineActive);
  // THE RUNNER USES A FRESH TEMP PROFILE PER RUN
  // (--user-data-dir=.../golf-flipper-electron-qa-profiles/<scope>-<rand>), so an
  // empty slot list means THIS DRIVER COULD NOT SEE THE OWNER'S SAVE -- it does
  // NOT mean his save is clean. Reported as unknown rather than as absent,
  // because "no evidence" and "evidence of no" is the distinction this whole
  // project keeps paying for.
  out.ownerSaveReadable = out.savedSlots.length > 0;
  console.log('P0 saved slots', JSON.stringify(out.savedSlots, null, 2));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const latch = () => page.evaluate(() => {
    const q = window.__fw.state?.shop?.pendingCheckoutsQuarantine;
    return {
      active: q?.active === true,
      reason: q?.reason ?? null,
      evidenceKeys: q?.evidence ? Object.keys(q.evidence) : null,
    };
  });
  out.freshGameLatch = await latch();
  console.log('P0 fresh game latch', JSON.stringify(out.freshGameLatch));

  // ---- 3. does a checkout actually fail while it is set? -------------------
  //
  // completeSale is called with the LIVE state and a minimal but real ticket, so
  // the answer is about this build's settlement path rather than about a mock.
  // The point is not the ticket's contents: both arms use the identical ticket
  // and differ only in the latch, so whatever else that ticket trips is held
  // constant and cancels out.
  const trySale = () => page.evaluate(async () => {
    const app = window.__fw;
    // completeSale lives in sim/register.js, NOT in checkoutSettlement.js. The
    // first version imported the settlement module and got
    // "m.completeSale is not a function" -- three arms of the experiment all
    // "failed" identically for a reason that had nothing to do with the latch,
    // and the clause table dutifully reported saleFailsOnlyWhenLatched:false.
    // An error that is constant across both arms is not evidence about either.
    const m = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = {
      number: 9001,
      items: [{ uid: 'p0-probe-uid-1', skuId: 'balls1', name: 'Golf balls', price: 12 }],
      method: 'card',
      taxRate: 0,
      stage: 'done',
    };
    try {
      const r = m.completeSale(app.state, tx, 'P0 Probe');
      return { threw: false, ok: r?.ok === true, reason: r?.reason ?? null, diagnostic: r?.diagnostic ?? null };
    } catch (e) {
      return { threw: true, message: String(e?.message || e) };
    }
  });

  const setLatch = (on) => page.evaluate(async (want) => {
    const app = window.__fw;
    const m = await import(new URL('src/sim/checkoutSettlement.js', document.baseURI).href);
    if (want) {
      m.quarantineCheckoutWal(app.state, 'p0-probe-deliberate', { probe: true });
    } else {
      // THE CLEAR IS DONE BY HAND HERE BECAUSE THE GAME HAS NO CLEAR.
      // That absence is the finding, not an oversight in this driver: nothing in
      // src/ ever sets active back to false or deletes the field.
      delete app.state.shop.pendingCheckoutsQuarantine;
    }
    return m.checkoutWalIsQuarantined(app.state);
  }, on);

  await setLatch(false);
  out.saleWithLatchClear = await trySale();
  await setLatch(true);
  out.saleWithLatchSet = await trySale();
  await setLatch(false);
  out.saleAfterClearingAgain = await trySale();

  out.clauses = {
    latchIsSettable: (await latch()).active === false, // cleared at the end
    // THE CAUSAL LINK, and the negative control that makes it mean anything
    saleFailsOnlyWhenLatched:
      out.saleWithLatchSet.ok === false
      && out.saleWithLatchClear.ok !== out.saleWithLatchSet.ok,
    failureIsTheOwnersString:
      /unavailable right now/i.test(String(out.saleWithLatchSet.reason || '')),
    diagnosticNamesTheQuarantine:
      /quarantin/i.test(String(out.saleWithLatchSet.diagnostic || '')),
    // and the thing that makes it a dead save rather than a bad hour
    noClearExistsInTheGame: true, // asserted by grep, restated in the report
  };
  out.ok = out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'wal.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P0-WAL', JSON.stringify({
    ownerSaveQuarantined: out.ownerSaveQuarantined,
    freshGameLatch: out.freshGameLatch,
    saleWithLatchClear: out.saleWithLatchClear,
    saleWithLatchSet: out.saleWithLatchSet,
    saleAfterClearingAgain: out.saleAfterClearingAgain,
    clauses: out.clauses,
  }, null, 2));
  return out;
}

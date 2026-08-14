// P0 — IS THE MANAGER'S KEY ACTUALLY REACHABLE IN THE GAME?
//
// The unit tests prove releaseCheckoutWalQuarantine works. They cannot prove the
// player can get to it, and "the fix exists and nothing calls it" is a named
// FOUND_FALSE shape in this repo (a 1,400-line movement module imported by
// nothing). The laptop reads its capabilities from an `opts` object wired in
// main.js -- the same narrow-facade trap that has cost this project a debugging
// session -- so this asks the RUNNING GAME.
//
// The sequence is the owner's, in order:
//   1. wedge the till the way a bad save wedges it
//   2. confirm a real sale is refused with HIS string
//   3. confirm the laptop now OFFERS the key (it must not offer it when clean)
//   4. turn the key through the same opts the button calls
//   5. confirm the same sale banks
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p0-wal-key-in-game.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p0-wal-key');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // A REAL PAID TICKET, built with the shipped register calls. A hand-made
  // object is refused by an earlier guard and never reaches the question.
  const run = (phase) => page.evaluate(async (label) => {
    const app = window.__fw;
    const reg = await import(new URL('src/sim/register.js', document.baseURI).href);
    const co = await import(new URL('src/sim/checkout.js', document.baseURI).href);
    const item = { uid: `p0-key-${label}`, skuId: 'balls1', name: 'Practice Balls', price: 15 };
    const picked = co.pickFromShelf(app.state, item.skuId, item.uid);
    if (!picked.ok) return { staged: false, why: picked.reason || 'pickFromShelf refused' };
    app.state.shop.drawer = reg.newDrawer();
    const tx = reg.createTx({ items: [item], mode: 'relaxed', prefer: 'cash', rng: () => 0.9 });
    reg.scanItem(tx, item.uid);
    reg.requestPayment(tx);
    tx.tendered = reg.makeChange(20);
    reg.acceptCash(tx);
    reg.openDrawer(tx);
    reg.depositTendered(tx, app.state.shop.drawer);
    for (const [denom, count] of Object.entries(reg.makeChange(reg.changeDue(tx)))) {
      for (let i = 0; i < count; i += 1) reg.takeFromDrawer(tx, app.state.shop.drawer, Number(denom));
    }
    reg.handOverChange(tx, app.state.shop.drawer);
    reg.printReceipt(tx);
    reg.takeReceipt(tx);
    reg.packReceipt(tx);
    reg.bagItem(tx, item.uid);
    reg.handOverGoods(tx);
    const r = reg.completeSale(app.state, tx, 'P0 Key Customer');
    return { staged: true, ok: r?.ok === true, reason: r?.reason ?? null, banked: tx.banked === true };
  }, phase);

  // WHAT THE LAPTOP ITSELF WOULD DO. Not a re-derivation: these are the exact
  // opts the button's onclick calls, read off the live app.
  const laptopOffers = () => page.evaluate(() => {
    const o = window.__fw.laptopOpts || null;
    if (!o) return { optsReachable: false };
    return {
      optsReachable: true,
      hasWedgedProbe: typeof o.checkoutRecordsWedged === 'function',
      hasResolve: typeof o.resolveCheckoutRecords === 'function',
      offersKey: typeof o.checkoutRecordsWedged === 'function' ? !!o.checkoutRecordsWedged() : null,
    };
  });

  const wedge = () => page.evaluate(async () => {
    const m = await import(new URL('src/sim/checkoutSettlement.js', document.baseURI).href);
    m.quarantineCheckoutWal(window.__fw.state, 'p0-key-probe', { probe: true });
    return m.checkoutWalIsQuarantined(window.__fw.state);
  });

  out.cleanSale = await run('clean');
  out.laptopWhenClean = await laptopOffers();
  out.wedged = await wedge();
  out.wedgedSale = await run('wedged');
  out.laptopWhenWedged = await laptopOffers();
  out.turnedKey = await page.evaluate(() => {
    const o = window.__fw.laptopOpts;
    return typeof o?.resolveCheckoutRecords === 'function' ? o.resolveCheckoutRecords() : null;
  });
  out.saleAfterKey = await run('after-key');
  out.laptopAfterKey = await laptopOffers();

  out.clauses = {
    aRealSaleBanksWhenClean: out.cleanSale.ok === true,
    theWedgeRefusesThatSameSale: out.wedgedSale.ok === false,
    refusalIsTheOwnersString: /unavailable right now/i.test(String(out.wedgedSale.reason || '')),
    // THE FIX IS REACHABLE, which is the whole point of running this in Electron
    laptopOptsAreWired: out.laptopWhenWedged.optsReachable === true
      && out.laptopWhenWedged.hasResolve === true,
    // NEGATIVE CONTROL: a key that is always on screen teaches nothing and would
    // let a player clear a latch that was never set
    keyHiddenWhenNothingIsWrong: out.laptopWhenClean.offersKey === false,
    keyOfferedOnlyWhenWedged: out.laptopWhenWedged.offersKey === true,
    keyTurns: out.turnedKey === true,
    theSameSaleBanksAfterTheKey: out.saleAfterKey.ok === true,
    keyHiddenAgainAfterUse: out.laptopAfterKey.offersKey === false,
  };
  out.ok = Object.values(out.clauses).every((v) => v === true) && out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'key.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P0-KEY', JSON.stringify({ clauses: out.clauses, ok: out.ok }, null, 2));
  return out;
}

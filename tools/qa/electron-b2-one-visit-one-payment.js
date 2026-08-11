// B2 (Goal 23) — ONE VISIT, ONE PAYMENT, IN THE GAME.
//
// WHAT THE OLD CHECK MEASURED: tests/one-visit-one-payment.test.js drives
// createTx -> scanItem -> attachGreenFeeToTx -> payOnce ->
// finalizeReservationCheckIn directly on the sim modules. Eleven tests, every
// one honest, every one green — and not one of them asks whether a customer in
// the shop can ever reach that path. They could not. Three separate walls:
//
//   1. the tee-time errand was raised from the PAID-SALE site, so the words
//      arrived after the money;
//   2. attachGreenFeeToTx needs tx.stage 'scanning' on an unbanked ticket;
//   3. the desk list filtered on checkoutPhase starting 'reservation', and a
//      customer mid-sale is 'placing', so their booking was not even on screen.
//
// This driver refuses to accept the sim's word for any of it. It stages ONE
// customer with goods AND a booking, plays the whole visit through the shipped
// interactions, and asserts at each wall:
//
//   * the ask is SPOKEN while tx.stage is still 'scanning' and unbanked
//   * the booking is ON the desk list at that moment
//   * the desk actions the player clicks put the fee on THAT ticket
//   * ONE payment, and the money splits across BOTH revenue lines
//   * the customer is still there to be answered, and leaves after
//
//   VIDEO_DIR=qa/clips/one-visit node tools/qa/run-electron.cjs \
//     tools/qa/electron-b2-one-visit-one-payment.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b2-one-visit');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], steps: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const step = (name, data) => { out.steps.push({ name, ...data }); console.log('B2', name, JSON.stringify(data)); };

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  // ---- stage: shop open, a booking on the sheet, a shopper with goods -------
  out.staged = await page.evaluate(async ([skus]) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const res = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const time = await import(new URL('src/sim/time.js', document.baseURI).href);
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    app.speedIdx = 0;
    ch.setOrganicWalkins?.(false);
    // A fresh day opens CLOSED, and a shut shop is a counter nobody places
    // goods on. The first run of this driver measured exactly that.
    if (app.state.shop) app.state.shop.open = true;
    for (const id of skus) {
      const inv = app.state.shop.inventory[id];
      if (inv) inv.shelf = Math.max(inv.shelf, 8);
    }
    ch.rebuildStock();
    // a booking close enough that the desk would list it anyway is NOT what we
    // want: it would hide the wall this driver exists to test. Book it far
    // enough out that only "this person is standing here asking" can list it.
    const day = time.calendarOf(app.state.clock.minutes).dayAbs;
    const slots = res.slotTimes(app.state).filter((m) => m > (app.state.clock.minutes % 1440) + 240);
    const minute = slots[0] ?? null;
    if (minute == null) return { ok: false, why: 'no slot far enough out' };
    const made = res.bookSlot(app.state, day, minute, 'Ray Falk');
    if (!made.ok) return { ok: false, why: made.reason };
    const name = ch.sendToCounter(skus, 'card');
    if (!name) return { ok: false, why: 'sendToCounter returned nothing' };
    const c = ch.customerByName(name);
    if (!c) return { ok: false, why: 'staged customer not found' };
    return {
      ok: true, name, reservationId: made.res.id, minute,
      fee: made.res.fee,
      dueNow: res.dueForCheckIn(app.state).some((r) => String(r.id) === String(made.res.id)),
    };
  }, [['balls1', 'glove1']]);
  step('staged', out.staged);
  if (!out.staged.ok) {
    fs.writeFileSync(path.join(OUT, 'one-visit.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }

  // ---- the player goes to the till and takes the sale ----------------------
  await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const off = ch.interior.position;
    w.x = REGISTER.stand.x + off.x;
    w.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    w.yaw = Math.atan2(-dx / h, -dz / h);
    w.pitch = Math.atan2(1.18 - 1.62, h);
  });
  // A SILENTLY CAUGHT WAIT IS HOW A DRIVER MEASURES AN EMPTY COUNTER. The first
  // version swallowed this timeout and went on to scan zero items, press E on
  // nothing and report on a transaction that never existed.
  const gotTx = await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && tx.items.length >= 2;
  }, null, { timeout: 90000 }).then(() => true).catch(() => false);
  if (!gotTx) {
    out.stagingFailure = await page.evaluate((name) => {
      const ch = window.__fw.scene3d.clubhouse();
      const c = ch.customerByName(name);
      return {
        why: 'the customer never placed their goods on the counter',
        found: !!c,
        phase: c?.checkoutPhase ?? null,
        flow: c?.checkoutFlow?.state ?? null,
        cart: c?.cart?.length ?? null,
        placed: c?.checkoutPlacedCount ?? null,
        queued: !!c?.queued,
        awaitingCheckout: !!c?.awaitingCheckout,
        shopOpen: !!window.__fw.state.shop?.open,
        registerReady: !!ch.register?.isActive,
      };
    }, out.staged.name);
    step('STAGING FAILED', out.stagingFailure);
    out.ok = false;
    fs.writeFileSync(path.join(OUT, 'one-visit.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }
  // THE COMBINED VISIT, ATTACHED AT THE COUNTER.
  //
  // Forcing the reservation on at SPAWN removed the customer outright, twice —
  // a booking-holder walking a retail route trips something in arrival
  // handling, which is a finding in its own right and is written up rather than
  // worked around silently. What this driver is testing is the second half of
  // the visit: goods down, goods scanned, THEN the tee time. So the booking is
  // attached once they are standing at the counter with their goods on it,
  // which is the state the brief's step 3 begins from.
  out.attached = await page.evaluate(([name, resId]) => {
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.customerByName(name) || ch.register.getCustomer();
    if (!c) return { ok: false, why: 'customer gone at the counter' };
    c.reservationId = resId;
    c.combinedVisit = true;
    c.deskErrandPending = true;
    c.deskErrandSpoken = false;
    return { ok: true, phase: c.checkoutPhase, cart: c.cart?.length ?? null };
  }, [out.staged.name, out.staged.reservationId]);
  step('attached-booking', out.attached);

  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 20000 });
  await page.waitForTimeout(1800);
  step('at-the-till', await page.evaluate(() => {
    const r = window.__fw.scene3d.clubhouse().register;
    const tx = r.getTx();
    return { active: r.isActive(), items: tx ? tx.items.length : 0, stage: tx?.stage ?? null };
  }));

  // ---- scan every item through the shipped click interaction ---------------
  const clickItem = async (uid) => {
    const spot = await page.evaluate(async (id) => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw;
      const mesh = app.scene3d.clubhouse().register.itemMesh(id);
      if (!mesh) return null;
      const world = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      world.project(app.scene3d.camera);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      return {
        x: rect.left + ((world.x + 1) / 2) * rect.width,
        y: rect.top + ((-world.y + 1) / 2) * rect.height,
        ok: Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
      };
    }, uid);
    if (!spot || !spot.ok) return false;
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(1600);
    return true;
  };
  const uids = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid));
  for (const uid of uids) await clickItem(uid);

  // ---- WALL 1 + 2 + 3: the ask, the ticket stage, and the desk list --------
  out.afterScan = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const r0 = ch.register;
    const tx = r0.getTx();
    const c = r0.getCustomer();
    // ch.frontDeskReservations is INTERNAL; frontDeskBridge() is the accessor.
    // Reading the wrong one returns [] and looks exactly like an empty list.
    const bridge = ch.frontDeskBridge?.() || null;
    const listed = (bridge?.list?.() || []).map((r) => String(r.id));
    return {
      allScanned: !!tx && tx.items.every((i) => i.scanned),
      stage: tx?.stage ?? null,
      banked: !!tx?.banked,
      deskErrandSpoken: !!c?.deskErrandSpoken,
      deskErrandRaisedMidSale: !!c?.deskErrandRaisedMidSale,
      dialogue: c?.dialogue ?? null,
      deskListIds: listed,
      bridgeAvailable: typeof ch.frontDeskBridge === 'function',
      bridgeNonNull: !!bridge,
      customerInList: !!ch.customerByName(c?.name || ''),
      custReservationId: c?.reservationId ?? null,
      custPhase: c?.checkoutPhase ?? null,
      deskTargets: r0.deskHitTargets ? r0.deskHitTargets() : null,
    };
  });
  step('after-scan', out.afterScan);

  // ---- the player clicks the booking on the desk screen --------------------
  // REAL CLICKS ON THE REAL SCREEN. monitorScreenPoint returns null for a row
  // that is not drawn, so a click that lands is proof the row was there — which
  // is the whole question. Calling the dispatcher directly would prove nothing
  // a player could repeat, and that is how this was reported done twice.
  const clickDesk = async (action) => {
    const pt = await page.evaluate((a) => {
      const r = window.__fw.scene3d.clubhouse().register;
      const p = r.monitorScreenPoint ? r.monitorScreenPoint(a) : null;
      return p ? { x: p.x, y: p.y, targets: r.deskHitTargets ? r.deskHitTargets() : null } : { missing: true, targets: r.deskHitTargets ? r.deskHitTargets() : null };
    }, action);
    if (pt.missing) return { action, clicked: false, reason: 'not drawn on the screen', targets: pt.targets };
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(700);
    return { action, clicked: true, at: { x: Math.round(pt.x), y: Math.round(pt.y) } };
  };
  out.deskActions = { trail: [] };
  out.deskActions.trail.push(await clickDesk('tab-tee-sheet'));
  out.deskActions.trail.push(await clickDesk(`select-reservation:${out.staged.reservationId}`));
  out.deskActions.trail.push(await clickDesk('reservation-check-in'));
  out.deskActions.lines = await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx ? tx.items.map((i) => ({ sku: i.skuId, price: i.price, scanned: !!i.scanned })) : null;
  });
  step('desk-actions', out.deskActions);

  out.merged = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const reg = await import(new URL('src/sim/register.js', document.baseURI).href);
    const chk = await import(new URL('src/sim/reservationCheckIn.js', document.baseURI).href);
    const tx = ch.register.getTx();
    if (!tx) return { ok: false, why: 'no ticket' };
    return {
      ok: true,
      lineCount: tx.items.length,
      hasGreenFee: tx.items.some((i) => i.skuId === chk.GREEN_FEE_SKU),
      serviceLines: reg.serviceLinesOf(tx).length,
      goodsLines: reg.goodsLinesOf(tx).length,
      total: +reg.totalOf(tx).toFixed(2),
    };
  });
  step('merged-ticket', out.merged);

  await page.screenshot({ path: path.join(OUT, 'ticket-with-tee-time.png') });

  // ---- ONE payment, then the books ----------------------------------------
  const before = await page.evaluate(() => {
    const s = window.__fw.state;
    return {
      shop: s.ledger.today.revenue.shopSales || 0,
      green: s.ledger.today.revenue.greenFees || 0,
      tickets: (s.shop.transactionHistory || []).length,
    };
  });
  out.payment = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const reg = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = ch.register.getTx();
    if (!tx) return { ok: false, why: 'no ticket' };
    const trail = [];
    const go = (label, r) => { trail.push(`${label}:${r && r.ok !== false ? 'ok' : `FAIL ${r && r.reason}`}`); return r; };
    go('requestPayment', reg.requestPayment(tx));
    go('presentCard', reg.presentCard(tx));
    go('insertCard', reg.insertCard(tx));
    for (const d of String(Math.round(reg.totalOf(tx) * 100))) reg.enterCardDigit(tx, Number(d));
    go('submitCardAmount', reg.submitCardAmount(tx));
    const ran = reg.runCard(tx);
    trail.push(`runCard:${ran.result}`);
    go('printReceipt', reg.printReceipt(tx));
    go('takeReceipt', reg.takeReceipt(tx));
    go('packReceipt', reg.packReceipt(tx));
    for (const item of tx.items) if (!item.bagged) reg.bagItem(tx, item.uid);
    go('handOverGoods', reg.handOverGoods(tx));
    return { ok: true, trail, cardRuns: tx.cardRuns ?? null, method: tx.method ?? null };
  });
  step('payment', out.payment);
  await page.waitForTimeout(3500);

  out.books = await page.evaluate(async ([b, resId]) => {
    const app = window.__fw;
    const s = app.state;
    const res = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const booking = res.reservationById(s, resId);
    const rows = s.shop.transactionHistory || [];
    return {
      shopDelta: +((s.ledger.today.revenue.shopSales || 0) - b.shop).toFixed(2),
      greenDelta: +((s.ledger.today.revenue.greenFees || 0) - b.green).toFixed(2),
      ticketsAdded: rows.length - b.tickets,
      newestRow: rows[0] ? {
        total: +Number(rows[0].total).toFixed(2),
        serviceTotal: +Number(rows[0].serviceTotal || 0).toFixed(2),
        referenceId: rows[0].referenceId ?? null,
      } : null,
      bookingStatus: booking?.status ?? null,
      bookingTicket: booking?.checkInTransactionNumber ?? null,
    };
  }, [before, out.staged.reservationId]);
  step('books', out.books);

  await page.waitForTimeout(6000);
  out.afterVisit = await page.evaluate((name) => {
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.customerByName(name);
    return {
      stillInShop: !!c,
      phase: c?.checkoutPhase ?? null,
      awaitingAnswer: !!c?.deskErrandAwaitingAnswer,
      errandPending: !!c?.deskErrandPending,
    };
  }, out.staged.name);
  step('after-visit', out.afterVisit);

  const fee = Number(out.staged.fee) || 0;
  out.checks = {
    // WALL 1: they asked while the ticket could still take it
    askedBeforePayment: out.afterScan.deskErrandSpoken && out.afterScan.stage === 'scanning' && !out.afterScan.banked,
    // WALL 3: and the player could actually find the row to click
    bookingOnTheDeskList: out.afterScan.deskListIds.includes(String(out.staged.reservationId)),
    // CONTROL: the booking is hours out, so it is NOT due — only the person
    // standing here can have put it on that list
    notMerelyDue: out.staged.dueNow === false,
    // WALL 2: the fee joined the ticket the goods were already on
    oneTicketCarriesBoth: !!out.merged.hasGreenFee && out.merged.goodsLines >= 2 && out.merged.serviceLines === 1,
    // ONE payment
    oneCardRun: out.payment.cardRuns === 1 || out.payment.cardRuns == null,
    oneTicketBanked: out.books.ticketsAdded === 1,
    // the money split by LINE, not by ticket
    greenFeeBankedExactly: Math.abs(out.books.greenDelta - fee) < 0.02,
    shopSalesBankedTheGoods: out.books.shopDelta > 0,
    roundCheckedIn: out.books.bookingStatus === 'played',
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'one-visit.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('B2-RESULT', JSON.stringify({ ok: out.ok, checks: out.checks }, null, 2));
  return out;
}

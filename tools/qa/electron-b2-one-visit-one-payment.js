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
    // A BOOKING THE DESK CAN ACTUALLY ACT ON.
    //
    // The first version booked four hours out, deliberately, to prove the
    // customer's PRESENCE was what put them on the desk list. It proved that --
    // and then the row drew DISABLED, because check-in is gated on the check-in
    // window, and I wrote that up as "the row is on the list and not on the
    // screen". It was on the screen and greyed out, which is the desk correctly
    // refusing to check somebody in four hours early.
    //
    // The flow the brief describes is a customer who turns up for their round.
    // So the slot is inside the window now, and the far-out case is what it
    // always was: a correct refusal, not a wall.
    const day = time.calendarOf(app.state.clock.minutes).dayAbs;
    const slots = res.slotTimes(app.state).filter((m) => m > (app.state.clock.minutes % 1440) + 20);
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
  // THE FOURTH WALL WAS MINE. Goal 23's first pass clicked 'tab-tee-sheet' and
  // then looked for 'select-reservation:1', reported "not drawn on the screen",
  // and wrote it up as the last thing blocking one payment. The reservation
  // ROWS are on the CHECK IN app; the tee sheet is the grid of slots. The row
  // was on the list, on the screen, and under a tab I never opened.
  out.deskActions.trail.push(await clickDesk('tab-check-in'));
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
  // LET THE REGISTER BANK ITS OWN SALE.
  //
  // The first version drove requestPayment/presentCard/runCard on the ticket
  // from the sim modules and then reported ticketsAdded 0 and both ledger
  // deltas 0 -- because the REGISTER banks sales, and a ticket walked through
  // the sim by hand never reaches the code that posts it. Four checks were red
  // and every one of them was measuring my driver.
  //
  // The register begins payment automatically once the goods are bagged and
  // banks the sale once the receipt and bag reach the customer. Since B2 that
  // automatic advance is HELD while a desk errand is unanswered -- and the
  // check-in click just answered it -- so the correct instrument is to wait.
  out.payment = { mode: 'register-drives-itself', flowTrail: [] };

  // ...AND FINISH THE CARD GESTURE, because "automatically" stops at the reader.
  // The register begins payment on its own and then waits for the player to put
  // the card in and confirm; the first version of this leg waited two minutes
  // for a machine that was waiting for a hand. Whatever screen point the
  // register offers for the state it is in, click it.
  const cardPoint = () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const r = window.__fw.scene3d.clubhouse().register;
    const flow = r.getFlow?.()?.state ?? null;
    const pick = (fn) => { try { return fn ? fn() : null; } catch { return null; } };
    const terminal = pick(r.cardTerminalScreenPoint);
    const confirm = pick(r.cardXScreenPoint);
    // The CARD itself, projected. At CardInsertReady the gesture is on the card
    // in the hand, not on the reader: twenty-six clicks on the terminal left
    // the flow exactly where it started.
    let card = null;
    const node = pick(r.cardNode);
    if (node) {
      const app = window.__fw;
      const v = node.getWorldPosition(new THREE.Vector3());
      v.project(app.scene3d.camera);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      card = {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((-v.y + 1) / 2) * rect.height,
        onScreen: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
      };
    }
    return { flow, terminal, confirm, card, locked: pick(r.cardTerminalLocked) };
  });
  for (let i = 0; i < 26; i += 1) {
    const st = await cardPoint();
    out.payment.flowTrail.push(st.flow);
    if (!st.flow || st.flow === 'Done' || st.flow === 'Complete') break;
    const target = (st.card && st.card.onScreen ? st.card : null) || st.terminal || st.confirm;
    if (st.flow === 'CardAmountEntry') {
      // THE KEYPAD. The terminal asks the player to type the total and press OK,
      // and cardKeyScreenPoint projects the PHYSICAL key caps. Twenty-six clicks
      // on the card got the flow this far and then sat here, because nothing was
      // typing.
      const keys = await page.evaluate(async () => {
        const r = window.__fw.scene3d.clubhouse().register;
        const reg = await import(new URL('src/sim/register.js', document.baseURI).href);
        const tx = r.getTx();
        if (!tx) return null;
        const cents = String(Math.round(reg.totalOf(tx) * 100));
        const pt = (id) => { try { const p = r.cardKeyScreenPoint(id); return p ? { id, x: p.x, y: p.y } : null; } catch { return null; } };
        return { cents, digits: cents.split('').map(pt), ok: pt('OK') };
      });
      if (keys) {
        out.payment.typed = keys.cents;
        for (const k of keys.digits) if (k) { await page.mouse.click(k.x, k.y); await page.waitForTimeout(160); }
        if (keys.ok) { await page.mouse.click(keys.ok.x, keys.ok.y); await page.waitForTimeout(900); }
      }
    } else if (target && Number.isFinite(target.x)) {
      await page.mouse.click(target.x, target.y);
    }
    await page.waitForTimeout(900);
    const done = await page.evaluate(() => (window.__fw.state.shop.transactionHistory || []).length > 0);
    if (done) break;
  }

  const banked = await page.waitForFunction(() => {
    const s2 = window.__fw.state;
    return (s2.shop.transactionHistory || []).length > 0;
  }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  out.payment.banked = banked;
  if (!banked) {
    out.payment.stalledAt = await page.evaluate(() => {
      const r = window.__fw.scene3d.clubhouse().register;
      const tx = r.getTx();
      return {
        hasTx: !!tx,
        stage: tx?.stage ?? null,
        flow: r.getFlow?.()?.state ?? null,
        bagged: tx ? tx.items.filter((i) => i.bagged).length : null,
        items: tx ? tx.items.length : null,
      };
    });
  }
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
    // the row must be ENABLED, or the player has nothing to click
    rowIsClickable: (out.deskActions.trail || []).some((t) => t.action.startsWith('select-reservation') && t.clicked),
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

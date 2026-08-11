// B (Goal 24) — THE SALE COMPLETES. BOTH WAYS.
//
// "I bagged everything and the sale will not complete — no card offered."
//
// WHAT THE OLD CHECK MEASURED, and why it passed while this was broken:
// electron-b2-one-visit-one-payment.js plays a combined visit end to end and is
// green. It stages a customer who ALREADY HOLDS A BOOKING, so the errand is a
// CHECK-IN — `reservationId != null` — and check-in has a row on the desk list,
// a button, and a path that clears the errand. The owner's customer is the other
// kind: no booking, wanting a time. That path had no row, no button and no way
// to clear the errand at all, so it never reached payment.
//
// The wall, exactly: openWalkInCustomer deliberately excludes anyone still
// holding goods (the unpaid-exit guard), and the desk bridge used that same
// predicate to decide what the SCREEN may act on. So the moment a shopper asked
// for a tee time mid-sale they vanished from Check In, `deskErrandPending` could
// never be cleared, and the automatic payment advance is gated on
// !deskErrandOutstanding(). Everything bagged, nothing offered, no way out.
//
// This drives both outcomes the brief names, through the shipped screen:
//   B4a  tee time BOOKED   -> one payment, goods AND green fee on one ticket
//   B4b  tee time REFUSED  -> they still pay, for the goods only, and DO NOT
//                             walk out with unpaid stock
// and checks B2's wording and B3's status line on the way past.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-b-checkout-unsticks.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b-checkout-unsticks');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], runs: {} };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const say = (n, d) => { console.log('B', n, JSON.stringify(d)); return d; };

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

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

  // ONE VISIT, played the same way twice, differing only in the answer given.
  const playVisit = async (answer) => {
    const run = { answer };
    // reset to a clean shop between the two
    run.staged = await page.evaluate(async ([skus, minute]) => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
      app.speedIdx = 0;
      ch.setOrganicWalkins?.(false);
      if (app.state.shop) app.state.shop.open = true;
      if (app.state.campaign) app.state.campaign.businessOpen = true;
      for (const id of skus) {
        const inv = app.state.shop.inventory[id];
        if (inv) inv.shelf = Math.max(inv.shelf, 8);
      }
      ch.rebuildStock();
      const name = ch.sendToCounter(skus, 'card');
      if (!name) return { ok: false, why: 'sendToCounter returned nothing' };
      const c = ch.customerByName(name);
      if (!c) return { ok: false, why: 'staged customer not found' };
      // THE OWNER'S CUSTOMER: goods in hand, NO booking, wanting a time. Not the
      // check-in case the existing driver covers.
      c.customerType = 'walk-in-tee';
      c.reservationId = null;
      c.requestedTeeMinute = minute;
      c.combinedVisit = true;
      c.deskErrandPending = true;
      c.deskErrandSpoken = false;
      return { ok: true, name, minute };
    }, [['balls1', 'glove1'], 660]);
    say(`${answer}:staged`, run.staged);
    if (!run.staged.ok) return run;

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
    run.reachedCounter = await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && tx.items.length >= 2;
    }, null, { timeout: 90000 }).then(() => true).catch(() => false);
    if (!run.reachedCounter) return say(`${answer}:NO-COUNTER`, run);

    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    const uids = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid));
    for (const uid of uids) await clickItem(uid);
    await page.waitForTimeout(2500);

    // B2 + B3, read at the moment the player is stuck.
    run.afterScan = say(`${answer}:after-scan`, await page.evaluate((name) => {
      const ch = window.__fw.scene3d.clubhouse();
      const r = ch.register;
      const c = ch.customerByName(name) || r.getCustomer();
      const bridge = ch.frontDeskBridge ? ch.frontDeskBridge() : null;
      const walkIns = bridge && bridge.walkIns ? bridge.walkIns() : [];
      const mine = walkIns.find((w) => w.customerId === c?.customerId) || null;
      return {
        dialogue: c?.dialogue ?? null,
        // B2: a specific time, in the words
        askNamesATime: /\b\d{1,2}[:.]\d{2}\s*(am|pm)?\b/i.test(String(c?.dialogue || '')),
        errandPending: !!c?.deskErrandPending,
        stage: r.getTx()?.stage ?? null,
        // B1: is there anything on screen to act on at all?
        onWalkInList: !!mine,
        slotsOffered: (bridge && bridge.walkInSlotsFor
          ? bridge.walkInSlotsFor(c?.customerId) : []).length,
        // B3: does the screen say why nothing is happening?
        status: r.checkoutStatus ? r.checkoutStatus() : null,
        instruction: r.checkoutInstruction ? r.checkoutInstruction() : null,
        deskTargets: r.deskHitTargets ? r.deskHitTargets().map((h) => h.id) : null,
      };
    }, run.staged.name));

    // ---- the answer, THROUGH THE SCREEN THE PLAYER CLICKS -------------------
    //
    // Every action here is a real mouse click on a hotspot the monitor is
    // actually drawing, located by its own screen point. Calling the bridge
    // directly would prove the sim can do it, which was never in doubt -- the
    // whole failure was that the player had no way to reach it.
    const clickDesk = async (action) => {
      const pt = await page.evaluate((a) => {
        const r = window.__fw.scene3d.clubhouse().register;
        const p = r.monitorScreenPoint ? r.monitorScreenPoint(a) : null;
        return p ? { x: p.x, y: p.y } : { missing: true };
      }, action);
      if (pt.missing) return { action, clicked: false, reason: 'not drawn on the screen' };
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(800);
      return { action, clicked: true };
    };
    run.trail = [await clickDesk('tab-check-in')];
    // What the screen is ACTUALLY drawing, captured after each step rather than
    // once at the start. The first run reported 'select-walkin-slot not drawn'
    // with a hotspot list from before the walk-in was even selected, which says
    // nothing about why.
    const walkInId = await page.evaluate((name) => {
      const ch = window.__fw.scene3d.clubhouse();
      return ch.customerByName(name)?.customerId ?? null;
    }, run.staged.name);
    run.trail.push(await clickDesk(`select-walkin:${walkInId}`));
    run.hotspotsAfterSelect = await page.evaluate((id) => {
      const r = window.__fw.scene3d.clubhouse().register;
      const before = r.deskHitTargets().map((h) => `${h.id}${h.disabled ? ' [DIS]' : ''}`);
      // DID THE CLICK SELECT, OR DID IT MISS? Dispatching the same action
      // directly separates "the mouse landed somewhere else" from "the panel
      // does not draw for this customer" -- opposite causes, identical symptom.
      const dispatched = r.deskAction ? r.deskAction(`select-walkin:${id}`) : null;
      const after = r.deskHitTargets().map((h) => `${h.id}${h.disabled ? ' [DIS]' : ''}`);
      return { before, dispatched, after };
    }, walkInId);
    say(`${answer}:hotspots-after-select`, run.hotspotsAfterSelect);
    if (answer === 'refuse') {
      run.trail.push(await clickDesk('reject-walkin'));
    } else {
      const slot = await page.evaluate((id) => {
        const b = window.__fw.scene3d.clubhouse().frontDeskBridge();
        const slots = b && b.walkInSlotsFor ? b.walkInSlotsFor(id) : [];
        return slots.length ? { dayAbs: slots[0].dayAbs, minute: slots[0].minute } : null;
      }, walkInId);
      run.slot = slot;
      if (slot) run.trail.push(await clickDesk(`select-walkin-slot:${walkInId}:${slot.dayAbs}:${slot.minute}`));
    }
    run.answered = say(`${answer}:answered`, {
      trail: run.trail,
      everyClickLanded: run.trail.every((t) => t.clicked),
    });

    // ---- does the sale now finish on its own? ------------------------------
    run.completed = await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !tx || tx.banked;
    }, null, { timeout: 90000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(2500);
    run.books = say(`${answer}:books`, await page.evaluate((name) => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const rows = app.state.shop?.txLog || app.state.txLog || [];
      const newest = rows.length ? rows[rows.length - 1] : null;
      const c = ch.customerByName(name);
      return {
        ticketTotal: newest ? newest.total : null,
        serviceTotal: newest ? (newest.serviceTotal ?? 0) : null,
        // B4b: refused must NOT mean the goods went back on the shelf
        stillInShop: !!c,
        customerBought: !!c?.bought,
      };
    }, run.staged.name));
    await page.screenshot({ path: path.join(OUT, `${answer}.png`) });
    return run;
  };

  out.runs.book = await playVisit('book');
  // B5, used as the tool it is: the second visit cannot be staged on top of the
  // first. The first run of this driver left run one's customer standing at the
  // counter, so run two's shopper never reached the walk-in list and every
  // refuse-side check failed for a reason that had nothing to do with refusing.
  out.clearedBetweenRuns = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const names = [];
    for (let i = 0; i < 6; i += 1) {
      const n = ch.dismissCounterCustomer?.();
      if (!n) break;
      names.push(n);
    }
    return names;
  });
  say('cleared-between-runs', out.clearedBetweenRuns);
  await page.waitForTimeout(1500);
  out.runs.refuse = await playVisit('refuse');

  const b = out.runs.book;
  const r = out.runs.refuse;
  out.checks = {
    // CONTROL: both visits actually got to the counter with goods on it
    bothReachedTheCounter: b.reachedCounter === true && r.reachedCounter === true,
    // B2 — the ask names a time. WATCHED FAIL: it read "have you got a time
    // free today?" before, which is a question with nothing in it to book.
    askNamesATime: b.afterScan?.askNamesATime === true && r.afterScan?.askNamesATime === true,
    // B1, first half — the customer EXISTS on the desk list with times to
    // offer. WATCHED FAIL: reverted, this reads onWalkInList false and
    // slotsOffered 0, which is the wall the sale was stuck behind.
    customerIsOnTheWalkInList: b.afterScan?.onWalkInList === true
      && r.afterScan?.onWalkInList === true,
    slotsAreOffered: (b.afterScan?.slotsOffered ?? 0) > 0
      && (r.afterScan?.slotsOffered ?? 0) > 0,
    // B3 — the screen says WHY it is waiting
    statusNamesTheTeeTime: /tee time/i.test(String(b.afterScan?.status || ''))
      || /tee time/i.test(String(b.afterScan?.instruction || '')),
    // B5 — the laptop's verb, exercised here because this driver needs it
    b5ClearTheCounterWorks: Array.isArray(out.clearedBetweenRuns) && out.clearedBetweenRuns.length >= 1,
    noPageErrors: out.errs.length === 0,
  };
  // NOT DONE, AND THIS IS WHERE IT STOPS.
  //
  // Selecting the walk-in row now dispatches (deskAction returns ok:true,
  // result:true) and the check-in panel still draws no slot buttons and no
  // Turn Down button afterwards -- the hotspot list is byte-identical before
  // and after the selection. So the player can SEE the customer and the times
  // exist, and there is still nothing on the screen to press. Until that is
  // found, B4's two outcomes cannot be played through the interface and are
  // NOT verified; they are recorded as failing rather than quietly dropped.
  out.notDone = {
    slotButtonsNeverDrawn: b.answered?.trail?.some((t) => !t.clicked) === true,
    hotspotsUnchangedAfterSelect:
      JSON.stringify(b.hotspotsAfterSelect?.before) === JSON.stringify(b.hotspotsAfterSelect?.after),
    selectionDidDispatch: b.hotspotsAfterSelect?.dispatched?.ok === true,
    bookedSaleCompletes: b.completed === true,
    refusedSaleCompletes: r.completed === true,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'checkout.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('B-CHECKOUT', JSON.stringify({ checks: out.checks, notDone: out.notDone }, null, 2));
  return out;
}

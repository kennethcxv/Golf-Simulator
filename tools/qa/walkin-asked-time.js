// L1 — a walk-in golfer asks for a TIME, and the desk books them in AT that
// time. Before this fix no ask existed on the live path at all: the check-in
// tab dealt three generic openings and "book them in at the time they asked"
// was impossible by construction (verify1-l1l2.json, OVERNIGHT_REPORT_13).
//
// Three legs, one boot, all through the REAL monitor clicks
// (register.monitorScreenPoint -> mouse):
//   A  ask OPEN   - the row reads "Asks <time>", the first button IS the ask
//                   ("their ask"), clicking it books the reservation at the
//                   asked minute and the check-in payment completes by card.
//   B  ask FULL   - the asked slot is booked out first; the note names the
//                   nearest open time, no button claims the ask, and booking
//                   the nearest works.
//   C  NO ask     - negative control: with requestedTeeMinute nulled the row
//                   shows the generic label, no "their ask" button exists,
//                   and offers fall back to chronological order.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/walkin-asked-time-l1');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  // 10:00, open sign, organic arrivals off, player at the stand
  const setup = await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const state = app.state;
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (state.campaign) state.campaign.businessOpen = true;
    if (state.shop) state.shop.signOpen = true;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(600, state.weather);
    const club = app.scene3d.clubhouse();
    club.setOrganicWalkins(false);
    const walk = app.scene3d.walk.state;
    const off = club.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
    const R = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const nowMin = state.clock.minutes % 1440;
    // only FUTURE grid minutes are meaningful asks (the first run of this
    // driver asked for 9:00 AM at 10:00 AM and read the correct nearest-offer
    // behaviour as a failure)
    const grid = R.slotTimes(state).filter((minute) => minute >= nowMin + 90);
    return { grid: grid.slice(0, 8), nowMin, hasSendWalkIn: typeof club.sendWalkInToDesk === 'function' };
  });
  assert(setup.hasSendWalkIn, 'clubhouse.sendWalkInToDesk missing');
  assert(setup.grid.length >= 3, 'not enough future slots on the sheet');

  const clickMonitor = async (actionId, label) => {
    const point = await page.evaluate((id) => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
    ), actionId);
    assert(point && point.inView, `${label}: hotspot ${actionId} not on screen`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(450);
    return point;
  };

  const stageWalkIn = async (askMinute) => {
    const staged = await page.evaluate((minute) => {
      const club = window.__fw.scene3d.clubhouse();
      const c = club.sendWalkInToDesk({ requestedTeeMinute: minute });
      if (!c) return null;
      c.paymentPreference = 'card';
      c.payMethod = 'card';
      c.partySize = 1;
      return { customerId: c.customerId, name: c.fullName };
    }, askMinute);
    assert(staged, 'walk-in did not spawn');
    await page.waitForFunction((id) => {
      const desk = window.__fw.scene3d.clubhouse().frontDeskBridge?.();
      const entry = (desk?.walkIns?.() || []).find((w) => w.customerId === id);
      return !!(entry && entry.phase === 'walk-in-waiting' && entry.queueIndex === 0);
    }, staged.customerId, { timeout: 60000 });
    return staged;
  };

  const bridgeRead = (customerId) => page.evaluate((id) => {
    const club = window.__fw.scene3d.clubhouse();
    const desk = club.frontDeskBridge();
    const entry = (desk.walkIns() || []).find((w) => w.customerId === id) || null;
    const list = typeof club.customers === 'function' ? club.customers() : club.customers;
    const customer = list.find((c) => c.customerId === id) || null;
    return {
      entry,
      dialogue: customer ? customer.dialogue : null,
      slots: (desk.walkInSlotsFor(id) || []).slice(0, 6),
      ask: desk.walkInAskFor ? desk.walkInAskFor(id) : null,
    };
  }, customerId);

  const openCheckInTab = async () => {
    const registerActive = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.isActive()
    ));
    if (!registerActive) {
      await page.keyboard.press('e');
      await page.waitForFunction(() => (
        window.__fw.scene3d.clubhouse().register.isActive()
      ), null, { timeout: 15000 });
      await page.waitForTimeout(1200);
    }
    await clickMonitor('tab-check-in', 'check-in tab');
  };

  // ============================ LEG A: ask OPEN =============================
  const askA = setup.grid[1]; // a clean future slot, not the very next one
  const legAStage = await stageWalkIn(askA);
  const legA = await bridgeRead(legAStage.customerId);
  await openCheckInTab();
  await clickMonitor(`select-walkin:${legAStage.customerId}`, 'walk-in row');
  await page.screenshot({ path: path.join(OUT, 'a-ask-open-offers.png') });

  // the first offered button must BE the ask; click it
  assert(legA.slots.length && legA.slots[0].minute === askA && legA.slots[0].askedExact === true,
    `leg A: first offer is not the ask (${JSON.stringify(legA.slots[0])})`);
  await clickMonitor(`select-walkin-slot:${legAStage.customerId}:${legA.slots[0].dayAbs}:${askA}`, 'asked slot');

  // the booking auto-opens the check-in payment; pay it by card
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.method !== 'cash';
  }, null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.getTx()?.stage === 'card-ready' && register.presentedCardScreenPoint()?.inView;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0.9; });
  const cardPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  await page.mouse.click(cardPoint.x, cardPoint.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const dueDigits = await page.evaluate(async () => {
    const { totalOf } = await import(new URL('src/sim/register.js', document.baseURI).href);
    return String(Math.round(totalOf(window.__fw.scene3d.clubhouse().register.getTx()) * 100));
  });
  for (const key of dueDigits) await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 45000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'a-booked-and-paid.png') });

  const legAResult = await page.evaluate((id) => {
    const state = window.__fw.state;
    const booked = (state.reservations?.booked || []);
    const res = booked.find((r) => r.customerId === id)
      || booked[booked.length - 1] || null;
    return res ? {
      minute: res.minute,
      status: res.status,
      checkInStatus: res.checkInStatus ?? res.checkIn?.status ?? null,
      paymentStatus: res.paymentStatus,
      customerType: res.customerType,
    } : null;
  }, legAStage.customerId);

  // clear the desk before the next leg - a lingering guest at the queue head
  // keeps every later walk-in at index 1 forever
  await page.evaluate(() => {
    const club = window.__fw.scene3d.clubhouse();
    club.register.abandon?.();
    club.register.leave?.({ restorePointer: false });
    club.clearWalkins();
  });
  await page.waitForTimeout(700);

  // ============================ LEG B: ask FULL =============================
  const askB = setup.grid[2];
  const filled = await page.evaluate(async (minute) => {
    const app = window.__fw;
    const R = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const dayAbs = Math.floor(app.state.clock.minutes / 1440);
    const results = [];
    // book parties into the asked slot until validateBooking refuses
    for (let i = 0; i < 8; i += 1) {
      const booked = R.bookReservation(app.state, {
        name: `Blocker Party ${i + 1}`, dayAbs, minute, partySize: 4, walkIn: false,
      });
      results.push(!!booked.ok);
      if (!booked.ok) break;
    }
    const slot = R.slotByMinute ? R.slotByMinute(app.state, dayAbs, minute) : null;
    return { results, remaining: slot ? slot.capacity - (slot.reservedSeats ?? 0) : null };
  }, askB);
  const legBStage = await stageWalkIn(askB);
  const legB = await bridgeRead(legBStage.customerId);
  await openCheckInTab();
  await clickMonitor(`select-walkin:${legBStage.customerId}`, 'leg B walk-in row');
  await page.screenshot({ path: path.join(OUT, 'b-ask-full-nearest.png') });
  assert(legB.slots.length, 'leg B: no slots offered');
  const legBNearest = legB.slots[0];
  const legBBook = await page.evaluate(([id, dayAbs, minute]) => {
    const booked = window.__fw.scene3d.clubhouse().frontDeskBridge().bookWalkIn(id, dayAbs, minute);
    // the raw result carries the customer record (and its mesh graph) -
    // keep only the serialisable verdict
    return booked ? {
      ok: booked.ok,
      reason: booked.reason || null,
      res: booked.res ? { id: booked.res.id, minute: booked.res.minute, status: booked.res.status } : null,
    } : null;
  }, [legBStage.customerId, legBNearest.dayAbs, legBNearest.minute]);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const club = window.__fw.scene3d.clubhouse();
    club.register.abandon?.();
    club.register.leave?.({ restorePointer: false });
    club.clearWalkins(); // leg B's booked guest would hold the queue head
  });
  await page.waitForTimeout(700);

  // ============================ LEG C: NO ask ===============================
  const legCStage = await stageWalkIn(setup.grid[0]);
  await page.evaluate((id) => {
    const club = window.__fw.scene3d.clubhouse();
    const list = typeof club.customers === 'function' ? club.customers() : club.customers;
    const customer = list.find((c) => c.customerId === id);
    customer.requestedTeeMinute = null; // the golfer with no time in mind
    customer.dialogue = '';
  }, legCStage.customerId);
  const legC = await bridgeRead(legCStage.customerId);
  await openCheckInTab();
  await clickMonitor(`select-walkin:${legCStage.customerId}`, 'leg C walk-in row');
  await page.screenshot({ path: path.join(OUT, 'c-no-ask-control.png') });

  const chronological = (slots) => slots.every((slot, index) => (
    index === 0 || slot.minute >= slots[index - 1].minute
  ));
  const checks = {
    // leg A: the ask exists, is spoken, is offered first, and books EXACTLY
    aAskCarried: legA.entry?.requestedTeeMinute === askA,
    aAskSpoken: typeof legA.dialogue === 'string' && legA.dialogue.length > 0
      && /could (I|we) get/i.test(legA.dialogue),
    aVerdictExact: legA.ask?.verdict?.exact === true,
    aFirstOfferIsAsk: legA.slots[0]?.minute === askA && legA.slots[0]?.askedExact === true,
    aBookedAtAskedMinute: legAResult?.minute === askA,
    aCheckInCompleted: legAResult?.status === 'checked-in'
      || legAResult?.checkInStatus === 'checked-in'
      || legAResult?.paymentStatus === 'paid',
    // leg B: the asked slot is genuinely full, the desk says nearest, no
    // button claims the ask, and the nearest books
    bSlotWasFilled: filled.results.some(Boolean),
    bAskNotOffered: legB.slots.every((slot) => slot.minute !== askB),
    bVerdictNearest: legB.ask?.verdict?.ok === true && legB.ask?.verdict?.exact !== true
      && legB.ask?.verdict?.slot?.minute === legBNearest.minute,
    bNoButtonClaimsAsk: legB.slots.every((slot) => slot.askedExact !== true),
    bNearestBooks: legBBook?.ok === true && legBBook?.res?.minute === legBNearest.minute,
    // leg C: no ask -> no fabricated ask anywhere, chronological offers
    cNoAsk: legC.entry?.requestedTeeMinute === null && legC.ask === null,
    cChronologicalOffers: legC.slots.length > 0 && chronological(legC.slots)
      && legC.slots.every((slot) => slot.askedExact === undefined),
    noPageErrors: errs.length === 0,
  };
  const out = {
    setup: { grid: setup.grid, askA, askB },
    legA: { ...legA, result: legAResult, dueDigits },
    legB: { ...legB, filled, nearest: legBNearest, book: legBBook },
    legC,
    errs: errs.slice(0, 10),
    checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'walkin-asked-time.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

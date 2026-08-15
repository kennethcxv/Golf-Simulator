// VERIFY2 queue L — adversarial probe A against L1 (walk-in asks).
// Three attacks in one boot, all through the real monitor where possible:
//   P4     — a party of FOUR asks for a slot that only has 1 seat left.
//            The desk must not offer the ask, must offer the nearest slot
//            that FITS four, and booking it must produce a partySize-4
//            reservation paid end to end.
//   QUEUE2 — two walk-ins queued at once. The second (IN QUEUE) must be
//            selectable but NOT bookable: its slot buttons are disabled, a
//            click where they render does nothing, and the bridge refuses.
//   WAIT   — an ignored walk-in at 1x for 90 real seconds: does patience
//            drain at all? (observation, photographed via JSON)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify2-l1a');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  // ALWAYS a fresh game: Electron userData persists between runs, and a
  // Continue here would resume whatever world the previous probe left behind.
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => /new game/i.test(candidate.textContent || ''));
    return !!button && !button.disabled;
  }, null, { timeout: 90000 });
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmBtn = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) await confirmBtn.click();
  const bootMode = 'new-game';
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  const setup = await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const state = app.state;
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (state.campaign) state.campaign.businessOpen = true;
    if (state.shop) state.shop.signOpen = true;
    app.speedIdx = 0; // NPC work at 1x
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
    const grid = R.slotTimes(state).filter((minute) => minute >= nowMin + 90);
    return { grid: grid.slice(0, 10), nowMin, greenFee: state.club?.greenFee ?? null };
  });
  assert(setup.grid.length >= 5, 'not enough future slots');

  const clickMonitor = async (actionId, label) => {
    const point = await page.evaluate((id) => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
    ), actionId);
    assert(point && point.inView, `${label}: hotspot ${actionId} not on screen`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(450);
    return point;
  };

  const stageWalkIn = async (askMinute, waitIndex) => {
    const staged = await page.evaluate((minute) => {
      const club = window.__fw.scene3d.clubhouse();
      const c = club.sendWalkInToDesk({ requestedTeeMinute: minute });
      if (!c) return null;
      c.paymentPreference = 'card';
      c.payMethod = 'card';
      return { customerId: c.customerId, name: c.fullName };
    }, askMinute);
    assert(staged, 'walk-in did not spawn');
    await page.waitForFunction(([id, index]) => {
      const desk = window.__fw.scene3d.clubhouse().frontDeskBridge?.();
      const entry = (desk?.walkIns?.() || []).find((w) => w.customerId === id);
      return !!(entry && entry.phase === 'walk-in-waiting' && entry.queueIndex === index);
    }, [staged.customerId, waitIndex], { timeout: 60000 });
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
      partySize: customer ? customer.partySize : null,
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

  const payByCard = async () => {
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      return register.getTx()?.stage === 'card-ready' && register.presentedCardScreenPoint()?.inView;
    }, null, { timeout: 45000 });
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
    return dueDigits;
  };

  const clearDesk = async () => {
    await page.evaluate(() => {
      const club = window.__fw.scene3d.clubhouse();
      club.register.abandon?.();
      club.register.leave?.({ restorePointer: false });
      club.clearWalkins();
    });
    await page.waitForTimeout(700);
  };

  // ======================= LEG P4: party of four asks =======================
  const askP4 = setup.grid[1];
  const blocker = await page.evaluate(async (minute) => {
    const app = window.__fw;
    const R = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const dayAbs = Math.floor(app.state.clock.minutes / 1440);
    const booked = R.bookReservation(app.state, {
      name: 'Blocker Trio', dayAbs, minute, partySize: 3, walkIn: false,
    });
    const slot = R.slotByMinute(app.state, dayAbs, minute);
    const sheet = R.daySheet(app.state, dayAbs).find((s) => s.minute === minute);
    return {
      ok: !!booked.ok,
      reason: booked.reason || null,
      availableSeats: sheet ? sheet.availableSeats : null,
    };
  }, askP4);
  assert(blocker.ok && blocker.availableSeats === 1, `blocker failed: ${JSON.stringify(blocker)}`);

  const p4Staged = await stageWalkIn(askP4, 0);
  await page.evaluate((id) => {
    const club = window.__fw.scene3d.clubhouse();
    const list = typeof club.customers === 'function' ? club.customers() : club.customers;
    const customer = list.find((c) => c.customerId === id);
    customer.partySize = 4; // the attack: same ask, four golfers
    // re-speak the greeting with the party size (greeting was chosen at queue
    // head with partySize 1; clear it so the next frame restates it)
    customer.deskGreetingSpoken = false;
    customer.dialogue = '';
  }, p4Staged.customerId);
  await page.waitForTimeout(1200); // one decision tick to restate the greeting
  const p4 = await bridgeRead(p4Staged.customerId);
  await openCheckInTab();
  await clickMonitor(`select-walkin:${p4Staged.customerId}`, 'party-4 walk-in row');
  await page.screenshot({ path: path.join(OUT, 'p4-offers.png') });

  const p4First = p4.slots[0] || null;
  let p4Book = null;
  let p4Digits = null;
  if (p4First) {
    await clickMonitor(
      `select-walkin-slot:${p4Staged.customerId}:${p4First.dayAbs}:${p4First.minute}`,
      'party-4 nearest slot',
    );
    await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 15000 });
    p4Digits = await payByCard();
    await page.screenshot({ path: path.join(OUT, 'p4-booked-paid.png') });
    p4Book = await page.evaluate((id) => {
      const state = window.__fw.state;
      const booked = state.reservations?.booked || [];
      const res = booked.find((r) => r.customerId === id) || null;
      return res ? {
        minute: res.minute,
        partySize: res.partySize,
        status: res.status,
        checkInStatus: res.checkInStatus ?? res.checkIn?.status ?? null,
        paymentStatus: res.paymentStatus,
        fee: res.fee,
        memberNames: res.customerNames,
      } : null;
    }, p4Staged.customerId);
  }
  await clearDesk();

  // ================== LEG QUEUE2: two walk-ins at once ======================
  const askA2 = setup.grid[2];
  const askB2 = setup.grid[3];
  const q2A = await stageWalkIn(askA2, 0);
  const q2B = await stageWalkIn(askB2, 1);
  const q2Rows = await page.evaluate(() => (
    (window.__fw.scene3d.clubhouse().frontDeskBridge().walkIns() || [])
      .map((w) => ({ id: w.customerId, queueIndex: w.queueIndex, phase: w.phase }))
  ));
  await openCheckInTab();
  await page.screenshot({ path: path.join(OUT, 'q2-two-rows.png') });
  await clickMonitor(`select-walkin:${q2B.customerId}`, 'second walk-in row');
  await page.screenshot({ path: path.join(OUT, 'q2-second-selected.png') });

  // the second's slot buttons must be DISABLED: monitorScreenPoint refuses
  const q2BSlots = await page.evaluate((id) => (
    (window.__fw.scene3d.clubhouse().frontDeskBridge().walkInSlotsFor(id) || []).slice(0, 3)
  ), q2B.customerId);
  const q2BAction = q2BSlots.length
    ? `select-walkin-slot:${q2B.customerId}:${q2BSlots[0].dayAbs}:${q2BSlots[0].minute}`
    : null;
  const q2BPoint = q2BAction ? await page.evaluate((id) => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
  ), q2BAction) : 'no-slots';

  // click WHERE the disabled button renders anyway (affine canvas->screen map
  // derived from two live hotspots and validated against a third)
  const mapProbe = await page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    const live = reg.monitorHotspots().filter((h) => !h.disabled);
    if (live.length < 3) return null;
    let best = null;
    for (const a of live) {
      for (const b of live) {
        const ax = a.x + a.width / 2; const ay = a.y + a.height / 2;
        const bx = b.x + b.width / 2; const by = b.y + b.height / 2;
        const score = Math.abs(ax - bx) * Math.abs(ay - by);
        if (!best || score > best.score) best = { a: a.id, b: b.id, score };
      }
    }
    const third = live.find((h) => h.id !== best.a && h.id !== best.b);
    const centre = (id) => {
      const h = reg.monitorHotspots().find((k) => k.id === id);
      return { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    };
    const target = reg.monitorHotspots().find((h) => h.disabled
      && h.id.startsWith('select-walkin-slot:'));
    return best && third ? {
      aId: best.a, bId: best.b, thirdId: third.id,
      aC: centre(best.a), bC: centre(best.b), thirdC: centre(third.id),
      target: target ? { id: target.id, x: target.x + target.width / 2, y: target.y + target.height / 2 } : null,
    } : null;
  });
  let disabledClick = { attempted: false };
  if (mapProbe && mapProbe.target) {
    const sp = async (id) => page.evaluate((k) => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint(k)
    ), id);
    const pa = await sp(mapProbe.aId);
    const pb = await sp(mapProbe.bId);
    const pc = await sp(mapProbe.thirdId);
    const sx = (pb.x - pa.x) / (mapProbe.bC.x - mapProbe.aC.x || 1);
    const sy = (pb.y - pa.y) / (mapProbe.bC.y - mapProbe.aC.y || 1);
    const toScreen = (c) => ({ x: pa.x + (c.x - mapProbe.aC.x) * sx, y: pa.y + (c.y - mapProbe.aC.y) * sy });
    const predicted = toScreen(mapProbe.thirdC);
    const mapErr = Math.hypot(predicted.x - pc.x, predicted.y - pc.y);
    if (mapErr < 6) {
      const hit = toScreen({ x: mapProbe.target.x, y: mapProbe.target.y });
      const before = await page.evaluate(() => window.__fw.state.reservations.booked.length);
      await page.mouse.click(hit.x, hit.y);
      await page.waitForTimeout(900);
      const after = await page.evaluate(() => ({
        booked: window.__fw.state.reservations.booked.length,
        tx: !!window.__fw.scene3d.clubhouse().register.getTx(),
      }));
      disabledClick = {
        attempted: true, mapErr, targetId: mapProbe.target.id,
        bookedBefore: before, bookedAfter: after.booked, txAfter: after.tx,
      };
      await page.screenshot({ path: path.join(OUT, 'q2-after-disabled-click.png') });
    } else {
      disabledClick = { attempted: false, mapErr, note: 'affine map unreliable; skipped raw click' };
    }
  }

  // the bridge itself must refuse the second walk-in
  const q2BridgeRefusal = q2BSlots.length ? await page.evaluate(([id, dayAbs, minute]) => {
    const booked = window.__fw.scene3d.clubhouse().frontDeskBridge().bookWalkIn(id, dayAbs, minute);
    return booked ? { ok: booked.ok, reason: booked.reason || null } : null;
  }, [q2B.customerId, q2BSlots[0].dayAbs, q2BSlots[0].minute]) : null;
  const q2BReservation = await page.evaluate((id) => (
    (window.__fw.state.reservations?.booked || []).some((r) => r.customerId === id)
  ), q2B.customerId);

  // ================ LEG WAIT: ignore the queue for 90 real s ================
  await page.evaluate(() => {
    const club = window.__fw.scene3d.clubhouse();
    club.register.leave?.({ restorePointer: false }); // walk away from the till
  });
  const patienceOf = (id) => page.evaluate((cid) => {
    const club = window.__fw.scene3d.clubhouse();
    const list = typeof club.customers === 'function' ? club.customers() : club.customers;
    const c = list.find((k) => k.customerId === cid);
    return c ? {
      patience: c.patience,
      preServiceWait: c.preServiceWait ?? null,
      phase: c.checkoutPhase,
      present: true,
    } : { present: false };
  }, id);
  const waitT0 = { a: await patienceOf(q2A.customerId), b: await patienceOf(q2B.customerId) };
  await page.waitForTimeout(90000); // 1x, untouched
  const waitT90 = { a: await patienceOf(q2A.customerId), b: await patienceOf(q2B.customerId) };
  // even a manually drained patience: does the sim let it stand?
  await page.evaluate((cid) => {
    const club = window.__fw.scene3d.clubhouse();
    const list = typeof club.customers === 'function' ? club.customers() : club.customers;
    const c = list.find((k) => k.customerId === cid);
    if (c) c.patience = 25;
  }, q2A.customerId);
  await page.waitForTimeout(4000);
  const waitAfterManualDrain = await patienceOf(q2A.customerId);
  await page.screenshot({ path: path.join(OUT, 'wait-still-standing.png') });
  await clearDesk();

  const checks = {
    bootMode,
    // P4 facts
    p4AskCarried: p4.entry?.requestedTeeMinute === askP4,
    p4PartyCarried: p4.entry?.partySize === 4,
    p4GreetingNamesFour: typeof p4.dialogue === 'string' && /for 4\?/.test(p4.dialogue),
    p4AskNotOffered: p4.slots.length > 0 && p4.slots.every((s) => s.minute !== askP4),
    p4NoButtonClaimsAsk: p4.slots.every((s) => s.askedExact !== true),
    p4VerdictNearestFitsFour: p4.ask?.verdict?.ok === true && p4.ask?.verdict?.exact !== true
      && (p4.ask?.verdict?.slot?.availableSeats ?? 0) >= 4,
    p4BookedPartyOfFour: p4Book?.partySize === 4 && p4Book?.minute === (p4First?.minute ?? -1),
    p4CheckInCompleted: p4Book?.status === 'checked-in'
      || p4Book?.checkInStatus === 'checked-in' || p4Book?.paymentStatus === 'paid',
    // QUEUE2 facts
    q2SecondInQueue: q2Rows.some((r) => r.id === q2B.customerId && r.queueIndex === 1),
    q2SecondSlotButtonsUnreachable: q2BPoint === 'no-slots' || q2BPoint === null,
    q2DisabledClickDidNothing: !disabledClick.attempted
      || (disabledClick.bookedAfter === disabledClick.bookedBefore && disabledClick.txAfter === false),
    q2BridgeRefused: !!q2BridgeRefusal && q2BridgeRefusal.ok === false,
    q2NoReservationForSecond: q2BReservation === false,
    noPageErrors: errs.length === 0,
  };
  const out = {
    setup, askP4, blocker,
    p4: { ...p4, first: p4First, book: p4Book, digits: p4Digits },
    q2: {
      rows: q2Rows, slots: q2BSlots, screenPoint: q2BPoint,
      disabledClick, bridgeRefusal: q2BridgeRefusal, reservationForSecond: q2BReservation,
    },
    wait: { t0: waitT0, t90: waitT90, afterManualDrain: waitAfterManualDrain },
    errs: errs.slice(0, 10),
    checks,
  };
  out.ok = true; // verdicts are read from the facts, not gated here
  fs.writeFileSync(path.join(OUT, 'verify2-l1a.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

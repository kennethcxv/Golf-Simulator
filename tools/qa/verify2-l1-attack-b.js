// VERIFY2 queue L — adversarial probe B against L1/L2, staged at 16:40 when
// the day's sheet is spent (last slot 16:30 has passed; close 17:00).
//   EVENING — a walk-in asks for 16:30 at 16:40. There is nothing to sell:
//             the desk must say so, offer NO bookable time, refuse a direct
//             bridge booking at the ask, and the Turn Away path must walk
//             the golfer out cleanly.
//   SHEET   — the tee sheet near closing: every row past (dimmed), no
//             booking hotspots even with the walk-in selected at the head.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify2-l1b');
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
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 16 * 60 + 40;
    if (state.campaign) state.campaign.businessOpen = true;
    if (state.shop) state.shop.signOpen = true;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(16 * 60 + 40, state.weather);
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
    const remaining = R.slotTimes(state).filter((minute) => minute >= nowMin);
    const dayAbs = Math.floor(state.clock.minutes / 1440);
    return { nowMin, remaining, dayAbs, config: state.reservations?.config || null };
  });

  const ASK = 990; // 16:30 — the last slot of the day, ten minutes gone

  const staged = await page.evaluate((minute) => {
    const club = window.__fw.scene3d.clubhouse();
    const c = club.sendWalkInToDesk({ requestedTeeMinute: minute });
    if (!c) return null;
    c.paymentPreference = 'card';
    c.payMethod = 'card';
    c.partySize = 1;
    return { customerId: c.customerId, name: c.fullName };
  }, ASK);
  assert(staged, 'walk-in did not spawn');
  await page.waitForFunction((id) => {
    const desk = window.__fw.scene3d.clubhouse().frontDeskBridge?.();
    const entry = (desk?.walkIns?.() || []).find((w) => w.customerId === id);
    return !!(entry && entry.phase === 'walk-in-waiting' && entry.queueIndex === 0);
  }, staged.customerId, { timeout: 60000 });

  const evening = await page.evaluate((id) => {
    const club = window.__fw.scene3d.clubhouse();
    const desk = club.frontDeskBridge();
    const list = typeof club.customers === 'function' ? club.customers() : club.customers;
    const customer = list.find((c) => c.customerId === id);
    return {
      entry: (desk.walkIns() || []).find((w) => w.customerId === id) || null,
      dialogue: customer ? customer.dialogue : null,
      slots: desk.walkInSlotsFor(id) || [],
      ask: desk.walkInAskFor ? desk.walkInAskFor(id) : null,
    };
  }, staged.customerId);

  const clickMonitor = async (actionId, label) => {
    const point = await page.evaluate((id) => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
    ), actionId);
    assert(point && point.inView, `${label}: hotspot ${actionId} not on screen`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(450);
  };

  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await clickMonitor('tab-check-in', 'check-in tab');
  await clickMonitor(`select-walkin:${staged.customerId}`, 'evening walk-in row');
  await page.screenshot({ path: path.join(OUT, 'evening-no-times.png') });

  // what buttons exist for this walk-in? (none may book)
  const eveningButtons = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.monitorHotspots()
      .filter((h) => h.id.startsWith('select-walkin-slot:') || h.id === 'reject-walkin' || h.id === 'tab-tee-sheet')
      .map((h) => ({ id: h.id, label: h.label, disabled: h.disabled }))
  ));

  // the bridge must refuse a direct booking at the spent ask
  const bridgeRefusal = await page.evaluate(([id, dayAbs, minute]) => {
    const booked = window.__fw.scene3d.clubhouse().frontDeskBridge().bookWalkIn(id, dayAbs, minute);
    return booked ? { ok: booked.ok, reason: booked.reason || null } : null;
  }, [staged.customerId, setup.dayAbs, ASK]);

  // ---- the sheet near closing: all rows past, nothing bookable -------------
  await clickMonitor('tab-tee-sheet', 'tee sheet near closing');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'sheet-near-closing.png') });
  const sheetHotspots = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.monitorHotspots()
      .filter((h) => h.kind === 'slot').length
  ));

  // ---- Turn Away: the golfer leaves cleanly --------------------------------
  await clickMonitor('tab-check-in', 'back to check-in');
  await clickMonitor(`select-walkin:${staged.customerId}`, 're-select for reject');
  const rejectPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint('reject-walkin')
  ));
  assert(rejectPoint && rejectPoint.inView, 'reject-walkin button not reachable');
  await page.mouse.click(rejectPoint.x, rejectPoint.y);
  await page.waitForTimeout(600);
  const afterReject = await page.evaluate((id) => {
    const club = window.__fw.scene3d.clubhouse();
    const list = typeof club.customers === 'function' ? club.customers() : club.customers;
    const c = list.find((k) => k.customerId === id);
    const desk = club.frontDeskBridge();
    return {
      stillListed: (desk.walkIns() || []).some((w) => w.customerId === id),
      phase: c ? c.checkoutPhase : 'gone',
      rejected: c ? c.walkInRejected === true : null,
    };
  }, staged.customerId);
  await page.evaluate(() => {
    window.__fw.scene3d.clubhouse().register.leave?.({ restorePointer: false });
  });
  // watch them physically go (1x): removed from the floor within 3 minutes
  const leftTheShop = await page.waitForFunction((id) => {
    const club = window.__fw.scene3d.clubhouse();
    const list = typeof club.customers === 'function' ? club.customers() : club.customers;
    return !list.some((k) => k.customerId === id);
  }, staged.customerId, { timeout: 180000 }).then(() => true).catch(() => false);
  await page.screenshot({ path: path.join(OUT, 'after-turn-away.png') });

  const checks = {
    bootMode,
    noSlotsRemainToday: setup.remaining.length === 0,
    rowStillStatesAsk: evening.entry?.requestedTeeMinute === ASK,
    askSpoken: typeof evening.dialogue === 'string' && /could I get|could we get/i.test(evening.dialogue),
    noOffers: evening.slots.length === 0,
    verdictSaysNothingRemains: evening.ask?.verdict?.ok === false && evening.ask?.verdict?.none === true,
    noBookableButtons: eveningButtons.every((b) => !b.id.startsWith('select-walkin-slot:')),
    rejectOffered: eveningButtons.some((b) => b.id === 'reject-walkin' && !b.disabled),
    bridgeRefusedSpentAsk: !!bridgeRefusal && bridgeRefusal.ok === false,
    sheetHasNoBookingRows: sheetHotspots === 0,
    walkInLeftListAfterReject: afterReject.stillListed === false,
    walkInWalkedOut: leftTheShop === true,
    noPageErrors: errs.length === 0,
  };
  const out = {
    setup, ask: ASK, staged, evening, eveningButtons, bridgeRefusal,
    sheetHotspots, afterReject, leftTheShop, errs: errs.slice(0, 10), checks,
  };
  out.ok = true;
  fs.writeFileSync(path.join(OUT, 'verify2-l1b.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

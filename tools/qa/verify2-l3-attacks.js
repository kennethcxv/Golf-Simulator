// VERIFY2 queue L — adversarial probe against L3 (the ledger book).
//   ROSTER  — 21 seeded check-ins + one absurdly long name: pagination must
//             produce three spreads, real ArrowRight/ArrowLeft keys and a
//             real page-half click must turn them, the long name must fit.
//   TILL    — the book opens while a walk-in waits at the desk, nothing
//             deadlocks, and serving them afterwards signs entry #22.
//   OUTSIDE — X-carry the book OUT the front door, Z-drop it on the grass:
//             is it still findable and openable? Then carry it back.
//   CYCLES  — register abandon/leave cycles must not move or lose the spot.
//   REBOOT  — Save & Quit to menu, Continue: does the moved spot survive a
//             real boot? (state.shop.ledgerSpot through the actual save)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify2-l3');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  // ALWAYS a fresh game at boot (Electron userData persists between runs; a
  // stale Continue would resume another probe's world). The REBOOT leg at the
  // end then uses Save & Quit -> Continue deliberately, within this run.
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
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

  await page.evaluate(async () => {
    const app = window.__fw;
    const state = app.state;
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (state.campaign) state.campaign.businessOpen = true;
    if (state.shop) state.shop.signOpen = true;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(600, state.weather);
    app.scene3d.clubhouse().setOrganicWalkins(false);
  });

  const LONG_NAME = 'Maximilian Bartholomew Featherstonehaugh-Cholmondeley-Smythe of Pemberton-upon-Wold, Esquire';

  const standAtLedger = () => page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const club = app.scene3d.clubhouse();
    const off = club.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const book = club.ledgerBook.position();
    const dx = (book.x + off.x) - walk.x;
    const dz = (book.z + off.z) - walk.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    const eyeY = app.scene3d.camera.position.y;
    walk.pitch = Math.atan2((book.y + off.y) - eyeY, horizontal);
  });
  const aimAtBook = () => page.evaluate(() => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const off = club.interior.position;
    const book = club.ledgerBook.position();
    const walk = app.scene3d.walk.state;
    const dx = (book.x + off.x) - walk.x;
    const dz = (book.z + off.z) - walk.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    const eyeY = app.scene3d.camera.position.y;
    walk.pitch = Math.atan2((book.y + off.y) - eyeY, horizontal);
  });
  const promptNow = () => page.evaluate(() => {
    const el = document.querySelector('.shop-prompt');
    return el ? (el.textContent || '').trim() : null;
  });
  const diag = () => page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics());
  const bookPos = () => page.evaluate(() => ({
    position: window.__fw.scene3d.clubhouse().ledgerBook.position(),
    carried: window.__fw.scene3d.clubhouse().ledgerBook.isCarried(),
    spot: window.__fw.state.shop?.ledgerSpot ? { ...window.__fw.state.shop.ledgerSpot } : null,
  }));

  // ---- ROSTER: 21 seeded check-ins, one long name --------------------------
  const seeded = await page.evaluate(async (longName) => {
    const app = window.__fw;
    const identity = await import(new URL('src/sim/customerIdentity.js', document.baseURI).href);
    const ids = [];
    for (let i = 0; i < 21; i += 1) {
      const golfer = identity.allocateCustomerIdentity(app.state, { sourceId: `verify2-roster:${i}` });
      identity.recordCustomerVisit(app.state, golfer.customerId, {
        dayAbs: i, purpose: 'tee-time', outcome: 'check-in',
      });
      ids.push(golfer.customerId);
    }
    const victim = app.state.customerDirectory.customers.find((c) => c.customerId === ids[7]);
    victim.fullName = longName; // the fit stress: painted verbatim by the book
    const roster = await import(new URL('src/sim/clubRoster.js', document.baseURI).href);
    return { count: roster.rosterEntries(app.state).length, longNameId: ids[7] };
  }, LONG_NAME);
  assert(seeded.count === 21, `seeding failed: ${seeded.count} roster entries`);

  await standAtLedger();
  await page.waitForTimeout(700);
  const prompt0 = await promptNow();
  await page.screenshot({ path: path.join(OUT, '01-closed-prompt.png') });
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.ledgerOpen === true, null, { timeout: 10000 });
  await page.waitForTimeout(900);
  const spread0 = await diag();
  await page.screenshot({ path: path.join(OUT, '02-spread0-title.png') });

  // REAL keys turn the pages
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
  const spread1 = await diag();
  await page.screenshot({ path: path.join(OUT, '03-spread1-long-name.png') });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
  const spread2 = await diag();
  await page.screenshot({ path: path.join(OUT, '04-spread2-tail.png') });
  await page.keyboard.press('ArrowRight'); // beyond the end: must refuse
  await page.waitForTimeout(500);
  const beyondEnd = await diag();
  // a real CLICK on the left page half turns back
  await page.mouse.click(Math.round(VIEWPORT.width * 0.25), Math.round(VIEWPORT.height * 0.5));
  await page.waitForTimeout(700);
  const clickBack = await diag();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(700);
  const backToStart = await diag();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.ledgerOpen === false, null, { timeout: 8000 });
  await page.waitForTimeout(400);

  // ---- TILL: open the book while a walk-in waits at the desk ---------------
  const staged = await page.evaluate(() => {
    const club = window.__fw.scene3d.clubhouse();
    const c = club.sendWalkInToDesk({});
    if (!c) return null;
    c.paymentPreference = 'card';
    c.payMethod = 'card';
    c.partySize = 1;
    return { customerId: c.customerId, name: c.fullName };
  });
  assert(staged, 'walk-in did not spawn');
  await page.waitForFunction((id) => {
    const desk = window.__fw.scene3d.clubhouse().frontDeskBridge?.();
    const entry = (desk?.walkIns?.() || []).find((w) => w.customerId === id);
    return !!(entry && entry.phase === 'walk-in-waiting' && entry.queueIndex === 0);
  }, staged.customerId, { timeout: 60000 });
  await standAtLedger();
  await page.waitForTimeout(500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(300);
  await page.keyboard.press('e');
  const opensWithCustomerWaiting = await page.waitForFunction(
    () => window.__fw.ledgerOpen === true,
    null, { timeout: 8000 },
  ).then(() => true).catch(() => false);
  await page.screenshot({ path: path.join(OUT, '05-open-while-customer-waits.png') });
  const customerStillQueued = await page.evaluate((id) => {
    const desk = window.__fw.scene3d.clubhouse().frontDeskBridge();
    const entry = (desk.walkIns() || []).find((w) => w.customerId === id);
    return entry ? { phase: entry.phase, queueIndex: entry.queueIndex } : null;
  }, staged.customerId);
  if (opensWithCustomerWaiting) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.ledgerOpen === false, null, { timeout: 8000 });
  }

  // serve them for real: monitor booking + card payment => entry #22
  await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const off = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
  });
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
  await page.waitForTimeout(1800);
  // DOM notification cards float over the monitor at the overview pose and
  // eat pointerdowns (found by the L2 probe). Let clicks pass through them,
  // then use verified clicks with a retry.
  await page.evaluate(() => {
    const centre = document.querySelector('.notification-center');
    if (centre) centre.style.setProperty('pointer-events', 'none', 'important');
  });
  const clickMonitor = async (actionId, label, verified = null) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const point = await page.evaluate((id) => (
        window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
      ), actionId);
      assert(point && point.inView, `${label}: hotspot ${actionId} not on screen`);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(650);
      if (!verified) return;
      if (await page.evaluate(verified)) return;
    }
    throw new Error(`${label}: click on ${actionId} had no effect after 3 attempts`);
  };
  await clickMonitor('tab-check-in', 'check-in tab',
    () => window.__fw.scene3d.clubhouse().register.monitorHotspots().some((h) => h.id.startsWith('select-walkin:')));
  await clickMonitor(`select-walkin:${staged.customerId}`, 'walk-in row',
    () => window.__fw.scene3d.clubhouse().register.monitorHotspots().some((h) => h.id.startsWith('select-walkin-slot:') || h.id === 'reject-walkin'));
  const firstSlot = await page.evaluate((id) => (
    (window.__fw.scene3d.clubhouse().frontDeskBridge().walkInSlotsFor(id) || [])[0] || null
  ), staged.customerId);
  assert(firstSlot, 'no bookable slot for the walk-in');
  await clickMonitor(
    `select-walkin-slot:${staged.customerId}:${firstSlot.dayAbs}:${firstSlot.minute}`,
    'first offered slot',
    () => !!window.__fw.scene3d.clubhouse().register.getTx(),
  );
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
  await page.evaluate(() => {
    window.__fw.scene3d.clubhouse().register.leave?.({ restorePointer: false });
  });
  await page.waitForTimeout(700);
  const rosterAfterServe = await page.evaluate(async () => {
    const { rosterEntries } = await import(new URL('src/sim/clubRoster.js', document.baseURI).href);
    return rosterEntries(window.__fw.state).length;
  });
  await standAtLedger();
  await page.waitForTimeout(500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(300);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.ledgerOpen === true, null, { timeout: 10000 });
  await page.waitForTimeout(900);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
  const signedDiag = await diag();
  await page.screenshot({ path: path.join(OUT, '06-entry22-signed.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.ledgerOpen === false, null, { timeout: 8000 });
  await page.waitForTimeout(400);

  // ---- OUTSIDE: carry it out the front door and drop it on the grass -------
  await standAtLedger();
  await page.waitForTimeout(400);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(300);
  const beforeCarry = await bookPos();
  await page.keyboard.press('x');
  await page.waitForTimeout(500);
  const carried = await bookPos();
  await page.screenshot({ path: path.join(OUT, '07-carried.png') });
  // walk out: teleport the walker well past the porch (interior-local -0.8, 9)
  await page.evaluate(() => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const off = club.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = -0.8 + off.x;
    walk.z = 9.0 + off.z;
    walk.yaw = Math.PI; // face away from the shop
  });
  await page.waitForTimeout(800);
  await page.keyboard.press('z');
  await page.waitForTimeout(600);
  const droppedOutside = await bookPos();
  await page.screenshot({ path: path.join(OUT, '08-dropped-outside.png') });
  // step back, aim at it: is it findable and openable out here?
  await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk.state;
    walk.z += 1.2;
  });
  await aimAtBook();
  await page.waitForTimeout(600);
  const promptOutside = await promptNow();
  await page.screenshot({ path: path.join(OUT, '09-outside-prompt.png') });
  await page.keyboard.press('e');
  const opensOutside = await page.waitForFunction(
    () => window.__fw.ledgerOpen === true,
    null, { timeout: 8000 },
  ).then(() => true).catch(() => false);
  const outsideDiag = opensOutside ? await diag() : null;
  await page.screenshot({ path: path.join(OUT, '10-open-outside.png') });
  if (opensOutside) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.ledgerOpen === false, null, { timeout: 8000 });
    await page.waitForTimeout(300);
  }

  // carry it back in and set it down by the desk
  await aimAtBook();
  await page.waitForTimeout(300);
  await page.keyboard.press('x');
  await page.waitForTimeout(400);
  const recarried = await bookPos();
  await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const club = app.scene3d.clubhouse();
    const off = club.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    // face the desk so the drop lands on it
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
  });
  await page.waitForTimeout(600);
  await page.keyboard.press('z');
  await page.waitForTimeout(600);
  const backInside = await bookPos();
  await page.screenshot({ path: path.join(OUT, '11-back-at-desk.png') });

  // ---- CYCLES: register abandon/leave must not disturb the spot ------------
  const cycleResults = [];
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('e');
    const entered = await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.isActive()
    ), null, { timeout: 15000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const club = window.__fw.scene3d.clubhouse();
      club.register.abandon?.();
      club.register.leave?.({ restorePointer: false });
    });
    await page.waitForTimeout(500);
    cycleResults.push({ entered, ...(await bookPos()) });
  }
  await aimAtBook();
  await page.waitForTimeout(500);
  const promptAfterCycles = await promptNow();
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(300);
  await page.keyboard.press('e');
  const opensAfterCycles = await page.waitForFunction(
    () => window.__fw.ledgerOpen === true,
    null, { timeout: 8000 },
  ).then(() => true).catch(() => false);
  if (opensAfterCycles) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.ledgerOpen === false, null, { timeout: 8000 });
  }

  // ---- REBOOT: Save & Quit to menu, Continue — does the spot survive? ------
  // serializer round-trip first (the same code path the save file takes)
  const serializedRoundTrip = await page.evaluate(async () => {
    const app = window.__fw;
    const S = await import(new URL('src/sim/state.js', document.baseURI).href);
    const json = S.serialize(app.state);
    const parsed = JSON.parse(json);
    const savedSpot = parsed.shop?.ledgerSpot || null;
    let revivedSpot = null;
    let reviveError = null;
    try {
      const revived = S.deserializeWithReport(json);
      const st = revived.state || revived.value || revived;
      revivedSpot = st?.shop?.ledgerSpot || null;
    } catch (error) {
      reviveError = String(error?.message || error);
    }
    return { savedSpot, revivedSpot, reviveError, liveSpot: app.state.shop?.ledgerSpot || null };
  });

  const spotBeforeReboot = await bookPos();
  let reboot = { attempted: false };
  try {
    // pause menu -> Session -> Return to main menu -> confirm Save and return
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    const clickDomButton = async (pattern) => page.evaluate((source) => {
      const re = new RegExp(source, 'i');
      const button = [...document.querySelectorAll('button')]
        .find((b) => re.test((b.textContent || '').trim()));
      if (!button) return null;
      const label = (button.textContent || '').trim();
      button.click();
      return label;
    }, pattern);
    const sessionNav = await clickDomButton('^Session$');
    await page.waitForTimeout(500);
    const returnClicked = await clickDomButton('^Return to main menu');
    await page.waitForTimeout(700);
    const confirmClicked = await clickDomButton('^Save and return');
    if (returnClicked && confirmClicked) {
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')]
          .find((k) => /new game/i.test(k.textContent || ''));
        return !!b;
      }, null, { timeout: 45000 });
      await page.waitForTimeout(1500);
      const mode = await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
      await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
      await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
      await page.waitForTimeout(2500);
      const afterBoot = await bookPos();
      const rosterAfterBoot = await page.evaluate(async () => {
        const { rosterEntries } = await import(new URL('src/sim/clubRoster.js', document.baseURI).href);
        return rosterEntries(window.__fw.state).length;
      });
      await page.screenshot({ path: path.join(OUT, '12-after-reboot.png') });
      reboot = { attempted: true, sessionNav, returnClicked, confirmClicked, resumeMode: mode, afterBoot, rosterAfterBoot };
    } else {
      reboot = { attempted: false, sessionNav, returnClicked, confirmClicked, note: 'pause flow buttons not found' };
      await page.screenshot({ path: path.join(OUT, '12-no-pause-menu.png') });
    }
  } catch (error) {
    reboot = { attempted: true, failed: String(error?.message || error) };
  }

  const near = (a, b, tol = 0.05) => !!a && !!b
    && Math.abs(a.x - b.x) < tol && Math.abs(a.z - b.z) < tol;
  const checks = {
    bootMode,
    promptOffersLedger: typeof prompt0 === 'string' && /register|ledger/i.test(prompt0),
    threeSpreads: spread0.spreadCount === 3 && spread0.spread === 0,
    arrowKeysTurnForward: spread1.spread === 1 && spread2.spread === 2,
    // `painted` refreshes only on setOpen/paintSpread, not on turnPage, so the
    // tail page's contents are judged from 04-spread2-tail.png, not from diag
    lastSpreadReached: spread2.spread === 2 && spread2.entries === 21,
    turnRefusesBeyondEnd: beyondEnd.spread === 2,
    clickTurnsBack: clickBack.spread === 1,
    arrowLeftReturns: backToStart.spread === 0,
    opensWithCustomerWaiting,
    customerUndisturbed: !!customerStillQueued && customerStillQueued.phase === 'walk-in-waiting',
    serveAfterReadingSigns22: rosterAfterServe === 22 && signedDiag.entries === 22,
    xCarries: carried.carried === true,
    droppedOutsideRecorded: droppedOutside.carried === false
      && !!droppedOutside.spot && near(droppedOutside.spot, droppedOutside.position, 0.02),
    bookLeftTheShop: Math.hypot(
      droppedOutside.position.x - beforeCarry.position.x,
      droppedOutside.position.z - beforeCarry.position.z,
    ) > 4,
    promptFollowsOutside: typeof promptOutside === 'string' && /register|ledger/i.test(promptOutside),
    opensOutside,
    carriesBackInside: recarried.carried === true && backInside.carried === false,
    backSpotRecorded: !!backInside.spot && near(backInside.spot, backInside.position, 0.02),
    cyclesLeaveSpotAlone: cycleResults.every((c) => near(c.position, backInside.position, 0.02)),
    promptSurvivesCycles: typeof promptAfterCycles === 'string' && /register|ledger/i.test(promptAfterCycles),
    opensAfterCycles,
    serializerKeepsSpot: !!serializedRoundTrip.savedSpot
      && near(serializedRoundTrip.savedSpot, serializedRoundTrip.liveSpot, 0.001)
      && near(serializedRoundTrip.revivedSpot, serializedRoundTrip.liveSpot, 0.001),
    rebootKeepsSpot: reboot.attempted && reboot.resumeMode === 'continue'
      ? near(reboot.afterBoot?.position, spotBeforeReboot.position, 0.05)
      : null,
    noPageErrors: errs.length === 0,
  };
  const out = {
    seeded, prompt0, spread0, spread1, spread2, beyondEnd, clickBack, backToStart,
    staged, opensWithCustomerWaiting, customerStillQueued, rosterAfterServe, signedDiag,
    beforeCarry, carried, droppedOutside, promptOutside, opensOutside, outsideDiag,
    recarried, backInside, cycleResults, promptAfterCycles, opensAfterCycles,
    serializedRoundTrip, spotBeforeReboot, reboot,
    errs: errs.slice(0, 10), checks,
  };
  out.ok = true;
  fs.writeFileSync(path.join(OUT, 'verify2-l3.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

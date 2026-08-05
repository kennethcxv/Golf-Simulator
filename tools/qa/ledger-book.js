// L3 — the ledger book on the front desk (task #127's ruling). What this
// proves, in the running build:
//   1. the bound book is VISIBLE on the desk and carries an E prompt
//   2. E opens it IN PLACE: camera leans over the spread, no DOM UI
//   3. BLANK-STATE CONTROL: a fresh club shows the title page and ruled
//      empty rows - and the right-page ink counter reads ~zero, which is the
//      negative control for the signature check later
//   4. a real walk-in check-in (the L1 flow, end to end) signs the book:
//      diagnostics' content-ready predicate (pages painted from the live
//      roster - NOT the open flag) reports the entry, and the right page now
//      carries ink where the signature row is
//   5. with a directory big enough for two spreads, pages physically turn
//      forward and back
//   6. persistence is the identity directory's (already F4-verified); the
//      new firstVisitDayAbs field survives a JSON round-trip through the
//      same serialisation the save uses
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/ledger-book-l3');
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

  const setup = await page.evaluate(async () => {
    const app = window.__fw;
    const { FRONT_DESK } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const state = app.state;
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (state.campaign) state.campaign.businessOpen = true;
    if (state.shop) state.shop.signOpen = true;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(600, state.weather);
    const club = app.scene3d.clubhouse();
    club.setOrganicWalkins(false);
    return { ledgerAnchor: FRONT_DESK.ledger, hasBook: !!club.ledgerBook };
  });
  assert(setup.hasBook, 'clubhouse.ledgerBook missing');

  // stand at the till (proven walkable) and AIM at the live book - the first
  // derived stand spot sat inside the counter collider and got shoved away
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
  await standAtLedger();
  await page.waitForTimeout(700);
  const prompt = await page.evaluate(() => {
    const el = document.querySelector('.shop-prompt');
    return el ? (el.textContent || '').trim() : null;
  });
  await page.screenshot({ path: path.join(OUT, '01-closed-on-desk.png') });

  const diag = () => page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics());
  const rightPageInk = () => page.evaluate(() => {
    const club = window.__fw.scene3d.clubhouse();
    const root = club.interior.getObjectByName('FrontDeskLedgerBook');
    if (!root) return { error: 'book root missing' };
    root.updateWorldMatrix(true, true);
    let best = null;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const image = o.material?.map?.image;
      if (!image || image.width !== 768 || image.height !== 512) return;
      // visible chain only (the turning leaf hides between turns)
      for (let p = o; p; p = p.parent) if (p.visible === false) return;
      const world = o.getWorldPosition(new window.__fw.scene3d.camera.position.constructor());
      const local = root.worldToLocal(world.clone());
      if (local.x > 0.05) best = image; // the RIGHT page
    });
    if (!best) return { error: 'right page canvas not found' };
    const scratch = document.createElement('canvas');
    scratch.width = best.width; scratch.height = best.height;
    const ctx = scratch.getContext('2d');
    ctx.drawImage(best, 0, 0);
    const data = ctx.getImageData(0, 0, best.width, best.height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] < 100) ink += 1;
    }
    return { ink };
  });

  // ---- blank state ---------------------------------------------------------
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2); // pointer lock back
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.ledgerOpen === true, null, { timeout: 10000 });
  await page.waitForTimeout(900); // the focus lean settles
  const blankDiag = await diag();
  const blankInk = await rightPageInk();
  const blankTurn = await page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.turnPage(1));
  await page.screenshot({ path: path.join(OUT, '02-open-blank.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.ledgerOpen === false, null, { timeout: 8000 });
  await page.waitForTimeout(500);

  // ---- one REAL check-in signs the book ------------------------------------
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
  // move to the register stand and book their asked slot through the bridge
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
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  // book through the MONITOR (the handler also opens the check-in payment;
  // a bare bridge bookWalkIn books the slot and then nothing pays for it)
  const clickMonitor = async (actionId, label) => {
    const point = await page.evaluate((id) => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
    ), actionId);
    assert(point && point.inView, `${label}: hotspot ${actionId} not on screen`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(450);
  };
  await clickMonitor('tab-check-in', 'check-in tab');
  await clickMonitor(`select-walkin:${staged.customerId}`, 'walk-in row');
  const firstSlot = await page.evaluate((id) => (
    (window.__fw.scene3d.clubhouse().frontDeskBridge().walkInSlotsFor(id) || [])[0] || null
  ), staged.customerId);
  assert(firstSlot, 'no bookable slot for the walk-in');
  await clickMonitor(
    `select-walkin-slot:${staged.customerId}:${firstSlot.dayAbs}:${firstSlot.minute}`,
    'first offered slot',
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
    const club = window.__fw.scene3d.clubhouse();
    club.register.leave?.({ restorePointer: false });
  });
  await page.waitForTimeout(800);

  const roster = await page.evaluate(async () => {
    const { rosterEntries } = await import(new URL('src/sim/clubRoster.js', document.baseURI).href);
    return rosterEntries(window.__fw.state);
  });

  // ---- the signed book -----------------------------------------------------
  await standAtLedger();
  await page.waitForTimeout(600);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.ledgerOpen === true, null, { timeout: 10000 });
  await page.waitForTimeout(900);
  const signedDiag = await diag();
  const signedInk = await rightPageInk();
  await page.screenshot({ path: path.join(OUT, '03-signed.png') });

  // ---- page turns, with a directory big enough for two spreads -------------
  await page.evaluate(async () => {
    const app = window.__fw;
    const identity = await import(new URL('src/sim/customerIdentity.js', document.baseURI).href);
    // seed the directory the sim way - the same recordCustomerVisit call the
    // live check-in path makes; the book is being tested, not the recorder
    for (let i = 0; i < 12; i += 1) {
      const golfer = identity.allocateCustomerIdentity(app.state, { sourceId: `roster-fill:${i}` });
      identity.recordCustomerVisit(app.state, golfer.customerId, {
        dayAbs: i, purpose: 'tee-time', outcome: 'check-in',
      });
    }
    // repaint from the enlarged roster
    const book = app.scene3d.clubhouse().ledgerBook;
    book.setOpen(false);
    book.setOpen(true);
  });
  await page.waitForTimeout(400);
  const fullDiag = await diag();
  const turned = await page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.turnPage(1));
  await page.waitForTimeout(250);
  const midTurn = await diag();
  await page.waitForTimeout(600);
  const afterTurn = await diag();
  await page.screenshot({ path: path.join(OUT, '04-page-two.png') });
  const turnedBack = await page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.turnPage(-1));
  await page.waitForTimeout(700);
  const backAgain = await diag();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.ledgerOpen === false, null, { timeout: 8000 });
  await page.waitForTimeout(500);

  // ---- moveability: [X] carries it, [Z] sets it down somewhere else --------
  await standAtLedger();
  await page.waitForTimeout(500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(400);
  const beforeMove = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().ledgerBook.position()
  ));
  await page.keyboard.press('x');
  await page.waitForTimeout(500);
  const carriedNow = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().ledgerBook.isCarried()
  ));
  await page.screenshot({ path: path.join(OUT, '05-carried.png') });
  // back away from the desk with the book in hand, then set it down
  await page.keyboard.down('s');
  await page.waitForTimeout(900);
  await page.keyboard.up('s');
  await page.waitForTimeout(300);
  await page.keyboard.press('z');
  await page.waitForTimeout(500);
  const afterMove = await page.evaluate(() => ({
    position: window.__fw.scene3d.clubhouse().ledgerBook.position(),
    carried: window.__fw.scene3d.clubhouse().ledgerBook.isCarried(),
    spot: window.__fw.state.shop?.ledgerSpot || null,
  }));
  // aim squarely at where the book now lies (it may be on the floor)
  await page.evaluate(() => {
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
  await page.waitForTimeout(500);
  const movedPrompt = await page.evaluate(() => {
    const el = document.querySelector('.shop-prompt');
    return el ? (el.textContent || '').trim() : null;
  });
  await page.screenshot({ path: path.join(OUT, '06-set-down.png') });
  // it still opens where it now lies
  await page.keyboard.press('e');
  const reopensMoved = await page.waitForFunction(
    () => window.__fw.ledgerOpen === true,
    null, { timeout: 8000 },
  ).then(() => true).catch(() => false);
  const movedDiag = reopensMoved ? await diag() : null;
  if (reopensMoved) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.ledgerOpen === false, null, { timeout: 8000 });
  }

  // ---- persistence: the directory field survives the save's serialisation --
  const persistence = await page.evaluate(async () => {
    const app = window.__fw;
    const identity = await import(new URL('src/sim/customerIdentity.js', document.baseURI).href);
    const roster = await import(new URL('src/sim/clubRoster.js', document.baseURI).href);
    const before = roster.rosterEntries(app.state);
    const revived = { seed: app.state.seed, clock: { minutes: 0 } };
    revived.customerDirectory = JSON.parse(JSON.stringify(app.state.customerDirectory));
    identity.ensureCustomerDirectory(revived); // the load-time heal
    const after = roster.rosterEntries(revived);
    return {
      before: before.length,
      after: after.length,
      firstVisitSurvives: before.length > 0 && after.length > 0
        && before[0].firstVisitDayAbs === after[0].firstVisitDayAbs
        && after[0].firstVisitDayAbs != null,
    };
  });

  const checks = {
    promptOffersLedger: typeof prompt === 'string' && /ledger|register/i.test(prompt),
    opensInPlace: blankDiag.open === true && blankDiag.contentReady === true,
    blankBookIsBlank: blankDiag.entries === 0 && blankDiag.painted === 0,
    blankInkControlQuiet: !blankInk.error && blankInk.ink < 60,
    blankBookHasOneSpread: blankTurn === false && blankDiag.spreadCount === 1,
    checkInSignsTheBook: roster.length === 1 && roster[0].name === staged.name
      && roster[0].visits === 1 && Number.isFinite(roster[0].firstVisitDayAbs),
    signedPagePainted: signedDiag.entries === 1 && signedDiag.painted === 1
      && signedDiag.contentReady === true,
    signatureInkPresent: !signedInk.error && signedInk.ink > blankInk.ink + 200,
    pagesTurnForward: fullDiag.spreadCount >= 2 && turned === true
      && midTurn.turning === true && afterTurn.turning === false && afterTurn.spread === 1,
    pagesTurnBack: turnedBack === true && backAgain.spread === 0,
    // the book is MOVEABLE: X carries, Z sets down, the spot persists, and
    // the prompt + E follow it to where it now lies
    xCarriesTheBook: carriedNow === true,
    zSetsItDown: afterMove.carried === false,
    bookActuallyMoved: Math.hypot(
      afterMove.position.x - beforeMove.x,
      afterMove.position.z - beforeMove.z,
    ) > 0.8,
    movedSpotPersisted: !!afterMove.spot
      && Math.abs(afterMove.spot.x - afterMove.position.x) < 0.01
      && Math.abs(afterMove.spot.z - afterMove.position.z) < 0.01,
    movedPromptFindable: typeof movedPrompt === 'string' && /ledger|register/i.test(movedPrompt),
    opensAtItsNewSpot: reopensMoved === true && !!movedDiag && movedDiag.contentReady === true,
    directoryRoundTripKeepsFirstVisit: persistence.firstVisitSurvives
      && persistence.before === persistence.after,
    noPageErrors: errs.length === 0,
  };
  const out = {
    prompt, blankDiag, blankInk, blankTurn, staged, roster,
    signedDiag, signedInk, fullDiag, midTurn, afterTurn, backAgain,
    beforeMove, carriedNow, afterMove, movedPrompt, reopensMoved, movedDiag, persistence,
    errs: errs.slice(0, 10), checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'ledger-book.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

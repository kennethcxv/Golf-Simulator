// C6 acceptance — "N of M visits contained both a purchase and a booking."
//
// Runs at 1x ONLY (SIM-TIME-001). A full 9:00-19:30 day at 1x is 10.5 wall-hours,
// so this measures a bounded peak window and says exactly which one; the number
// is one window of one day and is reported as such.
//
// The driver plays the DESK, because a check-in is a player action: each tick it
// serves whoever is standing at the counter for a booking, exactly as clicking
// through the laptop would. It does NOT play the till — ringing goods up is a
// hand-driven beat with a card reader in it — so the purchase leg is counted at
// the moment the customer arrives at the register with goods and waits, which is
// the whole of the CUSTOMER's contribution to a sale.
//
// Env: C6_WINDOW_MIN (game minutes, default 45), C6_START_MIN (default 600).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/combined-visits');
  fs.mkdirSync(OUT, { recursive: true });
  const WINDOW_MIN = Number(process.env.C6_WINDOW_MIN || 45);
  const START_MIN = Number(process.env.C6_START_MIN || 600);
  const SEED = Number(process.env.C6_SEED || 20260804);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(async (seed) => {
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 240000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(4000);

  // Shop OPEN, 1x, at the peak window.
  const setup = await page.evaluate(({ startMin }) => {
    const app = window.__fw;
    const st = app.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + startMin;
    if (st.campaign) st.campaign.businessOpen = true;
    if (st.shop) st.shop.signOpen = true;
    app.speedIdx = 1; // 1x — the only speed NPC evidence is valid at
    app.scene3d.applyTimeWeather?.(startMin, st.weather);
    const club = app.scene3d.clubhouse();
    return {
      speedIdx: app.speedIdx,
      businessOpen: !!st.campaign?.businessOpen,
      signOpen: !!st.shop?.signOpen,
      tallyAtStart: club.visitTally(),
      combinedChanceKnown: typeof club.visitTally === 'function',
    };
  }, { startMin: START_MIN });

  await page.evaluate((on) => { window.__c6ForceWalkIns = on; },
    String(process.env.C6_FORCE_WALKINS || '1') === '1');

  const deadline = Date.now() + WINDOW_MIN * 60000 + 60000;
  const seenCombinedAtTill = new Set();
  const seenCombinedBrowsing = new Set();
  let ticks = 0;
  let served = 0;
  let booked = 0;
  for (;;) {
    if (Date.now() > deadline) break;
    const step = await page.evaluate(() => {
      const app = window.__fw;
      const club = app.scene3d.clubhouse();
      const list = typeof club.customers === 'function' ? club.customers() : club.customers;
      const desk = club.frontDeskBridge();
      if (!desk) return { error: 'no front desk bridge' };
      let servedNow = 0;
      let bookedNow = 0;
      // FORCE TEE-TIME ARRIVALS. Measured first without this: an organic day-1
      // starter produced 3 arrivals in 60 game-minutes and ZERO tee-time
      // arrivals, because a starter has no booked sheet and the walk-in roll is
      // rare. With M = 0 the acceptance question has no answer, so the driver
      // seeds the intent it is measuring and says so. Every other beat — the
      // shopping roll, the desk, the splice — is the shipped code.
      if (window.__c6ForceWalkIns && club.debugSpawn && list.length < 8) {
        club.debugSpawn(false, null, { allowWalkInRequest: true });
      }
      // PLAY THE DESK. A walk-in asking for a time gets the first slot the sim
      // offers; a pre-registered guest at the head of the queue gets checked in.
      for (const entry of (desk.walkIns() || [])) {
        const c = list.find((x) => x.customerId === entry.customerId);
        if (!c || !c.queued) continue;
        const slots = desk.walkInSlotsFor(entry.customerId) || [];
        const pick = slots[0];
        if (!pick) continue;
        const res = desk.bookWalkIn(entry.customerId, pick.dayAbs, pick.minute);
        if (res && res.ok) bookedNow += 1;
      }
      for (const row of (desk.list() || [])) {
        const id = row.id ?? row.reservationId;
        if (id == null) continue;
        if (desk.completeCustomer(id)) servedNow += 1;
      }
      const combinedAtTill = [];
      const combinedBrowsing = [];
      for (const c of list) {
        if (!c.combinedVisit) continue;
        combinedBrowsing.push(c.customerId);
        const waiting = c.awaitingCheckout
          || ['shopping', 'placing', 'waiting'].includes(String(c.checkoutPhase || ''));
        if (waiting && c.cart && c.cart.length) combinedAtTill.push(c.customerId);
      }
      return {
        clock: app.state.clock.minutes % 1440,
        speedIdx: app.speedIdx,
        population: list.length,
        servedNow,
        bookedNow,
        combinedAtTill,
        combinedBrowsing,
        tally: club.visitTally(),
      };
    }).catch((error) => ({ error: String(error) }));
    if (step.error) { errs.push(step.error); break; }
    ticks += 1;
    served += step.servedNow;
    booked += step.bookedNow;
    for (const id of step.combinedAtTill) seenCombinedAtTill.add(id);
    for (const id of step.combinedBrowsing) seenCombinedBrowsing.add(id);
    if ((step.clock - START_MIN + 1440) % 1440 >= WINDOW_MIN) break;
    await page.waitForTimeout(900);
  }

  const final = await page.evaluate(() => {
    const app = window.__fw;
    return {
      clock: app.state.clock.minutes % 1440,
      tally: app.scene3d.clubhouse().visitTally(),
    };
  });
  await page.screenshot({ path: path.join(OUT, 'window-end.png') });

  const t = final.tally;
  const result = {
    window: { startMin: START_MIN, endClock: final.clock, gameMinutes: WINDOW_MIN, speed: '1x', seed: SEED },
    setup,
    deskPlayed: { checkInsServed: served, walkInsBooked: booked, ticks },
    forcedWalkInArrivals: String(process.env.C6_FORCE_WALKINS || '1') === '1',
    tally: t,
    answer: {
      M_teeTimeArrivals: t.deskErrands,
      N_offeredCombined: t.combinedOffered,
      N_reachedTheShopFloorAfterTheDesk: t.combinedStarted,
      N_reachedTheTillWithGoods: seenCombinedAtTill.size,
      N_paid: t.combinedCompleted,
      retailOnlyArrivals: t.retailOnly,
      checkInsCompleted: t.checkInsCompleted,
    },
    errors: errs.slice(0, 20),
  };
  fs.writeFileSync(path.join(OUT, `combined-visits-${WINDOW_MIN}min.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

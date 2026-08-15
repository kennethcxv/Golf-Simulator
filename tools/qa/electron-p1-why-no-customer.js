// PHASE 1 (Goal 25) — WHY DOES NOBODY WALK IN?
//
// The stranger opened the shop, stocked it, put the clock inside trading hours
// and waited three minutes. Nobody came. The spawn is gated:
//
//     organicWalkins && open && organicCount < targetCount && Math.random() < ...
//
// so exactly one of those four is false. This asks the game which, instead of
// reading the formula and guessing — `shopFootfallTarget` is floored at 1
// whenever capacity is non-zero, so a zero target means a zero CAPACITY, and
// capacity is a fit-out property of a shop that has not been restored yet.
//
// It seeds the same four facts the stranger's Part B seeds and then reads the
// gate's own inputs.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p1-why-no-customer.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p1-why-no-customer');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const readGate = () => page.evaluate(async () => {
    const app = window.__fw;
    const sign = await import(new URL('src/sim/shopSign.js', document.baseURI).href);
    const footfall = await import(new URL('src/sim/shopFootfall.js', document.baseURI).href);
    const shop = await import(new URL('src/sim/shop.js', document.baseURI).href);
    // shopCustomerCapacity lives in shopProgression, NOT shop. Importing it from
    // the wrong module returns undefined and the probe would have reported
    // "capacity null" -- indistinguishable from a real zero, which is the exact
    // question being asked.
    const prog = await import(new URL('src/sim/shopProgression.js', document.baseURI).href);
    const campaign = await import(new URL('src/sim/campaign.js', document.baseURI).href);
    const rep = await import(new URL('src/sim/reputation.js', document.baseURI).href);
    const minute = ((app.state.clock.minutes % 1440) + 1440) % 1440;
    const capacity = typeof prog.shopCustomerCapacity === 'function'
      ? prog.shopCustomerCapacity(app.state) : null;
    return {
      minuteOfDay: Math.round(minute),
      signOpen: !!app.state.shop?.signOpen,
      shopOpenFlag: !!app.state.shop?.open,
      businessOpen: !!app.state.campaign?.businessOpen,
      campaignAllowsBusiness: campaign.campaignAllowsBusiness(app.state),
      shopAcceptsWalkIns: sign.shopAcceptsWalkIns(app.state, minute),
      // THE TWO NUMBERS THE GATE ACTUALLY MULTIPLIES
      capacity,
      footfallTarget: capacity == null ? null
        : footfall.shopFootfallTarget(app.state, capacity, { open: true }),
      drive: footfall.shopFootfallDrive ? +footfall.shopFootfallDrive(app.state).toFixed(3) : null,
      reputation: rep.reputationOverall ? +rep.reputationOverall(app.state).toFixed(1) : null,
      condition: shop.shopCondition ? shop.shopCondition(app.state) : null,
    };
  });

  out.beforeSeed = await readGate();
  console.log('WHY-NO-CUSTOMER before', JSON.stringify(out.beforeSeed, null, 1));

  await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const campaign = await import(new URL('src/sim/campaign.js', document.baseURI).href);
    // RESTORE, THEN TELL THE RENDERER. The previous seed opened the shop without
    // restoring it, and the measurement was unambiguous: four customers walked
    // onto the floor and not one reached the till in 31 game minutes, because an
    // unrestored shop has no installed fixtures and therefore nothing to buy.
    // `disableCampaign` restores the authored fixtures in STATE;
    // `refreshShopProgression` is the accessor that relays those fixtures,
    // retargets the customer fixture stops and rebuilds stock and boxes so the
    // scene agrees. Without the second call the shop is stocked in the sim and
    // empty on screen -- which is the same class of fault as everything else in
    // FOUND_FALSE.
    campaign.disableCampaign(app.state);
    if (app.state.shop) { app.state.shop.open = true; app.state.shop.signOpen = true; }
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    for (const id of ['balls1', 'glove1', 'tees1']) {
      const inv = app.state.shop?.inventory?.[id];
      if (inv) inv.shelf = Math.max(inv.shelf || 0, 8);
    }
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    ch.refreshShopProgression?.();
    ch.rebuildStock?.();
    ch.setOrganicWalkins?.(true);
  });
  await page.waitForTimeout(2000);
  out.afterSeed = await readGate();
  console.log('WHY-NO-CUSTOMER after', JSON.stringify(out.afterSeed, null, 1));

  // DOES THE CLOCK ADVANCE? The spawn roll is
  //     Math.random() < min(0.9, decisionDt * 0.15)
  // and decisionDt is GAME minutes elapsed this frame. A frozen or paused clock
  // makes that probability exactly zero every frame, which looks identical to
  // "the shop is open and the world is empty". Ten seconds of wall time is
  // plenty to tell them apart.
  const clockA = await page.evaluate(() => window.__fw.state.clock.minutes);
  const speedA = await page.evaluate(() => ({
    speedIdx: window.__fw.speedIdx ?? null,
    paused: !!window.__fw.paused,
    simSpeed: window.__fw.scene3d?.clubhouse?.()?.simTimeDiagnostics?.()?.speed ?? null,
  }));
  await page.waitForTimeout(10000);
  const clockB = await page.evaluate(() => window.__fw.state.clock.minutes);
  out.clock = {
    before: clockA, after: clockB,
    gameMinutesPerTenWallSeconds: +(clockB - clockA).toFixed(3),
    advancing: (clockB - clockA) > 0.001,
    ...speedA,
  };
  console.log('WHY-NO-CUSTOMER clock', JSON.stringify(out.clock));

  // WATCH THE FLOOR, NOT THE TILL.
  //
  // The first version waited for `tx.items.length` and called it "did anybody
  // come". Goods on the counter is the END of a shopping visit -- walk in,
  // browse a fixture, choose, queue, place -- which is twenty-odd game minutes
  // away at 8 game-minutes per real minute. It also called a `customerCount()`
  // that does not exist on the API, so the OR arm was permanently 0. Two
  // separate ways to report an empty shop that was not empty.
  //
  // `footfallDiagnostics().onFloor` is the number the arrival loop itself owns.
  const watch = [];
  let sawAnyone = false;
  for (let i = 0; i < 24; i += 1) {
    const s = await page.evaluate(() => {
      const ch = window.__fw?.scene3d?.clubhouse?.();
      const f = ch?.footfallDiagnostics?.() || {};
      const tx = ch?.register?.getTx?.();
      // WHAT ARE THEY DOING? "Three on the floor and none at the till" has at
      // least four different causes -- they never choose, they choose and cannot
      // path, they queue and are never served, or they give up -- and the count
      // alone cannot tell them apart.
      const people = (ch?.customers?.() || []).map((c) => ({
        type: c.customerType || null,
        queueIndex: typeof c.queueIndex === 'number' ? c.queueIndex : null,
        reservationId: c.reservationId ?? null,
        phase: c.checkoutPhase || null,
        dest: c.currentDestination || null,
        cart: c.cart ? c.cart.length : 0,
        queued: !!c.queued,
        bought: !!c.bought,
        awaiting: !!c.awaitingCheckout,
        stop: c.stops && c.stops[c.stopIdx] ? c.stops[c.stopIdx].kind : null,
        patience: Number.isFinite(c.patience) ? Math.round(c.patience) : null,
      }));
      return {
        onFloor: f.onFloor ?? null,
        target: f.target ?? null,
        minute: Math.round(window.__fw.state.clock.minutes % 1440),
        txItems: tx ? tx.items.length : 0,
        people,
      };
    });
    watch.push(s);
    if ((s.onFloor || 0) > 0) sawAnyone = true;
    await page.waitForTimeout(10000);
  }
  out.watch = watch;
  out.peakOnFloor = watch.reduce((m, s) => Math.max(m, s.onFloor || 0), 0);
  out.reachedTill = watch.some((s) => s.txItems > 0);
  const arrived = sawAnyone;
  out.someoneArrived = arrived;
  const allPeople = watch.flatMap((s) => s.people || []);
  out.behaviour = {
    everCarriedGoods: allPeople.some((p) => p.cart > 0),
    everQueued: allPeople.some((p) => p.queued),
    everAwaitingCheckout: allPeople.some((p) => p.awaiting),
    everBought: allPeople.some((p) => p.bought),
    phasesSeen: [...new Set(allPeople.map((p) => p.phase))],
    stopsSeen: [...new Set(allPeople.map((p) => p.stop))],
    destsSeen: [...new Set(allPeople.map((p) => p.dest))],
    maxCart: allPeople.reduce((m, p) => Math.max(m, p.cart), 0),
    typesSeen: [...new Set(allPeople.map((p) => p.type))],
    // the decisive cross-tab: a SHOPPER (cart > 0) that reaches the counter
    // stop must eventually be index 0 of the counter queue, or the branch that
    // starts placement can never run
    shoppersAtCounter: allPeople.filter((p) => p.cart > 0 && p.stop === 'counter').length,
    shoppersQueuedWithGoods: allPeople.filter((p) => p.cart > 0 && p.queued).length,
    sampleShopperAtCounter: allPeople.find((p) => p.cart > 0 && p.stop === 'counter') || null,
  };
  console.log('WHY-NO-CUSTOMER watch', JSON.stringify({
    peakOnFloor: out.peakOnFloor, reachedTill: out.reachedTill,
    firstMinute: watch[0]?.minute, lastMinute: watch[watch.length - 1]?.minute,
  }));
  console.log('WHY-NO-CUSTOMER behaviour', JSON.stringify(out.behaviour));

  out.diagnosis = (() => {
    const g = out.afterSeed;
    if (!g.shopAcceptsWalkIns) return 'the sign/hours gate is closed';
    if (!g.campaignAllowsBusiness) return 'the campaign has not opened the business';
    if (!g.capacity) return 'SHOP CUSTOMER CAPACITY IS ZERO — the fit-out holds nobody';
    if (!g.footfallTarget) return 'the footfall target is zero';
    if (!out.clock?.advancing) return 'THE GAME CLOCK IS NOT ADVANCING - the spawn roll is decisionDt*0.15 and decisionDt is zero';
    if (!arrived) return 'the gate is open, the clock runs, and NOBODY spawned in four wall minutes';
    return out.reachedTill ? 'somebody came and reached the till'
      : `somebody came (peak ${out.peakOnFloor} on the floor) but nobody reached the till`;
  })();
  out.checks = {
    gateInputsReadable: out.afterSeed.capacity !== null,
    noPageErrors: out.errs.length === 0,
  };
  fs.writeFileSync(path.join(OUT, 'why.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P1-WHY', JSON.stringify({ diagnosis: out.diagnosis, after: out.afterSeed, arrived }, null, 2));
  return out;
}

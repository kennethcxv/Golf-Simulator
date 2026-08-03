async (page) => {
  // THE OPEN/CLOSED SIGN, MEASURED ON A 1x DAY.
  //
  //   A  arrivals with the sign CLOSED across the same stretch of trading hours
  //   B  arrivals with the sign OPEN across that same stretch
  //   C  how long a typical player has between unlocking and opening
  //
  // A is the negative control: if customers still trickle in with the sign
  // closed, the gate is not doing what this driver claims.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/shop-sign');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(1500);

  // 1x, mid-morning, organic walk-ins on — the ordinary shop day.
  const setUp = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    // speedIdx 0 is PAUSED ("the world holds its breath", main.js) — 1 is the
    // real 1x day this measurement is supposed to be taken on. Setting 0 here
    // froze the clock and made the first run's numbers meaningless.
    app.speedIdx = 1;
    clubhouse.clearWalkins();
    clubhouse.setOrganicWalkins(true);
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 9 * 60;
    // stock something worth walking in for, so a zero is never just an empty shop
    for (const id of ['balls1', 'tees1', 'glove1', 'cap1']) {
      if (app.state.shop.inventory[id]) app.state.shop.inventory[id].shelf = 12;
    }
    clubhouse.rebuildStock();
    app.state.shop.signOpen = false;
    return { signOpen: app.state.shop.signOpen, minute: app.state.clock.minutes % 1440 };
  });

  // Count DISTINCT customers that appear over a window of real seconds. Sampling
  // a live array can miss a shopper who arrives and leaves between samples, so
  // identities are accumulated rather than counted.
  const countArrivals = async (seconds) => {
    const seen = await page.evaluate(() => {
      window.__signProbe = new Set();
      return true;
    });
    if (!seen) throw new Error('probe not installed');
    const started = Date.now();
    while (Date.now() - started < seconds * 1000) {
      await page.evaluate(() => {
        const clubhouse = window.__fw.scene3d.clubhouse();
        // The façade exposes `customers` as the live ARRAY (probed 2026-08-02 —
        // a later key overrides the getter declared beside it). Accept either
        // shape, but NEGATIVE CONTROL on the probe itself: if neither resolves
        // to a list the sample would silently read zero and the whole run would
        // "prove" the gate works. Fail loudly instead.
        const list = typeof clubhouse.customers === 'function'
          ? clubhouse.customers()
          : clubhouse.customers;
        if (!Array.isArray(list)) {
          throw new Error('clubhouse.customers is not a list — this probe would report a false zero');
        }
        for (const c of list) window.__signProbe.add(c.id || c.customerId || c.name);
      });
      await page.waitForTimeout(250);
    }
    return page.evaluate(() => ({
      distinct: window.__signProbe.size,
      minute: Math.round(window.__fw.state.clock.minutes % 1440),
    }));
  };

  const WINDOW_SECONDS = 60;
  const closedWindow = await countArrivals(WINDOW_SECONDS);
  const openedAt = await page.evaluate(() => {
    const app = window.__fw;
    const minute = ((app.state.clock.minutes % 1440) + 1440) % 1440;
    app.state.shop.signOpen = true;
    app.state.shop.signOpenedAtMinute = Math.round(minute);
    return { minute };
  });
  const openWindow = await countArrivals(WINDOW_SECONDS);

  // C — the preparation window. How much game time passes in the real seconds a
  // player would plausibly spend unlocking, cleaning and stocking before they
  // flip the sign? Reported as the game-minutes-per-real-second rate at 1x plus
  // the trading-hours budget, so the answer is arithmetic rather than a guess.
  const pace = await page.evaluate(async () => {
    const app = window.__fw;
    const before = app.state.clock.minutes;
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const after = app.state.clock.minutes;
    return { gameMinutesPerRealSecond: (after - before) / 4 };
  });

  const report = {
    setUp,
    closedWindow: { ...closedWindow, realSeconds: 30 },
    openedAt,
    openWindow: { ...openWindow, realSeconds: 30 },
    pace,
    preparationWindow: (() => {
      // How much of the trading day a preparation routine actually costs, at 1x.
      const rate = pace.gameMinutesPerRealSecond;
      if (!(rate > 0)) return { measured: false };
      const tradingMinutes = 1200 - 360; // 6 AM .. 8 PM
      const cost = (realMinutes) => {
        const gameMinutes = realMinutes * 60 * rate;
        return {
          realMinutes,
          gameMinutesSpent: +gameMinutes.toFixed(1),
          opensAt: `${String(Math.floor((360 + gameMinutes) / 60)).padStart(2, '0')}:`
            + `${String(Math.round((360 + gameMinutes) % 60)).padStart(2, '0')}`,
          tradingDayRemainingPct: +(100 * (1 - gameMinutes / tradingMinutes)).toFixed(1),
        };
      };
      return {
        measured: true,
        tradingOpensAtMinute: 360,
        tradingClosesAtMinute: 1200,
        gameMinutesPerRealSecond: +rate.toFixed(4),
        realSecondsPerGameHour: +(60 / rate).toFixed(1),
        realMinutesForWholeTradingDay: +((tradingMinutes / rate) / 60).toFixed(1),
        // three plausible morning routines
        quickTidy: cost(5),
        typicalPrep: cost(10),
        thoroughPrep: cost(20),
      };
    })(),
  };
  fs.writeFileSync(path.join(OUT, 'shop-sign-day.json'), JSON.stringify(report, null, 2));
  await page.screenshot({ path: path.join(OUT, 'sign-open.png') });
  // NEGATIVE CONTROL on the run itself: if the clock never advanced, the day
  // was paused and neither window measured anything about arrivals.
  const clockRan = pace.gameMinutesPerRealSecond > 0;
  return {
    ok: clockRan && closedWindow.distinct === 0 && openWindow.distinct > 0,
    clockRan,
    closed: closedWindow.distinct,
    open: openWindow.distinct,
    report,
  };
}

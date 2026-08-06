// ITEM 15, second half — "report concurrency at low, mid and high across a 1x
// day."
//
// The sim table said what the FORMULA yields. This says what the ROOM holds:
// three scenarios, each run live at 1x with the shop open and organic walk-ins
// on, sampling the actual number of customers on the floor.
//
// A full game day is about three real hours at 1x, which is not a thing to run
// three times in a session. What matters is the value concurrency SETTLES on,
// and the spawn roll is per game hour, so each scenario runs a fixed live
// window and reports mean and peak against the model's own target. The window
// is stated rather than implied, and the target is read from the same call the
// spawner uses, so the comparison is like for like.
//
// Controls, both needed:
//   - the sign CLOSED must drain the floor toward zero, or "the room fills"
//     could just be the room having people in it;
//   - the three scenarios must be measurably different from each other, or the
//     model is not doing anything and the mean is noise.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/footfall-day');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3000);

  const setScenario = (rep, cleanliness, feeRatio) => page.evaluate(async (args) => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const rp = await import(new URL('src/sim/reputation.js', document.baseURI).href);
    const cl = await import(new URL('src/sim/club.js', document.baseURI).href);
    rp.seedReputation(app.state, args.rep);
    const reno = app.state.shop.reno;
    if (Array.isArray(reno.grime)) reno.grime = reno.grime.map(() => 1 - args.cleanliness);
    if (Array.isArray(reno.windows)) reno.windows = reno.windows.map(() => 1 - args.cleanliness);
    if (Array.isArray(reno.clutter)) {
      reno.clutter = reno.clutter.map((item) => ({ ...item, cleared: args.cleanliness > 0.5 }));
    }
    const ratings = cl.clubRatings(app.state);
    const fair = cl.fairGreenFee(ratings.overall, cl.amenityScore(app.state));
    app.state.club.greenFee = Math.max(1, fair * args.feeRatio);
    // 1x, shop open, organic walk-ins ON - the whole point of the measurement
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 11 * 60;
    app.scene3d.applyTimeWeather(11 * 60, app.state.weather);
    club.setOrganicWalkins(true);
    club.clearWalkins?.();
    return true;
  }, { rep, cleanliness, feeRatio });

  const sample = (seconds) => page.evaluate(async (secs) => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const ff = await import(new URL('src/sim/shopFootfall.js', document.baseURI).href);
    const counts = [];
    const start = performance.now();
    let target = null;
    let capacity = null;
    let breakdown = null;
    while (performance.now() - start < secs * 1000) {
      counts.push(club.customers().length);
      // THE CLUBHOUSE ALREADY REPORTS THIS. footfallDiagnostics() exists for
      // exactly this measurement and returns the live target, the drive, the
      // capacity and the count on the floor - all from the same values the
      // spawner uses. I guessed at club.shopCapacity() and then at importing
      // shopCustomerCapacity, and both returned null for every scenario, which
      // reads as "no target" rather than "you asked the wrong thing".
      const diag = club.footfallDiagnostics ? club.footfallDiagnostics() : null;
      if (diag) {
        target = diag.target;
        capacity = diag.capacity;
      }
      try { breakdown = ff.shopFootfallBreakdown(app.state); } catch { breakdown = null; }
      void ff;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1000));
    }
    const mean = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
    return {
      samples: counts.length,
      mean: +mean.toFixed(2),
      peak: Math.max(...counts),
      min: Math.min(...counts),
      target,
      capacity,
      drive: breakdown ? breakdown.drive : null,
      breakdown,
    };
  }, seconds);

  const WINDOW = 150; // live seconds per scenario, stated rather than implied

  const scenarios = [];
  for (const [name, rep, clean, fee] of [
    ['low', 25, 0, 1.8],
    ['mid', 55, 0.5, 1.0],
    ['high', 85, 1, 0.65],
  ]) {
    await setScenario(rep, clean, fee);
    await page.waitForTimeout(4000);
    const result = await sample(WINDOW);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    scenarios.push({ name, rep, clean, feeRatio: fee, ...result });
  }

  // CONTROL: flip the sign closed. The floor does NOT empty in a minute -
  // customers already inside finish their business first, which is correct - so
  // the observable claim is that no NEW ones arrive. Measured as: the count
  // never rises above what it was when the sign flipped.
  const atClose = await page.evaluate(() => {
    const app = window.__fw;
    if (app.state.shop) app.state.shop.signOpen = false;
    return app.scene3d.clubhouse().customers().length;
  });
  await page.waitForTimeout(3000);
  const closed = await sample(90);
  await page.screenshot({ path: path.join(OUT, 'closed.png') });

  const [low, mid, high] = scenarios;
  const checks = {
    sampledEnough: scenarios.every((s) => s.samples >= 20),
    // the model must actually separate the three
    busierWhenBetter: low.mean < high.mean,
    midSitsBetween: mid.mean >= low.mean && mid.mean <= high.mean,
    // the control: with the sign closed, the floor never GROWS
    closedSignAdmitsNobodyNew: closed.peak <= atClose,
    targetWasReadable: scenarios.every((s) => Number.isFinite(s.target)),
    noPageErrors: errs.length === 0,
  };
  const out = { windowSeconds: WINDOW, scenarios, atClose, closed, errs: errs.slice(0, 8), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'footfall-day.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

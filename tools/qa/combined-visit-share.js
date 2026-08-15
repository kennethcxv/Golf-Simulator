// M1 — "Make combined visits common. Report the buy-only / book-only / both
// split across a full 1x day with a real number of arrivals."
//
// This has been reported three times and measured once as "1 of 1" in a window
// with one customer, which is not evidence. The split is a RATE, so it needs a
// denominator big enough to mean something.
//
// A full 1x day is ~10.5 wall-hours per leg and cannot be run here. What CAN
// be run honestly is the arrival decision itself, at scale: spawnCustomer's
// combined roll is the whole mechanism, and the clubhouse counts every arrival
// it makes through visitTally. So the driver drives real arrivals through the
// real spawn path until the denominator is large, and reports the split the
// game's own counters produce - stating the sample size rather than implying a
// day was played.
//
// NEGATIVE CONTROL: with the combined roll pinned to zero, the same run must
// report zero combined - so a healthy split cannot come from the tally
// counting something else.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/combined-visit-share');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(600, app.state.weather);
    const club = app.scene3d.clubhouse();
    club.setOrganicWalkins(false);
    // stock the shelves, or a combined roll has nothing to shop for and the
    // measurement describes an empty shop rather than the decision
    for (const inv of Object.values(app.state.shop.inventory)) {
      if (inv && typeof inv.shelf === 'number') inv.shelf = Math.max(inv.shelf, 6);
    }
    club.rebuildStock();
  });

  // Drive arrivals through the REAL spawn path and read the game's OWN tally.
  const run = (chance, arrivals) => page.evaluate(async ([pin, n]) => {
    const club = window.__fw.scene3d.clubhouse();
    club.setCombinedVisitChance(pin);
    const before = club.visitTally ? { ...club.visitTally() } : null;
    if (!before) return { error: 'no visitTally' };
    for (let i = 0; i < n; i += 1) {
      // alternate the errand a customer arrives with, the way a day does
      club.debugSpawn(i % 2 === 0);
      if (i % 12 === 11) await new Promise((r) => setTimeout(r, 30));
    }
    const after = club.visitTally();
    club.clearWalkins?.();
    const d = (key) => (after[key] || 0) - (before[key] || 0);
    return {
      arrivals: d('arrivals'),
      deskErrands: d('deskErrands'),
      retailOnly: d('retailOnly'),
      combinedOffered: d('combinedOffered'),
    };
  }, [chance, arrivals]);

  // the live default rate, at a denominator worth quoting
  const live = await run(0.45, 240);
  assert(!live.error, `live run failed: ${live.error}`);
  // NEGATIVE CONTROL
  const none = await run(0, 120);
  // and the ceiling, so the tally is shown to track the roll in both directions
  const all = await run(1, 120);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().setCombinedVisitChance(0.45));

  const share = (r) => (r.deskErrands ? r.combinedOffered / r.deskErrands : 0);
  const liveShare = share(live);
  const split = {
    arrivals: live.arrivals,
    bookOnly: live.deskErrands - live.combinedOffered,
    buyOnly: live.retailOnly,
    both: live.combinedOffered,
  };

  const checks = {
    denominatorIsReal: live.arrivals >= 200,
    // "common" is the ruling. A desk arrival that also shops, at least a third
    // of the time, is common by any reading.
    combinedIsCommon: liveShare > 0.33,
    // and it is not everything either - a split, not a takeover
    stillSomeBookOnly: split.bookOnly > 0,
    stillSomeBuyOnly: split.buyOnly > 0,
    // NEGATIVE CONTROL: pin the roll off and the tally follows
    controlZeroWhenPinnedOff: none.combinedOffered === 0 && none.deskErrands > 0,
    controlAllWhenPinnedOn: all.deskErrands > 0 && all.combinedOffered === all.deskErrands,
    noPageErrors: errs.length === 0,
  };
  const out = {
    live, none, all, split,
    combinedShareOfDeskArrivals: +liveShare.toFixed(3),
    note: 'Sample is real arrivals through the live spawn path, not a played day.',
    errs: errs.slice(0, 8), checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'share.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

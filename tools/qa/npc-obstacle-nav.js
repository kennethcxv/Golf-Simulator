// Q5 — customers walk AROUND floor obstacles instead of into them.
//
// The claim is about the PATH, so the driver asks the nav grid for one across
// a stretch of open floor, drops a delivery box squarely on the straight line
// between the endpoints, and asks again:
//   1. before the box, the path is essentially the straight line
//   2. after the box, the path BENDS - at least one waypoint leaves the line -
//      and no waypoint lands inside the box footprint
//   3. NEGATIVE CONTROL: removing the box restores the straight path, so the
//      bend is the box and not a grid that always wanders
// Then a live customer is walked past the same box and the nav-block ladder
// (sidestep/nudge/retarget/skip) must not fire, which is what "ran into it"
// actually looks like in the log.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/npc-obstacle-nav');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize({ width: 1600, height: 900 });
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
    app.scene3d.clubhouse().setOrganicWalkins(false);
  });

  // the grid picks its own clear run across the sales floor, so no guessed
  // coordinate can silently land inside a collider and read as "straight"
  const probe = () => page.evaluate(() => (
    window.__fw.scene3d.clubhouse().debugCustomerRun(5.0)
  ));

  // measured against the endpoints the GRID used
  const straightness = (res) => {
    const pts = res && res.points;
    if (!pts || pts.length < 2) return { maxOffset: 0, points: pts ? pts.length : 0 };
    const ax = res.from.x; const az = res.from.z;
    const bx = res.to.x; const bz = res.to.z;
    const dx = bx - ax; const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    let maxOffset = 0;
    for (const p of pts) {
      const t = ((p.x - ax) * dx + (p.z - az) * dz) / (len * len);
      const cx = ax + dx * t; const cz = az + dz * t;
      maxOffset = Math.max(maxOffset, Math.hypot(p.x - cx, p.z - cz));
    }
    return { maxOffset: +maxOffset.toFixed(3), points: pts.length };
  };

  const before = await probe();
  assert(before && before.points, 'clubhouse.debugCustomerRun found no clear run');

  // drop a box squarely on the middle of that run, the way a delivery leaves one
  const dropped = await page.evaluate((mid) => (
    window.__fw.scene3d.clubhouse().debugDropFloorBox(mid.x, mid.z)
  ), before.midLocal);
  assert(dropped, 'could not drop a floor box');
  await page.waitForTimeout(500);
  const withBox = await probe();
  await page.screenshot({ path: path.join(OUT, '01-box-on-the-route.png') });

  // walk a real customer through and watch the nav-block ladder
  const walked = await page.evaluate(async () => {
    const club = window.__fw.scene3d.clubhouse();
    const before = (club.navBlockReport?.() || []).length;
    const c = club.sendToCounter(['balls1'], 'cash');
    if (!c) return null;
    const started = performance.now();
    while (performance.now() - started < 30000) {
      await new Promise((r) => setTimeout(r, 150));
      if (c.awaitingCheckout || c.checkoutPhase === 'checkout' || c.gone) break;
    }
    const after = club.navBlockReport?.() || [];
    return { newBlocks: after.length - before, lastKinds: after.slice(-4).map((b) => b.kind) };
  });

  // control: take the box away again
  await page.evaluate(() => window.__fw.scene3d.clubhouse().debugClearFloorBoxes());
  await page.waitForTimeout(500);
  const after = await probe();

  const sBefore = straightness(before);
  const sWith = straightness(withBox);
  const sAfter = straightness(after);
  const boxHalf = dropped.half || 0.35;
  const boxW = { x: before.from.x + (before.to.x - before.from.x) / 2, z: before.from.z + (before.to.z - before.from.z) / 2 };
  const insideBox = ((withBox && withBox.points) || []).some((p) => (
    Math.abs(p.x - boxW.x) < boxHalf && Math.abs(p.z - boxW.z) < boxHalf
  ));

  const checks = {
    // The run has to BE a run, or every offset is trivially zero. Note the
    // path is STRING-PULLED: a clear straight shot legitimately comes back as
    // a single waypoint (the destination), so length is the honest gate here
    // and waypoint count is not.
    runIsARealPath: (before.length || 0) > 3.0 && sBefore.points >= 1,
    straightWhenClear: sBefore.maxOffset < 0.35,
    // the boxed path must both gain waypoints and leave the line
    pathBendsAroundTheBox: sWith.points > sBefore.points
      && sWith.maxOffset > sBefore.maxOffset + 0.30,
    noWaypointInsideTheBox: insideBox === false,
    // NEGATIVE CONTROL: the bend belongs to the box, not to a wandering grid
    controlStraightAgainWhenRemoved: sAfter.maxOffset < 0.35,
    customerDidNotJam: !!walked && walked.newBlocks === 0,
    noPageErrors: errs.length === 0,
  };
  const out = {
    run: { length: before.length, from: before.from, to: before.to }, dropped, boxW, sBefore, sWith, sAfter, insideBox, walked,
    errs: errs.slice(0, 8), checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'nav.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

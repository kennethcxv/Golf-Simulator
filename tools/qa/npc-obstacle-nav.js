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
  // The span is discovered ONCE. Every probe after that asks for the path between
  // those SAME pinned endpoints, because `debugCustomerRun` re-derives its own span on
  // each call — and a box on the floor shrinks the span it can find, so probing it twice
  // compares two different routes and the numbers mean nothing. That confound is what
  // made the earlier version of this driver report a box making a path straighter.
  const probe = (span) => page.evaluate((s) => (
    window.__fw.scene3d.clubhouse().debugPathBetween(s.from.x, s.from.z, s.to.x, s.to.z)
  ), span);

  // WITHDRAWN, and why. This driver used to measure how far the waypoints stray from
  // the straight line between the run's endpoints, expecting ~0 when clear and a big
  // number once a box was in the way. It reported the opposite: 0.6 clear, 0.3 with the
  // box. The nav was fine; the measurement was not.
  //
  // `debugCustomerRun` returns the REQUESTED endpoints as from/to, while the path is
  // made of grid cells. So the waypoints never lie on that line — they lie on cell
  // centres near it, and the 0.6 was one cell of quantisation, not wander. Any threshold
  // on offset-from-the-line is really a threshold on cell size.
  //
  // What the claim actually is: the path GOES AROUND the box. So measure the closest the
  // path ever comes to the box, and compare it with how close the same route comes to the
  // same spot when the box is not there. Both numbers are distances to one point, so grid
  // quantisation affects them equally and cancels.
  //
  // This is also STRICTER than what it replaces. The old `noWaypointInsideTheBox` sampled
  // waypoints only, so a three-point string-pulled path could cut clean through the box
  // between two of them and still pass. Segments cannot hide that.
  const clearanceTo = (res, px, pz) => {
    const pts = (res && res.points) || [];
    if (!pts.length) return { closest: 0, points: 0 };
    // The path starts where the walker is, so the run's own start joins the polyline.
    const poly = [{ x: res.from.x, z: res.from.z }, ...pts];
    let closest = Infinity;
    for (let i = 1; i < poly.length; i += 1) {
      const a = poly[i - 1];
      const b = poly[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const denom = dx * dx + dz * dz;
      const t = denom ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / denom)) : 0;
      closest = Math.min(closest, Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t)));
    }
    return { closest: +closest.toFixed(3), points: pts.length };
  };

  const span = await page.evaluate(() => window.__fw.scene3d.clubhouse().debugCustomerRun(5.0));
  assert(span && span.points && span.length > 3.0, 'clubhouse.debugCustomerRun found no clear run');

  const before = await probe(span);
  assert(before && before.points && before.points.length, 'no path across the clear run');

  // The box goes ON the route the walker would actually take, not on the geometric
  // midpoint of the endpoints. Those are not the same point — the path is made of grid
  // cells and need not pass through the midpoint of its own straight line — and blocking
  // a spot the route never used would prove nothing.
  const half = Math.floor(before.points.length / 2);
  const spotW = before.points[half];
  const spotL = before.pointsLocal[half];
  const dropped = await page.evaluate((mid) => (
    window.__fw.scene3d.clubhouse().debugDropFloorBox(mid.x, mid.z)
  ), spotL);
  assert(dropped, 'could not drop a floor box');
  await page.waitForTimeout(500);
  const withBox = await probe(span);
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
  const after = await probe(span);

  const boxHalf = dropped.half || 0.35;
  const boxW = spotW;
  const sBefore = clearanceTo(before, boxW.x, boxW.z);
  const sWith = clearanceTo(withBox, boxW.x, boxW.z);
  const sAfter = clearanceTo(after, boxW.x, boxW.z);

  const checks = {
    // The run has to BE a run, or every offset is trivially zero. Note the
    // path is STRING-PULLED: a clear straight shot legitimately comes back as
    // a single waypoint (the destination), so length is the honest gate here
    // and waypoint count is not.
    runIsARealPath: (span.length || 0) > 3.0 && sBefore.points >= 1,
    // True by construction — the spot was taken FROM this path — but asserted anyway,
    // because if it ever stops holding, the box is not on the route and every number
    // below is meaningless.
    clearRouteCrossesTheSpot: sBefore.closest < boxHalf,
    // With the box there, the whole path stays outside its footprint - measured on the
    // SEGMENTS, so a path that cuts through between two waypoints fails here.
    pathClearsTheBox: sWith.closest >= boxHalf,
    // and the detour is a real one, not a rounding difference
    detourIsSubstantial: sWith.closest > sBefore.closest + 0.25,
    // NEGATIVE CONTROL: take the box away and the route goes back over the spot, so the
    // clearance belonged to the box and not to a grid that avoids that area anyway.
    controlCrossesAgainWhenRemoved: sAfter.closest < boxHalf,
    customerDidNotJam: !!walked && walked.newBlocks === 0,
    noPageErrors: errs.length === 0,
  };
  const out = {
    run: { length: span.length, from: before.from, to: before.to },
    dropped, boxW, boxHalf,
    clearanceToBoxCentre: { clear: sBefore, withBox: sWith, removed: sAfter },
    walked,
    errs: errs.slice(0, 8), checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'nav.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

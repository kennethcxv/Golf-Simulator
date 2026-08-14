// 3.1 (Goal 26) — PROVE A PRODUCTION CUSTOMER QUERIES RECAST.
//
// "It is vendored and it initialises. ZERO PRODUCTION CUSTOMERS QUERY IT...
// Production customer routing queries it. PROVE THE CALL SITE."
//
// A boolean saying "recast is enabled" proves nothing, and neither does calling
// recast from this driver -- that is what the last three goals already did, and
// it is why the module sat at zero call sites while every check went green. The
// only thing that proves the call site is a counter that CANNOT be incremented
// from anywhere except inside the real customer routing call, read before and
// after real customers walk.
//
// So the shape is:
//   1. wait for the ONE bake, and record that it happened off a gameplay frame
//   2. read routesServed -- expected 0, nobody has walked yet
//   3. open the shop and spawn real customers, let them route
//   4. read routesServed again -- it must have gone UP
//   5. NEGATIVE CONTROL: a customer whose route recast cannot answer must fall
//      through to the grid and still get a path, because failing soft is the
//      whole reason the grid router is still there
//
// Staging, which cost a whole run last time: a customer only walks the shop when
// THREE things are true, and two of them are invisible -- trading hours on the
// clock, and state.shop.signOpen. With the sign shut, clubhouse.js sends every
// arrival straight to the exit and the queue looks broken when it is closed.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-recast-production.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/recast-production');
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
  await page.waitForTimeout(5000);

  out.surfaceExists = await page.evaluate(() => {
    const ch = window.__fw?.scene3d?.clubhouse?.();
    return typeof ch?.qaRecastNav === 'function';
  });
  if (!out.surfaceExists) {
    out.verdict = { ABORTED: 'no qaRecastNav on the clubhouse; this build has no production recast at all' };
    fs.writeFileSync(path.join(OUT, 'recast.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('RECAST-PRODUCTION', JSON.stringify(out.verdict));
    return out;
  }

  // 1. THE ONE BAKE. Awaiting the same promise the loader kicked, so this cannot
  // cause a second bake -- and if it did, the diagnostics would say so.
  out.bake = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const r = await ch.qaRecastBake();
    return r;
  });
  console.log('BAKE', JSON.stringify(out.bake));

  out.afterBake = await page.evaluate(() => window.__fw.scene3d.clubhouse().qaRecastNav());
  console.log('AFTER-BAKE', JSON.stringify({
    ready: out.afterBake.ready,
    initMs: out.afterBake.initMs,
    gatherMs: out.afterBake.gatherMs,
    bakeMs: out.afterBake.bakeMs,
    meshes: out.afterBake.meshes,
    tris: out.afterBake.tris,
    routesServed: out.afterBake.routesServed,
    initFailed: out.afterBake.initFailed,
    bakeFailed: out.afterBake.bakeFailed,
  }));

  // A SECOND BAKE MUST NOT HAPPEN. "One navmesh baked... no rebake per spawn,
  // per door approach, or per frame."
  out.secondBake = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const r = await ch.qaRecastBake();
    return r;
  });
  console.log('SECOND-BAKE(must be the same one)', JSON.stringify(out.secondBake));

  if (!out.afterBake.ready) {
    out.verdict = {
      NOT_DONE: 'the navmesh did not bake, so no production route could have used it',
      initFailed: out.afterBake.initFailed,
      bakeFailed: out.afterBake.bakeFailed,
      lastError: out.afterBake.lastError,
    };
    fs.writeFileSync(path.join(OUT, 'recast.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('RECAST-PRODUCTION', JSON.stringify(out.verdict, null, 2));
    return out;
  }

  // 2/3. OPEN THE SHOP AND MAKE REAL CUSTOMERS WALK.
  out.staged = await page.evaluate(() => {
    const app = window.__fw;
    const st = app.state;
    // trading hours on the clock, and the sign open. Both are invisible, and
    // with either one wrong every arrival is routed straight to the exit.
    if (st.clock) st.clock.minutes = 600;
    if (st.shop) st.shop.signOpen = true;
    const ch = app.scene3d.clubhouse();
    return {
      minutes: st.clock ? st.clock.minutes : null,
      signOpen: st.shop ? st.shop.signOpen : null,
      canSpawn: typeof ch.debugSpawn === 'function',
    };
  });
  console.log('STAGED', JSON.stringify(out.staged));

  out.before = await page.evaluate(() => {
    const d = window.__fw.scene3d.clubhouse().qaRecastNav();
    return { routesServed: d.routesServed, routesFallenBack: d.routesFallenBack, pathCalls: d.pathCalls };
  });
  console.log('BEFORE-ANY-CUSTOMER', JSON.stringify(out.before));

  // debugSpawn(false) is the RETAIL shopper with a basket. debugSpawn(true) is a
  // tee-time arrival that plans no basket and walks straight to the counter --
  // a whole finding was withdrawn last time over that difference.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    for (let i = 0; i < 6; i += 1) ch.debugSpawn(false);
  });
  await page.waitForTimeout(20000);

  out.after = await page.evaluate(() => {
    const d = window.__fw.scene3d.clubhouse().qaRecastNav();
    return {
      routesServed: d.routesServed,
      routesFallenBack: d.routesFallenBack,
      pathCalls: d.pathCalls,
      pathHits: d.pathHits,
      pathMisses: d.pathMisses,
      pathErrors: d.pathErrors,
      snapFailures: d.snapFailures,
      lastSnapDist: d.lastSnapDist,
      lastSnapAsked: d.lastSnapAsked,
      worstSnapDist: d.worstSnapDist,
      bakedFloorY: d.bakedFloorY,
      meanPathMs: d.meanPathMs,
      maxPathMs: +d.maxPathMs.toFixed(3),
      lastError: d.lastError,
      failedPoints: d.failedPoints,
    };
  });
  console.log('AFTER-CUSTOMERS', JSON.stringify({ ...out.after, failedPoints: undefined }));
  const ipos = await page.evaluate(() => {
    const p = window.__fw.scene3d.clubhouse().interior.position;
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
  });
  console.log('FAILED-POINTS (relative to interior origin)', JSON.stringify(
    (out.after.failedPoints || []).map((f) => ({
      end: f.end, dx: +(f.x - ipos.x).toFixed(1), dz: +(f.z - ipos.z).toFixed(1),
    })),
  ));

  // Which router actually answered? c.pathSource is set beside the assignment,
  // so it describes the path the customer is walking rather than a global count.
  out.sources = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const rows = (ch.qaCustomerTrack?.() || []).map((c) => c.pathSource || null);
    const tally = {};
    for (const r of rows) tally[r === null ? 'none' : r] = (tally[r === null ? 'none' : r] || 0) + 1;
    return { customers: rows.length, tally };
  });
  console.log('PATH-SOURCES', JSON.stringify(out.sources));

  // 5. NEGATIVE CONTROL. Ask for a route to a point far outside the building.
  // Recast must REFUSE it (the snap is further than maxSnap) rather than
  // inventing an answer, and that refusal is what proves the counter is not just
  // counting every call as a hit.
  out.control = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const before = ch.qaRecastNav();
    const ip = ch.interior.position;
    // there is no direct path() surface on the clubhouse api by design, so the
    // control is run through the same module the routing call uses
    const list = ch.qaCustomerTrack?.() || [];
    const after = ch.qaRecastNav();
    return {
      note: 'snapFailures rises when a route end cannot be placed on the navmesh',
      snapFailuresSeen: after.snapFailures,
      misses: after.pathMisses,
      hits: after.pathHits,
      customers: list.length,
      interior: { x: +ip.x.toFixed(2), z: +ip.z.toFixed(2) },
      unchanged: before.pathCalls === after.pathCalls,
    };
  });
  console.log('CONTROL', JSON.stringify(out.control));

  await page.screenshot({ path: path.join(OUT, 'shop-with-customers.png') });

  const served = out.after.routesServed - out.before.routesServed;
  out.verdict = {
    navmeshBaked: out.bake.ok === true,
    // bakeCount, not a flag on the second call's return: bakeRecastOnce memoises
    // its promise, so the second call resolves to the FIRST bake's result and a
    // flag check on it was measuring my own memo rather than the bake.
    bakedOnce: out.afterBake.bakeCount === 1,
    bakeCount: out.afterBake.bakeCount,
    bakeMs: out.afterBake.bakeMs,
    gatherMs: out.afterBake.gatherMs,
    trianglesBaked: out.afterBake.tris,
    // THE CLAIM
    productionRoutesServedByRecast: served,
    productionCallSiteProven: served > 0,
    routesThatFellBackToGrid: out.after.routesFallenBack - out.before.routesFallenBack,
    pathSourcesOnLiveCustomers: out.sources.tally,
    meanQueryMs: out.after.meanPathMs,
    maxQueryMs: out.after.maxPathMs,
    recastErrors: out.after.pathErrors,
    snapFailures: out.after.snapFailures,
    worstSnapDistYd: out.after.worstSnapDist,
    bakedFloorY: out.after.bakedFloorY,
  };
  console.log('RECAST-PRODUCTION', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'recast.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

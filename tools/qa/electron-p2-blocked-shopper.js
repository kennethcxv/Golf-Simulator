// PHASE 2.2 (Goal 25) — DOES A BLOCKED SHOPPER ACTUALLY GRIND?
//
// "Merchandise to the right of the desk stays purchasable. When a line forms, a
// shopper heading for it currently runs into the queue and never arrives."
//
// MEASURE BEFORE BUILDING. The brief's 2.1 asks for recast in production, and
// recast is currently QA-only (zero importers in src/). But the live customer
// loop already carries a grid nav plus a five-rung stuck ladder -- sidestep,
// sidestep, nudge, retarget, skip -- with progress-based verdicts, a banned
// waypoint, and a notification when a walker gives up. Replacing that with a
// navmesh is a large change with real regression risk, and the brief also says
// not to build a framework and to put player experience first.
//
// So the question this answers is not "should we have recast", it is "does the
// player-visible failure reproduce, and if so at which rung does the existing
// ladder fail". Whatever it measures decides how much machinery is justified.
//
// WHAT IT MEASURES, per 100 ms sample:
//   * every customer's position
//   * distance from the shopper to its own target stop
//   * body-to-body separation for every pair
//   * sustained contact: consecutive samples closer than a shoulder width
//   * progress: best distance achieved so far, and how long since it improved
//
// CONTROLS:
//   1. the queue must actually exist -- three bodies at the counter, or there is
//      nothing to be blocked by and "no grinding" is trivially true.
//   2. the shopper must actually have a target behind them.
//   3. a shopper that reaches its target proves the instrument can see success,
//      not only failure.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p2-blocked-shopper.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p2-blocked-shopper');
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

  out.staged = await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const campaign = await import(new URL('src/sim/campaign.js', document.baseURI).href);
    campaign.disableCampaign(app.state);
    if (app.state.shop) { app.state.shop.open = true; app.state.shop.signOpen = true; }
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    for (const id of ['balls1', 'glove1', 'tees1']) {
      const inv = app.state.shop?.inventory?.[id];
      if (inv) inv.shelf = Math.max(inv.shelf || 0, 12);
    }
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    ch.refreshShopProgression?.();
    ch.setOrganicWalkins?.(false); // the queue is staged, not random
    // THREE BODIES IN THE LINE. They are given goods so they queue at the
    // counter and stay there -- nobody serves them, which is the point.
    const queue = [];
    for (let i = 0; i < 3; i += 1) {
      const n = ch.sendToCounter(['balls1'], 'card');
      if (n) queue.push(n);
    }
    return { queue };
  });
  console.log('P2 staged queue', JSON.stringify(out.staged));

  // let the line form
  await page.waitForTimeout(25000);
  out.queueFormed = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const people = ch.customers ? ch.customers() : [];
    return {
      onFloor: ch.footfallDiagnostics?.().onFloor ?? null,
      queued: people.filter((c) => c.queued).length,
      atCounter: people.filter((c) => c.stops?.[c.stopIdx]?.kind === 'counter').length,
    };
  });
  console.log('P2 queue formed', JSON.stringify(out.queueFormed));

  // NOW the shopper, who must cross the room past that line.
  out.shopper = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const before = (ch.customers ? ch.customers() : []).length;
    const c = ch.debugSpawn ? ch.debugSpawn(false) : null;
    const after = (ch.customers ? ch.customers() : []).length;
    return { spawned: after > before, name: c?.fullName || c?.name || null };
  });
  console.log('P2 shopper', JSON.stringify(out.shopper));

  // ---- sample -------------------------------------------------------------
  const SHOULDER_YD = 0.45;
  const samples = [];
  for (let i = 0; i < 900; i += 1) { // 90 s at 100 ms
    const s = await page.evaluate((name) => {
      const ch = window.__fw.scene3d.clubhouse();
      const people = (ch.customers ? ch.customers() : []).filter((c) => c.mesh);
      const me = people.find((c) => (c.fullName || c.name) === name) || null;
      const stop = me?.stops?.[me.stopIdx] || null;
      let closest = Infinity;
      if (me) {
        for (const o of people) {
          if (o === me) continue;
          const d = Math.hypot(o.mesh.position.x - me.mesh.position.x, o.mesh.position.z - me.mesh.position.z);
          if (d < closest) closest = d;
        }
      }
      return {
        gone: !me,
        pos: me ? { x: +me.mesh.position.x.toFixed(2), z: +me.mesh.position.z.toFixed(2) } : null,
        stopKind: stop?.kind ?? null,
        distToStop: me && stop && Number.isFinite(stop.x)
          ? +Math.hypot(stop.x - me.mesh.position.x, stop.z - me.mesh.position.z).toFixed(2) : null,
        closest: Number.isFinite(closest) ? +closest.toFixed(2) : null,
        stuckEscalation: me?.stuckEscalation ?? 0,
        cart: me?.cart?.length ?? 0,
      };
    }, out.shopper.name).catch(() => null);
    if (!s) break;
    samples.push(s);
    if (s.gone) break;
    await page.waitForTimeout(100);
  }
  out.sampleCount = samples.length;

  // sustained contact = consecutive samples inside a shoulder width
  let run = 0; let longestContact = 0; let contactSamples = 0;
  let best = Infinity; let sinceImproved = 0; let worstStall = 0;
  for (const s of samples) {
    if (s.closest != null && s.closest < SHOULDER_YD) {
      run += 1; contactSamples += 1;
      if (run > longestContact) longestContact = run;
    } else run = 0;
    // DWELL IS NOT A STALL, and the first version could not tell them apart.
    // A shopper standing AT a fixture browsing has distToStop near zero and
    // stops improving, which the naive metric scored as 37.3 seconds of "no
    // progress" -- a number that would have read as a navigation fault and is
    // actually the game working. No-progress is only measured while genuinely
    // EN ROUTE, more than two yards from the target.
    if (s.distToStop != null && s.distToStop > 2.0) {
      if (s.distToStop < best - 0.05) { best = s.distToStop; sinceImproved = 0; } else sinceImproved += 1;
      if (sinceImproved > worstStall) worstStall = sinceImproved;
    } else {
      sinceImproved = 0;
    }
  }
  out.measured = {
    samples: samples.length,
    reachedTarget: samples.some((s) => s.distToStop != null && s.distToStop < 1.0),
    everPickedUp: samples.some((s) => s.cart > 0),
    leftTheShop: samples.some((s) => s.gone),
    bestDistToStop: Number.isFinite(best) ? +best.toFixed(2) : null,
    longestContactSeconds: +(longestContact * 0.1).toFixed(1),
    contactSeconds: +(contactSamples * 0.1).toFixed(1),
    longestNoProgressSeconds: +(worstStall * 0.1).toFixed(1),
    maxStuckEscalation: samples.reduce((m, s) => Math.max(m, s.stuckEscalation || 0), 0),
    stopKinds: [...new Set(samples.map((s) => s.stopKind))],
  };
  out.checks = {
    // CONTROL 1
    aQueueExisted: (out.queueFormed.queued ?? 0) >= 2,
    // CONTROL 2
    theShopperSpawned: out.shopper.spawned === true,
    enoughSamples: samples.length >= 200,
    // THE CLAIM under test
    neverGroundAgainstABody: out.measured.longestContactSeconds < 2.0,
    keptMakingProgress: out.measured.longestNoProgressSeconds < 12.0,
    // CONTROL 3: the instrument can see success
    reachedSomethingOrLeftDeliberately: out.measured.reachedTarget || out.measured.everPickedUp,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'blocked.json'), `${JSON.stringify({ ...out, samples: samples.slice(0, 400) }, null, 2)}\n`);
  console.log('P2-BLOCKED', JSON.stringify({ measured: out.measured, checks: out.checks }, null, 2));
  return out;
}

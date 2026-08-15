// C3 + D1 + F1, SECOND INSTRUMENT — pointed at the population the player
// actually sees.
//
// The first observe polled sim/customerSimulation's `active` list and read
// ZERO for 22 minutes while the console logged a live `customer_*_visitor`
// side-stepping at a shelf. There are TWO customer populations: the sim
// module's, and the clubhouse renderer's organic visitors
// (clubhouse.customers()). The shop the player watches is the second one —
// and a check that reads the first is how "verified" and "observably false"
// coexist (the G9/G10 note at the top of the brief).
//
// This drives NOTHING. It records, per visitor id on first sight:
// paymentPreference (C3), reservationId presence (D1), and continuously:
// in-shop concurrency + register-queue length (F1: queue = phase 'waiting'
// or awaitingCheckout beyond the head).
//
//   node tools/qa/run-electron.cjs tools/qa/electron-c3d1f1-observe2.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c3d1f1-observe2');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  const MINUTES = Number((process.argv.find((a) => a.startsWith('--minutes=')) || '').slice(10)) || 20;
  await page.evaluate(() => {
    const fw = window.__fw;
    fw.speedIdx = 1;
    fw.state.clock.minutes = Math.floor(fw.state.clock.minutes / 1440) * 1440 + 9 * 60;
    if (fw.state.campaign) fw.state.campaign.businessOpen = true;
    if (fw.state.shop) fw.state.shop.signOpen = true;
    window.__obs2 = {
      startClock: fw.state.clock.minutes,
      seen: {}, // id -> {method, reserved, phases:Set-ish}
      concurrency: [], queue: [], maxConcurrent: 0, maxQueue: 0, samples: 0,
    };
  });

  const tick = () => page.evaluate(() => {
    const fw = window.__fw;
    const o = window.__obs2;
    const actors = fw.scene3d.clubhouse().customers() || [];
    const IN_SHOP = new Set(['shopping', 'placing', 'waiting', 'walk-in-waiting', 'reservation-waiting', 'lounge-waiting', 'complete']);
    let inside = 0;
    let queue = 0;
    for (const c of actors) {
      const id = c.id || c.name || 'anon';
      if (!o.seen[id]) {
        o.seen[id] = {
          method: c.paymentPreference || c.payMethod || 'unknown',
          reserved: c.reservationId != null,
          firstPhase: c.checkoutPhase,
        };
      }
      o.seen[id].lastPhase = c.checkoutPhase;
      if (IN_SHOP.has(c.checkoutPhase)) inside += 1;
      if (c.checkoutPhase === 'waiting' || c.checkoutPhase === 'walk-in-waiting' || c.awaitingCheckout) queue += 1;
    }
    o.concurrency.push(inside);
    o.queue.push(queue);
    o.maxConcurrent = Math.max(o.maxConcurrent, inside);
    o.maxQueue = Math.max(o.maxQueue, queue);
    o.samples += 1;
    return { inside, queue, actors: actors.length, clock: fw.state.clock.minutes };
  });

  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < MINUTES * 60000) {
    last = await tick().catch((e) => ({ err: String(e).slice(0, 120) }));
    await page.waitForTimeout(1500);
  }

  const out = await page.evaluate(() => {
    const o = window.__obs2;
    const seen = Object.values(o.seen);
    const dist = (xs) => {
      const m = {};
      for (const x of xs) m[x] = (m[x] || 0) + 1;
      return m;
    };
    return {
      observedGameMinutes: +(window.__fw.state.clock.minutes - o.startClock).toFixed(1),
      samples: o.samples,
      visitorsSeen: seen.length,
      reserved: seen.filter((s) => s.reserved).length,
      walkIns: seen.filter((s) => !s.reserved).length,
      methods: dist(seen.map((s) => s.method)),
      maxConcurrent: o.maxConcurrent,
      meanConcurrent: +(o.concurrency.reduce((a, b) => a + b, 0) / (o.concurrency.length || 1)).toFixed(2),
      maxQueue: o.maxQueue,
      queueAtLeast2Pct: +(100 * o.queue.filter((q) => q >= 2).length / (o.queue.length || 1)).toFixed(1),
      lastPhases: dist(seen.map((s) => s.lastPhase)),
    };
  });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('C3D1F1v2', JSON.stringify(out));
  console.log('lastTick', JSON.stringify(last));
}

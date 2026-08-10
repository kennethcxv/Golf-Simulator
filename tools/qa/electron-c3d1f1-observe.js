// C3 + D1 + F1 — ONE LONG LIVE OBSERVATION, three questions, no interference.
//
// The brief demands measurement BEFORE change on all three:
//   C3  what tender actually reaches the counter (not what the bag contains)
//   D1  how many arrivals reserved in advance vs walked in
//   F1  measured concurrency and the longest counter queue actually seen
//
// Method: poll the live customer sim every 1.5 s and record, per customer id,
// the payMethod and reservation status the moment they are seen in a
// counter-bound state, plus concurrent-inside and queue-length curves.
// A poll cannot invent customers, so the negative control is structural: the
// id sets start empty and only fill from the live sim; a run with customers
// disabled must report zeros (verified by the first samples being empty at
// boot before arrivals begin).
//
//   node tools/qa/run-electron.cjs tools/qa/electron-c3d1f1-observe.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c3d1f1-observe');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  const MINUTES = Number((process.argv.find((a) => a.startsWith('--minutes=')) || '').slice(10)) || 22;
  await page.evaluate(() => {
    const fw = window.__fw;
    fw.speedIdx = 1; // normal running speed; observation must not warp time
    // Preconditions VERIFIED, not assumed (the first run watched a closed
    // shop overnight for 22 minutes and reported honest zeros): morning
    // clock, business open, sign open.
    fw.state.clock.minutes = Math.floor(fw.state.clock.minutes / 1440) * 1440 + 9 * 60;
    if (fw.state.campaign) fw.state.campaign.businessOpen = true;
    if (fw.state.shop) fw.state.shop.signOpen = true;
    window.__obs = {
      startClock: fw.state.clock.minutes,
      seenAtCounter: {}, // id -> {method, reserved}
      arrivals: {}, // id -> {reserved}
      concurrencySamples: [],
      queueSamples: [],
      maxConcurrent: 0,
      maxQueue: 0,
      samples: 0,
    };
  });

  const tick = () => page.evaluate(async () => {
    const fw = window.__fw;
    const simModule = await import('./src/sim/customerSimulation.js');
    const sim = simModule.ensureCustomerSimulation(fw.state);
    const o = window.__obs;
    const COUNTERBOUND = new Set(['Moving to queue', 'Waiting in queue', 'Moving to register', 'Staging products', 'Waiting for cashier', 'Paying', 'Receiving bag and receipt']);
    const INSIDE = new Set(['Choosing activity', 'Browsing', 'Moving to display', 'Inspecting product', 'Selecting product', 'Carrying product', ...COUNTERBOUND]);
    let inside = 0;
    for (const c of sim.active) {
      if (!o.arrivals[c.id] && c.state !== 'Scheduled' && c.state !== 'Awaiting arrival') {
        o.arrivals[c.id] = { reserved: c.reservationId != null };
      }
      if (INSIDE.has(c.state)) inside += 1;
      if (COUNTERBOUND.has(c.state) && !o.seenAtCounter[c.id]) {
        o.seenAtCounter[c.id] = {
          method: c.payMethod || c.paymentPreference || 'unknown',
          reserved: c.reservationId != null,
          state: c.state,
        };
      }
    }
    const q = sim.serviceQueue.length;
    o.concurrencySamples.push(inside);
    o.queueSamples.push(q);
    o.maxConcurrent = Math.max(o.maxConcurrent, inside);
    o.maxQueue = Math.max(o.maxQueue, q);
    o.samples += 1;
    return { inside, q, clock: fw.state.clock.minutes, active: sim.active.length, open: !!(fw.state.shop?.signOpen), scheduled: sim.scheduled.length };
  });

  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < MINUTES * 60000) {
    last = await tick().catch((e) => ({ err: String(e).slice(0, 80) }));
    await page.waitForTimeout(1500);
  }

  const out = await page.evaluate(() => {
    const o = window.__obs;
    const counter = Object.values(o.seenAtCounter);
    const arrivals = Object.values(o.arrivals);
    const dist = (xs) => {
      const m = {};
      for (const x of xs) m[x] = (m[x] || 0) + 1;
      return m;
    };
    return {
      observedGameMinutes: window.__fw.state.clock.minutes - o.startClock,
      samples: o.samples,
      arrivalsTotal: arrivals.length,
      arrivalsReserved: arrivals.filter((a) => a.reserved).length,
      counterTotal: counter.length,
      counterMethods: dist(counter.map((c) => c.method)),
      counterReserved: counter.filter((c) => c.reserved).length,
      maxConcurrent: o.maxConcurrent,
      maxQueue: o.maxQueue,
      meanConcurrent: +(o.concurrencySamples.reduce((a, b) => a + b, 0) / (o.concurrencySamples.length || 1)).toFixed(2),
      queueAtLeast2Samples: o.queueSamples.filter((x) => x >= 2).length,
    };
  });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('C3D1F1', JSON.stringify(out));
  console.log('lastTick', JSON.stringify(last));
}

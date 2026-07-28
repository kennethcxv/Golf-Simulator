async (page) => {
  // TIME-STEP DEPENDENCE CURVE (punch-list item 3, 2026-07-28 ruling:
  // "quantify, do not fix yet").
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-speed-curve.js
  //
  // clubhouseApi.update(dtMs) receives RAW WALL dt (courseScene.js:9651):
  // game speed compresses the CLOCK only, customers always move at wall rate.
  // This harness measures what that does to the shop: the SAME 60-game-minute
  // mid-day window, on the SAME restored resized room, with the SAME scripted
  // spawn, at 16x / 4x / 1x (BALANCE.speeds idx 3/2/1) — each leg from a fresh
  // boot so no leg contaminates the next. Reported per leg: arrivals,
  // departures, per-customer stop progress, the game's own nav-block count,
  // wall-unit freeze records, queue peak, and who is still mid-visit at window
  // end. Transactions stay zero by design (the player is the cashier and no
  // player is present) — visit flow is the throughput here.
  //
  // This is a MEASUREMENT, not an acceptance: ok gates only "every leg ran and
  // tracked customers with no page errors", never the shape of the curve.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);
  const VARIANT = String(process.env.GREYBOX_DAY_VARIANT || 'pine-hills-v2');
  const SPEEDS = String(process.env.GREYBOX_SPEED_LIST || '16,4,1')
    .split(',').map((value) => Number(value.trim())).filter((value) => [1, 4, 16].includes(value));
  const WINDOW_GAME_MINUTES = Number(process.env.GREYBOX_WINDOW_MINUTES || 60);
  const FREEZE_WINDOW_WALL_S = 12;
  const FREEZE_EPSILON_YD = 0.15;
  const QUEUE_BOUND_WALL_MIN = 12;
  const SPEED_IDX = { 1: 1, 4: 2, 16: 3 }; // BALANCE.speeds = [0, 1, 4, 16]

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  const boot = async () => {
    const query = VARIANT === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2' : '';
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.evaluate(async (seed) => {
      localStorage.clear();
      const E = await import('/src/sim/empire.js');
      const empire = E.newStarterEmpire('relaxed', seed);
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
    }, SEED);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /^Continue/ }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    // The operative condition: fully restored, clean room (the playable shop).
    await page.evaluate(async () => {
      const app = window.__fw;
      const R = await import('/src/sim/clubhouseRestoration.js');
      const snapshot = R.restorationSnapshot(app.state);
      for (const targetId of Object.keys(snapshot?.targetProgress || {})) {
        R.restorationAction(app.state, { type: 'set-target-progress', targetId, progress: 1 });
      }
      const components = snapshot?.architecture?.components || {};
      for (const componentId of Object.keys(components)) {
        R.restorationAction(app.state, { type: 'repair-component', component: componentId, progress: 1 });
      }
      const reno = app.state.shop?.reno;
      if (reno?.grime) reno.grime = reno.grime.map(() => 0);
      if (Array.isArray(reno?.windows)) reno.windows = reno.windows.map(() => 0);
      app.scene3d.clubhouse().pineHillsInterior?.refresh?.();
    });
    await page.waitForTimeout(800);
  };

  const runLeg = async (speed) => page.evaluate(async ([speedValue, speedIdx, windowMinutes, freezeWindowWallS, freezeEps, queueBoundWallMin]) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const state = app.state;
    const c = state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 10 * 60; // 10:00, mid-morning trade
    app.scene3d.applyTimeWeather(10 * 60, state.weather);
    app.speedIdx = speedIdx;

    const blocksBefore = clubhouse.navBlockDiagnostics().total;
    const spawned = clubhouse.debugSpawn
      ? Array.from({ length: 10 }, () => clubhouse.debugSpawn(false)).length : 0;
    const customersOf = () => {
      const list = typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers;
      return Array.isArray(list) ? list : [];
    };

    const windows = new Map();
    const frozen = new Map();
    const queueSeen = new Map();
    const queueViolations = [];
    const progress = new Map(); // id -> max stopIdx observed
    let maxSimultaneous = 0;
    let queuePeak = 0;
    let totalSeen = 0;
    const startMinute = state.clock.minutes;
    const started = performance.now();
    const wallCapMs = (windowMinutes / speedValue) * 60 * 1000 * 1.6 + 240000;

    await new Promise((resolve) => {
      const tick = () => {
        const nowMinute = state.clock.minutes;
        const wallSecond = performance.now() / 1000;
        const wallOverrun = performance.now() - started > wallCapMs;
        const list = customersOf();
        maxSimultaneous = Math.max(maxSimultaneous, list.length);
        const queue = (clubhouse.checkoutQueue?.() || []).map((entry) => entry.customerId);
        queuePeak = Math.max(queuePeak, queue.length);
        for (const customer of list) {
          const id = customer.customerId ?? customer.id ?? customer.name;
          const p = customer.mesh?.position;
          if (!p) continue;
          if (!windows.has(id)) totalSeen += 1;
          progress.set(id, Math.max(progress.get(id) ?? 0, customer.stopIdx ?? 0));
          const win = windows.get(id) || [];
          win.push({ t: wallSecond, x: p.x, z: p.z });
          while (win.length > 2 && win[win.length - 1].t - win[1].t >= freezeWindowWallS) win.shift();
          windows.set(id, win);
          const span = win[win.length - 1].t - win[0].t;
          if (span >= freezeWindowWallS) {
            const net = Math.hypot(win[win.length - 1].x - win[0].x, win[win.length - 1].z - win[0].z);
            if (net < freezeEps) {
              const stop = customer.stops?.[customer.stopIdx];
              const atStop = stop
                ? Math.hypot((stop.x ?? 0) - p.x, (stop.z ?? 0) - p.z) < 0.22 : false;
              const inQueue = queue.includes(id);
              const prior = frozen.get(id);
              if (!atStop && !inQueue && (!prior || span > prior.spanWallS)) {
                frozen.set(id, {
                  id,
                  simMinute: +(nowMinute % 1440).toFixed(1),
                  x: +p.x.toFixed(2),
                  z: +p.z.toFixed(2),
                  stopIdx: customer.stopIdx,
                  stopKind: stop?.kind ?? null,
                  fixtureId: stop?.fixtureId ?? null,
                  phase: customer.checkoutPhase ?? null,
                  netYd: +net.toFixed(3),
                  spanWallS: +span.toFixed(1),
                });
              }
            }
          }
          const qIndex = queue.indexOf(id);
          if (qIndex >= 0) {
            const seen = queueSeen.get(id) || { firstWallS: wallSecond, bestIndex: qIndex };
            seen.bestIndex = Math.min(seen.bestIndex, qIndex);
            if ((wallSecond - seen.firstWallS) / 60 > queueBoundWallMin
              && !queueViolations.some((violation) => violation.id === id)) {
              queueViolations.push({
                id, qIndex, heldWallMin: +((wallSecond - seen.firstWallS) / 60).toFixed(1),
              });
            }
            queueSeen.set(id, seen);
          } else {
            queueSeen.delete(id);
          }
        }
        for (const id of [...windows.keys()]) {
          if (!list.some((customer) => (customer.customerId ?? customer.id ?? customer.name) === id)) {
            windows.delete(id);
          }
        }
        if (nowMinute - startMinute >= windowMinutes || wallOverrun) resolve();
        else setTimeout(tick, 250);
      };
      tick();
    });
    app.speedIdx = 0;

    const diag = clubhouse.navBlockDiagnostics();
    const o = clubhouse.interior.position;
    const present = customersOf();
    const stopsAdvanced = [...progress.values()].reduce((sum, value) => sum + value, 0);
    return {
      speed: speedValue,
      wallSecondsRun: +((performance.now() - started) / 1000).toFixed(1),
      simMinutesRun: +(state.clock.minutes - startMinute).toFixed(1),
      spawned,
      customersTracked: totalSeen,
      organicArrivals: totalSeen - spawned,
      departures: totalSeen - present.length,
      stillMidVisitAtWindowEnd: present.map((customer) => ({
        id: customer.customerId ?? customer.name,
        stopIdx: customer.stopIdx,
        stopKind: customer.stops?.[customer.stopIdx]?.kind ?? null,
        phase: customer.checkoutPhase ?? null,
        lx: +(customer.mesh.position.x - o.x).toFixed(2),
        lz: +(customer.mesh.position.z - o.z).toFixed(2),
      })),
      stopsAdvancedTotal: stopsAdvanced,
      maxSimultaneous,
      queuePeak,
      queueViolations,
      frozen: [...frozen.values()].map((record) => ({
        ...record,
        lx: +(record.x - o.x).toFixed(2),
        lz: +(record.z - o.z).toFixed(2),
      })),
      navBlocks: diag.total - blocksBefore,
      transactions: state.shop?.transactionHistory?.length ?? null,
    };
  }, [speed, SPEED_IDX[speed], WINDOW_GAME_MINUTES, FREEZE_WINDOW_WALL_S, FREEZE_EPSILON_YD, QUEUE_BOUND_WALL_MIN]);

  const legs = {};
  for (const speed of SPEEDS) {
    await boot();
    legs[`x${speed}`] = await runLeg(speed);
    await page.screenshot({ path: path.join(outDir, `speed-curve-x${speed}-end.png`) });
  }

  const result = {
    protocol: {
      windowGameMinutes: WINDOW_GAME_MINUTES,
      startClock: '10:00',
      room: `${VARIANT} restored`,
      spawn: '10 scripted debugSpawn at window start + organic walk-ins (measured, not assumed)',
      freshBootPerLeg: true,
      watchdog: {
        freezeWindowWallSeconds: FREEZE_WINDOW_WALL_S,
        freezeEpsilonYd: FREEZE_EPSILON_YD,
        queueBoundWallMinutes: QUEUE_BOUND_WALL_MIN,
      },
    },
    limitations: {
      customersMoveInWallTime: true,
      note: 'clubhouseApi.update receives raw wall dt (courseScene.js:9651); the curve '
        + 'below IS that defect measured. No cashier is present, so transactions are '
        + 'structurally zero and visit flow (arrivals/departures/progress) is throughput.',
    },
    legs,
    errs: errs.slice(0, 16),
    ok: SPEEDS.every((speed) => legs[`x${speed}`]?.customersTracked > 0
      && Math.abs(legs[`x${speed}`].simMinutesRun - WINDOW_GAME_MINUTES) < WINDOW_GAME_MINUTES * 0.2)
      && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'speed-curve.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

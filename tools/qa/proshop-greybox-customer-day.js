async (page) => {
  // PINE HILLS V2 — customer navigation across a full simulated day, both
  // restoration states. Rebuilt to HARNESS_TRUST.md rule 3 after the first
  // version's watchdog (75 wall-s at 16x = 20 sim-minutes tolerance, 0.5-yd
  // position rounding, queue exemptions) proved too coarse for its claim.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-greybox-customer-day.js
  //
  // Primary source: the game's OWN nav-block log (clubhouse.navBlockDiagnostics)
  // — the same evidence the live build logs — plus an external freeze watchdog
  // with net-displacement windows (in WALL seconds, matching how the actors
  // actually move — see the measured constraint below) so oscillating
  // stuck-loops count as stuck. No state-class exemptions: a queue customer
  // must advance their queue index or leave within the patience bound. The
  // verdict includes stillInsideAtClose. Every block is reported with positions.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);
  const RUN_TAG = String(process.env.GREYBOX_DAY_TAG || 'run1');
  const VARIANT = String(process.env.GREYBOX_DAY_VARIANT || 'pine-hills-v2');
  // MEASURED CONSTRAINT this instrument must respect: the clubhouse update
  // receives RAW WALL dt (courseScene.js:9651) — the 16x speed compresses the
  // CLOCK, not customer locomotion. Customers walk, linger, and drain patience
  // in wall time, so freeze/queue thresholds are WALL units; sim units against
  // wall-time actors flag 1.6-second pauses as freezes. A walker that nets
  // under 0.15 yd across 12 consecutive wall-seconds is frozen (a moving
  // customer covers ~13 yd in that window; the recovery ladder resolves real
  // traps in ~15 wall-seconds, and its sidesteps clear this bar — so only a
  // trap the ladder itself cannot escape flags).
  const FREEZE_WINDOW_WALL_S = 12;
  const FREEZE_EPSILON_YD = 0.15;
  const QUEUE_BOUND_WALL_MIN = 8; // head patience is ~3 wall-min; 8 = never advancing
  const DAY_END_MINUTE = 19 * 60 + 30; // run past close so leavers can clear

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

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

  const runDay = async (label) => page.evaluate(async ([tag, freezeWindowWallS, freezeEps, queueBoundWallMin, dayEnd]) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const state = app.state;

    const c = state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 9 * 60;
    app.scene3d.applyTimeWeather(9 * 60, state.weather);
    app.speedIdx = 3; // 16x — a 9:00→19:30 day in ~20 wall-minutes

    const blocksBefore = clubhouse.navBlockDiagnostics().total;
    const spawned = clubhouse.debugSpawn
      ? Array.from({ length: 10 }, () => clubhouse.debugSpawn(false)).length : 0;

    const customersOf = () => {
      const list = typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers;
      return Array.isArray(list) ? list : [];
    };
    // Per-customer displacement window: samples of (simSecond, x, z). Frozen =
    // window spans >= freezeWindowS sim-seconds with net displacement < eps.
    const windows = new Map();
    const frozen = new Map(); // id -> worst freeze record
    const queueSeen = new Map(); // id -> { firstSimMin, bestIndex }
    const queueViolations = [];
    let maxSimultaneous = 0;
    let totalSeen = 0;
    const startMinute = state.clock.minutes;
    const started = performance.now();

    await new Promise((resolve) => {
      const tick = () => {
        const nowMinute = state.clock.minutes;
        const minuteOfDay = nowMinute % 1440;
        const wallSecond = performance.now() / 1000;
        const wallOverrun = performance.now() - started > 2100000;
        const list = customersOf();
        maxSimultaneous = Math.max(maxSimultaneous, list.length);
        const queue = (clubhouse.checkoutQueue?.() || []).map((entry) => entry.customerId);
        for (const customer of list) {
          const id = customer.customerId ?? customer.id ?? customer.name;
          const p = customer.mesh?.position;
          if (!p) continue;
          if (!windows.has(id)) totalSeen += 1;
          const win = windows.get(id) || [];
          win.push({ t: wallSecond, x: p.x, z: p.z });
          while (win.length > 2 && win[win.length - 1].t - win[1].t >= freezeWindowWallS) win.shift();
          windows.set(id, win);
          const span = win[win.length - 1].t - win[0].t;
          if (span >= freezeWindowWallS) {
            const net = Math.hypot(win[win.length - 1].x - win[0].x, win[win.length - 1].z - win[0].z);
            if (net < freezeEps) {
              const prior = frozen.get(id);
              const record = {
                id,
                simMinute: +(minuteOfDay).toFixed(1),
                x: +p.x.toFixed(2),
                z: +p.z.toFixed(2),
                stopIdx: customer.stopIdx,
                stopKind: customer.stops?.[customer.stopIdx]?.kind ?? null,
                fixtureId: customer.stops?.[customer.stopIdx]?.fixtureId ?? null,
                phase: customer.checkoutPhase ?? null,
                netYd: +net.toFixed(3),
                spanWallS: +span.toFixed(1),
                inQueue: queue.includes(id),
                // Standing still AT a stop is browsing, not a freeze: only count
                // when the walker has not arrived (its own loop would be in the
                // movement branch).
                // 0.22: just above the walker's 0.18 arrival radius. The pins this
                // instrument exists to catch hold at 0.25-0.5 yd from their stop —
                // a wider band would exempt exactly the failure being hunted.
                atStop: (() => {
                  const stop = customer.stops?.[customer.stopIdx];
                  if (!stop) return false;
                  return Math.hypot((stop.x ?? 0) - p.x, (stop.z ?? 0) - p.z) < 0.22;
                })(),
              };
              if (!record.atStop && !record.inQueue && (!prior || span > prior.spanWallS)) {
                frozen.set(id, record);
              }
            }
          }
          // Queue advancement bound.
          const qIndex = queue.indexOf(id);
          if (qIndex >= 0) {
            const seen = queueSeen.get(id) || { firstWallS: wallSecond, bestIndex: qIndex };
            seen.bestIndex = Math.min(seen.bestIndex, qIndex);
            if ((wallSecond - seen.firstWallS) / 60 > queueBoundWallMin
              && !queueViolations.some((v) => v.id === id)) {
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
        if (minuteOfDay >= dayEnd || wallOverrun) resolve();
        else setTimeout(tick, 250);
      };
      tick();
    });
    app.speedIdx = 0;

    const diag = clubhouse.navBlockDiagnostics();
    const o = clubhouse.interior.position;
    return {
      tag,
      spawned,
      maxSimultaneous,
      customersTracked: totalSeen,
      stillInsideAtClose: customersOf().map((customer) => ({
        id: customer.customerId ?? customer.name,
        stopKind: customer.stops?.[customer.stopIdx]?.kind ?? null,
        phase: customer.checkoutPhase ?? null,
        lx: +(customer.mesh.position.x - o.x).toFixed(2),
        lz: +(customer.mesh.position.z - o.z).toFixed(2),
      })),
      frozen: [...frozen.values()].map((record) => ({
        ...record,
        lx: +(record.x - o.x).toFixed(2),
        lz: +(record.z - o.z).toFixed(2),
      })),
      queueViolations,
      navBlocks: {
        total: diag.total - blocksBefore,
        events: diag.recent
          .slice(-80)
          .map((entry) => ({
            ...entry,
            lx: +(entry.x - o.x).toFixed(2),
            lz: +(entry.z - o.z).toFixed(2),
            ltx: +(entry.tx - o.x).toFixed(2),
            ltz: +(entry.tz - o.z).toFixed(2),
          })),
      },
      simMinutesRun: +(state.clock.minutes - startMinute).toFixed(1),
      transactions: state.shop?.transactionHistory?.length ?? null,
      unitsSold: state.shop?.salesLive?.units ?? null,
    };
  }, [label, FREEZE_WINDOW_WALL_S, FREEZE_EPSILON_YD, QUEUE_BOUND_WALL_MIN, DAY_END_MINUTE]);

  const neglected = await runDay('neglected');
  await page.screenshot({ path: path.join(outDir, `day-${RUN_TAG}-neglected-close.png`) });

  // Restore everything, then a second full day.
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

  const restored = await runDay('restored');
  await page.screenshot({ path: path.join(outDir, `day-${RUN_TAG}-restored-close.png`) });

  const result = {
    tag: RUN_TAG,
    variant: VARIANT,
    watchdog: {
      freezeWindowWallSeconds: FREEZE_WINDOW_WALL_S,
      freezeEpsilonYd: FREEZE_EPSILON_YD,
      queueBoundWallMinutes: QUEUE_BOUND_WALL_MIN,
    },
    limitations: {
      customersMoveInWallTime: true,
      note: 'clubhouseApi.update receives raw wall dt (courseScene.js:9651): 16x '
        + 'compresses the clock only, so one 16x "day" carries ~40 wall-minutes of '
        + 'true-rate customer motion. A full-parity day requires 1x (10.5 h).',
    },
    neglected,
    restored,
    errs: errs.slice(0, 16),
    ok: neglected.frozen.length === 0 && restored.frozen.length === 0
      && neglected.queueViolations.length === 0 && restored.queueViolations.length === 0
      && neglected.stillInsideAtClose.length === 0 && restored.stillInsideAtClose.length === 0
      && neglected.customersTracked > 0 && restored.customersTracked > 0,
  };
  fs.writeFileSync(path.join(outDir, `greybox-customer-day-${RUN_TAG}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

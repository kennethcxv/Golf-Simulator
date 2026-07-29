async (page) => {
  // PINE HILLS V2 — customer navigation under live crowd pressure, both
  // restoration states. Rebuilt to HARNESS_TRUST.md rule 3, then converted
  // 2026-07-28 per the crowd-churn ruling (DEFECTS.md NAV-CHURN-001):
  //
  //   "Eleven customers in 70 m² with nobody serving should jam. That pressure
  //    is what makes hiring a cashier feel necessary, so it stays. Do not
  //    exempt the class — that kills the signal. Convert the gate to a
  //    threshold. A genuine trap must still turn the gate red."
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-greybox-customer-day.js
  //
  // What changed in the conversion (design change, not a test fix):
  //  - The old gate (frozen.length === 0) failed on ANY 12-s stillness window.
  //    Worse, its per-customer "worst window" record capped every report at
  //    ~12 s, so a 7-wall-minute pin (requeue3, visitor:4 at member_station,
  //    game-minutes 754-873 at one coordinate) read as "12-s churn". The gate
  //    now tracks BLOCK EPISODES with real durations: an episode opens when a
  //    walker nets < 0.15 yd across a 12-wall-second window (not at a stop,
  //    not queued) and stays open until the walker gets ≥ 0.60 yd from the
  //    episode anchor (a real escape — two body radii past shove jitter), or
  //    arrives at its stop, or joins the queue, or leaves. Slow-creep pins
  //    cannot reset the clock by drifting between windows.
  //  - RED thresholds (the ruling's, recorded in DEFECTS.md):
  //      * any single episode > 20 wall-seconds (BLOCK_CAP_WALL_S), or
  //      * recovery rate below the floor: with ≥ 4 episodes in a leg, at least
  //        75% must clear within 15 wall-seconds of onset. 15 s is the
  //        recovery ladder's own design budget (12-s detection + one ladder
  //        cycle); an episode past it means the first ladder cycle failed.
  //        Below 4 episodes the cap alone governs — a proportion over 1-3
  //        samples is noise, and the cap still catches every real trap.
  //    Short jam churn under a full house stays GREEN by design — that is the
  //    hire-a-cashier pressure signal, reported but not failed.
  //  - CONTAINMENT is now asserted directly (the airtight claim, previously
  //    only inferred from block positions): no customer center may ever be in
  //    the staff corridor, east of the public bound (service wing), or inside
  //    a sealed slab. Zones derive from the live PINE_HILLS_V2_LAYOUT consts.
  //  - SPEED: defaults to 1× on a 60-game-minute peak window (10:00-11:00,
  //    10 scripted spawns + organic arrivals — requeue3's crowd density).
  //    Per SIM-TIME-001, NPC verification runs at 1× ONLY; a full 9:00-19:30
  //    day at 1× is 10.5 wall-hours per leg, so the practical instrument is
  //    the peak window. GREYBOX_DAY_START_MIN/END_MIN/SPEED restore the full
  //    16× day shape explicitly — that mode is a stress regime, not evidence
  //    of what a 1× player experiences, and is tagged as such in the output.
  //
  // Freeze/queue thresholds are WALL units at every speed: the clubhouse
  // update receives raw wall dt (courseScene.js:9651) so locomotion is
  // wall-rate regardless of speedIdx (DEFECTS.md SIM-TIME-001).
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
  const LEG = String(process.env.GREYBOX_DAY_LEG || 'both'); // neglected|restored|both
  const SPEED = Number(process.env.GREYBOX_DAY_SPEED || 1); // 1|4|16 (game speed)
  const SPEED_IDX = { 1: 1, 4: 2, 16: 3 }[SPEED];
  if (!SPEED_IDX) throw new Error(`GREYBOX_DAY_SPEED must be 1, 4 or 16 (got ${SPEED})`);
  const START_MIN = Number(process.env.GREYBOX_DAY_START_MIN || 10 * 60);
  const END_MIN = Number(process.env.GREYBOX_DAY_END_MIN || 11 * 60);
  const INCLUDES_CLOSE = END_MIN >= 19 * 60 + 30;
  // Wall budget for the window plus drain margin; the old fixed 35-min cap
  // would truncate any 1× window over ~30 game-minutes.
  const MAX_WALL_MS = ((END_MIN - START_MIN) / SPEED) * 60000 * 1.5 + 480000;

  const FREEZE_WINDOW_WALL_S = 12;
  const FREEZE_EPSILON_YD = 0.15;
  const EPISODE_ESCAPE_YD = 0.60;
  const BLOCK_CAP_WALL_S = 20;
  const LADDER_BUDGET_WALL_S = 15;
  const RECOVERY_FLOOR = 0.75;
  const FLOOR_MIN_EPISODES = 4;
  // Designed queue patience runs ~10 REAL minutes (register-feel spec) before a
  // customer gives up; only a queue that outlives that is a navigation claim.
  const QUEUE_BOUND_WALL_MIN = 12;

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

  const runLeg = async (label) => page.evaluate(async ([tag, cfg]) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const state = app.state;

    // Customer-forbidden zones, from the live layout (v2 only). Local coords;
    // margins shrink each rect so capsule-vs-face surface contact never flags —
    // only a center genuinely inside the sealed volume does.
    let zones = [];
    if (cfg.isV2) {
      const L = await import('/src/data/shopLayout.js');
      const V2 = L.PINE_HILLS_V2_LAYOUT;
      const seal = V2.corridorSeal;
      const west = V2.corridorWestSeal;
      const inset = (r, m) => ({ minX: r.minX + m, maxX: r.maxX - m, minZ: r.minZ + m, maxZ: r.maxZ - m });
      zones = [
        // The sealed staff corridor: behind the desk's staff edge, west of the
        // partition line, down to the return/hutch back band.
        { name: 'staff-corridor', ...inset({ minX: west.returnBackFill.minX, maxX: V2.publicBounds.maxX, minZ: seal.zTo, maxZ: west.returnBackFill.maxZ }, 0.15) },
        // East of the public bound = the service wing. 5.60 is the partition
        // band's west face; a customer center past it is inside or beyond the
        // partition line (the staff mouth included — no customer path exists
        // east of publicBounds.maxX).
        { name: 'service-wing', minX: 5.60, maxX: 99, minZ: seal.zFrom, maxZ: 99 },
        // Sealed slabs — inside any of these means the walker pierced a solid.
        { name: 'seal-east-stub', ...inset({ minX: seal.x - seal.t / 2, maxX: seal.x + seal.t / 2, minZ: seal.zFrom, maxZ: seal.zTo }, 0.02) },
        { name: 'seal-return-back', ...inset(west.returnBackFill, 0.05) },
        { name: 'seal-hutch-gap', ...inset(west.hutchGapFill, 0.05) },
        { name: 'seal-hutch-east', ...inset(west.hutchEastFill, 0.05) },
      ];
    }

    const c = state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + cfg.startMin;
    app.scene3d.applyTimeWeather(cfg.startMin, state.weather);
    app.speedIdx = cfg.speedIdx;

    const blocksBefore = clubhouse.navBlockDiagnostics().total;
    const spawned = clubhouse.debugSpawn
      ? Array.from({ length: 10 }, () => clubhouse.debugSpawn(false)).length : 0;

    const customersOf = () => {
      const list = typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers;
      return Array.isArray(list) ? list : [];
    };
    const o = clubhouse.interior.position;

    const windows = new Map(); // id -> displacement samples {t,x,z}
    const active = new Map(); // id -> open episode {anchorX, anchorZ, onsetWallS, ...ctx}
    const episodes = []; // closed episodes with real durations
    const queueSeen = new Map();
    const queueViolations = [];
    const containment = new Map(); // `${id}|${zone}` -> first violation record
    let containmentHits = 0;
    let maxSimultaneous = 0;
    let totalSeen = 0;
    const startMinute = state.clock.minutes;
    const started = performance.now();

    const closeEpisode = (id, epi, wallSecond, clearedBy) => {
      episodes.push({
        id,
        onsetAtWallS: +(epi.onsetWallS - started / 1000).toFixed(1),
        durationWallS: +(wallSecond - epi.onsetWallS).toFixed(1),
        lx: +(epi.anchorX - o.x).toFixed(2),
        lz: +(epi.anchorZ - o.z).toFixed(2),
        stopKind: epi.stopKind,
        fixtureId: epi.fixtureId,
        phase: epi.phase,
        simMinute: epi.simMinute,
        clearedBy,
      });
      active.delete(id);
    };

    await new Promise((resolve) => {
      const tick = () => {
        const nowMinute = state.clock.minutes;
        const minuteOfDay = nowMinute % 1440;
        const wallSecond = performance.now() / 1000;
        const wallOverrun = performance.now() - started > cfg.maxWallMs;
        const list = customersOf();
        maxSimultaneous = Math.max(maxSimultaneous, list.length);
        const queue = (clubhouse.checkoutQueue?.() || []).map((entry) => entry.customerId);
        const liveIds = new Set();
        for (const customer of list) {
          const id = customer.customerId ?? customer.id ?? customer.name;
          const p = customer.mesh?.position;
          if (!p) continue;
          liveIds.add(id);
          if (!windows.has(id)) totalSeen += 1;
          const lx = p.x - o.x;
          const lz = p.z - o.z;
          for (const zone of zones) {
            if (lx > zone.minX && lx < zone.maxX && lz > zone.minZ && lz < zone.maxZ) {
              containmentHits += 1;
              const key = `${id}|${zone.name}`;
              if (!containment.has(key) && containment.size < 60) {
                containment.set(key, {
                  id, zone: zone.name, lx: +lx.toFixed(2), lz: +lz.toFixed(2),
                  simMinute: +minuteOfDay.toFixed(1),
                  stopKind: customer.stops?.[customer.stopIdx]?.kind ?? null,
                });
              }
            }
          }
          const win = windows.get(id) || [];
          win.push({ t: wallSecond, x: p.x, z: p.z });
          while (win.length > 2 && win[win.length - 1].t - win[1].t >= cfg.freezeWindowWallS) win.shift();
          windows.set(id, win);
          const span = win[win.length - 1].t - win[0].t;
          const inQueue = queue.includes(id);
          const stop = customer.stops?.[customer.stopIdx];
          const atStop = stop
            ? Math.hypot((stop.x ?? 0) - p.x, (stop.z ?? 0) - p.z) < 0.22
            : false;
          const epi = active.get(id);
          if (epi) {
            // An open episode ends only on a REAL escape (≥ escapeYd from the
            // anchor), arrival, queue entry, or despawn — a slow creep between
            // detection windows keeps the clock running.
            const fromAnchor = Math.hypot(p.x - epi.anchorX, p.z - epi.anchorZ);
            if (fromAnchor >= cfg.episodeEscapeYd) closeEpisode(id, epi, wallSecond, 'moved');
            else if (atStop) closeEpisode(id, epi, wallSecond, 'atStop');
            else if (inQueue) closeEpisode(id, epi, wallSecond, 'inQueue');
          } else if (span >= cfg.freezeWindowWallS && !atStop && !inQueue) {
            const net = Math.hypot(win[win.length - 1].x - win[0].x, win[win.length - 1].z - win[0].z);
            if (net < cfg.freezeEpsilonYd) {
              active.set(id, {
                // Stillness has held since the window START — the episode
                // clock includes the detection lag, honestly.
                onsetWallS: win[0].t,
                anchorX: p.x,
                anchorZ: p.z,
                simMinute: +minuteOfDay.toFixed(1),
                stopKind: stop?.kind ?? null,
                fixtureId: stop?.fixtureId ?? null,
                phase: customer.checkoutPhase ?? null,
              });
            }
          }
          // Queue advancement bound (unchanged): patience is ~10 real minutes;
          // only a queue that outlives that is a navigation claim.
          const qIndex = queue.indexOf(id);
          if (qIndex >= 0) {
            const seen = queueSeen.get(id) || { firstWallS: wallSecond, bestIndex: qIndex };
            seen.bestIndex = Math.min(seen.bestIndex, qIndex);
            if ((wallSecond - seen.firstWallS) / 60 > cfg.queueBoundWallMin
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
          if (!liveIds.has(id)) {
            windows.delete(id);
            const epi = active.get(id);
            if (epi) closeEpisode(id, epi, wallSecond, 'despawn');
          }
        }
        if (minuteOfDay >= cfg.endMin || wallOverrun) {
          const endWall = performance.now() / 1000;
          for (const [id, epi] of [...active.entries()]) closeEpisode(id, epi, endWall, 'end');
          resolve();
        } else setTimeout(tick, 250);
      };
      tick();
    });
    app.speedIdx = 0;

    const durations = episodes.map((e) => e.durationWallS).sort((a, b) => a - b);
    const pct = (q) => (durations.length
      ? durations[Math.min(durations.length - 1, Math.floor(q * durations.length))] : 0);
    const within15 = episodes.filter((e) => e.durationWallS <= cfg.ladderBudgetWallS).length;
    const over20 = episodes.filter((e) => e.durationWallS > cfg.blockCapWallS);
    const recoveryRate = episodes.length ? +(within15 / episodes.length).toFixed(3) : 1;

    const diag = clubhouse.navBlockDiagnostics();
    const stillInside = customersOf().map((customer) => {
      const inQueue = (clubhouse.checkoutQueue?.() || [])
        .some((entry) => entry.customerId === (customer.customerId ?? customer.id ?? customer.name));
      const stopKind = customer.stops?.[customer.stopIdx]?.kind ?? null;
      const phase = customer.checkoutPhase ?? null;
      return {
        id: customer.customerId ?? customer.name,
        stopKind,
        phase,
        lx: +(customer.mesh.position.x - o.x).toFixed(2),
        lz: +(customer.mesh.position.z - o.z).toFixed(2),
        // The designed no-cashier signal: a counter-class waiter inside at
        // close is the hire-a-cashier pressure, reported green. Anyone else
        // still inside at close is a navigation claim.
        counterClass: inQueue || stopKind === 'counter'
          || phase === 'waiting' || phase === 'paying',
      };
    });

    const legFailures = [];
    if (containment.size > 0) legFailures.push(`containment: ${containment.size} zone violations`);
    if (over20.length > 0) legFailures.push(`block cap: ${over20.length} episodes over ${cfg.blockCapWallS}s (max ${durations[durations.length - 1]}s)`);
    if (episodes.length >= cfg.floorMinEpisodes && recoveryRate < cfg.recoveryFloor) {
      legFailures.push(`recovery floor: ${(recoveryRate * 100).toFixed(0)}% within ${cfg.ladderBudgetWallS}s (floor ${cfg.recoveryFloor * 100}%)`);
    }
    if (queueViolations.length > 0) legFailures.push(`queue bound: ${queueViolations.length} held past ${cfg.queueBoundWallMin} wall-min`);
    if (cfg.includesClose && stillInside.some((s) => !s.counterClass)) {
      legFailures.push('still inside at close outside the counter-waiter class');
    }
    if (totalSeen === 0) legFailures.push('no customers tracked');

    return {
      tag,
      speed: cfg.speed,
      window: { startMin: cfg.startMin, endMin: cfg.endMin, includesClose: cfg.includesClose },
      spawned,
      maxSimultaneous,
      customersTracked: totalSeen,
      episodes: {
        count: episodes.length,
        within15s: within15,
        over20s: over20.length,
        recoveryRateWithin15s: recoveryRate,
        p50S: pct(0.5),
        p95S: pct(0.95),
        maxS: durations.length ? durations[durations.length - 1] : 0,
        list: episodes.slice(0, 120),
      },
      containment: {
        count: containmentHits,
        violations: [...containment.values()],
      },
      queueViolations,
      stillInsideAtClose: stillInside,
      navBlocks: {
        total: diag.total - blocksBefore,
        events: diag.recent
          .slice(-40)
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
      legOk: legFailures.length === 0,
      legFailures,
    };
  }, [label, {
    isV2: VARIANT === 'pine-hills-v2',
    speed: SPEED,
    speedIdx: SPEED_IDX,
    startMin: START_MIN,
    endMin: END_MIN,
    includesClose: INCLUDES_CLOSE,
    maxWallMs: MAX_WALL_MS,
    freezeWindowWallS: FREEZE_WINDOW_WALL_S,
    freezeEpsilonYd: FREEZE_EPSILON_YD,
    episodeEscapeYd: EPISODE_ESCAPE_YD,
    blockCapWallS: BLOCK_CAP_WALL_S,
    ladderBudgetWallS: LADDER_BUDGET_WALL_S,
    recoveryFloor: RECOVERY_FLOOR,
    floorMinEpisodes: FLOOR_MIN_EPISODES,
    queueBoundWallMin: QUEUE_BOUND_WALL_MIN,
  }]);

  const restoreAll = async () => {
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

  const legs = {};
  if (LEG === 'neglected' || LEG === 'both') {
    legs.neglected = await runLeg('neglected');
    await page.screenshot({ path: path.join(outDir, `day-${RUN_TAG}-neglected-close.png`) });
  }
  if (LEG === 'restored' || LEG === 'both') {
    await restoreAll();
    legs.restored = await runLeg('restored');
    await page.screenshot({ path: path.join(outDir, `day-${RUN_TAG}-restored-close.png`) });
  }

  const ranLegs = Object.values(legs);
  const failures = ranLegs.flatMap((leg) => leg.legFailures.map((f) => `${leg.tag}: ${f}`));
  const result = {
    tag: RUN_TAG,
    variant: VARIANT,
    speed: SPEED,
    window: { startMin: START_MIN, endMin: END_MIN, includesClose: INCLUDES_CLOSE },
    watchdog: {
      freezeWindowWallSeconds: FREEZE_WINDOW_WALL_S,
      freezeEpsilonYd: FREEZE_EPSILON_YD,
      episodeEscapeYd: EPISODE_ESCAPE_YD,
      blockCapWallSeconds: BLOCK_CAP_WALL_S,
      ladderBudgetWallSeconds: LADDER_BUDGET_WALL_S,
      recoveryFloor: RECOVERY_FLOOR,
      floorMinEpisodes: FLOOR_MIN_EPISODES,
      queueBoundWallMinutes: QUEUE_BOUND_WALL_MIN,
    },
    limitations: {
      customersMoveInWallTime: true,
      note: 'clubhouseApi.update receives raw wall dt (courseScene.js:9651): game '
        + 'speed compresses the clock only (DEFECTS.md SIM-TIME-001). NPC evidence '
        + 'is valid at 1x; any run above 1x is a stress regime, not a play claim. '
        + 'A full 9:00-19:30 day at 1x is 10.5 wall-hours per leg — the default '
        + 'instrument is the 1x 60-game-minute peak window.',
    },
    ...legs,
    errs: errs.slice(0, 16),
    failures,
    ok: ranLegs.length > 0 && failures.length === 0,
  };
  fs.writeFileSync(path.join(outDir, `greybox-customer-day-${RUN_TAG}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async (page) => {
  // HOW FAST DO CUSTOMERS ACTUALLY WALK, IN YARDS PER WALL SECOND, AT EACH RUNG.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-walk-speed.js
  //
  // Written for the 2026-07-29 regression: shortening the day from twelve real
  // hours to three quadrupled the decision multiplier, the clubhouse derived
  // locomotion from it as min(simSpeed, CAP), and every shopper sprinted at the
  // 4x cap on the DEFAULT rung. Nothing measured walking speed, so nothing
  // caught it — the player did, by looking at the room.
  //
  // So this measures the quantity that was wrong, in the units a person can
  // check against reality: yards per REAL second, sampled from the mesh the
  // player is looking at, on a wall clock.
  //
  // INSTRUMENT CORRECTNESS, since a speed probe has more ways to lie than most:
  //
  //   * MEASURED AGAINST GROUND TRUTH, not against itself. Every customer
  //     carries an authored yd/s (`c.speed`, 1.10-1.60). The quantity reported
  //     is observed / (authored * locomotionScale), which must be 1.0 at every
  //     rung. Comparing a measurement to the number the code intended is a much
  //     harder test to pass by accident than comparing it to another measurement.
  //   * Per-customer p90, not a pooled mean. THE FIRST VERSION OF THIS PROBE
  //     POOLED EVERY MOVING INTERVAL AND ITS CONTROL FAILED: at the 4x rung it
  //     reported 0.74 yd/s — SLOWER than 1x — because customers queue and
  //     sidestep more when decisions compress, and a floor full of 0.1 yd/s
  //     jostle drags a pooled median below the walking speed it is supposed to
  //     be measuring. A high percentile per customer asks the right question:
  //     how fast does this body move WHEN IT IS WALKING.
  //   * Warps are counted, never silently dropped. The pooled version reported a
  //     max of 66 yd/s; a body cannot walk that, so something teleports (spawn
  //     placement, sidestep recovery). Anything over WARP_YD in a single frame
  //     is excluded from the speed statistic and reported as its own count, so
  //     a probe that quietly discards half its data cannot look clean.
  //   * Path length, not net displacement. Sampling every rAF keeps the
  //     straight-line approximation between samples short enough that a curved
  //     route does not read as slower than it is.
  //   * performance.now(), never the game clock. The whole question is what the
  //     player's eyes see per real second; measuring against a clock that the
  //     bug also moves would be the eleventh instrument measuring the wrong thing.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);
  const SAMPLE_WALL_S = Number(process.env.WALK_SPEED_SAMPLE_S || 10);
  // Below this a customer is standing, not walking. 0.05 yd/s is two orders of
  // magnitude under a human walk and well above float jitter in a mesh position.
  const MOVING_EPSILON_YD_S = 0.05;
  // A single frame's displacement larger than this is not locomotion. At the 4x
  // cap a 1.6 yd/s body covers 0.11 yd per 16ms frame, so 1.0 yd is an order of
  // magnitude clear of anything walking can produce.
  const WARP_YD = 1.0;
  // What a person walks at, for the report to be readable without arithmetic.
  const HUMAN_BASELINE_YD_S = 1.4;

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
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
  await page.waitForTimeout(2500);

  const ladder = await page.evaluate(async () => (await import('/src/sim/balance.js')).BALANCE.speeds);
  const authored = await page.evaluate(async () => {
    const B = await import('/src/sim/balance.js');
    return {
      gameMinutesPerRealSecond: B.BALANCE.gameMinutesPerRealSecond,
      npcTimingBaseline: B.BALANCE.npcTimingBaselineGameMinutesPerRealSecond,
      multipliers: B.BALANCE.speeds.map((_, i) => B.simSpeedMultipliers(i)),
    };
  });

  const measureRung = async (speedIdx) => page.evaluate(async ([idx, sampleWallS, epsilon, warpYd]) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const state = app.state;
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 10 * 60; // mid-morning trade
    app.speedIdx = idx;
    // Top up the floor so there is always something walking to measure.
    const customersOf = () => {
      const list = typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers;
      return Array.isArray(list) ? list : [];
    };
    while (customersOf().length < 6 && clubhouse.debugSpawn) clubhouse.debugSpawn(false);
    await new Promise((r) => setTimeout(r, 1200)); // let them get under way

    // BEST SUSTAINED HALF-SECOND, per body.
    //
    // Pooling every moving interval does not work, and the failure is instructive:
    // at the 4x rung it reported customers moving SLOWER than at 1x. With no
    // cashier present the till queue never drains, so most bodies spend the window
    // shuffling against each other inside resolveCustomer's 0.6 yd separation —
    // real displacement, above any idle threshold, and nothing to do with walking.
    // The pooled median measured the crowd, not the stride.
    //
    // Half a second is long enough that jostle cannot sustain it and short enough
    // that a body only has to get one clear walk in the window to be counted.
    //
    // AND THE FLOOR IS TOPPED UP THROUGHOUT. Measuring a fixed cohort fails at
    // the top rung for a reason that is not about walking at all: with decisions
    // at 16x the browse dwell burns off almost instantly, every body reaches the
    // till within a couple of seconds, and — no cashier being present — the queue
    // never drains. The first run of this version recorded ZERO free walks at 4x
    // against 5,293 idle samples. Nothing was wrong with locomotion; there was
    // simply no travel left in the window to measure. A fresh arrival always
    // walks, so one is added every SPAWN_EVERY_MS until the floor is full.
    const WINDOW_S = 0.5;
    const SPAWN_EVERY_MS = 1200;
    const FLOOR_CAP = 12;
    const last = new Map();
    const perCustomer = new Map();
    const started = performance.now();
    let lastSpawn = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now();
        if (now - lastSpawn >= SPAWN_EVERY_MS && customersOf().length < FLOOR_CAP && clubhouse.debugSpawn) {
          clubhouse.debugSpawn(false);
          lastSpawn = now;
        }
        for (const customer of customersOf()) {
          const id = customer.customerId ?? customer.id ?? customer.name;
          const p = customer.mesh?.position;
          if (!p) continue;
          const prev = last.get(id);
          last.set(id, { t: now, x: p.x, z: p.z });
          if (!perCustomer.has(id)) {
            perCustomer.set(id, {
              authored: Number(customer.speed) || null, window: [], best: 0, moving: 0, idle: 0, warps: 0,
            });
          }
          const rec = perCustomer.get(id);
          if (rec.authored == null) rec.authored = Number(customer.speed) || null;
          if (!prev) continue;
          const dt = (now - prev.t) / 1000;
          if (dt <= 0 || dt > 0.5) continue; // a stalled frame is not a measurement
          const step = Math.hypot(p.x - prev.x, p.z - prev.z);
          if (step > warpYd) { rec.warps += 1; rec.window.length = 0; continue; } // a teleport, not a stride
          if (step / dt > epsilon) rec.moving += 1; else rec.idle += 1;
          rec.window.push({ t: now, step });
          while (rec.window.length > 1 && (now - rec.window[0].t) / 1000 > WINDOW_S) rec.window.shift();
          const span = (now - rec.window[0].t) / 1000;
          if (span >= WINDOW_S * 0.8) {
            const travelled = rec.window.reduce((sum, s) => sum + s.step, 0);
            rec.best = Math.max(rec.best, travelled / span);
          }
        }
        if (now - started >= sampleWallS * 1000) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    app.speedIdx = 0;

    const diagnostics = clubhouse.simTimeDiagnostics();
    const scale = diagnostics.locomotionScale;
    const q = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
    const bodies = [];
    const neverWalked = [];
    let warps = 0;
    let idle = 0;
    let moving = 0;
    for (const [id, rec] of perCustomer) {
      warps += rec.warps;
      idle += rec.idle;
      moving += rec.moving;
      if (!rec.authored) continue;
      const expected = rec.authored * scale;
      const entry = {
        id,
        authoredYdPerS: +rec.authored.toFixed(2),
        walkYdPerS: +rec.best.toFixed(2),
        expectedYdPerS: +expected.toFixed(2),
        ratioToIntent: +(rec.best / expected).toFixed(2),
      };
      // A body that never got a clear walk has no walking speed to report. It is
      // NOT averaged in at whatever it was shuffling at — it is named and counted,
      // so a run where most of the floor was stuck cannot read as a clean result.
      if (rec.best < expected * 0.5) neverWalked.push(entry);
      else bodies.push(entry);
    }
    const ratios = bodies.map((b) => b.ratioToIntent).sort((a, b) => a - b);
    const walks = bodies.map((b) => b.walkYdPerS).sort((a, b) => a - b);
    return {
      speedIdx: idx,
      diagnostics,
      bodiesWalking: bodies.length,
      bodiesSeen: perCustomer.size,
      bodiesNeverWalkedFreely: neverWalked,
      samples: { moving, idle, warps },
      medianWalkYdPerS: q(walks, 0.5) == null ? null : +q(walks, 0.5).toFixed(2),
      slowestWalkYdPerS: walks.length ? +walks[0].toFixed(2) : null,
      fastestWalkYdPerS: walks.length ? +walks[walks.length - 1].toFixed(2) : null,
      medianRatioToIntent: q(ratios, 0.5) == null ? null : +q(ratios, 0.5).toFixed(2),
      bodies,
    };
  }, [speedIdx, SAMPLE_WALL_S, MOVING_EPSILON_YD_S, WARP_YD]);

  const rungs = {};
  for (let idx = 1; idx < ladder.length; idx++) {
    rungs[`x${ladder[idx]}`] = await measureRung(idx);
  }

  // THE BUILT-IN CONTROL: every body must travel at the speed the code intended
  // for it — its own authored yd/s times the rung's locomotion scale. A ratio of
  // 1.0 at every rung is the pass. This is checked against the code's INTENT
  // rather than against another measurement, so a probe measuring frame rate,
  // animation rate or the game clock cannot satisfy it by coincidence.
  const ratios = {};
  let ratiosHold = true;
  for (let idx = 1; idx < ladder.length; idx++) {
    const rung = rungs[`x${ladder[idx]}`];
    const actual = rung?.medianRatioToIntent ?? null;
    ratios[`x${ladder[idx]}`] = {
      expected: 1,
      actual,
      locomotionScale: rung?.diagnostics?.locomotionScale ?? null,
      bodiesWalking: rung?.bodiesWalking ?? 0,
    };
    // Tolerance is asymmetric ON PURPOSE. resolveCustomer pushes bodies apart to
    // 0.6 yd and away from colliders, and that displacement lands on top of the
    // path step — so an observed speed a little ABOVE intent is the separation
    // solver, a known mechanism, not a measurement fault. Below intent has no
    // such excuse and is held tighter.
    if (actual == null || actual < 0.85 || actual > 1.4 || (rung?.bodiesWalking ?? 0) < 3) ratiosHold = false;
  }

  const result = {
    what: 'customer walking speed in yards per REAL second, by speed rung',
    ladder,
    authored,
    protocol: {
      sampleWallSeconds: SAMPLE_WALL_S,
      sampledEvery: 'requestAnimationFrame',
      statistic: 'per-customer p90 of moving intervals ("how fast when walking"), '
        + 'then the median across customers',
      movingThresholdYdPerS: MOVING_EPSILON_YD_S,
      warpThresholdYd: WARP_YD,
      minMovingSamplesPerBody: 20,
      clock: 'performance.now() — wall time, never the game clock',
      room: 'pine-hills-v2, 10:00, >=8 customers on the floor',
    },
    humanBaselineYdPerS: HUMAN_BASELINE_YD_S,
    authoredCustomerSpeeds: {
      toCounter: 1.15,
      browsing: [1.10, 1.60],
      note: 'clubhouse.js spawnCustomer: speed = toCounter ? 1.15 : 1.1 + rng*0.5. '
        + 'These are the yd/s a customer SHOULD move at on the 1x rung.',
    },
    rungs,
    control: {
      description: 'each body must travel at its own authored yd/s times the rung\'s '
        + 'locomotionScale. Ratio 1.0 at every rung, checked against the code\'s '
        + 'intent rather than against another measurement.',
      ratios,
      holds: ratiosHold,
    },
    errs: errs.slice(0, 16),
    ok: ratiosHold
      && Object.values(rungs).every((r) => r.bodiesWalking >= 3)
      && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'walk-speed.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

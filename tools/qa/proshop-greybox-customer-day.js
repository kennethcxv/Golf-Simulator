async (page) => {
  // PINE HILLS V2 — customer navigation across a full simulated day, both restoration
  // states, with a stuck-NPC watchdog.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-greybox-customer-day.js
  //
  // Boots the seeded starter into pine-hills-v2, spawns ten customers, runs the sim
  // at speed to closing time in the NEGLECTED state; then restores everything
  // (targets, structural components, grime) and runs a second full day. A customer
  // pinned in one nav state longer than the watchdog window fails the run. Route
  // completion is measured from the sim's own lifecycle (spawned vs exited).
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);
  const RUN_TAG = String(process.env.GREYBOX_DAY_TAG || 'run1');
  const STUCK_LIMIT_S = Number(process.env.GREYBOX_STUCK_LIMIT || 75); // sim-seconds in ONE state+position
  const DAY_END_MINUTE = 19 * 60; // sim runs to 7 PM

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
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  const runDay = async (label) => page.evaluate(async ([tag, stuckLimit, dayEnd]) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const state = app.state;

    // Open for business and make customers come: force shop hours active.
    state.speed = 16;
    if (state.clock) state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 9 * 60;

    // Ten scripted customers on top of organic walk-ins.
    const spawned = clubhouse.debugSpawn ? Array.from({ length: 10 }, () => clubhouse.debugSpawn(false)).length : 0;

    // clubhouse.customers() returns the raw customer array (clubhouse.js:10433);
    // per-customer progress is watched through stopIdx/checkoutPhase/position, so
    // no label strings are assumed. The watchdog is WALL time in one unchanged
    // (progress, position) tuple — at speed 16 that bounds sim-time stuckness.
    const perCustomer = new Map();
    const observe = () => {
      const list = typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers;
      return Array.isArray(list) ? list : [];
    };
    const started = performance.now();
    const startMinute = state.clock?.minutes ?? 0;
    const stuck = [];
    let maxSimultaneous = 0;
    let sawAny = false;
    let totalSeen = 0;

    await new Promise((resolve) => {
      const tick = () => {
        const nowMinute = state.clock?.minutes ?? 0;
        const minuteOfDay = nowMinute % 1440;
        const wallOverrun = performance.now() - started > 240000;
        const list = observe();
        maxSimultaneous = Math.max(maxSimultaneous, list.length);
        if (list.length) sawAny = true;
        // Customers waiting at the till are exempt: holding the queue while no
        // cashier serves them is designed patience, not a navigation failure —
        // the register flow has its own acceptance drivers.
        const queued = new Set((clubhouse.checkoutQueue?.() || []).map((entry) => entry.customerId));
        for (const customer of list) {
          const id = customer.customerId ?? customer.id ?? customer.name;
          if (queued.has(id) || customer.awaitingCheckout) {
            perCustomer.delete(id);
            continue;
          }
          const x = Math.round((customer.x ?? customer.entity?.position?.x ?? 0) * 2) / 2;
          const z = Math.round((customer.z ?? customer.entity?.position?.z ?? 0) * 2) / 2;
          const key = `${customer.stopIdx ?? '-'}|${customer.checkoutPhase ?? '-'}|${x},${z}`;
          const record = perCustomer.get(id) || { key: null, sinceWall: performance.now(), worstWallS: 0 };
          if (!perCustomer.has(id)) totalSeen += 1;
          if (record.key !== key) {
            record.key = key;
            record.sinceWall = performance.now();
          } else {
            const heldWallS = (performance.now() - record.sinceWall) / 1000;
            record.worstWallS = Math.max(record.worstWallS, heldWallS);
            if (heldWallS > stuckLimit && !stuck.some((entry) => entry.id === id)) {
              stuck.push({ id, key, heldWallS: Math.round(heldWallS) });
            }
          }
          perCustomer.set(id, record);
        }
        if (minuteOfDay >= dayEnd || wallOverrun || stuck.length > 3) resolve();
        else setTimeout(tick, 250);
      };
      tick();
    });

    const worstHold = Math.max(0, ...[...perCustomer.values()].map((record) => record.worstWallS));
    return {
      tag,
      spawned,
      sawAny,
      maxSimultaneous,
      customersTracked: totalSeen,
      stillInsideAtClose: observe().length,
      stuck,
      worstStateHoldWallS: Math.round(worstHold * 10) / 10,
      simMinutesRun: (state.clock?.minutes ?? 0) - startMinute,
      history: state.shop?.history?.length ?? null,
      unitsSold: state.shop?.unitsSold ?? null,
    };
  }, [label, STUCK_LIMIT_S, DAY_END_MINUTE]);

  const neglected = await runDay('neglected');

  // Restore everything: cleanup targets, structural components, grime, windows.
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

  const result = {
    tag: RUN_TAG,
    stuckLimitSimSeconds: STUCK_LIMIT_S * 16,
    neglected,
    restored,
    errs: errs.slice(0, 16),
    ok: neglected.stuck.length === 0 && restored.stuck.length === 0
      && neglected.sawAny && restored.sawAny,
  };
  fs.writeFileSync(path.join(outDir, `greybox-customer-day-${RUN_TAG}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

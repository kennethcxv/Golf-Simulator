async (page) => {
  // Revived 2026-07-28 (HARNESS_TRUST.md remediation): BASE_URL was an MCP-REPL-era
  // global no committed runner defines; the committed runner's contract is QA_BASE_URL.
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
  // SAVE DURING AN INCOMPLETE TRANSACTION, RELOAD, AND CHECK THE BOOKS.
  //
  // This is the acceptance test for the bug that started the session. pickFromShelf
  // debits the shelf the instant a shopper lifts an item, and the day-rollover autosave
  // snapshots `state` live — so a save taken with someone half-served at the counter
  // used to persist the missing stock and NOT the pending sale. Reload, and the units
  // were gone: destroyed, with the revenue never arriving.
  //
  // We do it for real here: put a shopper at the till, scan one of their two items,
  // take the game's OWN autosave, reload the page, and count everything.

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  const OUT = process.getBuiltinModule('node:path').join(
    process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'register', 'recover',
  );
  const log = [];

  const boot = async () => {
    await page.goto(BASE_URL);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(1200);
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    if (await continueButton.isEnabled().catch(() => false)) {
      await continueButton.click();
    } else {
      // Live menu flow (2026-07-28): "New Empire — Relaxed" became
      // New game → difficulty card → confirm-if-autosave.
      await page.getByRole('button', { name: /New game/i }).click();
      await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
      const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
      if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
      // The old PROPERTY MARKET / Buy screen is gone: the modern flow boots
      // the starter empire straight into the walk (starter-loop is the proof).
    }
    await page.waitForFunction(() => window.__fw && window.__fw.scene3d
      && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 40000 });
    // Freeze the economy before waiting on visual readiness. A reload previously
    // spent several simulated hours behind the veil, then blamed legitimate
    // running costs on persistence.
    await page.evaluate(() => { window.__fw.speedIdx = 0; });
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 40000 });
    await page.waitForTimeout(2200);
    await page.getByRole('button', { name: 'Hide the guide' }).click().catch(() => {});
    // prepareCheckoutQa() no longer exists (2026-07-28); the fixture below does
    // its own stock/clock/pose prep and sendToCounter is the live diagnostic.
  };
  // WAIT FOR THE CAMERA TO ACTUALLY ARRIVE. isActive() flips true the instant [E] is
  // pressed, but the cashier pose BLENDS in over 0.4s — and headless rAF is throttled,
  // so a wall-clock wait under-runs the ease. Project an item while the camera is still
  // mid-flight and you get a pixel ~90px off; the click lands on bare counter, nothing
  // is grabbed, and the run reports "scanned: 0" as though the scanner were broken.
  // It is the same trap as sleeping for the receipt. Never sleep for state.
  const CASHIER_EYE = { x: 2.78 - 8, z: 5.52 + 228 };   // REGISTER cashier pose, in world
  const untilCameraSettled = (ms = 10000) => page.waitForFunction((eye) => {
    const c = window.__fw.scene3d.camera;
    return Math.hypot(c.position.x - eye.x, c.position.z - eye.z) < 0.03;
  }, CASHIER_EYE, { timeout: ms });

  const books = () => page.evaluate(() => {
    const s = window.__fw.state.shop;
    return {
      shelfBalls: s.inventory.balls3.shelf,
      shelfGlove: s.inventory.glove1.shelf,
      backBalls: s.inventory.balls3.back,
      held: (s.held || []).length,
      revenue: (s.salesLive || {}).revenue || 0,
      units: (s.salesLive || {}).units || 0,
      cash: window.__fw.state.cash,
    };
  });

  await boot();

  // a clean, known starting position
  await page.evaluate(async () => {
    const app = window.__fw;
    const inv = app.state.shop.inventory;
    for (const id of Object.keys(inv)) {
      if (['rug1', 'plant1', 'poster1', 'board1', 'light1', 'lounge1', 'vac1'].includes(id)) { inv[id].back = 0; inv[id].shelf = 0; continue; }
      inv[id].shelf = 8;
      inv[id].back = 0;
    }
    app.state.shop.salesLive = { units: 0, revenue: 0 };
    app.state.shop.held = [];
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    app.scene3d.clubhouse().rebuildStock();
    // Live stand (2026-07-28): the hardcoded (2.80-8, 5.10+228) predated BOTH
    // the interior's world offset AND the desk move itself — two stale layers.
    // COUNTER.staffStand is the layout's canonical cashier position; face the
    // register the way the acceptance driver does.
    const L = await import('/src/data/shopLayout.js');
    const o = app.scene3d.clubhouse().interior.position;
    const st = app.scene3d.walk.state;
    const stand = L.COUNTER.staffStand;
    st.x = stand.x + o.x;
    st.z = stand.z + o.z;
    const dx = L.COUNTER.registerX - stand.x;
    const dz = L.COUNTER.registerZ - stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    st.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    st.pitch = -0.18;
  });
  await page.waitForTimeout(700);
  const before = await books();
  log.push({ step: '1. clean start', ...before });

  // a shopper takes two units off the shelf and queues up
  await page.evaluate(() => window.__fw.scene3d.clubhouse().sendToCounter(['balls3', 'glove1'], 'cash'));
  // The fixture customer physically walks to the counter and places goods
  // before a transaction exists; through a crowded v1 floor that can exceed
  // the old 15 s (the acceptance driver budgets 12 s placing + 15 s tx).
  await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 45000 });
  await page.waitForTimeout(1200);
  const mid = await books();
  log.push({
    step: '2. shopper at the counter, holding two units',
    ...mid,
    check: mid.shelfBalls === before.shelfBalls - 1 && mid.held === 2
      ? 'OK — off the shelf, ON the held ledger'
      : 'FAIL',
  });

  // ring one of them up, then walk away from the sale entirely
  await page.keyboard.press('e');
  // WAIT for the till to actually open. Assuming it did is how the earlier run reported
  // "scanned: 0" and blamed the scanner: register mode had simply not come up yet, so
  // onDown() early-returned and the drag grabbed nothing.
  await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });
  await untilCameraSettled();
  await page.waitForTimeout(200);
  await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    window.__qa = {
      px(lx, ly, lz) {
        const ch = app.scene3d.clubhouse();
        const v = new THREE.Vector3(lx + ch.interior.position.x, ly + ch.interior.position.y, lz + ch.interior.position.z);
        v.project(app.scene3d.camera);
        const c = document.querySelector('canvas').getBoundingClientRect();
        return { x: c.left + ((v.x + 1) / 2) * c.width, y: c.top + ((-v.y + 1) / 2) * c.height };
      },
      item(i) {
        const ch = app.scene3d.clubhouse();
        const out = [];
        ch.interior.traverse((o) => { if (o.userData && o.userData.kind === 'item' && o.visible) out.push(o); });
        if (!out[i]) return null;
        const b = new THREE.Box3().setFromObject(out[i]);
        const c = b.getCenter(new THREE.Vector3());
        const o = ch.interior.position;
        return { x: c.x - o.x, y: c.y - o.y, z: c.z - o.z };
      },
    };
  });
  const at = await page.evaluate(() => window.__qa.item(0));
  const from = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), at);
  const via = await page.evaluate(() => window.__qa.px(2.70, 1.17, 4.22));
  const to = await page.evaluate(() => window.__qa.px(3.68, 1.17, 4.44));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // each leg starts where the LAST one ended. The first cut interpolated every leg from
  // `from`, so the cursor snapped back to the item at the start of leg two and the drag
  // zigzagged — it reported scanned: 0 and looked like a broken scanner.
  let cur = from;
  for (const leg of [via, to]) {
    for (let s = 1; s <= 12; s++) {
      const t = s / 12;
      await page.mouse.move(cur.x + (leg.x - cur.x) * t, cur.y + (leg.y - cur.y) * t);
      await page.waitForTimeout(14);
    }
    cur = leg;
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const scanned = await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx.items.filter((i) => i.scanned).length;
  });
  await page.screenshot({ path: `${OUT}/1-half-scanned.png` });
  const preSave = await books();
  log.push({
    step: '3. one of two scanned, mid-sale',
    scanned,
    ...preSave,
    check: scanned === 1 ? 'OK — half-rung-up' : 'FAIL — the drag did not scan',
  });

  // THE GAME'S OWN AUTOSAVE, the one that fires on a day rollover — the exact write
  // that used to lose the stock
  const saved = await page.evaluate(() => {
    window.__fw.autosave();
    const raw = localStorage.getItem('golfempire:autosave');
    const data = JSON.parse(raw);
    const st = data.holdings ? data.holdings[0].state : data;
    return { bytes: raw.length, heldInSave: (st.shop.held || []).length, shelfInSave: st.shop.inventory.balls3.shelf };
  });
  log.push({
    step: '4. AUTOSAVE taken mid-sale',
    ...saved,
    check: saved.heldInSave === 2 ? 'OK — the save KNOWS two units are in flight' : 'FAIL — units in flight are absent from the save',
  });

  // reload the page: every shopper lives in the renderer and none of them survive
  await boot();
  const after = await books();
  await page.screenshot({ path: `${OUT}/2-after-reload.png` });
  log.push({
    step: '5. RELOADED',
    ...after,
    checks: {
      stockReturned: after.shelfBalls === before.shelfBalls && after.shelfGlove === before.shelfGlove
        ? 'OK — both units back on the shelf' : `FAIL — balls ${after.shelfBalls} vs ${before.shelfBalls}`,
      nothingHeld: after.held === 0 ? 'OK — nothing left in limbo' : 'FAIL',
      noPhantomRevenue: after.revenue === 0 ? 'OK — the half-sale banked nothing' : 'FAIL',
      // ACROSS THE SAVE, not across the whole test. The game's economy keeps ticking
      // while the harness runs — the first cut compared cash at step 1 with cash after
      // the reload, saw a legitimate $90 of running costs, and called it a failure.
      noMoneyInvented: Math.abs(after.cash - preSave.cash) < 0.005
        ? 'OK — cash identical across the save/reload'
        : `FAIL — ${preSave.cash} -> ${after.cash} across the reload`,
    },
  });

  const stuck = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return { registerLocked: ch.register.isActive(), ghostTx: ch.register.hasTx() };
  });
  log.push({
    step: '6. and the player is not stranded',
    ...stuck,
    check: !stuck.registerLocked && !stuck.ghostTx ? 'OK — register mode is not locked and no ghost sale survives' : 'FAIL',
  });

  const ok = scanned === 1
    && saved.heldInSave === 2
    && after.shelfBalls === before.shelfBalls
    && after.shelfGlove === before.shelfGlove
    && after.held === 0
    && after.revenue === 0
    && Math.abs(after.cash - preSave.cash) < 0.005
    && !stuck.registerLocked
    && !stuck.ghostTx
    && errors.length === 0;
  return {
    ok,
    blocker: ok ? null : { message: 'mid-sale save/reload did not conserve stock, cash, and register state' },
    log,
    errors: errors.slice(0, 8),
    errorCount: errors.length,
  };
}

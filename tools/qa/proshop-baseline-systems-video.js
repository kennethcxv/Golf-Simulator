async (page) => {
  // PRO-SHOP PHASE 0 BASELINE — recorded footage of the three non-cleaning systems
  // the slice must keep working: the laptop, the checkout, and a customer walking
  // the route to the counter.
  //
  //   VIDEO_DIR=<dir> HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-systems-video.js
  //
  // Nothing is modified; the only non-player call is `sendToCounter`, the clubhouse's
  // own QA hook (clubhouse.js:10424) which performs a real pickFromShelf and routes a
  // real customer — it is how every register driver in tools/qa stages a sale.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const dataOut = path.resolve(process.env.BASELINE_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Baseline', 'data'));
  fs.mkdirSync(dataOut, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const MINUTE_OF_DAY = 13 * 60;

  const beats = [];
  const notes = {};
  let t0 = 0;
  const mark = (name) => beats.push({ name, atMs: Date.now() - t0 });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  const place = async (lx, lz, yaw, pitch) => {
    await page.evaluate(({ lx, lz, yaw, pitch, minuteOfDay }) => {
      const app = window.__fw;
      const s3 = app.scene3d;
      const o = s3.clubhouse().interior.position;
      const w = s3.walk;
      w.clearKeys();
      w.state.x = o.x + lx; w.state.z = o.z + lz; w.state.yaw = yaw; w.state.pitch = pitch;
      const c = app.state.clock;
      c.minutes = Math.floor(c.minutes / 1440) * 1440 + minuteOfDay;
      s3.applyTimeWeather(minuteOfDay, app.state.weather);
    }, { lx, lz, yaw, pitch, minuteOfDay: MINUTE_OF_DAY });
    await page.waitForTimeout(650);
  };

  await place(-0.8, 4.4, 0, -0.04);
  await page.evaluate(() => { window.__fw.speedIdx = 1; });
  await page.mouse.click(800, 450);
  t0 = Date.now();

  // ---- A. entering and using the laptop ------------------------------------------
  mark('approach-laptop');
  await page.waitForTimeout(2000);
  notes.fovBeforeLaptop = await page.evaluate(() => window.__fw.scene3d.camera.fov);

  let entered = false;
  for (const spot of [[0.9, 0.9], [0.4, 1.0], [1.4, 1.0], [0.9, 0.4]]) {
    await place(spot[0], spot[1], Math.PI, -0.25);
    const label = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
    if (/laptop/i.test(label)) {
      notes.laptopFocusLabel = label;
      notes.laptopFocusSpot = spot;
      mark('laptop-open');
      await page.evaluate(() => window.__fw.scene3d.walk.interact());
      await page.waitForTimeout(3000);
      entered = await page.evaluate(() => window.__fw.view === 'laptop'
        || window.__fw.scene3d.clubhouse().laptopScreenMode() === 'live');
      break;
    }
  }
  notes.laptopEntered = entered;
  if (entered) {
    notes.fovInLaptop = await page.evaluate(() => window.__fw.scene3d.camera.fov);
    // click through a couple of pages the way a player does, on the projected quad
    for (const nav of ['Shop', 'Finances', 'Home']) {
      const btn = page.getByRole('button', { name: new RegExp(`^${nav}$`, 'i') }).first();
      if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) {
        await btn.click().catch(() => {});
        mark(`laptop-page-${nav.toLowerCase()}`);
        await page.waitForTimeout(2200);
      }
    }
    mark('laptop-exit');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2500);
    notes.viewAfterEscape = await page.evaluate(() => window.__fw.view);
    notes.laptopScreenModeAfterExit = await page.evaluate(() => window.__fw.scene3d.clubhouse().laptopScreenMode());
    notes.fovAfterLaptopExit = await page.evaluate(() => window.__fw.scene3d.camera.fov);
    // Does the walk lens come back on its own once the player moves again?
    await place(-1.5, 2.5, 0, -0.05);
    await page.keyboard.down('w');
    await page.waitForTimeout(900);
    await page.keyboard.up('w');
    await page.waitForTimeout(900);
    notes.fovAfterMoving = await page.evaluate(() => window.__fw.scene3d.camera.fov);
  }

  // ---- B. a customer walking the route to the counter -----------------------------
  mark('customer-route');
  await place(-3.6, 3.6, -0.5, -0.04);
  const staged = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    try {
      const r = ch.sendToCounter(['balls1', 'glove1'], 'card');
      return { ok: true, detail: r === undefined ? null : JSON.parse(JSON.stringify(r)) };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  notes.sendToCounter = staged;
  await page.waitForTimeout(9000); // let them walk in and queue

  notes.customersAfterSpawn = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const S = (fn) => { try { return fn(); } catch (e) { return `ERR:${e.message}`; } };
    // `customers` is an array on the API surface; `checkoutQueue` is a function.
    const cs = S(() => (typeof ch.customers === 'function' ? ch.customers() : ch.customers));
    const q = S(() => (typeof ch.checkoutQueue === 'function' ? ch.checkoutQueue() : ch.checkoutQueue));
    return {
      customerCount: Array.isArray(cs) ? cs.length : typeof cs,
      queueLength: Array.isArray(q) ? q.length : typeof q,
    };
  });

  // ---- C. the checkout ------------------------------------------------------------
  mark('checkout');
  await place(0.0, 0.4, Math.PI, -0.14);
  await page.waitForTimeout(6000); // customer places goods on the staging tray

  const regBefore = await page.evaluate(() => {
    const r = window.__fw.scene3d.clubhouse().register;
    return { isActive: r.isActive(), hasTx: r.hasTx(), flow: r.getFlow?.()?.state ?? null };
  });
  notes.registerBeforeEnter = regBefore;

  // enter register mode the player's way: [E] on the front desk
  for (const spot of [[0.0, 0.4], [-0.6, 0.4], [0.6, 0.4], [0.0, 0.8]]) {
    await place(spot[0], spot[1], Math.PI, -0.14);
    const label = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
    if (/register|till|checkout|counter/i.test(label)) {
      notes.registerFocusLabel = label;
      await page.evaluate(() => window.__fw.scene3d.walk.interact());
      await page.waitForTimeout(3500);
      break;
    }
  }
  notes.registerAfterEnter = await page.evaluate(() => {
    const r = window.__fw.scene3d.clubhouse().register;
    return { isActive: r.isActive(), hasTx: r.hasTx(), flow: r.getFlow?.()?.state ?? null };
  });
  mark('checkout-observe');
  await page.waitForTimeout(9000); // hold on the register framing

  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  mark('end');

  const report = {
    durationMs: Date.now() - t0,
    viewport: { width: 1600, height: 900 },
    minuteOfDay: MINUTE_OF_DAY,
    notes,
    beats,
  };
  fs.writeFileSync(path.join(dataOut, 'baseline-systems-video.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

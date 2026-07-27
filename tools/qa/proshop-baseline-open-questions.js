async (page) => {
  // PRO-SHOP PHASE 0 — resolves the two open questions left by the baseline pass.
  //
  //   HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-open-questions.js
  //
  // Q1  Does the "Close Laptop" button restore the camera lens, or does it strand the
  //     player at LAPTOP_FOV 34 the way Escape does (OBS-1)?
  // Q2  Does the front-desk [E] verb actually open register mode with a customer
  //     waiting, or was the earlier miss a harness aiming problem?
  //
  // Diagnostic only. Nothing is modified and nothing is fixed.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const dataOut = path.resolve(process.env.BASELINE_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Baseline', 'data'));
  fs.mkdirSync(dataOut, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const MINUTE_OF_DAY = 13 * 60;

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
    await page.waitForTimeout(420);
  };
  const lens = () => page.evaluate(() => ({
    cameraFov: window.__fw.scene3d.camera.fov,
    walkFov: window.__fw.scene3d.walk.state.fov,
    view: window.__fw.view,
    screenMode: window.__fw.scene3d.clubhouse().laptopScreenMode(),
  }));

  await page.evaluate(() => { window.__fw.speedIdx = 1; });
  await page.mouse.click(800, 450);

  // ---------------------------------------------------------------- Q0: interactable census
  // Sweep the room on a grid and record every focus label the walk controller offers.
  // This is what makes the Q2 answer trustworthy rather than a guess about aiming.
  const census = {};
  for (let lx = -8; lx <= 8; lx += 1) {
    for (let lz = -5; lz <= 5; lz += 1) {
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        await page.evaluate(({ lx, lz, yaw }) => {
          const s3 = window.__fw.scene3d;
          const o = s3.clubhouse().interior.position;
          const w = s3.walk;
          w.clearKeys();
          w.state.x = o.x + lx; w.state.z = o.z + lz; w.state.yaw = yaw; w.state.pitch = -0.15;
        }, { lx, lz, yaw });
        const label = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
        if (label && !census[label]) census[label] = { lx, lz, yaw: +yaw.toFixed(3) };
      }
    }
  }

  // ---------------------------------------------------------------- Q1: laptop exit routes
  const laptopSpot = census[Object.keys(census).find((k) => /laptop/i.test(k))] || { lx: 0.9, lz: 0.9, yaw: Math.PI };
  const q1 = { laptopSpot, routes: [] };

  const enterLaptop = async () => {
    await place(laptopSpot.lx, laptopSpot.lz, laptopSpot.yaw, -0.25);
    await page.evaluate(() => window.__fw.scene3d.walk.interact());
    await page.waitForTimeout(3000);
    return page.evaluate(() => window.__fw.view === 'laptop'
      || window.__fw.scene3d.clubhouse().laptopScreenMode() === 'live');
  };

  // Route A — the "Close Laptop" button in the laptop UI
  {
    const before = await lens();
    const entered = await enterLaptop();
    const inside = await lens();
    let clicked = false;
    const btn = page.getByRole('button', { name: /Close Laptop/i }).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click().catch(() => {});
      clicked = true;
      await page.waitForTimeout(2600);
    }
    const after = await lens();
    await place(-1.5, 2.5, 0, -0.05);
    await page.keyboard.down('w'); await page.waitForTimeout(800); await page.keyboard.up('w');
    await page.waitForTimeout(800);
    const afterMoving = await lens();
    q1.routes.push({ route: 'Close Laptop button', entered, clicked, before, inside, after, afterMoving });
  }

  // Restore the lens so route B starts from a known state, then test Escape.
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    s3.camera.fov = s3.walk.state.fov; s3.camera.updateProjectionMatrix();
  });
  await page.waitForTimeout(500);

  // Route B — Escape
  {
    const before = await lens();
    const entered = await enterLaptop();
    const inside = await lens();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2600);
    const after = await lens();
    await place(-1.5, 2.5, 0, -0.05);
    await page.keyboard.down('w'); await page.waitForTimeout(800); await page.keyboard.up('w');
    await page.waitForTimeout(800);
    const afterMoving = await lens();
    q1.routes.push({ route: 'Escape key', entered, clicked: null, before, inside, after, afterMoving });
  }

  // Does anything at all bring the lens back? Try a second enter+exit cycle.
  {
    const entered = await enterLaptop();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2400);
    q1.afterSecondCycle = { entered, ...(await lens()) };
  }

  // ---------------------------------------------------------------- Q2: register [E]
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    s3.camera.fov = s3.walk.state.fov; s3.camera.updateProjectionMatrix();
  });
  const q2 = {};
  q2.staged = await page.evaluate(() => {
    try { return { ok: true, who: window.__fw.scene3d.clubhouse().sendToCounter(['balls1', 'glove1'], 'card') }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  await page.waitForTimeout(11000); // let them walk in, queue, and place goods

  q2.beforeEnter = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const r = ch.register;
    const q = typeof ch.checkoutQueue === 'function' ? ch.checkoutQueue() : ch.checkoutQueue;
    return {
      isActive: r.isActive(), hasTx: r.hasTx(),
      flow: r.getFlow?.()?.state ?? null,
      queueLength: Array.isArray(q) ? q.length : null,
      customer: r.getCustomer?.() ? 'present' : 'none',
    };
  });

  // Find the register/front-desk focus label from the census, stand there, press E.
  const regKey = Object.keys(census).find((k) => /register|till|checkout|serve|front desk|counter/i.test(k));
  q2.registerFocusLabel = regKey || null;
  q2.registerFocusSpot = regKey ? census[regKey] : null;
  if (regKey) {
    const s = census[regKey];
    await place(s.lx, s.lz, s.yaw, -0.15);
    q2.labelAtSpot = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
    await page.evaluate(() => window.__fw.scene3d.walk.interact());
    await page.waitForTimeout(3500);
  }
  q2.afterEnter = await page.evaluate(() => {
    const r = window.__fw.scene3d.clubhouse().register;
    return { isActive: r.isActive(), hasTx: r.hasTx(), flow: r.getFlow?.()?.state ?? null };
  });

  const report = {
    note: 'Diagnostic pass for the two open questions in PHASE_0_REPORT.md. Nothing was fixed.',
    interactableCensus: census,
    q1_laptopExitRestoresLens: q1,
    q2_registerInteract: q2,
  };
  fs.writeFileSync(path.join(dataOut, 'baseline-open-questions.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

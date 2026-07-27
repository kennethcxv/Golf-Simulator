async (page) => {
  // LAPTOP-1 regression check — the walk lens must come back after a focused mode.
  //
  //   HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-fix-laptop-fov-verify.js
  //
  // Before the fix, walkFocusOn snapshotted camera.fov AFTER enterLaptop had already
  // set LAPTOP_FOV, so the focus ease-out restored 34 instead of 66 — permanently, and
  // it re-poisoned itself every cycle. Covers both exit routes, a second cycle, and the
  // register path, which shared the same root cause.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.FIX_DATA_OUT || path.join(repo, 'Designs', 'ProShop', 'Phase1', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const c = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await c.isVisible({ timeout: 1500 }).catch(() => false)) await c.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(800, 450);

  const lens = () => page.evaluate(() => ({
    cameraFov: window.__fw.scene3d.camera.fov,
    cameraNear: +window.__fw.scene3d.camera.near.toFixed(4),
    walkFov: window.__fw.scene3d.walk.state.fov,
    view: window.__fw.view,
    screen: window.__fw.scene3d.clubhouse().laptopScreenMode(),
  }));
  const place = async (lx, lz, yaw, pitch) => {
    await page.evaluate(({ lx, lz, yaw, pitch }) => {
      const s3 = window.__fw.scene3d;
      const o = s3.clubhouse().interior.position;
      const w = s3.walk; w.clearKeys();
      w.state.x = o.x + lx; w.state.z = o.z + lz; w.state.yaw = yaw; w.state.pitch = pitch;
      window.__fw.speedIdx = 0;
    }, { lx, lz, yaw, pitch });
    await page.waitForTimeout(450);
  };
  const findProp = async (re, spots) => {
    for (const s of spots) {
      await place(s[0], s[1], s[2] ?? Math.PI, -0.2);
      const label = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
      if (re.test(label)) return { label, spot: s };
    }
    return null;
  };

  const checks = [];
  const record = (name, before, inside, after, expectFov) => {
    const ok = after.cameraFov === expectFov && Math.abs(after.cameraNear - 0.15) < 1e-6;
    checks.push({ name, ok, expectFov, before, inside, after });
    return ok;
  };

  // ---- laptop: route A (Close Laptop button), route B (Escape), then a 2nd cycle -----
  const laptopSpot = await findProp(/laptop/i, [[1, 0, -Math.PI / 2], [0.9, 0.9], [0.4, 1.0], [1.4, 1.0]]);
  for (const route of ['close-button', 'escape', 'escape-second-cycle']) {
    const before = await lens();
    if (laptopSpot) await place(laptopSpot.spot[0], laptopSpot.spot[1], laptopSpot.spot[2] ?? Math.PI, -0.25);
    await page.evaluate(() => window.__fw.scene3d.walk.interact());
    await page.waitForTimeout(3000);
    const inside = await lens();
    if (route === 'close-button') {
      const btn = page.getByRole('button', { name: /Close Laptop/i }).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) await btn.click().catch(() => {});
      else await page.keyboard.press('Escape');
    } else {
      await page.keyboard.press('Escape');
    }
    // The clobber landed ~0.4 s after exit via the focus ease-out, so wait well past it.
    await page.waitForTimeout(2600);
    const after = await lens();
    record(`laptop:${route}`, before, inside, after, 66);
  }

  // walking around afterwards must not re-break it
  await place(-1.5, 2.5, 0, -0.05);
  await page.keyboard.down('w'); await page.waitForTimeout(900); await page.keyboard.up('w');
  await page.waitForTimeout(900);
  const afterMoving = await lens();
  checks.push({ name: 'laptop:after-moving-again', ok: afterMoving.cameraFov === 66, expectFov: 66, after: afterMoving });

  // ---- register path: same root cause (D2) ------------------------------------------
  const staged = await page.evaluate(() => {
    try { return { ok: true, who: window.__fw.scene3d.clubhouse().sendToCounter(['balls1', 'glove1'], 'card') }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  await page.waitForTimeout(11000);
  const deskSpot = await findProp(/tee desk|register|till|checkout/i, [[-2, 2, Math.PI / 2], [-2.5, 1], [0, 0.4], [-0.6, 0.4]]);
  const regBefore = await lens();
  let regEntered = null;
  if (deskSpot) {
    await page.evaluate(() => window.__fw.scene3d.walk.interact());
    await page.waitForTimeout(3200);
    regEntered = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
    const regInside = await lens();
    // Escape in register mode is a CHAIN (simplifiedRegisterMode.js:5825-5833): it clears a
    // selected reservation, then resets the tab to home, and only then calls leave(). One
    // press does not necessarily exit, so press until it actually does.
    const escPresses = [];
    for (let i = 0; i < 4; i++) {
      const stillActive = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
      escPresses.push(stillActive);
      if (!stillActive) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(900);
    }
    // wait well past the 0.4 s focus ease-out that used to clobber the restore
    await page.waitForTimeout(2600);
    const regAfter = await lens();
    const regStillActive = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
    checks.push({
      name: 'register:exited-cleanly',
      ok: regStillActive === false,
      detail: { escPresses, regStillActive },
    });
    record('register:escape', regBefore, regInside, regAfter, 66);
  }

  const allOk = checks.every((c) => c.ok);
  const report = {
    defect: 'LAPTOP-1',
    fix: 'courseScene.js walkFocusOn snapshots walk.fov instead of camera.fov',
    laptopSpot, deskSpot, staged, registerEntered: regEntered,
    allOk,
    checks,
  };
  fs.writeFileSync(path.join(outDir, 'fix-laptop-fov-verify.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { ok: allOk, ...report };
}

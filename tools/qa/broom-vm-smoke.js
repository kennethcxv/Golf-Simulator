async (page) => {
  // PHASE 6 SMOKE — the rebuilt broom rig, framed and measured.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/broom-vm-smoke.js
  //
  // Four beats, each with a render and the rig's own numbers: (1) LEVEL pitch
  // — the head must be inside NDC (the old rig sat at y −1.55); (2) working
  // down-look mid-stroke; (3) sweeping into a fixture face — the clamp must
  // engage; (4) unequip then re-equip of another tool — the hands must return
  // to the world pass (the layer-escape regression).
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/broom-phase6/smoke');
  fs.mkdirSync(OUT, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

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

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    // Face EAST across the open sales floor: the level-pitch beat must not
    // face a nearby fixture, or the collider clamp legitimately pulls the
    // head to the feet and the framing number measures the clamp instead.
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4;
    w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
    document.querySelectorAll('.hud, .hud-min, .shop-lockhint, .notification-center, '
      + '.walk-overlay, .objectives-card, .shed-checklist')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.waitForTimeout(1200);
  await page.mouse.click(800, 450);

  const diag = () => page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics());
  const shots = [];
  const shot = async (name) => {
    const file = path.join(OUT, name);
    await page.screenshot({ path: file });
    shots.push(file);
  };

  // ---- 1. level pitch ------------------------------------------------------
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2500); // equip + authored adoption settle
  const level = await diag();
  await shot('01-level-pitch-hold.png');
  if (!level.vmActive) throw new Error(`viewmodel rig inactive after equip: ${JSON.stringify(level)}`);
  if (!(level.headNdc.y > -1 && level.headNdc.y < 1 && Math.abs(level.headNdc.x) < 1)) {
    throw new Error(`head off-frame at level pitch: ${JSON.stringify(level.headNdc)} (old rig: y -1.55)`);
  }

  // ---- 2. working down-look, mid-stroke ------------------------------------
  await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -0.82; });
  await page.mouse.down();
  await page.waitForTimeout(1600);
  const working = await diag();
  await shot('02-working-downlook.png');
  await page.mouse.up();

  // ---- 3. clamp at a fixture face ------------------------------------------
  // March the sweep into the front desk until the clamp engages.
  await page.evaluate(() => { window.__fw.scene3d.walk.state.yaw = Math.PI / 2; });
  await page.mouse.down();
  await page.keyboard.down('w');
  const clampSeen = await page.waitForFunction(
    () => window.__fw.scene3d.walk.broomDiagnostics().clamped === true,
    null, { timeout: 9000, polling: 120 },
  ).then(() => true).catch(() => false);
  await page.keyboard.up('w');
  const clamped = await diag();
  await shot('03-clamped-at-fixture.png');
  await page.mouse.up();

  // ---- 4. unequip / re-equip another tool: layers must restore -------------
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('mop'));
  await page.waitForTimeout(1200);
  const afterSwitch = await page.evaluate(() => {
    const app = window.__fw;
    const layer = 29;
    const escaped = [];
    app.scene3d.scene.traverse((object) => {
      if (object.isLight) return; // lights legitimately keep the extra layer
      if ((object.layers.mask & (1 << layer)) && !(object.layers.mask & 1)) {
        escaped.push(object.name || object.type);
      }
    });
    return { escaped: escaped.slice(0, 8), broom: app.scene3d.walk.broomDiagnostics() };
  });
  await shot('04-mop-after-switch.png');
  if (afterSwitch.broom.vmActive) throw new Error('rig still active after switching to the mop');
  if (afterSwitch.escaped.length) {
    throw new Error(`objects stranded on the viewmodel layer: ${JSON.stringify(afterSwitch.escaped)}`);
  }

  return {
    ok: true,
    level: { headNdc: level.headNdc, reach: level.reach, fov: level.fov },
    working,
    clamp: { engaged: clampSeen, at: clamped },
    afterSwitch: afterSwitch.broom,
    shots,
  };
}

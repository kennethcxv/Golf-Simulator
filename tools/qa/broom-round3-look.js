async (page) => {
  // The broom round-3 iteration loop: three frames and the numbers behind them.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/broom-round3-look.js
  //
  // Beats: level carry, working down-look, and mid-sweep at the arc's extreme —
  // the three poses the play-test called out. Every number is projected through
  // the VIEWMODEL lens, and the vm camera's matrices are never touched (it is
  // matrixAutoUpdate:false and driven by hand each frame).
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/broom-round3/look');
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
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4;
    w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
    document.querySelectorAll('.hud, .hud-min, .shop-lockhint, .notification-center, '
      + '.walk-overlay, .objectives-card, .shed-checklist, .tool-hint, .interact-prompt')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.waitForTimeout(1200);
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2600);

  const measure = () => page.evaluate(() => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const vm = w.broomViewmodelCamera();
    const world = app.scene3d.camera;
    const Vec3 = world.position.constructor;
    const v = new Vec3();
    const ndcOf = (o) => { o.getWorldPosition(v); const p = v.clone().project(vm); return [+p.x.toFixed(3), +p.y.toFixed(3)]; };
    const camOf = (o) => { o.getWorldPosition(v); const p = v.clone().applyMatrix4(world.matrixWorldInverse); return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]; };
    const find = (n) => { let f = null; app.scene3d.scene.traverse((o) => { if (o.name === n) f = o; }); return f; };
    const rh = find('FirstPersonRightHand'); const lh = find('FirstPersonLeftHand');
    // widest screen span of the green sleeve capsules — the "green diagonal" number
    let sleeveY = [9, -9]; let sleeveX = [9, -9];
    for (const armName of ['BroomRightArm', 'BroomLeftArm']) {
      const g = find(armName);
      if (!g) continue;
      g.traverse((m) => {
        if (!m.isMesh || m.geometry?.type !== 'CapsuleGeometry') return;
        if (m.material?.color?.getHexString() !== '2f4a35') return;
        const pos = m.geometry.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / 50));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i); m.localToWorld(v); v.project(vm);
          sleeveY = [Math.min(sleeveY[0], v.y), Math.max(sleeveY[1], v.y)];
          sleeveX = [Math.min(sleeveX[0], v.x), Math.max(sleeveX[1], v.x)];
        }
      });
    }
    const d = w.broomDiagnostics();
    return {
      headNdc: d.headNdc,
      rightHand: { ndc: rh ? ndcOf(rh) : null, cam: rh ? camOf(rh) : null },
      leftHand: { ndc: lh ? ndcOf(lh) : null, cam: lh ? camOf(lh) : null },
      sleeveNdc: { x: sleeveX.map((n) => +n.toFixed(2)), y: sleeveY.map((n) => +n.toFixed(2)) },
      grips: { upper: d.gripUpper, lower: d.gripLower },
      workBlend: d.workBlend, reach: d.drawReach, clamped: d.clamped, swingRad: d.swingRad,
    };
  });

  const out = {};
  const shot = async (n) => { await page.screenshot({ path: path.join(OUT, n) }); };

  // 1. level carry
  out.level = await measure();
  await shot('01-level.png');

  // 2. working down-look, mid-stroke
  await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -0.75; });
  await page.mouse.down();
  await page.waitForTimeout(1500);
  out.working = await measure();
  await shot('02-working.png');

  // 3. the arc's extreme: sample until |swing| peaks
  let best = null;
  for (let i = 0; i < 26; i += 1) {
    await page.waitForTimeout(70);
    const m = await measure();
    if (!best || Math.abs(m.swingRad || 0) > Math.abs(best.swingRad || 0)) {
      best = m;
      await shot('03-sweep-extreme.png');
    }
  }
  out.sweepExtreme = best;
  await page.mouse.up();

  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(out, null, 2));
  return { ok: true, ...out };
}

async (page) => {
  // ART BIBLE reference plates â€” the single best and single worst asset currently in the
  // starter pro shop, shot in-game at gameplay framing.
  //
  //   HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-artbible-reference.js
  //
  // Every rule in ART_BIBLE.md has to be traceable to a visible difference between these
  // two objects. Same capture discipline as the baseline: fixed seed, clock pinned, FOV
  // asserted against the walk lens, customers hidden, doors closed, toasts suppressed.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.join(repo, 'Designs', 'ProShop', 'ArtBible', 'reference');
  fs.mkdirSync(out, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.SPIKE_SEED || 20260727);
  const M = 13 * 60;

  const SHOTS = [
    // BEST â€” the reception/checkout counter run: real millwork, stile-and-rail panels,
    // a returned corner, brass pulls, believable 1.055 yd worktop.
    { id: 'best-counter-millwork', at: [0.0, 4.0], look: [0.0, 1.2], pitch: -0.12 },
    { id: 'best-counter-corner', at: [-2.2, 3.4], look: [-0.6, 1.4], pitch: -0.16 },
    // WORST â€” loose floor debris: flat untextured quads lying on the boards, and the
    // printed-card snack packaging on the turn-snacks rack.
    { id: 'worst-floor-debris', at: [-4.5, 4.4], look: [-4.5, 2.6], pitch: -0.70 },
    { id: 'worst-snack-packaging', at: [5.6, 4.2], look: [7.4, 3.0], pitch: -0.22 },
  ];

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  await page.evaluate((m) => {
    const app = window.__fw; const s3 = app.scene3d;
    const o = s3.clubhouse().interior.position; const w = s3.walk; w.clearKeys();
    w.state.x = o.x; w.state.z = o.z + 3; app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + m;
    s3.applyTimeWeather(m, app.state.weather);
  }, M);
  await page.waitForTimeout(12000); // let arrival toasts expire

  const shots = [];
  for (const s of SHOTS) {
    const pose = await page.evaluate(({ shot, m }) => {
      const app = window.__fw; const s3 = app.scene3d; const ch = s3.clubhouse();
      const o = ch.interior.position; const w = s3.walk; w.clearKeys();
      const cs = typeof ch.customers === 'function' ? ch.customers() : ch.customers;
      if (Array.isArray(cs)) cs.forEach((c) => { if (c && c.mesh) c.mesh.visible = false; });
      const doors = ch.doors || ch.doorApi?.doors || null;
      if (Array.isArray(doors)) doors.forEach((d) => { if (d) { d.open = false; d.swingTarget = 0; d.angle = 0; } });
      const nc = document.querySelector('.notification-center');
      if (nc) nc.style.display = 'none';
      const c = app.state.clock;
      c.minutes = Math.floor(c.minutes / 1440) * 1440 + m;
      s3.applyTimeWeather(m, app.state.weather);
      const ax = o.x + shot.at[0]; const az = o.z + shot.at[1];
      const dx = (o.x + shot.look[0]) - ax; const dz = (o.z + shot.look[1]) - az;
      const d = Math.hypot(dx, dz) || 1;
      w.state.x = ax; w.state.z = az;
      w.state.yaw = Math.atan2(-dx / d, -dz / d);
      w.state.pitch = shot.pitch;
      return { fovOk: s3.camera.fov === w.state.fov, cameraFov: s3.camera.fov };
    }, { shot: s, m: M });
    await page.waitForTimeout(750);
    await page.screenshot({ path: path.join(out, `${s.id}.png`) });
    shots.push({ id: s.id, ...s, ...pose });
  }

  const env = await page.evaluate(() => {
    const s3 = window.__fw.scene3d; const g = s3.post.gtao;
    return {
      fov: s3.camera.fov,
      gtao: {
        blendIntensity: g.blendIntensity,
        radius: g.gtaoMaterial?.uniforms?.radius?.value ?? null,
        renderTarget: g.gtaoRenderTarget ? `${g.gtaoRenderTarget.width}x${g.gtaoRenderTarget.height}` : null,
      },
      condition: s3.clubhouse().condition(),
    };
  });

  const report = { seed: SEED, minuteOfDay: M, env, shots, fovAssertAll: shots.every((s) => s.fovOk) };
  fs.writeFileSync(path.join(out, 'reference.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { ok: report.fovAssertAll, ...report };
}

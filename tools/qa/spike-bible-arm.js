async (page) => {
  // THROWAWAY — ART_BIBLE validation spike. Shoots one asset from three fixed angles.
  //
  //   ARM=A HEADED=1 node tools/qa/run-playwright.cjs tools/qa/spike-bible-arm.js
  //
  // Subject: asset_065_stockroom_worktable at interior-local (6.3, -1.7). Same capture
  // discipline as the lighting spike: fixed seed, clock pinned, FOV asserted against the
  // walk lens, customers hidden, doors closed, toasts suppressed.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const ARM = String(process.env.ARM || 'A');
  const out = path.join(repo, 'Designs', 'ProShop', 'Spike', 'bible', `arm${ARM}`);
  fs.mkdirSync(out, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.SPIKE_SEED || 20260727);
  const M = 13 * 60;

  // Worktable centre is local (6.3, -1.7); legs sit at +/-0.875 yd in x, +/-0.31 in z.
  const SHOTS = [
    // Inside the stockroom looking back. An earlier pose stood on the shop side of the
    // x >= 5.7 partition and photographed the wainscot instead of the subject.
    { id: '1-three-quarter', at: [7.70, -0.15], look: [6.10, -1.85], pitch: -0.30 },
    { id: '2-front-elevation', at: [6.30, 0.55], look: [6.30, -1.70], pitch: -0.20 },
    { id: '3-floor-contact', at: [5.05, -0.72], look: [5.45, -1.42], pitch: -0.80 },
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
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  await page.evaluate((m) => {
    const app = window.__fw; const s3 = app.scene3d;
    const o = s3.clubhouse().interior.position; const w = s3.walk; w.clearKeys();
    w.state.x = o.x + 5; w.state.z = o.z; app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + m;
    s3.applyTimeWeather(m, app.state.weather);
  }, M);
  await page.waitForTimeout(12000); // let arrival toasts expire

  // Record the subject's measured state so each arm's change is evidenced, not asserted.
  const subject = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const s3 = window.__fw.scene3d; const ch = s3.clubhouse(); const o = ch.interior.position;
    let root = null;
    ch.interior.traverse((n) => { if (!root && /AssetRuntime_65_stockroom_worktable/.test(n.name || '')) root = n; });
    if (!root) return { found: false };
    const box = new THREE.Box3().setFromObject(root); const size = new THREE.Vector3(); box.getSize(size);
    let tris = 0; let meshes = 0; const mats = {};
    root.traverse((m) => {
      if (!m.isMesh) return;
      meshes++;
      const g = m.geometry;
      tris += g?.index ? g.index.count / 3 : (g?.attributes?.position ? g.attributes.position.count / 3 : 0);
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => {
        if (!mm) return;
        mats[mm.name || '(unnamed)'] = {
          color: mm.color ? `#${mm.color.getHexString()}` : null,
          roughness: mm.roughness != null ? +mm.roughness.toFixed(3) : null,
          metalness: mm.metalness != null ? +mm.metalness.toFixed(3) : null,
        };
      });
    });
    return {
      found: true,
      meshes, tris: Math.round(tris),
      dimsYd: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)],
      baseYAboveFloor: +(box.min.y - o.y).toFixed(4),
      centreLocal: [+(box.min.x + size.x / 2 - o.x).toFixed(2), +(box.min.z + size.z / 2 - o.z).toFixed(2)],
      materials: mats,
    };
  });

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
      const d2 = Math.hypot(dx, dz) || 1;
      w.state.x = ax; w.state.z = az;
      w.state.yaw = Math.atan2(-dx / d2, -dz / d2);
      w.state.pitch = shot.pitch;
      return { fovOk: s3.camera.fov === w.state.fov, cameraFov: s3.camera.fov };
    }, { shot: s, m: M });
    await page.waitForTimeout(750);
    await page.screenshot({ path: path.join(out, `${s.id}.png`) });
    shots.push({ id: s.id, ...s, ...pose });
  }

  const report = { arm: ARM, seed: SEED, subject, shots, fovAssertAll: shots.every((s) => s.fovOk) };
  fs.writeFileSync(path.join(out, 'arm.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { ok: report.fovAssertAll && subject.found, ...report };
}

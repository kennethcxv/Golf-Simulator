async (page) => {
  // ART_BIBLE validation capture. Three fixed angles on asset_065, plus the matched
  // pair the Â§7.4.1 [V] palette gate requires.
  //
  //   ARM=I node tools/qa/run-playwright.cjs tools/qa/spike-bible-arm.js
  //
  // No longer a throwaway: Â§7.4.1's acceptance table names this script and pose
  // `2-front-elevation` by name, so it is the instrument a gate depends on.
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

  // ART_BIBLE Â§7.4.1 [V] gate: the worktable worktop and the reception counter run,
  // front elevation, for `palette-calibration-worktop.png`.
  //
  // The gate says "one frame" and one frame is not possible. `LegacyServicePartition`
  // at x = 5.7 is a solid wall between the stockroom and the shop floor;
  // `tools/qa/proshop-counter-worktop-sightline.js` raycast six candidate positions and
  // the partition is the first hit on every sightline to the worktop from the shop side.
  // So the plate is a MATCHED-CAMERA PAIR instead: identical standoff, identical eye
  // height, identical pitch, identical lens, stacked into one image. That is the
  // property the gate actually depends on â€” comparing two woods photographed the same
  // way â€” and it is stated on the plate rather than quietly substituted.
  //
  // The camera is computed from each subject's live bounding box rather than typed in,
  // so the standoff is matched by construction and lands in arm.json as evidence.
  const STANDOFF = 1.6;   // yards from the front face
  const SURFACE_MARGIN = 0.02;
  const MATCHED = [
    { id: '4-worktop-elevation', match: 'AssetRuntime_65_stockroom_worktable', from: '+z' },
    { id: '5-counter-elevation', match: 'AssetRuntime_61_front_desk_counter_shell', from: '+z' },
  ];

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
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
    w.state.x = o.x + 5; w.state.z = o.z; app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + m;
    s3.applyTimeWeather(m, app.state.weather);
  }, M);
  await page.waitForTimeout(12000); // let arrival toasts expire

  // Record the subject's measured state so each arm's change is evidenced, not asserted.
  const subject = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
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

  // Matched pair for the Â§7.4.1 palette plate.
  const matched = [];
  for (const spec of MATCHED) {
    const pose = await page.evaluate(async ({ shot, m, standoff, margin }) => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
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

      let node = null;
      ch.interior.traverse((n) => { if (!node && (n.name || '') === shot.match) node = n; });
      if (!node) {
        ch.interior.traverse((n) => { if (!node && (n.name || '').startsWith(shot.match)) node = n; });
      }
      if (!node) return { found: false, match: shot.match };

      // Bounds of the VISIBLE geometry only. Collision hulls and socket markers extend
      // past the object and would push the camera back by an amount that differs
      // between the two subjects, which is exactly what a matched pair must not do.
      const box = new THREE.Box3();
      node.traverse((n) => {
        if (!n.isMesh || !n.visible) return;
        if (/^COL_|Collision/i.test(n.name || '')) return;
        box.expandByObject(n);
      });
      const size = new THREE.Vector3(); box.getSize(size);
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      const topY = box.max.y - margin;

      // Front face is +z for both subjects: the worktable's open side and the counter's
      // customer side both face the shop floor.
      const face = box.max.z;
      const ax = cx;
      const az = face + standoff;
      const eye = o.y + (w.state.eye ?? 1.75);
      const drop = eye - topY;
      const run = Math.hypot(ax - cx, az - cz);

      w.state.x = ax; w.state.z = az;
      w.state.yaw = Math.atan2(-(cx - ax) / (run || 1), -(cz - az) / (run || 1));
      w.state.pitch = -Math.atan2(drop, run);

      return {
        found: true,
        match: shot.match,
        subjectLocal: {
          centre: [+(cx - o.x).toFixed(3), +(cz - o.z).toFixed(3)],
          topY: +(topY - o.y).toFixed(3),
          sizeYd: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)],
        },
        camLocal: [+(ax - o.x).toFixed(3), +(az - o.z).toFixed(3)],
        // These four are what "matched" means; they are compared across the pair below.
        standoffYd: +standoff.toFixed(3),
        eyeYd: +(eye - o.y).toFixed(3),
        pitchRad: +w.state.pitch.toFixed(4),
        distToTopYd: +Math.hypot(run, drop).toFixed(3),
        fovOk: s3.camera.fov === w.state.fov,
        cameraFov: s3.camera.fov,
      };
    }, { shot: spec, m: M, standoff: STANDOFF, margin: SURFACE_MARGIN });
    await page.waitForTimeout(750);
    await page.screenshot({ path: path.join(out, `${spec.id}.png`) });
    matched.push({ id: spec.id, ...pose });
  }

  // A matched pair whose cameras are not actually matched proves nothing, so check it
  // rather than assert it in a comment.
  const pairOk = matched.length === 2 && matched.every((s) => s.found && s.fovOk)
    && matched[0].standoffYd === matched[1].standoffYd
    && matched[0].eyeYd === matched[1].eyeYd
    && matched[0].cameraFov === matched[1].cameraFov;
  const pitchSpread = matched.length === 2 && matched[0].found && matched[1].found
    ? +Math.abs(matched[0].pitchRad - matched[1].pitchRad).toFixed(4) : null;

  const report = {
    arm: ARM,
    seed: SEED,
    subject,
    shots,
    matched,
    // Pitch differs only by the two subjects' surface heights, which is what a true
    // elevation requires; record the residual so the plate can state it.
    matchedPitchSpreadRad: pitchSpread,
    matchedCameraOk: pairOk,
    fovAssertAll: shots.every((s) => s.fovOk),
  };
  fs.writeFileSync(path.join(out, 'arm.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { ok: report.fovAssertAll && subject.found && pairOk, ...report };
}

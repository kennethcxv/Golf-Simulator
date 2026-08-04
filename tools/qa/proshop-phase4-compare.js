async (page) => {
  // PHASE 4 â€” fixed-pose before/after comparison, both variants, per the phase
  // brief ("Capture identical before-and-after camera views").
  //
  //   PHASE4_TAG=before PHASE4_VARIANT=v2 node tools/qa/run-playwright.cjs tools/qa/proshop-phase4-compare.js
  //   PHASE4_TAG=before PHASE4_VARIANT=v1 node tools/qa/run-playwright.cjs tools/qa/proshop-phase4-compare.js
  //   ...same with PHASE4_TAG=after once the material/lighting pass lands.
  //
  // v1 is the CONTROL: ten Phase 0 baseline poses, fresh neglected state â€” the
  // after-run must read identically to the before-run (v1 rides no Phase 4
  // change; the variant seam is the guarantee, these frames are the proof).
  //
  // v2 is the SUBJECT: the six baseline poses that stand inside the resized
  // envelope plus five v2-authored views, each captured in THREE lighting
  // states (Â§2.4 both are shipping states, and Phase 4's key-light gating must
  // be judged in all of them):
  //   dark      â€” fresh campaign start: ceiling unpowered, panel faults live
  //   powered   â€” ceiling repaired + both repairable panels serviced
  //   restored  â€” everything restored (the day harness's restore block)
  //
  // Settings match the Phase 0 baseline: 1600x900, DPR 1, 13:00 pinned, clock
  // paused, 750 ms per-pose settle.
  //
  // DETERMINISM (added after the first before/after pair was unusable): the
  // menu's New Game path seeds the world with Math.random()
  // (BASELINE_PERFORMANCE Â§8), so two runs of IDENTICAL code render different
  // terrain, different grime seeding and different customer positions â€” the
  // v1 control frames moved a median 46% of pixels between two runs of an
  // unchanged v1. This harness now boots a pinned-seed empire from
  // localStorage and, per pose, hides customers, closes doors and hides the
  // notification centre â€” the same discipline as
  // proshop-artbible-reference.js. Without this the deliverable comparison
  // measures the seed, not the work.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const TAG = String(process.env.PHASE4_TAG || 'before');
  const VARIANT = String(process.env.PHASE4_VARIANT || 'v2');
  const out = path.resolve(process.env.PHASE4_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Phase4', 'screenshots', `${TAG}-${VARIANT}`));
  const dataOut = path.resolve(process.env.PHASE4_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Phase4', 'data'));
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(dataOut, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  const VIEWPORT = { width: 1600, height: 900 };
  const MINUTE_OF_DAY = 13 * 60;
  const SEED = Number(process.env.PHASE4_SEED || 20260727);

  // Phase 0 baseline poses (BASELINE_CAMERA_TRANSFORMS.md). In v2 the resize
  // seals everything west of x -2.60 and north of z -4.60, which strands poses
  // 02, 06, 07 and 09 inside dead cavity â€” v2 substitutes in-envelope views
  // below for the same four jobs (wide read, merch wall, cleaning route,
  // floor read) plus a ceiling-rig view for the lighting evidence.
  const BASELINE_SHOTS = [
    { id: '01-entrance-looking-inward', at: [-0.8, 4.6], look: [-0.8, -3.0], pitch: -0.03 },
    { id: '02-wide-room-overview', at: [-7.0, 3.6], look: [4.0, -2.2], pitch: -0.05 },
    { id: '03-checkout-focal-view', at: [0.0, 4.2], look: [0.0, 0.8], pitch: -0.04 },
    { id: '04-checkout-interaction-view', at: [0.0, 0.2], look: [0.0, 3.4], pitch: -0.16 },
    { id: '05-laptop-workstation', at: [0.9, 0.1], look: [0.95, 2.4], pitch: -0.30 },
    { id: '06-main-merchandise-wall', at: [-3.2, 1.4], look: [-3.6, -4.4], pitch: -0.02 },
    { id: '07-cleaning-route', at: [-7.4, 4.1], look: [3.6, 3.0], pitch: -0.30 },
    { id: '08-customer-route', at: [-0.8, 5.0], look: [0.2, 1.6], pitch: -0.10 },
    { id: '09-floor-dirt-read', at: [-4.0, -1.0], look: [-8.0, -1.0], pitch: -0.66 },
    { id: '10-back-of-room-clutter', at: [4.6, 1.2], look: [7.6, 3.4], pitch: -0.12 },
  ];
  const V2_CARRIED = new Set([
    '01-entrance-looking-inward', '03-checkout-focal-view',
    '04-checkout-interaction-view', '05-laptop-workstation',
    '08-customer-route', '10-back-of-room-clutter',
  ]);
  const V2_SHOTS = [
    ...BASELINE_SHOTS.filter((s) => V2_CARRIED.has(s.id)),
    // NW corner diagonal â€” the widest honest in-envelope read (west shelves,
    // aisle, desk, lounge edge).
    { id: '11-v2-wide-overview', at: [-2.3, -4.1], look: [4.6, 3.2], pitch: -0.05 },
    // The west-wall retail run (shelf_balls / shelf_acc) from across the aisle.
    { id: '12-v2-merch-west-wall', at: [0.7, 0.3], look: [-2.55, -0.4], pitch: -0.02 },
    // Down the F1 entry strip the starter cleaning task runs along.
    { id: '13-v2-cleaning-route', at: [-0.6, 4.8], look: [-0.9, -4.2], pitch: -0.30 },
    // Open floor pitched down â€” the v2 floor-dirt read, aimed at the door
    // approach cells that actually carry traffic grime.
    { id: '14-v2-floor-read', at: [0.3, 3.1], look: [-2.4, 2.9], pitch: -0.66 },
    // Up at the lid, beams and the four in-envelope panels â€” the lighting-rig
    // view the Phase 4 report needs in every state.
    { id: '15-v2-ceiling-rig', at: [0.6, 2.6], look: [0.6, -2.2], pitch: 0.55 },
  ];

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  // --- boot a FRESH campaign starter (dark-start state) ------------------------------
  const query = VARIANT === 'v2' ? '?clubhouse=pine-hills-v2' : '';
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  await page.evaluate((minuteOfDay) => {
    const app = window.__fw;
    const s3 = app.scene3d;
    const o = s3.clubhouse().interior.position;
    const w = s3.walk;
    w.clearKeys();
    w.state.x = o.x; w.state.z = o.z + 3.0; w.state.yaw = 0; w.state.pitch = 0;
    app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + minuteOfDay;
    s3.applyTimeWeather(minuteOfDay, app.state.weather);
  }, MINUTE_OF_DAY);
  await page.waitForTimeout(14000); // arrival toasts expire

  const lightingState = () => page.evaluate(async () => {
    const app = window.__fw;
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    const snapshot = R.restorationSnapshot(app.state);
    let lights = 0; let visiblePanels = 0;
    app.scene3d.scene.traverse((object) => {
      if (object.isLight && object.visible) lights += 1;
      if (/panel/i.test(object.name || '') && object.visible && object.isMesh) visiblePanels += 1;
    });
    return {
      campaignEnabled: !!app.state.campaign?.enabled,
      ceilingRestored: !!snapshot?.architecture?.components?.ceiling?.restored,
      panelTargets: Object.fromEntries(Object.entries(snapshot?.targetProgress || {})
        .filter(([key]) => key.startsWith('ceiling:'))),
      visibleLights: lights,
      visiblePanelMeshes: visiblePanels,
      exposure: app.scene3d.renderer.toneMappingExposure,
      toneMapping: app.scene3d.renderer.toneMapping,
    };
  });

  const shoot = async (shots, stateLabel, captured) => {
    for (const shot of shots) {
      const pose = await page.evaluate(({ s, minuteOfDay }) => {
        const app = window.__fw;
        const s3 = app.scene3d;
        const ch = s3.clubhouse();
        const o = ch.interior.position;
        const w = s3.walk;
        w.clearKeys();
        // Suppress everything that moves between runs but is not the subject.
        const cs = typeof ch.customers === 'function' ? ch.customers() : ch.customers;
        if (Array.isArray(cs)) cs.forEach((cust) => { if (cust?.mesh) cust.mesh.visible = false; });
        const doors = ch.doors || ch.doorApi?.doors || null;
        if (Array.isArray(doors)) doors.forEach((d) => { if (d) { d.open = false; d.swingTarget = 0; d.angle = 0; } });
        const nc = document.querySelector('.notification-center');
        if (nc) nc.style.display = 'none';
        const c = app.state.clock;
        c.minutes = Math.floor(c.minutes / 1440) * 1440 + minuteOfDay;
        s3.applyTimeWeather(minuteOfDay, app.state.weather);
        const ax = o.x + s.at[0];
        const az = o.z + s.at[1];
        const dx = (o.x + s.look[0]) - ax;
        const dz = (o.z + s.look[1]) - az;
        const d = Math.hypot(dx, dz) || 1;
        w.state.x = ax;
        w.state.z = az;
        w.state.yaw = Math.atan2(-dx / d, -dz / d);
        w.state.pitch = s.pitch;
        return { insideRoom: ch.isInside(ax, az), yaw: w.state.yaw };
      }, { s: shot, minuteOfDay: MINUTE_OF_DAY });
      await page.waitForTimeout(750);
      const file = `${shot.id}--${stateLabel}.png`;
      await page.screenshot({ path: path.join(out, file) });
      captured.push({ id: shot.id, state: stateLabel, file, at: shot.at, look: shot.look, pitch: shot.pitch, ...pose });
    }
  };

  const renderStats = () => page.evaluate(() => new Promise((resolve) => {
    const s3 = window.__fw.scene3d;
    const r = s3.renderer;
    r.info.autoReset = false;
    r.info.reset();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const calls = r.info.render.calls;
      const drawnTris = r.info.render.triangles;
      r.info.autoReset = true;
      const mats = new Set(); const texs = new Set(); const sources = new Set();
      s3.scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if (!m) return;
          mats.add(m.uuid);
          ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach((k) => {
            if (m[k]) { texs.add(m[k].uuid); if (m[k].source) sources.add(m[k].source.uuid); }
          });
        });
      });
      resolve({
        drawCallsPerFrame: calls,
        trianglesDrawnPerFrame: drawnTris,
        uniqueMaterials: mats.size,
        uniqueTextures: texs.size,
        uniqueTextureSources: sources.size,
        texturesInMemory: r.info.memory.textures,
        geometriesInMemory: r.info.memory.geometries,
        programs: r.info.programs ? r.info.programs.length : null,
      });
    }));
  }));

  const captured = [];
  const states = [];
  const shots = VARIANT === 'v2' ? V2_SHOTS : BASELINE_SHOTS;

  // State 1 â€” dark start (fresh campaign boot, as-is).
  states.push({ label: 'dark', lighting: await lightingState() });
  await shoot(shots, 'dark', captured);

  // State 2 â€” powered: ceiling repaired, repairable panels serviced.
  await page.evaluate(async () => {
    const app = window.__fw;
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    R.restorationAction(app.state, { type: 'repair-component', component: 'ceiling', progress: 1 });
    const snapshot = R.restorationSnapshot(app.state);
    for (const targetId of Object.keys(snapshot?.targetProgress || {})) {
      if (targetId.startsWith('ceiling:')) {
        R.restorationAction(app.state, { type: 'repair-light', targetId });
      }
    }
    app.scene3d.clubhouse().pineHillsInterior?.refresh?.();
  });
  await page.waitForTimeout(1200);
  states.push({ label: 'powered', lighting: await lightingState() });
  await shoot(shots, 'powered', captured);

  // State 3 â€” fully restored (the day harness's restore block).
  await page.evaluate(async () => {
    const app = window.__fw;
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
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
  await page.waitForTimeout(1200);
  states.push({ label: 'restored', lighting: await lightingState() });
  await shoot(shots, 'restored', captured);

  const stats = await renderStats();
  const report = {
    tag: TAG,
    variant: VARIANT,
    viewport: VIEWPORT,
    minuteOfDay: MINUTE_OF_DAY,
    states,
    renderStatsAtLastPose: stats,
    shots: captured,
    errs: errs.slice(0, 16),
    ok: errs.length === 0 && captured.every((s) => s.insideRoom !== false),
  };
  fs.writeFileSync(
    path.join(dataOut, `phase4-compare-${TAG}-${VARIANT}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

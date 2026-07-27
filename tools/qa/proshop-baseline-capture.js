async (page) => {
  // PRO-SHOP PHASE 0 BASELINE — fixed-camera capture of the starter clubhouse pro shop
  // exactly as it ships today, before the visual rebuild begins.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-capture.js
  //   (HEADED=1 for the real GPU; dev server must be on 8457 — node tools/serve.cjs)
  //
  // Every pose is expressed in LOCAL room coordinates relative to the LIVE
  // clubhouse().interior.position. The older harnesses hardcode a world offset
  // (x-8 / z+228) that belongs to a different property and no longer resolves to
  // this room — see BASELINE_TEST_PROTOCOL.md. Nothing here alters the room,
  // its materials, its lighting or its assets; the capture only moves the camera.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.resolve(process.env.BASELINE_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Baseline', 'screenshots'));
  const dataOut = path.resolve(process.env.BASELINE_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Baseline', 'data'));
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(dataOut, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  // Fixed capture configuration — identical for every comparable shot.
  const VIEWPORT = { width: 1600, height: 900 };
  const MINUTE_OF_DAY = 13 * 60; // 1:00 PM — mid-afternoon, sun well above the horizon

  // The eight required baseline views, plus two that document specific current
  // weaknesses (the floor dirt read, and the back-of-room delivery clutter).
  // at/look are LOCAL metres: +x = toward the lounge end, +z = toward the entrance.
  const SHOTS = [
    { id: '01-entrance-looking-inward', at: [-0.8, 4.6], look: [-0.8, -3.0], pitch: -0.03,
      note: 'Standing just inside the entrance doors, facing the length of the room.' },
    { id: '02-wide-room-overview', at: [-7.0, 3.6], look: [4.0, -2.2], pitch: -0.05,
      note: 'South-west corner diagonal — the widest honest read of the whole floor.' },
    { id: '03-checkout-focal-view', at: [0.0, 4.2], look: [0.0, 0.8], pitch: -0.04,
      note: 'Customer side of the counter, the checkout as a focal point.' },
    { id: '04-checkout-interaction-view', at: [0.0, 0.2], look: [0.0, 3.4], pitch: -0.16,
      note: 'Staff side, the working checkout framing the player actually uses.' },
    { id: '05-laptop-workstation', at: [0.9, 0.1], look: [0.95, 2.4], pitch: -0.30,
      note: 'The laptop station on the back-of-counter run.' },
    { id: '06-main-merchandise-wall', at: [-3.2, 1.4], look: [-3.6, -4.4], pitch: -0.02,
      note: 'The main merchandise wall on the far side of the room.' },
    { id: '07-cleaning-route', at: [-7.4, 4.1], look: [3.6, 3.0], pitch: -0.30,
      note: 'Along the debris strip the starter cleaning task runs down.' },
    { id: '08-customer-route', at: [-0.8, 5.0], look: [0.2, 1.6], pitch: -0.10,
      note: 'The path a customer walks from the door to the counter.' },
    // Open merchandise-side floor, pitched down so the boards fill most of the frame
    // and the "Shop condition — filthy" badge stays legible top-right. An earlier pose
    // stood beside the counter, which then occupied most of the image and left the
    // floor as a corner detail — useless as evidence about how dirt reads.
    { id: '09-floor-dirt-read', at: [-4.0, -1.0], look: [-8.0, -1.0], pitch: -0.66,
      note: 'Extra: floor grime at working distance — the primary evidence for how the '
        + 'neglected state actually reads. Grid cell (-4.13, 0.69) is 0.927 dirty here.' },
    { id: '10-back-of-room-clutter', at: [4.6, 1.2], look: [7.6, 3.4], pitch: -0.12,
      note: 'Extra: the delivery/back-of-room corner, currently the weakest composition.' },
  ];

  // --- boot a FRESH neglected starter --------------------------------------------------
  await page.setViewportSize(VIEWPORT);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const tNewGame = Date.now();
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  const tWalkActive = Date.now();
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  const tVeilClear = Date.now();
  await page.waitForTimeout(2500); // shader prewarm + AO history settle

  // Move inside and freeze the world. Pausing the clock is what makes two capture
  // runs comparable: unpaused, ~8 game-minutes pass per real second and the ten
  // shots drift across more than an hour of lighting.
  await page.evaluate((minuteOfDay) => {
    const app = window.__fw;
    const s3 = app.scene3d;
    const ch = s3.clubhouse();
    const o = ch.interior.position;
    const w = s3.walk;
    w.clearKeys();
    w.state.x = o.x; w.state.z = o.z + 3.0; w.state.yaw = 0; w.state.pitch = 0;
    app.speedIdx = 0; // paused
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + minuteOfDay;
    s3.applyTimeWeather(minuteOfDay, app.state.weather);
  }, MINUTE_OF_DAY);

  // Let the arrival objective toasts expire so they do not sit over different shots.
  await page.waitForTimeout(14000);

  // --- environment record ---------------------------------------------------------------
  const env = await page.evaluate(() => {
    const app = window.__fw;
    const s3 = app.scene3d;
    const ch = s3.clubhouse();
    const r = s3.renderer;
    const gl = r.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const S = (fn) => { try { return fn(); } catch (e) { return `ERR:${e.message}`; } };
    return {
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'masked',
      devicePixelRatio: window.devicePixelRatio,
      canvas: { width: r.domElement.width, height: r.domElement.height },
      rendererPixelRatio: r.getPixelRatio(),
      camera: { fov: s3.camera.fov, near: s3.camera.near, far: s3.camera.far, aspect: s3.camera.aspect },
      walkFov: s3.walk.state.fov,
      eyeHeight: s3.walk.state.eye,
      toneMapping: r.toneMapping,
      toneMappingExposure: r.toneMappingExposure,
      outputColorSpace: r.outputColorSpace,
      shadowMap: { enabled: r.shadowMap.enabled, type: r.shadowMap.type },
      post: { gtao: !!s3.post.gtao?.enabled, bloom: !!s3.post.bloom?.enabled },
      interiorPosition: { x: ch.interior.position.x, y: ch.interior.position.y, z: ch.interior.position.z },
      interiorRotationY: ch.interior.rotation.y,
      doorWorld: S(() => ch.doorWorld),
      laptopPose: S(() => ch.laptopPose()),
      clock: { minutes: app.state.clock.minutes, minuteOfDay: app.state.clock.minutes % 1440 },
      weather: app.state.weather,
      speedIdx: app.speedIdx,
      propertyId: S(() => app.state.property?.id),
      shopCondition: S(() => ch.condition && ch.condition()),
      neglect: S(() => ({
        grimeCells: app.state.shop.reno.grime.length,
        grimeMean: +(app.state.shop.reno.grime.reduce((a, v) => a + v, 0)
          / app.state.shop.reno.grime.length).toFixed(4),
        debrisCount: ch.debrisCount(),
        debrisTotal: +ch.debrisTotal().toFixed(3),
        clutterPiles: app.state.shop.reno.clutter.length,
        clutterCleared: app.state.shop.reno.clutter.filter((p) => p.cleared).length,
        windows: app.state.shop.reno.windows,
        architectureRestored: Object.fromEntries(
          Object.entries(app.state.shop.reno.architecture.components).map(([k, v]) => [k, v.restored]),
        ),
      })),
      roomFootprintLocal: (() => {
        const o = ch.interior.position;
        let minX = null; let maxX = null; let minZ = null; let maxZ = null;
        for (let x = -14; x <= 14; x += 0.5) {
          for (let z = -10; z <= 10; z += 0.5) {
            if (!ch.isInside(o.x + x, o.z + z)) continue;
            if (minX === null || x < minX) minX = x;
            if (maxX === null || x > maxX) maxX = x;
            if (minZ === null || z < minZ) minZ = z;
            if (maxZ === null || z > maxZ) maxZ = z;
          }
        }
        return { minX, maxX, minZ, maxZ, widthX: maxX - minX, depthZ: maxZ - minZ };
      })(),
      sceneCounts: (() => {
        let objects = 0; let meshes = 0; let visibleMeshes = 0; let lights = 0;
        s3.scene.traverse((o) => {
          objects++;
          if (o.isMesh) { meshes++; if (o.visible) visibleMeshes++; }
          if (o.isLight) lights++;
        });
        return { objects, meshes, visibleMeshes, lights };
      })(),
    };
  });

  // --- shoot ------------------------------------------------------------------------------
  const captured = [];
  for (const shot of SHOTS) {
    const pose = await page.evaluate(({ s, minuteOfDay }) => {
      const app = window.__fw;
      const s3 = app.scene3d;
      const ch = s3.clubhouse();
      const o = ch.interior.position;
      const w = s3.walk;
      w.clearKeys();
      // Re-pin the clock before every frame: even paused, a stray tick would
      // change the sun between the first and last shot.
      const c = app.state.clock;
      c.minutes = Math.floor(c.minutes / 1440) * 1440 + minuteOfDay;
      s3.applyTimeWeather(minuteOfDay, app.state.weather);
      const ax = o.x + s.at[0];
      const az = o.z + s.at[1];
      const tx = o.x + s.look[0];
      const tz = o.z + s.look[1];
      const dx = tx - ax;
      const dz = tz - az;
      const d = Math.hypot(dx, dz) || 1;
      w.state.x = ax;
      w.state.z = az;
      w.state.yaw = Math.atan2(-dx / d, -dz / d); // forward = (-sin yaw, -cos yaw)
      w.state.pitch = s.pitch;
      return {
        localAt: s.at,
        localLook: s.look,
        world: { x: ax, y: o.y + w.state.eye, z: az },
        yaw: w.state.yaw,
        pitch: w.state.pitch,
        eye: w.state.eye,
        fov: w.state.fov,
        insideRoom: ch.isInside(ax, az),
      };
    }, { s: shot, minuteOfDay: MINUTE_OF_DAY });

    await page.waitForTimeout(750); // let culling, shadows and AO settle at the new pose
    const file = `${shot.id}.png`;
    await page.screenshot({ path: path.join(out, file) });
    captured.push({ id: shot.id, file, note: shot.note, ...pose });
  }

  // --- per-frame render cost at the wide-overview pose -------------------------------------
  // renderer.info resets on every render() and the composer runs several passes per
  // frame, so a naive read returns the last fullscreen quad. Freeze it, run one frame.
  const renderStats = await page.evaluate(() => new Promise((resolve) => {
    const s3 = window.__fw.scene3d;
    const r = s3.renderer;
    r.info.autoReset = false;
    r.info.reset();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const calls = r.info.render.calls;
      const drawnTris = r.info.render.triangles;
      r.info.autoReset = true;
      let sceneTris = 0; let meshes = 0;
      const mats = new Set(); const texs = new Set();
      s3.scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        meshes++;
        const g = o.geometry;
        const n = g && g.index ? g.index.count / 3
          : (g && g.attributes.position ? g.attributes.position.count / 3 : 0);
        sceneTris += n * (o.isInstancedMesh ? o.count : 1);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if (!m) return;
          mats.add(m.uuid);
          ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach((k) => {
            if (m[k]) texs.add(m[k].uuid);
          });
        });
      });
      resolve({
        drawCallsPerFrame: calls,
        trianglesDrawnPerFrame: drawnTris,
        visibleMeshes: meshes,
        visibleSceneTriangles: Math.round(sceneTris),
        uniqueMaterials: mats.size,
        uniqueTextures: texs.size,
        geometriesInMemory: r.info.memory.geometries,
        texturesInMemory: r.info.memory.textures,
        programs: r.info.programs ? r.info.programs.length : null,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      });
    }));
  }));

  const report = {
    capturedAtNote: 'Timestamps are deliberately omitted so re-runs diff cleanly.',
    viewport: VIEWPORT,
    minuteOfDay: MINUTE_OF_DAY,
    loadTimings: {
      newGameClickToWalkActiveMs: tWalkActive - tNewGame,
      newGameClickToVeilClearMs: tVeilClear - tNewGame,
    },
    env,
    renderStats,
    shots: captured,
  };
  fs.writeFileSync(path.join(dataOut, 'baseline-capture.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

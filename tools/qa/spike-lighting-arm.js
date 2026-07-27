async (page) => {
  // THROWAWAY SPIKE HARNESS — interior lighting experiment. Not production work.
  //
  //   ARM=0 HEADED=1 node tools/qa/run-playwright.cjs tools/qa/spike-lighting-arm.js
  //
  // Shoots the ten BASELINE_CAMERA_TRANSFORMS poses and measures three perf scenarios,
  // for one lighting arm, into Designs/ProShop/Spike/lighting/arm<N>/.
  //
  // Unlike the Phase 0 capture this boots from a FIXED SEED. The menu's New Game path
  // seeds with Math.random() (main.js:2829), which re-rolls the golf course and therefore
  // everything visible through the windows — useless when four arms must be diffed frame
  // against frame. newStarterEmpire(mode, seed) is the same call the menu makes, so the
  // starting state is identical in every other respect.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const ARM = String(process.env.ARM ?? '0');
  const out = path.join(repo, 'Designs', 'ProShop', 'Spike', 'lighting', `arm${ARM}`);
  fs.mkdirSync(out, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.SPIKE_SEED || 20260727);
  const MINUTE_OF_DAY = 13 * 60;
  const RUNS = Number(process.env.SPIKE_PERF_RUNS || 2);

  // Exactly the poses in Designs/ProShop/Baseline/BASELINE_CAMERA_TRANSFORMS.md
  const SHOTS = [
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

  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const seeded = await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
    return { seed, activeId: empire.activeId };
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const tStart = Date.now();
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  const tVeil = Date.now();
  await page.waitForTimeout(3000);

  await page.evaluate((m) => {
    const app = window.__fw; const s3 = app.scene3d;
    const o = s3.clubhouse().interior.position; const w = s3.walk; w.clearKeys();
    w.state.x = o.x; w.state.z = o.z + 3; w.state.yaw = 0; w.state.pitch = 0;
    app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + m;
    s3.applyTimeWeather(m, app.state.weather);
  }, MINUTE_OF_DAY);
  await page.waitForTimeout(13000); // let arrival toasts expire

  const env = await page.evaluate(() => {
    const app = window.__fw; const s3 = app.scene3d; const r = s3.renderer;
    const gl = r.getContext(); const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const S = (fn) => { try { return fn(); } catch (e) { return `ERR:${e.message}`; } };
    let interiorCasters = 0; let interiorReceivers = 0; let interiorMeshes = 0;
    s3.clubhouse().interior.traverse((o) => {
      if (!o.isMesh) return;
      interiorMeshes++;
      if (o.castShadow) interiorCasters++;
      if (o.receiveShadow) interiorReceivers++;
    });
    const lights = [];
    s3.scene.traverse((o) => { if (o.isLight) lights.push({ type: o.type, name: o.name || '', intensity: +Number(o.intensity).toFixed(3), castShadow: !!o.castShadow }); });
    return {
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'masked',
      fov: s3.camera.fov, walkFov: s3.walk.state.fov,
      shadowMapType: r.shadowMap.type, shadowMapEnabled: r.shadowMap.enabled,
      sunShadowRadius: S(() => s3.post.sun.shadow.radius),
      sunShadowMapSize: S(() => `${s3.post.sun.shadow.mapSize.x}x${s3.post.sun.shadow.mapSize.y}`),
      toneMapping: r.toneMapping, exposure: r.toneMappingExposure,
      gtao: !!s3.post.gtao?.enabled, bloom: !!s3.post.bloom?.enabled,
      // Prove the GTAO arm actually took effect rather than assuming the source edit
      // reached the running pass. NOTE: GTAOPass has no `radius` property — it lives in
      // gtaoMaterial.uniforms.radius, which is why main.js:196's `gtao.radius = 0.7` is
      // inert and the real radius is whatever updateGtaoMaterial set at construction.
      gtaoParams: S(() => {
        const g = s3.post.gtao;
        const u = g.gtaoMaterial?.uniforms || {};
        return {
          blendIntensity: g.blendIntensity,
          uniformRadius: u.radius?.value ?? null,
          uniformSamples: u.samples?.value ?? null,
          strayRadiusProp: g.radius ?? null,
          renderTarget: g.gtaoRenderTarget ? `${g.gtaoRenderTarget.width}x${g.gtaoRenderTarget.height}` : null,
          pdRadius: g.pdMaterial?.uniforms?.radius?.value ?? null,
        };
      }),
      interiorMeshes, interiorCasters, interiorReceivers,
      lightCount: lights.length,
      lights: lights.slice(0, 40),
      propertyId: S(() => app.state.property?.id),
      condition: S(() => s3.clubhouse().condition()),
      grimeSum: S(() => +app.state.shop.reno.grime.reduce((a, v) => a + v, 0).toFixed(3)),
      interiorY: S(() => +s3.clubhouse().interior.position.y.toFixed(4)),
    };
  });

  // ---- shoot ------------------------------------------------------------------------
  const shots = [];
  for (const s of SHOTS) {
    const pose = await page.evaluate(({ shot, m }) => {
      const app = window.__fw; const s3 = app.scene3d; const ch = s3.clubhouse();
      // Hide live customers for the frame. They wander, and an NPC standing in shot 02
      // produced a 4.2 meanAbs / 9% pixel delta between two arms that were otherwise
      // pixel-identical — noise that would swamp the lighting signal this spike measures.
      // Presentation-only and capture-local; the sim keeps running untouched.
      const cs = typeof ch.customers === 'function' ? ch.customers() : ch.customers;
      if (Array.isArray(cs)) cs.forEach((c) => { if (c && c.mesh) c.mesh.visible = false; });
      // Doors must be in the SAME state in every arm. A customer walking the entrance
      // leaves them swinging, and shot 04's whole delta in the first pass turned out to
      // be an open door rather than lighting.
      const doors = ch.doors || ch.doorApi?.doors || null;
      if (Array.isArray(doors)) {
        doors.forEach((d) => { if (d) { d.open = false; d.swingTarget = 0; d.angle = 0; } });
      }
      // Objective/notification toasts appear on their own schedule and are pure HUD.
      const nc = document.querySelector('.notification-center');
      if (nc) nc.style.display = 'none';
      const o = ch.interior.position; const w = s3.walk; w.clearKeys();
      const c = app.state.clock;
      c.minutes = Math.floor(c.minutes / 1440) * 1440 + m;
      s3.applyTimeWeather(m, app.state.weather);
      const ax = o.x + shot.at[0]; const az = o.z + shot.at[1];
      const dx = (o.x + shot.look[0]) - ax; const dz = (o.z + shot.look[1]) - az;
      const d = Math.hypot(dx, dz) || 1;
      w.state.x = ax; w.state.z = az;
      w.state.yaw = Math.atan2(-dx / d, -dz / d);
      w.state.pitch = shot.pitch;
      // Required by the spike brief: the lens must be the walk lens for every frame.
      return {
        fovOk: s3.camera.fov === w.state.fov,
        cameraFov: s3.camera.fov, walkFov: w.state.fov, yaw: w.state.yaw,
        doorAngles: Array.isArray(doors) ? doors.map((d) => +Number(d?.angle || 0).toFixed(4)) : null,
        toastsHidden: !!nc,
      };
    }, { shot: s, m: MINUTE_OF_DAY });
    await page.waitForTimeout(750);
    await page.screenshot({ path: path.join(out, `${s.id}.png`) });
    shots.push({ id: s.id, ...s, ...pose });
  }

  // ---- perf -------------------------------------------------------------------------
  await page.evaluate(() => {
    window.__spin = { on: false, speed: 2.4 };
    const drive = () => {
      if (window.__spin.on && window.__fw?.scene3d?.walk) window.__fw.scene3d.walk.state.yaw += window.__spin.speed / 60;
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
    window.__startSample = () => {
      window.__samp = { d: [], last: performance.now(), on: true };
      const loop = (t) => { const s = window.__samp; if (!s || !s.on) return; s.d.push(t - s.last); s.last = t; requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    };
    window.__stopSample = () => {
      const s = window.__samp; s.on = false;
      const d = s.d.slice(5).sort((a, b) => a - b);
      const avg = d.reduce((a, v) => a + v, 0) / Math.max(1, d.length);
      const worstN = Math.max(1, Math.round(d.length * 0.01));
      const p1 = d.slice(-worstN).reduce((a, v) => a + v, 0) / worstN;
      const info = window.__fw.scene3d.renderer.info;
      return {
        frames: d.length,
        avgMs: +avg.toFixed(2), p1Ms: +p1.toFixed(2), worstMs: +d[d.length - 1].toFixed(1),
        avgFps: +(1000 / avg).toFixed(1), low1Fps: +(1000 / p1).toFixed(1),
        over33: d.filter((v) => v > 33.3).length,
        drawCalls: info.render.calls, triangles: info.render.triangles,
      };
    };
  });
  const place = async (lx, lz, yaw, pitch) => {
    await page.evaluate(({ lx, lz, yaw, pitch, m }) => {
      const app = window.__fw; const s3 = app.scene3d;
      const o = s3.clubhouse().interior.position; const w = s3.walk; w.clearKeys();
      w.state.x = o.x + lx; w.state.z = o.z + lz; w.state.yaw = yaw; w.state.pitch = pitch;
      app.speedIdx = 0;
      const c = app.state.clock;
      c.minutes = Math.floor(c.minutes / 1440) * 1440 + m;
      s3.applyTimeWeather(m, app.state.weather);
    }, { lx, lz, yaw, pitch, m: MINUTE_OF_DAY });
    await page.waitForTimeout(650);
  };
  const runs = [];
  const sample = async (name, seconds, spin) => {
    await page.evaluate((on) => { window.__spin.on = on; }, spin);
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__startSample());
    await page.waitForTimeout(seconds * 1000);
    const r = await page.evaluate(() => window.__stopSample());
    await page.evaluate(() => { window.__spin.on = false; });
    runs.push({ name, ...r });
  };
  for (let i = 0; i < RUNS; i++) {
    await place(-2.0, 1.0, 0, -0.05); await sample(`run${i + 1}/idle-interior`, 6, false);
    await place(-2.0, 1.0, 0, -0.05); await sample(`run${i + 1}/spin-interior`, 8, true);
    await place(-0.8, 4.6, 0, -0.03); await sample(`run${i + 1}/entrance-sightline`, 6, false);
  }
  const byScenario = {};
  for (const r of runs) { const k = r.name.split('/')[1]; (byScenario[k] ||= []).push(r); }
  const summary = Object.entries(byScenario).map(([scenario, rs]) => {
    const mean = (k) => +(rs.reduce((a, v) => a + v[k], 0) / rs.length).toFixed(2);
    return {
      scenario, runs: rs.length,
      avgMs: mean('avgMs'), p1Ms: mean('p1Ms'),
      avgFps: mean('avgFps'), low1Fps: mean('low1Fps'),
      worstMsMax: Math.max(...rs.map((v) => v.worstMs)),
      over33Total: rs.reduce((a, v) => a + v.over33, 0),
      drawCalls: rs[rs.length - 1].drawCalls,
    };
  });

  const report = {
    arm: ARM, seed: seeded, env,
    loadVeilMs: tVeil - tStart,
    fovAssertAllShots: shots.every((s) => s.fovOk),
    shots, summary, runs, errs: errs.slice(0, 8),
  };
  fs.writeFileSync(path.join(out, 'arm.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { ok: report.fovAssertAllShots, arm: ARM, env, summary, loadVeilMs: report.loadVeilMs, errs: report.errs };
}

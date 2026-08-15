// A — WHERE THE FRAME TIME ACTUALLY GOES, in Electron, in the shipping room.
//
// The existing perf-probe.js measures headed Chrome on the willow-creek bootstrap
// with the clock PAUSED. Three things are wrong with that for this brief: the
// product is Electron, the room is pine-hills-v2, and a paused world has no NPCs
// in it. "Laggy and glitchy" is a complaint about the live game, so the probe has
// to run the live game: shop open, speedIdx 1, customers walking.
//
// WHAT IT MEASURES, and how the pieces fit:
//
//   rAF delta          the only number the player feels. Everything else exists to
//                      explain it.
//   jsMs               wall time inside our own code that frame, from the wrappers
//                      below. Sums the phases; does NOT include compositing, swap,
//                      or GPU work that finishes after the JS returns.
//   phases             scene3d.render (broken into composer / direct / rig passes),
//                      walk.update, applyTimeWeather, clubhouse.update, and the
//                      residual — everything in main.js's frame() that is not one
//                      of those.
//   frameMs - jsMs     the gap. A big gap with small phases means GPU- or
//                      present-bound; a small gap means CPU-bound in our code.
//                      This distinction decides which optimisations can possibly
//                      help, so it is measured rather than assumed.
//
// THE INSTRUMENT'S NEGATIVE CONTROL (rule: every instrument gets one). The
// `control-2x-pixels` leg quadruples the fragment load by raising the renderer's
// pixel ratio. If the probe cannot see THAT get worse, the probe is not measuring
// the frame and none of its other numbers mean anything. It is asserted, not
// merely recorded — `controlCostsMore` is the gate.
//
// Env:
//   PERF_LABEL=before|after   names the output file (default 'run')
//   PERF_SECONDS=6            per-pose sample length
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const LABEL = process.env.PERF_LABEL || 'run';
  const SECS = Number(process.env.PERF_SECONDS || 6);
  const OUT = path.resolve('qa/electron/frame-profile');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000); // shader prewarm done, AO history settled

  // ---- the world the numbers are about -------------------------------------------------
  const world = await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;                                    // NPCs at 1x, not paused
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;  // shop OPEN
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60; // 1 PM, same every run
    const ch = app.scene3d.clubhouse();
    const o = ch.interior.position;
    return {
      variant: ch.variant || null,
      interior: { x: o.x, y: o.y, z: o.z },
      speedIdx: app.speedIdx,
      open: !!app.state.shop?.signOpen,
      dpr: window.devicePixelRatio,
      pixelRatio: app.scene3d.renderer.getPixelRatio(),
    };
  });

  // ---- the instrument ------------------------------------------------------------------
  await page.evaluate(() => {
    const app = window.__fw;
    const s3 = app.scene3d;
    if (window.__perf) return;
    const P = {
      on: false, rows: [], phase: null,
      acc: {}, calls: {}, lastBakes: 0,
    };
    window.__perf = P;
    const bump = (k, ms) => { P.acc[k] = (P.acc[k] || 0) + ms; P.calls[k] = (P.calls[k] || 0) + 1; };
    const wrap = (obj, key, name) => {
      const orig = obj[key];
      if (typeof orig !== 'function' || orig.__perfWrapped) return;
      const next = function wrapped(...a) {
        if (!P.on) return orig.apply(this, a);
        const t = performance.now();
        try { return orig.apply(this, a); } finally { bump(name, performance.now() - t); }
      };
      next.__perfWrapped = true;
      try { obj[key] = next; } catch { /* frozen — skip, and it will read as residual */ }
    };
    // scene3d is a plain object literal, so these are writable.
    wrap(s3, 'render', 'scene3d.render');
    wrap(s3, 'applyTimeWeather', 'applyTimeWeather');
    wrap(s3.walk, 'update', 'walk.update');
    wrap(s3.post.composer, 'render', 'composer.render');
    wrap(s3.renderer, 'render', 'renderer.render');       // rig passes + composer's inner calls
    wrap(s3.renderer.shadowMap, 'render', 'shadowMap.render');
    const ch = s3.clubhouse();
    if (ch) wrap(ch, 'update', 'clubhouse.update');

    P.start = () => {
      const stats = s3.post.stats;
      P.on = true; P.rows = []; P.acc = {}; P.calls = {};
      P.lastBakes = stats ? stats().shadowBakes : 0;
      let last = performance.now();
      const loop = (t) => {
        if (!P.on) return;
        const b = stats ? stats().shadowBakes : 0;
        const info = s3.renderer.info;
        P.rows.push({
          ms: t - last,
          bake: b !== P.lastBakes,
          js: Object.entries(P.acc).reduce((a, [k, v]) => (k === 'scene3d.render' ? a + v : a), 0),
          acc: P.acc,
          calls: P.calls,
          draws: info.render.calls,
          tris: info.render.triangles,
        });
        P.lastBakes = b;
        P.acc = {}; P.calls = {};
        last = t;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };
    P.stop = () => {
      P.on = false;
      const rows = P.rows.slice(6); // settling frames
      if (!rows.length) return null;
      const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
      const mean = (a) => a.reduce((x, v) => x + v, 0) / Math.max(1, a.length);
      const worstN = Math.max(1, Math.round(ms.length * 0.01));
      const p1 = mean(ms.slice(-worstN));
      const keys = new Set();
      for (const r of rows) for (const k of Object.keys(r.acc)) keys.add(k);
      const phases = {};
      for (const k of keys) phases[k] = Math.round(mean(rows.map((r) => r.acc[k] || 0)) * 1000) / 1000;
      const callsPerFrame = {};
      for (const k of keys) callsPerFrame[k] = Math.round(mean(rows.map((r) => r.calls[k] || 0)) * 10) / 10;
      const avgMs = mean(ms);
      const bakeRows = rows.filter((r) => r.bake);
      const plainRows = rows.filter((r) => !r.bake);
      const jsMs = phases['scene3d.render'] || 0;
      return {
        frames: ms.length,
        avgFps: Math.round((1000 / avgMs) * 10) / 10,
        low1Fps: Math.round((1000 / p1) * 10) / 10,
        avgMs: Math.round(avgMs * 100) / 100,
        p1Ms: Math.round(p1 * 100) / 100,
        worstMs: Math.round(ms[ms.length - 1] * 10) / 10,
        medianMs: Math.round(ms[Math.floor(ms.length / 2)] * 100) / 100,
        bakeAvgMs: Math.round(mean(bakeRows.map((r) => r.ms)) * 100) / 100,
        plainAvgMs: Math.round(mean(plainRows.map((r) => r.ms)) * 100) / 100,
        bakeShare: Math.round((bakeRows.length / rows.length) * 1000) / 1000,
        // sceneRenderMs is our whole render call; gapMs is everything the frame
        // spent that our code did not: present, compositing, GPU catch-up, and
        // whatever else main.js's frame() does that we did not wrap.
        sceneRenderMs: Math.round(jsMs * 100) / 100,
        gapMs: Math.round((avgMs - jsMs) * 100) / 100,
        phases,
        callsPerFrame,
        draws: Math.round(mean(rows.map((r) => r.draws))),
        tris: Math.round(mean(rows.map((r) => r.tris))),
      };
    };
    // deterministic spin, so "fast movement" is the same movement every run
    window.__spin = { on: false, speed: 2.2 };
    const drive = () => {
      if (window.__spin.on && s3.walk) {
        s3.walk.state.yaw += window.__spin.speed / 60;
        s3.walk.state.pitch = -0.05;
      }
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
  });

  const { gateRenderer } = await import(
    `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/perf-renderer-gate.mjs`
  );
  const { gpu, software } = await gateRenderer(page);

  // ---- fixed poses ---------------------------------------------------------------------
  // Offsets from the interior origin so the same literal poses survive a layout
  // nudge; the resolved world coordinates are recorded in the output so a later
  // run can be checked against this one rather than trusted.
  const POSES = [
    { name: 'shop-desk-still', dx: -3.0, dz: 4.4, yaw: 2.35, pitch: -0.06, spin: false, move: false },
    { name: 'shop-floor-spin', dx: -5.6, dz: 2.4, yaw: 0.0, pitch: -0.05, spin: true, move: false },
    { name: 'shop-walk-spin', dx: -5.6, dz: 5.2, yaw: 1.2, pitch: -0.05, spin: true, move: true },
    { name: 'porch-outdoor-spin', dx: -2.0, dz: 14.0, yaw: 0.2, pitch: -0.03, spin: true, move: false },
    { name: 'fairway-run-spin', dx: -2.0, dz: 42.0, yaw: 0.2, pitch: -0.03, spin: true, move: true },
  ];

  const runs = [];
  async function sample(name, { dx, dz, yaw, pitch, spin, move, setup, teardown, seconds }) {
    const at = await page.evaluate(({ dx: ax, dz: az, yaw: ay, pitch: ap }) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk.state;
      w.x = o.x + ax; w.z = o.z + az; w.yaw = ay; w.pitch = ap;
      return { x: w.x, z: w.z, yaw: w.yaw, pitch: w.pitch };
    }, { dx, dz, yaw, pitch });
    if (setup) await page.evaluate(setup);
    await page.waitForTimeout(900); // let the pose establish (grass rebucket, LOD)
    if (move) await page.keyboard.down('w');
    await page.evaluate((on) => { window.__spin.on = on; }, !!spin);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__perf.start());
    await page.waitForTimeout((seconds || SECS) * 1000);
    const stats = await page.evaluate(() => window.__perf.stop());
    await page.evaluate(() => { window.__spin.on = false; });
    if (move) await page.keyboard.up('w');
    if (teardown) await page.evaluate(teardown);
    runs.push({ name, at, ...stats });
    return stats;
  }

  for (const p of POSES) await sample(p.name, p);

  // ---- the negative control ------------------------------------------------------------
  // Same pose as shop-floor-spin, four times the fragments. Must be slower.
  const basePose = POSES[1];
  const baseline = runs.find((r) => r.name === 'shop-floor-spin');
  const control = await sample('control-2x-pixels', {
    ...basePose,
    seconds: 4,
    setup: () => {
      const r = window.__fw.scene3d.renderer;
      window.__perfOldPR = r.getPixelRatio();
      r.setPixelRatio(window.__perfOldPR * 2);
      window.__fw.scene3d.resize();
    },
    teardown: () => {
      const r = window.__fw.scene3d.renderer;
      r.setPixelRatio(window.__perfOldPR);
      window.__fw.scene3d.resize();
    },
  });

  // ---- attribution A/B: turn one thing off at a time, same pose ------------------------
  const ab = [];
  async function abLeg(name, setup, teardown) {
    const s = await sample(name, { ...basePose, seconds: 4, setup, teardown });
    ab.push({
      name,
      avgMs: s.avgMs,
      savedMs: baseline ? Math.round((baseline.avgMs - s.avgMs) * 100) / 100 : null,
      avgFps: s.avgFps,
      low1Fps: s.low1Fps,
    });
  }
  await abLeg('AB-gtao-off',
    () => { window.__fw.scene3d.post.gtao.enabled = false; },
    () => { window.__fw.scene3d.post.gtao.enabled = true; });
  await abLeg('AB-bloom-off',
    () => { window.__fw.scene3d.post.bloom.enabled = false; },
    () => { window.__fw.scene3d.post.bloom.enabled = true; });
  await abLeg('AB-shadows-off',
    () => { window.__fw.scene3d.renderer.shadowMap.enabled = false; },
    () => { window.__fw.scene3d.renderer.shadowMap.enabled = true; });
  await abLeg('AB-post-off',
    () => { window.__fw.scene3d.post.gtao.enabled = false; window.__fw.scene3d.post.bloom.enabled = false; },
    () => { window.__fw.scene3d.post.gtao.enabled = true; window.__fw.scene3d.post.bloom.enabled = true; });
  await abLeg('AB-half-pixels',
    () => {
      const r = window.__fw.scene3d.renderer;
      window.__perfOldPR = r.getPixelRatio();
      r.setPixelRatio(window.__perfOldPR * 0.7);
      window.__fw.scene3d.resize();
    },
    () => {
      const r = window.__fw.scene3d.renderer;
      r.setPixelRatio(window.__perfOldPR);
      window.__fw.scene3d.resize();
    });

  // ---- CPU profile at the pose that hurts most -----------------------------------------
  const worst = runs.filter((r) => r.name.startsWith('shop') || r.name.startsWith('fairway') || r.name.startsWith('porch'))
    .sort((a, b) => b.avgMs - a.avgMs)[0];
  let topSelf = ['(profiler unavailable)'];
  let profileNote = null;
  try {
    const wp = POSES.find((p) => p.name === worst.name);
    await page.evaluate(({ dx, dz, yaw, pitch }) => {
      const o = window.__fw.scene3d.clubhouse().interior.position;
      const w = window.__fw.scene3d.walk.state;
      w.x = o.x + dx; w.z = o.z + dz; w.yaw = yaw; w.pitch = pitch;
    }, wp);
    if (wp.move) await page.keyboard.down('w');
    await page.evaluate((on) => { window.__spin.on = on; }, !!wp.spin);
    await page.waitForTimeout(800);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    await page.waitForTimeout(8000);
    const { profile } = await cdp.send('Profiler.stop');
    await page.evaluate(() => { window.__spin.on = false; });
    if (wp.move) await page.keyboard.up('w');
    const nodesById = new Map(profile.nodes.map((n) => [n.id, n]));
    const totalById = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const id = profile.samples[i];
      totalById.set(id, (totalById.get(id) || 0) + (profile.timeDeltas[i] || 0));
    }
    const selfTime = new Map();
    let wall = 0;
    for (const [id, us] of totalById) {
      const n = nodesById.get(id);
      if (!n) continue;
      wall += us;
      const f = n.callFrame;
      const key = `${f.functionName || '(anon)'} @ ${String(f.url).split('/').slice(-1)[0]}:${f.lineNumber + 1}`;
      selfTime.set(key, (selfTime.get(key) || 0) + us / 1000);
    }
    topSelf = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 26)
      .map(([k, ms]) => `${(ms / (wall / 1000) * 100).toFixed(1)}%  ${Math.round(ms)}ms  ${k}`);
    profileNote = `pose=${worst.name} wallMs=${Math.round(wall / 1000)}`;
  } catch (e) {
    profileNote = `profiler failed: ${String(e.message || e)}`;
  }

  // ---- scene census: what the frame is asked to walk ------------------------------------
  const census = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let objects = 0; let meshes = 0; let autoUpdate = 0; let skinned = 0;
    let clubhouseObjects = 0; let clubhouseAuto = 0;
    const ch = s3.clubhouse();
    const chRoot = ch?.group || ch?.interior?.parent || null;
    s3.scene.traverse((o) => {
      objects++;
      if (o.isMesh) meshes++;
      if (o.isSkinnedMesh) skinned++;
      if (o.matrixAutoUpdate) autoUpdate++;
    });
    if (chRoot) {
      chRoot.traverse((o) => { clubhouseObjects++; if (o.matrixAutoUpdate) clubhouseAuto++; });
    }
    return {
      objects, meshes, skinned, autoUpdate, clubhouseObjects, clubhouseAuto,
      geometries: s3.renderer.info.memory.geometries,
      textures: s3.renderer.info.memory.textures,
      programs: s3.renderer.info.programs?.length ?? null,
    };
  });

  const controlCostsMore = !!(baseline && control && control.avgMs > baseline.avgMs * 1.10);

  const out = {
    label: LABEL,
    gpu,
    softwareRenderer: software,
    world,
    census,
    runs,
    ab,
    topSelf,
    profileNote,
    checks: {
      // If quadrupling the pixels does not cost measurably more, this probe is not
      // watching the frame and nothing else here is evidence.
      controlCostsMore,
      controlAvgMs: control?.avgMs ?? null,
      baselineAvgMs: baseline?.avgMs ?? null,
      everyPoseSampled: runs.length === POSES.length + 1 + ab.length,
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = out.checks.controlCostsMore && out.checks.everyPoseSampled;
  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

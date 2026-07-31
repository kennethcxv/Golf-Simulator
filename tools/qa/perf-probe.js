async (page) => {
  // PERFORMANCE BASELINE — .agents/skills/performance-regression protocol.
  //
  // Fixed fixture (--bootstrap willow-creek, tutorial off), fixed 1600×900 viewport, fixed
  // camera routes, headed Chrome (HEADED=1) so the numbers come from the real GPU. Scenarios:
  //   idle-outdoors      standing still at the spawn framing
  //   spin-outdoors      holding W while the camera spins — the "fast movement" complaint
  //   spin-interior      the same spin inside the shop, among the fixtures and customers
  //   A/B toggles        the same spin with GTAO / bloom / DPR / shadow-refresh flipped,
  //                      one at a time — each isolates one hypothesis about the frame cost
  const errs = [];
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

  await page.goto(baseUrl);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 90000 });
  await page.waitForTimeout(3000); // warm-up: shader prewarm has run, AO history settled

  await page.evaluate(() => {
    // the spin driver — a steady, deterministic fast-look, same every run
    window.__spin = { on: false, speed: 2.4 };
    const drive = () => {
      if (window.__spin.on && window.__fw?.scene3d?.walk) {
        const w = window.__fw.scene3d.walk.state;
        w.yaw += window.__spin.speed / 60;
        w.pitch = Math.sin(performance.now() / 900) * 0.1;
      }
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
    // the frame sampler — each delta also notes whether that frame carried a shadow bake,
    // so spikes can be attributed instead of guessed at
    window.__startSample = () => {
      const stats = window.__fw.scene3d.post.stats;
      window.__samp = { deltas: [], bakes: [], last: performance.now(), lastBakes: stats ? stats().shadowBakes : 0, on: true };
      const loop = (t) => {
        const s = window.__samp;
        if (!s || !s.on) return;
        const b = stats ? stats().shadowBakes : 0;
        s.deltas.push(t - s.last);
        s.bakes.push(b !== s.lastBakes);
        s.lastBakes = b;
        s.last = t;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };
    window.__stopSample = () => {
      const s = window.__samp;
      s.on = false;
      const pairs = s.deltas.map((v, i) => [v, s.bakes[i]]).slice(5);
      const bakeFrames = pairs.filter((p) => p[1]).map((p) => p[0]);
      const plainFrames = pairs.filter((p) => !p[1]).map((p) => p[0]);
      const avgOf = (arr) => (arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : 0);
      const d = s.deltas.slice(5); // drop the settling frames
      d.sort((a, b) => a - b);
      const sum = d.reduce((a, v) => a + v, 0);
      const avg = sum / Math.max(1, d.length);
      const worstN = Math.max(1, Math.round(d.length * 0.01));
      const worstSlice = d.slice(-worstN);
      const p1 = worstSlice.reduce((a, v) => a + v, 0) / worstN;
      const info = window.__fw.scene3d.renderer.info;
      return {
        frames: d.length,
        avgFps: Math.round((1000 / avg) * 10) / 10,
        low1Fps: Math.round((1000 / p1) * 10) / 10,
        worstMs: Math.round(d[d.length - 1] * 10) / 10,
        avgMs: Math.round(avg * 100) / 100,
        bakeAvgMs: Math.round(avgOf(bakeFrames) * 100) / 100,
        plainAvgMs: Math.round(avgOf(plainFrames) * 100) / 100,
        bakeWorstMs: bakeFrames.length ? Math.round(Math.max(...bakeFrames) * 10) / 10 : 0,
        plainWorstMs: plainFrames.length ? Math.round(Math.max(...plainFrames) * 10) / 10 : 0,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs ? info.programs.length : null,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      };
    };
  });

  // Rule 5: a performance green must gate the renderer string, not just record
  // it. Software (SwiftShader) numbers refuse unless explicitly overridden.
  const { gateRenderer } = await import(
    `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/perf-renderer-gate.mjs`
  );
  const { gpu, software } = await gateRenderer(page);

  const runs = [];
  async function sample(name, seconds, { spin = false, move = false, setup = null, teardown = null } = {}) {
    // pin the world to the same moment for every scenario: 10 AM, clock frozen — otherwise
    // eight game-hours pass across the probe and the scenarios measure different courses
    await page.evaluate(() => {
      const app = window.__fw;
      app.speedIdx = 0;
      const st = app.state;
      st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 10 * 60;
    });
    if (setup) await page.evaluate(setup);
    if (move) await page.keyboard.down('w');
    await page.evaluate((on) => { window.__spin.on = on; }, spin);
    await page.waitForTimeout(600); // let the scenario establish before sampling
    await page.evaluate(() => window.__startSample());
    await page.waitForTimeout(seconds * 1000);
    const stats = await page.evaluate(() => window.__stopSample());
    await page.evaluate(() => { window.__spin.on = false; });
    if (move) await page.keyboard.up('w');
    if (teardown) await page.evaluate(teardown);
    runs.push({ name, ...stats });
  }

  // --- the fixed route --------------------------------------------------------------------
  await sample('idle-outdoors', 8);
  await sample('spin-outdoors', 10, { spin: true, move: true });

  // interior: park in the middle of the shop floor
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x + 6; w.z = o.z + 3; w.yaw = 1.2; w.pitch = -0.04;
  });
  await page.waitForTimeout(800);
  await sample('spin-interior', 8, { spin: true, move: false });

  // back outdoors for the A/B set — same spot, same spin
  await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    w.x = -2; w.z = 160; w.yaw = 0.2; w.pitch = -0.02;
  });
  await page.waitForTimeout(800);

  await sample('AB-gtao-off', 6, {
    spin: true,
    setup: () => { window.__fw.scene3d.post.gtao.enabled = false; },
    teardown: () => { window.__fw.scene3d.post.gtao.enabled = true; },
  });
  await sample('AB-bloom-off', 6, {
    spin: true,
    setup: () => { window.__fw.scene3d.post.bloom.enabled = false; },
    teardown: () => { window.__fw.scene3d.post.bloom.enabled = true; },
  });
  await sample('AB-gtao+bloom-off', 6, {
    spin: true,
    setup: () => { window.__fw.scene3d.post.gtao.enabled = false; window.__fw.scene3d.post.bloom.enabled = false; },
    teardown: () => { window.__fw.scene3d.post.gtao.enabled = true; window.__fw.scene3d.post.bloom.enabled = true; },
  });
  await sample('AB-shadow2048', 6, {
    spin: true,
    setup: () => {
      const sun = window.__fw.scene3d.post.sun;
      sun.shadow.mapSize.set(2048, 2048);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    },
    teardown: () => {
      const sun = window.__fw.scene3d.post.sun;
      sun.shadow.mapSize.set(4096, 4096);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    },
  });

  // the living-world worst case: clock RUNNING at 16× while sprint-spinning — hourly turf
  // ticks, golfer churn and autos all land inside the sample window, as in real play
  await page.evaluate(() => { window.__fw.speedIdx = 3; });
  await page.keyboard.down('w');
  await page.evaluate(() => { window.__spin.on = true; });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  await page.evaluate(() => window.__startSample());
  await page.waitForTimeout(10000);
  const liveStats = await page.evaluate(() => window.__stopSample());
  const { profile } = await cdp.send('Profiler.stop');
  await page.evaluate(() => { window.__spin.on = false; window.__fw.speedIdx = 1; });
  await page.keyboard.up('w');
  runs.push({ name: 'spin-speed16-live', ...liveStats });

  // digest the CPU profile: top self-time functions (game code and three.js alike)
  const selfTime = new Map();
  const nodesById = new Map(profile.nodes.map((n) => [n.id, n]));
  const totalById = new Map();
  if (profile.samples && profile.timeDeltas) {
    for (let i = 0; i < profile.samples.length; i++) {
      const id = profile.samples[i];
      const dt = profile.timeDeltas[i] || 0;
      totalById.set(id, (totalById.get(id) || 0) + dt);
    }
  }
  for (const [id, us] of totalById) {
    const n = nodesById.get(id);
    if (!n) continue;
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} @ ${String(f.url).split('/').slice(-1)[0]}:${f.lineNumber}`;
    selfTime.set(key, (selfTime.get(key) || 0) + us / 1000);
  }
  const topSelf = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
    .map(([k, ms]) => `${Math.round(ms)}ms  ${k}`);

  const dpr = await page.evaluate(() => window.devicePixelRatio);
  return { gpu, softwareRenderer: software, dpr, runs, topSelf, errs: errs.slice(0, 5) };
}

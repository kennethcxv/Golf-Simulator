async (page) => {
  // PERF NOISE FLOOR â€” how repeatable is the performance harness, actually?
  //
  //   NOISE_SESSION=s01 HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-perf-noise.js
  //
  // Phase 0 and the lighting spike both produced inter-arm deltas of 2-6%, and then the
  // SAME unchanged configuration measured 9.22ms and 10.96ms on two different sessions â€”
  // a 19% swing. Until that is understood, SLICE_BRIEF Â§13's "no regression greater than
  // 10%" rule cannot be enforced, because the instrument cannot see 10%.
  //
  // This runs one unchanged configuration repeatedly and records everything needed to
  // separate WITHIN-session variance (warm-up, GC, thermal) from BETWEEN-session variance
  // (shader cache, process start, machine state). Each invocation appends one JSON line,
  // so sessions accumulate into a single file.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outFile = path.resolve(process.env.NOISE_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Phase1', 'data', 'perf-noise.jsonl'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SESSION = String(process.env.NOISE_SESSION || 'unlabelled');
  const REPS = Number(process.env.NOISE_REPS || 3);
  const SECONDS = Number(process.env.NOISE_SECONDS || 10);
  const SEED = Number(process.env.SPIKE_SEED || 20260727);
  const PROFILE = process.env.QA_PERSISTENT_PROFILE ? 'persistent' : 'ephemeral';

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

  const tContinue = Date.now();
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  const tVeil = Date.now();

  // Settle: the veil lifting means prewarm returned, but AO/bloom history and the shadow
  // bake cadence take a moment more. This is the window a short settle would truncate.
  const SETTLE_MS = Number(process.env.NOISE_SETTLE_MS || 5000);
  await page.waitForTimeout(SETTLE_MS);

  await page.evaluate(({ m }) => {
    const app = window.__fw; const s3 = app.scene3d;
    const o = s3.clubhouse().interior.position; const w = s3.walk; w.clearKeys();
    w.state.x = o.x - 2.0; w.state.z = o.z + 1.0; w.state.yaw = 0; w.state.pitch = -0.05;
    app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + m;
    s3.applyTimeWeather(m, app.state.weather);
    const nc = document.querySelector('.notification-center');
    if (nc) nc.style.display = 'none';
    const ch = s3.clubhouse();
    const cs = typeof ch.customers === 'function' ? ch.customers() : ch.customers;
    if (Array.isArray(cs)) cs.forEach((c2) => { if (c2 && c2.mesh) c2.mesh.visible = false; });
  }, { m: 13 * 60 });
  await page.waitForTimeout(800);

  const gpu = await page.evaluate(() => {
    const gl = window.__fw.scene3d.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'masked';
  });

  await page.evaluate(() => {
    window.__startSample = () => {
      const s3 = window.__fw.scene3d;
      const stats = s3.post.stats;
      window.__samp = {
        d: [], last: performance.now(), on: true,
        heapStart: performance.memory ? performance.memory.usedJSHeapSize : null,
        bakesStart: stats ? stats().shadowBakes : null,
      };
      const loop = (t) => { const s = window.__samp; if (!s || !s.on) return; s.d.push(t - s.last); s.last = t; requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    };
    window.__stopSample = () => {
      const s = window.__samp; s.on = false;
      const stats = window.__fw.scene3d.post.stats;
      const d = s.d.slice(5).sort((a, b) => a - b);
      const n = d.length;
      const mean = d.reduce((a, v) => a + v, 0) / Math.max(1, n);
      const variance = d.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, n - 1);
      const worstN = Math.max(1, Math.round(n * 0.01));
      const p1 = d.slice(-worstN).reduce((a, v) => a + v, 0) / worstN;
      return {
        frames: n,
        avgMs: +mean.toFixed(3),
        sdMs: +Math.sqrt(variance).toFixed(3),
        medianMs: +d[Math.floor(n / 2)].toFixed(3),
        p1Ms: +p1.toFixed(3),
        worstMs: +d[n - 1].toFixed(2),
        over33: d.filter((v) => v > 33.3).length,
        heapStartMB: s.heapStart ? Math.round(s.heapStart / 1048576) : null,
        heapEndMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        shadowBakes: stats && s.bakesStart != null ? stats().shadowBakes - s.bakesStart : null,
      };
    };
  });

  const reps = [];
  for (let i = 0; i < REPS; i++) {
    await page.evaluate(() => window.__startSample());
    await page.waitForTimeout(SECONDS * 1000);
    const r = await page.evaluate(() => window.__stopSample());
    reps.push({ rep: i + 1, ...r });
    await page.waitForTimeout(500);
  }

  const record = {
    session: SESSION,
    profile: PROFILE,
    gpu,
    seed: SEED,
    settleMs: SETTLE_MS,
    sampleSeconds: SECONDS,
    continueToVeilMs: tVeil - tContinue,
    reps,
  };
  fs.appendFileSync(outFile, `${JSON.stringify(record)}\n`);
  return { ok: true, session: SESSION, profile: PROFILE, reps: reps.map((r) => ({ rep: r.rep, avgMs: r.avgMs, p1Ms: r.p1Ms, heapEndMB: r.heapEndMB })) };
}

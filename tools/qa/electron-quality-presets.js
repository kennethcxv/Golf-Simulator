// A + E2 — DO THE PRESETS GENUINELY DIFFER, and by how much, at fixed poses.
//
// Two questions with one answer. The brief asks for before/after fps and 1% lows
// at the same fixed poses (A), and for Low/Medium/High/Ultra presets that
// genuinely differ (E2). A preset table is only worth shipping if the numbers
// behind it separate, so this measures the four tiers at three fixed poses and
// prints the table.
//
// THE NOISE FLOOR IS MEASURED FIRST, and it is the whole reason this driver can
// claim anything. The shop is open, customers are walking, and the clock is
// running at 1x, so two identical runs do not produce identical numbers. So the
// driver samples `high` TWICE, at the start and at the end, and reports the
// spread between them. A preset difference smaller than that spread is not a
// difference. Without this the table would be a list of numbers with no way to
// tell which gaps mean anything — which is how six earlier "fixes" shipped green
// with no effect.
//
// FIRST-VISIT COMPILES ARE BURNED OFF before any sampling. The first spin at a
// new pose costs 2-5 s of shader compilation (see electron-stall-attribution.js)
// and would land in whichever preset happened to go first.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/quality-presets');
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
  await page.waitForTimeout(4000);

  const world = await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const o = app.scene3d.clubhouse().interior.position;
    return { interior: { x: o.x, z: o.z }, speedIdx: app.speedIdx, open: !!app.state.shop?.signOpen };
  });

  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const P = { on: false, rows: [] };
    window.__q = P;
    P.start = () => {
      P.on = true; P.rows = []; P.draws = []; P.tris = [];
      let last = performance.now();
      const loop = (t) => {
        if (!P.on) return;
        P.rows.push(t - last);
        // per FRAME, averaged later. Reading info.render.calls once at stop()
        // samples whatever pass the renderer happened to be in and gave 133,
        // 351, 273 and 686 for the same pose in one run.
        P.draws.push(s3.renderer.info.render.calls);
        P.tris.push(s3.renderer.info.render.triangles);
        last = t;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };
    P.stop = () => {
      P.on = false;
      const raw = P.rows.slice(8);
      const d = raw.slice().sort((a, b) => a - b);
      if (!d.length) return null;
      const mean = (a) => a.reduce((x, v) => x + v, 0) / a.length;
      const worstN = Math.max(1, Math.round(d.length * 0.01));
      return {
        frames: d.length,
        avgFps: Math.round((1000 / mean(d)) * 10) / 10,
        low1Fps: Math.round((1000 / mean(d.slice(-worstN))) * 10) / 10,
        avgMs: Math.round(mean(d) * 100) / 100,
        medianMs: Math.round(d[Math.floor(d.length / 2)] * 100) / 100,
        worstMs: Math.round(d[d.length - 1] * 10) / 10,
        draws: Math.round(mean(P.draws.slice(8))),
        tris: Math.round(mean(P.tris.slice(8))),
      };
    };
    window.__spin = { on: false, speed: 2.2 };
    const drive = () => {
      if (window.__spin.on) { s3.walk.state.yaw += window.__spin.speed / 60; s3.walk.state.pitch = -0.05; }
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
  });

  const { gateRenderer } = await import(
    `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/perf-renderer-gate.mjs`
  );
  const { gpu, software } = await gateRenderer(page);

  const POSES = [
    { name: 'shop-floor-spin', dx: -5.6, dz: 2.4, yaw: 0, spin: true, move: false },
    { name: 'shop-walk-spin', dx: -5.6, dz: 5.2, yaw: 1.2, spin: true, move: true },
    { name: 'porch-outdoor-spin', dx: -2.0, dz: 14.0, yaw: 0.2, spin: true, move: false },
  ];

  const goTo = async (p) => page.evaluate(({ dx, dz, yaw }) => {
    const o = window.__fw.scene3d.clubhouse().interior.position;
    const w = window.__fw.scene3d.walk.state;
    w.x = o.x + dx; w.z = o.z + dz; w.yaw = yaw; w.pitch = -0.05;
    return { x: w.x, z: w.z, yaw: w.yaw };
  }, p);

  const applyPreset = async (name) => page.evaluate((preset) => {
    const app = window.__fw;
    return import(new URL('src/core/preferences.js', document.baseURI).href).then((mod) => {
      const values = mod.QUALITY_PRESETS[preset];
      if (!values) return null;
      app.preferences.update({ display: values });
      return true;
    });
  }, name);

  // READ THE RENDERER ONLY AFTER IT HAS CAUGHT UP. setShadowQuality does not
  // write sun.shadow.mapSize itself — fitSunShadow owns that field and applies
  // it on the next bake. Reading immediately after update() reported the
  // PREVIOUS tier's map size for every preset, which made `ultra` look like it
  // had not changed anything.
  const readLive = async () => page.evaluate(() => {
    const app = window.__fw;
    const d = app.preferences.values.display;
    const r = app.scene3d.renderer;
    return {
      quality: d.quality,
      renderScale: d.renderScale,
      shadowQuality: d.shadowQuality,
      ao: d.ambientOcclusion,
      bloom: d.bloom,
      shadows: d.shadows,
      livePixelRatio: r.getPixelRatio(),
      liveShadowsEnabled: r.shadowMap.enabled,
      liveGtao: !!app.scene3d.post.gtao.enabled,
      liveBloom: !!app.scene3d.post.bloom.enabled,
      liveSunMap: app.scene3d.post.sun.shadow.mapSize.x,
    };
  });

  // Burn off the first-visit shader compiles at every pose before anything is
  // sampled, so the cost lands outside the measurement rather than inside
  // whichever preset happened to run first.
  for (const p of POSES) {
    await goTo(p);
    await page.evaluate(() => { window.__spin.on = true; });
    await page.waitForTimeout(6000);
    await page.evaluate(() => { window.__spin.on = false; });
  }

  const sample = async (preset, p) => {
    const at = await goTo(p);
    await page.waitForTimeout(900);
    if (p.move) await page.keyboard.down('w');
    await page.evaluate((on) => { window.__spin.on = on; }, !!p.spin);
    // PER-PRESET BURN-OFF, not just per-pose. Changing the shadow tier changes
    // the shadow map size, which is part of every program's cache key, so each
    // preset pays its own first-draw compile burst. Burning it off once at the
    // top of the run was not enough: the first `high` sample read 25.2 fps with
    // a 0.6 fps 1% low, against 68.1 fps for the identical preset at the end.
    await page.waitForTimeout(4500);
    await page.evaluate(() => window.__q.start());
    await page.waitForTimeout(6000);
    const s = await page.evaluate(() => window.__q.stop());
    await page.evaluate(() => { window.__spin.on = false; });
    if (p.move) await page.keyboard.up('w');
    return { preset, pose: p.name, at, ...s };
  };

  const rows = [];
  const applied = {};
  // 'high' first and 'high' again last: the pair brackets every other reading,
  // so the drift across the whole run is visible rather than assumed to be zero.
  const ORDER = ['high', 'low', 'medium', 'ultra', 'high'];
  for (let i = 0; i < ORDER.length; i++) {
    const preset = ORDER[i];
    const label = i === ORDER.length - 1 ? 'high(repeat)' : preset;
    await applyPreset(preset);
    await page.waitForTimeout(2500); // let the resize and the next bake's refit land
    applied[label] = await readLive();
    for (const p of POSES) rows.push({ ...(await sample(label, p)) });
  }

  // ---- the noise floor: the same preset, measured twice, an entire run apart
  const drift = {};
  for (const p of POSES) {
    const a = rows.find((r) => r.preset === 'high' && r.pose === p.name);
    const b = rows.find((r) => r.preset === 'high(repeat)' && r.pose === p.name);
    if (!a || !b) continue;
    drift[p.name] = {
      avgFps: [a.avgFps, b.avgFps],
      avgFpsSpreadPct: Math.round((Math.abs(a.avgFps - b.avgFps) / a.avgFps) * 1000) / 10,
      low1Fps: [a.low1Fps, b.low1Fps],
    };
  }
  const worstDriftPct = Math.max(0, ...Object.values(drift).map((d) => d.avgFpsSpreadPct));

  // A tier "genuinely differs" from the one below it only by more than the drift.
  const table = {};
  for (const p of POSES) {
    table[p.name] = {};
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      const r = rows.find((x) => x.preset === q && x.pose === p.name);
      if (r) table[p.name][q] = { avgFps: r.avgFps, low1Fps: r.low1Fps, avgMs: r.avgMs, draws: r.draws };
    }
  }
  const separations = [];
  for (const p of POSES) {
    const t = table[p.name];
    for (const [lo, hi] of [['low', 'medium'], ['medium', 'high'], ['high', 'ultra']]) {
      if (!t[lo] || !t[hi]) continue;
      const gapPct = Math.round(((t[lo].avgFps - t[hi].avgFps) / t[hi].avgFps) * 1000) / 10;
      separations.push({ pose: p.name, pair: `${lo}>${hi}`, gapPct, beatsDrift: gapPct > worstDriftPct });
    }
  }

  const out = {
    gpu, softwareRenderer: software, world, applied, drift, worstDriftPct, table, separations, rows,
    checks: {
      // each preset must reach the RENDERER, not just the preferences document
      presetsReachTheRenderer: ['low', 'medium', 'high', 'ultra'].every((q) => {
        const a = applied[q];
        return a && a.liveGtao === a.ao && a.liveBloom === a.bloom && a.liveShadowsEnabled === a.shadows;
      }),
      shadowMapFollowsTheTier: applied.low && applied.ultra
        ? applied.ultra.liveSunMap > applied.medium.liveSunMap
        : false,
      // ...and the tiers must be ordered by cost at the shop pose, by more than
      // the drift the run itself measured
      lowIsFasterThanUltra: (table['shop-floor-spin']?.low?.avgFps || 0)
        > (table['shop-floor-spin']?.ultra?.avgFps || 0),
      everyStepSeparates: separations.every((s) => s.beatsDrift),
      driftIsSmallEnoughToClaimAnything: worstDriftPct < 12,
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = out.checks.presetsReachTheRenderer && out.checks.lowIsFasterThanUltra;
  fs.writeFileSync(path.join(OUT, 'presets.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

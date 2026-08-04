async (page) => {
  // PRO-SHOP PHASE 0 BASELINE â€” performance of the starter clubhouse pro shop.
  //
  //   HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-performance.js
  //
  // Same sampling method as tools/qa/perf-probe.js (that harness measures the golf
  // course from a bootstrapped willow-creek save; this one measures the neglected
  // starter pro-shop interior, which is what the rebuild will regress against).
  // Fixed 1600x900, headed Chrome for the real GPU, clock pinned to 1:00 PM and the
  // sim paused so every scenario measures the same world.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const dataOut = path.resolve(process.env.BASELINE_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Baseline', 'data'));
  fs.mkdirSync(dataOut, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  // BASELINE_VARIANT boots the same seeded empire into a specific clubhouse
  // presentation (?clubhouse=<variant>) so the A/B rooms are measured by one
  // instrument in one session. Output is suffixed per variant so a rerun can
  // never clobber the Phase 0 evidence.
  const VARIANT = (process.env.BASELINE_VARIANT || '').trim();
  const bootUrl = VARIANT
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}clubhouse=${encodeURIComponent(VARIANT)}`
    : baseUrl;
  const MINUTE_OF_DAY = 13 * 60;
  const RUNS = Number(process.env.BASELINE_PERF_RUNS || 3);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(bootUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  // FIXED SEED. The menu's New Game path seeds with Math.random() (main.js:2829), so every
  // run generated a different golf course â€” different terrain, flora and golfer counts â€”
  // and the harness compared scenes rather than code. newStarterEmpire(mode, seed) is the
  // same call the menu makes, so the starting state is identical in every other respect.
  const SEED = Number(process.env.BASELINE_PERF_SEED || 20260727);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // --- load timing ------------------------------------------------------------------
  const tNewGame = Date.now();
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  const tWalkActive = Date.now();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  const tClubhouse = Date.now();
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  const tVeilClear = Date.now();
  // Rule 5: baselines cited against Phase 0 must come from real hardware.
  const { gateRenderer } = await import(
    `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/perf-renderer-gate.mjs`
  );
  const rendererGate = await gateRenderer(page);
  await page.waitForTimeout(3000); // shader prewarm done, AO history settled

  const gpu = await page.evaluate(() => {
    const gl = window.__fw.scene3d.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'masked';
  });

  // --- samplers ----------------------------------------------------------------------
  await page.evaluate(() => {
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

    window.__startSample = () => {
      const stats = window.__fw.scene3d.post.stats;
      window.__samp = { deltas: [], last: performance.now(), on: true, bakes: [], lastBakes: stats ? stats().shadowBakes : 0 };
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
      const d = s.deltas.slice(5); // drop settling frames
      const pairs = s.deltas.map((v, i) => [v, s.bakes[i]]).slice(5);
      const bakeFrames = pairs.filter((p) => p[1]).map((p) => p[0]);
      const avgOf = (a) => (a.length ? a.reduce((x, v) => x + v, 0) / a.length : 0);
      const sorted = [...d].sort((a, b) => a - b);
      const avg = avgOf(sorted);
      const worstN = Math.max(1, Math.round(sorted.length * 0.01));
      const p1 = avgOf(sorted.slice(-worstN));
      // A "stutter" is any frame over 33.3 ms â€” two missed frames at 60 Hz.
      const stutters = d.filter((v) => v > 33.3).length;
      const info = window.__fw.scene3d.renderer.info;
      return {
        frames: d.length,
        avgFps: Math.round((1000 / avg) * 10) / 10,
        low1Fps: Math.round((1000 / p1) * 10) / 10,
        avgMs: Math.round(avg * 100) / 100,
        p1Ms: Math.round(p1 * 100) / 100,
        worstMs: Math.round(sorted[sorted.length - 1] * 10) / 10,
        stutterFrames: stutters,
        stutterPct: Math.round((stutters / Math.max(1, d.length)) * 1000) / 10,
        shadowBakeAvgMs: Math.round(avgOf(bakeFrames) * 100) / 100,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs ? info.programs.length : null,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      };
    };
  });

  const place = async (lx, lz, yaw, pitch) => {
    await page.evaluate(({ lx, lz, yaw, pitch, minuteOfDay }) => {
      const app = window.__fw;
      const s3 = app.scene3d;
      const o = s3.clubhouse().interior.position;
      const w = s3.walk;
      w.clearKeys();
      w.state.x = o.x + lx; w.state.z = o.z + lz; w.state.yaw = yaw; w.state.pitch = pitch;
      app.speedIdx = 0;
      const c = app.state.clock;
      c.minutes = Math.floor(c.minutes / 1440) * 1440 + minuteOfDay;
      s3.applyTimeWeather(minuteOfDay, app.state.weather);
    }, { lx, lz, yaw, pitch, minuteOfDay: MINUTE_OF_DAY });
    await page.waitForTimeout(700);
  };

  const runs = [];
  let laptopEntry = { entered: false, focusLabel: null, from: null };
  const sample = async (name, seconds, opts = {}) => {
    const { spin = false, move = null, setup = null, teardown = null } = opts;
    if (setup) await setup();
    if (move) await page.keyboard.down(move);
    await page.evaluate((on) => { window.__spin.on = on; }, spin);
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__startSample());
    await page.waitForTimeout(seconds * 1000);
    const stats = await page.evaluate(() => window.__stopSample());
    await page.evaluate(() => { window.__spin.on = false; });
    if (move) await page.keyboard.up(move);
    if (teardown) await teardown();
    runs.push({ name, ...stats });
    return stats;
  };

  // --- the fixed route ----------------------------------------------------------------
  for (let r = 0; r < RUNS; r++) {
    // 1. standing still mid-room
    await place(-2.0, 1.0, 0, -0.05);
    await sample(`run${r + 1}/idle-interior`, 6);

    // 2. fast look â€” the "spin" worst case for culling and shadow refits
    await place(-2.0, 1.0, 0, -0.05);
    await sample(`run${r + 1}/spin-interior`, 8, { spin: true });

    // 3. walking the room with the camera turning
    await place(-6.0, 3.5, -Math.PI / 2, -0.05);
    await sample(`run${r + 1}/walk-spin-interior`, 8, { spin: true, move: 'w' });

    // 4. entrance sightline â€” the heaviest single framing (whole room in view)
    await place(-0.8, 4.6, 0, -0.03);
    await sample(`run${r + 1}/entrance-sightline`, 6);

    // 5. sweeping with the broom â€” cleaning feedback cost
    await sample(`run${r + 1}/broom-sweeping`, 8, {
      setup: async () => {
        await place(-5.6, 4.4, 0, -0.82);
        await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
        await page.waitForTimeout(1200);
        await page.mouse.click(800, 450);
        await page.mouse.down();
      },
      teardown: async () => {
        await page.mouse.up();
        await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
        await page.waitForTimeout(400);
      },
    });

    // 6. live world at 16x with customers arriving â€” the real worst case
    await sample(`run${r + 1}/live-speed16-customers`, 10, {
      spin: true,
      setup: async () => {
        await place(-2.0, 2.0, 0, -0.05);
        await page.evaluate(() => { window.__fw.speedIdx = 3; });
      },
      teardown: async () => { await page.evaluate(() => { window.__fw.speedIdx = 0; }); },
    });

    // 7. laptop mode â€” the 1024x640 DOM page is re-projected onto the live screen
    // quad every frame (main.js:2557), so this measures 3D + homography together.
    // `enterLaptop` is module-private in main.js, so the only route is the player's:
    // stand where the laptop prop takes focus and press the interact verb.
    //
    // THIS SCENARIO RUNS LAST ON PURPOSE. Leaving the laptop does not restore the
    // camera lens â€” it stays at LAPTOP_FOV 34 (see BASELINE_PERFORMANCE.md, observed
    // defect OBS-1), so any scenario measured after it would be framed at 34 deg
    // instead of the walk FOV 66 and would report a falsely cheap frame. The teardown
    // restores the lens explicitly so the next run starts clean.
    await sample(`run${r + 1}/laptop-open`, 6, {
      setup: async () => {
        laptopEntry = { entered: false, focusLabel: null, from: null };
        for (const spot of [[0.9, 0.9], [0.4, 1.0], [1.4, 1.0], [0.9, 0.4], [0.9, 1.4]]) {
          await place(spot[0], spot[1], Math.PI, -0.25); // face +z toward the worktop
          const label = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
          if (/laptop/i.test(label)) {
            laptopEntry.focusLabel = label;
            laptopEntry.from = spot;
            await page.evaluate(() => window.__fw.scene3d.walk.interact());
            await page.waitForTimeout(2400);
            laptopEntry.entered = await page.evaluate(() => window.__fw.view === 'laptop'
              || window.__fw.scene3d.clubhouse().laptopScreenMode() === 'live');
            break;
          }
        }
      },
      teardown: async () => {
        if (laptopEntry.entered) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(1400);
        }
        // Undo OBS-1 for the harness's own sake. This is a measurement fixture, not
        // a fix: the game itself still leaves the lens at 34 after the player exits.
        laptopEntry.fovAfterExit = await page.evaluate(() => window.__fw.scene3d.camera.fov);
        await page.evaluate(() => {
          const s3 = window.__fw.scene3d;
          s3.camera.fov = s3.walk.state.fov;
          s3.camera.updateProjectionMatrix();
        });
        await page.waitForTimeout(600);
      },
    });
  }

  // --- static scene cost --------------------------------------------------------------
  await place(-0.8, 4.6, 0, -0.03);
  const sceneStats = await page.evaluate(() => new Promise((resolve) => {
    const s3 = window.__fw.scene3d;
    const r = s3.renderer;
    r.info.autoReset = false;
    r.info.reset();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const calls = r.info.render.calls;
      const drawnTris = r.info.render.triangles;
      r.info.autoReset = true;
      let interiorObjects = 0; let interiorMeshes = 0; let visTris = 0; let visMeshes = 0;
      const mats = new Set(); const texs = new Set();
      const ch = s3.clubhouse();
      ch.interior.traverse((o) => { interiorObjects++; if (o.isMesh) interiorMeshes++; });
      s3.scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        visMeshes++;
        const g = o.geometry;
        const n = g && g.index ? g.index.count / 3 : (g && g.attributes.position ? g.attributes.position.count / 3 : 0);
        visTris += n * (o.isInstancedMesh ? o.count : 1);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if (!m) return;
          mats.add(m.uuid);
          ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach((k) => { if (m[k]) texs.add(m[k].uuid); });
        });
      });
      resolve({
        drawCallsPerFrame: calls,
        trianglesDrawnPerFrame: drawnTris,
        interiorSubtreeObjects: interiorObjects,
        interiorSubtreeMeshes: interiorMeshes,
        visibleMeshesWholeScene: visMeshes,
        visibleTrianglesWholeScene: Math.round(visTris),
        uniqueMaterials: mats.size,
        uniqueTextures: texs.size,
        geometriesInMemory: r.info.memory.geometries,
        texturesInMemory: r.info.memory.textures,
        programs: r.info.programs ? r.info.programs.length : null,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      });
    }));
  }));

  const env = await page.evaluate(() => {
    const app = window.__fw;
    const s3 = app.scene3d;
    const r = s3.renderer;
    const S = (fn) => { try { return fn(); } catch (e) { return `ERR:${e.message}`; } };
    return {
      devicePixelRatio: window.devicePixelRatio,
      rendererPixelRatio: r.getPixelRatio(),
      canvas: { width: r.domElement.width, height: r.domElement.height },
      fov: s3.camera.fov,
      toneMapping: r.toneMapping,
      toneMappingExposure: r.toneMappingExposure,
      outputColorSpace: r.outputColorSpace,
      shadowMap: { enabled: r.shadowMap.enabled, type: r.shadowMap.type },
      gtaoEnabled: !!s3.post.gtao?.enabled,
      bloomEnabled: !!s3.post.bloom?.enabled,
      propertyId: S(() => app.state.property?.id),
      clubhouseVariant: S(() => app.state.property?.clubhouseVariant),
      campaignEnabled: S(() => !!app.state.campaign?.enabled),
      hardwareConcurrency: navigator.hardwareConcurrency,
      userAgent: navigator.userAgent,
    };
  });

  // aggregate across runs by scenario name
  const byScenario = {};
  for (const run of runs) {
    const key = run.name.split('/')[1];
    (byScenario[key] ||= []).push(run);
  }
  // A single number here is a lie: the measured noise floor is CV ~1.4% on a quiet machine
  // and ~3.1% under load, so every figure carries a confidence interval and a usability
  // verdict. Method and the empirical noise floor: BASELINE_PERFORMANCE.md section 8.
  const WARMUP_RUNS = Number(process.env.BASELINE_PERF_WARMUP ?? 1);
  const CV_TRUST_LIMIT = 2.5; // % â€” quiet machine measured 1.42, 8-thread load 3.11
  const summary = Object.entries(byScenario).map(([scenario, all]) => {
    // The first run of a scenario is consistently ~2.2% slower than later ones (measured
    // over 10 sessions). Drop it rather than average a known transient into the result.
    const rs = all.length > WARMUP_RUNS ? all.slice(WARMUP_RUNS) : all;
    const round = (v, p = 2) => Math.round(v * 10 ** p) / 10 ** p;
    const stats = (k) => {
      const xs = rs.map((v) => v[k]);
      const n = xs.length;
      const mean = xs.reduce((a, v) => a + v, 0) / n;
      const sd = n > 1 ? Math.sqrt(xs.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
      // 95% CI on the mean. t is used rather than 1.96 because n is small.
      const T95 = { 1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262 };
      const t = T95[n - 1] ?? 1.96;
      const ci = n > 1 ? t * (sd / Math.sqrt(n)) : null;
      return {
        mean: round(mean, 3),
        sd: round(sd, 3),
        cvPct: mean ? round((sd / mean) * 100, 2) : null,
        ci95: ci === null ? null : round(ci, 3),
        ci95Pct: ci === null || !mean ? null : round((ci / mean) * 100, 2),
        n,
      };
    };
    const avgMs = stats('avgMs');
    return {
      scenario,
      runsUsed: rs.length,
      runsDiscardedAsWarmup: all.length - rs.length,
      avgMs,
      p1Ms: stats('p1Ms'),
      avgFps: stats('avgFps'),
      low1Fps: stats('low1Fps'),
      worstMsMax: Math.max(...rs.map((v) => v.worstMs)),
      stutterTotal: rs.reduce((a, v) => a + (v.stutterFrames || 0), 0),
      drawCalls: rs[rs.length - 1].drawCalls,
      triangles: rs[rs.length - 1].triangles,
      heapMB: rs[rs.length - 1].heapMB,
      // Self-policing: a noisy machine produces a wide spread, and that is detectable
      // from the data itself without needing to read system CPU.
      trustworthy: avgMs.cvPct !== null && avgMs.cvPct <= CV_TRUST_LIMIT && rs.length >= 2,
      note: avgMs.cvPct !== null && avgMs.cvPct > CV_TRUST_LIMIT
        ? `run-to-run CV ${avgMs.cvPct}% exceeds ${CV_TRUST_LIMIT}% â€” machine was probably not quiet; do not compare this against another run`
        : null,
    };
  });

  const report = {
    method: 'tools/qa/proshop-baseline-performance.js â€” see BASELINE_TEST_PROTOCOL.md',
    runsPerScenario: RUNS,
    requestedVariant: VARIANT || null,
    gpu,
    softwareRenderer: rendererGate.software,
    env,
    loadTimings: {
      newGameClickToWalkActiveMs: tWalkActive - tNewGame,
      newGameClickToClubhouseBuiltMs: tClubhouse - tNewGame,
      newGameClickToVeilClearMs: tVeilClear - tNewGame,
    },
    sceneStats,
    laptopEntry,
    summary,
    runs,
    errs: errs.slice(0, 12),
  };
  const outName = VARIANT ? `baseline-performance-${VARIANT}.json` : 'baseline-performance.json';
  fs.writeFileSync(path.join(dataOut, outName), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

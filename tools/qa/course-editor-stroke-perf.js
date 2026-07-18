// Course Editor stroke performance probe.
//
// Measures the thing a player actually feels: dragging the terrain brush. Two
// independent views, because one alone is misleading.
//
//   1. Synthetic — time refreshGround() directly, the call every stroke tick
//      makes. Decomposed so the terrain-mesh share and the visual-field share
//      are separable rather than one opaque number.
//   2. Real — drive an actual pointer drag through the editor's own handlers
//      and record raw frame deltas. This is the honest user-facing figure; the
//      synthetic number cannot see throttling or renderer stalls.
//
// Run:
//   QA_BASE_URL='http://localhost:8467/' COURSE_QA_PHASE='stroke_before' \
//   node tools/qa/run-playwright.cjs tools/qa/course-editor-stroke-perf.js --bootstrap
async (page) => {
  const phase = process.env.COURSE_QA_PHASE || 'stroke_baseline';
  const outDir = `qa/course_master_final/${phase}`;
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const diagnostics = { console: [], pageErrors: [] };

  page.on('console', (m) => {
    if (m.type() === 'error') diagnostics.console.push(m.text());
  });
  page.on('pageerror', (e) => diagnostics.pageErrors.push(e.message));

  await page.goto(baseUrl);
  await page.waitForFunction(() => document.readyState === 'complete');
  const cont = page.getByRole('button', { name: 'Continue', exact: true });
  await cont.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((i) => i.textContent.trim() === 'Continue');
    return b && !b.disabled;
  });
  await cont.click();
  await page.waitForFunction(
    () => window.__fw?.state?.course?.vec && window.__fw?.scene3d && window.__fw?.editorUi?.(),
    null, { timeout: 90000 },
  );
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 90000 });

  await page.evaluate(() => {
    const w = window.__fw.state.weather;
    w.locked = true;
    w.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
  });

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive());
  await page.locator('.ced-root').waitFor({ state: 'visible' });
  await page.evaluate(() => new Promise((r) => {
    let n = 20;
    const t = () => (--n <= 0 ? r() : requestAnimationFrame(t));
    requestAnimationFrame(t);
  }));

  // ---- 1. synthetic: the exact call a stroke tick makes -------------------
  const synthetic = await page.evaluate(() => {
    const scene = window.__fw.scene3d;
    const st = window.__fw.state;
    const stats = (samples) => {
      const o = samples.slice().sort((a, b) => a - b);
      return {
        runs: o.length,
        medianMs: +o[Math.floor(o.length / 2)].toFixed(3),
        meanMs: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3),
        minMs: +o[0].toFixed(3),
        maxMs: +o[o.length - 1].toFixed(3),
      };
    };
    const time = (fn, runs = 12) => {
      fn(); // warm: first call pays lazy relief/geometry allocation
      const out = [];
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        fn();
        out.push(performance.now() - t0);
      }
      return stats(out);
    };

    // A brush stroke is ~2 cells across. This is the dirty area that SHOULD
    // matter; everything above it is waste.
    const centre = { x: 60, y: 40 };
    const rect = { x0: centre.x - 3, y0: centre.y - 3, x1: centre.x + 3, y1: centre.y + 3 };

    return {
      // full-course rebuild: the cost a stamp used to pay unconditionally
      fullRebuildCall: time(() => scene.refreshGround(st, {})),
      // the live terrain tick after scoping (what the drag does now)
      liveTerrainTick: time(() => scene.refreshGround(st, { zones: false, terrainRect: rect })),
      // paint's live tick
      paintTick: time(() => scene.updateZoneField(st, rect), 8),
      // stamp tools (green/bunker/water/tee): relief invalidation forces a full
      // terrain rebuild today, even though the feature is local
      stampCall: time(() => scene.refreshGround(st, {
        relief: true, holes: true, zoneRect: rect,
      }), 6),
      // the same stamp with the mesh rebuild scoped to the feature
      stampCallScoped: time(() => scene.refreshGround(st, {
        relief: true, holes: true, zoneRect: rect, terrainRect: rect,
      }), 6),
    };
  });

  // ---- 2. real: drag the terrain brush through the editor's own handlers --
  await page.evaluate(() => {
    const ui = window.__fw.editorUi();
    if (ui.qa?.selectTool) ui.qa.selectTool('terrain');
  });
  const terrainBtn = page.locator('.ced-tool', { hasText: 'Terrain' }).first();
  if (await terrainBtn.count()) await terrainBtn.click().catch(() => {});
  await page.evaluate(() => new Promise((r) => {
    let n = 10;
    const t = () => (--n <= 0 ? r() : requestAnimationFrame(t));
    requestAnimationFrame(t);
  }));

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width * 0.55;
  const cy = box.y + box.height * 0.55;

  await page.evaluate(() => {
    window.__strokeProbe = { deltas: [], running: true, last: performance.now() };
    const tick = (now) => {
      const p = window.__strokeProbe;
      if (!p.running) return;
      const d = now - p.last;
      p.last = now;
      if (d > 0) p.deltas.push(d);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(cx + i * 4, cy + Math.sin(i / 3) * 20);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.evaluate(() => new Promise((r) => {
    let n = 10;
    const t = () => (--n <= 0 ? r() : requestAnimationFrame(t));
    requestAnimationFrame(t);
  }));

  const drag = await page.evaluate(() => {
    const p = window.__strokeProbe;
    p.running = false;
    const d = p.deltas;
    const o = d.slice().sort((a, b) => a - b);
    const mean = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
    const slowCount = Math.max(1, Math.ceil(o.length * 0.01));
    const slowMean = o.slice(-slowCount).reduce((a, b) => a + b, 0) / slowCount;
    return {
      frames: d.length,
      averageFps: +(1000 / mean).toFixed(2),
      averageFrameMs: +mean.toFixed(3),
      onePercentLowFps: +(1000 / Math.max(0.001, slowMean)).toFixed(2),
      medianFrameMs: +o[Math.floor(o.length / 2)].toFixed(3),
      worstFrameMs: +o[o.length - 1].toFixed(3),
      framesOver33ms: d.filter((x) => x > 33).length,
      framesOver100ms: d.filter((x) => x > 100).length,
      rawFrameDeltasMs: d.map((x) => +x.toFixed(2)),
    };
  });

  await page.screenshot({ path: `${outDir}/terrain_stroke.png` });

  return {
    ok: diagnostics.pageErrors.length === 0,
    phase,
    note: 'liveStrokeCall is the call the terrain drag makes today (no zoneRect).',
    synthetic,
    drag,
    diagnostics,
  };
}

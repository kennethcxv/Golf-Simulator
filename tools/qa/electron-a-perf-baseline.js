// A (Goal 23) — THE WHOLE PERFORMANCE PICTURE IN ONE RUN.
//
// "The game is horrible to play" is about the BASELINE, not the stalls, and the
// numbers the owner asked for are GPU ms, CPU submit ms, draw calls, achieved
// fps per cap, and the worst frame in a sixty-second indoor walk. Those have
// been measured before by five different drivers on five different days, which
// means they have never once been measured on the same frame of the same build.
// One run, one build, one place: standing and then WALKING inside the shop.
//
// Every leg carries its own control:
//   * GPU timing reports the INSTRUMENT first. A missing extension and a fast
//     GPU produce identical silence.
//   * The cap ladder counts renderer.info.render.frame, not rAF: the cap
//     schedules rAF every vsync and skips the body, so rAF reads panel rate
//     whatever the cap does.
//   * The walk leg asserts it MOVED (start/end position differ by yards) and
//     that it stayed INSIDE. A "60-second indoor walk" that never left the spot
//     measures standing still, and standing still is not what feels bad.
//   * The census reports what a per-material merge WOULD save before anything
//     is merged, so the lever is sized before it is pulled.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a-perf-baseline.js --clubhouse=pine-hills-v2
//   [--label=before|after]
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const labelArg = process.argv.find((a) => a.startsWith('--label='));
  const LABEL = labelArg ? labelArg.slice(8) : 'run';
  const OUT = path.resolve('qa/electron/a-perf');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { label: LABEL, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(6000);

  // Stand in the middle of the shop floor, indoors, clock pinned, sim paused so
  // the frame cost is the RENDER and not a day advancing underneath it.
  out.placed = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    const ip = ch.interior.position;
    fw.state.clock.minutes = Math.floor(fw.state.clock.minutes / 1440) * 1440 + 14 * 60;
    fw.speedIdx = 0;
    st.x = ip.x; st.z = ip.z; st.pitch = -0.05;
    return { inside: !!ch.isInside(st.x, st.z, 0.35), x: +st.x.toFixed(2), z: +st.z.toFixed(2) };
  });
  await page.waitForTimeout(2500);

  // ---- 1. WHAT IS BEING DRAWN, AND WHAT A MERGE WOULD SAVE -----------------
  out.census = await page.evaluate(() => {
    const fw = window.__fw;
    const r = fw.scene3d.renderer;
    const ch = fw.scene3d.clubhouse();
    const info = r.info;
    // Walk the interior subtree the way the renderer does: only meshes that are
    // visible AND on a live layer actually cost a draw call.
    let meshes = 0; let drawable = 0; let skinnedOrMorph = 0; let instanced = 0;
    const byMaterial = new Map();
    const key = (m) => `${m.uuid}`;
    ch.interior.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      meshes += 1;
      if (!o.visible || o.layers.mask === 0) return;
      let hidden = false;
      for (let p = o.parent; p; p = p.parent) if (!p.visible) { hidden = true; break; }
      if (hidden) return;
      drawable += 1;
      if (o.isInstancedMesh) { instanced += 1; return; }
      if (o.isSkinnedMesh || (o.morphTargetInfluences && o.morphTargetInfluences.length)) {
        skinnedOrMorph += 1; return;
      }
      // a mesh whose world transform can change is not static
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.length !== 1 || !o.geometry?.attributes?.position) return;
      const k = key(mats[0]);
      const row = byMaterial.get(k) || { name: mats[0].name || mats[0].type, meshes: 0, verts: 0 };
      row.meshes += 1;
      row.verts += o.geometry.attributes.position.count;
      byMaterial.set(k, row);
    });
    const rows = [...byMaterial.values()].sort((a, b) => b.meshes - a.meshes);
    const mergeable = rows.filter((x) => x.meshes > 1);
    return {
      rendererCalls: info.render.calls,
      rendererTriangles: info.render.triangles,
      programs: info.programs?.length ?? null,
      interiorMeshes: meshes,
      interiorDrawable: drawable,
      interiorInstanced: instanced,
      interiorSkinnedOrMorph: skinnedOrMorph,
      singleMaterialStaticMeshes: rows.reduce((s, x) => s + x.meshes, 0),
      distinctMaterials: rows.length,
      // the prize: every group of N meshes on one material becomes 1 call
      wouldSaveDrawCalls: mergeable.reduce((s, x) => s + (x.meshes - 1), 0),
      top: rows.slice(0, 15).map((x) => ({ material: x.name, meshes: x.meshes, verts: x.verts })),
    };
  });

  // ---- 2. CPU SUBMIT: WALL TIME INSIDE scene3d.render -----------------------
  out.cpuSubmit = await page.evaluate(() => new Promise((resolve) => {
    const fw = window.__fw;
    fw.preferences.set('display.fpsCap', 0);
    const s = fw.scene3d;
    const orig = s.render;
    const renderMs = []; const frameMs = [];
    let lastEnd = 0;
    s.render = function patched(...args) {
      const t0 = performance.now();
      if (lastEnd) frameMs.push(t0 - lastEnd);
      const r = orig.apply(this, args);
      const t1 = performance.now();
      renderMs.push(t1 - t0);
      lastEnd = t1;
      return r;
    };
    setTimeout(() => {
      s.render = orig;
      const stat = (xs) => {
        const v = xs.slice(10).sort((a, b) => a - b);
        if (!v.length) return null;
        const at = (q) => +v[Math.min(v.length - 1, Math.floor(v.length * q))].toFixed(2);
        return { n: v.length, median: at(0.5), p95: at(0.95), worst: +v[v.length - 1].toFixed(2) };
      };
      resolve({ insideRenderCall: stat(renderMs), betweenRenderCalls: stat(frameMs) });
    }, 8000);
  }));

  // ---- 3. GPU MS ------------------------------------------------------------
  out.gpu = await page.evaluate(() => new Promise((resolve) => {
    const r = window.__fw.scene3d.renderer;
    const gl = r.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') || gl.getExtension('EXT_disjoint_timer_query');
    if (!ext) {
      resolve({ instrumentAvailable: false, why: 'EXT_disjoint_timer_query(_webgl2) not exposed',
        note: 'No GPU timing collected. A missing extension and a fast GPU look identical from here.' });
      return;
    }
    const TARGET = ext.TIME_ELAPSED_EXT !== undefined ? ext.TIME_ELAPSED_EXT : 0x88BF;
    const rows = []; const pending = [];
    let active = null; let prev = performance.now();
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      if (active) { gl.endQuery(TARGET); pending.push({ q: active.q, dt: active.dt }); active = null; }
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const p = pending[i];
        if (gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
            rows.push({ dt: p.dt, gpuMs: +(gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6).toFixed(3) });
          }
          gl.deleteQuery(p.q); pending.splice(i, 1);
        }
      }
      if (now - t0 < 10000) {
        const q = gl.createQuery();
        try { gl.beginQuery(TARGET, q); active = { q, dt: +(now - prev).toFixed(2) }; } catch { gl.deleteQuery(q); }
        prev = now;
        requestAnimationFrame(tick);
      } else {
        setTimeout(() => {
          const g = rows.map((x) => x.gpuMs).sort((a, b) => a - b);
          const at = (q) => (g.length ? +g[Math.min(g.length - 1, Math.floor(g.length * q))].toFixed(2) : null);
          resolve({ instrumentAvailable: true, samples: g.length, median: at(0.5), p95: at(0.95), worst: g.length ? g[g.length - 1] : null });
        }, 500);
      }
    };
    requestAnimationFrame(tick);
  }));

  // ---- 4. SIXTY SECONDS OF WALKING, INDOORS --------------------------------
  await page.evaluate(() => window.__fw.preferences.set('display.fpsCap', 60));
  await page.waitForTimeout(600);
  const walkStart = await page.evaluate(() => {
    const st = window.__fw.scene3d.walk.state;
    return { x: st.x, z: st.z };
  });
  const walkPromise = page.evaluate((durMs) => new Promise((resolve) => {
    const fw = window.__fw;
    const info = fw.scene3d.renderer.info;
    const intervals = []; const calls = [];
    let lastFrame = info.render.frame; let lastTs = performance.now();
    const t0 = lastTs;
    let inside = 0; let total = 0;
    const ch = fw.scene3d.clubhouse();
    const tick = (ts) => {
      const f = info.render.frame;
      if (f !== lastFrame) {
        intervals.push(ts - lastTs); calls.push(info.render.calls);
        lastTs = ts; lastFrame = f;
        const st = fw.scene3d.walk.state;
        total += 1;
        if (ch.isInside(st.x, st.z, 0.35)) inside += 1;
      }
      if (ts - t0 < durMs) requestAnimationFrame(tick);
      else resolve({ intervals, calls, insidePct: total ? +(100 * inside / total).toFixed(1) : null });
    };
    requestAnimationFrame(tick);
  }), 60000);

  // A real patrol: forward, turn, forward, turn — inside a shop, for a minute.
  const leg = async (key, ms, turn) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    if (turn) await page.mouse.move(640 + turn, 360, { steps: 12 });
  };
  const t0 = Date.now();
  while (Date.now() - t0 < 58000) {
    await leg('w', 2600, 220);
    await leg('a', 1400, 0);
    await leg('w', 2200, -260);
    await leg('d', 1400, 0);
    await leg('s', 1600, 180);
  }
  const walk = await walkPromise;
  const walkEnd = await page.evaluate(() => {
    const st = window.__fw.scene3d.walk.state;
    return { x: st.x, z: st.z };
  });
  {
    const v = walk.intervals.slice(5).sort((a, b) => a - b);
    const at = (q) => (v.length ? +v[Math.min(v.length - 1, Math.floor(v.length * q))].toFixed(2) : null);
    const target = 1000 / 60;
    out.walk = {
      movedYards: +Math.hypot(walkEnd.x - walkStart.x, walkEnd.z - walkStart.z).toFixed(2),
      pathTaken: walk.intervals.length,
      insidePct: walk.insidePct,
      frames: v.length,
      medianMs: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99),
      worstMs: v.length ? +v[v.length - 1].toFixed(2) : null,
      achievedFps: at(0.5) ? +(1000 / at(0.5)).toFixed(1) : null,
      droppedPct: v.length ? +(100 * v.filter((i) => i > target * 1.5).length / v.length).toFixed(2) : null,
      drawCallsMedian: walk.calls.length ? walk.calls.slice().sort((a, b) => a - b)[Math.floor(walk.calls.length / 2)] : null,
      drawCallsMax: walk.calls.length ? Math.max(...walk.calls) : null,
    };
  }

  // ---- 5. THE CAP LADDER ----------------------------------------------------
  const measure = (ms) => page.evaluate((dur) => new Promise((resolve) => {
    const info = window.__fw.scene3d.renderer.info;
    const intervals = [];
    let lastFrame = info.render.frame; let lastTs = performance.now();
    const t0b = lastTs;
    const tick = (ts) => {
      const f = info.render.frame;
      if (f !== lastFrame) { intervals.push(ts - lastTs); lastTs = ts; lastFrame = f; }
      if (ts - t0b < dur) requestAnimationFrame(tick); else resolve(intervals);
    };
    requestAnimationFrame(tick);
  }), ms);
  out.capLadder = [];
  for (const cap of [60, 120, 144, 0]) {
    await page.evaluate((c) => window.__fw.preferences.set('display.fpsCap', c), cap);
    await page.waitForTimeout(900);
    const intervals = await measure(6000);
    const v = intervals.slice(5).sort((a, b) => a - b);
    const median = v[Math.floor(v.length / 2)] ?? 0;
    const want = cap > 0 ? 1000 / cap : null;
    out.capLadder.push({
      cap,
      achievedFps: median > 0 ? +(1000 / median).toFixed(1) : 0,
      onCadencePct: want ? +(100 * v.filter((i) => Math.abs(i - want) <= want * 0.2).length / v.length).toFixed(1) : null,
    });
  }
  await page.evaluate(() => window.__fw.preferences.set('display.fpsCap', 60));

  out.controls = {
    // A walk that did not walk measures standing still.
    actuallyWalked: (out.walk?.movedYards ?? 0) > 2,
    stayedIndoors: (out.walk?.insidePct ?? 0) > 80,
    gpuInstrument: out.gpu?.instrumentAvailable ?? false,
  };
  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A-PERF', LABEL, JSON.stringify({
    census: { calls: out.census.rendererCalls, wouldSave: out.census.wouldSaveDrawCalls, materials: out.census.distinctMaterials },
    cpuSubmitMedian: out.cpuSubmit.insideRenderCall?.median,
    gpuMedian: out.gpu?.median ?? null,
    walk: out.walk,
    caps: out.capLadder,
    controls: out.controls,
  }, null, 2));
  return out;
}

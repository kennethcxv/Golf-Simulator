// A3 — WHICH PASS OWNS THE 7.11 POST MILLISECONDS?
//
// Tonight's re-measure: GPU 9.43 ms indoors, post OFF 2.32 ms. The panel is a
// measured 240 Hz (Win32 CurrentRefreshRate; the earlier 120 was the app's
// vsync-halved rAF cadence, not the monitor). Before any pmndrs surgery, split
// the 7.11 ms between gtao, bloom, and the 4xMSAA half-float composer target —
// six suite files pin the current chain's contracts, so the cut must be aimed,
// not sprayed. Each lever is toggled and RESTORED so later rungs measure one
// thing; drift control first and last; also reports the UNMASKED renderer so
// a dual-GPU (RTX 5080 + iGPU) mis-assignment cannot hide.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a3-post-attribution.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a3-post-attribution');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], sweep: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(6000);

  out.teleport = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw?.scene3d?.clubhouse?.();
    const st = fw?.scene3d?.walk?.state;
    if (!ch || !st) return { ok: false };
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 3.0;
    st.z = book.z + (to.z / len) * 3.0;
    st.pitch = -0.2;
    return { ok: true, inside: !!ch.isInside(st.x, st.z, 0.35) };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));
  await page.waitForTimeout(3500);

  const gpuSample = (ms) => page.evaluate((dur) => new Promise((resolve) => {
    const r = window.__fw.scene3d.renderer;
    const gl = r.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
      || gl.getExtension('EXT_disjoint_timer_query');
    if (!ext) { resolve({ ok: false }); return; }
    const TARGET = ext.TIME_ELAPSED_EXT !== undefined ? ext.TIME_ELAPSED_EXT : 0x88BF;
    const gpu = []; const dts = []; const pending = [];
    let active = null;
    let prev = performance.now();
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      if (active) { gl.endQuery(TARGET); pending.push(active); active = null; }
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const p = pending[i];
        if (gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) {
          // A disjoint result is invalid, not slow. Discard rather than average.
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
            gpu.push(gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6);
            dts.push(p.dt);
          }
          gl.deleteQuery(p.q); pending.splice(i, 1);
        }
      }
      if (now - t0 < dur) {
        const q = gl.createQuery();
        try { gl.beginQuery(TARGET, q); active = { q, dt: now - prev }; } catch { gl.deleteQuery(q); }
        prev = now;
        requestAnimationFrame(tick);
      } else setTimeout(() => resolve({ ok: true, gpu, dts }), 400);
    };
    requestAnimationFrame(tick);
  }), ms);

  const stat = (xs) => {
    if (!xs || !xs.length) return { n: 0 };
    const v = xs.slice().sort((a, b) => a - b);
    const at = (q) => v[Math.min(v.length - 1, Math.floor(v.length * q))];
    return {
      n: v.length, median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2),
      overRefreshPct: +((v.filter((d) => d > 8.33).length / v.length) * 100).toFixed(1),
    };
  };

  const run = async (label, apply) => {
    const applied = apply ? await page.evaluate(apply).catch((e) => `threw: ${String(e && e.message)}`) : null;
    await page.waitForTimeout(1500);
    const res = await gpuSample(8000);
    const g = stat(res.gpu);
    const d = stat(res.dts);
    out.sweep.push({ label, applied, gpu: g, frame: d });
    return g;
  };

  out.adapter = await page.evaluate(() => {
    const gl = window.__fw.scene3d.renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'no debug ext';
  });

  await run('baseline', null);
  await run('gtao OFF', () => window.__fw.scene3d.postDiag.setGtaoEnabled(false));
  await run('gtao back ON', () => window.__fw.scene3d.postDiag.setGtaoEnabled(true));
  await run('bloom OFF', () => window.__fw.scene3d.postDiag.setBloomEnabled(false));
  await run('bloom back ON', () => window.__fw.scene3d.postDiag.setBloomEnabled(true));
  await run('msaa 0', () => window.__fw.scene3d.setAntialiasSamples(0));
  await run('msaa back 4', () => window.__fw.scene3d.setAntialiasSamples(4));
  await run('gtao+bloom OFF, msaa 0', () => {
    const s = window.__fw.scene3d;
    s.postDiag.setGtaoEnabled(false); s.postDiag.setBloomEnabled(false); return s.setAntialiasSamples(0);
  });
  await run('post OFF entirely', () => {
    const s = window.__fw.scene3d;
    s.postDiag.setGtaoEnabled(true); s.postDiag.setBloomEnabled(true); s.setAntialiasSamples(4);
    return s.setPostEnabled(false);
  });
  await run('baseline again', () => window.__fw.scene3d.setPostEnabled(true));

  const med = (i) => out.sweep[i]?.gpu.median ?? null;
  const base = med(0);
  out.verdict = {
    inside: out.teleport?.inside ?? null,
    adapter: out.adapter,
    panelRefreshMs: 4.17,
    baselineGpuMs: base,
    baselineAgainGpuMs: med(out.sweep.length - 1),
    controlGapMs: +Math.abs(base - med(out.sweep.length - 1)).toFixed(2),
    ladder: out.sweep.map((s) => `${s.label}:${s.gpu.median}ms`).join('  '),
    gtaoCost: +(base - med(1)).toFixed(2),
    bloomCost: +(base - med(3)).toFixed(2),
    msaaCost: +(base - med(5)).toFixed(2),
    allThreeCost: +(base - med(7)).toFixed(2),
    wholeComposerCost: +(base - med(8)).toFixed(2),
  };
  fs.writeFileSync(path.join(OUT, 'a3-post-attribution.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A3-POSTATTR', JSON.stringify(out.verdict));
  for (const s of out.sweep) console.log(`  ${s.label.padEnd(24)} gpu ${JSON.stringify(s.gpu)}`);
  return out;
}

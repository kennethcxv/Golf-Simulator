// A1 — HOW LONG DOES THE GPU ACTUALLY SPEND ON AN INDOOR FRAME?
//
// Nine mechanisms are eliminated with controls and the picture points one way:
// CPU inside `renderer.render()` is flat, draw calls and triangles are identical
// on spike and calm frames, and the loop misses one 8.33 ms vsync in seven and
// then fires back-to-back to catch up. All of that is what a GPU running late
// looks like from the CPU side — and none of it can SEE the GPU, because
// `render()` returns when the commands are queued, not when they are done.
//
// `EXT_disjoint_timer_query_webgl2` is the one instrument that can. It brackets
// the draw commands with GPU-side timestamps and reports the elapsed time on the
// device.
//
// IT MAY SIMPLY NOT BE THERE. Chrome disabled timer queries for a long stretch
// over a side-channel concern and support varies by driver and by flag. So the
// first thing this driver reports is whether the extension exists at all, and a
// null result is written up as "the instrument is unavailable", NEVER as "the GPU
// is fine". A missing extension and a fast GPU produce the same silence, and
// this session has already logged several faults of exactly that shape.
//
// The disjoint flag is checked too: if the GPU was interrupted during a query,
// the result is invalid and must be discarded rather than averaged in.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-gpu-timer.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-gpu-timer');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
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

  out.support = await page.evaluate(() => {
    const gl = window.__fw?.scene3d?.renderer?.getContext?.();
    if (!gl) return { ok: false, why: 'no gl context' };
    const names = gl.getSupportedExtensions ? gl.getSupportedExtensions() : [];
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
      || gl.getExtension('EXT_disjoint_timer_query');
    return {
      ok: !!ext,
      isWebGL2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      timerNames: (names || []).filter((n) => /timer/i.test(n)),
      why: ext ? null : 'EXT_disjoint_timer_query(_webgl2) not exposed',
    };
  }).catch((e) => ({ ok: false, why: String(e && e.message) }));

  if (!out.support.ok) {
    // Say what is missing, not what the GPU is doing. These are different facts.
    out.verdict = {
      instrumentAvailable: false,
      why: out.support.why,
      timerExtensionsSeen: out.support.timerNames,
      note: 'No GPU timing was collected. This is a statement about the instrument, '
        + 'not about the GPU: a missing extension and a fast GPU look identical from here.',
    };
    fs.writeFileSync(path.join(OUT, 'a1-gpu-timer.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('A1-GPU', JSON.stringify(out.verdict));
    return out;
  }

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

  out.result = await page.evaluate(() => new Promise((resolve) => {
    const r = window.__fw.scene3d.renderer;
    const gl = r.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
      || gl.getExtension('EXT_disjoint_timer_query');
    const TARGET = ext.TIME_ELAPSED_EXT !== undefined ? ext.TIME_ELAPSED_EXT : 0x88BF;
    const rows = [];
    const pending = [];
    let active = null;
    const orig = r.render.bind(r);
    r.render = function timed(scene, camera) {
      // One query per FRAME, not per render() call: the composer calls render
      // several times and nested queries are illegal. Only the first call in a
      // frame opens one, and the frame's own tick closes it.
      const res = orig(scene, camera);
      return res;
    };
    let prev = performance.now();
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      // Close the previous frame's query before opening the next.
      if (active) { gl.endQuery(TARGET); pending.push({ q: active.q, dt: active.dt }); active = null; }
      // Harvest anything finished.
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const p = pending[i];
        const available = gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE);
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        if (available) {
          if (!disjoint) {
            rows.push({ dt: p.dt, gpuMs: +(gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6).toFixed(3) });
          }
          gl.deleteQuery(p.q);
          pending.splice(i, 1);
        }
      }
      if (now - t0 < 11000) {
        const q = gl.createQuery();
        try { gl.beginQuery(TARGET, q); active = { q, dt: +(now - prev).toFixed(2) }; } catch { gl.deleteQuery(q); }
        prev = now;
        requestAnimationFrame(tick);
      } else {
        r.render = orig;
        setTimeout(() => resolve({ rows, unharvested: pending.length }), 500);
      }
    };
    requestAnimationFrame(tick);
  })).catch((e) => ({ threw: String(e && e.message) }));

  const rows = out.result?.rows || [];
  const med = (xs) => {
    if (!xs.length) return null;
    const v = xs.slice().sort((a, b) => a - b);
    return +v[Math.floor(v.length / 2)].toFixed(2);
  };
  const spike = rows.filter((r) => r.dt > 16.7);
  const calm = rows.filter((r) => r.dt <= 16.7);
  out.verdict = {
    instrumentAvailable: true,
    inside: out.teleport?.inside ?? null,
    samples: rows.length,
    unharvested: out.result?.unharvested ?? null,
    spikes: spike.length,
    dtMedianSpike: med(spike.map((r) => r.dt)),
    dtMedianCalm: med(calm.map((r) => r.dt)),
    gpuMedianSpike: med(spike.map((r) => r.gpuMs)),
    gpuMedianCalm: med(calm.map((r) => r.gpuMs)),
    gpuGapMs: med(spike.map((r) => r.gpuMs)) != null && med(calm.map((r) => r.gpuMs)) != null
      ? +(med(spike.map((r) => r.gpuMs)) - med(calm.map((r) => r.gpuMs))).toFixed(2) : null,
  };
  fs.writeFileSync(path.join(OUT, 'a1-gpu-timer.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-GPU', JSON.stringify(out.verdict));
  return out;
}

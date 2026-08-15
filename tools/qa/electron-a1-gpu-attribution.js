// A1 — WHERE DO THE 8.4 GPU MILLISECONDS GO?
//
// The GPU runs a flat 8.4 ms per indoor frame against an 8.33 ms refresh
// interval — 101% subscribed, constantly, which is the whole of invariant 1's
// indoor stutter. The lever is GPU milliseconds, so the question is now simply
// which pass owns them.
//
// Two levers are exposed and can be swept at runtime without touching game code:
//
//   - `setPostEnabled(false)` — the whole composer: RenderPass into an MSAA
//     half-float target, GTAO, bloom. courseScene's own note says turning GTAO
//     and bloom off individually still pays for the composer, so this is the
//     honest all-or-nothing measurement.
//   - `setShadowQuality({ walkMap })` — the shadow map's resolution, 2048 by
//     default, which is a straight quadratic on shadow-pass fill.
//
// Each window measures GPU TIME, not frame time, because frame time is paced by
// vsync and would hide a saving that does not cross the interval boundary. A
// change that takes the GPU from 8.4 to 7.9 ms fixes the stutter completely and
// moves the frame-time median not at all.
//
// Baseline measured FIRST AND LAST as the drift control.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-gpu-attribution.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-gpu-attribution');
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

  await run('baseline', null);
  await run('post OFF', () => window.__fw.scene3d.setPostEnabled?.(false) ?? 'no setter');
  await run('post ON', () => window.__fw.scene3d.setPostEnabled?.(true) ?? 'no setter');
  await run('shadow 1024', () => window.__fw.scene3d.setShadowQuality?.({ walkMap: 1024 }) ?? 'no setter');
  await run('shadow 512', () => window.__fw.scene3d.setShadowQuality?.({ walkMap: 512 }) ?? 'no setter');
  await run('baseline again', () => window.__fw.scene3d.setShadowQuality?.({ walkMap: 2048 }) ?? 'no setter');

  const base = out.sweep[0].gpu.median;
  const baseEnd = out.sweep[out.sweep.length - 1].gpu.median;
  out.verdict = {
    inside: out.teleport?.inside ?? null,
    refreshMs: 8.33,
    baselineGpuMs: base,
    baselineAgainGpuMs: baseEnd,
    controlGapMs: base != null && baseEnd != null ? +Math.abs(base - baseEnd).toFixed(2) : null,
    ladder: out.sweep.map((s) => `${s.label}:${s.gpu.median}ms`).join('  '),
    // What each lever is worth, against the 0.07 ms the frame is over by.
    savedByPostOff: base != null ? +(base - (out.sweep[1]?.gpu.median ?? base)).toFixed(2) : null,
    savedByShadow1024: base != null ? +(base - (out.sweep[3]?.gpu.median ?? base)).toFixed(2) : null,
    savedByShadow512: base != null ? +(base - (out.sweep[4]?.gpu.median ?? base)).toFixed(2) : null,
  };
  fs.writeFileSync(path.join(OUT, 'a1-gpu-attribution.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-GPUATTR', JSON.stringify(out.verdict));
  for (const s of out.sweep) console.log(`  ${s.label.padEnd(16)} gpu ${JSON.stringify(s.gpu)}  frame ${JSON.stringify(s.frame)}`);
  return out;
}

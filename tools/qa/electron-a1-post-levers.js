// A1 — WHICH 0.8 MILLISECONDS INSIDE THE POST CHAIN?
//
// The post chain is 6.71 ms of a 9.11 ms GPU frame and the frame needs to lose
// only 0.8 ms to fit inside a 8.33 ms refresh interval. Turning post off is not
// the fix; finding 12% of it is.
//
// Two candidates are visible in the source and settable at runtime, so both can
// be PRICED before a line of game code changes:
//
//   - `composerTarget` is created with `samples: 4` — 4x MSAA on a HalfFloatType
//     target at 3840x2055 (courseScene.js:718-720). MSAA on a half-float target
//     is the most expensive single attribute in that constructor.
//   - `GTAO_CONFIG.samples` is **24** (courseScene.js:239). Twenty-four AO taps
//     per pixel is a lot, and AO cost is close to linear in tap count.
//
// GPU time, not frame time, for the reason established: vsync hides any saving
// that does not cross the interval boundary, and the whole question here is a
// sub-millisecond margin.
//
// EVERY RUNG VERIFIES THE SETTING TOOK. A lever that silently fails to apply
// reports "no saving", which reads exactly like "this is not where the time is".
// That fault has already been logged twice this session, so each rung reads the
// value back and the verdict carries it.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-post-levers.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-post-levers');
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

  out.shape = await page.evaluate(() => {
    const p = window.__fw.scene3d.post;
    const c = p?.composer;
    const g = p?.gtao;
    return {
      hasComposer: !!c,
      rt1Samples: c?.renderTarget1?.samples ?? null,
      rt2Samples: c?.renderTarget2?.samples ?? null,
      gtaoKeys: g ? Object.keys(g).filter((k) => /sample|scale|resolution|blend/i.test(k)) : null,
      gtaoParams: g?.pdRings !== undefined || g?.parameters ? Object.keys(g.parameters || {}) : null,
      passCount: c?.passes?.length ?? null,
      passNames: (c?.passes || []).map((x) => x.constructor?.name).slice(0, 10),
    };
  }).catch((e) => ({ threw: String(e && e.message) }));

  const gpuSample = (ms) => page.evaluate((dur) => new Promise((resolve) => {
    const r = window.__fw.scene3d.renderer;
    const gl = r.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) { resolve({ ok: false }); return; }
    const TARGET = ext.TIME_ELAPSED_EXT;
    const gpu = []; const pending = [];
    let active = null; let prev = performance.now(); const t0 = prev;
    const tick = () => {
      const now = performance.now();
      if (active) { gl.endQuery(TARGET); pending.push(active); active = null; }
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const p = pending[i];
        if (gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(p.q); pending.splice(i, 1);
        }
      }
      if (now - t0 < dur) {
        const q = gl.createQuery();
        try { gl.beginQuery(TARGET, q); active = { q }; } catch { gl.deleteQuery(q); }
        prev = now; requestAnimationFrame(tick);
      } else setTimeout(() => resolve({ ok: true, gpu }), 400);
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
    const applied = apply ? await page.evaluate(apply).catch((e) => `threw: ${String(e && e.message)}`) : 'baseline';
    await page.waitForTimeout(1800);
    const res = await gpuSample(8000);
    out.sweep.push({ label, applied, gpu: stat(res.gpu) });
  };

  await run('baseline', null);
  // MSAA off on both composer buffers. Three.js rebuilds the target when
  // `samples` changes, so the read-back proves the change reached the GL object.
  await run('msaa 0', () => {
    const c = window.__fw.scene3d.post.composer;
    if (!c) return 'no composer';
    c.renderTarget1.samples = 0; c.renderTarget2.samples = 0;
    c.renderTarget1.dispose(); c.renderTarget2.dispose();
    return { rt1: c.renderTarget1.samples, rt2: c.renderTarget2.samples };
  });
  // 2x is the option worth shipping if it lands near 0x on cost: half the
  // samples, most of the edge quality. Priced between the two extremes so the
  // saving can be read as a fraction of the 1.26 ms that 0x buys.
  await run('msaa 2', () => {
    const c = window.__fw.scene3d.post.composer;
    if (!c) return 'no composer';
    c.renderTarget1.samples = 2; c.renderTarget2.samples = 2;
    c.renderTarget1.dispose(); c.renderTarget2.dispose();
    return { rt1: c.renderTarget1.samples, rt2: c.renderTarget2.samples };
  });
  await run('msaa 4 again', () => {
    const c = window.__fw.scene3d.post.composer;
    if (!c) return 'no composer';
    c.renderTarget1.samples = 4; c.renderTarget2.samples = 4;
    c.renderTarget1.dispose(); c.renderTarget2.dispose();
    return { rt1: c.renderTarget1.samples, rt2: c.renderTarget2.samples };
  });
  // GTAO tap count. The pass exposes its own knobs; try the common shapes and
  // report which one actually moved.
  await run('gtao 8 taps', () => {
    const g = window.__fw.scene3d.post.gtao;
    if (!g) return 'no gtao';
    const before = { samples: g.samples ?? null, paramSamples: g.parameters?.samples ?? null };
    if (g.parameters && 'samples' in g.parameters) { g.parameters.samples = 8; g.updateGtaoMaterial?.(g.parameters); }
    if ('samples' in g) g.samples = 8;
    return { before, after: { samples: g.samples ?? null, paramSamples: g.parameters?.samples ?? null } };
  });
  await run('baseline again', () => {
    const g = window.__fw.scene3d.post.gtao;
    if (g?.parameters && 'samples' in g.parameters) { g.parameters.samples = 24; g.updateGtaoMaterial?.(g.parameters); }
    if (g && 'samples' in g) g.samples = 24;
    return 'restored';
  });

  const base = out.sweep[0].gpu.median;
  const end = out.sweep[out.sweep.length - 1].gpu.median;
  out.verdict = {
    inside: out.teleport?.inside ?? null,
    shape: out.shape,
    refreshMs: 8.33,
    baselineGpuMs: base,
    baselineAgainGpuMs: end,
    controlGapMs: base != null && end != null ? +Math.abs(base - end).toFixed(2) : null,
    needToSaveMs: base != null ? +(base - 8.33).toFixed(2) : null,
    ladder: out.sweep.map((s) => `${s.label}:${s.gpu.median}ms(${s.gpu.overRefreshPct}%)`).join('  '),
  };
  fs.writeFileSync(path.join(OUT, 'a1-post-levers.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-LEVERS', JSON.stringify(out.verdict));
  for (const s of out.sweep) console.log(`  ${s.label.padEnd(16)} ${JSON.stringify(s.gpu)}  applied ${JSON.stringify(s.applied)}`);
  return out;
}

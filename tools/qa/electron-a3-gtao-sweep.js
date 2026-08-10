// A3 — WHICH GTAO CONFIG KEEPS THE CONTACT DARKENING AT THE LEAST COST?
//
// The ladder says GTAO owns 4.34 of the 8.17 GPU ms. tests/gtao-config.test.js
// pins full resolution with "half res was removing the only indoor contact
// darkening" — so the cheaper config must be picked by LOOKING, not assumed.
// Each rung: apply config live (updateGtaoMaterial / setSize wrap), measure
// GPU ms, screenshot the same pose. The screenshots go side by side in the
// report; the pick is the cheapest rung whose floor-contact shadow survives.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a3-gtao-sweep.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a3-gtao-sweep');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], sweep: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(5000);

  // Same pose as the attribution ladder: 3m from the ledger desk, looking at
  // furniture on the floor — the exact surface the contact-darkening claim is
  // about. Deterministic extras: fixed clock, speed 0.
  await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 3.0;
    st.z = book.z + (to.z / len) * 3.0;
    st.pitch = -0.25;
    fw.state.clock.minutes = Math.floor(fw.state.clock.minutes / 1440) * 1440 + 14 * 60;
    fw.speedIdx = 0;
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
  });
  await page.waitForTimeout(2500);

  const gpuSample = (ms) => page.evaluate((dur) => new Promise((resolve) => {
    const gl = window.__fw.scene3d.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) { resolve({ ok: false }); return; }
    const gpu = []; const pending = [];
    let active = null;
    const t0 = performance.now();
    const tick = () => {
      const now = performance.now();
      if (active) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(active); active = null; }
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const p = pending[i];
        if (gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(p.q); pending.splice(i, 1);
        }
      }
      if (now - t0 < dur) {
        const q = gl.createQuery();
        try { gl.beginQuery(ext.TIME_ELAPSED_EXT, q); active = { q }; } catch { gl.deleteQuery(q); }
        requestAnimationFrame(tick);
      } else setTimeout(() => resolve({ ok: true, gpu }), 400);
    };
    requestAnimationFrame(tick);
  }), ms);
  const median = (xs) => {
    const v = xs.slice().sort((a, b) => a - b);
    return +v[Math.floor(v.length / 2)].toFixed(2);
  };

  // Live GTAO reconfiguration. resolutionScale needs the setSize wrap the
  // constructor applies, so it is re-wrapped here per rung.
  const applyConfig = (cfg) => page.evaluate((c) => {
    const s = window.__fw.scene3d;
    const gtao = s.postDiag?.gtaoPass?.();
    if (!gtao) return 'no gtaoPass handle';
    if (c.samples) gtao.updateGtaoMaterial({ samples: c.samples });
    if (c.pdSamples) gtao.updatePdMaterial({ samples: c.pdSamples });
    if (c.scale != null) {
      const base = gtao.__baseSetSize || (gtao.__baseSetSize = gtao.setSize.bind(gtao));
      gtao.setSize = (w, h) => base(Math.max(1, Math.ceil(w * c.scale)), Math.max(1, Math.ceil(h * c.scale)));
      const el = s.renderer.domElement;
      gtao.setSize(el.width, el.height);
    }
    return 'ok';
  }, cfg);

  const RUNGS = [
    { name: 'baseline-24s-16pd-full', samples: 24, pdSamples: 16, scale: 1 },
    { name: 'samples12', samples: 12, pdSamples: 16, scale: 1 },
    { name: 'samples8', samples: 8, pdSamples: 16, scale: 1 },
    { name: 'samples12-pd8', samples: 12, pdSamples: 8, scale: 1 },
    { name: 'scale075-s12-pd8', samples: 12, pdSamples: 8, scale: 0.75 },
    { name: 'scale05-s12-pd8', samples: 12, pdSamples: 8, scale: 0.5 },
    { name: 'back-to-baseline', samples: 24, pdSamples: 16, scale: 1 },
  ];
  for (const rung of RUNGS) {
    const applied = await applyConfig(rung);
    await page.waitForTimeout(1200);
    const res = await gpuSample(6000);
    const canvas = await page.$('#game');
    await (canvas || page).screenshot({ path: path.join(OUT, `${rung.name}.png`) });
    out.sweep.push({ ...rung, applied, gpuMedian: res.gpu ? median(res.gpu) : null });
  }
  fs.writeFileSync(path.join(OUT, 'sweep.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.sweep.map((r) => ({ name: r.name, applied: r.applied, gpu: r.gpuMedian })), null, 1));
}

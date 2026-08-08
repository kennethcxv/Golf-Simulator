// A1 — IS THE INDOOR SPIKE INSIDE THE RENDER CALL, OR OUTSIDE IT?
//
// Five mechanisms are eliminated (shadow bakes, culling/LOD, geometry volume,
// GC, texture uploads). What survives is "per-frame CPU outside draw submission,
// or GPU-side variance" — which is still two very different places to look.
//
// One measurement splits it. Wrap `renderer.render` so it times itself, then per
// frame compare that against the whole frame's dt:
//
//   - render time SPIKES with dt  -> the cost is in the render call: draw
//     submission, GPU stalls, the post chain.
//   - render time FLAT while dt spikes -> the cost is everything else the frame
//     does: game update, NPCs, the shop sim, layout, input.
//
// Note that `renderer.render` returning does NOT mean the GPU has finished — it
// means the commands are queued. So a flat render time with spiking dt could
// ALSO be the GPU catching up at the next frame's swap. That ambiguity is real
// and is called out in the verdict rather than papered over; what this driver
// can say for certain is whether the CPU time inside render moves.
//
// The patch is installed from the driver and removed afterwards, and the
// baseline is taken with the patch ALREADY IN PLACE so the wrapper's own cost is
// in both populations rather than only in one.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-render-vs-logic.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-render-vs-logic');
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

  out.patched = await page.evaluate(() => {
    const r = window.__fw?.scene3d?.renderer;
    if (!r) return 'no renderer';
    if (r.__a1Patched) return 'already';
    r.__a1Patched = true;
    window.__a1 = { renderMs: 0, calls: 0 };
    const orig = r.render.bind(r);
    r.render = function timed(scene, camera) {
      const t0 = performance.now();
      const res = orig(scene, camera);
      window.__a1.renderMs += performance.now() - t0;
      window.__a1.calls += 1;
      return res;
    };
    return 'patched';
  }).catch((e) => `threw: ${String(e && e.message)}`);

  const sample = (ms) => page.evaluate((dur) => new Promise((resolve) => {
    const rows = [];
    let prev = performance.now();
    let prevRender = window.__a1.renderMs;
    let prevCalls = window.__a1.calls;
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      rows.push({
        t: +(now - t0).toFixed(0),
        dt: +(now - prev).toFixed(2),
        render: +(window.__a1.renderMs - prevRender).toFixed(2),
        renderCalls: window.__a1.calls - prevCalls,
      });
      prev = now;
      prevRender = window.__a1.renderMs;
      prevCalls = window.__a1.calls;
      if (now - t0 < dur) requestAnimationFrame(tick);
      else resolve(rows);
    };
    requestAnimationFrame(tick);
  }), ms);

  const analyse = (rows0) => {
    const rows = rows0.slice(1);
    const spike = rows.filter((r) => r.dt > 16.7);
    const calm = rows.filter((r) => r.dt <= 16.7);
    const med = (xs) => {
      if (!xs.length) return null;
      const v = xs.slice().sort((a, b) => a - b);
      return +v[Math.floor(v.length / 2)].toFixed(2);
    };
    return {
      frames: rows.length,
      spikes: spike.length,
      spikePct: rows.length ? +((spike.length / rows.length) * 100).toFixed(1) : null,
      dtMedianSpike: med(spike.map((r) => r.dt)),
      dtMedianCalm: med(calm.map((r) => r.dt)),
      renderMedianSpike: med(spike.map((r) => r.render)),
      renderMedianCalm: med(calm.map((r) => r.render)),
      renderCallsSpike: med(spike.map((r) => r.renderCalls)),
      renderCallsCalm: med(calm.map((r) => r.renderCalls)),
      // How much of the extra time on a spike frame is inside render()?
      extraDt: med(spike.map((r) => r.dt)) != null && med(calm.map((r) => r.dt)) != null
        ? +(med(spike.map((r) => r.dt)) - med(calm.map((r) => r.dt))).toFixed(2) : null,
      extraRender: med(spike.map((r) => r.render)) != null && med(calm.map((r) => r.render)) != null
        ? +(med(spike.map((r) => r.render)) - med(calm.map((r) => r.render))).toFixed(2) : null,
    };
  };

  out.outdoor = analyse(await sample(11000));
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
  await page.waitForTimeout(4000);
  out.indoor = analyse(await sample(11000));

  const i = out.indoor;
  out.verdict = {
    inside: out.teleport?.inside ?? null,
    patched: out.patched,
    indoorSpikePct: i.spikePct,
    // The split, stated as one ratio.
    extraDtOnSpikeMs: i.extraDt,
    extraRenderOnSpikeMs: i.extraRender,
    shareOfSpikeInsideRenderPct: i.extraDt && i.extraRender != null
      ? +((i.extraRender / i.extraDt) * 100).toFixed(1) : null,
    renderCallsSpike: i.renderCallsSpike,
    renderCallsCalm: i.renderCallsCalm,
  };
  fs.writeFileSync(path.join(OUT, 'a1-render-vs-logic.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-SPLIT', JSON.stringify(out.verdict));
  console.log('  indoor ', JSON.stringify(out.indoor));
  console.log('  outdoor', JSON.stringify(out.outdoor));
  return out;
}

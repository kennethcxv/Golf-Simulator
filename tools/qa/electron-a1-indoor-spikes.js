// A1 — WHAT SHAPE ARE THE INDOOR SPIKES?
//
// Established: indoors, 21% of frames exceed 16.7 ms against 1% outdoors. Shadow
// bakes are 8.5% of frames, cost 18.7 ms each, and account for only ~1.2 points
// of the 21 — proved by sweeping the cadence to 1000 ms and watching the total
// barely move. So ~19 points live in NON-BAKE frames whose median is 5.0 ms.
//
// A low median with frequent large spikes is a distinctive shape and it narrows
// the field before any code is read:
//
//   - PERIODIC spikes at a fixed interval mean a timer or a clock-driven job.
//   - Spikes CORRELATED WITH DRAW-CALL JUMPS mean culling or LOD churn: work
//     appearing and disappearing from the frame.
//   - Spikes with NO correlate, irregularly spaced and clustered, look like GC.
//
// Each of those points somewhere different, so measure which one it is rather
// than picking the one that feels likeliest. Per frame this records dt, the bake
// counter, draw calls, triangles and JS heap where available, then reports the
// inter-arrival distribution of the over-16 frames and how the other quantities
// differ between spike and non-spike frames.
//
// THE CONTROL IS AGAIN FREE: the non-spike frames of the same run. And there is a
// second one worth having — the same measurement OUTDOORS, where the spike rate
// is 1%, so any correlate that also holds outdoors is a property of the engine
// rather than of the room.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-indoor-spikes.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-indoor-spikes');
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

  const sample = (ms) => page.evaluate((dur) => new Promise((resolve) => {
    const rows = [];
    const s3 = () => window.__fw?.scene3d;
    let prev = performance.now();
    let prevBakes = (() => { try { return s3().post.stats().shadowBakes; } catch { return 0; } })();
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      let bakes = prevBakes; let calls = null; let tris = null; let heap = null;
      try { bakes = s3().post.stats().shadowBakes; } catch { /* keep last */ }
      try { calls = s3().renderer.info.render.calls; tris = s3().renderer.info.render.triangles; } catch { /* none */ }
      try { heap = performance.memory ? performance.memory.usedJSHeapSize : null; } catch { heap = null; }
      rows.push({
        t: +(now - t0).toFixed(0),
        dt: +(now - prev).toFixed(2),
        bake: bakes - prevBakes > 0 ? 1 : 0,
        calls,
        tris,
        heap,
      });
      prev = now; prevBakes = bakes;
      if (now - t0 < dur) requestAnimationFrame(tick);
      else resolve(rows);
    };
    requestAnimationFrame(tick);
  }), ms);

  const analyse = (rows) => {
    const nonBake = rows.filter((r) => !r.bake);
    const spikes = nonBake.filter((r) => r.dt > 16.7);
    const calm = nonBake.filter((r) => r.dt <= 16.7);
    const mean = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null);
    // Inter-arrival gaps between consecutive non-bake spikes, in ms.
    const gaps = [];
    for (let i = 1; i < spikes.length; i += 1) gaps.push(spikes[i].t - spikes[i - 1].t);
    const sorted = gaps.slice().sort((a, b) => a - b);
    const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
    // Is the gap distribution tight (periodic) or spread (bursty)?
    const gapMedian = q(0.5);
    const gapIQR = sorted.length ? q(0.75) - q(0.25) : null;
    // Heap: does it FALL on a spike frame? A collection returns memory.
    const heapDrops = [];
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].heap != null && rows[i - 1].heap != null && rows[i].heap < rows[i - 1].heap) {
        heapDrops.push({ t: rows[i].t, dt: rows[i].dt, freedMB: +((rows[i - 1].heap - rows[i].heap) / 1048576).toFixed(1) });
      }
    }
    const dropOnSpike = heapDrops.filter((d) => d.dt > 16.7).length;
    return {
      frames: rows.length,
      nonBakeFrames: nonBake.length,
      spikes: spikes.length,
      spikePctOfNonBake: nonBake.length ? +((spikes.length / nonBake.length) * 100).toFixed(1) : null,
      // periodicity
      gapMedianMs: gapMedian,
      gapIQRMs: gapIQR,
      gapMinMs: sorted[0] ?? null,
      gapMaxMs: sorted[sorted.length - 1] ?? null,
      // draw-call / triangle correlate
      callsOnSpike: mean(spikes.map((r) => r.calls).filter((v) => v != null)),
      callsOnCalm: mean(calm.map((r) => r.calls).filter((v) => v != null)),
      trisOnSpike: mean(spikes.map((r) => r.tris).filter((v) => v != null)),
      trisOnCalm: mean(calm.map((r) => r.tris).filter((v) => v != null)),
      // GC correlate
      heapAvailable: rows.some((r) => r.heap != null),
      heapDrops: heapDrops.length,
      heapDropsOnSpike: dropOnSpike,
      heapDropSpikeSharePct: heapDrops.length ? +((dropOnSpike / heapDrops.length) * 100).toFixed(1) : null,
    };
  };

  // OUTDOORS FIRST, as the second control: whatever correlates with spikes there
  // too is the engine, not the room.
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
    return { ok: true, inside: !!ch.isInside(st.x, st.z, 0.35), x: +st.x.toFixed(2), z: +st.z.toFixed(2) };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));
  await page.waitForTimeout(4000);
  out.indoor = analyse(await sample(11000));

  out.verdict = {
    inside: out.teleport?.inside ?? null,
    indoorSpikePct: out.indoor.spikePctOfNonBake,
    outdoorSpikePct: out.outdoor.spikePctOfNonBake,
    // PERIODIC? A tight IQR around a stable median says yes.
    indoorGapMedianMs: out.indoor.gapMedianMs,
    indoorGapIQRMs: out.indoor.gapIQRMs,
    // CULLING/LOD? A draw-call or triangle gap between spike and calm says yes.
    indoorCallsGap: out.indoor.callsOnSpike != null && out.indoor.callsOnCalm != null
      ? +(out.indoor.callsOnSpike - out.indoor.callsOnCalm).toFixed(1) : null,
    indoorTrisGap: out.indoor.trisOnSpike != null && out.indoor.trisOnCalm != null
      ? +(out.indoor.trisOnSpike - out.indoor.trisOnCalm).toFixed(0) : null,
    // GC? Heap falling on spike frames says yes.
    heapAvailable: out.indoor.heapAvailable,
    indoorHeapDrops: out.indoor.heapDrops,
    indoorHeapDropSpikeSharePct: out.indoor.heapDropSpikeSharePct,
  };
  fs.writeFileSync(path.join(OUT, 'a1-indoor-spikes.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-SPIKES', JSON.stringify(out.verdict));
  console.log('  indoor ', JSON.stringify(out.indoor));
  console.log('  outdoor', JSON.stringify(out.outdoor));
  return out;
}

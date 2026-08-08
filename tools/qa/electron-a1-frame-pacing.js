// A1 — WHAT PACES THE FRAME LOOP, AND IS 16.7 ms EVEN THE RIGHT LINE?
//
// A number nobody has questioned: the indoor median frame is **5.7 ms** and the
// outdoor median is **8.7 ms**. Those are 175 Hz and 115 Hz. A vsync-locked loop
// cannot have two different medians in one session, and neither number is a
// refresh interval — so the loop appears to be running UNCAPPED, as fast as the
// machine allows.
//
// That matters for invariant 1's own definition. "No frame over 16 ms" is a
// 60 Hz budget. In an uncapped loop a 22 ms frame is still a real stall, but the
// FRACTION of frames over 16.7 ms is inflated by counting against a denominator
// of very fast frames — and the number the invariant reports is a rate, not a
// duration.
//
// This driver does not argue any of that. It measures the pacing regime:
//
//   - VSYNC-LOCKED shows a spiky histogram: a tall bin at the refresh interval
//     and smaller ones at exact multiples (16.7, 33.3, 50.0).
//   - UNCAPPED shows a continuous spread with no preferred bin.
//
// Reported for indoors and outdoors, because the two medians differ and the
// explanation has to cover both.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-frame-pacing.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-frame-pacing');
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
    let prev = performance.now();
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      rows.push(+(now - prev).toFixed(2));
      prev = now;
      if (now - t0 < dur) requestAnimationFrame(tick);
      else resolve(rows);
    };
    requestAnimationFrame(tick);
  }), ms);

  const analyse = (xs0) => {
    const xs = xs0.slice(1);
    // 1 ms bins up to 40 ms; anything above goes in the tail.
    const bins = new Array(41).fill(0);
    let tail = 0;
    for (const d of xs) {
      const b = Math.floor(d);
      if (b >= 0 && b <= 40) bins[b] += 1; else tail += 1;
    }
    const total = xs.length;
    const top = bins
      .map((n, ms) => ({ ms, n, pct: +((n / total) * 100).toFixed(1) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 8);
    const sorted = xs.slice().sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    // A vsync-locked loop concentrates: its busiest bin holds a large share and
    // the runners-up sit at multiples of it. An uncapped loop spreads.
    const busiest = top[0] || { ms: null, pct: 0 };
    return {
      n: total,
      median: +at(0.5).toFixed(2),
      p05: +at(0.05).toFixed(2),
      p95: +at(0.95).toFixed(2),
      over16pct: +((xs.filter((d) => d > 16.7).length / total) * 100).toFixed(1),
      busiestBinMs: busiest.ms,
      busiestBinPct: busiest.pct,
      topBins: top,
      tailOver40: tail,
    };
  };

  out.outdoor = analyse(await sample(10000));
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
  out.indoor = analyse(await sample(10000));

  out.verdict = {
    inside: out.teleport?.inside ?? null,
    outdoorMedian: out.outdoor.median,
    indoorMedian: out.indoor.median,
    outdoorBusiestBinMs: out.outdoor.busiestBinMs,
    outdoorBusiestBinPct: out.outdoor.busiestBinPct,
    indoorBusiestBinMs: out.indoor.busiestBinMs,
    indoorBusiestBinPct: out.indoor.busiestBinPct,
    // A locked loop's fastest frames cannot be much under the refresh interval.
    outdoorP05: out.outdoor.p05,
    indoorP05: out.indoor.p05,
  };
  fs.writeFileSync(path.join(OUT, 'a1-frame-pacing.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-PACING', JSON.stringify(out.verdict));
  console.log('  outdoor bins', JSON.stringify(out.outdoor.topBins));
  console.log('  indoor bins ', JSON.stringify(out.indoor.topBins));
  return out;
}

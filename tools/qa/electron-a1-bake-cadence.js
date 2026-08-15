// A1 — HOW MUCH OF INVARIANT 1 DOES THE BAKE CADENCE OWN?
//
// Established, reproduced twice, with a within-run control: indoors the sun
// shadow bake costs a median 18.6-22.0 ms against a 5.0-5.3 ms non-bake median,
// and 72-88% of bake frames exceed 16.7 ms. Outdoors the same bake costs ~1 ms.
//
// Before changing how bakes are scheduled, measure what changing it would buy.
// `setShadowQuality({ bakeMs })` already accepts 16..1000 ms at runtime
// (courseScene.js:10451), so the cadence can be swept WITHOUT touching a line of
// game code — which means this measurement cannot be contaminated by the fix it
// is meant to justify.
//
// WHY THE CADENCE IS EVEN A CANDIDATE. The walk fit snaps the shadow focus to
// the shadow texel grid: `texel = (span * 2) / size` = 240 / 2048 = 0.117 yd
// (courseScene.js:10415-10419). Standing still, `sun.target.position` and
// `sun.position` come out bit-identical bake after bake, so the shadow map is
// re-rendered to produce the same image. The snapping exists so a 10 Hz rebake
// "never swims as the player moves" — and it also makes most bakes redundant
// when the player does not.
//
// THE HAZARD THIS MEASUREMENT DOES NOT COVER, recorded so it is not forgotten:
// a slower cadence also slows every MOVING shadow caster — NPCs walking the
// clubhouse, a swinging tool, an opening door. The source says so itself at the
// setter: at 200 ms a character's shadow "lags perceptibly on a fast turn".
// This driver measures the frame-time headroom only. It is not a licence to
// raise the default.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-bake-cadence.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-bake-cadence');
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

  // Indoors, because that is where the cost is. Confirmed from `walk.state`,
  // not from the API fields — `w.x` is undefined and `isInside(undefined,
  // undefined)` answers "no" without complaining.
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
    return {
      ok: true,
      inside: !!ch.isInside(st.x, st.z, 0.35),
      x: +st.x.toFixed(2),
      z: +st.z.toFixed(2),
    };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));
  await page.waitForTimeout(4000);

  const sample = (ms) => page.evaluate((dur) => new Promise((resolve) => {
    const rows = [];
    const bakes = () => {
      try { return window.__fw.scene3d.post.stats().shadowBakes; } catch { return null; }
    };
    let prev = performance.now();
    let prevBakes = bakes();
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      const b = bakes();
      rows.push({ dt: +(now - prev).toFixed(2), dBakes: b === null || prevBakes === null ? null : b - prevBakes });
      prev = now; prevBakes = b;
      if (now - t0 < dur) requestAnimationFrame(tick);
      else resolve(rows);
    };
    requestAnimationFrame(tick);
  }), ms);

  const stat = (xs) => {
    if (!xs.length) return { n: 0 };
    const v = xs.slice().sort((a, b) => a - b);
    const at = (q) => v[Math.min(v.length - 1, Math.floor(v.length * q))];
    return {
      n: v.length,
      median: +at(0.5).toFixed(2),
      p95: +at(0.95).toFixed(2),
      worst: +v[v.length - 1].toFixed(2),
      over16pct: +((v.filter((d) => d > 16.7).length / v.length) * 100).toFixed(1),
    };
  };

  // 100 twice, at the start and at the END, so a drift in the machine across the
  // sweep shows up as a disagreement between two readings of the SAME setting
  // rather than masquerading as an effect of the setting.
  for (const bakeMs of [100, 200, 400, 1000, 100]) {
    // `(ms) => ... { bakeMs }` was a ReferenceError — the parameter is `ms` and
    // `bakeMs` is a Node-side variable that does not exist in the page. The
    // `.catch` turned it into the string "threw: bakeMs is not defined", and
    // `"threw: ...".bakeMs` is `undefined`, so the sweep reported
    // `appliedBakeMs: undefined` five times and swept nothing at all. The bake
    // SHARE staying pinned at 9.3% across a supposed 10x cadence change is what
    // gave it away: at 1000 ms it should have fallen to well under 1%.
    const applied = await page.evaluate((ms) => (
      window.__fw?.scene3d?.setShadowQuality?.({ bakeMs: ms }) ?? 'no setter'
    ), bakeMs).catch((e) => `threw: ${String(e && e.message)}`);
    // An assertion, not a hope: if the setter did not take, say so loudly rather
    // than sampling five identical configurations and calling it a ladder.
    if (!applied || applied.bakeMs !== bakeMs) {
      out.errs.push(`setShadowQuality did not apply bakeMs ${bakeMs}: ${JSON.stringify(applied)}`);
    }
    await page.waitForTimeout(1200);
    const rows = await sample(9000);
    const all = stat(rows.map((r) => r.dt));
    const bake = stat(rows.filter((r) => r.dBakes > 0).map((r) => r.dt));
    const idle = stat(rows.filter((r) => r.dBakes === 0).map((r) => r.dt));
    out.sweep.push({
      bakeMs,
      appliedBakeMs: applied && applied.bakeMs,
      all,
      bake,
      nonBake: idle,
      bakeSharePct: +((bake.n / all.n) * 100).toFixed(1),
    });
  }

  // Put it back, so nothing downstream inherits a swept value.
  out.restored = await page.evaluate(() => (
    window.__fw?.scene3d?.setShadowQuality?.({ bakeMs: 100 }) ?? 'no setter'
  )).catch(() => null);

  const first = out.sweep[0];
  const last = out.sweep[out.sweep.length - 1];
  out.verdict = {
    inside: out.teleport?.inside ?? null,
    // The drift control: two readings of bakeMs 100, nine seconds of sampling
    // apart. If these disagree by more than the effect, the sweep is void.
    control100aOver16pct: first.all.over16pct,
    control100bOver16pct: last.all.over16pct,
    controlGap: +Math.abs(first.all.over16pct - last.all.over16pct).toFixed(1),
    ladder: out.sweep.map((s) => `${s.bakeMs}ms:${s.all.over16pct}%`).join('  '),
    bestOver16pct: Math.min(...out.sweep.map((s) => s.all.over16pct)),
  };
  fs.writeFileSync(path.join(OUT, 'a1-bake-cadence.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-CADENCE', JSON.stringify(out.verdict));
  for (const s of out.sweep) {
    console.log(`  bakeMs ${String(s.bakeMs).padStart(4)} (applied ${s.appliedBakeMs})  all ${JSON.stringify(s.all)}`);
    console.log(`               bake ${JSON.stringify(s.bake)}  share ${s.bakeSharePct}%`);
  }
  return out;
}

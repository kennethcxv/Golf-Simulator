// A1 — IS THE INDOOR COST THE INTERIOR LIGHTING?
//
// One candidate fits every measurement taken so far:
//
//   - CPU time inside `renderer.render()` is flat (+1.7 ms of a +16.6 ms spike),
//     which is what you see when render() only QUEUES work and the GPU is the
//     one running late.
//   - Draw calls and triangles are byte-identical on spike and calm frames — the
//     same submission, taking longer to execute.
//   - Indoors submits a THIRD of the draw calls of outdoors and runs far worse,
//     so it is not how much is drawn but how expensive each pixel is.
//   - The pacing histogram shows miss-then-catch-up against a 120 Hz vsync, which
//     is the signature of a GPU that cannot finish inside the interval.
//
// Per-fragment cost scales with the number of lights the shader loops over, and
// a clubhouse interior is exactly where a pile of point lights lives.
//
// THE TEST, AND THE ONE THING IT MUST NOT DO. Set every interior light's
// intensity to 0 and measure again — but LEAVE THEM IN THE SCENE. three.js bakes
// light COUNTS into every program's cache key, so removing a light or toggling
// `visible` recompiles every material in view and the measurement would time a
// shader compile instead of a shading cost. This codebase has been bitten by
// that twice (A3's ledger, the first-equip stall), and both are on record.
// Intensity 0 keeps the count, keeps the programs, and removes the light.
//
// Three windows — lit, dark, lit — so the restore is a drift control.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-interior-lights.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-interior-lights');
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

  out.census = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const byType = {};
    let total = 0;
    let lit = 0;
    s3.scene.traverse((o) => {
      if (!o.isLight) return;
      total += 1;
      if ((o.intensity ?? 0) > 0) lit += 1;
      byType[o.type] = (byType[o.type] || 0) + 1;
    });
    return { total, lit, byType, programs: s3.renderer.info.programs?.length ?? null };
  }).catch((e) => ({ threw: String(e && e.message) }));

  // Intensity only. Never `visible`, never removal — see the header.
  const setLights = (dark) => page.evaluate((off) => {
    const s3 = window.__fw.scene3d;
    let touched = 0;
    s3.scene.traverse((o) => {
      if (!o.isLight) return;
      // The sun is what lights the world through the windows; killing it would
      // change the picture far beyond "the interior lamps are off". Only lights
      // that are NOT directional are interior fittings here.
      if (o.isDirectionalLight || o.isAmbientLight || o.isHemisphereLight) return;
      if (off) {
        if (o.__a1Saved === undefined) o.__a1Saved = o.intensity;
        o.intensity = 0;
      } else if (o.__a1Saved !== undefined) {
        o.intensity = o.__a1Saved;
        delete o.__a1Saved;
      }
      touched += 1;
    });
    return { touched, programs: s3.renderer.info.programs?.length ?? null };
  }, dark);

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

  const stat = (xs0) => {
    const v = xs0.slice(1).sort((a, b) => a - b);
    if (!v.length) return { n: 0 };
    const at = (q) => v[Math.min(v.length - 1, Math.floor(v.length * q))];
    return {
      n: v.length,
      median: +at(0.5).toFixed(2),
      p95: +at(0.95).toFixed(2),
      over16pct: +((v.filter((d) => d > 16.7).length / v.length) * 100).toFixed(1),
    };
  };

  out.lit1 = stat(await sample(9000));
  out.dark = await setLights(true);
  await page.waitForTimeout(1500);
  out.darkStats = stat(await sample(9000));
  out.restore = await setLights(false);
  await page.waitForTimeout(1500);
  out.lit2 = stat(await sample(9000));

  out.verdict = {
    inside: out.teleport?.inside ?? null,
    lightsTotal: out.census?.total ?? null,
    lightsDimmed: out.dark?.touched ?? null,
    // Programs must NOT move; if they do, this measured a compile.
    programsBefore: out.census?.programs ?? null,
    programsAfterDark: out.dark?.programs ?? null,
    programsAfterRestore: out.restore?.programs ?? null,
    litOver16pct: out.lit1.over16pct,
    darkOver16pct: out.darkStats.over16pct,
    litAgainOver16pct: out.lit2.over16pct,
    controlGap: +Math.abs(out.lit1.over16pct - out.lit2.over16pct).toFixed(1),
    effectPoints: +(((out.lit1.over16pct + out.lit2.over16pct) / 2) - out.darkStats.over16pct).toFixed(1),
    litMedian: out.lit1.median,
    darkMedian: out.darkStats.median,
  };
  fs.writeFileSync(path.join(OUT, 'a1-interior-lights.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-LIGHTS', JSON.stringify(out.verdict));
  console.log('  census', JSON.stringify(out.census));
  return out;
}

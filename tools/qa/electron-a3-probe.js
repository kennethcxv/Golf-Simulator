// A3 diagnostic probe: the prewarm ran and the number did not move, so find out
// what the open frame is ACTUALLY spending its time on before touching anything
// else. Reports the prewarm's own timing ledger, whether the ledger's visual
// prewarm was reachable when it ran, and then instruments the open frame from
// inside: renderer program count and draw calls sampled per frame across the
// press, so a compile shows up as a program delta and an upload does not.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a3-ledger');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(9000);

  out.prewarm = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const timings = s3.prewarmTimings ? s3.prewarmTimings() : null;
    const ch = s3.clubhouse?.();
    return {
      timings,
      hasClubhouse: !!ch,
      hasLedger: !!ch?.ledgerBook,
      hasPrewarmVisual: typeof ch?.ledgerBook?.prewarmVisual === 'function',
      glbReady: ch?.ledgerBook?.diagnostics?.()?.glbReady ?? null,
    };
  });

  // stage at the book
  await page.evaluate(() => {
    const fw = window.__fw;
    const walk = fw.scene3d.walk;
    const st = walk.state;
    const ch = fw.scene3d.clubhouse();
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 1.3;
    st.z = book.z + (to.z / len) * 1.3;
    st.yaw = Math.atan2(-(book.x - st.x), -(book.z - st.z));
    st.pitch = -0.3;
  });
  await page.waitForTimeout(1200);

  // Per-frame renderer telemetry across the press. A compile shows as a
  // program-count delta; a texture upload shows as neither, which is how the
  // two are told apart.
  await page.evaluate(() => {
    const s = { rows: [], pressAt: null, stop: false };
    window.__a3p = s;
    window.addEventListener('keydown', (e) => {
      if (s.pressAt == null && (e.key === 'e' || e.key === 'E')) s.pressAt = performance.now();
    }, true);
    const r = window.__fw.scene3d.renderer;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      s.rows.push({
        t: +now.toFixed(1),
        dt: +(now - last).toFixed(1),
        programs: r.info.programs ? r.info.programs.length : -1,
        calls: r.info.render.calls,
        tris: r.info.render.triangles,
        geoms: r.info.memory.geometries,
        texs: r.info.memory.textures,
        state: window.__fw.scene3d.clubhouse?.()?.ledgerBook?.diagnostics?.()?.state ?? null,
      });
      last = now;
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(1500);
  await page.keyboard.press('e');
  await page.waitForTimeout(5000);

  out.trace = await page.evaluate(() => {
    const s = window.__a3p;
    s.stop = true;
    const t0 = s.pressAt;
    const rows = s.rows.map((r) => ({ ...r, rel: +(r.t - t0).toFixed(1) }));
    const worst = rows.reduce((a, b) => (b.dt > a.dt ? b : a), rows[0]);
    const idx = rows.indexOf(worst);
    return {
      pressAt: t0,
      worst,
      // what the numbers did across the expensive frame
      around: rows.slice(Math.max(0, idx - 3), idx + 4),
      programsBefore: rows.find((r) => r.rel >= -200)?.programs ?? null,
      programsAfter: rows[rows.length - 1]?.programs ?? null,
      texsBefore: rows.find((r) => r.rel >= -200)?.texs ?? null,
      texsAfter: rows[rows.length - 1]?.texs ?? null,
      geomsBefore: rows.find((r) => r.rel >= -200)?.geoms ?? null,
      geomsAfter: rows[rows.length - 1]?.geoms ?? null,
    };
  });

  fs.writeFileSync(path.join(OUT, 'a3-probe.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A3PROBE prewarm', JSON.stringify(out.prewarm));
  console.log('A3PROBE trace', JSON.stringify(out.trace));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}

// B2 — WHAT DOES A DENSE BROOM HEAD ACTUALLY COST?
//
// The 720-bristle head was shipped (0128a86) and then reverted on a single-sample
// comparison of the tool-equip frame: 8282 ms at 720 against 2770 ms at 200. That
// conviction has since been RETRACTED — the equip frame is dominated by a shader
// compile with 4.4x run-to-run variance at fixed configuration, so both numbers
// were draws from the same noisy distribution and the difference between them was
// not evidence of anything. The revert was kept anyway, and the source comment at
// toolViewmodel.js:541 still cites the retracted measurement as fact.
//
// So the cost question is genuinely open, and this driver answers it the way the
// earlier attempt did not:
//
//   - A DISTRIBUTION, not a sample. Frame times are sampled continuously and
//     reported as median / p95 / worst over hundreds of frames per phase.
//   - THE RIGHT FRAME. The equip frame is the noisiest thing in the build and the
//     least relevant to "does a denser head cost more to draw". What matters is
//     STEADY STATE with the broom held, and steady state WHILE SWINGING, because
//     the strand sim runs per strand per frame.
//   - A DRIFT CONTROL. `idleNoTool` is measured first, in the same run, with no
//     tool equipped. It is identical between the 200 and 720 builds, so if it
//     moves between runs the machine moved and the comparison is void.
//   - THE DRAW-CALL CLAIM, CHECKED. The source asserts the fibres are instanced
//     and therefore "the draw call count does not move". That is one number and
//     nobody has ever read it. If it is true, density costs vertex work and CPU
//     sim, not draws, and the honest budget conversation is a different one.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-b2-broom-cost.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b2-broom-cost');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], phases: {} };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  // An unfocused window rAF-throttles to ~1 fps and manufactures second-long
  // frames out of nothing. Every frame number below depends on this line.
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(6000);

  await page.evaluate(() => {
    const s = { rows: [], phase: 'settle', stop: false };
    window.__b2 = s;
    window.__b2phase = (n) => { s.phase = n; };
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      s.rows.push({ dt: +(now - last).toFixed(2), phase: s.phase });
      last = now;
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const phase = (n) => page.evaluate((x) => window.__b2phase(x), n);

  // INSIDE THE CLUBHOUSE, because the cleaning kit is gated on it. A driver that
  // skips this gets an empty tool wheel and then spends six hypotheses on the
  // rig. Teleporting to the ledger's stand point is the shortest way in that the
  // walk driver already proves works.
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
    // 3 yards past the book, INTO the room, so the player is on open floor and
    // not nose-to-nose with the desk the way the B1 capture was.
    st.x = book.x + (to.x / len) * 3.0;
    st.z = book.z + (to.z / len) * 3.0;
    st.pitch = -0.35;
    return { ok: true, x: +st.x.toFixed(2), z: +st.z.toFixed(2) };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));
  await page.waitForTimeout(2500);

  const info = () => page.evaluate(() => {
    const r = window.__fw?.scene3d?.renderer;
    return r ? {
      calls: r.info.render.calls,
      triangles: r.info.render.triangles,
      programs: r.info.programs?.length ?? null,
      geometries: r.info.memory.geometries,
    } : null;
  }).catch(() => null);

  // 1. THE DRIFT CONTROL. No tool, nothing equipped, the same scene. This phase
  //    is IDENTICAL between the 200 and 720 builds by construction, so it is the
  //    only thing that can tell "the head got dearer" from "the machine did".
  await phase('idleNoTool');
  await page.waitForTimeout(5000);
  out.infoNoTool = await info();

  const keys = await page.evaluate(() => window.__fw.preferences?.values?.controls?.bindings || {});
  await phase('equip');
  await page.keyboard.down(keys.toolBelt || 'f');
  await page.waitForTimeout(450);
  const wheel = await page.evaluate(() => {
    const el = document.querySelector('.tool-wheel');
    return el ? [...el.querySelectorAll('.tool-wheel-item')]
      .map((b) => b.querySelector('.tool-wheel-label')?.textContent || '') : [];
  });
  const hasBroom = wheel.some((l) => /broom/i.test(l));
  if (hasBroom) await page.keyboard.press('b');
  await page.waitForTimeout(250);
  await page.keyboard.up(keys.toolBelt || 'f');
  await page.waitForTimeout(2500);
  out.wheel = wheel;
  out.equipped = await page.evaluate(() => window.__fw?.scene3d?.walk?.getTool?.() ?? 'none').catch(() => null);

  // 2. STEADY STATE, BROOM HELD, NOT SWINGING. Draw cost only.
  await phase('idleBroom');
  await page.waitForTimeout(5000);
  out.infoBroom = await info();

  // 3. STEADY STATE, SWINGING. Draw cost plus the per-strand CPU sim, which is
  //    where a 3.6x strand count would actually show up if it shows up anywhere.
  await phase('sweeping');
  await page.mouse.down();
  await page.waitForTimeout(6000);
  out.infoSweeping = await info();
  await page.mouse.up();
  await page.waitForTimeout(500);

  out.rigCount = await page.evaluate(() => {
    const d = window.__fw?.scene3d?.walk?.toolRigDiagnostics?.('broom');
    return d ? { headNdc: d.headNdc, strokeX: d.strokeX, intensity: d.intensity } : null;
  }).catch(() => null);

  // THE PICTURE, LAST, so that looking cannot perturb what was measured.
  //
  // B2 is a claim about how the head READS — "separated tines rather than a
  // brush" — and no triangle count answers that. Look down at the default
  // camera and shoot; the head sits ~60 degrees below a level gaze and is not in
  // frame until you do (measured on the mop: NDC y -1.296 level, -0.129 down).
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(750);
  await page.keyboard.up('ArrowDown');
  await page.waitForTimeout(500);
  out.shotNdc = await page.evaluate(() => {
    const d = window.__fw?.scene3d?.walk?.toolRigDiagnostics?.('broom');
    return {
      headNdc: d?.headNdc ?? null,
      pitch: +(window.__fw?.scene3d?.camera?.rotation?.x ?? 0).toFixed(3),
      fov: window.__fw?.scene3d?.camera?.fov ?? null,
      css: { w: window.innerWidth, h: window.innerHeight },
      dpr: window.devicePixelRatio,
    };
  }).catch(() => null);
  await page.screenshot({ path: path.join(OUT, 'broom-head.png') });
  out.shot = 'broom-head.png';

  await page.evaluate(() => { window.__b2.stop = true; });
  const rows = await page.evaluate(() => window.__b2.rows);
  const stat = (name) => {
    const v = rows.filter((r) => r.phase === name).map((r) => r.dt).sort((a, b) => a - b);
    if (!v.length) return { n: 0 };
    const at = (q) => v[Math.min(v.length - 1, Math.floor(v.length * q))];
    return {
      n: v.length,
      median: +at(0.5).toFixed(2),
      p95: +at(0.95).toFixed(2),
      worst: +v[v.length - 1].toFixed(2),
      over16: v.filter((d) => d > 16.7).length,
    };
  };
  for (const p of ['idleNoTool', 'equip', 'idleBroom', 'sweeping']) out.phases[p] = stat(p);

  out.verdict = {
    equipped: out.equipped,
    // The claim under test, as one number per phase.
    callsNoTool: out.infoNoTool?.calls ?? null,
    callsBroom: out.infoBroom?.calls ?? null,
    callsSweeping: out.infoSweeping?.calls ?? null,
    callsAddedByBroom: (out.infoBroom?.calls ?? 0) - (out.infoNoTool?.calls ?? 0),
    trianglesAddedByBroom: (out.infoBroom?.triangles ?? 0) - (out.infoNoTool?.triangles ?? 0),
    driftControlMedian: out.phases.idleNoTool?.median ?? null,
    sweepingMedian: out.phases.sweeping?.median ?? null,
  };
  fs.writeFileSync(path.join(OUT, 'b2-broom-cost.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('B2-COST', JSON.stringify(out.verdict));
  for (const p of ['idleNoTool', 'equip', 'idleBroom', 'sweeping']) {
    console.log(`  ${p.padEnd(12)} ${JSON.stringify(out.phases[p])}`);
  }
  return out;
}

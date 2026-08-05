// C2, RE-VERIFIED AFTER THE FIX — and the fix's own risk, tested.
//
// The C2 fix caps the HANDS at the height from which the handle can still reach
// the boards. That kills the head-rise number. It also means that above the cap
// the hands stop climbing while the view keeps going, and hands that detach
// from the camera are their own bug. This driver exists to answer that with
// pictures and with the cap's own magnitude, not with the head number again.
//
// It produces three things:
//   1. a 6 s level -> full up -> level pan, sampled every animation frame
//      (VIDEO_DIR=... records it as well)
//   2. a flip-book of stills across the same range, so the pan can be READ
//      rather than watched
//   3. hand crops at the top of the range, where the cap is fully engaged
//
// …plus the A8 sleeve sub-item, which was closed on an audit table and never
// looked at. Crops centred on each forearm's elbow->wrist midpoint at the two
// poses a player actually holds.
//
// Usage:
//   VIDEO_DIR=qa/electron/broom-c2 node tools/qa/run-electron.cjs tools/qa/broom-c2-reverify.js
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/broom-c2');
  fs.mkdirSync(OUT, { recursive: true });
  const W = 1600; const H = 900;

  await page.setViewportSize({ width: W, height: H });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    // open floor, facing a plain wall, so the only thing moving is the broom
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2;
    w.state.pitch = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    document.querySelectorAll('.hud,.hud-min,.shop-lockhint,.notification-center,.walk-overlay,.objectives-card')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.mouse.click(W / 2, H / 2);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForFunction(() => window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive === true,
    null, { timeout: 30000 });
  await page.waitForTimeout(2600);

  // ---- 1. the pan, sampled per animation frame ---------------------------
  const trace = await page.evaluate(async () => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const camera = app.scene3d.camera;
    const LIMIT = 1.35; // mouseLook.js PITCH_LIMIT
    const DURATION = 6000;
    const rows = [];
    const started = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - started) / DURATION;
        const phase = t < 0.5 ? t / 0.5 : (1 - t) / 0.5;
        const e = Math.max(0, Math.min(1, phase));
        w.state.pitch = LIMIT * (e * e * (3 - 2 * e));
        const d = w.broomDiagnostics ? w.broomDiagnostics() : null;
        rows.push({
          ms: Math.round(performance.now() - started),
          pitch: +w.state.pitch.toFixed(3),
          headAboveFloor: d ? d.headAboveFloor : null,
          headWorldY: d ? d.assetHeadWorldY : null,
          gripWorldY: d ? d.assetGripWorldY : null,
          // the cap, measured rather than inferred
          gripCamWorldY: d ? d.gripCamWorldY : null,
          gripCapYd: d ? d.gripCapYd : null,
          gripStowYd: d ? d.gripStowYd : null,
          handNdcUpperY: d && d.handNdcUpper ? d.handNdcUpper.y : null,
          handNdcLowerY: d && d.handNdcLower ? d.handNdcLower.y : null,
          headNdcY: d && d.assetHeadNdc ? d.assetHeadNdc.y : null,
          // if the hands are held while the shoulders ride the camera, THIS is
          // where the cost lands: the forearm has to cover more ground.
          reachGapR: d && d.arms && d.arms.right ? d.arms.right.reachGapYd : null,
          reachGapL: d && d.arms && d.arms.left ? d.arms.left.reachGapYd : null,
          armVisR: d && d.arms && d.arms.right ? d.arms.right.visibleFrac : null,
          armVisL: d && d.arms && d.arms.left ? d.arms.left.visibleFrac : null,
          camY: +camera.position.y.toFixed(3),
          geomSource: d ? d.geomSource : null,
        });
        if (performance.now() - started >= DURATION) { resolve(rows); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });

  // ---- 2. the flip-book --------------------------------------------------
  const settle = async (pitch) => {
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
    await page.waitForTimeout(700);
    return page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics());
  };
  const STOPS = [0, 0.20, 0.40, 0.60, 0.80, 0.90, 1.00, 1.10, 1.20, 1.35];
  const book = [];
  for (let i = 0; i < STOPS.length; i += 1) {
    const d = await settle(STOPS[i]);
    const name = `pan-${String(i).padStart(2, '0')}-p${STOPS[i].toFixed(2).replace('.', 'p')}.png`;
    await page.screenshot({ path: path.join(OUT, name) });
    book.push({
      pitch: STOPS[i],
      file: name,
      headAboveFloor: d.headAboveFloor,
      gripCapYd: d.gripCapYd,
      gripStowYd: d.gripStowYd,
      handNdcUpper: d.handNdcUpper,
      handNdcLower: d.handNdcLower,
      reachGap: { right: d.arms?.right?.reachGapYd ?? null, left: d.arms?.left?.reachGapYd ?? null },
      armVisible: { right: d.arms?.right?.visibleFrac ?? null, left: d.arms?.left?.visibleFrac ?? null },
    });
  }

  // ---- 3. crops ----------------------------------------------------------
  const px = (ndc) => ({
    x: ((ndc.x + 1) / 2) * W,
    y: ((1 - ndc.y) / 2) * H,
  });
  const crop = async (centreNdc, size, name) => {
    if (!centreNdc) return null;
    const c = px(centreNdc);
    const x = Math.max(0, Math.min(W - size, Math.round(c.x - size / 2)));
    const y = Math.max(0, Math.min(H - size, Math.round(c.y - size / 2)));
    await page.screenshot({ path: path.join(OUT, name), clip: { x, y, width: size, height: size } });
    return { name, x, y, size, centrePx: { x: Math.round(c.x), y: Math.round(c.y) } };
  };
  const mid = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null);

  const crops = [];
  const sleeves = [];
  // the two poses a player actually holds, for the SLEEVE question
  for (const [label, pitch] of [['level', 0], ['work', -0.36]]) {
    const d = await settle(pitch);
    // The rig runs wrist -> forearm -> ELBOW -> rolled cuff -> sleeve -> off-frame
    // shoulder. So the cuff and the whole sleeve sit BEYOND the elbow: if the
    // elbow is off the bottom of the frame, no sleeve pixel can be on screen,
    // and "the sleeves look right" is not a claim a screenshot can support.
    for (const side of ['right', 'left']) {
      const a = d.arms?.[side];
      if (!a) continue;
      sleeves.push({
        pose: label,
        side,
        elbowNdc: a.elbowNdc,
        wristNdc: a.wristNdc,
        elbowOnScreen: Math.abs(a.elbowNdc.x) <= 1 && Math.abs(a.elbowNdc.y) <= 1,
        forearmVisibleFrac: a.visibleFrac,
        reachGapYd: a.reachGapYd,
      });
    }
    await page.screenshot({ path: path.join(OUT, `sleeve-${label}-full.png`) });
    crops.push(await crop(mid(d.arms?.right?.elbowNdc, d.arms?.right?.wristNdc), 560, `sleeve-${label}-right.png`));
    crops.push(await crop(mid(d.arms?.left?.elbowNdc, d.arms?.left?.wristNdc), 560, `sleeve-${label}-left.png`));
    crops.push(await crop(d.handNdcUpper, 420, `sleeve-${label}-cuff-upper.png`));
    crops.push(await crop(d.handNdcLower, 420, `sleeve-${label}-cuff-lower.png`));
  }
  // and the top of the range, where the cap is fully engaged — the C2 risk
  for (const pitch of [1.00, 1.35]) {
    const d = await settle(pitch);
    const tag = `p${pitch.toFixed(2).replace('.', 'p')}`;
    await page.screenshot({ path: path.join(OUT, `capped-${tag}-full.png`) });
    crops.push(await crop(d.handNdcUpper, 520, `capped-${tag}-upper.png`));
    crops.push(await crop(d.handNdcLower, 520, `capped-${tag}-lower.png`));
  }
  await settle(0);

  // ---- verdict numbers ---------------------------------------------------
  const at = (p) => trace.reduce((best, r) => (
    Math.abs(r.pitch - p) < Math.abs(best.pitch - p) ? r : best), trace[0]);
  const level = at(0);
  const full = at(1.35);
  const capEngages = trace.filter((r) => (r.gripCapYd ?? 0) > 0.001);
  const summary = {
    frames: trace.length,
    geomSource: trace[0]?.geomSource ?? null,
    // C2's original acceptance, re-measured over the REAL pitch range
    headLiftYd: (level.headAboveFloor != null && full.headAboveFloor != null)
      ? +(full.headAboveFloor - level.headAboveFloor).toFixed(3) : null,
    maxHeadAboveFloor: +Math.max(...trace.map((r) => r.headAboveFloor ?? -Infinity)).toFixed(3),
    // the fix's own cost
    capFirstEngagesAtPitch: capEngages.length ? Math.min(...capEngages.map((r) => r.pitch)) : null,
    capYdAtFullUp: full.gripCapYd,
    handsHeldYd: +(full.gripWorldY - level.gripWorldY).toFixed(3),
    // does anything leave the frame, or stretch, because of it?
    handNdcUpperRange: [
      +Math.min(...trace.map((r) => r.handNdcUpperY ?? 9)).toFixed(3),
      +Math.max(...trace.map((r) => r.handNdcUpperY ?? -9)).toFixed(3),
    ],
    handNdcLowerRange: [
      +Math.min(...trace.map((r) => r.handNdcLowerY ?? 9)).toFixed(3),
      +Math.max(...trace.map((r) => r.handNdcLowerY ?? -9)).toFixed(3),
    ],
    handsLeaveFrame: trace.some((r) => (r.handNdcUpperY != null && Math.abs(r.handNdcUpperY) > 1)
      || (r.handNdcLowerY != null && Math.abs(r.handNdcLowerY) > 1)),
    maxReachGapYd: +Math.max(...trace.map((r) => Math.max(r.reachGapR ?? 0, r.reachGapL ?? 0))).toFixed(3),
    minArmVisible: +Math.min(...trace.map((r) => Math.min(r.armVisR ?? 1, r.armVisL ?? 1))).toFixed(3),
  };
  // The hands DO leave the frame at extreme up-look, and that is correct — you
  // cannot see your own hands while craning at the ceiling. What must not happen
  // is the handle staying behind without them, so the acceptance is that the
  // stow tracks the cap everywhere the cap engages. The frame itself is judged
  // from the flip-book; no number can do that part.
  const stowRows = trace.filter((r) => (r.gripCapYd ?? 0) > 0.001);
  const checks = {
    headStaysPut: summary.headLiftYd != null && Math.abs(summary.headLiftYd) <= 0.05,
    capDoesEngage: summary.capYdAtFullUp > 0.05,
    stowFollowsCap: stowRows.length > 0 && stowRows.every((r) => (r.gripStowYd ?? 0) > 0),
    // the whole working range — everything at or below the horizon, and the
    // carried band above it up to where the handle runs out of reach — must be
    // untouched by any of this
    stowLeavesTheWorkingRangeAlone: trace.every((r) => r.pitch > 0.74 || (r.gripStowYd ?? 0) === 0),
    armsDoNotStretch: summary.maxReachGapYd <= 0.02,
  };
  fs.writeFileSync(path.join(OUT, 'c2-reverify.json'),
    `${JSON.stringify({
      summary, checks, book, sleeves, crops: crops.filter(Boolean), trace,
    }, null, 1)}\n`);
  return {
    summary, checks, book, sleeves, ok: Object.values(checks).every(Boolean),
  };
}

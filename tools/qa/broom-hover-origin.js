// A8 QUESTION: "what is the 0.600 measuring, and from what origin? If 0.600 is
// head-above-floor, floorKiss is gone and the fix pinned the head at a constant
// height rather than anchoring it."
//
// The answer has to come off the running build, because the two readings that
// distinguish the good case from the bad one are IDENTICAL at level look:
//
//   GOOD  — hover = carryHover*(1-workBlend) + floorKiss*workBlend.
//           0.600 is head-above-floor at the CARRIED end of a blend whose other
//           end is floorKiss. Look down and the head descends to ~0.012.
//   BAD   — the head is pinned at 0.600 above the boards at every pitch.
//           floorKiss is dead code and the broom never touches anything.
//
// Both print "0.600" at pitch 0. Only a SWEEP tells them apart, so this driver
// measures the three pitches asked for plus a steep control, and reports the
// blend's own inputs (workBlend, the two constants, the raw world heights)
// alongside the result so the number can be checked against its own arithmetic
// rather than believed.
//
// NEGATIVE CONTROL: at pitch -1.0 the pose is fully planted (workBelow -0.40),
// so headAboveFloor MUST read ~floorKiss. If it reads 0.600 there too, the head
// is pinned and the answer to the question is "floorKiss is gone".
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/broom-hover-origin');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1280, height: 720 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  // The authored constants, read from the LIVE module rather than the source
  // file — a driver that quotes the file cannot notice a build serving
  // something else. Electron resolves a leading slash to the drive root, so the
  // specifier is built from document.baseURI.
  const constants = await page.evaluate(async () => {
    const mod = await import(new URL('src/data/broomFeel.js', document.baseURI).href);
    const feel = mod.BROOM_FEEL || mod.default;
    return {
      carryHover: feel.compose.carryHover,
      floorKiss: feel.surface.floorKiss,
      carryAbove: feel.pitch.carryAbove,
      workBelow: feel.pitch.workBelow,
    };
  });

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    document.querySelectorAll('.hud,.hud-min,.shop-lockhint,.notification-center,.walk-overlay,.objectives-card')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.mouse.click(640, 360);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2600);

  const rows = [];
  // The three the question asks for, plus a steep control at each end. Ordered
  // high-to-low so the settle at each step is a small move.
  // D7: THE SURVIVING COPY OF THE C2 INCIDENT.
  //
  // This stopped at +0.30 — BROOM_FEEL.pitch.maxPitch, which is a reach-curve
  // clamp and not the look limit. mouseLook.js owns PITCH_LIMIT (1.35), so the
  // whole band from +0.30 to full up-look was outside every reading this driver
  // ever took. The top of the sweep now comes from that module.
  const LOOK_LIMIT = await page.evaluate(async () => (await import(
    new URL('src/render3d/mouseLook.js', document.baseURI).href)).PITCH_LIMIT);
  for (const pitch of [LOOK_LIMIT, 0.60, 0.30, 0.0, -0.30, -1.00]) {
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
    // The pitch-driven reach is an eased follower (followRate 10/s), so a
    // reading taken immediately after the set measures the PREVIOUS pose.
    await page.waitForTimeout(900);
    const d = await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics());
    rows.push({
      pitch,
      headAboveFloor: d.headAboveFloor,
      workBlend: d.workBlend,
      assetHeadWorldY: d.assetHeadWorldY,
      assetGripWorldY: d.assetGripWorldY,
      headNdcY: d.assetHeadNdc ? d.assetHeadNdc.y : null,
      geomSource: d.geomSource,
      // What the blend SHOULD produce for this workBlend, from the live
      // constants. If measured and predicted disagree, the drawn head is not
      // where the solve thinks it is — which is the whole reason this reads the
      // asset socket rather than the solve's own intent.
      predicted: d.workBlend == null ? null
        : +(constants.carryHover * (1 - d.workBlend) + constants.floorKiss * d.workBlend).toFixed(3),
    });
    await page.screenshot({ path: path.join(OUT, `pitch${String(pitch).replace('.', 'p').replace('-', 'neg')}.png`) });
  }

  const at = (p) => rows.find((r) => r.pitch === p) || {};
  const steep = at(-1.00);
  const level = at(0.0);
  const controlOk = steep.headAboveFloor != null
    && Math.abs(steep.headAboveFloor - constants.floorKiss) < 0.05;

  return {
    constants,
    controlOk,
    controlNote: controlOk
      ? `planted end reads ${steep.headAboveFloor} yd against floorKiss ${constants.floorKiss} — the head descends, so 0.600 is one END of a blend, not a pin`
      : `CONTROL FAILED: planted end reads ${steep.headAboveFloor}, expected ~${constants.floorKiss}. The head is pinned and floorKiss is dead.`,
    // The headline the question asks for.
    answer: {
      measures: 'yards from the DRAWN bristle socket down to the floor beneath it',
      origin: 'the floor surface under the head (floorY at the head x/z), not the hands and not the camera',
      levelLook: level.headAboveFloor,
      plantedLook: steep.headAboveFloor,
      floorKissAlive: controlOk,
    },
    // Every row's measured value against what the blend predicts. Agreement
    // across four different workBlends is what makes this an anchor rather
    // than a coincidence at one pose.
    predictionAgreement: rows.map((r) => ({
      pitch: r.pitch,
      workBlend: r.workBlend,
      measured: r.headAboveFloor,
      predicted: r.predicted,
      delta: (r.headAboveFloor != null && r.predicted != null)
        ? +(r.headAboveFloor - r.predicted).toFixed(3) : null,
    })),
    rows,
  };
}

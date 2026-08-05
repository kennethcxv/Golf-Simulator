// C2 — "THE BROOM STILL RISES WHEN I LOOK UP."
//
// A8 reported 0.002 yd of lift and called it fixed. This driver exists to be
// watched, not read: six seconds of level -> full up -> level with the broom in
// hand, plus a per-ANIMATION-FRAME sample of the four quantities that could each
// separately explain "it rises":
//
//   headWorldY   — the drawn bristle socket's world height (the world anchor)
//   headAboveFloor — the same thing minus the floor (what A8 measured)
//   headNdcY     — where it lands ON SCREEN (a world-anchored head can still
//                  climb the frame; they are different claims)
//   gripWorldY   — the hands, which ride camera.matrixWorld unconditionally
//
// …and pitch itself, because the A8 sweep stopped at +0.30 on the belief that
// broomFeel's maxPitch was the look limit. mouseLook.js clamps at ±1.35.
//
// Usage:
//   VIDEO_DIR=qa/broom-c2 node tools/qa/run-playwright.cjs tools/qa/broom-lookup-clip.js
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/broom-c2');
  fs.mkdirSync(OUT, { recursive: true });
  const bootUrl = `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`;
  const { clickThroughMenu } = await import(bootUrl);
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  // Stand in open floor facing an empty wall so nothing but the broom moves.
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2;
    w.state.pitch = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    document.querySelectorAll('.hud,.hud-min,.shop-lockhint,.notification-center,.walk-overlay,.objectives-card')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.mouse.click(640, 360);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2600);

  // The pan, driven from inside rAF so the sampling and the motion cannot
  // disagree about which frame is which.
  const trace = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const w = app.scene3d.walk;
    const camera = app.scene3d.camera;
    // the real look limit, read from the module that clamps it
    const { PITCH_LIMIT: LIMIT } = await import(new URL('src/render3d/mouseLook.js', document.baseURI).href);
    const DURATION = 6000;
    const rows = [];
    const started = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - started) / DURATION;   // 0..1
        // level -> full up -> level, eased so it reads as a pan not a snap
        const phase = t < 0.5 ? t / 0.5 : (1 - t) / 0.5;
        const e = Math.max(0, Math.min(1, phase));
        w.state.pitch = LIMIT * (e * e * (3 - 2 * e));
        const d = w.broomDiagnostics ? w.broomDiagnostics() : null;
        rows.push({
          ms: Math.round(performance.now() - started),
          pitch: +w.state.pitch.toFixed(3),
          headAboveFloor: d ? d.headAboveFloor : null,
          headWorldY: d ? d.assetHeadWorldY : null,
          headNdcY: d && d.assetHeadNdc ? +d.assetHeadNdc.y.toFixed(3) : null,
          gripWorldY: d ? d.assetGripWorldY : null,
          workBlend: d ? d.workBlend : null,
          shaftDrop: d ? d.shaftDrop : null,
          camY: +camera.position.y.toFixed(3),
          // the sockets come from the GLB when it loads and from the fallback
          // rig when it does not, and the two put the grip in different places.
          // Comparing two runs without this compares two different brooms.
          geomSource: d ? d.geomSource : null,
        });
        if (performance.now() - started >= DURATION) { resolve(rows); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });

  // Stills at the three beats, for a side-by-side that does not need a player.
  const still = async (pitch, name) => {
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, name) });
  };
  await still(0, 'a-level.png');
  await still(0.60, 'b-up-0p60.png');
  await still(1.00, 'c-up-1p00.png');
  await still(1.35, 'd-up-full.png');
  await still(0, 'e-back-to-level.png');

  const at = (p) => trace.reduce((best, r) => (
    Math.abs(r.pitch - p) < Math.abs(best.pitch - p) ? r : best), trace[0]);
  const level = at(0);
  const full = at(1.35);
  const summary = {
    frames: trace.length,
    geomSource: trace[0] ? trace[0].geomSource : null,
    pitchRangeSwept: [Math.min(...trace.map((r) => r.pitch)), Math.max(...trace.map((r) => r.pitch))],
    // The A8 sweep stopped here. Everything above it was never measured.
    a8SweepCeiling: 0.30,
    level: {
      pitch: level.pitch, headAboveFloor: level.headAboveFloor, headNdcY: level.headNdcY, gripWorldY: level.gripWorldY,
    },
    fullUp: {
      pitch: full.pitch, headAboveFloor: full.headAboveFloor, headNdcY: full.headNdcY, gripWorldY: full.gripWorldY,
    },
    liftYd: (level.headAboveFloor != null && full.headAboveFloor != null)
      ? +(full.headAboveFloor - level.headAboveFloor).toFixed(3) : null,
    maxHeadAboveFloor: Math.max(...trace.map((r) => r.headAboveFloor ?? -Infinity)),
    // is the head still on screen at the top of the pan?
    ndcSpread: [Math.min(...trace.map((r) => r.headNdcY ?? 0)), Math.max(...trace.map((r) => r.headNdcY ?? 0))],
  };
  fs.writeFileSync(path.join(OUT, 'lookup-trace.json'),
    `${JSON.stringify({ summary, trace }, null, 1)}\n`);
  return summary;
}

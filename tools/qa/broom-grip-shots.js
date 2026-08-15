// I4 — the grip, at the player camera and at crop.
//
// Full frames at rest and mid-sweep, plus 420-px crops centred on each hand
// (computed from the rig's own hand NDCs, cropped node-side with sharp): the
// D2 lesson is that a hand is ~90 px in a full frame and every grip judgement
// made at that size was wrong.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd().replace(/\\/g, '/')}/package.json`);
  let sharp = null;
  try { sharp = require2('sharp'); } catch { /* crops skipped */ }
  const OUT = path.resolve(process.env.GRIP_OUT || 'qa/electron/broom-grip-i4');
  fs.mkdirSync(OUT, { recursive: true });
  const W = 1600; const H = 900;

  await page.setViewportSize({ width: W, height: H });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 13 * 60;
    app.speedIdx = 0;
  });
  await page.mouse.click(W / 2, H / 2);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForFunction(() => window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive === true,
    null, { timeout: 30000 });
  await page.waitForTimeout(2400);

  const crop = async (buf, ndc, name) => {
    if (!sharp || !ndc) return null;
    // The screenshot buffer is DEVICE pixels (DPR-scaled), not the CSS
    // viewport - the first cut assumed 1600x900 and every crop landed
    // up-left of its hand on this 1.5-DPR window. Scale by the real PNG size.
    const meta = await sharp(buf).metadata();
    const sx = meta.width / W;
    const sy = meta.height / H;
    const px = Math.round(((ndc.x + 1) / 2) * W * sx);
    const py = Math.round(((1 - ndc.y) / 2) * H * sy);
    const half = Math.round(210 * sx);
    const left = Math.max(0, Math.min(meta.width - 2 * half, px - half));
    const top = Math.max(0, Math.min(meta.height - 2 * half, py - half));
    const file = path.join(OUT, name);
    await sharp(buf).extract({ left, top, width: 2 * half, height: 2 * half }).toFile(file);
    return name;
  };

  const shoot = async (label, pitch, using) => {
    await page.evaluate(({ p, u }) => {
      const w = window.__fw.scene3d.walk;
      w.state.pitch = p;
      w.setSpraying(u);
    }, { p: pitch, u: using });
    await page.waitForTimeout(using ? 1100 : 800);
    const buf = await page.screenshot({ path: path.join(OUT, `${label}.png`) });
    const d = await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics());
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
    return {
      file: `${label}.png`,
      handNdcUpper: d.handNdcUpper,
      handNdcLower: d.handNdcLower,
      cropUpper: await crop(buf, d.handNdcUpper, `${label}-crop-upper.png`),
      cropLower: await crop(buf, d.handNdcLower, `${label}-crop-lower.png`),
      seatError: d.seatError,
    };
  };

  const rest = await shoot('rest', 0, false);
  const sweep = await shoot('sweep', -0.36, true);
  const out = {
    rest, sweep,
    checks: {
      bothHandsTracked: !!(sweep.handNdcUpper && sweep.handNdcLower),
      // the seat error EQUALS handShaftOffset by design (the palm rests ON the
      // shaft, one offset off the socket) - the first cut of this check used a
      // bare 0.02 and failed the correct pose
      seated: Math.abs(sweep.seatError - 0.034) < 0.012,
    },
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'grip-shots.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

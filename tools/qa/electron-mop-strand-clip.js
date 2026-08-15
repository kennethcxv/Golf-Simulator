// B3 — THE CLIP. "The measurement is not the claim. Watch a clip."
//
// electron-mop-strands-trail.js carries the numbers and the controls. This
// exists only to be watched, so it is framed for the eye rather than for a
// probe: the view is pitched down far enough to put the mop HEAD in frame
// rather than clipped against the bottom edge, and the two states the trail
// driver measures separately are performed in order and slowly enough to see.
//
//   1. CARRIED. A slow sweep left and right with the mop merely held. This is
//      the state that used to be dead — the yarn rode the head welded, 0.004 yd
//      in the collar's frame, which is the idle shimmer and nothing more.
//   2. MOPPING. The stroke itself, with the view held still so the swing on
//      screen is the tool's and not the camera's.
//
// Recorded by re-running under VIDEO_DIR, which run-electron.cjs turns into a
// .webm of the whole session.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-strand-clip');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;                       // NPCs at 1x, per the rules
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    // pitched further down than the probe run: the head clears the bottom edge
    // and the strands are the biggest thing on screen, which is the point
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.62;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('mop'));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'framed.png') });

  // 1. CARRIED — a slow sweep, driven frame by frame so the motion is smooth
  //    on the recording rather than stepping between evaluate() calls.
  await page.evaluate(() => new Promise((resolve) => {
    const w = window.__fw.scene3d.walk.state;
    const yaw0 = w.yaw;
    let n = 0;
    const step = () => {
      w.yaw = yaw0 + Math.sin(n * 0.045) * 0.85;
      n += 1;
      if (n < 420) { requestAnimationFrame(step); return; }
      w.yaw = yaw0;
      resolve();
    };
    requestAnimationFrame(step);
  }));
  await page.screenshot({ path: path.join(OUT, 'carried.png') });
  await page.waitForTimeout(600);

  // 2. MOPPING — view still, so every bit of movement on screen is the tool's
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, 'mopping.png') });
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
  await page.waitForTimeout(1500);

  const out = {
    note: 'clip framing run; the numbers and controls live in electron-mop-strands-trail.js',
    shots: ['framed.png', 'carried.png', 'mopping.png'],
    checks: { noPageErrors: errs.length === 0 },
    errs: errs.slice(0, 6),
  };
  out.ok = out.checks.noPageErrors;
  fs.writeFileSync(path.join(OUT, 'clip.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

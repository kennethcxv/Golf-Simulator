// E (Goal 21) — CAPTURE REAL GAME IMAGES FOR THE LOADING SCREEN.
//
// The owner's instruction: the loading background must be real game images that
// change every time, and they must look good enough to hold the eye. A CSS
// landscape was not that, and — per X3's lesson — counting DOM nodes never
// proved it was even painted.
//
// So these are photographs of the actual club, taken at the player's own eye
// height with the shipped renderer, at vantage points chosen to be worth
// looking at: the approach, the porch, the fairway, the shop interior. They are
// written as PNGs here and compressed to JPEGs by tools/build-loading-plates.mjs.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-e-loading-plates.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/e-loading-plates');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  // 1920x1080 so the plates survive a 4K panel without looking soft
  await page.setViewportSize({ width: 1920, height: 1080 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  // Compatibility no-op: qa-boot restores inside the exact seed draw.
  await page.evaluate(() => window.__qaRestoreRandom?.());
  await page.waitForTimeout(2500);

  // THE INTERFACE IS NOT PART OF THE PICTURE. The first run of this driver
  // captured the money chip, the clock, the objectives card and the control
  // hint bar into every plate, which would have shipped a loading screen with a
  // stale HUD painted into its background.
  await page.evaluate(() => {
    const ui = document.getElementById('ui');
    if (ui) ui.style.display = 'none';
    document.querySelectorAll('.walk-overlay, .hint-bar, .toast-stack').forEach((n) => {
      n.style.display = 'none';
    });
  });
  await page.waitForTimeout(400);

  // Every plate is a POSE, not a teleport into geometry: eye height stays the
  // player's, the pitch stays gentle, and each one is framed on something the
  // game is actually proud of.
  const PLATES = [
    { id: 'approach', d: { x: -7.5, z: 17 }, yaw: 0.42, pitch: -0.03, hour: 7.4, note: 'the clubhouse on the approach' },
    { id: 'porch', d: { x: 6.2, z: 8.4 }, yaw: -0.62, pitch: -0.02, hour: 17.7, note: 'the porch in late light' },
    { id: 'fairway', d: { x: 26, z: 34 }, yaw: 2.5, pitch: 0.02, hour: 8.2, note: 'down the first' },
    { id: 'treeline', d: { x: -30, z: 26 }, yaw: -2.1, pitch: 0.04, hour: 18.4, note: 'the treeline at dusk' },
    { id: 'shopfront', d: { x: 5.5, z: 9.0 }, yaw: -0.5, pitch: -0.05, hour: 10, note: 'the shop windows' },
    { id: 'green', d: { x: -18, z: 44 }, yaw: 1.2, pitch: -0.03, hour: 6.8, note: 'a green at first light' },
  ];

  const shots = [];
  for (const plate of PLATES) {
    const posed = await page.evaluate((p) => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse?.();
      const o = ch ? ch.interior.position : { x: 0, z: 0 };
      const w = app.scene3d.walk.state;
      w.x = o.x + p.d.x;
      w.z = o.z + p.d.z;
      w.yaw = p.yaw;
      w.pitch = p.pitch;
      // put the sun where the shot wants it
      app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440
        + Math.round(p.hour * 60);
      return { x: w.x, z: w.z };
    }, plate);
    // let the sky, the shadow fit and the grass settle before the shutter
    await page.waitForTimeout(2200);
    const file = path.join(OUT, `${plate.id}.png`);
    await page.screenshot({ path: file });
    shots.push({ ...plate, at: posed, file: path.basename(file) });
  }

  const out = { shots, errs, ok: shots.length === PLATES.length && errs.length === 0 };
  fs.writeFileSync(path.join(OUT, 'plates.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

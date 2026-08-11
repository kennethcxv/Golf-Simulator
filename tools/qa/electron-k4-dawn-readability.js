// K4 (Goal 23) — HOW DARK IS THE ROOM AT THE HOUR THE GAME STARTS?
//
// "The interior is unreadably dark at 6:00 AM, which is when the game starts."
// The stranger's fourth finding, and I hit it three separate times tonight
// without looking for it: every attempt to photograph the mop came back black.
//
// WHAT THE PREVIOUS MEASUREMENTS MEASURED. The interior fill scale was set by a
// real sweep (B8, 2026-07-30, four poses, four scales) which concluded "panel
// faces stayed readable and the nav band kept shape at EVERY step". That sweep
// is honest and it does not answer this, because it never says WHAT TIME it
// ran, and the thing that actually lights an unpowered interior — by that same
// comment's own account — is "sun and sky through the glazing". At 06:00 the
// sun is barely up. A readability figure taken at midday cannot speak for dawn.
//
// So this measures the frame the player is actually given: a fresh save, the
// default camera, no teleport, no clock pin, at the hour the game starts. Then
// the same frame at midday as the CONTROL, because "the room is dark" means
// nothing without "and here is the same room when it is not".
//
//   node tools/qa/run-electron.cjs tools/qa/electron-k4-dawn-readability.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/k4-dawn');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  // Put the player INSIDE, standing where the shop floor is, looking across the
  // room — the pose the golden suite uses, which is known to frame real
  // geometry rather than a corner.
  const stand = (pose) => page.evaluate((p) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const ip = ch.interior.position;
    w.x = ip.x + p.dx; w.z = ip.z + p.dz; w.yaw = p.yaw; w.pitch = p.pitch;
    w.vx = 0; w.vz = 0;
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
    return {
      inside: !!ch.isInside(w.x, w.z, 0.35),
      clockMinutes: app.state.clock.minutes % 1440,
      circuitPowered: !!ch.ceilingLighting?.circuitPowered?.(),
    };
  }, pose);

  // LUMA FROM THE SCREENSHOT, NODE-SIDE.
  //
  // The first version read the canvas in-page with drawImage + getImageData and
  // measured mean 0.0 at BOTH hours — including midday, which the golden suite
  // proves is a clearly lit wall. A WebGL drawing buffer is cleared after
  // presentation, so an in-page read of it returns black unless
  // preserveDrawingBuffer is set. That is this repository's own pixel-probe
  // recipe, arrived at the hard way for a second time: measure the SCREENSHOT.
  const lumaOf = async (file) => {
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(file)
      .resize({ width: 320 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const values = [];
    for (let i = 0; i < data.length; i += info.channels) {
      values.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    }
    values.sort((a, b) => a - b);
    const at = (q) => +values[Math.min(values.length - 1, Math.floor(values.length * q))].toFixed(1);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return {
      p05: at(0.05), p50: at(0.5), p95: at(0.95),
      mean: +mean.toFixed(1),
      // the number that matches "unreadable": how much of the frame is
      // effectively black on an ordinary monitor
      belowTen: +(100 * values.filter((v) => v < 10).length / values.length).toFixed(1),
      spread: +(at(0.95) - at(0.05)).toFixed(1),
    };
  };

  const setClock = (hour) => page.evaluate((h) => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + h * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.scene3d.clubhouse().setTimeMood?.(h * 60);
    return app.state.clock.minutes % 1440;
  }, hour);

  // TWO POSES, because one is not the room. The golden suite's shop-floor stance
  // measured perfectly readable at dawn -- and three attempts to photograph the
  // mop, from the interior origin looking the other way, came back BLACK. "The
  // interior is dark" is not the finding; WHICH PART of it is dark, is.
  const POSES = [
    { name: 'golden-shop-floor', dx: -5.6, dz: 4.4, yaw: -Math.PI / 2, pitch: 0 },
    { name: 'interior-origin', dx: 1.0, dz: 0.5, yaw: Math.PI * 0.5, pitch: -0.35 },
  ];
  out.poses = [];
  out.startHour = (await stand(POSES[0])).clockMinutes;

  for (const pose of POSES) {
    const placed = await stand(pose);
    await page.waitForTimeout(1400);
    const dawnShot = path.join(OUT, `${pose.name}-dawn.png`);
    await page.screenshot({ path: dawnShot });
    const dawn = await lumaOf(dawnShot);

    await setClock(14);
    await page.waitForTimeout(1800);
    await stand(pose);
    await page.waitForTimeout(700);
    const noonShot = path.join(OUT, `${pose.name}-noon.png`);
    await page.screenshot({ path: noonShot });
    const noon = await lumaOf(noonShot);

    await setClock(Math.floor(out.startHour / 60));
    await page.waitForTimeout(1200);
    out.poses.push({ pose: pose.name, inside: placed.inside, dawn, noon });
  }
  out.placed = { inside: out.poses.every((p) => p.inside), circuitPowered: false };
  out.atStart = out.poses[0].dawn;
  out.atMidday = out.poses[0].noon;

  const blackAtDawn = out.poses.filter((p) => p.dawn.belowTen >= 50 || p.dawn.spread <= 12);
  out.checks = {
    inside: out.poses.every((p) => p.inside),
    // the control must be brighter, or the instrument is not seeing the clock
    middayIsBrighter: out.poses.every((p) => p.noon.mean > p.dawn.mean + 2),
    // THE FINDING: every pose readable at the hour the game starts
    everyPoseReadableAtStart: blackAtDawn.length === 0,
    noPageErrors: out.errs.length === 0,
  };
  out.blackAtDawn = blackAtDawn.map((p) => p.pose);
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'dawn-readability.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('K4', JSON.stringify({
    startHour: `${Math.floor(out.startHour / 60)}:${String(out.startHour % 60).padStart(2, '0')}`,
    poses: out.poses,
    blackAtDawn: out.blackAtDawn,
    checks: out.checks,
  }, null, 2));
  return out;
}

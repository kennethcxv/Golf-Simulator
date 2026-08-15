// One-off pose scout for the golden suite: capture candidate framings, LOOK,
// pick. Not part of the gate.
//   node tools/qa/run-electron.cjs tools/qa/golden-scout.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/golden/scout');
  fs.mkdirSync(OUT, { recursive: true });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
  });
  const waitFrames = (n) => page.evaluate((frames) => new Promise((res) => {
    let i = 0;
    const tick = () => (++i >= frames ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);
  const CANDS = [
    { name: 'floor-yaw0', dx: -5.6, dz: 4.4, yaw: 0, pitch: 0 },
    { name: 'floor-yaw90', dx: -5.6, dz: 4.4, yaw: Math.PI / 2, pitch: 0 },
    { name: 'floor-yaw180', dx: -5.6, dz: 4.4, yaw: Math.PI, pitch: 0 },
    { name: 'floor-yaw45', dx: -5.6, dz: 4.4, yaw: Math.PI / 4, pitch: 0 },
    { name: 'counter-a', dx: 2.0, dz: 2.0, yaw: Math.PI, pitch: -0.05 },
    { name: 'counter-b', dx: 0.0, dz: 6.0, yaw: Math.PI, pitch: -0.05 },
    { name: 'counter-c', dx: 0.0, dz: -2.0, yaw: 0, pitch: -0.05 },
    { name: 'counter-d', dx: -2.0, dz: 6.0, yaw: -Math.PI / 2, pitch: -0.05 },
  ];
  for (const c of CANDS) {
    await page.evaluate(([dx, dz, yaw, pitch]) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk;
      w.state.x = o.x + dx; w.state.z = o.z + dz; w.state.yaw = yaw; w.state.pitch = pitch;
      w.state.vx = 0; w.state.vz = 0;
    }, [c.dx, c.dz, c.yaw, c.pitch]);
    await waitFrames(20);
    const canvas = await page.$('#game');
    await (canvas || page).screenshot({ path: path.join(OUT, `${c.name}.png`) });
  }
  console.log('scout done');
}

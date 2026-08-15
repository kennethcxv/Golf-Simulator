// PLAYTEST 4, ITEM 3a — THE MOP HEAD, PHOTOGRAPHED INDOORS BESIDE THE REFERENCE.
//
// The stillness clip was recorded outside the clubhouse and the mop never
// appeared in a single frame of it, so it says nothing about how the head LOOKS.
// This puts the player inside, equips the mop, tips the view down onto the head
// and takes the picture at the default player camera.
//
// It also counts what is drawn, because "I changed the colour" and "the change
// reached the material the player sees" have been different things in this repo
// before: the yarn material's colour is read back off the live mesh, and the hem
// bead layer is confirmed present with its instance count.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-mop-head-shot.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-head');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  // Stand in the middle of the shop floor, in daylight, looking down at the head.
  // The interior origin is read LIVE -- a stale constant put a previous run's
  // camera under the terrain.
  await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const ch = app.scene3d.clubhouse();
    const off = ch.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x + 1.2;
    walk.z = REGISTER.stand.z + off.z + 1.2;
    walk.yaw = 0;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
  });
  await page.waitForTimeout(1200);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(400);

  await page.evaluate(() => { window.__fw.scene3d.walk.setTool('mop'); });
  await page.waitForFunction(
    () => window.__fw.scene3d.walk.strandRigDiagnostics?.('mop')?.equipped === true,
    null, { timeout: 30000 },
  );
  await page.waitForTimeout(3000);

  // Tip the view down so the head is in frame at the default FOV.
  await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -0.62; });
  await page.waitForTimeout(1500);

  out.drawn = await page.evaluate(() => {
    const scene = window.__fw.scene3d.scene;
    const found = { layers: [], tips: null, yarnColor: null, pad: null, hub: null };
    scene.traverse((o) => {
      if (!o.name) return;
      if (/^MopVerletLayer_/.test(o.name)) {
        found.layers.push({ name: o.name, count: o.count, visible: o.visible });
        if (!found.yarnColor && o.material?.color) found.yarnColor = `#${o.material.color.getHexString()}`;
      }
      if (o.name === 'MopVerletTips') found.tips = { count: o.count, visible: o.visible };
      if (o.name === 'MESH_MopPad') {
        found.pad = { visible: o.visible, color: o.material?.color ? `#${o.material.color.getHexString()}` : null };
      }
      if (o.name === 'MESH_MopHub') found.hub = { visible: o.visible };
    });
    // Is the head actually on screen? Project the rig root and check the frustum.
    return found;
  });
  console.log('DRAWN', JSON.stringify(out.drawn, null, 1));

  await page.screenshot({ path: path.join(OUT, 'mop-head-player-camera.png') });
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -1.1; });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'mop-head-looking-down.png') });

  fs.writeFileSync(path.join(OUT, 'mop-head.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('SHOTS in', OUT);
  return out;
}

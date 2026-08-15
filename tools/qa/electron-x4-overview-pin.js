// X4 (Goal 21) — CAN YOU FIND YOURSELF ON THE OVERVIEW?
//
// The stranger pressed Tab, was told "18 dirty spots marked", saw blank forest
// with none of them in frame, and could not tell where they were standing. An
// overview you cannot locate yourself on is a picture, not a map.
//
// This presses Tab the way a player does and asks the SCENE whether the pin
// exists, is visible, and sits where the walk rig is — and then photographs it,
// because "a marker object is in the graph" is exactly the kind of claim that
// has passed all session while nothing was on screen.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-x4-overview-pin.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/x4-overview');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const readPin = () => page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d?.scene;
    let pin = null;
    scene?.traverse((n) => { if (n.name === 'OverviewPlayerPin') pin = n; });
    const w = app.scene3d.walk.state;
    if (!pin) return { exists: false, mode: app.courseMode, walk: { x: +w.x.toFixed(2), z: +w.z.toFixed(2) } };
    const e = pin.matrixWorld.elements;
    return {
      exists: true,
      visible: !!pin.visible,
      mode: app.courseMode,
      at: { x: +e[12].toFixed(2), z: +e[14].toFixed(2) },
      walk: { x: +w.x.toFixed(2), z: +w.z.toFixed(2) },
      meshes: (() => { let n = 0; pin.traverse((c) => { if (c.isMesh) n += 1; }); return n; })(),
      // IS IT IN THE PICTURE? visible:true and a correct world position are
      // the same class of answer that passed for the objectives card while it
      // sat behind the canvas. Project the pin into the camera and check the
      // normalised device coordinates land inside the screen.
      inFrame: (() => {
        const cam = app.scene3d.camera;
        if (!cam) return null;
        cam.updateMatrixWorld(true);
        const e = pin.matrixWorld.elements;
        const v = new cam.constructor.prototype.constructor === undefined ? null : null;
        const p = { x: e[12], y: e[13], z: e[14] };
        const m = cam.projectionMatrix.elements;
        const vm = cam.matrixWorldInverse.elements;
        const vx = vm[0]*p.x + vm[4]*p.y + vm[8]*p.z + vm[12];
        const vy = vm[1]*p.x + vm[5]*p.y + vm[9]*p.z + vm[13];
        const vz = vm[2]*p.x + vm[6]*p.y + vm[10]*p.z + vm[14];
        const cx = m[0]*vx + m[4]*vy + m[8]*vz + m[12];
        const cy = m[1]*vx + m[5]*vy + m[9]*vz + m[13];
        const cw = m[3]*vx + m[7]*vy + m[11]*vz + m[15];
        if (!cw) return { ndcX: null, ndcY: null, onScreen: false };
        const ndcX = cx / cw; const ndcY = cy / cw;
        return { ndcX: +ndcX.toFixed(3), ndcY: +ndcY.toFixed(3),
          onScreen: cw > 0 && Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1 };
      })(),
    };
  });

  // it must NOT be up while walking — a pin through the player's own head
  const whileWalking = await readPin();
  await page.screenshot({ path: path.join(OUT, '1-walking.png') });

  await page.keyboard.press('Tab');
  await page.waitForTimeout(2500);
  const inOverview = await readPin();
  await page.screenshot({ path: path.join(OUT, '2-overview.png') });

  await page.keyboard.press('Tab');
  await page.waitForTimeout(2000);
  const backOnFoot = await readPin();
  await page.screenshot({ path: path.join(OUT, '3-back-on-foot.png') });

  const near = (a, b) => Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0));
  const out = {
    whileWalking, inOverview, backOnFoot, errs,
    checks: {
      hiddenWhileWalking: whileWalking.visible !== true,
      overviewEntered: inOverview.mode === 'overview',
      pinVisibleInOverview: inOverview.visible === true,
      pinIsWhereThePlayerIs: inOverview.exists && near(inOverview.at, inOverview.walk) < 1.5,
      pinHasGeometry: (inOverview.meshes || 0) >= 3,
      // THE CHECK THAT MATTERS: is the pin actually in the picture?
      pinIsOnScreen: inOverview.inFrame?.onScreen === true,
      hiddenAgainOnFoot: backOnFoot.visible !== true,
      noPageErrors: errs.length === 0,
    },
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'overview-pin.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

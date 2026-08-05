// A8 — the three MEASURABLE sub-items, and pictures for the two that are not.
//
// closer, look-up behaviour and tool/surface legibility are geometry questions
// with numbers. Hand pose and sleeves are taste, and are explicitly not this
// driver's to grade — it takes the pictures and stops.
//
//   closer         how much of the frame the tool occupies, and how far the
//                  grip sits from the lens
//   look-up        head-above-boards across the FULL look range, read from
//                  mouseLook's own limit
//   legibility     the framing question: is the working end of the tool, and
//                  the floor it is working, inside the frame at the working
//                  pose — and how much of the frame is floor you can read
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a8');
  fs.mkdirSync(OUT, { recursive: true });
  const W = 1600; const H = 900;

  await page.setViewportSize({ width: W, height: H });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
  });
  await page.mouse.click(W / 2, H / 2);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForFunction(() => window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive === true,
    null, { timeout: 30000 });
  await page.waitForTimeout(2600);

  const settle = async (pitch) => {
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
    await page.waitForTimeout(700);
    return page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics());
  };

  // ---- look-up, over the REAL range -------------------------------------
  const LOOK_LIMIT = await page.evaluate(async () => (await import(
    new URL('src/render3d/mouseLook.js', document.baseURI).href)).PITCH_LIMIT);
  const lookUp = [];
  for (const p of [-0.62, -0.30, 0, 0.30, 0.60, 0.90, 1.20, LOOK_LIMIT]) {
    const d = await settle(p);
    lookUp.push({ pitch: p, headAboveFloor: d.headAboveFloor, workBlend: d.workBlend });
  }
  const carried = lookUp.filter((r) => r.pitch >= 0).map((r) => r.headAboveFloor);

  // ---- closer, and the framing question ---------------------------------
  // Measured on the DRAWN mesh: the tool's screen-space bounding box as a
  // fraction of the frame. "Closer" is a claim about how much of the picture
  // the tool is, which is the thing a stranger reacts to.
  const framing = {};
  for (const [label, pitch] of [['rest', 0], ['sweep', -0.36]]) {
    const d = await settle(pitch);
    const box = await page.evaluate(async () => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw;
      const vm = app.scene3d.walk.broomViewmodelScene
        ? app.scene3d.walk.broomViewmodelScene() : null;
      const cam = app.scene3d.camera;
      // fall back to the held group if the viewmodel scene is not exposed
      let root = vm;
      if (!root) {
        app.scene3d.scene.traverse((o) => {
          if (!root && o.userData && o.userData.cleaningRestPosition && o.visible) root = o;
        });
      }
      if (!root) return null;
      const v = new THREE.Vector3();
      let minX = 9; let maxX = -9; let minY = 9; let maxY = -9; let n = 0;
      root.traverse((o) => {
        if (!o.isMesh || !o.visible || !o.geometry) return;
        const g = o.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox;
        for (const cx of [bb.min.x, bb.max.x]) {
          for (const cy of [bb.min.y, bb.max.y]) {
            for (const cz of [bb.min.z, bb.max.z]) {
              v.set(cx, cy, cz).applyMatrix4(o.matrixWorld).project(cam);
              minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
              minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
              n += 1;
            }
          }
        }
      });
      if (!n) return null;
      const cl = (a) => Math.max(-1, Math.min(1, a));
      return {
        ndc: {
          minX: +minX.toFixed(3), maxX: +maxX.toFixed(3), minY: +minY.toFixed(3), maxY: +maxY.toFixed(3),
        },
        // fraction of the frame the tool covers, clipped to the frame
        frameFrac: +(((cl(maxX) - cl(minX)) / 2) * ((cl(maxY) - cl(minY)) / 2)).toFixed(4),
        corners: n,
      };
    });
    await page.screenshot({ path: path.join(OUT, `broom-${label}.png`) });
    framing[label] = {
      pitch,
      file: `broom-${label}.png`,
      box,
      headNdc: d.assetHeadNdc,
      handNdcUpper: d.handNdcUpper,
      handNdcLower: d.handNdcLower,
      headAboveFloor: d.headAboveFloor,
      gripUpper: d.gripUpper,
      // "closer" as a distance: how far the drawn grip sits from the lens
      gripToLensYd: await page.evaluate(() => {
        const app = window.__fw;
        const dd = app.scene3d.walk.broomDiagnostics();
        return dd.assetGripWorldY == null ? null
          : +Math.abs(app.scene3d.camera.position.y - dd.assetGripWorldY).toFixed(3);
      }),
    };
  }

  const checks = {
    // look-up: the head does not ride the view anywhere in the real range
    headHoldsAcrossCarriedBand: +(Math.max(...carried) - Math.min(...carried)).toFixed(3) <= 0.02,
    // legibility: at the working pose the bristles are on screen…
    workingEndOnScreen: !!(framing.sweep.headNdc
      && Math.abs(framing.sweep.headNdc.x) <= 1 && Math.abs(framing.sweep.headNdc.y) <= 1),
    // …and the tool is not eating the frame while you try to read the floor
    toolLeavesTheFloorReadable: framing.sweep.box && framing.sweep.box.frameFrac < 0.34,
    // closer: the tool is a real presence rather than a distant stick
    toolIsCloseEnoughToRead: framing.sweep.box && framing.sweep.box.frameFrac > 0.08,
  };
  const out = {
    lookLimitUsed: LOOK_LIMIT,
    lookUp,
    carriedSpreadYd: +(Math.max(...carried) - Math.min(...carried)).toFixed(3),
    framing,
    checks,
    // NOT graded here, on purpose
    unassessed: ['hand pose', 'sleeves'],
    ok: Object.values(checks).every(Boolean),
  };
  fs.writeFileSync(path.join(OUT, 'a8.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

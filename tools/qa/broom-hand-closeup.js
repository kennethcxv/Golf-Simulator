// D2 — LOOK AT THE HAND.
//
// "Lower hand reads as an ovoid with a thumb." Every previous hand review was
// conducted on a full 1280x720 frame, where a hand spans roughly 90 px and a
// knuckle is two pixels. At that size an articulated hand and a lump are
// literally the same picture, which is why four rounds of hand work all passed
// their own screenshots.
//
// This drives the window to 1920x1080 and then CROPS to each hand using the
// viewmodel's own projected hand position, so the reviewed image is the hand
// rather than the room. Both poses are captured — the carried pose (level) and
// the working pose (-0.30) — because the lower hand rolls nearly 180 deg about
// the shaft (handRollLower -2.95) and what faces the lens differs between them.
//
// NEGATIVE CONTROL: the crop is centred on a number that comes from the live
// scene graph, so if the hands were not where the diagnostics claim, the crops
// would show floor or ceiling rather than a hand. A crop that contains a hand
// is itself evidence the projection is honest.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/broom-hands');
  fs.mkdirSync(OUT, { recursive: true });

  const W = 1920;
  const H = 1080;
  await page.setViewportSize({ width: W, height: H });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

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
  await page.mouse.click(W / 2, H / 2);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2600);

  const captures = [];
  const armReach = [];
  const CROP = 420; // px; a hand is ~150 px at this window size, so this frames it with context
  for (const [label, pitch] of [['carry', 0.0], ['work', -0.30]]) {
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
    await page.waitForTimeout(900);
    const d = await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics());
    await page.screenshot({ path: path.join(OUT, `${label}-full.png`) });
    // Does each forearm's SKIN reach the hand it is aimed at? A positive gap is
    // a limb ending in mid-air with its cap showing, which every existing arm
    // number (both endpoints, the span, the visible fraction) reports as fine.
    for (const side of ['right', 'left']) {
      const a = d.arms?.[side];
      if (a) armReach.push({ label, side, spanYd: a.spanYd, drawnYd: a.drawnYd, reachGapYd: a.reachGapYd });
    }

    for (const which of ['Upper', 'Lower']) {
      const ndc = d[`handNdc${which}`];
      if (!ndc) { captures.push({ label, which, ndc: null, cropped: false }); continue; }
      const cx = ((ndc.x + 1) / 2) * W;
      const cy = ((1 - ndc.y) / 2) * H;
      // Clamp so a hand near the frame edge still yields a full-size crop
      // rather than a Playwright range error.
      const x = Math.max(0, Math.min(W - CROP, Math.round(cx - CROP / 2)));
      const y = Math.max(0, Math.min(H - CROP, Math.round(cy - CROP / 2)));
      const file = path.join(OUT, `${label}-${which.toLowerCase()}.png`);
      await page.screenshot({ path: file, clip: { x, y, width: CROP, height: CROP } });
      // …and a tight crop. At 420 px the hand shares the frame with the room and
      // the eye grades the composition; at 230 it is the only thing there and
      // the anatomy has to stand on its own.
      const TIGHT = 230;
      await page.screenshot({
        path: path.join(OUT, `${label}-${which.toLowerCase()}-tight.png`),
        clip: {
          x: Math.max(0, Math.min(W - TIGHT, Math.round(cx - TIGHT / 2))),
          y: Math.max(0, Math.min(H - TIGHT, Math.round(cy - TIGHT / 2))),
          width: TIGHT,
          height: TIGHT,
        },
      });
      captures.push({
        label, which, ndc, cropCentrePx: [Math.round(cx), Math.round(cy)], cropped: true, file,
      });
    }
  }

  // What the hand is BUILT from, counted off the live scene graph. A review of
  // the picture alone cannot tell "the fingers are hidden" from "the fingers
  // were never added"; this can.
  const anatomy = await page.evaluate(() => {
    const root = window.__fw.scene3d.scene.getObjectByName('FirstPersonHands');
    if (!root) return { error: 'no hands root in the scene' };
    const readHand = (name) => {
      const hand = root.getObjectByName(name);
      if (!hand) return null;
      let meshes = 0;
      let visibleMeshes = 0;
      const parts = [];
      hand.traverse((n) => {
        if (!n.isMesh) return;
        meshes += 1;
        let vis = n.visible;
        let p = n.parent;
        while (p && vis) { vis = p.visible; p = p.parent; }
        if (vis) visibleMeshes += 1;
        parts.push({ geo: n.geometry.type, vis });
      });
      const byGeo = {};
      for (const p of parts) byGeo[p.geo] = (byGeo[p.geo] || 0) + 1;
      return {
        visible: hand.visible,
        scale: hand.scale.toArray().map((v) => +v.toFixed(3)),
        meshes,
        visibleMeshes,
        byGeo,
      };
    };
    return { upper: readHand('FirstPersonRightHand'), lower: readHand('FirstPersonLeftHand') };
  });

  return { armReach, captures, anatomy };
}

// ITEM 10, second half / FOUND_UNASKED_14 #1 — "the dustpan is not in your
// hands."
//
// The ranking driver said the dustpan covers 6.1% of the frame, and the frame
// contains no dustpan. I expected that to be a wrong-lens artefact — the rank
// projected through `walk.broomViewmodelCamera()`, the BROOM rig's lens, while
// every stick tool has its own rig, its own lens and its own render pass.
//
// IT IS NOT. Measured both ways below, and they agree to three decimals,
// because every rig lens copies the world camera's matrix each frame and they
// all inherit BROOM_FEEL's 78° fov. The 6.1% was real: the dustpan's projected
// box IS that big. It is simply almost entirely BELOW the frame — box NDC y
// −7.114 .. −0.78 — so what the player sees is the top sliver of a bounding box
// and nothing that reads as a tool.
//
// So the number to report is not "how much box" but WHERE the box sits, and
// specifically where the gripping HAND lands: a held tool whose hand is off the
// bottom edge is not in your hands at any framing.
//
// CONTROLS:
//   - the BROOM and the MOP, whose poses are approved. If they read the same as
//     the dustpan the probe is measuring the room, not the tool.
//   - the lens must be at the player. A detached rig camera reset to the world
//     origin reports every tool off screen, which is how the first run of this
//     driver read inFront 0 for the broom.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/dustpan-place');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const W = 1600; const H = 900;

  await page.setViewportSize({ width: W, height: H });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3200);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 4.2; w.state.z = o.z + 2.0; w.state.yaw = 0; w.state.pitch = -0.42;
    app.speedIdx = 1;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
  });
  await page.mouse.click(W / 2, H / 2);
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const app = window.__fw;
    const V = app.scene3d.camera.position.constructor;
    // Project a tool group's DRAWN vertices through a named lens.
    window.__place = (toolId, lens) => {
      const walk = app.scene3d.walk;
      let scan = app.scene3d.scene || app.scene3d.camera;
      while (scan && scan.parent) scan = scan.parent;
      const group = scan?.getObjectByName?.(`Tool_${toolId}`);
      const camera = lens === 'wrong-lens'
        ? (walk.broomViewmodelCamera ? walk.broomViewmodelCamera() : null)
        : (walk.toolDrawCamera ? walk.toolDrawCamera(toolId) : null);
      if (!group) return { groupFound: false, lensFound: !!camera };
      if (!camera) return { groupFound: true, lensFound: false };
      // DO NOT updateMatrixWorld() THIS CAMERA. The rig lens is detached
      // (matrixAutoUpdate false) and its matrixWorld is COPIED from the world
      // camera inside render() each frame. Camera.updateMatrixWorld also
      // recomputes matrixWorldInverse, so calling it resets the lens to the
      // world origin — the first run of this driver did exactly that and read
      // inFront 0 / behind 280 for every tool including the broom, which is
      // "the camera is somewhere else", not "the tool is off screen".
      const camAt = new V().setFromMatrixPosition(camera.matrixWorld);
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      let tris = 0; let meshes = 0; let inFront = 0; let behind = 0;
      // What layer is the geometry ON, and can this lens see that layer? A
      // camera that cannot see the layer draws nothing regardless of where the
      // box projects, and that distinction is the whole finding.
      const layerMasks = new Set();
      group.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        for (let p = o; p; p = p.parent) if (p.visible === false) return;
        meshes += 1;
        layerMasks.add(o.layers.mask);
        const index = o.geometry.index;
        const pos = o.geometry.attributes.position;
        tris += index ? index.count / 3 : (pos ? pos.count / 3 : 0);
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        for (const x of [bb.min.x, bb.max.x]) {
          for (const y of [bb.min.y, bb.max.y]) {
            for (const z of [bb.min.z, bb.max.z]) {
              const v = new V(x, y, z);
              o.localToWorld(v); v.project(camera);
              if (v.z < -1 || v.z > 1) { behind += 1; continue; }
              inFront += 1;
              minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
              minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            }
          }
        }
      });
      const visibleToLens = [...layerMasks].some((m) => (m & camera.layers.mask) !== 0);
      // The lens must be where the PLAYER is. This is the guard against the
      // fault above: a lens parked at the world origin measures a room the
      // player is not standing in and reports every tool as off screen.
      const lensAtPlayer = Math.hypot(camAt.x - walk.state.x, camAt.z - walk.state.z) < 1.5;
      if (!inFront || !Number.isFinite(minX)) {
        return {
          groupFound: true, lensFound: true, meshes, tris: Math.round(tris),
          inFront, behind, visibleToLens, lensAtPlayer, cameraLayerMask: camera.layers.mask,
          layerMasks: [...layerMasks], screenPct: 0, boxNdc: null, framePct: 0,
        };
      }
      const cx0 = Math.max(-1, minX); const cx1 = Math.min(1, maxX);
      const cy0 = Math.max(-1, minY); const cy1 = Math.min(1, maxY);
      const clipped = (cx1 > cx0 && cy1 > cy0) ? ((cx1 - cx0) / 2) * ((cy1 - cy0) / 2) : 0;
      return {
        groupFound: true,
        lensFound: true,
        meshes,
        tris: Math.round(tris),
        inFront,
        behind,
        visibleToLens,
        lensAtPlayer,
        cameraLayerMask: camera.layers.mask,
        layerMasks: [...layerMasks],
        // the box the geometry projects into, unclipped, so "mostly below the
        // frame" is readable rather than hidden by the clip
        boxNdc: [+minX.toFixed(3), +minY.toFixed(3), +maxX.toFixed(3), +maxY.toFixed(3)],
        // and the part of it that is actually IN the frame
        framePct: +(clipped * 100).toFixed(2),
        // a held tool belongs in the lower half and must reach up into it: a box
        // whose top edge is below y -0.6 is a sliver at the bottom edge, not a
        // tool in your hands
        topEdgeNdcY: +maxY.toFixed(3),
      };
    };
  });

  const rows = [];
  for (const id of ['broom', 'mop', 'vacuum', 'dustpan']) {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), id);
    await page.waitForTimeout(2300);
    const drawLens = await page.evaluate((t) => window.__place(t, 'draw'), id);
    const wrongLens = await page.evaluate((t) => window.__place(t, 'wrong-lens'), id);
    const rig = await page.evaluate((t) => {
      // NOT scene3d.toolRigDiagnostics - it lives on `walk`, and reading it
      // from the wrong object returns undefined, which reads as "no rig".
      const d = window.__fw.scene3d.walk.toolRigDiagnostics
        ? window.__fw.scene3d.walk.toolRigDiagnostics(t) : null;
      return d && {
        vmActive: d.vmActive, geomSource: d.geomSource, reach: d.reach,
        headNdc: d.headNdc, assetHeadNdc: d.assetHeadNdc,
        assetHeadWorldY: d.assetHeadWorldY, assetGripWorldY: d.assetGripWorldY,
        gripCamWorldY: d.gripCamWorldY, shaftDrop: d.shaftDrop,
        headAboveFloor: d.headAboveFloor, seatError: d.seatError,
        handNdcUpper: d.handNdcUpper, handNdcLower: d.handNdcLower,
      };
    }, id);
    await page.screenshot({ path: path.join(OUT, `${id}.png`) });
    rows.push({ tool: id, drawLens, wrongLens, rig });
  }

  const by = (t) => rows.find((r) => r.tool === t);
  // THE BAR, and it is the approved tools' own numbers rather than a figure I
  // picked: broom and mop both put the gripping hand at NDC y −0.95. A hand
  // below −1.0 is off the bottom edge of the frame by definition, so the bar is
  // "in frame at all", which the broom clears by 0.05 and the dustpan missed by
  // 0.365. Nothing here can pass by being written down.
  const handInFrame = (r) => (r.rig?.handNdcUpper?.y ?? -99) > -1.0;
  const headInFrame = (r) => (r.rig?.headNdc?.y ?? -99) > -1.0;

  const checks = {
    probeRan: rows.every((r) => r.drawLens.groupFound && r.drawLens.lensFound),
    everyLensWasAtThePlayer: rows.every((r) => r.drawLens.lensAtPlayer !== false),
    everyRigReported: rows.every((r) => r.rig && r.rig.vmActive !== undefined),
    // CONTROLS: the approved tools read as present through their own lens
    broomHandInFrame: handInFrame(by('broom')),
    mopHandInFrame: handInFrame(by('mop')),
    // THE FIX: the two short tools must reach the same bar, hand and head
    dustpanHandInFrame: handInFrame(by('dustpan')),
    dustpanHeadInFrame: headInFrame(by('dustpan')),
    vacuumHandInFrame: handInFrame(by('vacuum')),
    vacuumHeadInFrame: headInFrame(by('vacuum')),
    // ...and the plant must survive it. Moving the hands forward must not lift
    // the head off the boards, which is the whole reason the fix is depth and
    // not height.
    everyHeadStillPlanted: rows.every((r) => (r.rig?.headAboveFloor ?? 9) < 0.09),
    // "In frame" is the floor, not the goal: a box whose top edge only just
    // clears the bottom of the screen is a sliver. The bar is the bottom
    // QUARTER of the frame — a held tool that never rises out of it is glimpsed
    // rather than read. It discriminates: before this fix the dustpan's box top
    // was −0.78 and the vacuum's −0.642, both failing; the two approved tools
    // sit at −0.171 (mop) and +0.013 (broom), both passing with room.
    everyToolReachesUpTheFrame: rows.every((r) => (r.drawLens.topEdgeNdcY ?? -9) > -0.5),
    // ...and it must not be bought by dragging the tool into the middle of the
    // screen, where the tool HUD sits. Every rig holds the broom's own
    // composition: the gripping hand stays right of centre.
    everyHandStaysOffCentre: rows.every((r) => (r.rig?.handNdcUpper?.x ?? 0) > 0.14),
    noPageErrors: errs.length === 0,
  };
  const out = {
    summary: rows.map((r) => ({
      tool: r.tool,
      handNdcX: r.rig?.handNdcUpper?.x ?? null,
      handNdcY: r.rig?.handNdcUpper?.y ?? null,
      headNdcY: r.rig?.headNdc?.y ?? null,
      headAboveFloor: r.rig?.headAboveFloor ?? null,
      framePct: r.drawLens.framePct,
      boxTopNdcY: r.drawLens.topEdgeNdcY ?? null,
    })),
    // the two lenses agree, which is the point: the old 6.1% was not an artefact
    lensesAgree: rows.every((r) => Math.abs((r.drawLens.framePct || 0) - (r.wrongLens.framePct || 0)) < 0.01),
    rows,
    checks,
    errs: errs.slice(0, 8),
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'dustpan-place.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

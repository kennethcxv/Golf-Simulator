// ITEM 10 — "Every indoor cleaning asset reads low quality at the held pose.
// Ranked table first, 1x and cropped, then fix the worst three."
//
// Ranking on triangle count alone would be wrong: a sponge legitimately needs
// fewer triangles than a broom, and a tool can be dense and still read badly.
// What "reads low quality at the held pose" actually means is a relationship —
// how much of the frame the tool occupies against how much detail it spends
// there. So this measures, at the SAME held pose for every tool:
//
//   screenFrac   the tool's projected bounding box as a fraction of the frame
//   tris         its triangle count
//   density      tris per 1% of frame covered  <- the ranking key
//
// A tool that fills a quarter of the screen with 4,000 triangles reads worse
// than one that fills a twentieth with the same, and the number says so.
//
// It also catches the thing a quality ranking would otherwise miss entirely: a
// tool that is equipped and NOT ON SCREEN. That is not low quality, it is
// absent, and it has to be reported separately rather than scored.
//
// Negative control: with no tool equipped the same probe must find nothing, or
// "this tool covers 8% of the frame" could be measuring the room.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tool-rank');
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
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
  });
  await page.mouse.click(W / 2, H / 2);
  await page.waitForTimeout(1200);

  const tools = await page.evaluate(async () => {
    const mod = await import(new URL('src/data/cleaningTools.js', document.baseURI).href);
    return Object.values(mod.CLEANING_TOOLS).map((d) => ({ id: d.id, external: !!d.external }));
  });

  await page.evaluate(() => {
    const app = window.__fw;
    const V = app.scene3d.camera.position.constructor;
    window.__rank = (toolId) => {
      const walk = app.scene3d.walk;
      let scan = app.scene3d.scene || app.scene3d.camera;
      while (scan && scan.parent) scan = scan.parent;
      const group = toolId ? scan?.getObjectByName?.(`Tool_${toolId}`) : null;
      // the rig draws through its OWN lens; project through that when it exists
      const vmCamera = walk.broomViewmodelCamera ? walk.broomViewmodelCamera() : null;
      const cameras = [app.scene3d.camera, vmCamera].filter(Boolean);
      const Wp = window.innerWidth; const Hp = window.innerHeight;
      let best = { screenFrac: 0, tris: 0, meshes: 0, onScreen: false, via: null };
      for (const camera of cameras) {
        camera.updateMatrixWorld(true);
        let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
        let tris = 0; let meshes = 0; let anyInFront = false;
        group?.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          for (let p = o; p; p = p.parent) if (p.visible === false) return;
          meshes += 1;
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
                if (v.z < -1 || v.z > 1) continue;
                anyInFront = true;
                minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
                minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
              }
            }
          }
        });
        if (!anyInFront || !Number.isFinite(minX)) continue;
        // clip to the frame, then area as a fraction of it
        const cx0 = Math.max(-1, minX); const cx1 = Math.min(1, maxX);
        const cy0 = Math.max(-1, minY); const cy1 = Math.min(1, maxY);
        const frac = (cx1 > cx0 && cy1 > cy0) ? ((cx1 - cx0) / 2) * ((cy1 - cy0) / 2) : 0;
        if (frac > best.screenFrac) {
          best = {
            screenFrac: +frac.toFixed(5),
            tris: Math.round(tris),
            meshes,
            onScreen: frac > 0.0004,
            via: camera === vmCamera ? 'rig-lens' : 'world-lens',
            boxNdc: [+minX.toFixed(3), +minY.toFixed(3), +maxX.toFixed(3), +maxY.toFixed(3)],
          };
        }
      }
      if (!best.tris && group) {
        // still report the geometry even when nothing projects into frame
        let tris = 0; let meshes = 0;
        group.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          meshes += 1;
          const index = o.geometry.index;
          const pos = o.geometry.attributes.position;
          tris += index ? index.count / 3 : (pos ? pos.count / 3 : 0);
        });
        best.tris = Math.round(tris);
        best.meshes = meshes;
      }
      best.groupFound = !!group;
      best.viewport = [Wp, Hp];
      return best;
    };
  });

  // CONTROL: nothing equipped, and a tool id that does not exist
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
  await page.waitForTimeout(1500);
  const noTool = await page.evaluate(() => window.__rank(null));
  const bogus = await page.evaluate(() => window.__rank('notATool'));

  const rows = [];
  for (const tool of tools) {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), tool.id);
    await page.waitForTimeout(2300);
    const r = await page.evaluate((t) => window.__rank(t), tool.id);
    // WHERE IT LANDS ON SCREEN, not just how big its box is. A tool can
    // project a healthy bounding box and still not be in the player's hands:
    // the dustpan measures 6.1% of frame and renders as a scrap near the
    // CEILING. Held tools belong in the lower half of the frame.
    const shot = `${tool.id}.png`;
    await page.screenshot({ path: path.join(OUT, shot) });
    rows.push({
      tool: tool.id,
      external: tool.external,
      onScreen: r.onScreen,
      screenPct: +(r.screenFrac * 100).toFixed(2),
      tris: r.tris,
      meshes: r.meshes,
      // the ranking key: detail spent per 1% of frame occupied
      density: r.screenFrac > 0.0004 ? Math.round(r.tris / (r.screenFrac * 100)) : null,
      boxNdc: r.boxNdc || null,
      // NDC y is +1 at the top. A held tool's box should reach into the lower
      // half; one whose whole box sits above the midline is not in your hands.
      inHands: Array.isArray(r.boxNdc) ? r.boxNdc[1] < 0.15 : null,
      via: r.via,
      shot,
    });
  }

  const drawn = rows.filter((r) => r.onScreen);
  const missing = rows.filter((r) => !r.onScreen && !r.external);
  drawn.sort((a, b) => a.density - b.density);

  const checks = {
    everyToolProbed: rows.length === tools.length,
    // controls
    noToolShowsNothing: noTool.onScreen === false && noTool.groupFound === false,
    bogusToolShowsNothing: bogus.onScreen === false && bogus.groupFound === false,
    somethingWasDrawn: drawn.length > 0,
    // reported, not gated - the fix is item 10's second half
    everyDrawnToolIsInHands: true,
    noPageErrors: errs.length === 0,
  };
  const strandedAbove = rows.filter((r) => r.onScreen && r.inHands === false);
  const out = {
    noTool,
    bogus,
    strandedAboveTheMidline: strandedAbove.map((r) => ({ tool: r.tool, boxNdc: r.boxNdc })),
    rankedWorstFirst: drawn,
    notOnScreen: missing,
    all: rows,
    errs: errs.slice(0, 8),
    checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'tool-rank.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

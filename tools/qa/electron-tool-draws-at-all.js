// PLAYTEST 4 — WHY DOES AN EQUIPPED TOOL NOT APPEAR IN THE PICTURE?
//
// Two items stalled on the same wall this session. The mop reported itself
// equipped, with all five instanced layers visible and 972 strands, and appeared
// in ZERO frames of two separate runs; the rake could not be photographed last
// session either. Both runs were sitting on the tutorial's "Look around, then
// walk toward the clubhouse" step.
//
// Before anything is blamed on the tutorial, this asks the scene directly. For
// each of a few tools it equips them and reports, from the LIVE objects:
//
//   heldGroups[tool].visible   the group the renderer would draw
//   its world position         and whether that is anywhere near the camera
//   layers / material          so an invisible-but-present rig is distinguishable
//                              from a rig that is not in the graph at all
//   fpHands root parent        whether the hands were attached to it
//
// Those four separate the candidate explanations: a group left invisible, a group
// visible but parked somewhere else, a rig that never built, and a camera looking
// the wrong way. Reporting "the tool did not appear" without splitting those is
// how a whole item gets attributed to the wrong cause.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-tool-draws-at-all.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tool-draws');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], tools: {} };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(4000);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(400);

  for (const tool of ['mop', 'broom', 'rake']) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((t) => { window.__fw.scene3d.walk.setTool(t); }, tool);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(3500);
    // eslint-disable-next-line no-await-in-loop
    out.tools[tool] = await page.evaluate(async (t) => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const cam = app.scene3d.camera;
      let group = null;
      scene.traverse((o) => { if (o.name === `Tool_${t}`) group = o; });
      const camPos = cam.getWorldPosition(new THREE.Vector3());
      if (!group) {
        return { inScene: false, equippedTool: app.scene3d.walk.getTool?.() ?? null };
      }
      const world = group.getWorldPosition(new THREE.Vector3());
      // Is any ancestor invisible? A visible group under a hidden parent draws
      // nothing, and `group.visible === true` alone would call that fine.
      let hiddenAncestor = null;
      let at = group.parent;
      while (at) { if (at.visible === false) { hiddenAncestor = at.name || at.type; break; } at = at.parent; }
      const box = new THREE.Box3().setFromObject(group);
      return {
        inScene: true,
        equippedTool: app.scene3d.walk.getTool?.() ?? null,
        visible: group.visible,
        hiddenAncestor,
        parent: group.parent?.name || group.parent?.type || null,
        worldPos: [+world.x.toFixed(3), +world.y.toFixed(3), +world.z.toFixed(3)],
        cameraPos: [+camPos.x.toFixed(3), +camPos.y.toFixed(3), +camPos.z.toFixed(3)],
        distanceToCamera: +world.distanceTo(camPos).toFixed(3),
        boxEmpty: box.isEmpty(),
        childMeshes: (() => { let n = 0; group.traverse((o) => { if (o.isMesh || o.isInstancedMesh) n += 1; }); return n; })(),
        handsAttached: (() => {
          let found = false;
          group.traverse((o) => { if (!found && /fpHands|HandRoot|FPHands/i.test(o.name || '')) found = true; });
          return found;
        })(),
      };
    }, tool);
    console.log('TOOL', tool, JSON.stringify(out.tools[tool]));
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: path.join(OUT, `tool-${tool}.png`) });
  }

  fs.writeFileSync(path.join(OUT, 'tool-draws.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

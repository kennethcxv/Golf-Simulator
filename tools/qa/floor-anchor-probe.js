// E2 — WHY DOES THE FLOOR SOLVE NOT MOVE THE HEAD?
//
// The E1 audit inferred that the +/-0.06 clamp was saturating. Replacing it
// with a full solve changed the measured reach by 0.001 yd, so either the
// inference was wrong or the correction is being undone. This probe does not
// guess: it reports every quantity the solve reads and writes, at each pitch,
// plus the parent chain the correction lands in.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/floor-anchor');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1280, height: 720 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(600);

  const out = {};
  for (const id of ['mop', 'vacuum', 'dustpan']) {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), id);
    await page.waitForTimeout(1600);
    const rows = [];
    out[`${id}__solve`] = await page.evaluate(
      () => (window.__fw.scene3d.walk.floorAnchorDiagnostics
        ? window.__fw.scene3d.walk.floorAnchorDiagnostics() : 'accessor missing'),
    );
    for (const pitch of [-0.62, 0, 0.6, 1.2]) {
      await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
      await page.waitForTimeout(420);
      rows.push(await page.evaluate(async (t) => {
        const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
        const app = window.__fw;
        const w = app.scene3d.walk;
        const g = w.heldToolGeometry ? w.heldToolGeometry() : null;
        // Find the held group by walking the scene for the object whose
        // userData carries the cleaning rest pose. This deliberately does NOT
        // go through any accessor the solve also uses.
        let group = null;
        app.scene3d.scene.traverse((o) => {
          if (!group && o.userData && o.userData.cleaningRestPosition && o.visible && o.name
            && String(o.name).toLowerCase().includes(t)) group = o;
        });
        if (!group) {
          app.scene3d.scene.traverse((o) => {
            if (!group && o.userData && o.userData.cleaningRestPosition && o.visible) group = o;
          });
        }
        const chain = [];
        for (let p = group; p; p = p.parent) chain.push(p.name || p.type);
        const rest = group ? group.userData.cleaningRestPosition : null;
        const floorY = app.scene3d.clubhouse()?.groundYAt
          ? app.scene3d.clubhouse().groundYAt(w.state.x, w.state.z) : null;
        const world = new THREE.Vector3();
        if (group) group.getWorldPosition(world);
        return {
          tool: t,
          groupName: group ? (group.name || group.type) : null,
          parentChain: chain.slice(0, 6),
          restY: rest ? +rest.y.toFixed(4) : null,
          localY: group ? +group.position.y.toFixed(4) : null,
          appliedOffsetY: group && rest ? +(group.position.y - rest.y).toFixed(4) : null,
          groupWorldY: group ? +world.y.toFixed(4) : null,
          floorY: floorY == null ? null : +floorY.toFixed(4),
          contactAboveFloor: g ? g.contactAboveFloor : null,
          contactWorldY: g ? g.contactWorldY : null,
          camY: +app.scene3d.camera.position.y.toFixed(4),
        };
      }, id));
      rows[rows.length - 1].pitch = pitch;
    }
    out[id] = rows;
  }
  fs.writeFileSync(path.join(OUT, 'probe.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

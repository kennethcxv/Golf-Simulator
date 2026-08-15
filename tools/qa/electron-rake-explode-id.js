// 9.4 (Goal 26) — NAME THE EXPLODED GEOMETRY.
//
// The photograph is already taken and the diagnosis written: with the rake
// equipped OUTDOORS, a cluster of eight or nine tan capsule lumps floats in the
// upper third with two flat planks driven through it, while the tool proper --
// a dark shaft with a green head -- sits correctly at the right edge.
//
// The hands were ruled out by measurement (world y 1.48/1.59 against a camera at
// 1.52). So the next question is not "what does it look like" but "what IS it",
// and that is answerable: every mesh within a couple of yards of the camera, by
// name, by parent chain, and by where it sits relative to the eye.
//
// WHAT WOULD MAKE THIS LIE, and is guarded:
//   - the rake is on the OUTDOOR belt and is not drawn indoors at all. Four
//     Goal 23 photographs failed exactly that way. The player is put outside and
//     the tool's group is confirmed drawn before anything is enumerated.
//   - matrixWorld, not local position: a lump parented to a mis-transformed node
//     has a perfectly innocent local offset.
//   - a mesh is only near the camera if its WORLD BOUNDS are, so the bounding
//     sphere is used rather than the origin -- a large mesh whose origin is far
//     away can still fill the top third.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-rake-explode-id.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/rake-explode');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  out.staged = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const c = ch.interior.position;
    const w = s3.walk.state;
    // OUTDOORS. The rake is on the outdoor belt and simply is not drawn inside.
    w.x = c.x + 30; w.z = c.z + 30; w.vx = 0; w.vz = 0; w.yaw = 0; w.pitch = 0;
    s3.walk.setTool('rake');
    return { inside: ch.isInside(w.x, w.z) };
  });
  await page.waitForTimeout(3000);
  out.equipped = await page.evaluate(() => ({ tool: window.__fw.scene3d.walk.getTool?.() ?? null }));
  console.log('STAGED', JSON.stringify(out.staged), 'EQUIPPED', JSON.stringify(out.equipped));

  out.near = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const cam = s3.camera;
    cam.updateMatrixWorld(true);
    const camPos = cam.position;
    const rows = [];
    s3.scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) return;
      if (!o.visible) return;
      let p = o.parent;
      let visibleChain = true;
      const chain = [];
      while (p) {
        if (!p.visible) visibleChain = false;
        if (p.name) chain.push(p.name);
        p = p.parent;
      }
      if (!visibleChain) return;
      o.updateWorldMatrix(true, false);
      if (!o.geometry) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const bs = o.geometry.boundingSphere;
      if (!bs) return;
      // world centre of the bounding sphere, and a world-scaled radius
      const e = o.matrixWorld.elements;
      const cx = e[0] * bs.center.x + e[4] * bs.center.y + e[8] * bs.center.z + e[12];
      const cy = e[1] * bs.center.x + e[5] * bs.center.y + e[9] * bs.center.z + e[13];
      const cz = e[2] * bs.center.x + e[6] * bs.center.y + e[10] * bs.center.z + e[14];
      const scale = Math.max(
        Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]),
      );
      const r = bs.radius * scale;
      const d = Math.hypot(cx - camPos.x, cy - camPos.y, cz - camPos.z);
      // "near the camera" means its SURFACE is near, not its origin
      if (d - r > 2.5) return;
      rows.push({
        name: o.name || '(unnamed)',
        parents: chain.slice(0, 4),
        distToSurface: +(d - r).toFixed(3),
        radius: +r.toFixed(3),
        aboveCameraY: +(cy - camPos.y).toFixed(3),
        world: [+cx.toFixed(2), +cy.toFixed(2), +cz.toFixed(2)],
        verts: o.geometry.attributes?.position?.count ?? null,
        type: o.isSkinnedMesh ? 'skinned' : (o.isInstancedMesh ? 'instanced' : 'mesh'),
        material: Array.isArray(o.material) ? 'multi'
          : (o.material?.color ? `#${o.material.color.getHexString()}` : null),
      });
    });
    rows.sort((a, b) => b.aboveCameraY - a.aboveCameraY);
    return { camY: +camPos.y.toFixed(3), count: rows.length, rows };
  });
  console.log('NEAR-CAMERA count', out.near.count, 'camY', out.near.camY);
  for (const r of out.near.rows.slice(0, 24)) console.log('  ', JSON.stringify(r));

  // The cluster the photograph shows is ABOVE the eye. Group what is up there by
  // its top-most named ancestor, because "nine unnamed capsules" is not
  // actionable and "nine capsules under Tool_rake" is.
  out.aboveEye = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const cam = s3.camera;
    const groups = {};
    s3.scene.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.geometry) return;
      o.updateWorldMatrix(true, false);
      const e = o.matrixWorld.elements;
      const dy = e[13] - cam.position.y;
      const d = Math.hypot(e[12] - cam.position.x, e[13] - cam.position.y, e[14] - cam.position.z);
      if (dy < 0.15 || d > 3) return;
      let top = o;
      let label = o.name || '(unnamed)';
      let p = o.parent;
      while (p) { if (p.name) { label = p.name; top = p; } p = p.parent; }
      const key = `${label}`;
      groups[key] = groups[key] || { count: 0, names: [], maxAbove: 0 };
      groups[key].count += 1;
      if (groups[key].names.length < 6) groups[key].names.push(o.name || '(unnamed)');
      if (dy > groups[key].maxAbove) groups[key].maxAbove = +dy.toFixed(3);
      void top;
    });
    return groups;
  });
  console.log('ABOVE-EYE BY ROOT', JSON.stringify(out.aboveEye, null, 2));

  await page.screenshot({ path: path.join(OUT, 'rake-level.png') });
  fs.writeFileSync(path.join(OUT, 'rake-explode.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

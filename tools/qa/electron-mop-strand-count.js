// 5.x (Goal 26) — HOW MANY OF THE 972 STRANDS ACTUALLY DRAW?
//
// The head photographs as about forty blunt quills radiating from the hub. The
// rig reports strandCount 972. Those two cannot both be describing what is on
// screen, so this asks the renderer rather than the rig: the InstancedMesh
// layers carry `count` (how many instances are drawn) and `instanceMatrix.count`
// (how many were allocated), and a `count` far below the allocation is the whole
// explanation. Frustum culling and layer masks are read too, because this repo
// has already been caught measuring geometry that never draws.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-mop-strand-count.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-strand-count');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const c = s3.clubhouse().interior.position;
    const w = s3.walk.state;
    w.x = c.x; w.z = c.z + 2; w.yaw = 0; w.pitch = -0.72;
    s3.walk.setTool('mop');
  });
  await page.waitForTimeout(3000);

  out.layers = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let rigNode = null;
    s3.scene.traverse((o) => {
      if (!rigNode && o.userData?.strandRig?.tipsWorld) rigNode = o;
    });
    if (!rigNode) return { ok: false };
    const rig = rigNode.userData.strandRig;
    const rows = [];
    rig.root.traverse((o) => {
      if (!o.isInstancedMesh) return;
      rows.push({
        name: o.name || '(unnamed)',
        drawnCount: o.count,
        allocated: o.instanceMatrix ? o.instanceMatrix.count : null,
        visible: o.visible,
        frustumCulled: o.frustumCulled,
        layerMask: o.layers.mask,
        radialSegments: o.geometry && o.geometry.parameters
          ? o.geometry.parameters.radialSegments : null,
        radiusTop: o.geometry && o.geometry.parameters
          ? o.geometry.parameters.radiusTop : null,
        radiusBottom: o.geometry && o.geometry.parameters
          ? o.geometry.parameters.radiusBottom : null,
        height: o.geometry && o.geometry.parameters
          ? o.geometry.parameters.height : null,
      });
    });
    return {
      ok: true, strandCount: rig.strandCount, clumpCount: rig.clumpCount, layers: rows,
    };
  });
  console.log('LAYERS', JSON.stringify(out.layers, null, 2));
  fs.writeFileSync(path.join(OUT, 'strand-count.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

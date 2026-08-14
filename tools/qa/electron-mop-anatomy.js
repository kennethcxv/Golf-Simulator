// 5.1 (Goal 26) — WHAT IS THE MOP HEAD ACTUALLY MADE OF, RIGHT NOW?
//
// The photograph at the default camera shows a sparse spray of thin spikes with
// a visible GAP between the shaft end and the yarn -- the owner's "too thin" and
// "it does not connect to the stem", both plainly true in the frame.
//
// But the code says the head is 432 strands on a 128 mm disc, which should be
// dense. Those two cannot both be right, so this asks the running game rather
// than reading further: how many strand instances exist, are they VISIBLE, what
// is their world size, and is there anything between the yarn and the shaft.
//
// The trap this is built to avoid is the one this project keeps paying for: a
// scene-graph count is not proof of a draw, and a rig that exists but is hidden
// looks exactly like a rig that is thin.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-mop-anatomy.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-anatomy');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000);

  await page.evaluate(() => window.__fw.scene3d.walk.setTool('mop'));
  await page.waitForTimeout(2500);

  // BY NAME, FROM THE SCENE. My first version reached for s3.toolRigs.mop, which
  // is not the handle -- it reported foundRig:false while the scene search in the
  // same breath found "MopStrandRig". An accessor that does not exist returns
  // undefined, and undefined reads exactly like "there is no mop".
  out.anatomy = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let rig = null;
    s3.scene.traverse((o) => { if (!rig && /MopStrandRig/i.test(o.name || '')) rig = o; });
    if (!rig) return { found: false };
    rig.updateWorldMatrix(true, true);
    const nodes = [];
    let instanceTotal = 0;
    rig.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const chainVisible = (() => {
        for (let n = o; n; n = n.parent) if (!n.visible) return false;
        return true;
      })();
      if (o.isInstancedMesh) instanceTotal += o.count;
      nodes.push({
        name: o.name || '(unnamed)',
        type: o.type,
        instances: o.isInstancedMesh ? o.count : null,
        visible: o.visible,
        chainVisible,
        layers: o.layers.mask,
      });
    });
    // World size WITHOUT reaching for THREE off the scene object -- s3.THREE does
    // not exist, and my first attempt died on it. Geometry bounding boxes plus the
    // node's own world scale give the same answer with no constructor needed.
    let size = [0, 0, 0];
    try {
      let maxR = 0;
      let maxY = 0;
      rig.traverse((o) => {
        if (!o.geometry) return;
        o.geometry.computeBoundingBox?.();
        const bb = o.geometry.boundingBox;
        if (!bb) return;
        maxR = Math.max(maxR, Math.abs(bb.max.x), Math.abs(bb.min.x));
        maxY = Math.max(maxY, Math.abs(bb.max.y), Math.abs(bb.min.y));
      });
      size = [+(maxR * 2).toFixed(4), +maxY.toFixed(4), +(maxR * 2).toFixed(4)];
    } catch { size = [0, 0, 0]; }
    // and what sits between the yarn and the shaft: the collar is the rig's parent
    const collar = rig.parent;
    const collarKids = [];
    if (collar) {
      collar.children.forEach((c) => {
        if (c === rig) return;
        collarKids.push({ name: c.name || '(unnamed)', type: c.type, visible: c.visible });
      });
    }
    return {
      found: true,
      nodes,
      instanceTotal,
      headSize: size,
      collarName: collar ? (collar.name || '(unnamed)') : null,
      collarSiblings: collarKids,
    };
  });
  console.log('MOP-HEAD', JSON.stringify({
    found: out.anatomy.found,
    meshes: out.anatomy.nodes?.length,
    instanceTotal: out.anatomy.instanceTotal,
    headSize: out.anatomy.headSize,
    collar: out.anatomy.collarName,
  }));
  for (const n of (out.anatomy.nodes || [])) {
    console.log(`  ${String(n.name).padEnd(24)} ${String(n.type).padEnd(14)} inst=${n.instances ?? '-'} vis=${n.visible}/${n.chainVisible}`);
  }
  console.log('COLLAR-SIBLINGS', JSON.stringify(out.anatomy.collarSiblings));

  fs.writeFileSync(path.join(OUT, 'mop-anatomy.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

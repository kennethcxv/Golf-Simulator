// 5.1 (Goal 26) — WHY DO 432 AUTHORED STRANDS PHOTOGRAPH AS A DOZEN?
//
// SHIPPED_MOP_YARN says 432 strands on a 128 mm disc with 18 clumps and 0.32
// splay. The photograph at the default player camera shows a sparse spray of thin
// spikes. Both cannot be true.
//
// My last probe searched the scene for "MopStrandRig" and found THE BROOM'S rig
// -- both tools build theirs from mopStrands.js and both carry that name, so a
// name search returns whichever comes first, and the parent turned out to be
// LOD0_BroomHeld. That is why this one does NOT search by name. It collects every
// object carrying `userData.strandRig` (the handle toolViewmodel.js actually
// assigns) and reports each with the tool it belongs to, so the mop and the broom
// cannot be confused again.
//
// For each rig it reports what a photograph would show rather than what the
// parameters claim: how many instanced strands exist, whether the whole parent
// chain is visible, and -- the number that decides "too thin" -- the FRUSTUM-
// CULLED and matrix-zero cases that make an instance exist without drawing.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-mop-strand-truth.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-strand-truth');
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
  await page.waitForTimeout(3000);

  out.rigs = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const found = [];
    const roots = [s3.scene];
    // Rig tools draw through their own scene, so a sweep of only s3.scene can
    // miss the held viewmodel entirely.
    for (const rig of Object.values(s3.toolRigs || {})) {
      if (rig?.scene) roots.push(rig.scene);
      if (rig?.group) roots.push(rig.group);
    }
    const seen = new Set();
    for (const root of roots) {
      if (!root || seen.has(root)) continue;
      seen.add(root);
      root.traverse((o) => {
        if (!o.userData || !o.userData.strandRig) return;
        const chain = [];
        let chainVisible = true;
        for (let n = o; n; n = n.parent) {
          chain.push(n.name || n.type);
          if (!n.visible) chainVisible = false;
        }
        const layers = [];
        let instanceTotal = 0;
        let zeroScaled = 0;
        o.traverse((m) => {
          if (!m.isInstancedMesh) return;
          instanceTotal += m.count;
          // An instance whose matrix collapses to zero scale exists in the count
          // and draws nothing. This is the shape that makes a parameter lie.
          const mat = new Array(16);
          let collapsed = 0;
          for (let i = 0; i < m.count; i += 1) {
            m.getMatrixAt(i, { elements: mat, fromArray() {} });
            const sx = Math.hypot(mat[0] || 0, mat[1] || 0, mat[2] || 0);
            if (!(sx > 1e-6)) collapsed += 1;
          }
          zeroScaled += collapsed;
          layers.push({
            name: m.name || '(unnamed)',
            count: m.count,
            visible: m.visible,
            frustumCulled: m.frustumCulled,
            collapsed,
          });
        });
        found.push({
          owner: chain.slice(0, 6).join(' < '),
          chainVisible,
          instanceTotal,
          zeroScaled,
          layers,
          reportedStrandCount: o.userData.strandRig.strandCount ?? null,
          reportedDrawCalls: o.userData.strandRig.drawCalls ?? null,
        });
      });
    }
    return found;
  });

  // 5.1's SECOND fault: "It does not connect to the stem. There is a gap between
  // the yarn and the shaft." So: what meshes does the mop actually carry, is
  // there a collar among them, and is it visible?
  out.mopParts = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let tool = null;
    for (const rig of Object.values(s3.toolRigs || {})) {
      const root = rig?.scene || rig?.group;
      if (!root) continue;
      root.traverse((o) => { if (!tool && o.name === 'Tool_mop') tool = o; });
    }
    if (!tool) return { found: false };
    const parts = [];
    tool.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh && !/COLLAR|SOCKET/i.test(o.name || '')) return;
      o.geometry?.computeBoundingBox?.();
      const bb = o.geometry?.boundingBox;
      parts.push({
        name: o.name || '(unnamed)',
        type: o.type,
        visible: o.visible,
        y: +o.position.y.toFixed(4),
        size: bb ? [
          +(bb.max.x - bb.min.x).toFixed(4),
          +(bb.max.y - bb.min.y).toFixed(4),
          +(bb.max.z - bb.min.z).toFixed(4),
        ] : null,
      });
    });
    return { found: true, parts };
  });
  console.log('MOP-PARTS', out.mopParts.found ? out.mopParts.parts.length : 'NOT FOUND');
  for (const p of (out.mopParts.parts || [])) {
    console.log(`    ${String(p.name).padEnd(26)} vis=${String(p.visible).padEnd(5)} y=${p.y} size=${p.size ? p.size.join('x') : '-'}`);
  }

  console.log('RIGS FOUND', out.rigs.length);
  for (const r of out.rigs) {
    console.log(`  owner        ${r.owner}`);
    console.log(`    chainVisible ${r.chainVisible}  instances ${r.instanceTotal}  reported ${r.reportedStrandCount} strands / ${r.reportedDrawCalls} draws`);
    for (const l of r.layers) {
      console.log(`    layer ${String(l.name).padEnd(20)} count=${l.count} vis=${l.visible} culled=${l.frustumCulled}`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'mop-strand-truth.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

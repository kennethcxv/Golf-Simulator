// GOAL 29 P2 — why did the gondola batch not form? Read the blockers off the
// live subtree instead of guessing.
//   node tools/qa/run-electron.cjs tools/qa/goal29-gondola-probe.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/goal29-draws');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(9000); // let merch.onReady content land

  const out = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const root = ch.interior.getObjectByName('TieredRetailGondola');
    if (!root) return { err: 'no TieredRetailGondola in interior' };
    const rows = [];
    const chain = (o) => {
      const reasons = [];
      for (let n = o; n; n = n.parent) {
        const u = n.userData || {};
        if (u.fixtureId || u.movable) reasons.push(`movable-fixture@${n.name || n.type}`);
        if (u.liveVisualHierarchy) reasons.push('live-visual-hierarchy');
        if (u.visibilityGated) reasons.push('visibility-gated');
        if (u.kind === 'item') reasons.push(`sim-item@${n.name || n.type}`);
        if (u.collision_proxy || u.helper) reasons.push('proxy-or-helper');
        if (n.animations?.length) reasons.push('ancestor-animations');
        if (/^(?:COL_|COLLISION_|VOLUME_)/i.test(n.name || '')) reasons.push(`col-name@${n.name}`);
        if (n === root) break;
      }
      return reasons;
    };
    let total = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      total += 1;
      if (rows.length >= 20) return;
      rows.push({
        name: o.name || o.type,
        visible: o.visible,
        chainVisible: (() => { for (let n = o; n; n = n.parent) { if (!n.visible) return false; if (n === root) break; } return true; })(),
        mask: o.layers.mask,
        arrayMat: Array.isArray(o.material),
        transparent: !!o.material?.transparent,
        depthWrite: o.material?.depthWrite !== false,
        interleaved: !!o.geometry?.attributes?.position?.isInterleavedBufferAttribute,
        userDataKeys: Object.keys(o.userData || {}),
        blockers: chain(o),
      });
    });
    return { rootVisible: root.visible, totalMeshes: total, kitChildren: root.children.map((c) => c.name || c.type), rows };
  });
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'gondola-probe.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

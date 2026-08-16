// GOAL 29 P2 — name the anonymous census roots (Group#750, Group#1248, the
// 9-mesh Group wave) by their CONTENT: named descendants, material names,
// world bounds. Chain-visible subtrees only — hidden geometry is not a draw.
//   node tools/qa/run-electron.cjs tools/qa/goal29-root-identify.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/goal29-draws');
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(9000);

  const out = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const rows = [];
    const inspect = (root, where) => {
      for (const child of root.children) {
        if (!child.visible) continue;
        const anonymous = !child.name || child.name === '';
        let meshes = 0;
        const names = new Set();
        const mats = new Set();
        let minX = Infinity; let minY = Infinity; let minZ = Infinity;
        let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
        child.updateMatrixWorld(true);
        child.traverseVisible((o) => {
          if (o.name && names.size < 6) names.add(o.name);
          if (!o.isMesh || o.layers.mask === 0) return;
          meshes += 1;
          if (o.material?.name && mats.size < 5) mats.add(o.material.name);
          if (o.geometry?.boundingSphere === null) o.geometry.computeBoundingSphere();
          const bs = o.geometry?.boundingSphere;
          if (bs) {
            const c = bs.center.clone().applyMatrix4(o.matrixWorld);
            minX = Math.min(minX, c.x - bs.radius); maxX = Math.max(maxX, c.x + bs.radius);
            minY = Math.min(minY, c.y - bs.radius); maxY = Math.max(maxY, c.y + bs.radius);
            minZ = Math.min(minZ, c.z - bs.radius); maxZ = Math.max(maxZ, c.z + bs.radius);
          }
        });
        if (meshes >= 4 && anonymous) {
          rows.push({
            where,
            childIndex: root.children.indexOf(child),
            type: child.type,
            meshes,
            descendantNames: [...names],
            materialNames: [...mats],
            center: meshes ? [((minX + maxX) / 2).toFixed(1), ((minY + maxY) / 2).toFixed(1), ((minZ + maxZ) / 2).toFixed(1)] : null,
            size: meshes ? [(maxX - minX).toFixed(1), (maxY - minY).toFixed(1), (maxZ - minZ).toFixed(1)] : null,
          });
        }
      }
    };
    inspect(ch.interior, 'interior');
    if (ch.group) inspect(ch.group, 'group');
    return rows;
  });
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'root-identify.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

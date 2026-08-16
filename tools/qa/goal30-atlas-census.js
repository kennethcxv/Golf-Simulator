// GOAL 30 — who carries the club_sign atlas (4b7996eb), where, facing which way
//   node tools/qa/run-electron.cjs tools/qa/goal30-atlas-census.js --clubhouse=pine-hills-v2
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(9000);
  const out = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const roots = new Map();
    s3.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (!mats.some((m) => m?.map?.name?.includes('4b7996eb'))) return;
      let r = o;
      while (r.parent && r.parent !== s3.scene) r = r.parent;
      if (!roots.has(r.uuid)) roots.set(r.uuid, { root: r, meshes: 0, names: [] });
      const e = roots.get(r.uuid);
      e.meshes += 1;
      if (e.names.length < 10) e.names.push(o.name || '(unnamed)');
    });
    return [...roots.values()].map((e) => {
      let n = 0;
      e.root.traverse(() => { n += 1; });
      return {
        rootName: e.root.name || '(unnamed)',
        type: e.root.type,
        pos: e.root.position.toArray().map((v) => +v.toFixed(1)),
        rotY: +e.root.rotation.y.toFixed(3),
        atlasMeshes: e.meshes,
        totalNodes: n,
        meshNames: e.names,
      };
    });
  });
  console.log(JSON.stringify(out, null, 1));
  return out;
}

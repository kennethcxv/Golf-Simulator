// A1 (Goal 23) — WHERE DO THE INTERIOR'S DRAW CALLS ACTUALLY LIVE?
//
// "Merge static meshes per material" is only safe where the meshes are really
// static. The clubhouse moves a great deal: build mode picks fixtures up, merch
// restocks, damage states swap, lights toggle, doors swing. A blanket merge
// would collapse all of that into one buffer and break it silently, which is
// worse than 548 draw calls.
//
// So before merging anything: which SUBTREE holds the mergeable meshes, and how
// many calls would each subtree actually save? A lever is worth pulling where
// the saving is large and the branch is inert, and nowhere else.
//
// Reported per top-level child of the interior, plus the same split for the
// prop-placement batch that already exists, so the new work does not duplicate
// the proven one.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-batch-census.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-batch-census');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(7000);

  out.census = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const rows = [];
    const scan = (root) => {
      let drawable = 0; let instanced = 0; let skinned = 0; let multiMat = 0;
      const byMat = new Map();
      root.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        if (!o.visible || o.layers.mask === 0) return;
        for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
        drawable += 1;
        if (o.isInstancedMesh) { instanced += 1; return; }
        if (o.isSkinnedMesh || o.morphTargetInfluences?.length) { skinned += 1; return; }
        if (Array.isArray(o.material)) { multiMat += 1; return; }
        if (!o.material || !o.geometry?.attributes?.position) return;
        byMat.set(o.material.uuid, (byMat.get(o.material.uuid) || 0) + 1);
      });
      const groups = [...byMat.values()];
      return {
        drawable,
        instanced,
        skinned,
        multiMat,
        mergeableMeshes: groups.reduce((s, n) => s + n, 0),
        materials: groups.length,
        wouldSave: groups.reduce((s, n) => s + (n - 1), 0),
      };
    };
    for (const child of ch.interior.children) {
      const s = scan(child);
      if (!s.drawable) continue;
      rows.push({ name: child.name || child.type, ...s });
    }
    rows.sort((a, b) => b.wouldSave - a.wouldSave);
    const totals = scan(ch.interior);
    return { total: totals, rows: rows.slice(0, 25), topLevelChildren: ch.interior.children.length };
  });

  fs.writeFileSync(path.join(OUT, 'batch-census.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-BATCH-CENSUS');
  console.log(JSON.stringify(out.census, null, 2));
  return out;
}

// ROUND 5 — WHOSE material is the last page-turn program?
//
// One `basic` shader still compiles on the first turn, and every structural
// diff has come back empty: identical scene mesh count either side, no new
// objects, no new geometries now that hidden objects are drawn during the warm.
// So stop diffing the graph and ask the RENDERER which material owns the
// program: three keeps the compiled program per material in
// renderer.properties, so the new cacheKey can be matched straight back to the
// material that asked for it.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-pageturn-owner.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/pageturn-owner');
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
  await page.waitForTimeout(6500);

  const canvas = await page.$('#game') || await page.$('canvas');
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const r = ch.ledgerBook?.root;
    if (!r) return;
    r.updateWorldMatrix(true, false);
    const e = r.matrixWorld.elements;
    const w = window.__fw.scene3d.walk.state;
    const c = ch.interior.position;
    let dx = c.x - e[12]; let dz = c.z - e[14];
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    w.x = e[12] + dx * 1.9; w.z = e[14] + dz * 1.9; w.vx = 0; w.vz = 0;
    const lx = e[12] - w.x; const lz = e[14] - w.z;
    const h = Math.hypot(lx, lz) || 0.001;
    w.yaw = Math.atan2(-lx / h, -lz / h);
    const eye = window.__fw.scene3d?.camera?.position?.y;
    w.pitch = Math.atan2(e[13] - (Number.isFinite(eye) ? eye : 1.62), h);
  });
  await page.waitForTimeout(1200);
  await page.keyboard.press('k');
  await page.waitForTimeout(2200);
  await page.keyboard.press('e');
  await page.waitForTimeout(2800);

  const keys = () => page.evaluate(() => (
    (window.__fw.scene3d.renderer.info.programs || []).map((p) => p.cacheKey || '')));
  const before = await keys();

  await page.keyboard.press('e'); // the first turn
  await page.waitForTimeout(2500);
  const after = await keys();
  const beforeSet = new Set(before);
  const fresh = after.filter((k) => !beforeSet.has(k));

  // Match the fresh cacheKey back to the material holding it.
  out.owners = await page.evaluate((freshKeys) => {
    const s3 = window.__fw.scene3d;
    const props = s3.renderer.properties;
    if (!props || typeof props.get !== 'function') return 'renderer.properties unavailable';
    const wanted = new Set(freshKeys);
    const hits = [];
    const seen = new Set();
    const inspect = (root, rootLabel) => {
      root.traverse((o) => {
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of mats) {
          if (!m || seen.has(m.uuid)) continue;
          seen.add(m.uuid);
          let key = null;
          try { key = props.get(m)?.currentProgram?.cacheKey ?? null; } catch { /* not built */ }
          if (key && wanted.has(key)) {
            hits.push({
              root: rootLabel,
              mesh: o.name || '(unnamed)',
              parent: o.parent?.name || '(no parent)',
              materialType: m.type,
              materialName: m.name || '(unnamed)',
              side: m.side,
              transparent: m.transparent,
              hasMap: !!m.map,
              visible: o.visible,
            });
          }
        }
      });
    };
    inspect(s3.scene, 'scene');
    // The viewmodel/held pass can live outside the main scene graph.
    const held = s3.walk?.viewmodelRoot?.() ?? null;
    if (held) inspect(held, 'viewmodel');
    return hits;
  }, fresh);

  out.summary = {
    freshKeys: fresh.map((k) => String(k).slice(0, 120)),
    ownerCount: Array.isArray(out.owners) ? out.owners.length : out.owners,
    owners: Array.isArray(out.owners) ? out.owners.slice(0, 8) : out.owners,
  };
  fs.writeFileSync(path.join(OUT, 'owner.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('PAGETURN-OWNER', JSON.stringify(out.summary, null, 2));
  return out;
}

// ROUND 5 — WHICH shader compiles on the first ledger page turn?
//
// The first turn still costs ~34 ms with +1 GL program and +2 geometries, even
// with the deferred warm reporting hands:done sweep:done. The leaf meshes are
// built eagerly at construction and compileAsync traverses hidden objects, so
// "the leaf's material" is a guess -- and a guess is what sent the last two
// warm attempts at the wrong target.
//
// three keeps every compiled program in renderer.info.programs with a cacheKey
// that encodes the shader name and its defines. Diffing that list across the
// turn NAMES the program instead of inferring it. The same for geometry: the
// ledger subtree is walked before and after so the two new buffers can be
// identified by the mesh that owns them.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-pageturn-program.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/pageturn-program');
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
  await page.waitForTimeout(6500); // let the deferred warm finish
  out.warmState = await page.evaluate(() => window.__fwWarm ?? null);

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

  const survey = () => page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const info = s3.renderer.info;
    const programs = (info.programs || []).map((p) => p.cacheKey || '(no key)');
    // THE WHOLE SCENE, not just the ledger. The first pass surveyed only the
    // book's subtree, found it unchanged, and so could say what did NOT change
    // and nothing about what did -- the two new geometries are created
    // somewhere else entirely.
    const meshes = [];
    const geoOwners = new Map();
    s3.scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
      const geo = o.geometry?.uuid ?? null;
      if (geo && !geoOwners.has(geo)) geoOwners.set(geo, o.name || o.type || '(unnamed)');
      meshes.push({
        name: o.name || '(unnamed)',
        visible: o.visible,
        geo: geo ? geo.slice(0, 8) : null,
        mat: Array.isArray(o.material)
          ? o.material.map((m) => `${m.type}:${m.uuid.slice(0, 8)}`).join(',')
          : `${o.material?.type}:${o.material?.uuid?.slice(0, 8)}`,
      });
    });
    return {
      programs,
      meshes,
      geoOwners: [...geoOwners.entries()].map(([uuid, name]) => `${uuid.slice(0, 8)}:${name}`),
      textures: info.memory.textures,
      geometries: info.memory.geometries,
    };
  });

  await page.keyboard.press('k');
  await page.waitForTimeout(2200);
  await page.keyboard.press('e'); // open
  await page.waitForTimeout(2800);

  const before = await survey();
  await page.keyboard.press('e'); // FIRST page turn
  await page.waitForTimeout(2500);
  const after = await survey();

  const beforeSet = new Set(before.programs);
  const newPrograms = after.programs.filter((k) => !beforeSet.has(k));
  const beforeMeshes = new Map(before.meshes.map((m) => [`${m.name}|${m.geo}`, m]));
  const changedMeshes = after.meshes.filter((m) => !beforeMeshes.has(`${m.name}|${m.geo}`));
  const beforeGeo = new Set(before.geoOwners.map((g) => g.split(':')[0]));
  const newGeoOwners = after.geoOwners.filter((g) => !beforeGeo.has(g.split(':')[0]));

  out.summary = {
    warmState: out.warmState,
    programsBefore: before.programs.length,
    programsAfter: after.programs.length,
    NEW_PROGRAM_KEYS: newPrograms.map((k) => String(k).slice(0, 220)),
    geometriesBefore: before.geometries,
    geometriesAfter: after.geometries,
    texturesBefore: before.textures,
    texturesAfter: after.textures,
    sceneMeshesBefore: before.meshes.length,
    sceneMeshesAfter: after.meshes.length,
    NEW_OR_CHANGED_MESHES: changedMeshes.slice(0, 12),
    NEW_GEOMETRY_OWNERS: newGeoOwners.slice(0, 12),
  };
  out.before = before;
  out.after = after;
  fs.writeFileSync(path.join(OUT, 'pageturn.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('PAGETURN-PROGRAM', JSON.stringify(out.summary, null, 2));
  return out;
}

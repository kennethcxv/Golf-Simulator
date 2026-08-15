// GOAL 27, THE 10-SECOND TARGET — WHERE DO 330 PROGRAMS COME FROM, AND WHAT
// IS THE FLOOR?
//
// The owner's hypothesis: 349 materials are the cold-boot cost. The unit of
// cost is actually the PROGRAM (material feature-shape x geometry shape x
// light/shadow state), so this measures three things after a settled boot:
//
//   1. every live program's cacheKey, clustered by the parameter axes that
//      differ — which axis is MULTIPLYING variants;
//   2. every material in the scene, classed by its texture-slot SHAPE
//      (which map slots are non-null) and its feature flags — how many
//      shape-classes exist versus how many could exist;
//   3. the floor estimate: programs if all materials of one type shared one
//      slot shape.
//
// Diagnostic only — reads, no writes.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-program-census.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/program-census');
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

  out.census = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const info = s3.renderer.info;

    // ---- 1. programs, clustered by differing key fields --------------------
    const programs = (info.programs || []).map((p) => ({
      key: String(p.cacheKey), used: p.usedTimes,
    }));
    // three's cacheKey is a comma-ish joined parameter list; split and vote
    // per field position on how many distinct values appear.
    const split = programs.map((p) => p.key.split(','));
    const width = Math.max(...split.map((f) => f.length));
    const fieldSpread = [];
    for (let i = 0; i < width; i += 1) {
      const values = new Set(split.map((f) => f[i] ?? ''));
      if (values.size > 1) fieldSpread.push({ field: i, distinct: values.size });
    }
    fieldSpread.sort((a, b) => b.distinct - a.distinct);

    // shader family = the first field (vertex glsl id / material type-ish);
    // count programs per family
    const famCount = new Map();
    for (const f of split) famCount.set(f[0], (famCount.get(f[0]) || 0) + 1);
    const families = [...famCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

    // ---- 2. materials by slot shape ---------------------------------------
    const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap', 'envMap'];
    const mats = new Map();
    const shapeCount = new Map();
    const typeCount = new Map();
    const ch = s3.clubhouse();
    for (const root of [ch.group, ch.interior, s3.scene].filter(Boolean)) {
      root.traverse((o) => {
        if (!o.material) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m || mats.has(m.uuid)) continue;
          const shape = [
            m.type,
            ...SLOTS.map((s) => (m[s] ? s.slice(0, 4) : '-')),
            m.transparent ? 't' : 'o',
            m.alphaTest > 0 ? 'at' : '-',
            m.vertexColors ? 'vc' : '-',
            m.side,
            m.flatShading ? 'fs' : '-',
          ].join('|');
          mats.set(m.uuid, shape);
          shapeCount.set(shape, (shapeCount.get(shape) || 0) + 1);
          typeCount.set(m.type, (typeCount.get(m.type) || 0) + 1);
        }
      });
    }
    const shapes = [...shapeCount.entries()].sort((a, b) => b[1] - a[1]);

    // UV audit for the untextured Standards: they can join the unified slot
    // shape only if every geometry that uses them carries a uv attribute
    const untexturedUsers = new Map(); // material uuid -> { withUv, withoutUv }
    for (const root of [ch.group, ch.interior, s3.scene].filter(Boolean)) {
      root.traverse((o) => {
        if (!o.isMesh || !o.material || !o.geometry) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m?.isMeshStandardMaterial) continue;
          if (m.map || m.normalMap || m.roughnessMap || m.metalnessMap) continue;
          const row = untexturedUsers.get(m.uuid) || { withUv: 0, withoutUv: 0 };
          if (o.geometry.attributes?.uv) row.withUv += 1; else row.withoutUv += 1;
          untexturedUsers.set(m.uuid, row);
        }
      });
    }
    let allUsersHaveUv = 0;
    let someUserLacksUv = 0;
    for (const row of untexturedUsers.values()) {
      if (row.withoutUv === 0 && row.withUv > 0) allUsersHaveUv += 1;
      else if (row.withoutUv > 0) someUserLacksUv += 1;
    }

    return {
      untexturedStandardMaterials: untexturedUsers.size,
      untexturedAllUsersHaveUv: allUsersHaveUv,
      untexturedSomeUserLacksUv: someUserLacksUv,
      programCount: programs.length,
      programsByFamilyTop: families.map(([k, n]) => ({ family: String(k).slice(0, 40), programs: n })),
      keyFieldSpreadTop: fieldSpread.slice(0, 12),
      materialCount: mats.size,
      materialTypes: [...typeCount.entries()].map(([t, n]) => ({ type: t, count: n })),
      slotShapeClassCount: shapes.length,
      slotShapesTop: shapes.slice(0, 20).map(([s, n]) => ({ shape: s, materials: n })),
      slotShapeSingletons: shapes.filter(([, n]) => n === 1).length,
    };
  });

  console.log(JSON.stringify(out.census, null, 2));
  fs.writeFileSync(path.join(OUT, 'program-census.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

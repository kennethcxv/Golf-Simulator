// D4 — how much is material interning actually worth?
//
// B9 measured the load as 9.7 s of one-time program compilation across 132
// programs, and costed interning at "days, touches every builder". Nobody has
// measured the CEILING: how many of those 132 programs are duplicates that an
// intern would collapse, and how many are genuinely distinct.
//
// This survey answers that before anyone spends the days. It walks the live
// scene and groups every material three ways:
//
//   instances      — how many Material objects exist
//   programKey     — three.js's OWN definition of "same program": the set of
//                    switches that change the generated shader. Two materials
//                    with this key equal compile ONE program, whatever else
//                    differs, so this is the floor interning can reach.
//   paramKey       — same program AND same uniforms. Two materials with this
//                    key equal are fully interchangeable: an intern could hand
//                    back one object and nothing on screen would change.
//
// The gap between instances and paramKey is what an intern removes for free.
// The gap between programKey and the renderer's own program count is the part
// that is NOT a duplication problem and will not move.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/material-intern');
  fs.mkdirSync(OUT, { recursive: true });

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  const t0 = Date.now();
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  const msToWalk = Date.now() - t0;
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 }).catch(() => {});
  const msToPlayable = Date.now() - t0;
  await page.waitForTimeout(4000);

  const survey = await page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d.scene || app.scene3d.getScene?.();
    const renderer = app.scene3d.renderer || app.scene3d.getRenderer?.();
    if (!scene) return { error: 'no scene handle exposed' };

    // The switches that actually change the generated program. Kept explicit
    // rather than JSON.stringify(material): a colour difference must NOT count
    // as a different program, and stringifying would make it one.
    const programKey = (m) => [
      m.type,
      m.vertexColors ? 'vc' : '',
      m.transparent ? 'tr' : '',
      m.side,
      m.flatShading ? 'flat' : '',
      m.map ? 'map' : '', m.normalMap ? 'nrm' : '', m.roughnessMap ? 'rgh' : '',
      m.metalnessMap ? 'mtl' : '', m.aoMap ? 'ao' : '', m.emissiveMap ? 'emi' : '',
      m.alphaMap ? 'alp' : '', m.envMap ? 'env' : '', m.lightMap ? 'lm' : '',
      m.displacementMap ? 'dsp' : '', m.bumpMap ? 'bmp' : '',
      m.skinning ? 'skin' : '', m.morphTargets ? 'morph' : '',
      m.fog ? 'fog' : '', m.depthWrite ? 'dw' : '', m.alphaTest > 0 ? 'at' : '',
      m.onBeforeCompile ? `obc:${String(m.onBeforeCompile).length}` : '',
      m.defines ? Object.keys(m.defines).sort().join(',') : '',
    ].join('|');

    const paramKey = (m) => [
      programKey(m),
      m.color?.getHexString?.() || '',
      m.roughness ?? '', m.metalness ?? '', m.opacity ?? '',
      m.emissive?.getHexString?.() || '', m.emissiveIntensity ?? '',
      m.map?.uuid || '', m.normalMap?.uuid || '', m.roughnessMap?.uuid || '',
      m.aoMap?.uuid || '', m.emissiveMap?.uuid || '',
      m.alphaTest ?? '', m.envMapIntensity ?? '',
    ].join('|');

    const seen = new Set();
    const byProgram = new Map();
    const byParam = new Map();
    const byType = new Map();
    let instances = 0;
    let meshes = 0;
    scene.traverse((node) => {
      if (!node.isMesh && !node.isSkinnedMesh && !node.isInstancedMesh && !node.isLine && !node.isPoints) return;
      meshes += 1;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of list) {
        if (!m || seen.has(m.uuid)) continue;
        seen.add(m.uuid);
        instances += 1;
        byProgram.set(programKey(m), (byProgram.get(programKey(m)) || 0) + 1);
        byParam.set(paramKey(m), (byParam.get(paramKey(m)) || 0) + 1);
        byType.set(m.type, (byType.get(m.type) || 0) + 1);
      }
    });

    // The biggest duplicate groups — the ones an intern pays for first.
    const worst = [...byParam.entries()]
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([key, n]) => ({ copies: n, key: key.slice(0, 110) }));

    return {
      meshes,
      materialInstances: instances,
      distinctPrograms_byKey: byProgram.size,
      distinctMaterials_byParams: byParam.size,
      rendererPrograms: renderer?.info?.programs?.length ?? null,
      rendererMemory: renderer?.info?.memory ?? null,
      byType: Object.fromEntries([...byType.entries()].sort((a, b) => b[1] - a[1])),
      biggestDuplicateGroups: worst,
      // The headline: what interning can and cannot reach.
      internableInstances: instances - byParam.size,
      programCeiling: byProgram.size,
    };
  });

  const result = { load: { msToWalk, msToPlayable }, survey };
  fs.writeFileSync(path.join(OUT, 'survey.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

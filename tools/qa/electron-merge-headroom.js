// PLAYTEST 3, ITEM 10 — MEASURE BEFORE YOU START.
//
// "817 materials over 2482 mergeable meshes is three meshes per material. If
// dedup must come first for the 30% target to be reachable, say so plainly and
// do not start."
//
// The honest answer needs three numbers that a scene-graph walk alone cannot
// give, and the difference between them is the whole question:
//
//   1. WHAT ACTUALLY DRAWS. `renderer.info.render.calls` after a real frame.
//      Not a mesh count -- this repo already batches ten props behind
//      `layers.mask = 0`, so the scene graph contains geometry that never
//      reaches the GPU, and a merge target derived from mesh counts would be
//      promising to remove draws that do not exist.
//   2. HOW MANY OF THOSE ARE MERGEABLE. A mesh can only merge with another if
//      they share a material AND neither needs its own transform at runtime --
//      so anything animated, skinned, instanced, or moved by the sim is out.
//   3. WHAT THE MERGE WOULD LEAVE. One draw per (material, group) among the
//      mergeable set. That is the floor a perfect merge reaches, and if the
//      floor is not 30% below the standing count then the merge cannot hit the
//      target no matter how well it is implemented.
//
// The dedup question is then arithmetic: if two materials are identical in every
// respect that affects a draw call, merging cannot combine their meshes but
// dedup would let it. So the same floor is computed a second time against
// DEDUPED material keys, and the gap between the two floors is exactly what
// dedup would buy.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-merge-headroom.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/merge-headroom');
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
  await page.waitForTimeout(8000);

  // Stand inside, at the default camera, and let a few frames settle so the
  // count is a standing frame rather than a load frame.
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const c = ch.interior.position;
    const w = s3.walk.state;
    for (const [dx, dz] of [[-2, 3], [-3, 2], [0, 4], [0, 0]]) {
      if (ch.isInside(c.x + dx, c.z + dz)) { w.x = c.x + dx; w.z = c.z + dz; break; }
    }
    w.vx = 0; w.vz = 0; w.pitch = -0.05;
  });
  await page.waitForTimeout(3000);

  out.measured = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const info = s3.renderer.info;
    const standingCalls = info.render.calls;
    const ch = s3.clubhouse();

    // A material key that captures everything a draw call cares about. Two
    // meshes can share a batch only if every one of these agrees.
    const matKey = (m) => [
      m.type, m.uuid,
    ].join('|');
    // ...and the DEDUPED key: the same material by VALUE rather than identity.
    // If two distinct material objects produce this same string they are
    // interchangeable at draw time, and dedup would let their meshes merge.
    const dedupKey = (m) => [
      m.type,
      m.color ? m.color.getHexString() : '-',
      m.map ? (m.map.uuid) : '-',
      m.normalMap ? m.normalMap.uuid : '-',
      m.roughnessMap ? m.roughnessMap.uuid : '-',
      m.emissiveMap ? m.emissiveMap.uuid : '-',
      m.roughness ?? '-', m.metalness ?? '-',
      m.transparent ? 't' : 'o', m.opacity ?? 1,
      m.side, m.alphaTest ?? 0, m.vertexColors ? 'vc' : '-',
      m.emissive ? m.emissive.getHexString() : '-',
      m.depthWrite ? 'dw' : '-', m.blending,
    ].join('|');

    const roots = [ch.group, ch.interior].filter(Boolean);
    let visibleMeshes = 0;
    let mergeable = 0;
    let excludedAnimated = 0;
    let excludedInstanced = 0;
    let excludedSkinned = 0;
    let excludedMulti = 0;
    let excludedHidden = 0;
    const byMat = new Set();
    const byDedup = new Set();
    let mergeableTris = 0;

    const chainVisible = (o) => {
      for (let p = o; p; p = p.parent) if (p.visible === false) return false;
      return true;
    };

    for (const root of roots) {
      root.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) return;
        if (!chainVisible(o)) { excludedHidden += 1; return; }
        // Batched-away geometry never draws; counting it as a saving would be
        // promising to remove a draw call that is not being made.
        if (o.layers && o.layers.mask === 0) { excludedHidden += 1; return; }
        visibleMeshes += 1;
        if (o.isInstancedMesh) { excludedInstanced += 1; return; }
        if (o.isSkinnedMesh) { excludedSkinned += 1; return; }
        if (Array.isArray(o.material)) { excludedMulti += 1; return; }
        // Anything the sim moves keeps its own transform, so it cannot be baked
        // into a shared buffer. `userData.dynamic` is not a convention here, so
        // this uses the only reliable signal: a mesh under a node the game
        // animates by name, plus anything explicitly marked.
        if (o.userData && (o.userData.dynamic || o.userData.pick || o.userData.animated)) {
          excludedAnimated += 1;
          return;
        }
        mergeable += 1;
        byMat.add(matKey(o.material));
        byDedup.add(dedupKey(o.material));
        const g = o.geometry;
        if (g && g.index) mergeableTris += g.index.count / 3;
        else if (g && g.attributes && g.attributes.position) mergeableTris += g.attributes.position.count / 3;
      });
    }

    return {
      standingCalls,
      visibleMeshes,
      mergeable,
      excluded: {
        instanced: excludedInstanced,
        skinned: excludedSkinned,
        multiMaterial: excludedMulti,
        animatedOrPickable: excludedAnimated,
        hiddenOrBatchedAway: excludedHidden,
      },
      distinctMaterials: byMat.size,
      distinctMaterialsAfterDedup: byDedup.size,
      mergeableTriangles: Math.round(mergeableTris),
      triangles: info.render.triangles,
      programs: info.programs ? info.programs.length : null,
    };
  });

  const m = out.measured;
  // What a PERFECT merge leaves: the non-mergeable draws stay, and the mergeable
  // ones collapse to one per material.
  const nonMergeableDraws = Math.max(0, m.standingCalls - m.mergeable);
  const floorAsIs = nonMergeableDraws + m.distinctMaterials;
  const floorDeduped = nonMergeableDraws + m.distinctMaterialsAfterDedup;
  const pct = (from, to) => +(((from - to) / from) * 100).toFixed(1);

  out.verdict = {
    standingDrawCalls: m.standingCalls,
    mergeableMeshes: m.mergeable,
    distinctMaterials: m.distinctMaterials,
    distinctMaterialsAfterDedup: m.distinctMaterialsAfterDedup,
    materialsDedupWouldRemove: m.distinctMaterials - m.distinctMaterialsAfterDedup,
    meshesPerMaterial: +(m.mergeable / Math.max(1, m.distinctMaterials)).toFixed(2),
    // THE ANSWER THE OWNER ASKED FOR
    bestCaseCallsAfterMerge: floorAsIs,
    bestCaseReductionPct: pct(m.standingCalls, floorAsIs),
    bestCaseCallsAfterDedupThenMerge: floorDeduped,
    bestCaseReductionPctWithDedup: pct(m.standingCalls, floorDeduped),
    thirtyPercentReachableWithoutDedup: pct(m.standingCalls, floorAsIs) >= 30,
    thirtyPercentReachableWithDedup: pct(m.standingCalls, floorDeduped) >= 30,
    excluded: m.excluded,
    note: 'best case assumes a perfect merge: every mergeable mesh of one material becomes one draw',
  };
  console.log('MERGE-HEADROOM', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'merge-headroom.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

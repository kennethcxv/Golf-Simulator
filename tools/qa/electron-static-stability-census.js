// GOAL 27 PHASE 3, REVISED FOR GOAL 29 PHASE 2 — WHICH MESHES ARE *ACTUALLY* STATIC?
//
// The merge-headroom estimate counts a mesh "mergeable" if it is not skinned,
// morphed, instanced, or multi-material. That filter is BLIND to parent-pivot
// articulation (delivery casters under a tilting group), to entry-record flags
// (movable fixtures), and to runtime MATERIAL swaps (shop progression floor).
// This census watches matrixWorld bit-stability across a live window AND walks
// ancestor flags, recording the exclusion reason per mesh.
//
// GOAL 29 REVISIONS, each paid for by a lie the first run shipped:
//   1. The first run's control was VOID ("0 of 1566 moved" — customers are
//      skinned and outside the candidate set, so a dead world and a live one
//      looked identical). Now a PLANTED MOVER wiggles via rAF through the
//      whole window; if it does not read moved, the census is void.
//   2. Doors sat in the truly-static set (ArchitecturalDoor_*, the three
//      Procedural*Fallback door systems) — they swing when used; idle
//      stability proves nothing. They are contract-excluded like the
//      delivery equipment.
//   3. ShopProgressionVisuals swaps MATERIALS at runtime (concrete/standard/
//      luxury floor). Matrix stability cannot see that; contract-excluded.
//   4. propPlacement now mirrors its entry flags into root.userData
//      (fixtureId / liveVisualHierarchy / visibilityGated). This census reads
//      them, and REQUIRES at least one mirrored flag to be visible when any
//      fixture-mounted entry exists — the mirror's live red-green.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-static-stability-census.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/static-stability-census');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'census';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  // snapshot 1: every candidate's matrixWorld, keyed by a stable path — plus
  // the planted mover, wiggling from before the first snapshot to after the
  // second so a frozen sampler cannot miss it
  await page.evaluate(() => {
    const fw = window.__fw;
    const s3 = fw.scene3d;
    const ch = s3.clubhouse();

    // ---- the planted mover -------------------------------------------------
    // plain Mesh donors only: the first mesh in traverse order is the addon
    // Sky, whose constructor ignores its arguments (the Sky trap)
    let donor = null;
    s3.scene.traverse((o) => {
      if (!donor && o.isMesh && o.constructor?.name === 'Mesh' && !Array.isArray(o.material) && o.geometry?.attributes?.position) donor = o;
    });
    const GeoC = donor.geometry.constructor;
    const BA = donor.geometry.attributes.position.constructor;
    const tri = new GeoC();
    tri.setIndex?.(null);
    for (const name of Object.keys(tri.attributes || {})) tri.deleteAttribute(name);
    tri.setAttribute('position', new BA(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]), 3));
    tri.computeVertexNormals();
    const mover = new donor.constructor();
    mover.geometry = tri;
    mover.material = donor.material;
    mover.name = 'Goal29PlantedMover';
    mover.frustumCulled = false;
    ch.interior.add(mover);
    let t = 0;
    const wiggle = () => {
      if (!window.__stab || !window.__stab.done) {
        t += 1;
        mover.position.set(Math.sin(t * 0.1), 1.5 + Math.cos(t * 0.1), 0);
        requestAnimationFrame(wiggle);
      }
    };
    requestAnimationFrame(wiggle);

    const candidates = new Map();
    const pathOf = (o) => {
      const parts = [];
      for (let n = o; n && n !== ch.interior && n !== ch.group; n = n.parent) {
        parts.push(`${n.name || n.type}#${n.id}`);
      }
      return parts.reverse().join('/');
    };
    for (const root of [ch.interior, ch.group].filter(Boolean)) {
      root.updateMatrixWorld(true);
      // traverseVisible, not traverse + own-flag: a mesh with visible:true
      // under a hidden ancestor (the tier-gated gondola, the suppressed
      // lounge) never draws, and counting it repeats the repo's recorded
      // scene-graph lie — the gondola sat in this census as 25 phantom saves
      // until the batcher's honest walk refused it.
      root.traverseVisible((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
        if (o.layers.mask === 0) return;
        if (Array.isArray(o.material) || !o.material || !o.geometry?.attributes?.position) return;
        if (o.morphTargetInfluences?.length) return;
        candidates.set(o.id, {
          path: pathOf(o),
          planted: o.name === 'Goal29PlantedMover',
          m: o.matrixWorld.toArray().join(','),
          materialUuid: o.material.uuid,
          castShadow: !!o.castShadow,
          receiveShadow: !!o.receiveShadow,
          side: o.material.side,
          // the exact-fold key: everything a pixel depends on EXCEPT color.
          // Untextured standard materials that agree on all of this can share
          // one draw with color moved to vertex colors, pixel-identically.
          exactFoldKey: (o.material.isMeshStandardMaterial
            && !o.material.map && !o.material.normalMap && !o.material.roughnessMap
            && !o.material.metalnessMap && !o.material.aoMap && !o.material.emissiveMap
            && !o.material.alphaMap && !o.material.bumpMap && !o.material.envMap
            && o.geometry.attributes.uv !== undefined)
            ? [
              'std-untextured',
              o.material.roughness, o.material.metalness,
              o.material.transparent, o.material.opacity,
              o.material.emissive?.getHex?.() ?? 0, o.material.emissiveIntensity,
              o.material.alphaTest, o.material.side, o.material.depthWrite,
              o.material.vertexColors,
              !!o.castShadow, !!o.receiveShadow,
            ].join('|')
            : `identity:${o.material.uuid}|${+!!o.castShadow}${+!!o.receiveShadow}`,
          tris: o.geometry.index ? o.geometry.index.count / 3
            : o.geometry.attributes.position.count / 3,
        });
      });
    }
    window.__stab = { first: candidates, firstAt: performance.now(), done: false };
    return candidates.size;
  });

  // let the world live: customers walk, clocks tick, sims run
  await page.waitForTimeout(15000);

  out.result = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const S = window.__stab;
    const moved = [];
    const stable = [];
    const vanished = [];
    const seen = new Set();
    let plantedMoved = false;
    let mirroredFixtureRoots = 0;
    let mirroredLiveHierarchyRoots = 0;
    let mirroredVisibilityGatedRoots = 0;

    // articulation flags walked up the ancestor chain, so the REASON a mesh
    // is excluded is recorded rather than inferred.
    //  - doors swing when used (idle stability proves nothing)
    //  - ShopProgressionVisuals swaps MATERIALS at runtime
    const ARTICULATED_ROOTS = /DeliveryEquipment|CheckoutHardware|FrontDeskLedgerBook|SimplifiedFrontDeskRegister|shop-stock|SHEET06|ArchitecturalDoor|DoorFallback|MainEntranceFallback|ShopProgressionVisuals/i;
    const flagsFor = (o) => {
      const flags = [];
      for (let n = o; n; n = n.parent) {
        if (n.animations?.length) flags.push('ancestor-animations');
        if (n.userData?.movable || n.userData?.fixtureId) flags.push('movable-fixture');
        if (n.userData?.liveVisualHierarchy) flags.push('live-visual-hierarchy');
        if (n.userData?.visibilityGated) flags.push('visibility-gated');
        if (n.userData?.kind === 'item') flags.push('sim-item');
        if (n.name && ARTICULATED_ROOTS.test(n.name)) { flags.push(`contract:${n.name}`); break; }
      }
      return flags;
    };

    for (const root of [ch.interior, ch.group].filter(Boolean)) {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (o.userData?.fixtureId) mirroredFixtureRoots += 1;
        if (o.userData?.liveVisualHierarchy) mirroredLiveHierarchyRoots += 1;
        if (o.userData?.visibilityGated) mirroredVisibilityGatedRoots += 1;
        if (!S.first.has(o.id) || seen.has(o.id)) return;
        seen.add(o.id);
        const before = S.first.get(o.id);
        const now = o.matrixWorld.toArray().join(',');
        if (before.planted) {
          if (now !== before.m) plantedMoved = true;
          return; // the mover is an instrument part, not a candidate
        }
        const flags = flagsFor(o);
        const row = {
          path: before.path,
          materialUuid: before.materialUuid,
          exactFoldKey: before.exactFoldKey,
          tris: Math.round(before.tris),
          flags,
        };
        if (now !== before.m) moved.push(row);
        else stable.push(row);
      });
    }
    for (const [id, before] of S.first) {
      if (!seen.has(id) && !before.planted) vanished.push(before.path);
    }
    S.done = true;

    // the honest mergeable set: stable AND unflagged
    const trulyStatic = stable.filter((r) => r.flags.length === 0);
    const byMat = new Map();
    const byFold = new Map();
    for (const r of trulyStatic) {
      byMat.set(r.materialUuid, (byMat.get(r.materialUuid) || 0) + 1);
      byFold.set(r.exactFoldKey, (byFold.get(r.exactFoldKey) || 0) + 1);
    }

    // per top-root attribution of the truly-static set
    const byRoot = new Map();
    for (const r of trulyStatic) {
      const root = r.path.split('/')[0] || '(interior)';
      const b = byRoot.get(root) || { meshes: 0, mats: new Set(), folds: new Set(), samples: [] };
      b.meshes += 1; b.mats.add(r.materialUuid); b.folds.add(r.exactFoldKey);
      if (b.samples.length < 2) b.samples.push(r.path); // names an anonymous Group
      byRoot.set(root, b);
    }
    const rootRows = [...byRoot.entries()]
      .map(([name, b]) => ({
        root: name,
        meshes: b.meshes,
        materials: b.mats.size,
        wouldSave: b.meshes - b.mats.size,
        wouldSaveExactFold: b.meshes - b.folds.size,
        samples: b.samples,
      }))
      .filter((r) => r.wouldSave > 0 || r.wouldSaveExactFold > 0)
      .sort((a, b) => b.wouldSaveExactFold - a.wouldSaveExactFold);

    return {
      candidates: S.first.size - 1, // minus the planted mover
      windowSec: +((performance.now() - S.firstAt) / 1000).toFixed(1),
      movedCount: moved.length,
      movedSample: moved.slice(0, 12).map((r) => r.path),
      vanishedCount: vanished.length,
      stableCount: stable.length,
      flaggedStableCount: stable.length - trulyStatic.length,
      trulyStaticCount: trulyStatic.length,
      trulyStaticMaterials: byMat.size,
      honestWouldSave: [...byMat.values()].reduce((s, n) => s + (n - 1), 0),
      exactFoldBuckets: byFold.size,
      exactFoldWouldSave: [...byFold.values()].reduce((s, n) => s + (n - 1), 0),
      topRoots: rootRows.slice(0, 18),
      mirroredFixtureRoots,
      mirroredLiveHierarchyRoots,
      mirroredVisibilityGatedRoots,
      control_plantedMover: plantedMoved
        ? 'ok — the planted mover read as moved'
        : 'PLANTED MOVER NEVER MOVED — CENSUS VOID',
      control_flagMirror: (mirroredFixtureRoots + mirroredLiveHierarchyRoots
        + mirroredVisibilityGatedRoots) > 0
        ? `ok — mirrors visible (fixture ${mirroredFixtureRoots}, live-hier ${mirroredLiveHierarchyRoots}, vis-gated ${mirroredVisibilityGatedRoots})`
        : 'NO MIRRORED ENTRY FLAGS FOUND — the propPlacement mirror is not in this build',
    };
  });

  console.log(JSON.stringify(out.result, null, 2));
  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  const ok = String(out.result.control_plantedMover).startsWith('ok')
    && String(out.result.control_flagMirror).startsWith('ok');
  console.log(ok ? 'CONTROLS OK' : 'CONTROLS FAILED — CENSUS VOID');
  if (!ok) process.exitCode = 1;
  return out;
}

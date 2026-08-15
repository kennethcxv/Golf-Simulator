// GOAL 27, PHASE 3 — WHICH MESHES ARE *ACTUALLY* STATIC?
//
// The merge-headroom estimate (−47.7%) counts a mesh "mergeable" if it is not
// skinned, morphed, instanced, or multi-material. That filter is BLIND to
// parent-pivot articulation: the delivery hand-truck's wheels are plain meshes
// under a tilting pivot group, and deliveryEquipment.js opens with an explicit
// contract that refs 41-45 stay articulated. A merge built on that count
// would weld casters to frames.
//
// This measures staticness the only way that cannot be argued with: LET THE
// WORLD RUN and watch every candidate's matrixWorld. Two snapshots far apart;
// only bit-identical matrices qualify. That is necessary but NOT sufficient —
// a hand-truck tilts only when USED — so the verdict also excludes any mesh
// with an ancestor that carries animation clips, interaction markers, or a
// subsystem articulation contract, and reports the reasons separately so the
// exclusion lists are auditable.
//
// NEGATIVE CONTROL: customers walk during the window. If the sampler reports
// zero moved matrices while customers are visibly animating, it measured
// nothing and says so.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-static-stability-census.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/static-stability-census');
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

  // snapshot 1: every candidate's matrixWorld, keyed by a stable path
  await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
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
      root.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
        if (!o.visible || o.layers.mask === 0) return;
        if (Array.isArray(o.material) || !o.material || !o.geometry?.attributes?.position) return;
        if (o.morphTargetInfluences?.length) return;
        candidates.set(o.id, {
          path: pathOf(o),
          m: o.matrixWorld.toArray().join(','),
          materialUuid: o.material.uuid,
          tris: o.geometry.index ? o.geometry.index.count / 3
            : o.geometry.attributes.position.count / 3,
        });
      });
    }
    window.__stab = { first: candidates, firstAt: performance.now() };
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

    // articulation flags walked up the ancestor chain, so the REASON a mesh
    // is excluded is recorded rather than inferred
    const ARTICULATED_ROOTS = /DeliveryEquipment|CheckoutHardware|FrontDeskLedgerBook|SimplifiedFrontDeskRegister|shop-stock|SHEET06/i;
    const flagsFor = (o) => {
      const flags = [];
      for (let n = o; n; n = n.parent) {
        if (n.animations?.length) flags.push('ancestor-animations');
        if (n.userData?.movable || n.userData?.fixtureId) flags.push('movable-fixture');
        if (n.userData?.kind === 'item') flags.push('sim-item');
        if (n.name && ARTICULATED_ROOTS.test(n.name)) { flags.push(`contract:${n.name}`); break; }
      }
      return flags;
    };

    for (const root of [ch.interior, ch.group].filter(Boolean)) {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!S.first.has(o.id) || seen.has(o.id)) return;
        seen.add(o.id);
        const before = S.first.get(o.id);
        const now = o.matrixWorld.toArray().join(',');
        const flags = flagsFor(o);
        const row = {
          path: before.path, materialUuid: before.materialUuid, tris: Math.round(before.tris), flags,
        };
        if (now !== before.m) moved.push(row);
        else stable.push(row);
      });
    }
    for (const [id, before] of S.first) {
      if (!seen.has(id)) vanished.push(before.path);
    }

    // the honest mergeable set: stable AND unflagged
    const trulyStatic = stable.filter((r) => r.flags.length === 0);
    const byMat = new Map();
    for (const r of trulyStatic) byMat.set(r.materialUuid, (byMat.get(r.materialUuid) || 0) + 1);
    const groups = [...byMat.values()];

    // per top-root attribution of the truly-static set
    const byRoot = new Map();
    for (const r of trulyStatic) {
      const root = r.path.split('/')[0] || '(interior)';
      const b = byRoot.get(root) || { meshes: 0, mats: new Set() };
      b.meshes += 1; b.mats.add(r.materialUuid);
      byRoot.set(root, b);
    }
    const rootRows = [...byRoot.entries()]
      .map(([name, b]) => ({ root: name, meshes: b.meshes, materials: b.mats.size, wouldSave: b.meshes - b.mats.size }))
      .filter((r) => r.wouldSave > 0)
      .sort((a, b) => b.wouldSave - a.wouldSave);

    return {
      candidates: S.first.size,
      windowSec: +((performance.now() - S.firstAt) / 1000).toFixed(1),
      movedCount: moved.length,
      movedSample: moved.slice(0, 12).map((r) => r.path),
      vanishedCount: vanished.length,
      stableCount: stable.length,
      flaggedStableCount: stable.length - trulyStatic.length,
      trulyStaticCount: trulyStatic.length,
      trulyStaticMaterials: groups.length,
      honestWouldSave: groups.reduce((s, n) => s + (n - 1), 0),
      topRoots: rootRows.slice(0, 15),
      control_worldWasAlive: moved.length > 0
        ? `alive (${moved.length} matrices moved)` : 'DEAD WORLD — CENSUS VOID',
    };
  });

  console.log(JSON.stringify(out.result, null, 2));
  fs.writeFileSync(path.join(OUT, 'stability-census.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

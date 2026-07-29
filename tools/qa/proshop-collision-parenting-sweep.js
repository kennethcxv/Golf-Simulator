async (page) => {
  // BLOCKER 6 — the collision and parenting sweep. Fifth instance of one class:
  // an object whose collider is missing, or is somewhere the object is not.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-collision-parenting-sweep.js
  //
  // Two symmetric questions, asked of the room rather than of the source:
  //
  //   MISSING   a floor-standing solid whose middle the player can stand in.
  //             Measured with walk.isFree at the object's own centre, which is
  //             the same test the player's body runs.
  //   ORPHANED  a collider with no geometry in it. That is the tray-collider
  //             shape: a solid the player bumps into with nothing there to see.
  //
  // The batching trap this room is known for (10 props draw from a merged
  // static batch with layers.mask = 0) is why footprints are measured from
  // GEOMETRY bounds via Box3.setFromObject and not from visibility: a prop that
  // never draws still has to be walked around, and a scene-graph probe that
  // filters on `visible` measures the wrong population. Objects are included by
  // having geometry, not by drawing.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const boot = async (variant) => {
    const query = variant === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2' : '';
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(async (seed) => {
      localStorage.clear();
      const E = await import('/src/sim/empire.js');
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
    }, SEED);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /^Continue/ }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForTimeout(3000);
  };

  const sweep = () => page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const L = await import('/src/data/shopLayout.js');
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const origin = ch.center;
    const walk = app.scene3d.walk;
    const cols = walk.colliders;
    const radius = walk.state.radius || 0.32;

    const solids = [...(cols.props || []), ...(cols.structures || [])];
    const floorY = ch.interior.getWorldPosition(new THREE.Vector3()).y;

    // The room only, so course furniture and the porch do not enter the count.
    const bounds = L.PUBLIC_ROOM_BOUNDS;
    const inRoom = (lx, lz) => lx >= bounds.minX - 1.2 && lx <= bounds.maxX + 1.2
      && lz >= bounds.minZ - 1.2 && lz <= bounds.maxZ + 1.2;

    // --- candidates: floor-standing solids with a real footprint --------------
    // Walk one level of "prop-like" groups rather than every mesh, so a chair is
    // one candidate and not eleven slats.
    const seen = new Set();
    const candidates = [];
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();

    // A merged static batch is ONE node holding the geometry of many props
    // scattered across the room, so its bounding box is the union of all of
    // them and its centre lands in open floor. The first run of this sweep
    // reported BATCH_PineHillsStatic_1 — 3.5 x 11.9 yd — as a prop with a
    // missing collider. It is not a prop; it is a draw call.
    const isBatch = (node) => /^BATCH_|StaticDressingBatch|RUNTIME_.*Batch/i.test(node.name || '');

    const consider = (node) => {
      if (!node || seen.has(node)) return;
      if (isBatch(node)) return;
      let hasGeometry = false;
      node.traverse((o) => { if (o.isMesh && o.geometry) hasGeometry = true; });
      if (!hasGeometry) return;
      box.setFromObject(node, true);
      if (!Number.isFinite(box.min.x) || box.isEmpty()) return;
      box.getSize(size);
      box.getCenter(centre);
      const lx = centre.x - origin.x;
      const lz = centre.z - origin.z;
      if (!inRoom(lx, lz)) return;
      // Floor-standing: its base is near the floor. A wall panel, a ceiling
      // fitting or a picture is not something a body walks into on the floor.
      const base = box.min.y - floorY;
      if (base > 0.45) return;
      // Big enough to be worth walking around, and tall enough to be in the way.
      if (size.x < 0.32 || size.z < 0.32 || size.y < 0.35) return;
      // Not the room itself.
      if (size.x > 12 || size.z > 12) return;
      seen.add(node);
      node.traverse((o) => seen.add(o));
      candidates.push({
        name: node.name || '(unnamed)',
        type: node.type,
        parent: node.parent?.name || null,
        local: { x: +lx.toFixed(2), z: +lz.toFixed(2) },
        size: { w: +size.x.toFixed(2), h: +size.y.toFixed(2), d: +size.z.toFixed(2) },
        world: { x: centre.x, z: centre.z },
        footprint: {
          minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z,
        },
      });
    };

    // Named roots first (props, fixtures, furniture), then anything else with
    // geometry that survived the filters above.
    const roots = [];
    ch.interior.traverse((o) => { if (o.name) roots.push(o); });
    for (const r of roots) consider(r);
    ch.interior.traverse((o) => consider(o));

    // --- MISSING: the player can stand in the middle of it -------------------
    const blockedAt = (wx, wz) => solids.some((c) => (c.minX !== undefined
      ? wx + radius > c.minX && wx - radius < c.maxX && wz + radius > c.minZ && wz - radius < c.maxZ
      : Math.hypot(wx - c.x, wz - c.z) < c.r + radius));
    const missing = [];
    for (const cand of candidates) {
      if (blockedAt(cand.world.x, cand.world.z)) continue;
      // The centre may sit in a hollow (a table's legs are at the corners), so
      // require the whole footprint to be walkable before calling it missing.
      const f = cand.footprint;
      const probes = [
        [f.minX + 0.1, f.minZ + 0.1], [f.maxX - 0.1, f.minZ + 0.1],
        [f.minX + 0.1, f.maxZ - 0.1], [f.maxX - 0.1, f.maxZ - 0.1],
      ];
      if (probes.some(([x, z]) => blockedAt(x, z))) continue;
      missing.push(cand);
    }

    // --- ORPHANED: a collider with nothing in it -----------------------------
    // Tested against ALL geometry in the room, not against the candidate list.
    // Candidates are filtered to floor-standing solids of a certain size, so a
    // collider around a wall-mounted or small prop would read as orphaned when
    // it is doing its job — the first run reported two on exactly that basis.
    // Traversed from the clubhouse GROUP, not from interior: a receiving-pad or
    // porch prop registers its collider like any other but its geometry hangs
    // off a different root, and reading only the interior reported one of those
    // as an orphan.
    const allGeometry = [];
    ch.group.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const b = new THREE.Box3().setFromObject(o, true);
      if (b.isEmpty() || !Number.isFinite(b.min.x)) return;
      allGeometry.push({
        minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z,
      });
    });
    const anyGeometryIn = (c) => allGeometry.some((f) => (
      f.maxX > c.minX && f.minX < c.maxX && f.maxZ > c.minZ && f.minZ < c.maxZ
    ));
    const orphaned = [];
    for (const c of cols.props || []) {
      if (c.minX === undefined) continue;      // circles are trees and characters
      if (c.door || c.shellWall) continue;     // the building
      const cx = (c.minX + c.maxX) / 2;
      const cz = (c.minZ + c.maxZ) / 2;
      const lx = cx - origin.x;
      const lz = cz - origin.z;
      if (!inRoom(lx, lz)) continue;
      if (anyGeometryIn(c)) continue;
      orphaned.push({
        local: { x: +lx.toFixed(2), z: +lz.toFixed(2) },
        size: { w: +(c.maxX - c.minX).toFixed(2), d: +(c.maxZ - c.minZ).toFixed(2) },
      });
    }

    return {
      candidates: candidates.length,
      colliders: (cols.props || []).length,
      missing,
      orphaned,
    };
  });

  // WHITELIST-OR-FAIL. Two things in the room are deliberately walk-through,
  // and both are soft decor a shoulder brushes past rather than furniture:
  //
  //   the umbrella stand   PROP_PLACEMENTS declares collision: 'none' for it
  //   the floor plants     same reason, authored by the interior
  //
  // Everything else that a body can stand inside is a defect. Adding to this
  // list is a deliberate act with a reason next to it; the sweep going green
  // because something was quietly appended is the failure mode a whitelist
  // exists to make visible.
  const WALK_THROUGH_BY_DESIGN = [
    { pattern: /umbrella_stand/i, why: "PROP_PLACEMENTS declares collision: 'none'" },
    { pattern: /floorPlant/i, why: 'soft decor; a shoulder passes through the fronds' },
  ];

  const out = { variants: {}, whitelist: WALK_THROUGH_BY_DESIGN.map((w) => String(w.pattern)) };
  for (const variant of ['pine-hills', 'pine-hills-v2']) {
    // eslint-disable-next-line no-await-in-loop
    await boot(variant);
    // eslint-disable-next-line no-await-in-loop
    const result = await sweep();
    result.waived = result.missing.filter(
      (m) => WALK_THROUGH_BY_DESIGN.some((w) => w.pattern.test(m.name)),
    ).map((m) => ({
      name: m.name,
      why: WALK_THROUGH_BY_DESIGN.find((w) => w.pattern.test(m.name)).why,
    }));
    result.missing = result.missing.filter(
      (m) => !WALK_THROUGH_BY_DESIGN.some((w) => w.pattern.test(m.name)),
    );
    out.variants[variant] = result;
  }
  out.totals = {
    missing: Object.values(out.variants).reduce((n, v) => n + v.missing.length, 0),
    waived: Object.values(out.variants).reduce((n, v) => n + v.waived.length, 0),
    orphaned: Object.values(out.variants).reduce((n, v) => n + v.orphaned.length, 0),
  };
  out.ok = out.totals.missing === 0 && out.totals.orphaned === 0;
  fs.writeFileSync(path.join(outDir, 'collision-parenting-sweep.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

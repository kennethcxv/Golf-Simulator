// B6 PRE-CHECK — is every placed prop somewhere a camera can see it?
//
// asset_087 was authored correctly and placed where no camera reaches it. That
// is not a texture problem and texturing it would have been wasted work, so the
// brief's rule is: find the placement defects first, fix them, and only then
// spend a texture budget.
//
// The question is answered empirically rather than from the placement registry,
// because the registry is what put the clock behind the wall in the first place.
// For every placed asset this samples the walkable floor, aims an eye at the
// asset from each reachable standing spot, and raycasts. An asset is VISIBLE if
// some reachable eye has an unobstructed line to it. One that no sample can see
// is either behind geometry, outside the room, or below the floor.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/asset-visibility');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  const result = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const club = app.scene3d.clubhouse();
    const interior = club.interior;

    // --- 1. find the placed assets ----------------------------------------
    //
    // From PROP_PLACEMENTS, which is the registry that put the clock behind the
    // wall — auditing it against what a camera can actually see is the point.
    // A first version matched scene objects by an `asset_0NN` in their names and
    // found ZERO of twenty, which its own control caught: loaded GLB roots are
    // named after the node inside the file, not the file. So the placement gives
    // the WHERE and the drawn geometry near it gives the WHAT.
    const { PROP_PLACEMENTS } = await import(
      new URL('src/render3d/assets51to100/propPlacement.js', document.baseURI).href);
    // All forty placed props, not just B6's sheets: asset_087 — the named
    // example of this defect — is sheet_09, so a check scoped to 61-80 could
    // not have caught the very case it was written for.
    const wanted = PROP_PLACEMENTS.slice();

    // Every drawn mesh in the room, with its world centre, once.
    const meshes = [];
    const _c = new THREE.Vector3();
    interior.updateWorldMatrix(true, true);
    interior.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.geometry) return;
      if (/^COL_/.test(o.name || '')) return; // collision proxies are not drawn
      const b = new THREE.Box3().setFromObject(o);
      if (b.isEmpty()) return;
      b.getCenter(_c);
      meshes.push({ mesh: o, box: b, cx: _c.x, cy: _c.y, cz: _c.z });
    });

    const found = new Map();
    for (const r of wanted) {
      const wx = interior.position.x + r.x;
      const wz = interior.position.z + r.z;
      // 1.2 yd of slack: a placement point is a socket, not a centroid.
      const near = meshes.filter((m) => ((m.cx - wx) ** 2 + (m.cz - wz) ** 2) < 1.44);
      found.set(r.n, { placement: r, world: { x: wx, z: wz }, near });
    }

    // --- 2. sample the walkable floor -------------------------------------
    //
    // NOT from the interior's bounding box. propPlacement parks hidden props at
    // y = -256, so that box is ~256 yd tall and its min.y is nowhere near the
    // boards — an earlier version of this driver put every sampled eye 256 yd
    // below the floor and duly reported all twenty assets invisible. Its own
    // `someAssetsAreVisible` control caught that, twice.
    //
    // The floor comes from the camera, which is standing on it. The bounds come
    // from the placement points themselves, which is the region the question is
    // actually about.
    const walk = app.scene3d.walk;
    const RADIUS = 0.34;
    const EYE = 1.62;
    const floorY = app.scene3d.camera.position.y - EYE;
    const floorYSource = 'camera height minus eye';
    const colliderBlocked = (x, z) => {
      const q = walk.colliderQuery || app.scene3d.colliderQuery;
      if (typeof q !== 'function') return false;
      const hit = q(x, z, RADIUS);
      return !!(hit && hit.blocked);
    };
    const xs = wanted.map((r) => interior.position.x + r.x);
    const zs = wanted.map((r) => interior.position.z + r.z);
    const bounds = {
      minX: Math.min(...xs) - 3, maxX: Math.max(...xs) + 3,
      minZ: Math.min(...zs) - 3, maxZ: Math.max(...zs) + 3,
    };
    const spots = [];
    for (let x = bounds.minX; x <= bounds.maxX; x += 0.7) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z += 0.7) {
        if (!colliderBlocked(x, z)) spots.push({ x, z });
      }
    }

    // --- 3. can any of them see it? ---------------------------------------
    const ray = new THREE.Raycaster();
    ray.far = 30;
    const eye = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const rows = [];
    for (const [n, rec] of [...found.entries()].sort((p, q) => p[0] - q[0])) {
      if (!rec.near.length) {
        rows.push({
          asset: n,
          placed: true,
          drawn: false,
          visible: false,
          placementWorld: { x: +rec.world.x.toFixed(2), z: +rec.world.z.toFixed(2) },
          mount: rec.placement.mount,
          note: 'the registry places this asset here and NO drawn mesh sits within 1.2 yd of it',
        });
        continue;
      }
      const tb = new THREE.Box3();
      for (const m of rec.near) tb.union(m.box);
      const centre = tb.getCenter(new THREE.Vector3());
      const size = tb.getSize(new THREE.Vector3());
      const selfSet = new Set(rec.near.map((m) => m.mesh));

      let seenFrom = null;
      let nearest = Infinity;
      let tried = 0;
      for (const sp of spots) {
        const d2 = (sp.x - centre.x) ** 2 + (sp.z - centre.z) ** 2;
        if (d2 > 144) continue;
        tried += 1;
        eye.set(sp.x, floorY + EYE, sp.z);
        dir.copy(centre).sub(eye);
        const dist = dir.length();
        if (dist < 0.4) continue;
        dir.normalize();
        ray.set(eye, dir);
        const hits = ray.intersectObject(interior, true)
          .filter((h) => h.object.visible && h.distance > 0.05 && !/^COL_/.test(h.object.name || ''));
        const first = hits[0];
        if (!first) continue;
        if (selfSet.has(first.object) || first.distance >= dist - 0.25) {
          if (dist < nearest) { nearest = dist; seenFrom = { x: +sp.x.toFixed(2), z: +sp.z.toFixed(2) }; }
        }
      }
      rows.push({
        asset: n,
        placed: true,
        drawn: true,
        visible: !!seenFrom,
        nearestVisibleYd: seenFrom ? +nearest.toFixed(2) : null,
        seenFrom,
        spotsInRange: tried,
        meshes: rec.near.length,
        mount: rec.placement.mount,
        centre: { x: +centre.x.toFixed(2), y: +centre.y.toFixed(2), z: +centre.z.toFixed(2) },
        sizeYd: { x: +size.x.toFixed(2), y: +size.y.toFixed(2), z: +size.z.toFixed(2) },
        belowFloor: centre.y < floorY - 0.2,
        aboveCeiling: centre.y > floorY + 3.6,
      });
    }
    return {
      roomBounds: {
        minX: +bounds.minX.toFixed(2), maxX: +bounds.maxX.toFixed(2),
        minZ: +bounds.minZ.toFixed(2), maxZ: +bounds.maxZ.toFixed(2),
      },
      floorY: +floorY.toFixed(3),
      floorYSource,
      standableSpots: spots.length,
      rows,
    };
  });

  const placed = result.rows.filter((r) => r.placed);
  const missing = result.rows.filter((r) => r.drawn === false).map((r) => r.asset);
  const invisible = placed.filter((r) => !r.visible).map((r) => r.asset);
  const checks = {
    // the control: if NOTHING is visible the instrument is broken, not the room
    someAssetsAreVisible: placed.some((r) => r.visible),
    // a run that finds no geometry at all is a broken instrument, not an empty room
    assetsWereFound: placed.some((r) => r.drawn),
    enoughStandingSpots: result.standableSpots > 20,
    everyPlacedAssetIsVisible: invisible.length === 0,
  };
  fs.writeFileSync(path.join(OUT, 'asset-visibility.json'),
    `${JSON.stringify({ ...result, missing, invisible, checks }, null, 1)}\n`);
  return {
    floorY: result.floorY,
    standableSpots: result.standableSpots,
    placedCount: placed.length,
    missing,
    invisible,
    rows: placed.map((r) => ({
      asset: r.asset, visible: r.visible, nearestVisibleYd: r.nearestVisibleYd, belowFloor: r.belowFloor,
    })),
    checks,
    ok: Object.values(checks).every(Boolean),
  };
}

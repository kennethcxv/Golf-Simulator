// C1 (Goal 24) — DOES RECAST ACTUALLY RUN IN THE SHIPPED PAGE?
//
// The library is vendored. That proves esbuild can bundle it and nothing else.
// The three things that could still make it useless in this game are all
// runtime, all invisible to a source test, and all specific to how this app is
// built:
//
//   1. THE CSP. The page loads over file:// with no bundler and a policy that
//      refuses eval outright. 'wasm-unsafe-eval' was added for exactly this and
//      has never been exercised by anything. If WebAssembly.compile is refused,
//      init() rejects and every navmesh plan dies here.
//   2. THE FILE:// ORIGIN. A WASM build that fetches a sibling .wasm file
//      resolves it against the document URL, and file:// fetches are blocked.
//      The wasm-compat entry inlines the binary as base64 to avoid that; this
//      run is what proves the vendored bundle is the compat one.
//   3. THE IMPORT MAP. `three` is bare and resolved by the map; a vendored
//      bundle that accidentally inlined its own copy of three would load fine
//      and then break instanceof across the boundary.
//
// So this boots the real game, imports the vendored bundle the way src/ would,
// initialises it, and BUILDS A NAVMESH FROM THE CLUBHOUSE'S OWN GEOMETRY, then
// asks it for a path across the room.
//
// CONTROL: a query far outside the mesh must FAIL to find a path. A navmesh that
// answers "yes, walk there" for every point is indistinguishable from a stub,
// and that is precisely the failure mode of a wrapper that silently caught its
// own init error.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-c1-recast-boots.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c1-recast');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], console: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  page.on('console', (m) => {
    const t = String(m.text());
    // CSP refusals arrive as console errors, not exceptions. Without this the
    // run reports "init failed" with no reason and the CSP is never suspected.
    if (/Content Security|CSP|wasm|WebAssembly/i.test(t)) out.console.push(t.slice(0, 200));
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  out.boot = await page.evaluate(async () => {
    const t0 = performance.now();
    try {
      // ONE module. Two bundles each carried their own copy of core, so init()
      // touched one and the generators used the other -- which reports itself
      // as "init must be called first" and sends you looking at the CSP.
      const core = await import(new URL('vendor/recast-navigation.module.js', document.baseURI).href);
      const gen = core;
      await core.init();
      return {
        ok: true,
        initMs: Math.round(performance.now() - t0),
        hasCrowd: typeof core.Crowd === 'function',
        hasNavMeshQuery: typeof core.NavMeshQuery === 'function',
        hasSoloGenerator: typeof gen.generateSoloNavMesh === 'function',
        hasTiledGenerator: typeof gen.generateTiledNavMesh === 'function',
      };
    } catch (e) {
      return { ok: false, why: String(e && e.message ? e.message : e).slice(0, 300) };
    }
  });
  console.log('C1 boot', JSON.stringify(out.boot));

  if (out.boot.ok) {
    out.bake = await page.evaluate(async () => {
      const core = await import(new URL('vendor/recast-navigation.module.js', document.baseURI).href);
      const gen = core;
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const t0 = performance.now();

      // THE CLUBHOUSE'S OWN GEOMETRY, not a test box. Walkable surfaces and the
      // things that block them: everything under the interior root that draws.
      const positions = [];
      const indices = [];
      let base = 0;
      let meshes = 0;
      const root = ch.interior;
      root.updateWorldMatrix(true, true);
      root.traverse((o) => {
        if (!o.isMesh || !o.visible || !o.geometry?.attributes?.position) return;
        // skip the enormous instanced scatter and anything not drawn
        if (o.isInstancedMesh) return;
        const g = o.geometry;
        const pos = g.attributes.position;
        if (pos.count > 40000) return;
        const m = o.matrixWorld.elements;
        for (let i = 0; i < pos.count; i += 1) {
          const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
          positions.push(
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
          );
        }
        if (g.index) {
          const idx = g.index;
          for (let i = 0; i < idx.count; i += 1) indices.push(base + idx.getX(i));
        } else {
          for (let i = 0; i < pos.count; i += 1) indices.push(base + i);
        }
        base += pos.count;
        meshes += 1;
      });
      const gatherMs = Math.round(performance.now() - t0);

      const t1 = performance.now();
      const result = gen.generateSoloNavMesh(
        Float32Array.from(positions),
        Uint32Array.from(indices),
        {
          // a person: half a yard wide, two yards tall, steps over a threshold
          cs: 0.18, ch: 0.12,
          walkableSlopeAngle: 35,
          walkableHeight: 14,
          walkableClimb: 3,
          walkableRadius: 2,
          maxEdgeLen: 12,
          maxSimplificationError: 1.3,
          minRegionArea: 8,
          mergeRegionArea: 20,
          maxVertsPerPoly: 6,
          detailSampleDist: 6,
          detailSampleMaxError: 1,
        },
      );
      const bakeMs = Math.round(performance.now() - t1);
      if (!result.success || !result.navMesh) {
        return {
          ok: false, why: result.error || 'generateSoloNavMesh returned no mesh',
          meshes, verts: positions.length / 3, tris: indices.length / 3, gatherMs, bakeMs,
        };
      }
      window.__qaNav = { core, navMesh: result.navMesh };
      return {
        ok: true, meshes, verts: positions.length / 3, tris: indices.length / 3,
        gatherMs, bakeMs, tiles: result.navMesh.getMaxTiles(),
      };
    });
    console.log('C1 bake', JSON.stringify(out.bake));
  }

  if (out.bake?.ok) {
    out.query = await page.evaluate(() => {
      const { core, navMesh } = window.__qaNav;
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const q = new core.NavMeshQuery(navMesh);
      const ip = ch.interior.position;
      const w = app.scene3d.walk.state;
      // A POINT IS NOT ON THE MESH JUST BECAUSE IT IS IN THE ROOM.
      //
      // The first version fed raw world positions straight to computePath and
      // got success:false at both ends -- which reads as "the navmesh is empty"
      // and is really "you asked about a point in mid-air". `walk.state` has no
      // `y` at all, so the start height was undefined and every coordinate went
      // in as NaN. Detour wants a polygon reference, so both ends are snapped
      // first and the snap DISTANCE is reported: a snap that had to travel
      // twenty yards is not the same answer as one that travelled two inches.
      // Stand INSIDE before asking. At boot the player is outside the building,
      // so "the start point is not on the navmesh" was true and told me nothing
      // about the mesh.
      const floorY = ip.y;
      const raw = {
        from: { x: ip.x - 5.6, y: floorY, z: ip.z + 4.4 },
        to: { x: ip.x, y: floorY, z: ip.z },
        far: { x: ip.x + 500, y: floorY, z: ip.z + 500 },
      };
      const snap = (p) => {
        try {
          const r = q.findClosestPoint(p);
          if (!r || !r.success) return { ok: false };
          const d = Math.hypot(r.point.x - p.x, r.point.y - p.y, r.point.z - p.z);
          return { ok: true, point: r.point, polyRef: r.polyRef, dist: +d.toFixed(2) };
        } catch (e) { return { ok: false, why: String(e.message || e).slice(0, 120) }; }
      };
      const a = snap(raw.from);
      const b = snap(raw.to);
      const f = snap(raw.far);
      let inside = null;
      if (a.ok && b.ok) {
        try { inside = q.computePath(a.point, b.point); } catch (e) { inside = { success: false, why: String(e.message || e).slice(0, 120) }; }
      }
      const len = (p) => (p && p.success && Array.isArray(p.path) ? p.path.length : 0);
      const bounds = (() => {
        try { const bb = navMesh.getTile(0).header(); return { polyCount: bb.polyCount(), vertCount: bb.vertCount() }; } catch { return null; }
      })();
      // HOW MUCH OF THE ROOM DOES THIS MESH ACTUALLY COVER? One successful snap
      // says one point worked. A grid says whether a person can walk about.
      let sampled = 0; let onMesh = 0;
      for (let dx = -8; dx <= 8; dx += 1) {
        for (let dz = -8; dz <= 8; dz += 1) {
          if (!ch.isInside(ip.x + dx, ip.z + dz, 0.4)) continue;
          sampled += 1;
          const r = snap({ x: ip.x + dx, y: floorY, z: ip.z + dz });
          if (r.ok && r.dist < 0.75) onMesh += 1;
        }
      }
      return {
        tile0: bounds,
        interiorSamples: sampled,
        interiorOnMesh: onMesh,
        coveragePct: sampled ? +((onMesh / sampled) * 100).toFixed(1) : 0,
        fromSnap: a, toSnap: b, farSnap: f,
        insidePoints: len(inside),
        insideSucceeded: !!inside?.success,
        // CONTROL: half a kilometre out. Snapping it should have to travel an
        // absurd distance, or fail outright.
        farSnapDist: f.ok ? f.dist : null,
      };
    });
    console.log('C1 query', JSON.stringify(out.query));
  }

  out.checks = {
    initialisedUnderTheCsp: out.boot?.ok === true,
    noCspRefusalLogged: !out.console.some((l) => /Content Security|refused/i.test(l)),
    generatorsPresent: out.boot?.hasSoloGenerator === true && out.boot?.hasTiledGenerator === true,
    crowdPresent: out.boot?.hasCrowd === true,
    // CONTROL: a bake over real geometry, not a toy
    bakedFromRealGeometry: out.bake?.ok === true && (out.bake?.tris ?? 0) > 5000,
    // the mesh answers a reachable query...
    // both ends of a real walk land ON the mesh, within a stride
    playerAndDeskAreOnTheMesh: (out.query?.fromSnap?.ok === true && out.query.fromSnap.dist < 1.5)
      && (out.query?.toSnap?.ok === true && out.query.toSnap.dist < 1.5),
    // CONTROL: the grid has to have found real interior floor to ask about
    interiorGridIsReal: (out.query?.interiorSamples ?? 0) >= 40,
    navmeshCoversTheRoom: (out.query?.coveragePct ?? 0) >= 70,
    routesAcrossTheRoom: (out.query?.insidePoints ?? 0) >= 2,
    // ...and a point half a kilometre away does NOT quietly land next door
    refusesAPointOffTheMesh: out.query?.farSnap?.ok !== true
      || (out.query?.farSnapDist ?? 0) > 50,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'recast.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('C1-RECAST', JSON.stringify({ boot: out.boot, bake: out.bake, query: out.query, checks: out.checks }, null, 2));
  return out;
}

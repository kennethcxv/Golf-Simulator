// 3.1 (Goal 26) — RECAST IN PRODUCTION, NOT IN A QA DRIVER.
//
// "It is vendored and it initialises. ZERO PRODUCTION CUSTOMERS QUERY IT. That is
// the zero-call-sites shape and it has happened in this repo before with a
// 1,400-line movement module imported by nothing."
//
// He is describing the exact failure this file has to avoid being. So the shape
// here is deliberately narrow:
//
//   ONE INITIALISATION      `ensure()` is idempotent and remembers its own
//                           failure. A second call after a failed init does not
//                           retry the wasm load on a gameplay frame.
//   ONE BAKE                from the static interior geometry, during loading.
//                           `bake()` refuses to run twice and says so.
//   NO REBAKE               there is no per-spawn, per-door or per-frame entry
//                           point. Moving people are handled by the caller's
//                           separation, which is what 3.2 asks for -- "queue
//                           bodies and moving people are DYNAMIC OBSTACLES, do
//                           not rebake the static mesh for them."
//   ONE QUERY SURFACE       `path()`, returning the same {x,z} waypoint array
//                           shape the grid router returns, so the call site is a
//                           substitution and not a rewrite.
//
// AND IT FAILS SOFT. If the wasm will not load, if the bake produces nothing, if
// a query throws, `path()` returns null and the caller falls through to the grid
// router that shipped. A navigation system that can turn the shop into statues
// when a vendored binary changes is not an improvement over one that works.
//
// Counters are exported because "prove the call site" is the actual requirement,
// and a boolean saying "recast is enabled" proves nothing about whether a
// customer ever asked it anything.

const DEFAULT_BAKE = Object.freeze({
  // A person, in yards. These are the numbers the C1 feasibility bake used
  // against this same building, expressed in cell units where recast wants them.
  cs: 0.18,
  ch: 0.12,
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
});

// A mesh with more vertices than this is scenery detail, not floor: including it
// costs bake time and changes nothing a person can walk on.
const MAX_MESH_VERTS = 40000;

export function createRecastNav({ loadModule } = {}) {
  let core = null;
  let navMesh = null;
  let query = null;
  let initFailed = null;
  let bakeFailed = null;
  let baked = false;
  let baking = false;
  let bakeCount = 0;
  // The floor height the navmesh was baked at. A query is a 3D question and the
  // caller only has a 2D one, so somebody has to supply the Y -- and the honest
  // source is the mesh itself, not whatever height the asker happens to be at.
  let bakedFloorY = null;

  const stats = {
    initMs: null,
    gatherMs: null,
    bakeMs: null,
    meshes: 0,
    verts: 0,
    tris: 0,
    skippedOutOfBand: 0,
    // the numbers that answer "prove the call site"
    pathCalls: 0,
    pathHits: 0,
    pathMisses: 0,
    pathErrors: 0,
    snapFailures: 0,
    // what the snap ACTUALLY measured on the last failure. Without this a snap
    // failure is indistinguishable from an empty navmesh, and I spent a run on
    // that distinction once already.
    lastSnapDist: null,
    lastSnapAsked: null,
    worstSnapDist: 0,
    // WHERE the refusals are, not just how many. "24 of 31 fell back" is a
    // number; a list of the points Detour could not place tells you whether the
    // navmesh is missing the doorway, the back room, or the whole floor.
    failedPoints: [],
    lastError: null,
    totalPathMs: 0,
    maxPathMs: 0,
  };

  const importModule = loadModule || (() => import(
    /* @vite-ignore */ new URL('../../../vendor/recast-navigation.module.js', import.meta.url).href
  ));

  async function ensure() {
    if (core || initFailed) return core;
    const t0 = now();
    try {
      // ONE module. Two bundles each carry their own copy of core, so init()
      // touches one and the generators use the other -- which reports itself as
      // "init must be called first" and sends you looking at the CSP.
      const mod = await importModule();
      await mod.init();
      core = mod;
      stats.initMs = Math.round(now() - t0);
    } catch (e) {
      initFailed = String((e && e.message) || e).slice(0, 300);
      stats.lastError = initFailed;
    }
    return core;
  }

  function now() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  // Collect world-space triangles from everything under `root` that draws.
  // Instanced meshes are skipped: the scatter is grass and props, and a navmesh
  // that has to swallow a hundred thousand instanced blades takes seconds to
  // bake for no change in where a person can stand.
  function gather(root, floorY, band) {
    const positions = [];
    const indices = [];
    let base = 0;
    let meshes = 0;
    let skippedOutOfBand = 0;
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.visible) return;
      const g = o.geometry;
      const pos = g && g.attributes && g.attributes.position;
      if (!pos || pos.count > MAX_MESH_VERTS) return;
      // A Y BAND ROUND THE FLOOR. Under the interior root there is geometry a
      // THOUSAND YARDS below the room -- the sky dome and the world ground -- and
      // my first bake swallowed it whole. It cost 383k triangles and, worse, my
      // "the lowest vertex is the floor" heuristic then put the query height at
      // -1002, so every single production route asked Detour about a point deep
      // underground and got "not on the navmesh" back. Nothing about that read
      // as a Y-range problem: it read as an empty navmesh.
      if (Number.isFinite(floorY)) {
        if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox;
        if (bb) {
          const lo = bb.min.y + o.matrixWorld.elements[13];
          const hi = bb.max.y + o.matrixWorld.elements[13];
          if (hi < floorY - band || lo > floorY + band) { skippedOutOfBand += 1; return; }
        }
      }
      const m = o.matrixWorld.elements;
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        positions.push(
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        );
      }
      if (g.index) {
        for (let i = 0; i < g.index.count; i += 1) indices.push(base + g.index.getX(i));
      } else {
        for (let i = 0; i < pos.count; i += 1) indices.push(base + i);
      }
      base += pos.count;
      meshes += 1;
    });
    return { positions, indices, meshes, skippedOutOfBand };
  }

  // ONE bake, off the gameplay frame. Returns a plain result rather than
  // throwing, because the caller is a load step and a rejected promise there
  // takes the whole clubhouse down for a navmesh that is optional by design.
  // `roots` may be one object or several. It has to be several here: the shell
  // (walls, porch, threshold) and the interior (floor, fixtures, stock) are
  // SIBLING groups, not parent and child, and a navmesh built from either one
  // alone is wrong in a different direction. Interior only: customers walking in
  // from the porch cannot be placed at all, and 24 of 31 routes fell to the grid.
  // Shell only: they can be placed, 23 of 29 routes are served -- and the mesh
  // has never heard of the shelving they are supposed to walk around.
  async function bake(roots, options = {}, { floorY = null, band = 12 } = {}) {
    if (baked) return { ok: true, alreadyBaked: true };
    if (baking) return { ok: false, why: 'a bake is already running' };
    const list = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
    if (!list.length) return { ok: false, why: 'no root' };
    baking = true;
    try {
      const mod = await ensure();
      if (!mod) return { ok: false, why: `init failed: ${initFailed}` };

      const t0 = now();
      const positions = [];
      const indices = [];
      let meshes = 0;
      let skippedOutOfBand = 0;
      for (const root of list) {
        const part = gather(root, floorY, band);
        const base = positions.length / 3;
        for (const v of part.positions) positions.push(v);
        for (const i of part.indices) indices.push(base + i);
        meshes += part.meshes;
        skippedOutOfBand += part.skippedOutOfBand;
      }
      stats.gatherMs = Math.round(now() - t0);
      stats.meshes = meshes;
      stats.skippedOutOfBand = skippedOutOfBand;
      stats.roots = list.length;
      stats.verts = positions.length / 3;
      stats.tris = indices.length / 3;
      if (!positions.length || !indices.length) {
        bakeFailed = 'no geometry under the interior root';
        return { ok: false, why: bakeFailed };
      }

      const t1 = now();
      const result = mod.generateSoloNavMesh(
        Float32Array.from(positions),
        Uint32Array.from(indices),
        { ...DEFAULT_BAKE, ...options },
      );
      stats.bakeMs = Math.round(now() - t1);
      if (!result || !result.success || !result.navMesh) {
        bakeFailed = (result && result.error) || 'generateSoloNavMesh returned no mesh';
        stats.lastError = bakeFailed;
        return { ok: false, why: bakeFailed, gatherMs: stats.gatherMs, bakeMs: stats.bakeMs };
      }
      navMesh = result.navMesh;
      query = new mod.NavMeshQuery(navMesh);
      baked = true;
      bakeCount += 1;
      // THE CALLER'S FLOOR, not a vertex heuristic. The clubhouse knows where its
      // own floor is; the geometry does not, because it also contains a sky.
      bakedFloorY = Number.isFinite(floorY) ? floorY : null;
      return {
        ok: true,
        meshes,
        verts: stats.verts,
        tris: stats.tris,
        gatherMs: stats.gatherMs,
        bakeMs: stats.bakeMs,
        tiles: navMesh.getMaxTiles ? navMesh.getMaxTiles() : null,
      };
    } catch (e) {
      bakeFailed = String((e && e.message) || e).slice(0, 300);
      stats.lastError = bakeFailed;
      return { ok: false, why: bakeFailed };
    } finally {
      baking = false;
    }
  }

  // A POINT IS NOT ON THE MESH JUST BECAUSE IT IS IN THE ROOM. Detour wants a
  // polygon, so both ends are snapped first, and a snap that had to travel a long
  // way is not an answer to the question that was asked -- it is a different
  // question about a different place. `maxSnap` is what makes that refusable.
  function snap(p, maxSnap) {
    const r = query.findClosestPoint(p);
    if (!r || !r.success) { stats.lastSnapDist = 'findClosestPoint failed'; return null; }
    const d = Math.hypot(r.point.x - p.x, r.point.z - p.z);
    stats.lastSnapDist = +d.toFixed(3);
    stats.lastSnapAsked = { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) };
    if (d > stats.worstSnapDist) stats.worstSnapDist = +d.toFixed(3);
    if (d > maxSnap) return null;
    return r.point;
  }

  /**
   * The production query. Same contract as the grid router's `path`: an array of
   * {x, z} waypoints ending at the target, or null when it cannot answer -- and
   * null is a real answer here, meaning "fall through to the grid".
   */
  function path(sx, sz, tx, tz, floorY, { maxSnap = 1.5 } = {}) {
    if (!baked || !query) return null;
    stats.pathCalls += 1;
    const t0 = now();
    try {
      // The BAKED floor, not the asker's height. A customer mesh origin can sit
      // at the model's centre rather than its feet, and Detour searches a small
      // box around the query point -- a metre of vertical error reads back as
      // "that point is not on the navmesh" and looks exactly like an empty mesh.
      const y = Number.isFinite(bakedFloorY) ? bakedFloorY
        : (Number.isFinite(floorY) ? floorY : 0);
      const from = snap({ x: sx, y, z: sz }, maxSnap);
      const to = snap({ x: tx, y, z: tz }, maxSnap);
      if (!from || !to) {
        stats.snapFailures += 1;
        stats.pathMisses += 1;
        if (stats.failedPoints.length < 40) {
          stats.failedPoints.push({
            end: from ? 'to' : 'from',
            x: +(from ? tx : sx).toFixed(2),
            z: +(from ? tz : sz).toFixed(2),
          });
        }
        return null;
      }
      const res = query.computePath(from, to);
      const pts = (res && res.success && res.path) ? res.path : (Array.isArray(res) ? res : null);
      if (!pts || pts.length < 2) {
        stats.pathMisses += 1;
        return null;
      }
      // Drop the first point: it is where the agent already is, and the grid
      // router does not emit it either. Keeping it makes an agent step backwards
      // onto its own feet on the frame a route resolves.
      const out = [];
      for (let i = 1; i < pts.length; i += 1) out.push({ x: pts[i].x, z: pts[i].z });
      // End exactly on the goal rather than on the polygon centre the snap
      // chose, so arrival radii mean what the caller thinks they mean.
      out[out.length - 1] = { x: tx, z: tz };
      stats.pathHits += 1;
      return out;
    } catch (e) {
      stats.pathErrors += 1;
      stats.lastError = String((e && e.message) || e).slice(0, 200);
      return null;
    } finally {
      const ms = now() - t0;
      stats.totalPathMs += ms;
      if (ms > stats.maxPathMs) stats.maxPathMs = ms;
    }
  }

  function diagnostics() {
    return Object.freeze({
      schemaVersion: 1,
      source: 'production-recastNav',
      ready: baked && !!query,
      baked,
      bakeCount,
      bakedFloorY,
      initFailed,
      bakeFailed,
      ...stats,
      meanPathMs: stats.pathCalls ? +(stats.totalPathMs / stats.pathCalls).toFixed(3) : null,
    });
  }

  function dispose() {
    try { if (query && query.destroy) query.destroy(); } catch { /* ignore */ }
    try { if (navMesh && navMesh.destroy) navMesh.destroy(); } catch { /* ignore */ }
    query = null;
    navMesh = null;
    baked = false;
  }

  return {
    bake, path, diagnostics, dispose,
    isReady: () => baked && !!query,
  };
}

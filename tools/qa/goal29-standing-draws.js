// GOAL 29, PHASE 2 — STANDING DRAW CALLS, COUNTED HONESTLY.
//
// Count-verifiable by design: draw calls, triangles, programs, geometries and
// textures are COUNTS from renderer.info after real frames — valid on a
// degraded machine where no ms figure can be trusted.
//
// Stations: the DEFAULT spawn pose (untouched — the default-player-camera law)
// and outdoors at 45 yd facing the course, then facing back at the shop.
//
// NEGATIVE CONTROLS, both required in every run:
//   1. PLANTED DRAWS: 25 cubes, each with its own material, placed in front of
//      the camera. renderer.info.render.calls must rise by exactly 25, and
//      fall back when they are removed. If it does not, the counter is not
//      counting draws.
//   2. THE BROKEN SHAPE (this repo's recorded lie): the same 25 cubes with
//      layers.mask = 0 — geometry in the scene graph that never reaches the
//      GPU. The counter must NOT move. A probe that counts scene meshes
//      instead of real draws fails HERE, before any of its numbers are used.
//
//   node tools/qa/run-electron.cjs tools/qa/goal29-standing-draws.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/goal29-draws');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(8000); // let deferred warms retire; counts settle

  // Deterministic counts: sim speed 0 + day-preserving 14:00 clock pin (the
  // golden recipe). Wandering customers would swing the call count mid-sample.
  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
  });

  // per-frame renderer.info sampler — reads AFTER each real frame
  await page.evaluate(() => {
    const S = { window: null, results: {} };
    window.__g29 = S;
    const tick = () => {
      if (S.window) {
        const info = window.__fw.scene3d.renderer.info;
        S.results[S.window].push({
          calls: info.render.calls,
          tris: info.render.triangles,
          programs: info.programs?.length ?? -1,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    S.begin = (name) => { S.results[name] = []; S.window = name; };
    S.end = () => { S.window = null; };
  });

  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const sample = async (name, seconds = 4) => {
    await page.waitForTimeout(1200); // culling/shadow settle at the pose
    await page.evaluate((n) => window.__g29.begin(n), name);
    await page.waitForTimeout(seconds * 1000);
    const rows = await page.evaluate((n) => { window.__g29.end(); return window.__g29.results[n]; }, name);
    const s = {
      frames: rows.length,
      calls: median(rows.map((r) => r.calls)),
      callsMin: Math.min(...rows.map((r) => r.calls)),
      callsMax: Math.max(...rows.map((r) => r.calls)),
      tris: median(rows.map((r) => r.tris)),
      programs: median(rows.map((r) => r.programs)),
      geometries: median(rows.map((r) => r.geometries)),
      textures: median(rows.map((r) => r.textures)),
    };
    out[name] = s;
    console.log(`${name.padEnd(28)} calls ${String(s.calls).padStart(5)} (min ${s.callsMin} max ${s.callsMax})  tris ${String(s.tris).padStart(9)}  programs ${s.programs}  geom ${s.geometries}  tex ${s.textures}`);
    return s;
  };

  // ---- STATION 1: the default spawn pose, untouched --------------------------
  await sample('shop-default-spawn', 4);
  await page.screenshot({ path: path.join(OUT, `${tag}-shop.png`) });

  // static-subtree batch state, if any batches are live in this build
  out.batchState = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const batches = [];
    let suppressed = 0;
    for (const root of [ch.interior, ch.group].filter(Boolean)) {
      root.traverse((o) => {
        if (o.userData?.staticSubtreeBatch) batches.push({ name: o.name, meshes: o.children.length });
        if (o.userData?.staticSubtreeBatchSuppressed) suppressed += 1;
      });
    }
    return { batches, suppressed };
  });
  console.log(`batch state: ${JSON.stringify(out.batchState)}`);

  // ---- CONTROLS at the shop station ------------------------------------------
  // THREE is module-scoped in the page; reach it through an existing mesh's
  // constructors instead of importing.
  const plantReal = (suppressed) => page.evaluate((sup) => {
    const s3 = window.__fw.scene3d;
    const scene = s3.scene;
    const cam = s3.camera;
    // find any existing mesh to borrow constructors from
    let donor = null;
    scene.traverse((o) => { if (!donor && o.isMesh && !Array.isArray(o.material) && o.geometry?.attributes?.position) donor = o; });
    if (!donor) return { err: 'no donor mesh' };
    const GeoC = donor.geometry.constructor; // BufferGeometry
    const MatC = donor.material.constructor; // some Material
    const MeshC = donor.constructor; // Mesh
    const V3 = cam.position.constructor;
    const dir = cam.getWorldDirection(new V3());
    // one shared triangle geometry built by hand — a single triangle per plant
    // is enough to be a draw call
    const tri = new GeoC();
    const pos = new Float32Array([0, 0, 0, 0.3, 0, 0, 0, 0.3, 0]);
    const BA = donor.geometry.attributes.position.constructor;
    tri.setAttribute('position', new BA(pos, 3));
    tri.computeVertexNormals();
    const planted = [];
    for (let i = 0; i < 25; i += 1) {
      const mat = new MatC();
      if (mat.color?.setHex) mat.color.setHex(0xff00ff);
      mat.side = 2; // DoubleSide — orientation-proof
      const mesh = new MeshC(tri, mat);
      const p = cam.position.clone().add(dir.clone().multiplyScalar(2.2));
      mesh.position.set(p.x + (i % 5) * 0.35 - 0.7, p.y + Math.floor(i / 5) * 0.35 - 0.7, p.z);
      mesh.frustumCulled = false;
      if (sup) mesh.layers.mask = 0; // THE BROKEN SHAPE: in graph, never drawn
      scene.add(mesh);
      planted.push(mesh);
    }
    window.__g29planted = planted;
    return { planted: planted.length, suppressed: !!sup };
  }, suppressed);

  const unplant = () => page.evaluate(() => {
    const list = window.__g29planted;
    if (!list) return false;
    for (const mesh of list) {
      mesh.parent?.remove(mesh);
      mesh.material?.dispose?.();
    }
    list[0]?.geometry?.dispose?.(); // one shared triangle geometry
    window.__g29planted = null;
    return true;
  });

  const base = out['shop-default-spawn'].calls;

  // CONTROL 2 FIRST (the broken shape): suppressed cubes must NOT move calls.
  const p1 = await plantReal(true);
  const suppressedSample = await sample('control-suppressed-cubes', 2.5);
  await unplant();
  out.control_brokenShape = (p1.planted === 25 && suppressedSample.calls === base)
    ? `ok — 25 suppressed meshes moved calls by 0 (graph-counting would have lied here)`
    : `FAILED — calls ${base} -> ${suppressedSample.calls} with layers.mask=0 plants (planted=${JSON.stringify(p1)})`;

  // CONTROL 1: visible plants must move calls by an EXACT INTEGER MULTIPLE of
  // 25 (the composer renders the scene through more than one pass — GTAO
  // prepass + beauty — so one visible object costs passMultiplier draws per
  // frame), and calls must return to base exactly when they are removed. The
  // multiplier is MEASURED here, not assumed, and is part of the record: every
  // "saved draw" in this report saves passMultiplier info.render calls.
  const p2 = await plantReal(false);
  const plantedSample = await sample('control-planted-cubes', 2.5);
  await unplant();
  const returnSample = await sample('control-after-unplant', 2.5);
  const delta = plantedSample.calls - base;
  const multiplier = delta / 25;
  out.passMultiplier = multiplier;
  out.control_plantedDraws = (p2.planted === 25 && delta > 0 && Number.isInteger(multiplier)
    && returnSample.calls === base)
    ? `ok — calls ${base} -> ${plantedSample.calls} -> ${returnSample.calls} (+25 objects = +${delta} calls, pass multiplier ${multiplier}, exact return)`
    : `FAILED — calls ${base} -> ${plantedSample.calls} -> ${returnSample.calls} (delta ${delta} not a clean multiple of 25, or no exact return; planted=${JSON.stringify(p2)})`;
  console.log(`CONTROL broken shape: ${out.control_brokenShape}`);
  console.log(`CONTROL planted draws: ${out.control_plantedDraws}`);

  // ---- STATION 2: outdoors ---------------------------------------------------
  const geo = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const o = ch.interior.position;
    const h = Math.hypot(-o.x, -o.z) || 1;
    return { ox: o.x, oz: o.z, dirX: -o.x / h, dirZ: -o.z / h };
  });
  const putAt = (dist, faceOut) => page.evaluate(([g, d, face]) => {
    const w = window.__fw.scene3d.walk.state;
    w.x = g.ox + g.dirX * d;
    w.z = g.oz + g.dirZ * d;
    w.vx = 0; w.vz = 0;
    w.yaw = Math.atan2(-(face ? g.dirX : -g.dirX), -(face ? g.dirZ : -g.dirZ));
    w.pitch = -0.03;
  }, [geo, dist, faceOut]);

  await putAt(45, true);
  await sample('out-45yd-facing-course', 4);
  await page.screenshot({ path: path.join(OUT, `${tag}-out45.png`) });
  await putAt(45, false);
  await sample('out-45yd-facing-shop', 4);

  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  const ok = String(out.control_brokenShape).startsWith('ok')
    && String(out.control_plantedDraws).startsWith('ok');
  console.log(ok ? 'CONTROLS OK' : 'CONTROLS FAILED — COUNTS VOID');
  if (!ok) process.exitCode = 1;
  return out;
}

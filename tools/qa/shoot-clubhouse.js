async (page) => {
  // CLUBHOUSE ASSET-PASS HARNESS — reload, stock the retail displays, shoot the
  // same 10 poses every pass, and measure. Before/after are directly comparable
  // because nothing here varies between runs except the code under test.
  //
  // Edit PASS between passes; qa/assets/<pass>/ must already exist.
  //
  // The retail stocking is an ART-INSPECTION aid (empty shelves can't be judged).
  // It deliberately zeroes `decor`/`supplies`: a decor SKU in inventory makes the
  // shop spawn translucent green PLACEMENT GHOSTS that would fill the room with
  // fake blobs. Final gameplay proof does not use this file.
  const PASS = 'before';
  const OUT = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper/qa/assets/' + PASS;

  const L2W = (x, z) => ({ x: x - 8, z: z + 228 });
  const SHOTS = [
    { id: '01-entrance',  at: [-0.8, 5.2],  to: [-1.2, -2.0], pitch: -0.05 },
    { id: '02-checkout',  at: [0.5, 2.3],   to: [2.9, 4.5],   pitch: -0.10 },
    { id: '03-clubwall',  at: [-6.3, -0.2], to: [-9.9, -0.4], pitch: 0.02 },
    { id: '04-ballwall',  at: [-6.9, -3.5], to: [-6.9, -6.2], pitch: 0.05 },
    { id: '05-apparel',   at: [-4.0, 3.4],  to: [-5.4, 0.0],  pitch: -0.02 },
    { id: '06-bagshoe',   at: [2.3, 1.7],   to: [3.7, -1.9],  pitch: -0.02 },
    { id: '07-lounge',    at: [1.3, -3.3],  to: [4.3, -5.3],  pitch: -0.03 },
    { id: '08-office',    at: [7.2, 4.3],   to: [9.6, 4.6],   pitch: -0.06 },
    { id: '09-stockroom', at: [7.4, -2.3],  to: [8.1, -5.9],  pitch: -0.04 },
  ];
  const EXT = { id: '10-exterior', atW: [-1.5, 243.5], toW: [-8.5, 231.0], pitch: 0.03 };

  // --- fresh boot so leftover in-memory edits can't leak between passes -------
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 30000 });
  await page.waitForTimeout(2500);

  const stock = await page.evaluate(() => {
    const app = window.__fw;
    const inv = app.state.shop.inventory;
    // Unplaced decor sitting in the BACKROOM (inv.back > 0) makes the shop spawn a
    // translucent green placement ghost at every candidate spot — clubhouse.js:1288.
    // Those blobs would sit on top of the art in every shot, so park them.
    const DECOR = ['rug1', 'plant1', 'poster1', 'board1', 'light1', 'lounge1', 'vac1'];
    const filled = {};
    for (const id of Object.keys(inv)) {
      if (DECOR.includes(id)) { inv[id].back = 0; inv[id].shelf = 0; continue; }
      inv[id].shelf = Math.max(inv[id].shelf, 12);
      inv[id].back = Math.max(inv[id].back, 6);
      filled[id] = inv[id].shelf;
    }
    const ch = app.scene3d.clubhouse();
    ch.rebuildStock();
    if (ch.rebuildReno) ch.rebuildReno();
    return { retailStocked: Object.keys(filled).length, decorGhostsParked: DECOR.length };
  });
  await page.waitForTimeout(800); // decorSignature() drives the ghost teardown on the next tick

  // --- shoot ------------------------------------------------------------------
  const shots = SHOTS.map((s) => {
    const a = L2W(s.at[0], s.at[1]);
    const t = L2W(s.to[0], s.to[1]);
    return { id: s.id, ax: a.x, az: a.z, tx: t.x, tz: t.z, pitch: s.pitch };
  });
  shots.push({ id: EXT.id, ax: EXT.atW[0], az: EXT.atW[1], tx: EXT.toW[0], tz: EXT.toW[1], pitch: EXT.pitch });

  const done = [];
  for (const s of shots) {
    await page.evaluate((shot) => {
      const w = window.__fw.scene3d.walk;
      const st = w.state;
      w.clearKeys();
      st.x = shot.ax;
      st.z = shot.az;
      const dx = shot.tx - shot.ax;
      const dz = shot.tz - shot.az;
      const d = Math.hypot(dx, dz) || 1;
      st.yaw = Math.atan2(-dx / d, -dz / d); // forward = (-sin yaw, -cos yaw)
      st.pitch = shot.pitch;
    }, s);
    await page.waitForTimeout(650);
    await page.screenshot({ path: OUT + '/' + s.id + '.png' });
    done.push(s.id);
  }

  // --- measure ----------------------------------------------------------------
  // renderer.info resets on every renderer.render(), and EffectComposer renders
  // several passes per frame, so a naive read returns the last fullscreen quad.
  // Turn autoReset off, zero it, let exactly one frame run, then read.
  const stats = await page.evaluate(() => new Promise((resolve) => {
    const s3 = window.__fw.scene3d;
    const r = s3.renderer;
    r.info.autoReset = false;
    r.info.reset();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const calls = r.info.render.calls;
        const drawnTris = r.info.render.triangles;
        r.info.autoReset = true;
        let tris = 0, meshes = 0;
        const mats = new Set(), texs = new Set();
        s3.scene.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          meshes++;
          const g = o.geometry;
          const n = g && g.index ? g.index.count / 3
            : (g && g.attributes.position ? g.attributes.position.count / 3 : 0);
          tris += n * (o.isInstancedMesh ? o.count : 1);
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => {
            if (!mm) return;
            mats.add(mm.uuid);
            ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach((k) => {
              if (mm[k]) texs.add(mm[k].uuid);
            });
          });
        });
        resolve({
          drawCallsPerFrame: calls,
          trianglesDrawnPerFrame: drawnTris,
          sceneMeshes: meshes,
          sceneTriangles: Math.round(tris),
          uniqueMaterials: mats.size,
          uniqueTextures: texs.size,
          geometriesInMemory: r.info.memory.geometries,
          texturesInMemory: r.info.memory.textures,
        });
      });
    });
  }));

  return { pass: PASS, out: OUT, stock, shots: done, stats };
}

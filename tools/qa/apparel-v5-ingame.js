// IN-GAME VERIFICATION for the ten v5 apparel GLBs.
//
// v5 built ten garments and shipped none of them: the whole output was Blender
// renders, which is the gap control_export_roundtrip.py was written about --
// every check looks at the Blender scene and nobody reads the file back. The
// export now reads it back, but a faithful GLB is still not a garment that
// works in the game, so this loads all ten through the app's OWN loader, stands
// them on a rail and a shelf in the live clubhouse, and shoots the default
// player camera.
//
// IT ALSO CHECKS THE ORIGIN CONVENTION, which is the thing v5 has and v4 did
// not. v4's ten each needed a hand-tuned height in the QA driver because their
// origins were wherever the draft happened to leave them. v5 exports a hung
// garment with its origin AT THE TOP OF ITS HOOK, a resting one with its origin
// at its base, and the peg display with its origin on the wall plane -- so the
// driver places every one of them at the same rail/shelf/wall line with no
// per-asset constant, and then MEASURES where each actually landed. If a
// garment's origin is wrong it shows up as a number here, not as a screenshot
// somebody has to squint at.
//
//   node tools/qa/run-electron.cjs tools/qa/apparel-v5-ingame.js \
//        --clubhouse=pine-hills-v2
//
async (page) => {
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 180000 });
  } catch {
    console.log('load veil still up after 180 s -- continuing');
  }
  await page.waitForTimeout(2500);

  // STAND ON THE SHOP FLOOR FIRST.
  //
  // The game opens with the player OUTSIDE, walking toward the clubhouse at
  // 6 a.m. in the rain, so the first cut of this driver photographed ten
  // garments hanging on a lawn in the dark. That answers nothing the brief
  // asks -- lighting response and texture response are interior questions.
  // This is the golden suite's own shop-floor pose, taken from the LIVE
  // interior origin rather than a stale constant.
  // ...and pin the clock to 2 p.m. while doing it. The starter shop is the
  // DILAPIDATED one: 6 a.m., condition 10, lights not yet repaired. Ten
  // garments photographed in it come back as ten silhouettes, which is a
  // picture of the starter state and not of the assets. 14:00 is the golden
  // suite's own pin, for the same reason.
  const prep = await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
    const w = app.scene3d.walk;
    const o = app.scene3d.clubhouse().interior.position;
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4;
    w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    w.state.vx = 0; w.state.vz = 0;
    return { clock: app.state.clock.minutes, seed: app.state.seed };
  });
  console.log(`staged: ${JSON.stringify(prep)}`);
  await page.waitForTimeout(2000);

  // group, line height, how far out, how far down to look, then the assets as
  // (name, file, origin rule). The LINE is shared by everything in a group --
  // that is the claim being tested. The distances The distances are
  // set by the row's own width: the four hung garments span 3.4 m together and
  // the first cut stood them 2.35 m away, which put the tee off the right edge
  // of the frame entirely.
  const GROUPS = [
    ['rail', 1.58, 2.60, -0.14, [
      ['tee-hung', 'apparel_tee_hung.glb', 'hook'],
      ['polo-hung', 'apparel_polo_hung.glb', 'hook'],
      ['hoodie-hung', 'apparel_hoodie_hung.glb', 'hook'],
      ['trousers-hung', 'apparel_trousers_hung.glb', 'hook'],
    ]],
    ['shelf', 0.92, 2.30, -0.34, [
      ['tee-folded', 'apparel_tee_folded.glb', 'base'],
      ['polo-folded', 'apparel_polo_folded.glb', 'base'],
      ['hoodie-folded', 'apparel_hoodie_folded.glb', 'base'],
      ['trousers-folded', 'apparel_trousers_folded.glb', 'base'],
      ['cap', 'apparel_cap.glb', 'base'],
    ]],
    ['wall', 1.45, 1.55, -0.06, [
      ['cap-peg', 'apparel_cap_peg.glb', 'wall'],
    ]],
  ];

  // THE NEGATIVE CONTROL LIVES HERE. Point this at hero/v4 and the origin
  // assertion must fire on every asset, because v4 exported each garment
  // wherever its draft left it -- that is why v4's own QA driver carries a
  // hand-tuned height per asset. An origin check that has only ever been run
  // against files that pass it is not a check.
  //
  //   APPAREL_DIR=Assets/models/hero/v4 node tools/qa/run-electron.cjs \
  //       tools/qa/apparel-v5-ingame.js --clubhouse=pine-hills-v2
  const DIR = process.env.APPAREL_DIR || 'Assets/models/hero/v5';
  const TAG = DIR.endsWith('v4') ? 'v4' : 'v5';
  console.log(`loading from ${DIR}`);

  // SHOOT IN ROWS THAT FIT THE ROOM, not one long rail.
  //
  // The four hung garments span 3.4 m together, and standing far enough back to
  // frame that puts the rack THROUGH the wall -- the shop-floor pose has walls
  // about 3 m out in every direction (the golden suite's own note on this
  // corner). So each group is split into rows no wider than the frame at its
  // shooting distance, and each row gets its own full-size frame.
  const FIT = 0.72;   // fraction of the visible width a row may use
  const chunk = (assets, dist, widths) => {
    const budget = 2 * dist * Math.tan((60 * Math.PI / 180) / 2) * FIT;
    const outRows = [[]];
    let w = 0;
    for (const a of assets) {
      const aw = widths[a[0]] ?? 0.9;
      if (outRows[outRows.length - 1].length && w + aw > budget) { outRows.push([]); w = 0; }
      outRows[outRows.length - 1].push(a);
      w += aw + 0.10;
    }
    return outRows;
  };
  // measured off the export, so the layout does not have to load a file to
  // know how wide it is
  const WIDTH_M = {
    'tee-hung': 0.82, 'polo-hung': 0.83, 'hoodie-hung': 1.03, 'trousers-hung': 0.47,
    'tee-folded': 0.32, 'polo-folded': 0.31, 'hoodie-folded': 0.37,
    'trousers-folded': 0.24, cap: 0.20, 'cap-peg': 0.31,
  };

  const rows = [];
  for (const [group, height, dist, pitch, allAssets] of GROUPS) {
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
    await page.waitForTimeout(250);
    const parts = chunk(allAssets, dist, WIDTH_M);
    let partNo = 0;
    for (const assets of parts) {
    partNo += 1;
    const info = await page.evaluate(async ([assets, height, DIR, dist]) => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const THREE = await import('three');
      const mod = await import('./src/render3d/gltfCache.js');
      const loader = new mod.CachedGLTFLoader();

      let cam = null;
      for (const k of Object.keys(app.scene3d)) {
        const v = app.scene3d[k];
        if (v && v.isCamera) { cam = v; break; }
      }
      if (!cam) {
        let n = ch.interior;
        while (n.parent) n = n.parent;
        n.traverse((o) => { if (!cam && o.isCamera) cam = o; });
      }
      if (!cam) throw new Error('no camera found on scene3d');
      let scene = cam;
      while (scene.parent) scene = scene.parent;

      const prev = scene.getObjectByName('__v5probe');
      if (prev) prev.parent.remove(prev);
      const holder = new THREE.Group();
      holder.name = '__v5probe';
      scene.add(holder);

      cam.updateMatrixWorld(true);
      const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      const q = cam.getWorldQuaternion(new THREE.Quaternion());
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      fwd.y = 0; fwd.normalize();
      const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      // the floor under the player, so the rail and shelf heights below are
      // real heights and not offsets from wherever the eye happens to be
      const floorY = eye.y - 1.62;

      const out = [];
      // measure the widths first so the row can be laid out without overlap
      const loaded = [];
      for (const [name, file, rule] of assets) {
        const g = await new Promise((res, rej) =>
          loader.load(`${DIR}/${file}`, res, undefined, rej));
        const root = (g.scene || g.scenes[0]).clone(true);
        const box = new THREE.Box3().setFromObject(root);
        loaded.push({ name, rule, root, w: box.getSize(new THREE.Vector3()).x });
      }
      const gap = 0.10;
      const total = loaded.reduce((s, o) => s + o.w, 0) + gap * (loaded.length - 1);
      let cursor = -total / 2;

      for (const item of loaded) {
        const { name, rule, root, w } = item;
        // THE ORIGIN GOES ON THE LINE. No per-asset height, no centring by
        // bounding box -- that is the whole point of the convention.
        const along = cursor + w / 2;
        cursor += w + gap;
        const at = eye.clone()
          .add(fwd.clone().multiplyScalar(dist))
          .add(right.clone().multiplyScalar(along));
        at.y = floorY + height;
        root.position.copy(at);
        root.rotation.y = Math.atan2(-fwd.x, -fwd.z);
        holder.add(root);
        root.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        // Where the origin landed vs where the asset's extremity landed.
        //
        // 'wall' used to return a literal 0 -- the rule was asserted, never
        // measured, so cap-peg was the one asset that could not fail this
        // check. The mount plane is the asset's furthest face along the view
        // direction (the model is turned so its back faces away from the
        // player), so support the world AABB along fwd and compare that.
        let err;
        if (rule === 'hook') err = box.max.y - at.y;
        else if (rule === 'base') err = box.min.y - at.y;
        else {
          const far = new THREE.Vector3(
            fwd.x >= 0 ? box.max.x : box.min.x,
            fwd.y >= 0 ? box.max.y : box.min.y,
            fwd.z >= 0 ? box.max.z : box.min.z,
          );
          err = far.sub(at).dot(fwd);
        }

        let tris = 0, meshes = 0, uv = 0, white = 0, mats = 0;
        const cols = [];
        root.traverse((o) => {
          if (!o.isMesh) return;
          meshes += 1;
          const ix = o.geometry.index;
          tris += (ix ? ix.count : o.geometry.attributes.position.count) / 3;
          if (o.geometry.attributes.uv) uv += 1;
          for (const m of [].concat(o.material)) {
            if (!m || !m.color) continue;
            mats += 1;
            const c = m.color;
            // THE TEN-WHITE-GARMENTS FAULT: a Base Color driven by a node chain
            // exports as baseColorFactor 1,1,1 and every render still looks
            // right because the render is of the Blender scene.
            if (c.r > 0.94 && c.g > 0.94 && c.b > 0.94) white += 1;
            cols.push([+c.r.toFixed(3), +c.g.toFixed(3), +c.b.toFixed(3)]);
          }
        });
        out.push({
          name,
          rule,
          sizeMm: [size.x, size.y, size.z].map((v) => +(v * 1000).toFixed(0)),
          originErrMm: +(err * 1000).toFixed(1),
          tris,
          meshes,
          uv,
          mats,
          white,
          colours: cols,
        });
      }
      return out;
    }, [assets, height, DIR, dist]);

    await page.waitForTimeout(900);
    const suffix = parts.length > 1 ? `-${partNo}` : '';
    const shot = `qa/hero/v5/ingame/${group}${suffix}-ingame${TAG === 'v4' ? '-v4CONTROL' : ''}.png`;
    await page.screenshot({ path: shot });
    for (const r of info) {
      rows.push({ ...r, group, shot });
      console.log(
        `${r.name.padEnd(16)} ${String(r.sizeMm.join(' x ')).padEnd(18)} mm  `
        + `origin ${String(r.originErrMm).padStart(6)} mm  ${String(r.tris).padStart(6)} tris  `
        + `uv ${r.uv}/${r.meshes}  white ${r.white}/${r.mats}`,
      );
    }
    }
  }

  // ASSERTIONS, after the frames are on disk so a failure still leaves evidence.
  const bad = [];
  for (const r of rows) {
    if (Math.abs(r.originErrMm) > 1.0) {
      bad.push(`${r.name}: origin rule '${r.rule}' is off by ${r.originErrMm} mm in the game`);
    }
    if (r.uv < r.meshes) bad.push(`${r.name}: ${r.meshes - r.uv} mesh(es) arrived with no UV`);
    if (r.white > 0) bad.push(`${r.name}: ${r.white}/${r.mats} materials came in WHITE — a linked Base Color did not flatten`);
    if (r.tris < 100) bad.push(`${r.name}: only ${r.tris} tris — the file did not really load`);
  }
  console.log(bad.length ? `\nFAILED:\n  ${bad.join('\n  ')}` : '\nall ten load, sit on their line, keep their UVs and their colour');
  return { rows, failures: bad };
}

// ITEM 16 — "customer models read poorly, hats worst. Four at conversational
// distance, before/after."
//
// The failure is a LOOK, so the deliverable is four framed portraits. But a
// screenshot pass with no numbers is how a model gets called improved because
// the light changed, so this also measures the two things that can be measured
// about a silhouette at 2 m:
//
//   headPixelSpan   how much of the frame the head actually occupies, so
//                   "conversational distance" is a number and the before/after
//                   pair is shot at the SAME size;
//   hairlineCut     the hair's lowest point against the skull's widest point,
//                   in the head's own space. A hemisphere sliced flat across a
//                   round skull leaves a hard horizontal line and bare scalp
//                   below it, which is the "swim cap" read; a hairline that
//                   descends past the skull's equator does not.
//
// CONTROL: the same measurement on a CAPPED customer, whose crown/bill/band
// geometry is a different construction entirely. If capped and bare heads
// report the same hairline number, the probe is not reading hair.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const label = (process.env.QA_LABEL || 'before').replace(/[^a-z0-9-]/gi, '');
  const OUT = path.resolve('qa/electron/customer-read');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const W = 1280; const H = 900;

  await page.setViewportSize({ width: W, height: H });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3000);

  // Four figures, built directly from the character factory with the four
  // looks the shop actually randomises between: pale cap, navy cap, bare head,
  // and the staff palette. Spawning four SHOPPERS and hoping they stand still
  // at a known distance is a race; the read being tested is the model, so the
  // model is what gets placed.
  const setup = await page.evaluate(async () => {
    const app = window.__fw;
    const mod = await import(new URL('src/render3d/characterAsset.js', document.baseURI).href);
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const club = app.scene3d.clubhouse();
    const o = club.interior.position;
    const w = app.scene3d.walk;
    app.speedIdx = 1;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);

    const LOOKS = [
      { key: 'cap-pale', polo: 0x3b6fb3, khaki: 0xc2b190, cap: 0xf2efe4, skin: 0xd9a97e },
      { key: 'cap-navy', polo: 0xb43f3f, khaki: 0x8d8574, cap: 0x2c3e66, skin: 0x8a5b3a },
      { key: 'bare', polo: 0x2f7d5c, khaki: 0xd6cbb2, cap: null, skin: 0xf0c9a2 },
      { key: 'staff', polo: 0xf0ede2, khaki: 0x3f5944, cap: 0x2f5c38, skin: 0x5d3a24 },
    ];
    window.__portraits = [];
    const stage = new THREE.Group();
    stage.name = 'QA_PortraitStage';
    club.interior.add(stage);
    LOOKS.forEach((look, i) => {
      const built = mod.makeCharacter(look);
      const g = built.root || built.group || built;
      // spread them across the open floor, all facing the camera stand point
      // Local (-4.2, +2.0) facing -z is the open lane the tool-ranking driver
      // already proved: several yards of clear floor. The first cut put the four
      // at local z +4.0, which is inside a wall - the frame came back black and
      // the numbers still read "2.1 m, 100 px, in front of the camera", because
      // in front of the camera and VISIBLE are different claims.
      // Shifted one slot west: at -2.7 the fourth figure stands behind
      // GREY_shelf_acc from every stand point the retry tries, and a portrait
      // of a shelf is not a portrait.
      g.position.set(-6.3 + i * 0.9, 0, 0.0);
      stage.add(g);
      window.__portraits.push({ key: look.key, group: g, built });
    });
    // the player stands 2.0 m from the first figure - conversational distance,
    // which is the distance the brief names
    w.clearKeys();
    // YAW 0 FACES -Z. The first cut used Math.PI, which faces +z - away from
    // four figures standing at lower z - and the frame came back as a
    // photograph of the golf course with no customer in it. The numbers did not
    // say so: a point behind the camera still projects to a finite NDC with a
    // flipped sign, so the head measured 100 px and 2.14 m while facing the
    // wrong way. Hence facingTheFigure below.
    w.state.x = o.x - 4.2; w.state.z = o.z + 2.6;
    w.state.yaw = 0; w.state.pitch = -0.06;
    return { placed: window.__portraits.length, at: { x: w.state.x, z: w.state.z } };
  });

  // Measure each figure: how big the head reads on screen, and where the hair
  // (or cap) stops against the skull.
  const measure = () => page.evaluate(async () => {
    const app = window.__fw;
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const camera = app.scene3d.camera;
    camera.updateMatrixWorld(true);
    const rows = [];
    for (const p of window.__portraits) {
      const head = p.group.getObjectByName('headJoint');
      if (!head) { rows.push({ key: p.key, error: 'no headJoint' }); continue; }
      head.updateWorldMatrix(true, true);
      const inv = new THREE.Matrix4().copy(head.matrixWorld).invert();
      // classify the head's children by material colour against the skin tone:
      // the skull is the biggest skin-coloured sphere, the hair/crown is not
      let skullR = 0; let skullY = 0;
      let coverLowY = Infinity; let coverName = null; let coverParts = 0;
      const box = new THREE.Box3();
      const headBox = new THREE.Box3();
      head.traverse((m) => {
        if (!m.isMesh || !m.geometry) return;
        box.setFromObject(m);
        headBox.union(box);
        // local-space extent of this piece
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const r = m.geometry.boundingSphere.radius
          * Math.max(m.scale.x, m.scale.y, m.scale.z);
        if (r > skullR && m.geometry.type === 'SphereGeometry'
          && m.geometry.parameters.phiLength === undefined) {
          // full sphere -> the skull
        }
        if (m.geometry.type === 'SphereGeometry' && r > skullR
          && (m.geometry.parameters.thetaLength ?? Math.PI) >= Math.PI - 1e-3) {
          skullR = r; skullY = m.position.y;
        }
        // a partial sphere over the skull is hair or a cap crown
        if (m.geometry.type === 'SphereGeometry'
          && (m.geometry.parameters.thetaLength ?? Math.PI) < Math.PI - 1e-3) {
          coverParts += 1;
          const local = box.clone().applyMatrix4(inv);
          if (local.min.y < coverLowY) { coverLowY = local.min.y; coverName = m.name || m.geometry.type; }
        }
      });
      // head size on screen, in pixels of the 900-tall frame
      const corners = [];
      for (let i = 0; i < 8; i += 1) {
        corners.push(new THREE.Vector3(
          i & 1 ? headBox.max.x : headBox.min.x,
          i & 2 ? headBox.max.y : headBox.min.y,
          i & 4 ? headBox.max.z : headBox.min.z,
        ).project(camera));
      }
      const ys = corners.map((c) => c.y);
      const zs = corners.map((c) => c.z);
      // NDC z outside [-1, 1] is behind the camera (or past the far plane).
      // Without this a figure standing behind you reports a healthy head size.
      const inFrontOfCamera = zs.every((z) => z > -1 && z < 1);
      const headPixelSpan = Math.round(((Math.max(...ys) - Math.min(...ys)) / 2) * window.innerHeight);
      const worldHead = new THREE.Vector3();
      head.getWorldPosition(worldHead);
      const camAt = camera.getWorldPosition(new THREE.Vector3());
      // IS ANYTHING IN THE WAY? A wall between the camera and the head reports
      // the same distance, the same pixel span and the same in-front-of-camera
      // as a clear view, and renders as a black frame.
      const toHead = worldHead.clone().sub(camAt);
      const headDist = toHead.length();
      const clear = new THREE.Raycaster(camAt, toHead.clone().normalize());
      clear.far = headDist - 0.12;
      const blockers = clear.intersectObject(app.scene3d.clubhouse().interior, true)
        .filter((h) => h.object.visible && h.distance > 0.15
          && !/^COL_/.test(h.object.name || '')
          && !p.group.getObjectById(h.object.id));
      const headIsVisible = blockers.length === 0;
      rows.push({
        key: p.key,
        distanceM: +worldHead.distanceTo(camAt).toFixed(2),
        inFrontOfCamera,
        headIsVisible,
        blockedBy: headIsVisible ? null : (blockers[0].object.name || '(unnamed)'),
        headPixelSpan,
        skullR: +skullR.toFixed(4),
        skullY: +skullY.toFixed(4),
        coverParts,
        coverName,
        // HOW FAR DOWN THE SKULL THE COVERING REACHES, as a fraction of the
        // skull radius below its centre. 0 means it stops at the equator (a
        // flat slice across a round head); 1 means it reaches the chin line.
        coverBelowEquator: Number.isFinite(coverLowY) && skullR > 0
          ? +(((skullY - coverLowY) / skullR)).toFixed(3) : null,
      });
    }
    return rows;
  });

  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${label}-all-four.png`) });

  // One close portrait each, and the numbers are taken FROM THAT POSE. The
  // group shot spreads the four across the floor, so its per-figure distances
  // run 2.2 m to 5.0 m - only the nearest is at the distance the brief names,
  // and reporting the far ones as "conversational" would be reporting the
  // frame's convenience as a measurement.
  const rows = [];
  for (let i = 0; i < 4; i += 1) {
    // THE STAND POINT IS HUNTED, NOT ASSUMED. A fixed 1.9 m straight in front
    // put the camera on the far side of GREY_WestWall_CreamField for one of the
    // four, and every number except the occlusion probe read as a clean
    // portrait. Try a handful of stand points at conversational range and take
    // the first with an unobstructed line to the head.
    await page.evaluate((idx) => {
      const app = window.__fw;
      const w = app.scene3d.walk;
      const wp = window.__portraits[idx].group.position;
      const o = app.scene3d.clubhouse().interior.position;
      w.state.x = o.x + wp.x; w.state.z = o.z + wp.z + 1.9;
      w.state.yaw = 0; w.state.pitch = 0.02;
    }, i);
    await page.waitForTimeout(500);
    let one = (await measure())[i];
    if (!one.headIsVisible) {
      // dead ahead was blocked: step aside and re-measure, reporting which
      for (const [dx, dz] of [[0.7, 1.75], [-0.7, 1.75], [0, 1.45], [1.2, 1.6]]) {
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate(({ idx, ox, oz }) => {
          const app = window.__fw;
          const w = app.scene3d.walk;
          const wp = window.__portraits[idx].group.position;
          const o = app.scene3d.clubhouse().interior.position;
          w.state.x = o.x + wp.x + ox; w.state.z = o.z + wp.z + oz;
          // forward is (-sin yaw, -cos yaw), so looking from (+ox, +oz) back at
          // the figure needs yaw = atan2(ox, oz). The negated form turned the
          // camera 180 degrees away and the figure went behind it - which the
          // inFrontOfCamera check then caught.
          w.state.yaw = Math.atan2(ox, oz); w.state.pitch = 0.02;
        }, { idx: i, ox: dx, oz: dz });
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(400);
        // eslint-disable-next-line no-await-in-loop
        one = (await measure())[i];
        if (one.headIsVisible) { one.standOffset = [dx, dz]; break; }
      }
    }
    rows.push(one);
    await page.screenshot({ path: path.join(OUT, `${label}-${one?.key || i}.png`) });
  }

  const bare = rows.find((r) => r.key === 'bare');
  const capped = rows.filter((r) => r.key !== 'bare');
  const checks = {
    fourWerePlaced: setup.placed === 4 && rows.length === 4 && rows.every((r) => !r.error),
    // conversational distance, and the same for every figure in the pair
    atConversationalDistance: rows.every((r) => r.distanceM > 1.4 && r.distanceM < 4.2),
    facingTheFigure: rows.every((r) => r.inFrontOfCamera === true),
    nothingInTheWay: rows.every((r) => r.headIsVisible === true),
    headReadsAtThatDistance: rows.every((r) => r.headPixelSpan > 40),
    // CONTROL: bare heads and capped heads must NOT report the same covering,
    // or the probe is measuring something both share rather than the hair
    coverProbeTellsThemApart: bare && capped.length
      && capped.every((c) => c.coverParts !== bare.coverParts
        || Math.abs((c.coverBelowEquator ?? 0) - (bare.coverBelowEquator ?? 0)) > 0.05),
    noPageErrors: errs.length === 0,
  };
  const out = { label, setup, rows, checks, errs: errs.slice(0, 8) };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, `${label}.json`), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

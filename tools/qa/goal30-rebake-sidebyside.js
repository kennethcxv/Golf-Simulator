// GOAL 30 LEVER C — the rebake side-by-side the goal doc demands: original vs
// 1024 vs 512 candidates, rendered by the LIVE game at the prop's real place,
// real sun, default player camera, owner resolution. Frames are the decision
// evidence; the harness only stages them.
//
// CONTROL (the cache-collapse discriminator): after staging, each column's
// material.map.image width is read back and must be 2048 / 1024 / 512. If two
// columns share bytes, "no visible difference" would be a lie of the loader,
// not a finding about the rebake.
//
//   node tools/qa/run-electron.cjs tools/qa/goal30-rebake-sidebyside.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal30');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(8000);
  await boot.ownerResolution(page, page.electronApp);

  // deterministic light: 14:00, speed 0
  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
  });
  await page.waitForTimeout(1500);

  // ---- stage both trios ------------------------------------------------------
  out.stage = await page.evaluate(async () => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const s3 = window.__fw.scene3d;
    const scene = s3.scene;

    // the live club_sign, found by its tripo atlas name (grep-proof identity)
    let liveSign = null;
    scene.traverse((o) => {
      if (!liveSign && o.isMesh && o.material?.map?.name?.includes('4b7996eb')) liveSign = o;
    });
    if (!liveSign) return { err: 'live club_sign not found in scene' };
    let signRoot = liveSign;
    while (signRoot.parent && signRoot.parent !== scene) signRoot = signRoot.parent;

    const load = (url) => new Promise((resolve, reject) => {
      new GLTFLoader().load(url, (g) => resolve(g.scene), undefined, reject);
    });
    const [sign1024Src, sign512Src, shoeOrig, shoe1024, shoe512] = await Promise.all([
      load('qa/goal30/stage1024/vendor/models/club_sign.glb'),
      load('qa/goal30/stage512/vendor/models/club_sign.glb'),
      load('vendor/models/clubhouse/shoe_pro.glb'),
      load('qa/goal30/stage1024/vendor/models/clubhouse/shoe_pro.glb'),
      load('qa/goal30/stage512/vendor/models/clubhouse/shoe_pro.glb'),
    ]);

    // The candidates' fresh GLB loads carry neither putModel's orientation nor
    // the text-overlay child the live monument was given at build time (the
    // first cut of this driver staged bare loads and shot a blank back and an
    // edge-on pillar). So: clone the LIVE sign — text plane, transforms and
    // all — and graft ONLY the candidate atlas onto the clones' materials.
    // The columns then differ in nothing but the tripo texture, which is the
    // claim under test; candidate geometry equality is the stage audit's job.
    const SLOTS = ['map', 'normalMap', 'metalnessMap', 'roughnessMap', 'aoMap'];
    const extractMaterial = (root) => {
      let m = null;
      root.traverse((o) => { if (!m && o.isMesh && o.material?.map) m = o.material; });
      return m;
    };
    // swap EVERY texture slot the candidate carries — the fleet rebake shrinks
    // base, normal and roughness together, so the probe must too. The
    // candidate's OWN texture objects are used as-is: texture.clone() shares
    // its Source, and assigning .image through a clone mutates the LIVE
    // sign's pixels too (the width control caught exactly that on the first
    // graft attempt — all three columns read 512).
    const graft = (cloneRoot, candMat) => {
      cloneRoot.traverse((o) => {
        if (!o.isMesh || !o.material?.map?.name?.includes('4b7996eb')) return;
        const m = o.material.clone();
        for (const slot of SLOTS) {
          if (!m[slot] || !candMat[slot]) continue;
          m[slot] = candMat[slot];
        }
        m.userData.g30graft = true;
        m.needsUpdate = true;
        o.material = m;
      });
    };
    const ry = signRoot.rotation.y;
    const right = { x: Math.cos(ry), z: -Math.sin(ry) }; // sign-local +X in world
    // NEGATIVE k: the entrance's own flag-pillar dressing flanks the sign on
    // its clubhouse side at almost exactly the first cut's +2.6/+5.2 offsets,
    // and the second shot framed THOSE instead of the clones. The open field
    // is on the other side.
    const gap = 4.0;
    const staged = [];
    const sign1024 = signRoot.clone(true);
    const sign512 = signRoot.clone(true);
    graft(sign1024, extractMaterial(sign1024Src));
    graft(sign512, extractMaterial(sign512Src));
    for (const [m, k] of [[sign1024, -1], [sign512, -2]]) {
      m.position.set(
        signRoot.position.x + right.x * gap * k,
        signRoot.position.y,
        signRoot.position.z + right.z * gap * k,
      );
      scene.add(m);
      staged.push(m);
    }

    // shoe trio on a line at counter height, indoors staging happens second —
    // park them far below the floor until their shot
    const shoes = [shoeOrig, shoe1024, shoe512];
    for (const m of shoes) { m.position.set(0, -80, 0); scene.add(m); staged.push(m); }

    const widthOf = (root, needle) => {
      let w = null; let name = null;
      root.traverse((o) => {
        if (w !== null || !o.isMesh) return;
        const mat = o.material;
        const t = mat?.map;
        if (!t || !t.image) return;
        // grafted materials are authoritative; otherwise match the atlas name
        if (mat.userData?.g30graft || !needle || (t.name || '').includes(needle)) {
          w = t.image.width; name = t.name;
        }
      });
      return { w, name };
    };
    window.__g30 = { signRoot, sign1024, sign512, shoes, staged };
    return {
      signWidths: [widthOf(signRoot, '4b7996eb'), widthOf(sign1024, '4b7996eb'), widthOf(sign512, '4b7996eb')],
      shoeWidths: [widthOf(shoeOrig), widthOf(shoe1024), widthOf(shoe512)],
      signPos: signRoot.position.toArray().map((v) => +v.toFixed(1)),
      signYaw: +signRoot.rotation.y.toFixed(3),
      signScale: +signRoot.scale.x.toFixed(2),
    };
  });
  if (out.stage.err) { console.log(JSON.stringify(out, null, 2)); process.exitCode = 1; return out; }

  const sw = out.stage.signWidths.map((x) => x.w);
  const hw = out.stage.shoeWidths.map((x) => x.w);
  out.control_widths = (sw[0] === 2048 && sw[1] === 1024 && sw[2] === 512
    && hw[0] === 2048 && hw[1] === 1024 && hw[2] === 512)
    ? `ok — sign ${sw.join('/')} shoe ${hw.join('/')}`
    : `FAILED — sign ${sw.join('/')} shoe ${hw.join('/')} (columns are not three distinct resolutions)`;

  // ---- shots: the walk rig owns the camera every frame, so the player is
  // TELEPORTED (walk.exit + walk.enter({x,z,yaw})) rather than posing the
  // camera directly — the first cut of this driver posed s3.camera and shot
  // the spawn porch twice. yaw convention: forward = (-sin yaw, -cos yaw).
  const standAt = (px, pz, tx, tz) => page.evaluate(({ px, pz, tx, tz }) => {
    const s3 = window.__fw.scene3d;
    const yaw = Math.atan2(-(tx - px), -(tz - pz));
    s3.walk.exit();
    s3.walk.enter({ x: px, z: pz, yaw });
  }, { px, pz, tx, tz });

  const sp = out.stage.signPos;
  const ry = out.stage.signYaw;
  const fwd = { x: Math.sin(ry), z: Math.cos(ry) };
  const right = { x: Math.cos(ry), z: -Math.sin(ry) };
  // trio centre = the 1024 column (live sign + one gap step into the field)
  const c = { x: sp[0] - right.x * 4.0, z: sp[2] - right.z * 4.0 };

  await standAt(c.x + fwd.x * 6.5, c.z + fwd.z * 6.5, c.x, c.z);
  await page.waitForTimeout(1200);
  // misattribution guard: each column must project INSIDE the frame, spread
  // left-to-right — the second cut of this driver shot the entrance dressing
  // and called it the trio
  out.projection = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const { signRoot, sign1024, sign512 } = window.__g30;
    const V = signRoot.position.constructor;
    return [signRoot, sign1024, sign512].map((m) => {
      const p = new V(m.position.x, m.position.y + 1.5, m.position.z).project(s3.camera);
      return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), inFrame: Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1 };
    });
  });
  await page.screenshot({ path: path.join(OUT, 'sign-trio-3m.png') });
  await standAt(c.x + fwd.x * 1.6, c.z + fwd.z * 1.6, c.x, c.z);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'sign-trio-1m.png') });

  // ---- shoe trio at 1.1 m, eye-level-shelf height (walk pitch is pointer-
  // driven and enter() zeroes it, so the row is staged AT eye height — the
  // real gondola's top shelf — same sun; outdoor light is brighter than the
  // shelf's, which makes this the CONSERVATIVE direction for the decision) ----
  await page.evaluate(({ signYaw, cx, cz }) => {
    const { shoes, sign1024 } = window.__g30;
    const r = { x: Math.cos(signYaw), z: -Math.sin(signYaw) };
    const f = { x: Math.sin(signYaw), z: Math.cos(signYaw) };
    // a metre out from the sign face so the row doesn't intersect the board
    const bx = cx + f.x * 1.0;
    const bz = cz + f.z * 1.0;
    shoes.forEach((m, i) => {
      m.position.set(
        bx + r.x * (i - 1) * 0.45,
        sign1024.position.y + 1.32,
        bz + r.z * (i - 1) * 0.45,
      );
      m.rotation.y = signYaw;
    });
    window.__g30.shoeCentre = { x: bx, z: bz };
  }, { signYaw: ry, cx: c.x, cz: c.z });
  const sc = { x: c.x + fwd.x * 1.0, z: c.z + fwd.z * 1.0 };
  await standAt(sc.x + fwd.x * 1.15, sc.z + fwd.z * 1.15, sc.x, sc.z);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'shoe-trio-1m.png') });

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'sidebyside-result.json'), `${JSON.stringify(out, null, 2)}\n`);
  const ok = out.control_widths.startsWith('ok') && out.errs.length === 0;
  console.log(ok ? 'CONTROLS OK' : 'CONTROLS FAILED');
  if (!ok) process.exitCode = 1;
  return out;
}

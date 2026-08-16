// GOAL 30 LEVER C — the rebake decision evidence, A/B-swap form: ONE live
// prop, ONE camera, and the candidate atlases swapped in place between
// frames. Framing, sun, text overlay and dressing are pixel-identical across
// the set, so the ONLY thing that changes frame-to-frame is the texture
// resolution under test.
//
// Frame set per station: orig -> 1024 -> 512 -> orig-restored.
// CONTROLS:
//   * width readback before every frame (2048/1024/512/2048) — a cache
//     collapse or failed swap reads as the wrong width;
//   * the restore frame measures the ambient noise floor: any 2048-vs-1024
//     difference smaller than orig-vs-restored is weather, not resolution.
//
//   node tools/qa/run-electron.cjs tools/qa/goal30-rebake-abswap.js --clubhouse=pine-hills-v2
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

  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
  });
  await page.waitForTimeout(1200);

  // ---- locate the sign, its front side, and load the candidate materials ----
  out.setup = await page.evaluate(async () => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const s3 = window.__fw.scene3d;
    let signMesh = null;
    s3.scene.traverse((o) => {
      if (!signMesh && o.isMesh && o.material?.map?.name?.includes('4b7996eb')) signMesh = o;
    });
    if (!signMesh) return { err: 'club_sign atlas mesh not found' };
    let signRoot = signMesh;
    while (signRoot.parent && signRoot.parent !== s3.scene) signRoot = signRoot.parent;

    // the name panel is a separate root placed just off the sign's front face —
    // its offset direction from the monument IS the front direction
    let panel = null;
    const sp = signRoot.position;
    s3.scene.traverse((o) => {
      if (panel || !o.isMesh || o === signMesh) return;
      const t = o.material?.map;
      if (!t || !t.isCanvasTexture) return;
      const dx = o.getWorldPosition(new sp.constructor()).sub(sp);
      if (dx.length() < 3) panel = { obj: o, off: { x: dx.x, z: dx.z } };
    });
    const ry = signRoot.rotation.y;
    let front = { x: -Math.sin(ry), z: -Math.cos(ry) };
    if (panel) {
      const L = Math.hypot(panel.off.x, panel.off.z) || 1;
      front = { x: panel.off.x / L, z: panel.off.z / L };
    }

    const load = (url) => new Promise((resolve, reject) => {
      new GLTFLoader().load(url, (g) => resolve(g.scene), undefined, reject);
    });
    const firstMat = (root) => {
      let m = null;
      root.traverse((o) => { if (!m && o.isMesh && o.material?.map) m = o.material; });
      return m;
    };
    const [s1024, s512, shoeO, shoe1024, shoe512] = await Promise.all([
      load('qa/goal30/stage1024/vendor/models/club_sign.glb'),
      load('qa/goal30/stage512/vendor/models/club_sign.glb'),
      load('vendor/models/clubhouse/shoe_pro.glb'),
      load('qa/goal30/stage1024/vendor/models/clubhouse/shoe_pro.glb'),
      load('qa/goal30/stage512/vendor/models/clubhouse/shoe_pro.glb'),
    ]);

    const SLOTS = ['map', 'normalMap', 'metalnessMap', 'roughnessMap', 'aoMap'];
    const origSign = {};
    for (const s of SLOTS) origSign[s] = signMesh.material[s] || null;

    // the shoe stands on open field in front of the sign at eye-shelf height —
    // far enough out that its camera spot clears the sign's r=1.6 collider
    shoeO.position.set(sp.x + front.x * 4.5, sp.y + 1.25, sp.z + front.z * 4.5);
    shoeO.rotation.y = Math.atan2(front.x, front.z) + Math.PI * 0.85;
    s3.scene.add(shoeO);
    const shoeMesh = (() => { let m = null; shoeO.traverse((o) => { if (!m && o.isMesh) m = o; }); return m; })();
    const origShoe = {};
    for (const s of SLOTS) origShoe[s] = shoeMesh.material[s] || null;

    window.__g30 = {
      SLOTS,
      signMesh,
      signRoot,
      front,
      shoeRoot: shoeO,
      shoeMesh,
      variants: {
        sign: { orig: origSign, v1024: firstMat(s1024), v512: firstMat(s512) },
        shoe: { orig: origShoe, v1024: firstMat(shoe1024), v512: firstMat(shoe512) },
      },
    };
    return {
      signPos: sp.toArray().map((v) => +v.toFixed(1)),
      front: { x: +front.x.toFixed(2), z: +front.z.toFixed(2) },
      panelFound: !!panel,
    };
  });
  if (out.setup.err) { console.log(JSON.stringify(out, null, 2)); process.exitCode = 1; return out; }

  // returns how far the collider push moved us off the requested spot — a
  // shot from a shoved position is a shot of something else (two frames of
  // the groundskeeper's house proved it)
  const standAt = async (px, pz, tx, tz) => {
    await page.evaluate(({ px, pz, tx, tz }) => {
      const s3 = window.__fw.scene3d;
      const yaw = Math.atan2(-(tx - px), -(tz - pz));
      s3.walk.exit();
      s3.walk.enter({ x: px, z: pz, yaw });
    }, { px, pz, tx, tz });
    await page.waitForTimeout(400); // camera takes the walk pose on the next frames
    const moved = await page.evaluate(({ px, pz }) => {
      const p = window.__fw.scene3d.camera.position;
      return +Math.hypot(p.x - px, p.z - pz).toFixed(2);
    }, { px, pz });
    if (moved > 0.5) out.errs.push(`standAt(${px.toFixed(1)},${pz.toFixed(1)}) shoved ${moved} yd off-spot`);
    return moved;
  };

  // swap the LIVE material's texture slots to a variant's; 'orig' restores
  const setVariant = (station, which) => page.evaluate(({ station, which }) => {
    const g = window.__g30;
    const mesh = station === 'sign' ? g.signMesh : g.shoeMesh;
    const v = g.variants[station][which];
    for (const slot of g.SLOTS) {
      const src = which === 'orig' ? v[slot] : (v[slot] || null);
      if (!mesh.material[slot] && !src) continue;
      if (src) mesh.material[slot] = src;
    }
    mesh.material.needsUpdate = true;
    const w = mesh.material.map?.image?.width || null;
    return { width: w };
  }, { station, which });

  const sp = out.setup.signPos;
  const f = out.setup.front;

  const shots = [];
  const shoot = async (station, which, tag) => {
    const r = await setVariant(station, which);
    await page.waitForTimeout(700);
    const file = `abswap-${tag}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    shots.push({ station, which, tag, width: r.width, file });
  };

  // ---- sign at 2.6 m (reading distance) --------------------------------------
  await standAt(sp[0] + f.x * 2.6, sp[2] + f.z * 2.6, sp[0], sp[2]);
  await page.waitForTimeout(1100);
  for (const which of ['orig', 'v1024', 'v512', 'orig']) {
    await shoot('sign', which, `sign-2m-${which === 'orig' ? (shots.some((s) => s.tag.startsWith('sign-2m-orig')) ? 'restore' : 'orig') : which}`);
  }
  // ---- sign at 2.05 m (walk-right-up; the sign's prop collider r=1.6 PLUS
  // the walker's own 0.34 body radius blocks anything nearer than ~1.94, and
  // walkEnter shoves a blocked spawn 15 m down the course — two cuts of this
  // driver shot the groundskeeper's house and called it a close-up) ------------
  await standAt(sp[0] + f.x * 2.05, sp[2] + f.z * 2.05, sp[0], sp[2]);
  await page.waitForTimeout(900);
  for (const which of ['orig', 'v1024', 'v512', 'orig']) {
    await shoot('sign', which, `sign-1m-${which === 'orig' ? (shots.some((s) => s.tag.startsWith('sign-1m-orig')) ? 'restore' : 'orig') : which}`);
  }

  // ---- shoe at arm's length ---------------------------------------------------
  const shoeC = { x: sp[0] + f.x * 4.5, z: sp[2] + f.z * 4.5 };
  await standAt(shoeC.x + f.x * 0.9, shoeC.z + f.z * 0.9, shoeC.x, shoeC.z);
  out.shoeCamDist = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const p = s3.camera.position;
    const q = window.__g30.shoeRoot.position;
    return +Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z).toFixed(2);
  });
  await page.waitForTimeout(900);
  for (const which of ['orig', 'v1024', 'v512', 'orig']) {
    await shoot('shoe', which, `shoe-1m-${which === 'orig' ? (shots.some((s) => s.tag.startsWith('shoe-1m-orig')) ? 'restore' : 'orig') : which}`);
  }

  out.shots = shots;
  const seq = (pfx) => shots.filter((s) => s.tag.startsWith(pfx)).map((s) => s.width).join('/');
  const wantSign = '2048/1024/512/2048';
  const wantShoe = '2048/1024/512/2048';
  out.control_widths = (seq('sign-2m') === wantSign && seq('sign-1m') === wantSign && seq('shoe-1m') === wantShoe)
    ? `ok — sign2m ${seq('sign-2m')} sign1m ${seq('sign-1m')} shoe ${seq('shoe-1m')}`
    : `FAILED — sign2m ${seq('sign-2m')} sign1m ${seq('sign-1m')} shoe ${seq('shoe-1m')}`;

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'abswap-result.json'), `${JSON.stringify(out, null, 2)}\n`);
  const ok = out.control_widths.startsWith('ok') && out.errs.length === 0;
  console.log(ok ? 'CONTROLS OK' : 'CONTROLS FAILED');
  if (!ok) process.exitCode = 1;
  return out;
}

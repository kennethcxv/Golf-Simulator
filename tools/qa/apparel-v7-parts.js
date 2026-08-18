// WHICH MESH IS THAT? A flat-colour identity frame.
//
// The hoodie's hood reads in game as a glossy pale dome when its material is
// dark navy, and three plausible explanations (flipped normals, the hanger,
// the staging rail) are all guesses. Guessing which mesh a pixel belongs to is
// how this project ends up fixing the wrong thing, so: give every mesh a flat
// unlit colour, shoot one frame, and print the legend.
//
//   V7_PART_ASSET=apparel_hoodie_hung.glb node tools/qa/run-electron.cjs \
//       tools/qa/apparel-v7-parts.js --clubhouse=pine-hills-v2
//
async (page) => {
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  const boot = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 180000 });
  } catch { /* keep going */ }
  await page.waitForTimeout(2500);

  const ASSET = process.env.V7_PART_ASSET || 'apparel_hoodie_hung.glb';
  const HEIGHT = Number(process.env.V7_PART_HEIGHT || 1.66);

  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
    const w = app.scene3d.walk;
    const o = app.scene3d.clubhouse().interior.position;
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4;
    w.state.yaw = -Math.PI / 2 + 60 * Math.PI / 180; w.state.pitch = -0.30;
    w.state.vx = 0; w.state.vz = 0;
    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k];
      if (v && v.isCamera) { cam = v; break; }
    }
    window.__v7cam = cam;
    let s = cam; while (s.parent) s = s.parent;
    window.__v7scene = s;
  });
  await page.waitForTimeout(1200);

  const legend = await page.evaluate(async ([ASSET, HEIGHT]) => {
    const THREE = await import('three');
    const mod = await import('./src/render3d/gltfCache.js');
    const loader = new mod.CachedGLTFLoader();
    const cam = window.__v7cam;
    const scene = window.__v7scene;
    cam.updateMatrixWorld(true);
    const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const q = cam.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    fwd.y = 0; fwd.normalize();

    const prev = scene.getObjectByName('__v7parts');
    if (prev) prev.parent.remove(prev);
    const holder = new THREE.Group();
    holder.name = '__v7parts';
    scene.add(holder);

    const g = await new Promise((res, rej) =>
      loader.load(`Assets/models/hero/v5/${ASSET}`, res, undefined, rej));
    const root = (g.scene || g.scenes[0]).clone(true);
    const at = eye.clone().add(fwd.clone().multiplyScalar(0.9));
    at.y = eye.y - 1.62 + HEIGHT;
    root.position.copy(at);
    root.rotation.y = Math.atan2(-fwd.x, -fwd.z);
    holder.add(root);

    const PALETTE = [
      0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff,
      0xff8000, 0x8000ff, 0x00ff80, 0x804000,
    ];
    const rows = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const c = PALETTE[rows.length % PALETTE.length];
      const names = [].concat(o.material).map((m) => (m && m.name) || '?');
      // FLAT AND UNLIT, so what is seen is the mesh and not the lighting.
      o.material = new THREE.MeshBasicMaterial({ color: c, side: THREE.FrontSide });
      const box = new THREE.Box3().setFromObject(o);
      const s = box.getSize(new THREE.Vector3());
      rows.push({
        colour: '#' + c.toString(16).padStart(6, '0'),
        mesh: o.name,
        wasMaterial: names.join('+'),
        sizeMm: [s.x, s.y, s.z].map((v) => Math.round(v * 1000)),
        topMm: Math.round((box.max.y - at.y) * 1000),
      });
    });
    return rows;
  }, [ASSET, HEIGHT]);

  await page.waitForTimeout(900);
  await page.screenshot({ path: `qa/hero/v7/parts-${ASSET.replace('.glb', '')}.png` });
  console.log(`\n${ASSET} -- flat identity frame`);
  for (const r of legend) {
    console.log(`  ${r.colour}  ${(r.mesh || '?').padEnd(26)} `
      + `${r.wasMaterial.padEnd(24)} ${r.sizeMm.join(' x ').padEnd(18)} mm  `
      + `top ${r.topMm} mm from origin`);
  }
  return { legend };
}

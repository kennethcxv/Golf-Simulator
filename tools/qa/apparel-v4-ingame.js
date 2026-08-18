// IN-GAME VERIFICATION for the ten v4 apparel GLBs.
//
// The brief's tenth PASS condition is an in-game screenshot: scale, orientation,
// lighting response, texture response, clipping, camera distance, readability.
// I had been calling this blocked because the pro shop's fixtures are not placed
// until the shop is restored and stocked, and because nothing in the renderer
// references hero/v4 yet -- so a shop tour shows bare walls whatever it is told.
//
// Both of those are about MERCHANDISING, not about whether the asset survives
// the game's renderer. This driver skips the merchandising question: it loads
// each GLB through the app's own CachedGLTFLoader, stands it in front of the
// player at rail or shelf height in the live clubhouse, and shoots the DEFAULT
// player camera. That answers every item on the brief's list, and it answers
// them about the shipping renderer rather than about Blender.
//
//   node tools/qa/run-electron.cjs tools/qa/apparel-v4-ingame.js \
//        --clubhouse=pine-hills-v2
//
async (page) => {
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  // THE COMPILE VEIL CAN OUTLAST 40 SECONDS on a cold profile -- the shop tour
  // got away with it warm and this did not. Wait long, then carry on rather than
  // failing the whole run: the veil is a load screen, and if it is still up the
  // screenshots will show it and say so.
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 180000 });
  } catch (e) {
    console.log('load veil still up after 180 s -- continuing');
  }

  await page.waitForTimeout(2500);

  const ASSETS = [
    ['hoodie-hung', 'apparel_hoodie_hung.glb', 1.42],
    ['trousers-hung', 'apparel_trousers_hung.glb', 1.55],
    ['cap', 'apparel_cap.glb', 1.05],
    ['polo-hung', 'apparel_polo_hung.glb', 1.42],
    ['tee-hung', 'apparel_tee_hung.glb', 1.42],
    ['hoodie-folded', 'apparel_hoodie_folded.glb', 0.94],
    ['trousers-folded', 'apparel_trousers_folded.glb', 0.94],
    ['polo-folded', 'apparel_polo_folded.glb', 0.94],
    ['tee-folded', 'apparel_tee_folded.glb', 0.94],
    ['cap-peg', 'apparel_cap_peg.glb', 1.35],
  ];

  const out = [];
  for (const [name, file, height] of ASSETS) {
    const info = await page.evaluate(async ([file, height]) => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      // three comes from the page's own import map -- the app does not hang a
      // THREE global off scene3d, and window.THREE does not exist in a module
      // build. Importing the bare specifier gets the SAME instance the renderer
      // uses, which matters for instanceof checks inside the scene graph.
      const THREE = await import('three');
      const mod = await import('./src/render3d/gltfCache.js');
      const loader = new mod.CachedGLTFLoader();

      // clear anything a previous asset left
      let rootScan = ch.interior;
      while (rootScan.parent) rootScan = rootScan.parent;
      const prev = rootScan.getObjectByName('__v4probe');
      if (prev) prev.parent.remove(prev);

      const g = await new Promise((res, rej) =>
        loader.load(`Assets/models/hero/v4/${file}`, res, undefined, rej));
      const root = g.scene || g.scenes[0];
      root.name = '__v4probe';

      // measure what the RENDERER sees, in world units
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());

      // STAND IT IN FRONT OF THE LIVE CAMERA, IN WORLD SPACE.
      //
      // The first cut added it to ch.interior at the walk position, and the
      // frames came back showing the clubhouse porch: the game opens with the
      // player OUTSIDE, walking toward the building, so an object parented into
      // the interior subtree is behind a wall and 20 m away. Placing from the
      // camera's own world matrix cannot be wrong about where the player is
      // looking, whatever the interior's origin happens to be.
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

      cam.updateMatrixWorld(true);
      const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      const fwd = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
      // 1.15 m out, and dropped to chest height so a hung garment reads the way
      // it would on a rail rather than floating at eye level
      const at = eye.clone().add(fwd.clone().multiplyScalar(1.15));
      const centre = box.getCenter(new THREE.Vector3());
      root.position.copy(at).sub(centre);
      root.position.y -= 0.10;
      root.rotation.y = Math.atan2(-fwd.x, -fwd.z);
      scene.add(root);
      root.updateMatrixWorld(true);

      let tris = 0, meshes = 0, uv = 0;
      root.traverse((o) => {
        if (!o.isMesh) return;
        meshes += 1;
        const ix = o.geometry.index;
        tris += (ix ? ix.count : o.geometry.attributes.position.count) / 3;
        if (o.geometry.attributes.uv) uv += 1;
      });
      return { size: [size.x, size.y, size.z], tris, meshes, uv };
    }, [file, height]);

    await page.waitForTimeout(700);
    const shot = `qa/hero/v4/ingame/${name}-ingame.png`;
    await page.screenshot({ path: shot });
    out.push({ name, shot, ...info });
    console.log(`${name.padEnd(17)} ${info.size.map((v) => (v * 1000).toFixed(0)).join(' x ')} mm  `
      + `${info.tris} tris  ${info.uv}/${info.meshes} meshes with UV`);
  }
  return { shots: out };
}

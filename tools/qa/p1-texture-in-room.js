// P1: the textured assets, in the room, at the player's own camera.
//
// The pair harness renders each asset alone in a neutral studio, which is the right way
// to prove a map arrived. It is NOT the right way to judge whether the pass reads well:
// the shop has its own light, its own exposure and its own standoff distances, and a
// grain that looks convincing at arm's length in a studio can be invisible at the
// distance the player actually stands, or can tile visibly across a wall of casework.
//
// So this walks the live build to the places the player looks from and captures through
// the game's camera, with the game's post chain. Nothing is measured here — the point is
// to look at it.
//
//   node tools/qa/run-electron.cjs tools/qa/p1-texture-in-room.js
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/p1-texture/in-room');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  // Midday, lights on, so the surfaces are lit the way the shop is normally seen.
  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 12 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(720, app.state.weather);
  });
  await page.waitForTimeout(900);

  // Do not guess where the assets are. Ask the scene which of them it actually
  // instantiated, take each one's world bounding box, and frame it from the player's
  // eye height at a standoff the collision system would permit. A hand-picked vantage
  // proves only that the camera was pointed somewhere.
  const found = await page.evaluate(() => {
    const scene = window.__fw.scene3d;
    const roots = new Map();
    scene.scene.traverse((node) => {
      const m = /^A_(\d{3})_/.exec(node.name || '');
      if (!m) return;
      const n = Number(m[1]);
      if (n < 61 || n > 80 || n === 65) return;
      // The first-person variants are parented to the camera rig and only take a
      // position when a tool is held; in the world they sit at the origin, outside the
      // building. They are room props in no sense, and the pair harness already covers
      // them. Skip them here rather than photograph the lawn.
      if (/_FP_ROOT$/.test(node.name)) return;
      if (!roots.has(node.name)) roots.set(node.name, node);
    });
    return [...roots.keys()];
  });

  const shots = [];
  for (const name of found) {
    const placed = await page.evaluate(async (rootName) => {
      // The app does not re-export three, so import the same module the scene uses.
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const scene = window.__fw.scene3d;
      let target = null;
      scene.scene.traverse((n) => { if (!target && n.name === rootName) target = n; });
      if (!target) return { error: 'gone' };
      const box = new THREE.Box3().setFromObject(target);
      if (box.isEmpty()) return { error: 'empty bounds' };
      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const cam = scene.camera || scene.getCamera?.();
      if (!cam) return { error: 'no camera' };
      // Stand back far enough to see the whole thing, but no further — the question is
      // whether the grain reads at a plausible standoff, not from across the room.
      // Which SIDE to stand on cannot be assumed: a fixed offset direction puts the
      // camera inside a wall for anything against one, and photographs the plaster.
      // So cast outward from the asset and take the direction with the most clear room,
      // which is the direction a player could actually stand in.
      const want = Math.max(size.length() * 0.75, 0.9);
      const eye = centre.y + Math.min(size.y * 0.35, 0.55);
      const ray = new THREE.Raycaster();
      const blockers = [];
      scene.scene.traverse((n) => {
        if (!n.isMesh || !n.visible) return;
        if (/collision|COL_/i.test(n.name || '')) return;
        let inAsset = false;
        for (let p = n; p; p = p.parent) if (p === target) { inAsset = true; break; }
        if (!inAsset) blockers.push(n);
      });
      let best = null;
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        ray.set(new THREE.Vector3(centre.x, eye, centre.z), dir);
        ray.far = want * 1.4;
        const hit = ray.intersectObjects(blockers, false)[0];
        const clear = hit ? hit.distance : want * 1.4;
        if (!best || clear > best.clear) best = { dir, clear };
      }
      const dist = Math.min(want, Math.max(best.clear * 0.8, 0.55));
      cam.position.set(
        centre.x + best.dir.x * dist, eye + dist * 0.28, centre.z + best.dir.z * dist,
      );
      cam.lookAt(centre);
      cam.updateMatrixWorld(true);
      scene.renderer.render(scene.scene, cam);
      return { ok: true, canvas: scene.renderer.domElement.toDataURL('image/png') };
    }, name);
    const stem = name.replace(/^A_/, '').replace(/_ROOT$/, '').toLowerCase();
    if (placed.error) { shots.push({ asset: name, error: placed.error }); continue; }
    fs.writeFileSync(path.join(OUT, `${stem}.png`), Buffer.from(placed.canvas.split(',')[1], 'base64'));
    shots.push({ asset: name, saved: `${stem}.png` });
  }

  const checks = {
    someAssetsArePlacedInTheRoom: shots.length > 0,
    everyPlacedAssetCaptured: shots.every((s) => !s.error),
    noPageErrors: errs.length === 0,
  };
  const out = { placed: found, shots, errs: errs.slice(0, 8), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'in-room.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

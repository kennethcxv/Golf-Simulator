// H7 end-to-end proof, golden leg: the golden suite must SEE a new object.
// Spawns the throwaway bucket in the shop-floor pose's view, captures that
// pose, and the diff against the committed golden must FAIL. Then removes it,
// recaptures, and the diff must PASS. Symmetric proof in one run.
//
//   node tools/qa/run-electron.cjs tools/qa/golden-proof-intruder.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const WITH = path.resolve('qa/golden/proof-with');
  const WITHOUT = path.resolve('qa/golden/proof-without');
  fs.mkdirSync(WITH, { recursive: true });
  fs.mkdirSync(WITHOUT, { recursive: true });

  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });

  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
  });
  const waitFrames = (n) => page.evaluate((frames) => new Promise((res) => {
    let i = 0;
    const tick = () => (++i >= frames ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);
  const setPose = () => page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    w.state.vx = 0; w.state.vz = 0;
  });
  const despawnAll = () => page.evaluate(async () => {
    const app = window.__fw;
    const simModule = await import('./src/sim/customerSimulation.js');
    const sim = simModule.ensureCustomerSimulation(app.state);
    for (const c of sim.active.slice()) { try { simModule.despawnCustomer(app.state, c, { reason: 'golden-proof' }); } catch { /* void nothing */ } }
  });
  const shot = async (dir) => {
    await despawnAll();
    await waitFrames(45);
    const canvas = await page.$('#game');
    await (canvas || page).screenshot({ path: path.join(dir, 'shop-floor.png') });
  };

  // Spawn the intruder dead ahead of the shop-floor camera — positioned FROM
  // THE LIVE CAMERA (the interior-origin Y is not the floor Y; that gotcha is
  // on record), then verify it projects on-screen before trusting the capture.
  await setPose();
  await waitFrames(5);
  const spawned = await page.evaluate(async () => {
    const app = window.__fw;
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const cam = app.scene3d.camera;
    cam.updateMatrixWorld(true);
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const gltf = await new GLTFLoader().loadAsync('./vendor/models/_throwaway/range_bucket_throwaway.glb');
    const root = gltf.scene;
    root.name = 'GOLDEN_PROOF_INTRUDER';
    root.scale.setScalar(2);
    // 2.2m ahead, half a metre below eye, floating mid-frame: this leg proves
    // the golden SEES a new object, not that buckets rest on floors.
    root.position.copy(camPos).addScaledVector(dir, 2.2);
    root.position.y = camPos.y - 0.5;
    app.scene3d.scene.add(root);
    root.updateMatrixWorld(true);
    const ndc = root.position.clone().add(new THREE.Vector3(0, 0.3, 0)).project(cam);
    return { at: root.position.toArray().map((v) => +v.toFixed(2)), ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2), +ndc.z.toFixed(2)], onScreen: Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && ndc.z < 1 };
  });
  console.log('intruder spawned', JSON.stringify(spawned));
  if (!spawned.onScreen) throw new Error('intruder projects OFF-SCREEN — placement wrong, capture would prove nothing');
  await shot(WITH);

  await page.evaluate(() => {
    const app = window.__fw;
    const g = app.scene3d.scene.getObjectByName('GOLDEN_PROOF_INTRUDER');
    if (g) g.parent.remove(g);
  });
  await setPose();
  await shot(WITHOUT);
  console.log('captures done');
}

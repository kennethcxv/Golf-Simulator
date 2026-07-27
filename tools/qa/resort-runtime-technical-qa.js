async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.join(process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'clubhouse_resort', 'runtime-technical');
  fs.mkdirSync(out, { recursive: true });
  await page.goto(`${baseUrl}tools/qa/resort-runtime-harness.html`, { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 1600, height: 900 });
  const diagnostics = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createResortClubhouse } = await import('/src/render3d/clubhouse/resortClubhouse.js');
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#preview'), antialias: true });
    renderer.setPixelRatio(1);
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb9d8e9);
    scene.fog = new THREE.Fog(0xb9d8e9, 55, 120);
    const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.08, 240);
    const mount = new THREE.Group();
    scene.add(mount);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshStandardMaterial({ color: 0x6f8c5c, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    scene.add(new THREE.HemisphereLight(0xd8efff, 0x6b583f, 2.1));
    const sun = new THREE.DirectionalLight(0xffedcf, 4.2);
    sun.position.set(-22, 38, 24);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    scene.add(sun);
    const resort = createResortClubhouse({
      group: mount,
      shellFallbacks: {},
      sheet06Production: { ready: Promise.resolve(), getRoot: () => null },
      doors: [{ mainLeaf: 'left', angle: 0 }, { mainLeaf: 'right', angle: 0 }],
      floorTop: 0,
      url: '/vendor/models/clubhouse/clubhouse_resort_4000.glb',
    });
    await resort.ready;
    window.__resortHarness = { THREE, renderer, scene, camera, resort };
    const render = () => renderer.render(scene, camera);
    window.__resortHarness.render = render;
    render();
    return resort.diagnostics();
  });

  const shots = [
    { id: '01-front-runtime', at: [-22, 13, 37], to: [0, 3.6, 2] },
    { id: '02-entrance-runtime', at: [-2, 5.5, 25], to: [-1, 2.4, 8] },
    { id: '03-bag-cart-runtime', at: [32, 12, 32], to: [10, 3, 11] },
    { id: '04-rear-runtime', at: [-20, 11, -34], to: [0, 2.6, -7] },
  ];
  for (const shot of shots) {
    await page.evaluate((pose) => {
      const { THREE, camera, render } = window.__resortHarness;
      camera.position.fromArray(pose.at);
      camera.lookAt(new THREE.Vector3(...pose.to));
      render();
    }, shot);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, `${shot.id}.png`) });
  }
  const stats = await page.evaluate(() => {
    const { renderer, scene } = window.__resortHarness;
    renderer.info.autoReset = false;
    renderer.info.reset();
    renderer.render(scene, window.__resortHarness.camera);
    const result = {
      drawCalls: renderer.info.render.calls,
      renderedTriangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    };
    renderer.info.autoReset = true;
    return result;
  });
  return {
    ok: diagnostics.status === 'ready'
      && diagnostics.runtimeBatch.offlineOptimized === true
      && diagnostics.runtimeBatch.batchedDrawCalls < 40,
    out,
    diagnostics,
    stats,
  };
}

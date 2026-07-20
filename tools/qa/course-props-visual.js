// Deterministic player-camera comparison for the runtime Tripo props that are
// resident in a normal course boot. This is a visual diagnostic; functional QA
// for the interactions remains on the normal keyboard/mouse route.
//
//   $env:COURSE_PROP_QA_PHASE='before'
//   node tools/qa/run-playwright.cjs tools/qa/course-props-visual.js --bootstrap
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const phase = process.env.COURSE_PROP_QA_PHASE || 'before';
  const outDir = path.join(repo, 'qa', 'steam-performance-master-pass', 'assets', `course-props-${phase}`);
  const audit = JSON.parse(fs.readFileSync(path.join(
    repo,
    'qa',
    'steam-performance-master-pass',
    'assets',
    'runtime-model-footprint.json',
  ), 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => diagnostics.push({
    kind: /ERR_ABORTED/i.test(request.failure()?.errorText || '') ? 'requestaborted' : 'requestfailed',
    message: `${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  }));

  const targetFiles = [
    'vendor/models/shed.glb',
    'vendor/models/workbench.glb',
    'vendor/models/tool_chest.glb',
    'vendor/models/tractor_broken.glb',
    'vendor/models/gas_can.glb',
    'vendor/models/belt.glb',
    'vendor/models/club_sign.glb',
    'vendor/models/golf_cart.glb',
    'vendor/models/tee_sign_broken.glb',
    'vendor/models/tractor_red.glb',
  ];
  const targets = targetFiles.map((file) => {
    const asset = audit.assets.find((entry) => entry.file === file);
    if (!asset) throw new Error(`asset audit is missing ${file}`);
    return {
      file,
      name: path.basename(file, '.glb'),
      textureNames: asset.resources.images.map((image) => image.name),
    };
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const barrier = window.__fw?.scene3d?.assetBarrier?.();
    if (barrier?.promise) await barrier.promise;
    return !barrier || barrier.idle || !window.__fw.scene3d.assetBarrier().idle;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.__fw.speedIdx = 0;
    window.__fw.scene3d.walk.clearKeys?.();
  });

  const screenshots = [];
  const poses = [];
  const capture = async (name) => {
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    screenshots.push(file);
  };

  const establishPose = async (target, { overview = false, isolate = false } = {}) => page.evaluate((input) => {
    const THREE = window.__fw.scene3d.scene.constructor;
    // Use constructors already present on scene objects without importing a
    // second Three.js module into the page.
    const firstMesh = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (firstMesh.length || !object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const matched = materials.some((material) => material && Object.values(material).some((value) => (
        value?.isTexture && input.textureNames.includes(value.name || value.image?.name || value.source?.data?.name)
      )));
      if (matched) firstMesh.push(object);
    });
    const mesh = firstMesh[0];
    if (!mesh) return { found: false, file: input.file };

    let root = mesh;
    const scene = window.__fw.scene3d.scene;
    while (root.parent && root.parent !== scene) root = root.parent;
    const original = {
      visible: root.visible,
      position: root.position.toArray(),
      rotation: root.rotation.toArray(),
    };
    root.visible = true;
    root.updateMatrixWorld(true);

    // Box3/Vector3 constructors are obtained from existing values because the
    // production module intentionally exposes scene objects, not the THREE API.
    const box = mesh.geometry.boundingBox?.clone();
    if (!box) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const min = bounds.min;
    const max = bounds.max;
    const center = min.clone().add(max).multiplyScalar(0.5);
    const size = max.clone().sub(min);

    if (input.isolate) {
      // The restored tractor is loaded but hidden behind the broken progression
      // state. Move only this QA-page root into an open patch for its comparison.
      root.position.x += 8;
      root.position.z -= 8;
      root.updateMatrixWorld(true);
      center.x += 8;
      center.z -= 8;
    }

    const maxDimension = Math.max(size.x, size.y, size.z);
    const distance = input.overview
      ? Math.min(18, Math.max(9, maxDimension * 2.2))
      : Math.min(9, Math.max(2.4, maxDimension * 1.45));
    const walk = window.__fw.scene3d.walk.state;
    walk.x = center.x + distance * 0.72;
    walk.z = center.z + distance * 0.69;
    const dx = center.x - walk.x;
    const dz = center.z - walk.z;
    const horizontal = Math.hypot(dx, dz) || 1;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.max(-0.3, Math.min(0.22, Math.atan2(center.y - (min.y + 1.65), horizontal)));
    return {
      found: true,
      file: input.file,
      object: mesh.name || '(unnamed)',
      root: root.name || '(unnamed)',
      center: center.toArray(),
      size: size.toArray(),
      camera: { x: walk.x, z: walk.z, yaw: walk.yaw, pitch: walk.pitch },
      original,
    };
  }, { ...target, overview, isolate });

  const overview = targets.find((target) => target.name === 'shed');
  poses.push(await establishPose(overview, { overview: true }));
  await page.waitForTimeout(600);
  await capture('01-maintenance-yard-overview');

  let index = 2;
  for (const target of targets) {
    const pose = await establishPose(target, { isolate: target.name === 'tractor_red' });
    poses.push(pose);
    await page.waitForTimeout(450);
    await capture(`${String(index).padStart(2, '0')}-${target.name}`);
    index += 1;
  }

  for (const tool of ['hose', 'divot', 'rake']) {
    await page.evaluate((name) => {
      const app = window.__fw;
      app.scene3d.walk.setTool(name);
      app.scene3d.walk.state.pitch = -0.12;
    }, tool);
    await page.waitForTimeout(500);
    await capture(`${String(index).padStart(2, '0')}-held-${tool}`);
    index += 1;
  }
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));

  const report = {
    capturedAt: new Date().toISOString(),
    phase,
    fixture: 'normal Continue --bootstrap boot; deterministic 1600x900 player camera; only comparison camera/tool establishment is injected',
    targets,
    poses,
    screenshots,
    diagnostics,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return {
    ok: poses.every((pose) => pose.found)
      && diagnostics.every((entry) => entry.kind === 'requestaborted' || entry.kind === 'console:warning'),
    ...report,
  };
}

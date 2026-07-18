// Fixed player-camera evidence for conditional course assets that only load
// after tractor/sign restoration. The deterministic bootstrap save is advanced
// before a normal Continue; production interaction logic is not bypassed in the
// running scene.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const phase = process.env.COURSE_PROP_QA_PHASE || 'before';
  const outDir = path.join(repo, 'qa', 'steam-performance-master-pass', 'assets', `course-props-repaired-${phase}`);
  const audit = JSON.parse(fs.readFileSync(path.join(
    repo, 'qa', 'steam-performance-master-pass', 'assets', 'runtime-model-footprint.json'
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

  const targetFiles = ['vendor/models/mower_deck.glb', 'vendor/models/course_sign.glb'];
  const targets = targetFiles.map((file) => {
    const asset = audit.assets.find((entry) => entry.file === file);
    if (!asset) throw new Error(`asset audit is missing ${file}`);
    return {
      file,
      name: path.basename(file, '.glb'),
      textureNames: asset.resources.images.map((image) => image.name),
    };
  });

  // The runner already installed its deterministic bootstrap save on this page.
  await page.evaluate(() => {
    const key = 'golfempire:autosave';
    const empire = JSON.parse(localStorage.getItem(key));
    const holding = empire.holdings.find((entry) => entry.property.id === empire.activeId)
      || empire.holdings[0];
    if (!holding?.state) throw new Error('repaired-prop QA could not find the active save state');
    holding.state.tractor = {
      steps: { cleared: true, fuel: true, belt: true },
      repaired: true,
    };
    holding.state.props = holding.state.props || {};
    holding.state.props.teeSignFixed = true;
    localStorage.setItem(key, JSON.stringify(empire));
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
    return window.__fw?.scene3d?.assetBarrier?.().idle === true;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__fw.speedIdx = 0;
    window.__fw.scene3d.walk.clearKeys?.();
  });

  const screenshots = [];
  const poses = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const pose = await page.evaluate((input) => {
      let mesh = null;
      const scene = window.__fw.scene3d.scene;
      scene.traverse((object) => {
        if (mesh || !object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some((material) => material && Object.values(material).some((value) => (
          value?.isTexture && input.textureNames.includes(value.name || value.image?.name || value.source?.data?.name)
        )))) mesh = object;
      });
      if (!mesh) return { found: false, file: input.file };
      mesh.geometry.computeBoundingBox();
      mesh.updateMatrixWorld(true);
      const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
      const size = bounds.max.clone().sub(bounds.min);
      const distance = Math.min(9, Math.max(2.8, Math.max(size.x, size.y, size.z) * 1.65));
      const walk = window.__fw.scene3d.walk.state;
      walk.x = center.x + distance * 0.72;
      walk.z = center.z + distance * 0.69;
      const dx = center.x - walk.x;
      const dz = center.z - walk.z;
      const horizontal = Math.hypot(dx, dz) || 1;
      walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      walk.pitch = Math.max(-0.3, Math.min(0.22, Math.atan2(center.y - (bounds.min.y + 1.65), horizontal)));
      return {
        found: true,
        file: input.file,
        object: mesh.name || '(unnamed)',
        center: center.toArray(),
        size: size.toArray(),
        camera: { x: walk.x, z: walk.z, yaw: walk.yaw, pitch: walk.pitch },
      };
    }, target);
    poses.push(pose);
    await page.waitForTimeout(500);
    const file = path.join(outDir, `${String(index + 1).padStart(2, '0')}-${target.name}.png`);
    await page.screenshot({ path: file });
    screenshots.push(file);
  }

  const report = {
    capturedAt: new Date().toISOString(),
    phase,
    fixture: 'deterministic --bootstrap save advanced to repaired tractor and fixed tee sign, then normal Continue at 1600x900',
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

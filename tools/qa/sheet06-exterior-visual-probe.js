async (page) => {
  // Read-only visual diagnosis for the Sheet 6 exterior. State mutations are
  // isolated to the Playwright bootstrap save and exist only to capture paired
  // presentation states; production code and the acceptance driver stay intact.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const out = path.join(
    repo,
    'qa',
    'assets_51_100_master',
    'sheet_06',
    'diagnostics',
    'exterior_visual_runtime',
  );
  fs.mkdirSync(out, { recursive: true });

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

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    if (!production) return false;
    try { await production.ready; } catch { return false; }
    return production.diagnostics?.().activationStatus === 'active';
  }, null, { timeout: 90000 });

  const fixture = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const walk = app.scene3d.walk;
    app.speedIdx = 0;
    walk.clearKeys?.();
    walk.setTool?.(null);
    walk.setSpraying?.(false);
    walk.setSoaping?.(false);
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72,
      tempLoF: 54,
      rainIn: 0,
      humidity: 0.48,
      windMph: 5,
    };
    app.state.weather.locked = true;
    app.state.shop.reno.grime.fill(0);
    for (const clutter of app.state.shop.reno.clutter || []) clutter.cleared = true;
    clubhouse.rebuildReno?.();
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    return {
      exterior: JSON.parse(JSON.stringify(app.state.shop.reno.exterior)),
      interiorOrigin: clubhouse.interior.position.toArray(),
    };
  });
  await page.waitForTimeout(900);
  await page.locator('#game').click({ position: { x: 800, y: 450 }, force: true });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const hint = document.querySelector('.shop-lockhint');
    if (hint) hint.style.visibility = 'hidden';
  });

  async function setCamera(shot) {
    await page.evaluate((camera) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const walk = app.scene3d.walk;
      const origin = clubhouse.interior.position;
      walk.clearKeys?.();
      walk.state.x = origin.x + camera.x;
      walk.state.z = origin.z + camera.z;
      walk.state.yaw = Math.atan2(-(camera.tx - camera.x), -(camera.tz - camera.z));
      walk.state.pitch = camera.pitch;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    }, shot);
    await page.waitForTimeout(650);
  }

  async function applyArchitecture(restoredByComponent) {
    const mutation = await page.evaluate(async (desired) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const restoration = await import('/src/sim/clubhouseRestoration.js');
      const production = typeof clubhouse.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse.sheet06Production;
      const beforeApplications = Number(production.diagnostics().stateApplications) || 0;
      const results = [restoration.setMainDoorState(app.state, 'closed')];
      for (const [component, restored] of Object.entries(desired)) {
        results.push(restoration.updateArchitectureComponent(app.state, component, { restored }));
      }
      if (results.some((result) => result?.ok !== true)) {
        throw new Error(`Architecture fixture mutation failed: ${JSON.stringify(results)}`);
      }
      clubhouse.rebuildReno();
      return { beforeApplications, results };
    }, restoredByComponent);
    await page.waitForFunction((prior) => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      const production = typeof clubhouse?.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse?.sheet06Production;
      return Number(production?.diagnostics?.().stateApplications) > Number(prior);
    }, mutation.beforeApplications, { timeout: 30000 });
    await page.waitForTimeout(350);
    return mutation;
  }

  const exteriorCamera = {
    id: 'iteration-05-exterior',
    x: -6.8,
    z: 17.2,
    tx: -0.8,
    tz: 5.3,
    pitch: 0.04,
  };
  await setCamera(exteriorCamera);

  const artifact = await page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const camera = app.scene3d.camera;
    const clubhouse = app.scene3d.clubhouse();
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const effectiveVisible = (object) => {
      for (let node = object; node; node = node.parent) {
        if (node.visible === false) return false;
      }
      return true;
    };
    const indexedPath = (object) => {
      const segments = [];
      for (let node = object; node; node = node.parent) {
        const index = node.parent ? node.parent.children.indexOf(node) : 0;
        segments.push(`${node.name || node.type || '(anonymous)'}[${index}]`);
      }
      return segments.reverse().join('/');
    };
    const toScreen = (vector) => {
      const p = vector.clone().project(camera);
      return {
        x: (p.x + 1) * 800,
        y: (1 - p.y) * 450,
        ndcZ: p.z,
      };
    };
    const candidates = [];
    scene.traverse((object) => {
      const materials = (Array.isArray(object.material) ? object.material : [object.material])
        .filter(Boolean);
      const matchesCobwebSignature = object.isMesh
        && object.geometry?.type === 'ShapeGeometry'
        && materials.some((material) => (
          material.type === 'MeshBasicMaterial'
          && material.color?.getHex?.() === 0xe8e8e0
          && material.transparent === true
          && Math.abs(Number(material.opacity) - 0.32) < 0.0001
          && material.depthWrite === false
        ));
      if (!matchesCobwebSignature) return;
      object.geometry.computeBoundingBox();
      const worldBounds = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
      const worldCenter = worldBounds.getCenter(object.position.clone());
      const local = worldCenter.clone().sub(clubhouse.interior.position);
      candidates.push({
        uuid: object.uuid,
        name: object.name || '',
        type: object.type,
        geometryType: object.geometry.type,
        indexedPath: indexedPath(object),
        effectivelyVisible: effectiveVisible(object),
        parentName: object.parent?.name || '',
        parentType: object.parent?.type || null,
        parentChildCount: object.parent?.children?.length ?? null,
        material: materials.map((material) => ({
          uuid: material.uuid,
          name: material.name || '',
          type: material.type,
          color: material.color?.getHexString?.() || null,
          opacity: material.opacity,
          transparent: material.transparent,
          side: material.side,
          depthWrite: material.depthWrite,
        })),
        worldBounds: {
          min: worldBounds.min.toArray(),
          max: worldBounds.max.toArray(),
        },
        localCenterFromInteriorOrigin: local.toArray(),
        screenCenter: toScreen(worldCenter),
        rotation: object.rotation.toArray().slice(0, 3),
      });
    });
    return {
      exteriorState: JSON.parse(JSON.stringify(app.state.shop.reno.exterior)),
      candidates,
    };
  });

  const artifactOnFile = path.join(out, 'artifact-cobweb-visible.png');
  await page.screenshot({ path: artifactOnFile });
  const hiddenCount = await page.evaluate(() => {
    let count = 0;
    window.__fw.scene3d.scene.traverse((object) => {
      const materials = (Array.isArray(object.material) ? object.material : [object.material])
        .filter(Boolean);
      if (object.isMesh
        && object.geometry?.type === 'ShapeGeometry'
        && materials.some((material) => material.type === 'MeshBasicMaterial'
          && material.color?.getHex?.() === 0xe8e8e0
          && Math.abs(Number(material.opacity) - 0.32) < 0.0001
          && material.depthWrite === false)) {
        object.visible = false;
        count++;
      }
    });
    return count;
  });
  await page.waitForTimeout(150);
  const artifactOffFile = path.join(out, 'artifact-cobweb-hidden-diagnostic-ab.png');
  await page.screenshot({ path: artifactOffFile });

  // Restore the diagnostic A/B toggle, then prove the intended gameplay repair
  // path clears the same two meshes and persisted exterior scalar.
  await page.evaluate(() => {
    window.__fw.scene3d.scene.traverse((object) => {
      const materials = (Array.isArray(object.material) ? object.material : [object.material])
        .filter(Boolean);
      if (object.isMesh
        && object.geometry?.type === 'ShapeGeometry'
        && materials.some((material) => material.type === 'MeshBasicMaterial'
          && material.color?.getHex?.() === 0xe8e8e0
          && Math.abs(Number(material.opacity) - 0.32) < 0.0001
          && material.depthWrite === false)) {
        object.visible = true;
      }
    });
  });
  const cobwebInteractionCamera = {
    id: 'normal-e-cobweb-cleanup',
    x: -6.1, z: 10.75, tx: -6.1, tz: 6.16, pitch: 0.08,
  };
  await setCamera(cobwebInteractionCamera);
  await page.waitForFunction(() => /Cobwebs in the porch corners/i.test(
    window.__fw?.scene3d?.walk?.getFocusLabel?.() || '',
  ), null, { timeout: 5000 });
  const cobwebLabelBeforeNormalE = await page.evaluate(
    () => window.__fw.scene3d.walk.getFocusLabel(),
  );
  await page.keyboard.press('e');
  await page.waitForFunction(() => (
    Number(window.__fw?.state?.shop?.reno?.exterior?.cobwebs) === 0
  ), null, { timeout: 5000 });
  await page.waitForTimeout(250);
  const normalCobwebCleanupEvidence = await page.evaluate(() => {
    const matches = [];
    window.__fw.scene3d.scene.traverse((object) => {
      const materials = (Array.isArray(object.material) ? object.material : [object.material])
        .filter(Boolean);
      if (object.isMesh
        && object.geometry?.type === 'ShapeGeometry'
        && materials.some((material) => material.type === 'MeshBasicMaterial'
          && material.color?.getHex?.() === 0xe8e8e0
          && Math.abs(Number(material.opacity) - 0.32) < 0.0001
          && material.depthWrite === false)) {
        let effectivelyVisible = true;
        for (let node = object; node; node = node.parent) {
          if (node.visible === false) effectivelyVisible = false;
        }
        matches.push({ visible: object.visible, effectivelyVisible });
      }
    });
    return {
      exterior: JSON.parse(JSON.stringify(window.__fw.state.shop.reno.exterior)),
      matchingCobwebMeshes: matches,
    };
  });
  await setCamera(exteriorCamera);
  const artifactClearedNormalEFile = path.join(out, 'artifact-cobweb-cleared-normal-e.png');
  await page.screenshot({ path: artifactClearedNormalEFile });

  const allRestored = {
    shell: true,
    porch: true,
    windows: true,
    panels: true,
    trim: true,
    ceiling: true,
    floor: true,
  };
  await applyArchitecture(allRestored);

  const closeCameras = [
    {
      id: 'close-a-two-window-facade',
      x: -6.0, z: 9.75, tx: -6.0, tz: 6.16, pitch: 0.04,
    },
    {
      id: 'close-b-mid-window',
      x: -4.48, z: 8.95, tx: -4.48, tz: 6.16, pitch: 0.025,
    },
    {
      id: 'close-c-entry-window-context',
      x: -3.65, z: 10.15, tx: -4.45, tz: 6.16, pitch: 0.06,
    },
    {
      id: 'close-d-west-and-mid-context',
      x: -6.1, z: 10.75, tx: -6.1, tz: 6.16, pitch: 0.08,
    },
  ];

  const captures = [];
  for (const shot of closeCameras) {
    await setCamera(shot);
    const file = path.join(out, `${shot.id}-clean.png`);
    await page.screenshot({ path: file });
    captures.push({ state: 'clean', shot, file });
  }

  // Shell exposes the aligned weather/mold overlays; trim exposes the authored
  // boarded apertures and broken fascia. Keeping windows restored makes the
  // additive nature of the boards unambiguous in the paired capture.
  const damaged = {
    shell: false,
    porch: true,
    windows: true,
    panels: true,
    trim: false,
    ceiling: true,
    floor: true,
  };
  await applyArchitecture(damaged);
  for (const shot of closeCameras) {
    await setCamera(shot);
    const file = path.join(out, `${shot.id}-damaged-shell-and-trim.png`);
    await page.screenshot({ path: file });
    captures.push({ state: 'damaged-shell-and-trim', shot, file });
  }

  const damageEvidence = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const root = production.getRoot(52);
    const camera = app.scene3d.camera;
    const effectiveVisible = (object) => {
      for (let node = object; node; node = node.parent) {
        if (node.visible === false) return false;
      }
      return true;
    };
    const rows = [];
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.computeBoundingBox?.();
      const bounds = object.geometry?.boundingBox?.clone?.().applyMatrix4(object.matrixWorld) || null;
      const center = bounds?.getCenter(object.position.clone()) || null;
      const projected = center?.clone().project(camera) || null;
      rows.push({
        name: object.name,
        parent: object.parent?.name || '',
        visible: object.visible,
        effectivelyVisible: effectiveVisible(object),
        materialNames: (Array.isArray(object.material) ? object.material : [object.material])
          .filter(Boolean).map((material) => material.name),
        localBounds: object.geometry?.boundingBox ? {
          min: object.geometry.boundingBox.min.toArray(),
          max: object.geometry.boundingBox.max.toArray(),
        } : null,
        worldBounds: bounds ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null,
        screenCenterAtLastCamera: projected ? {
          x: (projected.x + 1) * 800,
          y: (1 - projected.y) * 450,
          ndcZ: projected.z,
        } : null,
        userData: object.userData,
      });
    });
    return {
      architecture: JSON.parse(JSON.stringify(app.state.shop.reno.architecture)),
      production: production.diagnostics(),
      meshes: rows,
    };
  });

  const blockingDiagnostics = diagnostics.filter((entry) => ![
    'console:warning',
    'requestaborted',
  ].includes(entry.kind));
  const report = {
    ok: artifact.candidates.length === 2
      && hiddenCount === 2
      && normalCobwebCleanupEvidence.exterior.cobwebs === 0
      && normalCobwebCleanupEvidence.matchingCobwebMeshes.every(
        (mesh) => mesh.effectivelyVisible === false,
      )
      && damageEvidence.meshes.some((mesh) => (
        mesh.name === 'MESH_BoardedApertureDamage' && mesh.effectivelyVisible
      ))
      && blockingDiagnostics.length === 0,
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/sheet06-exterior-visual-probe.js --bootstrap',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    fixture,
    artifact: {
      conclusion: 'Legacy exterior cobweb ShapeGeometry remains visible because the visual fixture does not clear reno.exterior.cobwebs.',
      sourceOwner: 'src/render3d/clubhouse/exterior.js buildExterior(B) cobweb interaction group',
      materialOwner: 'unnamed MeshBasicMaterial created as webMat: #e8e8e0, opacity 0.32, DoubleSide, depthWrite false',
      cause: 'Iteration 5 clears reno.grime and reno.clutter but leaves reno.exterior.cobwebs=1, so buildExterior keeps its two interactive cobweb meshes visible even while architecture components are restored.',
      exactFixtureFix: 'Use the normal Cobwebs in the porch corners [E] action before retained clean exterior captures (validated camera below), or establish reno.exterior.cobwebs=0 before constructing the clubhouse. Do not suppress this legitimate gameplay repair mesh in production.',
      artifactOnFile,
      artifactOffFile,
      artifactClearedNormalEFile,
      hiddenCount,
      cobwebInteractionCamera,
      cobwebLabelBeforeNormalE,
      normalCobwebCleanupEvidence,
      ...artifact,
    },
    cameraCandidates: closeCameras,
    damageCaptureDiagnosis: {
      cause: 'Iteration 5 sets shell.restored=false but keeps trim.restored=true. The adapter therefore exposes LOD0_RoofDamage while hiding LOD0_TrimDamage, which owns MESH_BoardedApertureDamage. The runtime intentionally suppresses Asset 52 full-surface wall skins, and the wide porch canopy occludes most roof overlays, so the retained wide screenshot is nearly indistinguishable.',
      requiredState: damaged,
      recommendedCamera: closeCameras[1],
      cleanFile: path.join(out, 'close-b-mid-window-clean.png'),
      damagedFile: path.join(out, 'close-b-mid-window-damaged-shell-and-trim.png'),
      rationale: 'The complete middle-window casing stays in frame at player eye height, the clean Asset 55 glazing remains reviewable, and all three authored 145 mm weathered boards read immediately in the damaged counterpart without foliage or railing occlusion.',
    },
    captures,
    damageEvidence,
    diagnostics,
    blockingDiagnostics,
  };
  fs.writeFileSync(path.join(out, 'exterior-visual-probe.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

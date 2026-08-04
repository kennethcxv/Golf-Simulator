// Normal-control acceptance for the production landscaping library.
//
//   $env:QA_BASE_URL='http://localhost:8467/'
//   $env:VIDEO_DIR='qa/property-expansion-world-overhaul/landscaping/after/video'
//   node tools/qa/run-playwright.cjs tools/qa/landscaping-library-qa.js --bootstrap
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const outDir = path.resolve('qa/property-expansion-world-overhaul/landscaping/after');
  fs.mkdirSync(outDir, { recursive: true });

  const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.failedRequests.push({
    url: request.url(), error: request.failure()?.errorText || 'unknown',
  }));

  const waitFrames = (count = 6) => page.evaluate((requested) => new Promise((resolve) => {
    let left = requested;
    const frame = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), count);

  const performanceSample = () => page.evaluate(() => new Promise((resolve) => {
    const deltas = [];
    let prior = performance.now();
    const started = prior;
    const frame = (now) => {
      if (now > prior) deltas.push(now - prior);
      prior = now;
      if (now - started < 3000) return requestAnimationFrame(frame);
      const sorted = deltas.slice().sort((a, b) => a - b);
      const avg = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
      resolve({
        averageFps: +(1000 / avg).toFixed(2),
        p99FrameMs: +(sorted[Math.max(0, Math.floor(sorted.length * 0.99) - 1)] || 0).toFixed(3),
        worstFrameMs: +(sorted.at(-1) || 0).toFixed(3),
        renderer: { ...window.__fw.scene3d.renderer.info.memory },
        domNodes: document.getElementsByTagName('*').length,
        flora: window.__fw.scene3d.floraDiagnostics?.() || null,
      });
    };
    requestAnimationFrame(frame);
  }));

  const findObjectPoints = (type) => page.evaluate(async (objectType) => {
    const { objectPlacementOk } = await import(new URL('src/sim/courseEditor.js', document.baseURI).href);
    const THREE = await import('three');
    const app = window.__fw;
    const candidates = [];
    for (let fy = 1; fy < app.state.course.h - 1; fy += 0.35) {
      for (let fx = 1; fx < app.state.course.w - 1; fx += 0.35) {
        if (!objectPlacementOk(app.state.course, objectType, fx, fy, { scale: 1, protectPlay: true }).ok) continue;
        const x = app.scene3d.worldX(fx);
        const z = app.scene3d.worldZ(fy);
        const projected = new THREE.Vector3(x, app.scene3d.heightAt(x, z) + 0.2, z).project(app.scene3d.camera);
        if (projected.z < -1 || projected.z > 1) continue;
        const screenX = (projected.x + 1) * innerWidth / 2;
        const screenY = (1 - projected.y) * innerHeight / 2;
        if (screenX < 335 || screenX > 1350 || screenY < 100 || screenY > 795) continue;
        const score = Math.hypot(screenX - 835, screenY - 500);
        candidates.push({ x: screenX, y: screenY, fx, fy, score });
      }
    }
    return candidates.sort((a, b) => a.score - b.score).slice(0, 80);
  }, type);

  const visibleGhost = () => page.evaluate(() => {
    const meshes = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (!object.visible || !object.userData?.previewUnitScale) return;
      meshes.push({
        unitScale: object.userData.previewUnitScale,
        finalScale: object.scale.x,
        rotation: object.parent?.rotation?.y || 0,
      });
    });
    return meshes;
  });

  const ghostValidity = () => page.evaluate(() => {
    const colors = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.visible && object.userData?.isDisc) colors.push(object.material?.color?.getHex?.());
    });
    return { colors, valid: colors.includes(0x7fd66b) };
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8467/');
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.floraDiagnostics?.().ready && window.__fw?.editorUi, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.evaluate(() => {
    const weather = window.__fw.state.weather;
    weather.locked = true;
    weather.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
  });

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive());
  await page.keyboard.press('f');
  await waitFrames(16);
  const baseline = await performanceSample();

  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  const toolPanel = page.locator('.ced-tool-panel');
  const catalogText = await toolPanel.textContent();
  await page.screenshot({ path: path.join(outDir, '01-production-tree-catalog.png') });

  const search = page.getByRole('searchbox', { name: 'Search landscaping' });
  const items = [
    { type: 'cypress_a', name: 'Cypress', category: 'Trees', baseH: 14 },
    { type: 'palm_a', name: 'Palm', category: 'Trees', baseH: 12 },
    { type: 'acacia_a', name: 'Acacia', category: 'Trees', baseH: 11.5 },
    { type: 'eucalyptus_a', name: 'Eucalyptus', category: 'Trees', baseH: 16 },
    { type: 'ornamental_small_a', name: 'Small ornamental', category: 'Trees', baseH: 5 },
    { type: 'hedge_a', name: 'Hedge section', category: 'Shrubs', baseH: 1.25 },
    { type: 'groundcover_a', name: 'Groundcover', category: 'Shrubs', baseH: 0.3 },
    { type: 'flower_bed_a', name: 'Flower bed', category: 'Decor', baseH: 0.45 },
  ];
  const placed = [];
  let currentCategory = 'Trees';
  let palmPreview = null;
  let palmPoint = null;
  for (const item of items) {
    if (item.category !== currentCategory) {
      await page.getByRole('button', { name: item.category, exact: true }).click();
      currentCategory = item.category;
    }
    await search.fill(item.name);
    await page.getByRole('button', { name: new RegExp(`^${item.name}`) }).click();
    const points = await findObjectPoints(item.type);
    if (!points.length) throw new Error(`No visible legal placement found for ${item.name}.`);
    const before = await page.evaluate(() => window.__fw.state.course.objects.length);
    let accepted = null;
    for (const point of points) {
      await page.mouse.move(point.x, point.y);
      await waitFrames(3);
      const validity = await ghostValidity();
      if (!validity.valid) continue;
      const ghost = await visibleGhost();
      if (!ghost.length) continue;
      if (item.type === 'palm_a') {
        palmPreview = ghost;
        palmPoint = point;
        await page.screenshot({ path: path.join(outDir, '02-exact-palm-preview.png') });
      }
      await page.mouse.click(point.x, point.y);
      const placedOk = await page.waitForFunction(
        (count) => window.__fw.state.course.objects.length === count + 1,
        before,
        { timeout: 2500 },
      ).then(() => true).catch(() => false);
      if (placedOk) {
        accepted = { point, ghost };
        break;
      }
    }
    if (!accepted) throw new Error(`${item.name} never produced an accepted green-ghost click.`);
    await waitFrames(5);
    const object = await page.evaluate(() => ({ ...window.__fw.state.course.objects.at(-1) }));
    placed.push({ item, point: accepted.point, ghost: accepted.ghost, object });
  }

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.mouse.move(1450, 760);
  await waitFrames(14);
  await page.screenshot({ path: path.join(outDir, '03-library-placed-through-controls.png') });

  // Re-enter object placement and prove that canopy collision makes an existing
  // acacia location red and rejects the click without changing state.
  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  await page.getByRole('button', { name: 'Trees', exact: true }).click();
  await search.fill('Acacia');
  await page.getByRole('button', { name: /^Acacia/ }).click();
  const acacia = placed.find((entry) => entry.item.type === 'acacia_a');
  const countBeforeRejected = await page.evaluate(() => window.__fw.state.course.objects.length);
  await page.mouse.move(acacia.point.x, acacia.point.y);
  await waitFrames(6);
  const invalidPreview = await page.evaluate(() => {
    const disc = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.visible && object.userData?.isDisc) disc.push(object.material?.color?.getHex?.());
    });
    return disc;
  });
  await page.screenshot({ path: path.join(outDir, '04-acacia-clearance-rejection.png') });
  await page.mouse.click(acacia.point.x, acacia.point.y);
  await waitFrames(6);
  const countAfterRejected = await page.evaluate(() => window.__fw.state.course.objects.length);

  // Five undo/redo rebuilds must reuse the loaded flora resources.
  const cycleCensus = [];
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press('Control+z');
    await waitFrames(5);
    await page.keyboard.press('Control+y');
    await waitFrames(5);
    cycleCensus.push(await page.evaluate(() => ({
      count: window.__fw.state.course.objects.length,
      memory: { ...window.__fw.scene3d.renderer.info.memory },
      flora: window.__fw.scene3d.floraDiagnostics?.() || null,
    })));
  }

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.mouse.move(835, 500);
  for (let index = 0; index < 6; index += 1) {
    await page.mouse.wheel(0, -120);
    await waitFrames(2);
  }
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(835, 390, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await waitFrames(10);
  await page.screenshot({ path: path.join(outDir, '05-close-library-inspection.png') });

  await page.getByTitle('Save the course').click();
  await page.getByRole('button', { name: 'Build & save', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.ced-modal-veil'));
  const idsBeforeReload = placed.map((entry) => entry.object.id);
  await page.reload();
  const continueAfterReload = page.getByRole('button', { name: 'Continue', exact: true });
  if (await continueAfterReload.isVisible().catch(() => false)) await continueAfterReload.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.floraDiagnostics?.().ready, null, { timeout: 90000 });
  const persisted = await page.evaluate((ids) => ({
    objects: window.__fw.state.course.objects.filter((object) => ids.includes(object.id)).map((object) => ({ ...object })),
    diagnostics: window.__fw.scene3d.floraDiagnostics(),
  }), idsBeforeReload);
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive());
  await page.keyboard.press('f');
  await waitFrames(16);
  const final = await performanceSample();
  await page.getByRole('button', { name: 'Playtest', exact: true }).click();
  await page.waitForFunction(() => window.__fw.editorUi().isPlaytesting());
  await waitFrames(12);
  await page.screenshot({ path: path.join(outDir, '06-library-player-camera.png') });

  const placedTypes = new Set(placed.map((entry) => entry.object.type));
  const finalMemories = cycleCensus.map((cycle) => cycle.memory);
  const checks = {
    requestedCatalogVisible: ['Oak', 'Maple', 'Pine', 'Cedar', 'Birch', 'Cypress', 'Palm', 'Acacia', 'Eucalyptus', 'Flowering ornamental', 'Small ornamental']
      .every((name) => catalogText.includes(name)),
    allNewAssetsPlacedNormally: items.every((item) => placedTypes.has(item.type)),
    authoredExactPreviews: placed.every((entry) => entry.ghost.length > 0
      && entry.ghost.every((mesh) => Math.abs(mesh.unitScale - entry.item.baseH) < 0.01)),
    previewRotationCommitted: placed.every((entry) => Math.abs(entry.ghost[0].rotation - entry.object.rot) < 1e-6),
    palmPreviewCaptured: palmPreview?.length > 0 && palmPoint != null,
    collisionPreviewRed: invalidPreview.includes(0xd84b3a),
    collisionRejected: countAfterRejected === countBeforeRejected,
    lifecycleCountStable: cycleCensus.every((cycle) => cycle.count === countBeforeRejected),
    lifecycleResourcesStable: finalMemories.every((memory) => memory.geometries === finalMemories[0].geometries
      && memory.textures === finalMemories[0].textures),
    saveReloadPreserved: persisted.objects.length === items.length
      && items.every((item) => persisted.objects.some((object) => object.type === item.type)),
    threeTierLodActive: persisted.diagnostics.mode === 'dynamic-near-medium-far'
      && ['hero', 'medium', 'far'].some((tier) => persisted.diagnostics.tiers[tier] > 0),
    weatherResponsiveWindActive: persisted.diagnostics.windMaterials >= 15,
    performanceAcceptable: final.averageFps >= 30
      && (final.averageFps >= 60 || final.averageFps >= baseline.averageFps * 0.75)
      && final.p99FrameMs <= 80,
    rendererGrowthBounded: final.renderer.geometries <= baseline.renderer.geometries + 24
      && final.renderer.textures <= baseline.renderer.textures + 2,
    consoleErrorsClean: diagnostics.consoleErrors.length === 0,
    pageErrorsClean: diagnostics.pageErrors.length === 0,
    requestFailuresClean: diagnostics.failedRequests.length === 0,
  };
  const result = {
    ok: Object.values(checks).every(Boolean),
    checks,
    placed: placed.map(({ item, point, ghost, object }) => ({ item, point, ghost, object })),
    invalidPreview,
    counts: { beforeRejected: countBeforeRejected, afterRejected: countAfterRejected },
    lifecycle: cycleCensus,
    persistence: persisted,
    performance: { baseline, final },
    diagnostics,
    screenshots: [
      '01-production-tree-catalog.png',
      '02-exact-palm-preview.png',
      '03-library-placed-through-controls.png',
      '04-acacia-clearance-rejection.png',
      '05-close-library-inspection.png',
      '06-library-player-camera.png',
    ],
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

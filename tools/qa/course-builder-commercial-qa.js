// Normal-control QA for the commercial course-builder increment.
//
//   $env:QA_BASE_URL='http://localhost:8467/'
//   $env:VIDEO_DIR='qa/property-expansion-world-overhaul/course-builder/after/video'
//   node tools/qa/run-playwright.cjs tools/qa/course-builder-commercial-qa.js --bootstrap
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const outDir = path.resolve('qa/property-expansion-world-overhaul/course-builder/after');
  fs.mkdirSync(outDir, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => diagnostics.push(
    `requestfailed:${request.url()}:${request.failure()?.errorText || 'unknown'}`,
  ));

  const waitFrames = (count = 4) => page.evaluate((requested) => new Promise((resolve) => {
    let left = requested;
    function frame() {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }), count);
  const samplePerformance = () => page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    let previous = window.performance.now();
    const started = previous;
    function frame(now) {
      samples.push(now - previous);
      previous = now;
      if (now - started < 3000) return requestAnimationFrame(frame);
      const sorted = [...samples].sort((a, b) => a - b);
      const total = samples.reduce((sum, value) => sum + value, 0);
      resolve({
        averageFps: samples.length * 1000 / total,
        p99FrameMs: sorted[Math.max(0, Math.floor(sorted.length * 0.99) - 1)],
        worstFrameMs: Math.max(...samples),
        renderer: { ...window.__fw.scene3d.renderer.info.memory },
        dom: document.getElementsByTagName('*').length,
      });
    }
    requestAnimationFrame(frame);
  }));

  const projectedHolePoint = (ratio) => page.evaluate(async (t) => {
    const THREE = await import('three');
    const app = window.__fw;
    const hole = app.state.course.holes.find((candidate) => candidate.tee && candidate.pin);
    const fx = hole.tee.x + (hole.pin.x - hole.tee.x) * t;
    const fy = hole.tee.y + (hole.pin.y - hole.tee.y) * t;
    const x = app.scene3d.worldX(fx);
    const z = app.scene3d.worldZ(fy);
    const projected = new THREE.Vector3(x, app.scene3d.heightAt(x, z) + 0.2, z)
      .project(app.scene3d.camera);
    return {
      x: (projected.x + 1) * innerWidth / 2,
      y: (1 - projected.y) * innerHeight / 2,
      fx,
      fy,
    };
  }, ratio);

  const findObjectPoint = (type) => page.evaluate(async (objectType) => {
    const { objectPlacementOk } = await import('/src/sim/courseEditor.js');
    const THREE = await import('three');
    const app = window.__fw;
    let best = null;
    for (let fy = 1; fy < app.state.course.h - 1; fy += 0.5) {
      for (let fx = 1; fx < app.state.course.w - 1; fx += 0.5) {
        if (!objectPlacementOk(app.state.course, objectType, fx, fy, {
          scale: 1, protectPlay: true,
        }).ok) continue;
        const x = app.scene3d.worldX(fx);
        const z = app.scene3d.worldZ(fy);
        const projected = new THREE.Vector3(x, app.scene3d.heightAt(x, z) + 0.2, z)
          .project(app.scene3d.camera);
        if (projected.z < -1 || projected.z > 1) continue;
        const screenX = (projected.x + 1) * innerWidth / 2;
        const screenY = (1 - projected.y) * innerHeight / 2;
        if (screenX < 330 || screenX > 1340 || screenY < 110 || screenY > 800) continue;
        const score = Math.hypot(screenX - 820, screenY - 500);
        if (!best || score < best.score) best = { x: screenX, y: screenY, fx, fy, score };
      }
    }
    return best;
  }, type);

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8467/');
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
  await page.waitForFunction(() => window.__fw?.scene3d && window.__fw?.editorUi, null, { timeout: 45000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 45000 });
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 15000 });
  await page.keyboard.press('f');
  await waitFrames(12);
  const baseline = await samplePerformance();

  await page.getByRole('button', { name: 'Terrain', exact: true }).click();
  await page.getByRole('button', { name: /Slope/, exact: false }).click();
  const terrainPoint = await projectedHolePoint(0.12);
  if (!terrainPoint || terrainPoint.x < 300 || terrainPoint.y < 90) {
    throw new Error('Selected-hole terrain point is not reachable through the canvas.');
  }
  await page.mouse.move(terrainPoint.x, terrainPoint.y);
  await page.mouse.down();
  await page.mouse.move(terrainPoint.x + 52, terrainPoint.y + 12, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const panel = document.querySelector('.ced-impact');
    return panel && getComputedStyle(panel).display !== 'none' && /CONSTRUCTION IMPACT/.test(panel.textContent);
  });
  const terrainImpact = await page.evaluate(async () => {
    const { constructionImpact } = await import('/src/sim/courseEditor.js');
    const app = window.__fw;
    return {
      panel: document.querySelector('.ced-impact')?.textContent || '',
      impact: constructionImpact(app.state, app.editorUi().session()),
    };
  });
  await page.screenshot({ path: path.join(outDir, '01-slope-and-construction-impact.png') });
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.ced-impact')).display === 'none');

  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search landscaping' });
  await search.fill('oak');
  await page.getByRole('button', { name: /^Oak/ }).click();
  const objectPoint = await findObjectPoint('oak_a');
  if (!objectPoint) throw new Error('No visible legal Oak placement was found.');
  const objectsBefore = await page.evaluate(() => window.__fw.state.course.objects.length);
  await page.mouse.move(objectPoint.x, objectPoint.y);
  await waitFrames(6);
  const preview = await page.evaluate(() => {
    const meshes = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.visible && object.userData?.previewUnitScale) meshes.push({
        scale: object.scale.x,
        unitScale: object.userData.previewUnitScale,
        parentRotation: object.parent?.rotation?.y || 0,
      });
    });
    return {
      meshes,
      panel: document.querySelector('.ced-tool-panel')?.textContent || '',
      renderer: { ...window.__fw.scene3d.renderer.info.memory },
    };
  });
  await page.screenshot({ path: path.join(outDir, '02-exact-oak-preview-and-search.png') });
  await page.mouse.click(objectPoint.x, objectPoint.y);
  await page.waitForFunction((count) => window.__fw.state.course.objects.length === count + 1, objectsBefore);
  const placed = await page.evaluate(() => {
    const object = window.__fw.state.course.objects.at(-1);
    return { ...object };
  });
  await waitFrames(10);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.mouse.move(1450, 760);
  await waitFrames(6);
  await page.screenshot({ path: path.join(outDir, '03-oak-placed-through-controls.png') });
  await page.keyboard.press('Control+z');
  await page.waitForFunction((count) => window.__fw.state.course.objects.length === count, objectsBefore);

  const finalPerformance = await samplePerformance();
  const checks = {
    terrainModesVisible: terrainImpact.panel.includes('CONSTRUCTION IMPACT'),
    slopeWasCosted: terrainImpact.impact.pendingCost > 0 && terrainImpact.impact.changedCells > 0,
    closureImpactEstimated: terrainImpact.impact.holesAffected > 0
      && terrainImpact.impact.maxConstructionDays > 0,
    searchFilteredOak: /Oak/.test(preview.panel) && !/Shade tree/.test(preview.panel),
    priceAndClearanceVisible: /roots 2\.2 yd/.test(preview.panel) && /canopy 6\.3 yd/.test(preview.panel) && /\$/.test(preview.panel),
    authoredPreviewPresent: preview.meshes.length > 0
      && preview.meshes.every((mesh) => mesh.unitScale > 10),
    exactPreviewRotationCommitted: Math.abs(preview.meshes[0].parentRotation - placed.rot) < 1e-6,
    placedAndUndoRestored: placed.type === 'oak_a',
    consoleErrorsClean: diagnostics.length === 0,
    performanceAcceptable: finalPerformance.averageFps >= 30
      && finalPerformance.averageFps >= baseline.averageFps * 0.65
      && finalPerformance.p99FrameMs <= 80,
    rendererGrowthBounded: finalPerformance.renderer.geometries <= baseline.renderer.geometries + 4
      && finalPerformance.renderer.textures <= baseline.renderer.textures + 2,
    // The Objects panel intentionally contains the search field, five category
    // buttons, item cards, pricing, and clearance copy that the Select panel
    // does not. Bound that authored chrome rather than calling it a leak.
    domGrowthBounded: finalPerformance.dom <= baseline.dom + 60,
  };
  const result = {
    ok: Object.values(checks).every(Boolean),
    checks,
    terrainImpact,
    preview,
    placed,
    performance: { baseline, final: finalPerformance },
    diagnostics,
    screenshots: [
      '01-slope-and-construction-impact.png',
      '02-exact-oak-preview-and-search.png',
      '03-oak-placed-through-controls.png',
    ],
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

// Course Editor live-preview acceptance through visible controls.
//
//   $env:COURSE_QA_PHASE='editor_preview_iteration_01'
//   $env:QA_RESULT_PATH='qa/course_master_final/editor_preview_iteration_01/result.json'
//   $env:VIDEO_DIR='qa/course_master_final/editor_preview_iteration_01/video'
//   $env:HEADED='1'
//   node tools/qa/run-playwright.cjs tools/qa/course-editor-preview-qa.js --bootstrap
async (page) => {
  const phase = process.env.COURSE_QA_PHASE || 'editor_preview';
  const outDir = `qa/course_master_final/${phase}`;
  const diagnostics = { console: [], pageErrors: [], failedRequests: [] };
  let qaDocumentCommitted = false;

  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.console.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    if (qaDocumentCommitted) diagnostics.failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText || 'unknown',
    });
  });

  const waitFrames = (count = 4) => page.evaluate((frameCount) => new Promise((resolve) => {
    let left = frameCount;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), count);

  const screenshot = async (name) => {
    const path = `${outDir}/${name}.png`;
    await page.screenshot({ path, fullPage: false });
    return path;
  };

  const tool = async (name) => {
    await page.getByRole('button', { name, exact: true }).click();
    await waitFrames(3);
  };

  const setRangeRatio = async (label, ratio) => {
    const row = page.locator('.ced-tool-panel .ced-row').filter({ hasText: label }).first();
    const input = row.locator('input[type="range"]');
    const box = await input.boundingBox();
    if (!box) throw new Error(`Range not visible: ${label}`);
    await page.mouse.click(box.x + Math.max(3, Math.min(box.width - 3, box.width * ratio)), box.y + box.height / 2);
    await waitFrames(2);
    return Number(await input.inputValue());
  };

  const findPlacement = (feature, options = {}) => page.evaluate(async ({ featureName, featureOptions }) => {
    const { featurePlacementOk } = await import('/src/sim/courseEditor.js');
    const THREE = await import('three');
    const app = window.__fw;
    const scene = app.scene3d;
    const hole = app.state.course.holes[0];
    const width = innerWidth;
    const height = innerHeight;
    let best = null;
    for (let fy = 1; fy < app.state.course.h - 1; fy += 1) {
      for (let fx = 1; fx < app.state.course.w - 1; fx += 1) {
        let candidate = { ...featureOptions };
        if (featureName === 'tee') {
          const pin = hole.pin || { x: fx + 4, y: fy };
          const base = Math.atan2(pin.y - fy, pin.x - fx);
          const angle = base + ((candidate.rotationDeg || 0) * Math.PI) / 180;
          candidate = {
            holeId: hole.id,
            aimX: fx + Math.cos(angle) * 4,
            aimY: fy + Math.sin(angle) * 4,
          };
        }
        const legal = featurePlacementOk(app.state.course, featureName, fx, fy, candidate);
        if (!legal.ok) continue;
        const worldX = scene.worldX(fx);
        const worldZ = scene.worldZ(fy);
        const projected = new THREE.Vector3(
          worldX,
          scene.heightAt(worldX, worldZ) + 0.2,
          worldZ,
        ).project(scene.camera);
        if (projected.z < -1 || projected.z > 1) continue;
        const x = (projected.x + 1) * width / 2;
        const y = (1 - projected.y) * height / 2;
        if (x < 330 || x > 1340 || y < 110 || y > 800) continue;
        const score = Math.hypot(x - 850, y - 475);
        if (!best || score < best.score) best = { x, y, fx, fy, score };
      }
    }
    return best;
  }, { featureName: feature, featureOptions: options });

  const findZone = (zoneKey) => page.evaluate(async (key) => {
    const { ZONE } = await import('/src/sim/constants.js');
    const THREE = await import('three');
    const scene = window.__fw.scene3d;
    const course = window.__fw.state.course;
    const hole = course.holes[0];
    const vector = course.vec?.holes?.find((candidate) => candidate.id === hole.vecId);
    const cell = key === 'GREEN'
      ? (vector?.green ? { x: vector.green.cx, y: vector.green.cy } : hole.pin)
      : hole.pin;
    if (!cell) return null;
    const worldX = scene.worldX(cell.x);
    const worldZ = scene.worldZ(cell.y);
    if (scene.zoneAtWorld(worldX, worldZ) !== ZONE[key]) return null;
    const projected = new THREE.Vector3(
      worldX,
      scene.heightAt(worldX, worldZ) + 0.2,
      worldZ,
    ).project(scene.camera);
    return {
      x: (projected.x + 1) * innerWidth / 2,
      y: (1 - projected.y) * innerHeight / 2,
      fx: cell.x,
      fy: cell.y,
    };
  }, zoneKey);

  const readFeaturePreview = () => page.evaluate(() => {
    const scene = window.__fw.scene3d.scene;
    const group = scene.getObjectByName('editor-feature-preview');
    const fill = scene.getObjectByName('editor-feature-preview-fill');
    const outline = scene.getObjectByName('editor-feature-preview-outline');
    const guide = scene.getObjectByName('editor-feature-preview-guide');
    return {
      visible: !!group?.visible,
      color: fill?.material?.color?.getHex?.() ?? null,
      fillVertices: fill?.geometry?.drawRange?.count ?? 0,
      outlineVertices: outline?.geometry?.drawRange?.count ?? 0,
      guideVertices: guide?.geometry?.drawRange?.count ?? 0,
      rendererGeometries: window.__fw.scene3d.renderer.info.memory.geometries,
    };
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  qaDocumentCommitted = true;
  await page.goto('http://localhost:8457/');
  await page.waitForFunction(() => document.readyState === 'complete');
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  await continueButton.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Continue');
    return button && !button.disabled;
  }, null, { timeout: 90000 });
  await continueButton.click();
  await page.waitForFunction(() => window.__fw?.state?.course?.vec && window.__fw?.scene3d && window.__fw?.editorUi?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive());
  await page.locator('.ced-root').waitFor({ state: 'visible' });
  await page.keyboard.press('f');
  await waitFrames(10);

  const evidence = {};

  await tool('Terrain');
  const terrainPoint = await findPlacement('green', { r: 1.2, elong: 1 });
  if (!terrainPoint) throw new Error('Could not find visible open terrain for brush evidence.');
  await page.mouse.move(terrainPoint.x, terrainPoint.y);
  await waitFrames(3);
  evidence.terrain = {
    screenshot: await screenshot('01_terrain_falloff'),
    rings: await page.evaluate(() => ({
      outer: !!window.__fw.scene3d.scene.getObjectByName('editor-brush-ring')?.visible,
      falloff: !!window.__fw.scene3d.scene.getObjectByName('editor-brush-falloff-ring')?.visible,
    })),
  };

  await tool('Tee');
  const teeRotation = await setRangeRatio('Rotate', 0.76);
  const teePoint = await findPlacement('tee', { rotationDeg: teeRotation });
  if (!teePoint) throw new Error('Could not find a legal tee preview point.');
  await page.mouse.move(teePoint.x, teePoint.y);
  await waitFrames(3);
  evidence.tee = {
    rotationDeg: teeRotation,
    preview: await readFeaturePreview(),
    screenshot: await screenshot('02_tee_rotated_aim_preview'),
  };

  await tool('Green');
  await page.getByRole('button', { name: 'Kidney', exact: true }).click();
  const greenRotation = await setRangeRatio('Rotate', 0.31);
  const greenPoint = await findPlacement('green', {
    r: 30 / 16, elong: 1.35, angle: greenRotation * Math.PI / 180, kidney: true,
  });
  if (!greenPoint) throw new Error('Could not find a legal green preview point.');
  await page.mouse.move(greenPoint.x, greenPoint.y);
  await waitFrames(3);
  evidence.green = {
    rotationDeg: greenRotation,
    preview: await readFeaturePreview(),
    screenshot: await screenshot('03_green_kidney_preview'),
  };

  await tool('Bunker');
  await page.getByRole('button', { name: 'Oval', exact: true }).click();
  const bunkerRotation = await setRangeRatio('Rotate', 0.64);
  const bunkerPoint = await findPlacement('bunker', {
    r: 14 / 16, lobes: 2, stretch: 1.45, angle: bunkerRotation * Math.PI / 180,
  });
  if (!bunkerPoint) throw new Error('Could not find a legal bunker preview point.');
  await page.mouse.move(bunkerPoint.x, bunkerPoint.y);
  await waitFrames(3);
  evidence.bunker = {
    rotationDeg: bunkerRotation,
    preview: await readFeaturePreview(),
    screenshot: await screenshot('04_bunker_oval_preview'),
  };

  await tool('Water');
  await page.getByRole('button', { name: 'Lake', exact: true }).click();
  const waterRotation = await setRangeRatio('Rotate', 0.36);
  const waterPoint = await findPlacement('water', {
    r: (36 / 16) * 1.6, elong: 1.4, angle: waterRotation * Math.PI / 180,
  });
  if (!waterPoint) throw new Error('Could not find a legal water preview point.');
  await page.mouse.move(waterPoint.x, waterPoint.y);
  await waitFrames(3);
  evidence.water = {
    rotationDeg: waterRotation,
    preview: await readFeaturePreview(),
    screenshot: await screenshot('05_water_lake_preview'),
  };

  await page.locator('.ced-camera').selectOption('green');
  await waitFrames(10);
  const invalidPoint = await findZone('GREEN');
  if (!invalidPoint) throw new Error('Could not find the selected green for invalid-placement evidence.');
  await page.mouse.move(invalidPoint.x, invalidPoint.y);
  await waitFrames(3);
  evidence.invalid = {
    preview: await readFeaturePreview(),
    screenshot: await screenshot('06_invalid_water_over_green'),
  };

  // The preview hot path must keep renderer geometry memory flat under sustained
  // real mouse movement. Frame cadence is sampled over the same interaction.
  await page.evaluate(() => {
    window.__editorPreviewFrameProbe = { frames: 0, deltas: [], last: performance.now(), active: true };
    const tick = (now) => {
      const probe = window.__editorPreviewFrameProbe;
      if (!probe?.active) return;
      probe.frames += 1;
      probe.deltas.push(now - probe.last);
      probe.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const memoryBefore = (await readFeaturePreview()).rendererGeometries;
  for (let index = 0; index < 240; index += 1) {
    const x = 360 + (index % 40) * 23;
    const y = 190 + (Math.floor(index / 40) % 6) * 90;
    await page.mouse.move(x, y);
  }
  await waitFrames(8);
  const memoryAfter = (await readFeaturePreview()).rendererGeometries;
  const frameProbe = await page.evaluate(() => {
    const probe = window.__editorPreviewFrameProbe;
    probe.active = false;
    const durationMs = probe.deltas.reduce((sum, value) => sum + value, 0);
    return {
      frames: probe.frames,
      durationMs,
      averageFps: durationMs > 0 ? probe.frames * 1000 / durationMs : 0,
      worstFrameMs: Math.max(...probe.deltas),
    };
  });
  evidence.pointerStress = {
    moves: 240,
    memoryBefore,
    memoryAfter,
    geometryDelta: memoryAfter - memoryBefore,
    averageFps: +frameProbe.averageFps.toFixed(2),
    worstFrameMs: +frameProbe.worstFrameMs.toFixed(2),
  };

  await tool('Select');
  const cleared = await readFeaturePreview();
  evidence.clearedOnToolSwitch = !cleared.visible;

  await page.evaluate(() => {
    window.__editorPreviewControlProbe = { frames: 0, deltas: [], last: performance.now(), active: true };
    const tick = (now) => {
      const probe = window.__editorPreviewControlProbe;
      if (!probe?.active) return;
      probe.frames += 1;
      probe.deltas.push(now - probe.last);
      probe.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const controlMemoryBefore = (await readFeaturePreview()).rendererGeometries;
  for (let index = 0; index < 240; index += 1) {
    const x = 360 + (index % 40) * 23;
    const y = 190 + (Math.floor(index / 40) % 6) * 90;
    await page.mouse.move(x, y);
  }
  await waitFrames(8);
  const controlMemoryAfter = (await readFeaturePreview()).rendererGeometries;
  const controlProbe = await page.evaluate(() => {
    const probe = window.__editorPreviewControlProbe;
    probe.active = false;
    const durationMs = probe.deltas.reduce((sum, value) => sum + value, 0);
    return {
      frames: probe.frames,
      durationMs,
      averageFps: durationMs > 0 ? probe.frames * 1000 / durationMs : 0,
      worstFrameMs: Math.max(...probe.deltas),
    };
  });
  evidence.controlPointerStress = {
    tool: 'Select',
    moves: 240,
    memoryBefore: controlMemoryBefore,
    memoryAfter: controlMemoryAfter,
    geometryDelta: controlMemoryAfter - controlMemoryBefore,
    averageFps: +controlProbe.averageFps.toFixed(2),
    worstFrameMs: +controlProbe.worstFrameMs.toFixed(2),
  };
  evidence.pointerStress.fpsVsControl = +(
    evidence.pointerStress.averageFps / Math.max(0.01, evidence.controlPointerStress.averageFps)
  ).toFixed(3);

  const validColor = 0x7fd66b;
  const invalidColor = 0xd84b3a;
  const shaped = [evidence.tee, evidence.green, evidence.bunker, evidence.water];
  const checks = {
    terrainRingsVisible: evidence.terrain.rings.outer && evidence.terrain.rings.falloff,
    validShapesVisible: shaped.every((item) => item.preview.visible
      && item.preview.color === validColor
      && item.preview.fillVertices > 0
      && item.preview.outlineVertices > 0),
    teeAimVisible: evidence.tee.preview.guideVertices > 1,
    invalidRedVisible: evidence.invalid.preview.visible
      && evidence.invalid.preview.color === invalidColor,
    geometryMemoryStable: evidence.pointerStress.geometryDelta === 0,
    previewStressWithinControl: evidence.pointerStress.fpsVsControl >= 0.85,
    clearedOnToolSwitch: evidence.clearedOnToolSwitch,
    consoleClean: diagnostics.console.length === 0,
    pageErrorsClean: diagnostics.pageErrors.length === 0,
    requestsClean: diagnostics.failedRequests.length === 0,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    phase,
    fixture: 'runner --bootstrap, relaxed empire seed 424242, first property',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    browser: await page.evaluate(() => navigator.userAgent),
    checks,
    evidence,
    diagnostics,
  };
}

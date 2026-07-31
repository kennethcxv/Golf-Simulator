// Runtime audit for the Course Editor's utility controls and transaction shell.
// The first mutation sweep is made through visible controls and discarded
// exactly. A final small edit is then built, saved, and reloaded.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const phase = String(process.env.COURSE_EDITOR_QA_PHASE || 'course-editor-utility-controls')
    .replace(/[^a-z0-9._-]+/gi, '_');
  const outDir = path.join(repo, 'qa', 'course_master_final', phase);
  const canonicalResultPath = path.join(outDir, 'result.json');
  const configuredResultPath = process.env.QA_RESULT_PATH
    ? path.resolve(process.env.QA_RESULT_PATH)
    : canonicalResultPath;
  const videoDirectory = process.env.VIDEO_DIR
    ? path.resolve(process.env.VIDEO_DIR)
    : path.join(outDir, 'video');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(videoDirectory, { recursive: true });

  const startedAt = new Date().toISOString();
  const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [] };
  const checkpoints = [];
  const captures = [];
  const actionTimings = [];
  const runtimeActions = [];
  let sequence = 0;
  let expectedNavigation = true;

  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'unknown';
    if (expectedNavigation && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(error)) return;
    diagnostics.requestFailures.push({ url: request.url(), error });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) diagnostics.httpErrors.push({ url: response.url(), status: response.status() });
  });

  const waitFrames = (count = 4) => page.evaluate((frames) => new Promise((resolve) => {
    let remaining = frames;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), count);
  const settle = async (frames = 5) => {
    await waitFrames(frames);
    await page.waitForTimeout(80);
  };
  const requireTruth = (condition, message, evidence = null) => {
    if (condition) return;
    const error = new Error(message);
    error.evidence = evidence;
    throw error;
  };
  const measureAction = async (label, action) => {
    const started = Date.now();
    const value = await action();
    actionTimings.push({ label, durationMs: Date.now() - started });
    return value;
  };
  const measureRuntimeAction = async (label, action, settleFrames = 10) => {
    await page.evaluate(() => {
      window.__courseUtilityFrameProbe = { running: true, last: performance.now(), deltas: [] };
      const tick = (now) => {
        const probe = window.__courseUtilityFrameProbe;
        if (!probe?.running) return;
        const delta = now - probe.last;
        probe.last = now;
        if (delta > 0) probe.deltas.push(delta);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const rendererBefore = await page.evaluate(
      () => window.__fw.scene3d.editorPerformanceSnapshot?.() || {},
    );
    const started = Date.now();
    const value = await action();
    await waitFrames(settleFrames);
    await page.waitForFunction(
      () => !window.__fw.editorUi?.()?.qa?.refreshBusy?.(),
      null,
      { timeout: 15000 },
    );
    await waitFrames(2);
    const result = await page.evaluate(() => {
      const probe = window.__courseUtilityFrameProbe;
      probe.running = false;
      const ordered = probe.deltas.slice().sort((left, right) => left - right);
      const mean = probe.deltas.reduce((sum, entry) => sum + entry, 0) / Math.max(1, probe.deltas.length);
      return {
        frames: probe.deltas.length,
        averageFps: +(1000 / Math.max(0.001, mean)).toFixed(2),
        worstFrameMs: +(ordered.at(-1) || 0).toFixed(2),
        framesOver100ms: probe.deltas.filter((entry) => entry > 100).length,
        rawFrameDeltasMs: probe.deltas.map((entry) => +entry.toFixed(2)),
      };
    });
    result.label = label;
    result.durationMs = Date.now() - started;
    const rendererAfter = await page.evaluate(
      () => window.__fw.scene3d.editorPerformanceSnapshot?.() || {},
    );
    result.rendererCosts = {};
    for (const [key, after] of Object.entries(rendererAfter)) {
      const before = rendererBefore[key] || {};
      const calls = (after.calls || 0) - (before.calls || 0);
      if (calls <= 0) continue;
      const totalMs = (after.totalMs || 0) - (before.totalMs || 0);
      result.rendererCosts[key] = {
        calls,
        totalMs: +totalMs.toFixed(3),
        averageMs: +(totalMs / calls).toFixed(3),
        units: (after.units || 0) - (before.units || 0),
        lastMs: after.lastMs || 0,
      };
    }
    runtimeActions.push(result);
    actionTimings.push({ label, durationMs: result.durationMs });
    return { value, performance: result };
  };
  const capture = async (name, description) => {
    sequence += 1;
    const filePath = path.join(outDir, `${String(sequence).padStart(2, '0')}_${name}.png`);
    await page.screenshot({ path: filePath });
    const record = { name, description, path: filePath };
    captures.push(record);
    return record;
  };
  const checkpoint = async (name, action) => {
    const started = Date.now();
    const record = { name, ok: false, durationMs: 0 };
    try {
      record.evidence = await action();
      record.ok = true;
    } catch (error) {
      record.error = error?.message || String(error);
      if (error?.evidence !== undefined) record.evidence = error.evidence;
      try {
        record.screenshot = (await capture(`failure_${checkpoints.length + 1}`, record.error)).path;
      } catch { /* preserve the primary failure */ }
    }
    record.durationMs = Date.now() - started;
    checkpoints.push(record);
    return record;
  };
  const writeResult = (result) => {
    const body = `${JSON.stringify(result, null, 2)}\n`;
    fs.writeFileSync(canonicalResultPath, body);
    if (path.resolve(configuredResultPath) !== path.resolve(canonicalResultPath)) {
      fs.mkdirSync(path.dirname(configuredResultPath), { recursive: true });
      fs.writeFileSync(configuredResultPath, body);
    }
  };
  const toolButton = (label) => page.locator('.ced-tool').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
  const useTool = async (label) => {
    const button = toolButton(label);
    await button.click();
    await settle(3);
    return button;
  };
  const fingerprint = () => page.evaluate(() => {
    const hashBytes = (bytes) => {
      let hash = 2166136261;
      for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
      return hash >>> 0;
    };
    const hashValues = (values) => {
      if (!values) return { length: 0, hash: 0 };
      let bytes;
      if (ArrayBuffer.isView(values)) {
        bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
      } else {
        bytes = new Uint8Array(new Float64Array(Array.from(values)).buffer);
      }
      return { length: values.length, hash: hashBytes(bytes) };
    };
    const hashText = (text) => {
      let hash = 2166136261;
      for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
      return hash >>> 0;
    };
    const app = window.__fw;
    const course = app.state.course;
    const core = JSON.stringify({
      clubName: app.state.clubName,
      cash: app.state.cash,
      sections: app.state.sections,
      w: course.w,
      h: course.h,
      holes: course.holes,
      nextHoleId: course.nextHoleId,
      objects: course.objects,
      nextObjectId: course.nextObjectId,
      paths: course.paths,
      nextPathId: course.nextPathId,
      structures: course.structures,
      vec: course.vec,
    });
    return {
      core: { length: core.length, hash: hashText(core) },
      identity: {
        nextHoleId: course.nextHoleId,
        nextObjectId: course.nextObjectId,
        nextPathId: course.nextPathId,
        nextVectorId: course.vec?.nextId ?? null,
      },
      structuralHashes: {
        holes: hashText(JSON.stringify(course.holes)),
        sections: hashText(JSON.stringify(app.state.sections)),
        objects: hashText(JSON.stringify(course.objects)),
        paths: hashText(JSON.stringify(course.paths)),
        vectors: hashText(JSON.stringify(course.vec)),
      },
      zones: hashValues(course.zones),
      elevation: hashValues(course.elevation),
      paint: hashValues(course.paint),
      holeCount: course.holes.length,
      objectCount: course.objects.length,
      pathCount: course.paths.length,
    };
  });
  const groundPoints = () => page.evaluate(() => {
    const scene = window.__fw.scene3d;
    const course = window.__fw.state.course;
    const rect = scene.renderer.domElement.getBoundingClientRect();
    const candidates = [];
    for (let y = Math.max(rect.top + 150, 170); y < Math.min(rect.bottom - 90, 790); y += 45) {
      for (let x = Math.max(rect.left + 410, 420); x < Math.min(rect.right - 70, 1510); x += 55) {
        const hit = scene.raycastGround(x, y);
        if (!hit || hit.fx < 1 || hit.fy < 1 || hit.fx >= course.w - 1 || hit.fy >= course.h - 1) continue;
        candidates.push({ x, y, fx: hit.fx, fy: hit.fy });
      }
    }
    if (!candidates.length) return [];
    const first = candidates[Math.floor(candidates.length * 0.34)];
    const second = candidates.find((candidate) => Math.hypot(candidate.x - first.x, candidate.y - first.y) > 180)
      || candidates.at(-1);
    const third = candidates.find((candidate) => Math.hypot(candidate.x - second.x, candidate.y - second.y) > 150)
      || candidates[0];
    return [first, second, third];
  });
  const selectHoleByIndex = async (index) => {
    await page.locator('.ced-holechip').click();
    const modal = page.locator('.ced-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    const cards = modal.locator('.ced-holecard:not(.add)');
    requireTruth(await cards.count() > index, `Hole card ${index + 1} is unavailable.`);
    await cards.nth(index).click();
    await modal.getByRole('button', { name: 'Frame it', exact: true }).click();
    await settle(12);
    return page.evaluate((holeIndex) => {
      const hole = window.__fw.state.course.holes[holeIndex];
      return hole ? { id: hole.id, name: hole.name, index: holeIndex } : null;
    }, index);
  };
  const featureCandidate = (feature, options = {}, avoid = []) => page.evaluate(
    async ({ featureKind, placementOptions, avoided }) => {
      const { featurePlacementOk } = await import('/src/sim/courseEditor.js');
      const app = window.__fw;
      const course = app.state.course;
      const scene = app.scene3d;
      const rect = scene.renderer.domElement.getBoundingClientRect();
      const candidates = [];
      for (let screenY = Math.max(rect.top + 145, 165); screenY <= Math.min(rect.bottom - 70, 800); screenY += 28) {
        for (let screenX = Math.max(rect.left + 390, 410); screenX <= rect.right - 55; screenX += 34) {
          const hit = scene.raycastGround(screenX, screenY);
          if (!hit?.inBounds) continue;
          const point = { x: hit.fx + (course.vec ? 0.5 : 0), y: hit.fy + (course.vec ? 0.5 : 0) };
          if (avoided.some((entry) => Math.hypot(point.x - entry.x, point.y - entry.y) < (entry.radius || 5))) continue;
          const exactOptions = { ...placementOptions };
          if (featureKind === 'tee') {
            const hole = course.holes.find((entry) => entry.id === placementOptions.holeId);
            if (!hole) continue;
            const markerOffset = course.vec ? 0.5 : 0;
            const pin = hole.pin
              ? { x: hole.pin.x + markerOffset, y: hole.pin.y + markerOffset }
              : { x: point.x + 4, y: point.y };
            const angle = Math.atan2(pin.y - point.y, pin.x - point.x);
            exactOptions.aimX = point.x + Math.cos(angle) * 4;
            exactOptions.aimY = point.y + Math.sin(angle) * 4;
          }
          const legal = featurePlacementOk(course, featureKind, point.x, point.y, exactOptions);
          if (!legal.ok) continue;
          const score = Math.hypot(screenX - rect.width * 0.65, screenY - rect.height * 0.53);
          candidates.push({ x: screenX, y: screenY, point, score });
        }
      }
      candidates.sort((left, right) => left.score - right.score);
      return candidates[0] || null;
    },
    { featureKind: feature, placementOptions: options, avoided: avoid },
  );
  const objectCandidate = (type, scale = 1, avoid = []) => page.evaluate(
    async ({ objectType, objectScale, avoided }) => {
      const { objectPlacementOk } = await import('/src/sim/courseEditor.js');
      const app = window.__fw;
      const course = app.state.course;
      const scene = app.scene3d;
      const rect = scene.renderer.domElement.getBoundingClientRect();
      const candidates = [];
      for (let screenY = Math.max(rect.top + 145, 165); screenY <= Math.min(rect.bottom - 70, 800); screenY += 28) {
        for (let screenX = Math.max(rect.left + 390, 410); screenX <= rect.right - 55; screenX += 34) {
          const hit = scene.raycastGround(screenX, screenY);
          if (!hit?.inBounds) continue;
          const point = { x: hit.fx, y: hit.fy };
          if (avoided.some((entry) => Math.hypot(point.x - entry.x, point.y - entry.y) < (entry.radius || 4))) continue;
          const legal = objectPlacementOk(course, objectType, point.x, point.y, { scale: objectScale });
          if (!legal.ok) continue;
          const score = Math.hypot(screenX - rect.width * 0.65, screenY - rect.height * 0.53);
          candidates.push({ x: screenX, y: screenY, point, score });
        }
      }
      candidates.sort((left, right) => left.score - right.score);
      return candidates[0] || null;
    },
    { objectType: type, objectScale: scale, avoided: avoid },
  );
  const paintCandidate = () => page.evaluate(async () => {
    const { ZONE } = await import('/src/sim/constants.js');
    const app = window.__fw;
    const course = app.state.course;
    const scene = app.scene3d;
    const rect = scene.renderer.domElement.getBoundingClientRect();
    let best = null;
    for (let screenY = Math.max(rect.top + 145, 165); screenY <= Math.min(rect.bottom - 70, 800); screenY += 28) {
      for (let screenX = Math.max(rect.left + 390, 410); screenX <= rect.right - 55; screenX += 34) {
        const hit = scene.raycastGround(screenX, screenY);
        if (!hit?.inBounds) continue;
        const x = Math.max(0, Math.min(course.w - 1, Math.round(hit.fx)));
        const y = Math.max(0, Math.min(course.h - 1, Math.round(hit.fy)));
        if (course.zones[y * course.w + x] === ZONE.FAIRWAY) continue;
        const score = Math.hypot(screenX - rect.width * 0.65, screenY - rect.height * 0.53);
        if (!best || score < best.score) best = { x: screenX, y: screenY, point: { x: hit.fx, y: hit.fy }, score };
      }
    }
    return best;
  });
  const greenPinCandidate = (holeId, pinKey) => page.evaluate(async ({ selectedHoleId, key }) => {
    const THREE = await import('three');
    const { getZone } = await import('/src/sim/course.js');
    const { ZONE } = await import('/src/sim/constants.js');
    const app = window.__fw;
    const course = app.state.course;
    const scene = app.scene3d;
    const hole = course.holes.find((candidate) => candidate.id === selectedHoleId);
    const vectorHole = course.vec?.holes?.find((candidate) => candidate.id === hole?.vecId);
    const points = vectorHole?.green?.pts || [];
    if (!points.length) return null;
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const rect = scene.renderer.domElement.getBoundingClientRect();
    const prior = hole.pins?.[key];
    let best = null;
    for (let y = Math.max(0, Math.ceil(minY - 0.5)); y <= Math.min(course.h - 1, Math.floor(maxY - 0.5)); y += 1) {
      for (let x = Math.max(0, Math.ceil(minX - 0.5)); x <= Math.min(course.w - 1, Math.floor(maxX - 0.5)); x += 1) {
        if (getZone(course, x, y) !== ZONE.GREEN) continue;
        if (prior && Math.hypot(prior.x - x, prior.y - y) < 0.8) continue;
        const worldX = scene.worldX(x);
        const worldZ = scene.worldZ(y);
        const ndc = new THREE.Vector3(worldX, scene.heightAt(worldX, worldZ) + 0.015, worldZ).project(scene.camera);
        const screenX = rect.left + ((ndc.x + 1) * rect.width) / 2;
        const screenY = rect.top + ((1 - ndc.y) * rect.height) / 2;
        const hit = scene.raycastGround(screenX, screenY);
        if (!hit || Math.hypot(hit.fx - x, hit.fy - y) > 0.9) continue;
        if (screenX < 350 || screenX > rect.right - 35 || screenY < 105 || screenY > rect.bottom - 55) continue;
        const score = Math.hypot(screenX - rect.width * 0.65, screenY - rect.height * 0.5);
        if (!best || score < best.score) best = { x: screenX, y: screenY, cell: { x, y }, prior, score };
      }
    }
    return best;
  }, { selectedHoleId: holeId, key: pinKey });
  const transactionSnapshot = () => page.evaluate(() => {
    const app = window.__fw;
    const session = app.editorUi().session();
    return {
      cash: app.state.cash,
      bill: session?.bill || 0,
      undo: session?.undo?.length || 0,
      redo: session?.redo?.length || 0,
      holes: app.state.course.holes.length,
      objects: app.state.course.objects.length,
      waters: app.state.course.vec?.waters?.length || 0,
      bunkers: (app.state.course.vec?.holes || []).reduce((sum, hole) => sum + (hole.bunkers?.length || 0), 0),
    };
  });
  const sampleIdle = (durationMs = 1400) => page.evaluate((duration) => new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    const started = last;
    const tick = (now) => {
      const delta = now - last;
      last = now;
      if (delta > 0) deltas.push(delta);
      if (now - started < duration) requestAnimationFrame(tick);
      else {
        const mean = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
        resolve({
          frames: deltas.length,
          averageFps: +(1000 / Math.max(0.001, mean)).toFixed(2),
          worstFrameMs: +Math.max(0, ...deltas).toFixed(2),
          framesOver100ms: deltas.filter((value) => value > 100).length,
        });
      }
    };
    requestAnimationFrame(tick);
  }), durationMs);

  try {
    await page.goto(baseUrl);
    await page.waitForFunction(() => document.readyState === 'complete');
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    await continueButton.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.trim() === 'Continue');
      return !!button && !button.disabled;
    }, null, { timeout: 90000 });
    await continueButton.click();
    await page.waitForFunction(() => window.__fw?.scene3d?.renderer && window.__fw?.editorUi?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.keyboard.press('j');
    await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 15000 });
    await page.locator('.ced-root').waitFor({ state: 'visible' });
    await page.locator('.ced-camera').selectOption('frame-hole');
    await settle(12);
    expectedNavigation = false;

    const baseline = await fingerprint();
    await capture('before_utility_audit', 'Before: clean editor state prior to utility and transaction controls.');

    await checkpoint('all ten tool panels and object categories', async () => {
      const expectedHeadings = new Map([
        ['Select', 'Select'], ['Terrain', 'Terrain'], ['Paint', 'Paint'], ['Tee', 'Tee boxes'],
        ['Green', 'Green'], ['Bunker', 'Bunker'], ['Water', 'Water'], ['Objects', 'Objects'],
        ['Paths', 'Paths'], ['Measure', 'Measure'],
      ]);
      const tools = [];
      for (const [label, expectedHeading] of expectedHeadings) {
        const button = await useTool(label);
        const heading = (await page.locator('.ced-tool-panel .ced-panel-head').first().textContent())?.trim();
        const tip = (await page.locator('.ced-tip').textContent())?.trim();
        const hint = (await page.locator('.ced-hints').textContent())?.trim();
        tools.push({ label, heading, active: await button.evaluate((node) => node.classList.contains('on')), tip, hint });
        requireTruth(heading === expectedHeading, `${label} opened the wrong panel.`, tools.at(-1));
        requireTruth(tools.at(-1).active && tip?.length > 8 && hint?.length > 8,
          `${label} did not expose active guidance.`, tools.at(-1));
      }

      await useTool('Objects');
      const categories = [];
      for (const label of ['Trees', 'Shrubs', 'Rocks', 'Props', 'Decor']) {
        const button = page.locator('.ced-tool-panel .ced-seg').getByRole('button', { name: label, exact: true });
        await button.click();
        await settle(2);
        const count = await page.locator('.ced-tool-panel .ced-objgrid button').count();
        categories.push({ label, count, active: await button.evaluate((node) => node.classList.contains('on')) });
        requireTruth(count > 0 && categories.at(-1).active, `${label} catalog did not activate.`, categories.at(-1));
      }
      return { tools, categories };
    });

    await checkpoint('statistics and all lighting previews', async () => {
      await page.locator('.ced-top-btn[title="Course statistics"]').click();
      await page.locator('.ced-stats').waitFor({ state: 'visible' });
      const statsText = (await page.locator('.ced-stats').textContent())?.trim();
      const statRows = await page.locator('.ced-stats .ced-stat-row').count();
      await capture('statistics_panel', 'Course statistics panel reached from the top bar.');
      const lighting = [];
      for (const value of ['day', 'morning', 'golden', 'overcast']) {
        await page.locator('.ced-light').selectOption(value);
        await settle(3);
        lighting.push(await page.locator('.ced-light').inputValue());
      }
      await page.locator('.ced-light').selectOption('day');
      await page.locator('.ced-top-btn[title="Course statistics"]').click();
      requireTruth(statRows >= 6 && /Holes/.test(statsText) && /Pending works/.test(statsText),
        'Statistics panel is incomplete.', { statsText, statRows });
      requireTruth(JSON.stringify(lighting) === JSON.stringify(['day', 'morning', 'golden', 'overcast']),
        'A lighting preview could not be selected.', lighting);
      return { statRows, statsText, lighting };
    });

    let points = await groundPoints();
    await checkpoint('measure chain and right-click clear', async () => {
      requireTruth(points.length === 3, 'No safe ground points were available for Measure.', points);
      await useTool('Measure');
      await page.mouse.click(points[0].x, points[0].y);
      await page.mouse.click(points[1].x, points[1].y);
      await page.mouse.click(points[2].x, points[2].y);
      await settle(5);
      const text = (await page.locator('.ced-measure').textContent())?.trim();
      const visible = await page.locator('.ced-measure').isVisible();
      await capture('measure_chain', 'Three-point measurement with segment, elevation, slope, and chain total.');
      await page.mouse.click(points[2].x, points[2].y, { button: 'right' });
      await settle(4);
      const cleared = !(await page.locator('.ced-measure').isVisible());
      requireTruth(visible && /yd/.test(text) && /Elevation/.test(text) && /Chain total/.test(text),
        'Measure did not report the complete chain.', { visible, text });
      requireTruth(cleared, 'Right-click did not clear Measure.', { cleared });
      return { points, text, cleared };
    });

    await checkpoint('terrain and paint create discardable live work', async () => {
      points = await groundPoints();
      requireTruth(points.length === 3, 'No safe ground points were available for live strokes.', points);
      await useTool('Terrain');
      await measureAction('utility terrain stroke', async () => {
        await page.mouse.move(points[0].x, points[0].y);
        await page.mouse.down();
        await page.mouse.move(points[0].x + 28, points[0].y + 8, { steps: 8 });
        await page.mouse.up();
        await settle(8);
      });
      const fairway = await paintCandidate();
      requireTruth(fairway, 'No visible non-fairway ground was available for explicit Fairway paint.');
      await useTool('Paint');
      const fairwayButton = page.locator('.ced-tool-panel').getByRole('button', { name: 'Fairway', exact: true });
      await fairwayButton.click();
      await measureAction('utility fairway paint stroke', async () => {
        await page.mouse.move(fairway.x, fairway.y);
        await page.mouse.down();
        await page.mouse.move(fairway.x + 28, fairway.y + 8, { steps: 8 });
        await page.mouse.up();
        await settle(8);
      });
      const afterStrokes = await fingerprint();
      const dirtyVisible = await page.getByRole('button', { name: 'Discard', exact: true }).first().isVisible();
      requireTruth(JSON.stringify(afterStrokes) !== JSON.stringify(baseline), 'Terrain/Paint strokes changed no course data.');
      requireTruth(dirtyVisible, 'Pending-work controls did not appear after live strokes.');
      requireTruth(await fairwayButton.evaluate((node) => node.classList.contains('on')),
        'Fairway was not retained as the active paint surface.');
      return { afterStrokes, dirtyVisible, paintSurface: 'Fairway', fairway };
    });

    await checkpoint('tee green bunker pond flora props pin and select complete live', async () => {
      const selectedHole = await selectHoleByIndex(4);
      requireTruth(selectedHole, 'The Millpond fixture could not be selected for stamp coverage.');
      const avoid = await page.evaluate((holeId) => {
        const course = window.__fw.state.course;
        const hole = course.holes.find((entry) => entry.id === holeId);
        const vectorHole = course.vec?.holes?.find((entry) => entry.id === hole?.vecId);
        const points = [];
        for (const tee of Object.values(hole?.tees || {})) if (tee) points.push({ x: tee.x, y: tee.y, radius: 5 });
        if (vectorHole?.green) points.push({ x: vectorHole.green.cx, y: vectorHole.green.cy, radius: 6 });
        return points;
      }, selectedHole.id);

      await useTool('Tee');
      const teeHole = page.locator('.ced-tool-panel .ced-row').filter({ hasText: 'Hole' }).locator('select').first();
      await teeHole.selectOption(String(selectedHole.id));
      await page.locator('.ced-tool-panel .ced-seg').getByRole('button', { name: 'Forward', exact: true }).click();
      const teeCandidate = await featureCandidate('tee', { holeId: selectedHole.id }, avoid);
      requireTruth(teeCandidate, 'No visible legal tee stamp candidate was found.');
      const teeBefore = await page.evaluate((holeId) => {
        const hole = window.__fw.state.course.holes.find((entry) => entry.id === holeId);
        return JSON.parse(JSON.stringify({ tee: hole?.tees?.forward, bill: window.__fw.editorUi().session().bill }));
      }, selectedHole.id);
      const teePreviewRun = await measureRuntimeAction(
        'tee placement preview', () => page.mouse.move(teeCandidate.x, teeCandidate.y), 6,
      );
      const teeRun = await measureRuntimeAction('forward tee stamp', () => page.mouse.click(teeCandidate.x, teeCandidate.y));
      const teeAfter = await page.evaluate((holeId) => {
        const hole = window.__fw.state.course.holes.find((entry) => entry.id === holeId);
        return JSON.parse(JSON.stringify({ tee: hole?.tees?.forward, bill: window.__fw.editorUi().session().bill }));
      }, selectedHole.id);
      requireTruth(JSON.stringify(teeAfter.tee) !== JSON.stringify(teeBefore.tee) && teeAfter.bill > teeBefore.bill,
        'The visible tee stamp did not move the tee and add a pending cost.', { teeBefore, teeAfter, teeCandidate });

      await useTool('Green');
      await page.locator('.ced-tool-panel .ced-seg').getByRole('button', { name: 'Draw', exact: true }).click();
      const greenCandidate = await featureCandidate('green', { r: 30 / 16, elong: 1.35, angle: 0 }, [
        ...avoid, { ...teeCandidate.point, radius: 6 },
      ]);
      requireTruth(greenCandidate, 'No visible legal green stamp candidate was found.');
      const greenBefore = await page.evaluate((holeId) => {
        const course = window.__fw.state.course;
        const hole = course.holes.find((entry) => entry.id === holeId);
        const vectorHole = course.vec?.holes?.find((entry) => entry.id === hole?.vecId);
        return JSON.parse(JSON.stringify({ green: vectorHole?.green, bill: window.__fw.editorUi().session().bill }));
      }, selectedHole.id);
      const greenPreviewRun = await measureRuntimeAction(
        'green placement preview', () => page.mouse.move(greenCandidate.x, greenCandidate.y), 6,
      );
      const greenRun = await measureRuntimeAction('green stamp', () => page.mouse.click(greenCandidate.x, greenCandidate.y));
      const greenAfter = await page.evaluate((holeId) => {
        const course = window.__fw.state.course;
        const hole = course.holes.find((entry) => entry.id === holeId);
        const vectorHole = course.vec?.holes?.find((entry) => entry.id === hole?.vecId);
        return JSON.parse(JSON.stringify({ green: vectorHole?.green, bill: window.__fw.editorUi().session().bill }));
      }, selectedHole.id);
      requireTruth(JSON.stringify(greenAfter.green?.pts) !== JSON.stringify(greenBefore.green?.pts)
        && greenAfter.bill > greenBefore.bill,
      'The visible green stamp did not author a new boundary and pending cost.', { greenBefore, greenAfter, greenCandidate });

      await page.locator('.ced-tool-panel .ced-seg').getByRole('button', { name: 'A', exact: true }).click();
      const pinCandidate = await greenPinCandidate(selectedHole.id, 'A');
      requireTruth(pinCandidate, 'No visible legal pin-A candidate was found on the stamped green.');
      const pinPreviewRun = await measureRuntimeAction(
        'pin placement preview', () => page.mouse.move(pinCandidate.x, pinCandidate.y), 6,
      );
      const pinRun = await measureRuntimeAction('pin A placement', () => page.mouse.click(pinCandidate.x, pinCandidate.y));
      const pinAfter = await page.evaluate((holeId) => {
        const hole = window.__fw.state.course.holes.find((entry) => entry.id === holeId);
        return JSON.parse(JSON.stringify({ pin: hole?.pins?.A, activePin: hole?.activePin }));
      }, selectedHole.id);
      requireTruth(!!pinAfter.pin && pinAfter.activePin === 'A', 'Pin A was not authored and selected.', { pinAfter, pinCandidate });

      await useTool('Bunker');
      await page.locator('.ced-tool-panel .ced-seg').getByRole('button', { name: 'Draw', exact: true }).click();
      const bunkerCandidate = await featureCandidate('bunker', {
        r: 14 / 16, lobes: 3, stretch: 1.12, angle: 0,
      }, [...avoid, { ...teeCandidate.point, radius: 5 }, { ...greenCandidate.point, radius: 6 }]);
      requireTruth(bunkerCandidate, 'No visible legal bunker stamp candidate was found.');
      const bunkerBefore = await transactionSnapshot();
      const bunkerPreviewRun = await measureRuntimeAction(
        'bunker placement preview', () => page.mouse.move(bunkerCandidate.x, bunkerCandidate.y), 6,
      );
      const bunkerRun = await measureRuntimeAction('bunker stamp', () => page.mouse.click(bunkerCandidate.x, bunkerCandidate.y));
      const bunkerAfter = await transactionSnapshot();
      requireTruth(bunkerAfter.bunkers === bunkerBefore.bunkers + 1 && bunkerAfter.bill > bunkerBefore.bill,
        'The visible bunker stamp did not add one charged bunker.', { bunkerBefore, bunkerAfter, bunkerCandidate });

      await useTool('Water');
      await page.locator('.ced-tool-panel .ced-seg').getByRole('button', { name: 'Draw', exact: true }).click();
      await page.locator('.ced-tool-panel .ced-seg').getByRole('button', { name: 'Pond', exact: true }).click();
      const pondCandidate = await featureCandidate('water', {
        r: 36 / 16, elong: 1.15, angle: 0,
      }, [
        ...avoid,
        { ...teeCandidate.point, radius: 6 },
        { ...greenCandidate.point, radius: 7 },
        { ...bunkerCandidate.point, radius: 5 },
      ]);
      requireTruth(pondCandidate, 'No visible legal pond stamp candidate was found.');
      const pondBefore = await transactionSnapshot();
      const pondPreviewRun = await measureRuntimeAction(
        'pond placement preview', () => page.mouse.move(pondCandidate.x, pondCandidate.y), 6,
      );
      const pondRun = await measureRuntimeAction('pond stamp', () => page.mouse.click(pondCandidate.x, pondCandidate.y));
      const pondAfter = await transactionSnapshot();
      requireTruth(pondAfter.waters === pondBefore.waters + 1 && pondAfter.bill > pondBefore.bill,
        'The visible pond stamp did not add one charged water body.', { pondBefore, pondAfter, pondCandidate });

      await useTool('Objects');
      await page.locator('.ced-tool-panel .ced-seg').getByRole('button', { name: 'Trees', exact: true }).click();
      await page.locator('.ced-tool-panel .ced-objgrid').getByRole('button', { name: 'Oak', exact: true }).click();
      const treeCandidate = await objectCandidate('tree_oak', 1, [
        { ...greenCandidate.point, radius: 6 }, { ...pondCandidate.point, radius: 7 },
      ]);
      requireTruth(treeCandidate, 'No visible legal Flora placement candidate was found.');
      const treeBefore = await transactionSnapshot();
      const treePreviewRun = await measureRuntimeAction(
        'flora placement preview', () => page.mouse.move(treeCandidate.x, treeCandidate.y), 6,
      );
      const treeRun = await measureRuntimeAction('flora oak placement', () => page.mouse.click(treeCandidate.x, treeCandidate.y));
      const treeAfter = await transactionSnapshot();
      requireTruth(treeAfter.objects === treeBefore.objects + 1 && treeAfter.bill > treeBefore.bill,
        'The Flora action did not add one charged Oak.', { treeBefore, treeAfter, treeCandidate });

      await page.locator('.ced-tool-panel .ced-seg').getByRole('button', { name: 'Props', exact: true }).click();
      await page.locator('.ced-tool-panel .ced-objgrid').getByRole('button', { name: 'Bench', exact: true }).click();
      const benchCandidate = await objectCandidate('bench', 1, [
        { ...treeCandidate.point, radius: 5 }, { ...greenCandidate.point, radius: 6 }, { ...pondCandidate.point, radius: 7 },
      ]);
      requireTruth(benchCandidate, 'No visible legal Props placement candidate was found.');
      const benchBefore = await transactionSnapshot();
      const benchPreviewRun = await measureRuntimeAction(
        'prop placement preview', () => page.mouse.move(benchCandidate.x, benchCandidate.y), 6,
      );
      const benchRun = await measureRuntimeAction('prop bench placement', () => page.mouse.click(benchCandidate.x, benchCandidate.y));
      const benchAfter = await transactionSnapshot();
      requireTruth(benchAfter.objects === benchBefore.objects + 1 && benchAfter.bill > benchBefore.bill,
        'The Props action did not add one charged Bench.', { benchBefore, benchAfter, benchCandidate });

      await page.mouse.move(benchCandidate.x, benchCandidate.y);
      await settle(3);
      const rejectedBefore = await transactionSnapshot();
      const rejectedRun = await measureRuntimeAction('rejected prop placement', () => page.mouse.click(benchCandidate.x, benchCandidate.y));
      const rejectedAfter = await transactionSnapshot();
      requireTruth(rejectedAfter.objects === rejectedBefore.objects && rejectedAfter.bill === rejectedBefore.bill,
        'A rejected collision changed inventory or pending cost.', { rejectedBefore, rejectedAfter });

      await useTool('Select');
      await page.mouse.click(benchCandidate.x, benchCandidate.y);
      await settle(5);
      const selectedText = (await page.locator('.ced-tool-panel').textContent())?.trim();
      requireTruth(/Bench/.test(selectedText), 'Select did not acquire the newly placed Bench.', { selectedText, benchCandidate });
      await capture('live_stamp_and_catalog_actions',
        'Tee, green, pin, bunker, pond, Flora, Props, rejection, and Select exercised through visible controls.');

      const runs = [
        teePreviewRun, teeRun,
        greenPreviewRun, greenRun,
        pinPreviewRun, pinRun,
        bunkerPreviewRun, bunkerRun,
        pondPreviewRun, pondRun,
        treePreviewRun, treeRun,
        benchPreviewRun, benchRun,
        rejectedRun,
      ]
        .map((entry) => entry.performance);
      requireTruth(runs.every((entry) => entry.framesOver100ms === 0),
        'A standard stamp/catalog action produced a frame over 100 ms.', runs);
      return {
        selectedHole,
        checks: {
          teeStamped: true,
          greenStamped: true,
          pinAPlaced: true,
          bunkerStamped: true,
          pondStamped: true,
          floraPlaced: true,
          propPlaced: true,
          rejectedActionFree: true,
          selectAcquiredProp: true,
          noFrameOver100ms: true,
        },
        candidates: { teeCandidate, greenCandidate, pinCandidate, bunkerCandidate, pondCandidate, treeCandidate, benchCandidate },
        runs,
      };
    });

    await checkpoint('hole settings reorder duplicate delete add undo and redo', async () => {
      const holeCountBefore = await page.evaluate(() => window.__fw.state.course.holes.length);
      const targetIndex = Math.min(4, holeCountBefore - 1);
      await page.locator('.ced-holechip').click();
      let modal = page.locator('.ced-modal');
      await modal.waitFor({ state: 'visible' });
      await modal.locator('.ced-holecard:not(.add)').nth(targetIndex).click();
      await modal.getByRole('button', { name: 'Edit Hole', exact: true }).click();
      const targetHole = await page.evaluate((index) => {
        const hole = window.__fw.state.course.holes[index];
        return { id: hole.id, name: hole.name, handicap: hole.handicap };
      }, targetIndex);
      const changedName = `${targetHole.name} QA`;
      await modal.locator('input[type="text"]').fill(changedName);
      await modal.locator('input[type="number"]').fill(String(targetHole.handicap === 18 ? 17 : targetHole.handicap + 1));
      await modal.getByRole('button', { name: /Earlier/ }).click();
      await modal.getByRole('button', { name: /Later/ }).click();
      await modal.getByRole('button', { name: 'Apply', exact: true }).click();
      await modal.waitFor({ state: 'hidden' });
      const nameAfterApply = await page.evaluate((id) => window.__fw.state.course.holes.find((hole) => hole.id === id)?.name, targetHole.id);

      await measureAction('hole settings undo', async () => {
        await page.locator('.ced-top-btn[title^="Undo"]').click();
        await settle(5);
      });
      const nameAfterUndo = await page.evaluate((id) => window.__fw.state.course.holes.find((hole) => hole.id === id)?.name, targetHole.id);
      await measureAction('hole settings redo', async () => {
        await page.locator('.ced-top-btn[title^="Redo"]').click();
        await settle(5);
      });
      const nameAfterRedo = await page.evaluate((id) => window.__fw.state.course.holes.find((hole) => hole.id === id)?.name, targetHole.id);

      await page.locator('.ced-holechip').click();
      await modal.locator('.ced-holecard:not(.add)').nth(targetIndex).click();
      await modal.getByRole('button', { name: 'Edit Hole', exact: true }).click();
      await modal.getByRole('button', { name: 'Duplicate settings', exact: true }).click();
      const countAfterDuplicate = await page.evaluate(() => window.__fw.state.course.holes.length);
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
      await modal.waitFor({ state: 'hidden' });

      await page.locator('.ced-holechip').click();
      await modal.locator('.ced-holecard:not(.add)').nth(countAfterDuplicate - 1).click();
      await modal.getByRole('button', { name: 'Edit Hole', exact: true }).click();
      await modal.getByRole('button', { name: 'Delete hole', exact: true }).click();
      await modal.getByRole('button', { name: 'Delete', exact: true }).click();
      await modal.waitFor({ state: 'hidden' });
      const countAfterDelete = await page.evaluate(() => window.__fw.state.course.holes.length);
      await page.locator('.ced-top-btn[title^="Undo"]').click();
      await settle(4);
      const countAfterDeleteUndo = await page.evaluate(() => window.__fw.state.course.holes.length);
      await page.locator('.ced-top-btn[title^="Redo"]').click();
      await settle(4);
      const countAfterDeleteRedo = await page.evaluate(() => window.__fw.state.course.holes.length);

      await page.locator('.ced-holechip').click();
      await modal.locator('.ced-holecard.add').click();
      await settle(4);
      const countAfterAdd = await page.evaluate(() => window.__fw.state.course.holes.length);
      await modal.locator('.ced-x').click();
      await modal.waitFor({ state: 'hidden' });
      await capture('hole_actions_complete', 'Hole settings, reorder, duplicate, delete, add, Undo, and Redo exercised.');

      const checks = {
        settingsApplied: nameAfterApply === changedName,
        undoRestoredName: nameAfterUndo === targetHole.name,
        redoRestoredEdit: nameAfterRedo === changedName,
        duplicateAdded: countAfterDuplicate === holeCountBefore + 1,
        deleteRemovedDuplicate: countAfterDelete === holeCountBefore,
        deleteUndoRestored: countAfterDeleteUndo === holeCountBefore + 1,
        deleteRedoRepeated: countAfterDeleteRedo === holeCountBefore,
        addHoleWorked: countAfterAdd === holeCountBefore + 1,
      };
      requireTruth(Object.values(checks).every(Boolean), 'A hole-management action failed.', checks);
      return { checks, targetHole, changedName, counts: {
        before: holeCountBefore,
        afterDuplicate: countAfterDuplicate,
        afterDelete: countAfterDelete,
        afterDeleteUndo: countAfterDeleteUndo,
        afterDeleteRedo: countAfterDeleteRedo,
        afterAdd: countAfterAdd,
      } };
    });

    let discardFrames = null;
    let discardRuntimeCosts = null;
    await checkpoint('discard is exact and frame bounded', async () => {
      await page.evaluate(() => window.__fw.scene3d.resetEditorPerformanceStats?.());
      await page.evaluate(() => {
        window.__discardFrameProbe = { running: true, last: performance.now(), deltas: [] };
        const tick = (now) => {
          const probe = window.__discardFrameProbe;
          if (!probe?.running) return;
          const delta = now - probe.last;
          probe.last = now;
          if (delta > 0) probe.deltas.push(delta);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const topDiscard = page.getByRole('button', { name: 'Discard', exact: true }).first();
      await topDiscard.click();
      const modal = page.locator('.ced-modal');
      await modal.waitFor({ state: 'visible' });
      await measureAction('discard pending work', async () => {
        await modal.getByRole('button', { name: 'Discard', exact: true }).click();
        await modal.waitFor({ state: 'hidden', timeout: 30000 });
        await settle(12);
      });
      discardFrames = await page.evaluate(() => {
        const probe = window.__discardFrameProbe;
        probe.running = false;
        const mean = probe.deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, probe.deltas.length);
        return {
          frames: probe.deltas.length,
          averageFps: +(1000 / Math.max(0.001, mean)).toFixed(2),
          worstFrameMs: +Math.max(0, ...probe.deltas).toFixed(2),
          framesOver33ms: probe.deltas.filter((value) => value > 33).length,
          framesOver100ms: probe.deltas.filter((value) => value > 100).length,
          rawFrameDeltasMs: probe.deltas.map((value) => +value.toFixed(2)),
        };
      });
      discardRuntimeCosts = await page.evaluate(
        () => window.__fw.scene3d.editorPerformanceSnapshot?.() || null,
      );
      const afterDiscard = await fingerprint();
      const exact = JSON.stringify(afterDiscard) === JSON.stringify(baseline);
      requireTruth(exact, 'Discard did not restore the exact opening course fingerprint.', { baseline, afterDiscard });
      requireTruth(discardFrames.framesOver100ms === 0, 'Discard produced a frame over 100 ms.', discardFrames);
      return { exact, baseline, afterDiscard, discardFrames, discardRuntimeCosts };
    });

    let buildPerformance = null;
    let savePerformance = null;
    await checkpoint('Build charges once and visible Save reloads exact built work', async () => {
      const cleanStart = await transactionSnapshot();
      requireTruth(cleanStart.bill === 0 && cleanStart.undo === 0,
        'The Build audit did not start from a clean discarded session.', cleanStart);
      const buildPaint = await paintCandidate();
      requireTruth(buildPaint, 'No visible ground was available for the Build audit.');
      await useTool('Paint');
      await page.locator('.ced-tool-panel').getByRole('button', { name: 'Fairway', exact: true }).click();
      const paintRun = await measureRuntimeAction('build-audit fairway stroke', async () => {
        await page.mouse.move(buildPaint.x, buildPaint.y);
        await page.mouse.down();
        await page.mouse.move(buildPaint.x + 22, buildPaint.y + 6, { steps: 7 });
        await page.mouse.up();
      });
      const pending = await transactionSnapshot();
      const buildButton = page.getByRole('button', { name: 'Build', exact: true }).first();
      requireTruth(pending.bill > 0 && pending.undo > 0 && await buildButton.isVisible() && await buildButton.isEnabled(),
        'A successful edit did not expose an enabled Build transaction.', { pending, paintRun: paintRun.performance });

      const buildRun = await measureRuntimeAction('top-level Build transaction', () => buildButton.click(), 12);
      buildPerformance = buildRun.performance;
      const built = await transactionSnapshot();
      const buildStillVisible = await buildButton.isVisible().catch(() => false);
      requireTruth(built.cash === pending.cash - pending.bill,
        'Build did not charge the exact pending bill once.', { pending, built });
      requireTruth(built.bill === 0 && built.undo === 0 && built.redo === 0 && !buildStillVisible,
        'Build did not settle history, cost, and control state.', { built, buildStillVisible });
      requireTruth(buildPerformance.framesOver100ms === 0,
        'Build produced a frame over 100 ms.', buildPerformance);
      const builtFingerprint = await fingerprint();
      await capture('built_transaction', 'Top-level Build charged the exact bill and settled all pending controls.');

      await page.locator('.ced-top-btn[title="Save the course"]').click();
      const saveModal = page.locator('.ced-modal');
      await saveModal.waitFor({ state: 'visible', timeout: 5000 });
      const saveButton = saveModal.getByRole('button', { name: 'Save', exact: true });
      requireTruth(await saveButton.isVisible(), 'A settled course did not expose the plain Save action.');
      const saveRun = await measureRuntimeAction('visible Save transaction', async () => {
        await saveButton.click();
        await saveModal.waitFor({ state: 'hidden', timeout: 10000 });
      }, 12);
      savePerformance = saveRun.performance;
      requireTruth(savePerformance.framesOver100ms === 0,
        'Visible Save produced a frame over 100 ms.', savePerformance);

      expectedNavigation = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.readyState === 'complete');
      const continueAfterReload = page.getByRole('button', { name: 'Continue', exact: true });
      await continueAfterReload.waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('button')]
          .find((candidate) => candidate.textContent.trim() === 'Continue');
        return !!button && !button.disabled;
      }, null, { timeout: 90000 });
      await continueAfterReload.click();
      await page.waitForFunction(() => window.__fw?.scene3d?.renderer && window.__fw?.editorUi?.(), null, { timeout: 90000 });
      await page.waitForFunction(() => {
        const veil = document.querySelector('.load-veil');
        return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
      }, null, { timeout: 90000 });
      await page.keyboard.press('j');
      await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 15000 });
      await page.locator('.ced-root').waitFor({ state: 'visible' });
      await settle(12);
      expectedNavigation = false;
      const reloadedFingerprint = await fingerprint();
      requireTruth(JSON.stringify(reloadedFingerprint) === JSON.stringify(builtFingerprint),
        'Visible Save/reload drifted from the exact built fingerprint.', { builtFingerprint, reloadedFingerprint });
      const reloadSession = await transactionSnapshot();
      requireTruth(reloadSession.bill === 0 && reloadSession.undo === 0 && reloadSession.redo === 0,
        'Reload reopened with stale pending transaction state.', reloadSession);
      await capture('built_save_reload', 'Built Fairway edit preserved exactly after visible Save and normal reload.');
      return {
        checks: {
          dirtyBuildEnabled: true,
          exactSingleCharge: true,
          settledBuildControls: true,
          buildFrameBounded: true,
          plainSaveUsed: true,
          saveFrameBounded: true,
          exactReload: true,
          cleanReloadSession: true,
        },
        cleanStart,
        pending,
        built,
        buildPaint,
        performance: { paint: paintRun.performance, build: buildPerformance, save: savePerformance },
        builtFingerprint,
        reloadedFingerprint,
      };
    });

    const finalPerformance = await sampleIdle();
    await capture('after_complete_utility_audit', 'After: all utility, transaction, Build, Save, and reload checks complete.');
    const discardCheckpoint = checkpoints.find((item) => item.name === 'discard is exact and frame bounded');
    const buildCheckpoint = checkpoints.find((item) => item.name === 'Build charges once and visible Save reloads exact built work');
    const checks = {
      allCheckpointsPassed: checkpoints.length === 8 && checkpoints.every((item) => item.ok),
      exactDiscard: discardCheckpoint?.evidence?.exact === true,
      discardFrameBounded: discardFrames?.framesOver100ms === 0,
      buildTransactionExact: buildCheckpoint?.evidence?.checks?.exactSingleCharge === true,
      buildFrameBounded: buildPerformance?.framesOver100ms === 0,
      saveReloadExact: buildCheckpoint?.evidence?.checks?.exactReload === true,
      saveFrameBounded: savePerformance?.framesOver100ms === 0,
      standardActionsFrameBounded: runtimeActions.every((item) => item.framesOver100ms === 0),
      idleFrameBounded: finalPerformance.framesOver100ms === 0,
      consoleErrorsClean: diagnostics.consoleErrors.length === 0,
      pageErrorsClean: diagnostics.pageErrors.length === 0,
      requestFailuresClean: diagnostics.requestFailures.length === 0,
      httpErrorsClean: diagnostics.httpErrors.length === 0,
      videoCaptureActive: !!page.video(),
      screenshotsWritten: captures.every((item) => fs.existsSync(item.path)),
    };
    const result = {
      ok: Object.values(checks).every(Boolean),
      suite: 'course-editor-utility-controls',
      phase,
      startedAt,
      finishedAt: new Date().toISOString(),
      checks,
      checkpoints,
      performance: {
        actionTimings,
        runtimeActions,
        discard: discardFrames,
        discardRuntimeCosts,
        finalIdle: finalPerformance,
      },
      diagnostics,
      artifacts: {
        outputDirectory: outDir,
        resultJson: canonicalResultPath,
        configuredResultJson: configuredResultPath,
        videoDirectory,
        videoCaptureActive: !!page.video(),
        captures,
      },
    };
    writeResult(result);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      suite: 'course-editor-utility-controls',
      phase,
      startedAt,
      finishedAt: new Date().toISOString(),
      fatal: { message: error?.message || String(error), stack: error?.stack || null, evidence: error?.evidence },
      checkpoints,
      performance: { actionTimings, runtimeActions },
      diagnostics,
      artifacts: { outputDirectory: outDir, videoDirectory, captures },
    };
    try {
      result.fatal.screenshot = (await capture('fatal', result.fatal.message)).path;
    } catch { /* no page left to capture */ }
    writeResult(result);
    return result;
  }
}

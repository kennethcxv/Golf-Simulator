// Headed, recorded Course Editor production-tool QA through player-facing controls.
//
// Recommended invocation (the runner owns browser launch and closes the video):
//
//   $env:COURSE_EDITOR_QA_PHASE='production-tools'
//   $env:HEADED='1'
//   $env:VIDEO_DIR='qa/course_master_final/production-tools/video'
//   $env:QA_RESULT_PATH='qa/course_master_final/production-tools/result.json'
//   node tools/qa/run-playwright.cjs tools/qa/course-editor-production-qa.js --bootstrap
//
// The driver intentionally returns ok:false when a required control or interaction is
// not reachable. Screenshots are evidence, not an automatic visual-acceptance claim;
// a human must review them and the finalized WebM after the runner closes the context.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');

  const repo = process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const rawPhase = String(process.env.COURSE_EDITOR_QA_PHASE || 'production-tools');
  const phase = rawPhase.replace(/[^a-z0-9._-]+/gi, '_');
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
  const captures = [];
  const checkpoints = [];
  const actionTimings = [];
  const blockers = [];
  const diagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
    httpErrors: [],
  };
  let expectedNavigation = true;
  let captureSequence = 0;

  const diagnosticEntry = (text) => ({
    text: String(text),
    at: new Date().toISOString(),
  });
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(diagnosticEntry(message.text()));
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(diagnosticEntry(message.text()));
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(diagnosticEntry(error.message)));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    if (expectedNavigation && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure)) return;
    diagnostics.requestFailures.push({
      ...diagnosticEntry(`${request.url()} (${failure})`),
      url: request.url(),
      failure,
    });
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    diagnostics.httpErrors.push({
      ...diagnosticEntry(`${response.url()} (HTTP ${response.status()})`),
      url: response.url(),
      status: response.status(),
    });
  });

  const safeName = (value) => String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'capture';

  const waitFrames = (count = 4) => page.evaluate((frameCount) => new Promise((resolve) => {
    let left = frameCount;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), count);

  const settle = async (count = 6) => {
    await waitFrames(count);
    await page.waitForTimeout(80);
  };

  const measureAction = async (label, action) => {
    const started = Date.now();
    const value = await action();
    actionTimings.push({ label, durationMs: Date.now() - started });
    return value;
  };

  const capture = async (name, description, extra = {}) => {
    captureSequence += 1;
    const fileName = `${String(captureSequence).padStart(2, '0')}_${safeName(name)}.png`;
    const filePath = path.join(outDir, fileName);
    await page.screenshot({ path: filePath, fullPage: false });
    const item = {
      name,
      description,
      path: filePath,
      viewport: page.viewportSize(),
      at: new Date().toISOString(),
      ...extra,
    };
    captures.push(item);
    return item;
  };

  const requireTruth = (condition, message, evidence = null) => {
    if (condition) return;
    const error = new Error(message);
    if (evidence !== null) error.evidence = evidence;
    throw error;
  };

  const requireChecks = (checks, evidence = {}) => {
    const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
    if (!failed.length) return { checks, ...evidence };
    const error = new Error(`Failed checks: ${failed.join(', ')}`);
    error.evidence = { checks, ...evidence };
    throw error;
  };

  const checkpoint = async (name, action) => {
    const record = {
      name,
      ok: false,
      startedAt: new Date().toISOString(),
      durationMs: 0,
    };
    const started = Date.now();
    try {
      record.evidence = await action();
      record.ok = true;
    } catch (error) {
      record.error = error?.message || String(error);
      if (error?.evidence !== undefined) record.evidence = error.evidence;
      const blocker = {
        checkpoint: name,
        message: record.error,
        at: new Date().toISOString(),
      };
      blockers.push(blocker);
      try {
        blocker.screenshot = (await capture(
          `blocker-${name}`,
          `Automatic blocker capture for ${name}: ${record.error}`,
          { blocker: true },
        )).path;
      } catch (captureError) {
        blocker.captureError = captureError?.message || String(captureError);
      }
    } finally {
      record.durationMs = Date.now() - started;
      record.finishedAt = new Date().toISOString();
      checkpoints.push(record);
    }
    return record.ok ? record.evidence : null;
  };

  const writeResult = (result) => {
    const body = `${JSON.stringify(result, null, 2)}\n`;
    fs.mkdirSync(path.dirname(canonicalResultPath), { recursive: true });
    fs.writeFileSync(canonicalResultPath, body);
    if (path.resolve(configuredResultPath) !== path.resolve(canonicalResultPath)) {
      fs.mkdirSync(path.dirname(configuredResultPath), { recursive: true });
      fs.writeFileSync(configuredResultPath, body);
    }
  };

  const toolPanel = () => page.locator('.ced-tool-panel');

  const useTool = async (name) => {
    await page.getByRole('button', { name, exact: true }).first().click();
    await settle(4);
  };

  const panelButton = async (name, index = 0) => {
    const button = toolPanel().getByRole('button', { name, exact: true }).nth(index);
    await button.waitFor({ state: 'visible', timeout: 5000 });
    await button.click();
    await settle(3);
  };

  const selectCamera = async (value) => {
    await page.locator('.ced-camera').selectOption(value);
    await settle(10);
  };

  const rangeLocator = (label) => toolPanel()
    .locator('.ced-row')
    .filter({ hasText: label })
    .locator('input[type="range"]')
    .first();

  const setRange = async (label, target) => {
    const input = rangeLocator(label);
    await input.waitFor({ state: 'visible', timeout: 5000 });
    const attrs = await input.evaluate((node) => ({
      min: Number(node.min),
      max: Number(node.max),
      step: Number(node.step || 1),
    }));
    const box = await input.boundingBox();
    requireTruth(box, `Range control is not measurable: ${label}`);
    const bounded = Math.max(attrs.min, Math.min(attrs.max, Number(target)));
    const ratio = (bounded - attrs.min) / Math.max(1e-9, attrs.max - attrs.min);
    await page.mouse.move(box.x + 3 + ratio * Math.max(1, box.width - 6), box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await input.focus();
    let actual = Number(await input.inputValue());
    let guard = 0;
    const maxSteps = Math.ceil((attrs.max - attrs.min) / attrs.step) + 2;
    while (Math.abs(actual - bounded) > Math.max(1e-7, attrs.step / 2) && guard < maxSteps) {
      // Commit sliders rebuild their panel after a completed keyboard change;
      // re-resolve and focus the retained control before every corrective key.
      await input.focus();
      await page.keyboard.press(actual < bounded ? 'ArrowRight' : 'ArrowLeft');
      actual = Number(await input.inputValue());
      guard += 1;
    }
    requireTruth(
      Math.abs(actual - bounded) <= Math.max(1e-7, attrs.step / 2),
      `Range control did not reach ${bounded}: ${label}`,
      { actual, bounded, attrs, keySteps: guard },
    );
    await page.keyboard.press('Tab');
    await settle(3);
    return actual;
  };

  const selectInRow = async (label, value) => {
    const select = toolPanel()
      .locator('.ced-row')
      .filter({ hasText: label })
      .locator('select')
      .first();
    await select.waitFor({ state: 'visible', timeout: 5000 });
    await select.selectOption(value);
    await settle(4);
    return select.inputValue();
  };

  const setCheckbox = async (label, checked) => {
    const wrapper = toolPanel().locator('label.ced-check').filter({ hasText: label }).first();
    await wrapper.waitFor({ state: 'visible', timeout: 5000 });
    const input = wrapper.locator('input[type="checkbox"]');
    const before = await input.isChecked();
    if (before !== checked) {
      await wrapper.click();
      await settle(4);
    }
    return input.isChecked();
  };

  const projectCells = (cells) => page.evaluate(async (points) => {
    const THREE = await import('three');
    const scene = window.__fw.scene3d;
    const rect = scene.renderer.domElement.getBoundingClientRect();
    return points.map((cell) => {
      const worldX = scene.worldX(cell.x);
      const worldZ = scene.worldZ(cell.y);
      const worldY = scene.heightAt(worldX, worldZ) + 0.015;
      const projected = new THREE.Vector3(worldX, worldY, worldZ).project(scene.camera);
      const x = rect.left + ((projected.x + 1) * rect.width) / 2;
      const y = rect.top + ((1 - projected.y) * rect.height) / 2;
      const hit = scene.raycastGround(x, y);
      const targetError = hit ? Math.hypot(hit.fx - cell.x, hit.fy - cell.y) : Infinity;
      return {
        cell,
        x,
        y,
        ndcZ: projected.z,
        targetError,
        safe: projected.z >= -1 && projected.z <= 1
          && x >= 350 && x <= rect.right - 35
          && y >= 105 && y <= rect.bottom - 55
          && targetError <= 1.1,
      };
    });
  }, cells);

  const featureControl = (kind, { holeId = null, recordIndex = null, pathId = null } = {}) => page.evaluate(
    async ({ featureKind, selectedHoleId, requestedIndex, requestedPathId }) => {
      const THREE = await import('three');
      const app = window.__fw;
      const course = app.state.course;
      const scene = app.scene3d;
      const rect = scene.renderer.domElement.getBoundingClientRect();
      const hole = course.holes.find((candidate) => candidate.id === selectedHoleId) || null;
      const vectorHole = hole ? course.vec?.holes?.find((candidate) => candidate.id === hole.vecId) : null;
      let records = [];
      if (featureKind === 'green' && vectorHole?.green) {
        records = [{ feature: vectorHole.green, recordIndex: 0, closed: true }];
      } else if (featureKind === 'bunker') {
        records = (vectorHole?.bunkers || []).map((feature, index) => ({ feature, recordIndex: index, closed: true }));
      } else if (featureKind === 'water') {
        records = (course.vec?.waters || [])
          .map((feature, index) => ({ feature, recordIndex: index, closed: true, source: 'water' }))
          .filter(({ feature }) => feature.kind === 'pond' || feature.kind === 'lake' || !feature.kind);
      } else if (featureKind === 'stream') {
        const waterCount = (course.vec?.waters || [])
          .filter((feature) => feature.kind === 'pond' || feature.kind === 'lake' || !feature.kind).length;
        records = (course.vec?.streams || []).map((feature, index) => ({
          feature,
          recordIndex: index,
          displayIndex: waterCount + index,
          closed: false,
          source: 'stream',
        }));
      } else if (featureKind === 'path') {
        records = (course.paths || []).map((feature, index) => ({ feature, recordIndex: index, closed: false }));
      }
      if (requestedIndex !== null) records = records.filter((record) => record.recordIndex === requestedIndex);
      if (requestedPathId !== null) records = records.filter((record) => record.feature.id === requestedPathId);

      const project = (cell) => {
        const wx = scene.vectorWorldX(cell.x);
        const wz = scene.vectorWorldZ(cell.y);
        const wy = scene.heightAt(wx, wz) + 0.015;
        const ndc = new THREE.Vector3(wx, wy, wz).project(scene.camera);
        const x = rect.left + ((ndc.x + 1) * rect.width) / 2;
        const y = rect.top + ((1 - ndc.y) * rect.height) / 2;
        const hit = scene.raycastGround(x, y);
        const targetError = hit
          ? Math.hypot(hit.fx + 0.5 - cell.x, hit.fy + 0.5 - cell.y)
          : Infinity;
        return {
          x,
          y,
          targetError,
          safe: ndc.z >= -1 && ndc.z <= 1
            && x >= 350 && x <= rect.right - 35
            && y >= 105 && y <= rect.bottom - 55
            && targetError <= 1.1,
        };
      };

      let best = null;
      for (const record of records) {
        const points = record.feature?.pts || [];
        if (points.length < 2) continue;
        const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
        center.x /= points.length;
        center.y /= points.length;
        for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
          const fromCell = { x: points[pointIndex].x, y: points[pointIndex].y };
          let dx;
          let dy;
          if (record.closed) {
            dx = fromCell.x - center.x;
            dy = fromCell.y - center.y;
          } else {
            const previous = points[Math.max(0, pointIndex - 1)];
            const next = points[Math.min(points.length - 1, pointIndex + 1)];
            dx = -(next.y - previous.y);
            dy = next.x - previous.x;
          }
          const length = Math.hypot(dx, dy) || 1;
          const toCell = {
            x: Math.max(-0.25, Math.min(course.w - 0.75, fromCell.x + (dx / length) * 0.38)),
            y: Math.max(-0.25, Math.min(course.h - 0.75, fromCell.y + (dy / length) * 0.38)),
          };
          const from = project(fromCell);
          const to = project(toCell);
          if (!from.safe || !to.safe) continue;
          const score = Math.hypot(from.x - rect.width * 0.63, from.y - rect.height * 0.52);
          if (!best || score < best.score) {
            best = {
              kind: featureKind,
              id: record.feature.id ?? null,
              recordIndex: record.recordIndex,
              displayIndex: record.displayIndex ?? record.recordIndex,
              source: record.source ?? null,
              pointIndex,
              beforePts: points.map((point) => ({ x: point.x, y: point.y })),
              fromCell,
              toCell,
              from,
              to,
              score,
            };
          }
        }
      }
      return best;
    },
    {
      featureKind: kind,
      selectedHoleId: holeId,
      requestedIndex: recordIndex,
      requestedPathId: pathId,
    },
  );

  const dragControl = async (control, label = 'feature control drag') => {
    const started = Date.now();
    requireTruth(control?.from?.safe && control?.to?.safe, 'No visible editable control point was found.', control);
    await page.mouse.move(control.from.x, control.from.y);
    await page.mouse.down();
    await page.mouse.move(control.to.x, control.to.y, { steps: 10 });
    await page.mouse.up();
    await settle(10);
    actionTimings.push({ label, durationMs: Date.now() - started });
  };

  const greenPinCandidate = (holeId, pinKey) => page.evaluate(async ({ selectedHoleId, key }) => {
    const THREE = await import('three');
    const { getZone } = await import(new URL('src/sim/course.js', document.baseURI).href);
    const { ZONE } = await import(new URL('src/sim/constants.js', document.baseURI).href);
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
    // Pin sockets are simulation cell-centre records, even on a vector course.
    // Scan integer cells whose centres overlap the authored green rather than
    // asking the typed zone grid for fractional indices.
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

  const openRoute = () => page.evaluate(async () => {
    const { ZONE } = await import(new URL('src/sim/constants.js', document.baseURI).href);
    const app = window.__fw;
    const scene = app.scene3d;
    const rect = scene.renderer.domElement.getBoundingClientRect();
    const excluded = new Set([ZONE.OUT, ZONE.WATER, ZONE.GREEN, ZONE.TEE, ZONE.BUNKER]);
    for (let screenY = 230; screenY <= Math.min(770, rect.bottom - 70); screenY += 38) {
      const row = [];
      for (let screenX = 390; screenX <= rect.right - 65; screenX += 42) {
        const ground = scene.raycastGround(screenX, screenY);
        if (!ground?.inBounds || excluded.has(scene.zoneAtWorld(ground.point.x, ground.point.z))) continue;
        if (row.some((item) => Math.hypot(item.cell.x - ground.fx, item.cell.y - ground.fy) < 1.4)) continue;
        row.push({ x: screenX, y: screenY, cell: { x: ground.fx, y: ground.fy } });
      }
      for (let start = 0; start + 4 < row.length; start += 1) {
        const candidate = [row[start], row[start + 2], row[start + 4]];
        const lengths = [
          Math.hypot(candidate[1].cell.x - candidate[0].cell.x, candidate[1].cell.y - candidate[0].cell.y),
          Math.hypot(candidate[2].cell.x - candidate[1].cell.x, candidate[2].cell.y - candidate[1].cell.y),
        ];
        if (lengths.every((length) => length >= 1.6 && length <= 18)) return candidate;
      }
    }
    return null;
  });

  const waterCrossingRoute = () => page.evaluate(async () => {
    const THREE = await import('three');
    const { getZone } = await import(new URL('src/sim/course.js', document.baseURI).href);
    const { ZONE } = await import(new URL('src/sim/constants.js', document.baseURI).href);
    const app = window.__fw;
    const course = app.state.course;
    const scene = app.scene3d;
    const rect = scene.renderer.domElement.getBoundingClientRect();
    const project = (cell) => {
      const wx = scene.vectorWorldX(cell.x);
      const wz = scene.vectorWorldZ(cell.y);
      const ndc = new THREE.Vector3(wx, scene.heightAt(wx, wz) + 0.015, wz).project(scene.camera);
      const x = rect.left + ((ndc.x + 1) * rect.width) / 2;
      const y = rect.top + ((1 - ndc.y) * rect.height) / 2;
      const hit = scene.raycastGround(x, y);
      return {
        x,
        y,
        safe: !!hit && Math.hypot(hit.fx + 0.5 - cell.x, hit.fy + 0.5 - cell.y) <= 1.1
          && ndc.z >= -1 && ndc.z <= 1
          && x >= 350 && x <= rect.right - 35 && y >= 105 && y <= rect.bottom - 55,
      };
    };
    let best = null;
    for (const water of course.vec?.waters || []) {
      if (!water?.pts?.length) continue;
      const xs = water.pts.map((point) => point.x);
      const ys = water.pts.map((point) => point.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      let center = {
        x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
        y: ys.reduce((sum, value) => sum + value, 0) / ys.length,
      };
      const zoneAtVector = (point) => scene.zoneAtWorld(
        scene.vectorWorldX(point.x),
        scene.vectorWorldZ(point.y),
      );
      if (zoneAtVector(center) !== ZONE.WATER) {
        let found = null;
        for (let y = minY; y <= maxY && !found; y += 0.25) {
          for (let x = minX; x <= maxX; x += 0.25) {
            if (zoneAtVector({ x, y }) === ZONE.WATER) { found = { x, y }; break; }
          }
        }
        if (!found) continue;
        center = found;
      }
      // Cross the pond's short axis so both banks remain visible and the deck
      // does not become needlessly long.
      const horizontal = (maxX - minX) < (maxY - minY);
      const route = horizontal
        ? [
          { x: minX - 1.5, y: center.y },
          center,
          { x: maxX + 1.5, y: center.y },
        ]
        : [
          { x: center.x, y: minY - 1.5 },
          center,
          { x: center.x, y: maxY + 1.5 },
        ];
      if (zoneAtVector(route[0]) === ZONE.WATER || zoneAtVector(route[0]) === ZONE.OUT
        || zoneAtVector(route[2]) === ZONE.WATER || zoneAtVector(route[2]) === ZONE.OUT) continue;
      const screens = route.map(project);
      if (!screens.every((screen) => screen.safe)) continue;
      const score = Math.hypot(screens[1].x - rect.width * 0.65, screens[1].y - rect.height * 0.52);
      if (!best || score < best.score) best = {
        waterId: water.id ?? null,
        route,
        screens,
        center,
        horizontal,
        score,
      };
    }
    return best;
  });

  const objectCandidate = ({ type = 'bench', scale = 1, ignoreId = null, avoidCell = null } = {}) => page.evaluate(
    async ({ objectType, objectScale, ignoredId, avoid }) => {
      const { objectPlacementOk } = await import(new URL('src/sim/courseEditor.js', document.baseURI).href);
      const { snapCoursePoint } = await import(new URL('src/sim/courseEditorObjectPlacement.js', document.baseURI).href);
      const app = window.__fw;
      const course = app.state.course;
      const scene = app.scene3d;
      const rect = scene.renderer.domElement.getBoundingClientRect();
      let best = null;
      for (let screenY = 135; screenY <= rect.bottom - 65; screenY += 24) {
        for (let screenX = 365; screenX <= rect.right - 45; screenX += 24) {
          const ground = scene.raycastGround(screenX, screenY);
          if (!ground?.inBounds) continue;
          const snapped = snapCoursePoint(ground.fx, ground.fy, { enabled: true, incrementYd: 1 });
          if (!snapped) continue;
          if (avoid && Math.hypot(snapped.x - avoid.x, snapped.y - avoid.y) < 1.2) continue;
          const legal = objectPlacementOk(course, objectType, snapped.x, snapped.y, {
            scale: objectScale,
            ignoreId: ignoredId,
          });
          if (!legal.ok) continue;
          const score = Math.hypot(screenX - rect.width * 0.67, screenY - rect.height * 0.54);
          if (!best || score < best.score) {
            best = { x: screenX, y: screenY, cell: snapped, score, legal };
          }
        }
      }
      return best;
    },
    {
      objectType: type,
      objectScale: scale,
      ignoredId: ignoreId,
      avoid: avoidCell,
    },
  );

  const placementGhost = () => page.evaluate(() => {
    const scene = window.__fw.scene3d.scene;
    let disc = null;
    scene.traverse((object) => {
      if (!disc && object.userData?.isDisc) disc = object;
    });
    const group = disc?.parent || null;
    return {
      exists: !!disc,
      visible: !!(disc?.visible && group?.visible),
      color: disc?.material?.color?.getHex?.() ?? null,
      position: group ? { x: group.position.x, y: group.position.y, z: group.position.z } : null,
      footprintScale: disc ? disc.scale.x : null,
    };
  });

  const samplePerformance = (durationMs = 1400) => page.evaluate((duration) => new Promise((resolve) => {
    const scene = window.__fw.scene3d;
    const started = performance.now();
    const deltas = [];
    let previous = started;
    const tick = (now) => {
      if (now > started) deltas.push(now - previous);
      previous = now;
      if (now - started < duration) {
        requestAnimationFrame(tick);
        return;
      }
      const ordered = [...deltas].sort((a, b) => a - b);
      const sum = deltas.reduce((total, value) => total + value, 0);
      const mean = sum / Math.max(1, deltas.length);
      const p99 = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.99))] || 0;
      const info = scene.renderer.info;
      resolve({
        durationMs: now - started,
        frames: deltas.length,
        averageFps: mean > 0 ? Number((1000 / mean).toFixed(2)) : 0,
        onePercentLowFps: p99 > 0 ? Number((1000 / p99).toFixed(2)) : 0,
        worstFrameMs: Number((Math.max(0, ...deltas)).toFixed(2)),
        renderer: {
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          calls: info.render.calls,
          triangles: info.render.triangles,
          points: info.render.points,
          lines: info.render.lines,
        },
        domNodes: document.getElementsByTagName('*').length,
        resources: performance.getEntriesByType('resource').length,
      });
    };
    requestAnimationFrame(tick);
  }), durationMs);

  const waitForRendererMemoryStable = async ({
    timeoutMs = 15000,
    intervalMs = 500,
    confirmations = 4,
    minimumDurationMs = 4500,
  } = {}) => {
    const started = Date.now();
    const samples = [];
    let previous = null;
    let unchanged = 0;
    while (Date.now() - started < timeoutMs) {
      await page.waitForTimeout(intervalMs);
      const current = await page.evaluate(() => {
        const info = window.__fw?.scene3d?.renderer?.info;
        return info ? {
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          resources: performance.getEntriesByType('resource').length,
        } : null;
      });
      samples.push(current);
      if (current && previous
        && current.geometries === previous.geometries
        && current.textures === previous.textures
        && current.resources === previous.resources) unchanged += 1;
      else unchanged = 0;
      previous = current;
      if (unchanged >= confirmations && Date.now() - started >= minimumDurationMs) {
        return { stable: true, durationMs: Date.now() - started, samples };
      }
    }
    return { stable: false, durationMs: Date.now() - started, samples };
  };

  const bootGame = async ({ navigate = true } = {}) => {
    expectedNavigation = true;
    if (navigate) await page.goto(baseUrl);
    await page.waitForFunction(() => document.readyState === 'complete');
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    await continueButton.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.trim() === 'Continue');
      return !!button && !button.disabled;
    }, null, { timeout: 90000 });
    await continueButton.click();
    await page.waitForFunction(() => window.__fw?.state?.course?.vec
      && window.__fw?.scene3d?.renderer
      && window.__fw?.editorUi?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => {
      const app = window.__fw;
      app.speedIdx = 0;
      app.scene3d.walk?.clearKeys?.();
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 11 * 60;
      if (app.state.weather) app.state.weather.locked = true;
      app.scene3d.applyTimeWeather?.(11 * 60, app.state.weather);
    });
    await settle(8);
    expectedNavigation = false;
  };

  const enterEditor = async () => {
    await page.keyboard.press('j');
    await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 15000 });
    await page.locator('.ced-root').waitFor({ state: 'visible', timeout: 15000 });
    await settle(10);
  };

  const selectHoleByIndex = async (index) => {
    await page.locator('.ced-holechip').click();
    const modal = page.locator('.ced-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    const cards = modal.locator('.ced-holecard');
    requireTruth(await cards.count() > index, `Hole card ${index + 1} is not available.`);
    await cards.nth(index).click();
    await modal.getByRole('button', { name: 'Frame it', exact: true }).click();
    await settle(12);
    return page.evaluate((holeIndex) => {
      const hole = window.__fw.state.course.holes[holeIndex];
      return hole ? { id: hole.id, name: hole.name, index: holeIndex } : null;
    }, index);
  };

  const cloneFeatureState = (holeId) => page.evaluate((selectedHoleId) => {
    const course = window.__fw.state.course;
    const hole = course.holes.find((candidate) => candidate.id === selectedHoleId);
    const vectorHole = course.vec?.holes?.find((candidate) => candidate.id === hole?.vecId);
    return JSON.parse(JSON.stringify({ hole, vectorHole }));
  }, holeId);

  const findBunker = (holeId, id, index) => page.evaluate(({ selectedHoleId, bunkerId, bunkerIndex }) => {
    const course = window.__fw.state.course;
    const hole = course.holes.find((candidate) => candidate.id === selectedHoleId);
    const vectorHole = course.vec?.holes?.find((candidate) => candidate.id === hole?.vecId);
    const bunkers = vectorHole?.bunkers || [];
    const feature = bunkerId == null
      ? bunkers[bunkerIndex]
      : bunkers.find((candidate) => candidate.id === bunkerId);
    return feature ? JSON.parse(JSON.stringify(feature)) : null;
  }, { selectedHoleId: holeId, bunkerId: id, bunkerIndex: index });

  const findWater = (id, index) => page.evaluate(({ waterId, waterIndex }) => {
    const waters = window.__fw.state.course.vec?.waters || [];
    const feature = waterId == null ? waters[waterIndex] : waters.find((candidate) => candidate.id === waterId);
    return feature ? JSON.parse(JSON.stringify(feature)) : null;
  }, { waterId: id, waterIndex: index });

  const pixelsDiffer = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
  const approximately = (actual, expected, epsilon = 0.08) => Math.abs(Number(actual) - Number(expected)) <= epsilon;

  let selectedHole = null;
  let baselinePerformance = null;
  let baselineRendererStability = null;
  let postReloadPerformance = null;
  let postReloadRendererStability = null;
  let finalPerformance = null;
  let persistedObject = null;
  let bridgePathId = null;
  let bridgeRoute = null;

  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await bootGame({ navigate: true });
    await enterEditor();
    selectedHole = await selectHoleByIndex(4); // Millpond: a deterministic green plus the authored pond.
    requireTruth(selectedHole, 'Could not select the deterministic Millpond fixture through the hole cards.');
    baselineRendererStability = await waitForRendererMemoryStable();
    requireTruth(baselineRendererStability.stable, 'Renderer resources did not stabilize before baseline sampling.', baselineRendererStability);
    await capture(
      'before-production-tools',
      'Before screenshot: untouched --bootstrap Millpond editor baseline at 1600x900.',
      { kind: 'before' },
    );
    baselinePerformance = await samplePerformance();

    await checkpoint('green edit and pin sockets', async () => {
      await useTool('Green');
      await selectCamera('green');
      await panelButton('Edit', 0);
      const greenRowEdit = toolPanel().locator('.ced-pathrow').first()
        .getByRole('button', { name: 'Edit', exact: true });
      if (await greenRowEdit.count()) {
        await greenRowEdit.click();
        await settle(5);
      }

      const before = await cloneFeatureState(selectedHole.id);
      let control = await featureControl('green', { holeId: selectedHole.id });
      if (!control) {
        await selectCamera('frame-hole');
        control = await featureControl('green', { holeId: selectedHole.id });
      }
      requireTruth(control, 'The selected green has no reachable boundary control.', before);
      await dragControl(control, 'green boundary drag');
      const fringe = await setRange('Fringe', 2.25);
      const apron = await setRange('Apron', 5);
      const raise = await setRange('Raise', 2.2);
      const contour = await selectInRow('Contour preset', 'soft-roll');

      await panelButton('B', 0);
      const pinCandidate = await greenPinCandidate(selectedHole.id, 'B');
      requireTruth(pinCandidate, 'No reachable legal pin-B position was found on the edited green.');
      await measureAction('pin socket placement', () => page.mouse.click(pinCandidate.x, pinCandidate.y));
      await settle(8);
      await toolPanel().getByRole('button', { name: 'Play B', exact: true }).click();
      await settle(6);

      const after = await cloneFeatureState(selectedHole.id);
      const screenshot = await capture(
        'green-boundary-contour-pin-b',
        'Edited green boundary/contour with pin socket B selected.',
      );
      const checks = {
        boundaryChanged: pixelsDiffer(before.vectorHole.green.pts, after.vectorHole.green.pts),
        fringeChanged: approximately(after.vectorHole.green.fringe, fringe, 0.3),
        apronChanged: approximately(after.vectorHole.green.apron, apron, 0.55),
        raiseChanged: approximately(after.vectorHole.green.raise, raise, 0.2),
        contourPresetChanged: contour === 'soft-roll'
          && after.vectorHole.green.contours?.some((item) => item.role === 'editor-soft-roll'),
        pinBChanged: pixelsDiffer(before.hole.pins?.B, after.hole.pins?.B),
        pinBActive: after.hole.activePin === 'B'
          && approximately(after.hole.pin?.x, after.hole.pins?.B?.x, 1e-6)
          && approximately(after.hole.pin?.y, after.hole.pins?.B?.y, 1e-6),
      };
      return requireChecks(checks, {
        before: { green: before.vectorHole.green, pinB: before.hole.pins?.B },
        after: { green: after.vectorHole.green, pinB: after.hole.pins?.B, activePin: after.hole.activePin },
        interaction: { control, pinCandidate, fringe, apron, raise, contour },
        screenshot: screenshot.path,
      });
    });

    await checkpoint('bunker edit delete and undo', async () => {
      await useTool('Bunker');
      await selectCamera('green');
      await panelButton('Edit', 0);
      let control = await featureControl('bunker', { holeId: selectedHole.id });
      if (!control) {
        await selectCamera('frame-hole');
        control = await featureControl('bunker', { holeId: selectedHole.id });
      }
      requireTruth(control, 'No Millpond bunker boundary is reachable from a production camera.');
      const rows = toolPanel().locator('.ced-pathrow');
      await rows.nth(control.recordIndex).getByRole('button', { name: 'Edit', exact: true }).click();
      await settle(4);
      // Edit selection may frame the retained feature. Reproject the handle
      // after that production camera move instead of dragging stale pixels.
      control = await featureControl('bunker', {
        holeId: selectedHole.id,
        recordIndex: control.recordIndex,
      });
      requireTruth(control, 'The selected bunker has no reachable control after feature framing.');
      const beforeFeature = await findBunker(selectedHole.id, control.id, control.recordIndex);
      const beforeCount = await rows.count();
      await dragControl(control, 'bunker boundary drag');
      const depth = await setRange('Depth', 3.2 * 10);
      const lip = await setRange('Lip', 1.4 * 10);
      const editedFeature = await findBunker(selectedHole.id, control.id, control.recordIndex);
      await measureAction('bunker delete', async () => {
        await toolPanel().getByRole('button', { name: 'Delete bunker', exact: true }).click();
        await settle(8);
      });
      const afterDeleteCount = await page.evaluate((holeId) => {
        const course = window.__fw.state.course;
        const hole = course.holes.find((candidate) => candidate.id === holeId);
        return course.vec?.holes?.find((candidate) => candidate.id === hole?.vecId)?.bunkers?.length || 0;
      }, selectedHole.id);
      const deletedScreenshot = await capture('bunker-deleted', 'Bunker deletion before Undo.');
      await measureAction('bunker undo', async () => {
        await page.locator('.ced-top-btn[title^="Undo"]').click();
        await settle(10);
      });
      const restoredFeature = await findBunker(selectedHole.id, control.id, control.recordIndex);
      const restoredScreenshot = await capture('bunker-restored-by-undo', 'Bunker restored through the top-bar Undo control.');
      const checks = {
        boundaryChanged: pixelsDiffer(beforeFeature?.pts, editedFeature?.pts),
        depthChanged: approximately(editedFeature?.depth, depth / 10, 0.12),
        lipChanged: approximately(editedFeature?.lip, lip / 10, 0.12),
        deleteReducedCount: afterDeleteCount === beforeCount - 1,
        undoRestored: !!restoredFeature && pixelsDiffer(beforeFeature?.pts, restoredFeature.pts),
        undoRetainedEdits: approximately(restoredFeature?.depth, editedFeature?.depth, 1e-7)
          && approximately(restoredFeature?.lip, editedFeature?.lip, 1e-7),
      };
      return requireChecks(checks, {
        control,
        beforeFeature,
        editedFeature,
        restoredFeature,
        counts: { before: beforeCount, afterDelete: afterDeleteCount },
        screenshots: [deletedScreenshot.path, restoredScreenshot.path],
      });
    });

    await checkpoint('water shoreline and stream editing', async () => {
      await useTool('Water');
      await selectCamera('green');
      await panelButton('Edit', 0);
      let waterControl = await featureControl('water', { holeId: selectedHole.id });
      if (!waterControl) {
        await selectCamera('frame-hole');
        waterControl = await featureControl('water', { holeId: selectedHole.id });
      }
      requireTruth(waterControl, 'No authored pond shoreline is reachable from the Millpond camera.');
      await toolPanel().locator('.ced-pathrow').nth(waterControl.displayIndex)
        .getByRole('button', { name: 'Edit', exact: true }).click();
      await settle(4);
      waterControl = await featureControl('water', {
        holeId: selectedHole.id,
        recordIndex: waterControl.recordIndex,
      });
      requireTruth(waterControl, 'The selected pond has no reachable shoreline after feature framing.');
      const waterBefore = await findWater(waterControl.id, waterControl.recordIndex);
      await dragControl(waterControl, 'pond shoreline drag');
      const waterDepthInput = await setRange('Depth', 5.6 * 10);
      const waterAfter = await findWater(waterControl.id, waterControl.recordIndex);

      await panelButton('Draw', 0);
      await panelButton('Stream', 0);
      const streamWidthInput = await setRange('Width', 8);
      const streamDepthInput = await setRange('Finished depth', 5 * 10);
      const route = await openRoute();
      requireTruth(route?.length === 3, 'No reachable open route was found for stream drawing.');
      const streamCountBefore = await page.evaluate(() => window.__fw.state.course.vec?.streams?.length || 0);
      await measureAction('stream draw and finish', async () => {
        for (const point of route) await page.mouse.click(point.x, point.y);
        await page.mouse.click(route[2].x, route[2].y, { button: 'right' });
        await settle(12);
      });
      const streamCountAfterDraw = await page.evaluate(() => window.__fw.state.course.vec?.streams?.length || 0);
      requireTruth(streamCountAfterDraw === streamCountBefore + 1, 'Normal pointer drawing did not add a stream.', {
        streamCountBefore,
        streamCountAfterDraw,
        route,
      });

      await panelButton('Edit', 0);
      const streamIndex = streamCountAfterDraw - 1;
      let streamControl = await featureControl('stream', { holeId: selectedHole.id, recordIndex: streamIndex });
      if (!streamControl) {
        await selectCamera('frame-hole');
        streamControl = await featureControl('stream', { holeId: selectedHole.id, recordIndex: streamIndex });
      }
      requireTruth(streamControl, 'The newly drawn stream has no reachable centerline control.');
      await toolPanel().locator('.ced-pathrow').nth(streamControl.displayIndex)
        .getByRole('button', { name: 'Edit', exact: true }).click();
      await settle(4);
      streamControl = await featureControl('stream', {
        holeId: selectedHole.id,
        recordIndex: streamIndex,
      });
      requireTruth(streamControl, 'The selected stream has no reachable centerline after feature framing.');
      const streamBeforeEdit = await page.evaluate((index) => JSON.parse(JSON.stringify(
        window.__fw.state.course.vec.streams[index],
      )), streamIndex);
      const editedStreamWidth = await setRange('Width', 10);
      await dragControl(streamControl, 'stream centerline drag');
      const streamAfterEdit = await page.evaluate((index) => JSON.parse(JSON.stringify(
        window.__fw.state.course.vec.streams[index],
      )), streamIndex);
      const screenshot = await capture(
        'water-shoreline-and-stream',
        'Edited pond shoreline plus a newly drawn and reshaped stream.',
      );
      const checks = {
        shorelineChanged: pixelsDiffer(waterBefore?.pts, waterAfter?.pts),
        waterDepthChanged: approximately(waterAfter?.depth, waterDepthInput / 10, 0.15),
        streamAdded: streamCountAfterDraw === streamCountBefore + 1,
        streamCreationWidthApplied: approximately(streamBeforeEdit?.w, streamWidthInput, 0.55),
        streamCreationDepthApplied: approximately(streamBeforeEdit?.depth, streamDepthInput / 10, 0.25),
        streamWidthEdited: approximately(streamAfterEdit?.w, editedStreamWidth, 0.55),
        streamCenterlineEdited: pixelsDiffer(streamBeforeEdit?.pts, streamAfterEdit?.pts),
      };
      return requireChecks(checks, {
        water: { before: waterBefore, after: waterAfter, control: waterControl },
        stream: { before: streamBeforeEdit, after: streamAfterEdit, control: streamControl, route },
        screenshot: screenshot.path,
      });
    });

    await checkpoint('path draw edit bridge delete and undo', async () => {
      await useTool('Paths');
      await selectCamera('green');
      await panelButton('Draw', 0);
      const drawWidth = await setRange('Width', 4 * 10);
      const drawMaterial = await selectInRow('Material', 'concrete');
      await setCheckbox('Bridge', true);
      const drawDeckMaterial = await selectInRow('Deck material', 'steel');
      await setCheckbox('Railings', true);
      const drawClearance = await setRange('Minimum clearance', 1.8 * 10);
      const drawSupportSpacing = await setRange('Support spacing', 10);

      bridgeRoute = await waterCrossingRoute();
      if (!bridgeRoute) {
        await selectCamera('frame-hole');
        bridgeRoute = await waterCrossingRoute();
      }
      requireTruth(bridgeRoute?.route?.length === 3, 'No reachable route crosses an authored water body for bridge QA.');
      const pathCountBefore = await page.evaluate(() => window.__fw.state.course.paths.length);
      await measureAction('bridge path draw and finish', async () => {
        for (const screen of bridgeRoute.screens) await page.mouse.click(screen.x, screen.y);
        await page.mouse.click(bridgeRoute.screens[2].x, bridgeRoute.screens[2].y, { button: 'right' });
        await settle(16);
      });
      const created = await page.evaluate(() => JSON.parse(JSON.stringify(window.__fw.state.course.paths.at(-1))));
      requireTruth(created && (await page.evaluate(() => window.__fw.state.course.paths.length)) === pathCountBefore + 1,
        'Normal pointer drawing did not create the bridge path.', { pathCountBefore, created, bridgeRoute });
      bridgePathId = created.id;

      await panelButton('Edit', 0);
      const pathRow = toolPanel().locator('.ced-pathrow').filter({ hasText: new RegExp(`^Path ${bridgePathId}\\b`) });
      await pathRow.getByRole('button', { name: 'Edit', exact: true }).click();
      await settle(5);
      const editWidth = await setRange('Width', 4.6 * 10);
      const editMaterial = await selectInRow('Material', 'gravel');
      const editDeckMaterial = await selectInRow('Deck material', 'timber');
      await setCheckbox('Railings', false);
      const railingsRestored = await setCheckbox('Railings', true);
      const editClearance = await setRange('Minimum clearance', 2.2 * 10);
      const editSupportSpacing = await setRange('Support spacing', 8);
      let pathControl = await featureControl('path', { pathId: bridgePathId });
      if (!pathControl) {
        await selectCamera('frame-hole');
        pathControl = await featureControl('path', { pathId: bridgePathId });
      }
      requireTruth(pathControl, 'The selected bridge path has no reachable centerline control.');
      const beforeDrag = await page.evaluate((id) => JSON.parse(JSON.stringify(
        window.__fw.state.course.paths.find((candidate) => candidate.id === id),
      )), bridgePathId);
      await dragControl(pathControl, 'bridge path centerline drag');
      const edited = await page.evaluate((id) => JSON.parse(JSON.stringify(
        window.__fw.state.course.paths.find((candidate) => candidate.id === id),
      )), bridgePathId);
      const bridgeScreenshot = await capture(
        'authored-bridge-path',
        'Bridge path after selected width/material/deck/rail/support edits and centerline drag.',
      );

      await measureAction('bridge path delete', async () => {
        await toolPanel().getByRole('button', { name: 'Delete path', exact: true }).click();
        await settle(10);
      });
      const deleted = await page.evaluate((id) => !window.__fw.state.course.paths.some((candidate) => candidate.id === id), bridgePathId);
      const deletedScreenshot = await capture('bridge-path-deleted', 'Selected bridge path deleted through its production control.');
      await measureAction('bridge path undo', async () => {
        await page.locator('.ced-top-btn[title^="Undo"]').click();
        await settle(14);
      });
      const restored = await page.evaluate((id) => {
        const found = window.__fw.state.course.paths.find((candidate) => candidate.id === id);
        return found ? JSON.parse(JSON.stringify(found)) : null;
      }, bridgePathId);
      const restoredScreenshot = await capture('bridge-path-restored', 'Bridge path restored through top-bar Undo.');

      const checks = {
        pathAdded: !!created && created.id === bridgePathId,
        drawWidthApplied: approximately(created?.width, drawWidth / 10, 0.15),
        drawMaterialApplied: created?.material === drawMaterial,
        drawBridgeApplied: created?.bridge?.enabled === true
          && created.bridge.deckMaterial === drawDeckMaterial
          && approximately(created.bridge.clearanceFt, drawClearance / 10, 0.15)
          && approximately(created.bridge.supportSpacingYd, drawSupportSpacing, 0.6),
        selectedWidthEdited: approximately(edited?.width, editWidth / 10, 0.15),
        selectedMaterialEdited: edited?.material === editMaterial,
        selectedBridgeEdited: edited?.bridge?.deckMaterial === editDeckMaterial
          && edited.bridge.railings === railingsRestored
          && approximately(edited.bridge.clearanceFt, editClearance / 10, 0.15)
          && approximately(edited.bridge.supportSpacingYd, editSupportSpacing, 0.6),
        centerlineEdited: pixelsDiffer(beforeDrag?.pts, edited?.pts),
        deleteWorked: deleted,
        undoRestoredExactEdit: !!restored && JSON.stringify(restored) === JSON.stringify(edited),
      };
      return requireChecks(checks, {
        bridgeRoute,
        drawControls: { drawWidth, drawMaterial, drawDeckMaterial, drawClearance, drawSupportSpacing },
        editControls: { editWidth, editMaterial, editDeckMaterial, editClearance, editSupportSpacing, railingsRestored },
        created,
        edited,
        restored,
        pathControl,
        screenshots: [bridgeScreenshot.path, deletedScreenshot.path, restoredScreenshot.path],
      });
    });

    await checkpoint('object snap ghost transforms and save reload', async () => {
      await useTool('Objects');
      await panelButton('Props', 0);
      await panelButton('Bench', 0);
      await panelButton('1 yd', 0);
      await setCheckbox('Random rotation', false);
      const size = await setRange('Size', 100);
      let firstCandidate = await objectCandidate({ type: 'bench', scale: size / 100 });
      if (!firstCandidate) {
        await selectCamera('course-overview');
        firstCandidate = await objectCandidate({ type: 'bench', scale: size / 100 });
      }
      requireTruth(firstCandidate, 'No collision-safe visible bench placement exists in the deterministic fixture.');
      await page.mouse.move(firstCandidate.x, firstCandidate.y);
      await settle(6);
      const validGhost = await placementGhost();
      const validGhostScreenshot = await capture(
        'bench-valid-snap-ghost',
        'Green one-yard-snapped placement ghost for a Bench.',
      );
      const objectCountBefore = await page.evaluate(() => window.__fw.state.course.objects.length);
      await measureAction('object placement', async () => {
        await page.mouse.click(firstCandidate.x, firstCandidate.y);
        await settle(12);
      });
      const placed = await page.evaluate(() => JSON.parse(JSON.stringify(window.__fw.state.course.objects.at(-1))));
      const objectCountAfterPlace = await page.evaluate(() => window.__fw.state.course.objects.length);

      await page.mouse.move(firstCandidate.x, firstCandidate.y);
      await settle(6);
      const invalidGhost = await placementGhost();
      const invalidGhostScreenshot = await capture(
        'bench-collision-ghost',
        'Red collision ghost over the just-placed Bench.',
      );
      await measureAction('object collision rejection', async () => {
        await page.mouse.click(firstCandidate.x, firstCandidate.y);
        await settle(8);
      });
      const objectCountAfterRejectedClick = await page.evaluate(() => window.__fw.state.course.objects.length);

      await useTool('Select');
      const placedScreen = (await projectCells([{ x: placed.x, y: placed.y }]))[0];
      requireTruth(placedScreen?.safe, 'The placed Bench is not reachable for Select-tool movement.', placedScreen);
      const moveCandidate = await objectCandidate({
        type: 'bench',
        scale: placed.scale,
        ignoreId: placed.id,
        avoidCell: { x: placed.x, y: placed.y },
      });
      requireTruth(moveCandidate, 'No second collision-safe snapped location exists for moving the Bench.');
      await measureAction('object move', async () => {
        await page.mouse.move(placedScreen.x, placedScreen.y);
        await page.mouse.down();
        await page.mouse.move(moveCandidate.x, moveCandidate.y, { steps: 14 });
        await page.mouse.up();
        await settle(12);
      });
      const moved = await page.evaluate((id) => JSON.parse(JSON.stringify(
        window.__fw.state.course.objects.find((object) => object.id === id),
      )), placed.id);
      const rotate = await measureAction('object rotate', () => setRange('Rotate', 90));
      const scale = await measureAction('object scale', () => setRange('Scale', 125));
      const transformed = await page.evaluate((id) => JSON.parse(JSON.stringify(
        window.__fw.state.course.objects.find((object) => object.id === id),
      )), placed.id);

      const countBeforeDuplicate = await page.evaluate(() => window.__fw.state.course.objects.length);
      await measureAction('object duplicate', async () => {
        await toolPanel().getByRole('button', { name: 'Duplicate', exact: true }).click();
        await settle(12);
      });
      const countAfterDuplicate = await page.evaluate(() => window.__fw.state.course.objects.length);
      const duplicate = await page.evaluate(() => JSON.parse(JSON.stringify(window.__fw.state.course.objects.at(-1))));
      await measureAction('object remove', async () => {
        await toolPanel().getByRole('button', { name: 'Remove', exact: true }).click();
        await settle(12);
      });
      const countAfterRemove = await page.evaluate(() => window.__fw.state.course.objects.length);
      const transformedScreenshot = await capture(
        'bench-moved-rotated-scaled',
        'Bench after snapped move, rotation, scale, duplicate, and duplicate removal.',
      );

      persistedObject = transformed;
      await page.locator('.ced-top-btn[title="Save the course"]').click();
      const saveModal = page.locator('.ced-modal');
      await saveModal.waitFor({ state: 'visible', timeout: 5000 });
      const primarySave = saveModal.getByRole('button', { name: /^(Build & save|Save)$/ });
      const saveAction = (await primarySave.textContent())?.trim();
      await measureAction('course build and save', async () => {
        await primarySave.click();
        await saveModal.waitFor({ state: 'hidden', timeout: 30000 });
        await settle(10);
      });

      expectedNavigation = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await bootGame({ navigate: false });
      await enterEditor();
      selectedHole = await selectHoleByIndex(4);
      postReloadRendererStability = await waitForRendererMemoryStable();
      requireTruth(postReloadRendererStability.stable,
        'Renderer resources did not stabilize after the save/reload cycle.', postReloadRendererStability);
      postReloadPerformance = await samplePerformance();
      const reloaded = await page.evaluate((id) => {
        const object = window.__fw.state.course.objects.find((candidate) => candidate.id === id);
        return object ? JSON.parse(JSON.stringify(object)) : null;
      }, persistedObject.id);
      const reloadScreenshot = await capture(
        'bench-after-save-reload',
        'Saved transformed Bench after a normal page reload and Continue/editor re-entry.',
      );
      const checks = {
        validGhostGreen: validGhost.visible && validGhost.color === 0x7fd66b,
        snapApplied: Number.isInteger(Math.round(placed.x * 8))
          && approximately(placed.x * 8, Math.round(placed.x * 8), 1e-7)
          && approximately(placed.y * 8, Math.round(placed.y * 8), 1e-7),
        placedOnce: objectCountAfterPlace === objectCountBefore + 1 && placed.type === 'bench',
        invalidGhostRed: invalidGhost.visible && invalidGhost.color === 0xd84b3a,
        collisionClickRejected: objectCountAfterRejectedClick === objectCountAfterPlace,
        moved: !approximately(moved.x, placed.x, 0.01) || !approximately(moved.y, placed.y, 0.01),
        movedOnSnap: approximately(moved.x * 8, Math.round(moved.x * 8), 1e-7)
          && approximately(moved.y * 8, Math.round(moved.y * 8), 1e-7),
        rotated: approximately(transformed.rot, (rotate * Math.PI) / 180, 0.03),
        scaled: approximately(transformed.scale, scale / 100, 0.03),
        duplicated: countAfterDuplicate === countBeforeDuplicate + 1 && duplicate.id !== placed.id,
        duplicateRemoved: countAfterRemove === countBeforeDuplicate,
        saveReloadWithinSerializedPrecision: !!reloaded
          && approximately(reloaded.x, transformed.x, 5.1e-4)
          && approximately(reloaded.y, transformed.y, 5.1e-4)
          && approximately(reloaded.rot, transformed.rot, 5.1e-4)
          && approximately(reloaded.scale, transformed.scale, 5.1e-4),
        saveRouteUsed: saveAction === 'Build & save' || saveAction === 'Save',
      };
      return requireChecks(checks, {
        firstCandidate,
        validGhost,
        invalidGhost,
        placed,
        moved,
        transformed,
        duplicate,
        reloaded,
        saveAction,
        counts: {
          before: objectCountBefore,
          afterPlace: objectCountAfterPlace,
          afterRejectedClick: objectCountAfterRejectedClick,
          beforeDuplicate: countBeforeDuplicate,
          afterDuplicate: countAfterDuplicate,
          afterRemove: countAfterRemove,
        },
        screenshots: [
          validGhostScreenshot.path,
          invalidGhostScreenshot.path,
          transformedScreenshot.path,
          reloadScreenshot.path,
        ],
      });
    });

    await checkpoint('selected tee playtest and bridge surface', async () => {
      requireTruth(await page.evaluate(() => window.__fw.editorUi().isActive()), 'Editor is not active for playtest QA.');
      const bridgeSurface = await page.evaluate(({ pathId, route }) => {
        if (pathId == null || !route?.route?.length) return null;
        const course = window.__fw.state.course;
        const scene = window.__fw.scene3d;
        const path = course.paths.find((candidate) => candidate.id === pathId);
        if (!path) return { pathMissing: true };
        const start = path.pts[0];
        const center = path.pts[Math.floor(path.pts.length / 2)];
        const end = path.pts.at(-1);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy) || 1;
        const normal = { x: -dy / length, y: dx / length };
        const sample = (cell) => {
          const x = scene.vectorWorldX(cell.x);
          const z = scene.vectorWorldZ(cell.y);
          const bridge = scene.bridgeSurfaceAtWorld?.(x, z) || null;
          return {
            cell,
            rawZone: scene.zoneAtWorld(x, z),
            playZone: scene.playZoneAtWorld?.(x, z) ?? scene.zoneAtWorld(x, z),
            rawHeight: scene.heightAt(x, z),
            playHeight: scene.playHeightAt?.(x, z) ?? scene.heightAt(x, z),
            bridge: bridge ? {
              zone: bridge.zone,
              pathId: bridge.pathId,
              deckHeightYd: bridge.deckHeightYd,
              bridgeT: bridge.bridgeT,
            } : null,
          };
        };
        return {
          path: JSON.parse(JSON.stringify(path)),
          center: sample(center),
          adjacentPositive: sample({ x: center.x + normal.x, y: center.y + normal.y }),
          adjacentNegative: sample({ x: center.x - normal.x, y: center.y - normal.y }),
          bridgeMesh: !!scene.scene.getObjectByName(`coursePathBridge:${pathId}`),
          deckMesh: !!scene.scene.getObjectByName('bridge-deck'),
        };
      }, { pathId: bridgePathId, route: bridgeRoute });
      const bridgeScreenshot = await capture(
        'bridge-surface-before-playtest',
        'Saved bridge path used for deck PATH-versus-adjacent-WATER surface verification.',
      );

      await useTool('Tee');
      await panelButton('Middle', 0);
      const teeBefore = await page.evaluate((holeId) => {
        const hole = window.__fw.state.course.holes.find((candidate) => candidate.id === holeId);
        return hole ? JSON.parse(JSON.stringify(hole.tees.middle)) : null;
      }, selectedHole.id);
      requireTruth(teeBefore, 'The deterministic selected hole has no built middle tee.');
      await toolPanel().getByRole('button', { name: 'Play this tee', exact: true }).click();
      await settle(8);
      const selectedTeeState = await page.evaluate((holeId) => {
        const hole = window.__fw.state.course.holes.find((candidate) => candidate.id === holeId);
        return hole ? { activeTee: hole.activeTee, tee: JSON.parse(JSON.stringify(hole.tee)) } : null;
      }, selectedHole.id);
      const editorBeforePlaytest = await page.evaluate(() => {
        const rig = window.__fw.scene3d.rig;
        return {
          cameraView: document.querySelector('.ced-camera')?.value || null,
          target: { x: rig.target.x, y: rig.target.y, z: rig.target.z },
          yaw: rig.yaw,
          pitch: rig.pitch,
          dist: rig.dist,
        };
      });
      await page.getByRole('button', { name: 'Playtest', exact: true }).click();
      await page.waitForFunction(() => window.__fw.editorUi().isPlaytesting(), null, { timeout: 10000 });
      await settle(10);
      const playtestStart = await page.evaluate(() => {
        const app = window.__fw;
        const pt = app.editorUi().qa.playtest();
        const hole = app.state.course.holes.find((candidate) => candidate.id === pt?.holeId);
        const expectedX = app.scene3d.worldX(hole.tee.x - 0.5);
        const expectedZ = app.scene3d.worldZ(hole.tee.y - 0.5);
        return {
          holeId: pt?.holeId ?? null,
          activeTee: hole?.activeTee ?? null,
          ball: pt ? { x: pt.ball.x, y: pt.ball.y, z: pt.ball.z } : null,
          expectedTeeWorld: { x: expectedX, z: expectedZ },
          hudVisible: getComputedStyle(document.querySelector('.ced-pt')).display !== 'none',
          ballMeshVisible: [...app.scene3d.scene.children].some((object) => object.visible
            && object.isMesh
            && object.geometry?.type === 'SphereGeometry'
            && Math.abs(object.geometry.parameters?.radius - 0.035) < 1e-6),
        };
      });
      const teeScreenshot = await capture(
        'selected-middle-tee-playtest',
        'Playtest entered from the selected middle tee with HUD and ball visible.',
      );
      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      requireTruth(canvasBox, 'Playtest canvas is not measurable.');
      await page.mouse.move(canvasBox.x + canvasBox.width * 0.63, canvasBox.y + canvasBox.height * 0.57);
      await page.mouse.down();
      await page.waitForTimeout(420);
      await page.mouse.up();
      await page.waitForFunction(() => window.__fw.editorUi().qa.playtest()?.strokes >= 1, null, { timeout: 10000 });
      await settle(12);
      const playtestAfterStrike = await page.evaluate(() => {
        const pt = window.__fw.editorUi().qa.playtest();
        return pt ? { strokes: pt.strokes, phase: pt.phase, surface: pt.surface, events: [...pt.events] } : null;
      });
      const strikeScreenshot = await capture(
        'selected-tee-normal-swing',
        'Normal hold-and-release LMB swing from the selected middle tee.',
      );
      await page.getByRole('button', { name: /Editor/ }).click();
      await page.waitForFunction(() => !window.__fw.editorUi().isPlaytesting(), null, { timeout: 10000 });
      await settle(8);
      const editorAfterReturn = await page.evaluate(() => {
        const rig = window.__fw.scene3d.rig;
        const visible = (selector) => {
          const node = document.querySelector(selector);
          return !!node && getComputedStyle(node).display !== 'none';
        };
        return {
          cameraView: document.querySelector('.ced-camera')?.value || null,
          target: { x: rig.target.x, y: rig.target.y, z: rig.target.z },
          yaw: rig.yaw,
          pitch: rig.pitch,
          dist: rig.dist,
          topVisible: visible('.ced-top'),
          toolsVisible: visible('.ced-left'),
          playtestHudHidden: !visible('.ced-pt'),
        };
      });

      const ZONE_WATER = 6;
      const ZONE_PATH = 7;
      const adjacentSamples = [bridgeSurface?.adjacentPositive, bridgeSurface?.adjacentNegative].filter(Boolean);
      const checks = {
        bridgePathPersisted: !!bridgeSurface?.path && bridgeSurface.path.id === bridgePathId,
        bridgeMeshPresent: bridgeSurface?.bridgeMesh === true && bridgeSurface?.deckMesh === true,
        bridgeDeckIsPath: bridgeSurface?.center?.bridge?.pathId === bridgePathId
          && bridgeSurface.center.bridge.zone === ZONE_PATH
          && bridgeSurface.center.playZone === ZONE_PATH
          && bridgeSurface.center.playHeight > bridgeSurface.center.rawHeight,
        adjacentWaterRemainsHazard: adjacentSamples.some((sample) => sample.rawZone === ZONE_WATER
          && sample.playZone === ZONE_WATER
          && sample.bridge === null),
        middleTeeSelected: selectedTeeState?.activeTee === 'middle'
          && approximately(selectedTeeState?.tee?.x, teeBefore.x, 1e-8)
          && approximately(selectedTeeState?.tee?.y, teeBefore.y, 1e-8),
        playtestUsesSelectedHole: playtestStart.holeId === selectedHole.id && playtestStart.activeTee === 'middle',
        playtestBallAtSelectedTee: approximately(playtestStart.ball?.x, playtestStart.expectedTeeWorld.x, 1e-6)
          && approximately(playtestStart.ball?.z, playtestStart.expectedTeeWorld.z, 1e-6),
        playtestFeedbackVisible: playtestStart.hudVisible && playtestStart.ballMeshVisible,
        normalSwingRegistered: playtestAfterStrike?.strokes === 1,
        returnedToEditor: await page.evaluate(() => window.__fw.editorUi().isActive()
          && !window.__fw.editorUi().isPlaytesting()),
        exactCameraRestored: editorAfterReturn.cameraView === editorBeforePlaytest.cameraView
          && approximately(editorAfterReturn.target.x, editorBeforePlaytest.target.x, 1e-6)
          && approximately(editorAfterReturn.target.y, editorBeforePlaytest.target.y, 1e-6)
          && approximately(editorAfterReturn.target.z, editorBeforePlaytest.target.z, 1e-6)
          && approximately(editorAfterReturn.yaw, editorBeforePlaytest.yaw, 1e-6)
          && approximately(editorAfterReturn.pitch, editorBeforePlaytest.pitch, 1e-6)
          && approximately(editorAfterReturn.dist, editorBeforePlaytest.dist, 1e-6),
        editorChromeRestored: editorAfterReturn.topVisible
          && editorAfterReturn.toolsVisible
          && editorAfterReturn.playtestHudHidden,
      };
      return requireChecks(checks, {
        bridgeSurface,
        selectedTeeState,
        editorBeforePlaytest,
        editorAfterReturn,
        playtestStart,
        playtestAfterStrike,
        screenshots: [bridgeScreenshot.path, teeScreenshot.path, strikeScreenshot.path],
      });
    });

    finalPerformance = await samplePerformance();
    const finalScreenshot = await capture(
      'after-production-tools',
      'After screenshot: final Course Editor state after all production-tool checkpoints.',
      { kind: 'after' },
    );

    const videoActive = !!page.video();
    const performanceChecks = {
      finalAverageFpsAtLeast30: finalPerformance.averageFps >= 30,
      noSevereAverageFpsRegression: finalPerformance.averageFps >= baselinePerformance.averageFps * 0.65,
      finalOnePercentLowAtLeast12: finalPerformance.onePercentLowFps >= 12,
      geometryGrowthBoundedAcrossReload: finalPerformance.renderer.geometries
        <= (postReloadPerformance || baselinePerformance).renderer.geometries + 24,
      textureGrowthBoundedAcrossReload: finalPerformance.renderer.textures
        <= (postReloadPerformance || baselinePerformance).renderer.textures + 12,
    };
    const checks = {
      headedRequested: process.env.HEADED === '1',
      videoDirectoryConfigured: !!process.env.VIDEO_DIR,
      videoCaptureActive: videoActive,
      resolution1600x900: page.viewportSize()?.width === 1600
        && page.viewportSize()?.height === 900
        && await page.evaluate(() => Math.abs(devicePixelRatio - 1) < 1e-4),
      allProductionCheckpointsPassed: checkpoints.length === 6 && checkpoints.every((item) => item.ok),
      consoleErrorsClean: diagnostics.consoleErrors.length === 0,
      pageErrorsClean: diagnostics.pageErrors.length === 0,
      failedRequestsClean: diagnostics.requestFailures.length === 0,
      httpErrorsClean: diagnostics.httpErrors.length === 0,
      screenshotsWritten: captures.length >= 12 && captures.every((item) => fs.existsSync(item.path)),
      performanceWithinGate: Object.values(performanceChecks).every(Boolean),
    };
    const result = {
      ok: Object.values(checks).every(Boolean),
      suite: 'course-editor-production-tools',
      phase,
      startedAt,
      finishedAt: new Date().toISOString(),
      fixture: {
        source: 'tools/qa/run-playwright.cjs --bootstrap',
        empireMode: 'relaxed',
        seed: 424242,
        property: 'Willow Creek',
        cash: 10_000_000,
        selectedHole: selectedHole,
        deterministicEnvironmentOnly: ['clock paused at 11:00', 'weather locked'],
        gameplayMutations: 'All production-tool mutations use visible editor controls and canvas pointer input.',
      },
      browser: {
        userAgent: await page.evaluate(() => navigator.userAgent),
        headedRequested: process.env.HEADED === '1',
        viewport: page.viewportSize(),
        deviceScaleFactor: await page.evaluate(() => devicePixelRatio),
      },
      artifacts: {
        outputDirectory: outDir,
        resultJson: canonicalResultPath,
        configuredResultJson: configuredResultPath,
        videoDirectory,
        videoCaptureActive: videoActive,
        videoFinalization: 'The Playwright runner finalizes the .webm when it closes the browser context after this function returns.',
        finalScreenshot: finalScreenshot.path,
        captures,
      },
      checks,
      checkpoints,
      blockers,
      performance: {
        baseline: baselinePerformance,
        baselineRendererStability,
        postReload: postReloadPerformance,
        postReloadRendererStability,
        final: finalPerformance,
        actionTimings,
        ratio: {
          averageFps: Number((finalPerformance.averageFps / Math.max(0.01, baselinePerformance.averageFps)).toFixed(3)),
          onePercentLowFps: Number((finalPerformance.onePercentLowFps
            / Math.max(0.01, baselinePerformance.onePercentLowFps)).toFixed(3)),
        },
        checks: performanceChecks,
      },
      diagnostics,
      visualReview: {
        status: 'human-review-required',
        acceptanceClaim: false,
        rationale: 'The driver captures repeatable evidence and functional assertions; screenshots and WebM still require human visual review.',
        reviewFocus: [
          'green, bunker, pond, stream, and path control-point feedback',
          'bridge deck/support/rail geometry and water clearance',
          'green/red object ghost legibility and transformed Bench placement',
          'selected-tee HUD, ball visibility, camera, and swing feedback',
        ],
      },
    };
    writeResult(result);
    return result;
  } catch (error) {
    const fatal = {
      message: error?.message || String(error),
      stack: error?.stack || null,
      at: new Date().toISOString(),
    };
    blockers.push({ checkpoint: 'fatal driver error', ...fatal });
    try {
      fatal.screenshot = (await capture(
        'fatal-driver-error',
        `Fatal driver error: ${fatal.message}`,
        { blocker: true },
      )).path;
    } catch (captureError) {
      fatal.captureError = captureError?.message || String(captureError);
    }
    const result = {
      ok: false,
      suite: 'course-editor-production-tools',
      phase,
      startedAt,
      finishedAt: new Date().toISOString(),
      fatal,
      checks: {
        driverCompleted: false,
        headedRequested: process.env.HEADED === '1',
        videoDirectoryConfigured: !!process.env.VIDEO_DIR,
        videoCaptureActive: !!page.video(),
      },
      artifacts: {
        outputDirectory: outDir,
        resultJson: canonicalResultPath,
        configuredResultJson: configuredResultPath,
        videoDirectory,
        captures,
      },
      checkpoints,
      blockers,
      performance: { baseline: baselinePerformance, final: finalPerformance, actionTimings },
      diagnostics,
      visualReview: {
        status: 'blocked',
        acceptanceClaim: false,
      },
    };
    writeResult(result);
    return result;
  }
}

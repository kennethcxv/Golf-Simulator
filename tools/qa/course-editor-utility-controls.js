// Runtime audit for the Course Editor's utility controls and transaction shell.
// Every mutation is made through visible controls and is discarded before exit.
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
      await useTool('Paint');
      await page.locator('.ced-tool-panel').getByRole('button', { name: 'Dirt', exact: true }).click();
      await measureAction('utility paint stroke', async () => {
        await page.mouse.move(points[1].x, points[1].y);
        await page.mouse.down();
        await page.mouse.move(points[1].x + 28, points[1].y + 8, { steps: 8 });
        await page.mouse.up();
        await settle(8);
      });
      const afterStrokes = await fingerprint();
      const dirtyVisible = await page.getByRole('button', { name: 'Discard', exact: true }).first().isVisible();
      requireTruth(JSON.stringify(afterStrokes) !== JSON.stringify(baseline), 'Terrain/Paint strokes changed no course data.');
      requireTruth(dirtyVisible, 'Pending-work controls did not appear after live strokes.');
      return { afterStrokes, dirtyVisible };
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

    const finalPerformance = await sampleIdle();
    await capture('after_exact_discard', 'After: exact clean baseline restored without leaving the editor.');
    const checks = {
      allCheckpointsPassed: checkpoints.length === 6 && checkpoints.every((item) => item.ok),
      exactDiscard: checkpoints.at(-1)?.evidence?.exact === true,
      discardFrameBounded: discardFrames?.framesOver100ms === 0,
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
      performance: { actionTimings },
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

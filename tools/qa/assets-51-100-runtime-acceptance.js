async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(repo, process.env.ASSET_RUNTIME_ACCEPTANCE_OUT
    || 'qa/assets_51_100_master/runtime_acceptance/current');
  fs.mkdirSync(out, { recursive: true });

  const viewport = { width: 1600, height: 900 };
  const diagnostics = [];
  const captures = [];
  const interactionResults = [];
  const toolResults = [];
  const checks = {};
  let blocker = null;
  let captureStarted = null;
  let mediaCapture = null;

  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      diagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => diagnostics.push({
    kind: 'requestfailed',
    message: `${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  }));

  const requireCheck = (condition, message, evidence = null) => {
    if (condition) return;
    const error = new Error(message);
    error.evidence = evidence;
    throw error;
  };

  async function capture(file) {
    const output = path.join(out, file);
    await page.screenshot({ path: output });
    captures.push(output);
    return output;
  }

  async function waitForRuntime() {
    await page.waitForFunction(() => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      const runtime = clubhouse?.assets51to100Runtime?.diagnostics?.();
      const viewmodels = app?.scene3d?.walk?.toolViewmodelDiagnostics?.();
      return runtime?.placed === 40 && runtime?.failed === 0
        && viewmodels?.authoredCount === 9;
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || getComputedStyle(veil).display === 'none'
        || parseFloat(getComputedStyle(veil).opacity) < 0.02;
    }, null, { timeout: 90000 });
    await page.waitForTimeout(700);
  }

  async function boot({ reload = false } = {}) {
    if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
    else await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText('Continue', { exact: true }).click();
    await waitForRuntime();
    await page.locator('#game').click({
      position: { x: viewport.width / 2, y: viewport.height / 2 },
      force: true,
    });
    const locked = await page.waitForFunction(() => (
      document.pointerLockElement === document.getElementById('game')
    ), null, { timeout: 1200 }).then(() => true).catch(() => false);
    if (!locked) {
      await page.evaluate(() => {
        const hint = document.querySelector('.shop-lockhint');
        if (hint) hint.style.visibility = 'hidden';
      });
    }
    await page.waitForTimeout(180);
    return locked;
  }

  async function targetFor(assetNumber, suffix = '') {
    return page.evaluate(({ number, wantedSuffix }) => {
      const targets = window.__fw.scene3d.clubhouse().assets51to100Runtime.interactionTargets();
      return targets.find((target) => target.assetNumber === number
        && (target.suffix || '') === wantedSuffix) || null;
    }, { number: assetNumber, wantedSuffix: suffix });
  }

  async function focusTarget(assetNumber, suffix = '') {
    const target = await targetFor(assetNumber, suffix);
    requireCheck(target, `Asset ${assetNumber}${suffix ? `/${suffix}` : ''} has no interaction target.`);
    const angles = [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4,
      -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4];
    for (const angle of angles) {
      const established = await page.evaluate(({ focus, candidateAngle }) => {
        const app = window.__fw;
        const walk = app.scene3d.walk;
        const radius = Math.min(1.30, Math.max(0.82, focus.radius - 0.35));
        const x = focus.x + Math.sin(candidateAngle) * radius;
        const z = focus.z + Math.cos(candidateAngle) * radius;
        if (!walk.isFree(x, z, 0.30)) return false;
        walk.clearKeys?.();
        walk.state.x = x;
        walk.state.z = z;
        const dx = focus.x - x;
        const dz = focus.z - z;
        const horizontal = Math.hypot(dx, dz) || 1;
        walk.state.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
        const floorY = app.scene3d.clubhouse().interior.position.y;
        const eyeY = floorY + walk.state.eye;
        walk.state.pitch = Math.max(-1.10, Math.min(0.72,
          Math.atan2((focus.aimY ?? floorY) - eyeY, horizontal)));
        return true;
      }, { focus: target, candidateAngle: angle });
      if (!established) continue;
      await page.waitForTimeout(220);
      const focused = await page.evaluate(() => {
        const focus = window.__fw.scene3d.walk.getFocus?.();
        return focus?.kind === 'prop' ? {
          assetNumber: focus.prop?.userData?.assetNumber || null,
          suffix: focus.prop?.userData?.suffix || '',
          label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
        } : null;
      });
      if (focused?.assetNumber === assetNumber && (focused.suffix || '') === suffix) {
        return { target, focused, angle };
      }
    }
    const observed = await page.evaluate(() => ({
      label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
      pose: { ...window.__fw.scene3d.walk.state },
    }));
    requireCheck(false, `Could not focus Asset ${assetNumber}${suffix ? `/${suffix}` : ''}.`, observed);
    return null;
  }

  async function nodePose(assetNumber) {
    return page.evaluate((number) => {
      const root = window.__fw.scene3d.clubhouse().assets51to100Runtime.getRoot(number);
      if (!root) return null;
      const nodes = {};
      root.traverse((object) => {
        if (!object.name || /^(?:SOCKET_|COL_|COLLISION_|VOLUME_)/u.test(object.name)) return;
        nodes[object.name] = [
          object.position.x, object.position.y, object.position.z,
          object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w,
          object.scale.x, object.scale.y, object.scale.z,
        ];
      });
      return nodes;
    }, assetNumber);
  }

  function poseDelta(before, after) {
    let delta = 0;
    for (const [name, values] of Object.entries(before || {})) {
      const next = after?.[name];
      if (!next) continue;
      for (let index = 0; index < values.length; index += 1) {
        delta = Math.max(delta, Math.abs(values[index] - next[index]));
      }
    }
    return delta;
  }

  async function stateFor(assetNumber) {
    return page.evaluate((number) => {
      const key = `asset_${String(number).padStart(3, '0')}`;
      return structuredClone(window.__fw.state.shop?.assetRuntime?.[key] || {});
    }, assetNumber);
  }

  async function useWorldInteraction(assetNumber) {
    const focus = await focusTarget(assetNumber);
    const beforeState = await stateFor(assetNumber);
    const beforePose = await nodePose(assetNumber);
    await page.keyboard.down('e');
    await page.waitForTimeout(30);
    await page.keyboard.up('e');
    await page.waitForTimeout(160);
    const movingPose = await nodePose(assetNumber);
    await page.waitForTimeout(520);
    const afterState = await stateFor(assetNumber);
    const result = {
      assetNumber,
      label: focus.focused.label,
      beforeState,
      afterState,
      animationDelta: poseDelta(beforePose, movingPose),
    };
    requireCheck(JSON.stringify(beforeState) !== JSON.stringify(afterState),
      `Asset ${assetNumber} did not change its persisted interaction state.`, result);
    requireCheck(result.animationDelta > 0.00001,
      `Asset ${assetNumber} state changed but its authored animation did not move.`, result);
    interactionResults.push(result);
    return result;
  }

  async function useTool(assetNumber, tool, suffix = '') {
    const focus = await focusTarget(assetNumber, suffix);
    await page.keyboard.press('e');
    await page.waitForFunction((expected) => (
      window.__fw.scene3d.walk.getTool?.() === expected
    ), tool, { timeout: 3000 });
    const stateBeforeSecondUse = await stateFor(assetNumber);
    if (assetNumber === 76) {
      // The first normal E equips the bottle. The second operates the authored world trigger.
      await page.keyboard.press('e');
      await page.waitForTimeout(260);
    }
    await page.mouse.down();
    await page.waitForTimeout(420);
    await page.mouse.up();
    await page.waitForTimeout(180);
    const diagnostics = await page.evaluate(() => (
      window.__fw.scene3d.walk.toolViewmodelDiagnostics()
    ));
    const toolDiag = diagnostics.tools?.[tool] || null;
    const stateAfterSecondUse = await stateFor(assetNumber);
    const result = {
      assetNumber,
      suffix,
      tool,
      label: focus.focused.label,
      authored: diagnostics.loadResults?.find((entry) => entry.id === tool) || null,
      clips: toolDiag?.clips || [],
      played: toolDiag?.played || [],
      stateBeforeSecondUse,
      stateAfterSecondUse,
    };
    requireCheck(result.authored?.ok === true, `Tool ${tool} did not adopt its authored GLB.`, result);
    requireCheck(result.played.some((name) => /_Equip$/u.test(name)),
      `Tool ${tool} never played its authored equip clip.`, result);
    requireCheck(result.played.some((name) => !/_Equip$/u.test(name)),
      `Tool ${tool} never played an authored use clip.`, result);
    if (assetNumber === 76) {
      requireCheck(JSON.stringify(stateBeforeSecondUse) !== JSON.stringify(stateAfterSecondUse),
        'The world spray-bottle trigger did not persist its one-shot use.', result);
    }
    toolResults.push(result);
    return result;
  }

  async function fixtureAttachmentSnapshot() {
    return page.evaluate(() => {
      const runtime = window.__fw.scene3d.clubhouse().assets51to100Runtime;
      const rows = [];
      for (const [number, fixtureId] of [[62, 'backcounter'], [64, 'backshelf_n'], [64, 'backshelf_e2']]) {
        const root = runtime.getRoot(number, fixtureId);
        root?.updateWorldMatrix(true, false);
        const elements = root?.matrixWorld?.elements || null;
        rows.push({
          number,
          fixtureId,
          parent: root?.parent?.name || null,
          parentFixtureId: root?.parent?.userData?.fixtureLayoutId || null,
          world: elements ? [elements[12], elements[13], elements[14]] : null,
          visible: root?.visible === true,
        });
      }
      return rows;
    });
  }

  try {
    await page.setViewportSize(viewport);
    checks.pointerLockAcquired = await boot();
    const initial = await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      app.speedIdx = 0;
      const reno = app.state.shop.reno;
      if (reno) {
        reno.grime.fill(0);
        reno.debris = [];
        reno.debrisSeeded = true;
        for (const clutter of reno.clutter || []) clutter.cleared = true;
        clubhouse.rebuildReno?.();
      }
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      return {
        runtime: clubhouse.assets51to100Runtime.diagnostics(),
        fittingRoom: clubhouse.assets51to100Runtime.fittingRoom(),
        interactionCount: clubhouse.assets51to100Runtime.interactionTargets().length,
        viewmodels: app.scene3d.walk.toolViewmodelDiagnostics(),
      };
    });
    requireCheck(initial.runtime.placed === 40 && initial.runtime.failed === 0,
      'The complete runtime was not ready.', initial);
    requireCheck(initial.interactionCount === 22, 'The runtime did not expose all 22 normal interactions.', initial);
    requireCheck(initial.fittingRoom.curtainColliderActive === true,
      'The closed fitting curtain had no active blocker.', initial);
    requireCheck(initial.viewmodels.authoredCount === 9,
      'Not all nine cleaning-tool variants adopted authored viewmodels.', initial);
    await capture('01-runtime-ready.png');

    // Start retained gameplay capture only after the normal canvas click and deterministic fixture.
    captureStarted = await page.evaluate(() => {
      const audio = window.__fw.audio;
      audio.setMuted(false);
      audio.setVolume(0.8);
      return audio.startCapture(document.getElementById('game'), { fps: 30 });
    });
    requireCheck(captureStarted.videoTracks > 0 && captureStarted.audioTracks > 0,
      'Runtime acceptance could not start a live audio/video capture.', captureStarted);

    // A closed curtain blocks the player; the normal E animation removes only that thin collider.
    const fittingTraversal = await page.evaluate(() => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const origin = app.scene3d.clubhouse().interior.position;
      walk.clearKeys?.();
      walk.state.x = origin.x - 7.88;
      walk.state.z = origin.z + 4.40;
      walk.state.yaw = Math.PI / 2;
      walk.state.pitch = -0.10;
      return { startX: walk.state.x, originX: origin.x };
    });
    await page.keyboard.down('w');
    await page.waitForTimeout(360);
    await page.keyboard.up('w');
    checks.closedCurtainStopX = await page.evaluate(() => window.__fw.scene3d.walk.state.x);
    requireCheck(checks.closedCurtainStopX > fittingTraversal.originX - 8.30,
      'The player passed through the closed fitting curtain.', checks.closedCurtainStopX);

    await useWorldInteraction(63);
    checks.fittingAfterOpen = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().assets51to100Runtime.fittingRoom()
    ));
    requireCheck(checks.fittingAfterOpen.curtainOpen === true
      && checks.fittingAfterOpen.curtainColliderActive === false,
    'Opening Asset 63 did not remove its curtain collider.', checks.fittingAfterOpen);
    await page.evaluate(() => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const origin = app.scene3d.clubhouse().interior.position;
      walk.state.x = origin.x - 7.35;
      walk.state.z = origin.z + 4.40;
      walk.state.yaw = Math.PI / 2;
      walk.state.pitch = -0.04;
    });
    await page.waitForTimeout(220);
    await capture('02-fitting-curtain-open.png');

    await page.evaluate(() => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const origin = app.scene3d.clubhouse().interior.position;
      walk.state.x = origin.x - 7.88;
      walk.state.z = origin.z + 4.40;
      walk.state.yaw = Math.PI / 2;
      walk.state.pitch = -0.10;
    });
    await page.keyboard.down('w');
    await page.waitForTimeout(360);
    await page.keyboard.up('w');
    checks.openCurtainTraverseX = await page.evaluate(() => window.__fw.scene3d.walk.state.x);
    requireCheck(checks.openCurtainTraverseX < fittingTraversal.originX - 8.48,
      'The player could not walk through the open fitting curtain.', checks.openCurtainTraverseX);

    // Every animated, non-tool prop is operated with the ordinary E key from its player prompt.
    for (const assetNumber of [62, 70, 73, 78, 81, 82, 83, 84, 85, 92, 97, 98]) {
      await useWorldInteraction(assetNumber);
      if (assetNumber === 70) await capture('03-trophy-cabinet-open.png');
      if (assetNumber === 85) await capture('04-office-interactions.png');
      if (assetNumber === 92) await capture('05-stockroom-safety-interactions.png');
    }

    // Each pickup uses normal E, then a real held mouse input. This exercises the authored
    // first-person equip/use clips and the existing cleaning simulation adapter.
    for (const spec of [
      [71, 'vacuum', ''], [72, 'mop', ''], [74, 'broom', ''], [75, 'dustpan', ''],
      [76, 'spray', ''], [77, 'cloth', 'cloth'], [77, 'sponge', 'sponge'],
      [79, 'washer', ''], [80, 'trashbag', ''],
    ]) {
      await useTool(...spec);
      if ([71, 76, 79].includes(spec[0])) await capture(`06-held-${spec[1]}.png`);
    }

    checks.fixtureAttachmentsBeforeSave = await fixtureAttachmentSnapshot();
    requireCheck(checks.fixtureAttachmentsBeforeSave.every((entry) => (
      entry.visible && entry.parent && entry.parentFixtureId === entry.fixtureId
    )),
      'An authored movable fixture was detached before save.', checks.fixtureAttachmentsBeforeSave);

    // Stop exact-path AV capture before reload destroys the page MediaRecorder.
    const videoOut = path.join(out, 'assets-51-100-normal-controls.webm');
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    const stopPromise = page.evaluate((downloadName) => (
      window.__fw.audio.stopCapture({ downloadName })
    ), path.basename(videoOut));
    const [download, captureStopped] = await Promise.all([downloadPromise, stopPromise]);
    const downloadFailure = await download.failure();
    requireCheck(!downloadFailure, `Runtime capture download failed: ${downloadFailure}`);
    await download.saveAs(videoOut);
    mediaCapture = {
      output: videoOut,
      bytesOnDisk: fs.statSync(videoOut).size,
      ...captureStarted,
      ...captureStopped,
    };
    captureStarted = null;
    requireCheck(mediaCapture.bytesOnDisk > 100000, 'Runtime gameplay video is unexpectedly empty.', mediaCapture);

    const saved = await page.evaluate(async () => {
      const app = window.__fw;
      await app.autosave();
      const raw = localStorage.getItem('golfempire:autosave');
      if (!raw) throw new Error('Autosave did not write golfempire:autosave.');
      return {
        bytes: raw.length,
        assetRuntime: structuredClone(app.state.shop.assetRuntime),
      };
    });
    requireCheck(saved.assetRuntime.asset_063?.open === true,
      'The fitting-room open state was absent from the autosave.', saved.assetRuntime.asset_063);

    checks.pointerLockAfterReload = await boot({ reload: true });
    const reloaded = await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      return {
        assetRuntime: structuredClone(app.state.shop.assetRuntime),
        fittingRoom: clubhouse.assets51to100Runtime.fittingRoom(),
        runtime: clubhouse.assets51to100Runtime.diagnostics(),
        interactionCount: clubhouse.assets51to100Runtime.interactionTargets().length,
      };
    });
    checks.fixtureAttachmentsAfterReload = await fixtureAttachmentSnapshot();
    requireCheck(JSON.stringify(saved.assetRuntime) === JSON.stringify(reloaded.assetRuntime),
      'Asset interaction state changed across save/reload.', { saved: saved.assetRuntime, reloaded: reloaded.assetRuntime });
    requireCheck(reloaded.fittingRoom.curtainOpen === true
      && reloaded.fittingRoom.curtainColliderActive === false,
    'The open fitting curtain did not restore its animation/collision state.', reloaded.fittingRoom);
    requireCheck(JSON.stringify(checks.fixtureAttachmentsBeforeSave)
      === JSON.stringify(checks.fixtureAttachmentsAfterReload),
    'Authored movable fixtures changed parent/position across save/reload.', {
      before: checks.fixtureAttachmentsBeforeSave,
      after: checks.fixtureAttachmentsAfterReload,
    });
    requireCheck(reloaded.runtime.placed === 40 && reloaded.runtime.failed === 0
      && reloaded.interactionCount === 22,
    'The runtime did not fully recover after reload.', reloaded);
    await focusTarget(63);
    await capture('07-save-reload-fitting-open.png');
  } catch (error) {
    blocker = { message: error?.message || String(error), evidence: error?.evidence || null };
    await capture('99-blocker.png').catch(() => {});
  } finally {
    await page.keyboard.up('w').catch(() => {});
    await page.keyboard.up('e').catch(() => {});
    await page.mouse.up().catch(() => {});
    if (captureStarted) {
      await page.evaluate(() => window.__fw?.audio?.stopCapture?.({
        downloadName: 'assets-51-100-blocked.webm',
      })).catch(() => {});
    }
  }

  const blockingDiagnostics = diagnostics.filter((entry) => !(
    (entry.kind === 'console:warning'
      && /dyn_index_vec4_float4_int|THREE\.WebGLProgram/u.test(entry.message))
    || (entry.kind === 'requestfailed' && /ERR_ABORTED/u.test(entry.message))
  ));
  return {
    ok: !blocker && blockingDiagnostics.length === 0,
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/assets-51-100-runtime-acceptance.js --bootstrap',
    methodology: {
      viewport,
      controls: 'Normal canvas click, keyboard E/W and real mouse down/up; direct pose injection is limited to deterministic approach setup.',
      animationProof: 'Persisted state transition plus a non-zero authored node transform delta during every world interaction.',
      firstPersonProof: 'Each pickup is equipped with E and used with a real held mouse input; played authored clip names are recorded.',
      persistence: 'window.__fw.autosave() to golfempire:autosave, full page reload, then exact state and fixture attachment comparison.',
    },
    checks,
    worldInteractions: interactionResults,
    toolInteractions: toolResults,
    mediaCapture,
    captures,
    diagnostics,
    blockingDiagnostics,
    blocker,
  };
}

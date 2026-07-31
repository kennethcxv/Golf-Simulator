async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const crypto = process.getBuiltinModule('node:crypto');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.STATEFUL_BATCHING_QA_OUT
    || path.join(repo, 'qa', 'performance', 'stateful-batching-safety'));
  fs.mkdirSync(out, { recursive: true });

  const sourceFiles = [
    'src/render3d/assets51to100/propPlacement.js',
    'src/render3d/clubhouse/fixtures.js',
    'src/render3d/clubhouse/rigidVisualBatch.js',
    'src/render3d/clubhouse/simplifiedRegisterMode.js',
  ];
  const sourceHashes = () => Object.fromEntries(sourceFiles.map((relative) => {
    const data = fs.readFileSync(path.join(repo, relative));
    return [relative, crypto.createHash('sha256').update(data).digest('hex')];
  }));
  const sourceBefore = sourceHashes();
  const diagnostics = [];
  const captures = [];
  const checks = {};
  let captureStarted = null;
  let mediaCapture = null;

  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      diagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'unknown';
    if (!/ERR_ABORTED/u.test(error)) {
      diagnostics.push({ kind: 'requestfailed', message: `${request.url()} (${error})` });
    }
  });

  const requireCheck = (condition, message, evidence = null) => {
    if (condition) return;
    const error = new Error(message);
    error.evidence = evidence;
    throw error;
  };
  const capture = async (name) => {
    const file = path.join(out, name);
    await page.screenshot({ path: file });
    captures.push(file);
    return file;
  };

  async function focusPoint(target, expected, candidateAngles = null) {
    const angles = candidateAngles || [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4,
      -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4];
    for (const angle of angles) {
      const established = await page.evaluate(({ focus, candidateAngle }) => {
        const app = window.__fw;
        const walk = app.scene3d.walk;
        const radius = Math.min(1.28, Math.max(0.78, (focus.radius || 1.8) - 0.35));
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
      await page.waitForTimeout(240);
      const observed = await page.evaluate(() => {
        const focus = window.__fw.scene3d.walk.getFocus?.();
        return {
          kind: focus?.kind || null,
          assetNumber: focus?.prop?.userData?.assetNumber || null,
          label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
        };
      });
      if (expected(observed)) return { target, observed, angle };
    }
    const observed = await page.evaluate(() => ({
      label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
      pose: { ...window.__fw.scene3d.walk.state },
    }));
    requireCheck(false, 'Could not establish the requested normal-control focus.', observed);
    return null;
  }

  async function focusAsset(assetNumber) {
    const target = await page.evaluate((number) => (
      window.__fw.scene3d.clubhouse().assets51to100Runtime.interactionTargets()
        .find((entry) => entry.assetNumber === number && !(entry.suffix || '')) || null
    ), assetNumber);
    requireCheck(target, `Asset ${assetNumber} has no runtime interaction target.`);
    return focusPoint(target, (observed) => observed.kind === 'prop'
      && observed.assetNumber === assetNumber);
  }

  async function cleaningBayTarget() {
    return page.evaluate(() => {
      const interior = window.__fw.scene3d.clubhouse().interior.position;
      return { x: interior.x + 7.25, z: interior.z + 1.10, aimY: interior.y + 0.72, radius: 1.90 };
    });
  }

  async function aimFromCurrent(target, expected) {
    await page.evaluate((focus) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const dx = focus.x - walk.state.x;
      const dz = focus.z - walk.state.z;
      const horizontal = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      const floorY = app.scene3d.clubhouse().interior.position.y;
      const eyeY = floorY + walk.state.eye;
      walk.state.pitch = Math.max(-1.10, Math.min(0.72,
        Math.atan2((focus.aimY ?? floorY) - eyeY, horizontal)));
    }, target);
    await page.waitForTimeout(240);
    const observed = await page.evaluate(() => {
      const focus = window.__fw.scene3d.walk.getFocus?.();
      return {
        kind: focus?.kind || null,
        assetNumber: focus?.prop?.userData?.assetNumber || null,
        label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
      };
    });
    requireCheck(expected(observed), 'Rotating in place did not establish the requested focus.', observed);
    return observed;
  }

  async function assetPose(assetNumber) {
    return page.evaluate((number) => {
      const root = window.__fw.scene3d.clubhouse().assets51to100Runtime.getRoot(number);
      const values = {};
      root?.traverse((object) => {
        if (!object.name || /^(?:SOCKET_|COL_|COLLISION_|VOLUME_)/u.test(object.name)) return;
        values[object.name] = [
          object.position.x, object.position.y, object.position.z,
          object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w,
          object.scale.x, object.scale.y, object.scale.z,
        ];
      });
      return values;
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

  async function visualSnapshot() {
    return page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const runtime = clubhouse.assets51to100Runtime;
      const root73 = runtime.getRoot(73);
      const root83 = runtime.getRoot(83);
      const water = root73?.getObjectByName('BucketWater')
        || root73?.getObjectByName('MESH_BucketWater');
      const bulb = root83?.getObjectByName('MESH_LampBulb');
      let lamp = null;
      root83?.traverse((object) => { if (!lamp && object.isPointLight) lamp = object; });
      const stateFor = (number) => structuredClone(app.state.shop?.assetRuntime?.[
        `asset_${String(number).padStart(3, '0')}`
      ] || {});
      return {
        runtime: runtime.diagnostics(),
        bucketState: stateFor(73),
        lampState: stateFor(83),
        cleaning: clubhouse.cleaningStatus(),
        water: water ? {
          visible: water.visible,
          layers: water.layers.mask,
          suppressed: water.userData.assetRuntimeStaticRenderSuppressed === true
            || water.userData.assetRuntimePlacedStaticRenderSuppressed === true,
          color: water.material?.color?.getHex?.() || null,
        } : null,
        bulb: bulb ? {
          visible: bulb.visible,
          layers: bulb.layers.mask,
          suppressed: bulb.userData.assetRuntimeStaticRenderSuppressed === true
            || bulb.userData.assetRuntimePlacedStaticRenderSuppressed === true,
          emissiveIntensity: Number(bulb.material?.emissiveIntensity),
        } : null,
        lamp: lamp ? { visible: lamp.visible, layers: lamp.layers.mask } : null,
      };
    });
  }

  let blocker = null;
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await page.waitForFunction(() => {
      const runtime = window.__fw?.scene3d?.clubhouse?.()?.assets51to100Runtime?.diagnostics?.();
      return runtime?.placed === 40 && runtime?.failed === 0;
    }, null, { timeout: 90000 });
    await page.locator('#game').click({ position: { x: 800, y: 450 }, force: true });
    await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      app.speedIdx = 0;
    });
    await page.waitForTimeout(500);

    const initial = await visualSnapshot();
    requireCheck(initial.runtime.placedStaticBatchSavedDrawCalls > 0,
      'Inert cross-asset batching was not active.', initial.runtime);
    requireCheck(!initial.runtime.placedStaticBatchAssetNumbers.includes(73)
      && !initial.runtime.placedStaticBatchAssetNumbers.includes(83),
    'A mutable asset entered the cross-asset static batch.', initial.runtime);
    requireCheck(initial.water && initial.water.layers !== 0 && !initial.water.suppressed,
      'Bucket water was not on its live rendered hierarchy.', initial.water);
    requireCheck(initial.bulb && initial.bulb.layers !== 0 && !initial.bulb.suppressed,
      'Desk-lamp emissive was not on its live rendered hierarchy.', initial.bulb);

    captureStarted = await page.evaluate(() => {
      window.__fw.audio.setMuted(false);
      window.__fw.audio.setVolume(0.8);
      return window.__fw.audio.startCapture(document.getElementById('game'), { fps: 30 });
    });
    requireCheck(captureStarted.videoTracks > 0 && captureStarted.audioTracks > 0,
      'Audio/video capture did not start.', captureStarted);

    checks.lampFocus = await focusAsset(83);
    await capture('01-desk-lamp-on.png');
    const lampPoseBefore = await assetPose(83);
    await page.keyboard.press('e');
    checks.lampAnimationDelta = 0;
    // The authored switch clip is only 1/6 second long and returns the off
    // switch to its resting transform. Sample the whole short action instead of
    // taking one frame after it has already settled.
    for (let sample = 0; sample < 8; sample += 1) {
      await page.waitForTimeout(28);
      checks.lampAnimationDelta = Math.max(
        checks.lampAnimationDelta,
        poseDelta(lampPoseBefore, await assetPose(83)),
      );
    }
    await page.waitForTimeout(340);
    const lampOff = await visualSnapshot();
    requireCheck(lampOff.lampState.on === false && lampOff.lamp?.visible === false,
      'Normal E did not switch the desk lamp off.', lampOff);
    requireCheck(lampOff.bulb.emissiveIntensity <= 0.03 && checks.lampAnimationDelta > 0.00001,
      'The rendered bulb or authored switch animation did not follow the lamp state.', {
        lampOff, animationDelta: checks.lampAnimationDelta,
      });
    await capture('02-desk-lamp-off.png');
    await focusAsset(83);
    await page.keyboard.press('e');
    await page.waitForTimeout(650);
    const lampRestored = await visualSnapshot();
    requireCheck(lampRestored.lampState.on === true
      && lampRestored.lamp?.visible === true
      && lampRestored.bulb.emissiveIntensity > 1,
    'The desk lamp did not visibly return to its lit state.', lampRestored);

    const bayTarget = await cleaningBayTarget();
    checks.cleaningBayFocusBeforeTool = await focusPoint(
      bayTarget,
      (observed) => /Cleaning bay|Mop bucket/u.test(observed.label || ''),
    );
    checks.mopFPresses = null;
    for (let press = 0; press <= 14; press += 1) {
      const equipped = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.());
      if (equipped === 'mop') {
        checks.mopFPresses = press;
        break;
      }
      if (press === 14) break;
      await page.keyboard.press('f');
      await page.waitForTimeout(90);
    }
    requireCheck(checks.mopFPresses !== null,
      'Normal F tool cycling did not equip the mop.', {
        tool: await page.evaluate(() => window.__fw.scene3d.walk.getTool?.()),
      });
    checks.cleaningBayFocus = await aimFromCurrent(
      bayTarget,
      (observed) => /Mop bucket/u.test(observed.label || ''),
    );
    await capture('03-bucket-clean-water.png');
    let services = 0;
    while (services < 24) {
      const status = await page.evaluate(() => (
        window.__fw.scene3d.clubhouse().cleaningStatus().bucket
      ));
      if (status.water === 'empty') break;
      await page.keyboard.down('e');
      await page.waitForTimeout(35);
      await page.keyboard.up('e');
      await page.waitForTimeout(220);
      const serviced = await page.evaluate(() => (
        window.__fw.scene3d.clubhouse().cleaningStatus().bucket
      ));
      requireCheck(serviced.wrings > status.wrings || serviced.water === 'empty',
        'Normal E did not service the focused mop bucket.', { before: status, after: serviced });
      services += 1;
    }
    await page.waitForTimeout(240);
    const bucketEmpty = await visualSnapshot();
    checks.bucketServices = services;
    requireCheck(bucketEmpty.cleaning.bucket.water === 'empty'
      && bucketEmpty.water.visible === false,
    'Normal mop servicing emptied the bucket but did not hide the live water mesh.', bucketEmpty);
    requireCheck(bucketEmpty.water.layers !== 0 && !bucketEmpty.water.suppressed,
      'The empty-state check reached a batched copy instead of the live water mesh.', bucketEmpty.water);
    await capture('04-bucket-empty.png');

    await page.keyboard.press('x');
    await page.waitForTimeout(420);
    const bucketRefilled = await visualSnapshot();
    requireCheck(bucketRefilled.cleaning.bucket.water === 'clean'
      && bucketRefilled.cleaning.bucket.level === 1
      && bucketRefilled.water.visible === true,
    'Normal secondary action did not restore clean visible bucket water.', bucketRefilled);
    await capture('05-bucket-refilled.png');

    const videoOut = path.join(out, 'stateful-batching-normal-controls.webm');
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    const stopPromise = page.evaluate((downloadName) => (
      window.__fw.audio.stopCapture({ downloadName })
    ), path.basename(videoOut));
    const [download, captureStopped] = await Promise.all([downloadPromise, stopPromise]);
    const downloadFailure = await download.failure();
    requireCheck(!downloadFailure, `Capture download failed: ${downloadFailure}`);
    await download.saveAs(videoOut);
    mediaCapture = {
      output: videoOut,
      bytesOnDisk: fs.statSync(videoOut).size,
      ...captureStarted,
      ...captureStopped,
    };
    captureStarted = null;
    requireCheck(mediaCapture.bytesOnDisk > 100000,
      'The normal-control recording is unexpectedly empty.', mediaCapture);
  } catch (error) {
    blocker = { message: error?.message || String(error), evidence: error?.evidence || null };
    await capture('99-blocker.png').catch(() => {});
  } finally {
    await page.keyboard.up('e').catch(() => {});
    await page.keyboard.up('x').catch(() => {});
    await page.mouse.up().catch(() => {});
    if (captureStarted) {
      await page.evaluate(() => window.__fw?.audio?.stopCapture?.({
        downloadName: 'stateful-batching-blocked.webm',
      })).catch(() => {});
    }
  }

  const sourceAfter = sourceHashes();
  const sourceUnchanged = JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter);
  const blockingDiagnostics = diagnostics.filter((entry) => !(
    entry.kind === 'console:warning'
      && /PCFSoftShadowMap has been deprecated/u.test(entry.message)
  ));
  return {
    ok: !blocker && blockingDiagnostics.length === 0 && sourceUnchanged,
    capturedAt: new Date().toISOString(),
    methodology: {
      viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
      controls: 'Normal pointer-lock canvas click, E lamp toggle/service, F mop selection, and X clean-water change; deterministic walk poses only establish reachable focus.',
      renderProof: 'Live mesh layer/suppression flags plus player-camera screenshots prove mutable water and lamp emissive meshes were not replaced by a stale static batch.',
    },
    checks,
    mediaCapture,
    captures,
    diagnostics,
    blockingDiagnostics,
    source: { before: sourceBefore, after: sourceAfter, unchanged: sourceUnchanged },
    blocker,
  };
}

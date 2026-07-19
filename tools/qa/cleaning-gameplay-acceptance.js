// COMPLETE FIRST-PERSON CLEANING GAMEPLAY ACCEPTANCE.
//
// This route deliberately drives player verbs through the shipped controls:
//   F              cycle the context-sensitive tool belt
//   mouse buttons  use tools / apply pressure-washer soap
//   E / X          service, tie, dispose, and change bucket water
//   Escape + UI    save and reload a mid-task transaction
//
// Direct access is restricted to deterministic fixture setup: fixed player poses and known dirt
// or debris at the tool's real contact socket. The thing under test is always activated by the
// normal control path. The route also records the game's own canvas + WebAudio mix.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const out = path.join(repo, 'qa', 'overnight', 'cleaning-gameplay', 'final');
  const shotsDir = path.join(out, 'screenshots');
  const videoFile = path.join(out, 'cleaning-gameplay-normal-controls.webm');
  fs.mkdirSync(shotsDir, { recursive: true });

  const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:8463/';
  const consoleErrors = [];
  const consoleWarnings = [];
  const failedRequests = [];
  const checks = [];
  const captures = [];
  const normalControlProof = [];
  const cdp = await page.context().newCDPSession(page);

  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
    if (message.type() === 'warning') consoleWarnings.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });

  function check(name, pass, detail = null) {
    const entry = { name, pass: !!pass };
    if (detail !== null && detail !== undefined) entry.detail = detail;
    checks.push(entry);
    return entry.pass;
  }

  const round = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));
  const median = (values) => {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  async function waitForGame() {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.evaluate(async () => {
      await window.__fw.scene3d.clubhouse().sheet06ProductionReady?.();
      await window.__fw.scene3d.clubhouse().props71to100?.ready;
    });
    await page.waitForTimeout(1200);
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      if (!veil) return true;
      const style = getComputedStyle(veil);
      return style.display === 'none' || style.visibility === 'hidden'
        || Number.parseFloat(style.opacity) < 0.02;
    }, null, { timeout: 90000 });
    await page.waitForTimeout(450);
  }

  async function prepareGame() {
    return page.evaluate(() => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      ch.setOrganicWalkins?.(false);
      ch.clearWalkins?.();
      app.scene3d.setGolfersFrozen?.(true);
      app.scene3d.clearGolfers?.();
      const inventory = app.state.shop.inventory;
      if (!inventory.vac1) inventory.vac1 = { shelf: 0, back: 1, ordered: 0 };
      inventory.vac1.back = Math.max(1, Number(inventory.vac1.back) || 0);
      app.state.tutorial.complete = true;
      app.state.tutorial.hidden = true;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      app.scene3d.walk.clearKeys?.();
      return {
        origin: ch.interior.position.toArray(),
        walkActive: app.scene3d.walk.isActive(),
        vacuumBack: inventory.vac1.back,
      };
    });
  }

  async function pose(localX, localZ, yaw = 0, pitch = -0.62) {
    await page.evaluate(({ localX, localZ, yaw, pitch }) => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const walk = app.scene3d.walk;
      const origin = ch.interior.position;
      walk.clearKeys?.();
      walk.state.x = origin.x + localX;
      walk.state.z = origin.z + localZ;
      walk.state.yaw = yaw;
      walk.state.pitch = pitch;
    }, { localX, localZ, yaw, pitch });
    await page.waitForTimeout(260);
  }

  async function poseFacing(localX, localZ, targetX, targetZ, pitch = -0.45) {
    const dx = targetX - localX;
    const dz = targetZ - localZ;
    const yaw = Math.atan2(-dx, -dz);
    await pose(localX, localZ, yaw, pitch);
  }

  async function findFocus(targetX, targetZ, patterns, options = {}) {
    const wanted = (Array.isArray(patterns) ? patterns : [patterns]).map((value) => (
      value instanceof RegExp ? value : new RegExp(String(value), 'i')
    ));
    const radii = options.radii || [1.05, 1.28, 1.52, 1.72];
    const pitch = options.pitch ?? -0.46;
    const candidates = await page.evaluate(({ targetX, targetZ, radii }) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const origin = app.scene3d.clubhouse().interior.position;
      const result = [];
      for (const radius of radii) {
        for (let i = 0; i < 16; i += 1) {
          const angle = (i / 16) * Math.PI * 2;
          const x = targetX + Math.cos(angle) * radius;
          const z = targetZ + Math.sin(angle) * radius;
          if (!walk.isFree(origin.x + x, origin.z + z, 0.34)) continue;
          result.push({ x, z });
        }
      }
      return result;
    }, { targetX, targetZ, radii });
    for (const candidate of candidates) {
      await poseFacing(candidate.x, candidate.z, targetX, targetZ, pitch);
      const label = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
      if (wanted.some((pattern) => pattern.test(label))) return { ...candidate, label };
    }
    return {
      label: await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || ''),
      candidates: candidates.length,
    };
  }

  async function screenshot(name, description) {
    const file = path.join(shotsDir, name);
    await page.screenshot({ path: file });
    const context = await page.evaluate(() => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const ch = app.scene3d.clubhouse();
      const origin = ch.interior.position;
      return {
        tool: walk.getTool(),
        localPlayer: [
          Number((walk.state.x - origin.x).toFixed(3)),
          Number((walk.state.z - origin.z).toFixed(3)),
        ],
        yaw: Number(walk.state.yaw.toFixed(4)),
        pitch: Number(walk.state.pitch.toFixed(4)),
        fov: app.scene3d.camera.fov,
        viewport: [innerWidth, innerHeight],
        focus: walk.getFocusLabel?.() || null,
      };
    });
    captures.push({ file, description, context });
    return file;
  }

  async function waitForToasts() {
    // Tool cycling intentionally produces player feedback. Let it complete before a visual-QA
    // frame so the image evaluates the tool and world rather than a temporary stack of equip text.
    await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0, null, {
      timeout: 5000,
    }).catch(() => {});
    await page.waitForTimeout(120);
  }

  async function snapshot() {
    return page.evaluate(() => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const reno = app.state.shop.reno;
      const mean = (values) => Array.isArray(values) && values.length
        ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length
        : 0;
      const wash = {};
      for (const [id, surface] of Object.entries(reno.wash || {})) {
        wash[id] = { grime: mean(surface.grime), soap: mean(surface.soap) };
      }
      const scene = app.scene3d.scene;
      let nodes = 0;
      let visibleToolRoots = 0;
      scene.traverse((object) => {
        nodes += 1;
        if (/^Tool_/.test(object.name || '') && object.visible) visibleToolRoots += 1;
      });
      return {
        tool: app.scene3d.walk.getTool(),
        status: ch.cleaningStatus(),
        debrisTotal: ch.debrisTotal(),
        debris: (reno.debris || []).map((entry) => ({ ...entry })),
        grime: mean(reno.grime),
        wet: mean(reno.wet),
        solution: mean(reno.solution),
        wash,
        diagnostics: app.scene3d.walk.cleaningDiagnostics(),
        audio: app.audio.toolLoopDiagnostics(),
        props: ch.props71to100.diagnostics(),
        renderer: {
          geometries: app.scene3d.renderer.info.memory.geometries,
          textures: app.scene3d.renderer.info.memory.textures,
          programs: app.scene3d.renderer.info.programs?.length || 0,
          calls: app.scene3d.renderer.info.render.calls,
          triangles: app.scene3d.renderer.info.render.triangles,
        },
        nodes,
        visibleToolRoots,
      };
    });
  }

  async function cycleTo(expected, scope = 'indoor') {
    for (let press = 0; press < 14; press += 1) {
      const current = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
      if (current === expected) {
        normalControlProof.push({ control: 'F', scope, expected, equipped: current, presses: press });
        await page.waitForTimeout(260);
        return true;
      }
      await page.keyboard.press('f');
      await page.waitForTimeout(85);
    }
    const equipped = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
    normalControlProof.push({ control: 'F', scope, expected, equipped, presses: 14 });
    return false;
  }

  async function useTool(ms, options = {}) {
    const viewport = page.viewportSize() || { width: 1600, height: 900 };
    await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
    await page.mouse.down({ button: options.button || 'left' });
    await page.waitForTimeout(Math.min(ms, options.evidenceDelay || 420));
    const during = await snapshot();
    if (options.screenshot) await screenshot(options.screenshot, options.description || options.screenshot);
    const elapsed = Math.min(ms, options.evidenceDelay || 420);
    if (ms > elapsed) await page.waitForTimeout(ms - elapsed);
    await page.mouse.up({ button: options.button || 'left' });
    await page.waitForTimeout(options.settleMs ?? 180);
    const after = await snapshot();
    normalControlProof.push({
      control: options.button === 'right' ? 'right mouse hold' : 'left mouse hold',
      tool: during.tool,
      durationMs: ms,
      duringUsing: during.diagnostics.using || during.diagnostics.soaping,
      result: during.diagnostics.result,
    });
    return { during, after };
  }

  async function replaceDebrisAtLastContact(entries) {
    return page.evaluate((entries) => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const origin = ch.interior.position;
      const contact = app.scene3d.walk.cleaningDiagnostics().contact;
      const x = contact[0] - origin.x;
      const z = contact[2] - origin.z;
      app.state.shop.reno.debris = entries.map((entry, index) => ({
        x: Number((x + (entry.dx || 0)).toFixed(3)),
        z: Number((z + (entry.dz || 0)).toFixed(3)),
        a: Number(entry.a),
        kind: entry.kind || 'grit',
        qaIndex: index,
      }));
      return { contact: [x, z], debris: app.state.shop.reno.debris.map((entry) => ({ ...entry })) };
    }, entries);
  }

  async function resetCleaningFixture(patch = {}) {
    await page.evaluate((patch) => {
      const reno = window.__fw.state.shop.reno;
      const cleaning = reno.cleaning;
      if (patch.pan !== undefined) cleaning.pan.load = patch.pan;
      if (patch.bag !== undefined) cleaning.bag.load = patch.bag;
      if (patch.tied !== undefined) cleaning.bag.tied = patch.tied;
      if (patch.mopCharge !== undefined) cleaning.mop.charge = patch.mopCharge;
      if (patch.bucketLevel !== undefined) cleaning.bucket.level = patch.bucketLevel;
      if (patch.bucketSoil !== undefined) cleaning.bucket.soil = patch.bucketSoil;
      if (patch.bucketWater !== undefined) cleaning.bucket.water = patch.bucketWater;
      if (patch.grime !== undefined && Array.isArray(reno.grime)) reno.grime.fill(patch.grime);
      if (patch.wet !== undefined && Array.isArray(reno.wet)) reno.wet.fill(patch.wet);
      if (patch.solution !== undefined && Array.isArray(reno.solution)) reno.solution.fill(patch.solution);
      reno.pan = cleaning.pan.load;
      reno.bag = cleaning.bag.load;
    }, patch);
    await page.waitForTimeout(100);
  }

  async function openPauseMenu() {
    if (await page.evaluate(() => !!document.pointerLockElement)) {
      await page.evaluate(() => document.exitPointerLock());
      await page.waitForFunction(() => !document.pointerLockElement, null, { timeout: 3000 });
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await page.locator('.pause-veil-ui').count()) return;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(220);
    }
    await page.waitForSelector('.pause-veil-ui', { timeout: 5000 });
  }

  async function saveSlotOne() {
    await openPauseMenu();
    await page.getByRole('button', { name: 'Save game', exact: true }).click();
    const save = page.getByRole('button', { name: 'Save here', exact: true }).first();
    await save.waitFor({ state: 'visible' });
    await save.click();
    await page.waitForTimeout(450);
    normalControlProof.push({ control: 'Escape > Save game > Save here', ok: true });
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.waitForTimeout(350);
  }

  async function loadSlotOne() {
    await openPauseMenu();
    await page.getByRole('button', { name: 'Load game', exact: true }).click();
    const load = page.getByRole('button', { name: 'Load', exact: true }).first();
    await load.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')]
        .find((entry) => entry.textContent.trim() === 'Load');
      return !!button && !button.disabled;
    }, null, { timeout: 6000 });
    await page.evaluate(() => { window.__cleaningPriorScene = window.__fw.scene3d; });
    await load.click();
    await page.waitForFunction(() => window.__fw?.scene3d
      && window.__fw.scene3d !== window.__cleaningPriorScene
      && window.__fw.scene3d.clubhouse?.(), null, { timeout: 90000 });
    await waitForGame();
    await prepareGame();
    normalControlProof.push({ control: 'Escape > Load game > Load', ok: true });
  }

  async function census() {
    // DOMCounters includes collectible detached nodes. A 100-press tool stress intentionally
    // creates 100 short-lived toasts, so collect once at each matched boundary before deciding
    // whether those removed nodes are actually retained.
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await page.waitForTimeout(120);
    const dom = await cdp.send('Memory.getDOMCounters');
    const app = await snapshot();
    const liveDomNodes = await page.evaluate(() => document.querySelectorAll('*').length);
    return {
      documents: dom.documents,
      nodes: dom.nodes,
      liveDomNodes,
      jsEventListeners: dom.jsEventListeners,
      sceneNodes: app.nodes,
      renderer: app.renderer,
      authoredViewmodels: app.diagnostics.viewmodels.authored,
      animatedViewmodels: app.diagnostics.viewmodels.animated.slice().sort(),
      playingViewmodels: app.diagnostics.viewmodels.playing.slice().sort(),
    };
  }

  async function performanceSample(label, durationMs = 2500) {
    const beforeDom = await cdp.send('Memory.getDOMCounters');
    const sample = await page.evaluate(async ({ label, durationMs }) => {
      const app = window.__fw;
      const frames = [];
      let previous = performance.now();
      const observerTarget = document.querySelector('#ui') || document.body;
      let mutations = 0;
      const observer = new MutationObserver((list) => { mutations += list.length; });
      observer.observe(observerTarget, { subtree: true, childList: true, attributes: true, characterData: true });
      const start = performance.now();
      await new Promise((resolve) => {
        const frame = (now) => {
          frames.push(now - previous);
          previous = now;
          if (now - start >= durationMs) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      observer.disconnect();
      const duration = performance.now() - start;
      frames.shift();
      const sorted = frames.slice().sort((a, b) => b - a);
      const slowCount = Math.max(1, Math.ceil(sorted.length * 0.01));
      const slowMean = sorted.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
      const info = app.scene3d.renderer.info;
      return {
        label,
        durationMs: duration,
        frames: frames.length,
        averageFps: frames.length * 1000 / duration,
        onePercentLowFps: 1000 / slowMean,
        worstFrameMs: sorted[0] || null,
        drawCalls: info.render.calls,
        renderedTriangles: info.render.triangles,
        materialCount: info.programs?.length || 0,
        textureCount: info.memory.textures,
        jsHeapUsedBytes: performance.memory?.usedJSHeapSize || null,
        uiMutationsPerSecond: mutations / (duration / 1000),
      };
    }, { label, durationMs });
    const afterDom = await cdp.send('Memory.getDOMCounters');
    sample.eventListeners = afterDom.jsEventListeners;
    sample.domNodeDelta = afterDom.nodes - beforeDom.nodes;
    for (const key of ['durationMs', 'averageFps', 'onePercentLowFps', 'worstFrameMs', 'uiMutationsPerSecond']) {
      sample[key] = round(sample[key]);
    }
    return sample;
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();
  const prepared = await prepareGame();
  check('gameplay booted in first-person with cleaning equipment owned',
    prepared.walkActive && prepared.vacuumBack > 0, prepared);

  // The abandoned shipment occupying the cleaning corner is removed with the ordinary E verb.
  const clutterFocus = await findFocus(7.6, 1.3, /Old clutter/i, { pitch: -0.08 });
  check('cleaning-bay clutter can be focused through normal first-person view', /Old clutter/i.test(clutterFocus.label || ''), clutterFocus);
  if (/Old clutter/i.test(clutterFocus.label || '')) {
    await page.keyboard.press('e');
    normalControlProof.push({ control: 'E', action: 'haul cleaning-bay clutter', label: clutterFocus.label });
    await page.waitForTimeout(450);
  }
  const clutterCleared = await page.evaluate(() => !!window.__fw.state.shop.reno.clutter
    .find((entry) => Math.hypot(entry.x - 7.6, entry.z - 1.3) < 0.3)?.cleared);
  check('cleaning-bay approach opens after hauling clutter', clutterCleared);
  // Accessible west-side stockroom lane; the packing bench remains foreground context without
  // putting the camera inside its collider.
  await poseFacing(6.30, -2.25, 7.85, 1.08, -0.10);
  await waitForToasts();
  await screenshot('00-cleaning-bay-world.png', 'Authored cleaning bay after the normal E clutter-removal route.');

  let captureStarted = null;
  let mediaCapture = null;
  captureStarted = await page.evaluate(async () => {
    const audio = window.__fw.audio;
    audio.setMuted(false);
    audio.setVolume(0.8);
    return audio.startCapture(document.getElementById('game'), {
      fps: 30,
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    });
  });
  check('player-view recording starts with live video and WebAudio',
    captureStarted.audioTracks > 0 && captureStarted.videoTracks > 0
      && captureStarted.audioContextState === 'running', captureStarted);

  // BROOM: deterministic ring at the physical floor-contact socket. It must move and conserve it.
  await pose(-5.5, 3.2, 0, -0.62);
  check('normal F equips broom', await cycleTo('broom'));
  await useTool(180); // establish the actual authored contact socket on an empty patch
  const broomSeed = await replaceDebrisAtLastContact([
    { dx: -0.12, dz: 0.00, a: 0.30, kind: 'grit' },
    { dx: -0.06, dz: 0.10, a: 0.30, kind: 'grit' },
    { dx: 0.06, dz: 0.10, a: 0.30, kind: 'grit' },
    { dx: 0.12, dz: 0.00, a: 0.30, kind: 'grit' },
    { dx: 0.06, dz: -0.10, a: 0.30, kind: 'grit' },
    { dx: -0.06, dz: -0.10, a: 0.30, kind: 'grit' },
  ]);
  const broomBefore = await snapshot();
  await waitForToasts();
  const broomUse = await useTool(1450, {
    screenshot: '01-broom-active.png',
    description: 'Push broom contacting and consolidating a deterministic grit pile.',
  });
  const broomAfter = broomUse.after;
  const broomMovedDistance = broomBefore.debris.reduce((sum, entry, index) => {
    const now = broomAfter.debris[index];
    return sum + (now ? Math.hypot(now.x - entry.x, now.z - entry.z) : 0);
  }, 0);
  check('broom moves debris through its real contact point',
    (broomUse.during.diagnostics.result?.did || 0) > 0 && broomMovedDistance > 0.01,
    { seed: broomSeed, result: broomUse.during.diagnostics.result, movedDistance: broomMovedDistance });
  check('broom conserves debris instead of deleting it',
    Math.abs(broomAfter.debrisTotal - broomBefore.debrisTotal) < 0.02,
    { before: broomBefore.debrisTotal, after: broomAfter.debrisTotal });
  check('broom work animation, motes, and audio run while held',
    broomUse.during.diagnostics.viewmodels.playing.includes('broom')
      && broomUse.during.diagnostics.effects.motesVisible
      && broomUse.during.audio.active === 'broom', broomUse.during.diagnostics);

  // DUSTPAN: capacity is finite. Excess must remain on the floor.
  check('normal F equips dustpan', await cycleTo('dustpan'));
  await resetCleaningFixture({ pan: 0, bag: 0, tied: false });
  await page.evaluate(() => { window.__fw.state.shop.reno.debris = []; });
  await useTool(180);
  const panSeed = await replaceDebrisAtLastContact([{ a: 2.3, kind: 'grit' }]);
  await waitForToasts();
  const panUse = await useTool(1050, {
    screenshot: '02-dustpan-capacity.png',
    description: 'Dustpan collecting only its finite capacity with grit still visible on the floor.',
  });
  check('dustpan fills to its finite 1.8-unit capacity',
    Math.abs(panUse.after.status.pan.load - panUse.after.status.pan.capacity) < 0.01,
    { seed: panSeed, status: panUse.after.status.pan, result: panUse.during.diagnostics.result });
  check('dustpan overflow remains as conserved floor debris',
    panUse.after.debrisTotal > 0.42 && panUse.after.debrisTotal < 0.58,
    { remaining: panUse.after.debrisTotal, pan: panUse.after.status.pan });

  const panBucketFocus = await findFocus(7.25, 1.10, /pan .*empty pan|empty pan into bag/i, { pitch: -0.55 });
  check('loaded dustpan exposes the cleaning-bay emptying prompt', /empty pan/i.test(panBucketFocus.label || ''), panBucketFocus);
  if (/empty pan/i.test(panBucketFocus.label || '')) {
    await page.keyboard.press('e');
    normalControlProof.push({ control: 'E', action: 'empty dustpan into trash bag', label: panBucketFocus.label });
    await page.waitForTimeout(450);
  }
  const panEmptied = await snapshot();
  check('normal E transfers the pan load into the reusable bag without loss',
    panEmptied.status.pan.load === 0 && Math.abs(panEmptied.status.bag.load - 1.8) < 0.01,
    panEmptied.status);
  await waitForToasts();
  await screenshot('03-cleaning-bay-pan-emptied.png', 'Dustpan emptied into the bag at the physical cleaning bay.');

  // Save and reload in the middle of the floor-to-bag task. Mutate only with normal bag pickup.
  await saveSlotOne();
  const savedMidTask = await snapshot();
  await pose(-5.5, 3.2, 0, -0.62);
  check('normal F equips trash bag before the post-save mutation', await cycleTo('trashbag'));
  await page.evaluate(() => { window.__fw.state.shop.reno.debris = []; });
  await useTool(180);
  await replaceDebrisAtLastContact([{ a: 0.8, kind: 'litter' }]);
  const postSaveMutation = await useTool(650);
  check('normal trash-bag use changes the saved mid-task state before reload',
    postSaveMutation.after.status.bag.load > savedMidTask.status.bag.load + 0.6,
    { saved: savedMidTask.status.bag, mutated: postSaveMutation.after.status.bag });
  await loadSlotOne();
  const reloadedMidTask = await snapshot();
  check('pause-menu load restores pan, bag, bucket, mop, debris, wetness, and solution state',
    Math.abs(reloadedMidTask.status.bag.load - savedMidTask.status.bag.load) < 0.001
      && reloadedMidTask.status.pan.load === savedMidTask.status.pan.load
      && reloadedMidTask.status.bucket.wrings === savedMidTask.status.bucket.wrings
      && Math.abs(reloadedMidTask.debrisTotal - savedMidTask.debrisTotal) < 0.001
      && Math.abs(reloadedMidTask.wet - savedMidTask.wet) < 0.01
      && Math.abs(reloadedMidTask.solution - savedMidTask.solution) < 0.01,
    { saved: savedMidTask, reloaded: reloadedMidTask });

  // VACUUM: a real intake socket pulls and consumes a nearby cluster; active state has feedback.
  await pose(-5.5, 3.2, 0, -0.62);
  check('normal F equips vacuum after reload', await cycleTo('vacuum'));
  await page.evaluate(() => { window.__fw.state.shop.reno.debris = []; });
  await useTool(180);
  const vacuumSeed = await replaceDebrisAtLastContact([{ a: 0.65, kind: 'grit' }]);
  const vacuumBefore = await snapshot();
  await waitForToasts();
  const vacuumUse = await useTool(1500, {
    screenshot: '04-vacuum-active.png',
    description: 'Authored vacuum head pulling grit at its floor intake with suction motes.',
  });
  check('vacuum intake consumes nearby debris without radius-wide deletion',
    vacuumUse.after.debrisTotal < vacuumBefore.debrisTotal - 0.4,
    { seed: vacuumSeed, before: vacuumBefore.debrisTotal, after: vacuumUse.after.debrisTotal });
  check('vacuum animation, suction motes, and loop audio run only during use',
    vacuumUse.during.diagnostics.viewmodels.playing.includes('vacuum')
      && vacuumUse.during.diagnostics.effects.motesVisible
      && vacuumUse.during.audio.active === 'vacuum'
      && vacuumUse.after.audio.active === null,
    { during: vacuumUse.during.diagnostics, audioAfter: vacuumUse.after.audio });

  // MOP: dry refusal, physical bucket service, hard-floor water, carpet refusal, water change.
  check('normal F equips mop', await cycleTo('mop'));
  await resetCleaningFixture({ mopCharge: 0, grime: 0.72, wet: 0 });
  const dryMop = await useTool(520);
  check('dry mop refuses work and spends no charge',
    dryMop.during.diagnostics.result?.reason === 'mop-dry'
      && dryMop.after.status.mop.charge === 0,
    { result: dryMop.during.diagnostics.result, mop: dryMop.after.status.mop });
  const mopBucketFocus = await findFocus(7.25, 1.10, /Mop bucket.*insert and wring/i, { pitch: -0.55 });
  check('dry mop exposes the physical insert-and-wring prompt', /insert and wring/i.test(mopBucketFocus.label || ''), mopBucketFocus);
  const beforeService = await snapshot();
  if (/insert and wring/i.test(mopBucketFocus.label || '')) {
    await page.keyboard.press('e');
    normalControlProof.push({ control: 'E', action: 'insert and wring mop', label: mopBucketFocus.label });
    await page.waitForTimeout(700);
  }
  const servicedMop = await snapshot();
  check('normal E services the mop and consumes bucket water',
    servicedMop.status.mop.charge > 23.5
      && servicedMop.status.bucket.level < beforeService.status.bucket.level
      && servicedMop.status.bucket.wrings === beforeService.status.bucket.wrings + 1,
    { before: beforeService.status, after: servicedMop.status });
  await waitForToasts();
  await screenshot('05-mop-bucket-service.png', 'Mop inserted into the authored bucket/wringer after normal E.');

  await pose(-5.5, 3.2, 0, -0.62);
  const hardFloorBefore = await snapshot();
  await waitForToasts();
  const mopUse = await useTool(1250, {
    screenshot: '06-mop-hard-floor-active.png',
    description: 'Serviced mop cleaning hard floor and leaving a readable wet sheen.',
  });
  check('serviced mop cleans hard floor, spends charge, and leaves water',
    (mopUse.during.diagnostics.result?.did || 0) > 0
      && mopUse.after.status.mop.charge < hardFloorBefore.status.mop.charge
      && mopUse.after.wet > hardFloorBefore.wet,
    { before: hardFloorBefore.status.mop, after: mopUse.after.status.mop, result: mopUse.during.diagnostics.result });
  await pose(-0.8, 4.55, 0, -0.62);
  const carpetChargeBefore = (await snapshot()).status.mop.charge;
  const carpetMop = await useTool(650);
  check('mop rejects carpet without consuming resource charge',
    carpetMop.during.diagnostics.result?.reason === 'carpet'
      && Math.abs(carpetMop.after.status.mop.charge - carpetChargeBefore) < 0.01,
    { result: carpetMop.during.diagnostics.result, chargeBefore: carpetChargeBefore, chargeAfter: carpetMop.after.status.mop.charge });
  const changeWaterFocus = await findFocus(7.25, 1.10, /Mop bucket/i, { pitch: -0.55 });
  const changesBefore = (await snapshot()).status.bucket.changes;
  check('bucket exposes the normal X secondary water-change action', /Mop bucket/i.test(changeWaterFocus.label || ''), changeWaterFocus);
  if (/Mop bucket/i.test(changeWaterFocus.label || '')) {
    await page.keyboard.press('x');
    normalControlProof.push({ control: 'X', action: 'change bucket water', label: changeWaterFocus.label });
    await page.waitForTimeout(500);
  }
  const waterChanged = await snapshot();
  check('normal X installs fresh clean bucket water and stows the mop',
    waterChanged.status.bucket.changes === changesBefore + 1
      && waterChanged.status.bucket.level === 1
      && waterChanged.status.bucket.water === 'clean'
      && waterChanged.tool === null,
    waterChanged.status.bucket);

  // SPRAY + CLOTH + SPONGE: one fixed reachable surface, with two-step and repeated-pass logic.
  await pose(-5.5, 3.2, 0, -1.0);
  await resetCleaningFixture({ grime: 0.76, solution: 0 });
  check('normal F equips spray bottle', await cycleTo('spray'));
  const sprayBefore = await snapshot();
  await waitForToasts();
  const sprayUse = await useTool(850, {
    screenshot: '07-spray-active.png',
    description: 'Trigger-attached authored spray bottle laying visible solution droplets.',
  });
  check('spray lays solution without directly erasing grime',
    sprayUse.after.solution > sprayBefore.solution
      && (sprayUse.during.diagnostics.result?.did || 0) > 0,
    { before: { grime: sprayBefore.grime, solution: sprayBefore.solution }, after: { grime: sprayUse.after.grime, solution: sprayUse.after.solution }, result: sprayUse.during.diagnostics.result });
  check('spray trigger animation, nozzle droplets, and audio are active together',
    sprayUse.during.diagnostics.viewmodels.playing.includes('spray')
      && sprayUse.during.diagnostics.sprayVisible
      && sprayUse.during.audio.active === 'spray', sprayUse.during.diagnostics);

  check('normal F equips microfibre cloth', await cycleTo('cloth'));
  const clothBefore = await snapshot();
  await waitForToasts();
  const clothUse = await useTool(1100, {
    screenshot: '08-cloth-active.png',
    description: 'Microfibre cloth wiping the exact sprayed patch with a flat contact pose.',
  });
  check('cloth consumes solution and removes grime only after spraying',
    (clothUse.during.diagnostics.result?.did || 0) > 0
      && clothUse.after.grime < clothBefore.grime
      && clothUse.after.solution < clothBefore.solution,
    { before: { grime: clothBefore.grime, solution: clothBefore.solution }, after: { grime: clothUse.after.grime, solution: clothUse.after.solution }, result: clothUse.during.diagnostics.result });

  check('normal F equips scouring sponge', await cycleTo('sponge'));
  const spongeBefore = await snapshot();
  const spongePasses = [];
  for (let pass = 0; pass < 3; pass += 1) {
    if (pass === 0) await waitForToasts();
    const used = await useTool(650, pass === 0 ? {
      screenshot: '09-sponge-active.png',
      description: 'Scouring sponge working a stubborn patch through repeated visible passes.',
    } : {});
    spongePasses.push(used.during.diagnostics.result);
  }
  const spongeAfter = await snapshot();
  check('sponge removes stubborn grime across repeated physical passes',
    spongePasses.filter((result) => (result?.did || 0) > 0).length >= 2
      && spongeAfter.grime < spongeBefore.grime,
    { passes: spongePasses, before: spongeBefore.grime, after: spongeAfter.grime });

  // TRASH BAG: accepts litter, rejects grit, fills finitely, ties, and disposes through world props.
  check('normal F equips trash bag', await cycleTo('trashbag'));
  await page.evaluate(() => { window.__fw.state.shop.reno.debris = []; });
  await useTool(180);
  const bagBefore = await snapshot();
  const bagSeed = await replaceDebrisAtLastContact([
    { a: 7.0, kind: 'litter' },
    { dx: 0.06, dz: 0.04, a: 0.7, kind: 'grit' },
  ]);
  await waitForToasts();
  const bagUse = await useTool(900, {
    screenshot: '10-trashbag-full.png',
    description: 'Authored bag at its full visual state with conserved overflow on the floor.',
  });
  const remainingGrit = bagUse.after.debris
    .filter((entry) => entry.kind === 'grit').reduce((sum, entry) => sum + entry.a, 0);
  const remainingLitter = bagUse.after.debris
    .filter((entry) => entry.kind === 'litter').reduce((sum, entry) => sum + entry.a, 0);
  check('trash bag collects litter up to its finite 7.5-unit capacity',
    Math.abs(bagUse.after.status.bag.load - bagUse.after.status.bag.capacity) < 0.01
      && bagUse.after.status.bag.load > bagBefore.status.bag.load,
    { seed: bagSeed, before: bagBefore.status.bag, after: bagUse.after.status.bag });
  check('trash bag leaves grit and capacity overflow on the floor',
    remainingGrit > 0.65 && remainingLitter > 1.15,
    { remainingGrit, remainingLitter, debris: bagUse.after.debris });

  const tieFocus = await findFocus(7.25, 1.10, /Trash bag .*tie bag/i, { pitch: -0.55 });
  check('full bag exposes the cleaning-bay tie prompt', /tie bag/i.test(tieFocus.label || ''), tieFocus);
  if (/tie bag/i.test(tieFocus.label || '')) {
    await page.keyboard.press('e');
    normalControlProof.push({ control: 'E', action: 'tie loaded trash bag', label: tieFocus.label });
    await page.waitForTimeout(650);
  }
  const tiedBag = await snapshot();
  check('normal E ties the loaded bag and preserves its load',
    tiedBag.status.bag.tied && Math.abs(tiedBag.status.bag.load - 7.5) < 0.01, tiedBag.status.bag);
  await waitForToasts();
  await screenshot('11-trashbag-tied.png', 'Tied full bag ready for the waste-station carry step.');

  const wasteFocus = await findFocus(9.85, 1.30, /Waste station.*dispose tied trash bag/i, { pitch: -0.12 });
  check('tied bag exposes the stockroom waste-station disposal prompt', /dispose tied trash bag/i.test(wasteFocus.label || ''), wasteFocus);
  const disposedBefore = tiedBag.status.bag.disposed;
  if (/dispose tied trash bag/i.test(wasteFocus.label || '')) {
    await page.keyboard.press('e');
    normalControlProof.push({ control: 'E', action: 'dispose tied bag', label: wasteFocus.label });
    await page.waitForTimeout(700);
  }
  const disposedBag = await snapshot();
  check('normal E disposal installs a fresh bag and retains lifetime totals',
    disposedBag.status.bag.load === 0
      && !disposedBag.status.bag.tied
      && disposedBag.status.bag.disposed === disposedBefore + 1
      && disposedBag.status.bag.disposedLoad >= 7.5,
    disposedBag.status.bag);
  await waitForToasts();
  await screenshot('12-waste-station-disposed.png', 'Waste-station feedback after a complete bag lifecycle.');

  // Switching while active must cancel every transient system immediately.
  await pose(-5.5, 3.2, 0, -0.62);
  check('normal F re-equips vacuum for active-switch cancellation', await cycleTo('vacuum'));
  const viewport = page.viewportSize();
  await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(420);
  await page.keyboard.press('f');
  await page.waitForTimeout(180);
  const switchedActive = await snapshot();
  await page.mouse.up({ button: 'left' });
  check('normal F while using cancels input, effects, animation, and loop audio',
    !switchedActive.diagnostics.using
      && !switchedActive.diagnostics.soaping
      && !switchedActive.diagnostics.effects.motesVisible
      && switchedActive.diagnostics.viewmodels.playing.length === 0
      && switchedActive.audio.active === null,
    switchedActive.diagnostics);

  // Prewarmed, normal F cycling must not create nodes, GPU resources, or event listeners.
  await cycleTo(null);
  await waitForToasts();
  const lifecycleBefore = await census();
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press('f');
    await page.waitForTimeout(24);
  }
  await waitForToasts();
  const lifecycleAfter = await census();
  normalControlProof.push({ control: 'F', action: '100 repeated indoor tool switches', count: 100 });
  check('100 normal tool switches keep DOM/event-listener counts stable',
    lifecycleAfter.jsEventListeners === lifecycleBefore.jsEventListeners
      && lifecycleAfter.liveDomNodes <= lifecycleBefore.liveDomNodes + 2
      && lifecycleAfter.nodes <= lifecycleBefore.nodes + 2,
    { before: lifecycleBefore, after: lifecycleAfter });
  check('100 normal tool switches do not allocate scene or GPU resources',
    lifecycleAfter.sceneNodes === lifecycleBefore.sceneNodes
      && lifecycleAfter.renderer.geometries === lifecycleBefore.renderer.geometries
      && lifecycleAfter.renderer.textures === lifecycleBefore.renderer.textures
      && lifecycleAfter.renderer.programs === lifecycleBefore.renderer.programs,
    { before: lifecycleBefore, after: lifecycleAfter });
  check('all nine authored viewmodels remain singular and stopped after switch stress',
    lifecycleAfter.authoredViewmodels === 9 && lifecycleAfter.playingViewmodels.length === 0,
    lifecycleAfter);

  // FOV + resolution matrix. The camera change is a visual fixture; equipment still comes from F.
  await cycleTo('spray');
  await pose(-5.5, 3.2, 0, -0.82);
  await waitForToasts();
  const fovMatrix = [];
  for (const spec of [
    { width: 1280, height: 720, fov: 50, file: '13-spray-1280x720-fov50.png' },
    { width: 1600, height: 900, fov: 66, file: '14-spray-1600x900-fov66.png' },
    { width: 1920, height: 1080, fov: 90, file: '15-spray-1920x1080-fov90.png' },
  ]) {
    await page.setViewportSize({ width: spec.width, height: spec.height });
    const visibility = await page.evaluate((fov) => {
      const app = window.__fw;
      const camera = app.scene3d.camera;
      camera.fov = fov;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const group = app.scene3d.scene.getObjectByName('Tool_spray');
      let meshes = 0;
      let projectedInFrame = 0;
      group?.updateWorldMatrix(true, true);
      group?.traverse((object) => {
        if (!object.isMesh || !object.visible) return;
        meshes += 1;
        object.geometry.computeBoundingSphere?.();
        const point = object.geometry.boundingSphere?.center?.clone() || object.position.clone();
        object.localToWorld(point);
        point.project(camera);
        if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
          && Math.abs(point.x) <= 1.1 && Math.abs(point.y) <= 1.1 && point.z >= -1 && point.z <= 1) {
          projectedInFrame += 1;
        }
      });
      return { cameraFov: camera.fov, meshes, projectedInFrame };
    }, spec.fov);
    await page.waitForTimeout(350);
    await screenshot(spec.file, `Spray viewmodel at ${spec.width}x${spec.height}, ${spec.fov}-degree FOV.`);
    fovMatrix.push({ ...spec, visibility });
  }
  check('held equipment remains projected in-frame across FOV and resolution matrix',
    fovMatrix.every((entry) => entry.visibility.meshes > 0 && entry.visibility.projectedInFrame > 0), fovMatrix);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    window.__fw.scene3d.camera.fov = 66;
    window.__fw.scene3d.camera.updateProjectionMatrix();
  });

  // PRESSURE WASHER: normal outdoor belt, left wash, right soap, authored nozzle-aligned jet.
  await poseFacing(5.6, 9.2, 5.6, 6.5, 0.06);
  check('normal outdoor F equips pressure washer', await cycleTo('washer', 'outdoor'));
  const washerBefore = await snapshot();
  const soapUse = await useTool(780, { button: 'right' });
  await waitForToasts();
  const washerUse = await useTool(1100, {
    screenshot: '16-pressure-washer-active.png',
    description: 'Authored pressure-washer wand with nozzle-aligned beam, droplets, and mist.',
  });
  const washChanged = Object.keys(washerBefore.wash).some((id) => {
    const before = washerBefore.wash[id];
    const afterSoap = soapUse.after.wash[id];
    const afterWash = washerUse.after.wash[id];
    return Math.abs(afterSoap.soap - before.soap) > 0.000001
      || Math.abs(afterWash.grime - before.grime) > 0.000001;
  });
  check('right mouse lays soap and left mouse washes a real exterior surface', washChanged,
    { before: washerBefore.wash, afterSoap: soapUse.after.wash, afterWash: washerUse.after.wash });
  check('washer use shows jet and mist from the authored nozzle with loop audio',
    washerUse.during.diagnostics.effects.washerJetVisible
      && washerUse.during.diagnostics.effects.washerMistVisible
      && washerUse.during.audio.active === 'washer',
    { diagnostics: washerUse.during.diagnostics, audio: washerUse.during.audio });

  // Stop and retain the player-view recording before performance measurement.
  if (captureStarted) {
    const downloadName = path.basename(videoFile);
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    const stopPromise = page.evaluate((name) => window.__fw.audio.stopCapture({ downloadName: name }), downloadName);
    const [download, stopped] = await Promise.all([downloadPromise, stopPromise]);
    const failure = await download.failure();
    if (failure) throw new Error(`Cleaning gameplay video download failed: ${failure}`);
    await download.saveAs(videoFile);
    mediaCapture = {
      output: videoFile,
      bytesOnDisk: fs.statSync(videoFile).size,
      ...captureStarted,
      ...stopped,
    };
  }
  check('recorded gameplay video is retained with non-silent player audio',
    !!mediaCapture && mediaCapture.bytesOnDisk > 100_000
      && mediaCapture.audioPeak > 0.0001
      && mediaCapture.nonSilentAudioWindows > 0,
    mediaCapture);

  // Matched performance: same 1440x900 indoor pose and 2.5-second sampling as the baseline.
  await pose(-5.5, 3.2, 0, -0.62);
  await cycleTo(null);
  const performance = { idleIndoor: [], vacuumActive: [] };
  for (let index = 0; index < 3; index += 1) {
    performance.idleIndoor.push(await performanceSample(`idle-indoor-${index + 1}`));
  }
  await cycleTo('vacuum');
  const perfViewport = page.viewportSize();
  await page.mouse.move(Math.floor(perfViewport.width / 2), Math.floor(perfViewport.height / 2));
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(300);
  for (let index = 0; index < 3; index += 1) {
    performance.vacuumActive.push(await performanceSample(`vacuum-active-${index + 1}`));
  }
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(300);

  const baselinePath = path.join(repo, 'qa', 'overnight', 'cleaning-gameplay', 'baseline', 'baseline-result.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const comparison = {
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    sampleDurationSeconds: 2.5,
    samplesPerScenario: 3,
    idleAverageFps: {
      baselineMedian: median(baseline.performance.idleIndoor.map((entry) => entry.averageFps)),
      finalMedian: median(performance.idleIndoor.map((entry) => entry.averageFps)),
    },
    vacuumAverageFps: {
      baselineMedian: median(baseline.performance.vacuumActive.map((entry) => entry.averageFps)),
      finalMedian: median(performance.vacuumActive.map((entry) => entry.averageFps)),
    },
    idleOnePercentLow: {
      baselineMedian: median(baseline.performance.idleIndoor.map((entry) => entry.onePercentLowFps)),
      finalMedian: median(performance.idleIndoor.map((entry) => entry.onePercentLowFps)),
    },
    vacuumOnePercentLow: {
      baselineMedian: median(baseline.performance.vacuumActive.map((entry) => entry.onePercentLowFps)),
      finalMedian: median(performance.vacuumActive.map((entry) => entry.onePercentLowFps)),
    },
  };
  comparison.idleAverageFps.retention = comparison.idleAverageFps.finalMedian / comparison.idleAverageFps.baselineMedian;
  comparison.vacuumAverageFps.retention = comparison.vacuumAverageFps.finalMedian / comparison.vacuumAverageFps.baselineMedian;
  comparison.idleOnePercentLow.retention = comparison.idleOnePercentLow.finalMedian / comparison.idleOnePercentLow.baselineMedian;
  comparison.vacuumOnePercentLow.retention = comparison.vacuumOnePercentLow.finalMedian / comparison.vacuumOnePercentLow.baselineMedian;
  check('matched indoor idle performance retains at least 75% of baseline median FPS',
    comparison.idleAverageFps.retention >= 0.75, comparison.idleAverageFps);
  check('matched active-vacuum performance retains at least 75% of baseline median FPS',
    comparison.vacuumAverageFps.retention >= 0.75, comparison.vacuumAverageFps);

  await cycleTo(null);
  // Matched opposite angle from another walk-free point, showing bucket, wall tools, and supplies.
  await poseFacing(8.55, -1.25, 7.65, 1.08, -0.22);
  await waitForToasts();
  await screenshot('17-final-cleaning-bay.png', 'Final fixed-camera cleaning-bay evidence after the complete accepted lifecycle.');
  const finalSnapshot = await snapshot();
  check('all authored clubhouse props load without failures',
    finalSnapshot.props.placed === finalSnapshot.props.expected && finalSnapshot.props.failed === 0,
    finalSnapshot.props);
  check('no tool, particles, work animation, or loop audio survives final stow',
    finalSnapshot.tool === null
      && !finalSnapshot.diagnostics.using
      && !finalSnapshot.diagnostics.soaping
      && !finalSnapshot.diagnostics.sprayVisible
      && !finalSnapshot.diagnostics.effects.motesVisible
      && !finalSnapshot.diagnostics.effects.washerJetVisible
      && finalSnapshot.diagnostics.viewmodels.playing.length === 0
      && finalSnapshot.audio.active === null,
    finalSnapshot.diagnostics);
  const abortedDuringSceneReload = failedRequests.filter((entry) => /net::ERR_ABORTED/.test(entry));
  const unexpectedFailedRequests = failedRequests.filter((entry) => !/net::ERR_ABORTED/.test(entry));
  check('browser route has no console errors or unexpected failed requests',
    consoleErrors.length === 0 && unexpectedFailedRequests.length === 0,
    { consoleErrors, unexpectedFailedRequests, abortedDuringSceneReload, consoleWarnings });

  const failedChecks = checks.filter((entry) => !entry.pass);
  return {
    ok: failedChecks.length === 0,
    capturedAt: new Date().toISOString(),
    branch: 'overnight/cleaning-gameplay',
    baseCommit: '1dfb9de646c6785b027ddb023dda1e3a6af9a5c6',
    baseDeviation: 'Requested overnight/base-2026-07-18 did not exist; branch uses the immutable integration commit shared by the sibling overnight work.',
    controls: ['F', 'left mouse hold', 'right mouse hold', 'E', 'X', 'Escape pause save/load'],
    checks,
    failedChecks,
    normalControlProof,
    performance,
    comparison,
    lifecycle: { before: lifecycleBefore, after: lifecycleAfter },
    fovMatrix,
    mediaCapture,
    captures,
    diagnostics: { consoleErrors, consoleWarnings, failedRequests },
    finalSnapshot,
  };
}

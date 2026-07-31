async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const iteration = String(process.env.DOORS_QA_ITERATION || '1');
  const out = path.join(repoRoot, 'qa', 'doors', 'iterations', `iteration-${iteration}`);
  fs.mkdirSync(out, { recursive: true });

  await page.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const registrations = new WeakMap();
    const listeners = { active: 0, added: 0, removed: 0, byType: Object.create(null) };
    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
      if (listener) {
        let target = registrations.get(this);
        if (!target) {
          target = new Map();
          registrations.set(this, target);
        }
        let set = target.get(type);
        if (!set) {
          set = new Set();
          target.set(type, set);
        }
        if (!set.has(listener)) {
          set.add(listener);
          listeners.active += 1;
          listeners.added += 1;
          listeners.byType[type] = (listeners.byType[type] || 0) + 1;
        }
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
      const set = registrations.get(this)?.get(type);
      if (listener && set?.delete(listener)) {
        listeners.active -= 1;
        listeners.removed += 1;
        listeners.byType[type] = Math.max(0, (listeners.byType[type] || 0) - 1);
      }
      return originalRemove.call(this, type, listener, options);
    };
    window.__doorsQaListeners = listeners;
    window.__doorsQaUi = { callbacks: 0, records: 0 };
    addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver((records) => {
        window.__doorsQaUi.callbacks += 1;
        window.__doorsQaUi.records += records.length;
      });
      observer.observe(document.documentElement, {
        attributes: true, childList: true, characterData: true, subtree: true,
      });
      window.__doorsQaObserver = observer;
    }, { once: true });
  });

  const browserDiagnostics = [];
  const browserNotices = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      const entry = `console:${message.type()}: ${message.text()}`;
      // Three.js emits this once per renderer while internally selecting the
      // supported replacement. Keep it in the evidence without treating a
      // dependency deprecation notice as a game/browser failure.
      if (message.type() === 'warning'
          && message.text().includes('PCFSoftShadowMap has been deprecated')) {
        browserNotices.push(entry);
      } else {
        browserDiagnostics.push(entry);
      }
    }
  });
  page.on('pageerror', (error) => browserDiagnostics.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || 'unknown';
    const message = `requestfailed: ${request.url()} (${errorText})`;
    // Chromium aborts outstanding GLB fetches when the save/load step replaces
    // the document. That is lifecycle cancellation, not an asset-load failure;
    // the ready/failedCount assertions below remain the authoritative gate.
    if (errorText === 'net::ERR_ABORTED') browserNotices.push(message);
    else browserDiagnostics.push(message);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  await page.waitForFunction(() => {
    const doors = window.__fw?.scene3d?.clubhouse?.()?.architecturalDoors;
    return doors?.diagnostics?.().ready === true;
  }, null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60000 });
  await page.addStyleTag({
    content: '.toast-wrap, .notification-center, .shop-lockhint { display: none !important; }',
  });
  await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
  });
  await page.waitForTimeout(800);

  async function setPose(at, target, pitch = -0.04) {
    await page.evaluate(({ atLocal, targetLocal, lookPitch }) => {
      const scene = window.__fw.scene3d;
      const clubhouse = scene.clubhouse();
      clubhouse.group.updateWorldMatrix(true, false);
      const atWorld = clubhouse.group.localToWorld(
        clubhouse.group.position.clone().set(atLocal[0], 0, atLocal[1]),
      );
      const targetWorld = clubhouse.group.localToWorld(
        clubhouse.group.position.clone().set(targetLocal[0], 0, targetLocal[1]),
      );
      scene.walk.clearKeys();
      scene.walk.state.x = atWorld.x;
      scene.walk.state.z = atWorld.z;
      const dx = targetWorld.x - atWorld.x;
      const dz = targetWorld.z - atWorld.z;
      scene.walk.state.yaw = Math.atan2(-dx, -dz);
      scene.walk.state.pitch = lookPitch;
      const day = Math.floor(window.__fw.state.clock.minutes / 1440);
      window.__fw.state.clock.minutes = day * 1440 + 14 * 60;
      window.__fw.state.weather.today.rainIn = 0;
      scene.applyTimeWeather(14 * 60, window.__fw.state.weather);
    }, { atLocal: at, targetLocal: target, lookPitch: pitch });
    await page.waitForTimeout(400);
  }

  async function shot(name) {
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  }

  async function waitFocus(pattern, timeout = 8000) {
    const source = pattern.source;
    const flags = pattern.flags;
    await page.waitForFunction(({ regexSource, regexFlags }) => {
      const label = window.__fw?.scene3d?.walk?.getFocusLabel?.() || '';
      return new RegExp(regexSource, regexFlags).test(label);
    }, { regexSource: source, regexFlags: flags }, { timeout });
    return page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
  }

  async function resetDoor(name) {
    await page.evaluate((doorName) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const door = clubhouse.doors.find((entry) => entry.name === doorName);
      if (!door) return;
      if (door.mainLeaf) {
        for (const leaf of door.leaves) {
          leaf.desiredOpen = false;
          leaf.open = false;
        }
        const main = window.__fw.state.shop.reno.architecture.doors.main;
        main.left = 'closed';
        main.right = 'closed';
      } else {
        door.open = false;
        door.swingTarget = door.fixedSwing;
      }
    }, name);
    await page.waitForTimeout(900);
  }

  async function setQuality(qualityId) {
    const result = await page.evaluate(async (quality) => {
      const finishes = await import('/src/sim/constructionFinishes.js');
      const state = window.__fw.state;
      state.cash = Math.max(Number(state.cash) || 0, 10_000_000);
      const construction = finishes.ensureConstructionFinishes(state);
      const selectionId = `doors:hollow-core:${quality}`;
      if (!construction.owned.includes(selectionId)) construction.owned.push(selectionId);
      const installed = finishes.installConstructionFinish(state, 'doors', 'hollow-core', quality);
      const sync = await window.__fw.scene3d.clubhouse().architecturalDoors.sync();
      return { installed, sync };
    }, qualityId);
    await page.waitForFunction((quality) => {
      const diag = window.__fw.scene3d.clubhouse().architecturalDoors.diagnostics();
      const expected = quality === 'municipal' ? 'basic' : quality;
      return diag.installedServiceTier === expected
        && diag.service.stockroom.authoredBound
        && diag.service.receiving.authoredBound;
    }, qualityId, { timeout: 60000 });
    await page.waitForTimeout(400);
    return result;
  }

  async function hardwareSample(holderRole) {
    return page.evaluate((role) => {
      const holders = window.__fw.scene3d.clubhouse().architecturalDoors.holders();
      const holder = [...holders].reverse().find((entry) => (
        entry.userData.mountRole === role && entry.visible && entry.userData.loaded
      ));
      if (!holder) return null;
      const handles = [];
      const latches = [];
      holder.traverse((node) => {
        if (/^PIVOT_Handle/.test(node.name)) handles.push({
          name: node.name,
          rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
        });
        if (/^PIVOT_LatchBolt/.test(node.name)) latches.push({
          name: node.name,
          position: [node.position.x, node.position.y, node.position.z],
        });
      });
      return { handles, latches };
    }, holderRole);
  }

  const functional = {
    main: {},
    service: [],
    playerTraversals: [],
    npcTraversals: [],
    multipleNpcTraversal: null,
    saveLoad: null,
  };

  async function localPlayerPosition() {
    return page.evaluate(() => {
      const scene = window.__fw.scene3d;
      const clubhouse = scene.clubhouse();
      const local = clubhouse.group.worldToLocal(
        clubhouse.group.position.clone().set(scene.walk.state.x, 0, scene.walk.state.z),
      );
      return { x: local.x, z: local.z };
    });
  }

  await resetDoor('Shop door');
  await setPose([-0.8, 8.65], [-0.8, 7.13], -0.08);
  functional.main.focus = await waitFocus(/Shop doors/);
  await setPose([-0.8, 9.35], [-0.8, 7.13], -0.06);
  await shot('01-luxury-main-exterior-closed');
  await setPose([-0.8, 8.65], [-0.8, 7.13], -0.08);
  const closedCollisionBefore = await localPlayerPosition();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);
  const closedCollisionAfter = await localPlayerPosition();
  functional.main.closedCollision = {
    before: closedCollisionBefore,
    after: closedCollisionAfter,
    blocked: closedCollisionAfter.z > 7.25,
  };
  await setPose([-0.8, 8.65], [-0.8, 7.13], -0.08);
  await waitFocus(/Shop doors/);
  const mainHardwareBefore = await hardwareSample('main');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(130);
  const mainHardwarePressed = await hardwareSample('main');
  await page.waitForTimeout(1100);
  functional.main.bothOpen = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().doors
      .filter((door) => door.isMain)
      .map((door) => ({ leaf: door.mainLeaf, angle: door.angle, desiredOpen: door.desiredOpen }))
  ));
  functional.main.hardware = { before: mainHardwareBefore, pressed: mainHardwarePressed };
  await setPose([-0.8, 9.35], [-0.8, 7.13], -0.06);
  await shot('02-luxury-main-exterior-both-open');

  async function walkForwardThrough(label, start, target, durationMs, expectedLocalZ) {
    await setPose(start, target, -0.08);
    const before = await page.evaluate(() => {
      const scene = window.__fw.scene3d;
      const clubhouse = scene.clubhouse();
      const local = clubhouse.group.worldToLocal(
        clubhouse.group.position.clone().set(scene.walk.state.x, 0, scene.walk.state.z),
      );
      return { x: local.x, z: local.z };
    });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(durationMs);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => {
      const scene = window.__fw.scene3d;
      const clubhouse = scene.clubhouse();
      const local = clubhouse.group.worldToLocal(
        clubhouse.group.position.clone().set(scene.walk.state.x, 0, scene.walk.state.z),
      );
      return { x: local.x, z: local.z };
    });
    const passed = expectedLocalZ === 'less' ? after.z < 6.6 : after.z > 7.7;
    const sample = { label, before, after, expectedLocalZ, passed };
    functional.playerTraversals.push(sample);
    return sample;
  }

  await walkForwardThrough(
    'luxury-main-outside-in', [-0.8, 8.65], [-0.8, 5.4], 1150, 'less',
  );
  await setPose([-0.8, 5.35], [-0.8, 7.13], -0.08);
  await shot('03-luxury-main-interior-both-open');
  await walkForwardThrough(
    'luxury-main-inside-out', [-0.8, 5.35], [-0.8, 8.65], 1150, 'greater',
  );

  await resetDoor('Shop door');
  await setPose([-1.35, 8.45], [-0.95, 7.13], -0.08);
  await waitFocus(/Shop doors/);
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(1100);
  functional.main.leftOnly = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().doors.filter((door) => door.isMain)
      .map((door) => ({ leaf: door.mainLeaf, angle: door.angle, desiredOpen: door.desiredOpen }))
  ));
  await setPose([-1.35, 9.10], [-0.8, 7.13], -0.06);
  await shot('04-luxury-main-left-only');

  await resetDoor('Shop door');
  // Stay on the right-leaf half but closer to the door than the nearby hours
  // sign and exterior dressing, so the normal X interaction owns focus.
  await setPose([-0.05, 7.95], [-0.65, 7.13], -0.08);
  await waitFocus(/Shop doors/);
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(1100);
  functional.main.rightOnly = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().doors.filter((door) => door.isMain)
      .map((door) => ({ leaf: door.mainLeaf, angle: door.angle, desiredOpen: door.desiredOpen }))
  ));
  await setPose([-0.25, 9.10], [-0.8, 7.13], -0.06);
  await shot('05-luxury-main-right-only');

  const qualities = [
    ['municipal', 'basic'],
    ['standard', 'standard'],
    ['premium', 'premium'],
    ['high-end', 'high-end'],
  ];
  let shotIndex = 6;
  for (const [quality, tier] of qualities) {
    await setQuality(quality);
    await resetDoor('Stockroom door');
    await setPose([8.30, 3.75], [8.9, 2.0], -0.08);
    const focus = await waitFocus(/Stockroom door/);
    await shot(`${String(shotIndex++).padStart(2, '0')}-${tier}-stockroom-office-closed`);
    const before = await hardwareSample('stockroom');
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(130);
    const pressed = await hardwareSample('stockroom');
    await page.waitForTimeout(1050);
    const state = await page.evaluate(() => {
      const door = window.__fw.scene3d.clubhouse().doors.find((entry) => entry.name === 'Stockroom door');
      return { open: door.open, angle: door.angle, swingTarget: door.swingTarget, collider: { ...door.collider } };
    });
    await shot(`${String(shotIndex++).padStart(2, '0')}-${tier}-stockroom-office-open`);
    await setPose([9.65, 0.30], [8.9, 2.0], -0.08);
    await shot(`${String(shotIndex++).padStart(2, '0')}-${tier}-stockroom-rear-open`);
    functional.service.push({ quality, tier, focus, before, pressed, state });
  }

  await setQuality('high-end');
  await resetDoor('Receiving door');
  await setPose([14.10, -4.55], [11.36, -3.6], -0.02);
  await shot(`${String(shotIndex++).padStart(2, '0')}-high-end-receiving-exterior-closed`);
  // The current 3,000-square-foot shell places the east wall at x=11.358 yd.
  // Stand comfortably inside the production interaction radius rather than on
  // the stale pre-expansion 11.23-yd datum.
  await setPose([9.35, -3.6], [11.36, -3.6], -0.08);
  await waitFocus(/Receiving door/);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1150);
  const receivingOpenedState = await page.evaluate(() => {
    const door = window.__fw.scene3d.clubhouse().doors.find((entry) => entry.name === 'Receiving door');
    return {
      open: door.open,
      angle: door.angle,
      fixedSwing: door.fixedSwing,
      closedSign: door.closedSign,
      collider: { ...door.collider },
    };
  });
  await setPose([12.90, -4.35], [11.36, -3.6], -0.08);
  await shot(`${String(shotIndex++).padStart(2, '0')}-high-end-receiving-exterior-open-hinge-side`);
  await setPose([13.60, -3.60], [11.36, -3.6], -0.02);
  await shot(`${String(shotIndex++).padStart(2, '0')}-high-end-receiving-exterior-open-front`);
  const receivingFinalState = await page.evaluate(() => {
    const door = window.__fw.scene3d.clubhouse().doors.find((entry) => entry.name === 'Receiving door');
    return {
      open: door.open,
      angle: door.angle,
      fixedSwing: door.fixedSwing,
      closedSign: door.closedSign,
      collider: { ...door.collider },
    };
  });
  functional.receiving = {
    ...receivingOpenedState,
    finalState: receivingFinalState,
  };

  async function driveNpc(doorName, points, direction, repeat) {
    return page.evaluate(async ({ name, pathPoints, travelDirection, cycle }) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      // Counter-bound customers skip the unrelated organic merchandising plan,
      // then the deterministic doorway route below takes over their real actor.
      const actor = clubhouse.debugSpawn(true);
      if (!actor) return { ok: false, reason: 'spawn-failed', name, travelDirection, cycle };
      // Keep the real customer actor registered with the live door controller
      // while the deterministic QA route supplies its positions. A zero-speed
      // far target prevents the ordinary shopper itinerary from racing this
      // bidirectional doorway probe or removing the actor on the next frame.
      actor.stops = [{
        kind: 'walk',
        x: actor.mesh.position.x + 100,
        z: actor.mesh.position.z + 100,
      }];
      actor.stopIdx = 0;
      actor.speed = 0;
      actor.linger = 999;
      const root = clubhouse.group;
      const worldPoints = pathPoints.map(([x, z]) => {
        const p = root.localToWorld(root.position.clone().set(x, 0, z));
        return [p.x, p.z];
      });
      const door = clubhouse.doors.find((entry) => entry.name === name);
      let maxAngle = 0;
      for (const [x, z] of worldPoints) {
        actor.mesh.position.x = x;
        actor.mesh.position.z = z;
        await new Promise((resolve) => setTimeout(resolve, 180));
        maxAngle = Math.max(maxAngle, Math.abs(door.angle));
      }
      const result = {
        ok: maxAngle > 0.2,
        name,
        travelDirection,
        cycle,
        maxAngle,
        open: door.open,
      };
      clubhouse.clearWalkins();
      return result;
    }, { name: doorName, pathPoints: points, travelDirection: direction, cycle: repeat });
  }

  const npcPaths = [
    ['Shop door', [[-0.8, 8.3], [-0.8, 7.7], [-0.8, 7.15], [-0.8, 6.5]], 'outside-in'],
    ['Shop door', [[-0.8, 6.2], [-0.8, 6.7], [-0.8, 7.2], [-0.8, 8.0]], 'inside-out'],
    ['Stockroom door', [[8.9, 3.2], [8.9, 2.5], [8.9, 2.0], [8.9, 1.2]], 'office-stock'],
    ['Stockroom door', [[8.9, 0.8], [8.9, 1.5], [8.9, 2.0], [8.9, 2.8]], 'stock-office'],
    ['Receiving door', [[12.4, -3.6], [11.85, -3.6], [11.36, -3.6], [10.6, -3.6]], 'outside-in'],
    ['Receiving door', [[10.3, -3.6], [10.9, -3.6], [11.36, -3.6], [12.1, -3.6]], 'inside-out'],
  ];
  for (const [name, points, direction] of npcPaths) {
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      await resetDoor(name);
      functional.npcTraversals.push(await driveNpc(name, points, direction, cycle));
    }
  }

  await resetDoor('Shop door');
  functional.multipleNpcTraversal = await page.evaluate(async () => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const root = clubhouse.group;
    const actors = Array.from({ length: 3 }, () => clubhouse.debugSpawn(true)).filter(Boolean);
    for (const actor of actors) {
      actor.stops = [{
        kind: 'walk',
        x: actor.mesh.position.x + 100,
        z: actor.mesh.position.z + 100,
      }];
      actor.stopIdx = 0;
      actor.speed = 0;
      actor.linger = 999;
    }
    const primary = clubhouse.doors.find((entry) => entry.name === 'Shop door');
    const follower = clubhouse.doors.find((entry) => entry.name === 'Shop door right leaf');
    const zSteps = [8.35, 7.75, 7.15, 6.55];
    let maxLeftAngle = 0;
    let maxRightAngle = 0;
    for (const z of zSteps) {
      actors.forEach((actor, index) => {
        const local = root.position.clone().set(-1.05 + index * 0.25, 0, z - index * 0.08);
        const world = root.localToWorld(local);
        actor.mesh.position.x = world.x;
        actor.mesh.position.z = world.z;
      });
      await new Promise((resolve) => setTimeout(resolve, 220));
      maxLeftAngle = Math.max(maxLeftAngle, Math.abs(primary?.angle || 0));
      maxRightAngle = Math.max(maxRightAngle, Math.abs(follower?.angle || 0));
    }
    const finalLocalPositions = actors.map((actor) => {
      const local = root.worldToLocal(actor.mesh.position.clone());
      return { x: local.x, z: local.z };
    });
    const retainedActorCount = actors.filter((actor) => actor.mesh?.parent).length;
    const result = {
      spawnedCount: actors.length,
      retainedActorCount,
      maxLeftAngle,
      maxRightAngle,
      finalLocalPositions,
      passed: actors.length === 3
        && retainedActorCount === 3
        && maxLeftAngle > 0.8
        && maxRightAngle > 0.8
        && finalLocalPositions.every((position) => position.z < 6.7),
    };
    clubhouse.clearWalkins();
    return result;
  });

  await resetDoor('Shop door');
  await setPose([-1.35, 8.45], [-0.95, 7.13], -0.08);
  await waitFocus(/Shop doors/);
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(900);
  await setQuality('high-end');
  const beforeSave = await page.evaluate(() => ({
    leaves: { ...window.__fw.state.shop.reno.architecture.doors.main },
    quality: window.__fw.state.shop.reno.constructionFinishes.installed.doors.qualityId,
  }));
  await page.evaluate(() => window.__fw.autosave());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.state?.shop?.reno?.architecture?.doors?.main,
    null, { timeout: 60000 });
  const restoredState = await page.evaluate(() => ({
    leaves: { ...window.__fw.state.shop.reno.architecture.doors.main },
    quality: window.__fw.state.shop.reno.constructionFinishes.installed.doors.qualityId,
  }));
  await page.waitForFunction(() => (
    window.__fw?.scene3d?.clubhouse?.()?.architecturalDoors?.diagnostics?.().ready === true
  ), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60000 });
  await page.addStyleTag({
    content: '.toast-wrap, .notification-center, .shop-lockhint { display: none !important; }',
  });
  await page.waitForTimeout(800);
  const afterLoad = await page.evaluate(() => ({
    doors: window.__fw.scene3d.clubhouse().architecturalDoors.diagnostics(),
  }));
  functional.saveLoad = { beforeSave, restoredState, afterLoad };
  await setPose([-0.8, 8.65], [-0.8, 7.13], -0.08);
  await shot(`${String(shotIndex++).padStart(2, '0')}-save-load-restored`);

  const finalDiagnostics = await page.evaluate(() => ({
    architecturalDoors: window.__fw.scene3d.clubhouse().architecturalDoors.diagnostics(),
    sheet06: window.__fw.scene3d.clubhouse().sheet06Production.diagnostics(),
    listeners: { ...window.__doorsQaListeners, byType: { ...window.__doorsQaListeners.byType } },
    ui: { ...window.__doorsQaUi },
  }));
  const assertions = {
    mountsReady: finalDiagnostics.architecturalDoors.ready === true,
    noLoadFailures: finalDiagnostics.architecturalDoors.visuals.failedCount === 0,
    bothOpen: functional.main.bothOpen?.every((leaf) => Math.abs(leaf.angle) > 1.7),
    leftOnly: functional.main.leftOnly?.find((leaf) => leaf.leaf === 'left')?.angle > 1.7
      && Math.abs(functional.main.leftOnly?.find((leaf) => leaf.leaf === 'right')?.angle || 0) < 0.02,
    rightOnly: functional.main.rightOnly?.find((leaf) => leaf.leaf === 'right')?.angle < -1.7
      && Math.abs(functional.main.rightOnly?.find((leaf) => leaf.leaf === 'left')?.angle || 0) < 0.02,
    allServiceTiersOpened: functional.service.length === 4
      && functional.service.every((entry) => Math.abs(entry.state.angle) > 1.6),
    receivingOpenedOutward: functional.receiving?.closedSign === -1
      && functional.receiving?.angle < -1.6,
    closedDoorBlocksPlayer: functional.main.closedCollision?.blocked === true,
    playerTraversalBothDirections: functional.playerTraversals.length === 2
      && functional.playerTraversals.every((entry) => entry.passed),
    npcBothDirectionsRepeated: functional.npcTraversals.length === 18
      && functional.npcTraversals.every((entry) => entry.ok),
    multipleNpcTraversal: functional.multipleNpcTraversal?.passed === true,
    saveLoadRoundTrip: JSON.stringify(beforeSave) === JSON.stringify(restoredState),
    noBrowserErrors: browserDiagnostics.length === 0,
  };
  const result = {
    ok: Object.values(assertions).every(Boolean),
    iteration,
    assertions,
    functional,
    browserDiagnostics,
    browserNotices,
    finalDiagnostics,
    screenshotDirectory: path.relative(repoRoot, out).replaceAll('\\', '/'),
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

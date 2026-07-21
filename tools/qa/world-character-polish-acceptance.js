// Property Expansion world/character acceptance. The deterministic camera
// setup only frames evidence; the entrance and yard-collision routes use the
// player's real E/W controls and the exact live walk colliders.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const base = process.env.QA_BASE_URL || 'http://localhost:18679/';
  const iteration = process.env.WORLD_CHARACTER_QA_ITERATION || 'iteration-2';
  const out = path.resolve(repo, process.env.WORLD_CHARACTER_QA_OUT
    || `qa/property-expansion-world-overhaul/world-character/${iteration}`);
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => diagnostics.push(
    `requestfailed:${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  ));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return (!veil || getComputedStyle(veil).display === 'none'
      || Number.parseFloat(getComputedStyle(veil).opacity || '1') <= 0.01)
      && window.__fw?.prewarming !== true;
  }, null, { timeout: 120000 });
  await page.evaluate(async () => {
    const barrier = window.__fw.scene3d.assetBarrier?.(120000);
    if (barrier?.promise) await barrier.promise;
  });
  await page.waitForFunction(() => {
    const scene = window.__fw?.scene3d?.scene;
    return scene?.getObjectByName('MaintenanceYardDressing');
  }, null, { timeout: 90000 });
  await page.waitForTimeout(700);

  await page.locator('#game').click({ position: { x: 800, y: 450 }, force: true });
  const pointerLock = await page.waitForFunction(() => (
    document.pointerLockElement === document.getElementById('game')
  ), null, { timeout: 1500 }).then(() => true).catch(() => false);
  if (!pointerLock) {
    await page.evaluate(() => {
      const hint = document.querySelector('.shop-lockhint');
      if (hint) hint.style.visibility = 'hidden';
    });
  }

  const fixedCamera = async (shot) => {
    await page.evaluate((next) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + next.x;
      walk.state.z = origin.z + next.z;
      const dx = next.tx - next.x;
      const dz = next.tz - next.z;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = next.pitch || 0;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    }, shot);
    await page.waitForTimeout(550);
  };

  await fixedCamera({ x: 6.5, z: 15.5, tx: -0.5, tz: 3.0, pitch: 0.03 });
  await page.screenshot({ path: path.join(out, '01-clear-clubhouse-approach.png') });

  // Put the canonical door state on closed, then use the same E/W route as a
  // player. This setup call does not advance or replace the interaction.
  await page.evaluate(async () => {
    const app = window.__fw;
    const restoration = await import('/src/sim/clubhouseRestoration.js');
    restoration.setMainDoorState(app.state, 'closed');
    app.scene3d.clubhouse().rebuildReno();
  });
  await fixedCamera({ x: -1.5, z: 8.35, tx: -0.8, tz: 6.625, pitch: 0.01 });
  await page.waitForFunction(() => /Shop door/i.test(
    window.__fw?.scene3d?.walk?.getFocusLabel?.() || '',
  ), null, { timeout: 10000 });
  await page.screenshot({ path: path.join(out, '02-entrance-closed-clearway.png') });
  const routeStart = await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    return {
      x: app.scene3d.walk.state.x - origin.x,
      z: app.scene3d.walk.state.z - origin.z,
    };
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const main = window.__fw?.state?.shop?.reno?.architecture?.doors?.main;
    return main?.left === 'open' && main?.right === 'open';
  }, null, { timeout: 10000 });
  await page.screenshot({ path: path.join(out, '03-entrance-open-normal-e.png') });
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      return app.scene3d.walk.state.z - origin.z < 5.2;
    }, null, { timeout: 7000 });
  } finally {
    await page.keyboard.up('w').catch(() => {});
  }
  const routeEnd = await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    return {
      x: app.scene3d.walk.state.x - origin.x,
      z: app.scene3d.walk.state.z - origin.z,
    };
  });

  await fixedCamera({ x: 7.2, z: 26.2, tx: 17.0, tz: 16.2, pitch: -0.05 });
  await page.screenshot({ path: path.join(out, '04-maintenance-yard-context.png') });
  await fixedCamera({ x: 13.0, z: 22.6, tx: 18.6, tz: 16.8, pitch: -0.10 });
  await page.screenshot({ path: path.join(out, '05-maintenance-yard-player-view.png') });

  // Start west of the authored east-fence proxy and drive straight into it
  // with W. The resulting stop is evidence that the Blender collision reached
  // the live first-person world, not merely that a COL node exists in the GLB.
  const collisionSetup = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const collider = app.scene3d.scene.getObjectByName('COL_EastFence');
    collider.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(collider);
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.state.x = bounds.min.x - 1.15;
    walk.state.z = (bounds.min.z + bounds.max.z) / 2;
    walk.state.yaw = -Math.PI / 2;
    walk.state.pitch = -0.02;
    return {
      startX: walk.state.x,
      fenceMinX: bounds.min.x,
      fenceMaxX: bounds.max.x,
      z: walk.state.z,
    };
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(1100);
  await page.keyboard.up('w');
  const collisionEnd = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x,
    z: window.__fw.scene3d.walk.state.z,
  }));

  // Raise real course activity and let the normal visual population spawn.
  await page.evaluate(() => {
    const app = window.__fw;
    app.state.club.lastRounds = 50;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
  });
  await page.waitForFunction(() => (
    window.__fw.scene3d.golferCount() >= 3
      && window.__fw.scene3d.scene.getObjectByName('GolferIronEquipment')
  ), null, { timeout: 20000 });
  await page.waitForFunction(() => ![...document.querySelectorAll('*')].some((element) => (
    element.textContent?.trim() === 'Stepped you back to where you last had room.'
      && getComputedStyle(element).visibility !== 'hidden'
      && getComputedStyle(element).display !== 'none'
      && Number.parseFloat(getComputedStyle(element).opacity || '1') > 0.01
  )), null, { timeout: 7000 }).catch(() => {});
  const characterEvidence = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    app.scene3d.setGolfersFrozen(true);
    let club = null;
    app.scene3d.scene.traverse((object) => {
      if (!club && object.name === 'GolferIronEquipment') club = object;
    });
    let characterRoot = club;
    while (characterRoot && !characterRoot.userData?.char) characterRoot = characterRoot.parent;
    const char = characterRoot?.userData?.char;
    if (!club || !char) return null;
    char.setMode('Swing');
    char.update(1.22);
    characterRoot.updateMatrixWorld(true);
    const grip = char.carryGrip('R').getWorldPosition(new THREE.Vector3());
    const offHandGrip = char.carryGrip('L').getWorldPosition(new THREE.Vector3());
    const clubPivot = club.getWorldPosition(new THREE.Vector3());
    const yaw = characterRoot.rotation.y;
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    // Stay close enough to the fairway actor that random nearby trees or
    // structures cannot clip the evidence frame between seeded populations.
    const cameraX = characterRoot.position.x + forwardX * 2.8;
    const cameraZ = characterRoot.position.z + forwardZ * 2.8;
    const walk = app.scene3d.walk;
    walk.state.x = cameraX;
    walk.state.z = cameraZ;
    walk.state.yaw = Math.atan2(-(characterRoot.position.x - cameraX), -(characterRoot.position.z - cameraZ));
    walk.state.pitch = -0.13;
    return {
      gripDistance: grip.distanceTo(clubPivot),
      twoHandGripDistance: grip.distanceTo(offHandGrip),
      mode: char.mode,
      clubVisible: club.visible,
      idleVariant: char.idleVariant,
      x: characterRoot.position.x,
      z: characterRoot.position.z,
    };
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(out, '06-golfer-swing-with-club.png') });

  const equipmentContexts = await page.evaluate(() => {
    let club = null;
    window.__fw.scene3d.scene.traverse((object) => {
      if (!club && object.name === 'GolferIronEquipment') club = object;
    });
    let root = club;
    while (root && !root.userData?.char) root = root.parent;
    const char = root?.userData?.char;
    if (!char) return null;
    char.setMode('Drive');
    char.update(0.3);
    const hiddenWhileDriving = club.visible === false;
    char.setMode('Idle');
    char.update(0.35);
    return { hiddenWhileDriving, visibleOnFoot: club.visible === true };
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, '07-golfer-idle-variation.png') });

  await fixedCamera({ x: 6.5, z: 15.5, tx: -0.5, tz: 3.0, pitch: 0.03 });
  const performanceRuns = [];
  for (let run = 0; run < 3; run += 1) {
    performanceRuns.push(await page.evaluate(() => new Promise((resolve) => {
      const frames = [];
      const began = performance.now();
      let previous = began;
      function tick(now) {
        frames.push(now - previous);
        previous = now;
        if (now - began < 3000) return requestAnimationFrame(tick);
        const total = frames.reduce((sum, value) => sum + value, 0);
        const sorted = [...frames].sort((a, b) => a - b);
        resolve({
          averageFps: frames.length * 1000 / total,
          onePercentLowFps: 1000 / sorted[Math.max(0, Math.floor(sorted.length * 0.99) - 1)],
          worstFrameMs: Math.max(...frames),
        });
      }
      requestAnimationFrame(tick);
    })));
  }
  const runtimeFacts = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const yard = scene.getObjectByName('MaintenanceYardDressing');
    const approachSign = app.scene3d.clubhouse().group.getObjectByName('ClubApproachSign');
    const collisionNodes = [];
    const materials = new Set();
    const yardCollisionNames = new Set([
      'COL_BackFence', 'COL_EastFence', 'COL_GroundsRack', 'COL_GroundsSign',
    ]);
    scene.traverse((object) => {
      if (yardCollisionNames.has(object.name)) {
        collisionNodes.push({ name: object.name, visible: object.visible });
      }
      if (object.material) {
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (material) materials.add(material.uuid);
        }
      }
    });
    const yardBounds = new THREE.Box3().setFromObject(yard).getSize(new THREE.Vector3());
    return {
      yardPresent: Boolean(yard),
      yardBounds: yardBounds.toArray(),
      collisionNodes,
      approachSign: approachSign ? { x: approachSign.position.x, z: approachSign.position.z } : null,
      geometryCount: app.scene3d.renderer.info.memory.geometries,
      textureCount: app.scene3d.renderer.info.memory.textures,
      materialCount: materials.size,
      golferStates: app.scene3d.golferVisualState(),
    };
  });
  const fps = performanceRuns.reduce((sum, run) => sum + run.averageFps, 0) / performanceRuns.length;
  const assertions = {
    authoredYardVisible: runtimeFacts.yardPresent && runtimeFacts.yardBounds[0] > 9 && runtimeFacts.yardBounds[2] > 7,
    collisionProxiesHidden: runtimeFacts.collisionNodes.length === 4
      && runtimeFacts.collisionNodes.every((node) => node.visible === false),
    yardFenceStopsNormalMovement: collisionEnd.x > collisionSetup.startX + 0.2
      && collisionEnd.x < collisionSetup.fenceMinX,
    normalDoorInteraction: routeEnd.z < routeStart.z - 2.5,
    crossedEntranceClearway: routeEnd.z < 5.2,
    approachSignMovedAside: runtimeFacts.approachSign
      && runtimeFacts.approachSign.x < -2.1,
    golferClubAtGrip: characterEvidence?.gripDistance < 0.08,
    golferTwoHandGrip: characterEvidence?.twoHandGripDistance < 0.18,
    golferSwingVisible: characterEvidence?.mode === 'Swing' && characterEvidence?.clubVisible === true,
    equipmentContextual: equipmentContexts?.hiddenWhileDriving && equipmentContexts?.visibleOnFoot,
    threeGolferPopulation: runtimeFacts.golferStates.length >= 3,
    geometryAllocationImproved: runtimeFacts.geometryCount <= 1600,
    // The captured pre-change clubhouse baseline used 837 unique materials.
    // This census deliberately includes a live three-golfer population.
    materialAllocationImproved: runtimeFacts.materialCount < 837,
    performanceImproved: fps >= 32,
    noDiagnostics: diagnostics.length === 0,
  };
  const result = {
    ok: Object.values(assertions).every(Boolean),
    iteration,
    assertions,
    route: { start: routeStart, end: routeEnd },
    collision: { setup: collisionSetup, end: collisionEnd },
    characterEvidence,
    equipmentContexts,
    runtimeFacts,
    performanceRuns,
    averageFps: fps,
    diagnostics,
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) throw new Error(`World/character acceptance failed: ${JSON.stringify(assertions)}`);
  return result;
}

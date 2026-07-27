async (page) => {
  // SHEET 6 COLLISION / NAVIGATION QA
  //
  // Direct position/state writes below establish repeatable fixtures only. Every
  // accepted movement, barrier, and door result is exercised through the same
  // W, E, and ArrowLeft events used by a player in first-person mode.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = process.env.SHEET06_COLLISION_QA_OUT
    ? path.resolve(repo, process.env.SHEET06_COLLISION_QA_OUT)
    : path.join(repo, 'qa', 'assets_51_100_master', 'sheet_06', 'collisions', 'final');
  fs.mkdirSync(out, { recursive: true });

  const viewport = { width: 1600, height: 900 };
  const diagnostics = [];
  const captures = [];
  let phase = 'setup';
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push({ phase, kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    diagnostics.push({ phase, kind: 'pageerror', message: error.message });
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    diagnostics.push({
      phase,
      kind: /ERR_ABORTED/i.test(failure) ? 'requestaborted' : 'requestfailed',
      message: `${request.url()} (${failure})`,
    });
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    diagnostics.push({
      phase,
      kind: 'http-response',
      message: `${response.status()} ${response.request().method()} ${response.url()}`,
      resourceType: response.request().resourceType(),
    });
  });

  const capture = async (name) => {
    const file = path.join(out, name);
    await page.screenshot({ path: file });
    captures.push(file);
    return file;
  };

  const productionDiagnostics = () => page.evaluate(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    return production?.diagnostics?.() || null;
  });

  const playerSnapshot = (label) => page.evaluate((snapshotLabel) => {
    const app = window.__fw;
    const clubhouse = app?.scene3d?.clubhouse?.();
    const walkApi = app?.scene3d?.walk;
    const walk = walkApi?.state;
    if (!clubhouse || !walkApi || !walk) throw new Error('Player snapshot requires the live walk controller.');
    const origin = clubhouse.interior.position;
    const clubhouseGroundY = clubhouse.groundYAt(walk.x, walk.z);
    const terrainGroundY = app.scene3d.heightAt(walk.x, walk.z);
    const effectiveGroundY = clubhouseGroundY ?? terrainGroundY;
    const cameraY = app.scene3d.camera.position.y;
    return {
      label: snapshotLabel,
      world: { x: walk.x, z: walk.z },
      local: { x: walk.x - origin.x, z: walk.z - origin.z },
      yaw: walk.yaw,
      pitch: walk.pitch,
      radius: walk.radius,
      eye: walk.eye,
      clubhouseGroundY,
      terrainGroundY,
      effectiveGroundY,
      cameraY,
      cameraFootY: cameraY - walk.eye,
      cameraFootError: cameraY - walk.eye - effectiveGroundY,
      inside: clubhouse.isInside(walk.x, walk.z),
      free: walkApi.isFree(walk.x, walk.z, walk.radius),
      focusLabel: walkApi.getFocusLabel?.() || null,
      doorState: {
        left: app.state.shop?.reno?.architecture?.doors?.main?.left ?? null,
        right: app.state.shop?.reno?.architecture?.doors?.main?.right ?? null,
      },
    };
  }, label);

  async function setPlayerFixture(pose, label) {
    const established = await page.evaluate(({ targetPose, fixtureLabel }) => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      const walkApi = app?.scene3d?.walk;
      if (!clubhouse || !walkApi?.state) throw new Error(`Fixture '${fixtureLabel}' requires walk mode.`);
      const origin = clubhouse.interior.position;
      const walk = walkApi.state;
      walkApi.clearKeys?.();
      walkApi.clearFocus?.();
      walkApi.setTool?.(null);
      walkApi.setSpraying?.(false);
      walkApi.setSoaping?.(false);
      walk.x = origin.x + targetPose.x;
      walk.z = origin.z + targetPose.z;
      if (Number.isFinite(targetPose.yaw)) {
        walk.yaw = targetPose.yaw;
      } else {
        const dx = targetPose.tx - targetPose.x;
        const dz = targetPose.tz - targetPose.z;
        walk.yaw = Math.atan2(-dx, -dz);
      }
      walk.pitch = Number.isFinite(targetPose.pitch) ? targetPose.pitch : -0.04;
      return {
        classification: 'deterministic fixture setup only; excluded from normal-control acceptance',
        label: fixtureLabel,
        requested: targetPose,
        initiallyFree: walkApi.isFree(walk.x, walk.z, walk.radius),
      };
    }, { targetPose: pose, fixtureLabel: label });
    await page.waitForTimeout(260);
    return { established, settled: await playerSnapshot(`${label}:settled`) };
  }

  async function holdNormalKeyAndSample(key, {
    durationMs = 900,
    until = null,
    label = key,
  } = {}) {
    await page.keyboard.down(key);
    try {
      return await page.evaluate(async ({ sampleDurationMs, stop, sampleLabel, normalKey }) => {
        const app = window.__fw;
        const clubhouse = app?.scene3d?.clubhouse?.();
        const walkApi = app?.scene3d?.walk;
        if (!clubhouse || !walkApi?.state) throw new Error(`Normal-key sample '${sampleLabel}' requires walk mode.`);
        const origin = clubhouse.interior.position;
        const startedAt = performance.now();
        let lastSampleAt = -Infinity;
        const samples = [];
        const collect = (now) => {
          const walk = walkApi.state;
          const clubhouseGroundY = clubhouse.groundYAt(walk.x, walk.z);
          const terrainGroundY = app.scene3d.heightAt(walk.x, walk.z);
          const effectiveGroundY = clubhouseGroundY ?? terrainGroundY;
          const cameraY = app.scene3d.camera.position.y;
          const sample = {
            elapsedMs: now - startedAt,
            x: walk.x - origin.x,
            z: walk.z - origin.z,
            yaw: walk.yaw,
            clubhouseGroundY,
            terrainGroundY,
            effectiveGroundY,
            cameraY,
            cameraFootY: cameraY - walk.eye,
            cameraFootError: cameraY - walk.eye - effectiveGroundY,
            inside: clubhouse.isInside(walk.x, walk.z),
            free: walkApi.isFree(walk.x, walk.z, walk.radius),
          };
          samples.push(sample);
          return sample;
        };
        return new Promise((resolve) => {
          const tick = (now) => {
            const elapsed = now - startedAt;
            let sample = samples[samples.length - 1] || null;
            if (!sample || now - lastSampleAt >= 35 || elapsed >= sampleDurationMs) {
              sample = collect(now);
              lastSampleAt = now;
            }
            const reachedStop = elapsed >= 100 && (
              (Number.isFinite(stop?.localZLessThan) && sample.z < stop.localZLessThan)
              || (Number.isFinite(stop?.localZGreaterThan) && sample.z > stop.localZGreaterThan)
            );
            if (reachedStop || elapsed >= sampleDurationMs) {
              resolve({
                label: sampleLabel,
                input: `normal keyboard ${normalKey}`,
                requestedDurationMs: sampleDurationMs,
                stoppedByCondition: reachedStop,
                samples,
              });
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      }, {
        sampleDurationMs: durationMs,
        stop: until,
        sampleLabel: label,
        normalKey: key,
      });
    } finally {
      await page.keyboard.up(key).catch(() => {});
    }
  }

  const summarizeRoute = ({ label, fixture, before, after, sampleRun, target, site = null }) => {
    const dx = target.x - before.local.x;
    const dz = target.z - before.local.z;
    const length = Math.hypot(dx, dz) || 1;
    const dirX = dx / length;
    const dirZ = dz / length;
    const movedX = after.local.x - before.local.x;
    const movedZ = after.local.z - before.local.z;
    const samples = sampleRun?.samples || [];
    let pathDistance = 0;
    for (let index = 1; index < samples.length; index += 1) {
      pathDistance += Math.hypot(
        samples[index].x - samples[index - 1].x,
        samples[index].z - samples[index - 1].z,
      );
    }
    const finiteGround = samples.map((sample) => sample.effectiveGroundY).filter(Number.isFinite);
    const finiteClubhouseGround = samples.map((sample) => sample.clubhouseGroundY).filter(Number.isFinite);
    const footErrors = samples.map((sample) => Math.abs(sample.cameraFootError)).filter(Number.isFinite);
    const groundSequence = [
      before.effectiveGroundY,
      ...samples.map((sample) => sample.effectiveGroundY),
      after.effectiveGroundY,
    ];
    let maxEffectiveGroundStep = 0;
    for (let index = 1; index < groundSequence.length; index += 1) {
      if (!Number.isFinite(groundSequence[index - 1]) || !Number.isFinite(groundSequence[index])) continue;
      maxEffectiveGroundStep = Math.max(
        maxEffectiveGroundStep,
        Math.abs(groundSequence[index] - groundSequence[index - 1]),
      );
    }
    const lastElapsedMs = samples.at(-1)?.elapsedMs ?? 0;
    const finalWindowSamples = samples.filter((sample) => sample.elapsedMs >= lastElapsedMs - 240);
    const finalWindowX = finalWindowSamples.map((sample) => sample.x);
    const finalWindowZ = finalWindowSamples.map((sample) => sample.z);
    const finalWindowSpan = finalWindowSamples.length
      ? Math.hypot(
        Math.max(...finalWindowX) - Math.min(...finalWindowX),
        Math.max(...finalWindowZ) - Math.min(...finalWindowZ),
      )
      : null;
    const siteDistances = site
      ? samples.map((sample) => Math.hypot(sample.x - site.x, sample.z - site.z))
      : [];
    const siteProjections = site
      ? samples.map((sample) => (sample.x - site.x) * dirX + (sample.z - site.z) * dirZ)
      : [];
    return {
      label,
      control: sampleRun?.input || null,
      fixture,
      before,
      after,
      target,
      site,
      sampleCount: samples.length,
      requestedDurationMs: sampleRun?.requestedDurationMs ?? null,
      stoppedByCondition: sampleRun?.stoppedByCondition ?? false,
      netDistance: Math.hypot(movedX, movedZ),
      forwardProgress: movedX * dirX + movedZ * dirZ,
      lateralDrift: Math.abs(movedX * -dirZ + movedZ * dirX),
      pathDistance,
      effectiveGroundRange: finiteGround.length
        ? Math.max(...finiteGround) - Math.min(...finiteGround)
        : null,
      clubhouseGroundRange: finiteClubhouseGround.length
        ? Math.max(...finiteClubhouseGround) - Math.min(...finiteClubhouseGround)
        : null,
      maxEffectiveGroundStep,
      maxCameraFootError: footErrors.length ? Math.max(...footErrors) : null,
      finalWindowDurationMs: finalWindowSamples.length > 1
        ? finalWindowSamples.at(-1).elapsedMs - finalWindowSamples[0].elapsedMs
        : 0,
      finalWindowSpan,
      minimumDistanceToSite: siteDistances.length ? Math.min(...siteDistances) : null,
      minimumSiteProjection: siteProjections.length ? Math.min(...siteProjections) : null,
      maximumSiteProjection: siteProjections.length ? Math.max(...siteProjections) : null,
      allSamplesInside: samples.length > 0 && samples.every((sample) => sample.inside === true),
      allSamplesFree: samples.length > 0 && samples.every((sample) => sample.free === true),
      allSamplesFinite: samples.length > 0 && samples.every((sample) => (
        [sample.x, sample.z, sample.yaw, sample.effectiveGroundY,
          sample.cameraY, sample.cameraFootY, sample.cameraFootError].every(Number.isFinite)
      )),
      samples,
    };
  };

  async function runNormalRoute({ label, pose, target, durationMs, until = null, site = null }) {
    const fixture = await setPlayerFixture(pose, label);
    const before = await playerSnapshot(`${label}:before-W`);
    const sampleRun = await holdNormalKeyAndSample('w', { durationMs, until, label });
    await page.waitForTimeout(100);
    const after = await playerSnapshot(`${label}:after-W`);
    return summarizeRoute({ label, fixture, before, after, sampleRun, target, site });
  }

  async function applyArchitectureFixture({ floorRestored, closeDoor = false, allRestored = false }) {
    const result = await page.evaluate(async ({ desiredFloorRestored, forceClosedDoor, restoreEverything }) => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      if (!app?.state || !clubhouse) throw new Error('Architecture fixture requires the live clubhouse.');
      const restoration = await import('/src/sim/clubhouseRestoration.js');
      const production = typeof clubhouse.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse.sheet06Production;
      const beforeApplications = Number(production?.diagnostics?.().stateApplications) || 0;
      const mutations = [];
      if (restoreEverything) {
        for (const component of ['shell', 'porch', 'windows', 'panels', 'trim', 'ceiling', 'floor']) {
          const patch = component === 'panels'
            ? { restored: true, finish: 'medium-walnut' }
            : component === 'floor'
              ? { restored: desiredFloorRestored, finish: 'natural-oak' }
              : { restored: true };
          mutations.push(restoration.updateArchitectureComponent(app.state, component, patch));
        }
      } else {
        mutations.push(restoration.updateArchitectureComponent(app.state, 'floor', {
          restored: desiredFloorRestored,
          finish: 'natural-oak',
        }));
      }
      if (forceClosedDoor) mutations.push(restoration.setMainDoorState(app.state, 'closed'));
      if (mutations.some((mutation) => mutation?.ok !== true)) {
        throw new Error(`Architecture fixture mutation failed: ${JSON.stringify(mutations)}`);
      }
      clubhouse.rebuildReno();
      return { beforeApplications, mutations };
    }, {
      desiredFloorRestored: floorRestored,
      forceClosedDoor: closeDoor,
      restoreEverything: allRestored,
    });
    await page.waitForFunction((beforeApplications) => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      const production = typeof clubhouse?.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse?.sheet06Production;
      return Number(production?.diagnostics?.().stateApplications) > Number(beforeApplications);
    }, result.beforeApplications, { timeout: 30000 });
    await page.waitForTimeout(260);
    return { ...result, production: await productionDiagnostics() };
  }

  async function chooseDamageTracks() {
    return page.evaluate(async () => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      const walk = app?.scene3d?.walk;
      if (!clubhouse || !walk?.state) throw new Error('Damage-track selection requires walk mode.');
      const [{ createSheet06ProductionLayout }, { INTERIOR }] = await Promise.all([
        import('/src/render3d/assets51to100/sheet06ProductionRuntime.js'),
        import('/src/data/shopLayout.js'),
      ]);
      const layout = createSheet06ProductionLayout();
      const origin = clubhouse.interior.position;
      const directions = [
        [0, -1], [0, 1], [1, 0], [-1, 0],
        [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
        [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
      ];
      const offsets = [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6, 0.82, -0.82];
      const radius = walk.state.radius;
      return layout.damageSites.map((site) => {
        const rejected = [];
        for (let directionIndex = 0; directionIndex < directions.length; directionIndex += 1) {
          const [dx, dz] = directions[directionIndex];
          const px = -dz;
          const pz = dx;
          for (const offset of offsets) {
            const start = { x: site.x - dx * 0.82 + px * offset, z: site.z - dz * 0.82 + pz * offset };
            const end = { x: site.x + dx * 1.02 + px * offset, z: site.z + dz * 1.02 + pz * offset };
            const probes = [];
            let free = true;
            for (let index = 0; index <= 18; index += 1) {
              const t = index / 18;
              const localX = start.x + (end.x - start.x) * t;
              const localZ = start.z + (end.z - start.z) * t;
              const worldX = origin.x + localX;
              const worldZ = origin.z + localZ;
              const sampleFree = walk.isFree(worldX, worldZ, radius);
              // isInside's axial margin is an expansion, regardless of sign;
              // use the canonical interior bounds to guarantee radius clearance.
              const inside = Math.abs(localX) < INTERIOR.w / 2 - radius
                && Math.abs(localZ) < INTERIOR.d / 2 - radius;
              probes.push({ x: localX, z: localZ, free: sampleFree, inside });
              if (!sampleFree || !inside) free = false;
            }
            if (free) {
              return {
                id: site.id,
                site: { x: site.x, z: site.z },
                start,
                end,
                direction: { x: dx, z: dz },
                offset,
                yaw: Math.atan2(-dx, -dz),
                probes,
                selection: 'deterministic free-track fixture; movement acceptance still uses normal W',
              };
            }
            rejected.push({ directionIndex, offset });
          }
        }
        return {
          id: site.id,
          site: { x: site.x, z: site.z },
          trackUnavailable: true,
          rejectedCandidateCount: rejected.length,
        };
      });
    });
  }

  async function runFloorPass(mode, restored, tracks) {
    const stateFixture = await applyArchitectureFixture({ floorRestored: restored });
    const validTracks = tracks.filter((track) => !track.trackUnavailable);
    if (validTracks.length > 0) {
      const first = validTracks[0];
      await setPlayerFixture({
        x: first.start.x,
        z: first.start.z,
        tx: first.site.x,
        tz: first.site.z,
        pitch: -0.72,
      }, `${mode}:before-capture`);
      await capture(`${mode === 'restored' ? '06' : '08'}-${mode}-floor-before-five-routes.png`);
    }
    const routes = [];
    for (const track of tracks) {
      if (track.trackUnavailable) {
        routes.push({ id: track.id, site: track.site, trackUnavailable: true, track });
        continue;
      }
      const route = await runNormalRoute({
        label: `${mode}:${track.id}`,
        pose: {
          x: track.start.x,
          z: track.start.z,
          yaw: track.yaw,
          pitch: -0.54,
        },
        target: track.end,
        durationMs: 560,
        site: track.site,
      });
      routes.push({ id: track.id, track, route });
    }
    if (validTracks.length > 0) {
      await capture(`${mode === 'restored' ? '07' : '09'}-${mode}-floor-after-five-routes.png`);
    }
    return {
      mode,
      restored,
      stateFixture,
      damageVisible: stateFixture.production?.assembly?.floor?.damageVisible ?? null,
      damageSiteCount: stateFixture.production?.assembly?.floor?.damageInstanceCount ?? null,
      routes,
    };
  }

  await page.setViewportSize(viewport);
  phase = 'navigation';
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const continueButton = page.getByRole('button', { name: /^Continue\b/i });
  await page.getByRole('button', { name: /^(?:Continue|New game)\b/i })
    .first()
    .waitFor({ state: 'visible', timeout: 30000 });
  if (await continueButton.isVisible().catch(() => false)
      && await continueButton.isEnabled().catch(() => false)) {
    await continueButton.click();
  } else {
    await page.getByRole('button', { name: /New game/i }).click();
    await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
    const replaceAutosave = page.getByRole('button', { name: /^Start new game$/i });
    if (await replaceAutosave.isVisible().catch(() => false)) await replaceAutosave.click();
  }
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    if (!veil) return true;
    const style = getComputedStyle(veil);
    return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
  }, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    if (typeof clubhouse?.sheet06ProductionReady !== 'function') {
      throw new Error('clubhouse.sheet06ProductionReady() is unavailable.');
    }
    await clubhouse.sheet06ProductionReady();
  });

  phase = 'fixture';
  const fixture = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app?.scene3d?.clubhouse?.();
    if (!app?.state || !clubhouse) throw new Error('Collision QA fixture requires the active clubhouse.');
    app.speedIdx = 0;
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    app.scene3d.clearGolfers?.();
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.setTool?.(null);
    walk.setSpraying?.(false);
    walk.setSoaping?.(false);
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72,
      tempLoF: 54,
      rainIn: 0,
      humidity: 0.48,
      windMph: 5,
    };
    app.state.weather.locked = true;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    return {
      description: 'isolated bootstrap save; paused 2 PM clear weather; no customers/golfers; no held tool',
      saveAuthority: 'run-playwright --bootstrap ephemeral browser context',
      origin: {
        x: clubhouse.interior.position.x,
        y: clubhouse.interior.position.y,
        z: clubhouse.interior.position.z,
      },
    };
  });
  const initialArchitecture = await applyArchitectureFixture({
    floorRestored: true,
    closeDoor: true,
    allRestored: true,
  });
  const productionAtBoot = await productionDiagnostics();

  await page.locator('#game').click({
    position: { x: viewport.width / 2, y: viewport.height / 2 },
    force: true,
  });
  const pointerLockAcquired = await page.waitForFunction(() => (
    document.pointerLockElement === document.getElementById('game')
  ), null, { timeout: 1500 }).then(() => true).catch(() => false);
  if (!pointerLockAcquired) {
    await page.evaluate(() => {
      const hint = document.querySelector('.shop-lockhint');
      if (hint) hint.style.visibility = 'hidden';
    });
  }

  phase = 'ground-to-porch';
  const groundStartPose = { x: -0.8, z: 11.45, tx: -0.8, tz: 8.35, pitch: -0.08 };
  await setPlayerFixture(groundStartPose, 'ground-to-porch:start');
  await capture('01-exterior-ground-before-normal-walk.png');
  const groundToPorch = await runNormalRoute({
    label: 'ground-to-porch',
    pose: groundStartPose,
    target: { x: -0.8, z: 8.35 },
    durationMs: 2600,
    until: { localZLessThan: 8.55 },
  });
  await capture('02-porch-arrival-after-normal-walk.png');

  phase = 'barriers';
  const { authoredFrontZ, mainDoorX, railPlane, wallPlane } = await page.evaluate(async () => {
    const { METERS_TO_YARDS } = await import('/src/render3d/assets51to100/units.js');
    const { SHEET06_AUTHORED_FRONT_Z_YARDS } = await import(
      '/src/render3d/assets51to100/sheet06ClubhouseAdapter.js'
    );
    const { DOOR_MAIN, SHELL } = await import('/src/data/shopLayout.js');
    return {
      authoredFrontZ: SHEET06_AUTHORED_FRONT_Z_YARDS,
      mainDoorX: DOOR_MAIN.x,
      // Midpoint of Asset 54's authored west front rail after the one and only
      // meters-to-yards conversion and the canonical -1 yd porch placement.
      railPlane: {
        x: -1 + (-4.06 * METERS_TO_YARDS),
        z: SHEET06_AUTHORED_FRONT_Z_YARDS + (1.42 * METERS_TO_YARDS),
      },
      wallPlane: SHELL.d / 2 - SHELL.wallT / 2,
    };
  });
  const railBarrier = await runNormalRoute({
    label: 'authored-front-rail-barrier',
    pose: {
      x: railPlane.x,
      z: railPlane.z - 0.76,
      tx: railPlane.x,
      tz: railPlane.z + 1.2,
      pitch: -0.04,
    },
    target: { x: railPlane.x, z: railPlane.z + 1.2 },
    durationMs: 900,
  });
  await capture('03-authored-front-rail-after-block-attempt.png');
  const wallBarrier = await runNormalRoute({
    label: 'south-wall-barrier',
    // x=1.3 is solid facade, outside the main-door opening and inside the
    // central stair/railing gap, so this route isolates the analytic wall.
    pose: { x: 1.3, z: 8.2, tx: 1.3, tz: 5.8, pitch: -0.02 },
    target: { x: 1.3, z: 5.8 },
    durationMs: 900,
  });
  await capture('04-south-wall-after-block-attempt.png');

  phase = 'main-door';
  await applyArchitectureFixture({ floorRestored: true, closeDoor: true });
  // Approach perpendicular to the closed leaf plane through the canonical
  // double-door centre. A diagonal approach intentionally invokes the walk
  // controller's axis-separated obstacle sliding, so lateral motion would not
  // distinguish a solid leaf from a route-composition artefact.
  const doorPose = {
    x: mainDoorX,
    z: 8.35,
    tx: mainDoorX,
    tz: authoredFrontZ,
    pitch: 0.01,
  };
  const closedDoorBarrier = await runNormalRoute({
    label: 'closed-main-door-barrier',
    pose: doorPose,
    target: { x: mainDoorX, z: 5.6 },
    durationMs: 1000,
  });
  await capture('05-closed-double-door-after-block-attempt.png');
  // The perpendicular W attempt leaves the player stopped against the closed
  // leaves with the normal interaction prompt still live. Continue from that
  // exact arrested position: no pose/state write is permitted between the
  // closed-barrier assertion and the E-open/W-cross acceptance route.
  const doorInteractionFixture = closedDoorBarrier.fixture;
  await page.waitForFunction(() => /Shop door/i.test(
    window.__fw?.scene3d?.walk?.getFocusLabel?.() || '',
  ), null, { timeout: 5000 });
  const labelBeforeOpen = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const main = window.__fw?.state?.shop?.reno?.architecture?.doors?.main;
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    const door = production?.diagnostics?.().door;
    return main?.left === 'open' && main?.right === 'open'
      && Math.abs(Number(door?.leftAngle)) > 1.4
      && Math.abs(Number(door?.rightAngle)) > 1.4;
  }, null, { timeout: 7000 });
  const openedDoorDiagnostics = await productionDiagnostics();
  await capture('06-authored-double-door-open-normal-e.png');
  const openDoorStart = await playerSnapshot('open-door-crossing:before-W');
  const openDoorSamples = await holdNormalKeyAndSample('w', {
    durationMs: 3000,
    until: { localZLessThan: 5.2 },
    label: 'open-door-crossing',
  });
  await page.waitForTimeout(120);
  const openDoorEnd = await playerSnapshot('open-door-crossing:after-W');
  const openDoorCrossing = summarizeRoute({
    label: 'open-door-crossing',
    fixture: doorInteractionFixture,
    before: openDoorStart,
    after: openDoorEnd,
    sampleRun: openDoorSamples,
    target: { x: mainDoorX, z: 5.0 },
  });
  await capture('07-interior-after-open-door-normal-crossing.png');

  const yawBeforeTurn = openDoorEnd.yaw;
  await page.keyboard.down('ArrowLeft');
  try {
    await page.waitForFunction((startYaw) => {
      let delta = window.__fw.scene3d.walk.state.yaw - startYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      return Math.abs(delta) > 3.0;
    }, yawBeforeTurn, { timeout: 5000 });
  } finally {
    await page.keyboard.up('ArrowLeft').catch(() => {});
  }
  await page.waitForFunction(() => /Shop door/i.test(
    window.__fw?.scene3d?.walk?.getFocusLabel?.() || '',
  ), null, { timeout: 5000 });
  const labelBeforeClose = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
  const afterNormalTurn = await playerSnapshot('door-close:after-normal-ArrowLeft');
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const main = window.__fw?.state?.shop?.reno?.architecture?.doors?.main;
    return main?.left === 'closed' && main?.right === 'closed';
  }, null, { timeout: 5000 });
  await page.waitForTimeout(900);
  await capture('08-interior-after-normal-e-close.png');
  const closedDoorDiagnostics = await productionDiagnostics();
  const doorPersistence = await page.evaluate(async () => {
    const app = window.__fw;
    await app.autosave();
    const raw = localStorage.getItem('golfempire:autosave');
    const snapshot = raw ? JSON.parse(raw) : null;
    const holding = snapshot?.holdings?.find((entry) => entry?.property?.id === snapshot.activeId)
      || snapshot?.holdings?.[0];
    return {
      state: { ...app.state.shop.reno.architecture.doors.main },
      autosave: holding?.state?.shop?.reno?.architecture?.doors?.main || null,
      autosaveBytes: raw?.length || 0,
    };
  });

  phase = 'floor-routes';
  const damageTracks = await chooseDamageTracks();
  const restoredFloorPass = await runFloorPass('restored', true, damageTracks);
  const damagedFloorPass = await runFloorPass('damaged', false, damageTracks);

  phase = 'cleanup';
  const finalArchitecture = await applyArchitectureFixture({
    floorRestored: true,
    closeDoor: true,
    allRestored: true,
  });
  const finalSave = await page.evaluate(async () => {
    const app = window.__fw;
    await app.autosave();
    const raw = localStorage.getItem('golfempire:autosave');
    const snapshot = raw ? JSON.parse(raw) : null;
    const holding = snapshot?.holdings?.find((entry) => entry?.property?.id === snapshot.activeId)
      || snapshot?.holdings?.[0];
    return {
      autosaveBytes: raw?.length || 0,
      architecture: holding?.state?.shop?.reno?.architecture || null,
    };
  });
  const productionAtEnd = await productionDiagnostics();

  const floorRouteAccepted = (entry) => {
    const route = entry?.route;
    return entry?.trackUnavailable !== true
      && route?.fixture?.established?.initiallyFree === true
      && route?.allSamplesFinite === true
      && route?.allSamplesInside === true
      && route?.allSamplesFree === true
      && route?.forwardProgress > 1.65
      && route?.netDistance > 1.65
      && route?.lateralDrift < 0.1
      && route?.minimumDistanceToSite <= Math.abs(entry.track.offset) + 0.16
      && route?.minimumSiteProjection <= -0.58
      && route?.maximumSiteProjection >= 0.58
      && route?.clubhouseGroundRange <= 0.00001
      && route?.maxEffectiveGroundStep <= 0.00001
      && route?.maxCameraFootError <= 0.035;
  };
  const floorEntryAccepted = (entry) => entry?.trackUnavailable === true
    ? entry?.track?.rejectedCandidateCount === 72
    : floorRouteAccepted(entry);
  const restoredRoutes = new Map(restoredFloorPass.routes.map((entry) => [entry.id, entry]));
  const damagedRoutes = new Map(damagedFloorPass.routes.map((entry) => [entry.id, entry]));
  const floorComparisons = damageTracks.map((track) => {
    const restored = restoredRoutes.get(track.id)?.route;
    const damaged = damagedRoutes.get(track.id)?.route;
    if (track.trackUnavailable) {
      return {
        id: track.id,
        endpointDelta: null,
        distanceDelta: null,
        stablePhysicalObstruction: track.rejectedCandidateCount === 72,
        ok: track.rejectedCandidateCount === 72,
      };
    }
    const endpointDelta = restored && damaged
      ? Math.hypot(
        restored.after.local.x - damaged.after.local.x,
        restored.after.local.z - damaged.after.local.z,
      )
      : null;
    const distanceDelta = restored && damaged
      ? Math.abs(restored.netDistance - damaged.netDistance)
      : null;
    return {
      id: track.id,
      endpointDelta,
      distanceDelta,
      ok: Number.isFinite(endpointDelta) && endpointDelta <= 0.22
        && Number.isFinite(distanceDelta) && distanceDelta <= 0.22,
    };
  });
  const yawDelta = (() => {
    let delta = afterNormalTurn.yaw - yawBeforeTurn;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  })();
  const blockingDiagnostics = diagnostics.filter((entry) => ![
    'console:warning',
    'requestaborted',
  ].includes(entry.kind));
  const checks = [
    {
      id: 'sheet06-production-collision-authority',
      ok: productionAtBoot?.activationStatus === 'active'
        && productionAtBoot?.actualSharedGameIntegrated === true
        && productionAtBoot?.loadedAssetCount === 10
        && productionAtBoot?.assembledKitCount === 6
        && productionAtBoot?.glbCollisionObjectsActivated === 0
        && productionAtBoot?.door?.authoredBound === true
        && productionAtBoot?.door?.authoredPivotCount === 2
        && productionAtBoot?.door?.leafCount === 2
        && productionAtBoot?.door?.colliderCount === 2,
      actual: productionAtBoot,
    },
    {
      id: 'normal-ground-to-porch-no-snag-or-fall',
      ok: groundToPorch.fixture?.established?.initiallyFree === true
        && Number.isFinite(groundToPorch.before.clubhouseGroundY)
        && Math.abs(groundToPorch.before.clubhouseGroundY - groundToPorch.before.terrainGroundY) <= 0.00001
        && groundToPorch.before.inside === false
        && Number.isFinite(groundToPorch.after.clubhouseGroundY)
        && groundToPorch.forwardProgress > 2.35
        && groundToPorch.netDistance > 2.35
        && groundToPorch.after.local.z < 8.7
        && groundToPorch.allSamplesFinite === true
        && groundToPorch.lateralDrift < 0.1
        && groundToPorch.maxEffectiveGroundStep <= 0.18
        && groundToPorch.maxCameraFootError <= 0.035,
      actual: groundToPorch,
    },
    {
      id: 'authored-front-rail-blocks-normal-walk',
      ok: railBarrier.fixture?.established?.initiallyFree === true
        && railBarrier.after.local.z <= railPlane.z - 0.25
        && railBarrier.forwardProgress < 0.78
        && railBarrier.lateralDrift < 0.08
        && railBarrier.finalWindowDurationMs >= 180
        && railBarrier.finalWindowSpan < 0.06,
      actual: { railPlane, route: railBarrier },
    },
    {
      id: 'analytic-south-wall-blocks-normal-walk',
      ok: wallBarrier.fixture?.established?.initiallyFree === true
        && wallBarrier.after.local.z >= wallPlane + 0.25
        && wallBarrier.after.inside === false
        && wallBarrier.forwardProgress < 1.4
        && wallBarrier.lateralDrift < 0.08
        && wallBarrier.finalWindowDurationMs >= 180
        && wallBarrier.finalWindowSpan < 0.06,
      actual: { wallPlane, route: wallBarrier },
    },
    {
      id: 'closed-double-door-blocks-normal-walk',
      ok: closedDoorBarrier.before.doorState.left === 'closed'
        && closedDoorBarrier.before.doorState.right === 'closed'
        && closedDoorBarrier.after.inside === false
        && closedDoorBarrier.after.local.z > 6.5
        && closedDoorBarrier.forwardProgress < 1.75
        && closedDoorBarrier.lateralDrift < 0.1
        && closedDoorBarrier.finalWindowDurationMs >= 180
        && closedDoorBarrier.finalWindowSpan < 0.06,
      actual: closedDoorBarrier,
    },
    {
      id: 'normal-e-opens-authored-leaves-and-w-crosses',
      ok: /Shop door/i.test(labelBeforeOpen || '')
        && openedDoorDiagnostics?.door?.authoredBound === true
        && openedDoorDiagnostics?.door?.authoredPivotCount === 2
        && openedDoorDiagnostics?.door?.colliderCount === 2
        && Math.abs(openedDoorDiagnostics?.door?.leftAngle || 0) > 1.4
        && Math.abs(openedDoorDiagnostics?.door?.rightAngle || 0) > 1.4
        && openDoorCrossing.forwardProgress > 1.5
        && openDoorCrossing.allSamplesFinite === true
        && openDoorCrossing.lateralDrift < 0.15
        && openDoorCrossing.after.inside === true
        && openDoorCrossing.after.local.z < 5.35,
      actual: { labelBeforeOpen, openedDoorDiagnostics, route: openDoorCrossing },
    },
    {
      id: 'normal-turn-e-close-persists-both-leaves',
      ok: Math.abs(yawDelta) > 3.0
        && /Shop door/i.test(labelBeforeClose || '')
        && doorPersistence.state?.left === 'closed'
        && doorPersistence.state?.right === 'closed'
        && doorPersistence.autosave?.left === 'closed'
        && doorPersistence.autosave?.right === 'closed'
        && doorPersistence.autosaveBytes > 0
        && closedDoorDiagnostics?.door?.colliderCount === 2
        && Math.abs(closedDoorDiagnostics?.door?.leftAngle || 0) < 0.03
        && Math.abs(closedDoorDiagnostics?.door?.rightAngle || 0) < 0.03,
      actual: { yawDelta, labelBeforeClose, closedDoorDiagnostics, doorPersistence },
    },
    {
      id: 'five-restored-floor-routes-use-normal-w-with-stable-y',
      ok: restoredFloorPass.damageVisible === false
        && restoredFloorPass.routes.length === 5
        && restoredFloorPass.routes.every(floorEntryAccepted),
      actual: restoredFloorPass,
    },
    {
      id: 'five-damaged-floor-routes-use-normal-w-with-stable-y',
      ok: damagedFloorPass.damageVisible === true
        && damagedFloorPass.damageSiteCount === 5
        && damagedFloorPass.routes.length === 5
        && damagedFloorPass.routes.every(floorEntryAccepted),
      actual: damagedFloorPass,
    },
    {
      id: 'damage-overlays-do-not-change-navigation-endpoints',
      ok: floorComparisons.length === 5 && floorComparisons.every((comparison) => comparison.ok),
      actual: floorComparisons,
    },
    {
      id: 'isolated-save-restored-after-qa',
      ok: finalSave.autosaveBytes > 0
        && finalSave.architecture?.components?.floor?.restored === true
        && finalSave.architecture?.doors?.main?.left === 'closed'
        && finalSave.architecture?.doors?.main?.right === 'closed'
        && finalArchitecture.production?.assembly?.floor?.damageVisible === false,
      actual: { finalSave, finalArchitecture },
    },
    {
      id: 'production-contract-stable-at-end',
      ok: productionAtEnd?.activationStatus === 'active'
        && productionAtEnd?.loadedAssetCount === 10
        && productionAtEnd?.assembledKitCount === 6
        && productionAtEnd?.glbCollisionObjectsActivated === 0
        && productionAtEnd?.door?.authoredBound === true
        && productionAtEnd?.door?.authoredPivotCount === 2
        && productionAtEnd?.door?.leafCount === 2
        && productionAtEnd?.door?.colliderCount === 2,
      actual: productionAtEnd,
    },
    {
      id: 'before-after-screenshot-evidence-retained',
      ok: captures.length >= 12 && captures.every((file) => fs.existsSync(file)),
      actual: captures,
    },
    {
      id: 'blocking-browser-diagnostics',
      ok: blockingDiagnostics.length === 0,
      actual: blockingDiagnostics,
    },
  ];

  const report = {
    schemaVersion: 1,
    ok: checks.every((check) => check.ok),
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/sheet06-collision-navigation-qa.js --bootstrap',
    outputEnvironment: {
      directory: 'SHEET06_COLLISION_QA_OUT',
      runnerResult: 'QA_RESULT_PATH',
    },
    methodology: {
      viewport,
      deviceScaleFactor: 1,
      fixture,
      fixtureBoundary: 'direct pose and public restoration writes establish deterministic state only; every accepted traverse/barrier/door result uses normal keyboard events',
      normalControls: 'W ground-to-porch; W into authored rail, analytic wall, and closed leaves; E open; W cross; ArrowLeft turn; E close; W across each of five floor sites in restored and damaged states',
      floorComparison: 'identical deterministic free track, yaw, W duration, and stable analytic floor Y before/after enabling only Asset 60 visual damage',
      collisionAuthority: 'GLB collision nodes remain metadata/hidden; established analytic layout and two live double-leaf colliders remain authoritative',
      saveIsolation: 'ephemeral --bootstrap autosave; final cleanup restores all Sheet-6 components and both leaves before autosave',
    },
    pointerLockAcquired,
    captures,
    productionAtBoot,
    initialArchitecture,
    barriers: { railPlane, wallPlane, railBarrier, wallBarrier },
    entrance: {
      authoredFrontZ,
      mainDoorX,
      groundToPorch,
      closedDoorBarrier,
      doorInteractionFixture,
      labelBeforeOpen,
      openedDoorDiagnostics,
      openDoorCrossing,
      yawDelta,
      labelBeforeClose,
      closedDoorDiagnostics,
      doorPersistence,
    },
    floor: {
      tracks: damageTracks,
      restored: restoredFloorPass,
      damaged: damagedFloorPass,
      comparisons: floorComparisons,
    },
    finalSave,
    productionAtEnd,
    checks,
    diagnostics,
    blockingDiagnostics,
  };
  fs.writeFileSync(
    path.join(out, 'collision-navigation-result.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

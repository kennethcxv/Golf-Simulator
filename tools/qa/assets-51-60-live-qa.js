async (page) => {
  // SHEET 6 LIVE GAME QA
  //
  // The fixed camera placements below are deterministic visual fixtures. The
  // entrance itself is exercised only through the same E/W/ArrowLeft controls
  // used by a player. This route deliberately requires the public production
  // diagnostic hook so a screenshot can never race the asynchronous GLB load.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const out = process.env.SHEET06_QA_OUT
    ? path.resolve(repo, process.env.SHEET06_QA_OUT)
    : path.join(repo, 'qa', 'assets_51_100_master', 'sheet_06', 'live', 'current');
  const videoOut = process.env.SHEET06_VIDEO_OUT
    ? path.resolve(repo, process.env.SHEET06_VIDEO_OUT)
    : path.join(out, 'sheet06-normal-controls.webm');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.dirname(videoOut), { recursive: true });

  const viewport = { width: 1600, height: 900 };
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    diagnostics.push({
      kind: /ERR_ABORTED/i.test(failure) ? 'requestaborted' : 'requestfailed',
      message: `${request.url()} (${failure})`,
    });
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    diagnostics.push({
      kind: 'http-response',
      message: `${response.status()} ${response.request().method()} ${response.url()}`,
      resourceType: response.request().resourceType(),
    });
  });

  const productionDiagnostics = () => page.evaluate(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    if (!clubhouse) return null;
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    if (production && typeof production.diagnostics === 'function') {
      return production.diagnostics();
    }
    if (typeof clubhouse.sheet06ProductionDiagnostics === 'function') {
      return clubhouse.sheet06ProductionDiagnostics();
    }
    return null;
  });

  const collectArchitectureEvidence = (label) => page.evaluate((evidenceLabel) => {
    const app = window.__fw;
    const clubhouse = app?.scene3d?.clubhouse?.();
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    if (!app?.state || !production?.diagnostics || !production?.getRoot
      || !production?.getAssemblyRoot) {
      throw new Error(`Sheet 6 architecture evidence '${evidenceLabel}' requires the live production facade.`);
    }
    const architecture = app.state.shop?.reno?.architecture;
    const components = Object.fromEntries(Object.entries(architecture?.components || {}).map(
      ([component, value]) => [component, {
        restored: value?.restored === true,
        finish: value?.finish ?? null,
      }],
    ));
    const descendants = (root) => {
      const values = [];
      root?.traverse?.((node) => values.push(node));
      return values;
    };
    const effectivelyVisible = (node) => {
      for (let cursor = node; cursor; cursor = cursor.parent) {
        if (cursor.visible === false) return false;
      }
      return true;
    };
    const logicalName = (node) => String(node?.name || '').replace(/^(?:MESH_|EMPTY_)/, '');
    const root52 = production.getRoot(52);
    const root56 = production.getAssemblyRoot(56);
    const root60 = production.getAssemblyRoot(60);
    const asset52DamageNames = new Set([
      'LOD0_WallDamage',
      'LOD0_RoofDamage',
      'LOD0_TrimDamage',
      'LOD0_DamageRaycast',
    ]);
    const asset52VisualDamageNames = new Set([
      'LOD0_WallDamage',
      'LOD0_RoofDamage',
      'LOD0_TrimDamage',
    ]);
    const asset52DamageNodes = descendants(root52).filter(
      (node) => asset52DamageNames.has(logicalName(node)),
    );
    const asset52VisualDamageMeshes = descendants(root52).filter((node) => {
      if (node?.isMesh !== true) return false;
      for (let cursor = node; cursor && cursor !== root52; cursor = cursor.parent) {
        if (asset52VisualDamageNames.has(logicalName(cursor))) return true;
      }
      return false;
    });
    const asset56DamageMeshes = descendants(root56).filter((node) => (
      node?.isMesh === true
      && (node?.userData?.damage_overlay === true || node?.userData?.damageOverlay === true)
    ));
    const asset60Meshes = descendants(root60).filter((node) => node?.isMesh === true);
    const productionSnapshot = production.diagnostics();
    return {
      label: evidenceLabel,
      capturedAt: new Date().toISOString(),
      stateApplications: productionSnapshot.stateApplications,
      architecture: {
        components,
        allComponentsRestored: Object.keys(components).length === 7
          && Object.values(components).every((value) => value.restored === true),
        doors: {
          left: architecture?.doors?.main?.left ?? null,
          right: architecture?.doors?.main?.right ?? null,
        },
      },
      asset52: {
        rootPresent: !!root52,
        reportedDamageVisible: root52?.userData?.sheet06DamageVisible ?? null,
        namedDamageNodeCount: asset52DamageNodes.length,
        locallyVisibleNamedDamageNodeCount: asset52DamageNodes.filter(
          (node) => node.visible !== false,
        ).length,
        effectivelyVisibleNamedDamageNodeCount: asset52DamageNodes.filter(
          effectivelyVisible,
        ).length,
        visualDamageMeshCount: asset52VisualDamageMeshes.length,
        effectivelyVisibleVisualDamageMeshCount: asset52VisualDamageMeshes.filter(
          effectivelyVisible,
        ).length,
        namedDamageNodes: asset52DamageNodes.map((node) => ({
          name: node.name,
          visible: node.visible !== false,
          effectivelyVisible: effectivelyVisible(node),
        })),
      },
      asset56: {
        rootPresent: !!root56,
        reportedRestored: root56?.userData?.sheet06Restored ?? null,
        damageMeshCount: asset56DamageMeshes.length,
        damageInstanceCount: asset56DamageMeshes.reduce(
          (sum, node) => sum + (Number.isInteger(node.count) ? node.count : 1),
          0,
        ),
        effectivelyVisibleDamageMeshCount: asset56DamageMeshes.filter(effectivelyVisible).length,
        placementIds: asset56DamageMeshes.flatMap(
          (node) => node.userData?.sheet06PlacementIds || [],
        ),
      },
      asset60: {
        rootPresent: !!root60,
        rootVisible: root60?.visible ?? null,
        reportedDamageVisible: root60?.userData?.sheet06DamageVisible ?? null,
        meshCount: asset60Meshes.length,
        effectivelyVisibleMeshCount: asset60Meshes.filter(effectivelyVisible).length,
        selectedVariant: productionSnapshot.assembly?.floor?.damageVariant ?? null,
        diagnosticsDamageVisible: productionSnapshot.assembly?.floor?.damageVisible ?? null,
      },
    };
  }, label);

  async function applyArchitecturePresentationState(mode) {
    if (mode !== 'clean' && mode !== 'damaged-trio') {
      throw new Error(`Unsupported Sheet 6 presentation state '${mode}'.`);
    }
    const mutation = await page.evaluate(async (targetMode) => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      if (!app?.state || !clubhouse) throw new Error('Sheet 6 presentation fixture requires the live clubhouse.');
      const restoration = await import('/src/sim/clubhouseRestoration.js');
      const production = typeof clubhouse.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse.sheet06Production;
      if (!production?.diagnostics) throw new Error('Sheet 6 production diagnostics are unavailable.');

      const desired = {
        shell: targetMode === 'clean',
        porch: true,
        windows: true,
        panels: targetMode === 'clean',
        trim: targetMode === 'clean',
        ceiling: true,
        floor: targetMode === 'clean',
      };
      const beforeApplications = Number(production.diagnostics().stateApplications) || 0;
      const mutations = [restoration.setMainDoorState(app.state, 'closed')];
      // Apply the canonical public state before rebuildReno(), then let the
      // production state-application gate prove the renderer observed it.
      const ordered = Object.entries(desired).sort((left, right) => (
        Number(right[1]) - Number(left[1])
      ));
      for (const [component, restored] of ordered) {
        const update = component === 'panels'
          ? { restored, finish: 'medium-walnut' }
          : { restored };
        mutations.push(restoration.updateArchitectureComponent(app.state, component, update));
      }
      if (mutations.some((result) => result?.ok !== true)) {
        throw new Error(`Sheet 6 presentation mutation failed: ${JSON.stringify(mutations)}`);
      }
      clubhouse.rebuildReno();
      return {
        mode: targetMode,
        desired,
        finishFixture: { panels: 'medium-walnut' },
        mutations,
        beforeApplications,
      };
    }, mode);
    await page.waitForFunction((priorApplications) => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      const production = typeof clubhouse?.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse?.sheet06Production;
      return Number(production?.diagnostics?.().stateApplications) > Number(priorApplications);
    }, mutation.beforeApplications, { timeout: 30000 });
    await page.waitForTimeout(300);
    return {
      mutation,
      evidence: await collectArchitectureEvidence(`${mode}:after-production-apply`),
    };
  }

  function cleanArchitectureOk(evidence) {
    return evidence?.architecture?.allComponentsRestored === true
      && evidence?.architecture?.components?.panels?.finish === 'medium-walnut'
      && evidence?.architecture?.doors?.left === 'closed'
      && evidence?.architecture?.doors?.right === 'closed'
      && evidence?.asset52?.reportedDamageVisible === false
      && evidence?.asset52?.namedDamageNodeCount > 0
      && evidence?.asset52?.effectivelyVisibleNamedDamageNodeCount === 0
      && evidence?.asset52?.visualDamageMeshCount > 0
      && evidence?.asset52?.effectivelyVisibleVisualDamageMeshCount === 0
      && evidence?.asset56?.rootPresent === true
      && evidence?.asset56?.reportedRestored === true
      && evidence?.asset56?.damageMeshCount > 0
      && evidence?.asset56?.damageInstanceCount > 0
      && evidence?.asset56?.effectivelyVisibleDamageMeshCount === 0
      && evidence?.asset60?.rootPresent === true
      && evidence?.asset60?.rootVisible === false
      && evidence?.asset60?.reportedDamageVisible === false
      && evidence?.asset60?.diagnosticsDamageVisible === false
      && evidence?.asset60?.effectivelyVisibleMeshCount === 0;
  }

  function damagedTrioOk(evidence) {
    return evidence?.architecture?.components?.shell?.restored === false
      && evidence?.architecture?.components?.floor?.restored === false
      && evidence?.architecture?.components?.porch?.restored === true
      && evidence?.architecture?.components?.windows?.restored === true
      && evidence?.architecture?.components?.panels?.restored === false
      && evidence?.architecture?.components?.panels?.finish === 'medium-walnut'
      && evidence?.architecture?.components?.trim?.restored === false
      && evidence?.architecture?.components?.ceiling?.restored === true
      && evidence?.asset52?.reportedDamageVisible === true
      && evidence?.asset52?.effectivelyVisibleNamedDamageNodeCount > 0
      && evidence?.asset52?.effectivelyVisibleVisualDamageMeshCount > 0
      && evidence?.asset56?.reportedRestored === false
      && evidence?.asset56?.damageMeshCount > 0
      && evidence?.asset56?.damageInstanceCount > 0
      && evidence?.asset56?.effectivelyVisibleDamageMeshCount > 0
      && evidence?.asset60?.rootVisible === true
      && evidence?.asset60?.reportedDamageVisible === true
      && evidence?.asset60?.diagnosticsDamageVisible === true
      && evidence?.asset60?.effectivelyVisibleMeshCount > 0;
  }

  await page.setViewportSize(viewport);
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  // This is deterministic presentation setup, not interaction evidence. Clear
  // legacy exterior chores in the bootstrap save before the clubhouse is
  // constructed; those interactive meshes snapshot their initial visibility
  // during buildExterior() and are intentionally independent of architecture.
  const preConstructionExteriorFixture = await page.evaluate(async () => {
    const key = 'golfempire:autosave';
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Sheet 6 exterior fixture requires the bootstrap autosave.');
    const snapshot = JSON.parse(raw);
    const holding = snapshot.holdings?.find(
      (entry) => entry?.property?.id === snapshot.activeId,
    ) || snapshot.holdings?.[0];
    const { ensureShopReno } = await import('/src/sim/shop.js');
    ensureShopReno(holding?.state);
    const exterior = holding?.state?.shop?.reno?.exterior;
    if (!exterior || !Array.isArray(exterior.weeds)) {
      throw new Error('Sheet 6 exterior fixture could not locate legacy restoration state.');
    }
    exterior.weeds.fill(0);
    exterior.gutter = 0;
    exterior.cobwebs = 0;
    exterior.light = 0;
    localStorage.setItem(key, JSON.stringify(snapshot));
    return {
      authority: 'bootstrap autosave before clubhouse construction',
      purpose: 'presentation setup only; not counted as player interaction evidence',
      exterior: JSON.parse(JSON.stringify(exterior)),
    };
  });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    if (!clubhouse) return false;
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    return !!production || typeof clubhouse.sheet06ProductionDiagnostics === 'function';
  }, null, { timeout: 90000 });
  const readySnapshot = await page.evaluate(async () => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    if (typeof clubhouse?.sheet06ProductionReady !== 'function') {
      throw new Error('clubhouse.sheet06ProductionReady() is not exposed.');
    }
    return clubhouse.sheet06ProductionReady();
  });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    const snapshot = production?.diagnostics?.()
      || clubhouse?.sheet06ProductionDiagnostics?.()
      || null;
    return snapshot?.activationStatus === 'active'
      || snapshot?.activationStatus === 'fallback'
      || snapshot?.activationStatus === 'disposed';
  }, null, { timeout: 90000 });

  const productionAtBoot = await productionDiagnostics();
  if (readySnapshot?.activationStatus !== 'active'
    || readySnapshot?.actualSharedGameIntegrated !== true
    || productionAtBoot?.activationStatus !== 'active'
    || productionAtBoot?.actualSharedGameIntegrated !== true) {
    throw new Error(`Sheet 6 did not activate in the live game: ${JSON.stringify({ readySnapshot, productionAtBoot })}`);
  }

  const fixture = await page.evaluate((preConstruction) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    app.speedIdx = 0;
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.setTool?.(null);
    walk.setSpraying?.(false);
    walk.setSoaping?.(false);
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
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
    if (app.state.shop.reno) {
      app.state.shop.reno.grime.fill(0);
      for (const clutter of app.state.shop.reno.clutter || []) clutter.cleared = true;
      const exterior = app.state.shop.reno.exterior;
      if (!exterior || !Array.isArray(exterior.weeds)) {
        throw new Error('Sheet 6 runtime exterior fixture state is unavailable.');
      }
      // Reassert the pre-construction setup before rebuildReno(). This is a
      // fixed visual fixture, not one of the retained normal-control actions.
      exterior.weeds.fill(0);
      exterior.gutter = 0;
      exterior.cobwebs = 0;
      exterior.light = 0;
    }
    const parked = new Set(['rug1', 'plant1', 'poster1', 'board1', 'light1', 'lounge1', 'vac1']);
    for (const [id, entry] of Object.entries(app.state.shop.inventory || {})) {
      if (!entry || typeof entry !== 'object') continue;
      if (parked.has(id)) {
        entry.shelf = 0;
        entry.back = 0;
      } else {
        entry.shelf = Math.max(12, Number(entry.shelf) || 0);
        entry.back = Math.max(6, Number(entry.back) || 0);
      }
    }
    clubhouse.rebuildStock?.();
    clubhouse.rebuildReno?.();
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    return {
      description: 'Willow Creek bootstrap, paused at 2 PM, fixed clear weather, stocked retail, no walk-ins, clutter, or legacy exterior chores',
      interiorOffset: clubhouse.interior.position.toArray(),
      legacyExteriorPresentationSetup: {
        classification: 'deterministic setup only; excluded from normal-control evidence',
        preConstruction,
        runtimeBeforeRebuild: JSON.parse(JSON.stringify(app.state.shop.reno.exterior)),
      },
    };
  }, preConstructionExteriorFixture);
  const legacyExteriorFixtureOk = (() => {
    const exterior = fixture?.legacyExteriorPresentationSetup?.runtimeBeforeRebuild;
    return Array.isArray(exterior?.weeds)
      && exterior.weeds.length > 0
      && exterior.weeds.every((value) => value === 0 || value === false)
      && (exterior.gutter === 0 || exterior.gutter === false)
      && (exterior.cobwebs === 0 || exterior.cobwebs === false)
      && (exterior.light === 0 || exterior.light === false);
  })();
  if (!legacyExteriorFixtureOk) {
    throw new Error(`Sheet 6 legacy exterior fixture was not clean before rebuild: ${JSON.stringify(fixture)}`);
  }
  await page.waitForFunction((priorApplications) => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    const snapshot = production?.diagnostics?.()
      || clubhouse?.sheet06ProductionDiagnostics?.()
      || null;
    return snapshot?.activationStatus === 'active'
      && snapshot?.actualSharedGameIntegrated === true
      && Number(snapshot?.stateApplications) > Number(priorApplications || 0);
  }, productionAtBoot.stateApplications, { timeout: 30000 });
  await page.waitForTimeout(1200);

  // Use the normal canvas click so retained evidence does not include the
  // automation-only "Click to play" veil.
  await page.locator('#game').click({
    position: { x: viewport.width / 2, y: viewport.height / 2 },
    force: true,
  });
  const pointerLockAcquired = await page.waitForFunction(() => (
    document.pointerLockElement === document.getElementById('game')
  ), null, { timeout: 1500 }).then(() => true).catch(() => false);
  if (!pointerLockAcquired) {
    // Chrome automation can reject Pointer Lock even after the normal canvas
    // click. Record that limitation, but remove only its automation reminder
    // from retained art-review media; keyboard controls remain the real path.
    await page.evaluate(() => {
      const hint = document.querySelector('.shop-lockhint');
      if (hint) hint.style.visibility = 'hidden';
    });
  }
  await page.waitForTimeout(180);

  const fixedCameras = [
    {
      id: 's6-01-exterior-front',
      purpose: 'fully restored Asset 51/53/54 facade with Asset 52 damage explicitly hidden',
      x: -6.8, z: 17.2, tx: -0.8, tz: 5.3, pitch: 0.04,
    },
    {
      id: 's6-02-entry-closed',
      purpose: 'unobstructed Asset 53 double leaves, casing, and porch datum',
      // Approach from the latch-side aisle. The dead porch-light prop sits to
      // the east and otherwise competes for E at a mathematically near-tied
      // straight-on position; this remains a natural, unobstructed player path.
      x: -1.5, z: 8.35, tx: -0.8, tz: 6.625, pitch: 0.01,
    },
    {
      id: 's6-03-south-windows',
      purpose: 'paired close Asset 55 middle-window casing/glazing and Asset 52 boarded-aperture evidence',
      x: -4.48, z: 8.95, tx: -4.48, tz: 6.16, pitch: 0.025,
    },
    {
      id: 's6-04-interior-panel-trim-ceiling',
      purpose: 'Assets 56/57/58 repeated wall, trim, connectors, panels, and beams',
      x: -1.0, z: 4.8, tx: -7.6, tz: -1.8, pitch: 0.17,
    },
    {
      id: 's6-05-floor-and-damage',
      purpose: 'fully restored Asset 59 floor field with Asset 60 damage explicitly hidden',
      x: -0.35, z: 2.4, tx: -0.35, tz: -2.45, pitch: -0.55,
    },
  ];
  const asset60DamageCamera = {
    id: 's6-d2-asset60-damage-close',
    purpose: 'close Asset 60 damage variant over the unchanged Asset 59 walkable floor',
    x: -4.15, z: 4.05, tx: -4.15, tz: 2.05, pitch: -0.68,
  };

  async function setFixedCamera(camera) {
    await page.evaluate((shot) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const walk = app.scene3d.walk;
      const origin = clubhouse.interior.position;
      walk.clearKeys?.();
      walk.state.x = origin.x + shot.x;
      walk.state.z = origin.z + shot.z;
      const dx = shot.tx - shot.x;
      const dz = shot.tz - shot.z;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = shot.pitch;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    }, camera);
    await page.waitForTimeout(650);
  }

  async function resolvePanelDamageCamera() {
    return page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      const production = typeof clubhouse?.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse?.sheet06Production;
      const root = production?.getAssemblyRoot?.(56);
      const interior = clubhouse?.interior;
      if (!root || !interior) throw new Error('Asset 56 damage camera requires the live assembly root.');
      app.scene3d.scene.updateMatrixWorld(true);
      const candidates = [];
      root.traverse((node) => {
        if (!node?.isInstancedMesh
          || (node.userData?.damage_overlay !== true && node.userData?.damageOverlay !== true)) return;
        const placementIds = node.userData?.sheet06PlacementIds || [];
        for (let index = 0; index < node.count; index += 1) {
          const instance = node.matrix.clone();
          node.getMatrixAt(index, instance);
          const world = node.matrixWorld.clone().multiply(instance);
          const targetWorld = node.position.clone().setFromMatrixPosition(world);
          const inwardWorld = node.position.clone().set(0, 0, 1).transformDirection(world);
          inwardWorld.y = 0;
          inwardWorld.normalize();
          // The north/east retail walls carry solid-backed merchandise
          // fixtures and the west run is crossed by club shafts. Prefer the
          // short south-wall bay beside the entrance, where the low repair
          // layer remains readable from a plausible standing player view.
          const cameraWorld = targetWorld.clone().addScaledVector(inwardWorld, 1.15);
          const targetLocal = interior.worldToLocal(targetWorld.clone());
          const cameraLocal = interior.worldToLocal(cameraWorld.clone());
          const placementId = placementIds[index] || `asset56-damage-${index}`;
          const linePriority = /panel-south-2-/u.test(placementId) ? 0
            : /panel-south-3-/u.test(placementId) ? 1
              : /panel-west-/u.test(placementId) ? 2
                : /panel-north-/u.test(placementId) ? 3
                  : /panel-east-/u.test(placementId) ? 4
                    : 5;
          candidates.push({
            placementId,
            linePriority,
            x: cameraLocal.x,
            z: cameraLocal.z,
            tx: targetLocal.x,
            tz: targetLocal.z,
            pitch: -0.92,
            inward: inwardWorld.toArray(),
            targetY: targetLocal.y,
            cameraInside: Math.abs(cameraLocal.x) < 9.35 && Math.abs(cameraLocal.z) < 5.85,
          });
        }
      });
      const viable = candidates.filter((candidate) => candidate.cameraInside);
      viable.sort((left, right) => (
        left.linePriority - right.linePriority
        || Math.hypot(left.tx, left.tz) - Math.hypot(right.tx, right.tz)
        || left.placementId.localeCompare(right.placementId)
      ));
      if (viable.length === 0) {
        throw new Error(`Asset 56 has no player-camera-accessible damage instance: ${JSON.stringify(candidates)}`);
      }
      return {
        id: 's6-d3-asset56-damage-close',
        purpose: 'sparse repairable Asset 56 panel wear visible on one deterministic wall bay',
        ...viable[0],
        candidateCount: candidates.length,
      };
    });
  }

  const captures = [];
  const capturePhases = {
    cleanFixedCameras: [],
    damagedTrio: [],
    normalControlRoute: [],
  };
  const cleanBeforeFixedCameras = await applyArchitecturePresentationState('clean');
  if (!cleanArchitectureOk(cleanBeforeFixedCameras.evidence)) {
    throw new Error(`Fixed cameras did not start in fully restored Sheet 6 state: ${JSON.stringify(cleanBeforeFixedCameras)}`);
  }
  for (const camera of fixedCameras) {
    await setFixedCamera(camera);
    const file = path.join(out, `${camera.id}.png`);
    await page.screenshot({ path: file });
    captures.push(file);
    capturePhases.cleanFixedCameras.push(file);
  }
  const cleanAfterFixedCameras = await collectArchitectureEvidence('clean:after-fixed-cameras');
  if (!cleanArchitectureOk(cleanAfterFixedCameras)) {
    throw new Error(`Sheet 6 clean state changed during fixed-camera capture: ${JSON.stringify(cleanAfterFixedCameras)}`);
  }

  const damagedTrio = await applyArchitecturePresentationState('damaged-trio');
  if (!damagedTrioOk(damagedTrio.evidence)) {
    throw new Error(`Sheet 6 damage trio did not become visible: ${JSON.stringify(damagedTrio)}`);
  }
  const asset56DamageCamera = await resolvePanelDamageCamera();
  const damagedShots = [
    {
      camera: fixedCameras[2],
      file: path.join(out, 's6-d1-asset52-damaged-facade.png'),
      purpose: 'Asset 52 boarded-aperture and trim damage visible over the unchanged Asset 51 shell and Asset 55 window',
    },
    {
      camera: asset60DamageCamera,
      file: path.join(out, 's6-d2-asset60-damaged-floor.png'),
      purpose: 'Asset 60 damage variant visible over the unchanged Asset 59 walkable floor',
    },
    {
      camera: asset56DamageCamera,
      file: path.join(out, 's6-d3-asset56-damaged-panel.png'),
      purpose: 'Asset 56 sparse panel wear visible on a deterministic unrestored wall bay',
    },
  ];
  for (const shot of damagedShots) {
    await setFixedCamera(shot.camera);
    await page.screenshot({ path: shot.file });
    captures.push(shot.file);
    capturePhases.damagedTrio.push(shot.file);
  }
  const damagedAfterCaptures = await collectArchitectureEvidence('damaged-trio:after-captures');
  if (!damagedTrioOk(damagedAfterCaptures)) {
    throw new Error(`Sheet 6 damage state changed during trio capture: ${JSON.stringify(damagedAfterCaptures)}`);
  }

  const restoredAfterDamage = await applyArchitecturePresentationState('clean');
  if (!cleanArchitectureOk(restoredAfterDamage.evidence)) {
    throw new Error(`Sheet 6 did not return to clean after damaged evidence: ${JSON.stringify(restoredAfterDamage)}`);
  }

  // Normal-control entrance route: E opens both authored leaves, W crosses the
  // live analytic colliders, ArrowLeft turns back, and E closes both leaves.
  const entranceCamera = fixedCameras[1];
  await setFixedCamera(entranceCamera);
  await page.waitForFunction(() => /Shop door/i.test(
    window.__fw?.scene3d?.walk?.getFocusLabel?.() || '',
  ), null, { timeout: 5000 });
  let captureStarted = null;
  let labelBeforeOpen = null;
  let labelBeforeClose = null;
  let routeStart = null;
  let routeAfterWalk = null;
  let routeEnd = null;
  let routeError = null;
  try {
    captureStarted = await page.evaluate(async () => {
    const audio = window.__fw?.audio;
    if (!audio || typeof audio.startCapture !== 'function') {
      throw new Error('The game audio/video capture API is unavailable.');
    }
    audio.setMuted(false);
    audio.setVolume(0.8);
    return audio.startCapture(document.getElementById('game'), { fps: 30 });
    });
    if (captureStarted.audioTracks < 1 || captureStarted.videoTracks < 1
      || captureStarted.audioContextState !== 'running') {
      throw new Error(`Sheet 6 capture did not start with live audio/video: ${JSON.stringify(captureStarted)}`);
    }
    labelBeforeOpen = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
    routeStart = await page.evaluate(() => {
    const app = window.__fw;
    const walk = app.scene3d.walk.state;
    const origin = app.scene3d.clubhouse().interior.position;
    return { x: walk.x - origin.x, z: walk.z - origin.z, yaw: walk.yaw };
    });
    await page.keyboard.press('e');
    await page.waitForFunction(() => {
    const main = window.__fw?.state?.shop?.reno?.architecture?.doors?.main;
    return main?.left === 'open' && main?.right === 'open';
    }, null, { timeout: 5000 });
    await page.waitForTimeout(900);
    const openFile = path.join(out, 's6-06-entry-open-normal-e.png');
    await page.screenshot({ path: openFile });
    captures.push(openFile);
    capturePhases.normalControlRoute.push(openFile);

    await page.keyboard.down('w');
    try {
      await page.waitForFunction((start) => {
      const app = window.__fw;
      const walk = app.scene3d.walk.state;
      const origin = app.scene3d.clubhouse().interior.position;
      const localX = walk.x - origin.x;
      const localZ = walk.z - origin.z;
      return localZ < 5.2 && Math.hypot(localX - start.x, localZ - start.z) > 2.5;
      }, routeStart, { timeout: 5000 });
    } finally {
      await page.keyboard.up('w').catch(() => {});
    }
    await page.waitForTimeout(180);
    routeAfterWalk = await page.evaluate(() => {
    const app = window.__fw;
    const walk = app.scene3d.walk.state;
    const origin = app.scene3d.clubhouse().interior.position;
    return { x: walk.x - origin.x, z: walk.z - origin.z, yaw: walk.yaw };
    });

    await page.keyboard.down('ArrowLeft');
    try {
      await page.waitForFunction((startYaw) => {
      let delta = window.__fw.scene3d.walk.state.yaw - startYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      return Math.abs(delta) > 3.0;
      }, routeAfterWalk.yaw, { timeout: 5000 });
    } finally {
      await page.keyboard.up('ArrowLeft').catch(() => {});
    }
    await page.waitForTimeout(220);
    await page.waitForFunction(() => /Shop door/i.test(
      window.__fw?.scene3d?.walk?.getFocusLabel?.() || '',
    ), null, { timeout: 5000 });
    labelBeforeClose = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
    const insideOpenFile = path.join(out, 's6-07-entry-open-after-normal-traverse.png');
    await page.screenshot({ path: insideOpenFile });
    captures.push(insideOpenFile);
    capturePhases.normalControlRoute.push(insideOpenFile);
    await page.keyboard.press('e');
    await page.waitForFunction(() => {
    const main = window.__fw?.state?.shop?.reno?.architecture?.doors?.main;
    return main?.left === 'closed' && main?.right === 'closed';
    }, null, { timeout: 5000 });
    await page.waitForTimeout(900);
    const closedInsideFile = path.join(out, 's6-08-entry-closed-normal-e.png');
    await page.screenshot({ path: closedInsideFile });
    captures.push(closedInsideFile);
    capturePhases.normalControlRoute.push(closedInsideFile);
    routeEnd = await page.evaluate(() => {
      const app = window.__fw;
      const walk = app.scene3d.walk.state;
      const origin = app.scene3d.clubhouse().interior.position;
      const main = app.state.shop.reno.architecture.doors.main;
      return {
        x: walk.x - origin.x,
        z: walk.z - origin.z,
        yaw: walk.yaw,
        persistedDoorState: { left: main.left, right: main.right },
      };
    });
  } catch (error) {
    routeError = error;
  } finally {
    await page.keyboard.up('w').catch(() => {});
    await page.keyboard.up('ArrowLeft').catch(() => {});
    await page.keyboard.up('e').catch(() => {});
  }

  let mediaCapture = null;
  if (captureStarted) {
    try {
      const downloadName = path.basename(videoOut);
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
      const stopPromise = page.evaluate((name) => (
        window.__fw.audio.stopCapture({ downloadName: name })
      ), downloadName);
      const [download, captureStopped] = await Promise.all([downloadPromise, stopPromise]);
      const downloadFailure = await download.failure();
      if (downloadFailure) throw new Error(`Sheet 6 video download failed: ${downloadFailure}`);
      await download.saveAs(videoOut);
      const videoBytesOnDisk = fs.statSync(videoOut).size;
      mediaCapture = {
        output: videoOut,
        bytesOnDisk: videoBytesOnDisk,
        ...captureStarted,
        ...captureStopped,
      };
    } catch (captureError) {
      if (!routeError) routeError = captureError;
      else diagnostics.push({ kind: 'capture-cleanup-error', message: captureError.message });
    };
  }
  if (routeError) throw routeError;
  if (!mediaCapture) throw new Error('Sheet 6 gameplay video was not retained.');
  const walkedDistance = Math.hypot(
    routeAfterWalk.x - routeStart.x,
    routeAfterWalk.z - routeStart.z,
  );
  let yawDelta = routeEnd.yaw - routeAfterWalk.yaw;
  while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
  while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;

  const cleanAfterNormalRoute = await collectArchitectureEvidence('clean:after-normal-control-route');
  const productionAtEnd = await productionDiagnostics();
  const blockingDiagnostics = diagnostics.filter((entry) => ![
    'console:warning',
    'requestaborted',
  ].includes(entry.kind));
  const checks = [
    {
      id: 'legacy-exterior-presentation-setup',
      ok: legacyExteriorFixtureOk,
      actual: fixture.legacyExteriorPresentationSetup,
    },
    {
      id: 'clean-restored-fixed-camera-state',
      ok: cleanArchitectureOk(cleanBeforeFixedCameras.evidence)
        && cleanArchitectureOk(cleanAfterFixedCameras)
        && capturePhases.cleanFixedCameras.length === fixedCameras.length,
      actual: {
        before: cleanBeforeFixedCameras,
        after: cleanAfterFixedCameras,
        captures: capturePhases.cleanFixedCameras,
      },
    },
    {
      id: 'damaged-asset52-asset56-asset60-evidence',
      ok: damagedTrioOk(damagedTrio.evidence)
        && damagedTrioOk(damagedAfterCaptures)
        && capturePhases.damagedTrio.length === 3
        && capturePhases.damagedTrio.every((file) => fs.existsSync(file)),
      actual: {
        before: damagedTrio,
        after: damagedAfterCaptures,
        shots: damagedShots,
      },
    },
    {
      id: 'returned-clean-before-normal-route',
      ok: cleanArchitectureOk(restoredAfterDamage.evidence),
      actual: restoredAfterDamage,
    },
    {
      id: 'clean-restored-after-normal-route',
      ok: cleanArchitectureOk(cleanAfterNormalRoute),
      actual: cleanAfterNormalRoute,
    },
    {
      id: 'sheet06-active',
      ok: productionAtEnd?.activationStatus === 'active'
        && productionAtEnd?.actualSharedGameIntegrated === true,
      actual: productionAtEnd,
    },
    {
      id: 'sheet06-production-contract',
      ok: productionAtEnd?.loadedAssetCount === 10
        && productionAtEnd?.assembledKitCount === 6
        && productionAtEnd?.glbCollisionObjectsActivated === 0
        && productionAtEnd?.assembly?.parkedTemplateSamples === 0
        && productionAtEnd?.door?.authoredBound === true
        && productionAtEnd?.door?.authoredPivotCount === 2
        && productionAtEnd?.door?.proceduralFallbackVisible === false
        && productionAtEnd?.navigation?.active === true
        && productionAtEnd?.navigation?.railColliderCount === 2
        && productionAtEnd?.navigation?.glbCollisionObjectsActivated === 0,
      actual: {
        loadedAssetCount: productionAtEnd?.loadedAssetCount,
        assembledKitCount: productionAtEnd?.assembledKitCount,
        glbCollisionObjectsActivated: productionAtEnd?.glbCollisionObjectsActivated,
        parkedTemplateSamples: productionAtEnd?.assembly?.parkedTemplateSamples,
        door: productionAtEnd?.door,
        navigation: productionAtEnd?.navigation,
      },
    },
    {
      id: 'normal-walk-crossed-entrance',
      ok: walkedDistance > 2.5 && routeAfterWalk.z < 6.4,
      actual: { walkedDistance, routeStart, routeAfterWalk },
    },
    {
      id: 'normal-arrow-turn',
      ok: Math.abs(yawDelta) > 2.7,
      actual: { yawDelta },
    },
    {
      id: 'normal-e-open-close-persisted',
      ok: routeEnd.persistedDoorState.left === 'closed'
        && routeEnd.persistedDoorState.right === 'closed',
      actual: routeEnd.persistedDoorState,
    },
    {
      id: 'audio-bearing-gameplay-video',
      ok: mediaCapture.bytesOnDisk > 0
        && mediaCapture.nonSilentAudioWindows > 0
        && mediaCapture.audioPeak > 0.0001,
      actual: mediaCapture,
    },
    {
      id: 'blocking-browser-diagnostics',
      ok: blockingDiagnostics.length === 0,
      actual: blockingDiagnostics,
    },
  ];
  const report = {
    ok: checks.every((check) => check.ok),
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/assets-51-60-live-qa.js --bootstrap',
    methodology: {
      viewport,
      deviceScaleFactor: 1,
      fixtureEstablishment: 'documented deterministic presentation setup: legacy exterior chores cleared before clubhouse construction and reasserted before rebuild; excluded from normal-control evidence',
      functionalControls: 'normal canvas click, E, W, ArrowLeft, E',
      readinessGate: 'activationStatus active and actualSharedGameIntegrated true before capture',
      architecturePresentation: 'canonical clubhouseRestoration public mutators with medium-walnut panel finish -> clubhouse.rebuildReno(); clean fixed cameras -> shell/panels/trim/floor Asset 52/56/60 damaged evidence -> canonical clean restoration -> normal-control door route',
    },
    fixture,
    pointerLockAcquired,
    fixedCameras,
    captures,
    capturePhases,
    architecturePresentation: {
      cleanBeforeFixedCameras,
      cleanAfterFixedCameras,
      damagedTrio,
      damagedAfterCaptures,
      damagedShots,
      restoredAfterDamage,
      cleanAfterNormalRoute,
    },
    normalControlRoute: {
      labelBeforeOpen,
      labelBeforeClose,
      routeStart,
      routeAfterWalk,
      routeEnd,
      walkedDistance,
      yawDelta,
    },
    mediaCapture,
    productionAtBoot,
    readySnapshot,
    productionAtEnd,
    checks,
    diagnostics,
  };
  fs.writeFileSync(path.join(out, 'live-result.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

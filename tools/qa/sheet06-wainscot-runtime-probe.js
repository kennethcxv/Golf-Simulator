async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const out = path.join(
    repo,
    'qa',
    'assets_51_100_master',
    'sheet_06',
    'diagnostics',
    'wainscot_runtime',
  );
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => diagnostics.push({
    kind: 'requestfailed',
    url: request.url(),
    message: request.failure()?.errorText || 'unknown',
  }));

  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.scene, null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    if (!production) return false;
    try { await production.ready; } catch { return false; }
    return production.diagnostics?.().activationStatus === 'active';
  }, null, { timeout: 90000 });

  const fixture = await page.evaluate(async () => {
    const restoration = await import('/src/sim/clubhouseRestoration.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const priorApplications = production.diagnostics().stateApplications;
    restoration.setPanelsRestored(app.state, true);
    restoration.setArchitectureFinish(app.state, 'panels', 'muted-sage');
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
    clubhouse.rebuildReno?.();
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    return {
      priorApplications,
      panelState: JSON.parse(JSON.stringify(app.state.shop.reno.architecture.components.panels)),
    };
  });
  await page.waitForFunction((priorApplications) => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    return Number(production?.diagnostics?.().stateApplications) > Number(priorApplications);
  }, fixture.priorApplications, { timeout: 30000 });
  await page.waitForTimeout(800);

  // Retain the same deterministic art-review camera used by iteration 05.
  await page.locator('#game').click({ position: { x: 800, y: 450 }, force: true });
  await page.evaluate(() => {
    const hint = document.querySelector('.shop-lockhint');
    if (hint) hint.style.visibility = 'hidden';
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const walk = app.scene3d.walk;
    const shot = { x: -1.0, z: 4.8, tx: -7.6, tz: -1.8, pitch: 0.17 };
    const origin = clubhouse.interior.position;
    walk.clearKeys?.();
    walk.state.x = origin.x + shot.x;
    walk.state.z = origin.z + shot.z;
    walk.state.yaw = Math.atan2(-(shot.tx - shot.x), -(shot.tz - shot.z));
    walk.state.pitch = shot.pitch;
  });
  await page.waitForTimeout(650);
  const screenshot = path.join(out, 's6-04-wainscot-current.png');
  await page.screenshot({ path: screenshot });

  const audit = await page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const panelRoot = production.getAssemblyRoot(56);
    const structuralRoot = production.getRoot(51);
    const interior = clubhouse.interior;
    scene.updateMatrixWorld(true);

    const pathOf = (object) => {
      const parts = [];
      for (let node = object; node; node = node.parent) {
        parts.push(node.name || node.type || '(anonymous)');
      }
      return parts.reverse().join('/');
    };
    const effectivelyVisible = (object) => {
      for (let node = object; node; node = node.parent) if (node.visible === false) return false;
      return true;
    };
    const materialInfo = (object) => (Array.isArray(object.material)
      ? object.material
      : [object.material])
      .filter(Boolean)
      .map((material) => ({
        name: material.name || '',
        color: material.color?.getHexString?.() || null,
        roughness: material.roughness ?? null,
        metalness: material.metalness ?? null,
      }));
    const multiply = (a, b) => {
      const result = new Array(16).fill(0);
      for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
          for (let index = 0; index < 4; index += 1) {
            result[column * 4 + row] += a[index * 4 + row] * b[column * 4 + index];
          }
        }
      }
      return result;
    };
    const transformPoint = (point, matrix) => {
      const [x, y, z] = point;
      const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
      return [
        (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
        (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
        (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
      ];
    };
    const normalized = (value) => {
      const magnitude = Math.hypot(...value);
      return magnitude > 0 ? value.map((entry) => entry / magnitude) : [0, 0, 0];
    };
    const dot = (a, b) => a.reduce((sum, entry, index) => sum + entry * b[index], 0);
    const boundsFor = (geometry, matrix) => {
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      if (!bounds) return null;
      const points = [];
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            points.push(transformPoint([x, y, z], matrix));
          }
        }
      }
      return {
        min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))),
        max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))),
        center: [0, 1, 2].map((axis) => (
          Math.min(...points.map((point) => point[axis]))
          + Math.max(...points.map((point) => point[axis]))
        ) / 2),
      };
    };
    const localBounds = (geometry) => {
      geometry.computeBoundingBox();
      return geometry.boundingBox ? {
        min: geometry.boundingBox.min.toArray(),
        max: geometry.boundingBox.max.toArray(),
      } : null;
    };
    const subtractOrigin = (point, origin) => point.map((value, index) => value - origin[index]);
    const roundVector = (value) => value.map((entry) => Math.round(entry * 1e6) / 1e6);

    const lineContracts = {
      south: { expectedInward: [0, 0, -1], expectedRotationY: Math.PI },
      north: { expectedInward: [0, 0, 1], expectedRotationY: 0 },
      west: { expectedInward: [1, 0, 0], expectedRotationY: Math.PI / 2 },
      east: { expectedInward: [-1, 0, 0], expectedRotationY: -Math.PI / 2 },
      'partition-a-west': { expectedInward: [-1, 0, 0], expectedRotationY: -Math.PI / 2 },
      'partition-a-east': { expectedInward: [1, 0, 0], expectedRotationY: Math.PI / 2 },
      'partition-b-north': { expectedInward: [0, 0, -1], expectedRotationY: Math.PI },
      'partition-b-south': { expectedInward: [0, 0, 1], expectedRotationY: 0 },
    };
    const lineForPlacement = (placementId) => Object.keys(lineContracts)
      .sort((left, right) => right.length - left.length)
      .find((line) => placementId.startsWith(`panel-${line}-`)) || null;

    const originWorld = [
      interior.matrixWorld.elements[12],
      interior.matrixWorld.elements[13],
      interior.matrixWorld.elements[14],
    ];
    const batchRecords = [];
    const firstPlacementByLine = new Map();
    panelRoot?.traverse((object) => {
      if (!object.isInstancedMesh || !object.geometry) return;
      const placements = object.userData?.sheet06PlacementIds || [];
      const geometryBounds = localBounds(object.geometry);
      const record = {
        name: object.name || '',
        path: pathOf(object),
        visible: object.visible,
        effectivelyVisible: effectivelyVisible(object),
        instanceCount: object.count,
        placementCount: placements.length,
        localBounds: geometryBounds,
        localZCenter: geometryBounds ? (geometryBounds.min[2] + geometryBounds.max[2]) / 2 : null,
        material: materialInfo(object),
        userData: {
          sheet06AssetNumber: object.userData?.sheet06AssetNumber ?? null,
          sheet06Variant: object.userData?.sheet06Variant ?? null,
          sheet06InstanceCount: object.userData?.sheet06InstanceCount ?? null,
          sheet06ScaleApplications: object.userData?.sheet06ScaleApplications ?? null,
          sheet06MetricFrame: object.userData?.sheet06MetricFrame ?? null,
        },
      };
      batchRecords.push(record);
      placements.forEach((placementId, instanceIndex) => {
        const line = lineForPlacement(placementId);
        if (!line) return;
        if (!firstPlacementByLine.has(line)) firstPlacementByLine.set(line, placementId);
        if (firstPlacementByLine.get(line) !== placementId) return;
        const instance = Array.from(object.instanceMatrix.array.slice(
          instanceIndex * 16,
          instanceIndex * 16 + 16,
        ));
        const combined = multiply(Array.from(object.matrixWorld.elements), instance);
        const worldBounds = boundsFor(object.geometry, combined);
        const worldFront = normalized([combined[8], combined[9], combined[10]]);
        const contract = lineContracts[line];
        record.lineSamples ||= [];
        record.lineSamples.push({
          line,
          placementId,
          instanceIndex,
          worldBounds,
          clubhouseLocalBounds: worldBounds ? {
            min: subtractOrigin(worldBounds.min, originWorld),
            max: subtractOrigin(worldBounds.max, originWorld),
            center: subtractOrigin(worldBounds.center, originWorld),
          } : null,
          worldFrontNormalFromLocalPositiveZ: roundVector(worldFront),
          expectedInwardNormal: contract.expectedInward,
          frontFacesRoomDot: Math.round(dot(worldFront, contract.expectedInward) * 1e6) / 1e6,
          expectedRotationY: contract.expectedRotationY,
          inwardDepth: worldBounds
            ? Math.round(dot(subtractOrigin(worldBounds.center, originWorld), contract.expectedInward) * 1e6) / 1e6
            : null,
        });
      });
    });

    const lines = {};
    for (const line of Object.keys(lineContracts)) {
      const samples = batchRecords.flatMap((record) => (
        (record.lineSamples || [])
          .filter((sample) => sample.line === line)
          .map((sample) => ({
            batch: record.name,
            material: record.material,
            localZCenter: record.localZCenter,
            ...sample,
          }))
      ));
      const cream = samples.find((sample) => /PanelWarmPlasterBack/.test(sample.batch));
      const walnut = samples.filter((sample) => /Walnut|DadoField/.test(sample.batch));
      const representative = walnut[0] || samples[0] || null;
      lines[line] = {
        ...lineContracts[line],
        actualFrontNormal: representative?.worldFrontNormalFromLocalPositiveZ || null,
        frontFacesRoomDot: representative?.frontFacesRoomDot ?? null,
        facesRoom: (representative?.frontFacesRoomDot ?? -1) > 0.99,
        creamBackingInwardDepth: cream?.inwardDepth ?? null,
        walnutDecoratedInwardDepthRange: walnut.length ? {
          min: Math.min(...walnut.map((sample) => sample.inwardDepth)),
          max: Math.max(...walnut.map((sample) => sample.inwardDepth)),
        } : null,
        visibleLayerTowardRoom: cream && walnut.length
          ? (cream.inwardDepth > Math.max(...walnut.map((sample) => sample.inwardDepth))
            ? 'warm-cream-backing'
            : 'walnut-decorated-front')
          : 'unknown',
        layers: samples,
      };
    }

    const structuralMeshes = [];
    structuralRoot?.traverse((object) => {
      if (!object.isMesh || !object.geometry) return;
      if (!/InteriorWarmCreamPlasterLiners/.test(object.name || '')) return;
      const bounds = boundsFor(object.geometry, Array.from(object.matrixWorld.elements));
      structuralMeshes.push({
        name: object.name,
        path: pathOf(object),
        visible: object.visible,
        effectivelyVisible: effectivelyVisible(object),
        worldBounds: bounds,
        clubhouseLocalBounds: bounds ? {
          min: subtractOrigin(bounds.min, originWorld),
          max: subtractOrigin(bounds.max, originWorld),
          center: subtractOrigin(bounds.center, originWorld),
        } : null,
        material: materialInfo(object),
        userData: object.userData || {},
      });
    });

    // The runtime intentionally keeps the legacy wainscot meshes in place and
    // leases their visibility off. These anonymous, thin, walnut-colored meshes
    // are retained only to prove that no procedural panel is winning the render.
    const hiddenProceduralPanelCandidates = [];
    interior?.traverse((object) => {
      if (!object.isMesh || object.isInstancedMesh || !object.geometry) return;
      if (panelRoot && (object === panelRoot || panelRoot.getObjectById?.(object.id))) return;
      const bounds = boundsFor(object.geometry, Array.from(object.matrixWorld.elements));
      if (!bounds) return;
      const size = bounds.max.map((value, index) => value - bounds.min[index]);
      const heightLooksLikeWainscot = size[1] >= 0.8 && size[1] <= 1.1;
      const thinWallField = Math.min(size[0], size[2]) <= 0.08;
      // Legacy shell meshes are anonymous direct children of `interior`; this
      // excludes unrelated hidden authored fixture descendants with similar
      // thin silhouettes.
      if (!heightLooksLikeWainscot
        || !thinWallField
        || effectivelyVisible(object)
        || pathOf(object) !== 'Scene/Group/Mesh') return;
      hiddenProceduralPanelCandidates.push({
        name: object.name || '',
        path: pathOf(object),
        visible: object.visible,
        effectivelyVisible: false,
        size,
        clubhouseLocalBounds: {
          min: subtractOrigin(bounds.min, originWorld),
          max: subtractOrigin(bounds.max, originWorld),
        },
        material: materialInfo(object),
      });
    });

    const productionDiagnostics = production.diagnostics();
    const panelKitDiagnostics = productionDiagnostics.assembly?.kits?.find(
      (entry) => Number(entry.assetNumber) === 56,
    ) || null;
    const wrongFacingLines = Object.entries(lines)
      .filter(([, record]) => !record.facesRoom)
      .map(([line]) => line);
    const correctFacingLines = Object.entries(lines)
      .filter(([, record]) => record.facesRoom)
      .map(([line]) => line);
    return {
      productionDiagnostics,
      panelKitDiagnostics,
      panelState: JSON.parse(JSON.stringify(app.state.shop.reno.architecture.components.panels)),
      panelRoot: panelRoot ? {
        name: panelRoot.name,
        path: pathOf(panelRoot),
        visible: panelRoot.visible,
        effectivelyVisible: effectivelyVisible(panelRoot),
        userData: panelRoot.userData || {},
        childCount: panelRoot.children.length,
      } : null,
      sourceFrontProof: {
        convention: 'Authored decorated face is Three local positive-Z; exported mesh geometry is origin-centered and the authored layer offset lives in each descriptor-relative instance matrix.',
        correctFacingWitnesses: Object.fromEntries(['north', 'east'].map((line) => [line, {
          actualFrontNormal: lines[line].actualFrontNormal,
          expectedInwardNormal: lines[line].expectedInward,
          frontFacesRoomDot: lines[line].frontFacesRoomDot,
          creamBackingInwardDepth: lines[line].creamBackingInwardDepth,
          walnutDecoratedInwardDepthRange: lines[line].walnutDecoratedInwardDepthRange,
          decoratedFrontIsProudOfCreamBacking: lines[line].walnutDecoratedInwardDepthRange.min
            > lines[line].creamBackingInwardDepth,
        }])),
        creamBacking: batchRecords
          .filter((record) => /PanelWarmPlasterBack/.test(record.name))
          .map((record) => ({ name: record.name, localZCenter: record.localZCenter, material: record.material })),
        decoratedFront: batchRecords
          .filter((record) => /Walnut|DadoField/.test(record.name))
          .map((record) => ({ name: record.name, localZCenter: record.localZCenter, material: record.material })),
      },
      orientationSummary: {
        wrongFacingLines,
        correctFacingLines,
        expectedWrongFacingLines: [],
        previouslyWrongFacingLines: ['south', 'west', 'partition-a-east', 'partition-b-north'],
      },
      lines,
      batchRecords,
      asset51InteriorLiners: structuralMeshes,
      hiddenProceduralPanelCandidateCount: hiddenProceduralPanelCandidates.length,
      hiddenProceduralPanelCandidates,
      clubhouseInteriorOriginWorld: originWorld,
    };
  });

  const expectedWrong = [];
  const actualWrong = [...audit.orientationSummary.wrongFacingLines].sort();
  const checks = [
    {
      id: 'asset56-live-and-visible',
      ok: audit.panelRoot?.effectivelyVisible === true
        && audit.panelKitDiagnostics?.status === 'assembled'
        && audit.panelKitDiagnostics?.instanceCount === 65,
      actual: {
        panelRoot: audit.panelRoot,
        panelKitDiagnostics: audit.panelKitDiagnostics,
      },
    },
    {
      id: 'procedural-fallbacks-leased-hidden',
      ok: audit.productionDiagnostics.hiddenFallbackCount === 7,
      actual: {
        hiddenFallbackCount: audit.productionDiagnostics.hiddenFallbackCount,
        hiddenProceduralPanelCandidateCount: audit.hiddenProceduralPanelCandidateCount,
      },
    },
    {
      id: 'source-decorated-front-is-local-positive-z',
      ok: Object.values(audit.sourceFrontProof.correctFacingWitnesses).every((entry) => (
        entry.frontFacesRoomDot > 0.99
        && entry.decoratedFrontIsProudOfCreamBacking === true
      )),
      actual: audit.sourceFrontProof,
    },
    {
      id: 'all-eight-line-orientations-face-their-room',
      ok: JSON.stringify(actualWrong) === JSON.stringify(expectedWrong),
      actual: {
        expectedWrong,
        actualWrong,
        correctFacingLines: audit.orientationSummary.correctFacingLines,
      },
    },
    {
      id: 'previously-wrong-walls-now-present-walnut-front',
      ok: audit.orientationSummary.previouslyWrongFacingLines.every((line) => (
        audit.lines[line]?.visibleLayerTowardRoom === 'walnut-decorated-front'
      )),
      actual: Object.fromEntries(audit.orientationSummary.previouslyWrongFacingLines.map((line) => [line, {
        visibleLayerTowardRoom: audit.lines[line]?.visibleLayerTowardRoom,
        actualFrontNormal: audit.lines[line]?.actualFrontNormal,
        expectedInward: audit.lines[line]?.expectedInward,
      }])),
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/sheet06-wainscot-runtime-probe.js --bootstrap',
    fixture: {
      ...fixture,
      viewport: { width: 1600, height: 900 },
      time: '2:00 PM',
      weather: 'fixed clear',
      camera: 'iteration_05_runtime/s6-04-interior-panel-trim-ceiling',
    },
    screenshot,
    checks,
    ...audit,
    diagnostics,
  };
}

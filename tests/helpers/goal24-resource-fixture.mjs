import {
  GOAL24_PRODUCTION_FRAME_LOOP_OWNER,
  assembleGoal24ResourceSnapshot,
} from '../../tools/qa/lib/goal24-resource-diagnostics.mjs';

export function goal24WorkloadContextFixture(overrides = {}) {
  const base = {
    schemaVersion: 2,
    appScreen: 'game',
    prewarming: false,
    camera: {
      fov: 64,
      aspect: 16 / 9,
      near: 0.05,
      far: 2400,
      position: { x: 12, y: 1.65, z: -8 },
      quaternion: { x: 0, y: 0.707107, z: 0, w: 0.707107 },
    },
    walk: {
      active: true,
      x: 12,
      z: -8,
      yaw: Math.PI / 2,
      pitch: 0,
      eye: 1.65,
      fov: 64,
    },
    heldTool: 'sponge',
    ledger: {
      open: false,
      visualOpen: false,
      state: 'closed',
      spread: 0,
      pageCount: 8,
      turning: false,
    },
  };

  return {
    ...base,
    ...overrides,
    camera: {
      ...base.camera,
      ...overrides.camera,
      position: {
        ...base.camera.position,
        ...overrides.camera?.position,
      },
      quaternion: {
        ...base.camera.quaternion,
        ...overrides.camera?.quaternion,
      },
    },
    walk: {
      ...base.walk,
      ...overrides.walk,
    },
    ledger: {
      ...base.ledger,
      ...overrides.ledger,
    },
  };
}

function frameLoopFixture() {
  return {
    schemaVersion: 1,
    ownerToken: GOAL24_PRODUCTION_FRAME_LOOP_OWNER,
    rootStartCount: 1,
    scheduleCount: 101,
    callbackCount: 100,
    pendingCallbackCount: 1,
    maximumPendingCallbackCount: 1,
    schedulingFailureCount: 0,
    pendingUnderflowCount: 0,
    firstRootStartAtMs: 1,
    lastCallbackAtMs: 1600,
    accountingConsistent: true,
    invariantHolds: true,
  };
}

function listenerFixture(count) {
  return {
    source: 'Goal 24 fixture complete CDP event-listener census',
    limitation: 'The fixture represents the complete inspected renderer target.',
    targetCount: 12,
    targetsInspected: 12,
    targetsFailed: 0,
    complete: true,
    total: count,
    byType: { click: count },
  };
}

function audioFixture(count) {
  const contexts = Array.from({ length: count }, () => ({ state: 'running' }));
  return {
    source: 'Goal 24 fixture app debugStats plus CDP queryObjects census',
    limitation: 'The fixture represents the main renderer wrappers only.',
    count,
    app: {
      available: true,
      value: {
        initialized: count > 0,
        contextState: count > 0 ? 'running' : null,
      },
    },
    runtime: { available: true, count, contexts },
    agreement: true,
  };
}

export function goal24ResourceSnapshotFixture({
  label = 'goal24-resource-fixture',
  capturedAt = '2026-08-11T20:00:00.000Z',
  heapUsedBytes = 50_000_000,
  listenerCount = 54,
  domNodeCount = 2_000,
  sceneObjectCount = 900,
  meshCount = 400,
  materialCount = 120,
  geometryCount = 250,
  textureCount = 80,
  rendererGeometryAllocationCount = 450,
  rendererTextureAllocationCount = 101,
  rendererProgramCount = 17,
  textureDimensionsUnknownCount = 8,
  audioContextCount = 1,
  estimatedTextureBytes = 80_000_000,
  workloadContext = goal24WorkloadContextFixture(),
  renderSampleCount = 13,
  rawSampleTransform = (sample) => sample,
} = {}) {
  if (typeof rawSampleTransform !== 'function') {
    throw new TypeError('rawSampleTransform must be a function.');
  }

  const renderSamples = Array.from({ length: renderSampleCount }, (_, index) => {
    const sample = {
      timestampMs: index * 16.667,
      rendererFrame: 100 + index * 4,
      composedRenders: 40 + index,
      productionCallbackCount: 80 + index,
      calls: index === 0 ? 0 : index <= 2 ? 900 + index : 120,
      triangles: index === 0 ? 0 : index <= 2 ? 500_000 + index : 250_000,
      lines: index,
      points: 0,
      rendererInfoAutoReset: false,
      shadowBakes: index === 0 ? 8 : index === 1 ? 9 : 10,
      workloadContext: structuredClone(workloadContext),
    };
    return rawSampleTransform(sample, index) ?? sample;
  });

  return assembleGoal24ResourceSnapshot({
    capturedAt,
    label,
    gcCompleted: true,
    heap: {
      usedSize: heapUsedBytes,
      totalSize: Math.max(80_000_000, heapUsedBytes),
    },
    dom: {
      documents: 1,
      nodes: domNodeCount,
      jsEventListeners: listenerCount,
    },
    listeners: listenerFixture(listenerCount),
    audio: audioFixture(audioContextCount),
    production: {
      renderSamples,
      frameLoopDiagnostics: frameLoopFixture(),
      scene: {
        source: 'Goal 24 resource fixture scene census',
        objects: sceneObjectCount,
        meshes: meshCount,
        instancedMeshes: 4,
        geometries: geometryCount,
        materials: materialCount,
        textures: textureCount,
        visibleMeshes: meshCount,
        visibleGeometries: geometryCount,
        visibleMaterials: materialCount,
        visibleTextures: textureCount,
        visibleTextureSurfaces: textureCount,
        textureDimensionsKnown: Math.max(0, textureCount - textureDimensionsUnknownCount),
        textureDimensionsUnknown: textureDimensionsUnknownCount,
        sceneTextureDimensionsKnown: Math.max(
          0,
          textureCount - textureDimensionsUnknownCount,
        ),
        sceneTextureDimensionsUnknown: textureDimensionsUnknownCount,
        sceneTrianglesBeforeFrustumCulling: 500_000,
        estimatedVisibleTextureBytes: estimatedTextureBytes,
        rendererMemory: {
          source: 'Goal 24 fixture THREE.WebGLRenderer.info.memory census',
          geometries: rendererGeometryAllocationCount,
          textures: rendererTextureAllocationCount,
          programs: rendererProgramCount,
        },
      },
    },
  });
}

export function goal24ResourceCheckpointFixture({
  iteration = 0,
  elapsedMs = 0,
  ...snapshotOptions
} = {}) {
  return {
    iteration,
    elapsedMs,
    snapshot: goal24ResourceSnapshotFixture(snapshotOptions),
  };
}

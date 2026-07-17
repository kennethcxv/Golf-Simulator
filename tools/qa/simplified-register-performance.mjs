import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:8457/';
const DEFAULT_VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const REQUIRED_VIEWPORTS = Object.freeze(['1280x720', '1600x900', '1920x1080']);
let VIEWPORT = { ...DEFAULT_VIEWPORT };
const ITEMS = Object.freeze(['tees1', 'marker1', 'glove1']);
let OUT = path.resolve('qa/cash-register-production/simplified-rebuild/performance');
const SAMPLE_COUNT = 3;
const SAMPLE_MS = 2500;
const WARMUP_MS = 1500;
const GC_SETTLE_MS = 600;
const REENTRY_CYCLES = 20;

function configureViewport(value) {
  const raw = String(value || '').trim().toLowerCase().replace('×', 'x');
  if (!raw) {
    VIEWPORT = { ...DEFAULT_VIEWPORT };
    return { explicit: false, tag: `${VIEWPORT.width}x${VIEWPORT.height}` };
  }
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(raw);
  if (!match) throw new Error(`Invalid performance viewport "${value}". Use WIDTHxHEIGHT.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 640 || height < 360) throw new Error(`Performance viewport ${raw} is too small for the production route.`);
  VIEWPORT = { width, height };
  return { explicit: true, tag: `${width}x${height}` };
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function round(value, places = 3) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(places));
}

function summarizeFrames(frameTimesMs) {
  if (!frameTimesMs.length) {
    return {
      frameCount: 0,
      durationMs: 0,
      avgFps: null,
      onePercentLowFps: null,
      avgFrameMs: null,
      p95FrameMs: null,
      p99FrameMs: null,
      worstFrameMs: null,
      framesOver33Ms: 0,
      framesOver50Ms: 0,
      framesOver100Ms: 0,
    };
  }
  const ascending = [...frameTimesMs].sort((a, b) => a - b);
  const descending = [...ascending].reverse();
  const slowCount = Math.max(1, Math.ceil(descending.length * 0.01));
  const slowMean = descending.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
  const durationMs = frameTimesMs.reduce((sum, value) => sum + value, 0);
  const percentile = (p) => ascending[Math.min(ascending.length - 1, Math.floor(ascending.length * p))];
  return {
    frameCount: frameTimesMs.length,
    durationMs: round(durationMs, 1),
    avgFps: round(frameTimesMs.length * 1000 / durationMs),
    onePercentLowFps: round(1000 / slowMean),
    avgFrameMs: round(durationMs / frameTimesMs.length),
    p95FrameMs: round(percentile(0.95)),
    p99FrameMs: round(percentile(0.99)),
    worstFrameMs: round(descending[0]),
    framesOver33Ms: frameTimesMs.filter((value) => value > 33.333).length,
    framesOver50Ms: frameTimesMs.filter((value) => value > 50).length,
    framesOver100Ms: frameTimesMs.filter((value) => value > 100).length,
  };
}

function delta(before, after) {
  const absolute = after == null || before == null ? null : after - before;
  const percent = absolute == null || before === 0 ? null : absolute / before * 100;
  return { before, after, absolute: round(absolute), percent: round(percent) };
}

async function boot(page) {
  await page.goto(BASE_URL);
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(900);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(900);
}

async function configureFixture(page) {
  return page.evaluate((skuIds) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72,
      tempLoF: 54,
      rainIn: 0,
      humidity: 0.48,
      windMph: 5,
    };
    for (const skuId of skuIds) {
      const inventory = app.state.shop.inventory[skuId];
      inventory.shelf = Math.max(12, inventory.shelf || 0);
      inventory.back = Math.max(0, inventory.back || 0);
    }
    app.state.shop.markup.accessories = 1.15;
    app.state.shop.markup.apparel = 1.15;
    clubhouse.rebuildStock();
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    app.scene3d.walk.clearKeys();

    // The same normal first-person position used by the simplified acceptance route.
    // Pressing E from here lets production register.enter() own the actual camera pose/FOV.
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 + clubhouse.interior.position.x;
    walk.z = 5.35 + clubhouse.interior.position.z;
    walk.yaw = 0;
    walk.pitch = -0.18;

    return {
      fixture: 'Willow Creek bootstrap, paused at 2 PM, clear weather, deterministic three-item retail customer',
      interiorOffset: {
        x: clubhouse.interior.position.x,
        y: clubhouse.interior.position.y,
        z: clubhouse.interior.position.z,
      },
      walk: { x: walk.x, z: walk.z, yaw: walk.yaw, pitch: walk.pitch },
    };
  }, ITEMS);
}

async function installUiInstrumentation(page) {
  await page.evaluate(() => {
    const dimensions = {
      '1024x640': 'frontDeskMonitor',
      '640x256': 'scannerStatus',
      '512x360': 'cashWorkspace',
      '384x256': 'cardTerminal',
    };
    window.__simplifiedRegisterPerf = {
      counters: {
        frontDeskMonitor: 0,
        scannerStatus: 0,
        cashWorkspace: 0,
        cardTerminal: 0,
        otherFullCanvasClears: 0,
      },
      reset() {
        for (const key of Object.keys(this.counters)) this.counters[key] = 0;
      },
    };
    const prototype = CanvasRenderingContext2D.prototype;
    if (!prototype.__simplifiedRegisterPerfWrapped) {
      const originalFillRect = prototype.fillRect;
      const originalClearRect = prototype.clearRect;
      const record = (context, x, y, width, height) => {
        const perf = window.__simplifiedRegisterPerf;
        if (!perf || x !== 0 || y !== 0 || width !== context.canvas.width || height !== context.canvas.height) return;
        const key = dimensions[`${width}x${height}`];
        if (key) perf.counters[key]++;
        else perf.counters.otherFullCanvasClears++;
      };
      prototype.fillRect = function simplifiedRegisterPerfFillRect(x, y, width, height) {
        record(this, x, y, width, height);
        return originalFillRect.apply(this, arguments);
      };
      prototype.clearRect = function simplifiedRegisterPerfClearRect(x, y, width, height) {
        record(this, x, y, width, height);
        return originalClearRect.apply(this, arguments);
      };
      Object.defineProperty(prototype, '__simplifiedRegisterPerfWrapped', { value: true });
    }
  });
}

async function waitForCameraStable(page, timeout = 12000) {
  await page.evaluate(() => { window.__simplifiedPerfCameraProbe = null; });
  await page.waitForFunction(() => {
    const camera = window.__fw.scene3d.camera;
    const now = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      qx: camera.quaternion.x,
      qy: camera.quaternion.y,
      qz: camera.quaternion.z,
      qw: camera.quaternion.w,
      fov: camera.fov,
    };
    const old = window.__simplifiedPerfCameraProbe;
    if (!old) {
      window.__simplifiedPerfCameraProbe = { ...now, stable: 0 };
      return false;
    }
    const movement = Math.hypot(
      now.x - old.x,
      now.y - old.y,
      now.z - old.z,
      now.qx - old.qx,
      now.qy - old.qy,
      now.qz - old.qz,
      now.qw - old.qw,
      (now.fov - old.fov) / 100,
    );
    const stable = movement < 0.0002 ? old.stable + 1 : 0;
    window.__simplifiedPerfCameraProbe = { ...now, stable };
    return stable >= 8;
  }, null, { timeout, polling: 'raf' });
}

async function cameraSnapshot(page) {
  return page.evaluate(() => {
    const camera = window.__fw.scene3d.camera;
    return {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      quaternion: {
        x: camera.quaternion.x,
        y: camera.quaternion.y,
        z: camera.quaternion.z,
        w: camera.quaternion.w,
      },
      fovDegrees: camera.fov,
      near: camera.near,
      far: camera.far,
    };
  });
}

async function heapSnapshot(page, cdp, collect = true) {
  if (collect) await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const response = await cdp.send('Performance.getMetrics');
  const metrics = Object.fromEntries(response.metrics.map((metric) => [metric.name, metric.value]));
  const memory = await page.evaluate(() => performance.memory ? {
    used: performance.memory.usedJSHeapSize,
    total: performance.memory.totalJSHeapSize,
    limit: performance.memory.jsHeapSizeLimit,
  } : null);
  const used = metrics.JSHeapUsedSize ?? memory?.used ?? null;
  return {
    source: 'Chrome DevTools Protocol Performance.getMetrics after explicit HeapProfiler.collectGarbage',
    explicitGcImmediatelyBeforeRead: collect,
    jsHeapUsedBytes: used,
    jsHeapUsedMiB: used == null ? null : round(used / 1048576),
    jsHeapTotalBytes: metrics.JSHeapTotalSize ?? memory?.total ?? null,
    domNodes: metrics.Nodes ?? null,
    documents: metrics.Documents ?? null,
    layoutObjects: metrics.LayoutObjects ?? null,
  };
}

async function listenerSnapshot(cdp) {
  const objectGroup = `simplified-register-perf-${Date.now()}`;
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: '[window, document, ...document.querySelectorAll("*")]',
    objectGroup,
    returnByValue: false,
  });
  const properties = await cdp.send('Runtime.getProperties', {
    objectId: evaluated.result.objectId,
    ownProperties: true,
  });
  const targets = properties.result
    .filter((property) => /^\d+$/.test(property.name) && property.value?.objectId)
    .map((property) => property.value.objectId);
  const all = [];
  for (let index = 0; index < targets.length; index += 30) {
    const batch = targets.slice(index, index + 30);
    const found = await Promise.all(batch.map(async (objectId) => {
      try {
        return (await cdp.send('DOMDebugger.getEventListeners', { objectId })).listeners;
      } catch (_) {
        return [];
      }
    }));
    all.push(...found.flat());
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup }).catch(() => {});
  const byType = {};
  for (const listener of all) byType[listener.type] = (byType[listener.type] || 0) + 1;
  return {
    source: 'CDP DOMDebugger.getEventListeners over window, document, and every current DOM Element',
    targetsInspected: targets.length,
    total: all.length,
    byType,
    unmeasured: 'Listeners on non-DOM EventTargets that are unreachable through CDP enumeration',
  };
}

async function domSnapshot(page) {
  return page.evaluate(() => ({
    source: 'document.querySelectorAll counts in the isolated QA page',
    elements: document.querySelectorAll('*').length,
    canvases: document.querySelectorAll('canvas').length,
    bodyChildren: document.body.children.length,
    registerModeClass: document.body.classList.contains('register-mode'),
    shopOverlaysVisible: [...document.querySelectorAll('.shop-overlay')]
      .filter((element) => getComputedStyle(element).display !== 'none').length,
  }));
}

async function sceneResourceSnapshot(page) {
  return page.evaluate(() => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    const textureKeys = [
      'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
      'emissiveMap', 'alphaMap', 'lightMap', 'envMap',
    ];
    let objects = 0;
    let meshes = 0;
    app.scene3d.scene.traverse((object) => {
      objects++;
      if (!object.isMesh) return;
      meshes++;
      if (object.geometry) geometries.add(object.geometry.uuid);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of textureKeys) if (material[key]) textures.add(material[key].uuid);
      }
    });
    return {
      source: 'Unique live THREE scene resource UUIDs plus WebGLRenderer.info.memory',
      objects,
      meshes,
      geometries: geometries.size,
      materials: materials.size,
      textures: textures.size,
      rendererMemory: {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      },
    };
  });
}

async function renderSnapshot(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const renderer = app.scene3d.renderer;
    const isWorldVisible = (object) => {
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    };
    requestAnimationFrame(() => {
      renderer.info.autoReset = false;
      renderer.info.reset();
      requestAnimationFrame(() => {
        const render = { ...renderer.info.render };
        const geometries = new Set();
        const materials = new Set();
        const textures = new Map();
        const textureKeys = [
          'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
          'emissiveMap', 'alphaMap', 'lightMap', 'envMap',
        ];
        let visibleMeshes = 0;
        let sceneTrianglesBeforeFrustumCulling = 0;
        scene.traverse((object) => {
          if (!object.isMesh || !isWorldVisible(object)) return;
          visibleMeshes++;
          if (object.geometry) {
            geometries.add(object.geometry.uuid);
            const triangles = object.geometry.index
              ? object.geometry.index.count / 3
              : (object.geometry.attributes?.position?.count || 0) / 3;
            sceneTrianglesBeforeFrustumCulling += triangles * (object.isInstancedMesh ? object.count : 1);
          }
          const list = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of list) {
            if (!material) continue;
            materials.add(material.uuid);
            for (const key of textureKeys) {
              const texture = material[key];
              if (texture) textures.set(texture.uuid, texture);
            }
          }
        });
        let estimatedTextureBytes = 0;
        let textureDimensionsKnown = 0;
        for (const texture of textures.values()) {
          const image = texture.image || texture.source?.data;
          const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
          const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
          if (!width || !height) continue;
          textureDimensionsKnown++;
          estimatedTextureBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
        }
        renderer.info.autoReset = true;
        resolve({
          source: 'THREE.WebGLRenderer.info accumulated for one complete composed game frame',
          drawCalls: render.calls,
          renderedTriangles: render.triangles,
          renderedLines: render.lines,
          renderedPoints: render.points,
          visibleSceneMeshes: visibleMeshes,
          sceneTrianglesBeforeFrustumCulling: Math.round(sceneTrianglesBeforeFrustumCulling),
          uniqueVisibleGeometries: geometries.size,
          uniqueVisibleMaterials: materials.size,
          uniqueVisibleTextures: textures.size,
          geometriesInRendererMemory: renderer.info.memory.geometries,
          texturesInRendererMemory: renderer.info.memory.textures,
          estimatedVisibleTextureBytes: Math.round(estimatedTextureBytes),
          estimatedVisibleTextureMiB: Math.round(estimatedTextureBytes / 1048576 * 1000) / 1000,
          textureDimensionsKnown,
          textureMemoryQualification: 'Estimate assumes RGBA8 and a complete mip chain when mip generation is enabled; exact GPU allocation is unavailable from WebGL.',
        });
      });
    });
  }));
}

async function sampleFrameTimes(page, durationMs) {
  return page.evaluate((ms) => new Promise((resolve) => {
    const values = [];
    let started = null;
    let previous = null;
    const frame = (now) => {
      if (started == null) {
        started = now;
        previous = now;
      } else {
        values.push(now - previous);
        previous = now;
      }
      if (now - started >= ms) resolve(values);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), durationMs);
}

async function captureScene(page, cdp, key, label) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await page.waitForTimeout(GC_SETTLE_MS);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(WARMUP_MS);
  await page.evaluate(() => window.__simplifiedRegisterPerf.reset());
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const frameTimesMs = await sampleFrameTimes(page, SAMPLE_MS);
    samples.push({
      index: index + 1,
      summary: summarizeFrames(frameTimesMs),
      frameTimesMs: frameTimesMs.map((value) => round(value)),
    });
  }
  const pooled = samples.flatMap((sample) => sample.frameTimesMs);
  const durationMs = pooled.reduce((sum, value) => sum + value, 0);
  const uiCounts = await page.evaluate(() => ({ ...window.__simplifiedRegisterPerf.counters }));
  const ui = {
    source: 'Page-local CanvasRenderingContext2D full-canvas clear/fill instrumentation',
    durationMs: round(durationMs, 1),
    counts: uiCounts,
    perSecond: Object.fromEntries(Object.entries(uiCounts).map(([name, count]) => [
      name,
      round(count * 1000 / durationMs),
    ])),
    qualification: 'Counts full-canvas clear/fill operations by known simplified-register canvas dimensions; it is not a general browser paint counter.',
  };
  const scene = {
    key,
    label,
    workspace: await page.evaluate(() => window.__fw.scene3d.clubhouse().register.workspace()),
    transactionStage: await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx()?.stage || null),
    camera: await cameraSnapshot(page),
    samples,
    aggregate: summarizeFrames(pooled),
    render: await renderSnapshot(page),
    heap: await heapSnapshot(page, cdp, true),
    listeners: await listenerSnapshot(cdp),
    dom: await domSnapshot(page),
    liveSceneResources: await sceneResourceSnapshot(page),
    ui,
    screenshot: `${key}.png`,
  };
  await page.screenshot({ path: path.join(OUT, scene.screenshot) });
  return scene;
}

async function stabilitySnapshot(page, cdp, cycle) {
  await page.waitForTimeout(250);
  return {
    cycle,
    camera: await cameraSnapshot(page),
    heap: await heapSnapshot(page, cdp, true),
    listeners: await listenerSnapshot(cdp),
    dom: await domSnapshot(page),
    liveSceneResources: await sceneResourceSnapshot(page),
    transactionNumber: await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx()?.number || null),
    transactionStage: await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx()?.stage || null),
  };
}

async function monitorClick(page, action) {
  await page.waitForFunction((id) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.monitorScreenPoint(id);
    return register.workspace() === 'monitor' && point && point.inView;
  }, action, { timeout: 10000 });
  const point = await page.evaluate((id) => window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id), action);
  assert(point?.inView, `Monitor action ${action} is outside the production camera.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(180);
}

async function exitFrontDesk(page) {
  for (let step = 0; step < 4; step += 1) {
    const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
    if (!active) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(45);
  }
  const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
  assert(!active, 'Escape did not back out through the shared monitor and leave the front desk.');
}

async function projectObject(page, predicate) {
  return page.evaluate(async (query) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((object) => {
      if (found || !object.visible || !object.userData) return;
      if (query.kind && object.userData.kind !== query.kind) return;
      if (query.uid && object.userData.uid !== query.uid) return;
      if (query.from && object.userData.from !== query.from) return;
      found = object;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = bounds.isEmpty()
      ? found.getWorldPosition(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3());
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, predicate);
}

async function projectLocal(page, local) {
  return page.evaluate(async (point) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const world = new THREE.Vector3(
      point.x + clubhouse.interior.position.x,
      point.y + clubhouse.interior.position.y,
      point.z + clubhouse.interior.position.z,
    ).project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, local);
}

async function scanAll(page) {
  const itemIds = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid));
  for (const uid of itemIds) {
    const product = await projectObject(page, { kind: 'item', uid });
    assert(product?.inView, `${uid} is outside the scanner production camera.`);
    await page.mouse.click(product.x, product.y);
    await page.waitForTimeout(500);
    const centered = await projectObject(page, { kind: 'item', uid });
    assert(centered?.inView, `${uid} did not auto-center in the scanner workspace.`);
    await page.mouse.move(centered.x, centered.y);
    await page.mouse.down();
    await page.mouse.move(Math.min(VIEWPORT.width - 70, centered.x + 760), centered.y, { steps: 18 });
    await page.mouse.up();
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx?.items.find((item) => item.uid === id)?.scanned;
    }, uid, { timeout: 5000 });
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    return register.workspace() === 'monitor' && tx?.items.every((item) => item.scanned && item.staged);
  }, null, { timeout: 7000 });
  await waitForCameraStable(page);
}

async function declineCardAndSwitchToCash(page, onCardEntry = null) {
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0; });
  const anchors = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.insertAt());
  const ready = await projectLocal(page, anchors.ready);
  const inserted = await projectLocal(page, anchors.inserted);
  assert(ready.inView && inserted.inView, 'Card insertion anchors are outside the production card camera.');
  await page.mouse.move(ready.x, ready.y);
  await page.mouse.down();
  await page.mouse.move(inserted.x, inserted.y, { steps: 16 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-entry' && tx.checkoutFlow?.state === 'CardAmountEntry';
  }, null, { timeout: 4000 });
  if (onCardEntry) await onCardEntry();
  const digits = await page.evaluate(async () => {
    const { totalOf } = await import('/src/sim/register.js');
    return String(Math.round(totalOf(window.__fw.scene3d.clubhouse().register.getTx()) * 100));
  });
  await page.keyboard.type(digits, { delay: 35 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-busy' && tx.checkoutFlow?.state === 'CardProcessing';
  }, null, { timeout: 4000 });
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-declined', null, { timeout: 7000 });
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.workspace() === 'monitor', null, { timeout: 7000 });
  await waitForCameraStable(page);
  await monitorClick(page, 'card-to-cash');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender', null, { timeout: 5000 });
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.workspace() === 'cash', null, { timeout: 5000 });
  await waitForCameraStable(page);
}

function markdownReport(result) {
  const sceneRows = Object.values(result.scenes).map((scene) => (
    `| ${scene.label} | ${scene.aggregate.avgFps} | ${scene.aggregate.onePercentLowFps} | ${scene.aggregate.worstFrameMs} | ${scene.render.drawCalls} | ${scene.render.renderedTriangles} | ${scene.render.uniqueVisibleMaterials} | ${scene.render.uniqueVisibleTextures} | ${scene.heap.jsHeapUsedMiB} | ${scene.listeners.total} | ${scene.dom.elements} | ${scene.ui.perSecond.frontDeskMonitor} / ${scene.ui.perSecond.scannerStatus} / ${scene.ui.perSecond.cashWorkspace} / ${scene.ui.perSecond.cardTerminal} | [image](./${scene.screenshot}) |`
  )).join('\n');
  const leakRows = result.reentryLeak.samples.map((sample) => (
    `| ${sample.cycle} | ${sample.heap.jsHeapUsedMiB} | ${sample.listeners.total} | ${sample.dom.elements} | ${sample.liveSceneResources.geometries} / ${sample.liveSceneResources.materials} / ${sample.liveSceneResources.textures} | ${sample.liveSceneResources.rendererMemory.geometries} / ${sample.liveSceneResources.rendererMemory.textures} | ${sample.transactionNumber} | ${sample.transactionStage} |`
  )).join('\n');
  const gateRows = Object.entries(result.gates.details).map(([name, gate]) => (
    `| ${name} | ${gate.pass ? 'PASS' : 'FAIL'} | ${gate.detail} |`
  )).join('\n');
  return `# Simplified register performance capture

Generated: ${result.generatedAt}

This is a current-build, matched-scene feature-overhead capture. The idle baseline is the shared front-desk monitor opened through normal E input with no transaction. The active comparison uses the same production monitor camera with a deterministic three-item transaction. Scanner, card, cash, and open-drawer workspaces are supplemental representative stages.

## Protocol

- Chrome ${result.environment.browserVersion}, ${result.environment.viewport.width}x${result.environment.viewport.height}, DPR ${result.environment.devicePixelRatio}
- GPU: ${result.environment.webglRenderer}
- Fixture: ${result.fixture.fixture}
- ${result.protocol.sampleCount} x ${result.protocol.sampleMs / 1000}-second rAF samples per scene, after explicit GC, ${result.protocol.gcSettleMs} ms settle, and ${result.protocol.warmupMs / 1000}-second warm-up
- Average FPS = sampled frames / sampled duration. 1% low = inverse mean of the slowest 1% of rAF deltas. Worst frame is the largest retained rAF delta.
- Render counts come from THREE.WebGLRenderer.info over a complete composed game frame.
- Texture MiB is an estimate, not a GPU allocation measurement.
- Listener totals cover window, document, and current DOM Elements; unreachable non-DOM EventTargets are unmeasured.

## Scene results

| Scene | Avg FPS | 1% low | Worst ms | Draw calls | Triangles | Visible materials | Visible textures | Post-GC heap MiB | Listeners | DOM elements | UI clears/s monitor / scan / cash / card | Evidence |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${sceneRows}

Matched idle-to-active monitor camera delta: ${result.comparison.camera.positionDistance} world units, ${result.comparison.camera.quaternionDistance} quaternion distance, ${result.comparison.camera.fovDeltaDegrees} degrees FOV.

## Re-entry stability

The probe performs ${result.protocol.reentryCycles} normal Escape/E leave/re-enter cycles while preserving the same live transaction.

| Cycle | Post-GC heap MiB | Listeners | DOM elements | Live geometry / material / texture | Renderer geometry / texture | Tx # | Stage |
|---:|---:|---:|---:|---:|---:|---:|---|
${leakRows}

Final deltas: heap ${result.reentryLeak.delta.heapMiB >= 0 ? '+' : ''}${result.reentryLeak.delta.heapMiB} MiB; listeners ${result.reentryLeak.delta.listeners >= 0 ? '+' : ''}${result.reentryLeak.delta.listeners}; DOM ${result.reentryLeak.delta.domElements >= 0 ? '+' : ''}${result.reentryLeak.delta.domElements}; live geometry/material/texture ${result.reentryLeak.delta.liveGeometries}/${result.reentryLeak.delta.liveMaterials}/${result.reentryLeak.delta.liveTextures}; renderer geometry/texture ${result.reentryLeak.delta.rendererGeometries}/${result.reentryLeak.delta.rendererTextures}.

## Gates

| Gate | Result | Detail |
|---|---|---|
${gateRows}

Overall proposed-budget verdict: **${result.gates.pass ? 'PASS' : 'FAIL'}**.

The tolerances are local QA budgets, not repository product requirements: active monitor average FPS no more than 35% below idle, 1% low no more than 40% below idle, every sampled scene at least 30 FPS with no rAF delta over 100 ms, exact production-camera match, no listener/DOM/live-resource growth through re-entry, renderer memory growth at most two lazily realized resources, post-GC heap growth at most 2 MiB, no console/page/non-benign request errors, and no more than 5 static known-register canvas full clears per second in the idle/active monitor scenes.

## Limitations

- Headless Chrome rAF timing reflects this host, browser, viewport, and current background load; it is not a multi-hardware benchmark.
- Exact GPU texture allocation and GPU frame time are unavailable through WebGL; visible texture bytes are explicitly estimated as RGBA8 with mip assumptions.
- The listener probe cannot enumerate inaccessible non-DOM EventTargets.
- The leak probe exercises repeated safe exit/re-entry on one preserved transaction; it does not replace a multi-sale lifecycle stress test.
- Canvas clear instrumentation reports update frequency for known register canvas dimensions, not compositor paints or total UI CPU time.

Raw samples and metric sources are retained in [simplified-register-performance.json](./simplified-register-performance.json).
`;
}

export async function runSimplifiedRegisterPerformance(page, options = {}) {
  const viewportRun = configureViewport(options.viewport
    || process.env.REGISTER_PERF_VIEWPORT
    || process.env.REGISTER_QA_VIEWPORT
    || process.env.QA_VIEWPORT);
  const outBase = path.resolve(process.env.REGISTER_PERF_ROOT
    || 'qa/cash-register-production/simplified-rebuild/performance');
  OUT = viewportRun.explicit ? path.join(outBase, viewportRun.tag) : outBase;
  fs.mkdirSync(OUT, { recursive: true });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));

  await boot(page);
  const fixture = await configureFixture(page);
  await installUiInstrumentation(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  const environment = await page.evaluate(() => {
    const app = window.__fw;
    const gl = app.scene3d.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      url: location.href,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory || null,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      webglVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      webglRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  environment.browserVersion = await page.context().browser().version();

  // Idle is the normal shared monitor with no transaction; production owns the camera.
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.isActive() && !register.getTx() && register.workspace() === 'monitor';
  }, null, { timeout: 5000 });
  await waitForCameraStable(page);
  const scenes = {};
  scenes.idleMonitor = await captureScene(page, cdp, '01-idle-monitor', 'Idle shared monitor');

  await exitFrontDesk(page);
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 5000 });
  const customer = await page.evaluate((skuIds) => window.__fw.scene3d.clubhouse().sendToCounter(skuIds, 'card'), ITEMS);
  assert(customer, 'Could not create deterministic performance customer.');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx()?.items.length === 3, null, { timeout: 15000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.isActive() && register.getTx()?.items.length === 3 && register.workspace() === 'monitor';
  }, null, { timeout: 5000 });
  await waitForCameraStable(page);
  scenes.activeMonitor = await captureScene(page, cdp, '02-active-monitor', 'Active three-item monitor');

  const reentrySamples = [await stabilitySnapshot(page, cdp, 0)];
  const transactionNumber = reentrySamples[0].transactionNumber;
  for (let cycle = 1; cycle <= REENTRY_CYCLES; cycle++) {
    await exitFrontDesk(page);
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 3000 });
    await page.waitForTimeout(45);
    await page.keyboard.press('e');
    await page.waitForFunction((number) => {
      const register = window.__fw.scene3d.clubhouse().register;
      return register.isActive() && register.getTx()?.number === number && register.workspace() === 'monitor';
    }, transactionNumber, { timeout: 3000 });
    await page.waitForTimeout(70);
    if (cycle % 5 === 0) reentrySamples.push(await stabilitySnapshot(page, cdp, cycle));
  }
  const leakStart = reentrySamples[0];
  const leakEnd = reentrySamples[reentrySamples.length - 1];
  const reentryLeak = {
    cycles: REENTRY_CYCLES,
    samples: reentrySamples,
    delta: {
      heapMiB: round(leakEnd.heap.jsHeapUsedMiB - leakStart.heap.jsHeapUsedMiB),
      listeners: leakEnd.listeners.total - leakStart.listeners.total,
      domElements: leakEnd.dom.elements - leakStart.dom.elements,
      liveGeometries: leakEnd.liveSceneResources.geometries - leakStart.liveSceneResources.geometries,
      liveMaterials: leakEnd.liveSceneResources.materials - leakStart.liveSceneResources.materials,
      liveTextures: leakEnd.liveSceneResources.textures - leakStart.liveSceneResources.textures,
      rendererGeometries: leakEnd.liveSceneResources.rendererMemory.geometries - leakStart.liveSceneResources.rendererMemory.geometries,
      rendererTextures: leakEnd.liveSceneResources.rendererMemory.textures - leakStart.liveSceneResources.rendererMemory.textures,
    },
  };

  await monitorClick(page, 'start-scanning');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.workspace() === 'scan', null, { timeout: 5000 });
  await waitForCameraStable(page);
  scenes.scanner = await captureScene(page, cdp, '03-scanner', 'Assisted scanner workspace');
  await scanAll(page);

  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    return register.workspace() === 'card' && tx?.method === 'card' && tx.stage === 'card-ready';
  }, null, { timeout: 7000 });
  await waitForCameraStable(page);
  scenes.card = await captureScene(page, cdp, '04-card', 'Physical card reader workspace');

  await declineCardAndSwitchToCash(page, async () => {
    scenes.cardEntry = await captureScene(page, cdp, '04b-card-entry', 'Inserted card and active amount keypad');
  });
  scenes.cash = await captureScene(page, cdp, '05-cash', 'Cash workspace, tender presented');
  const tender = await projectObject(page, { kind: 'money', from: 'tender' });
  assert(tender?.inView, 'Presented cash is outside the production cash camera.');
  await page.mouse.click(tender.x, tender.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'cash-drawer' && tx.drawerOpen;
  }, null, { timeout: 5000 });
  await page.waitForTimeout(650);
  scenes.cashDrawer = await captureScene(page, cdp, '06-cash-drawer', 'Cash workspace, drawer open');

  const cameraPositionDistance = Math.hypot(
    scenes.activeMonitor.camera.position.x - scenes.idleMonitor.camera.position.x,
    scenes.activeMonitor.camera.position.y - scenes.idleMonitor.camera.position.y,
    scenes.activeMonitor.camera.position.z - scenes.idleMonitor.camera.position.z,
  );
  const cameraQuaternionDistance = Math.hypot(
    scenes.activeMonitor.camera.quaternion.x - scenes.idleMonitor.camera.quaternion.x,
    scenes.activeMonitor.camera.quaternion.y - scenes.idleMonitor.camera.quaternion.y,
    scenes.activeMonitor.camera.quaternion.z - scenes.idleMonitor.camera.quaternion.z,
    scenes.activeMonitor.camera.quaternion.w - scenes.idleMonitor.camera.quaternion.w,
  );
  const comparison = {
    camera: {
      positionDistance: round(cameraPositionDistance, 6),
      quaternionDistance: round(cameraQuaternionDistance, 6),
      fovDeltaDegrees: round(scenes.activeMonitor.camera.fovDegrees - scenes.idleMonitor.camera.fovDegrees, 6),
    },
    avgFps: delta(scenes.idleMonitor.aggregate.avgFps, scenes.activeMonitor.aggregate.avgFps),
    onePercentLowFps: delta(scenes.idleMonitor.aggregate.onePercentLowFps, scenes.activeMonitor.aggregate.onePercentLowFps),
    worstFrameMs: delta(scenes.idleMonitor.aggregate.worstFrameMs, scenes.activeMonitor.aggregate.worstFrameMs),
    drawCalls: delta(scenes.idleMonitor.render.drawCalls, scenes.activeMonitor.render.drawCalls),
    renderedTriangles: delta(scenes.idleMonitor.render.renderedTriangles, scenes.activeMonitor.render.renderedTriangles),
    uniqueVisibleMaterials: delta(scenes.idleMonitor.render.uniqueVisibleMaterials, scenes.activeMonitor.render.uniqueVisibleMaterials),
    uniqueVisibleTextures: delta(scenes.idleMonitor.render.uniqueVisibleTextures, scenes.activeMonitor.render.uniqueVisibleTextures),
    estimatedVisibleTextureMiB: delta(scenes.idleMonitor.render.estimatedVisibleTextureMiB, scenes.activeMonitor.render.estimatedVisibleTextureMiB),
    postGcHeapMiB: delta(scenes.idleMonitor.heap.jsHeapUsedMiB, scenes.activeMonitor.heap.jsHeapUsedMiB),
    listeners: delta(scenes.idleMonitor.listeners.total, scenes.activeMonitor.listeners.total),
    domElements: delta(scenes.idleMonitor.dom.elements, scenes.activeMonitor.dom.elements),
  };
  const nonBenignRequestFailures = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
  const workspaceTailPass = Object.values(scenes).every((scene) => scene.aggregate.worstFrameMs <= 100);
  const workspaceFpsPass = Object.values(scenes).every((scene) => scene.aggregate.avgFps >= 30);
  const staticUiRate = Math.max(
    ...['idleMonitor', 'activeMonitor'].flatMap((key) => {
      const rates = scenes[key].ui.perSecond;
      return [rates.frontDeskMonitor, rates.scannerStatus, rates.cashWorkspace, rates.cardTerminal];
    }),
  );
  const gate = (pass, detail) => ({ pass: !!pass, detail });
  const gateDetails = {
    cameraMatch: gate(
      cameraPositionDistance <= 0.002 && cameraQuaternionDistance <= 0.002
        && Math.abs(comparison.camera.fovDeltaDegrees) <= 0.02,
      `position ${round(cameraPositionDistance, 6)}, quaternion ${round(cameraQuaternionDistance, 6)}, FOV ${comparison.camera.fovDeltaDegrees} degrees`,
    ),
    activeMonitorAverageFps: gate(
      comparison.avgFps.percent >= -35,
      `${comparison.avgFps.percent}% versus idle; budget >= -35%`,
    ),
    activeMonitorOnePercentLow: gate(
      comparison.onePercentLowFps.percent >= -40,
      `${comparison.onePercentLowFps.percent}% versus idle; budget >= -40%`,
    ),
    everyWorkspaceAverageFps: gate(workspaceFpsPass, `minimum ${Math.min(...Object.values(scenes).map((scene) => scene.aggregate.avgFps))} FPS; budget >= 30 FPS`),
    everyWorkspaceWorstFrame: gate(workspaceTailPass, `maximum ${Math.max(...Object.values(scenes).map((scene) => scene.aggregate.worstFrameMs))} ms; budget <= 100 ms`),
    reentryHeap: gate(Math.abs(reentryLeak.delta.heapMiB) <= 2, `${reentryLeak.delta.heapMiB} MiB after ${REENTRY_CYCLES} cycles; budget <= 2 MiB absolute growth`),
    reentryListeners: gate(reentryLeak.delta.listeners === 0, `${reentryLeak.delta.listeners} listeners after ${REENTRY_CYCLES} cycles; budget 0`),
    reentryDom: gate(reentryLeak.delta.domElements === 0, `${reentryLeak.delta.domElements} elements after ${REENTRY_CYCLES} cycles; budget 0`),
    reentryLiveResources: gate(
      reentryLeak.delta.liveGeometries === 0 && reentryLeak.delta.liveMaterials === 0 && reentryLeak.delta.liveTextures === 0,
      `${reentryLeak.delta.liveGeometries}/${reentryLeak.delta.liveMaterials}/${reentryLeak.delta.liveTextures} geometry/material/texture; budget 0/0/0`,
    ),
    reentryRendererMemory: gate(
      Math.abs(reentryLeak.delta.rendererGeometries) <= 2 && Math.abs(reentryLeak.delta.rendererTextures) <= 2,
      `${reentryLeak.delta.rendererGeometries}/${reentryLeak.delta.rendererTextures} geometry/texture; budget <= 2 lazy resources each`,
    ),
    staticUiFrequency: gate(staticUiRate <= 5, `maximum known register full-canvas clear rate ${staticUiRate}/s in static monitor scenes; budget <= 5/s`),
    runtimeErrors: gate(consoleErrors.length === 0 && pageErrors.length === 0, `${consoleErrors.length} console errors, ${pageErrors.length} page errors`),
    requestFailures: gate(nonBenignRequestFailures.length === 0, `${nonBenignRequestFailures.length} non-benign failures`),
  };
  const gates = {
    pass: Object.values(gateDetails).every((entry) => entry.pass),
    details: gateDetails,
  };

  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    protocol: {
      baseUrl: BASE_URL,
      viewport: VIEWPORT,
      requiredViewports: REQUIRED_VIEWPORTS,
      sampleCount: SAMPLE_COUNT,
      sampleMs: SAMPLE_MS,
      warmupMs: WARMUP_MS,
      gcSettleMs: GC_SETTLE_MS,
      reentryCycles: REENTRY_CYCLES,
      productionInputRoute: 'E/Escape, physical monitor clicks, automatic customer payment choice, physical product drag, physical card insertion, physical tender click',
    },
    fixture,
    environment,
    customer,
    scenes,
    comparison,
    reentryLeak,
    errors: {
      consoleErrors,
      pageErrors,
      failedRequests,
      nonBenignRequestFailures,
    },
    gates,
    limitations: [
      'Single-host headless Chrome measurement; not a multi-device hardware benchmark.',
      'Texture memory is an RGBA8/mipmap estimate because WebGL does not expose exact GPU allocation.',
      'Listener enumeration excludes inaccessible non-DOM EventTargets.',
      'Leak stress covers 20 safe enter/exit cycles on one transaction, not repeated completed-sale lifecycle cleanup.',
      'Canvas instrumentation counts known full-canvas operations, not compositor paints or total UI CPU time.',
    ],
  };
  fs.writeFileSync(path.join(OUT, 'simplified-register-performance.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(OUT, 'README.md'), markdownReport(result));
  return {
    ok: true,
    out: OUT,
    raw: path.join(OUT, 'simplified-register-performance.json'),
    report: path.join(OUT, 'README.md'),
    comparison,
    workspaces: Object.fromEntries(Object.entries(scenes).map(([key, scene]) => [key, {
      avgFps: scene.aggregate.avgFps,
      onePercentLowFps: scene.aggregate.onePercentLowFps,
      worstFrameMs: scene.aggregate.worstFrameMs,
      drawCalls: scene.render.drawCalls,
      renderedTriangles: scene.render.renderedTriangles,
      materials: scene.render.uniqueVisibleMaterials,
      textures: scene.render.uniqueVisibleTextures,
      postGcHeapMiB: scene.heap.jsHeapUsedMiB,
      listeners: scene.listeners.total,
      domElements: scene.dom.elements,
    }])) ,
    reentryLeak: reentryLeak.delta,
    gates,
    errors: result.errors,
  };
}

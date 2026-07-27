'use strict';

// Repeatable pre-production baseline for the five-tier golf-cart asset pass.
// The route enters through the current player-facing menu, stages five carts
// through a documented fixture, then records fixed cameras and three identical
// performance samples at the authored cart-service bay.

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const URL = process.env.QA_URL || 'http://127.0.0.1:8457/';
const OUT = path.resolve(process.env.QA_OUT || path.join(ROOT, 'qa', 'golf-carts', 'baseline'));
const LABEL = process.env.QA_LABEL || 'before-assets';
const FLEET_PROFILE = process.env.QA_FLEET_PROFILE || 'owned-eight';
const HIDE_CARTS = process.env.QA_HIDE_CARTS === '1';
const CAPTURE_LOD = process.env.QA_CAPTURE_LOD === '1';
const PAIRED_VISIBILITY = process.env.QA_PAIRED_VISIBILITY === '1';
const VIEWPORT = { width: 1600, height: 900 };
const SAMPLE_MS = Math.max(100, Number(process.env.QA_SAMPLE_MS || 5000));
const SAMPLE_COUNT = Math.max(1, Math.round(Number(process.env.QA_SAMPLE_COUNT || 3)));
const WARMUP_MS = Math.max(0, Number(process.env.QA_WARMUP_MS || 6000));

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'video'), { recursive: true });

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(Number(value || 0) * scale) / scale;
}

async function waitForWorld(page) {
  await page.waitForFunction(() => (
    window.__fw?.screen === 'game'
      && window.__fw?.scene3d?.walk?.isActive?.()
      && window.__fw?.scene3d?.clubhouse?.()
  ), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    if (window.__fw?.prewarming === true) return false;
    if (!veil) return true;
    const style = getComputedStyle(veil);
    return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
  }, null, { timeout: 90_000 });
}

async function startNewProperty(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.getByRole('button', { name: /^New game\b/i }).click();
  await page.getByRole('button', { name: /^Relaxed\b/i }).click();
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90_000 });
  await page.evaluate(() => window.__fw.scene3d.clubhouse().setOrganicWalkins?.(false));
  await waitForWorld(page);
}

async function installFixture(page) {
  return page.evaluate(async (fleetProfile) => {
    const app = window.__fw;
    const state = app.state;
    const { ensureGolfDay } = await import('/src/sim/golfDay.js');
    ensureGolfDay(state);
    state.tutorial.complete = true;
    state.tutorial.hidden = true;
    state.weather.locked = true;
    state.weather.today = {
      tempHiF: 74,
      tempLoF: 55,
      rainIn: 0,
      humidity: 0.42,
      windMph: 5,
    };
    const dayStart = Math.floor(state.clock.minutes / 1440) * 1440;
    state.clock.minutes = dayStart + 10 * 60 + 30;
    app.empire.clockMinutes = state.clock.minutes;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(state.clock.minutes, state.weather);
    app.scene3d.clubhouse?.()?.setOrganicWalkins?.(false);
    app.scene3d.setGolfersFrozen(false);
    const fiveTiers = ['basic', 'standard', 'premium', 'high_end', 'luxury'];
    for (let index = 0; index < state.golfDay.carts.length; index++) {
      const cart = state.golfDay.carts[index];
      if (fleetProfile === 'five-tier' && index < fiveTiers.length) cart.tierId = fiveTiers[index];
      cart.status = index < 5 ? (index % 2 === 0 ? 'charging' : 'cleaning') : 'available';
      if (fleetProfile === 'five-tier' && index >= fiveTiers.length) cart.status = 'assigned';
      cart.assignedPartyId = null;
      cart.position = null;
      cart.serviceReadyMinute = index < 5 ? state.clock.minutes + 240 : null;
    }
    const barn = state.golfDay.routeNetwork?.facilities?.cartBarn;
    if (!barn) throw new Error('The authored cart-service bay is unavailable.');
    return {
      seed: state.seed,
      mode: state.mode,
      clubName: state.clubName,
      gameMinute: state.clock.minutes,
      serviceCartIds: state.golfDay.carts.slice(0, 5).map((cart) => cart.id),
      fleetProfile,
      barn: { x: barn.x, z: barn.z },
    };
  }, FLEET_PROFILE);
}

async function waitForFiveCarts(page) {
  await page.waitForFunction(() => {
    const group = window.__fw?.scene3d?.scene?.getObjectByName('LiveGolfCarts');
    if (!group) return false;
    return group.children.filter((child) => child.name.startsWith('GolfCart_')).length >= 5;
  }, null, { timeout: 90_000 });
}

async function placeCamera(page, fixture, name) {
  const offsets = {
    frontThreeQuarter: { at: [7.2, 7.8], target: [0, 2.4], pitch: -0.12 },
    sideProfile: { at: [8.4, 2.8], target: [0, 2.8], pitch: -0.10 },
    elevatedFleet: { at: [7.4, -5.8], target: [0, 2.8], pitch: -0.24 },
    mediumLodFront: { at: [-2.55, -15.0], target: [-2.55, 0.0], pitch: -0.08 },
  };
  const pose = offsets[name];
  if (!pose) throw new Error(`Unknown golf-cart baseline camera: ${name}`);
  return page.evaluate(({ barn, pose }) => {
    const walk = window.__fw.scene3d.walk;
    walk.clearKeys?.();
    const state = walk.state;
    state.x = barn.x + pose.at[0];
    state.z = barn.z + pose.at[1];
    const targetX = barn.x + pose.target[0];
    const targetZ = barn.z + pose.target[1];
    state.yaw = Math.atan2(-(targetX - state.x), -(targetZ - state.z));
    state.pitch = pose.pitch;
    return {
      x: state.x,
      z: state.z,
      targetX,
      targetZ,
      yaw: state.yaw,
      pitch: state.pitch,
    };
  }, { barn: fixture.barn, pose });
}

async function clearPresentationClutter(page) {
  for (let index = 0; index < 20; index++) {
    const dismiss = page.locator('button.notification-dismiss').first();
    if (!await dismiss.isVisible().catch(() => false)) break;
    await dismiss.evaluate((button) => button.click()).catch(() => {});
    await page.waitForTimeout(220);
  }
  const canvas = page.locator('canvas').first();
  if (await canvas.isVisible().catch(() => false)) {
    const box = await canvas.boundingBox();
    if (box) await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  }
  await page.waitForTimeout(350);
}

async function sceneInventory(page) {
  return page.evaluate(() => {
    const app = window.__fw;
    const group = app.scene3d.scene.getObjectByName('LiveGolfCarts');
    const cartRoots = (group?.children || []).filter((child) => child.type === 'Group');
    const uniqueGeometries = new Set();
    const uniqueMaterials = new Set();
    let meshes = 0;
    let triangles = 0;
    let visibleMeshes = 0;
    let visibleTriangles = 0;
    let visibleShadowMeshes = 0;
    const roots = [];
    for (const root of cartRoots) root.traverse((object) => {
      if (!object.isMesh) return;
      meshes++;
      if (object.geometry?.uuid) uniqueGeometries.add(object.geometry.uuid);
      const meshTriangles = object.geometry?.index
        ? object.geometry.index.count / 3
        : (object.geometry?.attributes?.position?.count || 0) / 3;
      triangles += meshTriangles;
      if (object.visible) {
        visibleMeshes++;
        visibleTriangles += meshTriangles;
        if (object.castShadow) visibleShadowMeshes++;
      }
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (material) uniqueMaterials.add(material.uuid);
      }
    });
    for (const root of cartRoots) {
      let rootMeshes = 0;
      let rootVisibleMeshes = 0;
      let rootShadowMeshes = 0;
      root.traverse((object) => {
        if (!object.isMesh) return;
        rootMeshes++;
        if (object.visible) {
          rootVisibleMeshes++;
          if (object.castShadow) rootShadowMeshes++;
        }
      });
      roots.push({
        name: root.name,
        meshes: rootMeshes,
        visibleMeshes: rootVisibleMeshes,
        visibleShadowMeshes: rootShadowMeshes,
        batch: root.userData?.golfCartBatch || null,
        lod: root.userData?.golfCartRig?.lod ?? null,
      });
    }
    return {
      rootCount: cartRoots.length,
      rootNames: cartRoots.map((root) => root.name),
      meshes,
      triangles: Math.round(triangles),
      visibleMeshes,
      visibleTriangles: Math.round(visibleTriangles),
      visibleShadowMeshes,
      uniqueGeometries: uniqueGeometries.size,
      uniqueMaterials: uniqueMaterials.size,
      roots,
    };
  });
}

async function sample(page, label) {
  return page.evaluate(async ({ durationMs, sampleLabel }) => {
    const scene3d = window.__fw.scene3d;
    const renderer = scene3d.renderer;
    const frameDeltas = [];
    let uiMutationCallbacks = 0;
    const observer = new MutationObserver(() => { uiMutationCallbacks++; });
    observer.observe(document.querySelector('#ui') || document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    await new Promise((resolve) => {
      let started = 0;
      let previous = 0;
      const frame = (time) => {
        if (!started) {
          started = time;
          previous = time;
          requestAnimationFrame(frame);
          return;
        }
        frameDeltas.push(time - previous);
        previous = time;
        if (time - started >= durationMs) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    observer.disconnect();

    const sorted = [...frameDeltas].sort((a, b) => b - a);
    const slowCount = Math.max(1, Math.ceil(sorted.length * 0.01));
    const averageMs = frameDeltas.reduce((sum, value) => sum + value, 0) / Math.max(1, frameDeltas.length);
    const slowMean = sorted.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;

    const previousAutoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
    const rendered = await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      drawCalls: renderer.info.render.calls,
      renderedTriangles: renderer.info.render.triangles,
    }))));
    renderer.info.autoReset = previousAutoReset;

    const materials = new Map();
    const textures = new Map();
    let sceneTriangles = 0;
    let visibleMeshes = 0;
    scene3d.scene.traverse((object) => {
      if (!object.isMesh || !object.visible) return;
      visibleMeshes++;
      const geometry = object.geometry;
      const count = geometry?.index
        ? geometry.index.count / 3
        : (geometry?.attributes?.position?.count || 0) / 3;
      sceneTriangles += count * (object.isInstancedMesh ? object.count : 1);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.set(material.uuid, material);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
          if (material[key]) textures.set(material[key].uuid, material[key]);
        }
      }
    });
    let estimatedTextureMemoryBytes = 0;
    for (const texture of textures.values()) {
      const image = texture?.image;
      const width = Number(image?.width || image?.videoWidth || 0);
      const height = Number(image?.height || image?.videoHeight || 0);
      estimatedTextureMemoryBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
    }
    return {
      label: sampleLabel,
      durationMs,
      samples: frameDeltas.length,
      validFrameSample: frameDeltas.length >= 30,
      averageFps: 1000 / averageMs,
      onePercentLowFps: 1000 / slowMean,
      worstFrameMs: sorted[0] || 0,
      ...rendered,
      sceneTriangles: Math.round(sceneTriangles),
      visibleMeshes,
      materials: materials.size,
      textures: textures.size,
      estimatedTextureMemoryBytes: Math.round(estimatedTextureMemoryBytes),
      rendererTextures: renderer.info.memory.textures,
      rendererGeometries: renderer.info.memory.geometries,
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      activeListeners: window.__qaListeners?.().active ?? null,
      listenerRegistrations: window.__qaListeners?.().registrations ?? null,
      uiMutationCallbacks,
      uiMutationCallbacksPerSecond: uiMutationCallbacks / (durationMs / 1000),
    };
  }, { durationMs: SAMPLE_MS, sampleLabel: label });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function summarize(samples) {
  const valid = samples.filter((entry) => entry.validFrameSample);
  const source = valid.length ? valid : samples;
  const pick = (key) => median(source.map((entry) => entry[key]).filter(Number.isFinite));
  return {
    validRuns: valid.length,
    totalRuns: samples.length,
    statisticallyUsable: valid.length >= 2,
    medianAverageFps: round(pick('averageFps'), 2),
    medianOnePercentLowFps: round(pick('onePercentLowFps'), 2),
    medianWorstFrameMs: round(pick('worstFrameMs'), 2),
    medianDrawCalls: pick('drawCalls'),
    medianRenderedTriangles: pick('renderedTriangles'),
    medianSceneTriangles: pick('sceneTriangles'),
    medianMaterials: pick('materials'),
    medianTextures: pick('textures'),
    medianEstimatedTextureMemoryBytes: pick('estimatedTextureMemoryBytes'),
    medianHeapBytes: pick('jsHeapBytes'),
    medianActiveListeners: pick('activeListeners'),
    medianUiMutationCallbacksPerSecond: round(pick('uiMutationCallbacksPerSecond'), 2),
  };
}

function pairedDelta(visible, hidden) {
  const delta = (key) => Number.isFinite(visible[key]) && Number.isFinite(hidden[key])
    ? round(visible[key] - hidden[key], 2)
    : null;
  const percent = (key) => Number.isFinite(visible[key]) && Number.isFinite(hidden[key]) && hidden[key] !== 0
    ? round(((visible[key] - hidden[key]) / hidden[key]) * 100, 2)
    : null;
  return {
    averageFps: delta('medianAverageFps'),
    averageFpsPercent: percent('medianAverageFps'),
    onePercentLowFps: delta('medianOnePercentLowFps'),
    onePercentLowFpsPercent: percent('medianOnePercentLowFps'),
    worstFrameMs: delta('medianWorstFrameMs'),
    worstFrameMsPercent: percent('medianWorstFrameMs'),
    drawCalls: delta('medianDrawCalls'),
    renderedTriangles: delta('medianRenderedTriangles'),
    heapBytes: delta('medianHeapBytes'),
  };
}

async function setCartVisibility(page, visible) {
  await page.evaluate((nextVisible) => {
    const group = window.__fw?.scene3d?.scene?.getObjectByName('LiveGolfCarts');
    if (!group) throw new Error('LiveGolfCarts root is unavailable for visibility sampling.');
    group.visible = nextVisible;
  }, visible);
  await page.waitForTimeout(450);
}

async function main() {
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const httpErrors = [];
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--enable-precise-memory-info',
      '--enable-gpu',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--force-color-profile=srgb',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: path.join(OUT, 'video'), size: VIEWPORT },
  });
  await context.addInitScript(() => {
    let randomState = 0x5f3759df;
    Math.random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };
    let active = 0;
    let registrations = 0;
    const registry = new WeakMap();
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const captureOf = (options) => typeof options === 'boolean' ? options : !!options?.capture;
    EventTarget.prototype.addEventListener = function patchedAdd(type, listener, options) {
      if (listener) {
        let types = registry.get(this);
        if (!types) { types = new Map(); registry.set(this, types); }
        let entries = types.get(type);
        if (!entries) { entries = []; types.set(type, entries); }
        const capture = captureOf(options);
        if (!entries.some((entry) => entry.listener === listener && entry.capture === capture)) {
          entries.push({ listener, capture });
          active++;
          registrations++;
        }
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function patchedRemove(type, listener, options) {
      const entries = registry.get(this)?.get(type);
      const capture = captureOf(options);
      const index = entries?.findIndex((entry) => entry.listener === listener && entry.capture === capture) ?? -1;
      if (index >= 0) { entries.splice(index, 1); active--; }
      return originalRemove.call(this, type, listener, options);
    };
    window.__qaListeners = () => ({ active, registrations });
  });

  const page = await context.newPage();
  page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text().slice(0, 900) }));
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'failed',
  }));
  page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() });
  });

  let result;
  try {
    await startNewProperty(page);
    const fixture = await installFixture(page);
    await waitForFiveCarts(page);
    if (HIDE_CARTS && !PAIRED_VISIBILITY) {
      await page.evaluate(() => {
        const group = window.__fw?.scene3d?.scene?.getObjectByName('LiveGolfCarts');
        if (!group) throw new Error('LiveGolfCarts root is unavailable for the hidden-render control.');
        group.visible = false;
      });
    }
    await page.waitForTimeout(WARMUP_MS);
    await clearPresentationClutter(page);

    const cameras = {};
    const cameraNames = ['frontThreeQuarter', 'sideProfile', 'elevatedFleet'];
    if (CAPTURE_LOD) cameraNames.push('mediumLodFront');
    for (const cameraName of cameraNames) {
      cameras[cameraName] = await placeCamera(page, fixture, cameraName);
      await page.waitForTimeout(700);
      await page.screenshot({
        path: path.join(OUT, `${LABEL}-${cameraName}.png`),
        animations: 'disabled',
      });
    }

    await placeCamera(page, fixture, 'frontThreeQuarter');
    await page.waitForTimeout(1000);
    const listenersBefore = await page.evaluate(() => window.__qaListeners());
    const samples = [];
    const visibilityOrder = [];
    if (PAIRED_VISIBILITY) {
      // V,H,H,V,V,H balances warm-up/thermal drift while providing three
      // samples of each state in one renderer and one deterministic scene.
      let visibleIndex = 0;
      let hiddenIndex = 0;
      for (let index = 0; index < SAMPLE_COUNT * 2; index++) {
        const visible = index % 4 === 0 || index % 4 === 3;
        visibilityOrder.push(visible ? 'visible' : 'hidden');
        await setCartVisibility(page, visible);
        if (visible) {
          visibleIndex++;
          samples.push(await sample(page, `service-fleet-visible-${visibleIndex}`));
        } else {
          hiddenIndex++;
          samples.push(await sample(page, `service-fleet-hidden-${hiddenIndex}`));
        }
      }
    } else {
      for (let index = 0; index < SAMPLE_COUNT; index++) {
        samples.push(await sample(page, `service-fleet-${index + 1}`));
      }
    }
    const listenersAfter = await page.evaluate(() => window.__qaListeners());
    const inventory = await sceneInventory(page);
    const visibleSamples = samples.filter((entry) => entry.label.includes('-visible-'));
    const hiddenSamples = samples.filter((entry) => entry.label.includes('-hidden-'));
    const visibleSummary = PAIRED_VISIBILITY ? summarize(visibleSamples) : null;
    const hiddenSummary = PAIRED_VISIBILITY ? summarize(hiddenSamples) : null;
    result = {
      capturedAt: new Date().toISOString(),
      label: LABEL,
      launch: {
        command: `QA_URL=${URL} QA_OUT=${OUT} node tools/qa/golf-carts-baseline.cjs`,
        url: URL,
        browser: await browser.version(),
        viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
        quality: 'repository defaults',
        warmupMs: WARMUP_MS,
        sampleCount: SAMPLE_COUNT,
        sampleDurationMs: SAMPLE_MS,
        cartRendering: PAIRED_VISIBILITY ? 'paired-visible-hidden' : HIDE_CARTS ? 'hidden-control' : 'visible',
      },
      normalControls: [
        'Main menu > New game',
        'New game dialog > Relaxed',
        'Marketplace > first Buy button',
      ],
      fixture,
      cameras,
      inventory,
      rawSamples: samples,
      summary: PAIRED_VISIBILITY ? visibleSummary : summarize(samples),
      pairedVisibility: PAIRED_VISIBILITY ? {
        order: visibilityOrder,
        visible: visibleSummary,
        hidden: hiddenSummary,
        visibleMinusHidden: pairedDelta(visibleSummary, hiddenSummary),
      } : null,
      listeners: {
        before: listenersBefore,
        after: listenersAfter,
        activeDelta: listenersAfter.active - listenersBefore.active,
        registrationDelta: listenersAfter.registrations - listenersBefore.registrations,
      },
      consoleMessages,
      pageErrors,
      failedRequests,
      httpErrors,
    };
    fs.writeFileSync(path.join(OUT, `${LABEL}.json`), `${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await context.close();
    await browser.close();
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

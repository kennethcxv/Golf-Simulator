import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE_URL = 'http://localhost:8457/';
const ITEMS = Object.freeze(['tees1', 'marker1', 'glove1']);
const OUT = path.resolve(process.env.CARD_SPIKE_OUT || 'qa/steam-performance-master-pass/card-spike-probe');
const STEADY_SEGMENTS = Number(process.env.CARD_SPIKE_STEADY_SEGMENTS || 8);
const A_B_SEGMENTS = Number(process.env.CARD_SPIKE_AB_SEGMENTS || 4);
const SEGMENT_MS = Number(process.env.CARD_SPIKE_SEGMENT_MS || 5000);
const REPRESENTATION_CYCLES = Number(process.env.CARD_SPIKE_REPRESENTATIONS || 8);
const INSERTION_CYCLES = Number(process.env.CARD_SPIKE_INSERTIONS || 8);

function sourceFingerprint(relativePath) {
  const absolutePath = path.resolve(relativePath);
  const bytes = fs.readFileSync(absolutePath);
  return {
    path: relativePath.replace(/\\/g, '/'),
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function round(value, places = 3) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(places));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function summarize(values) {
  if (!values.length) return {
    count: 0, avg: null, median: null, p95: null, p99: null, max: null,
  };
  return {
    count: values.length,
    avg: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    median: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    p99: round(percentile(values, 0.99)),
    max: round(Math.max(...values)),
  };
}

function metricMap(metrics) {
  return Object.fromEntries((metrics?.metrics || []).map((metric) => [metric.name, metric.value]));
}

function metricDelta(before, after, name, scale = 1) {
  const a = before[name];
  const b = after[name];
  return a == null || b == null ? null : round((b - a) * scale, 4);
}

function summarizeWindow(window) {
  const frames = window.frames || [];
  const intervals = frames.map((frame) => frame.intervalMs).filter(Number.isFinite);
  const longFrames = frames.filter((frame) => frame.intervalMs > 50);
  const over100 = frames.filter((frame) => frame.intervalMs > 100);
  const baked = frames.filter((frame) => frame.causeRender?.scheduledShadowBake)
    .map((frame) => frame.intervalMs);
  const plain = frames.filter((frame) => frame.causeRender && !frame.causeRender.scheduledShadowBake)
    .map((frame) => frame.intervalMs);
  const renders = window.renders || [];
  const gpu = renders.map((record) => record.gpuMs).filter(Number.isFinite);
  const composerCpu = renders.map((record) => record.composerCpuMs).filter(Number.isFinite);
  const shadowCpu = renders.filter((record) => record.scheduledShadowBake)
    .map((record) => record.shadowCpuMs).filter(Number.isFinite);
  const heapDrops = [];
  for (let index = 1; index < frames.length; index++) {
    const before = frames[index - 1].heapBytes;
    const after = frames[index].heapBytes;
    if (Number.isFinite(before) && Number.isFinite(after) && before - after >= 262144) {
      heapDrops.push({
        atMs: round(frames[index].atMs),
        droppedMiB: round((before - after) / 1048576),
        intervalMs: round(frames[index].intervalMs),
      });
    }
  }
  return {
    label: window.label,
    durationMs: round(window.durationMs, 1),
    observedSettings: renders[0]?.settings || null,
    frameIntervalsMs: summarize(intervals),
    averageFps: intervals.length && intervals.reduce((a, b) => a + b, 0) > 0
      ? round(intervals.length * 1000 / intervals.reduce((a, b) => a + b, 0))
      : null,
    framesOver33Ms: intervals.filter((value) => value > 33.333).length,
    framesOver50Ms: longFrames.length,
    framesOver100Ms: over100.length,
    bakeAttributedIntervalsMs: summarize(baked),
    nonBakeAttributedIntervalsMs: summarize(plain),
    composerCpuMs: summarize(composerCpu),
    wholeComposerGpuMs: summarize(gpu),
    scheduledBakeShadowCpuMs: summarize(shadowCpu),
    callbackLagMs: summarize(frames.map((frame) => frame.callbackLagMs).filter(Number.isFinite)),
    longFrames: longFrames.map((frame) => ({
      atMs: round(frame.atMs),
      intervalMs: round(frame.intervalMs),
      callbackLagMs: round(frame.callbackLagMs),
      heapMiB: Number.isFinite(frame.heapBytes) ? round(frame.heapBytes / 1048576) : null,
      causeRender: frame.causeRender || null,
      currentRender: frame.currentRender || null,
    })),
    heapDrops,
    longTasks: window.longTasks || [],
    longAnimationFrames: window.longAnimationFrames || [],
    gcEntries: window.gcEntries || [],
    webglCalls: window.webglCalls || [],
    gpuQualification: window.gpuQualification,
  };
}

export async function boot(page) {
  await page.goto(BASE_URL);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(900);
  const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(900);
}

export async function configureFixture(page) {
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
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 + clubhouse.interior.position.x;
    walk.z = 5.35 + clubhouse.interior.position.z;
    walk.yaw = 0;
    walk.pitch = -0.18;
    return {
      description: 'Willow Creek, paused 2 PM/clear, fixed register camera, deterministic three-item card customer',
      walk: { x: walk.x, z: walk.z, yaw: walk.yaw, pitch: walk.pitch },
    };
  }, ITEMS);
}

export async function waitForCameraStable(page, timeout = 12000) {
  await page.evaluate(() => { window.__cardSpikeCamera = null; });
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
    const old = window.__cardSpikeCamera;
    if (!old) {
      window.__cardSpikeCamera = { ...now, stable: 0 };
      return false;
    }
    const movement = Math.hypot(
      now.x - old.x, now.y - old.y, now.z - old.z,
      now.qx - old.qx, now.qy - old.qy, now.qz - old.qz, now.qw - old.qw,
      (now.fov - old.fov) / 100,
    );
    const stable = movement < 0.0002 ? old.stable + 1 : 0;
    window.__cardSpikeCamera = { ...now, stable };
    return stable >= 8;
  }, null, { timeout, polling: 'raf' });
}

export async function enterFrontDesk(page) {
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });
  const workspace = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.workspace());
  if (workspace !== 'monitor') await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.isActive() && register.workspace() === 'monitor';
  }, null, { timeout: 10000 });
  await waitForCameraStable(page);
}

export async function monitorClick(page, action) {
  await page.waitForFunction((id) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.monitorScreenPoint(id);
    return register.workspace() === 'monitor' && point?.inView;
  }, action, { timeout: 10000 });
  const point = await page.evaluate((id) => window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id), action);
  assert(point?.inView, `Monitor action ${action} is outside the production camera.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(180);
}

async function projectObject(page, predicate) {
  return page.evaluate(async (query) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((object) => {
      if (found || !object.visible || !object.userData) return;
      if (query.kind && object.userData.kind !== query.kind) return;
      if (query.uid && object.userData.uid !== query.uid) return;
      found = object;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = (bounds.isEmpty()
      ? found.getWorldPosition(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3())).project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, predicate);
}

export async function scanAll(page) {
  const itemIds = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid));
  for (const uid of itemIds) {
    let product = await projectObject(page, { kind: 'item', uid });
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(120);
      const next = await projectObject(page, { kind: 'item', uid });
      if (next && product && Math.abs(next.x - product.x) < 1.5 && Math.abs(next.y - product.y) < 1.5) {
        product = next;
        break;
      }
      product = next;
    }
    assert(product?.inView, `${uid} is outside the scanner production camera.`);
    await page.mouse.click(product.x, product.y);
    await page.waitForFunction((id) => {
      const item = window.__fw.scene3d.clubhouse().register.getTx()?.items.find((entry) => entry.uid === id);
      return !!item?.scanned;
    }, uid, { timeout: 5000 });
    await page.waitForFunction((id) => {
      const item = window.__fw.scene3d.clubhouse().register.getTx()?.items.find((entry) => entry.uid === id);
      return !!item?.staged;
    }, uid, { timeout: 8000 });
    await page.waitForTimeout(180);
  }
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.workspace() === 'monitor' && register.getTx()?.items.every((item) => item.scanned && item.staged);
  }, null, { timeout: 7000 });
}

async function installProbe(page) {
  return page.evaluate(() => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const composer = app.scene3d.post.composer;
    const shadowMap = renderer.shadowMap;
    const gl = renderer.getContext();
    const timerExt = gl instanceof WebGL2RenderingContext
      ? gl.getExtension('EXT_disjoint_timer_query_webgl2')
      : null;
    const originalComposerRender = composer.render.bind(composer);
    const originalShadowRender = shadowMap.render.bind(shadowMap);
    const renders = [];
    const frames = [];
    const longTasks = [];
    const longAnimationFrames = [];
    const gcEntries = [];
    const webglCalls = [];
    const pendingQueries = [];
    let measuring = false;
    let nextRenderId = 1;
    let currentShadowCpuMs = 0;
    let currentShadowCalls = 0;
    let lastRafTimestamp = null;
    let lastObservedRenderId = null;
    let activeWindow = null;

    // These are the only WebGL calls that can establish lazy shader/texture work
    // during the physical insertion transition. Timing them is intentionally
    // narrower than wrapping draws, so the attribution probe does not perturb
    // ordinary per-frame submission.
    const watchedWebglCalls = [
      'shaderSource', 'compileShader', 'linkProgram',
      'getShaderParameter', 'getProgramParameter', 'getShaderInfoLog', 'getProgramInfoLog',
      'texImage2D', 'texSubImage2D', 'compressedTexImage2D', 'compressedTexSubImage2D',
      'generateMipmap', 'readPixels', 'finish', 'flush', 'clientWaitSync',
    ];
    for (const name of watchedWebglCalls) {
      const original = gl[name];
      if (typeof original !== 'function') continue;
      try {
        gl[name] = function cardSpikeWebglCall() {
          const started = performance.now();
          try {
            return original.apply(this, arguments);
          } finally {
            if (measuring) {
              webglCalls.push({
                name,
                atMs: Number(started.toFixed(3)),
                durationMs: Number((performance.now() - started).toFixed(3)),
              });
            }
          }
        };
      } catch (_) {
        // Some browser builds expose non-writable native methods. Renderer
        // program/resource boundaries still provide the fallback attribution.
      }
    }

    const compactScript = (script) => ({
      duration: Number((script.duration || 0).toFixed(3)),
      invoker: script.invoker || null,
      sourceURL: script.sourceURL || null,
      sourceFunctionName: script.sourceFunctionName || null,
    });
    const observers = [];
    const observe = (type, sink, mapper) => {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) sink.push(mapper(entry));
      });
      observer.observe({ type, buffered: true });
      observers.push(observer);
    };
    observe('longtask', longTasks, (entry) => ({
      startTime: Number(entry.startTime.toFixed(3)),
      duration: Number(entry.duration.toFixed(3)),
      name: entry.name,
    }));
    observe('long-animation-frame', longAnimationFrames, (entry) => ({
      startTime: Number(entry.startTime.toFixed(3)),
      duration: Number(entry.duration.toFixed(3)),
      blockingDuration: Number((entry.blockingDuration || 0).toFixed(3)),
      renderStart: Number((entry.renderStart || 0).toFixed(3)),
      styleAndLayoutStart: Number((entry.styleAndLayoutStart || 0).toFixed(3)),
      scripts: [...(entry.scripts || [])].slice(0, 12).map(compactScript),
    }));
    observe('gc', gcEntries, (entry) => ({
      startTime: Number(entry.startTime.toFixed(3)),
      duration: Number(entry.duration.toFixed(3)),
      kind: entry.kind ?? null,
    }));

    function pollQueries() {
      if (!timerExt) return;
      const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
      for (let index = pendingQueries.length - 1; index >= 0; index -= 1) {
        const pending = pendingQueries[index];
        const available = gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE);
        if (!available && !disjoint) continue;
        if (available && !disjoint) {
          pending.record.gpuMs = gl.getQueryParameter(pending.query, gl.QUERY_RESULT) / 1e6;
        } else {
          pending.record.gpuDisjoint = true;
        }
        gl.deleteQuery(pending.query);
        pendingQueries.splice(index, 1);
      }
    }

    shadowMap.render = function cardSpikeShadowRender() {
      const started = performance.now();
      try {
        return originalShadowRender(...arguments);
      } finally {
        if (measuring) {
          currentShadowCpuMs += performance.now() - started;
          currentShadowCalls++;
        }
      }
    };

    composer.render = function cardSpikeComposerRender() {
      pollQueries();
      if (!measuring) return originalComposerRender(...arguments);
      const statsBefore = app.scene3d.post.stats?.() || {};
      const record = {
        id: nextRenderId++,
        atMs: performance.now(),
        shadowBakes: statsBefore.shadowBakes ?? null,
        scheduledShadowBake: false,
        shadowCpuMs: 0,
        shadowCalls: 0,
        composerCpuMs: 0,
        gpuMs: null,
        settings: {
          sunCastShadow: !!app.scene3d.post.sun.castShadow,
          shadowMapEnabled: !!renderer.shadowMap.enabled,
          gtaoEnabled: !!app.scene3d.post.gtao.enabled,
          bloomEnabled: !!app.scene3d.post.bloom.enabled,
        },
        rendererProgramsBefore: renderer.info.programs?.length ?? null,
        rendererMemoryBefore: { ...renderer.info.memory },
      };
      const previous = renders[renders.length - 1];
      record.scheduledShadowBake = previous
        ? Number.isFinite(record.shadowBakes) && record.shadowBakes > previous.shadowBakes
        : false;
      currentShadowCpuMs = 0;
      currentShadowCalls = 0;
      let query = null;
      if (timerExt) {
        query = gl.createQuery();
        gl.beginQuery(timerExt.TIME_ELAPSED_EXT, query);
      }
      const started = performance.now();
      try {
        return originalComposerRender(...arguments);
      } finally {
        record.composerCpuMs = performance.now() - started;
        record.shadowCpuMs = currentShadowCpuMs;
        record.shadowCalls = currentShadowCalls;
        record.rendererProgramsAfter = renderer.info.programs?.length ?? null;
        record.rendererMemoryAfter = { ...renderer.info.memory };
        if (timerExt && query) {
          gl.endQuery(timerExt.TIME_ELAPSED_EXT);
          pendingQueries.push({ query, record });
        }
        renders.push(record);
      }
    };

    function onFrame(timestamp) {
      const callbackAt = performance.now();
      const currentRender = renders[renders.length - 1] || null;
      if (measuring && lastRafTimestamp != null) {
        frames.push({
          atMs: callbackAt,
          rafTimestamp: timestamp,
          intervalMs: timestamp - lastRafTimestamp,
          callbackLagMs: callbackAt - timestamp,
          heapBytes: performance.memory?.usedJSHeapSize ?? null,
          causeRenderId: lastObservedRenderId,
          currentRenderId: currentRender?.id ?? null,
        });
      }
      lastRafTimestamp = timestamp;
      lastObservedRenderId = currentRender?.id ?? null;
      requestAnimationFrame(onFrame);
    }
    requestAnimationFrame(onFrame);

    window.__checkoutCardSpikeProbe = {
      supportedEntryTypes: [...PerformanceObserver.supportedEntryTypes],
      gpuQualification: timerExt
        ? 'EXT_disjoint_timer_query_webgl2 whole-composer elapsed GPU time; shadow CPU wrapper is submission time, not GPU time.'
        : 'EXT_disjoint_timer_query_webgl2 unavailable; GPU time is unmeasured.',
      original: {
        sunCastShadow: !!app.scene3d.post.sun.castShadow,
        gtaoEnabled: !!app.scene3d.post.gtao.enabled,
        bloomEnabled: !!app.scene3d.post.bloom.enabled,
      },
      setVariant(variant) {
        app.scene3d.post.sun.castShadow = variant.shadows !== false;
        app.scene3d.post.gtao.enabled = variant.gtao !== false;
        app.scene3d.post.bloom.enabled = variant.bloom !== false;
        renderer.shadowMap.needsUpdate = true;
      },
      restore() {
        app.scene3d.post.sun.castShadow = this.original.sunCastShadow;
        app.scene3d.post.gtao.enabled = this.original.gtaoEnabled;
        app.scene3d.post.bloom.enabled = this.original.bloomEnabled;
        renderer.shadowMap.needsUpdate = true;
      },
      start(label) {
        if (measuring) throw new Error('A card-spike measurement window is already active.');
        measuring = true;
        lastRafTimestamp = null;
        lastObservedRenderId = renders[renders.length - 1]?.id ?? null;
        activeWindow = {
          label,
          startMs: performance.now(),
          frameIndex: frames.length,
          renderIndex: renders.length,
          longTaskIndex: longTasks.length,
          loafIndex: longAnimationFrames.length,
          gcIndex: gcEntries.length,
          webglCallIndex: webglCalls.length,
        };
      },
      stop() {
        measuring = false;
        if (!activeWindow) throw new Error('No card-spike measurement window is active.');
        activeWindow.endMs = performance.now();
      },
      collect() {
        pollQueries();
        if (!activeWindow?.endMs) throw new Error('Stop the card-spike measurement before collecting it.');
        const byId = new Map(renders.map((record) => [record.id, record]));
        const compactRender = (record) => record ? {
          id: record.id,
          atMs: Number(record.atMs.toFixed(3)),
          scheduledShadowBake: record.scheduledShadowBake,
          shadowBakes: record.shadowBakes,
          shadowCpuMs: Number(record.shadowCpuMs.toFixed(3)),
          shadowCalls: record.shadowCalls,
          composerCpuMs: Number(record.composerCpuMs.toFixed(3)),
          gpuMs: Number.isFinite(record.gpuMs) ? Number(record.gpuMs.toFixed(3)) : null,
          gpuDisjoint: !!record.gpuDisjoint,
          settings: record.settings,
          rendererProgramsBefore: record.rendererProgramsBefore,
          rendererProgramsAfter: record.rendererProgramsAfter,
          rendererMemoryBefore: record.rendererMemoryBefore,
          rendererMemoryAfter: record.rendererMemoryAfter,
        } : null;
        const result = {
          label: activeWindow.label,
          startMs: activeWindow.startMs,
          endMs: activeWindow.endMs,
          durationMs: activeWindow.endMs - activeWindow.startMs,
          frames: frames.slice(activeWindow.frameIndex).map((frame) => ({
            atMs: frame.atMs,
            intervalMs: frame.intervalMs,
            callbackLagMs: frame.callbackLagMs,
            heapBytes: frame.heapBytes,
            causeRender: compactRender(byId.get(frame.causeRenderId)),
            currentRender: compactRender(byId.get(frame.currentRenderId)),
          })),
          renders: renders.slice(activeWindow.renderIndex).map(compactRender),
          longTasks: longTasks.slice(activeWindow.longTaskIndex)
            .filter((entry) => entry.startTime >= activeWindow.startMs && entry.startTime <= activeWindow.endMs),
          longAnimationFrames: longAnimationFrames.slice(activeWindow.loafIndex)
            .filter((entry) => entry.startTime >= activeWindow.startMs && entry.startTime <= activeWindow.endMs),
          gcEntries: gcEntries.slice(activeWindow.gcIndex)
            .filter((entry) => entry.startTime >= activeWindow.startMs && entry.startTime <= activeWindow.endMs),
          webglCalls: webglCalls.slice(activeWindow.webglCallIndex)
            .filter((entry) => entry.atMs >= activeWindow.startMs && entry.atMs <= activeWindow.endMs),
          gpuQualification: this.gpuQualification,
          pendingGpuQueries: pendingQueries.length,
        };
        activeWindow = null;
        return result;
      },
    };
    return {
      gpuQualification: window.__checkoutCardSpikeProbe.gpuQualification,
      supportedEntryTypes: window.__checkoutCardSpikeProbe.supportedEntryTypes,
      rendererPrograms: renderer.info.programs?.length ?? null,
      rendererMemory: { ...renderer.info.memory },
    };
  });
}

async function resourceSnapshot(page, { detailed = false } = {}) {
  return page.evaluate((includeDetails) => {
    const renderer = window.__fw.scene3d.renderer;
    const register = window.__fw.scene3d.clubhouse().register;
    const snapshot = {
      atMs: performance.now(),
      rendererPrograms: renderer.info.programs?.length ?? null,
      rendererMemory: { ...renderer.info.memory },
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
      workspace: register.workspace(),
      stage: register.getTx()?.stage || null,
      checkoutTexturePrewarm: register.drawerPrewarmStatus?.() || null,
      cashGpuPrewarm: register.cashGpuPrewarmStatus?.() || null,
      shadowBakes: window.__fw.scene3d.post.stats?.().shadowBakes ?? null,
      monitorTextureVersion: register.screenMaterial?.map?.version ?? null,
      terminalTextureVersion: register.termMaterial?.map?.version ?? null,
    };
    if (!includeDetails) return snapshot;

    const textures = new Map();
    const itemGeometries = new Map();
    const registerRoot = window.__fw.scene3d.scene
      .getObjectByName('SimplifiedFrontDeskRegister');
    if (!registerRoot) throw new Error('SimplifiedFrontDeskRegister scene root is unavailable.');
    const textureKeys = [
      'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
      'emissiveMap', 'alphaMap', 'lightMap', 'envMap',
    ];
    registerRoot.traverse((object) => {
      let itemRoot = null;
      for (let parent = object; parent && parent !== registerRoot; parent = parent.parent) {
        if (parent.userData?.kind === 'item' || parent.name?.startsWith('CheckoutProduct_')) {
          itemRoot = parent;
        }
      }
      if (itemRoot && object.geometry && !itemGeometries.has(object.geometry.uuid)) {
        itemGeometries.set(object.geometry.uuid, {
          uuid: object.geometry.uuid,
          geometryName: object.geometry.name || null,
          objectName: object.name || null,
          itemName: itemRoot.name || null,
        });
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const key of textureKeys) {
          const texture = material[key];
          if (!texture) continue;
          if (!textures.has(texture.uuid)) {
            const image = texture.image || texture.source?.data;
            const properties = renderer.properties.get(texture);
            textures.set(texture.uuid, {
              uuid: texture.uuid,
              name: texture.name || null,
              width: image?.videoWidth || image?.naturalWidth || image?.width || null,
              height: image?.videoHeight || image?.naturalHeight || image?.height || null,
              version: texture.version,
              resident: !!properties.__webglTexture,
              materialNames: [],
              objectNames: [],
              itemNames: [],
              mapKeys: [],
            });
          }
          const entry = textures.get(texture.uuid);
          if (material.name && !entry.materialNames.includes(material.name)) entry.materialNames.push(material.name);
          if (object.name && !entry.objectNames.includes(object.name)) entry.objectNames.push(object.name);
          if (itemRoot?.name && !entry.itemNames.includes(itemRoot.name)) entry.itemNames.push(itemRoot.name);
          if (!entry.mapKeys.includes(key)) entry.mapKeys.push(key);
        }
      }
    });
    snapshot.textureResidency = [...textures.values()];
    snapshot.itemGeometries = [...itemGeometries.values()];
    return snapshot;
  }, detailed);
}

async function collectWindow(page, cdp, label, action) {
  const beforeRaw = await cdp.send('Performance.getMetrics');
  const before = metricMap(beforeRaw);
  await page.evaluate((name) => window.__checkoutCardSpikeProbe.start(name), label);
  await action();
  await page.evaluate(() => window.__checkoutCardSpikeProbe.stop());
  await page.evaluate(() => new Promise((resolve) => {
    let remaining = 12;
    const poll = () => {
      if (--remaining <= 0) resolve();
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }));
  const raw = await page.evaluate(() => window.__checkoutCardSpikeProbe.collect());
  const after = metricMap(await cdp.send('Performance.getMetrics'));
  return {
    ...raw,
    cdpDelta: {
      source: 'Chrome DevTools Protocol Performance.getMetrics cumulative deltas over the window',
      taskMs: metricDelta(before, after, 'TaskDuration', 1000),
      scriptMs: metricDelta(before, after, 'ScriptDuration', 1000),
      layoutMs: metricDelta(before, after, 'LayoutDuration', 1000),
      styleMs: metricDelta(before, after, 'RecalcStyleDuration', 1000),
      layoutCount: metricDelta(before, after, 'LayoutCount'),
      styleCount: metricDelta(before, after, 'RecalcStyleCount'),
      heapMiB: after.JSHeapUsedSize == null || before.JSHeapUsedSize == null
        ? null
        : round((after.JSHeapUsedSize - before.JSHeapUsedSize) / 1048576),
    },
  };
}

async function setVariant(page, variant) {
  await page.evaluate((value) => window.__checkoutCardSpikeProbe.setVariant(value), variant);
  // Toggling castShadow can change program variants. This warm-up keeps those
  // compile/upload costs out of the steady A/B window by design.
  await page.waitForTimeout(2500);
}

async function fixedSegments(page, cdp, label, count) {
  const windows = [];
  for (let index = 1; index <= count; index++) {
    windows.push(await collectWindow(page, cdp, `${label}-${index}`, () => page.waitForTimeout(SEGMENT_MS)));
  }
  return windows;
}

async function cardRepresentation(page, cdp, index) {
  const point = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.cardXScreenPoint());
  assert(point?.visible && point?.inView, `Card reader X is not visible/in view for re-presentation cycle ${index}.`);
  return collectWindow(page, cdp, `card-representation-${index}`, async () => {
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      return register.workspace() === 'card' && tx?.stage === 'card-ready';
    }, null, { timeout: 7000 });
    await waitForCameraStable(page);
    await page.waitForTimeout(1000);
  });
}

async function cardInsertion(page, cdp, index) {
  const point = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  assert(point?.inView, `Presented card is not in view for insertion cycle ${index}.`);
  return collectWindow(page, cdp, `card-insertion-${index}`, async () => {
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      return register.workspace() === 'card'
        && tx?.stage === 'card-entry'
        && tx.checkoutFlow?.state === 'CardAmountEntry';
    }, null, { timeout: 7000 });
    await waitForCameraStable(page);
    await page.waitForTimeout(500);
  });
}

async function rearmCardInsertion(page, index) {
  const point = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.cardXScreenPoint());
  assert(point?.visible && point?.inView, `Card reader X is not visible after insertion cycle ${index}.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.workspace() === 'monitor' && register.getTx()?.stage === 'scanning';
  }, null, { timeout: 7000 });
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    return register.workspace() === 'card'
      && tx?.stage === 'card-ready'
      && tx.checkoutFlow?.state === 'CardInsertReady';
  }, null, { timeout: 7000 });
  await waitForCameraStable(page);
  await page.waitForTimeout(250);
}

function aggregateGroup(windows) {
  const summaries = windows.map(summarizeWindow);
  const frames = windows.flatMap((window) => window.frames || []);
  const intervals = frames.map((frame) => frame.intervalMs).filter(Number.isFinite);
  const renders = windows.flatMap((window) => window.renders || []);
  return {
    windows: summaries,
    combined: {
      windowCount: windows.length,
      observedSettings: [...new Map(windows
        .flatMap((window) => window.renders || [])
        .map((record) => [JSON.stringify(record.settings), record.settings])).values()],
      durationMs: round(windows.reduce((sum, window) => sum + window.durationMs, 0), 1),
      frameIntervalsMs: summarize(intervals),
      averageFps: intervals.length
        ? round(intervals.length * 1000 / intervals.reduce((sum, value) => sum + value, 0))
        : null,
      framesOver33Ms: intervals.filter((value) => value > 33.333).length,
      framesOver50Ms: intervals.filter((value) => value > 50).length,
      framesOver100Ms: intervals.filter((value) => value > 100).length,
      scheduledBakeIntervalsMs: summarize(frames.filter((frame) => frame.causeRender?.scheduledShadowBake).map((frame) => frame.intervalMs)),
      nonBakeIntervalsMs: summarize(frames.filter((frame) => frame.causeRender && !frame.causeRender.scheduledShadowBake).map((frame) => frame.intervalMs)),
      composerCpuMs: summarize(renders.map((record) => record.composerCpuMs).filter(Number.isFinite)),
      wholeComposerGpuMs: summarize(renders.map((record) => record.gpuMs).filter(Number.isFinite)),
      cdpTaskMs: round(windows.reduce((sum, window) => sum + (window.cdpDelta?.taskMs || 0), 0)),
      cdpScriptMs: round(windows.reduce((sum, window) => sum + (window.cdpDelta?.scriptMs || 0), 0)),
      heapDrops: summaries.flatMap((summary) => summary.heapDrops),
      longTasks: summaries.flatMap((summary) => summary.longTasks),
      longAnimationFrames: summaries.flatMap((summary) => summary.longAnimationFrames),
      gcEntries: summaries.flatMap((summary) => summary.gcEntries),
      longFrames: summaries.flatMap((summary) => summary.longFrames),
    },
  };
}

function markdown(result) {
  const rows = Object.entries(result.groups).map(([name, group]) => {
    const c = group.combined;
    return `| ${name} | ${c.durationMs} | ${c.averageFps} | ${c.frameIntervalsMs.p99} | ${c.frameIntervalsMs.max} | ${c.framesOver50Ms} | ${c.framesOver100Ms} | ${c.scheduledBakeIntervalsMs.p99} | ${c.nonBakeIntervalsMs.p99} | ${c.composerCpuMs.p99} | ${c.wholeComposerGpuMs.p99} |`;
  }).join('\n');
  return `# Physical-card frame-spike probe

Generated: ${result.generatedAt}

The fixture reaches card-ready through normal E, monitor clicks, product clicks, and the automatic customer card choice. Re-presentation cycles use the physical reader X and wait for the customer to present the card again. Runtime A/B toggles are restored before exit and do not alter production files.

| Phase | measured ms | avg FPS | p99 frame ms | worst ms | >50 ms | >100 ms | bake p99 ms | non-bake p99 ms | composer CPU p99 ms | composer GPU p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}

GPU qualification: ${result.instrumentation.gpuQualification}

Per-window summaries, complete long-frame render records, CDP task deltas, long-task/long-animation-frame entries, heap-drop signals, renderer resource snapshots, and errors are in [checkout-card-spike-probe.json](./checkout-card-spike-probe.json).
`;
}

export async function runCheckoutCardSpikeProbe(page) {
  fs.mkdirSync(OUT, { recursive: true });
  const errors = { console: [], page: [], requestFailed: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text());
  });
  page.on('pageerror', (error) => errors.page.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => errors.requestFailed.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await boot(page);
  const fixture = await configureFixture(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  const environment = await page.evaluate(() => {
    const app = window.__fw;
    const gl = app.scene3d.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
      webglRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  environment.browserVersion = await page.context().browser().version();

  const instrumentation = await installProbe(page);
  const resources = { beforeCustomer: await resourceSnapshot(page) };
  const customer = await page.evaluate((skuIds) => window.__fw.scene3d.clubhouse().sendToCounter(skuIds, 'card'), ITEMS);
  assert(customer, 'Could not create deterministic card-spike customer.');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx()?.items.length === 3, null, { timeout: 15000 });
  await enterFrontDesk(page);
  resources.beforeOverview = await resourceSnapshot(page, { detailed: true });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  const overviewTransition = await collectWindow(page, cdp, 'overview-products-transition', async () => {
    await monitorClick(page, 'start-scanning');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.workspace() === 'scan', null, { timeout: 5000 });
    await waitForCameraStable(page);
    await page.waitForTimeout(500);
  });
  const overviewCpuProfile = await cdp.send('Profiler.stop');
  resources.afterOverview = await resourceSnapshot(page, { detailed: true });
  await scanAll(page);
  resources.beforeFirstCard = await resourceSnapshot(page);

  const firstCardTransition = await collectWindow(page, cdp, 'first-card-transition', async () => {
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      return register.workspace() === 'card' && register.getTx()?.stage === 'card-ready';
    }, null, { timeout: 7000 });
    await waitForCameraStable(page);
    await page.waitForTimeout(1500);
  });
  resources.afterFirstCard = await resourceSnapshot(page);
  await page.screenshot({ path: path.join(OUT, 'card-ready.png') });

  const representations = [];
  for (let cycle = 1; cycle <= REPRESENTATION_CYCLES; cycle++) {
    representations.push(await cardRepresentation(page, cdp, cycle));
  }

  let steady = [];
  let shadowOff = [];
  let postOff = [];
  let bothOff = [];
  if (STEADY_SEGMENTS > 0) {
    await setVariant(page, { shadows: true, gtao: true, bloom: true });
    steady = await fixedSegments(page, cdp, 'steady-all-on', STEADY_SEGMENTS);
  }
  if (A_B_SEGMENTS > 0) {
    await setVariant(page, { shadows: false, gtao: true, bloom: true });
    shadowOff = await fixedSegments(page, cdp, 'shadow-off', A_B_SEGMENTS);
    await setVariant(page, { shadows: true, gtao: false, bloom: false });
    postOff = await fixedSegments(page, cdp, 'gtao-bloom-off', A_B_SEGMENTS);
    await setVariant(page, { shadows: false, gtao: false, bloom: false });
    bothOff = await fixedSegments(page, cdp, 'shadow-gtao-bloom-off', A_B_SEGMENTS);
  }
  await page.evaluate(() => window.__checkoutCardSpikeProbe.restore());
  await page.waitForTimeout(750);

  resources.beforeInsertions = await resourceSnapshot(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  const insertions = [];
  for (let cycle = 1; cycle <= INSERTION_CYCLES; cycle++) {
    insertions.push(await cardInsertion(page, cdp, cycle));
    resources[`afterInsertion${cycle}`] = await resourceSnapshot(page);
    if (cycle < INSERTION_CYCLES) await rearmCardInsertion(page, cycle);
  }
  const insertionCpuProfile = await cdp.send('Profiler.stop');

  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    build: {
      mode: sourceFingerprint('src/render3d/clubhouse/simplifiedRegisterMode.js'),
      courseScene: sourceFingerprint('src/render3d/courseScene.js'),
      probe: sourceFingerprint('tools/qa/checkout-card-spike-probe.mjs'),
    },
    protocol: {
      baseUrl: BASE_URL,
      browserMode: process.env.HEADED === '1' ? 'headed' : 'headless',
      segmentMs: SEGMENT_MS,
      steadySegments: STEADY_SEGMENTS,
      abSegments: A_B_SEGMENTS,
      representationCycles: REPRESENTATION_CYCLES,
      insertionCycles: INSERTION_CYCLES,
      route: 'normal E + physical monitor/product/X clicks; no transaction-state injection',
      runtimeVariants: 'sun.castShadow and existing GTAO/bloom pass enabled flags; restored after measurements',
    },
    fixture,
    environment,
    instrumentation,
    resources,
    groups: {
      overviewProducts: aggregateGroup([overviewTransition]),
      firstCardTransition: aggregateGroup([firstCardTransition]),
      cardRepresentations: aggregateGroup(representations),
      steadyAllOn: aggregateGroup(steady),
      shadowOff: aggregateGroup(shadowOff),
      gtaoBloomOff: aggregateGroup(postOff),
      shadowGtaoBloomOff: aggregateGroup(bothOff),
      cardInsertions: aggregateGroup(insertions),
    },
    overviewCpuProfile,
    insertionCpuProfile,
    errors: {
      ...errors,
      nonBenignRequestFailures: errors.requestFailed.filter((entry) => !/ERR_ABORTED/.test(entry.error)),
    },
    limitations: [
      'One headed Chrome host is diagnostic evidence, not a multi-hardware benchmark.',
      'Whole-composer timer queries include the scene, scheduled shadows, AO, bloom, and output; A/B medians isolate costs statistically.',
      'The shadow wrapper records CPU submission time. GPU shadow cost is inferred from matched shadow-on/off whole-composer queries.',
      'performance.memory heap drops and optional PerformanceObserver gc entries are signals; absence does not prove that V8 performed no GC.',
    ],
  };
  fs.writeFileSync(path.join(OUT, 'checkout-card-spike-probe.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'README.md'), markdown(result));
  return {
    ok: true,
    out: OUT,
    raw: path.join(OUT, 'checkout-card-spike-probe.json'),
    report: path.join(OUT, 'README.md'),
    screenshot: path.join(OUT, 'card-ready.png'),
    summary: Object.fromEntries(Object.entries(result.groups).map(([name, group]) => [name, group.combined])),
    errors: result.errors,
  };
}

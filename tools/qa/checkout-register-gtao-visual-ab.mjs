import fs from 'node:fs';
import path from 'node:path';

import {
  boot,
  configureFixture,
  enterFrontDesk,
  monitorClick,
  scanAll,
  waitForCameraStable,
} from './checkout-card-spike-probe.mjs';

const ITEMS = Object.freeze(['tees1', 'marker1', 'glove1']);
const OUT = path.resolve(
  process.env.REGISTER_GTAO_VISUAL_AB_OUT
    || 'qa/steam-performance-master-pass/register-gtao-visual-ab',
);

export const REGISTER_GTAO_VISUAL_AB_SCHEMA_VERSION = 1;
export const REGISTER_GTAO_VISUAL_AB_VIEW_KEYS = Object.freeze([
  'activeMonitor',
  'scanner',
  'cardReady',
]);

const VIEW_WORKSPACES = Object.freeze({
  activeMonitor: 'monitor',
  scanner: 'scan',
  cardReady: 'card',
});

function assert(value, message) {
  if (!value) throw new Error(message);
}

function saveDataUrl(file, dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error(`Expected a PNG data URL for ${file}.`);
  fs.writeFileSync(file, Buffer.from(match[1], 'base64'));
}

function cameraVector(camera) {
  return [
    ...(camera?.position || []),
    ...(camera?.quaternion || []),
    camera?.fov,
  ].filter(Number.isFinite);
}

function maxCameraDrift(before, after) {
  const a = cameraVector(before);
  const b = cameraVector(after);
  if (a.length !== 8 || b.length !== 8) return null;
  return Math.max(...a.map((value, index) => Math.abs(value - b[index])));
}

async function lifecycleSnapshot(page, checkpoint) {
  return page.evaluate((name) => {
    const app = window.__fw;
    const register = app.scene3d.clubhouse().register;
    return {
      checkpoint: name,
      active: register.isActive(),
      workspace: register.workspace(),
      stage: register.getTx()?.stage || null,
      gtaoEnabled: app.scene3d.post.gtao.enabled,
    };
  }, checkpoint);
}

async function waitForRegisterState(page, expected, timeout = 7000) {
  await page.waitForFunction((wanted) => {
    const app = window.__fw;
    const register = app.scene3d.clubhouse().register;
    if (wanted.active !== undefined && register.isActive() !== wanted.active) return false;
    if (wanted.workspace !== undefined && register.workspace() !== wanted.workspace) return false;
    if (wanted.stage !== undefined && (register.getTx()?.stage || null) !== wanted.stage) return false;
    if (wanted.gtaoEnabled !== undefined && app.scene3d.post.gtao.enabled !== wanted.gtaoEnabled) return false;
    return true;
  }, expected, { timeout });
}

async function settleFrames(page, count = 4) {
  await page.evaluate((frameCount) => new Promise((resolve) => {
    let remaining = frameCount;
    const frame = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), count);
}

async function compareScreenshots(page, shots) {
  return page.evaluate(async ({ onPng, offBeforePng, offAfterPng }) => {
    const decode = (base64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        resolve({
          width: canvas.width,
          height: canvas.height,
          pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
          canvas,
          context,
        });
      };
      image.onerror = reject;
      image.src = `data:image/png;base64,${base64}`;
    });
    const [gtaoOn, offBefore, offAfter] = await Promise.all([
      decode(onPng),
      decode(offBeforePng),
      decode(offAfterPng),
    ]);
    const width = gtaoOn.width;
    const height = gtaoOn.height;
    const regions = {
      wholeFrame: [0, 0, width, height],
      upperScene: [0, 0, width, Math.round(height * 0.58)],
      registerCenter: [Math.round(width * 0.30), Math.round(height * 0.20), Math.round(width * 0.48), Math.round(height * 0.62)],
      counterLower: [Math.round(width * 0.18), Math.round(height * 0.58), Math.round(width * 0.78), Math.round(height * 0.42)],
      foregroundLeft: [0, Math.round(height * 0.48), Math.round(width * 0.40), Math.round(height * 0.52)],
    };
    const compare = (a, b, [x, y, w, h]) => {
      let sum = 0;
      let sumSq = 0;
      let max = 0;
      let changed = 0;
      let count = 0;
      const histogram = new Uint32Array(766);
      for (let py = y; py < Math.min(height, y + h); py += 1) {
        for (let px = x; px < Math.min(width, x + w); px += 1) {
          const index = (py * width + px) * 4;
          const dr = Math.abs(a[index] - b[index]);
          const dg = Math.abs(a[index + 1] - b[index + 1]);
          const db = Math.abs(a[index + 2] - b[index + 2]);
          const channelSum = dr + dg + db;
          const delta = channelSum / 3;
          sum += delta;
          sumSq += delta * delta;
          max = Math.max(max, dr, dg, db);
          if (delta >= 2) changed += 1;
          histogram[channelSum] += 1;
          count += 1;
        }
      }
      const p95Target = Math.max(1, Math.ceil(count * 0.95));
      let cumulative = 0;
      let p95ChannelSum = 0;
      for (; p95ChannelSum < histogram.length; p95ChannelSum += 1) {
        cumulative += histogram[p95ChannelSum];
        if (cumulative >= p95Target) break;
      }
      return {
        pixels: count,
        meanAbsoluteRgb: Number((sum / count).toFixed(4)),
        rmsRgb: Number(Math.sqrt(sumSq / count).toFixed(4)),
        p95AbsoluteRgb: Number((p95ChannelSum / 3).toFixed(4)),
        maxChannelDelta: max,
        changedAtLeast2Percent: Number((changed * 100 / count).toFixed(3)),
      };
    };
    const compareRegions = (a, b) => Object.fromEntries(
      Object.entries(regions).map(([name, box]) => [name, compare(a, b, box)]),
    );
    const diff = gtaoOn.context.createImageData(width, height);
    for (let index = 0; index < diff.data.length; index += 4) {
      diff.data[index] = Math.min(255, Math.abs(gtaoOn.pixels[index] - offAfter.pixels[index]) * 8);
      diff.data[index + 1] = Math.min(255, Math.abs(gtaoOn.pixels[index + 1] - offAfter.pixels[index + 1]) * 8);
      diff.data[index + 2] = Math.min(255, Math.abs(gtaoOn.pixels[index + 2] - offAfter.pixels[index + 2]) * 8);
      diff.data[index + 3] = 255;
    }
    gtaoOn.context.putImageData(diff, 0, 0);
    return {
      gtaoOnVsOffBefore: compareRegions(gtaoOn.pixels, offBefore.pixels),
      gtaoOnVsOffAfter: compareRegions(gtaoOn.pixels, offAfter.pixels),
      offControlMotion: compareRegions(offBefore.pixels, offAfter.pixels),
      amplifiedDiffPng: gtaoOn.canvas.toDataURL('image/png'),
    };
  }, {
    onPng: shots.on.toString('base64'),
    offBeforePng: shots.offBefore.toString('base64'),
    offAfterPng: shots.offAfter.toString('base64'),
  });
}

async function captureFixedView(page, key, expectedStage) {
  const workspace = VIEW_WORKSPACES[key];
  assert(workspace, `Unknown register GTAO A/B view: ${key}.`);
  await waitForRegisterState(page, {
    active: true,
    workspace,
    ...(expectedStage ? { stage: expectedStage } : {}),
    gtaoEnabled: false,
  });
  await waitForCameraStable(page);
  await page.waitForTimeout(300);

  // The normal game rAF and EffectComposer remain live. Only clubhouse.update
  // is held during this one view's off/on/off toggle so the player camera and
  // checkout presentation cannot advance between comparison frames.
  const captureState = await page.evaluate(({ viewKey, expectedWorkspace }) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const register = clubhouse.register;
    if (window.__registerGtaoVisualFreeze) throw new Error('A register GTAO visual freeze is already installed.');
    if (typeof clubhouse.update !== 'function') throw new Error('clubhouse.update is unavailable.');
    window.__registerGtaoVisualFreeze = {
      key: viewKey,
      update: clubhouse.update,
      originalEnabled: app.scene3d.post.gtao.enabled,
    };
    clubhouse.update = function registerGtaoVisualFrozenUpdate() {};
    return {
      key: viewKey,
      active: register.isActive(),
      workspace: register.workspace(),
      stage: register.getTx()?.stage || null,
      expectedWorkspace,
      originalEnabled: app.scene3d.post.gtao.enabled,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      camera: {
        position: app.scene3d.camera.position.toArray(),
        quaternion: app.scene3d.camera.quaternion.toArray(),
        fov: app.scene3d.camera.fov,
      },
      rendererMemory: { ...app.scene3d.renderer.info.memory },
    };
  }, { viewKey: key, expectedWorkspace: workspace });
  assert(captureState.active, `${key} capture requires an active register.`);
  assert(captureState.workspace === workspace, `${key} did not reach ${workspace}.`);
  assert(captureState.originalEnabled === false, `${key} must inherit the active-register GTAO bypass.`);

  const shots = {};
  const observedSequence = [];
  try {
    for (const variant of [
      { name: 'off-before', enabled: false, output: 'offBefore' },
      { name: 'on', enabled: true, output: 'on' },
      { name: 'off-after', enabled: false, output: 'offAfter' },
    ]) {
      await page.evaluate((enabled) => {
        window.__fw.scene3d.post.gtao.enabled = enabled;
      }, variant.enabled);
      await settleFrames(page);
      const observed = await page.evaluate(() => window.__fw.scene3d.post.gtao.enabled);
      assert(observed === variant.enabled, `${key} could not hold GTAO ${variant.name} through settled render frames.`);
      observedSequence.push({ name: variant.name, enabled: observed });
      shots[variant.output] = await page.screenshot({ type: 'png' });
    }
  } finally {
    await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const freeze = window.__registerGtaoVisualFreeze;
      if (freeze) app.scene3d.post.gtao.enabled = freeze.originalEnabled;
      if (freeze?.update) clubhouse.update = freeze.update;
      delete window.__registerGtaoVisualFreeze;
    });
  }

  await waitForRegisterState(page, { active: true, workspace, gtaoEnabled: false });
  const postCapture = await page.evaluate(() => {
    const app = window.__fw;
    const register = app.scene3d.clubhouse().register;
    return {
      active: register.isActive(),
      workspace: register.workspace(),
      gtaoEnabled: app.scene3d.post.gtao.enabled,
      camera: {
        position: app.scene3d.camera.position.toArray(),
        quaternion: app.scene3d.camera.quaternion.toArray(),
        fov: app.scene3d.camera.fov,
      },
    };
  });
  const cameraDrift = maxCameraDrift(captureState.camera, postCapture.camera);
  assert(cameraDrift != null && cameraDrift <= 0.001, `${key} camera drifted ${cameraDrift} during fixed-view capture.`);

  const prefix = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const files = {
    gtaoOffControl: `${prefix}-gtao-off-control.png`,
    gtaoOn: `${prefix}-gtao-on.png`,
    gtaoOff: `${prefix}-gtao-off.png`,
    amplifiedDiff: `${prefix}-gtao-diff-8x.png`,
  };
  fs.writeFileSync(path.join(OUT, files.gtaoOffControl), shots.offBefore);
  fs.writeFileSync(path.join(OUT, files.gtaoOn), shots.on);
  fs.writeFileSync(path.join(OUT, files.gtaoOff), shots.offAfter);
  const metrics = await compareScreenshots(page, shots);
  saveDataUrl(path.join(OUT, files.amplifiedDiff), metrics.amplifiedDiffPng);
  delete metrics.amplifiedDiffPng;

  return {
    ...captureState,
    gtaoSequence: observedSequence,
    restoredEnabled: postCapture.gtaoEnabled,
    cameraAfter: postCapture.camera,
    cameraDrift,
    metrics,
    files,
  };
}

async function leaveFrontDeskThroughControls(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
    if (!active) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(30);
  }
  await page.waitForFunction(
    () => !window.__fw.scene3d.clubhouse().register.isActive(),
    null,
    { timeout: 2500 },
  );
}

export function validateRegisterGtaoVisualAbResult(result) {
  const issues = [];
  if (result?.schemaVersion !== REGISTER_GTAO_VISUAL_AB_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${REGISTER_GTAO_VISUAL_AB_SCHEMA_VERSION}`);
  }
  if (result?.protocol?.normalControls !== true) issues.push('protocol.normalControls must be true');
  if (result?.protocol?.captureSequence !== 'off/on/off') issues.push('protocol.captureSequence must be off/on/off');
  if (!String(result?.protocol?.freezeScope || '').includes('clubhouse.update only')) {
    issues.push('protocol.freezeScope must document clubhouse.update only');
  }
  for (const key of REGISTER_GTAO_VISUAL_AB_VIEW_KEYS) {
    const view = result?.views?.[key];
    if (!view) {
      issues.push(`views.${key} is required`);
      continue;
    }
    if (view.workspace !== VIEW_WORKSPACES[key]) issues.push(`views.${key}.workspace must be ${VIEW_WORKSPACES[key]}`);
    if (view.originalEnabled !== false) issues.push(`views.${key}.originalEnabled must be false`);
    if (view.restoredEnabled !== false) issues.push(`views.${key}.restoredEnabled must be false`);
    if (view.cameraDrift == null || view.cameraDrift > 0.001) issues.push(`views.${key}.cameraDrift exceeds the fixed-camera tolerance`);
    const sequence = (view.gtaoSequence || []).map((entry) => `${entry.name}:${entry.enabled}`).join(',');
    if (sequence !== 'off-before:false,on:true,off-after:false') {
      issues.push(`views.${key}.gtaoSequence must be off/on/off`);
    }
    for (const fileKey of ['gtaoOffControl', 'gtaoOn', 'gtaoOff', 'amplifiedDiff']) {
      if (!view.files?.[fileKey]) issues.push(`views.${key}.files.${fileKey} is required`);
    }
    for (const metricKey of ['gtaoOnVsOffBefore', 'gtaoOnVsOffAfter', 'offControlMotion']) {
      if (!view.metrics?.[metricKey]?.wholeFrame) {
        issues.push(`views.${key}.metrics.${metricKey}.wholeFrame is required`);
      }
    }
  }
  const first = result?.lifecycle?.firstCycle;
  if (first?.priorEnabled !== true || first?.restoredEnabled !== true) {
    issues.push('lifecycle.firstCycle must restore prior true');
  }
  if (first?.leave?.active !== false || first?.leave?.gtaoEnabled !== true) {
    issues.push('lifecycle.firstCycle.leave must be inactive with GTAO true');
  }
  const activeTransitions = first?.activeTransitions || [];
  const expectedTransitions = ['monitor', 'scan', 'card', 'monitor'];
  if (activeTransitions.length !== expectedTransitions.length) {
    issues.push('lifecycle.firstCycle.activeTransitions must cover monitor/scan/card/monitor');
  }
  for (const [index, snapshot] of activeTransitions.entries()) {
    if (!snapshot.active || snapshot.gtaoEnabled !== false) {
      issues.push(`lifecycle.firstCycle transition ${snapshot.checkpoint || 'unknown'} must stay active with GTAO false`);
    }
    if (snapshot.workspace !== expectedTransitions[index]) {
      issues.push(`lifecycle.firstCycle transition ${snapshot.checkpoint || index} must use ${expectedTransitions[index]}`);
    }
  }
  const second = result?.lifecycle?.secondCycle;
  if (second?.priorEnabled !== false || second?.enteredEnabled !== false || second?.restoredEnabled !== false) {
    issues.push('lifecycle.secondCycle must preserve prior false through enter/leave');
  }
  if (second?.entry?.active !== true || second?.entry?.gtaoEnabled !== false) {
    issues.push('lifecycle.secondCycle.entry must be active with GTAO false');
  }
  if (second?.leave?.active !== false || second?.leave?.gtaoEnabled !== false) {
    issues.push('lifecycle.secondCycle.leave must be inactive with GTAO false');
  }
  for (const diagnosticKey of ['errors', 'pageErrors', 'nonBenignRequestFailures']) {
    const entries = result?.diagnostics?.[diagnosticKey];
    if (!Array.isArray(entries)) issues.push(`diagnostics.${diagnosticKey} is required`);
    else if (entries.length > 0) issues.push(`diagnostics.${diagnosticKey} must be empty`);
  }
  return { valid: issues.length === 0, issues };
}

export async function runCheckoutRegisterGtaoVisualAb(page) {
  fs.mkdirSync(OUT, { recursive: true });
  const diagnostics = { warnings: [], errors: [], pageErrors: [], requestFailed: [] };
  page.on('console', (message) => {
    if (message.type() === 'warning') diagnostics.warnings.push(message.text());
    if (message.type() === 'error') diagnostics.errors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => diagnostics.requestFailed.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await boot(page);
  const fixture = await configureFixture(page);
  const gtaoFixture = await page.evaluate(() => {
    const gtao = window.__fw.scene3d.post.gtao;
    const originalEnabled = gtao.enabled;
    gtao.enabled = true;
    return { originalEnabled, firstPriorEnabled: gtao.enabled };
  });
  assert(gtaoFixture.firstPriorEnabled === true, 'Could not establish the first-cycle GTAO-on prior setting.');

  const customer = await page.evaluate(
    (skuIds) => window.__fw.scene3d.clubhouse().sendToCounter(skuIds, 'card'),
    ITEMS,
  );
  assert(customer, 'Could not create the deterministic register GTAO visual customer.');
  await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().register.getTx()?.items.length === 3,
    null,
    { timeout: 15000 },
  );

  const beforeFirstEntry = await lifecycleSnapshot(page, 'before-first-entry-prior-true');
  assert(!beforeFirstEntry.active && beforeFirstEntry.gtaoEnabled === true, 'First entry must begin inactive with GTAO true.');
  await enterFrontDesk(page);
  await waitForRegisterState(page, { active: true, workspace: 'monitor', gtaoEnabled: false });
  const activeMonitor = await lifecycleSnapshot(page, 'active-monitor');
  const views = {
    activeMonitor: await captureFixedView(page, 'activeMonitor', 'scanning'),
  };

  await monitorClick(page, 'start-scanning');
  await waitForRegisterState(page, { active: true, workspace: 'scan', stage: 'scanning', gtaoEnabled: false });
  const scanner = await lifecycleSnapshot(page, 'scanner-transition');
  views.scanner = await captureFixedView(page, 'scanner', 'scanning');

  await scanAll(page);
  await waitForRegisterState(page, { active: true, workspace: 'card', stage: 'card-ready', gtaoEnabled: false });
  const cardReady = await lifecycleSnapshot(page, 'card-ready-transition');
  views.cardReady = await captureFixedView(page, 'cardReady', 'card-ready');

  // The physical reader X now changes workspace only. The active register must
  // continue owning the GTAO bypass until normal Escape controls actually leave.
  const cancel = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.cardXScreenPoint());
  assert(cancel?.visible && cancel?.inView, 'The physical reader X is not visible for transition QA.');
  await page.mouse.click(cancel.x, cancel.y);
  await waitForRegisterState(page, { active: true, workspace: 'monitor', stage: 'scanning', gtaoEnabled: false }, 2000);
  const cardToMonitor = await lifecycleSnapshot(page, 'card-to-monitor-still-active');
  await leaveFrontDeskThroughControls(page);
  await waitForRegisterState(page, { active: false, gtaoEnabled: true }, 2000);
  const firstLeave = await lifecycleSnapshot(page, 'first-leave-restored-prior-true');

  await page.evaluate(() => { window.__fw.scene3d.post.gtao.enabled = false; });
  const beforeSecondEntry = await lifecycleSnapshot(page, 'before-second-entry-prior-false');
  assert(!beforeSecondEntry.active && beforeSecondEntry.gtaoEnabled === false, 'Second entry must begin inactive with GTAO false.');
  // The card X armed a 1.35-second re-presentation timer. Use the same normal E
  // control as the player, but assert and leave immediately rather than waiting
  // for camera stability and racing the still-authoritative payment timer.
  await page.keyboard.press('e');
  await waitForRegisterState(page, { active: true, workspace: 'monitor', gtaoEnabled: false }, 1000);
  const secondEntry = await lifecycleSnapshot(page, 'second-entry-preserves-prior-false');
  await leaveFrontDeskThroughControls(page);
  await waitForRegisterState(page, { active: false, gtaoEnabled: false }, 2000);
  const secondLeave = await lifecycleSnapshot(page, 'second-leave-restores-prior-false');

  const cleanup = await page.evaluate((enabled) => {
    const gtao = window.__fw.scene3d.post.gtao;
    const before = gtao.enabled;
    gtao.enabled = enabled;
    return { before, restoredFixtureEnabled: gtao.enabled };
  }, gtaoFixture.originalEnabled);

  const lifecycle = {
    firstCycle: {
      priorEnabled: beforeFirstEntry.gtaoEnabled,
      activeTransitions: [activeMonitor, scanner, cardReady, cardToMonitor],
      restoredEnabled: firstLeave.gtaoEnabled,
      leave: firstLeave,
    },
    secondCycle: {
      priorEnabled: beforeSecondEntry.gtaoEnabled,
      enteredEnabled: secondEntry.gtaoEnabled,
      restoredEnabled: secondLeave.gtaoEnabled,
      entry: secondEntry,
      leave: secondLeave,
    },
    cleanup,
  };
  const result = {
    ok: true,
    schemaVersion: REGISTER_GTAO_VISUAL_AB_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    fixture: { ...fixture, gtao: gtaoFixture },
    protocol: {
      launch: 'HEADED=1 node tools/qa/run-playwright.cjs tools/qa/checkout-register-gtao-visual-ab.js --bootstrap',
      browserMode: process.env.HEADED === '1' ? 'headed' : 'headless',
      viewport: { width: 1600, height: 900 },
      devicePixelRatio: 1,
      normalControls: true,
      route: 'normal E, Escape-to-monitor, monitor start-scanning click, physical product clicks, physical reader X, Escape leave, then normal E/Escape prior-false cycle',
      captureSequence: 'off/on/off',
      fixedViews: REGISTER_GTAO_VISUAL_AB_VIEW_KEYS,
      freezeScope: 'clubhouse.update only, independently installed and restored during each fixed-view A/B toggle; normal game rAF and EffectComposer remain live',
      lifecycleExpectation: 'GTAO false for every active workspace; exact prior restored only when the register leaves',
    },
    views,
    lifecycle,
    diagnostics: {
      ...diagnostics,
      nonBenignRequestFailures: diagnostics.requestFailed.filter((entry) => !/ERR_ABORTED/.test(entry.error)),
    },
  };
  const validation = validateRegisterGtaoVisualAbResult(result);
  result.ok = validation.valid;
  result.validation = validation;
  fs.writeFileSync(path.join(OUT, 'register-gtao-visual-ab.json'), `${JSON.stringify(result, null, 2)}\n`);
  assert(validation.valid, `Register GTAO visual A/B result failed schema validation: ${validation.issues.join('; ')}`);
  return {
    ok: true,
    out: OUT,
    result: path.join(OUT, 'register-gtao-visual-ab.json'),
    views: result.views,
    lifecycle: result.lifecycle,
    diagnostics: result.diagnostics,
  };
}

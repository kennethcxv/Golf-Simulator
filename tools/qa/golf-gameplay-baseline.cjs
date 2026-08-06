'use strict';

// Captures the shipped golf-course life baseline before the canonical round loop.
// The fixture fixes time, demand, and camera poses; player-facing interactions still
// use the normal menu, mouse, keyboard, and check-in controls.

const fs = require('fs');
const path = require('path');

const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = require(playwrightModule);

const URL = process.env.QA_URL || 'http://127.0.0.1:8469/';
const OUT = path.resolve(process.env.QA_OUT || 'qa/golf-gameplay-loop/baseline');
const VIEWPORT = { width: 1600, height: 900 };

async function placeCamera(page, pose) {
  await page.evaluate(({ x, z, targetX, targetZ, pitch = -0.06 }) => {
    const walk = window.__fw.scene3d.walk.state;
    walk.x = x;
    walk.z = z;
    walk.yaw = Math.atan2(-(targetX - x), -(targetZ - z));
    walk.pitch = pitch;
  }, pose);
  await page.waitForTimeout(450);
}

async function worldCourseFacts(page) {
  return page.evaluate(() => {
    const state = window.__fw.state;
    const cellYd = 8;
    const worldW = state.course.w * cellYd;
    const worldH = state.course.h * cellYd;
    const point = (p) => ({
      x: (p.x + 0.5) * cellYd - worldW / 2,
      z: (p.y + 0.5) * cellYd - worldH / 2,
    });
    return {
      holes: state.course.holes.map((hole, i) => ({
        number: i + 1,
        status: hole.status,
        tee: hole.tee ? point(hole.tee) : null,
        pin: hole.pin ? point(hole.pin) : null,
      })),
      structures: state.course.structures,
    };
  });
}

async function sampleRuntime(page, durationMs, label) {
  return page.evaluate(async ({ durationMs: duration, label: sampleLabel }) => {
    const scene3d = window.__fw.scene3d;
    const renderer = scene3d.renderer;
    const intervals = [];
    const uiRoot = document.querySelector('#ui');
    let uiMutationCallbacks = 0;
    const observer = uiRoot
      ? new MutationObserver(() => { uiMutationCallbacks++; })
      : null;
    if (observer) observer.observe(uiRoot, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    await new Promise((resolve) => {
      let start = 0;
      let last = 0;
      function frame(t) {
        if (!start) {
          start = t;
          last = t;
          requestAnimationFrame(frame);
          return;
        }
        intervals.push(t - last);
        last = t;
        if (t - start >= duration) resolve();
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    if (observer) observer.disconnect();

    const sorted = [...intervals].sort((a, b) => b - a);
    const slowN = Math.max(1, Math.ceil(sorted.length * 0.01));
    const slowMean = sorted.slice(0, slowN).reduce((a, b) => a + b, 0) / slowN;
    const avgMs = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);

    const frameRender = await new Promise((resolve) => {
      const oldAuto = renderer.info.autoReset;
      renderer.info.autoReset = false;
      requestAnimationFrame(() => {
        renderer.info.reset();
        requestAnimationFrame(() => {
          const value = {
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
          };
          renderer.info.autoReset = oldAuto;
          resolve(value);
        });
      });
    });

    const materials = new Set();
    const textures = new Set();
    let sceneTriangles = 0;
    let meshes = 0;
    let courseCharacters = 0;
    scene3d.scene.traverse((object) => {
      if (object.userData?.char && object.position.z < 210) courseCharacters++;
      if (!object.isMesh || !object.visible) return;
      meshes++;
      const geometry = object.geometry;
      const triangles = geometry?.index
        ? geometry.index.count / 3
        : (geometry?.attributes?.position ? geometry.attributes.position.count / 3 : 0);
      sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
          if (material[key]) textures.add(material[key]);
        }
      }
    });

    let textureBytes = 0;
    for (const texture of textures) {
      const image = texture.image;
      const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
      const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
      textureBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
    }

    return {
      label: sampleLabel,
      source: 'requestAnimationFrame + THREE.WebGLRenderer.info + scene traversal',
      sampleDurationMs: duration,
      frames: intervals.length,
      averageFps: +(1000 / avgMs).toFixed(2),
      onePercentLowFps: +(1000 / slowMean).toFixed(2),
      worstFrameMs: +Math.max(...intervals).toFixed(2),
      drawCalls: frameRender.calls,
      renderedTriangles: frameRender.triangles,
      sceneTriangles: Math.round(sceneTriangles),
      visibleMeshCount: meshes,
      materialCount: materials.size,
      textureCount: textures.size,
      textureMemoryBytesEstimatedRgbaMipmapped: Math.round(textureBytes),
      rendererTextureCount: renderer.info.memory.textures,
      rendererGeometryCount: renderer.info.memory.geometries,
      jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      activeEventListenerCount: window.__qaActiveListeners?.() ?? null,
      uiMutationCallbacks,
      uiMutationCallbacksPerSecond: +(uiMutationCallbacks / (duration / 1000)).toFixed(2),
      courseCharacterCount: courseCharacters,
    };
  }, { durationMs, label });
}

async function courseCharacterSnapshot(page) {
  return page.evaluate(() => {
    const characters = [];
    window.__fw.scene3d.scene.traverse((object) => {
      const char = object.userData?.char;
      if (!char || object.position.z >= 210) return;
      characters.push({
        uuid: object.uuid,
        x: +object.position.x.toFixed(3),
        y: +object.position.y.toFixed(3),
        z: +object.position.z.toFixed(3),
        yaw: +object.rotation.y.toFixed(3),
        mode: char.mode,
      });
    });
    return characters;
  });
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'video'), { recursive: true });
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];

  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: path.join(OUT, 'video'), size: VIEWPORT },
  });
  await context.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const registry = new WeakMap();
    let active = 0;
    const captureOf = (opts) => (typeof opts === 'boolean' ? opts : !!(opts && opts.capture));

    EventTarget.prototype.addEventListener = function addEventListener(type, listener, opts) {
      if (listener) {
        let byType = registry.get(this);
        if (!byType) {
          byType = new Map();
          registry.set(this, byType);
        }
        let entries = byType.get(type);
        if (!entries) {
          entries = [];
          byType.set(type, entries);
        }
        const capture = captureOf(opts);
        if (!entries.some((entry) => entry.listener === listener && entry.capture === capture)) {
          entries.push({ listener, capture });
          active++;
        }
      }
      return originalAdd.call(this, type, listener, opts);
    };

    EventTarget.prototype.removeEventListener = function removeEventListener(type, listener, opts) {
      const entries = registry.get(this)?.get(type);
      const capture = captureOf(opts);
      const index = entries
        ? entries.findIndex((entry) => entry.listener === listener && entry.capture === capture)
        : -1;
      if (index >= 0) {
        entries.splice(index, 1);
        active--;
      }
      return originalRemove.call(this, type, listener, opts);
    };
    window.__qaActiveListeners = () => active;
  });

  const page = await context.newPage();
  const video = page.video();
  page.on('console', (message) => consoleMessages.push({
    type: message.type(),
    text: message.text().slice(0, 700),
  }));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'failed',
  }));

  let evidence;
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.locator('button').filter({ hasText: 'New Empire' }).first().click();
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 60000 });
    await page.waitForTimeout(2500);

    // A short movement through normal controls proves the playable route is live.
    await page.keyboard.down('w');
    await page.waitForTimeout(450);
    await page.keyboard.up('w');

    const fixture = await page.evaluate(async () => {
      const app = window.__fw;
      const reservations = await import(new URL('src/sim/reservations.js', document.baseURI).href);
      const time = await import(new URL('src/sim/time.js', document.baseURI).href);
      const cal = time.calendarOf(app.state.clock.minutes);
      app.state.clock.minutes = cal.dayAbs * 1440 + 9 * 60 + 20;
      app.state.club.lastRounds = 50;
      const booked = reservations.bookSlot(app.state, cal.dayAbs, 10 * 60, 'Baseline Walking Party');
      app.scene3d.applyTimeWeather(9 * 60 + 20, app.state.weather);
      return {
        dayAbs: cal.dayAbs,
        timeMinute: 9 * 60 + 20,
        lastRounds: app.state.club.lastRounds,
        reservation: booked.res ? {
          id: booked.res.id,
          name: booked.res.name,
          minute: booked.res.minute,
          status: booked.res.status,
        } : null,
      };
    });
    const course = await worldCourseFacts(page);
    const first = course.holes[0];
    const dx = first.pin.x - first.tee.x;
    const dz = first.pin.z - first.tee.z;
    const len = Math.hypot(dx, dz) || 1;

    await placeCamera(page, {
      x: first.tee.x - (dx / len) * 16,
      z: first.tee.z - (dz / len) * 16,
      targetX: first.tee.x + (dx / len) * 36,
      targetZ: first.tee.z + (dz / len) * 36,
      pitch: -0.045,
    });
    await page.screenshot({ path: path.join(OUT, '01-first-tee.png') });
    const idlePerformance = await sampleRuntime(page, 5000, 'first tee fixed camera, opening day, warm state');

    // Clubhouse lawn where a practice/staging complex would have to announce itself.
    await placeCamera(page, { x: 20, z: 246, targetX: -40, targetZ: 184, pitch: -0.08 });
    await page.screenshot({ path: path.join(OUT, '02-clubhouse-practice-area-missing.png') });

    // Existing register check-in: the normal E interaction auto-charges and marks a reservation played.
    await page.evaluate(() => {
      const walk = window.__fw.scene3d.walk.state;
      walk.x = -5.2;
      walk.z = 233.1;
      walk.yaw = 0;
      walk.pitch = -0.18;
    });
    // The shipped NPC can fail to reach the queue. The visible register prompt is
    // still the normal supported interaction, so wait for that prompt instead of
    // hiding the route defect with a state mutation.
    await page.waitForFunction(() => (
      window.__fw.scene3d.walk.getFocusLabel()?.includes('check in Baseline Walking Party')
    ), null, { timeout: 15000 });
    const beforeCheckIn = await page.evaluate(() => ({
      cash: window.__fw.state.cash,
      due: window.__fw.state.reservations.booked.map((reservation) => ({
        id: reservation.id,
        name: reservation.name,
        status: reservation.status,
      })),
      activeRoundState: window.__fw.state.activeRounds ?? null,
    }));
    await page.keyboard.press('e');
    await page.waitForFunction(() => (
      window.__fw.state.reservations.booked.some((reservation) => (
        reservation.name === 'Baseline Walking Party' && reservation.status === 'played'
      ))
    ), null, { timeout: 10000 });
    await page.waitForTimeout(700);
    const afterCheckIn = await page.evaluate(() => ({
      cash: window.__fw.state.cash,
      reservations: window.__fw.state.reservations.booked.map((reservation) => ({
        id: reservation.id,
        name: reservation.name,
        status: reservation.status,
      })),
      greenFees: window.__fw.state.ledger.today.revenue.greenFees,
      activeRoundState: window.__fw.state.activeRounds ?? null,
      clubhouseGolfers: window.__fw.scene3d.clubhouse().customers()
        .filter((customer) => customer.isGolfer)
        .map((customer) => ({ name: customer.name, queued: customer.queued, done: customer.done })),
    }));
    await page.screenshot({ path: path.join(OUT, '03-after-check-in.png') });

    // Let the ambient course walkers spawn. They are driven by lastRounds, not the reservation.
    await placeCamera(page, {
      x: first.tee.x - (dx / len) * 16,
      z: first.tee.z - (dz / len) * 16,
      targetX: first.pin.x,
      targetZ: first.pin.z,
      pitch: -0.04,
    });
    await page.waitForFunction(() => {
      let count = 0;
      window.__fw.scene3d.scene.traverse((object) => {
        if (object.userData?.char && object.position.z < 210) count++;
      });
      return count >= 5;
    }, null, { timeout: 45000 });
    const movementBefore = await courseCharacterSnapshot(page);
    await page.waitForTimeout(2200);
    const movementAfter = await courseCharacterSnapshot(page);
    await page.screenshot({ path: path.join(OUT, '04-current-golfer-movement.png') });
    const ambientPerformance = await sampleRuntime(page, 7000, 'ambient course golfers, fixed first-tee camera');

    let swingFound = true;
    try {
      await page.waitForFunction(() => {
        let found = false;
        window.__fw.scene3d.scene.traverse((object) => {
          if (object.userData?.char?.mode === 'Swing' && object.position.z < 210) found = true;
        });
        return found;
      }, null, { timeout: 35000 });
    } catch {
      swingFound = false;
    }
    const swing = await page.evaluate((freeze) => {
      const app = window.__fw;
      const found = [];
      app.scene3d.scene.traverse((object) => {
        if (object.userData?.char && object.position.z < 210) {
          found.push({
            uuid: object.uuid,
            x: object.position.x,
            y: object.position.y,
            z: object.position.z,
            yaw: object.rotation.y,
            mode: object.userData.char.mode,
          });
        }
      });
      const target = found.find((entry) => entry.mode === 'Swing') || found[0] || null;
      if (freeze) app.scene3d.setGolfersFrozen(true);
      return target;
    }, swingFound);
    if (swing) {
      await placeCamera(page, {
        x: swing.x + 6.5,
        z: swing.z + 5.5,
        targetX: swing.x,
        targetZ: swing.z,
        pitch: -0.12,
      });
    }
    await page.screenshot({ path: path.join(OUT, '05-current-swing-no-ball.png') });

    // The only player-facing golf cart is an ambient static model beside the porch.
    await page.evaluate(() => window.__fw.scene3d.setGolfersFrozen(false));
    await placeCamera(page, { x: -8, z: 244, targetX: 1.5, targetZ: 240.5, pitch: -0.14 });
    await page.screenshot({ path: path.join(OUT, '06-static-member-cart.png') });

    const movementDeltas = movementBefore.map((before) => {
      const after = movementAfter.find((candidate) => candidate.uuid === before.uuid);
      return {
        uuid: before.uuid,
        before,
        after: after || null,
        distanceYd: after
          ? +Math.hypot(after.x - before.x, after.z - before.z).toFixed(3)
          : null,
      };
    });

    evidence = {
      capturedAt: new Date().toISOString(),
      branch: 'overnight/golf-gameplay-loop',
      commit: process.env.QA_COMMIT || '0c5137e5f0efac9627ce2309b9e66936f1eeb769',
      launch: `QA_URL=${URL}`,
      browser: await browser.version(),
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      fixture,
      fixedCameras: {
        firstTee: {
          x: first.tee.x - (dx / len) * 16,
          z: first.tee.z - (dz / len) * 16,
          targetX: first.tee.x + (dx / len) * 36,
          targetZ: first.tee.z + (dz / len) * 36,
        },
        clubhousePracticeLawn: { x: 20, z: 246, targetX: -40, targetZ: 184 },
        register: { x: -5.2, z: 233.1, yaw: 0, pitch: -0.18 },
        memberCart: { x: -8, z: 244, targetX: 1.5, targetZ: 240.5 },
      },
      course,
      beforeCheckIn,
      afterCheckIn,
      movementDeltas,
      swingFound,
      swing,
      authoritativeStateAbsences: {
        activeRounds: afterCheckIn.activeRoundState,
        partyRoundStateMachine: false,
        practiceOccupancy: false,
        starterQueue: false,
        scorecards: false,
        paceAndCongestion: false,
        assignedGolferCarts: false,
        golfBallPool: false,
        marshalTasks: false,
      },
      runtime: {
        idleFirstTee: idlePerformance,
        ambientGolfers: ambientPerformance,
      },
      consoleMessages,
      pageErrors,
      failedRequests,
    };
    fs.writeFileSync(path.join(OUT, 'baseline.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await context.close();
    const videoPath = await video.path();
    fs.copyFileSync(videoPath, path.join(OUT, 'baseline-route.webm'));
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

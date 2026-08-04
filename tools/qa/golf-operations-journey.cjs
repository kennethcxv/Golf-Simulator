'use strict';

// Deterministic, accelerated operating-day route for golf operations.
// It enters every player-facing surface through normal controls; direct state
// access is used only to install the repeatable fixture and advance the clock.
//
// PLAYWRIGHT_MODULE=<path> QA_URL=http://127.0.0.1:8468 \
// QA_ITERATION=iteration-01 node tools/qa/golf-operations-journey.cjs

const fs = require('fs');
const path = require('path');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const URL = process.env.QA_URL || 'http://127.0.0.1:8468/';
const ITERATION = process.env.QA_ITERATION || 'iteration-01';
const OUT = path.resolve(process.env.QA_OUT || `qa/golf-operations/${ITERATION}`);
const VIEWPORT = { width: 1600, height: 900 };

async function sampleRuntime(page, durationMs = 5000) {
  return page.evaluate(async (duration) => {
    const scene3d = window.__fw.scene3d;
    const renderer = scene3d.renderer;
    const intervals = [];
    await new Promise((resolve) => {
      let start = 0;
      let last = 0;
      function tick(time) {
        if (!start) {
          start = time;
          last = time;
          requestAnimationFrame(tick);
          return;
        }
        intervals.push(time - last);
        last = time;
        if (time - start >= duration) resolve();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    const descending = [...intervals].sort((a, b) => b - a);
    const slowCount = Math.max(1, Math.ceil(descending.length * 0.01));
    const slowMean = descending.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
    const averageMs = intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length);
    const frameRender = await new Promise((resolve) => {
      const previousAutoReset = renderer.info.autoReset;
      renderer.info.autoReset = false;
      requestAnimationFrame(() => {
        renderer.info.reset();
        requestAnimationFrame(() => {
          resolve({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
          renderer.info.autoReset = previousAutoReset;
        });
      });
    });

    const materials = new Set();
    const textures = new Set();
    let sceneTriangles = 0;
    scene3d.scene.traverse((object) => {
      if (!object.isMesh || !object.visible) return;
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
      sampleDurationMs: duration,
      frames: intervals.length,
      averageFps: +(1000 / averageMs).toFixed(2),
      onePercentLowFps: +(1000 / slowMean).toFixed(2),
      worstFrameMs: +Math.max(...intervals).toFixed(2),
      drawCalls: frameRender.calls,
      renderedTriangles: frameRender.triangles,
      sceneTriangles: Math.round(sceneTriangles),
      materialCount: materials.size,
      textureCount: textures.size,
      textureMemoryBytesEstimatedRgbaMipmapped: Math.round(textureBytes),
      rendererTextureCount: renderer.info.memory.textures,
      rendererGeometryCount: renderer.info.memory.geometries,
      jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      connectedListeners: window.__qaConnectedListeners?.() ?? null,
      listenerRegistrations: window.__qaListenerRegistrations?.() ?? null,
    };
  }, durationMs);
}

async function placeAtRegister(page) {
  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 2.8;
    walk.z = origin.z + 5.1;
    walk.yaw = 0;
    walk.pitch = -0.18;
  });
  await page.waitForTimeout(650);
}

async function normalEnterTeeDesk(page) {
  await placeAtRegister(page);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.frontDeskOpen === true, null, { timeout: 10000 });
  await page.locator('.front-desk').waitFor({ state: 'visible' });
}

async function jumpToArrival(page, reservationId) {
  await page.evaluate(async (id) => {
    const app = window.__fw;
    const operations = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const reservation = operations.reservationById(app.state, id);
    app.state.clock.minutes = reservation.arrival.plannedMinute;
    operations.golfOperationsTick(app.state, app.state.clock.minutes);
    app.scene3d.applyTimeWeather(app.state.clock.minutes % 1440, app.state.weather);
    app.frontDeskUi?.refresh();
  }, reservationId);
  await page.waitForTimeout(1400);
}

async function chooseParty(page, holder) {
  const row = page.locator('.fd-queue-row').filter({ hasText: holder }).first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.click();
  await page.locator('.fd-detail h2').filter({ hasText: holder }).waitFor({ state: 'visible' });
}

async function confirmParty(page) {
  const button = page.getByRole('button', { name: 'Confirm reservation', exact: true });
  if (await button.count()) await button.click();
}

async function swipeCard(page) {
  const card = page.locator('.fd-card');
  const track = page.locator('.fd-swipe-track');
  const cardBox = await card.boundingBox();
  const trackBox = await track.boundingBox();
  if (!cardBox || !trackBox) throw new Error('Card swipe geometry is not visible.');
  const x = cardBox.x + cardBox.width / 2;
  await page.mouse.move(x, cardBox.y + 3);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) {
    const y = trackBox.y + 4 + ((trackBox.height - 8) * step) / 12;
    await page.mouse.move(x, y);
    await page.waitForTimeout(45);
  }
  await page.mouse.up();
  await page.locator('.fd-receipt').waitFor({ state: 'visible', timeout: 10000 });
}

async function takeReceiptAndCheckIn(page) {
  await page.getByRole('button', { name: 'Take receipt', exact: true }).click();
  await page.getByRole('button', { name: 'Check in party', exact: true }).click();
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'video'), { recursive: true });
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const browser = await chromium.launch({
    channel: 'chrome',
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
    const records = [];
    const captureOf = (value) => (typeof value === 'boolean' ? value : !!value?.capture);
    EventTarget.prototype.addEventListener = function addEventListener(type, listener, options) {
      if (listener) records.push({ target: this, type, listener, capture: captureOf(options), active: true });
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function removeEventListener(type, listener, options) {
      const capture = captureOf(options);
      const record = records.findLast((entry) => (
        entry.active && entry.target === this && entry.type === type
        && entry.listener === listener && entry.capture === capture
      ));
      if (record) record.active = false;
      return originalRemove.call(this, type, listener, options);
    };
    window.__qaConnectedListeners = () => records.filter((entry) => (
      entry.active
      && (!(entry.target instanceof Node) || entry.target.isConnected)
    )).length;
    window.__qaListenerRegistrations = () => records.length;
  });

  const page = await context.newPage();
  const video = page.video();
  page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text().slice(0, 600) }));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'failed',
  }));

  let evidence;
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    const newGame = page.locator('.menu-screen .menu-action').filter({ hasText: /^New game/ });
    if (await newGame.count()) {
      await newGame.click();
      await page.getByRole('dialog', { name: 'New game' }).waitFor();
      await page.locator('.difficulty-card').filter({ hasText: /^Relaxed/ }).click();
    } else {
      await page.getByRole('button', { name: /New Empire.*Relaxed/ }).click();
    }
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 60000 });
    await page.waitForTimeout(1800);

    const fixture = await page.evaluate(async () => {
      const app = window.__fw;
      const operations = await import(new URL('src/sim/reservations.js', document.baseURI).href);
      const time = await import(new URL('src/sim/time.js', document.baseURI).href);
      const cal = time.calendarOf(app.state.clock.minutes);
      const qaDay = cal.dayAbs + 1;
      // Production boot fills the forward horizon. The evidence route owns a
      // smaller deterministic manifest, so reset only this subsystem first.
      operations.resetGolfOperationsQA(app.state);
      const seeded = operations.seedGolfOperationsQA(app.state, { dayAbs: qaDay, seed: 20260719 });
      const first = operations.reservationById(app.state, seeded.ids.earlyPrepaid);
      app.speedIdx = 1;
      app.state.clock.minutes = first.arrival.plannedMinute;
      operations.golfOperationsTick(app.state, app.state.clock.minutes);
      app.scene3d.applyTimeWeather(app.state.clock.minutes % 1440, app.state.weather);
      return {
        ...seeded,
        ids: { ...seeded.ids },
        holders: Object.fromEntries(Object.entries(seeded.ids).map(([key, id]) => (
          [key, operations.reservationById(app.state, id).reservationHolder]
        ))),
      };
    });

    await placeAtRegister(page);
    await page.waitForFunction((id) => window.__fw.scene3d.clubhouse().customers()
      .some((entry) => entry.entity?.reservationId === id), fixture.ids.earlyPrepaid, { timeout: 45000 });
    await page.evaluate((id) => {
      const actor = window.__fw.scene3d.clubhouse().customers()
        .find((entry) => entry.entity?.reservationId === id);
      if (actor?.entity) actor.entity.speed = 12;
    }, fixture.ids.earlyPrepaid);
    await page.waitForFunction((id) => {
      const customer = window.__fw.scene3d.clubhouse().customers()
        .find((entry) => entry.entity?.reservationId === id);
      return customer?.entity?.state === 'Front-desk inquiry';
    }, fixture.ids.earlyPrepaid, { timeout: 180000 });
    await page.evaluate(() => { window.__fw.speedIdx = 0; });
    await page.screenshot({ path: path.join(OUT, '01-arrival-at-counter.png') });

    await normalEnterTeeDesk(page);
    const entrySnapshot = await page.evaluate(() => {
      const app = window.__fw;
      const selected = app.frontDeskUi.selectedReservation();
      const shell = document.querySelector('.fd-shell').getBoundingClientRect();
      return {
        selectedId: selected?.id,
        selectedHolder: selected?.reservationHolder,
        shell: { x: shell.x, y: shell.y, width: shell.width, height: shell.height },
        registerActive: app.scene3d.clubhouse().register.isActive(),
        npcReservations: app.scene3d.clubhouse().customers()
          .filter((customer) => customer.entity?.reservationId != null)
          .map((customer) => ({
            reservationId: customer.entity.reservationId,
            name: customer.name,
            partySize: customer.entity.partySize,
            state: customer.entity.state,
          })),
      };
    });
    await page.screenshot({ path: path.join(OUT, '02-tee-desk-open.png') });

    await confirmParty(page);
    await page.getByRole('button', { name: 'Check in party', exact: true }).click();
    await page.waitForFunction((id) => {
      const reservation = window.__fw.state.reservations.booked.find((entry) => entry.id === id);
      return reservation?.checkIn?.status === 'checked-in';
    }, fixture.ids.earlyPrepaid);
    await page.screenshot({ path: path.join(OUT, '03-prepaid-check-in.png') });

    await jumpToArrival(page, fixture.ids.onTimeCard);
    await chooseParty(page, fixture.holders.onTimeCard);
    await confirmParty(page);
    const cardCashBefore = await page.evaluate(() => window.__fw.state.cash);
    await page.getByRole('button', { name: 'Pay by card', exact: true }).click();
    await page.screenshot({ path: path.join(OUT, '04-card-ready.png') });
    await swipeCard(page);
    await page.screenshot({ path: path.join(OUT, '05-card-receipt.png') });
    await takeReceiptAndCheckIn(page);

    await jumpToArrival(page, fixture.ids.lateCash);
    await chooseParty(page, fixture.holders.lateCash);
    await confirmParty(page);
    await page.getByRole('button', { name: 'Pay cash', exact: true }).click();
    await page.getByRole('button', { name: 'Open drawer', exact: true }).click();
    await page.screenshot({ path: path.join(OUT, '06-cash-drawer.png') });
    await page.getByRole('button', { name: /Accept .* & print/ }).click();
    await page.locator('.fd-receipt').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(OUT, '07-cash-receipt.png') });
    await takeReceiptAndCheckIn(page);

    await page.getByRole('button', { name: 'Walk-in booking', exact: true }).click();
    await page.getByRole('textbox', { name: 'Walk-in reservation holder' }).fill('Rowan Mercer');
    await page.getByRole('combobox', { name: 'Walk-in party size' }).selectOption('2');
    await page.screenshot({ path: path.join(OUT, '08-walk-in-availability.png') });
    await page.getByRole('button', { name: 'Create booking', exact: true }).click();
    await page.locator('.fd-detail h2').filter({ hasText: 'Rowan Mercer' }).waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(OUT, '09-walk-in-created.png') });

    const interactionResult = await page.evaluate(({ fixtureIds, cashBefore }) => {
      const app = window.__fw;
      const byId = (id) => app.state.reservations.booked.find((entry) => entry.id === id);
      const card = byId(fixtureIds.onTimeCard);
      const cash = byId(fixtureIds.lateCash);
      const walkIn = app.state.reservations.booked.find((entry) => entry.reservationHolder === 'Rowan Mercer');
      return {
        cashBeforeCard: cashBefore,
        cashAfterServices: app.state.cash,
        card: {
          status: card.status,
          payment: card.payment,
          checkIn: card.checkIn,
        },
        cash: {
          status: cash.status,
          payment: cash.payment,
          checkIn: cash.checkIn,
        },
        walkIn: {
          id: walkIn?.id,
          slotId: walkIn?.slotId,
          partySize: walkIn?.partySize,
          arrival: walkIn?.arrival,
          npc: app.scene3d.clubhouse().customers()
            .find((customer) => customer.entity?.reservationId === walkIn?.id)?.name,
        },
        processedTransactionIds: [...app.state.reservations.processedTransactionIds],
        financeEntries: app.state.reservations.financeEntries.map((entry) => ({ ...entry })),
      };
    }, { fixtureIds: fixture.ids, cashBefore: cardCashBefore });

    let mutationCallbacks = 0;
    await page.exposeFunction('__qaDeskMutation', () => { mutationCallbacks++; });
    await page.evaluate(() => {
      const root = document.querySelector('.front-desk');
      window.__qaDeskObserver = new MutationObserver(() => window.__qaDeskMutation());
      window.__qaDeskObserver.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    const listenersBefore = await page.evaluate(() => ({
      connected: window.__qaConnectedListeners(),
      registrations: window.__qaListenerRegistrations(),
    }));
    const runtime = await sampleRuntime(page, 5000);
    await page.evaluate(() => window.__qaDeskObserver.disconnect());
    const listenersAfter = await page.evaluate(() => ({
      connected: window.__qaConnectedListeners(),
      registrations: window.__qaListenerRegistrations(),
    }));

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.frontDeskOpen === false);
    const normalExit = await page.evaluate(() => ({
      frontDeskOpen: window.__fw.frontDeskOpen,
      focused: window.__fw.scene3d.walk.isFocused(),
      registerActive: window.__fw.scene3d.clubhouse().register.isActive(),
    }));

    evidence = {
      capturedAt: new Date().toISOString(),
      iteration: ITERATION,
      branch: 'overnight/golf-operations',
      commit: process.env.QA_COMMIT || 'working-tree',
      url: URL,
      browser: await browser.version(),
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      fixture,
      entrySnapshot,
      interactionResult,
      normalExit,
      runtime,
      listeners: {
        before: listenersBefore,
        after: listenersAfter,
        connectedDelta: listenersAfter.connected - listenersBefore.connected,
        registrationDelta: listenersAfter.registrations - listenersBefore.registrations,
      },
      uiMutationCallbacksDuringFiveSeconds: mutationCallbacks,
      consoleMessages,
      pageErrors,
      failedRequests,
    };
    fs.writeFileSync(path.join(OUT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await context.close();
    const recorded = await video.path();
    fs.copyFileSync(recorded, path.join(OUT, 'operating-day.webm'));
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

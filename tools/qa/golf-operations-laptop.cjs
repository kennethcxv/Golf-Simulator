// Player-facing laptop QA for golf operations. Every navigation, field edit,
// booking, cancellation, and close uses the same projected controls a player sees.

const fs = require('fs');
const path = require('path');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const URL = process.env.QA_URL || 'http://127.0.0.1:8468/';
const OUT = path.resolve(process.env.QA_OUT || 'qa/golf-operations/laptop-iteration-01');
const VIEWPORT = { width: 1600, height: 900 };

async function clickCenter(page, locator, label) {
  let box = await locator.boundingBox();
  const viewport = page.viewportSize();
  const insideScrollablePage = await locator.evaluate((element) => !!element.closest('.lt-content'));
  if (insideScrollablePage || !box || box.x < 0 || box.y < 0
      || box.x + box.width > viewport.width || box.y + box.height > viewport.height) {
    await locator.scrollIntoViewIfNeeded();
    box = await locator.boundingBox();
  }
  if (!box) throw new Error(`${label} is not visible on the projected laptop.`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function clickNav(page, label) {
  const button = page.locator('.lt-navbtn').filter({ hasText: label }).first();
  await clickCenter(page, button, `${label} navigation`);
  await page.waitForFunction((name) => [...document.querySelectorAll('.lt-navbtn.on')]
    .some((entry) => entry.textContent.includes(name)), label);
}

async function sampleRuntime(page, durationMs = 4000) {
  return page.evaluate(async (duration) => {
    const renderer = window.__fw.scene3d.renderer;
    const intervals = [];
    await new Promise((resolve) => {
      let start = 0;
      let last = 0;
      const frame = (time) => {
        if (!start) { start = time; last = time; requestAnimationFrame(frame); return; }
        intervals.push(time - last);
        last = time;
        if (time - start >= duration) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const slow = [...intervals].sort((a, b) => b - a);
    const slowN = Math.max(1, Math.ceil(slow.length * 0.01));
    const slowMean = slow.slice(0, slowN).reduce((sum, value) => sum + value, 0) / slowN;
    const avgMs = intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length);
    const materials = new Set();
    const textures = new Set();
    let sceneTriangles = 0;
    window.__fw.scene3d.scene.traverse((object) => {
      if (!object.isMesh || !object.visible) return;
      const geometry = object.geometry;
      const triangles = geometry?.index ? geometry.index.count / 3
        : geometry?.attributes?.position ? geometry.attributes.position.count / 3 : 0;
      sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
          if (material[key]) textures.add(material[key]);
        }
      }
    });
    return {
      samples: intervals.length,
      averageFps: 1000 / avgMs,
      onePercentLowFps: 1000 / slowMean,
      worstFrameMs: Math.max(...intervals),
      drawCalls: renderer.info.render.calls,
      renderedTriangles: renderer.info.render.triangles,
      sceneTriangles,
      materials: materials.size,
      textures: textures.size,
      rendererTextures: renderer.info.memory.textures,
      rendererGeometries: renderer.info.memory.geometries,
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  }, durationMs);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: path.join(OUT, '.video'), size: VIEWPORT },
  });
  await context.addInitScript(() => {
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
  const video = page.video();
  page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text().slice(0, 600) }));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(), failure: request.failure()?.errorText || 'failed',
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
    await page.waitForTimeout(1800);

    const fixture = await page.evaluate(async () => {
      const app = window.__fw;
      const operations = await import('/src/sim/reservations.js');
      const { calendarOf } = await import('/src/sim/time.js');
      const cal = calendarOf(app.state.clock.minutes);
      const productionDays = [...app.state.reservations.generator.generatedDays];
      const productionBookings = app.state.reservations.booked.map((reservation) => ({
        id: reservation.id,
        dayAbs: reservation.dayAbs,
        minute: reservation.minute,
        names: [...reservation.customerNames],
      }));
      operations.resetGolfOperationsQA(app.state);
      const seeded = operations.seedGolfOperationsQA(app.state, { dayAbs: cal.dayAbs, seed: 20260719 });
      const noShow = operations.reservationById(app.state, seeded.ids.noShow);
      for (const key of ['earlyPrepaid', 'onTimeCard', 'lateCash']) {
        const reservation = operations.reservationById(app.state, seeded.ids[key]);
        operations.markReservationArrived(app.state, reservation.id, reservation.arrival.plannedMinute);
      }
      app.state.clock.minutes = noShow.dayAbs * 1440 + noShow.minute + app.state.reservations.config.gracePeriodMin + 1;
      operations.golfOperationsTick(app.state, app.state.clock.minutes);
      app.speedIdx = 0;
      app.scene3d.applyTimeWeather(app.state.clock.minutes % 1440, app.state.weather);
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = 8.45 + origin.x;
      walk.z = 4.5 + origin.z;
      walk.yaw = -Math.PI / 2;
      walk.pitch = -0.05;
      return {
        ...seeded,
        production: {
          days: productionDays,
          bookings: productionBookings.length,
          uniqueWithinEachDay: productionDays.every((dayAbs) => {
            const names = productionBookings.filter((reservation) => reservation.dayAbs === dayAbs)
              .flatMap((reservation) => reservation.names);
            return new Set(names).size === names.length;
          }),
        },
      };
    });

    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, '00-laptop-approach.png') });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10000 });
    await page.waitForFunction(() => {
      const frame = document.querySelector('.lt-frame');
      return frame?.getBoundingClientRect().width > 100;
    }, null, { timeout: 20000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, '01-home-operations-alerts.png') });

    await clickNav(page, 'Reservations');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '02-capacity-aware-tee-sheet.png') });

    const holderInput = page.locator('input[placeholder="Reservation holder"]');
    await clickCenter(page, holderInput, 'reservation holder');
    await page.keyboard.type('Jordan Vale');
    const partyRow = page.locator('.lt-row').filter({ hasText: 'Party' }).first();
    const partySelect = partyRow.locator('select').first();
    await clickCenter(page, partySelect, 'party size');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const guestInput = page.locator('input[placeholder^="Other player names"]');
    await clickCenter(page, guestInput, 'guest names');
    await page.keyboard.type('Mara Vale, Ellis Vale');
    const paymentRow = page.locator('.lt-row').filter({ hasText: 'Payment' }).first();
    const paymentSelect = paymentRow.locator('select').first();
    await clickCenter(page, paymentSelect, 'payment plan');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const bookButton = page.locator('.lt-slotbook:not([disabled])').first();
    await clickCenter(page, bookButton, 'available tee-time booking');
    await page.waitForFunction(() => window.__fw.state.reservations.booked.some((reservation) => (
      reservation.reservationHolder === 'Jordan Vale'
    )));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '03-prepaid-party-booked.png') });

    const partyLine = page.locator('.lt-partyline').filter({ hasText: 'Jordan Vale' }).first();
    await clickCenter(page, partyLine.locator('button').filter({ hasText: 'Cancel' }), 'booking cancellation');
    await page.waitForSelector('.lt-confirm');
    await page.screenshot({ path: path.join(OUT, '04-cancellation-confirmation.png') });
    await clickCenter(page, page.locator('.lt-confirm button').filter({ hasText: 'Apply policy and cancel' }), 'confirm cancellation');
    await page.waitForFunction(() => window.__fw.state.reservations.booked.find((reservation) => (
      reservation.reservationHolder === 'Jordan Vale'
    ))?.status === 'cancelled');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, '05-cancelled-history-and-reopened-capacity.png') });

    await clickNav(page, 'Finances');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, '06-operations-subledger.png') });
    await clickNav(page, 'Settings');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '07-live-schedule-and-policy.png') });
    await clickNav(page, 'Home');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '08-home-after-workflow.png') });

    let mutations = 0;
    await page.exposeFunction('__qaLaptopMutation', () => { mutations++; });
    const listenersBefore = await page.evaluate(() => window.__qaListeners());
    await page.evaluate(() => {
      window.__qaLaptopObserver = new MutationObserver(() => window.__qaLaptopMutation());
      window.__qaLaptopObserver.observe(document.querySelector('.lt-content'), {
        subtree: true, childList: true, characterData: true, attributes: true,
      });
    });
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__qaLaptopObserver.disconnect());
    const listenersAfter = await page.evaluate(() => window.__qaListeners());
    const runtime = await sampleRuntime(page);
    const workflow = await page.evaluate(() => {
      const reservation = window.__fw.state.reservations.booked.find((entry) => entry.reservationHolder === 'Jordan Vale');
      const finance = window.__fw.state.reservations.financeEntries.filter((entry) => entry.reservationId === reservation.id);
      return {
        reservation: {
          id: reservation.id,
          minute: reservation.minute,
          partySize: reservation.partySize,
          names: reservation.customerNames,
          status: reservation.status,
          payment: reservation.payment,
          cancellation: reservation.cancellation,
        },
        finance,
        ledger: JSON.parse(JSON.stringify(window.__fw.state.ledger.today)),
        homeText: document.querySelector('.lt-content')?.textContent,
      };
    });

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, '09-normal-escape-return.png') });

    evidence = {
      capturedAt: new Date().toISOString(),
      branch: 'overnight/golf-operations',
      commit: process.env.QA_COMMIT || 'working-tree',
      launch: `QA_URL=${URL}`,
      browser: await browser.version(),
      viewport: VIEWPORT,
      fixture,
      workflow,
      runtime,
      listeners: {
        beforeIdle: listenersBefore,
        afterIdle: listenersAfter,
        activeDelta: listenersAfter.active - listenersBefore.active,
        registrationDelta: listenersAfter.registrations - listenersBefore.registrations,
      },
      idleUiMutationCallbacks: mutations,
      consoleMessages,
      pageErrors,
      failedRequests,
    };
    fs.writeFileSync(path.join(OUT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    if (!fixture.production.uniqueWithinEachDay || fixture.production.days.length !== 7) {
      throw new Error('Production boot did not create a complete identity-safe seven-day horizon.');
    }
    if (workflow.reservation.partySize !== 3 || workflow.reservation.names.join('|') !== 'Jordan Vale|Mara Vale|Ellis Vale') {
      throw new Error('Laptop booking did not preserve the exact named party.');
    }
    if (workflow.reservation.status !== 'cancelled' || workflow.reservation.cancellation.fee !== 12
      || workflow.reservation.cancellation.refund !== 84) {
      throw new Error(`Cancellation policy mismatch: ${JSON.stringify(workflow.reservation.cancellation)}`);
    }
    if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(' | ')}`);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await context.close();
    const videoPath = await video.path();
    fs.copyFileSync(videoPath, path.join(OUT, 'laptop-operations-route.webm'));
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

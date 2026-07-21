'use strict';

// Repeatable normal-browser visual journey for the canonical live golf loop.
// State setup uses production reservation/payment/check-in functions; travel,
// camera observation, laptop navigation, and all captured UI use normal controls.

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const URL = process.env.QA_URL || 'http://127.0.0.1:8469/';
const OUT = path.resolve(process.env.QA_OUT || 'qa/golf-gameplay-loop/iteration-1');
const VIEWPORT = { width: 1600, height: 900 };

function mkdirs() {
  fs.mkdirSync(path.join(OUT, 'video'), { recursive: true });
}

async function placeCamera(page, pose) {
  await page.evaluate(({ x, z, targetX, targetZ, pitch = -0.08 }) => {
    const walk = window.__fw.scene3d.walk.state;
    walk.x = x;
    walk.z = z;
    walk.yaw = Math.atan2(-(targetX - x), -(targetZ - z));
    walk.pitch = pitch;
  }, pose);
  await page.waitForTimeout(350);
  return pose;
}

async function tickTo(page, minuteOfDay) {
  return page.evaluate(async (minute) => {
    const app = window.__fw;
    const golf = await import('/src/sim/golfDay.js');
    const time = await import('/src/sim/time.js');
    const dayAbs = time.calendarOf(app.state.clock.minutes).dayAbs;
    if (app.state.tutorial) app.state.tutorial.hidden = true;
    const target = dayAbs * 1440 + minute;
    app.state.clock.minutes = target;
    golf.golfDayTick(app.state, target);
    app.scene3d.applyTimeWeather(minute, app.state.weather);
    return app.state.golfDay.parties.map((party) => ({
      id: party.id,
      name: party.partyName,
      state: party.state,
      hole: party.holeIndex + 1,
      transport: party.transport,
      position: { ...party.position },
    }));
  }, minuteOfDay);
}

async function fixture(page) {
  return page.evaluate(async () => {
    const app = window.__fw;
    const reservations = await import('/src/sim/reservations.js');
    const golf = await import('/src/sim/golfDay.js');
    const time = await import('/src/sim/time.js');
    app.speedIdx = 0;
    const dayAbs = time.calendarOf(app.state.clock.minutes).dayAbs;
    reservations.resetGolfOperationsQA(app.state, { horizonDays: 7 });

    const create = (holder, minute, arrival, transport, size) => {
      const absoluteArrival = dayAbs * 1440 + arrival;
      app.state.clock.minutes = absoluteArrival;
      const booked = reservations.bookSlot(app.state, dayAbs, minute, {
        holder,
        customerNames: Array.from({ length: size }, (_, index) => (
          index ? `${holder} Guest ${index + 1}` : holder
        )),
        partySize: size,
        transport,
      });
      if (!booked.ok) throw new Error(`${holder} booking failed: ${booked.reason}`);
      const reservation = booked.res;
      for (const result of [
        reservations.markReservationArrived(app.state, reservation.id, absoluteArrival),
        reservations.confirmReservation(app.state, reservation.id, absoluteArrival),
      ]) if (!result.ok) throw new Error(`${holder} arrival failed: ${result.reason}`);
      const payment = reservations.beginReservationPayment(app.state, reservation.id, 'card');
      if (!payment.ok) throw new Error(`${holder} payment failed: ${payment.reason}`);
      const paid = reservations.completeReservationPayment(app.state, reservation.id, {
        transactionId: payment.transactionId,
      });
      if (!paid.ok) throw new Error(`${holder} payment completion failed: ${paid.reason}`);
      const checkedIn = reservations.checkInReservation(app.state, reservation.id, { atMinute: absoluteArrival });
      if (!checkedIn.ok) throw new Error(`${holder} check-in failed: ${checkedIn.reason}`);
      return reservation.id;
    };

    const reservationIds = [
      create('Avery Monroe', 600, 560, 'walk', 2),
      create('Devon Park', 600, 561, 'ride', 2),
      create('Caleb Foster', 630, 562, 'walk', 3),
      create('Imani Cole', 660, 563, 'ride', 2),
    ];
    const target = dayAbs * 1440 + 564;
    app.state.clock.minutes = target;
    golf.golfDayTick(app.state, target);
    app.scene3d.applyTimeWeather(564, app.state.weather);
    return {
      seed: app.state.seed,
      dayAbs,
      reservationIds,
      facilities: app.state.golfDay.routeNetwork.facilities,
      firstHole: app.state.golfDay.routeNetwork.holes[0],
    };
  });
}

async function liveFacts(page) {
  return page.evaluate(() => {
    const app = window.__fw;
    const day = app.state.golfDay;
    const scene = { characters: 0, visibleCharacters: 0, liveCarts: 0, facilities: 0, ballInstances: 0 };
    app.scene3d.scene.traverse((object) => {
      if (object.userData?.char) {
        scene.characters++;
        if (object.visible) scene.visibleCharacters++;
      }
      if (object.parent?.name === 'LiveGolfCarts') scene.liveCarts++;
      if (object.parent?.name === 'GolfFacilities') scene.facilities++;
      if (object.isInstancedMesh && object.parent?.name === 'LiveGolfBalls') scene.ballInstances = object.count;
    });
    return {
      clock: app.state.clock.minutes,
      scene,
      panel: document.querySelector('.golf-live-panel')?.innerText || null,
      congestion: day.congestion,
      starter: day.starter,
      carts: day.carts,
      practice: day.practice,
      metrics: day.metrics,
      presentationShotCount: day.presentationShots.length,
      parties: day.parties.map((party) => ({
        id: party.id,
        name: party.partyName,
        state: party.state,
        hole: party.holeIndex + 1,
        transport: party.transport,
        cartId: party.cartId,
        simulationTier: party.simulationTier,
        position: party.position,
        score: party.golfers.map((golfer) => ({
          name: golfer.name,
          total: golfer.totalStrokes,
          current: golfer.holeStrokes,
        })),
        pace: party.pace,
      })),
    };
  });
}

async function main() {
  mkdirs();
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: path.join(OUT, 'video'), size: VIEWPORT },
  });
  await context.addInitScript(() => {
    let seed = 20260719;
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  });
  const page = await context.newPage();
  const video = page.video();
  page.on('console', (message) => consoleMessages.push({
    type: message.type(),
    text: message.text().slice(0, 900),
  }));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'failed',
  }));

  const stages = {};
  let setup;
  let cameras;
  let videoPath = null;
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.locator('button').filter({ hasText: 'New Empire' }).first().click();
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 60000 });
    await page.waitForTimeout(3000);

    // Normal player controls remain functional before the deterministic setup.
    await page.keyboard.down('w');
    await page.waitForTimeout(350);
    await page.keyboard.up('w');
    await page.evaluate(() => document.querySelector('[title="Hide the guide"]')?.click());
    await page.waitForTimeout(2800);
    setup = await fixture(page);
    await page.waitForFunction(() => (
      window.__fw.scene3d.scene.getObjectByName('GolfFacilities')?.children.length >= 5
    ), null, { timeout: 20000 });
    await page.waitForTimeout(1200);

    const shortGame = setup.facilities.chipping.center;
    const starter = setup.facilities.starterStand;
    const starterPoints = [starter, ...setup.facilities.staging];
    const starterFocus = {
      x: starterPoints.reduce((sum, point) => sum + point.x, 0) / starterPoints.length,
      z: starterPoints.reduce((sum, point) => sum + point.z, 0) / starterPoints.length,
    };
    const tee = setup.firstHole.tee;
    const pin = setup.firstHole.pin;
    const teeDx = pin.x - tee.x;
    const teeDz = pin.z - tee.z;
    const teeLen = Math.hypot(teeDx, teeDz) || 1;
    cameras = {
      practice: { x: shortGame.x - 13, z: shortGame.z + 11, targetX: shortGame.x, targetZ: shortGame.z, pitch: -0.13 },
      starter: {
        x: starterFocus.x + 12,
        z: starterFocus.z + 14,
        targetX: starterFocus.x,
        targetZ: starterFocus.z,
        pitch: -0.1,
      },
      firstTee: {
        x: tee.x - (teeDx / teeLen) * 9 - (teeDz / teeLen) * 4,
        z: tee.z - (teeDz / teeLen) * 9 + (teeDx / teeLen) * 4,
        targetX: tee.x + (teeDx / teeLen) * 64,
        targetZ: tee.z + (teeDz / teeLen) * 64,
        pitch: -0.045,
      },
    };

    await placeCamera(page, cameras.practice);
    await page.screenshot({ path: path.join(OUT, '01-practice-short-game.png') });
    stages.practice = await liveFacts(page);

    await tickTo(page, 580);
    await placeCamera(page, cameras.starter);
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, '02-starter-lineup.png') });
    stages.starter = await liveFacts(page);

    await tickTo(page, 600.6);
    await placeCamera(page, cameras.starter);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '03-starter-call.png') });
    stages.firstTeeCall = await liveFacts(page);

    await placeCamera(page, cameras.firstTee);
    await tickTo(page, 602.9);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, '04-live-shot-and-ball.png') });
    stages.shot = await liveFacts(page);

    const walking = (await tickTo(page, 608)).find((party) => party.name === 'Avery Monroe');
    cameras.walking = {
      x: walking.position.x + 8,
      z: walking.position.z + 7,
      targetX: walking.position.x,
      targetZ: walking.position.z,
      pitch: -0.11,
    };
    await placeCamera(page, cameras.walking);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, '05-walking-group.png') });
    stages.walking = await liveFacts(page);

    const riding = (await tickTo(page, 634)).find((party) => party.name === 'Devon Park');
    cameras.riding = {
      x: riding.position.x + 9,
      z: riding.position.z + 8,
      targetX: riding.position.x,
      targetZ: riding.position.z,
      pitch: -0.11,
    };
    await placeCamera(page, cameras.riding);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, '06-riding-cart.png') });
    stages.riding = await liveFacts(page);

    const congested = await tickTo(page, 700);
    const observed = congested.find((party) => party.state === 'waiting-on-group-ahead') || congested[1] || congested[0];
    cameras.congestion = {
      x: observed.position.x + 12,
      z: observed.position.z + 10,
      targetX: observed.position.x,
      targetZ: observed.position.z,
      pitch: -0.1,
    };
    await placeCamera(page, cameras.congestion);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, '07-pace-congestion.png') });
    stages.congestion = await liveFacts(page);

    // Open the physical clubhouse laptop with the supported E interaction.
    await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = 8.45 + origin.x;
      walk.z = 4.5 + origin.z;
      walk.yaw = -Math.PI / 2;
      walk.pitch = -0.05;
    });
    await page.waitForTimeout(300);
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10000 });
    await page.locator('.lt-navbtn[title="Course"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '08-laptop-live-course.png') });
    stages.laptopCourseText = await page.locator('.lt-content').innerText();
    await page.locator('.lt-navbtn[title="Carts & rentals"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '09-laptop-cart-fleet.png') });
    stages.laptopFleetText = await page.locator('.lt-content').innerText();
  } finally {
    await context.close();
    videoPath = video ? await video.path().catch(() => null) : null;
    await browser.close();
  }

  const evidence = {
    capturedAt: new Date().toISOString(),
    branch: 'overnight/golf-gameplay-loop',
    commit: process.env.QA_COMMIT || null,
    browser: await chromium.launch({ channel: 'chrome', headless: true }).then(async (instance) => {
      const version = instance.version();
      await instance.close();
      return version;
    }),
    viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
    setup,
    cameras,
    stages,
    videoPath,
    consoleMessages,
    pageErrors,
    failedRequests,
    hardFailures: {
      pageErrors,
      consoleErrors: consoleMessages.filter((entry) => entry.type === 'error'),
      nonAbortedRequests: failedRequests.filter((entry) => !entry.failure.includes('ERR_ABORTED')),
    },
  };
  fs.writeFileSync(path.join(OUT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    out: OUT,
    screenshots: 9,
    activeParties: stages.congestion?.parties?.length,
    pageErrors,
    consoleErrors: evidence.hardFailures.consoleErrors,
    nonAbortedRequests: evidence.hardFailures.nonAbortedRequests,
    videoPath,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

'use strict';

// Focused runtime proof for an assigned golf cart. Setup uses the production
// reservation and payment APIs plus the golf-day compatibility contract;
// browser entry and player movement use normal controls. The sample loop then
// proves the authored cart rig responds to real simulated route travel.

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const URL = process.env.QA_URL || 'http://127.0.0.1:8457/';
const OUT = path.resolve(process.env.QA_OUT || path.join(ROOT, 'qa', 'golf-carts', 'browser', 'iteration-04', 'motion'));
const END_MINUTE = Number(process.env.QA_END_MINUTE || 640);
const VIEWPORT = { width: 1600, height: 900 };

fs.mkdirSync(path.join(OUT, 'video'), { recursive: true });

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
  await page.keyboard.down('w');
  await page.waitForTimeout(300);
  await page.keyboard.up('w');
}

async function installRideFixture(page) {
  return page.evaluate(async () => {
    const app = window.__fw;
    const reservations = await import('/src/sim/reservations.js');
    const golf = await import('/src/sim/golfDay.js');
    const time = await import('/src/sim/time.js');
    const campaign = await import('/src/sim/campaign.js');
    campaign.disableCampaign(app.state);
    app.state.tutorial.complete = true;
    app.state.tutorial.hidden = true;
    app.state.weather.locked = true;
    app.state.weather.today = { tempHiF: 68, tempLoF: 52, rainIn: 0, humidity: 0.46, windMph: 3 };
    app.speedIdx = 0;
    const dayAbs = time.calendarOf(app.state.clock.minutes).dayAbs;
    const day = golf.ensureGolfDay(app.state);
    const arrivalMinute = 560;
    const teeMinute = 600;
    const absoluteArrival = dayAbs * 1440 + arrivalMinute;
    app.state.clock.minutes = absoluteArrival;
    const holder = 'Cart Motion Pair';
    const booked = reservations.bookSlot(app.state, dayAbs, teeMinute, {
      name: holder,
      holder,
      customerNames: [holder, `${holder} Guest 2`],
      partySize: 2,
      transport: 'cart',
    });
    if (!booked.ok) throw new Error(`Ride booking failed: ${booked.reason}`);
    const reservation = booked.res;
    for (const result of [
      reservations.markReservationArrived(app.state, reservation.id, absoluteArrival),
      reservations.confirmReservation(app.state, reservation.id, absoluteArrival),
    ]) if (!result.ok) throw new Error(`Ride arrival failed: ${result.reason}`);
    const payment = reservations.beginReservationPayment(app.state, reservation.id, 'card');
    if (!payment.ok) throw new Error(`Ride payment failed: ${payment.reason}`);
    const paid = reservations.completeReservationPayment(app.state, reservation.id, {
      transactionId: payment.pending?.transactionId,
      cardApproved: true,
    });
    if (!paid.ok) throw new Error(`Ride payment completion failed: ${paid.reason}`);
    // The current front-desk branch has not yet reconciled its flat reservation
    // record with the nested compatibility view consumed by golfDay. Populate
    // that view directly after the real payment succeeds so this cart-specific
    // harness does not alter or bypass production money movement.
    reservation.status = 'played';
    reservation.reservationStatus = 'played';
    reservation.checkInStatus = 'checked-in';
    reservation.checkedInAt = absoluteArrival;
    reservation.arrivalStatus = 'arrived';
    reservation.arrivalTime = absoluteArrival;
    reservation.arrivedAt = absoluteArrival;
    reservation.arrival = { status: 'arrived', arrivedAtMinute: absoluteArrival };
    reservation.checkIn = { status: 'checked-in', checkedInAtMinute: absoluteArrival };
    reservation.courseAccess = { status: 'granted', assignedCourse: 'Main Course', startingHole: 1 };
    reservation.party = {
      holder,
      transport: 'ride',
      members: reservation.groupMembers.map((member, index) => ({
        id: member.customerId || `${reservation.id}-member-${index + 1}`,
        name: member.name || member.fullName,
        memberStatus: 'guest',
      })),
    };
    golf.golfDayTick(app.state, absoluteArrival + 0.05);
    const party = day.parties.find((entry) => entry.reservationId === reservation.id);
    if (!party) throw new Error('Paid riding reservation did not create a live party.');
    const cart = day.carts.find((entry) => entry.id === party.cartId);
    if (!cart) throw new Error('Riding party did not receive a fleet cart.');
    cart.tierId = 'premium';
    cart.batteryPercent = 86;
    cart.condition = 94;
    app.scene3d.applyTimeWeather(app.state.clock.minutes, app.state.weather);
    app.scene3d.clubhouse?.()?.refreshCampaign?.();
    app.scene3d.clubhouse?.()?.setOrganicWalkins?.(false);
    return {
      seed: app.state.seed,
      dayAbs,
      arrivalMinute,
      teeMinute,
      reservationId: reservation.id,
      partyId: party.id,
      cartId: cart.id,
      tierId: cart.tierId,
    };
  });
}

async function tickAndSample(page, fixture, localMinute) {
  await page.evaluate(async ({ dayAbs, minute }) => {
    const app = window.__fw;
    const golf = await import('/src/sim/golfDay.js');
    const absolute = dayAbs * 1440 + minute;
    app.state.clock.minutes = absolute;
    golf.golfDayTick(app.state, absolute);
    app.scene3d.applyTimeWeather(absolute, app.state.weather);
  }, { dayAbs: fixture.dayAbs, minute: localMinute });
  await page.waitForTimeout(90);
  return page.evaluate(({ partyId, minute }) => {
    const app = window.__fw;
    const party = app.state.golfDay.parties.find((entry) => entry.id === partyId);
    const group = app.scene3d.scene.getObjectByName('LiveGolfCarts');
    const root = group?.children.find((child) => child.name.endsWith(`_${partyId}`));
    const rig = root?.userData?.golfCartRig;
    const wheel = rig?.wheels?.[0];
    const steer = rig?.steer?.[0];
    const golferRoots = [];
    const golferIds = new Set((party?.golfers || []).map((golfer) => golfer.id));
    app.scene3d.scene.traverse((object) => {
      if (golferIds.has(object.userData?.golferId)) golferRoots.push(object);
    });
    const seated = golferRoots.map((character) => {
      const anchorName = character.userData?.golfCartSeatAnchor || null;
      const anchor = rig?.anchors?.get(anchorName) || null;
      if (!anchor) return { golferId: character.userData?.golferId || null, anchorName, horizontalError: null, footAnchorError: null };
      // Character articulation updates child transforms immediately, while the
      // renderer may not have propagated every descendant matrix before this
      // 90 ms sample. Force the complete pose current before measuring soles.
      character.updateWorldMatrix(true, true);
      anchor.updateWorldMatrix(true, false);
      const characterPoint = character.getWorldPosition(character.position.clone());
      const anchorPoint = anchor.getWorldPosition(anchor.position.clone());
      const suffix = anchorName.replace(/^SEAT_ANCHOR_/, '');
      const footAnchors = [
        rig.anchors.get(`FOOT_ANCHOR_L_${suffix}`),
        rig.anchors.get(`FOOT_ANCHOR_R_${suffix}`),
      ].filter(Boolean);
      const footY = footAnchors.length
        ? footAnchors.reduce((sum, foot) => sum + foot.getWorldPosition(foot.position.clone()).y, 0) / footAnchors.length
        : null;
      let minimumMeshY = Infinity;
      const corner = character.position.clone();
      character.traverse((object) => {
        if (!object.isMesh || !object.geometry) return;
        for (let cursor = object; cursor && cursor !== character.parent; cursor = cursor.parent) {
          if (!cursor.visible) return;
        }
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        const bounds = object.geometry.boundingBox;
        if (!bounds) return;
        for (const x of [bounds.min.x, bounds.max.x]) {
          for (const y of [bounds.min.y, bounds.max.y]) {
            for (const z of [bounds.min.z, bounds.max.z]) {
              corner.set(x, y, z).applyMatrix4(object.matrixWorld);
              minimumMeshY = Math.min(minimumMeshY, corner.y);
            }
          }
        }
      });
      return {
        golferId: character.userData?.golferId || null,
        anchorName,
        horizontalError: Math.hypot(characterPoint.x - anchorPoint.x, characterPoint.z - anchorPoint.z),
        footAnchorError: Number.isFinite(footY) && Number.isFinite(minimumMeshY) ? Math.abs(minimumMeshY - footY) : null,
        rootY: characterPoint.y,
        seatAnchorY: anchorPoint.y,
        footAnchorY: Number.isFinite(footY) ? footY : null,
        minimumMeshY: Number.isFinite(minimumMeshY) ? minimumMeshY : null,
      };
    });
    let bag = null;
    app.scene3d.scene.traverse((object) => {
      if (object.userData?.golfCartAccessory === 'bag' && object.userData?.golfCartPartyId === partyId) bag = object;
    });
    const bagSlotName = bag?.userData?.golfCartBagSlot || null;
    const bagSlot = bagSlotName ? rig?.anchors?.get(bagSlotName) : null;
    const bagPoint = bag?.getWorldPosition(bag.position.clone()) || null;
    const bagSlotPoint = bagSlot?.getWorldPosition(bagSlot.position.clone()) || null;
    const vectorSample = (vector) => vector ? {
      x: Number.isFinite(vector.x) ? vector.x : null,
      y: Number.isFinite(vector.y) ? vector.y : null,
      z: Number.isFinite(vector.z) ? vector.z : null,
      finite: [vector.x, vector.y, vector.z].every(Number.isFinite),
    } : null;
    return {
      minute,
      partyState: party?.state || null,
      routeTransport: party?.routeTransport || null,
      cartLoaded: Boolean(party?.cartLoaded),
      partyPosition: party ? { x: party.position.x, z: party.position.z } : null,
      rootName: root?.name || null,
      rootPosition: root ? { x: root.position.x, z: root.position.z } : null,
      wheelCount: rig?.wheels?.length || 0,
      steerCount: rig?.steer?.length || 0,
      authoredSeatAnchors: rig?.seatAnchors?.length || 0,
      seatedCount: seated.filter((entry) => entry.anchorName).length,
      maxSeatHorizontalError: Math.max(0, ...seated.map((entry) => entry.horizontalError).filter(Number.isFinite)),
      maxFootAnchorError: Math.max(0, ...seated.map((entry) => entry.footAnchorError).filter(Number.isFinite)),
      seated,
      bagSlotName,
      bagSlotDistance: bagPoint && bagSlotPoint ? bagPoint.distanceTo(bagSlotPoint) : null,
      bagPoint: vectorSample(bagPoint),
      bagSlotPoint: vectorSample(bagSlotPoint),
      wheelRoll: wheel ? wheel.node.rotation.x - wheel.baseX : null,
      steerAngle: steer ? steer.node.rotation.y - steer.baseY : null,
      steeringWheelAngle: rig?.steeringWheel && rig?.steeringWheelBase
        ? rig.steeringWheel.rotation.z - rig.steeringWheelBase.z
        : null,
    };
  }, { partyId: fixture.partyId, minute: localMinute });
}

function distance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.z - a.z);
}

async function main() {
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--enable-webgl', '--ignore-gpu-blocklist'],
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
  });
  const page = await context.newPage();
  const video = page.video();
  page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text().slice(0, 900) }));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'failed',
  }));

  let fixture;
  const samples = [];
  let screenshotMinute = null;
  let videoPath = null;
  try {
    await startNewProperty(page);
    fixture = await installRideFixture(page);
    for (let minute = fixture.arrivalMinute + 0.1; minute <= END_MINUTE; minute += 0.5) {
      const sample = await tickAndSample(page, fixture, Number(minute.toFixed(2)));
      samples.push(sample);
      if (sample.rootPosition) {
        await page.evaluate(({ position }) => {
          const walk = window.__fw.scene3d.walk;
          walk.clearKeys?.();
          walk.state.x = position.x + 7.2;
          walk.state.z = position.z + 6.2;
          walk.state.yaw = Math.atan2(7.2, 6.2);
          walk.state.pitch = -0.12;
        }, { position: sample.rootPosition });
      }
      if (screenshotMinute == null && sample.routeTransport === 'ride' && /travel|return/i.test(sample.partyState || '')) {
        await page.waitForTimeout(220);
        await page.evaluate(() => {
          for (const button of document.querySelectorAll('button.notification-dismiss')) button.click();
        });
        const canvas = page.locator('canvas').first();
        if (await canvas.isVisible().catch(() => false)) await canvas.click({ position: { x: 800, y: 450 } });
        await page.waitForTimeout(220);
        await page.screenshot({ path: path.join(OUT, '01-premium-cart-live-route.png'), animations: 'disabled' });
        screenshotMinute = sample.minute;
      }
    }
    if (screenshotMinute == null) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, '01-premium-cart-live-route.png'), animations: 'disabled' });
    }
  } finally {
    await context.close();
    videoPath = video ? await video.path().catch(() => null) : null;
    await browser.close();
  }

  const rooted = samples.filter((sample) => sample.rootPosition);
  let routeDistance = 0;
  for (let index = 1; index < rooted.length; index++) {
    routeDistance += distance(rooted[index - 1].rootPosition, rooted[index].rootPosition);
  }
  const wheelValues = rooted.map((sample) => sample.wheelRoll).filter(Number.isFinite);
  const steeringValues = rooted.flatMap((sample) => [sample.steerAngle, sample.steeringWheelAngle]).filter(Number.isFinite);
  const wheelTravel = wheelValues.length ? Math.max(...wheelValues) - Math.min(...wheelValues) : 0;
  const maxSteering = steeringValues.length ? Math.max(...steeringValues.map(Math.abs)) : 0;
  const seatedSamples = rooted.filter((sample) => (
    sample.seatedCount >= 2
      && Number.isFinite(sample.maxSeatHorizontalError)
      && Number.isFinite(sample.maxFootAnchorError)
  ));
  const bagSamples = rooted.filter((sample) => (
    sample.cartLoaded && sample.bagSlotName && Number.isFinite(sample.bagSlotDistance)
  ));
  const unexpectedFailedRequests = failedRequests.filter((entry) => !entry.failure.includes('ERR_ABORTED'));
  const checks = {
    realRidingParty: rooted.some((sample) => sample.routeTransport === 'ride'),
    premiumModelAssigned: rooted.some((sample) => sample.rootName?.startsWith('GolfCart_premium_')),
    rootTraveled: routeDistance > 3,
    fourWheelsAuthored: rooted.some((sample) => sample.wheelCount === 4),
    frontSteeringAuthored: rooted.some((sample) => sample.steerCount === 2),
    wheelsRolled: wheelTravel > 0.2,
    steeringResponded: maxSteering > 0.01,
    occupantsUseAuthoredSeats: seatedSamples.some((sample) => (
      sample.authoredSeatAnchors >= 4
        && sample.maxSeatHorizontalError < 0.12
        && sample.maxFootAnchorError < 0.18
    )),
    golfBagUsesAuthoredSlot: bagSamples.some((sample) => sample.bagSlotDistance < 0.08),
    noPageErrors: pageErrors.length === 0,
    noConsoleErrors: consoleMessages.every((message) => message.type !== 'error'),
    noRequestFailures: unexpectedFailedRequests.length === 0,
  };
  const evidence = {
    capturedAt: new Date().toISOString(),
    browserEntry: ['New game', 'Relaxed', 'Buy', 'W movement'],
    viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
    fixture,
    metrics: {
      samples: samples.length,
      rootedSamples: rooted.length,
      routeDistanceYards: Number(routeDistance.toFixed(3)),
      wheelTravelRadians: Number(wheelTravel.toFixed(3)),
      maxSteeringRadians: Number(maxSteering.toFixed(3)),
      seatedSamples: seatedSamples.length,
      bagSlotSamples: bagSamples.length,
      bestSeatHorizontalErrorYd: seatedSamples.length
        ? Number(Math.min(...seatedSamples.map((sample) => sample.maxSeatHorizontalError)).toFixed(4))
        : null,
      bestFootAnchorErrorYd: seatedSamples.length
        ? Number(Math.min(...seatedSamples.map((sample) => sample.maxFootAnchorError)).toFixed(4))
        : null,
      bestBagSlotDistanceYd: bagSamples.length
        ? Number(Math.min(...bagSamples.map((sample) => sample.bagSlotDistance)).toFixed(4))
        : null,
    },
    checks,
    samples,
    screenshot: '01-premium-cart-live-route.png',
    screenshotMinute,
    videoPath,
    consoleMessages,
    pageErrors,
    failedRequests,
    unexpectedFailedRequests,
  };
  fs.writeFileSync(path.join(OUT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ out: OUT, metrics: evidence.metrics, checks, videoPath }, null, 2)}\n`);
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) throw new Error(`Golf-cart motion QA failed: ${failed.join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

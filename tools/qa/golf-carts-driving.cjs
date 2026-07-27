'use strict';

// Player-driving acceptance evidence for the authored golf-cart fleet. State
// setup controls only the owned tier, weather, and camera staging. Entry, drive,
// steer, brake, reverse, lights, camera switching, and exit all use normal keys.

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const URL = process.env.QA_URL || 'http://127.0.0.1:8457/';
const ITERATION = process.env.QA_ITERATION || '04';
const TIER = process.env.QA_TIER || 'basic';
const HOUR = Number(process.env.QA_HOUR || 18.5833);
const OUT = path.resolve(process.env.QA_OUT || path.join(ROOT, 'qa', 'golf-carts', 'browser', `iteration-${ITERATION}-driving-${TIER}`));
const VIEWPORT = { width: 1600, height: 900 };

fs.mkdirSync(path.join(OUT, 'video'), { recursive: true });

async function waitForWorld(page) {
  await page.waitForFunction(() => (
    window.__fw?.screen === 'game'
      && window.__fw?.scene3d?.walk?.isActive?.()
      && window.__fw?.scene3d?.clubhouse?.()
      && window.__fw?.prewarming !== true
  ), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
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
  return page.evaluate(async ({ tier, hour }) => {
    const app = window.__fw;
    const { ensureGolfDay } = await import('/src/sim/golfDay.js');
    const { disableCampaign } = await import('/src/sim/campaign.js');
    disableCampaign(app.state);
    const day = ensureGolfDay(app.state);
    app.state.tutorial.complete = true;
    app.state.tutorial.hidden = true;
    app.state.weather.locked = true;
    app.state.weather.today = { tempHiF: 67, tempLoF: 51, rainIn: 0, humidity: 0.48, windMph: 3 };
    const dayStart = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = dayStart + hour * 60;
    app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
    day.carts.splice(1);
    const cart = day.carts[0];
    const barn = day.routeNetwork?.facilities?.cartBarn;
    if (!barn) throw new Error('Cart-service bay missing from route network.');
    Object.assign(cart, {
      tierId: tier,
      status: 'available',
      assignedPartyId: null,
      assignedStaffId: null,
      condition: 100,
      batteryPercent: 100,
      position: { x: barn.x - 12, z: barn.z + 7 },
      yaw: Math.PI * 0.18,
      lightsOn: false,
      parkedByPlayer: true,
      drivenDistanceYd: 0,
      homeSlot: 0,
      serviceReadyMinute: null,
    });
    app.scene3d.applyTimeWeather(app.state.clock.minutes, app.state.weather);
    app.scene3d.clubhouse?.()?.refreshCampaign?.();
    app.scene3d.clubhouse?.()?.setOrganicWalkins?.(false);
    app.scene3d.setGolfersVisible?.(false);
    return { cartId: cart.id, tier, barn: { x: barn.x, z: barn.z }, minute: app.state.clock.minutes };
  }, { tier: TIER, hour: HOUR });
}

async function waitForCart(page, cartId) {
  await page.waitForFunction(({ id, tier }) => {
    const group = window.__fw?.scene3d?.scene?.getObjectByName('LiveGolfCarts');
    const root = group?.children?.find((child) => child.name.endsWith(`_${id}`));
    const rig = root?.userData?.golfCartRig;
    const expectedSeats = { basic: 2, standard: 2, premium: 4, high_end: 4, luxury: 6 }[tier];
    return root?.userData?.golfCartTierId === tier
      && !!rig?.anchors?.get('ENTRY_POINT_Seat_Driver')
      && rig.seatAnchors?.length === expectedSeats
      && (tier !== 'luxury' || rig.hinges?.some((hinge) => hinge.name === 'Door_FL'));
  }, { id: cartId, tier: TIER }, { timeout: 30_000 });
  await page.waitForTimeout(1800);
}

async function dismissNotifications(page) {
  for (let index = 0; index < 32; index++) {
    const dismissed = await page.evaluate(() => {
      const button = document.querySelector('button.notification-dismiss');
      if (!button || getComputedStyle(button).display === 'none') return false;
      button.click();
      return true;
    }).catch(() => false);
    if (!dismissed) break;
    await page.waitForTimeout(70);
  }
}

async function resumeLooking(page) {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(180);
  return page.evaluate(() => !!document.pointerLockElement);
}

async function stageAtDriverEntry(page, cartId) {
  return page.evaluate((id) => {
    const app = window.__fw;
    const group = app.scene3d.scene.getObjectByName('LiveGolfCarts');
    const root = group.children.find((child) => child.name.endsWith(`_${id}`));
    const anchor = root.userData.golfCartRig.anchors.get('ENTRY_POINT_Seat_Driver');
    const entry = root.position.clone();
    anchor.getWorldPosition(entry);
    const outwardX = entry.x - root.position.x;
    const outwardZ = entry.z - root.position.z;
    const length = Math.max(0.001, Math.hypot(outwardX, outwardZ));
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.state.x = entry.x + outwardX / length * 1.05;
    walk.state.z = entry.z + outwardZ / length * 1.05;
    walk.state.yaw = Math.atan2(-(root.position.x - walk.state.x), -(root.position.z - walk.state.z));
    walk.state.pitch = -0.04;
    return {
      root: { x: root.position.x, y: root.position.y, z: root.position.z, yaw: root.rotation.y },
      entry: { x: entry.x, y: entry.y, z: entry.z },
      walk: { x: walk.state.x, z: walk.state.z, yaw: walk.state.yaw },
      anchors: [...root.userData.golfCartRig.anchors.keys()].sort(),
      colliders: root.userData.golfCartRig.colliders.map((collider) => collider.name).sort(),
    };
  }, cartId);
}

async function stageCartOverview(page, cartId, localX = -2.65, localZ = 0.20) {
  return page.evaluate(({ id, localX: x, localZ: z }) => {
    const app = window.__fw;
    const root = app.scene3d.scene.getObjectByName('LiveGolfCarts').children.find((child) => child.name.endsWith(`_${id}`));
    const vantage = root.position.clone().set(x, 0, z);
    root.localToWorld(vantage);
    const walk = app.scene3d.walk.state;
    app.scene3d.walk.clearKeys?.();
    walk.x = vantage.x;
    walk.z = vantage.z;
    walk.yaw = Math.atan2(-(root.position.x - walk.x), -(root.position.z - walk.z));
    walk.pitch = -0.16;
    return { x: walk.x, z: walk.z, yaw: walk.yaw };
  }, { id: cartId, localX, localZ });
}

async function focusLabel(page, pattern, timeout = 10_000) {
  await page.waitForFunction((source) => new RegExp(source, 'i').test(
    window.__fw?.scene3d?.walk?.getFocus?.()?.label || '',
  ), pattern.source, { timeout });
  return page.evaluate(() => window.__fw.scene3d.walk.getFocus()?.label || '');
}

async function waitForDriverDoor(page, cartId, expected, timeout = 10_000) {
  await page.waitForFunction(({ id, open }) => {
    const roots = window.__fw?.scene3d?.scene?.getObjectByName('LiveGolfCarts')?.children || [];
    const root = roots.find((child) => child.name.endsWith(`_${id}`));
    const hinge = root?.userData?.golfCartRig?.hinges?.find((entry) => entry.name === 'Door_FL');
    if (!hinge) return true;
    return open ? hinge.open && hinge.amount >= 0.94 : !hinge.open && hinge.amount <= 0.05;
  }, { id: cartId, open: expected }, { timeout });
  return page.evaluate((id) => {
    const roots = window.__fw.scene3d.scene.getObjectByName('LiveGolfCarts').children;
    const root = roots.find((child) => child.name.endsWith(`_${id}`));
    const hinge = root?.userData?.golfCartRig?.hinges?.find((entry) => entry.name === 'Door_FL');
    return hinge ? { open: hinge.open, amount: hinge.amount } : null;
  }, cartId);
}

async function shot(page, name) {
  await page.waitForTimeout(520);
  await dismissNotifications(page);
  await resumeLooking(page);
  await page.waitForTimeout(110);
  await dismissNotifications(page);
  await resumeLooking(page);
  await page.waitForTimeout(80);
  await dismissNotifications(page);
  await page.screenshot({ path: path.join(OUT, name), animations: 'disabled' });
  return name;
}

async function aimAtCartFromPlayer(page, cartId) {
  await stageCartOverview(page, cartId, -2.90, -1.40);
}

async function snapshot(page, cartId) {
  return page.evaluate((id) => {
    const app = window.__fw;
    const fleet = app.state.golfDay.carts.find((cart) => cart.id === id);
    const root = app.scene3d.scene.getObjectByName('LiveGolfCarts').children.find((child) => child.name.endsWith(`_${id}`));
    const rig = root?.userData?.golfCartRig;
    return {
      speedIdx: app.speedIdx,
      audio: app.audio?.toolLoopDiagnostics?.() || null,
      controller: { ...app.scene3d.walk.cart },
      walk: { ...app.scene3d.walk.state },
      fleet: fleet ? JSON.parse(JSON.stringify(fleet)) : null,
      root: root ? {
        position: root.position.toArray(),
        rotation: [root.rotation.x, root.rotation.y, root.rotation.z, root.rotation.order],
        yaw: root.rotation.y,
        wheelRoll: rig?.wheelRoll,
        steerVisual: rig?.steerVisual,
        lightsOn: rig?.lightsOn,
        braking: rig?.braking,
        indicatorSide: rig?.indicatorSide,
        indicatorPhase: rig?.indicatorPhase,
        indicatorIntensity: {
          left: [...(rig?.lightMaterials?.indicator?.left || [])].map((material) => material.emissiveIntensity),
          right: [...(rig?.lightMaterials?.indicator?.right || [])].map((material) => material.emissiveIntensity),
        },
        headlightIntensity: rig?.runtimeLights?.head?.map((light) => light.intensity) || [],
        tailIntensity: rig?.runtimeLights?.tail?.map((light) => light.intensity) || [],
        hinges: rig?.hinges?.map((hinge) => ({ name: hinge.name, open: hinge.open, amount: hinge.amount })) || [],
      } : null,
      focus: app.scene3d.walk.getFocus?.()?.label || null,
      camera: {
        position: app.scene3d.camera.position.toArray(),
        rotation: app.scene3d.camera.rotation.toArray(),
        fov: app.scene3d.camera.fov,
      },
    };
  }, cartId);
}

async function restoredCartSnapshot(page, cartId) {
  return page.evaluate(async (id) => {
    const { serialize, deserialize } = await import('/src/sim/state.js');
    const restored = deserialize(serialize(window.__fw.state));
    const cart = restored.golfDay.carts.find((entry) => entry.id === id);
    return JSON.parse(JSON.stringify(cart));
  }, cartId);
}

async function installCollisionObstacle(page, cartId) {
  return page.evaluate((id) => {
    const app = window.__fw;
    const day = app.state.golfDay;
    const driven = day.carts.find((entry) => entry.id === id);
    const root = app.scene3d.scene.getObjectByName('LiveGolfCarts').children.find((child) => child.name.endsWith(`_${id}`));
    if (!driven || !root) throw new Error('Driven cart is unavailable for collision staging.');
    const yaw = app.scene3d.walk.cart.yaw;
    const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: -forward.z, z: forward.x };
    const distance = 5.2;
    // Keep the obstacle inside the impact envelope while exposing one side in
    // the chase-camera proof frame. A centered obstacle is fully occluded by
    // the driven cart even when the authored colliders stop it correctly.
    const lateralOffset = 0.95;
    const obstacleId = day.carts.some((entry) => entry.id === 'cart-2') ? 'cart-qa-obstacle' : 'cart-2';
    day.carts.push({
      id: obstacleId,
      tierId: 'basic',
      status: 'available',
      assignedPartyId: null,
      assignedStaffId: null,
      condition: 100,
      batteryPercent: 100,
      position: {
        x: root.position.x + forward.x * distance + right.x * lateralOffset,
        z: root.position.z + forward.z * distance + right.z * lateralOffset,
      },
      yaw,
      lightsOn: false,
      parkedByPlayer: true,
      drivenDistanceYd: 0,
      homeSlot: day.carts.length,
      trips: 0,
      upgrades: 0,
      serviceReadyMinute: null,
      lastReturnedMinute: null,
    });
    return {
      obstacleId,
      distance,
      lateralOffset,
      forward,
      start: { x: root.position.x, z: root.position.z },
    };
  }, cartId);
}

async function waitForCollisionObstacle(page, obstacleId) {
  await page.waitForFunction((id) => {
    const group = window.__fw?.scene3d?.scene?.getObjectByName('LiveGolfCarts');
    const root = group?.children?.find((child) => child.name.endsWith(`_${id}`));
    return !!root?.userData?.golfCartRig?.colliders?.length;
  }, obstacleId, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function collisionSnapshot(page, fixture, cartId) {
  return page.evaluate(({ fixture: staged, id }) => {
    const app = window.__fw;
    const roots = app.scene3d.scene.getObjectByName('LiveGolfCarts').children;
    const driven = roots.find((child) => child.name.endsWith(`_${id}`));
    const obstacle = roots.find((child) => child.name.endsWith(`_${staged.obstacleId}`));
    if (!driven || !obstacle) throw new Error('Collision roots are unavailable.');
    const displacement = {
      x: driven.position.x - staged.start.x,
      z: driven.position.z - staged.start.z,
    };
    return {
      driven: { x: driven.position.x, z: driven.position.z },
      obstacle: { x: obstacle.position.x, z: obstacle.position.z },
      centerDistance: Math.hypot(driven.position.x - obstacle.position.x, driven.position.z - obstacle.position.z),
      forwardProgress: displacement.x * staged.forward.x + displacement.z * staged.forward.z,
      lateralDrift: Math.abs(displacement.x * -staged.forward.z + displacement.z * staged.forward.x),
      velocity: app.scene3d.walk.cart.velocity,
    };
  }, { fixture, id: cartId });
}

async function main() {
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--enable-webgl', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
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
  page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text().slice(0, 1200) }));
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || 'failed' }));
  const evidence = {
    iteration: ITERATION,
    tier: TIER,
    capturedAt: new Date().toISOString(),
    viewport: VIEWPORT,
    inputs: [],
    screenshots: [],
    consoleMessages,
    pageErrors,
    failedRequests,
  };
  try {
    await startNewProperty(page);
    evidence.inputs.push('Main menu > New game', 'Relaxed mode', 'Marketplace > Buy');
    evidence.fixture = await installFixture(page);
    await waitForCart(page, evidence.fixture.cartId);
    evidence.overviewStage = await stageCartOverview(page, evidence.fixture.cartId);
    evidence.overviewFocus = await focusLabel(page, /cart-1/i);
    evidence.screenshots.push(await shot(page, '00-cart-overview.png'));
    evidence.entryStage = await stageAtDriverEntry(page, evidence.fixture.cartId);
    evidence.focusBeforeEntry = await focusLabel(page, /enter driver seat|open to enter/);
    evidence.screenshots.push(await shot(page, '01-before-entry.png'));
    await page.keyboard.press('e');
    evidence.inputs.push('E > driver entry interaction');
    if (/open to enter/i.test(evidence.focusBeforeEntry)) {
      evidence.openDoorFocus = await focusLabel(page, /enter driver seat/);
      evidence.driverDoorOpen = await waitForDriverDoor(page, evidence.fixture.cartId, true);
      // Pull back for an unambiguous view of the moving leaf, then return to
      // the authored entry point so the second E press remains normal input.
      await stageCartOverview(page, evidence.fixture.cartId, -3.05, -1.45);
      evidence.screenshots.push(await shot(page, '02-door-open.png'));
      await stageAtDriverEntry(page, evidence.fixture.cartId);
      await focusLabel(page, /enter driver seat/);
      await page.keyboard.press('e');
      evidence.inputs.push('E > enter through open driver door');
    }
    await page.waitForFunction(() => (
      window.__fw.scene3d.walk.cart.mounted
        && window.__fw.scene3d.walk.cart.vehicleKind === 'golf-cart'
    ), null, { timeout: 10_000 });
    evidence.driverDoorClosedAfterMount = await waitForDriverDoor(page, evidence.fixture.cartId, false);
    evidence.screenshots.push(await shot(page, '03-driver-camera-mounted.png'));
    // Capture settled camera evidence after the mount ease, not the first
    // transitional frame in which state has mounted but the eye is still moving.
    evidence.mounted = await snapshot(page, evidence.fixture.cartId);

    await page.keyboard.press('l');
    evidence.inputs.push('L > lights on');
    await page.waitForFunction((id) => window.__fw.state.golfDay.carts.find((cart) => cart.id === id)?.lightsOn === true, evidence.fixture.cartId);
    evidence.lightsOn = await snapshot(page, evidence.fixture.cartId);
    evidence.screenshots.push(await shot(page, '04-driver-camera-lights-on.png'));
    await page.keyboard.press('v');
    evidence.inputs.push('V > exterior light inspection');
    evidence.screenshots.push(await shot(page, '04b-lights-on-exterior.png'));
    await page.keyboard.press('v');

    await page.keyboard.down('w');
    await page.waitForTimeout(1150);
    await page.keyboard.down('a');
    await page.waitForTimeout(900);
    evidence.steering = await snapshot(page, evidence.fixture.cartId);
    await page.keyboard.press('v');
    evidence.inputs.push('V while steering > authored exterior camera');
    evidence.screenshots.push(await shot(page, '05-driving-steering-left-exterior.png'));
    await page.keyboard.press('v');
    await page.keyboard.up('a');
    await page.keyboard.up('w');
    evidence.inputs.push('Hold W > accelerate', 'Hold A while moving > steer left');

    await page.keyboard.down(' ');
    await page.waitForTimeout(700);
    await page.keyboard.press('v');
    evidence.braking = await snapshot(page, evidence.fixture.cartId);
    evidence.screenshots.push(await shot(page, '06-braking-exterior.png'));
    await page.keyboard.press('v');
    await page.keyboard.up(' ');
    evidence.inputs.push('Hold Space > brake');

    evidence.collisionFixture = await installCollisionObstacle(page, evidence.fixture.cartId);
    await waitForCollisionObstacle(page, evidence.collisionFixture.obstacleId);
    await page.keyboard.down('w');
    await page.waitForTimeout(2500);
    await page.keyboard.up('w');
    evidence.inputs.push('Hold W > drive into a second authored cart collider');
    evidence.collision = await collisionSnapshot(page, evidence.collisionFixture, evidence.fixture.cartId);
    await page.keyboard.press('v');
    evidence.screenshots.push(await shot(page, '06b-authored-collider-stop.png'));
    await page.keyboard.press('v');
    await page.keyboard.down(' ');
    await page.waitForTimeout(550);
    await page.keyboard.up(' ');

    await page.keyboard.down('s');
    await page.waitForTimeout(1050);
    evidence.reversing = await snapshot(page, evidence.fixture.cartId);
    await page.keyboard.up('s');
    evidence.inputs.push('Hold S > reverse');

    await page.keyboard.press('v');
    evidence.inputs.push('V > vehicle camera');
    await page.waitForFunction(() => window.__fw.scene3d.walk.cart.cameraMode === 'vehicle');
    evidence.vehicleCamera = await snapshot(page, evidence.fixture.cartId);
    evidence.screenshots.push(await shot(page, '07-authored-vehicle-camera.png'));
    await page.keyboard.press('v');
    evidence.inputs.push('V > driver camera');

    evidence.restoredWhileMounted = await restoredCartSnapshot(page, evidence.fixture.cartId);
    await page.keyboard.press('e');
    evidence.inputs.push('E > exit and park');
    await page.waitForFunction(() => !window.__fw.scene3d.walk.cart.mounted, null, { timeout: 10_000 });
    evidence.driverDoorClosedAfterExit = await waitForDriverDoor(page, evidence.fixture.cartId, false);
    evidence.exited = await snapshot(page, evidence.fixture.cartId);
    evidence.restoredAfterExit = await restoredCartSnapshot(page, evidence.fixture.cartId);
    await aimAtCartFromPlayer(page, evidence.fixture.cartId);
    evidence.screenshots.push(await shot(page, '08-parked-after-exit.png'));
    await stageCartOverview(page, evidence.fixture.cartId, -1.25, -3.65);
    evidence.screenshots.push(await shot(page, '09-front-fixtures-after-exit.png'));

    if (evidence.mounted.fleet.status !== 'player-driving') throw new Error('Fleet cart never entered player-driving status.');
    if (evidence.mounted.audio?.active !== 'cart') throw new Error('Golf cart did not use its dedicated electric motor loop.');
    if (!(evidence.steering.fleet.drivenDistanceYd > 0.25)) throw new Error('Normal W/A input did not move the cart.');
    if (!(Math.abs(evidence.steering.root.wheelRoll) > 0.05)) throw new Error('Wheel pivots did not roll while driving.');
    if (!(Math.abs(evidence.steering.root.steerVisual) > 0.02)) throw new Error('Steering pivots did not visibly steer.');
    const leftIndicator = Math.max(0, ...(evidence.steering.root.indicatorIntensity?.left || []));
    const rightIndicator = Math.max(0, ...(evidence.steering.root.indicatorIntensity?.right || []));
    if (!(evidence.steering.root.indicatorSide === 1 && leftIndicator > rightIndicator + 0.5)) {
      throw new Error('Left steering input did not produce an isolated visible left indicator state.');
    }
    if (Math.abs(evidence.steering.root.rotation[0]) > 0.225 || Math.abs(evidence.steering.root.rotation[2]) > 0.225) {
      throw new Error('Terrain grounding exceeded the cart pitch/roll stability envelope.');
    }
    const runningTail = Math.max(0, ...(evidence.lightsOn.root.tailIntensity || []));
    const brakingTail = Math.max(0, ...(evidence.braking.root.tailIntensity || []));
    const runningHead = Math.max(0, ...(evidence.lightsOn.root.headlightIntensity || []));
    if (!(runningHead > 0)) throw new Error('Normal L input did not enable the authored headlights.');
    // The lens emission supplies the visible brake-state jump; the point light
    // is deliberately restrained to avoid painting the whole rear body red.
    if (!(brakingTail > runningTail + 0.08)) throw new Error('Brake lights did not brighten.');
    if (evidence.braking.speedIdx !== 0) throw new Error('Space brake also changed the simulation speed.');
    if (!(evidence.collision.forwardProgress > 0.6
      && evidence.collision.forwardProgress < evidence.collisionFixture.distance - 0.65
      && evidence.collision.lateralDrift < 0.45)) {
      throw new Error('Authored golf-cart colliders did not stop a normal-control impact without tunneling.');
    }
    if (!(evidence.reversing.controller.velocity < 0)) throw new Error('S input did not produce reverse velocity.');
    if (evidence.restoredWhileMounted.status !== 'available' || !evidence.restoredWhileMounted.parkedByPlayer) {
      throw new Error('Mounted save did not recover as a safely parked cart.');
    }
    if (evidence.exited.fleet.status !== 'available' || !evidence.exited.fleet.parkedByPlayer) {
      throw new Error('Exit did not leave an available persisted cart.');
    }
    if (pageErrors.length || consoleMessages.some((entry) => entry.type === 'error')
      || failedRequests.some((entry) => !entry.failure.includes('ERR_ABORTED'))) {
      throw new Error('Browser hard failures were recorded during golf-cart driving QA.');
    }
  } finally {
    evidence.hardFailures = {
      pageErrors,
      consoleErrors: consoleMessages.filter((entry) => entry.type === 'error'),
      failedRequests: failedRequests.filter((entry) => !entry.failure.includes('ERR_ABORTED')),
    };
    evidence.browser = await browser.version();
    fs.writeFileSync(path.join(OUT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    await context.close();
    evidence.videoPath = video ? await video.path().catch(() => null) : null;
    fs.writeFileSync(path.join(OUT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    await browser.close();
  }
  process.stdout.write(`${JSON.stringify({
    out: OUT,
    tier: TIER,
    screenshots: evidence.screenshots,
    videoPath: evidence.videoPath,
    hardFailures: evidence.hardFailures,
    mounted: evidence.mounted?.fleet,
    exited: evidence.exited?.fleet,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

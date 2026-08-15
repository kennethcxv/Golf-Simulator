'use strict';

// Production browser evidence for the authored five-tier cart fleet. The QA
// fixture controls only inventory/condition and camera staging. Every cart-part
// interaction uses the normal E key, and every fleet operation uses the physical
// clubhouse laptop and its real buttons/confirmation bars.

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const URL = process.env.QA_URL || 'http://127.0.0.1:8457/';
const ITERATION = process.env.QA_ITERATION || '03';
const OUT = path.resolve(process.env.QA_OUT || path.join(ROOT, 'qa', 'golf-carts', 'browser', `iteration-${ITERATION}`));
const VIEWPORT = { width: 1600, height: 900 };

fs.mkdirSync(OUT, { recursive: true });
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
}

async function installFixture(page) {
  return page.evaluate(async () => {
    const app = window.__fw;
    const { ensureGolfDay } = await import(new URL('src/sim/golfDay.js', document.baseURI).href);
    const { disableCampaign } = await import(new URL('src/sim/campaign.js', document.baseURI).href);
    disableCampaign(app.state);
    const day = ensureGolfDay(app.state);
    app.state.cash = 250000;
    const qaMarshal = {
      id: 99001,
      name: 'Morgan Cartwright',
      role: 'marshal',
      skill: 3,
      wage: 115,
      trainingDays: 0,
      hiredDay: 1,
    };
    if (!app.state.staff.employees.some((employee) => employee.id === qaMarshal.id)) {
      app.state.staff.employees.push(qaMarshal);
    }
    app.state.tutorial.complete = true;
    app.state.tutorial.hidden = true;
    app.state.weather.locked = true;
    app.state.weather.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.42, windMph: 5 };
    const dayStart = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = dayStart + 10 * 60 + 30;
    app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
    const tiers = ['basic', 'standard', 'premium', 'high_end', 'luxury'];
    day.carts.splice(5);
    day.carts.forEach((cart, index) => {
      cart.tierId = tiers[index];
      cart.status = 'available';
      cart.assignedPartyId = null;
      cart.position = null;
      cart.homeSlot = index;
      cart.condition = 100;
      cart.batteryPercent = 100;
      cart.serviceReadyMinute = null;
    });
    day.carts[0].batteryPercent = 37;
    day.carts[1].condition = 62;
    day.carts[3].status = 'cleaning';
    day.carts[3].serviceReadyMinute = app.state.clock.minutes + 240;
    app.scene3d.applyTimeWeather(app.state.clock.minutes, app.state.weather);
    app.scene3d.clubhouse?.()?.refreshCampaign?.();
    app.scene3d.clubhouse?.()?.setOrganicWalkins?.(false);
    app.scene3d.setGolfersFrozen(false);
    const barn = day.routeNetwork?.facilities?.cartBarn;
    if (!barn) throw new Error('Cart-service bay missing from route network.');
    return {
      seed: app.state.seed,
      minute: app.state.clock.minutes,
      cash: app.state.cash,
      marshal: { id: qaMarshal.id, name: qaMarshal.name },
      barn: { x: barn.x, z: barn.z },
      carts: day.carts.map((cart) => ({ id: cart.id, tierId: cart.tierId, status: cart.status })),
    };
  });
}

async function waitForFleet(page, expected = 5) {
  await page.waitForFunction((count) => {
    const group = window.__fw?.scene3d?.scene?.getObjectByName('LiveGolfCarts');
    if (!group) return false;
    const roots = group.children.filter((child) => child.name.startsWith('GolfCart_'));
    return roots.length === count && roots.every((root) => root.userData?.golfCartRig?.hinges);
  }, expected, { timeout: 30_000 });
  await page.waitForTimeout(3500);
}

async function dismissNotifications(page) {
  for (let index = 0; index < 24; index++) {
    const dismissed = await page.evaluate(() => {
      const button = document.querySelector('button.notification-dismiss');
      if (!button || getComputedStyle(button).display === 'none') return false;
      button.click();
      return true;
    }).catch(() => false);
    if (!dismissed) break;
    await page.waitForTimeout(120);
  }
}

async function resumeLooking(page) {
  const canvas = page.locator('canvas').first();
  if (!await canvas.isVisible().catch(() => false)) return false;
  const box = await canvas.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(350);
  return page.evaluate(() => !!document.pointerLockElement);
}

async function placeCamera(page, fixture, pose) {
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
    return { x: state.x, z: state.z, targetX, targetZ, yaw: state.yaw, pitch: state.pitch };
  }, { barn: fixture.barn, pose });
}

async function shot(page, filename) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, filename), animations: 'disabled' });
}

async function cartInventory(page) {
  return page.evaluate(() => {
    const THREE = window.__fw.scene3d.scene.constructor;
    void THREE;
    const group = window.__fw.scene3d.scene.getObjectByName('LiveGolfCarts');
    return group.children.filter((child) => child.name.startsWith('GolfCart_')).map((root) => {
      let totalMeshes = 0;
      let visibleMeshes = 0;
      let visibleTriangles = 0;
      const visibleLods = new Set();
      const materials = new Set();
      root.traverse((object) => {
        if (!object.isMesh) return;
        totalMeshes++;
        if (object.visible) {
          visibleMeshes++;
          visibleLods.add(Number(object.userData?.golfCartLod ?? object.userData?.lod_level ?? 0));
          visibleTriangles += object.geometry?.index
            ? object.geometry.index.count / 3
            : (object.geometry?.attributes?.position?.count || 0) / 3;
        }
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (material) materials.add(material.uuid);
        }
      });
      const rig = root.userData.golfCartRig;
      return {
        name: root.name,
        tierId: root.userData.golfCartTierId,
        totalMeshes,
        visibleMeshes,
        visibleTriangles: Math.round(visibleTriangles),
        visibleLods: [...visibleLods].sort(),
        materials: materials.size,
        wheels: rig?.wheels?.length || 0,
        steerPivots: rig?.steer?.length || 0,
        hinges: (rig?.hinges || []).map((hinge) => hinge.name),
        batch: root.userData.golfCartBatch || null,
        position: { x: root.position.x, y: root.position.y, z: root.position.z },
      };
    });
  });
}

async function setWalkPose(page, x, z, targetX, targetZ, pitch = -0.06) {
  await page.evaluate(({ x, z, targetX, targetZ, pitch }) => {
    const walk = window.__fw.scene3d.walk;
    walk.clearKeys?.();
    walk.state.x = x;
    walk.state.z = z;
    walk.state.yaw = Math.atan2(-(targetX - x), -(targetZ - z));
    walk.state.pitch = pitch;
  }, { x, z, targetX, targetZ, pitch });
  await page.waitForTimeout(450);
}

async function cartPose(page, cartId) {
  return page.evaluate((id) => {
    const group = window.__fw.scene3d.scene.getObjectByName('LiveGolfCarts');
    const root = group.children.find((child) => child.name.endsWith(`_${id}`));
    if (!root) throw new Error(`Missing live root for ${id}.`);
    return { x: root.position.x, y: root.position.y, z: root.position.z, name: root.name };
  }, cartId);
}

async function waitFocus(page, pattern, timeout = 8000) {
  await page.waitForFunction((source) => {
    const label = window.__fw?.scene3d?.walk?.getFocus?.()?.label || '';
    return new RegExp(source, 'i').test(label);
  }, pattern.source, { timeout });
  return page.evaluate(() => window.__fw.scene3d.walk.getFocus()?.label || '');
}

async function hingeAmount(page, cartId, hingeName) {
  return page.evaluate(({ cartId, hingeName }) => {
    const group = window.__fw.scene3d.scene.getObjectByName('LiveGolfCarts');
    const root = group.children.find((child) => child.name.endsWith(`_${cartId}`));
    return root?.userData?.golfCartRig?.hinges?.find((hinge) => hinge.name === hingeName)?.amount ?? null;
  }, { cartId, hingeName });
}

async function interactAndWaitHinge(page, cartId, hingeName) {
  await page.keyboard.press('e');
  await page.waitForFunction(({ cartId, hingeName }) => {
    const group = window.__fw?.scene3d?.scene?.getObjectByName('LiveGolfCarts');
    const root = group?.children?.find((child) => child.name.endsWith(`_${cartId}`));
    return (root?.userData?.golfCartRig?.hinges?.find((hinge) => hinge.name === hingeName)?.amount || 0) > 0.72;
  }, { cartId, hingeName }, { timeout: 8000 });
  return hingeAmount(page, cartId, hingeName);
}

async function openPhysicalLaptop(page) {
  const candidates = [[0, -0.85], [0.85, 0], [-0.85, 0], [0, 0.85], [0, -1.25]];
  let focused = '';
  for (const offset of candidates) {
    focused = await page.evaluate(async ([offsetX, offsetZ]) => {
      const app = window.__fw;
      const { FRONT_DESK } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
      const origin = app.scene3d.clubhouse().interior.position;
      const targetX = origin.x + FRONT_DESK.laptop.x;
      const targetZ = origin.z + FRONT_DESK.laptop.z;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = targetX + offsetX;
      walk.state.z = targetZ + offsetZ;
      walk.state.yaw = Math.atan2(-(targetX - walk.state.x), -(targetZ - walk.state.z));
      walk.state.pitch = -0.05;
      return app.scene3d.walk.getFocusLabel?.() || '';
    }, offset);
    await page.waitForTimeout(450);
    focused = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
    if (/laptop/i.test(focused)) break;
  }
  if (!/laptop/i.test(focused)) throw new Error(`Physical laptop did not receive focus; last focus was "${focused}".`);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw?.laptopOpen === true, null, { timeout: 10000 });
  await page.waitForFunction(() => (
    window.__fw?.scene3d?.clubhouse?.()?.laptopScreenMode?.() === 'live'
      && getComputedStyle(document.querySelector('.laptop-screen')).display !== 'none'
      && document.querySelector('.lt-frame')?.getBoundingClientRect().width > 500
  ), null, { timeout: 20000 });
  await page.waitForTimeout(850);
}

async function clickCenter(page, locator) {
  await locator.waitFor({ state: 'visible', timeout: 12000 });
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ timeout: 12000 });
}

async function openFleetTab(page) {
  await clickCenter(page, page.locator('.lt-navbtn[title="Course"]'));
  await page.waitForFunction(() => document.querySelector('.lt-navbtn[title="Course"]')?.classList.contains('on'));
  await clickCenter(page, page.locator('.lt-tab').filter({ hasText: 'Cart Fleet' }).first());
  await page.waitForFunction(() => document.querySelector('.lt-content')?.textContent?.includes('Owned Fleet'));
  await page.waitForTimeout(350);
}

async function confirmAction(page, label) {
  await clickCenter(page, page.locator('.lt-confirm .lt-primary').filter({ hasText: label }).first());
  await page.waitForTimeout(450);
}

async function fleetUiDiagnostics(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.lt-frame');
    const content = document.querySelector('.lt-content');
    const frameRect = frame?.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    const overflowing = [...document.querySelectorAll('.lt-content *')].filter((node) => (
      node.scrollWidth > node.clientWidth + 2 && getComputedStyle(node).overflowX !== 'visible'
    )).slice(0, 30).map((node) => ({
      className: node.className,
      text: (node.textContent || '').trim().slice(0, 90),
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
    }));
    const clippedButtons = [...document.querySelectorAll('.lt-content button')].filter((button) => {
      const rect = button.getBoundingClientRect();
      return contentRect && (rect.left < contentRect.left - 1 || rect.right > contentRect.right + 1);
    }).map((button) => button.textContent.trim());
    return {
      frame: frameRect ? { width: frameRect.width, height: frameRect.height } : null,
      content: contentRect ? { width: contentRect.width, height: contentRect.height, scrollHeight: content.scrollHeight } : null,
      rowCount: document.querySelectorAll('.lt-order').length,
      buttonCount: document.querySelectorAll('.lt-content button').length,
      disabledButtonCount: document.querySelectorAll('.lt-content button:disabled').length,
      overflowing,
      clippedButtons,
      text: content?.innerText || '',
    };
  });
}

async function saveRoundTrip(page) {
  return page.evaluate(async () => {
    const { serialize, deserialize } = await import(new URL('src/sim/state.js', document.baseURI).href);
    const before = window.__fw.state.golfDay.carts.map((cart) => ({
      id: cart.id,
      tierId: cart.tierId,
      status: cart.status,
      condition: cart.condition,
      batteryPercent: cart.batteryPercent,
    }));
    const json = serialize(window.__fw.state);
    const restored = deserialize(json);
    const after = restored.golfDay.carts.map((cart) => ({
      id: cart.id,
      tierId: cart.tierId,
      status: cart.status,
      condition: cart.condition,
      batteryPercent: cart.batteryPercent,
    }));
    return { bytes: json.length, before, after, exact: JSON.stringify(before) === JSON.stringify(after) };
  });
}

async function manualSaveLoadRoundTrip(page) {
  const snapshot = () => page.evaluate(() => window.__fw.state.golfDay.carts.map((cart) => ({
    id: cart.id,
    tierId: cart.tierId,
    status: cart.status,
    condition: cart.condition,
    batteryPercent: cart.batteryPercent,
    assignedStaffId: cart.assignedStaffId,
    position: cart.position,
    yaw: cart.yaw,
    lightsOn: cart.lightsOn,
    parkedByPlayer: cart.parkedByPlayer,
    drivenDistanceYd: cart.drivenDistanceYd,
  })));
  const before = await snapshot();
  await page.keyboard.press('p');
  const pause = page.getByRole('dialog', { name: 'Pause menu' });
  await pause.waitFor({ state: 'visible', timeout: 10_000 });
  await pause.getByRole('button', { name: 'Save game', exact: true }).click();
  const saveButton = pause.getByRole('button', { name: 'Save here', exact: true }).first();
  await saveButton.waitFor({ state: 'visible', timeout: 10_000 });
  await saveButton.click();
  await page.waitForFunction(() => document.querySelector('.pause-status')?.textContent?.includes('Saved to slot 1'), null, { timeout: 15_000 });
  await page.screenshot({ path: path.join(OUT, '09-manual-save-slot.png'), animations: 'disabled' });

  await page.evaluate(() => {
    const cart = window.__fw.state.golfDay.carts[0];
    cart.tierId = 'luxury';
    cart.condition = 3;
    cart.batteryPercent = 4;
    cart.position = { x: 777, z: -777 };
    cart.yaw = -2.4;
    cart.lightsOn = true;
    cart.parkedByPlayer = true;
    cart.drivenDistanceYd = 9999;
  });
  const mutated = await snapshot();
  await pause.getByRole('button', { name: 'Load game', exact: true }).click();
  const loadButton = pause.getByRole('button', { name: 'Load', exact: true }).first();
  await loadButton.waitFor({ state: 'visible', timeout: 10_000 });
  await loadButton.click();
  await page.locator('.dialog-actions button.primary').filter({ hasText: 'Load game' }).click();
  await page.waitForFunction((expected) => JSON.stringify(window.__fw.state.golfDay.carts.map((cart) => ({
    id: cart.id,
    tierId: cart.tierId,
    status: cart.status,
    condition: cart.condition,
    batteryPercent: cart.batteryPercent,
    assignedStaffId: cart.assignedStaffId,
    position: cart.position,
    yaw: cart.yaw,
    lightsOn: cart.lightsOn,
    parkedByPlayer: cart.parkedByPlayer,
    drivenDistanceYd: cart.drivenDistanceYd,
  }))) === expected, JSON.stringify(before), { timeout: 30_000 });
  await waitForWorld(page);
  const after = await snapshot();
  return {
    before,
    mutated,
    after,
    exact: JSON.stringify(before) === JSON.stringify(after),
    screenshot: '09-manual-save-slot.png',
  };
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
  page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text().slice(0, 1000) }));
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || 'failed' }));

  const evidence = { iteration: ITERATION, capturedAt: new Date().toISOString(), inputs: [], screenshots: [], consoleMessages, pageErrors, failedRequests };
  try {
    await startNewProperty(page);
    evidence.inputs.push('Main menu > New game', 'Relaxed mode', 'Marketplace > Buy');
    if (process.env.QA_ONLY_LAPTOP === '1') {
      await openPhysicalLaptop(page);
      evidence.inputs.push('Dynamic front-desk pose > E > physical laptop');
      evidence.laptopProbe = { opened: true, screenMode: await page.evaluate(() => (
        window.__fw?.scene3d?.clubhouse?.()?.laptopScreenMode?.() || null
      )) };
      return;
    }
    evidence.fixture = await installFixture(page);
    await waitForFleet(page, 5);
    await dismissNotifications(page);
    evidence.pointerLockForWorldEvidence = await resumeLooking(page);

    const cameras = {
      frontProgression: { at: [1.4, -8.4], target: [0, 0.1], pitch: -0.11 },
      rearThreeQuarter: { at: [8.2, 7.1], target: [0, 0.1], pitch: -0.13 },
      elevatedProgression: { at: [0.0, -10.4], target: [0, 0.2], pitch: -0.23 },
    };
    evidence.cameras = {};
    for (const [name, pose] of Object.entries(cameras)) {
      evidence.cameras[name] = await placeCamera(page, evidence.fixture, pose);
      const filename = `01-${name}.png`;
      await shot(page, filename);
      evidence.screenshots.push(filename);
    }
    evidence.inventoryBefore = await cartInventory(page);

    const basic = await cartPose(page, 'cart-1');
    await dismissNotifications(page);
    await setWalkPose(page, basic.x, basic.z - 2.0, basic.x, basic.z, -0.04);
    evidence.inputs.push(`Walk camera staged at cart-1 front; focus: ${await waitFocus(page, /windshield/)}`);
    evidence.basicWindshieldAmount = await interactAndWaitHinge(page, 'cart-1', 'Windshield_Upper');
    evidence.inputs.push('E > fold Basic windshield');
    await setWalkPose(page, basic.x + 2.8, basic.z - 4.2, basic.x, basic.z + 0.15, -0.09);
    await shot(page, '02-basic-windshield-folded.png');
    evidence.screenshots.push('02-basic-windshield-folded.png');

    await dismissNotifications(page);
    await setWalkPose(page, basic.x + 1.18, basic.z + 0.35, basic.x, basic.z, -0.08);
    evidence.inputs.push(`Walk camera staged at cart-1 charge side; focus: ${await waitFocus(page, /charge port/)}`);
    await page.keyboard.press('e');
    evidence.inputs.push('E > connect Basic charger');
    await page.waitForFunction(() => window.__fw.state.golfDay.carts.find((cart) => cart.id === 'cart-1')?.status === 'charging');
    await page.waitForFunction(() => {
      const root = window.__fw.scene3d.scene.getObjectByName('LiveGolfCarts').children.find((child) => child.name.endsWith('_cart-1'));
      return (root?.userData?.golfCartRig?.hinges?.find((hinge) => hinge.name === 'BatteryCompartment_Lid')?.amount || 0) > 0.72;
    });
    await setWalkPose(page, basic.x + 3.0, basic.z + 1.0, basic.x + 0.45, basic.z, -0.10);
    await shot(page, '03-basic-charge-connected.png');
    evidence.screenshots.push('03-basic-charge-connected.png');

    const luxury = await cartPose(page, 'cart-5');
    await dismissNotifications(page);
    await setWalkPose(page, luxury.x - 1.2, luxury.z - 0.78, luxury.x, luxury.z - 0.78, -0.07);
    evidence.inputs.push(`Walk camera staged at Luxury front-left door; focus: ${await waitFocus(page, /passenger door/)}`);
    evidence.luxuryDoorAmount = await interactAndWaitHinge(page, 'cart-5', 'Door_FL');
    evidence.inputs.push('E > open Luxury front-left door');
    await setWalkPose(page, luxury.x - 3.25, luxury.z - 3.0, luxury.x - 0.4, luxury.z - 0.35, -0.09);
    await shot(page, '04-luxury-door-open.png');
    evidence.screenshots.push('04-luxury-door-open.png');

    await dismissNotifications(page);
    await setWalkPose(page, luxury.x, luxury.z + 2.35, luxury.x, luxury.z, -0.08);
    evidence.inputs.push(`Walk camera staged at Luxury luggage bay; focus: ${await waitFocus(page, /rear storage/)}`);
    evidence.luxuryStorageAmount = await interactAndWaitHinge(page, 'cart-5', 'StorageLid_Rear');
    evidence.inputs.push('E > open Luxury rear storage');
    await setWalkPose(page, luxury.x - 2.9, luxury.z + 4.2, luxury.x, luxury.z + 1.05, -0.10);
    await shot(page, '05-luxury-storage-open.png');
    evidence.screenshots.push('05-luxury-storage-open.png');

    await openPhysicalLaptop(page);
    evidence.inputs.push('E > open physical clubhouse laptop');
    await openFleetTab(page);
    evidence.inputs.push('Laptop > Course > Cart Fleet');
    await dismissNotifications(page);
    await shot(page, '06-fleet-ui-before.png');
    evidence.screenshots.push('06-fleet-ui-before.png');
    evidence.uiBefore = await fleetUiDiagnostics(page);

    const content = page.locator('.lt-content');
    await content.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await dismissNotifications(page);
    await shot(page, '07-fleet-ui-catalog.png');
    evidence.screenshots.push('07-fleet-ui-catalog.png');
    await content.evaluate((node) => { node.scrollTop = 0; });

    const standardRow = page.locator('.lt-order').filter({ hasText: 'CART-2 - Standard' }).first();
    await clickCenter(page, standardRow.getByRole('button', { name: /^Repair / }));
    await confirmAction(page, 'Repair cart');
    evidence.inputs.push('Cart-2 row > Repair > Repair cart');
    await page.waitForFunction(() => window.__fw.state.golfDay.carts.find((cart) => cart.id === 'cart-2')?.condition === 100);

    const premiumRow = page.locator('.lt-order').filter({ hasText: 'CART-3 - Premium' }).first();
    await clickCenter(page, premiumRow.getByRole('button', { name: /^Upgrade / }));
    await confirmAction(page, 'Upgrade cart');
    evidence.inputs.push('Cart-3 row > Upgrade > Upgrade cart');
    await page.waitForFunction(() => window.__fw.state.golfDay.carts.find((cart) => cart.id === 'cart-3')?.tierId === 'high_end');

    let luxuryRow = page.locator('.lt-order').filter({ hasText: 'CART-5 - Luxury' }).first();
    await luxuryRow.locator('select.lt-select').selectOption(String(evidence.fixture.marshal.id));
    await clickCenter(page, luxuryRow.getByRole('button', { name: 'Assign Staff', exact: true }));
    evidence.inputs.push(`Cart-5 row > assign ${evidence.fixture.marshal.name}`);
    await page.waitForFunction(({ cartId, employeeId }) => {
      const cart = window.__fw.state.golfDay.carts.find((entry) => entry.id === cartId);
      return cart?.status === 'staff-assigned' && cart.assignedStaffId === employeeId;
    }, { cartId: 'cart-5', employeeId: evidence.fixture.marshal.id });
    evidence.staffAssigned = await page.evaluate(() => JSON.parse(JSON.stringify(
      window.__fw.state.golfDay.carts.find((cart) => cart.id === 'cart-5'),
    )));
    luxuryRow = page.locator('.lt-order').filter({ hasText: 'CART-5 - Luxury' }).first();
    await clickCenter(page, luxuryRow.getByRole('button', { name: 'Release Staff', exact: true }));
    evidence.inputs.push('Cart-5 row > Release Staff');
    await page.waitForFunction(() => {
      const cart = window.__fw.state.golfDay.carts.find((entry) => entry.id === 'cart-5');
      return cart?.status === 'available' && cart.assignedStaffId == null;
    });
    luxuryRow = page.locator('.lt-order').filter({ hasText: 'CART-5 - Luxury' }).first();
    await clickCenter(page, luxuryRow.getByRole('button', { name: 'Park', exact: true }));
    evidence.inputs.push('Cart-5 row > Park');
    await page.waitForFunction(() => window.__fw.state.golfDay.carts.find((entry) => entry.id === 'cart-5')?.parkedByPlayer === false);
    evidence.staffReleasedAndParked = await page.evaluate(() => JSON.parse(JSON.stringify(
      window.__fw.state.golfDay.carts.find((cart) => cart.id === 'cart-5'),
    )));

    await content.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const luxuryCard = page.locator('.lt-card').filter({ hasText: '5. Luxury' }).filter({ has: page.getByRole('button', { name: /^Buy / }) }).first();
    await clickCenter(page, luxuryCard.getByRole('button', { name: /^Buy / }));
    await confirmAction(page, 'Purchase cart');
    evidence.inputs.push('Progression Catalog > Luxury > Buy > Purchase cart');
    await page.waitForFunction(() => window.__fw.state.golfDay.carts.length === 6);
    await content.evaluate((node) => { node.scrollTop = 0; });
    await dismissNotifications(page);
    await shot(page, '08-fleet-ui-after-operations.png');
    evidence.screenshots.push('08-fleet-ui-after-operations.png');
    evidence.uiAfter = await fleetUiDiagnostics(page);
    evidence.saveRoundTrip = await saveRoundTrip(page);
    if (!evidence.saveRoundTrip.exact) throw new Error('Golf-cart fleet changed across state serialize/deserialize.');

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__fw?.laptopOpen);
    evidence.manualSaveLoad = await manualSaveLoadRoundTrip(page);
    evidence.screenshots.push(evidence.manualSaveLoad.screenshot);
    evidence.inputs.push('P > Save game > Slot 1 > mutate live fleet > Load game > Slot 1 > Load game');
    if (!evidence.manualSaveLoad.exact) throw new Error('Manual save/load changed the canonical golf-cart fleet.');
    await waitForFleet(page, 6);
    await dismissNotifications(page);
    await resumeLooking(page);
    await placeCamera(page, evidence.fixture, { at: [8.7, 8.0], target: [0, 2.0], pitch: -0.14 });
    await shot(page, '10-yard-after-operations.png');
    evidence.screenshots.push('10-yard-after-operations.png');
    evidence.inventoryAfter = await cartInventory(page);
    evidence.finalState = await page.evaluate(() => ({
      cash: window.__fw.state.cash,
      carts: window.__fw.state.golfDay.carts.map((cart) => ({
        id: cart.id,
        tierId: cart.tierId,
        status: cart.status,
        condition: cart.condition,
        batteryPercent: cart.batteryPercent,
      })),
    }));
    if (pageErrors.length || consoleMessages.some((entry) => entry.type === 'error')
      || failedRequests.some((entry) => !entry.failure.includes('ERR_ABORTED'))) {
      throw new Error('Browser hard failures were recorded during golf-cart production QA.');
    }
  } finally {
    evidence.browser = await browser.version();
    evidence.viewport = { ...VIEWPORT, deviceScaleFactor: 1 };
    evidence.hardFailures = {
      pageErrors,
      consoleErrors: consoleMessages.filter((entry) => entry.type === 'error'),
      failedRequests: failedRequests.filter((entry) => !entry.failure.includes('ERR_ABORTED')),
    };
    fs.writeFileSync(path.join(OUT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    await context.close();
    evidence.videoPath = video ? await video.path().catch(() => null) : null;
    fs.writeFileSync(path.join(OUT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    await browser.close();
  }
  process.stdout.write(`${JSON.stringify({
    out: OUT,
    screenshots: evidence.screenshots.length,
    videoPath: evidence.videoPath,
    inputs: evidence.inputs.length,
    hardFailures: evidence.hardFailures,
    saveRoundTrip: evidence.saveRoundTrip,
    finalState: evidence.finalState,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

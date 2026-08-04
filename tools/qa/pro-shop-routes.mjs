import { chromium } from 'playwright-core';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// Normal-control acceptance for Routes A, B, and E. This deliberately uses the
// shipped New Empire UI, first-person controls, laptop UI, delivery clock,
// physical cartons, authored stocking/decor sockets, and office save slots.
// evaluate() calls below are read-only observations; they never assign game state.

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PORT = Number(process.argv.find((arg) => arg.startsWith('--port='))?.slice(7) || 8457);
const PASS = process.argv.find((arg) => arg.startsWith('--pass='))?.slice(7) || 'routes-a-b-e-acceptance';
const OUT = path.join(ROOT, 'qa', 'pro-shop-overhaul', PASS);
const BASE_URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEWPORT = { width: 1600, height: 900 };

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'video'), { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  recordVideo: { dir: path.join(OUT, 'video'), size: VIEWPORT },
});
const page = await context.newPage();
const consoleMessages = [];
const failedRequests = [];
page.on('console', (message) => {
  if (['warning', 'error'].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() });
});
page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));
page.on('response', (response) => {
  if (response.status() >= 400) failedRequests.push({ status: response.status(), url: response.url() });
});
page.on('requestfailed', (request) => failedRequests.push({ error: request.failure()?.errorText, url: request.url() }));

const steps = [];
const startedAt = Date.now();
let thrown = null;
let report = null;
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 88 });

const normAngle = (r) => {
  let out = r;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
};

const pose = () => page.evaluate(() => {
  const walk = window.__fw.scene3d.walk.state;
  const offset = window.__fw.scene3d.clubhouse().interior.position;
  return {
    x: walk.x, z: walk.z, yaw: walk.yaw, pitch: walk.pitch,
    localX: walk.x - offset.x, localZ: walk.z - offset.z,
  };
});

const worldOf = (local) => page.evaluate(([x, z]) => {
  const offset = window.__fw.scene3d.clubhouse().interior.position;
  return { x: offset.x + x, z: offset.z + z };
}, local);

async function turnTowardWorld(target, tolerance = 0.06) {
  for (let guard = 0; guard < 100; guard++) {
    const p = await pose();
    const desired = Math.atan2(-(target.x - p.x), -(target.z - p.z));
    const delta = normAngle(desired - p.yaw);
    if (Math.abs(delta) <= tolerance) return p;
    const key = delta > 0 ? 'ArrowLeft' : 'ArrowRight';
    const duration = Math.max(18, Math.min(150, Math.abs(delta) * 175));
    await page.keyboard.down(key);
    await page.waitForTimeout(duration);
    await page.keyboard.up(key);
  }
  throw new Error('Could not face the next waypoint');
}

async function walkToLocal(local, label, { tolerance = 0.28, interactOnStall = true } = {}) {
  const target = await worldOf(local);
  let stalled = 0;
  for (let guard = 0; guard < 260; guard++) {
    const before = await pose();
    const distance = Math.hypot(target.x - before.x, target.z - before.z);
    if (distance <= tolerance) {
      const row = { step: label, control: 'ArrowLeft/ArrowRight + W', pose: before, distanceToTarget: +distance.toFixed(3) };
      steps.push(row);
      return row;
    }
    await turnTowardWorld(target);
    const duration = Math.max(45, Math.min(250, distance * 140));
    await page.keyboard.down('w');
    await page.waitForTimeout(duration);
    await page.keyboard.up('w');
    const after = await pose();
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    stalled = moved < 0.018 ? stalled + 1 : 0;
    if (stalled >= 3) {
      if (!interactOnStall) throw new Error(`Blocked while carrying on route to ${label}`);
      await page.keyboard.press('e');
      await page.waitForTimeout(500);
      stalled = 0;
    }
  }
  throw new Error(`Could not walk to ${label}`);
}

async function faceLocal(local, tolerance) {
  return turnTowardWorld(await worldOf(local), tolerance);
}

const focus = () => page.evaluate(() => ({
  label: window.__fw.scene3d.walk.getFocusLabel(),
  tool: window.__fw.scene3d.walk.getTool(),
}));

const carried = () => page.evaluate(async () => {
  const stocking = await import(new URL('src/sim/stocking.js', document.baseURI).href);
  const deliveries = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
  const state = window.__fw.state;
  const goods = stocking.carriedGoods(state);
  const box = deliveries.carriedBox(state);
  return {
    goods: goods ? { skuId: goods.skuId, qty: goods.qty } : null,
    box: box ? { id: box.id, skuId: box.skuId, qty: box.qty } : null,
  };
});

const snapshot = () => page.evaluate(async () => {
  const deliveries = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
  const state = window.__fw.state;
  const ch = window.__fw.scene3d.clubhouse();
  const inventory = Object.fromEntries(Object.entries(state.shop.inventory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, line]) => [id, { shelf: line.shelf || 0, back: line.back || 0 }]));
  const boxes = deliveries.boxesOf(state).map((box) => ({
    id: box.id, skuId: box.skuId, qty: box.qty, loc: box.loc,
    tape: box.tape, flaps: [...box.flaps], flat: !!box.flat,
    x: box.x ?? null, z: box.z ?? null,
  }));
  const fixtureIds = [];
  ch.interior.traverse((object) => {
    const id = object.userData?.fixtureId;
    if (id) fixtureIds.push(id);
  });
  const uniqueFixtureIds = [...new Set(fixtureIds)].sort();
  const customers = Array.isArray(ch.customers) ? ch.customers : ch.customers();
  return {
    cash: state.cash,
    clockMinutes: state.clock.minutes,
    tier: state.shop.unlockedTier,
    lighting: ch.lightingTier(),
    inventory,
    decor: (state.shop.reno?.decor || []).map((item) => ({ ...item }))
      .sort((a, b) => `${a.skuId}:${a.spot}`.localeCompare(`${b.skuId}:${b.spot}`)),
    layout: state.shop.layout ? JSON.parse(JSON.stringify(state.shop.layout)) : null,
    boxes,
    orders: state.shop.orders.map((order) => ({ id: order.id, skuId: order.skuId, qty: order.qty, deliveryMin: order.deliveryMin })),
    held: (state.shop.held || []).map((item) => ({ uid: item.uid, skuId: item.skuId })),
    activeCustomerCount: customers.length,
    customerRuntime: customers.map((customer) => ({
      stopIdx: customer.stopIdx,
      nextStop: customer.stops?.[customer.stopIdx]?.kind || null,
      queued: !!customer.queued,
      awaitingCheckout: !!customer.awaitingCheckout,
      cartCount: customer.cart?.length || 0,
      x: customer.mesh?.position?.x ?? null,
      z: customer.mesh?.position?.z ?? null,
    })),
    fixtureIds: uniqueFixtureIds,
    duplicateFixtureIds: fixtureIds.length - uniqueFixtureIds.length,
  };
});

function persistentPart(value) {
  return {
    cash: value.cash,
    tier: value.tier,
    inventory: value.inventory,
    decor: value.decor,
    layout: value.layout,
    boxes: value.boxes,
    orders: value.orders,
    held: value.held,
  };
}

const savedSnapshot = (slot) => page.evaluate((key) => {
  const raw = JSON.parse(localStorage.getItem(`golfempire:${key}`) || 'null');
  if (!raw) throw new Error(`No save payload found for ${key}`);
  const holding = raw.holdings.find((item) => item.property.id === raw.activeId);
  if (!holding) throw new Error(`No active holding found in ${key}`);
  const state = holding.state;
  const inventory = Object.fromEntries(Object.entries(state.shop.inventory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, line]) => [id, { shelf: line.shelf || 0, back: line.back || 0 }]));
  const boxes = (state.shop.deliveries?.boxes || []).map((box) => ({
    id: box.id, skuId: box.skuId, qty: box.qty, loc: box.loc,
    tape: box.tape, flaps: [...box.flaps], flat: !!box.flat,
    x: box.x ?? null, z: box.z ?? null,
  }));
  return {
    cash: state.cash,
    clockMinutes: state.clock.minutes,
    tier: state.shop.unlockedTier,
    inventory,
    decor: (state.shop.reno?.decor || []).map((item) => ({ ...item }))
      .sort((a, b) => `${a.skuId}:${a.spot}`.localeCompare(`${b.skuId}:${b.spot}`)),
    layout: state.shop.layout ? JSON.parse(JSON.stringify(state.shop.layout)) : null,
    boxes,
    orders: state.shop.orders.map((order) => ({ id: order.id, skuId: order.skuId, qty: order.qty, deliveryMin: order.deliveryMin })),
    held: (state.shop.held || []).map((item) => ({ uid: item.uid, skuId: item.skuId })),
  };
}, `slot${slot}`);

async function bootFresh() {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  if (await continueButton.isEnabled().catch(() => false)) throw new Error('Fresh route context unexpectedly has an autosave');
  await page.getByRole('button', { name: /New Empire.*Relaxed/ }).click();
  await page.getByRole('heading', { name: 'PROPERTY MARKET' }).waitFor();
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });
  const guideClose = page.locator('button[title="Hide the guide"]');
  await guideClose.press('Enter');
  await page.locator('.objectives-card').waitFor({ state: 'hidden', timeout: 5_000 });
  await page.waitForTimeout(1_200);
  await page.locator('canvas').click({ position: { x: 800, y: 450 } });
}

async function openPause() {
  if (await page.evaluate(() => !!document.pointerLockElement)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    if (await page.evaluate(() => !!document.pointerLockElement)) {
      // Headless Chrome occasionally swallows the unlock Escape. This browser
      // API performs only that browser-level unlock; the game still receives
      // the next physical Escape and owns the pause/save interaction.
      await page.evaluate(() => document.exitPointerLock());
      await page.waitForFunction(() => !document.pointerLockElement);
    }
  }
  for (let i = 0; i < 2; i++) {
    if (await page.locator('.pause-veil-ui').isVisible().catch(() => false)) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }
  await page.locator('.pause-veil-ui').waitFor({ state: 'visible', timeout: 5_000 });
}

async function saveSlot(slot, label) {
  if (await page.evaluate(() => window.__fw.speedIdx === 0)) {
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__fw.speedIdx !== 0);
  }
  // Active shoppers are valid persistent-world context, but a unit held between
  // shelf and basket is deliberately recovered on load. Save only when no unit
  // is in flight, and verify that condition against the slot payload itself.
  await page.waitForFunction(() => (window.__fw.state.shop.held || []).length === 0,
    null, { timeout: 120_000, polling: 100 });
  await openPause();
  await page.getByRole('button', { name: 'Save game', exact: true }).click();
  const card = page.locator('.slot-card').nth(slot - 1);
  await card.getByRole('button', { name: 'Save here', exact: true }).click();
  await page.waitForFunction((index) => {
    const card = document.querySelectorAll('.slot-card')[index];
    return card && !card.querySelector('.slot-meta')?.textContent.includes('…');
  }, slot - 1);
  const value = await savedSnapshot(slot);
  if (value.held.length) throw new Error(`Slot ${slot} captured a shopper-held unit`);
  steps.push({ step: label, control: `Esc -> Save game -> Slot ${slot}`, snapshot: persistentPart(value) });
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(350);
  return value;
}

async function loadSlot(slot, label) {
  await openPause();
  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  const card = page.locator('.slot-card').nth(slot - 1);
  await page.waitForFunction((index) => {
    const card = document.querySelectorAll('.slot-card')[index];
    return card && !card.querySelector('.slot-meta')?.textContent.includes('…');
  }, slot - 1);
  await page.evaluate(() => { window.__routeStateBeforeLoad = window.__fw.state; });
  await card.getByRole('button', { name: 'Load', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.state && window.__fw.state !== window.__routeStateBeforeLoad, null, { timeout: 60_000 });
  if (await page.evaluate(() => window.__fw.speedIdx !== 0)) {
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__fw.speedIdx === 0);
  }
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(120);
  const value = await snapshot();
  steps.push({ step: label, control: `Esc -> Load game -> Slot ${slot}`, snapshot: persistentPart(value) });
  // Keep the loaded scene paused long enough for its asynchronous GLB textures
  // to settle before the next deliberate teardown. Rapid-fire slot cycling can
  // otherwise turn benign browser aborts into misleading console noise.
  await page.waitForTimeout(2_500);
  return value;
}

async function enterShopAndCirculate() {
  await walkToLocal([-0.8, 7.55], 'walked up the porch steps');
  await faceLocal([-0.8, 5.7]);
  await page.keyboard.press('e');
  await page.waitForTimeout(650);
  steps.push({ step: 'opened the hinged main door', control: 'E', focus: await focus() });
  await shot('01-main-door-normal-entry');
  await walkToLocal([-0.8, 5.65], 'crossed the shop threshold');
  for (const [at, label] of [
    [[-0.8, 4.15], 'followed the entrance clearway'],
    [[-1.4, 1.9], 'passed the east side of the feature table'],
    [[-4.25, 1.85], 'crossed behind the feature table'],
    [[-8.35, 1.85], 'circulated through the west retail aisle'],
    [[-8.35, -4.75], 'walked the full club-wall aisle'],
    [[-2.3, -4.9], 'reached the ball-wall approach'],
    [[0.55, -4.75], 'crossed the north display aisle'],
    [[-0.25, -3.55], 'cleared the west edge of the bag stand'],
    [[-0.45, -1.1], 'crossed the center aisle'],
    [[0.25, 2.85], 'followed the west side of the scorecard station'],
    [[2.5, 3.35], 'returned along the queue-clear aisle'],
  ]) await walkToLocal(at, label);
  await shot('02-basic-store-circulation');
}

async function sitAtLaptop() {
  for (const [at, label] of [
    [[0.75, 3.35], 'cleared the west end of the checkout counter'],
    [[0.75, 5.25], 'entered the staff corridor'],
    [[4.9, 5.25], 'walked behind the checkout clearway'],
    [[6.6, 5.3], 'entered the office side'],
    [[8.5, 4.5], 'reached the laptop chair'],
  ]) await walkToLocal(at, label);
  await faceLocal([9.55, 4.5], 0.05);
  const label = await focus();
  if (!/laptop/i.test(label.label || '')) throw new Error(`Laptop was not reachable through the office: ${label.label}`);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10_000 });
  await page.locator('.lt-frame').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(() => {
    const frame = document.querySelector('.lt-frame');
    if (!frame) return false;
    const rect = frame.getBoundingClientRect();
    const last = window.__routeLaptopRect || {};
    window.__routeLaptopRect = { left: rect.left, width: rect.width };
    return rect.width > 100 && Math.abs((last.left ?? 0) - rect.left) < 0.05 && Math.abs((last.width ?? 0) - rect.width) < 0.05;
  }, null, { timeout: 15_000, polling: 120 });
  steps.push({ step: 'opened the physical office laptop', control: 'E', focus: label });
}

async function laptopNav(name) {
  const button = page.locator('.lt-navbtn').filter({ hasText: name }).first();
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForTimeout(350);
}

async function orderStockAndDecor() {
  await laptopNav('Supplier');
  const addProduct = async (name, qty) => {
    const product = page.locator('.lt-product').filter({ hasText: name }).first();
    await product.scrollIntoViewIfNeeded();
    const plus = product.locator('.lt-qbtn').filter({ hasText: '+' });
    for (let i = 0; i < qty; i++) await plus.click();
  };
  await addProduct('Range-rock dozen', 3);
  await addProduct('North Ridge spikes', 1);
  await page.locator('.lt-head .lt-primary').click();
  await page.locator('.lt-confirm .lt-primary').click();
  await page.waitForTimeout(500);
  await laptopNav('Renovation');
  const plant = page.locator('.lt-order').filter({ hasText: 'Potted plant' }).first();
  await plant.scrollIntoViewIfNeeded();
  await plant.getByRole('button', { name: 'Order one', exact: true }).click();
  await page.waitForTimeout(400);
  const ordered = await snapshot();
  const wanted = new Set(ordered.orders.map((order) => order.skuId));
  for (const id of ['balls1', 'shoe1', 'plant1']) {
    if (!wanted.has(id)) throw new Error(`Laptop did not place the ${id} order`);
  }
  await shot('03-laptop-orders-placed');
  steps.push({ step: 'ordered starter stock, a new shoe category, and a fixture/decor upgrade', control: 'laptop pointer UI', orders: ordered.orders });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 10_000 });
}

async function waitForDeliveries() {
  await page.keyboard.press('3');
  await page.waitForFunction(() => {
    const state = window.__fw.state;
    const boxes = state.shop.deliveries?.boxes || [];
    return ['balls1', 'shoe1', 'plant1'].every((id) => boxes.some((box) => box.skuId === id));
  }, null, { timeout: 230_000, polling: 500 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__fw.speedIdx === 0);
  const landed = await snapshot();
  steps.push({ step: 'waited for the authored supplier lead times and pad arrival', control: '3 then Space', boxes: landed.boxes });
  await shot('04-orders-landed');
}

async function openServiceRoute() {
  for (const [at, label] of [
    [[8.6, 3.0], 'approached the stockroom door from the office'],
    [[8.9, 2.65], 'stood at the stockroom door'],
  ]) await walkToLocal(at, label);
  await faceLocal([8.9, 1.2]);
  await page.keyboard.press('e');
  await page.waitForTimeout(600);
  await walkToLocal([8.9, 1.25], 'crossed into the stockroom');
  await walkToLocal([9.3, -2.7], 'walked down the receiving aisle');
  await walkToLocal([9.55, -3.6], 'stood inside the receiving door');
  await faceLocal([10.7, -3.6]);
  await page.keyboard.press('e');
  await page.waitForTimeout(600);
  await walkToLocal([11.15, -3.6], 'crossed onto the receiving pad');
  steps.push({ step: 'opened both service doors to the delivery pad', control: 'E + first-person movement' });
}

const padBoxLocal = (skuId) => page.evaluate(async (wanted) => {
  const { boxDims } = await import(new URL('src/data/boxes.js', document.baseURI).href);
  const boxes = window.__fw.state.shop.deliveries?.boxes || [];
  let stack = 0;
  for (const box of boxes) {
    if (box.loc !== 'pad') continue;
    const index = stack++;
    if (box.skuId !== wanted) continue;
    const dim = boxDims(box.box || 'carton');
    return {
      id: box.id,
      skuId: box.skuId,
      x: 12.4 + (index % 3 - 1) * Math.max(0.62, dim.w + 0.14),
      z: -3.6 + Math.floor(index / 3) * Math.max(0.56, dim.d + 0.14) - 0.3,
    };
  }
  return null;
}, skuId);

async function bringBoxInside(skuId) {
  const box = await padBoxLocal(skuId);
  if (!box) throw new Error(`${skuId} carton is not on the receiving pad`);
  await walkToLocal([box.x, box.z - 0.85], `approached the ${skuId} delivery carton`, { tolerance: 0.22 });
  await faceLocal([box.x, box.z], 0.05);
  const label = await focus();
  if (!label.label?.includes('pick up')) throw new Error(`Could not focus ${skuId} carton: ${label.label}`);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.state.shop.deliveries.boxes.some((box) => box.loc === 'carried'));
  const lifted = await carried();
  if (lifted.box?.skuId !== skuId) throw new Error(`Focused ${label.label}, but picked up ${lifted.box?.skuId || 'nothing'} instead of ${skuId}`);
  const unpackAt = skuId === 'plant1' ? [8.3, -2.45] : skuId === 'shoe1' ? [8.65, -4.75] : [7.2, -4.7];
  for (const [at, name] of [
    [[11.0, -3.6], `carried ${skuId} toward the receiving door`],
    [[9.7, -3.6], `carried ${skuId} through the receiving door`],
    [[8.1, -4.5], `carried ${skuId} down the stockroom aisle`],
    [unpackAt, `reached the stockroom unpacking area with ${skuId}`],
  ]) await walkToLocal(at, name, { tolerance: 0.30, interactOnStall: false });
  const dropAttempts = skuId === 'plant1'
    ? [
        { stand: [8.3, -2.45], face: [8.3, -1.35] },
        { stand: [8.75, -2.65], face: [8.75, -1.45] },
      ]
    : skuId === 'shoe1'
      ? [
          { stand: [8.65, -4.75], face: [8.65, -3.55] },
          { stand: [8.9, -4.35], face: [8.15, -3.45] },
        ]
    : [
        { stand: [7.2, -4.7], face: [7.2, -3.6] },
        { stand: [7.85, -4.75], face: [7.85, -3.55] },
        { stand: [6.75, -4.7], face: [6.75, -3.5] },
      ];
  let dropped = false;
  for (const attempt of dropAttempts) {
    await walkToLocal(attempt.stand, `found clear floor space for the ${skuId} carton`, { tolerance: 0.30, interactOnStall: false });
    await faceLocal(attempt.face);
    const dropFocus = await focus();
    if (!/carrying.+set it down/i.test(dropFocus.label || '')) continue;
    await page.keyboard.press('e');
    await page.waitForTimeout(700);
    dropped = await page.evaluate((wanted) => window.__fw.state.shop.deliveries.boxes
      .some((entry) => entry.skuId === wanted && entry.loc === 'world'), skuId);
    if (dropped) break;
  }
  if (!dropped) throw new Error(`Could not find legal stockroom floor space for ${skuId}`);
  await page.waitForTimeout(350);
  steps.push({ step: `received ${skuId} through the physical service route`, control: 'E + first-person carrying', initialFocus: label });
}

async function unpackBox(skuId) {
  const local = await page.evaluate((wanted) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((entry) => entry.skuId === wanted && entry.loc === 'world');
    return box ? { x: box.x, z: box.z } : null;
  }, skuId);
  if (!local) throw new Error(`No dropped ${skuId} box to unpack`);
  const current = await pose();
  const distance = Math.hypot(local.x - current.localX, local.z - current.localZ);
  if (distance > 1.35) {
    await walkToLocal([local.x, local.z - 0.95], `stood over the dropped ${skuId} carton`, { tolerance: 0.24 });
  } else {
    steps.push({
      step: `remained beside the dropped ${skuId} carton`, control: 'normal set-down position',
      pose: current, distanceToCarton: +distance.toFixed(3), carton: local,
    });
  }
  await faceLocal([local.x, local.z], 0.045);
  // Ported off the box-cutter equip 2026-07-30 — cartons tear on a press, no
  // tool. Three presses: tape, other flap pair, armful.
  const sealed = await focus();
  if (sealed.tool !== null) throw new Error(`A carton press must not involve a tool for ${skuId}: ${JSON.stringify(sealed)}`);
  if (!/tear the tape/i.test(sealed.label || '')) throw new Error(`Sealed ${skuId} carton did not offer the tear press: ${JSON.stringify(sealed)}`);
  // Each press animates a flap phase and ignores input until it settles; the
  // next prompt is the settle signal.
  await page.keyboard.press('e');
  await page.waitForFunction(
    () => /open the other flap/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''),
    null, { timeout: 6000 },
  );
  await page.keyboard.press('e');
  await page.waitForFunction(
    () => /take an armful/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''),
    null, { timeout: 6000 },
  );
  await page.keyboard.press('e');
  await page.waitForFunction(async (wanted) => {
    const stocking = await import(new URL('src/sim/stocking.js', document.baseURI).href);
    return stocking.carriedGoods(window.__fw.state)?.skuId === wanted;
  }, skuId);
  const hands = await carried();
  steps.push({ step: `tore, opened, and took ${skuId} from its carton`, control: 'E + E + E', sealed, hands });
  return local;
}

async function ensureFocusedDoorOpen(name) {
  const open = await page.evaluate((wanted) => !!window.__fw.scene3d.clubhouse().doors.find((door) => door.name === wanted)?.open, name);
  if (open) return;
  const doorFocus = await focus();
  if (!doorFocus.label?.startsWith(name)) throw new Error(`Could not focus ${name}: ${doorFocus.label}`);
  await page.keyboard.press('e');
  await page.waitForFunction((wanted) => !!window.__fw.scene3d.clubhouse().doors.find((door) => door.name === wanted)?.open, name);
  steps.push({ step: `opened ${name}`, control: 'E', focus: doorFocus });
}

async function leaveStockroomForPad(label = 'left the stockroom through receiving') {
  await walkToLocal([9.5, -3.6], 'returned to the receiving door');
  await faceLocal([10.8, -3.6]);
  await ensureFocusedDoorOpen('Receiving door');
  await walkToLocal([11.15, -3.6], label);
}

async function padToMainEntrance() {
  for (const [at, label] of [
    [[12.0, 0.0], 'walked along the clubhouse east wall'],
    [[12.0, 6.9], 'rounded the southeast corner'],
    [[7.0, 8.0], 'followed the front approach west'],
    [[2.5, 8.0], 'passed the clubhouse sign'],
    [[-0.8, 7.55], 'returned to the main porch'],
  ]) await walkToLocal(at, label);
  await faceLocal([-0.8, 5.7]);
  await ensureFocusedDoorOpen('Shop door');
  await walkToLocal([-0.8, 5.65], 're-entered the shop through the main door');
}

async function storePlantAndPlace() {
  await bringBoxInside('plant1');
  const boxAt = await unpackBox('plant1');
  await walkToLocal([boxAt.x, boxAt.z - 1.3], 'stepped away from the open plant carton');
  const holding = await focus();
  if (!/Holding Potted plant/i.test(holding.label || '')) throw new Error(`Plant did not expose stockroom storage action: ${holding.label}`);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.state.shop.inventory.plant1.back === 1);
  steps.push({ step: 'stored the received plant on the stockroom shelf', control: 'E', focus: holding });

  await leaveStockroomForPad();
  await padToMainEntrance();
  await walkToLocal([-0.8, 4.25], 'cleared the inward-swinging main door');
  await walkToLocal([-2.35, 4.95], 'approached the authored plant ghost');
  await faceLocal([-2.35, 5.85], 0.05);
  const ghost = await focus();
  if (!/Place the potted plant here/i.test(ghost.label || '')) throw new Error(`Plant placement ghost was not usable: ${ghost.label}`);
  const before = await snapshot();
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.state.shop.reno.decor.some((item) => item.skuId === 'plant1'));
  const after = await snapshot();
  steps.push({ step: 'placed the purchased fixture/decor upgrade at its authored socket', control: 'E', focus: ghost, beforeDecor: before.decor, afterDecor: after.decor });
  await shot('05-upgrade-placed');
}

async function returnToPad() {
  await walkToLocal([-0.8, 5.65], 'left the upgraded entrance display');
  await faceLocal([-0.8, 7.7]);
  await ensureFocusedDoorOpen('Shop door');
  await walkToLocal([-0.8, 7.55], 'stepped back onto the porch');
  for (const [at, label] of [
    [[2.5, 8.0], 'walked east past the clubhouse sign'],
    [[7.0, 8.0], 'followed the front approach east'],
    [[12.0, 6.9], 'rounded the southeast corner toward receiving'],
    [[12.0, 0.0], 'walked along the clubhouse east wall toward receiving'],
    [[11.15, -3.6], 'returned to the receiving pad'],
  ]) await walkToLocal(at, label);
}

async function stockProduct(skuId, fixtureAt, approach, imageName, retailRoute = null) {
  await bringBoxInside(skuId);
  await unpackBox(skuId);
  await leaveStockroomForPad('carried opened stock through the receiving door');
  await padToMainEntrance();
  const route = retailRoute || [
    [[-0.8, 3.4], 'carried starter stock down the entrance aisle'],
    [[-1.4, 1.8], 'carried starter stock past the feature table'],
    [[-4.25, 1.8], 'carried starter stock into the west aisle'],
    [[-8.3, 1.8], 'carried starter stock to the club wall'],
    [[-8.3, -4.7], 'carried starter stock to the north wall'],
  ];
  for (const [at, label] of route) await walkToLocal(at, label);
  await walkToLocal(approach, `approached the authored ${skuId} stocking socket`, { tolerance: 0.22 });
  await faceLocal(fixtureAt, 0.05);
  const stockFocus = await focus();
  if (!/hold \[E\] to stock/i.test(stockFocus.label || '')) throw new Error(`Fixture rejected ${skuId}: ${stockFocus.label}`);
  if (await page.evaluate(() => window.__fw.speedIdx !== 0)) {
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__fw.speedIdx === 0);
    steps.push({ step: `paused ambient shoppers for the ${skuId} stock-count measurement`, control: 'Space' });
  }
  const before = await snapshot();
  let after = before;
  for (let attempt = 0; attempt < 2 && after.inventory[skuId].shelf <= before.inventory[skuId].shelf; attempt++) {
    await faceLocal(fixtureAt, 0.05);
    await page.keyboard.down('e');
    await page.waitForTimeout(1_200);
    await page.keyboard.up('e');
    await page.waitForTimeout(250);
    after = await snapshot();
  }
  if (after.inventory[skuId].shelf <= before.inventory[skuId].shelf) {
    throw new Error(`${skuId} shelf count did not increase from ${before.inventory[skuId].shelf}; carry=${JSON.stringify(await carried())}`);
  }
  if ((await carried()).goods) throw new Error(`${skuId} remained in the player's hands after stocking`);
  steps.push({
    step: `stocked ${skuId} at its authored fixture`, control: 'hold E', focus: stockFocus,
    shelfBefore: before.inventory[skuId].shelf, shelfAfter: after.inventory[skuId].shelf,
  });
  await shot(imageName);
  return after;
}

async function showReloadedPartialStock() {
  await page.locator('canvas').click({ position: { x: 800, y: 450 } });
  await walkToLocal([-0.8, 7.55], 'returned to the clubhouse after the partial-state reload');
  await faceLocal([-0.8, 5.7]);
  await page.keyboard.press('e');
  await page.waitForTimeout(650);
  for (const [at, label] of [
    [[-0.8, 5.65], 'crossed the reloaded shop threshold'],
    [[-0.8, 3.4], 'followed the reloaded entrance aisle'],
    [[-1.4, 1.8], 'passed the reloaded feature table'],
    [[-4.25, 1.8], 'crossed the reloaded west aisle'],
    [[-8.3, 1.8], 'reached the reloaded club wall'],
    [[-8.3, -4.7], 'reached the reloaded ball-wall aisle'],
    [[-6.9, -5.18], 'stood at the reloaded partial-stock socket'],
  ]) await walkToLocal(at, label);
  await faceLocal([-6.9, -6.15]);
  steps.push({ step: 'visually confirmed the partial stock inside the reloaded shop', control: 'first-person entry and circulation', focus: await focus() });
  await shot('07-partial-state-reloaded');
}

try {
  await bootFresh();
  steps.push({ step: 'created a fresh empire and bought Willow Creek', control: 'visible New Empire and Property Market UI', pose: await pose() });
  const basicSaved = await saveSlot(1, 'saved the untouched basic layout');
  await enterShopAndCirculate();

  await sitAtLaptop();
  await orderStockAndDecor();
  await waitForDeliveries();
  await openServiceRoute();
  await storePlantAndPlace();
  const upgradedSaved = await saveSlot(2, 'saved the upgraded layout after physical receipt and placement');

  await returnToPad();
  await stockProduct('balls1', [-6.9, -6.15], [-6.9, -5.18], '06-starter-stock-placed');
  const partialSaved = await saveSlot(3, 'saved the upgraded, partially stocked layout');

  await returnToPad();
  const newCategoryStocked = await stockProduct(
    'shoe1', [5.25, -0.25], [4.37, -0.25], '06b-new-category-stocked',
    [
      [[-0.8, 3.4], 'carried the new shoe category down the entrance aisle'],
      [[-0.45, -1.1], 'carried the shoes through the center aisle'],
      [[1.35, -1.35], 'cleared the west side of the bag display'],
      [[3.45, -1.15], 'approached the shoe-wall aisle'],
    ],
  );

  const reloadBasic = await loadSlot(1, 'reloaded the exact basic layout');
  const reloadUpgraded = await loadSlot(2, 'reloaded the exact upgraded layout');
  const reloadPartial = await loadSlot(3, 'reloaded the exact partial-stock layout');

  const checks = {
    basicExact: JSON.stringify(persistentPart(reloadBasic)) === JSON.stringify(persistentPart(basicSaved)),
    upgradedExact: JSON.stringify(persistentPart(reloadUpgraded)) === JSON.stringify(persistentPart(upgradedSaved)),
    partialExact: JSON.stringify(persistentPart(reloadPartial)) === JSON.stringify(persistentPart(partialSaved)),
    plantPlaced: reloadUpgraded.decor.some((item) => item.skuId === 'plant1'),
    partialBallsPreserved: reloadPartial.inventory.balls1.shelf === partialSaved.inventory.balls1.shelf,
    newCategoryStocked: newCategoryStocked.inventory.shoe1.shelf > 0,
    noDuplicateFixtures: [reloadBasic, reloadUpgraded, reloadPartial].every((value) => value.duplicateFixtureIds === 0),
    noStuckReloadCustomers: [reloadBasic, reloadUpgraded, reloadPartial].every((value) => {
      const capacity = value.tier >= 3 ? 10 : value.tier >= 2 ? 6 : 4;
      return value.activeCustomerCount <= capacity && value.customerRuntime.every((customer) => (
        customer.stopIdx <= 1
        && !!customer.nextStop
        && !customer.queued
        && !customer.awaitingCheckout
        && customer.cartCount === 0
        && Number.isFinite(customer.x)
        && Number.isFinite(customer.z)
      ));
    }),
    lightingReconstructed: [reloadBasic, reloadUpgraded, reloadPartial].every((value) => value.lighting?.tier === value.tier),
  };
  const passed = Object.values(checks).every(Boolean);
  report = {
    passed,
    branch: 'overnight/pro-shop-overhaul',
    normalControlsOnly: true,
    stateWritesUsed: false,
    routes: {
      A: 'fresh entry, circulation, starter stock receipt and authored-socket stocking; natural checkout is retained separately',
      B: 'paid laptop fixture/decor order, supplier lead time, receiving route, unpack, authored placement, and shoe-category stocking',
      E: 'office menu saves and loads for basic, upgraded, and partially stocked layouts',
    },
    checks,
    reloadRuntime: {
      basic: reloadBasic.customerRuntime,
      upgraded: reloadUpgraded.customerRuntime,
      partial: reloadPartial.customerRuntime,
    },
    saved: { basic: persistentPart(basicSaved), upgraded: persistentPart(upgradedSaved), partial: persistentPart(partialSaved) },
    reloaded: { basic: persistentPart(reloadBasic), upgraded: persistentPart(reloadUpgraded), partial: persistentPart(reloadPartial) },
    elapsedSeconds: +((Date.now() - startedAt) / 1000).toFixed(1),
  };
  await showReloadedPartialStock();
  if (!passed) throw new Error(`Route/save checks failed: ${JSON.stringify(checks)}`);
} catch (error) {
  thrown = { message: error.message, stack: error.stack };
  await shot('failure').catch(() => {});
}

await context.close();
await browser.close();
const result = {
  pass: PASS,
  timestamp: new Date().toISOString(),
  baseUrl: BASE_URL,
  viewport: VIEWPORT,
  report,
  thrown,
  steps,
  consoleMessages,
  failedRequests,
};
await writeFile(path.join(OUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ passed: !!report?.passed && !thrown, report, thrown, consoleMessages: consoleMessages.length, failedRequests: failedRequests.length }, null, 2));
if (thrown || !report?.passed) process.exitCode = 1;

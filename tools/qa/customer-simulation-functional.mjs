import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8464/';
const stamp = process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-');
const root = path.resolve('qa', 'customer-simulation', 'functional', stamp);
const screenshotsDir = path.join(root, 'screenshots');
const videoDir = path.join(root, 'video');
await mkdir(screenshotsDir, { recursive: true });
await mkdir(videoDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: videoDir, size: { width: 1600, height: 900 } },
});
const page = await context.newPage();
const video = page.video();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));

async function boot({ navigate = true } = {}) {
  if (navigate) await page.goto(url);
  await page.waitForTimeout(1_000);
  const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await clickThroughMenu(page);
  await page.waitForFunction(() => (
    window.__fw?.scene3d?.clubhouse && window.__fw.scene3d.clubhouse()
  ), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90_000 });
  await page.evaluate(() => {
    window.__fw.speedIdx = 0;
    window.__fw.state.tutorial.hidden = true;
  });
  await page.waitForTimeout(700);
}

const shot = async (name) => {
  const file = path.join(screenshotsDir, `${name}.png`);
  await page.screenshot({ path: file });
  return path.relative(root, file).replaceAll('\\', '/');
};

async function resetCustomerFloor(minuteOfDay = 600) {
  await page.evaluate(async (minute) => {
    const app = window.__fw;
    const domain = await import('/src/sim/customerSimulation.js');
    const reservations = await import('/src/sim/reservations.js');
    const sim = domain.customerSimulationOf(app.state);
    for (const customer of [...sim.active]) {
      domain.despawnCustomer(app.state, customer, { reason: 'functional QA reset' });
    }
    sim.scheduled = [];
    sim.serviceQueue = [];
    sim.socketClaims = {};
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + minute;
    reservations.resetGolfOperationsQA(app.state);
    app.scene3d.applyTimeWeather(minute, app.state.weather);
    app.speedIdx = 0;
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 - 8;
    walk.z = 5.10 + 228;
    walk.yaw = 0;
    walk.pitch = -0.18;
  }, minuteOfDay);
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().customerDiagnostics().active === 0);
  await page.waitForTimeout(300);
}

async function finishFrontDeskCheckIn() {
  await page.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await page.getByRole('button', { name: 'Pay cash', exact: true }).click();
  await page.getByRole('button', { name: 'Open drawer', exact: true }).click();
  await page.getByRole('button', { name: /^Accept \$.* & print$/ }).click();
  await page.getByRole('button', { name: 'Take receipt', exact: true }).click();
  await page.getByRole('button', { name: 'Check in party', exact: true }).click();
}

async function runFrontDeskCase({ id, kind, nowMinute, slotMinute = null }) {
  await resetCustomerFloor(nowMinute);
  let setup = await page.evaluate(async (scenario) => {
    const app = window.__fw;
    const domain = await import('/src/sim/customerSimulation.js');
    const reservations = await import('/src/sim/reservations.js');
    const day = Math.floor(app.state.clock.minutes / 1440);
    const ch = app.scene3d.clubhouse();
    const targetMinute = app.state.clock.minutes;
    let reservation = null;
    let intent = domain.CUSTOMER_INTENT.WALK_IN_TEE_TIME;
    if (scenario.kind === 'reservation') {
      // Create the booking before its tee time, then restore the scenario clock
      // and declare the deterministic physical fixture present. The player still
      // performs confirmation, payment and course-access controls in the UI.
      app.state.clock.minutes = day * 1440 + Math.max(
        reservations.TEE_SHEET.openMin,
        Math.min(scenario.nowMinute, scenario.slotMinute) - 60,
      );
      const booked = reservations.bookSlot(app.state, day, scenario.slotMinute, `QA ${scenario.id}`);
      if (!booked.ok) throw new Error(booked.reason);
      reservation = booked.res;
      app.state.clock.minutes = targetMinute;
      reservations.markReservationArrived(app.state, reservation.id, targetMinute);
      intent = domain.CUSTOMER_INTENT.RESERVATION_CHECK_IN;
      domain.customerSimulationOf(app.state).scheduled = [];
    }
    const actor = ch.debugSpawn(true, intent, {
      name: `QA ${scenario.id}`,
      reservationId: reservation?.id || null,
    });
    if (!actor) throw new Error(`could not create ${scenario.id}`);
    actor.entity.patienceSec = 120;
    return {
      actorId: actor.id,
      actorName: actor.name,
      reservationId: reservation?.id || null,
      fee: reservation?.fee ?? app.state.club.greenFee,
      cashBefore: app.state.cash,
    };
  }, { id, kind, nowMinute, slotMinute });

  await page.waitForFunction((actorId) => {
    const actor = window.__fw.scene3d.clubhouse().customerDiagnostics().actors
      .find((entry) => entry.id === actorId);
    return actor?.state === 'Front-desk inquiry';
  }, setup.actorId, { timeout: 15_000 });
  const beforeShot = await shot(`${id}-before-service`);

  // This is the player's interaction. The setup above only creates a deterministic
  // visitor and tee-sheet record; it never invokes the front-desk action directly.
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.frontDeskOpen === true, null, { timeout: 10_000 });
  if (kind === 'walk-in') {
    await page.getByRole('button', { name: 'Walk-in booking', exact: true }).click();
    await page.getByRole('textbox', { name: 'Walk-in reservation holder' }).fill(setup.actorName);
    const createButton = page.getByRole('button', { name: 'Create booking', exact: true });
    if (!(await createButton.isEnabled())) {
      const diagnostics = await page.evaluate(async () => {
        const operations = await import('/src/sim/reservations.js');
        const state = window.__fw.state;
        const dayAbs = Math.floor(state.clock.minutes / 1440);
        return {
          clock: state.clock.minutes,
          dayAbs,
          config: state.reservations.config,
          booked: state.reservations.booked.map((entry) => ({ id: entry.id, minute: entry.minute, status: entry.status })),
          slots: operations.availableSlots(state, dayAbs, { partySize: 1, walkIn: true })
            .map((slot) => ({ minute: slot.minute, availableSeats: slot.availableSeats })),
          holder: document.querySelector('[aria-label="Walk-in reservation holder"]')?.value || '',
        };
      });
      throw new Error(`Walk-in form unexpectedly disabled: ${JSON.stringify(diagnostics)}`);
    }
    await createButton.click();
    const created = await page.evaluate((actorId) => {
      const state = window.__fw.state;
      const actor = state.shop.customerSimulation.active.find((entry) => entry.id === actorId);
      const reservation = state.reservations.booked.find((entry) => entry.id === actor?.reservationId);
      return { reservationId: reservation?.id || null, fee: reservation?.fee || 0 };
    }, setup.actorId);
    if (!created.reservationId) throw new Error('The physical walk-in did not claim the canonical booking.');
    setup = { ...setup, ...created };
  }
  await finishFrontDeskCheckIn();
  await page.waitForFunction((actorId) => {
    const sim = window.__fw.state.shop.customerSimulation;
    const actor = sim.active.find((entry) => entry.id === actorId);
    return actor?.experience.checkInSuccess === 1;
  }, setup.actorId, { timeout: 10_000 });
  await page.waitForTimeout(250);
  const afterShot = await shot(`${id}-after-service`);
  const result = await page.evaluate(({ actorId, reservationId, cashBefore }) => {
    const state = window.__fw.state;
    const actor = state.shop.customerSimulation.active.find((entry) => entry.id === actorId);
    const reservation = reservationId
      ? state.reservations.booked.find((entry) => entry.id === reservationId)
      : null;
    return {
      state: actor?.state || null,
      checkInSuccess: actor?.experience?.checkInSuccess ?? null,
      reason: actor?.stateReason || null,
      reservationStatus: reservation?.status || null,
      cashDelta: state.cash - cashBefore,
      serviceQueue: [...state.shop.customerSimulation.serviceQueue],
    };
  }, { ...setup });
  await page.keyboard.press('Escape');
  const passed = result.checkInSuccess === 1
    && Math.abs(result.cashDelta - setup.fee) < 0.001
    && result.reservationStatus === 'played';
  return { id, kind, nowMinute, slotMinute, setup, result, screenshots: [beforeShot, afterShot], passed };
}

async function runCancellationCase() {
  const id = 'cancelled-arrival';
  const nowMinute = 600;
  const slotMinute = 630;
  await resetCustomerFloor(nowMinute);
  const setup = await page.evaluate(async ({ id: caseId, now, slot }) => {
    const app = window.__fw;
    const domain = await import('/src/sim/customerSimulation.js');
    const reservations = await import('/src/sim/reservations.js');
    const day = Math.floor(app.state.clock.minutes / 1440);
    app.state.clock.minutes = day * 1440 + 540;
    const booked = reservations.bookSlot(app.state, day, slot, `QA ${caseId}`);
    if (!booked.ok) throw new Error(booked.reason);
    app.state.clock.minutes = day * 1440 + now;
    reservations.markReservationArrived(app.state, booked.res.id, app.state.clock.minutes);
    domain.customerSimulationOf(app.state).scheduled = [];
    const actor = app.scene3d.clubhouse().debugSpawn(true, domain.CUSTOMER_INTENT.RESERVATION_CHECK_IN, {
      name: `QA ${caseId}`,
      reservationId: booked.res.id,
    });
    return { actorId: actor.id, reservationId: booked.res.id, cashBefore: app.state.cash };
  }, { id, now: nowMinute, slot: slotMinute });
  await page.waitForFunction((actorId) => {
    const actor = window.__fw.scene3d.clubhouse().customerDiagnostics().actors.find((entry) => entry.id === actorId);
    return actor?.state === 'Front-desk inquiry';
  }, setup.actorId, { timeout: 15_000 });
  const beforeShot = await shot(`${id}-before-service`);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.frontDeskOpen === true, null, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Cancel booking', exact: true }).first().click();
  await page.locator('.fd-confirm').getByRole('button', { name: 'Cancel booking', exact: true }).click();
  await page.waitForFunction((actorId) => {
    const actor = window.__fw.state.shop.customerSimulation.active.find((entry) => entry.id === actorId);
    return actor?.state === 'Leaving';
  }, setup.actorId, { timeout: 10_000 });
  const afterShot = await shot(`${id}-after-service`);
  const result = await page.evaluate(({ actorId, reservationId, cashBefore }) => {
    const state = window.__fw.state;
    const actor = state.shop.customerSimulation.active.find((entry) => entry.id === actorId);
    const reservation = state.reservations.booked.find((entry) => entry.id === reservationId);
    return {
      state: actor?.state || null,
      reservationStatus: reservation?.status || null,
      cashDelta: state.cash - cashBefore,
    };
  }, setup);
  await page.keyboard.press('Escape');
  return {
    id,
    kind: 'reservation-cancellation',
    nowMinute,
    slotMinute,
    setup,
    result,
    screenshots: [beforeShot, afterShot],
    passed: result.state === 'Leaving' && result.reservationStatus === 'cancelled' && result.cashDelta === 0,
  };
}

await boot();
const frontDesk = [];
frontDesk.push(await runFrontDeskCase({ id: 'early-reservation', kind: 'reservation', nowMinute: 600, slotMinute: 630 }));
frontDesk.push(await runFrontDeskCase({ id: 'on-time-reservation', kind: 'reservation', nowMinute: 600, slotMinute: 600 }));
frontDesk.push(await runFrontDeskCase({ id: 'late-reservation', kind: 'reservation', nowMinute: 630, slotMinute: 600 }));
frontDesk.push(await runCancellationCase());
frontDesk.push(await runFrontDeskCase({ id: 'walk-in', kind: 'walk-in', nowMinute: 660 }));

// Keep a busy checkout at the head and let the second customer's own patience
// expire. Their real reserved unit must return to the shelf and held ledger.
await resetCustomerFloor(660);
const abandonmentSetup = await page.evaluate(async () => {
  const app = window.__fw;
  const ch = app.scene3d.clubhouse();
  const domain = await import('/src/sim/customerSimulation.js');
  app.state.shop.inventory.balls1.shelf = 3;
  app.state.shop.inventory.glove1.shelf = 3;
  app.state.shop.held = [];
  ch.rebuildStock();
  ch.sendToCounter(['balls1'], 'card');
  const first = domain.customerSimulationOf(app.state).active.at(-1);
  ch.sendToCounter(['glove1'], 'cash');
  const second = domain.customerSimulationOf(app.state).active.at(-1);
  second.patienceSec = 0.6;
  return {
    firstId: first.id,
    secondId: second.id,
    secondUid: second.cart[0].uid,
    shelfBeforeWait: app.state.shop.inventory.glove1.shelf,
    lostSalesBefore: app.state.shop.lostSalesTotal || 0,
  };
});
await page.waitForFunction((id) => {
  const actor = window.__fw.state.shop.customerSimulation.active.find((entry) => entry.id === id);
  return actor?.experience?.abandonedReason === 'the service wait exceeded their patience';
}, abandonmentSetup.secondId, { timeout: 15_000 });
const abandonmentShot = await shot('patience-abandonment');
const abandonmentResult = await page.evaluate(({ secondId, secondUid }) => {
  const state = window.__fw.state;
  const customer = state.shop.customerSimulation.active.find((entry) => entry.id === secondId);
  return {
    state: customer?.state || null,
    reason: customer?.experience?.abandonedReason || null,
    cartCount: customer?.cart?.length ?? null,
    heldUidCount: state.shop.held.filter((entry) => entry.uid === secondUid).length,
    shelfAfterWait: state.shop.inventory.glove1.shelf,
    lostSales: state.shop.lostSalesTotal || 0,
  };
}, abandonmentSetup);
const abandonment = {
  setup: abandonmentSetup,
  result: abandonmentResult,
  screenshot: abandonmentShot,
  passed: abandonmentResult.state === 'Leaving'
    && abandonmentResult.cartCount === 0
    && abandonmentResult.heldUidCount === 0
    && abandonmentResult.shelfAfterWait === abandonmentSetup.shelfBeforeWait + 1
    && abandonmentResult.lostSales === abandonmentSetup.lostSalesBefore + 1,
};

// Reload to clear the deliberately unfinished first sale, then prove the persistent
// customer checkpoint with a half-scanned real transaction and the game's autosave.
await page.reload();
await boot({ navigate: false });
await resetCustomerFloor(840);
const saveSetup = await page.evaluate(async () => {
  const app = window.__fw;
  const ch = app.scene3d.clubhouse();
  const domain = await import('/src/sim/customerSimulation.js');
  const lifecycle = await import('/src/sim/inventoryLifecycle.js');
  lifecycle.ensureInventoryLifecycle(app.state);
  for (const id of ['balls3', 'glove1']) {
    const inv = app.state.shop.inventory[id];
    const wanted = Math.max(inv.shelf, 5);
    const added = wanted - inv.shelf;
    if (added > 0) {
      const adopted = lifecycle.adoptExternalInventory(app.state, {
        skuId: id,
        quantity: added,
        stage: lifecycle.INVENTORY_STAGE.SHELF,
        note: 'Customer save/reload browser fixture',
      });
      if (!adopted.ok) throw new Error(adopted.reason);
      inv.shelf = wanted;
    }
  }
  app.state.shop.held = [];
  app.state.shop.salesLive = { units: 0, revenue: 0 };
  ch.rebuildStock();
  const name = ch.sendToCounter(['balls3', 'glove1'], 'card');
  const customer = domain.customerSimulationOf(app.state).active.find((entry) => entry.name === name);
  return { id: customer.id, name, uids: customer.cart.map((entry) => entry.uid) };
});
await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 15_000 });
await page.keyboard.press('e');
await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10_000 });
await page.waitForFunction((eye) => {
  const camera = window.__fw.scene3d.camera;
  return Math.hypot(camera.position.x - eye.x, camera.position.z - eye.z) < 0.03;
}, { x: 2.78 - 8, z: 5.52 + 228 }, { timeout: 15_000 });
const pixels = await page.evaluate(async () => {
  const THREE = await import('/vendor/three.module.js');
  const app = window.__fw;
  const ch = app.scene3d.clubhouse();
  const items = [];
  ch.interior.traverse((object) => {
    if (object.userData?.kind === 'item' && object.visible) items.push(object);
  });
  const centre = new THREE.Box3().setFromObject(items[0]).getCenter(new THREE.Vector3());
  const project = (local) => {
    const point = new THREE.Vector3(
      local.x + ch.interior.position.x,
      local.y + ch.interior.position.y,
      local.z + ch.interior.position.z,
    ).project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((-point.y + 1) / 2) * rect.height,
    };
  };
  return {
    from: project({
      x: centre.x - ch.interior.position.x,
      y: centre.y - ch.interior.position.y,
      z: centre.z - ch.interior.position.z,
    }),
    scanner: project({ x: 2.70, y: 1.17, z: 4.22 }),
    bagSide: project({ x: 3.68, y: 1.17, z: 4.44 }),
  };
});
await page.mouse.move(pixels.from.x, pixels.from.y);
await page.mouse.down();
let cursor = pixels.from;
for (const destination of [pixels.scanner, pixels.bagSide]) {
  for (let step = 1; step <= 12; step++) {
    const t = step / 12;
    await page.mouse.move(
      cursor.x + (destination.x - cursor.x) * t,
      cursor.y + (destination.y - cursor.y) * t,
    );
    await page.waitForTimeout(14);
  }
  cursor = destination;
}
await page.mouse.up();
await page.waitForFunction(() => {
  const tx = window.__fw.scene3d.clubhouse().register.getTx();
  return tx?.items.filter((item) => item.scanned).length === 1;
}, null, { timeout: 10_000 });
const saveBeforeShot = await shot('save-half-scanned');
const preSave = await page.evaluate(async (fixture) => {
  const app = window.__fw;
  await app.autosave();
  const raw = localStorage.getItem('golfempire:autosave');
  const parsed = JSON.parse(raw);
  const savedState = parsed.holdings.find((holding) => holding.property.id === parsed.activeId)?.state
    || parsed.holdings[0].state;
  const customer = savedState.shop.customerSimulation.active.find((entry) => entry.id === fixture.id);
  return {
    bytes: raw.length,
    state: customer.state,
    cartUids: customer.cart.map((entry) => entry.uid),
    heldUids: savedState.shop.held.filter((entry) => fixture.uids.includes(entry.uid)).map((entry) => entry.uid),
    scanned: app.scene3d.clubhouse().register.getTx().items.filter((item) => item.scanned).length,
    revenue: savedState.shop.salesLive.revenue,
  };
}, saveSetup);

async function reloadCheckpoint() {
  await page.reload();
  await boot({ navigate: false });
  const checkpoint = await page.evaluate((fixture) => {
    const state = window.__fw.state;
    const matching = state.shop.customerSimulation.active.filter((entry) => entry.id === fixture.id);
    const customer = matching[0];
    return {
      matchingCustomers: matching.length,
      state: customer?.state || null,
      cartUids: customer?.cart?.map((entry) => entry.uid) || [],
      heldUids: state.shop.held.filter((entry) => fixture.uids.includes(entry.uid)).map((entry) => entry.uid),
      queueCount: state.shop.customerSimulation.serviceQueue.filter((id) => id === fixture.id).length,
      transactionRelationship: customer?.transactionRelationship || null,
      revenue: state.shop.salesLive.revenue,
      units: state.shop.salesLive.units,
    };
  }, saveSetup);
  // Saves intentionally return the player to the course. Re-enter the clubhouse
  // camera after recording the checkpoint so the evidence also proves the restored
  // actor/queue can be rendered and resumed in the physical service area.
  await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk.state;
    walk.x = 2.80 - 8;
    walk.z = 5.10 + 228;
    walk.yaw = 0;
    walk.pitch = -0.18;
  });
  await page.waitForTimeout(600);
  return checkpoint;
}

const firstReload = await reloadCheckpoint();
const reloadShot = await shot('save-first-reload');
await page.evaluate(() => window.__fw.autosave());
const secondReload = await reloadCheckpoint();
const secondReloadShot = await shot('save-second-reload');
const safeStates = new Set(['Waiting in queue', 'Moving to register', 'Staging products', 'Waiting for cashier']);
const saveReload = {
  setup: saveSetup,
  preSave,
  firstReload,
  secondReload,
  screenshots: [saveBeforeShot, reloadShot, secondReloadShot],
  passed: preSave.scanned === 1
    && preSave.heldUids.length === 2
    && firstReload.matchingCustomers === 1
    && secondReload.matchingCustomers === 1
    && firstReload.heldUids.length === 2
    && secondReload.heldUids.length === 2
    && firstReload.cartUids.length === 2
    && secondReload.cartUids.length === 2
    && safeStates.has(firstReload.state)
    && safeStates.has(secondReload.state)
    && firstReload.transactionRelationship === null
    && secondReload.transactionRelationship === null
    && firstReload.revenue === 0
    && secondReload.revenue === 0
    && firstReload.units === 0
    && secondReload.units === 0,
};

await page.close();
const videoPath = video ? await video.path() : null;
await context.close();
await browser.close();

const report = {
  stamp,
  url,
  protocol: 'canonical front-desk UI through normal E/mouse controls, real patience timing, physical half-scan, game autosave, real reload',
  frontDesk,
  abandonment,
  saveReload,
  errors: errors.slice(0, 20),
  errorCount: errors.length,
  videoPath,
};
report.passed = frontDesk.every((entry) => entry.passed)
  && abandonment.passed
  && saveReload.passed
  && report.errorCount === 0;
await writeFile(path.join(root, 'functional.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;

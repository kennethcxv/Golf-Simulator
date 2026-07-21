import fs from 'node:fs';
import path from 'node:path';

import {
  captureCashierBuildSnapshot,
  finalizeCashierQaResult,
} from './cashier-build-snapshot.mjs';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
const DEFAULT_VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const REQUIRED_VIEWPORTS = Object.freeze(['1280x720', '1600x900', '1920x1080']);
let VIEWPORT = { ...DEFAULT_VIEWPORT };
const SKUS = ['tees1', 'marker1', 'glove1'];

function configureViewport(value) {
  const raw = String(value || '').trim().toLowerCase().replace('×', 'x');
  if (!raw) {
    VIEWPORT = { ...DEFAULT_VIEWPORT };
    return { explicit: false, tag: `${VIEWPORT.width}x${VIEWPORT.height}` };
  }
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(raw);
  if (!match) throw new Error(`Invalid QA viewport "${value}". Use WIDTHxHEIGHT.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 640 || height < 360) throw new Error(`QA viewport ${raw} is too small for the production route.`);
  VIEWPORT = { width, height };
  return { explicit: true, tag: `${width}x${height}` };
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function boot(page) {
  await page.goto(BASE_URL);
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(1000);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null,
  { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);
}

async function setupFixture(page, mode) {
  return page.evaluate(([skuIds, payment]) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inventory = app.state.shop.inventory[id];
      if (skuIds.includes(id)) inventory.shelf = Math.max(inventory.shelf, 12);
    }
    app.state.shop.markup.accessories = 1.15;
    app.state.shop.markup.apparel = 1.15;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
    };
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    clubhouse.rebuildStock();
    const shop = app.state.shop;
    const before = {
      units: (shop.salesLive || {}).units || 0,
      revenue: (shop.salesLive || {}).revenue || 0,
      held: (shop.held || []).length,
      history: (shop.transactionHistory || []).length,
      shelf: Object.fromEntries(skuIds.map((id) => [id, shop.inventory[id].shelf])),
    };
    const walk = app.scene3d.walk.state;
    // Place the player at the staff stand using the clubhouse's LIVE interior
    // offset. A hardcoded offset goes stale the moment the building's world
    // placement moves (the course rebuild shifted it ~350yd), which drops the
    // player out on the course where a turf prop steals the [E] focus.
    const off = clubhouse.interior.position;
    walk.x = 2.80 + off.x;
    walk.z = 5.10 + off.z;
    walk.yaw = 0;
    walk.pitch = -0.18;
    const customer = clubhouse.sendToCounter(skuIds, payment);
    return { before, customer };
  }, [SKUS, mode]);
}

async function projectObject(page, predicate) {
  return page.evaluate(async (query) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((object) => {
      if (found || !object.visible || !object.userData) return;
      const data = object.userData;
      if (query.kind && data.kind !== query.kind) return;
      if (query.uid && data.uid !== query.uid) return;
      if (query.from && data.from !== query.from) return;
      if (query.denom !== undefined && Number(data.denom) !== Number(query.denom)) return;
      found = object;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = bounds.isEmpty()
      ? found.getWorldPosition(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3());
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    let screenBounds = null;
    let fullyInView = false;
    if (!bounds.isEmpty()) {
      const xs = [bounds.min.x, bounds.max.x];
      const ys = [bounds.min.y, bounds.max.y];
      const zs = [bounds.min.z, bounds.max.z];
      const projected = [];
      for (const x of xs) {
        for (const y of ys) {
          for (const z of zs) {
            const corner = new THREE.Vector3(x, y, z).project(app.scene3d.camera);
            projected.push({
              x: rect.left + ((corner.x + 1) / 2) * rect.width,
              y: rect.top + ((-corner.y + 1) / 2) * rect.height,
              z: corner.z,
            });
          }
        }
      }
      const left = Math.min(...projected.map((point) => point.x));
      const top = Math.min(...projected.map((point) => point.y));
      const right = Math.max(...projected.map((point) => point.x));
      const bottom = Math.max(...projected.map((point) => point.y));
      screenBounds = { left, top, right, bottom, width: right - left, height: bottom - top };
      fullyInView = projected.every((point) => point.z >= -1 && point.z <= 1)
        && left >= rect.left && top >= rect.top
        && right <= rect.right && bottom <= rect.bottom;
    }
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
      fullyInView,
      screenBounds,
    };
  }, predicate);
}

async function projectLocal(page, point) {
  return page.evaluate(async (local) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const world = new THREE.Vector3(
      local.x + clubhouse.interior.position.x,
      local.y + clubhouse.interior.position.y,
      local.z + clubhouse.interior.position.z,
    );
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, point);
}

async function monitorClick(page, action) {
  await page.waitForFunction((id) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.monitorScreenPoint(id);
    return register.workspace() === 'monitor' && point && point.inView;
  }, action, { timeout: 10000 });
  const point = await page.evaluate((id) => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
  ), action);
  assert(point && point.inView, `Monitor action ${action} is not visible.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(180);
  return point;
}

async function waitCamera(page, workspace) {
  await page.evaluate(() => { window.__simplifiedAcceptanceCameraProbe = null; });
  await page.waitForFunction((wanted) => {
    const app = window.__fw;
    const register = app.scene3d.clubhouse().register;
    if (register.workspace() !== wanted) return false;
    const camera = app.scene3d.camera;
    const now = {
      x: camera.position.x, y: camera.position.y, z: camera.position.z,
      qx: camera.quaternion.x, qy: camera.quaternion.y,
      qz: camera.quaternion.z, qw: camera.quaternion.w,
      fov: camera.fov,
    };
    const old = window.__simplifiedAcceptanceCameraProbe;
    if (!old) {
      window.__simplifiedAcceptanceCameraProbe = { ...now, stable: 0 };
      return false;
    }
    const delta = Math.max(
      Math.abs(now.x - old.x), Math.abs(now.y - old.y), Math.abs(now.z - old.z),
      Math.abs(now.qx - old.qx), Math.abs(now.qy - old.qy),
      Math.abs(now.qz - old.qz), Math.abs(now.qw - old.qw),
      Math.abs(now.fov - old.fov),
    );
    const stable = delta < 0.0008 ? old.stable + 1 : 0;
    window.__simplifiedAcceptanceCameraProbe = { ...now, stable };
    return stable >= 4;
  }, workspace, { timeout: 12000, polling: 80 });
}

async function escapeFrontDesk(page) {
  for (let step = 0; step < 4; step += 1) {
    const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
    if (!active) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
  }
  const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
  assert(!active, 'Escape did not back out through the shared monitor and leave the front desk.');
}

// what does a pick ray at this screen point actually hit? (failure forensics)
async function clickDiagnostic(page, x, y) {
  const hits = await page.evaluate(async (point) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((point.x - rect.left) / rect.width) * 2 - 1,
      -(((point.y - rect.top) / rect.height) * 2 - 1),
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, app.scene3d.camera);
    return ray.intersectObjects(app.scene3d.clubhouse().interior.children, true)
      .slice(0, 6)
      .map((h) => ({
        name: h.object.name || '(unnamed)',
        kind: h.object.userData.kind || null,
        uid: h.object.userData.uid || null,
        pick: !!h.object.userData.pick,
        d: Math.round(h.distance * 100) / 100,
      }));
  }, { x, y });
  return `click at ${Math.round(x)},${Math.round(y)} hit: ${JSON.stringify(hits)}`;
}

async function scanAll(page, shot, mode) {
  // Arrival already opens ON the goods (the one mixed working frame); the
  // separate "Bag Items" monitor step only exists when re-entering via the
  // monitor workspace, so the acceptance route rings items up directly.
  await waitCamera(page, 'scan');
  await shot('05-scanner-workspace.png');
  const items = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
  ));
  for (let index = 0; index < items.length; index += 1) {
    const uid = items[index];
    // bagging the previous item re-lays the remaining goods out on the counter,
    // so wait for THIS item's projected position to stop moving before aiming
    let product = await projectObject(page, { kind: 'item', uid });
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await projectObject(page, { kind: 'item', uid });
      if (next && product && Math.abs(next.x - product.x) < 1.5 && Math.abs(next.y - product.y) < 1.5) {
        product = next;
        break;
      }
      product = next;
    }
    assert(product && product.inView, `${uid} is not visible in the scan workspace.`);
    // click-to-bag: one click on the goods rings the item up and sends it to
    // the bag — there is no centring or swipe gesture in the production flow
    await page.mouse.click(product.x, product.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.items.find((item) => item.uid === id)?.scanned;
    }, uid, { timeout: 5000 }).catch(async (error) => {
      throw new Error(`${error.message} — ${await clickDiagnostic(page, product.x, product.y)}`);
    });
    if (index === 0) await shot('06-first-product-scanned.png');
    // let the bagged item finish its flight — it crosses OVER the remaining
    // goods on the way to the bag, and a click through it would be swallowed
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.items.find((item) => item.uid === id)?.staged;
    }, uid, { timeout: 8000 });
    if (index === 1) await shot('06b-mid-bagging.png');
    await page.waitForTimeout(220);
  }
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return register.workspace() === 'monitor' && tx && tx.stage === 'scanning'
      && tx.items.every((item) => item.scanned && item.staged);
  }, null, { timeout: 5000 });
  // The final product triggers the eased scan-to-monitor camera transition. A
  // workspace flag changes at the start of that transition, so the old 120 ms
  // wait retained a half-framed monitor. This checkpoint intentionally uses a
  // bounded settle: the automatic customer choice advances to card/cash after
  // 1.35 s on the monitor, so the general four-sample stability wait would race
  // that production timer and miss the all-scanned state entirely.
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.workspace() === 'monitor'
  ), null, { timeout: 5000 });
  await page.waitForTimeout(720);
  const automaticChoice = await page.evaluate(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    const hotspotIds = register.monitorHotspots().map((hotspot) => hotspot.id);
    return { prefer: tx?.prefer, stage: tx?.stage, hotspotIds };
  });
  assert(automaticChoice.prefer === mode,
    `Expected the customer to choose ${mode}, got ${automaticChoice.prefer}.`);
  assert(!automaticChoice.hotspotIds.includes('pay-card') && !automaticChoice.hotspotIds.includes('pay-cash'),
    'The shared monitor still asks the player to choose the customer payment method.');
  await shot('07-all-products-scanned.png');
}

async function insertCardGesture(page, shot, {
  handoffLabel,
  cancelledLabel = null,
  representedLabel = null,
  insertedLabel,
  processingLabel,
  exerciseModalExit = false,
  exerciseAmountErrors = false,
}) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-ready'
      && tx.checkoutFlow?.state === 'CardInsertReady';
  }, null, { timeout: 7000 });
  // handoff frame: the camera is on the CUSTOMER, the card waits in their hand
  await waitCamera(page, 'card'); // workspace stays 'card' across handoff+entry
  if (handoffLabel) await shot(handoffLabel);

  if (exerciseModalExit) {
    // While the card is waiting, the reader is already modal: Escape and
    // right-click must NOT leave, mutate the transaction, or unlock the reader.
    // The visible X remains the one intentional pre-authorization exit.
    const beforeModalInputs = await page.evaluate(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      return {
        active: register.isActive(),
        workspace: register.workspace(),
        locked: register.cardTerminalLocked(),
        number: tx?.number,
        stage: tx?.stage,
        method: tx?.method,
      };
    });
    assert(beforeModalInputs.active && beforeModalInputs.workspace === 'card'
      && beforeModalInputs.locked && beforeModalInputs.stage === 'card-ready',
    `Card handoff is not modal: ${JSON.stringify(beforeModalInputs)}.`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(160);
    await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2, { button: 'right' });
    await page.waitForTimeout(160);
    const afterModalInputs = await page.evaluate(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      return {
        active: register.isActive(),
        workspace: register.workspace(),
        locked: register.cardTerminalLocked(),
        number: tx?.number,
        stage: tx?.stage,
        method: tx?.method,
      };
    });
    assert(afterModalInputs.active && afterModalInputs.workspace === 'card' && afterModalInputs.locked,
      `Escape/right-click escaped the modal card reader: ${JSON.stringify(afterModalInputs)}.`);
    assert(afterModalInputs.number === beforeModalInputs.number
      && afterModalInputs.stage === beforeModalInputs.stage
      && afterModalInputs.method === beforeModalInputs.method,
    'Escape/right-click mutated the pre-authorization card transaction.');
    await shot('09a-escape-and-right-click-blocked.png');

    const xBefore = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.cardXScreenPoint()
    ));
    assert(xBefore && xBefore.visible && xBefore.inView,
      'The cancel X is not visible/on-screen during the handoff.');
    // The X is the ONE exit: click it and the run drops back to the post-scan
    // choice point with the basket intact, then the customer re-presents the card.
    await page.mouse.click(xBefore.x, xBefore.y);
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      return register.workspace() === 'monitor' && tx && tx.stage === 'scanning'
        && tx.items.every((item) => item.scanned && item.staged);
    }, null, { timeout: 4000 });
    if (cancelledLabel) await shot(cancelledLabel);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.stage === 'card-ready'
        && tx.checkoutFlow?.state === 'CardInsertReady';
    }, null, { timeout: 7000 });
    await waitCamera(page, 'card');
    if (representedLabel) await shot(representedLabel);
  }

  // Click-to-insert: ONE click on the presented card runs the complete insert.
  const cardPt = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint());
  assert(cardPt && cardPt.inView, `The presented card is outside the handoff camera: ${JSON.stringify(cardPt)}`);
  await page.mouse.click(cardPt.x, cardPt.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.checkoutFlow?.state === 'CardInserting';
  }, null, { timeout: 2000 });
  await shot(`${insertedLabel.replace(/\.png$/i, '')}-cashier-pickup-hold.png`);
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    const insertion = register.insertAt();
    return tx?.checkoutFlow?.state === 'CardInserting'
      && insertion.u >= 0.62 && insertion.u < 1;
  }, null, { timeout: 2000 });
  await shot(`${insertedLabel.replace(/\.png$/i, '')}-automatic-insert-motion.png`);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-entry' && tx.checkoutFlow?.state === 'CardAmountEntry';
  }, null, { timeout: 5000 }).catch(async (error) => {
    throw new Error(`${error.message} — ${await clickDiagnostic(page, cardPt.x, cardPt.y)}`);
  });
  // Insertion opens an EMPTY amount field. The cashier must key the displayed
  // total on the physical reader; neither the renderer nor the QA driver may
  // copy the transaction total directly into domain state.
  await waitCamera(page, 'card');
  const entry = await page.evaluate(async () => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const { cardEnteredAmount, totalOf } = await import('/src/sim/register.js');
    const total = totalOf(tx);
    const expectedCents = Math.round(total * 100);
    return {
      stage: tx?.stage,
      flow: tx?.checkoutFlow?.state,
      total,
      expectedCents,
      entered: cardEnteredAmount(tx),
      entryCents: Number(tx?.cardEntryCents),
      entryDigits: String(tx?.cardEntryDigits || ''),
      error: tx?.cardEntryError || null,
    };
  });
  assert(entry.stage === 'card-entry' && entry.flow === 'CardAmountEntry',
    `Card insertion did not reach amount entry: ${JSON.stringify(entry)}.`);
  assert(entry.entryCents === 0 && entry.entryDigits === ''
      && Math.round(entry.entered * 100) === 0 && entry.error === null,
  `Inserted card did not open an empty amount field: ${JSON.stringify(entry)}.`);
  await shot(insertedLabel);

  const clickKey = async (label) => {
    const point = await page.evaluate((key) => (
      window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint(key)
    ), label);
    assert(point?.inView, `Card keypad key ${label} is outside the terminal camera.`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(100);
  };
  // Empty and mismatched amounts must stay in entry with visible rejection.
  await clickKey('OK');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-entry' && tx.cardEntryError === 'ENTER AMOUNT';
  }, null, { timeout: 2000 });
  await shot(`${insertedLabel.replace(/\.png$/i, '')}-empty-error.png`);

  if (exerciseAmountErrors) {
    for (const digit of String(entry.expectedCents + 1)) await clickKey(digit);
    await clickKey('OK');
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'card-entry' && tx.cardEntryError === 'AMOUNT MUST MATCH TOTAL';
    }, null, { timeout: 2000 });
    await shot(`${insertedLabel.replace(/\.png$/i, '')}-wrong-error.png`);
    await clickKey('CANCEL');
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'card-entry' && tx.cardEntryDigits === '' && tx.cardEntryError === null;
    }, null, { timeout: 2000 });
  }

  // Key the exact cents through normal reader clicks, then submit once.
  for (const digit of String(entry.expectedCents)) await clickKey(digit);
  await page.waitForFunction((expectedCents) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-entry' && tx.cardEntryCents === expectedCents
      && tx.cardEntryDigits === String(expectedCents) && tx.cardEntryError === null;
  }, entry.expectedCents, { timeout: 2000 });
  await shot(`${insertedLabel.replace(/\.png$/i, '')}-amount-entered.png`);
  await clickKey('OK');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-busy' && tx.checkoutFlow?.state === 'CardProcessing';
  }, null, { timeout: 4000 });
  await shot(processingLabel);
  return entry;
}

async function cardRoute(page, shot) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && (tx.stage === 'card-present' || tx.stage === 'card-ready');
  }, null, { timeout: 7000 });
  await waitCamera(page, 'card');
  await shot('08-card-presented.png');

  // Drive the live, unforced runCard path deterministically: the first value is
  // below the first-card decline threshold and the replacement is well above
  // its lower threshold. Recording consumption proves the renderer consulted
  // tx.rng instead of bypassing normal authorization with a force override.
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const values = [0, 0.99];
    tx.__qaCardRngTrace = [];
    tx.rng = () => {
      const value = values.length ? values.shift() : 0.99;
      tx.__qaCardRngTrace.push(value);
      return value;
    };
  });

  // The initial handoff covers Escape/right-click locking and the visible X
  // cancel/re-present route before insertion and keyed amount entry.
  await insertCardGesture(page, shot, {
    handoffLabel: '09-card-handoff-modal-locked.png',
    cancelledLabel: '09b-card-cancelled-to-monitor.png',
    representedLabel: '09c-card-represented.png',
    insertedLabel: '10-card-entry-empty.png',
    processingLabel: '10b-card-processing-first-attempt.png',
    exerciseModalExit: true,
    exerciseAmountErrors: true,
  });
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-declined'
      && tx.checkoutFlow?.state === 'CardDeclined';
  }, null, { timeout: 7000 });
  const declined = await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      stage: tx?.stage,
      result: tx?.cardResult,
      attempts: tx?.cardAttempts,
      cardsTried: tx?.cardsTried,
      rngTrace: [...(tx?.__qaCardRngTrace || [])],
    };
  });
  assert(declined.result === 'declined' && declined.attempts === 1 && declined.cardsTried === 1,
    `First normal card authorization did not decline exactly once: ${JSON.stringify(declined)}.`);
  assert(JSON.stringify(declined.rngTrace) === JSON.stringify([0]),
    `First authorization bypassed or over-consumed tx.rng: ${JSON.stringify(declined.rngTrace)}.`);
  await shot('10c-card-declined-reader.png');

  await waitCamera(page, 'monitor');
  await shot('10d-card-declined-retry-choice.png');
  await monitorClick(page, 'retry-card');

  // A normal monitor click presents a different card. It follows the same
  // insert and keyed exact-total path, without debug hooks.
  await insertCardGesture(page, shot, {
    handoffLabel: '11-replacement-card-presented.png',
    insertedLabel: '11b-replacement-card-entry-empty.png',
    processingLabel: '11c-replacement-card-processing.png',
  });
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'receipt'
      && tx.checkoutFlow?.state === 'CardApproved';
  }, null, { timeout: 7000 });
  const approved = await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      stage: tx?.stage,
      result: tx?.cardResult,
      attempts: tx?.cardAttempts,
      cardsTried: tx?.cardsTried,
      rngTrace: [...(tx?.__qaCardRngTrace || [])],
    };
  });
  assert(approved.result === 'approved' && approved.attempts === 2 && approved.cardsTried === 2,
    `Replacement card did not approve on the second normal attempt: ${JSON.stringify(approved)}.`);
  assert(JSON.stringify(approved.rngTrace) === JSON.stringify([0, 0.99]),
    `Normal decline/retry did not consume the seeded RNG sequence once per attempt: ${JSON.stringify(approved.rngTrace)}.`);
  await shot('12-card-accepted.png');
}

async function cashRoute(page, shot) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'cash-tender';
  }, null, { timeout: 7000 });
  const cashFacts = await page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      total: register.cashTotalOf(tx),
      tendered: register.stackTotal(tx.tendered),
      change: register.changeDue(tx),
    };
  });
  assert(cashFacts.total === 35.72, `Expected exact cash total $35.72, got $${cashFacts.total}.`);
  assert(cashFacts.tendered === 40, `Expected $40.00 tender, got $${cashFacts.tendered}.`);
  assert(cashFacts.change === 4.28, `Expected $4.28 change, got $${cashFacts.change}.`);
  // The cash is offered in the customer's hand. Let the live handoff pose settle
  // before framing evidence or resolving a physical click target.
  await waitCamera(page, 'monitor');
  let handful = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint());
  assert(handful && handful.inView, 'The presented cash is not visible in the working frame.');
  await shot('08-cash-presented.png');

  // Bind the QA proof to the authored tray, not a timer or transaction flag.
  // Capture its closed local Z and world scale before normal input so the later
  // midpoint uses the same world-space travel units as REGISTER.drawer.travel.
  const drawerTravelStart = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const { REGISTER } = await import('/src/data/shopLayout.js');
    const clubhouse = window.__fw.scene3d.clubhouse();
    const trays = [];
    clubhouse.interior.traverse((object) => {
      if (object.name === 'CashDrawer_Tray') trays.push(object);
    });
    if (trays.length !== 1) {
      throw new Error(`Expected one authored CashDrawer_Tray, found ${trays.length}.`);
    }
    clubhouse.interior.updateMatrixWorld(true);
    const tray = trays[0];
    const worldScaleZ = Math.abs(tray.getWorldScale(new THREE.Vector3()).z);
    const closedWorldZ = tray.getWorldPosition(new THREE.Vector3()).z;
    window.__registerQaCashDrawerTray = tray;
    window.__registerQaCashDrawerMidpoint = null;
    return {
      uuid: tray.uuid,
      closedLocalZ: tray.position.z,
      closedWorldZ,
      worldScaleZ,
      travel: Number(REGISTER.drawer.travel),
    };
  });
  assert(Number.isFinite(drawerTravelStart.closedLocalZ)
      && drawerTravelStart.worldScaleZ > 0 && drawerTravelStart.travel > 0,
  `The authored drawer travel baseline is invalid: ${JSON.stringify(drawerTravelStart)}.`);

  // Arm the transform observer before the input. Screenshot capture can take
  // longer than this short animation, so starting the observer afterward can
  // miss the authored tray's entire 25%-75% travel window.
  const drawerMidpointPromise = page.waitForFunction((baseline) => {
    const tray = window.__registerQaCashDrawerTray;
    if (!tray || tray.uuid !== baseline.uuid) return false;
    const localDelta = tray.position.z - baseline.closedLocalZ;
    const worldTravel = localDelta * baseline.worldScaleZ;
    const progress = worldTravel / baseline.travel;
    if (progress < 0.25 || progress > 0.75) return false;
    window.__registerQaCashDrawerMidpoint = {
      uuid: tray.uuid,
      localZ: tray.position.z,
      localDelta,
      worldTravel,
      progress,
    };
    return true;
  }, drawerTravelStart, { timeout: 2500, polling: 'raf' })
    .then((handle) => ({ handle, error: null }))
    .catch((error) => ({ handle: null, error }));

  // Screenshot encoding can outlast a camera tween on smaller viewports. Resolve
  // the projected handful again at the normal-input boundary so the click cannot
  // use a stale screen-space position.
  handful = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint());
  assert(handful && handful.inView, 'The presented cash left the working frame before input.');
  // one click on the handful accepts ALL of it; the drawer slides open itself
  await page.mouse.click(handful.x, handful.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.checkoutFlow?.state === 'DrawerOpening';
  }, null, { timeout: 2000 }).catch(async (error) => {
    throw new Error(`${error.message} â€” ${await clickDiagnostic(page, handful.x, handful.y)}`);
  });
  // Capture #19 at the normal-input boundary, independently of drawer travel.
  await shot('08a-cash-clicked.png');
  // Capture #20 only after the pre-armed observer proves the authored tray was
  // genuinely in flight. This remains impossible to pass on a static till.
  const drawerMidpointObservation = await drawerMidpointPromise;
  if (drawerMidpointObservation.error) throw drawerMidpointObservation.error;
  await drawerMidpointObservation.handle.dispose();
  const drawerTravelMidpoint = await page.evaluate(() => window.__registerQaCashDrawerMidpoint);
  assert(drawerTravelMidpoint && drawerTravelMidpoint.progress >= 0.25
      && drawerTravelMidpoint.progress <= 0.75,
  `CashDrawer_Tray was not captured between 25% and 75% travel: ${JSON.stringify(drawerTravelMidpoint)}.`);
  await shot('08b-cash-clicked-drawer-opening.png');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.drawerOpen;
  }, null, { timeout: 5000 }).catch(async (error) => {
    throw new Error(`${error.message} — ${await clickDiagnostic(page, handful.x, handful.y)}`);
  });
  await waitCamera(page, 'cash');
  await shot('09-cash-workspace.png');
  // the change-counting pose frames the ENTIRE till: both rows and every label
  for (const denom of [50, 20, 10, 5, 1, 0.5, 0.2, 0.1, 0.05, 0.01]) {
    const slot = await projectObject(page, { kind: 'drawer-slot', denom });
    assert(slot && slot.inView, `Drawer slot ${denom} is outside the cash camera.`);
  }
  await shot('09b-cash-drawer-open.png');
  const moneyRowClip = async (denoms) => {
    const points = [];
    for (const denom of denoms) points.push(await projectObject(page, { kind: 'drawer-slot', denom }));
    const visible = points.filter((point) => point && point.inView);
    assert(visible.length === denoms.length, `Could not frame denomination row ${denoms.join(', ')}.`);
    const minX = Math.max(0, Math.min(...visible.map((point) => point.x)) - 75);
    const maxX = Math.min(VIEWPORT.width, Math.max(...visible.map((point) => point.x)) + 75);
    const minY = Math.max(0, Math.min(...visible.map((point) => point.y)) - 65);
    const maxY = Math.min(VIEWPORT.height, Math.max(...visible.map((point) => point.y)) + 65);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };
  await shot('09c-bill-close-up.png', { clip: await moneyRowClip([1, 5, 10, 20, 50]) });
  await shot('09d-coin-close-up.png', { clip: await moneyRowClip([0.01, 0.05, 0.1, 0.2, 0.5]) });
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.deposited;
  }, null, { timeout: 8000 });
  await shot('10-received-cash-sorted.png');

  const plan = await page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return register.makeChangeFrom(register.drawerContents(tx, window.__fw.state.shop.drawer), register.changeDue(tx));
  });
  assert(plan, 'The drawer cannot make the required change.');
  assert(JSON.stringify(plan) === JSON.stringify({ 1: 4, 0.2: 1, 0.05: 1, 0.01: 3 }),
    `Expected the exact $4.28 plan, got ${JSON.stringify(plan)}.`);

  const givingFacts = () => page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const giving = register.changeGivingState(tx);
    return {
      stage: tx?.stage,
      drawerOpen: !!tx?.drawerOpen,
      deposited: !!tx?.deposited,
      giving: register.handTotal(tx),
      requiredCents: giving.requiredCents,
      givingCents: giving.givingCents,
      deltaCents: giving.deltaCents,
      givingState: giving.state,
      changeGiven: tx?.changeGiven,
      lost: tx?.lost,
    };
  });
  const selectFromSlot = async (denom, count = 1) => {
    for (let index = 0; index < count; index += 1) {
      const slot = await projectObject(page, { kind: 'drawer-slot', denom });
      assert(slot && slot.inView, `Change slot ${denom} is not visible.`);
      await page.mouse.click(slot.x, slot.y);
      await page.waitForTimeout(130);
    }
  };
  const cashMonitorClick = async (action) => {
    await page.waitForFunction((id) => {
      const register = window.__fw.scene3d.clubhouse().register;
      const point = register.monitorScreenPoint(id);
      return register.workspace() === 'cash' && point && point.inView;
    }, action, { timeout: 10000 });
    const point = await page.evaluate((id) => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
    ), action);
    assert(point && point.inView, `Cash monitor action ${action} is not visible.`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(180);
  };

  // Count $4.27 first: one cent under must remain a hard rejection even when
  // the player explicitly presses the normal cash-confirm key.
  await selectFromSlot(1, 4);
  await selectFromSlot(0.2);
  await selectFromSlot(0.05);
  await selectFromSlot(0.01, 2);
  const under = await givingFacts();
  assert(under.stage === 'cash-drawer' && under.drawerOpen && under.deposited,
    `Under-change setup left the active drawer: ${JSON.stringify(under)}.`);
  assert(under.givingState === 'short' && under.requiredCents === 428
      && under.givingCents === 427 && under.deltaCents === -1,
  `Expected $4.27 to be one cent short: ${JSON.stringify(under)}.`);
  await shot('10b-change-under-by-one-cent.png');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(180);
  const underRejected = await givingFacts();
  assert(underRejected.stage === 'cash-drawer' && underRejected.drawerOpen
      && underRejected.givingState === 'short' && underRejected.givingCents === 427,
  `Under-change confirmation did not reject in the open drawer: ${JSON.stringify(underRejected)}.`);
  await shot('10c-under-change-confirm-rejected.png');
  // Let the short-change toast finish before photographing the allowed and
  // excessive over-change states; otherwise a stale warning contradicts the
  // live POS status even though the transaction logic is correct.
  await page.waitForTimeout(2400);

  // Add exactly $5.01: the first $5.00 reaches the permitted courtesy ceiling,
  // while one more cent crosses into the forbidden excess state.
  await selectFromSlot(5);
  await selectFromSlot(0.01);
  const allowedOver = await givingFacts();
  assert(allowedOver.stage === 'cash-drawer' && allowedOver.drawerOpen
      && allowedOver.givingState === 'over' && allowedOver.givingCents === 928
      && allowedOver.deltaCents === 500,
  `The exact $5.00 over-change boundary was not allowed: ${JSON.stringify(allowedOver)}.`);
  await shot('10d-over-change-at-five-dollar-limit.png');

  await selectFromSlot(0.01);
  const excess = await givingFacts();
  assert(excess.stage === 'cash-drawer' && excess.drawerOpen
      && excess.givingState === 'excess' && excess.givingCents === 929
      && excess.deltaCents === 501,
  `The $5.01 over-change boundary was not excessive: ${JSON.stringify(excess)}.`);
  await shot('10e-excess-change-over-five-dollar-limit.png');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(180);
  const excessRejected = await givingFacts();
  assert(excessRejected.stage === 'cash-drawer' && excessRejected.drawerOpen
      && excessRejected.givingState === 'excess' && excessRejected.givingCents === 929,
  `Excess-change confirmation did not reject in the open drawer: ${JSON.stringify(excessRejected)}.`);
  await shot('10f-excess-change-confirm-rejected.png');

  // Exercise the visible monitor Undo button, not the keyboard shortcut. It
  // must remove the last penny and return to the allowed $5.00 ceiling.
  await cashMonitorClick('undo-change');
  const undone = await givingFacts();
  assert(undone.stage === 'cash-drawer' && undone.drawerOpen
      && undone.givingState === 'over' && undone.givingCents === 928
      && undone.deltaCents === 500,
  `Undo did not restore the allowed over-change boundary: ${JSON.stringify(undone)}.`);
  await shot('10g-undo-restored-allowed-change.png');

  // Clear through the monitor, then count the actual $4.28 owed from the
  // physical labeled slots and finish with the visible Done action.
  await cashMonitorClick('clear-change');
  const cleared = await givingFacts();
  assert(cleared.stage === 'cash-drawer' && cleared.drawerOpen
      && cleared.givingState === 'short' && cleared.givingCents === 0,
  `Clear did not return every selected piece to the drawer: ${JSON.stringify(cleared)}.`);
  await shot('10h-change-cleared-for-exact-count.png');

  for (const [rawDenom, count] of Object.entries(plan)) {
    const denom = Number(rawDenom);
    await selectFromSlot(denom, count);
  }
  const exact = await givingFacts();
  assert(exact.stage === 'cash-drawer' && exact.drawerOpen
      && exact.givingState === 'exact' && exact.givingCents === 428
      && exact.deltaCents === 0,
  `The final $4.28 count is not exact: ${JSON.stringify(exact)}.`);
  await shot('11-exact-four-twenty-eight-selected.png');
  await cashMonitorClick('confirm-change');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && ['receipt', 'bagging', 'done'].includes(tx.stage);
  }, null, { timeout: 6000 });
  const confirmed = await givingFacts();
  assert(['receipt', 'bagging', 'done'].includes(confirmed.stage)
      && !confirmed.drawerOpen && confirmed.changeGiven === 4.28 && confirmed.lost === 0,
  `Exact change did not complete cleanly: ${JSON.stringify(confirmed)}.`);
  await shot('12-exact-change-confirmed.png');
  return { start: drawerTravelStart, midpoint: drawerTravelMidpoint };
}

async function finalSnapshot(page, customerName) {
  return page.evaluate((name) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const shop = app.state.shop;
    const customerList = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
    const customer = customerList.find((entry) => entry.name === name);
    return {
      active: clubhouse.register.isActive(),
      tx: clubhouse.register.getTx(),
      workspace: clubhouse.register.workspace(),
      queue: clubhouse.checkoutQueue(),
      customer: customer ? {
        name: customer.name,
        bought: !!customer.bought,
        phase: customer.checkoutPhase,
        cart: customer.cart.length,
      } : null,
      units: (shop.salesLive || {}).units || 0,
      revenue: (shop.salesLive || {}).revenue || 0,
      held: (shop.held || []).length,
      history: (shop.transactionHistory || []).length,
      ticket: shop.transactionHistory && shop.transactionHistory[0],
      shelf: Object.fromEntries(['tees1', 'marker1', 'glove1'].map((id) => [id, shop.inventory[id].shelf])),
    };
  }, customerName);
}

export async function runSimplifiedRegisterAcceptance(page, mode, options = {}) {
  const viewportRun = configureViewport(options.viewport
    || process.env.REGISTER_QA_VIEWPORT
    || process.env.QA_VIEWPORT);
  const rootBase = path.resolve(options.root || process.env.REGISTER_QA_ROOT
    || 'qa/cash-register-production/simplified-rebuild/acceptance');
  const root = viewportRun.explicit
    ? path.join(rootBase, viewportRun.tag, mode)
    : path.join(rootBase, mode);
  fs.mkdirSync(root, { recursive: true });
  const productionBuildBefore = captureCashierBuildSnapshot();
  const captureOutput = process.env.REGISTER_AUDIO_CAPTURE === '0'
    ? null
    : path.resolve(process.env.REGISTER_CAPTURE_PATH
      || path.join(root, 'video', `${mode}-with-audio.webm`));
  let captureActive = false;
  let audioVideoCapture = null;
  const errors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error && error.stack ? error.stack : error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));
  const evidence = [];
  const shot = async (name, options = {}) => {
    const output = path.join(root, name);
    await page.screenshot({ path: output, ...options });
    evidence.push(output);
  };

  const startMediaCapture = async () => {
    if (!captureOutput) return;
    fs.mkdirSync(path.dirname(captureOutput), { recursive: true });
    const started = await page.evaluate(async () => {
      const audio = window.__fw && window.__fw.audio;
      if (!audio || typeof audio.startCapture !== 'function') {
        throw new Error('The game audio capture API is not available.');
      }
      audio.setMuted(false);
      audio.setVolume(0.8);
      return audio.startCapture(document.getElementById('game'), { fps: 30 });
    });
    assert(started.audioTracks > 0, 'Capture did not expose a WebAudio track.');
    assert(started.videoTracks > 0, 'Capture did not expose a canvas video track.');
    assert(started.audioContextState === 'running', `Audio context remained ${started.audioContextState}.`);
    captureActive = true;
    audioVideoCapture = { output: captureOutput, ...started };
  };

  const stopMediaCapture = async () => {
    if (!captureOutput || !captureActive) return;
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    const stopPromise = page.evaluate((downloadName) => (
      window.__fw.audio.stopCapture({ downloadName })
    ), path.basename(captureOutput));
    const [download, stopped] = await Promise.all([downloadPromise, stopPromise]);
    const failure = await download.failure();
    if (failure) throw new Error(`Browser capture download failed: ${failure}`);
    await download.saveAs(captureOutput);
    const bytesOnDisk = fs.statSync(captureOutput).size;
    assert(bytesOnDisk > 0, 'The saved audio/video capture is empty.');
    assert(stopped.nonSilentAudioWindows > 0 && stopped.audioPeak > 0.0001,
      'The capture has an audio track but the live game bus remained silent.');
    audioVideoCapture = { ...audioVideoCapture, ...stopped, bytesOnDisk, output: captureOutput };
    captureActive = false;
  };

  await boot(page);
  await startMediaCapture();
  const fixture = await setupFixture(page, mode);
  assert(fixture.customer, 'Could not create the deterministic checkout customer.');
  await shot('01-customer-arrival.png');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 15000 });
  if (mode === 'cash') {
    await page.evaluate(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      // $35.72 tendered with $40.00 proves exact $4.28 penny change through
      // the same normal physical drawer route used by production gameplay.
      const prices = [6.90, 9.20, 19.62];
      tx.items.forEach((item, index) => {
        item.price = prices[index];
        item.priceCents = Math.round(prices[index] * 100);
      });
      tx.rng = () => 0.9;
    });
  }
  await shot('02-products-ready-at-counter.png');
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 5000 });
  // A retail arrival with unscanned goods opens ON the goods (the one mixed
  // working frame) — entry stopped defaulting to the monitor workspace.
  await waitCamera(page, 'scan');
  await shot('03-front-desk-entry.png');

  // Exit/re-entry is part of the acceptance route: the customer and exact tx must
  // survive a normal Escape and E without losing held inventory or resetting scans.
  const txNumber = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().number);
  await escapeFrontDesk(page);
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive());
  await page.waitForTimeout(650);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive());
  await waitCamera(page, 'scan');
  const reenteredNumber = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().number);
  assert(reenteredNumber === txNumber, 'Exit/re-entry replaced the active transaction.');
  await shot('04-safe-reentry.png');

  await scanAll(page, shot, mode);
  let cashDrawerTravelEvidence = null;
  let receiptVisibilityEvidence = null;
  if (mode === 'card') await cardRoute(page, shot);
  else cashDrawerTravelEvidence = await cashRoute(page, shot);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'receipt-print'
  ), null, { timeout: 10000 });
  await waitCamera(page, 'monitor');
  receiptVisibilityEvidence = await projectObject(page, { kind: 'receipt' });
  assert(receiptVisibilityEvidence?.inView && receiptVisibilityEvidence.fullyInView,
    'The physical receipt did not remain fully visible during printer focus.');
  assert(receiptVisibilityEvidence.screenBounds.width >= 45
      && receiptVisibilityEvidence.screenBounds.height >= 80,
  `The physical receipt printed too small to read (${Math.round(receiptVisibilityEvidence.screenBounds.width)}x${Math.round(receiptVisibilityEvidence.screenBounds.height)} px).`);
  await shot('12b-receipt-printing.png');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'done';
  }, null, { timeout: 8000 });
  await page.waitForFunction(() => {
    const phase = window.__fw.scene3d.clubhouse().register.deliveryPhase();
    return phase === 'receipt-deliver' || phase === 'bag-deliver';
  }, null, { timeout: 5000 });
  if (mode === 'card' || mode === 'cash') {
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'bag-deliver'
    ), null, { timeout: 5000 });
    // The bag phase begins only after Receipt_Strip is parented to the authored
    // palm grip, giving deterministic contact evidence without freezing a
    // context-free frame midway through the preceding arc.
    await shot('13-receipt-handover.png');
    await page.waitForTimeout(340);
    await shot('13b-bag-handover.png');
  } else {
    await page.waitForTimeout(320);
    await shot('13-receipt-handover.png');
  }
  // The sale banks ITSELF once the receipt and bag reach the customer — there is
  // no finalize click in the automatic flow. Wait for the transaction to clear.
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 14000 });
  await shot('14-transaction-complete.png');

  const final = await finalSnapshot(page, fixture.customer);
  assert(final.units === fixture.before.units + 3, `Expected exactly three units, got ${final.units - fixture.before.units}.`);
  assert(final.history === fixture.before.history + 1, 'Transaction history did not advance exactly once.');
  assert(final.held === fixture.before.held, 'Held inventory did not return to its opening count.');
  assert(final.ticket && final.ticket.method === mode, `Expected ${mode} ticket.`);
  assert(final.customer && final.customer.bought && final.customer.cart === 0, 'Customer did not receive the finalized products.');
  const departureStart = await page.evaluate((name) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
    const customer = customers.find((entry) => entry.name === name);
    return customer ? { x: customer.mesh.position.x, z: customer.mesh.position.z } : null;
  }, fixture.customer);
  if (departureStart) {
    await page.waitForFunction(({ name, start }) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers()
        : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
      const customer = customers.find((entry) => entry.name === name);
      if (!customer) return true;
      return Math.hypot(customer.mesh.position.x - start.x, customer.mesh.position.z - start.z) > 0.20;
    }, { name: fixture.customer, start: departureStart }, { timeout: 12000 });
    // Follow the departing customer with the register mode's normal bounded
    // mouse-look so the paid bag remains in frame instead of being cropped by
    // a camera that keeps staring at the now-empty POS.
    await page.mouse.move(VIEWPORT.width * 0.12, VIEWPORT.height * 0.50);
    await page.waitForTimeout(220);
    await shot('15-customer-leaving.png');
  } else {
    // Some production wrappers intentionally omit raw customer mesh access.
    // The accepted bag hold is fixed-duration; this still captures the normal
    // departure frame without mutating navigation or transaction state.
    await page.waitForTimeout(2200);
    await shot('15-customer-leaving.png');
  }
  assert(errors.length === 0, `Console errors: ${errors.join(' | ')}`);
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
  const nonAborted = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
  assert(nonAborted.length === 0, `Non-aborted request failures: ${JSON.stringify(nonAborted)}`);
  await stopMediaCapture();

  let result = {
    ok: true,
    mode,
    viewport: { ...VIEWPORT },
    requiredViewports: REQUIRED_VIEWPORTS,
    customer: fixture.customer,
    before: fixture.before,
    final,
    evidence,
    cashDrawerTravelEvidence,
    receiptVisibilityEvidence,
    audioVideoCapture,
    console: { errors, pageErrors, failedRequests, nonAbortedFailedRequests: nonAborted },
  };
  result = finalizeCashierQaResult({
    result,
    beforeSnapshot: productionBuildBefore,
    evidencePngs: evidence,
    evidenceRoot: root,
  });
  fs.writeFileSync(path.join(root, 'latest-result.json'), JSON.stringify(result, null, 2));
  return result;
}

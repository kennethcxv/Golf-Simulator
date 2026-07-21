import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
const VIEWPORT = { width: 1600, height: 900 };
const COUNTER_TOP = 1.055;
const CARRY_Y = COUNTER_TOP + 0.115;
const SCANNER = { x: 2.70, y: CARRY_Y, z: 4.22 };
const CARD_TERMINAL = { x: 2.05, y: COUNTER_TOP + 0.06, z: 3.88 };
const BAG = { x: 3.50, y: CARRY_Y, z: 4.44 };
const STAGING = [
  { x: 3.32, y: CARRY_Y, z: 4.31 },
  { x: 3.34, y: CARRY_Y, z: 4.44 },
  { x: 3.32, y: CARRY_Y, z: 4.57 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function roundedPoint(point) {
  if (!point) return null;
  return { x: Math.round(point.x), y: Math.round(point.y), inView: !!point.inView };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function same(valueA, valueB) {
  return JSON.stringify(valueA) === JSON.stringify(valueB);
}

async function boot(page) {
  await page.goto(BASE_URL);
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(900);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null,
  { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none'
      || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1200);
}

async function installReadOnlyProbe(page) {
  await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = () => app.scene3d.clubhouse();
    const pointerLockEvents = { changes: 0, acquired: 0, released: 0 };
    const wheelEvents = [];
    document.addEventListener('wheel', (event) => {
      wheelEvents.push({
        tag: event.target && event.target.tagName,
        className: event.target && typeof event.target.className === 'string'
          ? event.target.className : '',
        deltaY: event.deltaY,
        shiftKey: event.shiftKey,
      });
      if (wheelEvents.length > 40) wheelEvents.shift();
    }, { capture: true, passive: true });
    document.addEventListener('pointerlockchange', () => {
      pointerLockEvents.changes++;
      if (document.pointerLockElement) pointerLockEvents.acquired++;
      else pointerLockEvents.released++;
    });
    const rendered = (object) => {
      for (let entry = object; entry; entry = entry.parent) {
        if (!entry.visible) return false;
      }
      return true;
    };
    const ancestry = (object) => {
      const kinds = [];
      for (let entry = object; entry; entry = entry.parent) {
        if (entry.userData && entry.userData.kind) kinds.push(entry.userData.kind);
      }
      return kinds;
    };
    const localCentre = (object) => {
      const ch = clubhouse();
      const bounds = new THREE.Box3().setFromObject(object);
      const centre = bounds.isEmpty()
        ? object.getWorldPosition(new THREE.Vector3())
        : bounds.getCenter(new THREE.Vector3());
      const offset = ch.interior.position;
      return { x: centre.x - offset.x, y: centre.y - offset.y, z: centre.z - offset.z };
    };
    const describe = (object) => {
      if (!object) return null;
      return {
        ...localCentre(object),
        name: object.name || '',
        kind: object.userData.kind || null,
        uid: object.userData.uid || null,
        skuId: object.userData.skuId || null,
        denom: object.userData.denom == null ? null : Number(object.userData.denom),
        from: object.userData.from || null,
        pick: !!object.userData.pick,
        visible: !!object.visible,
        rendered: rendered(object),
        ancestry: ancestry(object),
      };
    };
    const objects = (predicate, renderedOnly = true) => {
      const found = [];
      clubhouse().interior.traverse((object) => {
        if ((!renderedOnly || rendered(object)) && predicate(object)) found.push(object);
      });
      return found;
    };
    const project = (local) => {
      const ch = clubhouse();
      const vector = new THREE.Vector3(
        local.x + ch.interior.position.x,
        local.y + ch.interior.position.y,
        local.z + ch.interior.position.z,
      );
      vector.project(app.scene3d.camera);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      return {
        x: rect.left + ((vector.x + 1) / 2) * rect.width,
        y: rect.top + ((-vector.y + 1) / 2) * rect.height,
        inView: vector.z >= -1 && vector.z <= 1
          && Math.abs(vector.x) <= 1 && Math.abs(vector.y) <= 1,
      };
    };
    const item = (uid) => {
      const object = objects((entry) => entry.userData
        && entry.userData.kind === 'item' && entry.userData.uid === uid)[0];
      if (!object) return null;
      const out = describe(object);
      const root = object.getWorldPosition(new THREE.Vector3())
        .sub(clubhouse().interior.position);
      out.root = { x: root.x, y: root.y, z: root.z };
      out.rotateX = Number(object.rotation.x || 0);
      out.rotateY = Number(object.rotation.y || 0);
      out.rotateZ = Number(object.rotation.z || 0);
      if (object.userData.bc) {
        const quaternion = object.userData.bc.getWorldQuaternion(new THREE.Quaternion());
        out.barcodeFacing = new THREE.Vector3(0, 0, 1)
          .applyQuaternion(quaternion).normalize().y;
      }
      return out;
    };
    const money = (from, denom = null, renderedOnly = true) => {
      const found = objects((entry) => entry.userData
        && entry.userData.kind === 'money'
        && entry.userData.from === from
        && (denom == null || Number(entry.userData.denom) === Number(denom)), renderedOnly);
      return found.length ? describe(found[found.length - 1]) : null;
    };
    const countMoney = (from, renderedOnly = true) => objects((entry) => entry.userData
      && entry.userData.kind === 'money' && entry.userData.from === from, renderedOnly).length;
    const kind = (value, renderedOnly = true) => {
      const object = objects((entry) => entry.userData
        && entry.userData.kind === value, renderedOnly)[0];
      return describe(object);
    };
    const named = (value, renderedOnly = false) => {
      const object = objects((entry) => entry.name === value, renderedOnly)[0];
      return describe(object);
    };
    const customerList = () => {
      const ch = clubhouse();
      if (typeof ch.customers === 'function') return ch.customers();
      if (typeof ch.getCustomers === 'function') return ch.getCustomers();
      return Array.isArray(ch.customers) ? ch.customers : [];
    };
    const customer = (name) => {
      const entry = customerList().find((candidate) => candidate.name === name);
      if (!entry) return null;
      return {
        name: entry.name,
        phase: entry.checkoutPhase,
        placed: entry.checkoutPlacedCount,
        patience: entry.patience,
        bought: !!entry.bought,
        paid: !!entry.paid,
        cart: (entry.cart || []).map((line) => ({
          uid: line.uid, skuId: line.skuId, placed: !!line.placed,
        })),
      };
    };
    const sortedObject = (value) => Object.fromEntries(Object.entries(value || {})
      .sort(([a], [b]) => Number(b) - Number(a)));
    const snapshot = (skuIds = [], customerName = null) => {
      const ch = clubhouse();
      const register = ch.register;
      const tx = register.getTx();
      const shop = app.state.shop;
      const camera = app.scene3d.camera;
      const hands = named('CashierHandsRig', false);
      const swipe = register.swipeAt ? register.swipeAt() : null;
      return {
        active: register.isActive(),
        hasTx: register.hasTx(),
        flow: register.getFlow ? register.getFlow() : null,
        tx: tx ? {
          number: tx.number,
          stage: tx.stage,
          method: tx.method,
          drawerOpen: !!tx.drawerOpen,
          deposited: !!tx.deposited,
          banked: !!tx.banked,
          receiptPrinted: !!tx.receiptPrinted,
          receiptPacked: !!tx.receiptPacked,
          cardAttempts: Number(tx.cardAttempts || 0),
          cardsTried: Number(tx.cardsTried || 0),
          tenderedTotal: Number(tx.tenderedTotal || 0),
          tendered: sortedObject(tx.tendered),
          hand: sortedObject(tx.hand),
          drawerPending: sortedObject(tx.drawerPending),
          items: tx.items.map((line) => ({
            uid: line.uid,
            skuId: line.skuId,
            scanned: !!line.scanned,
            staged: !!line.staged,
            bagged: !!line.bagged,
          })),
        } : null,
        customer: customerName ? customer(customerName) : null,
        books: {
          cash: Number(app.state.cash || 0),
          units: Number((shop.salesLive || {}).units || 0),
          revenue: Number((shop.salesLive || {}).revenue || 0),
          history: (shop.transactionHistory || []).length,
          nextTransactionNo: Number(shop.nextTransactionNo || 1),
          held: (shop.held || []).map((line) => ({ uid: line.uid, skuId: line.skuId }))
            .sort((a, b) => a.uid.localeCompare(b.uid)),
          shelf: Object.fromEntries(skuIds.map((id) => [id, {
            shelf: shop.inventory[id] ? shop.inventory[id].shelf : null,
            back: shop.inventory[id] ? shop.inventory[id].back : null,
          }])),
          drawer: sortedObject(shop.drawer),
        },
        visual: {
          registerClass: document.body.classList.contains('register-mode'),
          pointerLock: document.pointerLockElement === document.querySelector('canvas')
            ? 'canvas' : document.pointerLockElement ? 'other' : null,
          pointerLockEvents: { ...pointerLockEvents },
          pointerLockProbe: window.__qaPointerLockProbe
            ? { ...window.__qaPointerLockProbe } : null,
          activeElement: document.activeElement ? document.activeElement.tagName : null,
          cashierHandsRendered: !!(hands && hands.rendered),
          drawerMoneyRendered: countMoney('drawer', true),
          tenderRendered: countMoney('tender', true),
          handMoneyRendered: countMoney('hand', true),
          receiptsRendered: objects((entry) => entry.userData
            && entry.userData.kind === 'receipt', true).length,
          bag: kind('bag', true),
          swipeU: swipe ? Number(swipe.u || 0) : null,
        },
        camera: {
          x: camera.position.x, y: camera.position.y, z: camera.position.z,
          qx: camera.quaternion.x, qy: camera.quaternion.y,
          qz: camera.quaternion.z, qw: camera.quaternion.w,
          fov: camera.fov,
        },
      };
    };
    window.__qaRecovery = {
      project, item, money, countMoney, kind, named, customer, snapshot,
      wheelEvents: () => wheelEvents.slice(),
    };
  });
}

async function waitForCameraStable(page, timeout = 12000) {
  await page.evaluate(() => { window.__qaRecoveryCamera = null; });
  await page.waitForFunction(() => {
    const camera = window.__fw.scene3d.camera;
    const now = {
      x: camera.position.x, y: camera.position.y, z: camera.position.z,
      qx: camera.quaternion.x, qy: camera.quaternion.y,
      qz: camera.quaternion.z, qw: camera.quaternion.w,
    };
    const prior = window.__qaRecoveryCamera;
    if (!prior) {
      window.__qaRecoveryCamera = { ...now, stable: 0 };
      return false;
    }
    const delta = Math.hypot(
      now.x - prior.x, now.y - prior.y, now.z - prior.z,
      now.qx - prior.qx, now.qy - prior.qy,
      now.qz - prior.qz, now.qw - prior.qw,
    );
    const stable = delta < 0.00035 ? prior.stable + 1 : 0;
    window.__qaRecoveryCamera = { ...now, stable };
    return stable >= 7;
  }, null, { timeout, polling: 'raf' });
}

async function interpolateMouse(page, from, to, steps = 14, delay = 13) {
  for (let index = 1; index <= steps; index++) {
    const t = index / steps;
    await page.mouse.move(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
    );
    if (delay) await page.waitForTimeout(delay);
  }
  return to;
}

async function exercisePointerLockLoss(page, skuIds, name) {
  const before = await snapshot(page, skuIds, name);
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    window.__qaPointerLockProbe = { fired: false, resolved: false, error: null };
    const requestDuringRealPress = () => {
      window.__qaPointerLockProbe.fired = true;
      try {
        const pending = canvas.requestPointerLock();
        if (pending && pending.then) pending.then(() => {
          window.__qaPointerLockProbe.resolved = true;
        }).catch((error) => {
          window.__qaPointerLockProbe.error = error.message;
        });
      } catch (error) {
        window.__qaPointerLockProbe.error = error.message;
      }
    };
    document.addEventListener('pointerdown', requestDuringRealPress,
      { capture: true, once: true });
  });
  // The capture listener requests lock from an actual Playwright mouse gesture.
  // main.js's production pointerlockchange handler immediately releases it while
  // cashier mode is active, exercising the browser lifecycle path rather than a
  // direct register recovery hook.
  await page.bringToFront();
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height - 20);
  await page.waitForFunction(([changes]) => {
    const state = window.__qaRecovery.snapshot([], null);
    const events = state.visual.pointerLockEvents;
    const probe = state.visual.pointerLockProbe;
    return probe && probe.resolved && events.changes >= changes + 2
      && document.pointerLockElement === null;
  }, [before.visual.pointerLockEvents.changes],
  { timeout: 5000 }).catch(() => {});
  const after = await snapshot(page, skuIds, name);
  // main.js registered its listener before this probe and synchronously calls
  // exitPointerLock(). A later observer may therefore see `null` for both change
  // events even though the request promise proves the lock was granted.
  assert(after.visual.pointerLockProbe && after.visual.pointerLockProbe.resolved
    && !after.visual.pointerLockProbe.error
    && after.visual.pointerLockEvents.changes >= before.visual.pointerLockEvents.changes + 2,
  `Direct pointer-lock lifecycle did not fire: ${JSON.stringify(after.visual.pointerLockProbe)}.`);
  assert(after.active && after.visual.registerClass,
    'Direct pointer-lock loss unexpectedly exited cashier mode.');
  assert(after.visual.pointerLock === null,
    `Direct pointer-lock loss left ${after.visual.pointerLock || 'no'} lock owner.`);
  return { before, after };
}

async function activateCardReader(page) {
  const terminal = await project(page, CARD_TERMINAL);
  assert(terminal.inView, 'Card reader activation target left the cashier camera.');
  await page.mouse.click(terminal.x, terminal.y);
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    const flow = register.getFlow();
    return !!tx && tx.stage === 'card-ready' && flow && flow.state === 'CardSwipeReady';
  }, null, { timeout: 6000 });
  await waitForCameraStable(page);
  return terminal;
}

async function swipeCardDown(page) {
  const channel = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.swipeAt()
  ));
  const top = await project(page, channel.top);
  const bottom = await project(page, channel.bot);
  assert(top.inView && bottom.inView,
    'Card swipe endpoints left the focused cashier camera.');
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await page.waitForFunction(() => {
    const flow = window.__fw.scene3d.clubhouse().register.getFlow();
    return !!flow && flow.state === 'CardSwiping';
  }, null, { timeout: 2000 });
  await interpolateMouse(page, top, bottom, 16, 13);
  await page.mouse.up();
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    const flow = register.getFlow();
    return !!tx && tx.stage === 'card-busy' && flow && flow.state === 'CardProcessing';
  }, null, { timeout: 2500 });
  return { top: roundedPoint(top), bottom: roundedPoint(bottom) };
}

async function selectExactChange(page) {
  const change = await page.evaluate(async () => {
    const R = await import('/src/sim/register.js');
    const app = window.__fw;
    const tx = app.scene3d.clubhouse().register.getTx();
    const due = R.changeDue(tx);
    return {
      due,
      plan: R.makeChangeFrom(R.drawerContents(tx, app.state.shop.drawer), due),
    };
  });
  assert(change.plan, `Drawer could not make the required $${change.due.toFixed(2)} change.`);
  for (const [denom, count] of Object.entries(change.plan)) {
    for (let index = 0; index < count; index++) {
      const piece = await page.evaluate((value) => (
        window.__qaRecovery.money('drawer', Number(value))
      ), denom);
      assert(piece, `Visible ${denom} change piece disappeared before exact selection.`);
      const point = await project(page, piece);
      assert(point.inView, `Visible ${denom} change piece left the drawer camera.`);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(90);
    }
  }
  return change;
}

async function prepareFixture(page, skuIds, payment, patience = null) {
  await page.evaluate(async (ids) => {
    const app = window.__fw;
    const shop = app.state.shop;
    const { capacityOf } = await import('/src/data/fixtureSlots.js');
    for (const id of ids) {
      const inventory = shop.inventory[id];
      const capacity = Math.max(1, capacityOf(id));
      // Some long-lived saves predate fixture-aware shelf caps. Normalize the
      // deterministic QA stock to a valid display count before taking the
      // baseline, so an interrupted return does not legitimately migrate an
      // over-cap unit to back stock and masquerade as a recovery mismatch.
      inventory.shelf = Math.min(capacity, Math.max(inventory.shelf, Math.min(12, capacity)));
      inventory.back = Math.max(0, inventory.back || 0);
    }
    shop.markup.accessories = 1.15;
    shop.markup.apparel = 1.15;
    // Deterministic recovery: silence ambient walk-ins and clear the floor so a stray
    // shopper's held item cannot masquerade as a duplicated/lost unit in the exactly-once
    // recovery assertions. The interruption under test is unaffected.
    const chSetup = app.scene3d.clubhouse();
    if (typeof chSetup.setOrganicWalkins === 'function') chSetup.setOrganicWalkins(false);
    if (typeof chSetup.clearWalkins === 'function') chSetup.clearWalkins();
    app.speedIdx = 0;
    const clock = app.state.clock;
    clock.minutes = Math.floor(clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
    };
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    app.scene3d.clubhouse().rebuildStock();
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 - 8;
    walk.z = 5.10 + 228;
    walk.yaw = 0;
    walk.pitch = -0.18;
  }, skuIds);
  await waitForCameraStable(page);
  const before = await page.evaluate((ids) => window.__qaRecovery.snapshot(ids), skuIds);
  const name = await page.evaluate(([ids, method, patienceSeconds]) => {
    const ch = window.__fw.scene3d.clubhouse();
    const customerName = ch.sendToCounter(ids, method);
    if (customerName && patienceSeconds != null) {
      const entry = (Array.isArray(ch.customers) ? ch.customers : ch.customers()).find((candidate) => candidate.name === customerName);
      if (entry) entry.patience = patienceSeconds;
    }
    return customerName;
  }, [skuIds, payment, patience]);
  assert(name, `Could not create deterministic ${payment || 'timeout'} customer.`);
  return { name, before, walkCamera: before.camera };
}

async function waitForTransactionReady(page, skuIds, name, timeout = 16000) {
  await page.waitForFunction(([count, customerName]) => {
    const ch = window.__fw.scene3d.clubhouse();
    const tx = ch.register.getTx();
    const customer = (Array.isArray(ch.customers) ? ch.customers : ch.customers()).find((entry) => entry.name === customerName);
    return !!tx && tx.items.length === count && customer
      && customer.checkoutPhase === 'waiting';
  }, [skuIds.length, name], { timeout });
  return page.evaluate(([ids, customerName]) => (
    window.__qaRecovery.snapshot(ids, customerName)
  ), [skuIds, name]);
}

async function snapshot(page, skuIds, name = null) {
  return page.evaluate(([ids, customerName]) => (
    window.__qaRecovery.snapshot(ids, customerName)
  ), [skuIds, name]);
}

async function project(page, point) {
  return page.evaluate((value) => window.__qaRecovery.project(value), point);
}

function assertBooksUnchanged(expected, actual, label) {
  assert(same(expected.books, actual.books),
    `${label} changed sale, cash, held-UID, stock, history, or drawer books.\n`
      + `expected ${JSON.stringify(expected.books)}\nactual ${JSON.stringify(actual.books)}`);
  assert(actual.tx && expected.tx && actual.tx.number === expected.tx.number,
    `${label} replaced the in-flight transaction number.`);
  assert(same(expected.tx.items.map((line) => [line.uid, line.skuId]),
    actual.tx.items.map((line) => [line.uid, line.skuId])),
  `${label} duplicated, deleted, or replaced an in-flight product UID.`);
}

function assertNoBanking(beforeCustomer, inFlight, skuIds, label) {
  assert(inFlight.books.units === beforeCustomer.books.units,
    `${label} booked sale units before bag handoff.`);
  assert(inFlight.books.revenue === beforeCustomer.books.revenue,
    `${label} booked revenue before bag handoff.`);
  assert(inFlight.books.history === beforeCustomer.books.history,
    `${label} wrote transaction history before bag handoff.`);
  assert(inFlight.books.nextTransactionNo === beforeCustomer.books.nextTransactionNo,
    `${label} consumed a receipt number before successful banking.`);
  assert(inFlight.books.cash === beforeCustomer.books.cash,
    `${label} changed player cash during an interrupted checkout.`);
  assert(inFlight.books.held.length === beforeCustomer.books.held.length + skuIds.length,
    `${label} did not preserve exactly ${skuIds.length} in-flight held UIDs.`);
}

async function enterRegister(page, expectedFlow = null) {
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
    { timeout: 10000 });
  await waitForCameraStable(page);
  if (expectedFlow) {
    await page.waitForFunction((state) => {
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!flow && flow.state === state;
    }, expectedFlow, { timeout: 5000 });
  }
}

async function waitForWalkReturn(page, walkCamera, timeout = 12000) {
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null,
    { timeout });
  await waitForCameraStable(page, timeout);
  const camera = await page.evaluate(() => {
    const value = window.__fw.scene3d.camera;
    return { x: value.position.x, y: value.position.y, z: value.position.z, fov: value.fov };
  });
  assert(distance(camera, walkCamera) < 0.16,
    `Escape left the camera ${distance(camera, walkCamera).toFixed(3)} world units from the pre-register walking pose.`);
  assert(Math.abs(camera.fov - walkCamera.fov) < 0.01,
    `Escape did not restore walking FOV (${camera.fov} vs ${walkCamera.fov}).`);
}

function assertEscapeCleanup(state, label, { drawerClosed = false } = {}) {
  assert(!state.active, `${label} left register mode active.`);
  assert(!state.visual.registerClass, `${label} left the register-mode body class latched.`);
  assert(!state.visual.cashierHandsRendered, `${label} left first-person cashier hands rendered.`);
  assert(state.visual.pointerLock !== 'other', `${label} left pointer lock on an unexpected element.`);
  if (drawerClosed) {
    assert(state.tx && !state.tx.drawerOpen, `${label} left the authoritative drawer open.`);
    assert(state.visual.drawerMoneyRendered === 0,
      `${label} left ${state.visual.drawerMoneyRendered} drawer money props visibly rendered.`);
  }
}

async function scanAndStageAll(page, skuIds, name, trace) {
  const start = await snapshot(page, skuIds, name);
  for (let index = 0; index < start.tx.items.length; index++) {
    const uid = start.tx.items[index].uid;
    const info = await page.evaluate((id) => window.__qaRecovery.item(id), uid);
    assert(info, `Physical item ${uid} was missing before scan.`);
    const from = await project(page, info);
    assert(from.inView, `Physical item ${uid} was outside the cashier camera.`);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    let cursor = from;
    // An interrupted scan may have left the product beside the glass. Move that
    // still-unread label back to a neutral counter point before orienting it, so the
    // next read visibly crosses the scanner rather than starting inside the zone.
    if (info.root && info.root.z >= 4.58) {
      // The fall-prevention probe intentionally leaves this product at the far
      // counter corner. Carry it to a clear, still-nonscanning work point so the
      // wheel gesture targets canvas rather than overlapping counter hardware.
      const neutral = await project(page, { x: 1.75, y: CARRY_Y, z: 4.20 });
      cursor = await interpolateMouse(page, cursor, neutral, 10, 13);
    } else if (Math.hypot(info.x - SCANNER.x, info.z - SCANNER.z) < 0.30) {
      const neutral = await project(page, { x: 2.30, y: CARRY_Y, z: 4.52 });
      cursor = await interpolateMouse(page, cursor, neutral, 10, 13);
    }
    let rotated = info;
    // Recovery tests deliberately leave products at arbitrary persisted rotations.
    // Cover both production wheel axes (wheel = pitch, Shift+wheel = yaw) instead
    // of assuming the four-notch fresh-fixture starting pose.
    for (let yaw = 0; yaw < 4 && rotated.barcodeFacing > -0.35; yaw++) {
      for (let pitch = 0; pitch < 4 && rotated.barcodeFacing > -0.35; pitch++) {
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(70);
        rotated = await page.evaluate((id) => window.__qaRecovery.item(id), uid);
      }
      if (rotated.barcodeFacing <= -0.35) break;
      await page.keyboard.down('Shift');
      await page.mouse.wheel(0, 120);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(70);
      rotated = await page.evaluate((id) => window.__qaRecovery.item(id), uid);
    }
    const wheelTrace = await page.evaluate(() => window.__qaRecovery.wheelEvents());
    assert(rotated && rotated.barcodeFacing <= -0.35,
      `Wheel input did not turn ${uid}'s barcode toward the scanner: ${JSON.stringify({
        start: { rotateX: info.rotateX, rotateY: info.rotateY, dot: info.barcodeFacing },
        end: rotated,
        wheelEvents: wheelTrace.slice(-24),
      })}.`);
    const scanner = await project(page, SCANNER);
    await interpolateMouse(page, cursor, scanner, 16, 13);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const line = tx && tx.items.find((entry) => entry.uid === id);
      return !!line && line.scanned;
    }, uid, { timeout: 5000 });
    const stage = await project(page, STAGING[index]);
    assert(stage.inView, `Staging target ${index + 1} was outside the cashier camera.`);
    await interpolateMouse(page, scanner, stage, 14, 13);
    await page.mouse.up();
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const line = tx && tx.items.find((entry) => entry.uid === id);
      return !!line && line.staged;
    }, uid, { timeout: 5000 });
    trace.push({ action: 'normal mouse wheel + drag scan + stage', uid,
      from: roundedPoint(from), scanner: roundedPoint(scanner), stage: roundedPoint(stage) });
  }
  await page.waitForFunction(() => {
    const flow = window.__fw.scene3d.clubhouse().register.getFlow();
    return !!flow && flow.state === 'AllProductsScanned';
  }, null, { timeout: 6000 });
}

async function openPauseMenu(page) {
  // Playwright's synthetic Escape is delivered to page JavaScript but does not
  // invoke Chromium's trusted browser-level pointer-lock escape. Mirror that
  // browser action explicitly, then use the real in-game Escape/menu controls.
  if (await page.evaluate(() => !!document.pointerLockElement)) {
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => !document.pointerLockElement, null, { timeout: 3000 });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await page.locator('.pause-veil-ui').count()) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
  }
  await page.waitForSelector('.pause-veil-ui', { timeout: 5000 });
}

async function loadSlotOne(page) {
  await openPauseMenu(page);
  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  const load = page.getByRole('button', { name: 'Load', exact: true }).first();
  await load.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((entry) => entry.textContent.trim() === 'Load');
    return !!button && !button.disabled;
  }, null, { timeout: 6000 });
  await page.evaluate(() => { window.__qaRecoveryPriorScene = window.__fw.scene3d; });
  await load.click();
  await page.waitForFunction(() => window.__fw.scene3d
    && window.__fw.scene3d !== window.__qaRecoveryPriorScene
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null,
  { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none'
      || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1200);
}

export async function runRegisterRecovery(page) {
  const out = path.resolve(process.env.REGISTER_RECOVERY_QA_ROOT
    || 'qa/cash-register-production/recovery');
  fs.mkdirSync(out, { recursive: true });
  const errors = [];
  const warnings = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    if (!failure.includes('ERR_ABORTED')) failedRequests.push(`${request.url()} (${failure})`);
  });

  const scenarios = {};
  let currentScenario = 'boot';
  let shotNo = 0;
  const shot = async (label) => {
    shotNo++;
    const file = `${String(shotNo).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(out, file) });
    return file;
  };
  const saveResult = (result) => {
    fs.writeFileSync(path.join(out, 'latest-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  };

  try {
    // CARD: Escape must release a held product, settle a presenting card, and reset
    // a half-finished swipe to CardSwipeReady without touching the books.
    currentScenario = 'card interruptions';
    shotNo = 0;
    await boot(page);
    await installReadOnlyProbe(page);
    const cardSkus = ['tees1', 'marker1'];
    const cardFixture = await prepareFixture(page, cardSkus, 'card');
    const cardReady = await waitForTransactionReady(page, cardSkus, cardFixture.name);
    assertNoBanking(cardFixture.before, cardReady, cardSkus, 'Card fixture');
    const cardTrace = [];
    await enterRegister(page, 'WaitingForScan');

    // ROTATION / HELD INPUT: turn a product with the real wheel while it remains
    // safely away from the scanner, then exercise the production focus-loss path.
    const rotationCandidates = await Promise.all(cardReady.tx.items.map(async (line) => ({
      uid: line.uid,
      physical: await page.evaluate((uid) => window.__qaRecovery.item(uid), line.uid),
    })));
    rotationCandidates.sort((left, right) => (
      Math.hypot(right.physical.x - SCANNER.x, right.physical.z - SCANNER.z)
      - Math.hypot(left.physical.x - SCANNER.x, left.physical.z - SCANNER.z)
    ));
    const rotationUid = rotationCandidates[0].uid;
    const rotationStart = rotationCandidates[0].physical;
    const rotationPoint = await project(page, rotationStart);
    await page.mouse.move(rotationPoint.x, rotationPoint.y);
    await page.mouse.down();
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(70);
    let rotatedInfo = await page.evaluate((uid) => window.__qaRecovery.item(uid), rotationUid);
    for (let turn = 0; turn < 3 && rotatedInfo.barcodeFacing <= -0.35; turn++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(70);
      rotatedInfo = await page.evaluate((uid) => window.__qaRecovery.item(uid), rotationUid);
    }
    assert(rotatedInfo && rotatedInfo.barcodeFacing > -0.35,
      'Could not turn the held-product interruption fixture away from the scanner glass.');
    const rotationNeutral = await project(page, { x: 3.45, y: CARRY_Y, z: 4.62 });
    await interpolateMouse(page, rotationPoint, rotationNeutral, 8, 13);
    await page.waitForFunction((uid) => {
      const register = window.__fw.scene3d.clubhouse().register;
      const flow = register.getFlow();
      const tx = register.getTx();
      const line = tx && tx.items.find((entry) => entry.uid === uid);
      return flow && flow.state === 'ProductHeld' && line && !line.scanned;
    }, rotationUid, { timeout: 5000 });
    const rotationBeforeBlur = await snapshot(page, cardSkus, cardFixture.name);
    rotatedInfo = await page.evaluate((uid) => window.__qaRecovery.item(uid), rotationUid);
    assert(rotationBeforeBlur.flow.state === 'ProductHeld',
      `Wheel-held product entered ${rotationBeforeBlur.flow.state}, not ProductHeld.`);
    assert(rotatedInfo && (
      Math.abs(rotatedInfo.rotateX - rotationStart.rotateX) > 0.5
      || Math.abs(rotatedInfo.rotateY - rotationStart.rotateY) > 0.5
      || Math.abs(rotatedInfo.rotateZ - rotationStart.rotateZ) > 0.5
    ),
      'Normal wheel input did not visibly rotate the held product before interruption.');
    const rotationShot = await shot('card-focus-loss-while-product-rotated-and-held');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const flow = register.getFlow();
      return register.isActive() && flow && flow.state === 'WaitingForScan';
    }, null, { timeout: 5000 });
    const rotationRecovered = await snapshot(page, cardSkus, cardFixture.name);
    assert(rotationRecovered.visual.registerClass,
      'Held-product focus recovery lost active register styling.');
    assertBooksUnchanged(cardReady, rotationRecovered, 'Held-product rotation focus loss');
    const rotationRecoveredShot = await shot('card-rotated-product-safe-checkpoint');
    cardTrace.push({ interruption: 'window focus loss while product was wheel-rotated and held',
      beforeFlow: rotationBeforeBlur.flow.state,
      resumeFlow: rotationRecovered.flow.state,
      barcodeFacingBefore: rotationStart.barcodeFacing,
      barcodeFacingAfterWheel: rotatedInfo.barcodeFacing,
      rotationBefore: {
        x: rotationStart.rotateX, y: rotationStart.rotateY, z: rotationStart.rotateZ,
      },
      rotationAfterWheel: {
        x: rotatedInfo.rotateX, y: rotatedInfo.rotateY, z: rotatedInfo.rotateZ,
      },
      evidence: [rotationShot, rotationRecoveredShot] });

    // COUNTER EDGE / FALL PREVENTION: drag an unread product beyond the usable
    // bottom edge with normal mouse input. Production must clamp it back onto the
    // counter, preserve the same UID, and leave it physically pickable for scanning.
    const edgeStart = await page.evaluate((uid) => window.__qaRecovery.item(uid), rotationUid);
    const edgeStartPoint = await project(page, edgeStart);
    // Keep the gesture inside the canvas, but offset it left of the monitor and
    // drawer-pull raycast targets so the same product owns the release/re-pick.
    const beyondCounterPoint = { x: VIEWPORT.width * 0.24, y: VIEWPORT.height - 2 };
    assert(edgeStart && edgeStart.pick && edgeStartPoint.inView,
      'Unread edge-recovery product was not pickable before the drag.');
    assert(edgeStart.barcodeFacing > -0.35,
      'Counter-edge fixture was already in a readable scan orientation.');
    await page.mouse.move(edgeStartPoint.x, edgeStartPoint.y);
    await page.mouse.down();
    await page.waitForFunction(() => {
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!flow && (flow.state === 'ProductHeld' || flow.state === 'ProductScanning');
    }, null, { timeout: 3000 });
    await interpolateMouse(page, edgeStartPoint, beyondCounterPoint, 14, 13);
    const edgeCarried = await page.evaluate((uid) => window.__qaRecovery.item(uid), rotationUid);
    assert(edgeCarried && edgeCarried.root && edgeCarried.root.z > 4.60,
      `Normal drag did not carry the unread product beyond the useful counter edge: ${JSON.stringify(edgeCarried && edgeCarried.root)}.`);
    await page.mouse.up();
    await page.waitForFunction((uid) => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      const flow = register.getFlow();
      const line = tx && tx.items.find((entry) => entry.uid === uid);
      return flow && flow.state === 'WaitingForScan' && line && !line.scanned;
    }, rotationUid, { timeout: 5000 });
    const edgeDropped = await snapshot(page, cardSkus, cardFixture.name);
    const edgePhysical = await page.evaluate((uid) => window.__qaRecovery.item(uid), rotationUid);
    const edgeRecoveredPoint = await project(page, edgePhysical);
    assert(edgePhysical && edgePhysical.uid === rotationUid && edgePhysical.pick
      && edgePhysical.visible && edgePhysical.rendered && edgeRecoveredPoint.inView,
    'Counter-edge release did not preserve the same unread UID at a visible pickable checkpoint.');
    assert(edgePhysical.root
      && edgePhysical.root.x >= 1.419 && edgePhysical.root.x <= 4.381
      && Math.abs(edgePhysical.root.y - 1.067) <= 0.02
      && Math.abs(edgePhysical.root.z - 4.60) <= 0.02,
    `Counter-edge release did not clamp the product root to the safe counter bounds: ${JSON.stringify(edgePhysical.root)}.`);
    assert(edgePhysical.barcodeFacing > -0.35,
      'Counter-edge release changed the unread product into a readable scan orientation.');
    assertBooksUnchanged(cardReady, edgeDropped, 'Unread product counter-edge release');
    const edgeDropShot = await shot('card-unread-product-clamped-from-counter-edge');

    // Prove the rendered checkpoint is reachable through production raycasting,
    // not merely present in the read-only scene probe.
    const repickCountBefore = edgeDropped.flow.history.filter(
      (entry) => entry.event === `product-picked-up:${rotationUid}`,
    ).length;
    await page.mouse.move(edgeRecoveredPoint.x, edgeRecoveredPoint.y);
    await page.mouse.down();
    await page.waitForFunction((uid) => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      const flow = register.getFlow();
      const line = tx && tx.items.find((entry) => entry.uid === uid);
      return flow && (flow.state === 'ProductHeld' || flow.state === 'ProductScanning')
        && line && !line.scanned;
    }, rotationUid, { timeout: 3000 });
    const repickHistory = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.getFlow().history
    ));
    assert(repickHistory.filter(
      (entry) => entry.event === `product-picked-up:${rotationUid}`,
    ).length > repickCountBefore,
      'Counter-edge product was not re-picked through the production UID raycast path.');
    await page.mouse.up();
    await page.waitForFunction(() => {
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!flow && flow.state === 'WaitingForScan';
    }, null, { timeout: 3000 });
    const edgeRepicked = await snapshot(page, cardSkus, cardFixture.name);
    assertBooksUnchanged(cardReady, edgeRepicked, 'Repicked counter-edge product');
    const edgeRepickShot = await shot('card-counter-edge-product-repickable-safe-checkpoint');
    cardTrace.push({ interruption: 'unread product dragged beyond usable counter edge',
      uid: rotationUid,
      dragTarget: roundedPoint({ ...beyondCounterPoint, inView: true }),
      clampedProduct: {
        x: edgePhysical.x, y: edgePhysical.y, z: edgePhysical.z,
        root: edgePhysical.root,
        pick: edgePhysical.pick, rendered: edgePhysical.rendered,
        projected: roundedPoint(edgeRecoveredPoint),
      },
      resumeFlow: edgeRepicked.flow.state,
      evidence: [edgeDropShot, edgeRepickShot] });

    // POINTER LOCK: acquire from an actual browser mouse press while the register is
    // active. Production immediately releases it, leaving cursor-driven checkout
    // active and all transaction facts untouched.
    const pointerCycle = await exercisePointerLockLoss(page, cardSkus, cardFixture.name);
    assertBooksUnchanged(cardReady, pointerCycle.after, 'Direct pointer-lock loss');
    const pointerShot = await shot('card-direct-pointer-lock-loss-safe-cursor');
    cardTrace.push({ interruption: 'direct browser pointer-lock acquisition and loss',
      beforeEvents: pointerCycle.before.visual.pointerLockEvents,
      afterEvents: pointerCycle.after.visual.pointerLockEvents,
      resumeFlow: pointerCycle.after.flow.state,
      evidence: pointerShot });

    const firstItem = await page.evaluate((uid) => window.__qaRecovery.item(uid), cardReady.tx.items[0].uid);
    const firstPoint = await project(page, firstItem);
    await page.mouse.move(firstPoint.x, firstPoint.y);
    await page.mouse.down();
    // Deliberately make the barcode unreadable, then carry it into the scanner's
    // assistance zone. The formal flow must be ProductScanning while the physical
    // item remains unscanned when Escape interrupts it.
    let interruptedItem = firstItem;
    for (let turn = 0; turn < 3 && interruptedItem.barcodeFacing <= -0.35; turn++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(70);
      interruptedItem = await page.evaluate((uid) => window.__qaRecovery.item(uid), cardReady.tx.items[0].uid);
    }
    assert(interruptedItem.barcodeFacing > -0.35,
      'Could not turn the interruption fixture barcode away from the glass.');
    const interruptedScanner = await project(page, SCANNER);
    await interpolateMouse(page, firstPoint, interruptedScanner, 14, 13);
    await page.waitForFunction((uid) => {
      const register = window.__fw.scene3d.clubhouse().register;
      const flow = register.getFlow();
      const tx = register.getTx();
      const item = tx && tx.items.find((line) => line.uid === uid);
      return !!flow && flow.state === 'ProductScanning' && item && !item.scanned;
    }, cardReady.tx.items[0].uid, { timeout: 3000 });
    const heldBeforeEscape = await snapshot(page, cardSkus, cardFixture.name);
    assert(heldBeforeEscape.flow.state === 'ProductScanning',
      `Unread physical scan did not enter ProductScanning (got ${heldBeforeEscape.flow.state}).`);
    const heldShot = await shot('card-escape-while-product-held');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await waitForWalkReturn(page, cardFixture.walkCamera);
    await page.waitForTimeout(180);
    const scanRecovered = await snapshot(page, cardSkus, cardFixture.name);
    assert(scanRecovered.flow.state === 'WaitingForScan',
      `Held-product Escape resumed ${scanRecovered.flow.state}, not WaitingForScan.`);
    assert(scanRecovered.tx.stage === 'scanning', 'Held-product Escape changed the legacy transaction stage.');
    assertEscapeCleanup(scanRecovered, 'Held-product Escape');
    assertBooksUnchanged(cardReady, scanRecovered, 'Held-product Escape');
    const scanRecoveredShot = await shot('card-scan-safe-checkpoint-walking-camera');
    cardTrace.push({ interruption: 'Escape while product mouse button held',
      beforeFlow: heldBeforeEscape.flow.state, resumeFlow: scanRecovered.flow.state,
      evidence: [heldShot, scanRecoveredShot] });

    await enterRegister(page, 'WaitingForScan');
    await scanAndStageAll(page, cardSkus, cardFixture.name, cardTrace);
    await page.keyboard.press('t');
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && tx.method === 'card' && tx.stage === 'card-present';
    }, null, { timeout: 8000 });
    await page.waitForTimeout(220);
    const presentationBefore = await snapshot(page, cardSkus, cardFixture.name);
    assert(presentationBefore.flow.state === 'CardPresented',
      `Card presentation did not reach CardPresented (got ${presentationBefore.flow.state}).`);
    const presentationShot = await shot('card-escape-during-customer-presentation');
    await page.keyboard.press('Escape');
    await waitForWalkReturn(page, cardFixture.walkCamera);
    const presentationRecovered = await snapshot(page, cardSkus, cardFixture.name);
    assert(presentationRecovered.flow.state === 'CardPresented',
      `Card-presentation Escape resumed ${presentationRecovered.flow.state}, not CardPresented.`);
    assert(presentationRecovered.tx.stage === 'card-present',
      `Card-presentation Escape changed stage to ${presentationRecovered.tx.stage}.`);
    assertEscapeCleanup(presentationRecovered, 'Card-presentation Escape');
    assertBooksUnchanged(cardReady, presentationRecovered, 'Card-presentation Escape');
    const presentationRecoveredShot = await shot('card-presentation-safe-checkpoint');
    cardTrace.push({ interruption: 'Escape during physical customer card presentation',
      resumeFlow: presentationRecovered.flow.state,
      evidence: [presentationShot, presentationRecoveredShot] });

    await enterRegister(page, 'CardPresented');
    const terminal = await project(page, CARD_TERMINAL);
    assert(terminal.inView, 'Card terminal was outside the cashier camera after recovery.');
    await page.mouse.click(terminal.x, terminal.y);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!tx && tx.stage === 'card-ready' && flow && flow.state === 'CardSwipeReady';
    }, null, { timeout: 6000 });
    await waitForCameraStable(page);
    const channel = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.swipeAt());
    const swipeTop = await project(page, channel.top);
    const swipeBottom = await project(page, channel.bot);
    assert(swipeTop.inView && swipeBottom.inView, 'Recovered card swipe channel was outside the camera.');
    await page.mouse.move(swipeTop.x, swipeTop.y);
    await page.mouse.down();
    await page.waitForFunction(() => {
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!flow && flow.state === 'CardSwiping';
    }, null, { timeout: 2000 });
    const partialSwipe = {
      x: swipeTop.x + (swipeBottom.x - swipeTop.x) * 0.42,
      y: swipeTop.y + (swipeBottom.y - swipeTop.y) * 0.42,
    };
    await interpolateMouse(page, swipeTop, partialSwipe, 7, 16);
    const swipeBeforeEscape = await snapshot(page, cardSkus, cardFixture.name);
    const swipeShot = await shot('card-escape-mid-mouse-swipe');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await waitForWalkReturn(page, cardFixture.walkCamera);
    const swipeRecovered = await snapshot(page, cardSkus, cardFixture.name);
    assert(swipeRecovered.flow.state === 'CardSwipeReady',
      `Mid-swipe Escape resumed ${swipeRecovered.flow.state}, not CardSwipeReady.`);
    assert(swipeRecovered.tx.stage === 'card-ready',
      `Mid-swipe Escape changed stage to ${swipeRecovered.tx.stage}.`);
    assert(Math.abs(swipeRecovered.visual.swipeU) < 0.001,
      `Mid-swipe Escape left swipe progress at ${swipeRecovered.visual.swipeU}.`);
    assertEscapeCleanup(swipeRecovered, 'Mid-swipe Escape');
    assertBooksUnchanged(cardReady, swipeRecovered, 'Mid-swipe Escape');
    const swipeRecoveredShot = await shot('card-swipe-ready-reset');

    // A new real mouse-down must catch the channel after recovery. This is the
    // black-box proof that no stale button/grab/pointer state survived.
    await enterRegister(page, 'CardSwipeReady');
    const freshChannel = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.swipeAt());
    const freshTop = await project(page, freshChannel.top);
    const freshBottom = await project(page, freshChannel.bot);
    await page.mouse.move(freshTop.x, freshTop.y);
    await page.mouse.down();
    await page.waitForFunction(() => {
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!flow && flow.state === 'CardSwiping';
    }, null, { timeout: 2000 });
    await interpolateMouse(page, freshTop, {
      x: freshTop.x + (freshBottom.x - freshTop.x) * 0.18,
      y: freshTop.y + (freshBottom.y - freshTop.y) * 0.18,
    }, 4, 16);
    const freshShot = await shot('card-fresh-swipe-caught-after-reentry');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await waitForWalkReturn(page, cardFixture.walkCamera);
    const cardFinal = await snapshot(page, cardSkus, cardFixture.name);
    assert(cardFinal.flow.state === 'CardSwipeReady', 'Fresh post-recovery swipe could not return safely.');
    assertBooksUnchanged(cardReady, cardFinal, 'Card recovery sequence');
    cardTrace.push({ interruption: 'Escape at 42% of a mouse-controlled swipe',
      beforeFlow: swipeBeforeEscape.flow.state,
      resumeFlow: swipeRecovered.flow.state,
      freshGestureCaught: true,
      endpoints: { top: roundedPoint(swipeTop), bottom: roundedPoint(swipeBottom) },
      evidence: [swipeShot, swipeRecoveredShot, freshShot] });

    // CARD PROCESSING: complete a valid physical swipe, then leave during the
    // 1.5-second authorization window. With no persisted approval, recovery must
    // return to CardPresented and must not allow the pending timer to authorize.
    await enterRegister(page, 'CardSwipeReady');
    const processingEndpoints = await swipeCardDown(page);
    const processingBefore = await snapshot(page, cardSkus, cardFixture.name);
    const processingShot = await shot('card-escape-during-processing');
    await page.keyboard.press('Escape');
    await waitForWalkReturn(page, cardFixture.walkCamera);
    const processingRecovered = await snapshot(page, cardSkus, cardFixture.name);
    assert(processingRecovered.flow.state === 'CardPresented',
      `Card-processing Escape resumed ${processingRecovered.flow.state}, not CardPresented.`);
    assert(processingRecovered.tx.stage === 'card-present',
      `Card-processing Escape left legacy stage ${processingRecovered.tx.stage}.`);
    assertEscapeCleanup(processingRecovered, 'Card-processing Escape');
    assertBooksUnchanged(cardReady, processingRecovered, 'Card-processing Escape');
    const processingRecoveredShot = await shot('card-processing-safe-presentation-checkpoint');
    cardTrace.push({ interruption: 'Escape during live card authorization processing',
      beforeFlow: processingBefore.flow.state,
      resumeFlow: processingRecovered.flow.state,
      endpoints: processingEndpoints,
      evidence: [processingShot, processingRecoveredShot] });

    // Re-run the physical card path to an authorization result. The public fixture
    // fixes payment method but does not expose an outcome override; if the seeded
    // runtime naturally declines, retry through the visible reader and record it.
    await enterRegister(page, 'CardPresented');
    await activateCardReader(page);
    let cardDeclinesObserved = 0;
    let approved = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const endpoints = await swipeCardDown(page);
      await page.waitForFunction(() => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return !!tx && (tx.stage === 'receipt' || tx.stage === 'card-declined');
      }, null, { timeout: 6000 });
      const result = await snapshot(page, cardSkus, cardFixture.name);
      if (result.tx.stage === 'receipt') {
        approved = true;
        cardTrace.push({ action: 'physical card authorization approved after recovery',
          attempt, endpoints });
        break;
      }
      cardDeclinesObserved++;
      const declinedShot = await shot(`card-natural-decline-retry-${attempt}`);
      cardTrace.push({ action: 'seeded runtime card decline followed by physical retry',
        attempt, cardsTried: result.tx.cardsTried, endpoints, evidence: declinedShot });
      await activateCardReader(page);
    }
    assert(approved, 'Five normal physical card attempts failed after processing recovery.');

    // RECEIPT PRINTING: interrupt while the single physical receipt is still
    // emerging. The authorized payment checkpoint must reproduce no second paper
    // and must still bank nothing until the later bag handoff.
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const flow = register.getFlow();
      const receipt = window.__qaRecovery.kind('receipt');
      return !!flow && flow.state === 'ReceiptPrinting' && receipt && !receipt.pick;
    }, null, { timeout: 6000 });
    const receiptPrintingBefore = await snapshot(page, cardSkus, cardFixture.name);
    assert(receiptPrintingBefore.visual.receiptsRendered === 1,
      'Receipt printer created more or fewer than one paper before interruption.');
    const receiptPrintingShot = await shot('card-focus-loss-during-receipt-printing');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const flow = register.getFlow();
      return register.isActive() && flow && flow.state === 'ReceiptPrinting';
    }, null, { timeout: 5000 });
    const receiptPrintingRecovered = await snapshot(page, cardSkus, cardFixture.name);
    assert(receiptPrintingRecovered.visual.receiptsRendered === 1,
      'Receipt-print recovery duplicated or deleted the physical receipt.');
    assertBooksUnchanged(cardReady, receiptPrintingRecovered, 'Receipt-print focus loss');
    const receiptPrintingRecoveredShot = await shot('card-single-receipt-safe-checkpoint');
    cardTrace.push({ interruption: 'window focus loss during physical receipt feed',
      beforeFlow: receiptPrintingBefore.flow.state,
      resumeFlow: receiptPrintingRecovered.flow.state,
      receiptsBefore: receiptPrintingBefore.visual.receiptsRendered,
      receiptsAfter: receiptPrintingRecovered.visual.receiptsRendered,
      evidence: [receiptPrintingShot, receiptPrintingRecoveredShot] });

    await page.waitForFunction(() => {
      const receipt = window.__qaRecovery.kind('receipt');
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && tx.receiptPrinted && receipt && receipt.pick;
    }, null, { timeout: 10000 });
    const receipt = await page.evaluate(() => window.__qaRecovery.kind('receipt'));
    const receiptPoint = await project(page, receipt);
    const receiptBagPoint = await project(page, BAG);
    assert(receiptPoint.inView && receiptBagPoint.inView,
      'Receipt or bag left the receipt-packing camera.');
    await page.mouse.move(receiptPoint.x, receiptPoint.y);
    await page.mouse.down();
    await page.waitForFunction(() => {
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!flow && flow.state === 'Bagging';
    }, null, { timeout: 5000 });
    await interpolateMouse(page, receiptPoint, receiptBagPoint, 18, 13);
    await page.mouse.up();
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && tx.receiptPacked;
    }, null, { timeout: 5000 });

    // BAGGING: interrupt a real held paid product away from the bag. Its UID and
    // unbagged flag must survive, while the already packed receipt remains unique.
    const baggingUid = cardReady.tx.items[0].uid;
    const baggingItem = await page.evaluate((uid) => window.__qaRecovery.item(uid), baggingUid);
    const baggingFrom = await project(page, baggingItem);
    const neutralBaggingPoint = await project(page, { x: 2.95, y: CARRY_Y, z: 4.65 });
    await page.mouse.move(baggingFrom.x, baggingFrom.y);
    await page.mouse.down();
    await interpolateMouse(page, baggingFrom, neutralBaggingPoint, 10, 13);
    const baggingBefore = await snapshot(page, cardSkus, cardFixture.name);
    const baggingShot = await shot('card-focus-loss-with-paid-product-held-during-bagging');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const flow = register.getFlow();
      return register.isActive() && flow && flow.state === 'Bagging';
    }, null, { timeout: 5000 });
    const baggingRecovered = await snapshot(page, cardSkus, cardFixture.name);
    const recoveredLine = baggingRecovered.tx.items.find((line) => line.uid === baggingUid);
    assert(recoveredLine && !recoveredLine.bagged,
      'Bagging focus loss lost or prematurely packed the held product UID.');
    assert(baggingRecovered.tx.receiptPacked
      && baggingRecovered.visual.receiptsRendered === 1,
    'Bagging focus loss lost or duplicated the packed receipt.');
    assertBooksUnchanged(cardReady, baggingRecovered, 'Bagging focus loss');
    const baggingRecoveredShot = await shot('card-bagging-safe-counter-checkpoint');
    cardTrace.push({ interruption: 'window focus loss with paid product held during bagging',
      beforeFlow: baggingBefore.flow.state,
      resumeFlow: baggingRecovered.flow.state,
      heldUid: baggingUid,
      evidence: [baggingShot, baggingRecoveredShot] });

    for (const line of baggingRecovered.tx.items) {
      if (line.bagged) continue;
      const physical = await page.evaluate((uid) => window.__qaRecovery.item(uid), line.uid);
      const from = await project(page, physical);
      const to = await project(page, BAG);
      assert(from.inView && to.inView, `Bagging path for ${line.uid} left the cashier camera.`);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await interpolateMouse(page, from, to, 16, 13);
      await page.mouse.up();
      await page.waitForFunction((uid) => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        const item = tx && tx.items.find((entry) => entry.uid === uid);
        return !!item && item.bagged;
      }, line.uid, { timeout: 5000 });
    }
    await page.waitForTimeout(800);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const bag = window.__qaRecovery.kind('bag');
      return !!tx && tx.receiptPacked && tx.items.every((line) => line.bagged)
        && bag && bag.pick;
    }, null, { timeout: 6000 });

    // BAG HANDOFF: gathering the handles enters BagHandoff immediately. Interrupt
    // before the customer target, then verify the full bag returns to its safe pose
    // and the sale still has not banked.
    const handoffBag = await page.evaluate(() => window.__qaRecovery.kind('bag'));
    const handoffPalm = await page.evaluate(() => window.__qaRecovery.kind('palm'));
    assert(handoffBag && handoffPalm, 'Bag handoff targets were not rendered.');
    const handoffBagPoint = await project(page, handoffBag);
    await page.mouse.move(handoffBagPoint.x, handoffBagPoint.y);
    await page.mouse.down();
    await page.waitForFunction(() => {
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!flow && flow.state === 'BagHandoff';
    }, null, { timeout: 3000 });
    await waitForCameraStable(page);
    const handoffLiveBag = await page.evaluate(() => window.__qaRecovery.kind('bag'));
    const handoffLivePalm = await page.evaluate(() => window.__qaRecovery.kind('palm'));
    const handoffLiveBagPoint = await project(page, {
      x: handoffLiveBag.x, y: CARRY_Y, z: handoffLiveBag.z,
    });
    const handoffLivePalmPoint = await project(page, {
      x: handoffLivePalm.x, y: CARRY_Y, z: handoffLivePalm.z,
    });
    const partialBagPoint = {
      x: handoffLiveBagPoint.x + (handoffLivePalmPoint.x - handoffLiveBagPoint.x) * 0.22,
      y: handoffLiveBagPoint.y + (handoffLivePalmPoint.y - handoffLiveBagPoint.y) * 0.22,
    };
    await interpolateMouse(page, handoffLiveBagPoint, partialBagPoint, 7, 14);
    const handoffBefore = await snapshot(page, cardSkus, cardFixture.name);
    const handoffShot = await shot('card-focus-loss-mid-bag-handoff');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const flow = register.getFlow();
      const bag = window.__qaRecovery.kind('bag');
      return register.isActive() && flow && flow.state === 'Bagging' && bag && bag.pick;
    }, null, { timeout: 6000 });
    const handoffRecovered = await snapshot(page, cardSkus, cardFixture.name);
    assert(handoffRecovered.tx.stage === 'bagging' && handoffRecovered.tx.receiptPacked
      && handoffRecovered.tx.items.every((line) => line.bagged),
    'Bag-handoff recovery did not preserve the complete paid bag.');
    assertBooksUnchanged(cardReady, handoffRecovered, 'Bag-handoff focus loss');
    const handoffRecoveredShot = await shot('card-complete-bag-returned-safe-pose');
    cardTrace.push({ interruption: 'window focus loss after gathering bag handles',
      beforeFlow: handoffBefore.flow.state,
      resumeFlow: handoffRecovered.flow.state,
      evidence: [handoffShot, handoffRecoveredShot] });

    // Finish once through the same physical handoff and prove a later frame cannot
    // bank the same transaction again.
    const finalBag = await page.evaluate(() => window.__qaRecovery.kind('bag'));
    const finalBagPoint = await project(page, finalBag);
    await page.mouse.move(finalBagPoint.x, finalBagPoint.y);
    await page.mouse.down();
    await page.waitForFunction(() => {
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!flow && flow.state === 'BagHandoff';
    }, null, { timeout: 3000 });
    await waitForCameraStable(page);
    const finalLiveBag = await page.evaluate(() => window.__qaRecovery.kind('bag'));
    const finalPalm = await page.evaluate(() => window.__qaRecovery.kind('palm'));
    const finalLiveBagPoint = await project(page, {
      x: finalLiveBag.x, y: CARRY_Y, z: finalLiveBag.z,
    });
    const finalPalmPoint = await project(page, {
      x: finalPalm.x, y: CARRY_Y, z: finalPalm.z,
    });
    await interpolateMouse(page, finalLiveBagPoint, finalPalmPoint, 18, 13);
    await page.mouse.up();
    await page.waitForFunction(([units, history]) => {
      const shop = window.__fw.state.shop;
      return ((shop.salesLive || {}).units || 0) === units + 2
        && (shop.transactionHistory || []).length === history + 1
        && !window.__fw.scene3d.clubhouse().register.hasTx();
    }, [cardFixture.before.books.units, cardFixture.before.books.history], { timeout: 10000 });
    const cardCompleted = await snapshot(page, cardSkus, cardFixture.name);
    assert(cardCompleted.books.revenue > cardFixture.before.books.revenue,
      'Completed recovered card sale did not increase revenue.');
    assert(cardCompleted.books.held.length === cardFixture.before.books.held.length,
      'Completed recovered card sale left held inventory behind.');
    assert(cardCompleted.books.nextTransactionNo === cardFixture.before.books.nextTransactionNo + 1,
      'Completed recovered card sale did not consume exactly one receipt number.');
    for (const skuId of cardSkus) {
      assert(cardCompleted.books.shelf[skuId].shelf
        === cardFixture.before.books.shelf[skuId].shelf - 1,
      `${skuId} did not decrease exactly once after recovered card handoff.`);
    }
    await page.waitForTimeout(900);
    const cardExactlyOnce = await snapshot(page, cardSkus, cardFixture.name);
    assert(same(cardExactlyOnce.books, cardCompleted.books),
      'Recovered card handoff banked the same sale more than once.');
    const completedShot = await shot('card-recovered-sale-banked-exactly-once');
    scenarios.card = { ok: true, customer: cardFixture.name, products: cardSkus,
      beforeBooks: cardFixture.before.books, inFlightBooks: cardReady.books,
      final: cardFinal, completed: cardCompleted, exactlyOnce: cardExactlyOnce,
      deterministicDeclineFixture: false,
      cardDeclinesObserved,
      completionEvidence: completedShot,
      trace: cardTrace };

    // CASH: Escape while a tender note is physically held must close the drawer
    // and keep every tender piece. Focus loss during change selection must return
    // selected change to the transaction-local float, then permit a clean re-open.
    currentScenario = 'cash drawer and focus recovery';
    shotNo = 0;
    await boot(page);
    await installReadOnlyProbe(page);
    const cashSkus = ['tees1', 'marker1'];
    const cashFixture = await prepareFixture(page, cashSkus, 'cash');
    const cashReady = await waitForTransactionReady(page, cashSkus, cashFixture.name);
    assertNoBanking(cashFixture.before, cashReady, cashSkus, 'Cash fixture');
    const cashTrace = [];
    await enterRegister(page, 'WaitingForScan');
    await scanAndStageAll(page, cashSkus, cashFixture.name, cashTrace);
    await page.keyboard.press('t');
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!tx && tx.method === 'cash' && tx.stage === 'cash-tender'
        && flow && flow.state === 'CashPresented';
    }, null, { timeout: 8000 });

    // CASH PRESENTATION: interrupt the visible customer count before accepting it.
    // Recovery must settle the same tender pieces back to a pickable presentation
    // without touching the persistent drawer or any sale books.
    await page.waitForTimeout(220);
    const cashPresentationBefore = await snapshot(page, cashSkus, cashFixture.name);
    assert(cashPresentationBefore.visual.tenderRendered > 0,
      'Cash presentation created no visible tender pieces before interruption.');
    const cashPresentationShot = await shot('cash-focus-loss-during-customer-presentation');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const flow = register.getFlow();
      const tx = register.getTx();
      return register.isActive() && flow && flow.state === 'CashPresented'
        && tx && tx.stage === 'cash-tender';
    }, null, { timeout: 5000 });
    const cashPresentationRecovered = await snapshot(page, cashSkus, cashFixture.name);
    assert(cashPresentationRecovered.visual.tenderRendered
      === cashPresentationBefore.visual.tenderRendered,
    'Cash-presentation recovery lost or duplicated a tender piece.');
    assertBooksUnchanged(cashReady, cashPresentationRecovered, 'Cash-presentation focus loss');
    const cashPresentationRecoveredShot = await shot('cash-presentation-safe-checkpoint');
    cashTrace.push({ interruption: 'window focus loss during physical cash presentation',
      beforeFlow: cashPresentationBefore.flow.state,
      resumeFlow: cashPresentationRecovered.flow.state,
      tenderPiecesBefore: cashPresentationBefore.visual.tenderRendered,
      tenderPiecesAfter: cashPresentationRecovered.visual.tenderRendered,
      evidence: [cashPresentationShot, cashPresentationRecoveredShot] });

    await page.waitForTimeout(950);
    const tender = await page.evaluate(() => window.__qaRecovery.money('tender'));
    assert(tender, 'Cash customer presented no physical tender.');
    const tenderPoint = await project(page, tender);
    await page.mouse.click(tenderPoint.x, tenderPoint.y);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && tx.stage === 'cash-drawer';
    }, null, { timeout: 5000 });
    await page.keyboard.press('d');
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!tx && tx.drawerOpen && flow && flow.state === 'DrawerOpening';
    }, null, { timeout: 3000 });
    const drawerOpeningBefore = await snapshot(page, cashSkus, cashFixture.name);
    const drawerOpeningShot = await shot('cash-escape-during-drawer-opening-transition');
    await page.keyboard.press('Escape');
    await waitForWalkReturn(page, cashFixture.walkCamera);
    await page.waitForFunction(() => {
      const state = window.__qaRecovery.snapshot([], null);
      return state.tx && !state.tx.drawerOpen && state.visual.drawerMoneyRendered === 0;
    }, null, { timeout: 8000 });
    const drawerOpeningRecovered = await snapshot(page, cashSkus, cashFixture.name);
    assert(drawerOpeningRecovered.flow.state === 'CashAccepted',
      `Drawer-opening Escape resumed ${drawerOpeningRecovered.flow.state}, not CashAccepted.`);
    assert(!drawerOpeningRecovered.tx.deposited,
      'Drawer-opening Escape prematurely secured customer tender.');
    assert(drawerOpeningRecovered.visual.tenderRendered
      === cashPresentationRecovered.visual.tenderRendered,
    'Drawer-opening Escape lost or duplicated tender props.');
    assertEscapeCleanup(drawerOpeningRecovered, 'Drawer-opening Escape', { drawerClosed: true });
    assertBooksUnchanged(cashReady, drawerOpeningRecovered, 'Drawer-opening Escape');
    const drawerOpeningRecoveredShot = await shot('cash-drawer-opening-safe-closed-checkpoint');
    cashTrace.push({ interruption: 'Escape during physical drawer-opening transition',
      beforeFlow: drawerOpeningBefore.flow.state,
      resumeFlow: drawerOpeningRecovered.flow.state,
      evidence: [drawerOpeningShot, drawerOpeningRecoveredShot] });

    await enterRegister(page, 'CashAccepted');
    await page.keyboard.press('d');
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!tx && tx.drawerOpen && flow && flow.state === 'DepositingCash';
    }, null, { timeout: 7000 });
    await waitForCameraStable(page);

    const movingTender = await page.evaluate(() => window.__qaRecovery.money('tender'));
    const movingFrom = await project(page, movingTender);
    await page.mouse.move(movingFrom.x, movingFrom.y);
    await page.mouse.down();
    // A press attaches the physical note to the cashier hand immediately. Keep the
    // cursor at its customer-side origin so Escape cannot accidentally count a
    // single-note tender as deposited while this test is trying to interrupt it.
    await page.waitForTimeout(80);
    const cashHeldBefore = await snapshot(page, cashSkus, cashFixture.name);
    const cashHeldShot = await shot('cash-escape-with-tender-held-drawer-open');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await waitForWalkReturn(page, cashFixture.walkCamera);
    await page.waitForFunction(() => {
      const state = window.__qaRecovery.snapshot([], null);
      return state.tx && !state.tx.drawerOpen && state.visual.drawerMoneyRendered === 0;
    }, null, { timeout: 8000 });
    const drawerRecovered = await snapshot(page, cashSkus, cashFixture.name);
    assert(drawerRecovered.flow.state === 'CashAccepted',
      `Drawer Escape resumed ${drawerRecovered.flow.state}, not CashAccepted.`);
    assert(drawerRecovered.tx.stage === 'cash-drawer' && !drawerRecovered.tx.deposited,
      'Drawer Escape skipped or duplicated tender deposit state.');
    assert(drawerRecovered.visual.tenderRendered === cashHeldBefore.visual.tenderRendered,
      'Drawer Escape lost or duplicated a physical tender mesh.');
    assertEscapeCleanup(drawerRecovered, 'Open-drawer Escape', { drawerClosed: true });
    assertBooksUnchanged(cashReady, drawerRecovered, 'Open-drawer Escape');
    const drawerRecoveredShot = await shot('cash-drawer-closed-safe-checkpoint');
    cashTrace.push({ interruption: 'Escape with tender held over open drawer',
      resumeFlow: drawerRecovered.flow.state,
      tenderPiecesBefore: cashHeldBefore.visual.tenderRendered,
      tenderPiecesAfter: drawerRecovered.visual.tenderRendered,
      evidence: [cashHeldShot, drawerRecoveredShot] });

    await enterRegister(page, 'CashAccepted');
    await page.keyboard.press('d');
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && tx.drawerOpen;
    }, null, { timeout: 6000 });
    await waitForCameraStable(page);
    for (let guard = 0; guard < 24; guard++) {
      const piece = await page.evaluate(() => window.__qaRecovery.money('tender'));
      if (!piece) break;
      const slot = await page.evaluate((denom) => window.__qaRecovery.money('drawer', denom), piece.denom);
      assert(slot, `Drawer had no visible ${piece.denom} tender compartment after recovery.`);
      const from = await project(page, piece);
      const to = await project(page, { x: slot.x, y: CARRY_Y, z: slot.z });
      assert(from.inView && to.inView, 'Recovered cash deposit drag left the drawer camera.');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await interpolateMouse(page, from, to, 16, 13);
      await page.mouse.up();
      await page.waitForTimeout(90);
      cashTrace.push({ action: 'normal recovered tender deposit', denom: piece.denom,
        from: roundedPoint(from), to: roundedPoint(to) });
    }
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!tx && tx.deposited && flow && flow.state === 'SelectingChange';
    }, null, { timeout: 8000 });
    const twentyCoin = await page.evaluate(() => window.__qaRecovery.money('drawer', 0.2));
    assert(twentyCoin, 'No physical 20-unit coin was available for focus-loss recovery.');
    const twentyCoinPoint = await project(page, twentyCoin);
    await page.mouse.move(twentyCoinPoint.x, twentyCoinPoint.y);
    await page.mouse.down();
    await page.waitForFunction(() => !!window.__qaRecovery.money('hand', 0.2), null,
      { timeout: 3000 });
    const selectedBeforeBlur = await snapshot(page, cashSkus, cashFixture.name);
    const selectedShot = await shot('cash-focus-loss-with-change-selected');
    // Dispatch the browser lifecycle event, not a register action hook. It exercises
    // main.js's production window blur listener exactly as a tab/application switch does.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    await page.waitForFunction(() => {
      const state = window.__qaRecovery.snapshot([], null);
      return state.flow && state.flow.state === 'CashAccepted'
        && state.tx && !state.tx.drawerOpen && state.visual.handMoneyRendered === 0
        && state.visual.drawerMoneyRendered === 0;
    }, null, { timeout: 8000 });
    await waitForCameraStable(page);
    const blurRecovered = await snapshot(page, cashSkus, cashFixture.name);
    assert(blurRecovered.active, 'Focus-loss recovery unexpectedly exited register mode.');
    assert(blurRecovered.visual.registerClass, 'Focus-loss recovery lost active register styling.');
    assert(blurRecovered.tx.deposited, 'Focus-loss recovery undid already secured customer tender.');
    assert(Object.values(blurRecovered.tx.hand).reduce((sum, count) => sum + count, 0) === 0,
      'Focus-loss recovery left selected change in the cashier hand.');
    assert(blurRecovered.flow.state === 'CashAccepted',
      `Focus loss resumed ${blurRecovered.flow.state}, not CashAccepted.`);
    assertBooksUnchanged(cashReady, blurRecovered, 'Cash focus loss');
    const blurRecoveredShot = await shot('cash-focus-loss-closed-drawer-cleanup');
    cashTrace.push({ interruption: 'window focus loss with physical change selected',
      beforeFlow: selectedBeforeBlur.flow.state,
      resumeFlow: blurRecovered.flow.state,
      selectedHandBefore: selectedBeforeBlur.tx.hand,
      selectedHandAfter: blurRecovered.tx.hand,
      evidence: [selectedShot, blurRecoveredShot] });

    await page.keyboard.press('Escape');
    await waitForWalkReturn(page, cashFixture.walkCamera);
    const blurWalk = await snapshot(page, cashSkus, cashFixture.name);
    assertEscapeCleanup(blurWalk, 'Post-focus Escape', { drawerClosed: true });
    await enterRegister(page, 'CashAccepted');
    await page.keyboard.press('d');
    await page.waitForFunction(() => {
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!flow && flow.state === 'SelectingChange';
    }, null, { timeout: 8000 });
    await waitForCameraStable(page);
    const retryTwentyCoin = await page.evaluate(() => window.__qaRecovery.money('drawer', 0.2));
    const retryTwentyCoinPoint = await project(page, retryTwentyCoin);
    await page.mouse.click(retryTwentyCoinPoint.x, retryTwentyCoinPoint.y);
    await page.waitForFunction(() => !!window.__qaRecovery.money('hand', 0.2), null,
      { timeout: 3000 });
    const returnedTwentyCoin = await page.evaluate(() => window.__qaRecovery.money('hand', 0.2));
    const returnedTwentyCoinPoint = await project(page, returnedTwentyCoin);
    await page.mouse.click(returnedTwentyCoinPoint.x, returnedTwentyCoinPoint.y);
    await page.waitForFunction(() => !window.__qaRecovery.money('hand', 0.2), null,
      { timeout: 3000 });
    const cashReentryShot = await shot('cash-change-select-and-return-after-reentry');
    await page.keyboard.press('Escape');
    await waitForWalkReturn(page, cashFixture.walkCamera);
    await page.waitForFunction(() => window.__qaRecovery.snapshot([], null).visual.drawerMoneyRendered === 0,
      null, { timeout: 8000 });
    const cashFinal = await snapshot(page, cashSkus, cashFixture.name);
    assertEscapeCleanup(cashFinal, 'Cash final Escape', { drawerClosed: true });
    assertBooksUnchanged(cashReady, cashFinal, 'Cash recovery sequence');
    cashTrace.push({ action: 'normal-control drawer re-open, 20-unit coin select, and undo after recovery',
      evidence: cashReentryShot });

    // CHANGE HANDOFF: count the exact visible denominations, start the physical
    // movement toward the customer's palm, then interrupt before ownership changes.
    // Recovery must return every selected piece to the transaction-local drawer,
    // close it, and retain the already secured tender without banking the sale.
    await enterRegister(page, 'CashAccepted');
    await page.keyboard.press('d');
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const flow = register.getFlow();
      return !!flow && flow.state === 'SelectingChange';
    }, null, { timeout: 8000 });
    await waitForCameraStable(page);
    const exactChange = await selectExactChange(page);
    const changePalm = await page.evaluate(() => window.__qaRecovery.kind('palm'));
    assert(changePalm, 'Customer change-reception palm was not rendered.');
    const changePalmPoint = await project(page, changePalm);
    assert(changePalmPoint.inView, 'Customer change-reception palm left the cashier camera.');
    await page.mouse.click(changePalmPoint.x, changePalmPoint.y);
    await page.waitForFunction(() => {
      const flow = window.__fw.scene3d.clubhouse().register.getFlow();
      return !!flow && flow.state === 'GivingChange';
    }, null, { timeout: 3000 });
    await page.waitForTimeout(180);
    const changeHandoffBefore = await snapshot(page, cashSkus, cashFixture.name);
    assert(changeHandoffBefore.visual.handMoneyRendered > 0,
      'Change handoff began without visible money attached to the cashier hand.');
    const changeHandoffShot = await shot('cash-focus-loss-mid-change-handoff');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(() => {
      const state = window.__qaRecovery.snapshot([], null);
      return state.active && state.flow && state.flow.state === 'CashAccepted'
        && state.tx && state.tx.deposited && !state.tx.drawerOpen
        && state.visual.handMoneyRendered === 0
        && state.visual.drawerMoneyRendered === 0;
    }, null, { timeout: 8000 });
    const changeHandoffRecovered = await snapshot(page, cashSkus, cashFixture.name);
    assert(Object.values(changeHandoffRecovered.tx.hand)
      .reduce((sum, count) => sum + count, 0) === 0,
    'Change-handoff recovery left money in the cashier hand.');
    assertBooksUnchanged(cashReady, changeHandoffRecovered, 'Change-handoff focus loss');
    const changeHandoffRecoveredShot = await shot('cash-change-returned-safe-closed-checkpoint');
    cashTrace.push({ interruption: 'window focus loss during physical change handoff',
      beforeFlow: changeHandoffBefore.flow.state,
      resumeFlow: changeHandoffRecovered.flow.state,
      changeDue: exactChange.due,
      selectedPlan: exactChange.plan,
      selectedHandBefore: changeHandoffBefore.tx.hand,
      selectedHandAfter: changeHandoffRecovered.tx.hand,
      evidence: [changeHandoffShot, changeHandoffRecoveredShot] });
    await page.keyboard.press('Escape');
    await waitForWalkReturn(page, cashFixture.walkCamera);
    const cashAfterHandoff = await snapshot(page, cashSkus, cashFixture.name);
    assertEscapeCleanup(cashAfterHandoff, 'Post-change-handoff Escape', { drawerClosed: true });
    assertBooksUnchanged(cashReady, cashAfterHandoff, 'Cash interruption suite');
    scenarios.cash = { ok: true, customer: cashFixture.name, products: cashSkus,
      beforeBooks: cashFixture.before.books, inFlightBooks: cashReady.books,
      final: cashAfterHandoff, preHandoff: cashFinal, trace: cashTrace };

    // SAVE/LOAD: use the visible pause-menu Save and Load buttons. The renderer-only
    // transaction is intentionally void after load; the saved held ledger restores
    // every product exactly once, even when the same slot is loaded twice.
    currentScenario = 'normal UI save and reload';
    shotNo = 0;
    await boot(page);
    await installReadOnlyProbe(page);
    const saveSkus = ['glove1'];
    const saveFixture = await prepareFixture(page, saveSkus, 'card');
    const saveReady = await waitForTransactionReady(page, saveSkus, saveFixture.name);
    await enterRegister(page, 'WaitingForScan');
    const saveTrace = [];
    await scanAndStageAll(page, saveSkus, saveFixture.name, saveTrace);
    await page.keyboard.press('Escape');
    await waitForWalkReturn(page, saveFixture.walkCamera);
    const preSave = await snapshot(page, saveSkus, saveFixture.name);
    assert(preSave.books.held.length === saveFixture.before.books.held.length + 1,
      'Save/reload fixture did not have exactly one held unit in flight.');
    await openPauseMenu(page);
    await page.getByRole('button', { name: 'Save game', exact: true }).click();
    const saveHere = page.getByRole('button', { name: 'Save here', exact: true }).first();
    await saveHere.waitFor({ state: 'visible' });
    await saveHere.click();
    await page.waitForTimeout(450);
    const saveShot = await shot('save-slot-written-mid-transaction');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await loadSlotOne(page);
    const afterFirstLoad = await snapshot(page, saveSkus);
    assert(!afterFirstLoad.active && !afterFirstLoad.hasTx,
      'Loading a mid-transaction save restored a renderer ghost transaction.');
    // Entering register mode deliberately initializes the persistent opening
    // drawer float. The fixture's pre-customer snapshot predates that lazy init,
    // while the saved slot correctly contains it. Preserve that exact initialized
    // drawer and require every sale/stock field to return to its pre-customer value.
    const recoveredExpected = {
      ...saveFixture.before.books,
      drawer: preSave.books.drawer,
    };
    assert(same(afterFirstLoad.books, recoveredExpected),
      `First load did not return the held product exactly once.\n`
        + `expected ${JSON.stringify(recoveredExpected)}\nafter ${JSON.stringify(afterFirstLoad.books)}`);
    const firstLoadShot = await shot('first-load-held-unit-restored-no-ghost-sale');
    await loadSlotOne(page);
    const afterSecondLoad = await snapshot(page, saveSkus);
    assert(same(afterSecondLoad.books, afterFirstLoad.books),
      'Loading the same mid-transaction save twice duplicated or deleted money/stock/history.');
    assert(!afterSecondLoad.active && !afterSecondLoad.hasTx,
      'Second load created a register lock or ghost transaction.');
    const secondLoadShot = await shot('second-load-idempotent');
    saveTrace.push({ action: 'pause menu Save game > Slot 1 > Save here', evidence: saveShot });
    saveTrace.push({ action: 'pause menu Load game > Slot 1 > Load, twice',
      heldInSavedRuntime: preSave.books.held,
      afterFirstLoad: afterFirstLoad.books,
      afterSecondLoad: afterSecondLoad.books,
      evidence: [firstLoadShot, secondLoadShot] });
    scenarios.saveReload = { ok: true, products: saveSkus,
      beforeCustomer: saveFixture.before, preSave, afterFirstLoad, afterSecondLoad,
      trace: saveTrace };

    // CUSTOMER TIMEOUT: a short deterministic patience value is fixture setup, then
    // the real customer update loop performs the timeout and shelf return unaided.
    currentScenario = 'customer timeout';
    shotNo = 0;
    await boot(page);
    await installReadOnlyProbe(page);
    const timeoutSkus = ['tees1'];
    const timeoutFixture = await prepareFixture(page, timeoutSkus, 'cash', 1.25);
    const timeoutReady = await waitForTransactionReady(page, timeoutSkus, timeoutFixture.name);
    const timeoutWaitingShot = await shot('customer-waiting-with-short-patience-fixture');
    await page.waitForFunction((customerName) => {
      const ch = window.__fw.scene3d.clubhouse();
      const customer = (Array.isArray(ch.customers) ? ch.customers : ch.customers()).find((entry) => entry.name === customerName);
      return !ch.register.hasTx() && (!customer
        || customer.checkoutPhase === 'leaving' || customer.checkoutPhase === 'complete');
    }, timeoutFixture.name, { timeout: 8000 });
    await page.waitForTimeout(250);
    const timeoutFinal = await snapshot(page, timeoutSkus, timeoutFixture.name);
    assert(!timeoutFinal.active && !timeoutFinal.hasTx,
      'Timed-out customer left a register lock or ghost transaction.');
    const timeoutExpected = {
      ...timeoutFixture.before.books,
      drawer: timeoutReady.books.drawer,
    };
    assert(same(timeoutFinal.books, timeoutExpected),
      `Customer timeout did not return held inventory exactly once or changed the books.\n`
        + `expected ${JSON.stringify(timeoutExpected)}\nactual ${JSON.stringify(timeoutFinal.books)}`);
    const timeoutFinalShot = await shot('customer-timeout-stock-returned-clean-counter');
    scenarios.customerTimeout = {
      ok: true,
      fixturePatienceSeconds: 1.25,
      customer: timeoutFixture.name,
      beforeCustomer: timeoutFixture.before,
      waiting: timeoutReady,
      final: timeoutFinal,
      evidence: [timeoutWaitingShot, timeoutFinalShot],
    };

    assert(errors.length === 0, `Recovery QA observed ${errors.length} console/page error(s): ${errors.join(' | ')}`);
    assert(failedRequests.length === 0,
      `Recovery QA observed ${failedRequests.length} non-aborted failed request(s): ${failedRequests.join(' | ')}`);
    return saveResult({
      ok: true,
      viewport: VIEWPORT,
      evidenceDirectory: out,
      command: 'node tools/qa/run-playwright.cjs tools/qa/register-recovery.js --bootstrap',
      fixtureBoundary: 'sendToCounter, inventory/time/weather normalization, and timeout patience only; every checkout, pause-menu save, and load action after setup uses Playwright mouse/keyboard controls.',
      fixtureCapabilities: {
        deterministicCardDecline: false,
        note: 'The public sendToCounter fixture selects card or cash but exposes no authorization-outcome override; any seeded natural decline is retried and recorded through the physical reader.',
      },
      scenarios,
      diagnostics: {
        errors,
        warnings: warnings.slice(0, 40),
        failedRequests,
      },
    });
  } catch (error) {
    const safe = currentScenario.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64);
    const blocker = `99-blocker-${safe || 'unknown'}.png`;
    await page.screenshot({ path: path.join(out, blocker) }).catch(() => {});
    const live = await page.evaluate(() => {
      if (!window.__qaRecovery) return null;
      try { return window.__qaRecovery.snapshot([], null); } catch (probeError) {
        return { probeError: probeError.message };
      }
    }).catch((probeError) => ({ probeError: probeError.message }));
    return saveResult({
      ok: false,
      viewport: VIEWPORT,
      evidenceDirectory: out,
      command: 'node tools/qa/run-playwright.cjs tools/qa/register-recovery.js --bootstrap',
      fixtureCapabilities: {
        deterministicCardDecline: false,
        note: 'The public sendToCounter fixture exposes payment method only, not a card authorization outcome.',
      },
      blocker: { scenario: currentScenario, message: error.message, evidence: blocker, live },
      scenarios,
      diagnostics: {
        errors: errors.slice(0, 40),
        warnings: warnings.slice(0, 40),
        failedRequests: failedRequests.slice(0, 40),
      },
    });
  }
}

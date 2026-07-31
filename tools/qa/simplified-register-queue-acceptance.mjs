import fs from 'node:fs';
import path from 'node:path';

import {
  captureCashierBuildSnapshot,
  finalizeCashierQaResult,
} from './cashier-build-snapshot.mjs';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
const DEFAULT_VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const FIRST_SKUS = Object.freeze(['tees1', 'marker1']);
const SECOND_SKUS = Object.freeze(['glove1']);
let VIEWPORT = { ...DEFAULT_VIEWPORT };

function assert(value, message) {
  if (!value) throw new Error(message);
}

function configureViewport(value) {
  const raw = String(value || '').trim().toLowerCase().replace('×', 'x');
  if (!raw) {
    VIEWPORT = { ...DEFAULT_VIEWPORT };
    return `${VIEWPORT.width}x${VIEWPORT.height}`;
  }
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(raw);
  if (!match) throw new Error(`Invalid QA viewport "${value}". Use WIDTHxHEIGHT.`);
  VIEWPORT = { width: Number(match[1]), height: Number(match[2]) };
  assert(VIEWPORT.width >= 640 && VIEWPORT.height >= 360,
    `QA viewport ${raw} is too small for the checkout route.`);
  return `${VIEWPORT.width}x${VIEWPORT.height}`;
}

async function boot(page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(BASE_URL);
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

async function setupFixture(page) {
  return page.evaluate(([firstSkus, secondSkus]) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    const skuIds = [...firstSkus, ...secondSkus];
    for (const id of skuIds) {
      const inventory = app.state.shop.inventory[id];
      inventory.shelf = Math.max(inventory.shelf, 12);
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
      cash: app.state.cash,
      shelf: Object.fromEntries(skuIds.map((id) => [id, shop.inventory[id].shelf])),
    };

    const off = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 + off.x;
    walk.z = 5.10 + off.z;
    walk.yaw = 0;
    walk.pitch = -0.18;

    const customerList = () => (typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : clubhouse.customers);
    const firstName = clubhouse.sendToCounter(firstSkus, 'card');
    const first = customerList()[customerList().length - 1];
    if (first) first.__queueQaRole = 'first';
    return {
      before,
      first: first && {
        name: firstName,
        fullName: first.fullName || first.name,
        customerId: first.customerId,
        skus: [...firstSkus],
      },
      second: null,
    };
  }, [FIRST_SKUS, SECOND_SKUS]);
}

async function addSecondFixtureCustomer(page) {
  return page.evaluate((secondSkus) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customerList = () => (typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : clubhouse.customers);
    const secondName = clubhouse.sendToCounter(secondSkus, 'cash');
    const second = customerList()[customerList().length - 1];
    if (!second) return null;
    second.__queueQaRole = 'second';
    return {
      name: secondName,
      fullName: second.fullName || second.name,
      customerId: second.customerId,
      skus: [...secondSkus],
    };
  }, SECOND_SKUS);
}

async function inspectQueue(page) {
  return page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const register = clubhouse.register;
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : clubhouse.customers;
    const queue = clubhouse.checkoutQueue();
    const tx = register.getTx();
    const owner = register.getCustomer();
    const describe = (customer) => customer ? {
      role: customer.__queueQaRole || null,
      customerId: customer.customerId,
      fullName: customer.fullName || customer.name,
      queued: !!customer.queued,
      queueIndex: customer.queued
        ? queue.findIndex((entry) => entry.customerId === customer.customerId)
        : -1,
      awaitingCheckout: !!customer.awaitingCheckout,
      checkoutPhase: customer.checkoutPhase,
      bought: !!customer.bought,
      cart: (customer.cart || []).length,
      hasTx: !!customer.tx,
      txNumber: customer.tx?.number || null,
      txStage: customer.tx?.stage || null,
    } : null;
    const first = customers.find((customer) => customer.__queueQaRole === 'first');
    const second = customers.find((customer) => customer.__queueQaRole === 'second');
    const txHolders = customers.filter((customer) => customer.tx).map(describe);
    return {
      active: register.isActive(),
      workspace: register.workspace(),
      tx: tx ? {
        number: tx.number,
        stage: tx.stage,
        method: tx.method,
        prefer: tx.prefer,
        items: tx.items.map((item) => ({
          uid: item.uid,
          skuId: item.skuId,
          scanned: !!item.scanned,
          staged: !!item.staged,
        })),
      } : null,
      owner: describe(owner),
      first: describe(first),
      second: describe(second),
      txHolders,
      queue: queue.map((entry) => ({
        customerId: entry.customerId,
        fullName: entry.fullName,
        phase: entry.phase,
        awaitingCheckout: entry.awaitingCheckout,
      })),
      queueRoles: queue.map((entry) => (
        customers.find((customer) => customer.customerId === entry.customerId)?.__queueQaRole || null
      )),
      held: (app.state.shop.held || []).length,
      units: (app.state.shop.salesLive || {}).units || 0,
      history: (app.state.shop.transactionHistory || []).length,
    };
  });
}

async function installOwnershipProbe(page) {
  await page.evaluate(() => {
    if (window.__queueQaOwnership?.timer) clearInterval(window.__queueQaOwnership.timer);
    const probe = {
      transitions: [],
      violations: [],
      lastKey: null,
      timer: null,
    };
    const record = () => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      if (!clubhouse) return;
      const register = clubhouse.register;
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers()
        : clubhouse.customers;
      const queue = clubhouse.checkoutQueue();
      const tx = register.getTx();
      const owner = register.getCustomer();
      const holders = customers.filter((customer) => customer.tx);
      const ownerRole = owner?.__queueQaRole || null;
      const holderRoles = holders.map((customer) => customer.__queueQaRole || customer.customerId || 'unknown');
      const headId = queue[0]?.customerId || null;
      const violation = holders.length > 1
        ? `multiple transaction holders: ${holderRoles.join(',')}`
        : tx && !owner
          ? 'register has a transaction without a customer owner'
          : !tx && owner
            ? `register retains owner ${ownerRole || owner.customerId} without a transaction`
            : tx && holders.length !== 1
              ? `register transaction ${tx.number} has ${holders.length} customer transaction holders`
              : tx && holders[0] !== owner
                ? `register owner and customer transaction holder differ for ${tx.number}`
                : tx && owner && headId !== owner.customerId
                  ? `transaction owner ${owner.customerId} is not queue head ${headId}`
                  : null;
      if (violation && !probe.violations.includes(violation)) probe.violations.push(violation);
      const sample = {
        atMs: Math.round(performance.now()),
        txNumber: tx?.number || null,
        stage: tx?.stage || null,
        ownerRole,
        ownerCustomerId: owner?.customerId || null,
        holderRoles,
        queueRoles: queue.map((entry) => (
          customers.find((customer) => customer.customerId === entry.customerId)?.__queueQaRole || null
        )),
      };
      const key = JSON.stringify({
        txNumber: sample.txNumber,
        stage: sample.stage,
        ownerRole: sample.ownerRole,
        holderRoles: sample.holderRoles,
        queueRoles: sample.queueRoles,
      });
      if (key !== probe.lastKey) {
        probe.lastKey = key;
        probe.transitions.push(sample);
      }
    };
    record();
    probe.timer = setInterval(record, 50);
    window.__queueQaOwnership = probe;
  });
}

async function stopOwnershipProbe(page) {
  return page.evaluate(() => {
    const probe = window.__queueQaOwnership;
    if (!probe) return { transitions: [], violations: [] };
    if (probe.timer) clearInterval(probe.timer);
    probe.timer = null;
    return {
      transitions: [...probe.transitions],
      violations: [...probe.violations],
    };
  }).catch(() => ({ transitions: [], violations: ['ownership probe could not be read'] }));
}

async function waitCamera(page, workspace) {
  await page.evaluate(() => { window.__queueQaCameraProbe = null; });
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
    const old = window.__queueQaCameraProbe;
    if (!old) {
      window.__queueQaCameraProbe = { ...now, stable: 0 };
      return false;
    }
    const delta = Math.max(
      Math.abs(now.x - old.x), Math.abs(now.y - old.y), Math.abs(now.z - old.z),
      Math.abs(now.qx - old.qx), Math.abs(now.qy - old.qy),
      Math.abs(now.qz - old.qz), Math.abs(now.qw - old.qw),
      Math.abs(now.fov - old.fov),
    );
    const stable = delta < 0.0008 ? old.stable + 1 : 0;
    window.__queueQaCameraProbe = { ...now, stable };
    return stable >= 4;
  }, workspace, { timeout: 12000, polling: 80 });
}

async function exitFrontDesk(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const active = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.isActive()
    ));
    if (!active) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
  }
  const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
  assert(!active, 'Escape did not release the reset front desk after four normal back-out inputs.');
}

async function projectObject(page, predicate) {
  return page.evaluate(async (query) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((object) => {
      if (found || !object.visible || !object.userData) return;
      if (query.kind && object.userData.kind !== query.kind) return;
      if (query.uid && object.userData.uid !== query.uid) return;
      found = object;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = bounds.isEmpty()
      ? found.getWorldPosition(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3());
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, predicate);
}

async function clickDiagnostic(page, x, y) {
  return page.evaluate(async (point) => {
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
      .map((hit) => ({
        name: hit.object.name || '(unnamed)',
        kind: hit.object.userData.kind || null,
        uid: hit.object.userData.uid || null,
        distance: Math.round(hit.distance * 100) / 100,
      }));
  }, { x, y });
}

async function scanCurrentTransaction(page) {
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    return register.isActive() && register.workspace() === 'scan'
      && tx && tx.stage === 'scanning' && tx.items.some((item) => !item.scanned);
  }, null, { timeout: 12000 });
  await waitCamera(page, 'scan');
  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
  ));
  for (const uid of uids) {
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
    assert(product?.inView, `Product ${uid} is outside the scan camera.`);
    await page.mouse.click(product.x, product.y);
    await page.waitForFunction((wantedUid) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.items.find((item) => item.uid === wantedUid)?.scanned;
    }, uid, { timeout: 5000 }).catch(async (error) => {
      const hits = await clickDiagnostic(page, product.x, product.y);
      throw new Error(`${error.message} - click hit ${JSON.stringify(hits)}`);
    });
    await page.waitForFunction((wantedUid) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.items.find((item) => item.uid === wantedUid)?.staged;
    }, uid, { timeout: 8000 });
    await page.waitForTimeout(220);
  }
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.every((item) => item.scanned && item.staged);
  }, null, { timeout: 5000 });
}

async function clickMonitorAction(page, action, workspace) {
  await page.waitForFunction(([id, wantedWorkspace]) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.monitorScreenPoint(id);
    return register.workspace() === wantedWorkspace && point && point.inView;
  }, [action, workspace], { timeout: 10000 });
  const point = await page.evaluate((id) => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
  ), action);
  assert(point?.inView, `Monitor action ${action} is outside the ${workspace} camera.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(180);
}

async function completeCard(page) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-ready' && tx.checkoutFlow?.state === 'CardInsertReady';
  }, null, { timeout: 9000 });
  await waitCamera(page, 'card');
  const card = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  assert(card?.inView, `The first customer's card is outside the handoff camera: ${JSON.stringify(card)}.`);
  await page.mouse.click(card.x, card.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-entry';
  }, null, { timeout: 5000 });
  const entry = await page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      totalCents: Math.round(register.totalOf(tx) * 100),
      enteredCents: Number(tx.cardEntryCents),
      digits: String(tx.cardEntryDigits || ''),
    };
  });
  assert(entry.enteredCents === 0 && entry.digits === '',
    `Card insertion did not open an empty amount field: ${JSON.stringify(entry)}.`);
  for (const digit of String(entry.totalCents)) {
    const point = await page.evaluate((key) => (
      window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint(key)
    ), digit);
    assert(point?.inView, `Card keypad digit ${digit} is outside the fixed reader camera.`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(100);
  }
  await page.waitForFunction((expectedCents) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.cardEntryCents === expectedCents
      && tx.cardEntryDigits === String(expectedCents) && tx.cardEntryError == null;
  }, entry.totalCents, { timeout: 2500 });
  const ok = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint('OK')
  ));
  assert(ok?.inView, 'The card Confirm key is outside the fixed reader camera.');
  await page.mouse.click(ok.x, ok.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'receipt' && tx.cardResult === 'approved' && tx.cardAttempts === 1;
  }, null, { timeout: 9000 });
}

async function completeExactCash(page) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'cash-tender';
  }, null, { timeout: 9000 });
  const facts = await page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      total: register.cashTotalOf(tx),
      tendered: register.stackTotal(tx.tendered),
      change: register.changeDue(tx),
    };
  });
  assert(facts.total === 5 && facts.tendered === 5 && facts.change === 0,
    `The deterministic exact-cash fixture is invalid: ${JSON.stringify(facts)}.`);
  const cash = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  assert(cash?.inView, 'The second customer\'s exact cash is not visible.');
  await page.mouse.click(cash.x, cash.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'cash-drawer' && tx.drawerOpen && tx.deposited;
  }, null, { timeout: 10000 });
  await waitCamera(page, 'cash');
  const giving = await page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return register.changeGivingState(tx);
  });
  assert(giving.state === 'exact' && giving.requiredCents === 0 && giving.givingCents === 0,
    `Zero change was not exact: ${JSON.stringify(giving)}.`);
  await clickMonitorAction(page, 'confirm-change', 'cash');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && ['receipt', 'bagging', 'done'].includes(tx.stage)
      && !tx.drawerOpen && tx.changeGiven === 0;
  }, null, { timeout: 6000 });
}

async function finalSnapshot(page, fixture) {
  return page.evaluate((fixtureIds) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const shop = app.state.shop;
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : clubhouse.customers;
    const customer = (id) => customers.find((entry) => entry.customerId === id);
    const describe = (entry) => entry ? {
      customerId: entry.customerId,
      fullName: entry.fullName || entry.name,
      bought: !!entry.bought,
      cart: (entry.cart || []).length,
      queued: !!entry.queued,
      phase: entry.checkoutPhase,
      hasTx: !!entry.tx,
    } : null;
    return {
      active: clubhouse.register.isActive(),
      workspace: clubhouse.register.workspace(),
      tx: clubhouse.register.getTx(),
      owner: clubhouse.register.getCustomer()?.customerId || null,
      queue: clubhouse.checkoutQueue(),
      txHolderIds: customers.filter((entry) => entry.tx).map((entry) => entry.customerId),
      first: describe(customer(fixtureIds.first)),
      second: describe(customer(fixtureIds.second)),
      units: (shop.salesLive || {}).units || 0,
      revenue: (shop.salesLive || {}).revenue || 0,
      held: (shop.held || []).length,
      history: (shop.transactionHistory || []).length,
      tickets: (shop.transactionHistory || []).slice(0, 2),
      shelf: Object.fromEntries(fixtureIds.skus
        .map((id) => [id, shop.inventory[id].shelf])),
      cash: app.state.cash,
    };
  }, {
    first: fixture.first.customerId,
    second: fixture.second.customerId,
    skus: [...FIRST_SKUS, ...SECOND_SKUS],
  });
}

export async function runSimplifiedRegisterQueueAcceptance(page, options = {}) {
  const viewport = configureViewport(options.viewport
    || process.env.REGISTER_QA_VIEWPORT
    || process.env.QA_VIEWPORT);
  const root = path.resolve(process.env.REGISTER_QA_ROOT || 'qa/cashier_master_final/queue');
  fs.mkdirSync(root, { recursive: true });
  const productionBuildBefore = captureCashierBuildSnapshot();

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));

  const evidence = [];
  const checkpoints = [];
  const shot = async (name, label) => {
    const output = path.join(root, name);
    await page.screenshot({ path: output });
    evidence.push(output);
    if (label) checkpoints.push({ label, screenshot: output, state: await inspectQueue(page) });
  };

  let fixture = null;
  let ownership = { transitions: [], violations: [] };
  try {
    await boot(page);
    fixture = await setupFixture(page);
    assert(fixture.first, 'Could not seed the first deterministic retail customer.');
    await page.waitForFunction((firstId) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      return clubhouse.checkoutQueue()[0]?.customerId === firstId
        && clubhouse.register.getCustomer()?.customerId === firstId
        && clubhouse.register.getTx()?.items.length === 2;
    }, fixture.first.customerId, { timeout: 20000 });
    await installOwnershipProbe(page);
    fixture.second = await addSecondFixtureCustomer(page);
    assert(fixture.second, 'Could not seed the second deterministic retail customer.');
    assert(fixture.first.customerId !== fixture.second.customerId,
      'The two-customer fixture reused one customer identity.');

    await page.waitForFunction(([firstId, secondId]) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const queue = clubhouse.checkoutQueue();
      const owner = clubhouse.register.getCustomer();
      const tx = clubhouse.register.getTx();
      return queue.length === 2
        && queue[0].customerId === firstId
        && queue[1].customerId === secondId
        && owner?.customerId === firstId
        && tx?.items.length === 2;
    }, [fixture.first.customerId, fixture.second.customerId], { timeout: 20000 });
    const queued = await inspectQueue(page);
    assert(queued.queueRoles.join(',') === 'first,second',
      `The seeded queue order is wrong: ${JSON.stringify(queued.queueRoles)}.`);
    assert(queued.txHolders.length === 1 && queued.owner?.role === 'first'
      && !queued.second?.hasTx,
    `The first transaction ownership is not exclusive: ${JSON.stringify(queued)}.`);
    await shot('01-two-customer-queue-first-owner.png', 'two customers queued; first owns the only transaction');

    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
      { timeout: 5000 });
    await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const tx = clubhouse.register.getTx();
      const owner = clubhouse.register.getCustomer();
      if (owner?.__queueQaRole !== 'first') throw new Error('Cannot seed card RNG: first customer is not owner.');
      tx.rng = () => 0.99;
    });
    await scanCurrentTransaction(page);
    await completeCard(page);
    await shot('02-first-card-approved.png', 'first customer card approved through physical controls');
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'done'
    ), null, { timeout: 10000 });
    await shot('03-first-receipt-bag-handoff.png', 'first customer owns receipt and bag before banking');
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
      { timeout: 14000 });
    const reset = await inspectQueue(page);
    assert(!reset.tx && !reset.owner && reset.txHolders.length === 0,
      `The register did not expose a clean between-sale reset: ${JSON.stringify(reset)}.`);
    assert(reset.first?.bought && reset.first.cart === 0 && !reset.first.queued,
      `The first customer did not leave with a settled order: ${JSON.stringify(reset.first)}.`);
    assert(reset.queueRoles[0] === 'second' && reset.second?.queueIndex === 0,
      `The second customer did not advance to queue head: ${JSON.stringify(reset)}.`);
    await shot('04-first-leaving-register-reset.png', 'first leaving; no transaction owner; second at queue head');

    await page.waitForFunction((secondId) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      return clubhouse.register.getCustomer()?.customerId === secondId
        && clubhouse.register.getTx()?.items.length === 1;
    }, fixture.second.customerId, { timeout: 15000 });
    await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const tx = clubhouse.register.getTx();
      const owner = clubhouse.register.getCustomer();
      if (owner?.__queueQaRole !== 'second') throw new Error('Cannot seed exact cash: second customer is not owner.');
      tx.items[0].price = 5;
      tx.items[0].priceCents = 500;
      tx.rng = () => 0.99;
    });
    await waitCamera(page, 'scan');
    const advanced = await inspectQueue(page);
    assert(advanced.owner?.role === 'second' && advanced.txHolders.length === 1
      && !advanced.first?.hasTx && advanced.tx?.prefer === 'cash',
    `Second-customer ownership is not exclusive: ${JSON.stringify(advanced)}.`);
    await shot('05-second-customer-advanced-exclusive-owner.png', 'second advanced and owns a fresh cash transaction');
    await scanCurrentTransaction(page);
    await completeExactCash(page);
    await shot('06-second-exact-cash-drawer.png', 'second customer exact cash accepted and drawer balanced');
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'done'
    ), null, { timeout: 10000 });
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
      { timeout: 14000 });
    await shot('07-second-complete-queue-empty.png', 'second sale complete and queue empty');

    // A transaction clears before the paid customer necessarily finishes the
    // authored bag/departure animation. Prove the reusable in-register reset
    // only after both seeded QA customers have left the clubhouse runtime.
    await page.waitForFunction(([firstId, secondId]) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const register = clubhouse.register;
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers()
        : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
      return register.isActive()
        && !register.getTx()
        && !register.getCustomer()
        && clubhouse.checkoutQueue().length === 0
        && !customers.some((customer) => (
          customer.customerId === firstId || customer.customerId === secondId
        ));
    }, [fixture.first.customerId, fixture.second.customerId], { timeout: 20000 });
    await shot('07b-register-reset-empty.png',
      'in-register reset; no transaction, owner, queue, or seeded customer remains');

    await exitFrontDesk(page);
    await shot('08-front-desk-released-after-queue.png', 'normal Escape releases the reset front desk');

    ownership = await stopOwnershipProbe(page);
    const final = await finalSnapshot(page, fixture);
    const nonAborted = failedRequests.filter((request) => (
      !/ERR_ABORTED|NS_BINDING_ABORTED/i.test(request.error)
    ));
    const tickets = final.tickets;
    const firstTicket = tickets.find((ticket) => ticket.customerId === fixture.first.customerId);
    const secondTicket = tickets.find((ticket) => ticket.customerId === fixture.second.customerId);
    assert(final.units === fixture.before.units + 3,
      `Expected exactly three banked units, got ${final.units - fixture.before.units}.`);
    assert(final.history === fixture.before.history + 2,
      `Expected exactly two new tickets, got ${final.history - fixture.before.history}.`);
    assert(final.held === fixture.before.held,
      `Held inventory did not return to baseline (${fixture.before.held} -> ${final.held}).`);
    assert(firstTicket?.method === 'card' && firstTicket.items.length === 2,
      `The first exact-once card ticket is missing: ${JSON.stringify(tickets)}.`);
    assert(secondTicket?.method === 'cash' && secondTicket.items.length === 1
      && secondTicket.total === 5 && secondTicket.tendered === 5 && secondTicket.changeGiven === 0,
    `The second exact-cash ticket is invalid: ${JSON.stringify(secondTicket)}.`);
    assert(secondTicket.number === firstTicket.number + 1,
      `Ticket numbers did not advance once per owner: ${firstTicket.number}, ${secondTicket.number}.`);
    const ticketRevenueCents = tickets.reduce((sum, ticket) => sum + Math.round(ticket.total * 100), 0);
    assert(Math.round((final.revenue - fixture.before.revenue) * 100) === ticketRevenueCents,
      'Live revenue does not equal the two newly banked tickets.');
    for (const skuId of [...FIRST_SKUS, ...SECOND_SKUS]) {
      assert(final.shelf[skuId] === fixture.before.shelf[skuId] - 1,
        `${skuId} shelf stock did not decrement exactly once.`);
    }
    // Both customers should have crossed the exit despawn marker before the
    // reset checkpoint. Absence is a successful departure; retain the settled
    // invariants as a fail-closed guard if a wrapper still exposes either one.
    assert(!final.first || (final.first.bought && final.first.cart === 0
      && !final.first.queued && !final.first.hasTx),
    `First customer ownership was not released: ${JSON.stringify(final.first)}.`);
    assert(!final.second || (final.second.bought && final.second.cart === 0
      && !final.second.queued && !final.second.hasTx),
      `Second customer ownership was not released: ${JSON.stringify(final.second)}.`);
    assert(final.queue.length === 0 && final.tx === null && final.owner === null
      && final.txHolderIds.length === 0 && !final.active,
    `The front desk did not finish empty and released: ${JSON.stringify(final)}.`);
    assert(ownership.violations.length === 0,
      `The continuous ownership probe found overlap: ${ownership.violations.join(' | ')}.`);
    const ownerSequence = ownership.transitions
      .map((sample) => sample.ownerRole)
      .filter(Boolean)
      .filter((role, index, roles) => index === 0 || role !== roles[index - 1]);
    assert(JSON.stringify(ownerSequence) === JSON.stringify(['first', 'second']),
      `Transaction ownership did not advance first -> second exactly once: ${JSON.stringify(ownerSequence)}.`);
    assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
    assert(nonAborted.length === 0,
      `Non-aborted request failures: ${JSON.stringify(nonAborted)}.`);

    let result = {
      ok: true,
      viewport,
      fixture,
      checkpoints,
      final,
      ownership: { ...ownership, ownerSequence },
      evidence,
      console: {
        errors: consoleErrors,
        warnings: consoleWarnings,
        pageErrors,
        failedRequests,
        nonAbortedFailedRequests: nonAborted,
      },
    };
    result = finalizeCashierQaResult({
      result,
      beforeSnapshot: productionBuildBefore,
      evidencePngs: evidence,
      evidenceRoot: root,
    });
    fs.writeFileSync(path.join(root, 'latest-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    ownership = await stopOwnershipProbe(page);
    const failureShot = path.join(root, 'failure.png');
    await page.screenshot({ path: failureShot }).catch(() => {});
    let result = {
      ok: false,
      viewport,
      blocker: { message: error?.message || String(error), stack: error?.stack || null },
      fixture,
      checkpoints,
      ownership,
      evidence: [...evidence, failureShot],
      console: { errors: consoleErrors, warnings: consoleWarnings, pageErrors, failedRequests },
    };
    result = finalizeCashierQaResult({
      result,
      beforeSnapshot: productionBuildBefore,
      evidencePngs: [...evidence, failureShot],
      evidenceRoot: root,
    });
    fs.writeFileSync(path.join(root, 'latest-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
}

import fs from 'node:fs';
import path from 'node:path';

import {
  captureCashierBuildSnapshot,
  finalizeCashierQaResult,
} from './cashier-build-snapshot.mjs';
const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
const VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const DEFAULT_ROOT = 'qa/cashier_master_final/save_reload';
const AUTOSAVE_KEY = 'golfempire:autosave';
const QA_CHECKPOINT_KEY = 'golfempire:qa:save-reload-checkpoint';

// Selection:
//   REGISTER_QA_QUICK=1
//   REGISTER_QA_QUICK_CASES=mid-scan,completed-card
//   REGISTER_QA_CASES=customer-waiting,completed-cash  (highest precedence)

const matrixCase = (definition) => Object.freeze({
  ...definition,
  skuIds: Object.freeze([...definition.skuIds]),
  flowStates: Object.freeze([...(definition.flowStates || [])]),
});

// Keep this metadata browser-free so node:test can validate matrix coverage and
// selection without launching Chromium. The setup verbs are joined by id below.
export const SAVE_RELOAD_MATRIX = Object.freeze([
  matrixCase({
    id: 'customer-waiting', outputKey: 'customerWaiting', kind: 'rollback',
    payment: 'card', skuIds: ['tees1', 'marker1'], evidenceDir: 'customer_waiting',
    flowStates: ['WaitingForCashier'], stage: 'scanning', active: false,
  }),
  matrixCase({
    id: 'products-staged-before-scanning', outputKey: 'productsStagedBeforeScanning', kind: 'rollback',
    payment: 'card', skuIds: ['tees1', 'marker1'], evidenceDir: 'products_staged',
    flowStates: ['WaitingForScan'], stage: 'scanning', active: true, workspace: 'scan',
  }),
  matrixCase({
    id: 'mid-scan', outputKey: 'midScan', kind: 'rollback',
    payment: 'card', skuIds: ['tees1', 'marker1'], evidenceDir: 'mid_scan',
    flowStates: ['WaitingForScan'], stage: 'scanning', active: true, workspace: 'scan',
  }),
  matrixCase({
    id: 'all-scanned-payment-choice', outputKey: 'allScannedPaymentChoice', kind: 'rollback',
    payment: 'card', skuIds: ['tees1', 'marker1'], evidenceDir: 'payment_choice',
    flowStates: ['AllProductsScanned'], stage: 'scanning', active: true,
  }),
  matrixCase({
    id: 'card-presented', outputKey: 'cardPresented', kind: 'rollback',
    payment: 'card', skuIds: ['glove1'], evidenceDir: 'card_presented',
    flowStates: ['CardAmountEntry'], stage: 'card-entry', active: true, workspace: 'card',
  }),
  matrixCase({
    id: 'post-x-cancellation', outputKey: 'postXCancellation', kind: 'rollback',
    payment: 'card', skuIds: ['glove1'], evidenceDir: 'card_decline',
    flowStates: ['AllProductsScanned'], stage: 'scanning', active: true, workspace: 'monitor',
  }),
  matrixCase({
    id: 'card-declined', outputKey: 'cardDeclined', kind: 'rollback',
    payment: 'card', skuIds: ['glove1'], evidenceDir: 'card_decline',
    flowStates: ['CardDeclined'], stage: 'card-declined', active: true, workspace: 'card',
  }),
  matrixCase({
    id: 'cash-presented', outputKey: 'cashPresented', kind: 'rollback',
    payment: 'cash', skuIds: ['tees1'], evidenceDir: 'cash_presented',
    flowStates: ['CashPresented'], stage: 'cash-tender', active: true, workspace: 'monitor',
  }),
  matrixCase({
    id: 'drawer-open', outputKey: 'drawerOpen', kind: 'rollback',
    payment: 'cash', skuIds: ['tees1'], evidenceDir: 'cash_change',
    flowStates: ['DrawerOpening', 'DepositingCash'], stage: 'cash-drawer',
    active: true, workspace: 'cash',
  }),
  matrixCase({
    id: 'cash-deposited', outputKey: 'cashDeposited', kind: 'rollback',
    payment: 'cash', skuIds: ['tees1'], evidenceDir: 'cash_change',
    flowStates: ['SelectingChange'], stage: 'cash-drawer', active: true, workspace: 'cash',
  }),
  matrixCase({
    id: 'change-selected', outputKey: 'changeSelected', kind: 'rollback',
    payment: 'cash', skuIds: ['tees1'], evidenceDir: 'cash_change',
    flowStates: ['SelectingChange'], stage: 'cash-drawer', active: true, workspace: 'cash',
  }),
  matrixCase({
    id: 'receipt-printing', outputKey: 'receiptPrinting', kind: 'rollback',
    payment: 'card', skuIds: ['marker1'], evidenceDir: 'receipt_handoff',
    flowStates: ['ReceiptPrinting'], stage: 'receipt', active: true, workspace: 'monitor',
  }),
  matrixCase({
    id: 'completed-card', outputKey: 'completedCard', kind: 'completed',
    payment: 'card', skuIds: ['glove1'], evidenceDir: 'completed_sale',
    flowStates: [], stage: null,
  }),
  matrixCase({
    id: 'completed-cash', outputKey: 'completedCash', kind: 'completed',
    payment: 'cash', skuIds: ['tees1'], evidenceDir: 'completed_cash',
    flowStates: [], stage: null,
  }),
]);

export const DEFAULT_QUICK_CASE_IDS = Object.freeze([
  'mid-scan',
  'card-declined',
  'change-selected',
  'completed-card',
]);

const CASE_ALIASES = Object.freeze({
  mid_scan: 'mid-scan',
  card_decline: 'card-declined',
  cash_change: 'change-selected',
  receipt_handoff: 'receipt-printing',
  completed_sale: 'completed-card',
});

function selectedNames(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(',');
}

export function resolveSaveReloadCaseIds({ quick = false, cases = null, quickCases = null } = {}) {
  const allIds = SAVE_RELOAD_MATRIX.map((entry) => entry.id);
  const requested = cases != null && selectedNames(cases).some((entry) => entry.trim())
    ? selectedNames(cases)
    : quick
      ? (quickCases != null && selectedNames(quickCases).some((entry) => entry.trim())
        ? selectedNames(quickCases)
        : DEFAULT_QUICK_CASE_IDS)
      : allIds;
  const normalized = [...new Set(requested
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .map((entry) => CASE_ALIASES[entry] || entry))];
  const unknown = normalized.filter((entry) => !allIds.includes(entry));
  if (unknown.length) {
    throw new Error(`Unknown register save/reload case(s): ${unknown.join(', ')}. Valid cases: ${allIds.join(', ')}.`);
  }
  return normalized;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function waitForGame(page) {
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(850);
  const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null,
    { timeout: 40000 });
  // Random shoppers make a repeated-load comparison nondeterministic. Disable
  // only their renderer spawn loop as soon as the production clubhouse exists;
  // each table row still establishes its customer through the documented fixture.
  await page.evaluate(() => window.__fw.scene3d.clubhouse().setOrganicWalkins(false));
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none'
      || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1050);
}

async function boot(page) {
  await page.goto(BASE_URL);
  await waitForGame(page);
}

async function reloadFromAutosave(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForGame(page);
}

async function reloadExactCheckpoint(page) {
  await page.evaluate(([autosaveKey, checkpointKey]) => {
    const checkpoint = sessionStorage.getItem(checkpointKey);
    if (!checkpoint) throw new Error(`Missing QA checkpoint ${checkpointKey}.`);
    localStorage.setItem(autosaveKey, checkpoint);
  }, [AUTOSAVE_KEY, QA_CHECKPOINT_KEY]);
  await reloadFromAutosave(page);
}

async function waitCamera(page, workspace, timeout = 12000) {
  await page.evaluate(() => { window.__checkoutSaveReloadCameraProbe = null; });
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
    const prior = window.__checkoutSaveReloadCameraProbe;
    if (!prior) {
      window.__checkoutSaveReloadCameraProbe = { ...now, stable: 0 };
      return false;
    }
    const delta = Math.max(
      Math.abs(now.x - prior.x), Math.abs(now.y - prior.y), Math.abs(now.z - prior.z),
      Math.abs(now.qx - prior.qx), Math.abs(now.qy - prior.qy),
      Math.abs(now.qz - prior.qz), Math.abs(now.qw - prior.qw),
      Math.abs(now.fov - prior.fov),
    );
    const stable = delta < 0.0008 ? prior.stable + 1 : 0;
    window.__checkoutSaveReloadCameraProbe = { ...now, stable };
    return stable >= 4;
  }, workspace, { timeout, polling: 80 });
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
      if (query.name && object.name !== query.name) return;
      if (query.pick !== undefined && !!data.pick !== !!query.pick) return;
      found = object;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = bounds.isEmpty()
      ? found.getWorldPosition(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3());
    const local = world.clone().sub(clubhouse.interior.position);
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1
        && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
      local: { x: local.x, y: local.y, z: local.z },
      kind: found.userData.kind || null,
      uid: found.userData.uid || null,
      denom: found.userData.denom == null ? null : Number(found.userData.denom),
      from: found.userData.from || null,
      name: found.name || '',
      pick: !!found.userData.pick,
    };
  }, predicate);
}

async function checkoutSnapshot(page, skuIds = []) {
  return page.evaluate(async (ids) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const register = clubhouse.register;
    const tx = register.getTx();
    const shop = app.state.shop;
    const state = app.state;
    const camera = app.scene3d.camera;
    const walk = app.scene3d.walk.state;
    const { CHECKOUT_STATES } = await import('/src/sim/registerFlow.js');
    const clone = (value) => (value === undefined ? null : structuredClone(value));
    const flowState = tx?.checkoutFlow?.state || null;
    const flowSpec = flowState ? CHECKOUT_STATES[flowState] || null : null;
    const rendered = (object) => {
      for (let entry = object; entry; entry = entry.parent) {
        if (!entry.visible) return false;
      }
      return true;
    };
    const props = {
      items: 0,
      paymentCards: 0,
      tenderOrChange: 0,
      receipts: 0,
    };
    const physical = {
      itemUids: new Set(),
      tenderPieces: 0,
      settlingPieces: 0,
      changePieces: 0,
      paymentCardRoots: 0,
      receiptNames: [],
    };
    clubhouse.interior.traverse((object) => {
      if (!rendered(object)) return;
      const kind = object.userData?.kind;
      const from = object.userData?.from;
      if (kind === 'item') {
        props.items += 1;
        if (object.userData?.uid) physical.itemUids.add(object.userData.uid);
      }
      if (kind === 'payment-card') {
        props.paymentCards += 1;
        if (object.parent?.userData?.kind !== 'payment-card') physical.paymentCardRoots += 1;
      }
      if (kind === 'money' && from !== 'drawer') {
        props.tenderOrChange += 1;
        if (object.parent?.userData?.kind !== 'money') {
          if (from === 'tender') physical.tenderPieces += 1;
          else if (from === 'settling') physical.settlingPieces += 1;
          else if (from === 'change') physical.changePieces += 1;
        }
      }
      if (object.name === 'PrintedReceipt') {
        props.receipts += 1;
        physical.receiptNames.push(object.name);
      }
    });
    physical.itemUids = [...physical.itemUids].sort();
    physical.receiptNames.sort();
    const held = (shop.held || []).map((entry) => ({
      uid: entry.uid,
      skuId: entry.skuId,
    })).sort((left, right) => left.uid.localeCompare(right.uid));
    const history = shop.transactionHistory || [];
    const inventory = Object.fromEntries(ids.map((id) => [id, {
      shelf: Number(shop.inventory[id]?.shelf || 0),
      back: Number(shop.inventory[id]?.back || 0),
    }]));
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
    const runtimeCustomers = customers.map((customer) => ({
      customerId: customer.customerId || null,
      name: customer.fullName || customer.name || null,
      phase: customer.checkoutPhase || null,
      paymentStatus: customer.paymentStatus || null,
      bought: !!customer.bought,
      reviewed: !!customer.reviewed,
      visitRecorded: !!customer.visitRecorded,
      awaitingCheckout: !!customer.awaitingCheckout,
      cart: (customer.cart || []).map((item) => ({ uid: item.uid, skuId: item.skuId }))
        .sort((left, right) => String(left.uid).localeCompare(String(right.uid))),
    })).sort((left, right) => String(left.customerId || left.name)
      .localeCompare(String(right.customerId || right.name)));
    const hintElement = document.querySelector('.reg-hint');
    const hintStyle = hintElement ? getComputedStyle(hintElement) : null;
    const hintRect = hintElement ? hintElement.getBoundingClientRect() : null;
    const runtimeHint = register.hint ? register.hint() : null;
    const persistent = {
      ledger: clone(state.ledger),
      customers: clone(state.customerDirectory),
      reviews: clone(state.club?.reviews),
      statistics: {
        salesLive: clone(shop.salesLive),
        salesToday: clone(shop.salesToday),
        salesYesterday: clone(shop.salesYesterday),
        salesWindow: clone(shop.salesWindow),
        paymentBagStats: clone(shop.paymentBagStats),
        stateStatistics: clone(state.statistics),
        stateStats: clone(state.stats),
        clubStatistics: clone(state.club?.statistics),
        clubStats: clone(state.club?.stats),
        shopStatistics: clone(shop.statistics),
        shopStats: clone(shop.stats),
      },
    };
    return {
      active: register.isActive(),
      workspace: register.workspace(),
      deliveryPhase: register.deliveryPhase(),
      registerClass: document.body.classList.contains('register-mode'),
      pointerLock: document.pointerLockElement
        ? (document.pointerLockElement === document.querySelector('canvas') ? 'canvas' : 'other')
        : null,
      camera: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        fov: camera.fov,
        walkFov: walk.fov || 66,
        distanceToWalkXZ: Math.hypot(camera.position.x - walk.x, camera.position.z - walk.z),
      },
      props,
      physical,
      ui: {
        flowState,
        posState: flowSpec?.uiState?.posState || null,
        flowPrompt: flowSpec?.uiState?.prompt || null,
        runtimeHint: clone(runtimeHint),
        registerHint: hintElement ? {
          text: hintElement.textContent.trim(),
          inlineDisplay: hintElement.style.display,
          computedDisplay: hintStyle.display,
          visible: hintStyle.display !== 'none' && hintStyle.visibility !== 'hidden'
            && Number(hintStyle.opacity) !== 0 && hintRect.width > 0 && hintRect.height > 0,
        } : null,
        canvasCursor: getComputedStyle(document.querySelector('canvas')).cursor,
      },
      runtime: {
        customers: runtimeCustomers,
        queue: typeof clubhouse.checkoutQueue === 'function'
          ? clone(clubhouse.checkoutQueue())
          : [],
        activeCustomerId: register.getCustomer?.()?.customerId || null,
      },
      tx: tx ? {
        number: tx.number,
        stage: tx.stage,
        method: tx.method,
        prefer: tx.prefer || null,
        banked: !!tx.banked,
        drawerOpen: !!tx.drawerOpen,
        deposited: !!tx.deposited,
        receiptPrinted: !!tx.receiptPrinted,
        receiptPacked: !!tx.receiptPacked,
        checkoutFlow: tx.checkoutFlow?.state || null,
        cardResult: tx.cardResult || null,
        cardAttempts: Number(tx.cardAttempts || 0),
        cardsTried: Number(tx.cardsTried || 0),
        cardEntryCents: Number(tx.cardEntryCents || 0),
        cardEntryDigits: String(tx.cardEntryDigits || ''),
        tendered: clone(tx.tendered),
        tenderedTotal: Number(tx.tenderedTotal || 0),
        changeGiven: tx.changeGiven == null ? null : Number(tx.changeGiven),
        lost: Number(tx.lost || 0),
        hand: Object.fromEntries(Object.entries(tx.hand || {})
          .sort(([left], [right]) => Number(right) - Number(left))),
        drawerStart: clone(tx.drawerStart),
        drawerPending: clone(tx.drawerPending),
        items: tx.items.map((item) => ({
          uid: item.uid,
          skuId: item.skuId,
          scanned: !!item.scanned,
          staged: !!item.staged,
          bagged: !!item.bagged,
        })),
      } : null,
      books: {
        cash: Number(app.state.cash || 0),
        units: Number((shop.salesLive || {}).units || 0),
        revenue: Number((shop.salesLive || {}).revenue || 0),
        history: history.length,
        historyNumbers: history.map((ticket) => ticket.number),
        latestTicket: history[0] ? structuredClone(history[0]) : null,
        nextTransactionNo: Number(shop.nextTransactionNo || 1),
        held,
        inventory,
        log: [...(shop.log || [])],
        drawer: Object.fromEntries(Object.entries(shop.drawer || {})
          .sort(([left], [right]) => Number(right) - Number(left))),
      },
      persistent,
    };
  }, skuIds);
}

async function createFixture(page, skuIds, payment, authorizationRng = []) {
  const fixture = await page.evaluate(async ([ids, method]) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const shop = app.state.shop;
    const { capacityOf } = await import('/src/data/fixtureSlots.js');
    const { REGISTER } = await import('/src/data/shopLayout.js');
    const register = await import('/src/sim/register.js');
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    if (!shop.drawer) shop.drawer = register.newDrawer();
    for (const id of ids) {
      const inventory = shop.inventory[id];
      const capacity = Math.max(1, capacityOf(id));
      inventory.shelf = Math.min(capacity, Math.max(inventory.shelf || 0, Math.min(6, capacity)));
      inventory.back = Math.max(0, inventory.back || 0);
    }
    shop.markup.accessories = 1.15;
    shop.markup.apparel = 1.15;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
    };
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    clubhouse.rebuildStock();
    const off = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.atan2(1.185 - 1.62, horizontal);
    const customer = clubhouse.sendToCounter(ids, method);
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
    const entry = customers.find((candidate) => candidate.name === customer);
    if (entry) entry.patience = 180;
    return { customer, customerId: entry?.customerId || null };
  }, [skuIds, payment]);
  assert(fixture.customer, `Could not establish the deterministic ${payment} customer.`);
  await page.bringToFront();
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  try {
    await page.waitForFunction(([count, name]) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const tx = clubhouse.register.getTx();
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers()
        : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
      const customer = customers.find((candidate) => candidate.name === name);
      return !!tx && tx.items.length === count
        && (!customer || customer.checkoutPhase === 'waiting');
    }, [skuIds.length, fixture.customer], { timeout: 30000 });
  } catch (error) {
    const placement = await page.evaluate((name) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers()
        : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
      const customer = customers.find((candidate) => candidate.name === name);
      const progress = customer?.checkoutPlacement;
      return {
        documentHidden: document.hidden,
        customer: customer ? {
          checkoutPhase: customer.checkoutPhase,
          checkoutPlacedCount: customer.checkoutPlacedCount,
          awaitingCheckout: customer.awaitingCheckout,
          placement: progress ? {
            index: progress.index,
            activeUid: progress.activeUid,
            elapsed: progress.elapsed,
            complete: progress.complete,
            uids: [...progress.uids],
          } : null,
        } : null,
        queue: clubhouse.checkoutQueue(),
        txStage: clubhouse.register.getTx()?.stage || null,
      };
    }, fixture.customer).catch(() => null);
    error.message = `${error.message} placement=${JSON.stringify(placement)}`;
    throw error;
  }
  const seededAuthorization = await page.evaluate((values) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    if (!tx || !values.length) return { values: [], installed: false };
    const remaining = [...values];
    tx.__qaSaveReloadRngTrace = [];
    tx.rng = () => {
      const value = remaining.length ? remaining.shift() : values[values.length - 1];
      tx.__qaSaveReloadRngTrace.push(value);
      return value;
    };
    return { values: [...values], installed: true };
  }, authorizationRng);
  return { ...fixture, seededAuthorization };
}

async function prepareFixture(page, skuIds, payment, authorizationRng = []) {
  // Capture before the shopper removes stock. The setup call below is the only
  // fixture boundary; every checkout action after it is a real key/mouse input.
  const before = await page.evaluate(async (ids) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const shop = app.state.shop;
    const { capacityOf } = await import('/src/data/fixtureSlots.js');
    const register = await import('/src/sim/register.js');
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    if (!shop.drawer) shop.drawer = register.newDrawer();
    for (const id of ids) {
      const inventory = shop.inventory[id];
      const capacity = Math.max(1, capacityOf(id));
      inventory.shelf = Math.min(capacity, Math.max(inventory.shelf || 0, Math.min(6, capacity)));
      inventory.back = Math.max(0, inventory.back || 0);
    }
    clubhouse.rebuildStock();
    return true;
  }, skuIds);
  assert(before, 'Fixture stock normalization failed.');
  const baseline = await checkoutSnapshot(page, skuIds);
  const fixture = await createFixture(page, skuIds, payment, authorizationRng);
  const waiting = await checkoutSnapshot(page, skuIds);
  assert(waiting.tx && waiting.tx.items.length === skuIds.length,
    'The deterministic customer did not create the expected renderer transaction.');
  assert(waiting.books.held.length === baseline.books.held.length + skuIds.length,
    'The customer did not move every fixture item into the saved held ledger.');
  assert(waiting.runtime.customers.some((customer) => customer.name === fixture.customer),
    'The deterministic customer was not visible in the renderer snapshot.');
  if (authorizationRng.length) {
    assert(fixture.seededAuthorization.installed
        && same(fixture.seededAuthorization.values, authorizationRng),
    'The deterministic card authorization fixture was not installed at the fixture boundary.');
  }
  return { ...fixture, skuIds, payment, baseline, waiting };
}

async function enterCheckout(page) {
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
    { timeout: 8000 });
  await waitCamera(page, 'scan');
}

async function scanItems(page, count = Infinity) {
  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
  ));
  const chosen = uids.slice(0, count);
  for (const uid of chosen) {
    let point = await projectObject(page, { kind: 'item', uid });
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(150);
      const next = await projectObject(page, { kind: 'item', uid });
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) {
        point = next;
        break;
      }
      point = next;
    }
    assert(point?.inView, `Checkout item ${uid} was outside the player camera.`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((candidate) => candidate.uid === id);
      return !!item?.scanned;
    }, uid, { timeout: 5000 });
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((candidate) => candidate.uid === id);
      return !!item?.staged;
    }, uid, { timeout: 8000 });
    // `staged` is durable as soon as the scanner commits, while the authored
    // reader-to-bag arc still owns the cashier input gate. Wait for the flow
    // boundary before aiming at another product so this persistence route uses
    // the same physical one-click contract as acceptance and performance QA.
    await page.waitForFunction((id) => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      if (!tx) return false;
      const remaining = tx.items.some((item) => !item.scanned);
      const state = tx.checkoutFlow?.state;
      const presentation = register.scanPresentation();
      return !presentation.active
        && presentation.lastRead?.uid === id
        && presentation.lastRead?.ok
        // Payment now begins automatically after the readable all-items hold,
        // so a one-item order may already be presenting payment by the time
        // the visible bagging arc releases input.
        && (remaining
          ? state === 'WaitingForScan'
          : tx.items.every((item) => item.scanned && item.bagged));
    }, uid, { timeout: 8000 });
  }
  return chosen;
}

async function totalTransaction(page, mode) {
  // The compact flow resolves the customer's chosen payment method
  // automatically once every item is in the bag.
  await page.waitForFunction((payment) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && tx.method === payment;
  }, mode, { timeout: 10000 });
  if (mode === 'card') {
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'card-entry' && tx.checkoutFlow?.state === 'CardAmountEntry';
    }, null, { timeout: 10000 });
    await waitCamera(page, 'card');
    return;
  }
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'cash-tender' && tx.checkoutFlow?.state === 'CashPresented';
  }, null, { timeout: 10000 });
}

async function clickCardX(page) {
  const point = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cardXScreenPoint()
  ));
  assert(point?.visible && point?.inView,
    `The reader's pre-authorization X was not visible: ${JSON.stringify(point)}.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    return register.workspace() === 'monitor' && tx?.stage === 'scanning'
      && tx.items.every((item) => item.scanned && item.staged);
  }, null, { timeout: 5000 });
}

async function enterExactCardTotal(page) {
  const expectedCents = await page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    return Math.round(register.totalOf(
      window.__fw.scene3d.clubhouse().register.getTx(),
    ) * 100);
  });
  const digits = String(expectedCents);
  let entered = '';
  for (const digit of digits) {
    const point = await page.evaluate((key) => (
      window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint(key)
    ), `digit:${digit}`);
    assert(point?.inView, `Card keypad digit ${digit} was outside the player camera.`);
    await page.mouse.click(point.x, point.y);
    entered += digit;
    await page.waitForFunction((value) => (
      window.__fw.scene3d.clubhouse().register.getTx()?.cardEntryDigits === value
    ), entered, { timeout: 3000 });
  }
  const ok = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint('confirm')
  ));
  assert(ok?.inView, 'The card keypad OK button was outside the player camera.');
  await page.mouse.click(ok.x, ok.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.checkoutFlow?.state === 'CardProcessing' || tx?.cardResult === 'approved';
  }, null, { timeout: 4000 });
  return { expectedCents, entryCents: expectedCents, entryDigits: digits };
}

async function selectCashPiece(page, denom) {
  const slot = await projectObject(page, { kind: 'drawer-slot', denom });
  assert(slot?.inView, `Drawer denomination ${denom} was outside the player camera.`);
  const before = await page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return register.handTotal(tx);
  });
  await page.mouse.click(slot.x, slot.y);
  await page.waitForFunction(async (prior) => {
    const register = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return register.handTotal(tx) > prior;
  }, before, { timeout: 4000 });
  return slot;
}

async function saveAutosaveCheckpoint(page, skuIds) {
  return page.evaluate(async ({ ids, autosaveKey, checkpointKey }) => {
    const app = window.__fw;
    await app.autosave();
    const raw = localStorage.getItem(autosaveKey);
    if (!raw) throw new Error(`The production autosave did not write ${autosaveKey}.`);
    // sessionStorage is deliberately outside the game save. It lets both reload
    // passes restore the exact same bytes even if a boot-time autosave heals the
    // first copy in localStorage.
    sessionStorage.setItem(checkpointKey, raw);
    const empire = JSON.parse(raw);
    const holding = empire.holdings.find((candidate) => candidate.property.id === empire.activeId);
    if (!holding) throw new Error(`Autosave has no active holding for ${empire.activeId}.`);
    const state = holding.state;
    const shop = state.shop;
    const history = shop.transactionHistory || [];
    const clone = (value) => (value === undefined ? null : structuredClone(value));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return {
      key: autosaveKey,
      bytes: raw.length,
      sha256,
      books: {
        cash: Number(state.cash || 0),
        units: Number((shop.salesLive || {}).units || 0),
        revenue: Number((shop.salesLive || {}).revenue || 0),
        history: history.length,
        historyNumbers: history.map((ticket) => ticket.number),
        latestTicket: history[0] ? structuredClone(history[0]) : null,
        nextTransactionNo: Number(shop.nextTransactionNo || 1),
        held: (shop.held || []).map((entry) => ({ uid: entry.uid, skuId: entry.skuId }))
          .sort((left, right) => left.uid.localeCompare(right.uid)),
        inventory: Object.fromEntries(ids.map((id) => [id, {
          shelf: Number(shop.inventory[id]?.shelf || 0),
          back: Number(shop.inventory[id]?.back || 0),
        }])),
        log: [...(shop.log || [])],
        drawer: Object.fromEntries(Object.entries(shop.drawer || {})
          .sort(([left], [right]) => Number(right) - Number(left))),
      },
      persistent: {
        ledger: clone(state.ledger),
        customers: clone(state.customerDirectory),
        reviews: clone(state.club?.reviews),
        statistics: {
          salesLive: clone(shop.salesLive),
          salesToday: clone(shop.salesToday),
          salesYesterday: clone(shop.salesYesterday),
          salesWindow: clone(shop.salesWindow),
          paymentBagStats: clone(shop.paymentBagStats),
          stateStatistics: clone(state.statistics),
          stateStats: clone(state.stats),
          clubStatistics: clone(state.club?.statistics),
          clubStats: clone(state.club?.stats),
          shopStatistics: clone(shop.statistics),
          shopStats: clone(shop.stats),
        },
      },
    };
  }, {
    ids: skuIds,
    autosaveKey: AUTOSAVE_KEY,
    checkpointKey: QA_CHECKPOINT_KEY,
  });
}

function assertUnbankedSaved(fixture, live, saved, label) {
  assert(live.tx && !live.tx.banked, `${label} was already banked before autosave.`);
  assert(saved.key === AUTOSAVE_KEY && saved.bytes > 0 && saved.sha256.length === 64,
    `${label} did not use the production autosave record.`);
  assert(saved.books.units === fixture.baseline.books.units,
    `${label} autosave booked sale units before handoff.`);
  assert(saved.books.revenue === fixture.baseline.books.revenue,
    `${label} autosave booked revenue before handoff.`);
  assert(saved.books.history === fixture.baseline.books.history,
    `${label} autosave wrote transaction history before handoff.`);
  assert(saved.books.nextTransactionNo === fixture.baseline.books.nextTransactionNo,
    `${label} autosave consumed a transaction number before handoff.`);
  assert(saved.books.cash === fixture.baseline.books.cash,
    `${label} autosave changed player cash before handoff.`);
  assert(same(saved.books.drawer, fixture.baseline.books.drawer),
    `${label} autosave committed the transaction-local drawer before handoff.`);
  assert(same(saved.books.inventory, live.books.inventory),
    `${label} autosave did not preserve the in-flight inventory locations.`);
  assert(same(saved.books.log, fixture.baseline.books.log),
    `${label} autosave wrote the shop log before handoff.`);
  assert(saved.books.held.length === fixture.baseline.books.held.length + fixture.skuIds.length,
    `${label} autosave did not serialize every in-flight held unit.`);
  assert(new Set(saved.books.held.map((entry) => entry.uid)).size === saved.books.held.length,
    `${label} autosave serialized duplicate held UIDs.`);
  assert(same(saved.persistent, live.persistent),
    `${label} autosave drifted ledger/customer/review/statistics state.\nexpected ${JSON.stringify(live.persistent)}\nactual ${JSON.stringify(saved.persistent)}`);
}

function assertCleanRollback(fixture, reloaded, label) {
  assert(!reloaded.active && !reloaded.tx && !reloaded.registerClass,
    `${label} restored a renderer transaction or active register mode.`);
  assert(reloaded.workspace === 'monitor' && reloaded.deliveryPhase === null,
    `${label} restored a stale checkout workspace or delivery timer.`);
  assert(reloaded.pointerLock === null && reloaded.camera.distanceToWalkXZ < 0.35
      && Math.abs(reloaded.camera.fov - reloaded.camera.walkFov) < 0.01,
  `${label} left pointer lock or a checkout camera pose active: ${JSON.stringify(reloaded.camera)}.`);
  assert(reloaded.props.items === 0 && reloaded.props.paymentCards === 0
      && reloaded.props.tenderOrChange === 0 && reloaded.props.receipts === 0,
  `${label} left stale transaction props: ${JSON.stringify(reloaded.props)}.`);
  assert(reloaded.physical.itemUids.length === 0
      && reloaded.physical.tenderPieces === 0
      && reloaded.physical.settlingPieces === 0
      && reloaded.physical.changePieces === 0
      && reloaded.physical.paymentCardRoots === 0
      && reloaded.physical.receiptNames.length === 0,
  `${label} left stale physical roots: ${JSON.stringify(reloaded.physical)}.`);
  assert(!reloaded.ui.flowState && !reloaded.ui.posState && !reloaded.ui.flowPrompt
      && !reloaded.ui.registerHint?.visible && reloaded.ui.canvasCursor === 'auto',
    `${label} left stale checkout UI: ${JSON.stringify(reloaded.ui)}.`);
  assert(reloaded.runtime.customers.length === 0 && reloaded.runtime.queue.length === 0
      && reloaded.runtime.activeCustomerId === null,
  `${label} restored a renderer customer or queue reservation: ${JSON.stringify(reloaded.runtime)}.`);
  assert(same(reloaded.books, fixture.baseline.books),
    `${label} did not roll back exactly once.\nexpected ${JSON.stringify(fixture.baseline.books)}\nactual ${JSON.stringify(reloaded.books)}`);
  assert(same(reloaded.persistent, fixture.waiting.persistent),
    `${label} changed ledger/customer/review/statistics state during rollback.\nexpected ${JSON.stringify(fixture.waiting.persistent)}\nactual ${JSON.stringify(reloaded.persistent)}`);
}

function recoveryDigest(snapshot) {
  return {
    active: snapshot.active,
    workspace: snapshot.workspace,
    deliveryPhase: snapshot.deliveryPhase,
    registerClass: snapshot.registerClass,
    pointerLock: snapshot.pointerLock,
    camera: snapshot.camera,
    props: snapshot.props,
    physical: snapshot.physical,
    tx: snapshot.tx,
    ui: snapshot.ui,
    runtime: snapshot.runtime,
    books: snapshot.books,
    persistent: snapshot.persistent,
  };
}

function assertIdempotentRecovery(first, second, label) {
  assert(same(recoveryDigest(first), recoveryDigest(second)),
    `${label} changed when the identical autosave bytes were loaded twice.\nfirst ${JSON.stringify(recoveryDigest(first))}\nsecond ${JSON.stringify(recoveryDigest(second))}`);
}

function assertCheckpoint(definition, snapshot) {
  const label = definition.id;
  assert(snapshot.tx, `${label} did not retain a live renderer transaction.`);
  assert(snapshot.tx.stage === definition.stage,
    `${label} expected stage ${definition.stage}, got ${snapshot.tx.stage}.`);
  assert(definition.flowStates.includes(snapshot.tx.checkoutFlow),
    `${label} expected flow ${definition.flowStates.join(' or ')}, got ${snapshot.tx.checkoutFlow}.`);
  assert(snapshot.ui.flowState === snapshot.tx.checkoutFlow && snapshot.ui.posState,
    `${label} did not expose matching checkout UI state: ${JSON.stringify(snapshot.ui)}.`);
  assert(snapshot.active === definition.active,
    `${label} expected active=${definition.active}, got ${snapshot.active}.`);
  if (definition.workspace) {
    assert(snapshot.workspace === definition.workspace,
      `${label} expected ${definition.workspace} workspace, got ${snapshot.workspace}.`);
  }
  assert(snapshot.runtime.customers.length === 1 && snapshot.runtime.queue.length === 1,
    `${label} did not retain exactly one visible customer and queue owner.`);
  assert(snapshot.tx.items.length === definition.skuIds.length,
    `${label} did not retain every fixture product.`);
  assert(new Set(snapshot.tx.items.map((item) => item.uid)).size === snapshot.tx.items.length,
    `${label} contains duplicate product UIDs.`);
  assert(!snapshot.tx.banked, `${label} banked before its recovery checkpoint.`);

  const scanned = snapshot.tx.items.filter((item) => item.scanned).length;
  const staged = snapshot.tx.items.filter((item) => item.staged).length;
  switch (definition.id) {
    case 'customer-waiting':
      assert(!snapshot.registerClass && scanned === 0 && staged === 0
          && snapshot.runtime.customers[0].phase === 'waiting'
          && snapshot.physical.itemUids.length === definition.skuIds.length,
      `${label} was not a physical world-camera waiting order.`);
      break;
    case 'products-staged-before-scanning':
      assert(snapshot.registerClass && scanned === 0 && staged === 0
          && snapshot.physical.itemUids.length === definition.skuIds.length,
      `${label} was not the untouched physical basket in cashier mode.`);
      break;
    case 'mid-scan':
      assert(scanned === 1 && staged === 1
          && snapshot.tx.items.some((item) => !item.scanned && !item.staged),
      `${label} did not contain one settled scan and one remaining product.`);
      break;
    case 'all-scanned-payment-choice':
      assert(scanned === definition.skuIds.length && staged === definition.skuIds.length
          && snapshot.props.paymentCards === 0 && snapshot.props.tenderOrChange === 0,
      `${label} did not hold the all-scanned basket before a payment prop appeared.`);
      break;
    case 'card-presented':
      assert(scanned === definition.skuIds.length && snapshot.tx.method === 'card'
          && snapshot.physical.paymentCardRoots > 0 && snapshot.props.paymentCards > 0,
      `${label} did not expose a physical presented card.`);
      break;
    case 'post-x-cancellation':
      assert(scanned === definition.skuIds.length && staged === definition.skuIds.length
          && snapshot.tx.method === null && snapshot.physical.paymentCardRoots === 0,
      `${label} did not clear the card and return to the post-scan choice.`);
      break;
    case 'card-declined':
      assert(snapshot.tx.method === 'card' && snapshot.tx.cardResult === 'declined'
          && snapshot.tx.cardAttempts === 1,
      `${label} did not retain one real declined authorization.`);
      break;
    case 'cash-presented':
      assert(snapshot.tx.method === 'cash' && !snapshot.tx.drawerOpen && !snapshot.tx.deposited
          && snapshot.physical.tenderPieces > 0,
      `${label} did not retain customer-owned physical tender.`);
      break;
    case 'drawer-open':
      assert(snapshot.tx.method === 'cash' && snapshot.tx.drawerOpen && snapshot.tx.deposited
          && snapshot.tx.drawerStart && snapshot.tx.drawerPending,
      `${label} did not retain the automatic drawer-opening deposit journal.`);
      break;
    case 'cash-deposited':
      assert(snapshot.tx.drawerOpen && snapshot.tx.deposited
          && snapshot.tx.drawerStart && snapshot.tx.drawerPending
          && snapshot.physical.tenderPieces === 0,
      `${label} did not retain the deposited tender journal.`);
      break;
    case 'change-selected':
      assert(snapshot.tx.drawerOpen && snapshot.tx.deposited
          && Object.values(snapshot.tx.hand).reduce((sum, count) => sum + count, 0) === 1
          && snapshot.physical.changePieces > 0 && snapshot.props.tenderOrChange > 0,
      `${label} did not retain one domain-selected and visibly represented change piece.`);
      break;
    case 'receipt-printing':
      assert(snapshot.tx.receiptPrinted && snapshot.deliveryPhase === 'receipt-print'
          && snapshot.props.receipts === 1,
      `${label} did not retain exactly one visibly printing receipt.`);
      break;
    default:
      throw new Error(`No checkpoint assertion is defined for ${definition.id}.`);
  }
}

async function waitForFlow(page, states, timeout = 10000) {
  await page.waitForFunction((wanted) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && wanted.includes(tx.checkoutFlow?.state);
  }, states, { timeout });
}

async function presentCash(page) {
  await scanItems(page);
  await totalTransaction(page, 'cash');
}

async function takePresentedCash(page) {
  // One deliberate click accepts the customer's tender. The drawer then opens
  // and deposits that tender automatically before change selection begins.
  await page.waitForTimeout(950);
  const handful = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  assert(handful?.inView, 'The customer-held cash was outside the working frame.');
  await page.mouse.click(handful.x, handful.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'cash-drawer' && tx.drawerOpen && tx.deposited
      && tx.checkoutFlow?.state === 'SelectingChange';
  }, null, { timeout: 9000 });
  await waitCamera(page, 'cash');
  return handful;
}

async function takePresentedCashAtDrawerOpening(page) {
  await page.waitForTimeout(950);
  const handful = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  assert(handful?.inView, 'The customer-held cash was outside the working frame.');
  await page.mouse.click(handful.x, handful.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'cash-drawer' && tx.drawerOpen && tx.deposited
      && ['DrawerOpening', 'DepositingCash'].includes(tx.checkoutFlow?.state);
  }, null, { timeout: 4000 });
  return handful;
}

async function exactChangePlan(page) {
  return page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    const app = window.__fw;
    const tx = app.scene3d.clubhouse().register.getTx();
    const due = register.changeDue(tx);
    const plan = register.makeChangeFrom(
      register.drawerContents(tx, app.state.shop.drawer),
      due,
    );
    return { due, plan };
  });
}

async function handSelectedChangeToCustomer(page) {
  await waitCamera(page, 'cash');
  const done = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint('confirm-change')
  ));
  assert(done?.inView, 'The POS Done button was outside the change camera.');
  await page.mouse.click(done.x, done.y);
  await waitForFlow(page, ['GivingChange'], 4000);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'receipt'
  ), null, { timeout: 9000 });
  return done;
}

async function waitForReceiptPrinting(page) {
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    return tx?.stage === 'receipt'
      && tx.checkoutFlow?.state === 'ReceiptPrinting'
      && tx.cardResult === 'approved'
      && tx.cardAttempts === 1
      && tx.__qaSaveReloadRngTrace?.length === 1
      && tx.__qaSaveReloadRngTrace[0] === 0.99
      && tx.receiptPrinted
      && register.deliveryPhase() === 'receipt-print';
  }, null, { timeout: 12000 });
}

async function completeCardTransaction(page) {
  await scanItems(page);
  await totalTransaction(page, 'card');
  const amountEntry = await enterExactCardTotal(page);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'receipt' && tx.cardResult === 'approved'
      && tx.cardAttempts === 1
      && tx.__qaSaveReloadRngTrace?.length === 1
      && tx.__qaSaveReloadRngTrace[0] === 0.99;
  }, null, { timeout: 8000 });
  // Receipt packing, bag handoff, and customer departure are intentionally
  // automatic in the simplified presentation.
  await page.waitForFunction(() => (
    !window.__fw.scene3d.clubhouse().register.getTx()
  ), null, { timeout: 20000 });
  return amountEntry;
}

async function completeCashTransaction(page) {
  await presentCash(page);
  await takePresentedCash(page);
  const change = await exactChangePlan(page);
  assert(change.plan, `The transaction-local drawer could not make $${change.due.toFixed(2)} change.`);
  for (const [rawDenom, count] of Object.entries(change.plan)) {
    for (let index = 0; index < count; index += 1) {
      await selectCashPiece(page, Number(rawDenom));
    }
  }
  await handSelectedChangeToCustomer(page);
  await page.waitForFunction(() => (
    !window.__fw.scene3d.clubhouse().register.getTx()
  ), null, { timeout: 20000 });
  return change;
}

function stackValue(stack) {
  const cents = Object.entries(stack || {}).reduce(
    (sum, [denom, count]) => sum + Math.round(Number(denom) * 100) * Number(count),
    0,
  );
  return cents / 100;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function customerRecord(snapshot, customerId) {
  return snapshot.persistent.customers?.customers?.find(
    (customer) => customer.customerId === customerId,
  ) || null;
}

function assertCompletedReconciliation(fixture, completed, method, label) {
  assert(!completed.tx, `${label} left a live renderer transaction.`);
  const ticket = completed.books.latestTicket;
  assert(ticket?.method === method, `${label} did not write a ${method} ticket.`);
  const total = Number(ticket.total);
  assert(completed.books.units === fixture.baseline.books.units + fixture.skuIds.length,
    `${label} did not add exactly ${fixture.skuIds.length} sold unit(s).`);
  assert(round2(completed.books.revenue - fixture.baseline.books.revenue) === total,
    `${label} did not reconcile live revenue to the ticket total.`);
  assert(round2(completed.books.cash - fixture.baseline.books.cash) === total,
    `${label} did not reconcile player cash to the ticket total.`);
  assert(completed.books.history === fixture.baseline.books.history + 1
      && completed.books.nextTransactionNo === fixture.baseline.books.nextTransactionNo + 1,
  `${label} did not advance history and transaction numbering exactly once.`);
  assert(completed.books.held.length === fixture.baseline.books.held.length,
    `${label} left sold units in the held ledger.`);
  assert(same(completed.books.inventory, fixture.waiting.books.inventory),
    `${label} did not retain the real shelf debit for sold inventory.`);
  assert(new Set(completed.books.historyNumbers).size === completed.books.historyNumbers.length,
    `${label} produced duplicate transaction history numbers.`);

  const beforeRevenue = Number(fixture.waiting.persistent.ledger?.today?.revenue?.shopSales || 0);
  const afterRevenue = Number(completed.persistent.ledger?.today?.revenue?.shopSales || 0);
  assert(round2(afterRevenue - beforeRevenue) === total,
    `${label} did not reconcile the shopSales ledger line.`);
  const beforeEntries = fixture.waiting.persistent.ledger?.entries || [];
  const afterEntries = completed.persistent.ledger?.entries || [];
  assert(afterEntries.length > beforeEntries.length,
    `${label} did not append durable ledger entries.`);
  const newEntries = afterEntries.slice(beforeEntries.length);
  const saleEntries = newEntries.filter((entry) => entry?.direction === 'revenue'
    && entry?.category === 'shopSales' && entry?.source === 'checkout');
  assert(saleEntries.length === 1 && round2(saleEntries[0].amount) === total,
    `${label} did not append exactly one checkout shopSales entry.`);
  const saleEntry = saleEntries[0];
  assert(completed.persistent.ledger?.processedIds?.[saleEntry.idempotencyKey] === saleEntry.id,
    `${label} did not preserve the shopSales idempotency checkpoint.`);

  // A merchandise sale also posts non-cash cost of goods, and a non-exact cash
  // handoff can add drawer variance. Every one of those durable entries has a
  // bounded transaction-log row, so validate the new prefix semantically rather
  // than assuming the older one-row accounting model.
  const afterTxLog = completed.persistent.ledger?.txLog || [];
  const newTxRows = afterTxLog.slice(0, Math.min(newEntries.length, afterTxLog.length));
  const saleRows = newTxRows.filter((row) => row?.kind === 'rev'
    && row?.key === 'shopSales' && round2(row?.amt) === total);
  assert(saleRows.length === 1,
    `${label} did not append exactly one bounded shopSales transaction row.`);

  const beforeReviews = fixture.waiting.persistent.reviews;
  const afterReviews = completed.persistent.reviews;
  const beforeReviewCount = Array.isArray(beforeReviews) ? beforeReviews.length : 0;
  assert(Array.isArray(afterReviews) && afterReviews.length === beforeReviewCount + 1,
    `${label} did not add exactly one completed-purchase review.`);

  const beforeCustomer = customerRecord(fixture.waiting, fixture.customerId);
  const afterCustomer = customerRecord(completed, fixture.customerId);
  if (beforeCustomer || afterCustomer) {
    assert(beforeCustomer && afterCustomer,
      `${label} lost the persisted customer identity.`);
    const beforeVisit = beforeCustomer.visitHistory;
    const afterVisit = afterCustomer.visitHistory;
    assert(afterVisit.totalVisits === beforeVisit.totalVisits + 1
        && afterVisit.completedPurchases === beforeVisit.completedPurchases + 1
        && afterVisit.lifetimeSpend === round2(beforeVisit.lifetimeSpend + total),
    `${label} did not reconcile the customer's visit and lifetime-spend history.`);
    const methodKey = method === 'cash' ? 'cashPayments' : 'cardPayments';
    assert(afterVisit[methodKey] === beforeVisit[methodKey] + 1,
      `${label} did not record the customer's ${method} payment.`);
  }

  for (const skuId of fixture.skuIds) {
    const before = Number(fixture.waiting.persistent.statistics.salesToday?.[skuId] || 0);
    const after = Number(completed.persistent.statistics.salesToday?.[skuId] || 0);
    assert(after === before + 1,
      `${label} did not add ${skuId} exactly once to sales statistics.`);
  }
  if (method === 'card') {
    assert(same(completed.books.drawer, fixture.baseline.books.drawer),
      `${label} changed the drawer during a card sale.`);
  } else {
    assert(round2(stackValue(completed.books.drawer) - stackValue(fixture.baseline.books.drawer))
        === Number(ticket.cash),
    `${label} did not reconcile the physical drawer journal to ticket cash.`);
  }
}

function assertCleanCompletedReload(completed, reloaded, label) {
  assert(!reloaded.active && !reloaded.tx && !reloaded.registerClass
      && reloaded.workspace === 'monitor' && reloaded.deliveryPhase === null,
  `${label} restored stale completed-checkout UI or state.`);
  assert(reloaded.pointerLock === null && reloaded.camera.distanceToWalkXZ < 0.35
      && Math.abs(reloaded.camera.fov - reloaded.camera.walkFov) < 0.01,
  `${label} left pointer lock or a checkout camera pose active: ${JSON.stringify(reloaded.camera)}.`);
  assert(reloaded.props.items === 0 && reloaded.props.paymentCards === 0
      && reloaded.props.tenderOrChange === 0 && reloaded.props.receipts === 0,
  `${label} restored completed transaction props: ${JSON.stringify(reloaded.props)}.`);
  assert(reloaded.physical.itemUids.length === 0
      && reloaded.physical.tenderPieces === 0
      && reloaded.physical.settlingPieces === 0
      && reloaded.physical.changePieces === 0
      && reloaded.physical.paymentCardRoots === 0
      && reloaded.physical.receiptNames.length === 0,
  `${label} restored completed physical roots: ${JSON.stringify(reloaded.physical)}.`);
  assert(!reloaded.ui.flowState && !reloaded.ui.posState && !reloaded.ui.flowPrompt
      && !reloaded.ui.registerHint?.visible && reloaded.ui.canvasCursor === 'auto',
    `${label} restored stale completed-checkout UI: ${JSON.stringify(reloaded.ui)}.`);
  assert(reloaded.runtime.customers.length === 0 && reloaded.runtime.queue.length === 0
      && reloaded.runtime.activeCustomerId === null,
    `${label} restored the paid renderer customer.`);
  assert(same(reloaded.books, completed.books),
    `${label} duplicated or lost cash/revenue/inventory/drawer/history.`);
  assert(same(reloaded.persistent, completed.persistent),
    `${label} duplicated or lost ledger/customer/review/statistics state.`);
}

async function reachPresentedCard(page) {
  await enterCheckout(page);
  await scanItems(page);
  await totalTransaction(page, 'card');
}

const CHECKPOINT_SETUPS = Object.freeze({
  'customer-waiting': async () => ({}),
  'products-staged-before-scanning': async (page) => {
    await enterCheckout(page);
    await waitForFlow(page, ['WaitingForScan']);
    return {};
  },
  'mid-scan': async (page) => {
    await enterCheckout(page);
    await scanItems(page, 1);
    await waitForFlow(page, ['WaitingForScan']);
    return {};
  },
  'all-scanned-payment-choice': async (page) => {
    await enterCheckout(page);
    await scanItems(page);
    await waitForFlow(page, ['AllProductsScanned']);
    return {};
  },
  'card-presented': async (page) => {
    await reachPresentedCard(page);
    return {};
  },
  'post-x-cancellation': async (page, fixture) => {
    await reachPresentedCard(page);
    const preCancel = await checkoutSnapshot(page, fixture.skuIds);
    await clickCardX(page);
    return { preCancel };
  },
  'card-declined': async (page) => {
    await reachPresentedCard(page);
    const amountEntry = await enterExactCardTotal(page);
    await waitForFlow(page, ['CardDeclined']);
    const authorization = await page.evaluate(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return {
        result: tx.cardResult,
        attempts: tx.cardAttempts,
        rngTrace: [...(tx.__qaSaveReloadRngTrace || [])],
      };
    });
    assert(authorization.result === 'declined' && authorization.attempts === 1
        && same(authorization.rngTrace, [-1]),
    `The fixture's exact-total submission did not decline exactly once: ${JSON.stringify(authorization)}.`);
    return { amountEntry, authorization };
  },
  'cash-presented': async (page) => {
    await enterCheckout(page);
    await presentCash(page);
    await waitForFlow(page, ['CashPresented']);
    return {};
  },
  'drawer-open': async (page) => {
    await enterCheckout(page);
    await presentCash(page);
    const handful = await takePresentedCashAtDrawerOpening(page);
    return { handful };
  },
  'cash-deposited': async (page) => {
    await enterCheckout(page);
    await presentCash(page);
    const handful = await takePresentedCash(page);
    return { handful };
  },
  'change-selected': async (page) => {
    await enterCheckout(page);
    await presentCash(page);
    const handful = await takePresentedCash(page);
    await selectCashPiece(page, 0.01);
    return { handful, selectedDenomination: 0.01 };
  },
  'receipt-printing': async (page) => {
    await reachPresentedCard(page);
    const amountEntry = await enterExactCardTotal(page);
    await waitForReceiptPrinting(page);
    return { amountEntry };
  },
});

function authorizationRngFor(definition) {
  if (definition.payment !== 'card') return [];
  // Production card entry always approves. A negative fixture value stays
  // outside production RNG while exercising the domain decline branch.
  return definition.id === 'card-declined' ? [-1] : [0.99];
}

async function runRollbackMatrixCase(page, definition, shot) {
  const fixture = await prepareFixture(
    page,
    definition.skuIds,
    definition.payment,
    authorizationRngFor(definition),
  );
  const setup = CHECKPOINT_SETUPS[definition.id];
  assert(setup, `No setup is defined for ${definition.id}.`);
  const details = await setup(page, fixture);
  const checkpoint = await checkoutSnapshot(page, fixture.skuIds);
  assertCheckpoint(definition, checkpoint);
  // Persist before taking the screenshot so transient choice/printing states do
  // not advance past the named checkpoint while PNG encoding is in flight.
  const saved = await saveAutosaveCheckpoint(page, fixture.skuIds);
  assertUnbankedSaved(fixture, checkpoint, saved, definition.id);
  const checkpointShot = await shot(definition.evidenceDir, `${definition.id}-before-autosave`);

  await reloadExactCheckpoint(page);
  const firstReload = await checkoutSnapshot(page, fixture.skuIds);
  assertCleanRollback(fixture, firstReload, `${definition.id} first reload`);
  const firstReloadShot = await shot(definition.evidenceDir, `${definition.id}-first-reload-clean`);

  await reloadExactCheckpoint(page);
  const secondReload = await checkoutSnapshot(page, fixture.skuIds);
  assertCleanRollback(fixture, secondReload, `${definition.id} second reload`);
  assertIdempotentRecovery(firstReload, secondReload, definition.id);
  const secondReloadShot = await shot(definition.evidenceDir, `${definition.id}-second-reload-idempotent`);

  return {
    ok: true,
    caseId: definition.id,
    kind: definition.kind,
    fixture: {
      customer: fixture.customer,
      customerId: fixture.customerId,
      skus: fixture.skuIds,
      payment: fixture.payment,
    },
    baseline: fixture.baseline,
    waiting: fixture.waiting,
    details,
    checkpoint,
    saved,
    firstReload,
    secondReload,
    reconciled: {
      uiAndPhysicalRecovery: true,
      booksRollback: true,
      ledgerCustomerReviewsStatistics: true,
      identicalAutosaveLoadedTwice: true,
    },
    evidence: [checkpointShot, firstReloadShot, secondReloadShot],
  };
}

async function runCompletedMatrixCase(page, definition, shot) {
  const fixture = await prepareFixture(
    page,
    definition.skuIds,
    definition.payment,
    authorizationRngFor(definition),
  );
  await enterCheckout(page);
  const interaction = definition.payment === 'card'
    ? { amountEntry: await completeCardTransaction(page) }
    : { exactChange: await completeCashTransaction(page) };
  const completed = await checkoutSnapshot(page, fixture.skuIds);
  assertCompletedReconciliation(fixture, completed, definition.payment, definition.id);
  const completedShot = await shot(definition.evidenceDir, `${definition.id}-banked-once`);
  const saved = await saveAutosaveCheckpoint(page, fixture.skuIds);
  assert(same(saved.books, completed.books),
    `${definition.id} autosave did not exactly match completed books.`);
  assert(same(saved.persistent, completed.persistent),
    `${definition.id} autosave did not exactly match completed ledger/customer/review/statistics.`);

  await reloadExactCheckpoint(page);
  const firstReload = await checkoutSnapshot(page, fixture.skuIds);
  assertCleanCompletedReload(completed, firstReload, `${definition.id} first reload`);
  const firstReloadShot = await shot(definition.evidenceDir, `${definition.id}-first-reload-exact`);

  await reloadExactCheckpoint(page);
  const secondReload = await checkoutSnapshot(page, fixture.skuIds);
  assertCleanCompletedReload(completed, secondReload, `${definition.id} second reload`);
  assertIdempotentRecovery(firstReload, secondReload, definition.id);
  const secondReloadShot = await shot(definition.evidenceDir, `${definition.id}-second-reload-idempotent`);

  return {
    ok: true,
    caseId: definition.id,
    kind: definition.kind,
    fixture: {
      customer: fixture.customer,
      customerId: fixture.customerId,
      skus: fixture.skuIds,
      payment: fixture.payment,
    },
    baseline: fixture.baseline,
    waiting: fixture.waiting,
    interaction,
    completed,
    saved,
    firstReload,
    secondReload,
    reconciled: {
      uiAndPhysicalRecovery: true,
      cashRevenueInventoryDrawerHistory: true,
      ledgerCustomerReviewsStatistics: true,
      identicalAutosaveLoadedTwice: true,
    },
    evidence: [completedShot, firstReloadShot, secondReloadShot],
  };
}

// Run the selected rows in declaration order so full and subset evidence share
// one recovery contract and the long-standing output root/directory names.
export async function runSimplifiedRegisterSaveReload(page) {
  const out = path.resolve(process.env.REGISTER_QA_ROOT || DEFAULT_ROOT);
  fs.mkdirSync(out, { recursive: true });
  const productionBuildBefore = captureCashierBuildSnapshot();
  const diagnostics = {
    consoleErrors: [], pageErrors: [], warnings: [], failedRequests: [], httpErrors: [],
  };
  page.on('console', (message) => {
    const location = message.location();
    const source = location?.url ? ` (${location.url}:${location.lineNumber || 0})` : '';
    if (message.type() === 'error') diagnostics.consoleErrors.push(`${message.text()}${source}`);
    if (message.type() === 'warning') diagnostics.warnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'request failed';
    if (!/ERR_ABORTED/.test(error)) diagnostics.failedRequests.push({ url: request.url(), error });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      diagnostics.httpErrors.push({ status: response.status(), url: response.url() });
    }
  });

  const scenarios = {};
  let currentScenario = 'configuration';
  let currentDefinition = null;
  let shotNo = 0;
  const evidencePngs = [];
  const shot = async (directoryName, label) => {
    shotNo += 1;
    const directory = path.join(out, directoryName);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${String(shotNo).padStart(2, '0')}-${label}.png`);
    await page.screenshot({ path: file });
    evidencePngs.push(file);
    return file;
  };
  const persistResult = (result) => {
    const finalized = finalizeCashierQaResult({
      result,
      beforeSnapshot: productionBuildBefore,
      evidencePngs,
      evidenceRoot: out,
    });
    fs.writeFileSync(path.join(out, 'latest-result.json'), `${JSON.stringify(finalized, null, 2)}\n`);
    return finalized;
  };

  const quick = /^(1|true|yes)$/i.test(String(process.env.REGISTER_QA_QUICK || ''));
  const explicitCases = process.env.REGISTER_QA_CASES || null;
  const quickCases = process.env.REGISTER_QA_QUICK_CASES || null;
  let selectedCaseIds = [];

  try {
    selectedCaseIds = resolveSaveReloadCaseIds({
      quick,
      cases: explicitCases,
      quickCases,
    });
    const selected = selectedCaseIds.map(
      (id) => SAVE_RELOAD_MATRIX.find((definition) => definition.id === id),
    );
    await boot(page);

    for (const definition of selected) {
      currentDefinition = definition;
      currentScenario = definition.id;
      const result = definition.kind === 'completed'
        ? await runCompletedMatrixCase(page, definition, shot)
        : await runRollbackMatrixCase(page, definition, shot);
      scenarios[definition.outputKey] = result;
    }

    assert(diagnostics.consoleErrors.length === 0,
      `Console errors: ${diagnostics.consoleErrors.join(' | ')}`);
    assert(diagnostics.pageErrors.length === 0,
      `Page errors: ${diagnostics.pageErrors.join(' | ')}`);
    assert(diagnostics.failedRequests.length === 0,
      `Non-aborted failed requests: ${JSON.stringify(diagnostics.failedRequests)}`);
    assert(diagnostics.httpErrors.length === 0,
      `HTTP error responses: ${JSON.stringify(diagnostics.httpErrors)}`);

    return persistResult({
      ok: true,
      command: 'node tools/qa/run-playwright.cjs tools/qa/simplified-register-save-reload.js --bootstrap',
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      evidenceDirectory: out,
      configuration: {
        mode: explicitCases ? 'explicit-subset' : quick ? 'quick' : 'full',
        selectedCaseIds,
        availableCaseIds: SAVE_RELOAD_MATRIX.map((definition) => definition.id),
        environment: {
          REGISTER_QA_QUICK: '1 selects the default quick subset',
          REGISTER_QA_QUICK_CASES: 'comma-separated override for quick mode',
          REGISTER_QA_CASES: 'comma-separated explicit subset; takes precedence',
        },
      },
      savePath: `window.__fw.autosave() -> localStorage["${AUTOSAVE_KEY}"] -> deserializeEmpire() -> recoverCheckout()`,
      rollbackStrategy: 'Each unbanked renderer checkpoint serializes only the held-unit ledger. Both reload passes restore identical autosave bytes, recover every UID exactly once, close checkout UI/camera/props, and preserve ledger/customer/review/statistics slices. Completed card and cash tickets remain banked and byte-source-idempotent.',
      fixtureBoundary: 'sendToCounter plus stock/time/weather/patience normalization and deterministic authorization RNG only; after that boundary, E entry, one-click scan-to-bag actions, automatic payment presentation/card insertion, exact-total keypad entry, one-click cash acceptance with automatic drawer opening and deposit, drawer denomination selection, POS Done confirmation, and automatic receipt/bag/customer handoff use normal Playwright mouse controls.',
      preservedEvidencePaths: {
        root: DEFAULT_ROOT,
        midScan: 'mid_scan',
        cardCancelAndDecline: 'card_decline',
        cashDrawerAndChange: 'cash_change',
        receiptHandoff: 'receipt_handoff',
        completedCard: 'completed_sale',
      },
      legacyScenarioAliases: {
        midScan: 'midScan',
        cardCancelDecline: ['postXCancellation', 'cardDeclined'],
        cashChange: 'changeSelected',
        receiptHandoff: 'receiptPrinting',
        completedSale: 'completedCard',
      },
      scenarios,
      diagnostics,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const safe = currentScenario.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 70);
    const blockerPath = path.join(out, `99-blocker-${safe || 'unknown'}.png`);
    await page.screenshot({ path: blockerPath }).catch(() => {});
    if (fs.existsSync(blockerPath)) evidencePngs.push(blockerPath);
    const live = await checkoutSnapshot(page, currentDefinition?.skuIds || []).catch((probeError) => ({
      probeError: String(probeError?.stack || probeError),
    }));
    return persistResult({
      ok: false,
      command: 'node tools/qa/run-playwright.cjs tools/qa/simplified-register-save-reload.js --bootstrap',
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      evidenceDirectory: out,
      configuration: {
        mode: explicitCases ? 'explicit-subset' : quick ? 'quick' : 'full',
        selectedCaseIds,
      },
      savePath: `window.__fw.autosave() -> localStorage["${AUTOSAVE_KEY}"] -> deserializeEmpire() -> recoverCheckout()`,
      blocker: {
        scenario: currentScenario,
        message: error.message,
        stack: error.stack,
        evidence: blockerPath,
        live,
      },
      scenarios,
      diagnostics,
      generatedAt: new Date().toISOString(),
    });
  }
}

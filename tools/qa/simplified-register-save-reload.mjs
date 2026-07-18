import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:8457/';
const VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const DEFAULT_ROOT = 'qa/cashier_master_final/save_reload';

function assert(value, message) {
  if (!value) throw new Error(message);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function waitForGame(page) {
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(850);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null,
    { timeout: 40000 });
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
      inView: world.z >= -1 && world.z <= 1
        && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, predicate);
}

async function checkoutSnapshot(page, skuIds = []) {
  return page.evaluate((ids) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const register = clubhouse.register;
    const tx = register.getTx();
    const shop = app.state.shop;
    const camera = app.scene3d.camera;
    const walk = app.scene3d.walk.state;
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
    clubhouse.interior.traverse((object) => {
      if (!rendered(object)) return;
      const kind = object.userData?.kind;
      const from = object.userData?.from;
      if (kind === 'item') props.items += 1;
      if (kind === 'payment-card') props.paymentCards += 1;
      if (kind === 'money' && from !== 'drawer') props.tenderOrChange += 1;
      if (object.name === 'PrintedReceipt') props.receipts += 1;
    });
    const held = (shop.held || []).map((entry) => ({
      uid: entry.uid,
      skuId: entry.skuId,
    })).sort((left, right) => left.uid.localeCompare(right.uid));
    const history = shop.transactionHistory || [];
    const inventory = Object.fromEntries(ids.map((id) => [id, {
      shelf: Number(shop.inventory[id]?.shelf || 0),
      back: Number(shop.inventory[id]?.back || 0),
    }]));
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
        distanceToWalkXZ: Math.hypot(camera.position.x - walk.x, camera.position.z - walk.z),
      },
      props,
      tx: tx ? {
        number: tx.number,
        stage: tx.stage,
        method: tx.method,
        banked: !!tx.banked,
        drawerOpen: !!tx.drawerOpen,
        deposited: !!tx.deposited,
        receiptPrinted: !!tx.receiptPrinted,
        receiptPacked: !!tx.receiptPacked,
        checkoutFlow: tx.checkoutFlow?.state || null,
        cardResult: tx.cardResult || null,
        cardAttempts: Number(tx.cardAttempts || 0),
        tenderedTotal: Number(tx.tenderedTotal || 0),
        hand: Object.fromEntries(Object.entries(tx.hand || {})
          .sort(([left], [right]) => Number(right) - Number(left))),
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
        drawer: Object.fromEntries(Object.entries(shop.drawer || {})
          .sort(([left], [right]) => Number(right) - Number(left))),
      },
    };
  }, skuIds);
}

async function createFixture(page, skuIds, payment) {
  const fixture = await page.evaluate(async ([ids, method]) => {
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
    walk.x = 2.80 + off.x;
    walk.z = 5.10 + off.z;
    walk.yaw = 0;
    walk.pitch = -0.18;
    const customer = clubhouse.sendToCounter(ids, method);
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
    const entry = customers.find((candidate) => candidate.name === customer);
    if (entry) entry.patience = 180;
    return { customer };
  }, [skuIds, payment]);
  assert(fixture.customer, `Could not establish the deterministic ${payment} customer.`);
  await page.waitForFunction(([count, name]) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const tx = clubhouse.register.getTx();
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : Array.isArray(clubhouse.customers) ? clubhouse.customers : [];
    const customer = customers.find((candidate) => candidate.name === name);
    return !!tx && tx.items.length === count
      && (!customer || customer.checkoutPhase === 'waiting');
  }, [skuIds.length, fixture.customer], { timeout: 18000 });
  return fixture;
}

async function prepareFixture(page, skuIds, payment) {
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
  const fixture = await createFixture(page, skuIds, payment);
  const waiting = await checkoutSnapshot(page, skuIds);
  assert(waiting.tx && waiting.tx.items.length === skuIds.length,
    'The deterministic customer did not create the expected renderer transaction.');
  assert(waiting.books.held.length === baseline.books.held.length + skuIds.length,
    'The customer did not move every fixture item into the saved held ledger.');
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
    await page.waitForTimeout(200);
  }
  return chosen;
}

async function waitForPayment(page, mode) {
  if (mode === 'card') {
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'card-ready' && tx.checkoutFlow?.state === 'CardInsertReady';
    }, null, { timeout: 10000 });
    await waitCamera(page, 'card');
    return;
  }
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'cash-tender';
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

async function submitCard(page, rngValue) {
  await page.evaluate((value) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    tx.__qaSaveReloadRngTrace = [];
    tx.rng = () => {
      tx.__qaSaveReloadRngTrace.push(value);
      return value;
    };
  }, rngValue);
  const card = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  assert(card?.inView, `The customer-held card was not clickable: ${JSON.stringify(card)}.`);
  await page.mouse.click(card.x, card.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-entry' && tx.checkoutFlow?.state === 'CardAmountEntry';
  }, null, { timeout: 6000 });
  const prefill = await page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      expectedCents: Math.round(register.totalOf(tx) * 100),
      entryCents: Number(tx.cardEntryCents),
      entryDigits: String(tx.cardEntryDigits || ''),
    };
  });
  assert(prefill.entryCents === prefill.expectedCents
      && prefill.entryDigits === String(prefill.expectedCents),
  `The inserted card did not prefill the exact total: ${JSON.stringify(prefill)}.`);
  const ok = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint('OK')
  ));
  assert(ok?.inView, 'The physical reader Confirm key was outside the player camera.');
  await page.mouse.click(ok.x, ok.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-busy' && tx.checkoutFlow?.state === 'CardProcessing';
  }, null, { timeout: 3500 });
  return prefill;
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
  return page.evaluate(async (ids) => {
    const app = window.__fw;
    await app.autosave();
    const raw = localStorage.getItem('golfempire:autosave');
    if (!raw) throw new Error('The production autosave did not write golfempire:autosave.');
    const empire = JSON.parse(raw);
    const holding = empire.holdings.find((candidate) => candidate.property.id === empire.activeId);
    if (!holding) throw new Error(`Autosave has no active holding for ${empire.activeId}.`);
    const state = holding.state;
    const shop = state.shop;
    const history = shop.transactionHistory || [];
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return {
      key: 'golfempire:autosave',
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
        drawer: Object.fromEntries(Object.entries(shop.drawer || {})
          .sort(([left], [right]) => Number(right) - Number(left))),
      },
    };
  }, skuIds);
}

function assertUnbankedSaved(fixture, live, saved, label) {
  assert(live.tx && !live.tx.banked, `${label} was already banked before autosave.`);
  assert(saved.key === 'golfempire:autosave' && saved.bytes > 0 && saved.sha256.length === 64,
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
  assert(saved.books.held.length === fixture.baseline.books.held.length + fixture.skuIds.length,
    `${label} autosave did not serialize every in-flight held unit.`);
  assert(new Set(saved.books.held.map((entry) => entry.uid)).size === saved.books.held.length,
    `${label} autosave serialized duplicate held UIDs.`);
}

function assertCleanRollback(fixture, reloaded, label) {
  assert(!reloaded.active && !reloaded.tx && !reloaded.registerClass,
    `${label} restored a renderer transaction or active register mode.`);
  assert(reloaded.workspace === 'monitor' && reloaded.deliveryPhase === null,
    `${label} restored a stale checkout workspace or delivery timer.`);
  assert(reloaded.props.items === 0 && reloaded.props.paymentCards === 0
      && reloaded.props.tenderOrChange === 0 && reloaded.props.receipts === 0,
  `${label} left stale transaction props: ${JSON.stringify(reloaded.props)}.`);
  assert(reloaded.camera.distanceToWalkXZ < 0.35,
    `${label} left the camera latched to a checkout pose (${reloaded.camera.distanceToWalkXZ.toFixed(3)}m from walk pose).`);
  assert(same(reloaded.books, fixture.baseline.books),
    `${label} did not roll back exactly once.\nexpected ${JSON.stringify(fixture.baseline.books)}\nactual ${JSON.stringify(reloaded.books)}`);
}

async function completeCardTransaction(page) {
  await scanItems(page);
  await waitForPayment(page, 'card');
  const prefill = await submitCard(page, 0.99);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'receipt' && tx.checkoutFlow?.state === 'CardApproved';
  }, null, { timeout: 8000 });
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'receipt-print'
  ), null, { timeout: 10000 });
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
    { timeout: 16000 });
  return prefill;
}

export async function runSimplifiedRegisterSaveReload(page) {
  const out = path.resolve(process.env.REGISTER_QA_ROOT || DEFAULT_ROOT);
  fs.mkdirSync(out, { recursive: true });
  const diagnostics = { consoleErrors: [], pageErrors: [], warnings: [], failedRequests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.warnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'request failed';
    if (!/ERR_ABORTED/.test(error)) diagnostics.failedRequests.push({ url: request.url(), error });
  });

  const scenarios = {};
  let currentScenario = 'boot';
  let shotNo = 0;
  const shot = async (scenario, label) => {
    shotNo += 1;
    const directory = path.join(out, scenario);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${String(shotNo).padStart(2, '0')}-${label}.png`);
    await page.screenshot({ path: file });
    return file;
  };
  const persistResult = (result) => {
    fs.writeFileSync(path.join(out, 'latest-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  };

  try {
    await boot(page);

    // 1. MID-SCAN: one normal product click is durable only as held inventory.
    // The renderer transaction is intentionally absent after load and both units
    // return to their exact pre-customer shelf/back locations.
    currentScenario = 'mid-scan rollback';
    let fixture = await prepareFixture(page, ['tees1', 'marker1'], 'card');
    await enterCheckout(page);
    await scanItems(page, 1);
    const midScan = await checkoutSnapshot(page, fixture.skuIds);
    assert(midScan.tx?.items.filter((item) => item.scanned && item.staged).length === 1,
      'Mid-scan checkpoint did not contain exactly one clicked-and-bagged product.');
    const midScanShot = await shot('mid_scan', 'one-of-two-products-scanned-before-autosave');
    const midScanSaved = await saveAutosaveCheckpoint(page, fixture.skuIds);
    assertUnbankedSaved(fixture, midScan, midScanSaved, 'Mid-scan');
    await reloadFromAutosave(page);
    const midScanReloaded = await checkoutSnapshot(page, fixture.skuIds);
    assertCleanRollback(fixture, midScanReloaded, 'Mid-scan reload');
    const midScanReloadShot = await shot('mid_scan', 'held-stock-reconciled-clean-counter-after-reload');
    scenarios.midScan = {
      ok: true,
      fixture: { customer: fixture.customer, skus: fixture.skuIds, payment: fixture.payment },
      baseline: fixture.baseline,
      checkpoint: midScan,
      saved: midScanSaved,
      reloaded: midScanReloaded,
      evidence: [midScanShot, midScanReloadShot],
    };

    // 2. CARD: the next sale proves the prior rollback is playable. Exercise the
    // visible X, allow the customer to present again, then run one genuine declined
    // authorization through the physical card and prefilled Confirm key.
    currentScenario = 'card cancel and decline rollback';
    fixture = await prepareFixture(page, ['glove1'], 'card');
    await enterCheckout(page);
    scenarios.midScan.freshNormalSale = await checkoutSnapshot(page, fixture.skuIds);
    await scanItems(page);
    await waitForPayment(page, 'card');
    const preCancel = await checkoutSnapshot(page, fixture.skuIds);
    await clickCardX(page);
    const cancelledShot = await shot('card_decline', 'visible-x-cancelled-preauthorization');
    await waitForPayment(page, 'card');
    const cardPrefill = await submitCard(page, 0);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'card-declined' && tx.checkoutFlow?.state === 'CardDeclined';
    }, null, { timeout: 8000 });
    const declined = await checkoutSnapshot(page, fixture.skuIds);
    assert(declined.tx?.cardResult === 'declined' && declined.tx.cardAttempts === 1,
      `The normal authorization did not produce one real decline: ${JSON.stringify(declined.tx)}.`);
    const declinedShot = await shot('card_decline', 'physical-reader-declined-before-autosave');
    const declinedSaved = await saveAutosaveCheckpoint(page, fixture.skuIds);
    assertUnbankedSaved(fixture, declined, declinedSaved, 'Declined card');
    await reloadFromAutosave(page);
    const declinedReloaded = await checkoutSnapshot(page, fixture.skuIds);
    assertCleanRollback(fixture, declinedReloaded, 'Declined-card reload');
    const declinedReloadShot = await shot('card_decline', 'decline-cleared-held-stock-restored-after-reload');
    scenarios.cardCancelDecline = {
      ok: true,
      fixture: { customer: fixture.customer, skus: fixture.skuIds, payment: fixture.payment },
      baseline: fixture.baseline,
      preCancel,
      exactTotalPrefill: cardPrefill,
      checkpoint: declined,
      saved: declinedSaved,
      reloaded: declinedReloaded,
      evidence: [cancelledShot, declinedShot, declinedReloadShot],
    };

    // 3. CASH: accept the customer's visible handful with one click, wait for the
    // physical drawer and automatic deposit, then select one real penny of change.
    currentScenario = 'cash drawer change rollback';
    fixture = await prepareFixture(page, ['tees1'], 'cash');
    await enterCheckout(page);
    scenarios.cardCancelDecline.freshNormalSale = await checkoutSnapshot(page, fixture.skuIds);
    await scanItems(page);
    await waitForPayment(page, 'cash');
    const handful = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
    ));
    assert(handful?.inView, 'The customer-held cash was outside the working frame.');
    await page.mouse.click(handful.x, handful.y);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.drawerOpen;
    }, null, { timeout: 6000 });
    await waitCamera(page, 'cash');
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.getTx()?.deposited
    ), null, { timeout: 9000 });
    await selectCashPiece(page, 0.01);
    const cashChange = await checkoutSnapshot(page, fixture.skuIds);
    assert(cashChange.tx?.stage === 'cash-drawer' && cashChange.tx.drawerOpen
        && cashChange.tx.deposited && Number(cashChange.tx.hand['0.01'] || 0) === 1,
    `Cash checkpoint did not retain one selected penny: ${JSON.stringify(cashChange.tx)}.`);
    const cashShot = await shot('cash_change', 'drawer-open-tender-deposited-penny-selected');
    const cashSaved = await saveAutosaveCheckpoint(page, fixture.skuIds);
    assertUnbankedSaved(fixture, cashChange, cashSaved, 'Cash change');
    await reloadFromAutosave(page);
    const cashReloaded = await checkoutSnapshot(page, fixture.skuIds);
    assertCleanRollback(fixture, cashReloaded, 'Cash-change reload');
    const cashReloadShot = await shot('cash_change', 'drawer-closed-change-cleared-stock-restored-after-reload');
    scenarios.cashChange = {
      ok: true,
      fixture: { customer: fixture.customer, skus: fixture.skuIds, payment: fixture.payment },
      baseline: fixture.baseline,
      checkpoint: cashChange,
      saved: cashSaved,
      reloaded: cashReloaded,
      evidence: [cashShot, cashReloadShot],
    };

    // 4. RECEIPT/HANDOFF: approve normally, then autosave while the authored paper
    // is physically feeding. Payment is resolved but the sale remains unbanked
    // until receipt and bag reach the customer, so reload must still roll it back.
    currentScenario = 'receipt handoff rollback';
    fixture = await prepareFixture(page, ['marker1'], 'card');
    await enterCheckout(page);
    scenarios.cashChange.freshNormalSale = await checkoutSnapshot(page, fixture.skuIds);
    await scanItems(page);
    await waitForPayment(page, 'card');
    const receiptPrefill = await submitCard(page, 0.99);
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'receipt-print'
    ), null, { timeout: 10000 });
    const receipt = await checkoutSnapshot(page, fixture.skuIds);
    assert(receipt.tx && !receipt.tx.banked && receipt.tx.receiptPrinted
        && receipt.deliveryPhase === 'receipt-print' && receipt.props.receipts === 1,
    `Receipt checkpoint was not visibly printing and unbanked: ${JSON.stringify(receipt)}.`);
    const receiptShot = await shot('receipt_handoff', 'receipt-printing-before-customer-handoff');
    const receiptSaved = await saveAutosaveCheckpoint(page, fixture.skuIds);
    assertUnbankedSaved(fixture, receipt, receiptSaved, 'Receipt printing');
    await reloadFromAutosave(page);
    const receiptReloaded = await checkoutSnapshot(page, fixture.skuIds);
    assertCleanRollback(fixture, receiptReloaded, 'Receipt-print reload');
    const receiptReloadShot = await shot('receipt_handoff', 'receipt-bag-and-transaction-cleared-after-reload');
    scenarios.receiptHandoff = {
      ok: true,
      fixture: { customer: fixture.customer, skus: fixture.skuIds, payment: fixture.payment },
      baseline: fixture.baseline,
      exactTotalPrefill: receiptPrefill,
      checkpoint: receipt,
      saved: receiptSaved,
      reloaded: receiptReloaded,
      evidence: [receiptShot, receiptReloadShot],
    };

    // 5. COMPLETED SALE: the next fresh checkout runs through receipt + bag delivery
    // to exact-once banking. Save the completed ticket, reload the same autosave
    // twice, and require cash/revenue/history/stock/ticket identity to remain exact.
    currentScenario = 'completed sale reload idempotence';
    fixture = await prepareFixture(page, ['glove1'], 'card');
    await enterCheckout(page);
    scenarios.receiptHandoff.freshNormalSale = await checkoutSnapshot(page, fixture.skuIds);
    const completedPrefill = await completeCardTransaction(page);
    const completed = await checkoutSnapshot(page, fixture.skuIds);
    assert(!completed.tx, 'Completed receipt and bag delivery left a live transaction.');
    assert(completed.books.units === fixture.baseline.books.units + 1,
      'Completed sale did not add exactly one sold unit.');
    assert(completed.books.history === fixture.baseline.books.history + 1,
      'Completed sale did not write exactly one transaction ticket.');
    assert(completed.books.held.length === fixture.baseline.books.held.length,
      'Completed sale left its sold unit in the held ledger.');
    assert(completed.books.latestTicket?.method === 'card',
      'Completed sale did not retain its card ticket.');
    const completedShot = await shot('completed_sale', 'receipt-and-bag-delivered-sale-banked-once');
    const completedSaved = await saveAutosaveCheckpoint(page, fixture.skuIds);
    assert(same(completedSaved.books, completed.books),
      'Completed-sale autosave did not exactly match the banked books.');
    await reloadFromAutosave(page);
    const completedReloadOne = await checkoutSnapshot(page, fixture.skuIds);
    assert(!completedReloadOne.active && !completedReloadOne.tx
        && completedReloadOne.props.items === 0 && completedReloadOne.props.receipts === 0,
    'First completed-sale reload restored stale checkout state.');
    assert(same(completedReloadOne.books, completed.books),
      'First completed-sale reload duplicated or lost money, history, ticket, or inventory.');
    const completedReloadOneShot = await shot('completed_sale', 'first-reload-ticket-and-books-exact');
    await reloadFromAutosave(page);
    const completedReloadTwo = await checkoutSnapshot(page, fixture.skuIds);
    assert(same(completedReloadTwo.books, completedReloadOne.books),
      'Loading the completed-sale autosave twice duplicated or lost state.');
    assert(!completedReloadTwo.active && !completedReloadTwo.tx
        && completedReloadTwo.props.items === 0 && completedReloadTwo.props.paymentCards === 0
        && completedReloadTwo.props.tenderOrChange === 0 && completedReloadTwo.props.receipts === 0,
    'Second completed-sale reload restored a ghost transaction or physical prop.');
    const completedReloadTwoShot = await shot('completed_sale', 'second-reload-idempotent-clean-counter');
    scenarios.completedSale = {
      ok: true,
      fixture: { customer: fixture.customer, skus: fixture.skuIds, payment: fixture.payment },
      baseline: fixture.baseline,
      exactTotalPrefill: completedPrefill,
      completed,
      saved: completedSaved,
      firstReload: completedReloadOne,
      secondReload: completedReloadTwo,
      evidence: [completedShot, completedReloadOneShot, completedReloadTwoShot],
    };

    // A final new customer, normal E entry, and one product click prove the twice-
    // loaded completed sale did not lock the station or reuse the old transaction.
    currentScenario = 'fresh sale after completed reload';
    const fresh = await prepareFixture(page, ['marker1'], 'cash');
    await enterCheckout(page);
    await scanItems(page, 1);
    const finalFresh = await checkoutSnapshot(page, fresh.skuIds);
    assert(finalFresh.active && finalFresh.tx
        && finalFresh.tx.items[0].scanned && finalFresh.tx.items[0].staged,
    'A fresh normal checkout could not start after the completed-sale reloads.');
    assert(finalFresh.tx.number === completed.books.nextTransactionNo,
      'Fresh checkout did not use the next transaction number after the saved sale.');
    assert(finalFresh.books.history === completed.books.history,
      'Starting the fresh checkout duplicated completed-sale history.');
    const finalFreshShot = await shot('completed_sale', 'fresh-cash-sale-started-and-first-product-scanned');
    scenarios.completedSale.freshNormalSale = {
      fixture: { customer: fresh.customer, skus: fresh.skuIds, payment: fresh.payment },
      snapshot: finalFresh,
      evidence: finalFreshShot,
    };

    assert(diagnostics.consoleErrors.length === 0,
      `Console errors: ${diagnostics.consoleErrors.join(' | ')}`);
    assert(diagnostics.pageErrors.length === 0,
      `Page errors: ${diagnostics.pageErrors.join(' | ')}`);
    assert(diagnostics.failedRequests.length === 0,
      `Non-aborted failed requests: ${JSON.stringify(diagnostics.failedRequests)}`);

    return persistResult({
      ok: true,
      command: 'node tools/qa/run-playwright.cjs tools/qa/simplified-register-save-reload.js --bootstrap',
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      evidenceDirectory: out,
      savePath: 'window.__fw.autosave() -> localStorage["golfempire:autosave"] -> deserializeEmpire() -> recoverCheckout()',
      rollbackStrategy: 'Unbanked renderer transactions are intentionally not serialized. Their held-unit ledger is serialized, then recoverCheckout returns every UID once on load. A completed ticket is serialized and remains unchanged across repeated loads.',
      fixtureBoundary: 'sendToCounter plus stock/time/weather/patience normalization only; E entry, every item click, card X, card insertion, Confirm, cash acceptance, and change selection use Playwright keyboard/mouse controls.',
      scenarios,
      diagnostics,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const safe = currentScenario.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 70);
    const blockerPath = path.join(out, `99-blocker-${safe || 'unknown'}.png`);
    await page.screenshot({ path: blockerPath }).catch(() => {});
    const live = await checkoutSnapshot(page).catch((probeError) => ({
      probeError: String(probeError?.stack || probeError),
    }));
    return persistResult({
      ok: false,
      command: 'node tools/qa/run-playwright.cjs tools/qa/simplified-register-save-reload.js --bootstrap',
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      evidenceDirectory: out,
      savePath: 'window.__fw.autosave() -> localStorage["golfempire:autosave"] -> deserializeEmpire() -> recoverCheckout()',
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

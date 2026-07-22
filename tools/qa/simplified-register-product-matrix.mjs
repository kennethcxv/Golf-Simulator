import fs from 'node:fs';
import path from 'node:path';

import {
  PRODUCT_MATRIX,
  PRODUCT_MATRIX_REQUIRED_COUNTS,
  PRODUCT_MATRIX_REQUIRED_COVERAGE,
} from './simplified-register-product-matrix-spec.mjs';
import {
  captureCashierBuildSnapshot,
  finalizeCashierQaResult,
} from './cashier-build-snapshot.mjs';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
const VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const DEFAULT_ROOT = 'qa/cashier_master_final/product_matrix';
const cents = (value) => Math.round(Number(value || 0) * 100);

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function boot(page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(BASE_URL);
  await page.waitForTimeout(900);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null,
  { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(900);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(120);
}

async function waitCamera(page, workspace) {
  await page.evaluate(() => { window.__productMatrixCameraProbe = null; });
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
    const old = window.__productMatrixCameraProbe;
    if (!old) {
      window.__productMatrixCameraProbe = { ...now, stable: 0 };
      return false;
    }
    const delta = Math.max(
      Math.abs(now.x - old.x), Math.abs(now.y - old.y), Math.abs(now.z - old.z),
      Math.abs(now.qx - old.qx), Math.abs(now.qy - old.qy),
      Math.abs(now.qz - old.qz), Math.abs(now.qw - old.qw),
      Math.abs(now.fov - old.fov),
    );
    const stable = delta < 0.0008 ? old.stable + 1 : 0;
    window.__productMatrixCameraProbe = { ...now, stable };
    return stable >= 4;
  }, workspace, { timeout: 12000, polling: 80 });
}

async function leaveFrontDesk(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
    if (!active) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
  }
  assert(!await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive()),
    'Normal Escape input did not leave the front desk between matrix cases.');
}

async function stateSnapshot(page, skuIds) {
  return page.evaluate((ids) => {
    const app = window.__fw;
    const shop = app.state.shop;
    const history = Array.isArray(shop.transactionHistory) ? shop.transactionHistory : [];
    return {
      cashCents: Math.round(Number(app.state.cash || 0) * 100),
      shopRevenueCents: Math.round(Number(app.state.ledger?.today?.revenue?.shopSales || 0) * 100),
      liveUnits: Number(shop.salesLive?.units || 0),
      liveRevenueCents: Math.round(Number(shop.salesLive?.revenue || 0) * 100),
      held: (shop.held || []).map(({ uid, skuId }) => ({ uid, skuId })),
      historyLength: history.length,
      nextTransactionNo: Number(shop.nextTransactionNo || 1),
      shelf: Object.fromEntries(ids.map((id) => [id, Number(shop.inventory[id]?.shelf || 0)])),
      back: Object.fromEntries(ids.map((id) => [id, Number(shop.inventory[id]?.back || 0)])),
      salesToday: Object.fromEntries(ids.map((id) => [id, Number(shop.salesToday?.[id] || 0)])),
      latestTicket: history[0] ? JSON.parse(JSON.stringify(history[0])) : null,
      history: history.map((ticket) => ({
        number: ticket.number,
        total: ticket.total,
        method: ticket.method,
        itemUids: (ticket.items || []).map((item) => item.uid),
      })),
    };
  }, skuIds);
}

async function setupCase(page, entry) {
  return page.evaluate(async ({ skuIds }) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const { capacityOf } = await import('/src/data/fixtureSlots.js');
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    for (const skuId of skuIds) {
      if (!app.state.shop.inventory[skuId]) throw new Error(`Missing fixture inventory ${skuId}.`);
      app.state.shop.inventory[skuId].shelf = capacityOf(skuId);
    }
    for (const category of ['clubs', 'balls', 'apparel', 'accessories', 'provisions']) {
      app.state.shop.markup[category] = 1.15;
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
    };
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    clubhouse.rebuildStock();
    const shop = app.state.shop;
    const history = Array.isArray(shop.transactionHistory) ? shop.transactionHistory : [];
    const before = {
      cashCents: Math.round(Number(app.state.cash || 0) * 100),
      shopRevenueCents: Math.round(Number(app.state.ledger?.today?.revenue?.shopSales || 0) * 100),
      liveUnits: Number(shop.salesLive?.units || 0),
      liveRevenueCents: Math.round(Number(shop.salesLive?.revenue || 0) * 100),
      held: (shop.held || []).map(({ uid, skuId }) => ({ uid, skuId })),
      historyLength: history.length,
      nextTransactionNo: Number(shop.nextTransactionNo || 1),
      shelf: Object.fromEntries(skuIds.map((id) => [id, Number(shop.inventory[id]?.shelf || 0)])),
      back: Object.fromEntries(skuIds.map((id) => [id, Number(shop.inventory[id]?.back || 0)])),
      salesToday: Object.fromEntries(skuIds.map((id) => [id, Number(shop.salesToday?.[id] || 0)])),
    };
    const walk = app.scene3d.walk.state;
    const off = clubhouse.interior.position;
    walk.x = 2.80 + off.x;
    walk.z = 5.10 + off.z;
    walk.yaw = 0;
    walk.pitch = -0.18;
    const customer = clubhouse.sendToCounter(skuIds, 'card');
    return { before, customer };
  }, entry);
}

async function txSnapshot(page) {
  return page.evaluate(async () => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    if (!tx) return null;
    const domain = await import('/src/sim/register.js');
    return {
      number: tx.number,
      stage: tx.stage,
      workspace: register.workspace(),
      method: tx.method,
      prefer: tx.prefer,
      subtotalCents: Math.round(domain.subtotal(tx) * 100),
      totalCents: Math.round(domain.totalOf(tx) * 100),
      scannedUids: tx.items.filter((item) => item.scanned).map((item) => item.uid),
      stagedUids: tx.items.filter((item) => item.staged).map((item) => item.uid),
      items: tx.items.map((item) => ({
        uid: item.uid,
        skuId: item.skuId,
        name: item.name,
        priceCents: Number.isInteger(item.priceCents)
          ? item.priceCents
          : Math.round(Number(item.price || 0) * 100),
        scanned: !!item.scanned,
        staged: !!item.staged,
      })),
    };
  });
}

// Locate an actually hittable pixel on a product. The read-only diagnostic is
// deliberately separate from the click: gameplay advances only through the real
// page.mouse click below. Sampling the visible projected bounds handles thin club
// shafts and overlapping silhouettes without inventing a debug interaction path.
async function inspectItemTarget(page, uid) {
  return page.evaluate(async (wantedUid) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const register = clubhouse.register;
    const canvas = document.querySelector('canvas');
    const canvasRect = canvas.getBoundingClientRect();
    let product = null;
    clubhouse.interior.traverse((object) => {
      if (product || object.userData?.kind !== 'item' || object.userData?.uid !== wantedUid) return;
      if (String(object.name || '').startsWith('CheckoutProduct_')) product = object;
    });
    if (!product) {
      clubhouse.interior.traverse((object) => {
        if (!product && object.userData?.kind === 'item' && object.userData?.uid === wantedUid) product = object;
      });
    }
    if (!product) return { uid: wantedUid, foundObject: false, target: null };
    product.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3();
    product.traverse((object) => {
      if (!object.isMesh || object.visible === false || object.name === 'ItemClickPad' || !object.geometry) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (object.geometry.boundingBox) bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    });
    if (bounds.isEmpty()) bounds.setFromObject(product);
    const centerWorld = bounds.getCenter(new THREE.Vector3());
    const projectedCenter = centerWorld.clone().project(app.scene3d.camera);
    const corners = [];
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new THREE.Vector3(x, y, z).project(app.scene3d.camera);
          corners.push({
            x: canvasRect.left + ((projected.x + 1) / 2) * canvasRect.width,
            y: canvasRect.top + ((-projected.y + 1) / 2) * canvasRect.height,
            z: projected.z,
          });
        }
      }
    }
    const center = {
      x: canvasRect.left + ((projectedCenter.x + 1) / 2) * canvasRect.width,
      y: canvasRect.top + ((-projectedCenter.y + 1) / 2) * canvasRect.height,
      z: projectedCenter.z,
    };
    const rawMinX = Math.min(...corners.map((point) => point.x));
    const rawMaxX = Math.max(...corners.map((point) => point.x));
    const rawMinY = Math.min(...corners.map((point) => point.y));
    const rawMaxY = Math.max(...corners.map((point) => point.y));
    const minX = Math.max(canvasRect.left + 1, rawMinX - 18);
    const maxX = Math.min(canvasRect.right - 1, rawMaxX + 18);
    const minY = Math.max(canvasRect.top + 1, rawMinY - 18);
    const maxY = Math.min(canvasRect.bottom - 1, rawMaxY + 18);
    const samples = [center];
    for (let row = 0; row <= 8; row += 1) {
      for (let column = 0; column <= 12; column += 1) {
        samples.push({
          x: minX + (maxX - minX) * (column / 12),
          y: minY + (maxY - minY) * (row / 8),
        });
      }
    }
    let target = null;
    let blockingPick = null;
    for (const point of samples) {
      if (point.x < canvasRect.left || point.x > canvasRect.right
          || point.y < canvasRect.top || point.y > canvasRect.bottom) continue;
      const diagnostic = register.debugPickAt(point.x, point.y);
      if (!blockingPick && diagnostic.physical) blockingPick = diagnostic.physical;
      if (diagnostic.physical?.uid === wantedUid) {
        target = { x: point.x, y: point.y };
        break;
      }
    }
    let subtreePickCount = 0;
    product.traverse((object) => { if (object.userData?.pick) subtreePickCount += 1; });
    return {
      uid: wantedUid,
      foundObject: true,
      visible: product.visible !== false,
      target,
      center,
      projectedBounds: { minX, maxX, minY, maxY },
      inView: projectedCenter.z >= -1 && projectedCenter.z <= 1
        && center.x >= canvasRect.left && center.x <= canvasRect.right
        && center.y >= canvasRect.top && center.y <= canvasRect.bottom,
      ownPick: !!product.userData.pick,
      subtreePickCount,
      visualState: product.userData.checkoutVisualState || null,
      blockingPick,
    };
  }, uid);
}

async function clickCardAndApprove(page, expectedTotalCents) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-ready' && tx.checkoutFlow?.state === 'CardInsertReady';
  }, null, { timeout: 8000 });
  await waitCamera(page, 'card');
  const card = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint());
  assert(card?.inView, `Presented card is not visible: ${JSON.stringify(card)}.`);
  await page.mouse.click(card.x, card.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-entry' && tx.checkoutFlow?.state === 'CardAmountEntry';
  }, null, { timeout: 6000 });
  await waitCamera(page, 'card');
  const amountEntry = await page.evaluate(async () => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const domain = await import('/src/sim/register.js');
    return {
      entryCents: Number(tx.cardEntryCents),
      digits: String(tx.cardEntryDigits || ''),
      enteredCents: Math.round(domain.cardEnteredAmount(tx) * 100),
      totalCents: Math.round(domain.totalOf(tx) * 100),
      error: tx.cardEntryError || null,
    };
  });
  assert(amountEntry.entryCents === 0 && amountEntry.enteredCents === 0
      && amountEntry.totalCents === expectedTotalCents
      && amountEntry.digits === '' && amountEntry.error === null,
  `Card reader did not open an empty matrix amount field: ${JSON.stringify(amountEntry)}.`);
  let keyedDigits = '';
  for (const digit of String(expectedTotalCents)) {
    const point = await page.evaluate((key) => (
      window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint(key)
    ), digit);
    assert(point?.inView, `Physical reader digit ${digit} is not visible: ${JSON.stringify(point)}.`);
    await page.mouse.click(point.x, point.y);
    keyedDigits += digit;
    await page.waitForFunction((expectedDigits) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'card-entry' && tx.cardEntryDigits === expectedDigits;
    }, keyedDigits, { timeout: 1600 });
    // Let the physical key return far enough that a neighboring projection
    // cannot win the next pick ray on dense multi-digit totals.
    await page.waitForTimeout(120);
  }
  await page.waitForFunction((expectedCents) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.cardEntryCents === expectedCents
      && tx.cardEntryDigits === String(expectedCents) && tx.cardEntryError == null;
  }, expectedTotalCents, { timeout: 2500 });
  const ok = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint('OK'));
  assert(ok?.inView, `Physical OK key is not visible: ${JSON.stringify(ok)}.`);
  await page.mouse.click(ok.x, ok.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-busy' && tx.checkoutFlow?.state === 'CardProcessing';
  }, null, { timeout: 4000 });
  return amountEntry;
}

function verifyFinal(entry, fixture, initial, final) {
  const expectedTotalCents = initial.items.reduce((sum, item) => sum + item.priceCents, 0);
  const expectedCounts = new Map();
  for (const skuId of entry.skuIds) expectedCounts.set(skuId, (expectedCounts.get(skuId) || 0) + 1);
  assert(final.cashCents - fixture.before.cashCents === expectedTotalCents,
    `${entry.id}: cash did not advance by the exact total once.`);
  assert(final.shopRevenueCents - fixture.before.shopRevenueCents === expectedTotalCents,
    `${entry.id}: shopSales ledger did not advance by the exact total once.`);
  assert(final.liveUnits - fixture.before.liveUnits === entry.skuIds.length,
    `${entry.id}: live unit count did not advance once per product.`);
  assert(final.liveRevenueCents - fixture.before.liveRevenueCents === expectedTotalCents,
    `${entry.id}: live revenue did not advance once.`);
  assert(final.historyLength - fixture.before.historyLength === 1,
    `${entry.id}: expected one new ticket.`);
  assert(final.held.length === fixture.before.held.length,
    `${entry.id}: held inventory did not return to its opening count.`);
  for (const [skuId, count] of expectedCounts) {
    assert(final.shelf[skuId] === fixture.before.shelf[skuId] - count,
      `${entry.id}/${skuId}: shelf did not debit exactly ${count}.`);
    assert(final.back[skuId] === fixture.before.back[skuId],
      `${entry.id}/${skuId}: back stock changed during checkout.`);
    assert(final.salesToday[skuId] === fixture.before.salesToday[skuId] + count,
      `${entry.id}/${skuId}: sales velocity did not advance exactly ${count}.`);
  }
  const ticket = final.latestTicket;
  assert(ticket && ticket.number === initial.number && ticket.method === 'card',
    `${entry.id}: final card ticket identity is wrong.`);
  assert(cents(ticket.total) === expectedTotalCents,
    `${entry.id}: ticket total is not exact.`);
  assert((ticket.items || []).length === entry.skuIds.length,
    `${entry.id}: ticket line count is wrong.`);
  assert(JSON.stringify(ticket.items.map((item) => ({
    uid: item.uid, skuId: item.skuId, priceCents: cents(item.price),
  }))) === JSON.stringify(initial.items.map((item) => ({
    uid: item.uid, skuId: item.skuId, priceCents: item.priceCents,
  }))), `${entry.id}: ticket lines do not exactly match staged goods.`);
  assert(final.history.filter((ticketEntry) => ticketEntry.number === initial.number).length === 1,
    `${entry.id}: transaction number appears more than once.`);
  return expectedTotalCents;
}

function reportMarkdown(result) {
  const lines = [
    '# Checkout Product Matrix',
    '',
    `- Viewport: ${result.viewport.width}x${result.viewport.height}`,
    `- Cases: ${result.cases.length}`,
    `- Basket sizes: ${PRODUCT_MATRIX_REQUIRED_COUNTS.join(', ')}`,
    `- Coverage: ${PRODUCT_MATRIX_REQUIRED_COVERAGE.join(', ')}`,
    `- Console errors: ${result.console.errors.length}`,
    `- Page errors: ${result.console.pageErrors.length}`,
    `- Non-aborted request failures: ${result.console.nonAbortedFailedRequests.length}`,
    '',
    '| Case | Items | Exact total | One-click audits | Repeat blocked | Ticket | Evidence |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const entry of result.cases) {
    lines.push(`| ${entry.label} | ${entry.skuIds.length} | $${(entry.expectedTotalCents / 100).toFixed(2)} | ${entry.clicks.length} | ${entry.clicks.filter((click) => click.repeatBlocked).length} | ${entry.final.latestTicket.number} | ${entry.evidence.length} |`);
  }
  lines.push('', 'Every mutation in this browser matrix used the normal mouse/keyboard handlers. The fixture only creates a deterministic customer with real shelf debits; pick diagnostics are read-only pixel locators.', '');
  return lines.join('\n');
}

export async function runProductStagingMatrix(page, options = {}) {
  const root = path.resolve(options.root || process.env.REGISTER_PRODUCT_MATRIX_ROOT || DEFAULT_ROOT);
  fs.mkdirSync(root, { recursive: true });
  const productionBuildBefore = captureCashierBuildSnapshot();
  const errors = [];
  const warnings = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(), error: request.failure()?.errorText || 'request failed',
  }));

  await boot(page);
  const caseResults = [];
  for (const entry of PRODUCT_MATRIX) {
    await leaveFrontDesk(page);
    const fixture = await setupCase(page, entry);
    assert(fixture.customer, `${entry.id}: deterministic customer could not be created.`);
    await page.waitForFunction((count) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.items.length === count;
    }, entry.skuIds.length, { timeout: 20000 });
    await page.evaluate(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      tx.rng = () => 0.99;
    });
    const initial = await txSnapshot(page);
    assert(initial.items.length === entry.skuIds.length, `${entry.id}: transaction line count drifted.`);
    assert(JSON.stringify(initial.items.map((item) => item.skuId)) === JSON.stringify(entry.skuIds),
      `${entry.id}: transaction order differs from the staged fixture.`);
    const expectedTotalCents = initial.items.reduce((sum, item) => sum + item.priceCents, 0);
    const caseRoot = path.join(root, entry.id);
    fs.mkdirSync(caseRoot, { recursive: true });
    const evidence = [];
    const shot = async (name) => {
      const output = path.join(caseRoot, name);
      await page.screenshot({ path: output });
      evidence.push(output);
    };

    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 5000 });
    await waitCamera(page, 'scan');
    const initialTargets = [];
    for (const item of initial.items) {
      const inspected = await inspectItemTarget(page, item.uid);
      assert(inspected.foundObject && inspected.visible && inspected.inView && inspected.target,
        `${entry.id}/${item.skuId}: staged product is not independently visible and clickable: ${JSON.stringify(inspected)}.`);
      initialTargets.push(inspected);
    }
    await shot(`01-${entry.skuIds.length}-items-staged-and-clickable.png`);

    const clicks = [];
    for (let itemIndex = 0; itemIndex < initial.items.length; itemIndex += 1) {
      const item = initial.items[itemIndex];
      const beforeClick = await txSnapshot(page);
      const target = await inspectItemTarget(page, item.uid);
      assert(target.target, `${entry.id}/${item.skuId}: click target disappeared before its turn.`);
      await page.mouse.click(target.target.x, target.target.y);
      await page.waitForFunction((uid) => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return tx && tx.items.find((candidate) => candidate.uid === uid)?.scanned;
      }, item.uid, { timeout: 5000 });
      const afterClick = await txSnapshot(page);
      assert(afterClick.scannedUids.length === beforeClick.scannedUids.length + 1,
        `${entry.id}/${item.skuId}: one click did not add exactly one scanned line.`);
      assert(afterClick.scannedUids.includes(item.uid), `${entry.id}/${item.skuId}: clicked UID was not scanned.`);
      assert(afterClick.subtotalCents - beforeClick.subtotalCents === item.priceCents,
        `${entry.id}/${item.skuId}: one click changed subtotal by the wrong amount.`);
      await page.waitForFunction((uid) => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return tx && tx.items.find((candidate) => candidate.uid === uid)?.staged;
      }, item.uid, { timeout: 8000 });
      // `item.staged` is the durable transaction flag and flips when the arc
      // begins. Wait separately for the rendered model to land and shed every
      // pick flag before probing repeated input.
      await page.waitForFunction((uid) => {
        const clubhouse = window.__fw.scene3d.clubhouse();
        let product = null;
        clubhouse.interior.traverse((object) => {
          if (!product && object.userData?.kind === 'item' && object.userData?.uid === uid
              && String(object.name || '').startsWith('CheckoutProduct_')) product = object;
        });
        if (!product || !['visible-in-bag', 'oversize-set-aside'].includes(product.userData.checkoutVisualState)) {
          return false;
        }
        let pickable = !!product.userData.pick;
        product.traverse((object) => { if (object.userData?.pick) pickable = true; });
        return !pickable;
      }, item.uid, { timeout: 8000 });
      const baggedTarget = await inspectItemTarget(page, item.uid);
      assert(baggedTarget.visible && !baggedTarget.ownPick && baggedTarget.subtreePickCount === 0,
        `${entry.id}/${item.skuId}: bagged product remained interactive: ${JSON.stringify(baggedTarget)}.`);
      assert(['visible-in-bag', 'oversize-set-aside'].includes(baggedTarget.visualState),
        `${entry.id}/${item.skuId}: product did not reach a visible bag/handoff state.`);
      // Repeat the same normal input on the now-bagged visual. It must neither
      // rescan nor alter the subtotal, even though the model remains visible.
      await page.mouse.click(baggedTarget.center.x, baggedTarget.center.y);
      await page.waitForTimeout(120);
      const afterRepeat = await txSnapshot(page);
      assert(afterRepeat && afterRepeat.scannedUids.length === afterClick.scannedUids.length
          && afterRepeat.subtotalCents === afterClick.subtotalCents,
      `${entry.id}/${item.skuId}: repeated input double-charged or mutated the basket.`);

      const remainingTargets = [];
      for (const remaining of initial.items.slice(itemIndex + 1)) {
        const inspected = await inspectItemTarget(page, remaining.uid);
        assert(inspected.visible && inspected.inView && inspected.target,
          `${entry.id}/${item.skuId}: bagged product blocked remaining ${remaining.skuId}: ${JSON.stringify(inspected)}.`);
        remainingTargets.push({ uid: remaining.uid, skuId: remaining.skuId, ...inspected });
      }
      clicks.push({
        uid: item.uid,
        skuId: item.skuId,
        target: target.target,
        beforeClick,
        afterClick,
        baggedTarget,
        repeatBlocked: afterRepeat.scannedUids.length === afterClick.scannedUids.length
          && afterRepeat.subtotalCents === afterClick.subtotalCents,
        remainingTargets,
      });
      if (itemIndex === 0) {
        await shot(`02-first-${item.skuId}-bagged-and-remaining-clickable.png`);
      }
    }

    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      return register.workspace() === 'monitor' && tx
        && tx.items.every((item) => item.scanned && item.staged);
    }, null, { timeout: 6000 });
    await page.waitForTimeout(620);
    const allScanned = await txSnapshot(page);
    assert(allScanned.scannedUids.length === entry.skuIds.length
        && allScanned.stagedUids.length === entry.skuIds.length,
    `${entry.id}: not every staged product reached the bag/handoff.`);
    assert(allScanned.subtotalCents === expectedTotalCents && allScanned.totalCents === expectedTotalCents,
      `${entry.id}: final POS total is not the exact sum of all lines.`);
    await shot(`03-all-${entry.skuIds.length}-items-bagged-exact-total.png`);

    const amountEntry = await clickCardAndApprove(page, expectedTotalCents);
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 20000 });
    const final = await stateSnapshot(page, entry.skuIds);
    verifyFinal(entry, fixture, initial, final);
    caseResults.push({
      ...entry,
      fixture,
      initial,
      expectedTotalCents,
      initialTargets,
      clicks,
      allScanned,
      amountEntry,
      final,
      evidence,
    });
  }
  await leaveFrontDesk(page);
  const nonAborted = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
  assert(errors.length === 0, `Console errors: ${errors.join(' | ')}`);
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
  assert(nonAborted.length === 0, `Non-aborted request failures: ${JSON.stringify(nonAborted)}`);
  let result = {
    ok: true,
    route: 'normal-controls-product-staging-matrix',
    viewport: { ...VIEWPORT },
    requiredBasketSizes: [...PRODUCT_MATRIX_REQUIRED_COUNTS],
    requiredCoverage: [...PRODUCT_MATRIX_REQUIRED_COVERAGE],
    cases: caseResults,
    console: {
      errors,
      warnings,
      pageErrors,
      failedRequests,
      nonAbortedFailedRequests: nonAborted,
    },
  };
  result = finalizeCashierQaResult({
    result,
    beforeSnapshot: productionBuildBefore,
    evidencePngs: caseResults.flatMap((entry) => entry.evidence),
    evidenceRoot: root,
  });
  fs.writeFileSync(path.join(root, 'REPORT.md'), reportMarkdown(result));
  fs.writeFileSync(path.join(root, 'latest-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:8457/';
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
    walk.x = 2.80 - 8;
    walk.z = 5.35 + 228;
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
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
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
  midLabel,
  insertedLabel,
  amountLabel,
  processingLabel,
  clickKeypad = false,
  emptyLabel = null,
  wrongLabel = null,
}) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-ready';
  }, null, { timeout: 7000 });
  await waitCamera(page, 'card');
  const channel = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.insertAt());
  const ready = await projectLocal(page, channel.ready);
  const inserted = await projectLocal(page, channel.inserted);
  assert(ready.inView && inserted.inView,
    `Card insertion anchors are outside the camera: ${JSON.stringify({ ready, inserted })}`);
  await page.mouse.move(ready.x, ready.y);
  await page.mouse.down();
  await page.mouse.move(
    ready.x + (inserted.x - ready.x) * 0.55,
    ready.y + (inserted.y - ready.y) * 0.55,
    { steps: 8 },
  );
  await shot(midLabel);
  await page.mouse.move(inserted.x, inserted.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-entry' && tx.checkoutFlow?.state === 'CardAmountEntry';
  }, null, { timeout: 4000 });
  await shot(insertedLabel);
  const digits = await page.evaluate(async () => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const { totalOf } = await import('/src/sim/register.js');
    const cents = Math.round(totalOf(tx) * 100);
    return String(cents);
  });
  const clickKey = async (label) => {
    const point = await page.evaluate((key) => (
      window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint(key)
    ), label);
    assert(point?.inView, `Card keypad key ${label} is outside the terminal camera.`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(100);
  };
  if (clickKeypad) {
    await clickKey('OK');
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.getTx()?.cardEntryError === 'ENTER AMOUNT'
    ));
    if (emptyLabel) await shot(emptyLabel);
    await clickKey('1');
    await clickKey('OK');
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.getTx()?.cardEntryError === 'AMOUNT MUST MATCH TOTAL'
    ));
    if (wrongLabel) await shot(wrongLabel);
    await clickKey('CLEAR');
    for (const digit of digits) await clickKey(digit);
  } else {
    await page.keyboard.type(digits, { delay: 90 });
  }
  await shot(amountLabel);
  if (clickKeypad) await clickKey('OK');
  else await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-busy' && tx.checkoutFlow?.state === 'CardProcessing';
  }, null, { timeout: 4000 });
  await shot(processingLabel);
}

async function cardRoute(page, shot) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && (tx.stage === 'card-present' || tx.stage === 'card-ready');
  }, null, { timeout: 7000 });
  await page.evaluate(() => {
    window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0;
  });
  await waitCamera(page, 'card');
  await shot('08-card-presented.png');
  await insertCardGesture(page, shot, {
    midLabel: '09-card-mid-insert.png',
    insertedLabel: '09b-card-inserted-zero.png',
    amountLabel: '09c-card-amount-entered.png',
    processingLabel: '09d-card-processing.png',
    clickKeypad: true,
    emptyLabel: '09b1-card-empty-amount-error.png',
    wrongLabel: '09b2-card-wrong-amount-error.png',
  });
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-declined';
  }, null, { timeout: 7000 });
  await shot('10-card-declined.png');
  await waitCamera(page, 'monitor');
  await page.evaluate(() => {
    window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0.99;
  });
  await monitorClick(page, 'retry-card');
  await insertCardGesture(page, shot, {
    midLabel: '11-replacement-card-mid-insert.png',
    insertedLabel: '11b-replacement-card-inserted-zero.png',
    amountLabel: '11c-replacement-card-amount-entered.png',
    processingLabel: '11d-replacement-card-processing.png',
  });
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && ['receipt', 'bagging', 'done'].includes(tx.stage);
  }, null, { timeout: 7000 });
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
  // the cash is offered IN the customer's hand inside the mixed working frame —
  // the camera only moves once the drawer actually opens
  const handful = await projectObject(page, { kind: 'money', from: 'tender' });
  assert(handful && handful.inView, 'The presented cash is not visible in the working frame.');
  await shot('08-cash-presented.png');

  // one click on the handful accepts ALL of it; the drawer slides open itself
  await page.mouse.click(handful.x, handful.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.drawerOpen;
  }, null, { timeout: 5000 }).catch(async (error) => {
    throw new Error(`${error.message} — ${await clickDiagnostic(page, handful.x, handful.y)}`);
  });
  await waitCamera(page, 'cash');
  await shot('09-cash-workspace.png');
  // the change-counting pose frames the ENTIRE till: both rows and every label
  for (const denom of [50, 20, 10, 5, 1, 0.5, 0.25, 0.1, 0.05, 0.01]) {
    const slot = await projectObject(page, { kind: 'drawer-slot', denom });
    assert(slot && slot.inView, `Drawer slot ${denom} is outside the cash camera.`);
  }
  await shot('09b-cash-drawer-open.png');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.deposited;
  }, null, { timeout: 8000 });
  await shot('10-received-cash-sorted.png');

  const wrongSlot = await projectObject(page, { kind: 'drawer-slot', denom: 5 });
  assert(wrongSlot && wrongSlot.inView, '$5 slot is not visible for the incorrect-change state.');
  await page.mouse.click(wrongSlot.x, wrongSlot.y);
  await page.waitForTimeout(180);
  await shot('10b-incorrect-change.png');
  const wrongPiece = await projectObject(page, { kind: 'money', from: 'change', denom: 5 });
  assert(wrongPiece && wrongPiece.inView, 'Selected $5 bill cannot be returned to the drawer.');
  await page.mouse.click(wrongPiece.x, wrongPiece.y);
  await page.waitForTimeout(180);

  const plan = await page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return register.makeChangeFrom(register.drawerContents(tx, window.__fw.state.shop.drawer), register.changeDue(tx));
  });
  assert(plan, 'The drawer cannot make the required change.');
  assert(JSON.stringify(plan) === JSON.stringify({ 1: 4, 0.25: 1, 0.01: 3 }),
    `Expected the exact $4.28 plan, got ${JSON.stringify(plan)}.`);
  for (const [rawDenom, count] of Object.entries(plan)) {
    const denom = Number(rawDenom);
    for (let index = 0; index < count; index += 1) {
      const slot = await projectObject(page, { kind: 'drawer-slot', denom });
      assert(slot && slot.inView, `Change slot ${denom} is not visible.`);
      await page.mouse.click(slot.x, slot.y);
      await page.waitForTimeout(130);
    }
  }
  await shot('11-correct-change-selected.png');
  const review = await projectObject(page, { kind: 'cash-review' });
  assert(review && review.inView, 'Review on Monitor control is not visible.');
  await page.mouse.click(review.x, review.y);
  await waitCamera(page, 'monitor');
  await shot('12-change-review.png');
  await monitorClick(page, 'confirm-change');
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
  const rootBase = path.resolve(process.env.REGISTER_QA_ROOT
    || 'qa/cash-register-production/simplified-rebuild/acceptance');
  const root = viewportRun.explicit
    ? path.join(rootBase, viewportRun.tag, mode)
    : path.join(rootBase, mode);
  fs.mkdirSync(root, { recursive: true });
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
  const shot = async (name) => {
    const output = path.join(root, name);
    await page.screenshot({ path: output });
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
  if (mode === 'card') await cardRoute(page, shot);
  else await cashRoute(page, shot);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'done';
  }, null, { timeout: 8000 });
  await waitCamera(page, 'monitor');
  await shot(mode === 'card' ? '13-ready-to-finalize.png' : '13-ready-to-finalize.png');
  await monitorClick(page, 'finalize-transaction');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 5000 });
  await shot('14-transaction-complete.png');

  const final = await finalSnapshot(page, fixture.customer);
  assert(final.units === fixture.before.units + 3, `Expected exactly three units, got ${final.units - fixture.before.units}.`);
  assert(final.history === fixture.before.history + 1, 'Transaction history did not advance exactly once.');
  assert(final.held === fixture.before.held, 'Held inventory did not return to its opening count.');
  assert(final.ticket && final.ticket.method === mode, `Expected ${mode} ticket.`);
  assert(final.customer && final.customer.bought && final.customer.cart === 0, 'Customer did not receive the finalized products.');
  assert(errors.length === 0, `Console errors: ${errors.join(' | ')}`);
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
  const nonAborted = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
  assert(nonAborted.length === 0, `Non-aborted request failures: ${JSON.stringify(nonAborted)}`);
  await stopMediaCapture();

  const result = {
    ok: true,
    mode,
    viewport: { ...VIEWPORT },
    requiredViewports: REQUIRED_VIEWPORTS,
    customer: fixture.customer,
    before: fixture.before,
    final,
    evidence,
    audioVideoCapture,
    console: { errors, pageErrors, failedRequests, nonAbortedFailedRequests: nonAborted },
  };
  fs.writeFileSync(path.join(root, 'latest-result.json'), JSON.stringify(result, null, 2));
  return result;
}
